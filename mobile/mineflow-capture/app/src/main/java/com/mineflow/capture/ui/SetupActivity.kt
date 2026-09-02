package com.mineflow.capture.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.mineflow.capture.BuildConfig
import com.mineflow.capture.R
import com.mineflow.capture.capture.OverlayCaptureService
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.BluetoothPrinterManager
import com.mineflow.capture.printer.PrintJobPoller
import com.mineflow.capture.printer.StickerEncoder
import kotlin.concurrent.thread

/**
 * The MineFlow Capture CONTROL CENTER — a single-screen dashboard (Owner 2026-08-31 redesign).
 *
 * Combines what used to be three places (Capture Setup, the separate Bluetooth Printer screen, and
 * the Sticker rate) into ONE minimalist screen so live-selling staff can see, in ~2 seconds, whether
 * the system is ready: Overlay · Notifications · Capture · Printer.
 *
 * PRESENTATION ONLY. Every handler and every business-logic class it calls is UNCHANGED —
 * OverlayCaptureService, BluetoothPrinterManager, PrintJobPoller, StickerEncoder, SecureStore,
 * ApiClient, ScreenshotOcr and the whole capture/OCR/print engine are untouched. This file only
 * builds the views and wires them to the existing handlers (the printer orchestration was moved here
 * verbatim from the old BluetoothPrinterActivity, which is now removed — one screen, no separate
 * printer page).
 */
class SetupActivity : AppCompatActivity() {

    // ---- MineFlow palette ----------------------------------------------------
    private val gold = Color.parseColor("#C9A227")   // primary action / accent
    private val white = Color.parseColor("#F5EFE0")  // primary text
    private val gray = Color.parseColor("#8C8A82")   // muted secondary text
    private val grayDim = Color.parseColor("#6E6B63")
    private val screenBg = Color.parseColor("#0B0B0B")
    private val cardBg = Color.parseColor("#151515")
    private val cardBorder = Color.parseColor("#2A2A2A")
    private val fieldBg = Color.parseColor("#1E1E1E")
    private val green = Color.parseColor("#6FBF73")  // healthy / connected / active / granted
    private val amber = Color.parseColor("#D9A441")  // needs attention (permission required)
    private val red = Color.parseColor("#E0574B")    // stop / destructive only

    private lateinit var store: SecureStore
    private val ui = Handler(Looper.getMainLooper())

    // ---- System-status cells (icon + status text, updated live) --------------
    private class Cell(val icon: ImageView, val status: TextView)
    private lateinit var cOverlay: Cell
    private lateinit var cNotify: Cell
    private lateinit var cCapture: Cell
    private lateinit var cPrinter: Cell

    // ---- Quick-action buttons (reflect current status) -----------------------
    private lateinit var overlayAction: Button
    private lateinit var notifyAction: Button
    private lateinit var captureAction: Button

    // ---- Capture Area (Box Capture v1) ---------------------------------------
    private lateinit var captureAreaStatus: TextView
    private lateinit var controlsToggleBtn: Button

    // ---- Printer section (moved verbatim from BluetoothPrinterActivity) ------
    private lateinit var printerNameTv: TextView
    private lateinit var printerConnTv: TextView
    private lateinit var printerSpinner: Spinner
    private lateinit var toggleBtn: Button
    private lateinit var scanBtn: Button
    private lateinit var langRow: TextView
    private lateinit var rateInput: EditText

