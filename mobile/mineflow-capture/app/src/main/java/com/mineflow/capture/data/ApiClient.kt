package com.mineflow.capture.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.mineflow.capture.BuildConfig
import com.mineflow.capture.printer.BluetoothPrinterManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * All network access to MineFlow. HTTPS only. The Supabase access token is sent
 * as a Bearer header to the /api/mobile/ endpoints; the backend verifies it and
 * does every privileged action. No Pancake token or service-role key ever lives
 * in this app.
 */
class ApiClient(context: Context) {

    private val store = SecureStore.get(context)
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // Hard ceiling on a WHOLE call. connect/read timeouts bound individual phases, so a
        // request that keeps trickling bytes (captive portal, dying signal) can outlive both and
        // block the single print-poll thread indefinitely — no printing, no heartbeat, and from
        // the server it looks exactly like a dead phone.
        .callTimeout(45, TimeUnit.SECONDS)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    /**
     * What a refresh attempt established. The distinction is the whole point: only REJECTED may
     * end a session. Collapsing REJECTED and UNAVAILABLE into one "false" is the bug that signed
     * the Capture phone out mid-shift on 2026-09-09 and stopped all printing for 58 minutes.
     */
    enum class RefreshOutcome {
        /** A usable access token is now stored. */
        REFRESHED,

        /** The SERVER refused the refresh token (or there is none). The session is genuinely over. */
        REJECTED,

        /** Could not get an answer — offline, timeout, 5xx, captive portal. Session KEPT, retry later. */
        UNAVAILABLE,
    }

    data class Result(val ok: Boolean, val code: Int, val body: JSONObject)

    // ---- Auth (Supabase) ------------------------------------------------------

    /**
     * Sign in with the MineFlow account. Two steps:
     *   1. Supabase Auth password grant → access + refresh token.
     *   2. Verify against /api/mobile/session that the token maps to an ACTIVE
     *      MineFlow staff member (and cache the display name).
     * Tokens are stored in the Keystore-backed SecureStore. The password is used
     * once and never stored or logged. Returns null on success, or a safe,
     * user-facing message on failure. Diagnostics go to Logcat, sanitized.
     */
    fun signIn(email: String, password: String): String? {
        val authPath = "/auth/v1/token?grant_type=password"
        val payload = JSONObject().put("email", email).put("password", password)
        val req = Request.Builder()
            .url(BuildConfig.SUPABASE_URL + authPath)
            .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .addHeader("Content-Type", "application/json")
            .addHeader("Accept", "application/json")
            .post(payload.toString().toRequestBody(json))
            .build()

        val resp = try {
            http.newCall(req).execute()
        } catch (e: Exception) {
            Log.w(TAG, "signIn network failure at $authPath: ${e.javaClass.simpleName}")
            return "Network unavailable. Check your internet connection and try again."
        }

        resp.use {
            val body = parseJson(it.body?.string())
            val errCode = firstNonBlank(body, "error_code", "code", "error")
            Log.i(TAG, "signIn POST /auth/v1/token -> HTTP ${it.code}" +
                if (errCode != null) " code=$errCode" else "")
            if (!it.isSuccessful) return mapAuthError(it.code, body)

            val access = body.optString("access_token").trim()
            if (access.isEmpty()) {
                Log.w(TAG, "signIn HTTP ${it.code} ok but no access_token in response")
                return "Sign-in failed: no session returned. Please try again."
            }
            store.accessToken = access
            store.refreshToken = body.optString("refresh_token").trim().ifEmpty { null }
        }

        // Step 2: confirm the account is active MineFlow staff and cache the name.
        val session = get("/api/mobile/session")
        val sessCode = session.body.optString("code").ifBlank { null }
        Log.i(TAG, "signIn verify GET /api/mobile/session -> HTTP ${session.code}" +
            if (sessCode != null) " code=$sessCode" else "")
        if (!session.ok) {
            store.clearSession()
            return mapSessionError(session.code, session.body)
        }
        store.staffName = session.body.optJSONObject("staff")?.optString("name")
        return if (store.isLoggedIn) null else "Sign-in failed. Please try again."
    }

