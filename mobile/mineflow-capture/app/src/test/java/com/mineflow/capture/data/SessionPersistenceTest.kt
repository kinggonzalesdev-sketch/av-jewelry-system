package com.mineflow.capture.data

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Stay signed in until Logout (Owner 2026-09-25).
 *
 * The phone's session lives in SecureStore. These tests check what survives a PROCESS RESTART (app
 * closed, force-stopped, phone rebooted): only what reached disk. [DiskPrefs] models the one
 * SharedPreferences property that matters — commit() is on disk when it returns, apply() is only in
 * memory until the process lives long enough to flush it.
 */
class SessionPersistenceTest {

    @Test
    fun signedIn_survivesAProcessRestart() {
        val prefs = DiskPrefs()
        SecureStore.forTest(prefs).saveSession("access-1", "refresh-1")

        val reopened = SecureStore.forTest(prefs.restart())
        assertTrue(reopened.isLoggedIn)
        assertEquals("access-1", reopened.accessToken)
        assertEquals("refresh-1", reopened.refreshToken)
    }

    @Test
    fun rotatedRefreshToken_isOnDisk_evenIfTheAppIsKilledRightAfter() {
        val prefs = DiskPrefs()
        val store = SecureStore.forTest(prefs)
        store.saveSession("access-1", "refresh-1")
        // A silent refresh: Supabase has already spent refresh-1 and issued refresh-2.
        store.saveSession("access-2", "refresh-2")

        // Killed immediately — nothing pending is flushed.
        val reopened = SecureStore.forTest(prefs.restart())
        assertEquals("access-2", reopened.accessToken)
        assertEquals("refresh-2", reopened.refreshToken)
    }

    @Test
    fun whyTheSingleWriteMatters_separateAsyncWritesCanLoseTheRotatedToken() {
        // The old path: two setters, each an asynchronous apply(). Android normally flushes those
        // within moments, but a process killed before the flush leaves the SPENT refresh token on
        // disk, which Supabase refuses at the next launch → signed out. A narrow window, not the
        // 2026-09-24 sign-out (that was the web's every-session Logout), but it costs nothing to close.
        val prefs = DiskPrefs()
        val store = SecureStore.forTest(prefs)
        store.saveSession("access-1", "refresh-1")
        store.accessToken = "access-2"
        store.refreshToken = "refresh-2"

        val reopened = SecureStore.forTest(prefs.restart())
        assertEquals("refresh-1", reopened.refreshToken)
    }

    @Test
    fun refreshWithoutANewRefreshToken_keepsTheStoredOne() {
        val prefs = DiskPrefs()
        val store = SecureStore.forTest(prefs)
        store.saveSession("access-1", "refresh-1")
        store.saveSession("access-2", null)
        store.saveSession("access-3", "  ")

        val reopened = SecureStore.forTest(prefs.restart())
        assertEquals("access-3", reopened.accessToken)
        assertEquals("refresh-1", reopened.refreshToken)
    }

    @Test
    fun anExpiredAccessToken_aloneIsNotALogout() {
        // Access tokens expire hourly; the refresh token mints a new one silently.
        val prefs = DiskPrefs()
        SecureStore.forTest(prefs).saveSession("access-1", "refresh-1")
        prefs.edit().remove("access_token").commit()

        assertTrue(SecureStore.forTest(prefs.restart()).isLoggedIn)
    }

    @Test
    fun explicitLogout_isDurable_andKeepsTheBoxPrinterAndDevice() {
        val prefs = DiskPrefs()
        val store = SecureStore.forTest(prefs)
        val roi = CaptureRoi(0.2f, 0.55f, 0.6f, 0.05f, locked = true)
        store.captureRoi = roi
        store.printerAddress = "AA:BB:CC:DD:EE:FF"
        val device = store.deviceInstallationId
        prefs.flush() // the app ran long enough for those settings to reach disk
        store.saveSession("access-1", "refresh-1")

        store.clearSession()
        // Killed straight after Logout: it must not come back signed in.
        val reopened = SecureStore.forTest(prefs.restart())
        assertFalse(reopened.isLoggedIn)
        assertNull(reopened.accessToken)
        assertNull(reopened.refreshToken)
        assertEquals(roi, reopened.captureRoi)
        assertEquals("AA:BB:CC:DD:EE:FF", reopened.printerAddress)
        assertEquals(device, reopened.deviceInstallationId)
    }

    @Test
    fun neverSignedIn_isNotLoggedIn() {
        assertFalse(SecureStore.forTest(DiskPrefs()).isLoggedIn)
    }

    @Test
    fun phoneLogout_endsOnlyThisPhonesSession_neverEveryBrowser() {
        // GoTrue's /logout defaults to scope=global, which would sign the Owner out of every browser.
        assertTrue(ApiClient.LOGOUT_THIS_DEVICE_PATH.startsWith("/auth/v1/logout"))
        assertTrue(ApiClient.LOGOUT_THIS_DEVICE_PATH.endsWith("?scope=local"))
    }
}

/**
 * SharedPreferences with separate memory and "disk". [restart] is a new process: it sees only the
 * disk. Like Android, commit() writes the whole in-memory state to disk before returning; apply()
 * changes memory only, reaching disk on [flush] (or the next commit).
 */
private class DiskPrefs(private val disk: MutableMap<String, Any?> = HashMap()) : SharedPreferences {
    private val memory = HashMap<String, Any?>(disk)

    fun restart(): DiskPrefs = DiskPrefs(disk)

    fun flush() {
        disk.clear()
        disk.putAll(memory)
    }

    override fun getAll(): MutableMap<String, *> = HashMap(memory)
    override fun getString(key: String, defValue: String?): String? = memory[key] as String? ?: defValue
    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? =
        memory[key] as MutableSet<String>? ?: defValues
    override fun getInt(key: String, defValue: Int): Int = memory[key] as Int? ?: defValue
    override fun getLong(key: String, defValue: Long): Long = memory[key] as Long? ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = memory[key] as Float? ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = memory[key] as Boolean? ?: defValue
    override fun contains(key: String): Boolean = memory.containsKey(key)
    override fun edit(): SharedPreferences.Editor = Editor()
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    private inner class Editor : SharedPreferences.Editor {
        private val puts = LinkedHashMap<String, Any?>()
        private val removes = HashSet<String>()
        private var clearAll = false

        private fun writeTo(target: MutableMap<String, Any?>) {
            if (clearAll) target.clear()
            removes.forEach { target.remove(it) }
            target.putAll(puts)
        }

        private fun put(key: String, value: Any?): SharedPreferences.Editor {
            puts[key] = value
            return this
        }

        override fun putString(key: String, value: String?) = put(key, value)
        override fun putStringSet(key: String, values: MutableSet<String>?) = put(key, values)
        override fun putInt(key: String, value: Int) = put(key, value)
        override fun putLong(key: String, value: Long) = put(key, value)
        override fun putFloat(key: String, value: Float) = put(key, value)
        override fun putBoolean(key: String, value: Boolean) = put(key, value)
        override fun remove(key: String): SharedPreferences.Editor {
            removes.add(key)
            return this
        }
        override fun clear(): SharedPreferences.Editor {
            clearAll = true
            return this
        }
        override fun commit(): Boolean {
            writeTo(memory)
            flush()
            return true
        }
        override fun apply() {
            writeTo(memory)
        }
    }
}
