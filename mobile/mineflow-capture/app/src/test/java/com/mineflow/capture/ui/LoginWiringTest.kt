package com.mineflow.capture.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Stay signed in until Logout (Owner 2026-09-25) — the screen wiring. Activities need a device, so
 * this checks the source: launch goes straight to the dashboard while a session is stored, the
 * dashboard shows Login only once the session has genuinely ended, tokens are written in one place,
 * and phone Logout ends only this phone's session.
 */
class LoginWiringTest {

    private fun source(path: String): String =
        listOf(File(path), File("app/$path")).first { it.exists() }.readText()

    private val main = source("src/main/java/com/mineflow/capture/ui/MainActivity.kt")
    private val setup = source("src/main/java/com/mineflow/capture/ui/SetupActivity.kt")
    private val api = source("src/main/java/com/mineflow/capture/data/ApiClient.kt")

    @Test
    fun launch_goesStraightToTheDashboard_whileASessionIsStored() {
        assertTrue(main.contains("if (store.isLoggedIn) SetupActivity::class.java else LoginActivity::class.java"))
        // Decided before any screen is drawn — no network call, so no Login flash while offline.
        assertFalse(main.contains("ApiClient"))
    }

    @Test
    fun dashboard_showsLogin_onlyAfterTheSessionEnded() {
        val resume = Regex("override fun onResume\\(\\) \\{[\\s\\S]*?\\n    \\}").find(setup)?.value!!
        assertTrue(resume.contains("if (!store.isLoggedIn) {"))
        assertTrue(resume.contains("LoginActivity::class.java"))
    }

    @Test
    fun tokens_areWrittenOnlyThroughSaveSession() {
        assertFalse(api.contains("store.accessToken ="))
        assertFalse(api.contains("store.refreshToken ="))
        assertTrue(Regex("store\\.saveSession\\(").findAll(api).count() >= 2) // sign-in + refresh
    }

    @Test
    fun onlyAServerRefusal_endsTheSession_inTheNetworkLayer() {
        // clearSession in ApiClient: the refresh token the server REJECTED, and a sign-in whose staff
        // check failed. Never on UNAVAILABLE (offline, timeout, 5xx).
        val clears = Regex("store\\.clearSession\\(\\)").findAll(api).count()
        assertTrue("expected exactly 2 clearSession calls in ApiClient, got $clears", clears == 2)
        assertTrue(api.contains("RefreshOutcome.REJECTED -> {"))
    }

    @Test
    fun phoneLogout_wipesThePhoneFirst_thenEndsOnlyThisSessionOnTheServer() {
        val block = Regex("\"Log out\", white\\) \\{[\\s\\S]*?\\n        \\}").find(setup)?.value!!
        val clearAt = block.indexOf("store.clearSession()")
        val revokeAt = block.indexOf("revokeThisSession(token)")
        assertTrue(clearAt >= 0 && revokeAt > clearAt)
        assertTrue(api.contains("BuildConfig.SUPABASE_URL + LOGOUT_THIS_DEVICE_PATH"))
    }
}