    /** Map a Supabase Auth (GoTrue) error to a safe, specific user message. */
    private fun mapAuthError(status: Int, body: JSONObject): String {
        val code = firstNonBlank(body, "error_code", "code", "error").orEmpty().lowercase()
        val desc = firstNonBlank(body, "error_description", "message", "msg").orEmpty()
        return when {
            desc.contains("Email not confirmed", true) ->
                "This account's email isn't confirmed yet. Contact your administrator."
            status == 400 && (code.contains("invalid_grant") ||
                code.contains("invalid_credentials") ||
                desc.contains("Invalid login", true)) ->
                "Invalid email or password."
            // A bad/missing apikey — a configuration problem, not the user's credentials.
            code.contains("invalid_api_key") || desc.contains("Invalid API key", true) ||
                (status == 401 && desc.isNotBlank()) ->
                "A.V. Jewelry sign-in isn't configured correctly on this build. Contact your administrator."
            status == 422 -> "Enter a valid email address."
            status == 429 -> "Too many attempts. Please wait a moment and try again."
            status in 500..599 -> "A.V. Jewelry sign-in is temporarily unavailable. Please try again shortly."
            else -> "Invalid email or password."
        }
    }

    /** Map a /api/mobile/session verification failure to a safe, specific message. */
    private fun mapSessionError(status: Int, body: JSONObject): String =
        when (body.optString("code")) {
            "account_not_found" ->
                "This account isn't registered as A.V. Jewelry staff. Contact your administrator."
            "account_inactive" ->
                "This A.V. Jewelry account has been deactivated. Contact your administrator."
            "permission_denied" ->
                "You don't have permission to use A.V. Jewelry Capture."
            else -> when {
                status == 0 -> "Network unavailable. Check your internet connection and try again."
                status == 404 -> "A.V. Jewelry endpoint not found — the app may be out of date."
                status == 401 -> "Your session couldn't be verified. Please sign in again."
                status in 500..599 -> "A.V. Jewelry is temporarily unavailable. Please try again shortly."
                else -> "Sign-in verification failed. Please try again."
            }
        }

