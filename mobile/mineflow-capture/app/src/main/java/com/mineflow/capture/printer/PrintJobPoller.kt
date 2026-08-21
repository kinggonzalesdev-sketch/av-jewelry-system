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
                        // Mirror the ONE saved web Sticker Settings price-per-gram into the LOCAL
                        // cache (store.pricePerGram) that the direct/local print reads — so the
                        // capture sticker shows "…g • ₱rate/g" using the configured rate, and a
                        // later web change is picked up on the next poll. This is a background sync
                        // ONLY; the print path never waits on the network. Field absent (older
                        // server) → leave the cache alone; present → set/clear to match the server.
                        if (cap.has("pricePerGram")) {
                            val r = sharedRate(cap)
                            if (store.pricePerGram != r) {
                                store.pricePerGram = r
                                Log.i(TAG, "sticker rate synced from Sticker Settings: ${r ?: "(none)"}")
                            }
                        }
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

    /**
     * The shared price-per-gram carried on a capture-claim response (web Sticker Settings parity):
     * a trimmed rate string, or null when the server says none / the price line is hidden (empty or
     * JSON null). Pure (no Android deps) so the sync rule is unit-testable. The CALLER must first
     * check `resp.has("pricePerGram")` — an ABSENT field (older server) means "leave the local cache
     * alone", which is different from a present null ("clear it").
     */
    internal fun sharedRate(resp: org.json.JSONObject): String? =
        if (resp.isNull("pricePerGram")) null
        else resp.optString("pricePerGram").trim().ifEmpty { null }

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
