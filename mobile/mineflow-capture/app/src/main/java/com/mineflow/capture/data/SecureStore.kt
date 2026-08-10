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

    // ---- Bluetooth printer (native, on THIS device) ---------------------------
    /** MAC address of the selected active printer, or null. Remembered per device. */
    var printerAddress: String?
        get() = prefs.getString(KEY_PRINTER_ADDR, null)
        set(value) = prefs.edit().putString(KEY_PRINTER_ADDR, value).apply()

    var printerName: String?
        get() = prefs.getString(KEY_PRINTER_NAME, null)
        set(value) = prefs.edit().putString(KEY_PRINTER_NAME, value).apply()

    /** Printer language: TSPL (label printers like the XP-236B) vs ESC/POS. Default TSPL. */
    var printerTspl: Boolean
        get() = prefs.getBoolean(KEY_PRINTER_TSPL, true)
        set(value) = prefs.edit().putBoolean(KEY_PRINTER_TSPL, value).apply()

    /** Price-per-gram rate printed on the sticker (Sticker Settings parity), or null. */
    var pricePerGram: String?
        get() = prefs.getString(KEY_PRICE_PER_GRAM, null)
        set(value) = prefs.edit().putString(KEY_PRICE_PER_GRAM, value).apply()

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
        private const val KEY_PRINTER_ADDR = "printer_address"
        private const val KEY_PRINTER_NAME = "printer_name"
        private const val KEY_PRINTER_TSPL = "printer_tspl"
        private const val KEY_PRICE_PER_GRAM = "price_per_gram"

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
