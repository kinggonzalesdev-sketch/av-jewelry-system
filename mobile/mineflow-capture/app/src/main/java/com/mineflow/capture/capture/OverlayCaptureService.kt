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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.mineflow.capture.App
import com.mineflow.capture.ui.MainActivity
import com.mineflow.capture.ui.PreviewActivity
import java.io.File
import java.io.FileOutputStream
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
                    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                    projection = mpm.getMediaProjection(code, data).also {
                        it.registerCallback(object : MediaProjection.Callback() {
                            override fun onStop() { projection = null }
                        }, handler)
                    }
                    // Consent just granted for THIS tap — capture now.
                    doCapture()
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

        // Match the launcher icon (black disc + Soft Gold lens ring) and read as a
        // camera shutter — a gold camera glyph, no text.
        val disc = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xFF111111.toInt()) // black disc, like the app icon
            setStroke(dp(3), 0xFFC9A227.toInt()) // Soft Gold "lens" ring
        }
        val view = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_menu_camera)
            setColorFilter(0xFFC9A227.toInt()) // gold camera icon
            background = disc
            val p = dp(14)
            setPadding(p, p, p, p)
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
            if (projection != null) doCapture() else CapturePermissionActivity.request(this)
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

    private fun doCapture() {
        val mp = projection
        if (mp == null) { onCaptureFailed("Screen capture unavailable — grant permission again."); return }
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") windowManager.defaultDisplay.getRealMetrics(metrics)
        val w = metrics.widthPixels; val h = metrics.heightPixels; val density = metrics.densityDpi

        val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        var vd: VirtualDisplay? = null
        reader.setOnImageAvailableListener({ r ->
            val image = r.acquireLatestImage()
            if (image == null) {
                vd?.release(); r.close()
                handler.post { onCaptureFailed("Screenshot failed — please try again.") }
                return@setOnImageAvailableListener
            }
            try {
                val plane = image.planes[0]
                val rowStride = plane.rowStride
                val pixelStride = plane.pixelStride
                val rowPadding = rowStride - pixelStride * w
                val bmp = Bitmap.createBitmap(w + rowPadding / pixelStride, h, Bitmap.Config.ARGB_8888)
                bmp.copyPixelsFromBuffer(plane.buffer)
                val cropped = Bitmap.createBitmap(bmp, 0, 0, w, h)
                val file = savePng(cropped)
                bmp.recycle(); cropped.recycle()
                handler.post { onCaptured(file) }
            } finally {
                image.close()
                vd?.release()
                r.close()
            }
        }, handler)

        vd = mp.createVirtualDisplay(
            "mineflow-capture", w, h, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface, null, handler,
        )
    }

    private fun onCaptured(file: File) {
        restoreButton()
        // Phase 1: open the capture PREVIEW (Retake / Save Draft / Discard). No order,
        // upload, send, or print happens here.
        PreviewActivity.openCapture(this, file.absolutePath)
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