    // address -> printer, merged from bonded + discovery so the dropdown is one set.
    private val found = LinkedHashMap<String, BluetoothPrinterManager.Printer>()
    private var scanning = false
    private var pendingScan = false
    private var connecting = false
    private var connectFailed = false
    private var connectStartMs = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        setContentView(buildDashboard())
    }

    // ---- Build the single-screen dashboard -----------------------------------

    private fun buildDashboard(): View {
        val pad = dp(18)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(screenBg)
            setPadding(pad, dp(16), pad, dp(20))
        }

        col.addView(buildHeader())
        col.addView(buildStatusCard(), wide().apply { topMargin = dp(16) })
        col.addView(heading("Quick actions"))
        col.addView(buildQuickActions())
        col.addView(heading("Capture area"))
        col.addView(buildCaptureAreaCard())
        col.addView(heading("Printer"))
        col.addView(buildPrinterCard())
        col.addView(heading("Sticker price per gram"))
        col.addView(buildRateCard())
        col.addView(heading("Utilities"))
        col.addView(buildUtilities())
        col.addView(buildFooter(), wide().apply { topMargin = dp(20) })

        return ScrollView(this).apply {
            setBackgroundColor(screenBg)
            isFillViewport = true
            addView(col)
        }
    }

    // 1) HEADER — title + signed-in user + profile initials.
    private fun buildHeader(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        left.addView(
            TextView(this).apply { text = "MineFlow Capture"; textSize = 22f; setTextColor(white); typeface = Typeface.DEFAULT_BOLD },
        )
        val name = store.staffName?.takeIf { it.isNotBlank() } ?: "MineFlow staff"
        left.addView(
            TextView(this).apply { text = "Signed in as $name"; textSize = 13f; setTextColor(gray); setPadding(0, dp(2), 0, 0) },
        )
        row.addView(left, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val initials = name.split(Regex("\\s+")).filter { it.isNotBlank() }.take(2)
            .joinToString("") { it.first().uppercase() }.ifBlank { "M" }
        row.addView(
            TextView(this).apply {
                text = initials
                textSize = 14f
                setTextColor(gold)
                gravity = Gravity.CENTER
                typeface = Typeface.DEFAULT_BOLD
                background = rounded(Color.parseColor("#1C190F"), dp(22), gold, dp(1))
                layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
            },
        )
        return row
    }

    // 2) SYSTEM STATUS — one compact card, four columns.
    private fun buildStatusCard(): View {
        val card = card()
        val rowCells = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val (oV, oC) = statusCell(R.drawable.ic_overlay, "Overlay"); cOverlay = oC
        val (nV, nC) = statusCell(R.drawable.ic_bell, "Notify"); cNotify = nC
        val (cV, cC) = statusCell(R.drawable.ic_camera, "Capture"); cCapture = cC
        val (pV, pC) = statusCell(R.drawable.ic_printer, "Printer"); cPrinter = pC
        listOf(oV, nV, cV, pV).forEach { rowCells.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)) }
        card.addView(rowCells)
        return card
    }

    private fun statusCell(iconRes: Int, label: String): Pair<View, Cell> {
        val cell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL }
        val icon = ImageView(this).apply {
            setImageResource(iconRes); imageTintList = ColorStateList.valueOf(gray)
            layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
        }
        cell.addView(icon)
        cell.addView(
            TextView(this).apply { text = label; textSize = 11f; setTextColor(gray); gravity = Gravity.CENTER; setPadding(0, dp(6), 0, dp(2)) },
        )
        val status = TextView(this).apply { text = "…"; textSize = 11f; setTextColor(gray); gravity = Gravity.CENTER; typeface = Typeface.DEFAULT_BOLD }
        cell.addView(status)
        return cell to Cell(icon, status)
    }

    private fun setCell(cell: Cell, text: String, color: Int) {
        cell.status.text = text
        cell.status.setTextColor(color)
        cell.icon.imageTintList = ColorStateList.valueOf(color)
    }

    // 3) QUICK ACTIONS — three equal cards.
    private fun buildQuickActions(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val (oCard, oBtn) = actionCard(R.drawable.ic_overlay, "Overlay")
        val (nCard, nBtn) = actionCard(R.drawable.ic_bell, "Notify")
        val (cCard, cBtn) = actionCard(R.drawable.ic_camera, "Capture")
        overlayAction = oBtn; notifyAction = nBtn; captureAction = cBtn
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        row.addView(oCard, lp().apply { rightMargin = dp(5) })
        row.addView(nCard, lp().apply { leftMargin = dp(5); rightMargin = dp(5) })
        row.addView(cCard, lp().apply { leftMargin = dp(5) })
        return row
    }

    private fun actionCard(iconRes: Int, title: String): Pair<View, Button> {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(cardBg, dp(14), cardBorder, dp(1))
            setPadding(dp(10), dp(14), dp(10), dp(12))
        }
        c.addView(
            ImageView(this).apply {
                setImageResource(iconRes); imageTintList = ColorStateList.valueOf(gold)
                layoutParams = LinearLayout.LayoutParams(dp(24), dp(24))
            },
        )
        c.addView(
            TextView(this).apply { text = title; textSize = 12f; setTextColor(white); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(10)) },
        )
        val btn = Button(this).apply {
            isAllCaps = false; textSize = 12f
            minHeight = dp(44); minimumHeight = dp(44) // ~48dp touch target
            setPadding(dp(6), dp(8), dp(6), dp(8))
        }
        c.addView(btn, wide())
        return c to btn
    }

    /** Reflect current status: green "done" chip when already satisfied, gold action button otherwise. */
    private fun setActionState(btn: Button, done: Boolean, doneLabel: String, actionLabel: String, onAction: () -> Unit) {
        if (done) {
            btn.text = doneLabel
            btn.setTextColor(green)
            btn.background = rounded(Color.TRANSPARENT, dp(10), green, dp(1))
            btn.setOnClickListener { toast("Already $doneLabel.") }
        } else {
            btn.text = actionLabel
            btn.setTextColor(Color.parseColor("#111111"))
            btn.background = rounded(gold, dp(10), gold, 0)
            btn.setOnClickListener { onAction() }
        }
    }

    // 3.5) CAPTURE AREA (Box Capture v1) — Owner 2026-09-02.
    private fun buildCaptureAreaCard(): View {
        val card = card()
        captureAreaStatus = TextView(this).apply { textSize = 12f; typeface = Typeface.DEFAULT_BOLD }
        card.addView(captureAreaStatus)
        card.addView(
            TextView(this).apply {
                // The lock / done / resize controls now live ON the box (Box Capture v2), so the
                // dashboard only needs status + a way in and a reset. Owner 2026-09-02.
                text = "Capture reads ONLY inside the box. Tap Show / Edit Area, drag it over one comment, " +
                    "resize with the corner grip, then tap ✓ (or the lock) on the box itself."
                textSize = 11f; setTextColor(gray); setPadding(0, dp(4), 0, dp(10))
            },
            wide(),
        )
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row1.addView(ghostButton("Show / Edit Area") { onEditBox() }, lp().apply { rightMargin = dp(5) })
        // Reset stays — the ONE safe way to recover a corrupted / off-screen saved ROI (Owner: do not remove).
        row1.addView(
            ghostButton("Reset") { OverlayCaptureService.resetBox(this); refreshCaptureArea() },
            lp().apply { leftMargin = dp(5) },
        )
        card.addView(row1, wide())
        // Secondary: declutter the floating capture button during a live (long-press its handle to restore).
        controlsToggleBtn = ghostButton("Hide Floating Button") { onToggleControls() }
        card.addView(controlsToggleBtn, wide().apply { topMargin = dp(8) })
        return card
    }

    private fun onEditBox() {
        if (!Settings.canDrawOverlays(this)) { toast("Grant overlay permission first (Overlay → Grant Now)."); return }
        if (!OverlayCaptureService.isRunning) OverlayCaptureService.start(this)
        OverlayCaptureService.editBox(this)
        toast("Drag the box over one comment; drag the corner grip to resize; then tap ✓ or the lock on the box.")
        refreshCaptureArea()
    }

    private fun onToggleControls() {
        if (store.controlsHidden) OverlayCaptureService.showControls(this) else OverlayCaptureService.hideControls(this)
        refreshCaptureArea()
    }

    private fun refreshCaptureArea() {
        val roi = store.captureRoi
        val (text, color) = when {
            roi == null -> "Capture Area: Not Set" to amber
            roi.locked -> "Capture Area: Locked" to green
            else -> "Capture Area: Editing (unlocked)" to amber
        }
        captureAreaStatus.text = text
        captureAreaStatus.setTextColor(color)
        controlsToggleBtn.text = if (store.controlsHidden) "Show Floating Button" else "Hide Floating Button"
    }

    // 4) PRINTER CARD.
    private fun buildPrinterCard(): View {
        val card = card()

        val row1 = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        row1.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.ic_printer); imageTintList = ColorStateList.valueOf(white)
                layoutParams = LinearLayout.LayoutParams(dp(20), dp(20)).apply { rightMargin = dp(10) }
            },
        )
        printerNameTv = TextView(this).apply { textSize = 14f; setTextColor(white) }
        row1.addView(printerNameTv, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        printerConnTv = TextView(this).apply { textSize = 12f; setTextColor(gray); typeface = Typeface.DEFAULT_BOLD }
        row1.addView(printerConnTv)
        card.addView(row1)

        // The existing printer selector (dropdown) — pick / change / pair a printer.
        printerSpinner = Spinner(this)
        card.addView(printerSpinner, wide().apply { topMargin = dp(10) })

        // Second row: Scan · Connect/Disconnect · Test Print.
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        scanBtn = ghostButton("Scan") { onScanClicked() }
        toggleBtn = ghostButton("Connect") { onToggleClicked() }
        val testBtn = ghostButton("Test Print") { onTestPrint() }
        val alp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        actions.addView(scanBtn, alp().apply { rightMargin = dp(5) })
        actions.addView(toggleBtn, alp().apply { leftMargin = dp(5); rightMargin = dp(5) })
        actions.addView(testBtn, alp().apply { leftMargin = dp(5) })
        card.addView(actions, wide().apply { topMargin = dp(10) })

        // Subtle language row inside the card.
        langRow = TextView(this).apply {
            textSize = 12f; setTextColor(gray); setPadding(dp(2), dp(12), 0, 0)
            setOnClickListener { store.printerTspl = !store.printerTspl; updateLangLabel() }
        }
        updateLangLabel()
        card.addView(langRow, wide())
        return card
    }

    // 5) STICKER PRICE PER GRAM.
    private fun buildRateCard(): View {
        val card = card()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }

        val fieldBox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = rounded(fieldBg, dp(10), cardBorder, dp(1))
            setPadding(dp(12), 0, dp(10), 0)
        }
        fieldBox.addView(TextView(this).apply { text = "₱"; textSize = 15f; setTextColor(gold); setPadding(0, 0, dp(6), 0) })
        rateInput = EditText(this).apply {
            setText(store.pricePerGram ?: "")
            hint = "e.g. 7500"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setTextColor(white); setHintTextColor(gray); textSize = 15f
            setBackgroundColor(Color.TRANSPARENT); setPadding(0, dp(10), 0, dp(10))
        }
        fieldBox.addView(rateInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(fieldBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        row.addView(
            goldButton("Save Rate") { onSaveRate(rateInput) }.apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                    .apply { leftMargin = dp(10) }
            },
        )
        card.addView(row)
        card.addView(
            TextView(this).apply { text = "Set the price used for sticker printing."; textSize = 12f; setTextColor(gray); setPadding(dp(2), dp(10), 0, 0) },
        )
        return card
    }

    // 6) UTILITIES — three compact chips.
    private fun buildUtilities(): View {
        val card = card()
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val floating = utilityChip(R.drawable.ic_eye, "Floating", white) {
            if (!Settings.canDrawOverlays(this)) { toast("Grant overlay permission first."); refreshCaptureStatus(); return@utilityChip }
            if (OverlayCaptureService.isRunning) OverlayCaptureService.showButton(this) else OverlayCaptureService.start(this)
            refreshCaptureStatus()
            toast("Floating button shown. Switch to Facebook and tap the round camera button.")
        }
        val stop = utilityChip(R.drawable.ic_power, "Stop", red) {
            OverlayCaptureService.stop(this); refreshCaptureStatus()
        }
        val logout = utilityChip(R.drawable.ic_logout, "Log out", white) {
            OverlayCaptureService.stop(this)
            store.clearSession()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
        val lp = { LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        row.addView(floating, lp()); row.addView(stop, lp()); row.addView(logout, lp())
        card.addView(row)
        return card
    }

    private fun utilityChip(iconRes: Int, label: String, tint: Int, onClick: () -> Unit): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; isClickable = true
            setPadding(dp(4), dp(6), dp(4), dp(6))
            addView(
                ImageView(this@SetupActivity).apply {
                    setImageResource(iconRes); imageTintList = ColorStateList.valueOf(tint)
                    layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
                },
            )
            addView(
                TextView(this@SetupActivity).apply { text = label; textSize = 12f; setTextColor(tint); gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0) },
            )
            setOnClickListener { onClick() }
        }
    }

    // 7) FOOTER — real app version.
    private fun buildFooter(): View = TextView(this).apply {
        text = "MineFlow Capture v${BuildConfig.VERSION_NAME}"
        textSize = 11f; setTextColor(grayDim); gravity = Gravity.CENTER
    }

    // ==== LIFECYCLE ===========================================================

    override fun onResume() {
        super.onResume()
        refreshCaptureStatus()
        refreshCaptureArea()
        // Heartbeat: tell the backend this capture device is active (System Check "Ready").
        thread { ApiClient(this).pingSession() }
        // Keep the warm connection + print pump running when the printer is ON.
        if (!store.printerAddress.isNullOrBlank() && store.printerEnabled) PrintJobPoller.start(this)
        // Entering the screen shows the ACTUAL printer state — never a stale connecting/failed flag.
        connecting = false
        connectFailed = false
        if (hasBtPermissions()) loadBonded() // only when already permitted — never auto-prompt on the dashboard
        rebuildPrinterSpinner()
        startStatusTick()
    }

    override fun onPause() {
        super.onPause()
        ui.removeCallbacks(statusTick)
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false }
    }

    // ==== CAPTURE STATUS + PERMISSIONS (existing handlers) ====================

    private fun refreshCaptureStatus() {
        val overlay = Settings.canDrawOverlays(this)
        val notify = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val running = OverlayCaptureService.isRunning

        setCell(cOverlay, if (overlay) "Granted" else "Required", if (overlay) green else amber)
        setCell(cNotify, if (notify) "Granted" else "Required", if (notify) green else amber)
        setCell(cCapture, if (running) "Active" else "Stopped", if (running) green else gray)

        setActionState(overlayAction, overlay, "Granted", "Grant Now") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        setActionState(notifyAction, notify, "Granted", "Allow Now") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
            }
        }
        setActionState(captureAction, running, "Active", "Start Now") {
            if (!Settings.canDrawOverlays(this)) { toast("Grant overlay permission first (Overlay → Grant Now)."); return@setActionState }
            OverlayCaptureService.start(this); refreshCaptureStatus()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_NOTIF -> refreshCaptureStatus()
            REQ_PERMS -> {
                if (hasBtPermissions()) {
                    loadBonded(); rebuildPrinterSpinner(); refreshPrinterUi()
                    if (pendingScan) { pendingScan = false; onScanClicked() }
                } else {
                    toast("Bluetooth permission is needed to find and print to the printer.")
                }
            }
        }
    }

    // ==== PRINTER: live status tick (ported verbatim) =========================

    private fun startStatusTick() {
        ui.removeCallbacks(statusTick)
        ui.post(statusTick)
    }

    private val statusTick = object : Runnable {
        override fun run() {
            if (connecting) {
                val addr = store.printerAddress
                val connected = !addr.isNullOrBlank() && BluetoothPrinterManager.isConnected(addr)
                if (connected) {
                    connecting = false; connectFailed = false
                } else if (SystemClock.elapsedRealtime() - connectStartMs > CONNECT_TIMEOUT_MS) {
                    connecting = false; connectFailed = true
                }
            }
            refreshPrinterUi()
            ui.postDelayed(this, STATUS_TICK_MS)
        }
    }

    private fun beginConnect(addr: String) {
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        store.printerEnabled = true
        connectFailed = false
        connecting = true
        connectStartMs = SystemClock.elapsedRealtime()
        refreshPrinterUi()
        PrintJobPoller.start(this)
        thread { BluetoothPrinterManager.connect(this, addr) }
        startStatusTick()
    }

    // ==== PRINTER: ON/OFF toggle (ported verbatim) ============================

    private fun onToggleClicked() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { toast("Choose a printer from the dropdown first."); return }
        if (connecting) return
        if (BluetoothPrinterManager.isConnected(addr)) confirmTurnOff() else beginConnect(addr)
    }

    private fun confirmTurnOff() {
        AlertDialog.Builder(this)
            .setTitle("Disconnect printer?")
            .setMessage("Auto-printing will pause until you turn the printer back on.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Disconnect") { _, _ -> turnOff() }
            .show()
    }

    private fun turnOff() {
        store.printerEnabled = false
        connecting = false
        connectFailed = false
        thread {
            BluetoothPrinterManager.disconnect()
            runOnUiThread { refreshPrinterUi(); toast("Printer disconnected. Auto-print paused.") }
        }
    }

    // ==== PRINTER: scan / select / test (ported verbatim) =====================

    private fun onScanClicked() {
        if (!hasBtPermissions()) {
            pendingScan = true
            ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
            return
        }
        if (!BluetoothPrinterManager.isBluetoothOn(this)) { toast("Turn on Bluetooth first."); return }
        if (!locationServicesOn()) {
            toast("Turn ON Location — Android needs it to scan for Bluetooth printers.")
            try { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) } catch (_: Exception) {}
            loadBonded(); rebuildPrinterSpinner()
            return
        }
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false; scanBtn.text = "Scan"; return }
        loadBonded()
        scanning = true
        scanBtn.text = "Stop"
        val started = BluetoothPrinterManager.startDiscovery(
            this,
            onFound = { p -> runOnUiThread { found[p.address] = p; rebuildPrinterSpinner() } },
            onFinished = { runOnUiThread { scanning = false; scanBtn.text = "Scan" } },
        )
        if (!started) { scanning = false; scanBtn.text = "Scan"; toast("Could not start scan.") }
    }

    private fun setActive(p: BluetoothPrinterManager.Printer) {
        if (!p.bonded) {
            toast("Pairing ${p.name}… accept on the phone, then pick it again from the dropdown.")
            BluetoothPrinterManager.pair(this, p.address)
            return
        }
        store.printerAddress = p.address
        store.printerName = p.name
        rebuildPrinterSpinner()
        toast("${p.name} selected.")
        beginConnect(p.address)
    }

    private fun onTestPrint() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { toast("Set an active printer first."); return }
        if (!store.printerEnabled) { toast("Printer is off. Turn it on to print."); return }
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        toast("Printing test…")
        thread {
            val bytes = StickerEncoder.encode(StickerEncoder.sampleSticker(store.pricePerGram), store.printerTspl)
            val res = BluetoothPrinterManager.print(this, addr, bytes)
            runOnUiThread { toast(if (res.ok) "Test sent to printer." else (res.error ?: "Test print failed.")); refreshPrinterUi() }
        }
    }

    // ==== STICKER RATE (ported verbatim) ======================================

    private fun onSaveRate(rate: EditText) {
        val v = rate.text.toString().trim()
        if (v.isNotEmpty() && !Regex("^\\d{1,9}(\\.\\d{1,2})?$").matches(v)) {
            toast("Enter a valid rate, e.g. 7500."); return
        }
        store.pricePerGram = v.ifEmpty { null }
        store.pricePerGramDirty = true
        toast(if (v.isEmpty()) "Rate cleared." else "Rate saved — next sticker prints ₱$v/g.")
        val ctx = applicationContext
        thread {
            val res = ApiClient(ctx).pushStickerRate(store.pricePerGram)
            if (res.ok) { store.pricePerGramServerRev = res.rev; store.pricePerGramDirty = false }
        }
    }

    // ==== PRINTER: rendering (ported, drives both the card row and the status cell) ====

    private fun loadBonded() {
        BluetoothPrinterManager.bondedPrinters(this).forEach { found[it.address] = it }
    }

    private fun rebuildPrinterSpinner() {
        val printers = found.values.toList()
        val selected = store.printerAddress
        val nameCounts = printers.groupingBy { it.name }.eachCount()
        val labels = printers.map { p ->
            val suffix = if ((nameCounts[p.name] ?: 0) > 1) "  (…${p.address.takeLast(5)})" else ""
            val mark = if (p.address == selected) "  ✓" else ""
            p.name + suffix + mark
        }
        val display = labels.ifEmpty { listOf("No printers — tap Scan") }
        printerSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, display)
        val idx = printers.indexOfFirst { it.address == selected }
        if (idx >= 0) printerSpinner.setSelection(idx)
        printerSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val p = printers.getOrNull(position) ?: return
                if (p.address == store.printerAddress) return
                setActive(p)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun refreshPrinterUi() {
        val addr = store.printerAddress
        val name = store.printerName ?: "Printer"
        val connected = !addr.isNullOrBlank() && BluetoothPrinterManager.isConnected(addr)
        when (resolvePrinterDisplay(hasPrinter = !addr.isNullOrBlank(), connected = connected, connecting = connecting, connectFailed = connectFailed)) {
            PrinterDisplay.NO_PRINTER -> {
                printerNameTv.text = "No printer selected"; printerNameTv.setTextColor(gray)
                printerConnTv.text = ""; toggleBtn.text = "Connect"; toggleBtn.isEnabled = false
                setCell(cPrinter, "Not set", gray)
            }
            PrinterDisplay.CONNECTED -> {
                printerNameTv.text = name; printerNameTv.setTextColor(white)
                printerConnTv.text = "Connected"; printerConnTv.setTextColor(green)
                toggleBtn.text = "Disconnect"; toggleBtn.isEnabled = true
                setCell(cPrinter, "Connected", green)
            }
            PrinterDisplay.CONNECTING -> {
                printerNameTv.text = name; printerNameTv.setTextColor(white)
                printerConnTv.text = "Connecting…"; printerConnTv.setTextColor(gold)
                toggleBtn.text = "Connecting…"; toggleBtn.isEnabled = false
                setCell(cPrinter, "Connecting", gold)
            }
            PrinterDisplay.FAILED -> {
                printerNameTv.text = name; printerNameTv.setTextColor(white)
                printerConnTv.text = "Connection failed"; printerConnTv.setTextColor(amber)
                toggleBtn.text = "Connect"; toggleBtn.isEnabled = true
                setCell(cPrinter, "Failed", amber)
            }
            PrinterDisplay.DISCONNECTED -> {
                printerNameTv.text = name; printerNameTv.setTextColor(white)
                printerConnTv.text = "Not connected"; printerConnTv.setTextColor(gray)
                toggleBtn.text = "Connect"; toggleBtn.isEnabled = true
                setCell(cPrinter, "Off", gray)
            }
        }
        if (!scanning) scanBtn.text = "Scan"
    }

    private fun updateLangLabel() {
        langRow.text = "Printer language: " + if (store.printerTspl) "TSPL (label) — tap to switch" else "ESC/POS (receipt) — tap to switch"
    }

    // ==== PRINTER: permissions (ported verbatim) ==============================

    private fun requiredPerms(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        else
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun hasBtPermissions(): Boolean = requiredPerms().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun locationServicesOn(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
        return try {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (_: Exception) {
            true
        }
    }

    // ==== tiny view helpers ===================================================

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()

    private fun rounded(fill: Int, radiusPx: Int, stroke: Int, strokeW: Int): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(fill)
            cornerRadius = radiusPx.toFloat()
            if (strokeW > 0) setStroke(strokeW, stroke)
        }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(cardBg, dp(16), cardBorder, dp(1))
        setPadding(dp(16), dp(15), dp(16), dp(15))
        layoutParams = wide()
    }

    private fun heading(text: String): TextView = TextView(this).apply {
        this.text = text; textSize = 14f; setTextColor(white); typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(2), dp(18), 0, dp(8)); layoutParams = wide()
    }

    private fun goldButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 14f
        minHeight = dp(46); minimumHeight = dp(46) // ~48dp touch target
        setTextColor(Color.parseColor("#111111"))
        background = rounded(gold, dp(10), gold, 0)
        setPadding(dp(18), dp(10), dp(18), dp(10))
        setOnClickListener { onClick() }
    }

    private fun ghostButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 13f; minWidth = 0; minimumWidth = 0
        minHeight = dp(46); minimumHeight = dp(46) // ~48dp touch target
        setTextColor(white)
        background = rounded(Color.TRANSPARENT, dp(10), cardBorder, dp(1))
        setPadding(dp(6), dp(9), dp(6), dp(9))
        setOnClickListener { onClick() }
    }

    private fun wide() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQ_NOTIF = 1
        private const val REQ_PERMS = 42
        private const val CONNECT_TIMEOUT_MS = 12_000L
        private const val STATUS_TICK_MS = 700L
    }
}