    /**
     * Mint a fresh access token from the stored refresh token (Supabase refresh grant).
     * A live runs longer than the ~1h access-token lifetime, so this keeps the operator
     * signed in without a manual re-login. Stores the new access + rotated refresh
     * token. Never throws; diagnostics go to Logcat, sanitized.
     *
     * Serialized on a PROCESS-WIDE lock (the store is a singleton) so two concurrent
     * 401s can't both spend the same refresh token — Supabase rotates refresh tokens
     * and rejects a reused one, which would log the operator out. `usedToken` is the
     * access token the failing request carried: if the stored token already differs,
     * another thread refreshed first, so we reuse that instead of spending again.
     *
     * ⚠️ RETURNS A TRI-STATE, NOT A BOOLEAN (Owner 2026-09-09). It used to return false for
     * BOTH "Supabase rejected this refresh token" and "the network hiccuped", and the caller
     * wiped the session either way. On 2026-09-09 that silently signed the Capture phone out
     * mid-shift: the poller's `store.isLoggedIn` gate then failed forever, so it stopped
     * polling, stopped heartbeating, and 16 real customer stickers were queued to a phone that
     * would never ask for them again. Nothing recovers that but a manual sign-in.
     *
     * Losing a session must require the SERVER to say so. Anything else keeps the tokens and
     * retries on the next poll.
     */
    fun refreshAccessToken(usedToken: String? = null): RefreshOutcome = synchronized(REFRESH_LOCK) {
        if (usedToken != null && !store.accessToken.isNullOrBlank() && store.accessToken != usedToken) {
            return@synchronized RefreshOutcome.REFRESHED
        }
        // No refresh token at all: there is genuinely nothing to refresh, so this IS terminal.
        val refresh = store.refreshToken?.trim().orEmpty()
        if (refresh.isEmpty()) return@synchronized RefreshOutcome.REJECTED
        val path = "/auth/v1/token?grant_type=refresh_token"
        val payload = JSONObject().put("refresh_token", refresh)
        val req = Request.Builder()
            .url(BuildConfig.SUPABASE_URL + path)
            .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .addHeader("Content-Type", "application/json")
            .addHeader("Accept", "application/json")
            .post(payload.toString().toRequestBody(json))
            .build()
        try {
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.i(TAG, "refresh POST /auth/v1/token -> HTTP ${resp.code}")
                    return@synchronized classifyRefreshStatus(resp.code)
                }
                val body = parseJson(resp.body?.string())
                val access = body.optString("access_token").trim()
                // 200 with no token is a malformed/proxied response (captive portal, CDN error
                // page). NOT a rejection — never destroy a good session over it.
                if (access.isEmpty()) return@synchronized RefreshOutcome.UNAVAILABLE
                store.accessToken = access
                body.optString("refresh_token").trim().ifEmpty { null }
                    ?.let { store.refreshToken = it }
                return@synchronized RefreshOutcome.REFRESHED
            }
        } catch (e: Exception) {
            // Timeout, DNS, no signal, TLS. The session is almost certainly still valid.
            Log.w(TAG, "refresh network failure (session KEPT): ${e.javaClass.simpleName}")
            return@synchronized RefreshOutcome.UNAVAILABLE
        }
    }

    // ---- MineFlow backend -----------------------------------------------------

    /**
     * Lightweight heartbeat: re-verify the session so the backend records this
     * capture device as ACTIVE (the web System Check reads it). Best-effort — safe
     * to call on app open/resume; ignores the result and never throws.
     */
    fun pingSession() {
        if (!store.isLoggedIn) return
        runCatching { get("/api/mobile/session") }
    }

    fun searchInventory(query: String): JSONArray {
        val res = get("/api/mobile/inventory/search?q=" + encode(query))
        return if (res.ok) res.body.optJSONArray("items") ?: JSONArray() else JSONArray()
    }

    fun uploadScreenshot(captureId: String, contentType: String, bytes: ByteArray): String? {
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureId", captureId)
            .put("contentType", contentType)
            .put("base64", b64)
        val res = post("/api/mobile/capture/upload", payload)
        return if (res.ok) res.body.optString("path").ifEmpty { null } else null
    }

    fun createOrder(
        captureId: String,
        customerName: String,
        inventoryItemId: String,
        price: String,
        grams: String?,
        screenshotPath: String?,
        ocr: JSONObject?,
    ): Result {
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureId", captureId)
            .put("customerName", customerName)
            .put("inventoryItemId", inventoryItemId)
            .put("price", price)
            .putOpt("grams", grams)
            .putOpt("screenshotPath", screenshotPath)
            .putOpt("ocr", ocr)
        return post("/api/mobile/capture/order", payload)
    }

    /**
     * Send a PENDING capture to MineFlow: the uploaded screenshot path + the on-device
     * OCR guess (Facebook name + mined item). No order is created here — it appears on
     * the PC's "Incoming Captures" for the operator to confirm/correct into an order.
     * Idempotent per device+capture on the backend, so a repeated tap is one row.
     */
    fun createPendingCapture(
        captureId: String,
        screenshotPath: String?,
        ocr: JSONObject?,
        printStatus: String? = null,
        printDiag: JSONObject? = null,
    ): Result {
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureId", captureId)
            .putOpt("screenshotPath", screenshotPath)
            .putOpt("ocr", ocr)
            // 'printed' when this phone already printed the sticker locally, so the row is
            // born printed and the PC never double-prints it.
            .putOpt("printStatus", printStatus)
            // Technical-only direct-print diagnostic (no PII) → capture_records.print_diag.
            .putOpt("printDiag", printDiag)
        return post("/api/mobile/capture/pending", payload)
    }

    /** Resolve the Pancake conversation id for an OCR'd Facebook name (auto-send), or
     *  null when no unique linked customer matches. */
    fun resolveConversation(name: String): String? {
        val res = get("/api/mobile/customer/conversation?name=" + encode(name))
        return if (res.ok) res.body.optString("conversationId").ifBlank { null } else null
    }

    fun send(captureId: String, conversationId: String, message: String, screenshotPath: String?): Result {
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureId", captureId)
            .put("conversationId", conversationId)
            .put("message", message)
            .putOpt("screenshotPath", screenshotPath)
        return post("/api/mobile/capture/send", payload)
    }

    /**
     * Claim the next pending label job for this device. The DB hands out each job to
     * ONE device (FOR UPDATE SKIP LOCKED), so a label is never printed twice. Returns
     * the job JSON with `claimed=true` + the sticker fields, or `claimed=false` when the
     * queue is empty. Requires the confirm_claim_print_label permission (checked in DB).
     */
    fun claimLabelJob(): JSONObject {
        val payload = JSONObject().put("deviceInstallationId", store.deviceInstallationId)
        val res = post("/api/mobile/print/claim", payload)
        return if (res.ok) res.body else JSONObject().put("claimed", false)
    }

    /** Report a claimed label job as printed or failed (failed re-queues it). */
    fun reportLabelJob(labelJobId: String, printed: Boolean, reason: String? = null): Boolean {
        val payload = JSONObject()
            .put("labelJobId", labelJobId)
            .put("outcome", if (printed) "printed" else "failed")
            .putOpt("reason", reason)
        return post("/api/mobile/print/result", payload).ok
    }

    /**
     * Claim the next typed WEB print job (ORDER_STICKER) for this device — New Order stickers
     * enqueued from the web. The DB hands each job to ONE device (FOR UPDATE SKIP LOCKED), so a
     * sticker is never printed twice. Returns { claimed:true, print_job_id, job_type, sticker }
     * (sticker carries the pre-rendered `lines`), or { claimed:false } when the queue is empty.
     * Requires the confirm_claim_print_label permission (checked in DB).
     */
    fun claimPrintJob(): JSONObject {
        val payload = JSONObject().put("deviceInstallationId", store.deviceInstallationId)
        val res = post("/api/mobile/print/next", payload)
        return if (res.ok) res.body else JSONObject().put("claimed", false)
    }

    /** Report a claimed web print job printed or failed. 'printed' is terminal on the backend
     *  (a reconnect can't reprint it); 'failed' parks it for a deliberate manual retry. */
    fun reportPrintJob(printJobId: String, printed: Boolean, reason: String? = null): Boolean {
        val payload = JSONObject()
            .put("printJobId", printJobId)
            .put("outcome", if (printed) "printed" else "failed")
            .putOpt("reason", reason)
        return post("/api/mobile/print/next-result", payload).ok
    }

    /**
     * Claim the next LIVE capture sticker from the shared PC+phone queue. The DB hands
     * each eligible capture to ONE device (SKIP LOCKED), so a PC and this phone can both
     * be set up and each sticker prints exactly once. Returns the claim JSON.
     */
    fun claimCaptureSticker(): JSONObject {
        val payload = JSONObject().put("deviceInstallationId", store.deviceInstallationId)
        val res = post("/api/mobile/print/capture-claim", payload)
        return if (res.ok) res.body else JSONObject().put("claimed", false)
    }

    /**
     * Claim ONE specific capture sticker BY ID — the fast local-print path: the phone
     * that just captured claims its own sticker so it can print in ~0.5-1s without the
     * poll. Atomic + exactly-once on the backend, so the PC / poller can't also take it.
     * Returns { claimed:false } when it is already claimed/printed or not yet eligible.
     */
    fun claimCaptureStickerById(captureRecordId: String): JSONObject {
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureRecordId", captureRecordId)
        val res = post("/api/mobile/print/capture-claim", payload)
        return if (res.ok) res.body else JSONObject().put("claimed", false)
    }

    /** Report a claimed capture sticker printed, or failed (releases it for the PC). */
    fun reportCaptureSticker(captureRecordId: String, printed: Boolean): Boolean {
        val payload = JSONObject()
            .put("captureRecordId", captureRecordId)
            .put("outcome", if (printed) "printed" else "failed")
        return post("/api/mobile/print/capture-result", payload).ok
    }

    /** Outcome of pushing this phone's explicit Save Rate to the shared server Sticker Settings. */
    data class RatePush(val ok: Boolean, val rev: String?)

    /**
     * Push the operator's LOCAL Save Rate up to the shared server Sticker Settings so other phones
     * eventually receive it. Returns the new server revision (updated_at epoch ms) on success. A
     * failure leaves the local rate authoritative (the poller keeps it dirty and retries). An empty
     * string clears the shared rate. NEVER on the print path — background reconcile only.
     */
    fun pushStickerRate(rate: String?): RatePush {
        val payload = JSONObject().put("pricePerGram", rate ?: "")
        val res = post("/api/mobile/sticker-rate", payload)
        if (!res.ok) return RatePush(false, null)
        return RatePush(true, res.body.optString("pricePerGramRev").trim().ifEmpty { null })
    }

    // ---- Low-level ------------------------------------------------------------

    private fun get(path: String): Result = execute(
        Request.Builder().url(BuildConfig.API_BASE_URL + path).get().build()
    )

    private fun post(path: String, payload: JSONObject): Result = execute(
        Request.Builder().url(BuildConfig.API_BASE_URL + path)
            .post(payload.toString().toRequestBody(json))
            .build()
    )

    /** Best-effort device/APK/printer metadata headers for the server heartbeat
     *  (resolveMobileStaff reads them). NEVER secrets — no token, Bluetooth key, or customer data.
     *  Observability only: a failure here returns no headers and never blocks the request. */
    private fun deviceHeaders(): Map<String, String> = try {
        val addr = store.printerAddress
        val configured = !addr.isNullOrBlank()
        val conn = when {
            !configured -> "no_printer"
            !store.printerEnabled -> "off"
            !addr.isNullOrBlank() && BluetoothPrinterManager.isConnected(addr) -> "connected"
            else -> "connecting"
        }
        fun clean(s: String): String = s.filter { it.code in 32..126 }.take(80)
        val m = LinkedHashMap<String, String>()
        m["X-MineFlow-Device"] = clean(store.deviceInstallationId)
        m["X-MineFlow-App-Version"] = clean(BuildConfig.VERSION_NAME)
        m["X-MineFlow-Version-Code"] = BuildConfig.VERSION_CODE.toString()
        m["X-MineFlow-Commit"] = clean(BuildConfig.BUILD_COMMIT)
        m["X-MineFlow-Printer-Configured"] = if (configured) "1" else "0"
        m["X-MineFlow-Printer-Enabled"] = if (store.printerEnabled) "1" else "0"
        m["X-MineFlow-Printer-Conn"] = conn
        store.printerName?.let { val c = clean(it); if (c.isNotEmpty()) m["X-MineFlow-Printer-Name"] = c }
        m
    } catch (e: Exception) {
        emptyMap()
    }

    private fun execute(base: Request, allowRefresh: Boolean = true): Result {
        val used = store.accessToken
        val req = base.newBuilder()
            .addHeader("Authorization", "Bearer ${used.orEmpty()}")
            .addHeader("Accept", "application/json")
            .apply { deviceHeaders().forEach { (k, v) -> addHeader(k, v) } }
            .build()
        val path = req.url.encodedPath // path only — never the token or query secrets
        return try {
            val resp = http.newCall(req).execute()
            // Access token expired? Refresh ONCE with the stored refresh token and retry
            // before treating it as logged out — so a long live never forces a re-login.
            if (resp.code == 401 && allowRefresh) {
                resp.close()
                return when (refreshAccessToken(used)) {
                    RefreshOutcome.REFRESHED -> execute(base, allowRefresh = false)
                    // The server refused the refresh token itself — the session really is dead.
                    RefreshOutcome.REJECTED -> {
                        Log.i(TAG, "refresh REJECTED by server — clearing session")
                        store.clearSession()
                        Result(false, 401, JSONObject().put("error", "Session expired. Please sign in again."))
                    }
                    // Could not reach the auth server. KEEP the session and fail this ONE call;
                    // the poller retries in 2.5s. Wiping here is what silently killed printing
                    // for 58 minutes on 2026-09-09.
                    RefreshOutcome.UNAVAILABLE ->
                        Result(false, 0, JSONObject().put("error", "Network unavailable."))
                }
            }
            resp.use {
                val body = parseJson(it.body?.string())
                val ok = it.isSuccessful && body.optBoolean("ok", it.isSuccessful)
                if (!ok) {
                    val code = body.optString("code").ifBlank { null }
                    Log.i(TAG, "${req.method} $path -> HTTP ${it.code}" +
                        if (code != null) " code=$code" else "")
                }
                // A 401 that survived a SUCCESSFUL refresh used to clear the session here, on the
                // theory that the account must be deactivated. But the backend collapses every
                // auth failure into a bare 401 with no distinguishing code (authenticateMobile in
                // src/lib/mobile/auth.ts returns null for missing/invalid/expired token AND for an
                // inactive account alike), so this cannot tell "you were removed" from "Supabase
                // auth is degraded right now" — and this project has a documented history of
                // exactly that degradation. Guessing wrong signs the phone out for the rest of the
                // shift and stops all printing, which is far worse than keeping a token the server
                // will simply keep refusing. Holding a stale token grants nothing: every request is
                // re-authorized server-side by RLS. So log it and keep the session; only Supabase
                // refusing the REFRESH token (above) ends it.
                if (it.code == 401) Log.i(TAG, "401 after refresh on $path — session KEPT")
                Result(ok, it.code, body)
            }
        } catch (e: Exception) {
            Log.w(TAG, "${req.method} $path network failure: ${e.javaClass.simpleName}")
            Result(false, 0, JSONObject().put("error", "Network unavailable."))
        }
    }

    private fun encode(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    /** Parse a response body into a JSONObject, tolerating null/blank/malformed input. */
    private fun parseJson(raw: String?): JSONObject =
        try { JSONObject(raw.orEmpty().ifBlank { "{}" }) } catch (_: Exception) { JSONObject() }

    /** First non-blank string value among the given keys, or null. */
    private fun firstNonBlank(o: JSONObject, vararg keys: String): String? {
        for (k in keys) { val v = o.optString(k); if (v.isNotBlank()) return v }
        return null
    }

    companion object {
        private const val TAG = "MineFlowAuth"

        /** Process-wide lock so token refresh is serialized across ApiClient instances
         *  (the SecureStore is a singleton, so the refresh token is shared state). */
        private val REFRESH_LOCK = Any()

        /**
         * Does an HTTP status from the Supabase token endpoint mean "this refresh token is dead"?
         *
         * PURE and unit-tested — it decides whether the operator stays signed in, and getting it
         * wrong in the permissive direction stops every sticker printing until someone notices.
         *
         * GoTrue answers a bad / expired / already-rotated refresh token with 4xx (400 invalid_grant
         * is the usual one). Everything else — 5xx, 429, 408, a gateway's 502/503, or any status we
         * do not recognise — says nothing about the token's validity, only that we could not get an
         * answer. Those must NOT end the session.
         *
         * FAIL-SAFE DIRECTION: when in doubt, keep the session. A kept-but-dead session costs a few
         * futile retries that resolve themselves at the next real 401; a wrongly-cleared session
         * costs the whole shift's printing and needs a human to fix.
         */
        internal fun classifyRefreshStatus(code: Int): RefreshOutcome =
            // 408 Request Timeout and 429 Too Many Requests are 4xx but are explicitly transient.
            if (code in 400..499 && code != 408 && code != 429) RefreshOutcome.REJECTED
            else RefreshOutcome.UNAVAILABLE
    }
}
