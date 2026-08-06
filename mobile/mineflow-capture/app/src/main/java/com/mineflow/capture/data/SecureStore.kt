package com.mineflow.capture.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Encrypted local storage (Android Keystore-backed via EncryptedSharedPreferences).
 *
 * Holds the Supabase access/refresh tokens and a stable per-install device id.
 * NEVER stores a password. Screenshots are never persisted here. Tokens are wiped
 * on logout / session expiry.
 */
class SecureStore private constructor(private val prefs: SharedPreferences) {

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        set(value) = prefs.edit().putString(KEY_REFRESH, value).apply()

    var staffName: String?
        get() = prefs.getString(KEY_NAME, null)
        set(value) = prefs.edit().putString(KEY_NAME, value).apply()

    /** Stable installation id — the device half of the capture idempotency key. */
    val deviceInstallationId: String
        get() {
            var id = prefs.getString(KEY_DEVICE, null)
            if (id == null) {
                id = UUID.randomUUID().toString()
                prefs.edit().putString(KEY_DEVICE, id).apply()
            }
            return id
        }

    // Signed in while we hold EITHER a live access token OR a refresh token: an access
    // token expires after ~1h (shorter than a live), but the refresh token lets us mint
    // a new one silently. Only a real logout / a failed refresh clears both.
    val isLoggedIn: Boolean get() = !accessToken.isNullOrBlank() || !refreshToken.isNullOrBlank()

    fun clearSession() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).remove(KEY_NAME).apply()
    }

    companion object {
        private const val FILE = "mineflow_secure"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_NAME = "staff_name"
        private const val KEY_DEVICE = "device_installation_id"

        @Volatile private var instance: SecureStore? = null

        fun get(context: Context): SecureStore = instance ?: synchronized(this) {
            instance ?: build(context.applicationContext).also { instance = it }
        }

        private fun build(context: Context): SecureStore {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val prefs = EncryptedSharedPreferences.create(
                context,
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            return SecureStore(prefs)
        }
    }
}
