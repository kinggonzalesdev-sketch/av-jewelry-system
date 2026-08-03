package com.mineflow.capture.data

import android.content.Context
import android.util.Base64
import android.util.Log
import com.mineflow.capture.BuildConfig
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
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

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
                "MineFlow sign-in isn't configured correctly on this build. Contact your administrator."
            status == 422 -> "Enter a valid email address."
            status == 429 -> "Too many attempts. Please wait a moment and try again."
            status in 500..599 -> "MineFlow sign-in is temporarily unavailable. Please try again shortly."
            else -> "Invalid email or password."
        }
    }

    /** Map a /api/mobile/session verification failure to a safe, specific message. */
    private fun mapSessionError(status: Int, body: JSONObject): String =
        when (body.optString("code")) {
            "account_not_found" ->
                "This account isn't registered as MineFlow staff. Contact your administrator."
            "account_inactive" ->
                "This MineFlow account has been deactivated. Contact your administrator."
            "permission_denied" ->
                "You don't have permission to use MineFlow Capture."
            else -> when {
                status == 0 -> "Network unavailable. Check your internet connection and try again."
                status == 404 -> "MineFlow endpoint not found — the app may be out of date."
                status == 401 -> "Your session couldn't be verified. Please sign in again."
                status in 500..599 -> "MineFlow is temporarily unavailable. Please try again shortly."
                else -> "Sign-in verification failed. Please try again."
            }
        }

    // ---- MineFlow backend -----------------------------------------------------

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

    fun send(captureId: String, conversationId: String, message: String, screenshotPath: String?): Result {
        val payload = JSONObject()
            .put("deviceInstallationId", store.deviceInstallationId)
            .put("captureId", captureId)
            .put("conversationId", conversationId)
            .put("message", message)
            .putOpt("screenshotPath", screenshotPath)
        return post("/api/mobile/capture/send", payload)
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

    private fun execute(base: Request): Result {
        val req = base.newBuilder()
            .addHeader("Authorization", "Bearer ${store.accessToken.orEmpty()}")
            .addHeader("Accept", "application/json")
            .build()
        val path = req.url.encodedPath // path only — never the token or query secrets
        return try {
            http.newCall(req).execute().use { resp ->
                val body = parseJson(resp.body?.string())
                val ok = resp.isSuccessful && body.optBoolean("ok", resp.isSuccessful)
                if (!ok) {
                    val code = body.optString("code").ifBlank { null }
                    Log.i(TAG, "${req.method} $path -> HTTP ${resp.code}" +
                        if (code != null) " code=$code" else "")
                }
                if (resp.code == 401) store.clearSession()
                Result(ok, resp.code, body)
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

    private companion object {
        private const val TAG = "MineFlowAuth"
    }
}
