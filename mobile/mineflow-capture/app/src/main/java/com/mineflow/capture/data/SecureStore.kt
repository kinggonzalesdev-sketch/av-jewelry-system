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

    /** Printer toggle intent: ON = auto-connect + auto-print; OFF = intentional temporary
     *  disconnect. SEPARATE from printerAddress (the configured printer) — OFF never erases it.
     *  Defaults true so an already-configured printer keeps working after an app update. */
    var printerEnabled: Boolean
        get() = prefs.getBoolean(KEY_PRINTER_ENABLED, true)
        set(value) = prefs.edit().putBoolean(KEY_PRINTER_ENABLED, value).apply()

    /** Printer language: TSPL (label printers like the XP-236B) vs ESC/POS. Default TSPL. */
    var printerTspl: Boolean
        get() = prefs.getBoolean(KEY_PRINTER_TSPL, true)
        set(value) = prefs.edit().putBoolean(KEY_PRINTER_TSPL, value).apply()

    /** Price-per-gram rate printed on the sticker (Sticker Settings parity), or null. */
    var pricePerGram: String?
        get() = prefs.getString(KEY_PRICE_PER_GRAM, null)
        set(value) = prefs.edit().putString(KEY_PRICE_PER_GRAM, value).apply()

    /** LOCAL OWNERSHIP (2026-08-21): true when the operator tapped Save Rate on THIS phone and the
     *  new value has not yet been pushed to the shared server settings. While dirty the local value
     *  is AUTHORITATIVE — the background poll must NOT overwrite it; it pushes it up instead. */
    var pricePerGramDirty: Boolean
        get() = prefs.getBoolean(KEY_PRICE_DIRTY, false)
        set(value) = prefs.edit().putBoolean(KEY_PRICE_DIRTY, value).apply()

    /** The shared Sticker Settings revision (server updated_at, epoch ms as text) this phone last
     *  accepted. A server value is pulled ONLY when its rev is strictly newer — so a stale server
     *  copy can never revert a newer local/other-device save. Empty until the first sync. */
    var pricePerGramServerRev: String?
        get() = prefs.getString(KEY_PRICE_REV, null)
        set(value) = prefs.edit().putString(KEY_PRICE_REV, value).apply()

    // ---- Box Capture (Owner 2026-09-02) ---------------------------------------
    /** Capture mode: "box" (Box Capture v1 — crop to the locked box, no machine pin) or
     *  "full_screen_pin" (the legacy full-screen + visual-pin path, preserved). Default box. */
    var captureMode: String
        get() = prefs.getString(KEY_CAPTURE_MODE, MODE_BOX) ?: MODE_BOX
        set(value) = prefs.edit().putString(KEY_CAPTURE_MODE, value).apply()

    /** The saved Capture Box as NORMALIZED fractions (survives resolution/scale/restart), or null
     *  when the operator has not set one yet. Locked state travels with it. */
    var captureRoi: CaptureRoi?
        get() {
            if (!prefs.getBoolean(KEY_ROI_SET, false)) return null
            return CaptureRoi(
                prefs.getFloat(KEY_ROI_L, 0f),
                prefs.getFloat(KEY_ROI_T, 0f),
                prefs.getFloat(KEY_ROI_W, 0f),
                prefs.getFloat(KEY_ROI_H, 0f),
                prefs.getBoolean(KEY_ROI_LOCKED, false),
            )
        }
        set(value) {
            val e = prefs.edit()
            if (value == null) {
                e.putBoolean(KEY_ROI_SET, false)
            } else {
                e.putBoolean(KEY_ROI_SET, true)
                    .putFloat(KEY_ROI_L, value.left)
                    .putFloat(KEY_ROI_T, value.top)
                    .putFloat(KEY_ROI_W, value.width)
                    .putFloat(KEY_ROI_H, value.height)
                    .putBoolean(KEY_ROI_LOCKED, value.locked)
            }
            e.apply()
        }

    /** Whether the floating controls (button + quick menu) are hidden while the locked box stays
     *  visible (PHASE 3). A small restore handle always remains so controls are never lost. */
    var controlsHidden: Boolean
        get() = prefs.getBoolean(KEY_CONTROLS_HIDDEN, false)
        set(value) = prefs.edit().putBoolean(KEY_CONTROLS_HIDDEN, value).apply()

    // ---- Durable printed-capture ledger (Owner 2026-09-09 forensic fix) -------
    /** Capture-record ids this device has PHYSICALLY printed. Kept durably (survives app/service
     *  restart) so a sticker whose Bluetooth write SUCCEEDED but whose server acknowledgement POST
     *  FAILED can NEVER be reprinted when the row is claimed again. Bounded FIFO — only the most
     *  recent ids are retained, so it cannot grow without limit. */
    fun wasCapturePrinted(id: String): Boolean =
        id.isNotBlank() && printedCaptureIds().contains(id)

    fun rememberPrintedCapture(id: String) {
        if (id.isBlank()) return
        val ids = printedCaptureIds().toMutableList()
        if (ids.contains(id)) return
        ids.add(id)
        while (ids.size > PRINTED_CAPTURE_CAP) ids.removeAt(0)
        prefs.edit().putString(KEY_PRINTED_CAPTURES, ids.joinToString("\n")).apply()
    }

    private fun printedCaptureIds(): List<String> =
        prefs.getString(KEY_PRINTED_CAPTURES, null)
            ?.split("\n")
            ?.filter { it.isNotBlank() }
            ?: emptyList()

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
        private const val KEY_PRINTER_ENABLED = "printer_enabled"
        private const val KEY_PRINTER_TSPL = "printer_tspl"
        private const val KEY_PRICE_PER_GRAM = "price_per_gram"
        private const val KEY_PRICE_DIRTY = "price_per_gram_dirty"
        private const val KEY_PRICE_REV = "price_per_gram_server_rev"
        private const val KEY_CAPTURE_MODE = "capture_mode"
        private const val KEY_ROI_SET = "capture_roi_set"
        private const val KEY_ROI_L = "capture_roi_left"
        private const val KEY_ROI_T = "capture_roi_top"
        private const val KEY_ROI_W = "capture_roi_width"
        private const val KEY_ROI_H = "capture_roi_height"
        private const val KEY_ROI_LOCKED = "capture_roi_locked"
        private const val KEY_CONTROLS_HIDDEN = "capture_controls_hidden"
        private const val KEY_PRINTED_CAPTURES = "printed_capture_ids"
        /** Cap on the durable printed-capture ledger (most-recent ids retained). */
        private const val PRINTED_CAPTURE_CAP = 1000

        /** Capture-mode values (Owner 2026-09-02). */
        const val MODE_BOX = "box"
        const val MODE_FULL_SCREEN_PIN = "full_screen_pin"

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
