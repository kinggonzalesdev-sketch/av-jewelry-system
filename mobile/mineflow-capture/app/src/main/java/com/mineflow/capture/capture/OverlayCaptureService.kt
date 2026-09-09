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
import android.widget.TextView
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

    // BOX CAPTURE (Owner 2026-09-02): the movable/resizable/lockable Capture Box overlay window +
    // a tiny restore handle shown when the floating controls are hidden.
    private var boxView: CaptureBoxView? = null
    private var boxLp: WindowManager.LayoutParams? = null
    private var restoreHandle: View? = null
    // The Lock/Check controls window OUTSIDE the box's upper-right (Owner 2026-09-02 reference), + whether
    // the edit UI (controls + resize grip) is currently shown. A saved locked ROI restores as FINALIZED
    // (outline only) until the operator taps Edit Box.
    private var boxControls: BoxControlsView? = null
    private var controlsLp: WindowManager.LayoutParams? = null
    private var boxEditing: Boolean = false
    // Controls were revealed by a long-press on a locked box (arms the idle auto-hide; cleared on any tap).
    private var revealedByLongPress: Boolean = false

    // TRANSIENT STATUS NOTIFICATION (Owner 2026-09-07): ONE reusable overlay shown TOP-CENTER, below
    // the status bar / display cutout, for every short Capture message ("Captured ✓", "Sticker printed
    // ✓ …", name-read / upload results). It replaces the old system Toast, which on API 30+ is pinned
    // bottom-centre (over Facebook comments + the Capture Box) and cannot be restyled or moved. A new
    // message REPLACES the current one in the same spot (never stacks). It is FLAG_NOT_TOUCHABLE so it
    // never consumes a Facebook tap/scroll, and — like every overlay here — it is hidden before each
    // screenshot so it can never land in the OCR crop or the saved image. Position/presentation only;
    // no message text or capture/print logic changes.
    private var notifView: View? = null
    private var notifText: TextView? = null
    private var notifLp: WindowManager.LayoutParams? = null
    private val notifDismiss = Runnable { notifView?.visibility = View.GONE }

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

    /**
     * True while the CAPTURE side is off and only printing is running.
     *
     * PERSISTED in prefs, because the service is now START_STICKY: an OEM kill or a low-memory
     * reclaim re-creates it with a null Intent, and in-memory-only state would put the floating
     * button and Capture Box back on the operator's screen uninvited — precisely what
     * "nothing more, nothing less" forbids.
     */
    private var overlayStopped = false

    /** Bumped whenever capture is stopped, so a tap's delayed runnable — or a consent grant that
     *  was already on screen — can tell it belongs to a generation the operator has cancelled. */
    @Volatile private var captureEpoch = 0

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        prefs = getSharedPreferences("overlay", Context.MODE_PRIVATE)
        // Seed from the persisted choice so a sticky re-creation honours it. The Intent (read in
        // onStartCommand, which always runs straight after) can still force printing-only for boot.
        overlayStopped = prefs.getBoolean(PREF_OVERLAY_STOPPED, false)
        // Start as a SPECIAL_USE foreground service. The button needs no projection,
        // and on Android 14 a mediaProjection FGS may NOT start before consent — so
        // starting as mediaProjection here is exactly what crashed the app.
        startAsForeground(mediaProjection = false)
        // Keep the print pump alive with the always-on service, so label jobs print to
        // the Bluetooth printer even while the operator is in the Facebook app (idempotent;
        // only acts once a printer is selected + signed in).
        com.mineflow.capture.printer.PrintJobPoller.start(this)
        // Warm the OCR model so the first real capture doesn't pay the one-time load. Passing the
        // context ALSO loads the visual pin-badge template that gates automatic Capture.
        com.mineflow.capture.data.ScreenshotOcr.warmUp(this)
        // NOTE: the floating button and Capture Box are NOT restored here any more — onStartCommand
        // owns that, because only it can see whether this start was printing-only.
    }

    /**
     * Put the capture overlays back exactly as the operator left them: the floating button, a saved
     * Capture Box, and the hidden-controls layout.
     *
     * Factored out so "Show Floating Button" reinstates everything "Stop Capture" removed. When
     * only addButton() was restored, Box Mode came back with the aiming rectangle INVISIBLE while
     * still cropping and still printing — a capture aimed at something the operator cannot see.
     */
    private fun restoreOverlays() {
        addButton()
        // Box Capture (Owner 2026-09-02): restore a saved box + the hidden-controls state across a
        // service restart, so the operator's setup survives (PHASE 16). Orientation/scale changes are
        // handled at capture time — an off-screen box fails safely there rather than cropping wrong.
        val store = SecureStore.get(this)
        if (store.captureMode == SecureStore.MODE_BOX && store.captureRoi != null) {
            // Restore the saved box as FINALIZED (outline only) — editing UI returns via Edit Box.
            boxEditing = false
            showCaptureBox()
        }
        if (store.controlsHidden) setControlsHidden(true)
    }

    /** Record the capture-side on/off choice so it survives a sticky restart. */
    private fun setOverlayStopped(stopped: Boolean) {
        overlayStopped = stopped
        captureActive = !stopped
        runCatching { prefs.edit().putBoolean(PREF_OVERLAY_STOPPED, stopped).apply() }
    }

    /**
     * Update the ongoing notification WITHOUT re-entering the foreground.
     *
     * startForeground() would also change the service TYPE, and dropping to SPECIAL_USE while a
     * MediaProjection is held is the illegal Android 14 state that has already crashed this app.
     * Use this for every text/action refresh; call startAsForeground ONLY for a genuine type change.
     */
    private fun refreshNotification() {
        runCatching {
            androidx.core.app.NotificationManagerCompat.from(this)
                .notify(App.CAPTURE_NOTIFICATION_ID, buildNotification())
        }
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
            // "Stop Capture" now stops the CAPTURE side only and leaves printing running
            // (Owner 2026-09-09). It used to stopSelf(), which also killed PrintJobPoller via
            // onDestroy — so one button labelled "Stop Capture Service" silently ended order-sticker
            // printing too, permanently (START_NOT_STICKY means Android never brings it back). Two
            // unrelated features behind one control, with no hint that printing was one of them.
            ACTION_STOP -> { stopOverlayKeepPrinting(); return START_STICKY }
            // The real full stop, reachable from the notification and Log out, and labelled so the
            // consequence is visible before it is tapped.
            ACTION_STOP_ALL -> { stopSelf(); return START_NOT_STICKY }
            // A plain start (null action): either the operator opening the overlay, or a printing-only
            // boot start, or a sticky re-creation with a null Intent. The MODE TRAVELS IN THE INTENT
            // rather than a companion flag — a static was only ever cleared inside onCreate, so on the
            // two paths where onCreate does not run (the foreground start being refused, or a ROM
            // sending two boot broadcasts) it stayed armed and silently suppressed the floating button
            // on the operator's NEXT deliberate start.
            null -> {
                val printingOnly = intent?.getBooleanExtra(EXTRA_PRINTING_ONLY, false) ?: false
                if (printingOnly) {
                    setOverlayStopped(true)
                    startAsForeground(mediaProjection = false)
                } else if (!overlayStopped) {
                    restoreOverlays()
                }
            }
            ACTION_HIDE -> hideButton()
            ACTION_SHOW -> {
                setOverlayStopped(false)
                restoreOverlays()
                // Clear any capture latch stranded by a Stop or a cancelled consent dialog,
                // otherwise the restored button is inert and gives no feedback at all.
                busy = false
                // NOT startAsForeground: re-entering the foreground as SPECIAL_USE while a
                // MediaProjection is still held is the illegal Android 14 state that crashed this
                // app before. A plain notify() updates the same notification with no type change.
                refreshNotification()
            }
            ACTION_CAPTURE -> onCaptureTap()
            ACTION_SHOW_BOX -> showCaptureBox()
            ACTION_EDIT_BOX -> enterEditMode()
            ACTION_RESET_BOX -> resetCaptureBox()
            ACTION_HIDE_CONTROLS -> setControlsHidden(true)
            ACTION_SHOW_CONTROLS -> setControlsHidden(false)
            ACTION_DELIVER_PROJECTION -> {
                val code = intent.getIntExtra(EXTRA_CODE, 0)
                val data = intent.getParcelableExtra<Intent>(EXTRA_DATA)
                // The consent dialog can be granted AFTER "Stop Capture" (it was already on screen).
                // Honour the stop: do not silently resume mirroring and print a sticker the operator
                // did not ask for.
                if (overlayStopped) {
                    Log.i(TAG, "projection consent arrived after Stop Capture — ignoring")
                    busy = false
                } else if (data != null) {
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
        // GUARDED (Owner 2026-09-09): every other addView in this file already used runCatching;
        // this one did not. Without the overlay permission it throws BadTokenException, and since
        // addButton() runs from onCreate that killed the whole service — which, once a boot
        // receiver restarts the service, would be a crash on every single reboot.
        val added = runCatching { windowManager.addView(view, lp) }.isSuccess
        if (!added) {
            Log.w(TAG, "overlay button not added (permission revoked?) — printing continues")
            button = null
            overlayStopped = true
        }
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
        // Hide the Capture Box outline + restore handle + lock chip too, so NO overlay decoration
        // (border, ✓/lock icons, resize grip, unlock chip) can land in the screenshot — the crop is
        // proven to contain Facebook content only. The saved box coords are unaffected.
        boxView?.visibility = View.GONE
        restoreHandle?.visibility = View.GONE
        boxControls?.visibility = View.GONE
        // Hide the transient status notification too, so a lingering message from a PREVIOUS capture
        // can never appear in THIS screenshot (belt-and-braces: it is a top-centre window, well away
        // from the ROI, and messages are only shown AFTER a frame is grabbed).
        hideNotif()
        val tapEpoch = captureEpoch
        handler.postDelayed({
            // Bail if capture was stopped between the tap and this runnable — otherwise the consent
            // dialog appears AFTER "Stop Capture" and, if granted, captures and prints unbidden.
            if (tapEpoch != captureEpoch || overlayStopped) {
                busy = false
                return@postDelayed
            }
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
        menu.addView(item("Open A.V. Jewelry Capture") { openApp() })
        // Overlay-only stop: this menu is a capture control, so it must not silently end printing.
        menu.addView(item("Stop Capture (printing stays on)") { stopOverlayKeepPrinting() })

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

    // ---- Capture Box overlay (Owner 2026-09-02) -------------------------------

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    private fun screenSize(): Pair<Int, Int> {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION") windowManager.defaultDisplay.getRealMetrics(m)
        return m.widthPixels to m.heightPixels
    }

    /** Show the Capture Box at the saved (or default) normalized position. FINALIZED (outline only, no
     *  controls) unless we are in edit mode. Idempotent. */
    private fun showCaptureBox() {
        if (boxView != null) { applyBoxState(); return }
        val store = SecureStore.get(this)
        val roi = (store.captureRoi ?: com.mineflow.capture.data.CaptureRoi.default()).normalized()
        if (store.captureRoi == null) store.captureRoi = roi // seed a usable default
        val (sw, sh) = screenSize()
        val lp = WindowManager.LayoutParams(
            (roi.width * sw).toInt().coerceAtLeast(dp(48)),
            (roi.height * sh).toInt().coerceAtLeast(dp(48)),
            overlayType(),
            boxFlags(),
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (roi.left * sw).toInt()
            y = (roi.top * sh).toInt()
        }
        val view = CaptureBoxView(this).apply { editUi = boxEditing }
        view.setOnTouchListener(BoxTouchListener())
        boxLp = lp
        boxView = view
        runCatching { windowManager.addView(view, lp) }
        applyBoxState()
    }

    private fun hideCaptureBox() {
        boxView?.let { runCatching { windowManager.removeView(it) } }
        boxView = null
        boxLp = null
        hideControls()
    }

    // COORDINATE ALIGNMENT (Owner 2026-09-02). FLAG_LAYOUT_IN_SCREEN lays the box out in the FULL physical
    // screen from the top-left, so the window's (x,y) are the SAME pixels the MediaProjection mirror
    // captures (getRealMetrics both sides) — overlay-Y == bitmap-Y. The box is ALWAYS touchable: in Ready
    // it catches the long-press (reveal controls) and ignores tap/drag; in Edit it resizes/moves from any
    // edge/corner. It is hidden during the screenshot so it never contaminates OCR.
    private fun boxFlags(): Int =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN

    private fun isRoiLocked(): Boolean = SecureStore.get(this).captureRoi?.locked ?: false

    /** Apply the current state to the box + controls: the resize grip (edit only) and whether the
     *  external Lock/Check controls are shown. The box window is always touchable. */
    private fun applyBoxState() {
        val lp = boxLp ?: return
        val v = boxView ?: return
        lp.flags = boxFlags()
        v.editUi = boxEditing
        runCatching { windowManager.updateViewLayout(v, lp) }
        if (boxEditing) showControls() else hideControls()
        boxControls?.locked = isRoiLocked()
    }

    /** Persist the box's current window rect as the normalized ROI (keeps the current locked flag). */
    private fun saveBoxFromWindow() {
        val lp = boxLp ?: return
        val (sw, sh) = screenSize()
        if (sw <= 0 || sh <= 0) return
        val locked = isRoiLocked()
        SecureStore.get(this).captureRoi = com.mineflow.capture.data.CaptureRoi(
            lp.x.toFloat() / sw, lp.y.toFloat() / sh, lp.width.toFloat() / sw, lp.height.toFloat() / sh, locked,
        ).normalized()
    }

    /** Edit Box (dashboard) → show the box UNLOCKED with the Lock/Check controls + resize grip. */
    private fun enterEditMode() {
        val store = SecureStore.get(this)
        store.captureRoi = (store.captureRoi ?: com.mineflow.capture.data.CaptureRoi.default()).copy(locked = false)
        boxEditing = true
        revealedByLongPress = false
        cancelAutoHide()
        if (boxView == null) showCaptureBox() else applyBoxState()
        toastMain("Edit Capture Area — drag to move, drag any edge/corner to resize. Tap ✓ when done.")
    }

    /** Unlock control → enable / re-freeze move + resize; the box AND controls STAY visible. Any control
     *  tap cancels the long-press auto-hide (the operator is clearly interacting now). */
    private fun toggleBoxLock() {
        val store = SecureStore.get(this)
        saveBoxFromWindow()
        val nowLocked = !isRoiLocked()
        store.captureRoi = (store.captureRoi ?: com.mineflow.capture.data.CaptureRoi.default()).copy(locked = nowLocked)
        revealedByLongPress = false
        cancelAutoHide()
        applyBoxState()
        toastMain(if (nowLocked) "Locked — tap the lock to move/resize." else "Unlocked — drag to move, drag any edge/corner to resize.")
    }

    /** Check (Done) → save + finalize: hide Lock, Check, the resize grip and every editing affordance,
     *  leaving ONLY the gold box outline. Re-edit later by LONG-PRESSING the box (or dashboard Edit Box). */
    private fun finalizeBox() {
        saveBoxFromWindow()
        val store = SecureStore.get(this)
        store.captureRoi = (store.captureRoi ?: com.mineflow.capture.data.CaptureRoi.default()).copy(locked = true)
        boxEditing = false
        revealedByLongPress = false
        cancelAutoHide()
        applyBoxState()
        toastMain("Capture Area saved.")
    }

    // ---- Long-press reveal (from the finalized box) + auto-hide ----------------
    /** Long-press on a LOCKED/READY box reveals the Lock/Check controls WITHOUT unlocking — the box stays
     *  immobile until the operator explicitly taps Unlock (prevents accidental movement during a Live). */
    private fun revealControlsFromLongPress() {
        if (!isRoiLocked()) return // already editable
        boxEditing = true
        revealedByLongPress = true
        applyBoxState()
        armAutoHide()
        toastMain("Tap the lock to edit, or ✓ to keep it.")
    }

    private val autoHideControls = Runnable {
        // If the operator did nothing after the long-press (still locked, revealed by long-press), tidy up
        // back to the clean outline. Never fires mid-edit — any control tap / unlock cancels it first.
        if (boxEditing && isRoiLocked() && revealedByLongPress) {
            boxEditing = false
            revealedByLongPress = false
            applyBoxState()
        }
    }

    private fun armAutoHide() { handler.removeCallbacks(autoHideControls); handler.postDelayed(autoHideControls, 6000) }
    private fun cancelAutoHide() { handler.removeCallbacks(autoHideControls) }

    private fun resetCaptureBox() {
        SecureStore.get(this).captureRoi = com.mineflow.capture.data.CaptureRoi.default()
        boxEditing = true
        hideCaptureBox()
        showCaptureBox()
        toastMain("Capture Area reset — position it over one comment, then tap ✓.")
    }

    // ---- Lock/Check controls window (OUTSIDE the box, upper-right) -------------
    private fun showControls() {
        val box = boxLp ?: return
        if (boxControls == null) {
            val v = BoxControlsView(this).apply { locked = isRoiLocked() }
            val lp = WindowManager.LayoutParams(
                v.rowW, v.rowH, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.TOP or Gravity.START }
            v.setOnTouchListener(ControlsTouchListener(v))
            boxControls = v
            controlsLp = lp
            runCatching { windowManager.addView(v, lp) }
        } else {
            boxControls?.locked = isRoiLocked()
        }
        // box is referenced by positionControls via boxLp; keep the reference to avoid an unused warning.
        box.let { positionControls() }
    }

    private fun hideControls() {
        boxControls?.let { runCatching { windowManager.removeView(it) } }
        boxControls = null
        controlsLp = null
    }

    /** Place the controls just OUTSIDE the box's upper-right; reposition so they are never clipped at the
     *  top/right screen edges. The Capture Box coordinates themselves are never changed. */
    private fun positionControls() {
        val box = boxLp ?: return
        val lp = controlsLp ?: return
        val v = boxControls ?: return
        val (sw, sh) = screenSize()
        val gap = dp(8)
        var x = box.x + box.width - v.rowW      // right-aligned to the box right edge
        var y = box.y - v.rowH - gap            // above the box
        if (y < 0) y = box.y + gap              // box near the top → drop just inside the top-right
        if (x + v.rowW > sw) x = sw - v.rowW - gap  // near the right edge → shift left
        if (x < 0) x = gap
        if (y + v.rowH > sh) y = sh - v.rowH - gap
        lp.x = x; lp.y = y
        runCatching { windowManager.updateViewLayout(v, lp) }
    }

    private inner class ControlsTouchListener(private val v: BoxControlsView) : View.OnTouchListener {
        override fun onTouch(view: View, e: MotionEvent): Boolean {
            if (e.action == MotionEvent.ACTION_UP) {
                when (v.hitControl(e.x, e.y)) {
                    BoxControl.LOCK -> toggleBoxLock()
                    BoxControl.CHECK -> finalizeBox()
                    BoxControl.NONE -> {}
                }
            }
            return true
        }
    }

    /** Minimum draggable box height — just below the thin default so the operator can shrink a little,
     *  never below the crop-viability floor. Fraction-based (scales with the screen like the default),
     *  so it never exceeds the fractional default on shorter phones. Owner-tuned 2026-09-03. */
    private fun minBoxHeightPx(sh: Int): Int = maxOf(
        com.mineflow.capture.data.CaptureRoi.MIN_HEIGHT_PX,
        (sh * com.mineflow.capture.data.CaptureRoi.MIN_HEIGHT_FRACTION).toInt(),
    )

    private inner class BoxTouchListener : View.OnTouchListener {
        private var start = WinRect(0, 0, 0, 0)
        private var touchX = 0f; private var touchY = 0f
        private var zone = ResizeZone.NONE
        private var longPressArmed = false
        private val longPress = Runnable { longPressArmed = false; revealControlsFromLongPress() }

        override fun onTouch(v: View, e: MotionEvent): Boolean {
            val lp = boxLp ?: return false
            // EDITING = controls shown AND unlocked → resize/move from any edge/corner. Otherwise the box
            // is READY/locked: a LONG PRESS reveals the controls (no auto-unlock); a plain tap/drag is ignored.
            val editing = boxEditing && !isRoiLocked()
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    start = WinRect(lp.x, lp.y, lp.width, lp.height)
                    touchX = e.rawX; touchY = e.rawY
                    if (editing) {
                        zone = BoxGesture.hitZone(lp.width, lp.height, dp(20), e.x.toInt(), e.y.toInt())
                    } else {
                        longPressArmed = true
                        handler.postDelayed(longPress, 500)
                    }
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - touchX).toInt(); val dy = (e.rawY - touchY).toInt()
                    if (editing) {
                        val (sw, sh) = screenSize()
                        val nr = BoxGesture.applyResize(zone, start, dx, dy, sw, sh, dp(64), minBoxHeightPx(sh))
                        lp.x = nr.x; lp.y = nr.y; lp.width = nr.w; lp.height = nr.h
                        runCatching { windowManager.updateViewLayout(v, lp) }
                        positionControls() // controls follow the box's upper-right
                    } else if (longPressArmed && (abs(dx) > dp(8) || abs(dy) > dp(8))) {
                        // moved before the long press fired → a drag/scroll intent, not a long press
                        longPressArmed = false; handler.removeCallbacks(longPress)
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (longPressArmed) { longPressArmed = false; handler.removeCallbacks(longPress) }
                    if (editing) saveBoxFromWindow()
                }
            }
            return true
        }
    }

    // ---- Show / Hide floating controls (PHASE 3) ------------------------------

    private fun setControlsHidden(hidden: Boolean) {
        SecureStore.get(this).controlsHidden = hidden
        if (hidden) {
            hideButton()
            showRestoreHandle()
        } else {
            removeRestoreHandle()
            addButton()
        }
    }

    /** A tiny always-available handle so hidden controls can never be permanently lost. */
    private fun showRestoreHandle() {
        if (restoreHandle != null) return
        val size = dp(30)
        val lp = WindowManager.LayoutParams(
            size, size, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.END; x = dp(4); y = dp(90) }
        val v = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xCC111111.toInt())
                setStroke(dp(1), 0xFFC9A227.toInt())
            }
            // Tap = capture (so capture still works with controls hidden); long-press = show controls
            // again, so the full controls are never permanently lost.
            contentDescription = "Capture (long-press to show controls)"
            setOnClickListener { onCaptureTap() }
            setOnLongClickListener { setControlsHidden(false); true }
        }
        restoreHandle = v
        runCatching { windowManager.addView(v, lp) }
    }

    private fun removeRestoreHandle() {
        restoreHandle?.let { runCatching { windowManager.removeView(it) } }
        restoreHandle = null
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
            toastMain("Sign in to A.V. Jewelry Capture first.")
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
                    !roi.locked -> { toastMain("Finish your Capture Area first — tap ✓ on the box."); bmp.recycle(); return@thread }
                    px == null -> { toastMain("Please reset your Capture Area."); bmp.recycle(); return@thread }
                }
                val pxNN = px!!
                val roiNN = roi
                val tCrop = android.os.SystemClock.elapsedRealtime()
                // OCR the FULL box interior (Owner 2026-09-03 regression fix). A left-inset "text zone" cut
                // the name off on a tightly-framed box — the manual gold box IS the ROI, so we crop it whole
                // and handle a Facebook badge mis-read as a leading "O"/"0" purely by OCR GEOMETRY afterward
                // (stripBadgeGlyph in guessBox), never by cropping away the name.
                val crop = runCatching {
                    Bitmap.createBitmap(bmp, pxNN.left, pxNN.top, pxNN.width, pxNN.height)
                }.getOrNull()
                if (crop == null) { toastMain("Please reset your Capture Area."); bmp.recycle(); return@thread }
                val tMlStart = android.os.SystemClock.elapsedRealtime()
                val box = ocrBoxBlocking(crop)
                val tMlEnd = android.os.SystemClock.elapsedRealtime()
                // STEP 2 (DEBUG builds only) — persist the EXACT crop + full geometry/insets so the
                // physical crop can be inspected off-device (proving the box maps to the right pixels).
                saveBoxDiagnostic(bmp, crop, pxNN, roiNN, box)
                runCatching { crop.recycle() }
                val t0box = if (lastTapElapsed > 0) lastTapElapsed else tOcrStart
                Log.i(
                    TAG,
                    "timing BOX: tap->shot=${tOcrStart - t0box}ms roiMap+crop=${tMlStart - tCrop}ms " +
                        "mlKit=${tMlEnd - tMlStart}ms review=${box?.review} " +
                        "roiPx=[${pxNN.left},${pxNN.top} ${pxNN.width}x${pxNN.height}] shot=${bmp.width}x${bmp.height}",
                )
                if (box == null || box.review != com.mineflow.capture.data.BoxReview.NONE) {
                    toastMain(
                        when (box?.review) {
                            com.mineflow.capture.data.BoxReview.NO_CLAIM -> "Value not read — needs review."
                            com.mineflow.capture.data.BoxReview.MULTIPLE -> "More than one comment in the box — needs review."
                            com.mineflow.capture.data.BoxReview.CLIPPED -> "Text looks cut off — adjust your Capture Area, then capture again."
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
                    else -> "${printNote}Sent to A.V. Jewelry — confirm it on the PC."
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

    /**
     * BOX CAPTURE STEP 2 diagnostic (Owner 2026-09-02) — DEBUG BUILDS ONLY. Persist the EXACT crop
     * handed to ML Kit plus the full coordinate geometry (screenshot size, saved normalized ROI, the
     * resolved pixel ROI + crop size, status/navigation-bar insets, the box overlay window rect) and
     * the raw OCR + review, into app-private files (getExternalFilesDir/mineflow-diag). This is how the
     * physical crop is proven correct WITHOUT tethering — the crop PNG shows exactly what was OCR'd. It
     * is NEVER uploaded, and a rolling window (~20 newest) keeps it from filling storage. No-op in
     * release builds so customer crops are never persisted in production.
     */
    private fun saveBoxDiagnostic(
        full: Bitmap,
        crop: Bitmap,
        px: com.mineflow.capture.data.PixelRoi,
        roi: com.mineflow.capture.data.CaptureRoi,
        box: com.mineflow.capture.data.BoxGuess?,
    ) {
        if (!com.mineflow.capture.BuildConfig.DEBUG) return
        runCatching {
            val dir = File(getExternalFilesDir(null), "mineflow-diag").apply { mkdirs() }
            dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(20)
                ?.forEach { runCatching { it.delete() } }
            val ts = System.currentTimeMillis()
            FileOutputStream(File(dir, "$ts-crop.png")).use { crop.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val meta = JSONObject().apply {
                put("ts", ts)
                put("screenshot", JSONObject().put("w", full.width).put("h", full.height))
                put(
                    "savedRoi",
                    JSONObject().put("left", roi.left).put("top", roi.top)
                        .put("width", roi.width).put("height", roi.height).put("locked", roi.locked),
                )
                put("pixelRoi", JSONObject().put("left", px.left).put("top", px.top).put("w", px.width).put("h", px.height))
                put("cropSize", JSONObject().put("w", crop.width).put("h", crop.height))
                put("insets", JSONObject().put("statusBar", statusBarHeightPx()).put("navBar", navBarHeightPx()))
                boxLp?.let { put("boxWindow", JSONObject().put("x", it.x).put("y", it.y).put("w", it.width).put("h", it.height)) }
                put("review", box?.review?.name)
                put("fbName", box?.guess?.fbName)
                put("grams", box?.guess?.grams)
                put("rawLines", JSONArray(box?.guess?.rawLines ?: emptyList<String>()))
            }
            File(dir, "$ts.json").writeText(meta.toString(2))
            Log.i(TAG, "BOX DIAG saved: ${dir.absolutePath}/$ts-crop.png (review=${box?.review})")
        }
    }

    /** Status-bar height in px (0 if unknown) — for the STEP 1 coordinate diagnostic. */
    private fun statusBarHeightPx(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else 0
    }

    /** Navigation-bar height in px (0 if unknown) — for the STEP 1 coordinate diagnostic. */
    private fun navBarHeightPx(): Int {
        val id = resources.getIdentifier("navigation_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else 0
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

    // ---- Transient top-center status notification -----------------------------

    /**
     * Show a transient Capture status message at TOP-CENTER, below the status bar / display cutout
     * (Owner 2026-09-07). Every short Capture message routes here (keeping the SAME text strings), so
     * there is a SINGLE notification region and a new message REPLACES the current one in place rather
     * than stacking down the screen. Safe to call from any thread (posts to the main handler).
     *
     * Presentation only: the full message string is unchanged (still logged and sent to the server);
     * it is just rendered compact — capped width, at most two lines, ellipsised — so a long completion
     * message ("Sticker printed ✓ Read \"…\"") can never stretch across the screen. Business logic,
     * OCR, name/grams parsing, print and sync are all untouched.
     */
    private fun toastMain(msg: String) {
        handler.post {
            ensureNotif()
            val v = notifView ?: return@post
            notifText?.text = msg
            v.visibility = View.VISIBLE
            // Re-derive the top inset on every show so a rotation / cutout change is honoured.
            notifLp?.let { lp ->
                lp.y = topInsetPx() + dp(8)
                runCatching { windowManager.updateViewLayout(v, lp) }
            }
            handler.removeCallbacks(notifDismiss)
            // Keep a brief tick ("Captured ✓") ~1.6s and a detailed result ~3.5s — short, but long
            // enough to read, matching the previous Toast feel without stacking.
            val ms = if (msg.length <= 14) 1600L else 3500L
            handler.postDelayed(notifDismiss, ms)
        }
    }

    /** Build the single reusable notification window once (dark translucent, rounded, gold dot, white
     *  text — the same visual language as the other overlays). FLAG_NOT_TOUCHABLE lets every Facebook
     *  touch pass straight through; FLAG_LAYOUT_IN_SCREEN makes `y` absolute from the very top so the
     *  inset offset lands it right below the status bar / cutout. */
    private fun ensureNotif() {
        if (notifView != null) return
        val screenW = resources.displayMetrics.widthPixels
        val tv = TextView(this).apply {
            setTextColor(0xFFF5EFE0.toInt())
            textSize = 13f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            maxWidth = (screenW * 0.82f).toInt()
        }
        val dot = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#E0A81E")) // reference gold, same as the Capture Box
            }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xF2141414.toInt()) // dark translucent, same as the quick menu
            }
            setPadding(dp(12), dp(9), dp(12), dp(9))
            addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).apply { rightMargin = dp(8) })
            addView(tv)
        }
        notifText = tv
        notifView = row
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = topInsetPx() + dp(8)
        }
        notifLp = lp
        row.visibility = View.GONE
        runCatching { windowManager.addView(row, lp) }
    }

    /** Height of the top system UI to clear — status bar plus any display cutout — computed from the
     *  live window insets (device- and rotation-aware), with a status_bar_height fallback pre-API-30. */
    private fun topInsetPx(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val insets = windowManager.currentWindowMetrics.windowInsets.getInsets(
                android.view.WindowInsets.Type.statusBars() or
                    android.view.WindowInsets.Type.displayCutout(),
            )
            if (insets.top > 0) return insets.top
        }
        val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (resId > 0) resources.getDimensionPixelSize(resId) else dp(24)
    }

    private fun hideNotif() {
        handler.removeCallbacks(notifDismiss)
        notifView?.visibility = View.GONE
    }

    private fun onCaptureFailed(reason: String) {
        restoreButton()
        toastMain(reason)
    }

    private fun restoreButton() {
        busy = false
        button?.visibility = View.VISIBLE
        boxView?.visibility = View.VISIBLE
        restoreHandle?.visibility = View.VISIBLE
        boxControls?.visibility = View.VISIBLE
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
        // The wording carries the safety information: whichever state we are in, the operator can
        // see whether PRINTING is still on, and every action says what it will actually stop. The
        // old single "Stop Capture Service" action ended printing too and said nothing about it.
        val text =
            if (overlayStopped) {
                "Printing is ON. Capture is off — order stickers still print. " +
                    "Tap Show Floating Button to capture again."
            } else {
                "A.V. Jewelry Capture is ready. Tap the floating button to capture a mined item. " +
                    "Order stickers print automatically."
            }
        // AT MOST THREE ACTIONS. The platform templates render only three, so a fourth is simply
        // invisible — and the fourth here was "Stop Everything", the one control whose whole purpose
        // is to be findable. "Open App" is dropped instead: setContentIntent already makes the body
        // tap-to-open, so it was the redundant one.
        val builder = NotificationCompat.Builder(this, App.CAPTURE_CHANNEL_ID)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .setContentIntent(open)
        if (overlayStopped) {
            builder.addAction(0, "Show Floating Button", svc(3, ACTION_SHOW))
        } else {
            builder.addAction(0, "Hide Floating Button", svc(2, ACTION_HIDE))
            builder.addAction(0, "Stop Capture", svc(1, ACTION_STOP))
        }
        // Named for its consequence, not its mechanism. This is the only control that ends printing.
        builder.addAction(0, "Stop Everything (printing too)", svc(4, ACTION_STOP_ALL))
        return builder.build()
    }

    /**
     * Tear the CAPTURE side down — floating button, box, quick menu, screen projection — while the
     * service and PrintJobPoller keep running, so order stickers still print.
     *
     * The service must stay alive for that to be durable: the foreground service is the only thing
     * standing between the poll thread and Android reclaiming the process (with Facebook in the
     * foreground all day, that reclaim is the normal case, not an edge case).
     *
     * ORDER MATTERS. The projection is stopped BEFORE re-entering the foreground as SPECIAL_USE:
     * dropping the FGS type to specialUse while a MediaProjection is still held is the illegal
     * Android 14 state that has already crashed this app once.
     */
    private fun stopOverlayKeepPrinting() {
        setOverlayStopped(true)
        // CANCEL ANY CAPTURE IN FLIGHT. onCaptureTap posts a delayed runnable that can launch the
        // screen-record consent dialog; without this, that dialog could appear AFTER the operator
        // stopped capture and, if granted, silently resume mirroring, print a sticker and create a
        // capture row while the notification reads "Capture is off" — the system acting unbidden.
        // The epoch bump also makes a consent grant already on screen land on a stale generation.
        captureEpoch++
        handler.removeCallbacksAndMessages(null)
        // Release the capture latch, or the button is permanently dead once it is shown again.
        // Before this change ACTION_STOP destroyed the service, so the stuck flag died with it;
        // making stop non-destructive removed the operator's only way to clear it.
        busy = false
        boxEditing = false
        hideQuickMenu()
        button?.let { runCatching { windowManager.removeView(it) } }
        button = null
        handler.removeCallbacks(notifDismiss)
        notifView?.let { runCatching { windowManager.removeView(it) } }
        notifView = null
        cancelAutoHide()
        hideCaptureBox()
        removeRestoreHandle()
        teardownCapture()
        projection?.stop(); projection = null
        // Back to SPECIAL_USE now that no projection is held, and refresh the notification so the
        // operator can see printing is still on.
        startAsForeground(mediaProjection = false)
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        captureActive = false
        com.mineflow.capture.printer.PrintJobPoller.stop()
        hideQuickMenu()
        button?.let { runCatching { windowManager.removeView(it) } }
        button = null
        handler.removeCallbacks(notifDismiss)
        notifView?.let { runCatching { windowManager.removeView(it) } }
        notifView = null
        cancelAutoHide()
        hideCaptureBox()
        removeRestoreHandle()
        teardownCapture()
        projection?.stop(); projection = null
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        /** True while the capture service is alive — read by the Setup screen. NOTE: since the
         *  stop-split this means "the service (and printing) is up", NOT "capture is on". */
        @Volatile var isRunning: Boolean = false
            private set

        /** True while the CAPTURE side is on. Distinct from [isRunning]: after "Stop Capture" the
         *  service keeps running for printing, so the Setup screen must not keep reporting capture
         *  as Active (and must keep offering Start). */
        @Volatile var captureActive: Boolean = false
            private set

        /** Intent extra: start for printing only, no overlays. */
        private const val EXTRA_PRINTING_ONLY = "printing_only"

        /** Persisted capture-side choice, so a sticky restart cannot re-add a dismissed overlay. */
        private const val PREF_OVERLAY_STOPPED = "overlay_stopped"

        private const val TAG = "MineFlowCapture"

        private const val ACTION_STOP = "com.mineflow.capture.STOP"
        private const val ACTION_STOP_ALL = "com.mineflow.capture.STOP_ALL"
        private const val ACTION_HIDE = "com.mineflow.capture.HIDE"
        private const val ACTION_SHOW = "com.mineflow.capture.SHOW"
        private const val ACTION_CAPTURE = "com.mineflow.capture.CAPTURE"
        private const val ACTION_DELIVER_PROJECTION = "com.mineflow.capture.PROJECTION"
        private const val ACTION_SHOW_BOX = "com.mineflow.capture.SHOW_BOX"
        private const val ACTION_EDIT_BOX = "com.mineflow.capture.EDIT_BOX"
        private const val ACTION_RESET_BOX = "com.mineflow.capture.RESET_BOX"
        private const val ACTION_HIDE_CONTROLS = "com.mineflow.capture.HIDE_CONTROLS"
        private const val ACTION_SHOW_CONTROLS = "com.mineflow.capture.SHOW_CONTROLS"
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"

        private fun send(context: Context, action: String) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java).setAction(action),
            )
        }

        // Box Capture controls, driven from the Setup "Capture Area" section (Owner 2026-09-02).
        /** Enter edit mode: show the box UNLOCKED with the external Lock/Check controls + resize grip. */
        fun editBox(context: Context) = send(context, ACTION_EDIT_BOX)
        /** Reset the box to the default position + size (then edit mode). */
        fun resetBox(context: Context) = send(context, ACTION_RESET_BOX)
        /** Hide the floating controls (keep the locked box + a tiny capture/restore handle). */
        fun hideControls(context: Context) = send(context, ACTION_HIDE_CONTROLS)
        /** Restore the floating controls. */
        fun showControls(context: Context) = send(context, ACTION_SHOW_CONTROLS)

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

        /**
         * Start the service for PRINTING ONLY — no floating button, no projection. Used by the
         * boot receiver so a reboot restores order-sticker printing without putting an overlay on
         * the operator's screen uninvited.
         *
         * The mode rides in the INTENT, not a companion flag. A static was only ever cleared inside
         * onCreate, so on the two paths where onCreate never runs — the foreground start being
         * refused (exactly what BootReceiver's fallback is for), or a ROM sending two boot
         * broadcasts to an already-running service — it stayed armed and silently suppressed the
         * floating button on the operator's next deliberate start.
         *
         * Throws if Android refuses a background foreground-service start; the caller decides how
         * to degrade (BootReceiver posts a tap-to-resume notification rather than crashing).
         */
        fun startForPrinting(context: Context) {
            val intent = Intent(context, OverlayCaptureService::class.java)
                .putExtra(EXTRA_PRINTING_ONLY, true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else context.startService(intent)
        }

        /** Stop the CAPTURE side only — the floating button and screen projection go away, the
         *  service and the print poller keep running so order stickers still print. */
        fun stop(context: Context) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java).setAction(ACTION_STOP),
            )
        }

        /** Stop EVERYTHING, printing included. Only for Log out and the explicitly-labelled
         *  notification action — never for "I'm done capturing for now". */
        fun stopAll(context: Context) {
            context.startService(
                Intent(context, OverlayCaptureService::class.java).setAction(ACTION_STOP_ALL),
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
