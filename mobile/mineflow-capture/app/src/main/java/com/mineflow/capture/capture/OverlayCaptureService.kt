package com.mineflow.capture.capture

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import com.mineflow.capture.ui.MainActivity
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
        hideQuickMenu()
        // Hide the button so it is not part of the screenshot, then capture.
        button?.visibility = View.GONE
        handler.postDelayed({
            // Reuse the live mirror when we already have consent — no popup. Only the
            // FIRST capture of a session asks for permission.
            if (reader != null && projection != null) requestFrame()
            else CapturePermissionActivity.request(this)
        }, 200)
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
                    val file = imageToPng(image)
                    handler.post { onCaptured(file) }
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
                        val file = imageToPng(image)
                        handler.post { onCaptured(file) }
                    } catch (_: Throwable) {
                        handler.post { onCaptureFailed("Screenshot failed — please try again.") }
                    } finally {
                        image.close()
                    }
                }
            }
        }, 400)
    }

    private fun imageToPng(image: android.media.Image): File {
        val plane = image.planes[0]
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val rowPadding = rowStride - pixelStride * captureW
        val bmp = Bitmap.createBitmap(
            captureW + rowPadding / pixelStride, captureH, Bitmap.Config.ARGB_8888,
        )
        bmp.copyPixelsFromBuffer(plane.buffer)
        val cropped = Bitmap.createBitmap(bmp, 0, 0, captureW, captureH)
        val file = savePng(cropped)
        bmp.recycle(); cropped.recycle()
        return file
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
    private fun onCaptured(file: File) {
        restoreButton()
        val ctx = this
        if (!SecureStore.get(ctx).isLoggedIn) {
            toastMain("Sign in to MineFlow Capture first.")
            runCatching { file.delete() }
            return
        }
        toastMain("Sending to MineFlow…")
        val api = ApiClient(ctx)
        val captureId = file.nameWithoutExtension.ifBlank { "cap-${System.currentTimeMillis()}" }
        thread {
            val bmp = BitmapFactory.decodeFile(file.absolutePath)
            // 1) Compress to a small JPEG and upload FIRST, so the capture appears in the
            //    PC's Incoming Captures in ~1s. (The OCR reads the full bitmap below.)
            val bytes = if (bmp != null) toJpeg(bmp) else file.readBytes()
            val path = runCatching { api.uploadScreenshot(captureId, "image/jpeg", bytes) }.getOrNull()
            val res = api.createPendingCapture(captureId, path, null)
            if (!res.ok) {
                toastMain("Send failed: ${res.body.optString("error", "please try again")}")
                bmp?.recycle(); runCatching { file.delete() }
                return@thread
            }

            // 2) OCR on-device: the pinned Facebook name + mined item. Update the same
            //    pending row's guess (create_pending_capture is idempotent on
            //    device+capture), so the PC's Incoming Captures shows the pre-fill.
            val guess = if (bmp != null) ocrBlocking(bmp) else null
            val name = guess?.fbName?.trim().orEmpty()
            if (guess != null && (name.isNotEmpty() || !guess.itemQuery.isNullOrBlank())) {
                val ocr = JSONObject()
                    .putOpt("fbName", guess.fbName)
                    .putOpt("itemQuery", guess.itemQuery)
                runCatching { api.createPendingCapture(captureId, path, ocr) }
            }

            // 3) AUTO-SEND: if the pinned name resolves to EXACTLY ONE linked customer
            //    with a Facebook/Pancake chat, deliver the screenshot to them now — the
            //    one-tap goal. A shared or unrecognised name is NOT sent; it waits on the
            //    PC for the operator to link and confirm, so a wrong guess never reaches
            //    a customer. The backend send is idempotent, so a repeat tap won't dupe.
            var sentTo: String? = null
            if (!path.isNullOrBlank() && name.length >= 2) {
                val convId = runCatching { api.resolveConversation(name) }.getOrNull()
                if (!convId.isNullOrBlank()) {
                    val msg = "Hi $name! 📸 Ito po ang inyong na-mine na item. " +
                        "Ihahanda na po namin ang invoice ninyo — maraming salamat! 💛"
                    val sent = runCatching { api.send(captureId, convId, msg, path) }.getOrNull()
                    if (sent?.ok == true) sentTo = name
                }
            }
            toastMain(
                when {
                    sentTo != null -> "Sent the screenshot to $sentTo on Facebook. 💛"
                    name.isNotEmpty() -> "Read \"$name\" — confirm & link on the PC to send."
                    else -> "Sent to MineFlow — confirm it on the PC."
                },
            )
            bmp?.recycle()
            runCatching { file.delete() }
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
        ScreenshotOcr.analyze(bmp) { g -> result = g; latch.countDown() }
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

    private fun savePng(bmp: Bitmap): File {
        val dir = File(cacheDir, "captures").apply { mkdirs() }
        val file = File(dir, "capture-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return file
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
