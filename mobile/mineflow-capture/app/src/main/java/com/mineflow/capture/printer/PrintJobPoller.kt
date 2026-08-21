package com.mineflow.capture.printer

import android.content.Context
import android.util.Log
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.SecureStore
import kotlin.concurrent.thread

/**
 * Background print pump: claims label jobs from MineFlow and prints them to the
 * selected Bluetooth printer — no PC or browser involved.
 *
 *   MineFlow server → this registered device → claim next job → connect + print the
 *   sticker → report Printed / Failed back (a failure re-queues the job).
 *
 * Poll-based (Pancake/MineFlow has no push to the phone): it asks for the next job
 * every few seconds while a printer is selected + signed in. Started while the app is
 * open AND by the always-on capture service, so labels print even while the operator
 * is in the Facebook app. Idempotent start/stop; safe to call repeatedly.
 */
object PrintJobPoller {

    private const val TAG = "MineFlowPrintPoll"
    private const val POLL_MS = 2500L

    @Volatile private var running = false
    private var worker: Thread? = null

    val isRunning: Boolean get() = running

    fun start(context: Context) {
        if (running) return
        running = true
        val app = context.applicationContext
        // Hold the printer socket warm for the whole session so a capture sticker never pays
        // a cold BluetoothSocket.connect() (the 5–10s delay). Idempotent.
        BluetoothPrinterManager.ensureKeepAlive(app)
        worker = thread(name = "mineflow-print-poll", isDaemon = true) {
            val api = ApiClient(app)
            val store = SecureStore.get(app)
            while (running) {
                var drainedOne = false
                try {
                    // printerEnabled gate: when the toggle is OFF the phone claims/prints NOTHING
                    // (the PC fallback handles stickers); no warm socket is held while OFF.
                    if (store.isLoggedIn && !store.printerAddress.isNullOrBlank() && store.printerEnabled) {
                        // 1) Live capture stickers (shared PC+phone queue — exactly once).
                        val cap = api.claimCaptureSticker()
                        // Reconcile the sticker rate WITHOUT ever fighting an explicit local Save
                        // Rate: dirty (unsynced local save) → PUSH it up (local stays authoritative);
                        // otherwise PULL only a strictly-newer server revision. Background only — the
                        // print path always reads the local cache with zero network wait.
                        reconcileRate(api, store, cap)
                        if (cap.optBoolean("claimed", false)) {
                            drainedOne = printCaptureSticker(app, api, store, cap)
                        } else {
                            // 2) Order / claim labels.
                            val job = api.claimLabelJob()
                            if (job.optBoolean("claimed", false)) {
                                drainedOne = printLabelClaimed(app, api, store, job)
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "poll error: ${e.javaClass.simpleName}")
                }
                // Drain the queue fast on success; otherwise wait before the next poll. The
                // dedicated keep-alive (BluetoothPrinterManager) now holds the socket warm, so
                // the poll no longer reconnects here.
                if (!drainedOne) {
                    try { Thread.sleep(POLL_MS) } catch (_: InterruptedException) { break }
                }
            }
        }
    }

    fun stop() {
        running = false
        worker?.interrupt()
        worker = null
        BluetoothPrinterManager.stopKeepAlive()
    }

    /** The shared price-per-gram carried on a capture-claim response (web Sticker Settings parity):
     *  a trimmed rate string, or null when the server says none / the price line is hidden (empty or
     *  JSON null). The CALLER checks `resp.has("pricePerGram")` — ABSENT (older server) ≠ present null. */
    internal fun sharedRate(resp: org.json.JSONObject): String? =
        if (resp.isNull("pricePerGram")) null
        else resp.optString("pricePerGram").trim().ifEmpty { null }

    /** The shared Sticker Settings revision (server updated_at, epoch ms) on a capture-claim
     *  response, or null when absent/blank. Compared numerically so a stale copy never wins. */
    internal fun sharedRev(resp: org.json.JSONObject): String? =
        if (!resp.has("pricePerGramRev") || resp.isNull("pricePerGramRev")) null
        else resp.optString("pricePerGramRev").trim().ifEmpty { null }

    internal data class RateDecision(val action: String, val rate: String?, val rev: String?)

    /** Is server revision [server] STRICTLY newer than the last-accepted [local]? A blank local rev
     *  (never synced) accepts any server rev; a non-numeric server rev is treated as not-newer
     *  (fail-safe: keep local). */
    internal fun revNewer(server: String?, local: String?): Boolean {
        val s = server?.trim()?.toLongOrNull() ?: return false
        val l = local?.trim()?.toLongOrNull() ?: return true
        return s > l
    }

    /**
     * PURE rate-ownership decision (unit-tested). From the local state + the server's {rate, rev}:
     *   - server didn't send the field (older server) → 'none' (keep local, untouched);
     *   - a DIRTY local save (explicit Save Rate not yet pushed) → 'push' the LOCAL rate up — the
     *     local value stays authoritative and is NEVER overwritten here;
     *   - otherwise PULL only a strictly-newer server revision → 'pull'; else 'none'.
     * This is the fix for the build-15 regression where the poll clobbered a fresh local Save Rate.
     */
    internal fun rateDecision(
        present: Boolean,
        dirty: Boolean,
        localRate: String?,
        localRev: String?,
        serverRate: String?,
        serverRev: String?,
    ): RateDecision {
        if (!present) return RateDecision("none", null, null)
        if (dirty) return RateDecision("push", localRate, null)
        if (revNewer(serverRev, localRev)) return RateDecision("pull", serverRate, serverRev)
        return RateDecision("none", null, null)
    }

    /** Execute the reconcile against the network (push) / local cache (pull). Background only —
     *  never on the print path. A failed push KEEPS the local save authoritative (retries next poll). */
    private fun reconcileRate(api: ApiClient, store: SecureStore, cap: org.json.JSONObject) {
        val d = rateDecision(
            present = cap.has("pricePerGram"),
            dirty = store.pricePerGramDirty,
            localRate = store.pricePerGram,
            localRev = store.pricePerGramServerRev,
            serverRate = sharedRate(cap),
            serverRev = sharedRev(cap),
        )
        when (d.action) {
            "push" -> {
                val res = api.pushStickerRate(store.pricePerGram)
                if (res.ok) {
                    store.pricePerGramServerRev = res.rev
                    store.pricePerGramDirty = false
                    Log.i(TAG, "sticker rate pushed to Sticker Settings (rev=${res.rev ?: "-"})")
                } else {
                    Log.i(TAG, "sticker rate push deferred — local Save Rate kept authoritative")
                }
            }
            "pull" -> {
                store.pricePerGram = d.rate
                store.pricePerGramServerRev = d.rev
                Log.i(TAG, "sticker rate pulled from Sticker Settings: ${d.rate ?: "(none)"} rev=${d.rev ?: "-"}")
            }
        }
    }

    /** Print a claimed LIVE capture sticker (shared PC+phone queue). Returns true when
     *  printed (drain the next). On failure it releases the claim (report failed) so the
     *  PC — or a retry — can take it. */
    private fun printCaptureSticker(
        context: Context,
        api: ApiClient,
        store: SecureStore,
        cap: org.json.JSONObject,
    ): Boolean {
        val id = cap.optString("capture_record_id").ifBlank { return false }
        val address = store.printerAddress ?: return false
        return try {
            val sticker = StickerEncoder.fromCapture(
                cap.optString("fb_name"),
                cap.optString("grams").ifBlank { null },
                store.pricePerGram,
            )
            val bytes = StickerEncoder.encode(sticker, store.printerTspl)
            val res = BluetoothPrinterManager.print(context, address, bytes)
            // Provenance: this capture was printed by the POST-NETWORK mobile poll queue, NOT the
            // local-first direct path (which would have marked it printed and skipped this claim).
            Log.i(TAG, "PRINT_SOURCE=mobile-poller capture=$id ok=${res.ok} (post-network queue claim)")
            api.reportCaptureSticker(id, printed = res.ok)
            res.ok
        } catch (e: Exception) {
            api.reportCaptureSticker(id, printed = false)
            false
        }
    }

    /** Print one claimed order/claim label job, report the outcome (failed re-queues). */
    private fun printLabelClaimed(
        context: Context,
        api: ApiClient,
        store: SecureStore,
        job: org.json.JSONObject,
    ): Boolean {
        val jobId = job.optString("label_job_id").ifBlank { return false }
        val address = store.printerAddress ?: return false
        return try {
            val sticker = StickerEncoder.fromLabelJob(job, store.pricePerGram)
            val bytes = StickerEncoder.encode(sticker, store.printerTspl)
            val res = BluetoothPrinterManager.print(context, address, bytes)
            if (res.ok) {
                api.reportLabelJob(jobId, printed = true)
                true
            } else {
                api.reportLabelJob(jobId, printed = false, reason = res.error)
                false
            }
        } catch (e: Exception) {
            api.reportLabelJob(jobId, printed = false, reason = e.javaClass.simpleName)
            false
        }
    }
}
