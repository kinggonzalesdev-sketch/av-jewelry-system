package com.mineflow.capture.printer

import android.content.Context
import android.util.Log
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.ScreenshotOcr
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
    @Volatile private var worker: Thread? = null

    /**
     * Bumped by every start(). Each worker captures its own value and exits as soon as it no
     * longer matches, so a superseded thread can never keep claiming print jobs alongside its
     * replacement. stop() interrupts but does NOT join, so without this a thread whose interrupt
     * was swallowed by an in-flight network call could survive a stop()/start() pair and two
     * threads would claim jobs concurrently.
     */
    @Volatile private var epoch = 0

    val isRunning: Boolean get() = running && worker?.isAlive == true

    /**
     * Idempotent. Safe to call from anywhere; only ever one live worker.
     *
     * ⚠️ The guard checks the THREAD, not just the flag (Owner 2026-09-09). It used to be
     * `if (running) return`, with nothing that ever cleared `running` when the thread died — so a
     * worker killed by an Error left `running == true` forever and every later start() became a
     * permanent silent no-op. Printing could not be revived short of restarting the service.
     */
    @Synchronized
    fun start(context: Context) {
        if (running && worker?.isAlive == true) return
        val myEpoch = ++epoch
        running = true
        val app = context.applicationContext
        // Hold the printer socket warm for the whole session so a capture sticker never pays
        // a cold BluetoothSocket.connect() (the 5–10s delay). Idempotent.
        BluetoothPrinterManager.ensureKeepAlive(app)
        worker = thread(name = "mineflow-print-poll", isDaemon = true) {
            val api = ApiClient(app)
            val store = SecureStore.get(app)
            try {
            while (running && myEpoch == epoch) {
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
                            // 2) Legacy claim label_jobs queue.
                            val job = api.claimLabelJob()
                            if (job.optBoolean("claimed", false)) {
                                drainedOne = printLabelClaimed(app, api, store, job)
                            } else {
                                // 3) New Order stickers — the typed web print_jobs queue (ORDER_STICKER).
                                val order = api.claimPrintJob()
                                if (order.optBoolean("claimed", false)) {
                                    drainedOne = printPrintJob(app, api, store, order)
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    // Network / JSON / Bluetooth trouble: log and keep pumping. These are normal.
                    Log.w(TAG, "poll error: ${e.javaClass.simpleName}")
                } catch (t: Throwable) {
                    // An Error (OutOfMemory, LinkageError, a failed class-init in ApiClient or
                    // StickerEncoder) is not something a retry loop can recover from. Leave
                    // deliberately, so `finally` clears `running` and a later start() can build a
                    // FRESH thread. Previously this escaped the loop with `running` still true,
                    // wedging the poller permanently — no printing and no way back.
                    Log.e(TAG, "poll fatal, stopping loop: ${t.javaClass.simpleName}")
                    break
                }
                // Drain the queue fast on success; otherwise wait before the next poll. The
                // dedicated keep-alive (BluetoothPrinterManager) now holds the socket warm, so
                // the poll no longer reconnects here.
                if (!drainedOne) {
                    try { Thread.sleep(POLL_MS) } catch (_: InterruptedException) { break }
                }
            }
            } finally {
                // Whatever ended this worker — stop(), a superseding start(), an interrupt, or an
                // Error — the flag must reflect reality, or start() can never revive printing.
                // Only the CURRENT generation may clear it: a superseded thread finishing late
                // must not switch off its replacement.
                if (myEpoch == epoch) running = false
            }
        }
    }

    @Synchronized
    fun stop() {
        running = false
        // Bump the generation too: if the interrupt is swallowed by an in-flight network call,
        // the epoch check at the top of the loop still retires the thread on its next pass.
        epoch++
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
        // DURABLE IDEMPOTENCY (Owner 2026-09-09): if THIS device already physically printed this
        // capture — even if the earlier server acknowledgement POST failed — never print it again.
        // Re-report the success to clear it server-side, then move on. Closes the ack-failure reprint.
        if (store.wasCapturePrinted(id)) {
            runCatching { api.reportCaptureSticker(id, printed = true) }
            return false
        }
        return try {
            // Classify the RAW value: a FIXED PRICE ("15k"/"15000"/"₱15,000") prints "FIXED • ₱X";
            // a real weight prints "Xg • ₱rate/g". Matches the direct-local + PC classification.
            val sticker = StickerEncoder.fromCaptureAuto(
                // Strip a phantom leading O/0/° so a claimed OLD-capture sticker prints the clean name.
                ScreenshotOcr.sanitizeLeadingNameGlyph(cap.optString("fb_name")),
                cap.optString("grams").ifBlank { null },
                cap.optString("value").ifBlank { null },
                store.pricePerGram,
            )
            if (sticker == null) {
                api.reportCaptureSticker(id, printed = false)
                return false
            }
            val bytes = StickerEncoder.encode(sticker, store.printerTspl)
            val res = BluetoothPrinterManager.print(context, address, bytes)
            // Provenance: this capture was printed by the POST-NETWORK mobile poll queue, NOT the
            // local-first direct path (which would have marked it printed and skipped this claim).
            Log.i(TAG, "PRINT_SOURCE=mobile-poller capture=$id ok=${res.ok} (post-network queue claim)")
            // Persist the physical success LOCALLY FIRST, so a failed acknowledgement POST can never
            // cause a reprint on a later claim (the wasCapturePrinted guard above catches it).
            if (res.ok) store.rememberPrintedCapture(id)
            runCatching { api.reportCaptureSticker(id, printed = res.ok) }
                .onFailure { Log.w(TAG, "capture-result POST failed for $id — local ledger prevents reprint") }
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

    /** Print one claimed typed web print job (New Order sticker) from its PRE-RENDERED lines,
     *  reporting the outcome (a failure parks it for a manual retry). The web already computed the
     *  EXACT Order sticker lines from the order snapshot, so nothing is recomputed on-device. */
    private fun printPrintJob(
        context: Context,
        api: ApiClient,
        store: SecureStore,
        job: org.json.JSONObject,
    ): Boolean {
        val jobId = job.optString("print_job_id").ifBlank { return false }
        val address = store.printerAddress ?: return false
        return try {
            val lines = job.optJSONObject("sticker")?.optJSONArray("lines")
            if (lines == null || lines.length() == 0) {
                api.reportPrintJob(jobId, printed = false, reason = "empty_sticker")
                return false
            }
            val bytes = StickerEncoder.encodeLines(lines, store.printerTspl)
            val res = BluetoothPrinterManager.print(context, address, bytes)
            Log.i(TAG, "PRINT_SOURCE=mobile-poller order_job=$jobId ok=${res.ok}")
            api.reportPrintJob(jobId, printed = res.ok, reason = if (res.ok) null else res.error)
            res.ok
        } catch (e: Exception) {
            api.reportPrintJob(jobId, printed = false, reason = e.javaClass.simpleName)
            false
        }
    }
}
