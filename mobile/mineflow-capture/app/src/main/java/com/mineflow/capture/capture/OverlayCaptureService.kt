package com.mineflow.capture.capture

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.mineflow.capture.App
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.ScreenshotOcr
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.BluetoothPrinterManager
import com.mineflow.capture.printer.DirectPrintDiag
import com.mineflow.capture.printer.StickerEncoder
import com.mineflow.capture.ui.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread
import kotlin.math.abs

/**
 * The floating "Capture Mine" button + one-tap screen capture, as a foreground
 * service so it survives while the operator is in the Facebook app.
 *
 *  - The button is draggable and remembers its last position on THIS phone.
 *  - A single tap captures ONE still (never video, never audio). The button is
 *    hidden a frame before capture so it does not appear in the screenshot, then
 *    restored.
 *  - Screen-capture consent is requested via CapturePermissionActivity the first
 *    time; the grant is reused for subsequent taps until the service stops.
 */
class OverlayCaptureService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var prefs: SharedPreferences
    private val handler = Handler(Looper.getMainLooper())

    private var button: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    private var projection: MediaProjection? = null
    // A PERSISTENT screen-mirror kept alive for the whole session, so consent is asked
    // ONCE (first capture) and every later tap grabs a frame instantly — no popup.
    private var reader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var captureW = 0
    private var captureH = 0
    @Volatile private var pendingCapture = false
    private var busy = false
    // Monotonic tap time (elapsedRealtime) for capture→print→pending timing logs.
    @Volatile private var lastTapElapsed = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        prefs = getSharedPreferences("overlay", Context.MODE_PRIVATE)
        // Start as a SPECIAL_USE foreground service. The button needs no projection,
        // and on Android 14 a mediaProjection FGS may NOT start before consent — so
        // starting as mediaProjection here is exactly what crashed the app.
        startAsForeground(mediaProjection = false)
        addButton()
        // Keep the print pump alive with the always-on service, so label jobs print to
        // the Bluetooth printer even while the operator is in the Facebook app (idempotent;
        // only acts once a printer is selected + signed in).
        com.mineflow.capture.printer.PrintJobPoller.start(this)
        // Warm the OCR model so the first real capture doesn't pay the one-time load. Passing the
        // context ALSO loads the visual pin-badge template that gates automatic Capture.
        com.mineflow.capture.data.ScreenshotOcr.warmUp(this)
    }

    /**
     * Enter (or re-enter) the foreground with the correct service type.
     *  - mediaProjection=false → SPECIAL_USE: the always-on floating button.
     *  - mediaProjection=true  → MEDIA_PROJECTION: only while a capture is active,
     *    and only AFTER the user granted screen-capture consent.
     * The type argument is required on Android 10+ and MUST be mediaProjection when
     * a projection is held on Android 14; getting the type wrong throws.
     */
    private fun startAsForeground(mediaProjection: Boolean) {
        val notif = buildNotification()
        val type = when {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> 0
            mediaProjection -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            Build.VERSION.SDK_INT >= 34 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            // API 29–33: SPECIAL_USE doesn't exist; hosting the button under the
            // mediaProjection type is allowed there (the strict rule is Android 14+).
            else -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            @Suppress("DEPRECATION") startForeground(App.CAPTURE_NOTIFICATION_ID, notif)
        } else {
            ServiceCompat.startForeground(this, App.CAPTURE_NOTIFICATION_ID, notif, type)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_HIDE -> hideButton()
            ACTION_SHOW -> addButton()
            ACTION_CAPTURE -> onCaptureTap()
            ACTION_DELIVER_PROJECTION -> {
                val code = intent.getIntExtra(EXTRA_CODE, 0)
                val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
                if (data != null) {
                    try {
                        // Android 14+: the service MUST already be a mediaProjection-type
                        // foreground service BEFORE we obtain/use the projection, or
                        // getMediaProjection()/createVirtualDisplay throws a
                        // SecurityException (the "keeps stopping" crash). Consent has
                        // just been granted, so promote the FGS type now.
                        startAsForeground(mediaProjection = true)
                        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                        projection = mpm.getMediaProjection(code, data).also {
                            it.registerCallback(object : MediaProjection.Callback() {
                                override fun onStop() { teardownCapture(); projection = null }
                            }, handler)
                        }
                        // Set up the PERSISTENT mirror once (consent just granted), then
                        // capture this tap. Every later tap reuses it — no popup.
                        setupCapture()
                        requestFrame()
                    } catch (t: Throwable) {
                        onCaptureFailed("Screen capture couldn't start — please try again.")
                    }
                }
            }
        }
        return START_STICKY
    }

    // ---- Floating button ------------------------------------------------------

    private fun addButton() {
        if (button != null) return
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        // A round, label-free camera button — fixed square bounds so the OVAL
        // background renders as a perfect circle.
        val size = dp(58)
        val lp = WindowManager.LayoutParams(
            size,
            size,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.getInt("x", dp(16))
            y = prefs.getInt("y", dp(160))
        }
        layoutParams = lp

        // A camera "shutter" button (no icon, no text): a black disc with a Soft
        // Gold rim and an ivory centre — the universal "take a picture" look. Built
        // from two stacked ovals so it reads as concentric camera-shutter circles.
        val body = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFF111111.toInt()) // black body (contrast on any app behind it)
            setStroke(dp(2), 0xFFC9A227.toInt()) // Soft Gold rim
        }
        val centre = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFFF5EFE0.toInt()) // ivory shutter centre
        }
        val shutter = LayerDrawable(arrayOf(body, centre)).apply {
            val inset = dp(9) // gap between rim and centre → the shutter ring
            setLayerInset(1, inset, inset, inset, inset)
        }
        val view = View(this).apply {
            background = shutter
            contentDescription = "Capture Mine"
            setOnTouchListener(DragTapListener())
        }
        button = view
        windowManager.addView(view, lp)
    }

    /**
     * Drag to move (position remembered); a clean single tap starts ONE capture; a
     * long press opens the quick menu (Capture Now · Hide · Open App · Stop).
     */
    private inner class DragTapListener : View.OnTouchListener {
        private var startX = 0; private var startY = 0
        private var touchX = 0f; private var touchY = 0f
        private var moved = false
        private var longPressed = false
        private val longPress = Runnable { longPressed = true; showQuickMenu() }

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val lp = layoutParams ?: return false
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x; startY = lp.y
                    touchX = e.rawX; touchY = e.rawY; moved = false; longPressed = false
                    handler.postDelayed(longPress, 550)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt(); val dy = (e.rawY - touchY).toInt()
                    if (abs(dx) > dp(6) || abs(dy) > dp(6)) {
                        moved = true
                        handler.removeCallbacks(longPress)
                    }
                    lp.x = startX + dx; lp.y = startY + dy
                    windowManager.updateViewLayout(v, lp)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    handler.removeCallbacks(longPress)
                    prefs.edit().putInt("x", lp.x).putInt("y", lp.y).apply()
                    if (!moved && !longPressed) onCaptureTap()
                }
            }
            return true
        }
    }

    private fun onCaptureTap() {
        if (busy) return
        busy = true
        lastTapElapsed = android.os.SystemClock.elapsedRealtime()
        hideQuickMenu()
        // Hide the button so it is not part of the screenshot, then capture. 100ms (was 200)
        // is enough for the overlay-window removal to clear from the screen mirror (~6 frames)
        // — trimmed to cut capture latency (P2) while keeping the button out of the shot.
        button?.visibility = View.GONE
        handler.postDelayed({
            // Reuse the live mirror when we already have consent — no popup. Only the
            // FIRST capture of a session asks for permission.
            if (reader != null && projection != null) requestFrame()
            else CapturePermissionActivity.request(this)
        }, 100)
    }

    // ---- Long-press quick menu -----------------------------------------------

    private var quickMenu: View? = null

    private fun showQuickMenu() {
        if (quickMenu != null) { hideQuickMenu(); return }
        val lpBtn = layoutParams ?: return
        val menu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xF2141414.toInt())
            setPadding(dp(6), dp(6), dp(6), dp(6))
        }
        fun item(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label; isAllCaps = false
            setTextColor(0xFFF5EFE0.toInt()); setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { hideQuickMenu(); onClick() }
        }
        menu.addView(item("Capture Now") { onCaptureTap() })
        menu.addView(item("Hide Button") { hideButton() })
        menu.addView(item("Open MineFlow Capture") { openApp() })
        menu.addView(item("Stop Capture Service") { stopSelf() })

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START; x = lpBtn.x; y = lpBtn.y + dp(48) }
        quickMenu = menu
        runCatching { windowManager.addView(menu, lp) }
    }

    private fun hideQuickMenu() {
        quickMenu?.let { runCatching { windowManager.removeView(it) } }
        quickMenu = null
    }

    private fun hideButton() {
        hideQuickMenu()
        button?.let { runCatching { windowManager.removeView(it) } }
        button = null
    }

    private fun openApp() {
        startActivity(
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    // ---- One-tap capture ------------------------------------------------------

    /**
     * Create the PERSISTENT screen-mirror once (right after consent) and keep it alive
     * for the whole session. Because the projection stays actively mirroring, Android
     * does NOT ask for consent again — so every later tap is instant.
     */
    private fun setupCapture() {
        teardownCapture()
        val mp = projection ?: return
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") windowManager.defaultDisplay.getRealMetrics(metrics)
        captureW = metrics.widthPixels
        captureH = metrics.heightPixels
        val density = metrics.densityDpi

        val r = ImageReader.newInstance(captureW, captureH, PixelFormat.RGBA_8888, 2)
        r.setOnImageAvailableListener({ rr ->
            val image = rr.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                // The mirror produces frames continuously; only SAVE one when a tap
                // requested it — otherwise just drop the frame to keep the pipeline free.
                if (pendingCapture) {
                    pendingCapture = false
                    val bmp = imageToBitmap(image)
                    handler.post { onCaptured(bmp) }
                }
            } catch (_: Throwable) {
                handler.post { onCaptureFailed("Screenshot failed — please try again.") }
            } finally {
                image.close()
            }
        }, handler)
        reader = r
        virtualDisplay = mp.createVirtualDisplay(
            "mineflow-capture", captureW, captureH, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            r.surface, null, handler,
        )
    }

    /** Save the live mirror's next frame. Falls back to the latest available frame if a
     *  static screen produces no new one. */
    private fun requestFrame() {
        val r = reader
        if (r == null) { onCaptureFailed("Screen capture unavailable — please try again."); return }
        pendingCapture = true
        handler.postDelayed({
            if (pendingCapture) {
                val image = r.acquireLatestImage()
                if (image != null) {
                    try {
                        pendingCapture = false
                        val bmp = imageToBitmap(image)
                        handler.post { onCaptured(bmp) }
                    } catch (_: Throwable) {
                        handler.post { onCaptureFailed("Screenshot failed — please try again.") }
                    } finally {
                        image.close()
                    }
                }
            }
            // Fallback only — during a live the frame listener above fires in ~16–33ms, so
            // this rarely runs. 250ms (was 400) still safely covers a static screen.
        }, 250)
    }

    /** Convert the captured frame STRAIGHT to a Bitmap — no PNG encode + file write +
     *  re-decode round-trip (that double image conversion of a full phone-screen added
     *  ~0.5–1s per capture). The caller (onCaptured) owns the returned bitmap + recycles it. */
    private fun imageToBitmap(image: android.media.Image): Bitmap {
        val plane = image.planes[0]
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val rowPadding = rowStride - pixelStride * captureW
        val padded = Bitmap.createBitmap(
            captureW + rowPadding / pixelStride, captureH, Bitmap.Config.ARGB_8888,
        )
        padded.copyPixelsFromBuffer(plane.buffer)
        val cropped = Bitmap.createBitmap(padded, 0, 0, captureW, captureH)
        padded.recycle()
        return cropped
    }

    private fun teardownCapture() {
        pendingCapture = false
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
        runCatching { reader?.close() }
        reader = null
    }

    /**
     * AUTO-SEND (no preview/retake/save-draft): one tap → capture the whole screen →
     * OCR the pinned Facebook name + mined item on-device → upload the screenshot and
     * post it as a PENDING capture. It appears on the PC's "Incoming Captures" for the
     * operator to confirm/correct, then Send Invoice delivers the screenshot to that
     * customer's Facebook/Pancake chat. A quick toast is the only on-phone feedback.
     */
    private fun onCaptured(bmp: Bitmap) {
        restoreButton()
        val ctx = this
        if (!SecureStore.get(ctx).isLoggedIn) {
            toastMain("Sign in to MineFlow Capture first.")
            bmp.recycle()
            return
        }
        toastMain("Captured ✓")
        val api = ApiClient(ctx)
        val captureId = "cap-${System.currentTimeMillis()}"
        val tapAt = System.currentTimeMillis()
        thread {
            // 1) OCR FIRST — on-device, offline, ~<1s, with NO network in front of it, so the
            //    sticker is NEVER gated on a slow live-venue upload (Owner priority 2026-08-14:
            //    the right-name / right-grams sticker must come out FIRST; the row, upload, and
            //    send all follow). A blank read (no pinned comment) leaves name/grams empty.
            val store = SecureStore.get(ctx)
            val tOcrStart = android.os.SystemClock.elapsedRealtime()
            val guess: com.mineflow.capture.data.OcrGuess?
            if (store.captureMode == SecureStore.MODE_BOX) {
                // BOX CAPTURE (Owner 2026-09-02): OCR ONLY the LOCKED box crop — never the full
                // screen, no pin. The saved normalized box is mapped to this bitmap's pixels and
                // validated; an unset / unlocked / off-screen box STOPS here (no OCR, no print, no
                // row) with a clear message (PHASE 13/15) rather than cropping a wrong region.
                val roi = store.captureRoi
                val px = roi?.toPixelRoi(bmp.width, bmp.height)
                when {
                    roi == null -> { toastMain("Set Capture Area first — Setup → Capture Area."); bmp.recycle(); return@thread }
                    !roi.locked -> { toastMain("Lock Capture Area first."); bmp.recycle(); return@thread }
                    px == null -> { toastMain("Please reset your Capture Area."); bmp.recycle(); return@thread }
                }
                val tCrop = android.os.SystemClock.elapsedRealtime()
                val crop = runCatching { Bitmap.createBitmap(bmp, px!!.left, px.top, px.width, px.height) }.getOrNull()
                if (crop == null) { toastMain("Please reset your Capture Area."); bmp.recycle(); return@thread }
                val box = ocrBoxBlocking(crop)
                runCatching { crop.recycle() }
                Log.i(
                    TAG,
                    "timing: BOX crop=${tCrop - tOcrStart}ms ocr=" +
                        "${android.os.SystemClock.elapsedRealtime() - tCrop}ms review=${box?.review}",
                )
                if (box == null || box.review != com.mineflow.capture.data.BoxReview.NONE) {
                    toastMain(
                        when (box?.review) {
                            com.mineflow.capture.data.BoxReview.NO_CLAIM -> "Claim not read — needs review."
                            com.mineflow.capture.data.BoxReview.MULTIPLE -> "More than one comment in the box — needs review."
                            else -> "Name not read — needs review." // NO_NAME / EMPTY / null
                        },
                    )
                }
                guess = box?.guess
            } else {
                guess = ocrBlocking(bmp)
                // PIN GATE (legacy full-screen path only). WAITING = no confident on-screen pin, OR the
                // detector could not operate (FAIL CLOSED). Withhold the capture ENTIRELY: no local
                // print, no PC row, no send. Box mode never shows "Waiting for Pinned Comment".
                if (guess?.pinGate == com.mineflow.capture.data.PinGate.WAITING) {
                    Log.i(TAG, "PIN GATE: WaitingForPin — capture withheld (no print, no row, no send).")
                    toastMain("Waiting for Pinned Comment — pin the customer's comment, then capture again.")
                    bmp.recycle()
                    return@thread
                }
            }
            val tOcrEnd = android.os.SystemClock.elapsedRealtime()

            val name = guess?.fbName?.trim().orEmpty()
            // ALWAYS attach the OCR result — including the RAW recognised lines — whenever OCR
            // ran, even on a blank/low-confidence read. `fbName`/`itemQuery`/`grams` stay set only
            // when confidently read (so auto-send never fires on a guess), but `rawLines` lets the
            // server record EXACTLY what ML Kit saw, so a missed name is diagnosable and the name
            // extraction can be fixed precisely instead of blindly loosened. rawLines is the
            // Owner's own capture text (RLS-scoped); it is not shown on the sticker.
            val ocr = if (guess != null) {
                JSONObject()
                    .putOpt("fbName", guess.fbName)
                    .putOpt("itemQuery", guess.itemQuery)
                    .putOpt("grams", guess.grams)
                    .put("rawLines", JSONArray(guess.rawLines))
            } else {
                null
            }

            // 2) PRINT THE STICKER NOW — the moment OCR gives a confident name + grams, print
            //    it straight over Bluetooth. NO create, NO claim, NO network wait (~0.5–1s).
            //    The row is created below already-'printed', so the PC never double-prints it.
            val diag = maybePrintDirect(name, guess?.grams, guess?.itemQuery)
            val printedLocally = diag.result == "success"
            // Technical-only diagnostic (no PII) recorded on the created row below, so the direct
            // attempt is diagnosable read-only from the server — no Logcat / tethered phone needed.
            val printDiagJson = JSONObject().apply {
                diag.asDiagMap(System.currentTimeMillis()).forEach { (k, v) -> if (v != null) put(k, v) }
            }
            val tPrintReq = android.os.SystemClock.elapsedRealtime()
            val t0 = if (lastTapElapsed > 0) lastTapElapsed else tOcrStart
            Log.i(
                TAG,
                "timing: ocr=${tOcrEnd - tOcrStart}ms tap->printReq=${tPrintReq - t0}ms " +
                    "(LOCAL PRINT before pending/network)",
            )

            // 3) Create the PENDING row (network). Born 'printed' when we printed, so the PC's
            //    auto-print claim always fails — race-free, no double-print. Idempotent per
            //    device+capture; it appears in the PC's Incoming Captures with the name/grams.
            val created = api.createPendingCapture(
                captureId, null, ocr, if (printedLocally) "printed" else null, printDiagJson,
            )
            Log.i(
                TAG,
                "timing: pendingApiEnd=${android.os.SystemClock.elapsedRealtime() - t0}ms " +
                    "(AFTER print — network never precedes the sticker)",
            )
            if (!created.ok) {
                toastMain(
                    (if (printedLocally) "Sticker printed ✓ " else "") +
                        "Upload failed: ${created.body.optString("error", "please try again")}",
                )
                bmp.recycle()
                return@thread
            }
            Log.i(TAG, "capture $captureId visible in ${System.currentTimeMillis() - tapAt}ms")

            // 4) Upload the screenshot in the BACKGROUND — a slow / failed upload can no longer
            //    delay the sticker or the capture's appearance on the PC.
            val bytes = toJpeg(bmp)
            val upAt = System.currentTimeMillis()
            val path = runCatching { api.uploadScreenshot(captureId, "image/jpeg", bytes) }.getOrNull()
            if (!path.isNullOrBlank()) {
                runCatching {
                    api.createPendingCapture(captureId, path, ocr, if (printedLocally) "printed" else null, printDiagJson)
                }
                Log.i(TAG, "capture $captureId screenshot uploaded in ${System.currentTimeMillis() - upAt}ms")
            }

            // 5) THE PC SENDS the screenshot when the Facebook match resolves — and keeps
            //    retrying as the webhook catches up (the "di agad na-detect ang Facebook" case).
            //    The phone is done: sticker printed + capture posted. One screenshot, sent once,
            //    by the PC (the phone's own auto-send was removed 2026-08-13 to kill the double).
            val printNote = if (printedLocally) "Sticker printed ✓ " else ""
            toastMain(
                when {
                    name.isNotEmpty() ->
                        "${printNote}Read \"$name\" — the PC will send it once the chat matches."
                    else -> "${printNote}Sent to MineFlow — confirm it on the PC."
                },
            )
            bmp.recycle()
        }
    }

    /**
     * DIRECT sticker print — NO DB claim, NO network. Called RIGHT AFTER OCR (before the
     * capture row even exists) so the sticker comes out FIRST (~0.5–1s) — the Owner's
     * priority. Exactly-once is handled by the caller: it then creates the row already-
     * 'printed' (create_pending_capture printStatus='printed'), so the PC's auto-print claim
     * always fails and the sticker is never double-printed. Returns true when it actually
     * printed. Safe no-op when this phone has no printer set, or the name/weight is unread
     * (a needs-review capture is left for the operator on the PC — never blind-printed).
     */
    private fun maybePrintDirect(fbName: String, grams: String?, itemQuery: String?): DirectPrintDiag {
        val t0 = android.os.SystemClock.elapsedRealtime()
        val store = SecureStore.get(this)
        // Printer toggle OFF → NEVER attempt a local Bluetooth write. Leave the capture
        // un-printed (row not born 'printed') so the PC fallback prints it; capture/OCR/upload/
        // send all continue normally. OFF keeps the saved printer.
        if (!store.printerEnabled) { Log.i(TAG, "PRINT_SOURCE=direct-local SKIP reason=printer_off"); return DirectPrintDiag.skipped("printer_off") }
        val address = store.printerAddress
        if (address.isNullOrBlank()) { Log.i(TAG, "PRINT_SOURCE=direct-local SKIP reason=no_printer"); return DirectPrintDiag.skipped("no_printer") }
        if (fbName.length < 2) { Log.i(TAG, "PRINT_SOURCE=direct-local SKIP reason=no_name"); return DirectPrintDiag.skipped("no_name") }
        // Classify the RAW value LOCALLY: a FIXED PRICE (k / ₱ / P / PHP / comma / >=1000) prints
        // "FIXED • ₱X"; a real weight prints "Xg • ₱rate/g"; neither → needs review (skip). This is
        // decided on-device BEFORE any server call, so the fixed-price sticker is as fast as grams.
        val sticker = StickerEncoder.fromCaptureAuto(fbName, grams, itemQuery, store.pricePerGram)
        if (sticker == null) { Log.i(TAG, "PRINT_SOURCE=direct-local SKIP reason=no_value"); return DirectPrintDiag.skipped("no_value") }
        // Was the RFCOMM socket ALREADY warm (keep-alive holding it) when we print? A cold socket
        // forces BluetoothPrinterManager.print() into a slow s.connect() (or a failure) — the usual
        // cause of a direct-print MISS that then falls to the mobile poller (post-network). Logged
        // AND persisted (print_diag) only — behaviour unchanged.
        val socketWarm = BluetoothPrinterManager.isConnected(address)
        return try {
            val tEnc = android.os.SystemClock.elapsedRealtime()
            val bytes = StickerEncoder.encode(sticker, store.printerTspl)
            val tWrite = android.os.SystemClock.elapsedRealtime()
            val res = BluetoothPrinterManager.print(this, address, bytes)
            val tEnd = android.os.SystemClock.elapsedRealtime()
            Log.i(
                TAG,
                "PRINT_SOURCE=direct-local socketWarm=$socketWarm stickerEncode=${tWrite - tEnc}ms " +
                    "btWrite=${tEnd - tWrite}ms ok=${res.ok}",
            )
            DirectPrintDiag(
                result = if (res.ok) "success" else "failed",
                socketWarm = socketWarm,
                errorClass = if (res.ok) null else "bt_write_fail",
                durationMs = tEnd - t0,
            )
        } catch (e: Exception) {
            Log.w(TAG, "PRINT_SOURCE=direct-local socketWarm=$socketWarm ok=false ex=${e.javaClass.simpleName}")
            DirectPrintDiag("failed", socketWarm, e.javaClass.simpleName, android.os.SystemClock.elapsedRealtime() - t0)
        }
    }

    /** Compress a screenshot bitmap to a small JPEG for a fast upload. */
    private fun toJpeg(bmp: Bitmap): ByteArray =
        java.io.ByteArrayOutputStream().use { out ->
            bmp.compress(Bitmap.CompressFormat.JPEG, 72, out)
            out.toByteArray()
        }

    /** Run on-device OCR and block briefly for the result. Safe on a background
     *  thread: ML Kit posts its callback to the main thread, which is free here. */
    private fun ocrBlocking(bmp: Bitmap): com.mineflow.capture.data.OcrGuess? {
        val latch = java.util.concurrent.CountDownLatch(1)
        var result: com.mineflow.capture.data.OcrGuess? = null
        // applyPinGate = true: this is the AUTOMATIC print path — only a visually pinned comment may
        // auto-select/print. No confident pin (or the detector can't operate) → pinGate=WAITING, and
        // onCaptured withholds the capture entirely (no print, no PC row, no send). A single pin →
        // SELECTED (reads name+claim); 2+/ambiguous → NEEDS_REVIEW (a manual-review row, no auto-send).
        ScreenshotOcr.analyze(bmp, applyPinGate = true) { g -> result = g; latch.countDown() }
        runCatching { latch.await(5, java.util.concurrent.TimeUnit.SECONDS) }
        return result
    }

    /** BOX CAPTURE (Owner 2026-09-02): OCR the already-cropped locked box and validate one name +
     *  one claim (guessBox). Blocks briefly for the result, like ocrBlocking. */
    private fun ocrBoxBlocking(crop: Bitmap): com.mineflow.capture.data.BoxGuess? {
        val latch = java.util.concurrent.CountDownLatch(1)
        var result: com.mineflow.capture.data.BoxGuess? = null
        ScreenshotOcr.analyzeBox(crop) { g -> result = g; latch.countDown() }
        runCatching { latch.await(5, java.util.concurrent.TimeUnit.SECONDS) }
        return result
    }

    private fun toastMain(msg: String) {
        handler.post { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }
    }

    private fun onCaptureFailed(reason: String) {
        restoreButton()
        handler.post { Toast.makeText(this, reason, Toast.LENGTH_SHORT).show() }
    }

    private fun restoreButton() {
        busy = false
        button?.visibility = View.VISIBLE
    }

    // ---- Notification ---------------------------------------------------------

    private fun buildNotification(): Notification {
        fun svc(id: Int, action: String) = PendingIntent.getService(
            this, id, Intent(this, OverlayCaptureService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, App.CAPTURE_CHANNEL_ID)
            .setContentText("MineFlow Capture is ready. Tap the floating button to capture a mined item.")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    "MineFlow Capture is ready. Tap the floating button to capture a mined item.",
                ),
            )
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "Open App", open)
            .addAction(0, "Hide Floating Button", svc(2, ACTION_HIDE))
            .addAction(0, "Stop Capture Service", svc(1, ACTION_STOP))
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        com.mineflow.capture.printer.PrintJobPoller.stop()
        hideQuickMenu()
        button?.let { runCatching { windowManager.removeView(it) } }
        button = null
        teardownCapture()
        projection?.stop(); projection = null
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        /** True while the capture service is alive — read by the Setup screen. */
        @Volatile var isRunning: Boolean = false
            private set

        private const val TAG = "MineFlowCapture"

        private const val ACTION_STOP = "com.mineflow.capture.STOP"
        private const val ACTION_HIDE = "com.mineflow.capture.HIDE"
        private const val ACTION_SHOW = "com.mineflow.capture.SHOW"
        private const val ACTION_CAPTURE = "com.mineflow.capture.CAPTURE"
        private const val ACTION_DELIVER_PROJECTION = "com.mineflow.capture.PROJECTION"
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"

        /** Re-show the floating button after it was hidden (from Setup). */
        fun showButton(context: Context) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java).setAction(ACTION_SHOW),
            )
        }

        fun start(context: Context) {
            val intent = Intent(context, OverlayCaptureService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java).setAction(ACTION_STOP),
            )
        }

        /** Called by CapturePermissionActivity with the consent result. */
        fun deliverProjection(context: Context, code: Int, data: Intent) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java)
                    .setAction(ACTION_DELIVER_PROJECTION)
                    .putExtra(EXTRA_CODE, code)
                    .putExtra(EXTRA_DATA, data),
            )
        }
    }
}
