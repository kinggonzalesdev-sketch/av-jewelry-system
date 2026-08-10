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
        worker = thread(name = "mineflow-print-poll", isDaemon = true) {
            val api = ApiClient(app)
            val store = SecureStore.get(app)
            while (running) {
                var drainedOne = false
                try {
                    if (store.isLoggedIn && !store.printerAddress.isNullOrBlank()) {
                        // 1) Live capture stickers (shared PC+phone queue — exactly once).
                        val cap = api.claimCaptureSticker()
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
                // Drain the queue fast on success; otherwise wait before the next poll
                // so a failing printer never becomes a hot retry loop.
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
