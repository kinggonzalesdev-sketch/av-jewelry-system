package com.mineflow.capture.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.mineflow.capture.capture.OverlayCaptureService
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.PrintJobPoller
import kotlin.concurrent.thread

/**
 * Capture Setup & permissions. Compact status board + guided actions:
 *   1. Overlay permission (draw the floating button over Facebook)
 *   2. Notifications (the required foreground-service notice, Android 13+)
 *   3. Start the Capture service (screen-capture consent is requested on first tap)
 *
 * Screen-capture consent is requested ONLY when the operator taps the floating
 * button — never silently, and only a single still per tap.
 */
class SetupActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#8C7C55")
    private val black = Color.parseColor("#0B0B0B")

    private lateinit var overlayStatus: TextView
    private lateinit var captureStatus: TextView
    private lateinit var notifyStatus: TextView
    private lateinit var serviceStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = dp(20)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setBackgroundColor(black)
            setPadding(pad, pad, pad, pad)
        }

        val store = SecureStore.get(this)
        root.addView(title("Capture Setup"))
        root.addView(
            TextView(this).apply {
                text = "Signed in as ${store.staffName ?: "MineFlow staff"}"
                setTextColor(beige); setPadding(0, dp(2), 0, dp(14))
            },
            wide(),
        )

        overlayStatus = statusLine("Overlay Permission")
        captureStatus = statusLine("Screen Capture Permission")
        notifyStatus = statusLine("Notification Permission")
        serviceStatus = statusLine("Capture Service Status")
        listOf(overlayStatus, captureStatus, notifyStatus, serviceStatus).forEach { root.addView(it, wide()) }

        val overlayBtn = goldButton("1. Grant overlay permission") {
            startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
            )
        }
        val notifyBtn = goldButton("2. Allow notifications") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            }
        }
        val startBtn = goldButton("3. Start Capture Mine") {
            if (!Settings.canDrawOverlays(this)) {
                overlayStatus.text = "Overlay Permission: Permission Denied — grant it first (step 1)."
                return@goldButton
            }
            OverlayCaptureService.start(this)
            refreshStatus()
        }
        val showBtn = outlineButton("Show floating button") {
            // The floating button is drawn BY the capture service, so it can only
            // appear while the service runs. Previously this did nothing when the
            // service was stopped (silent no-op). Now it starts the service if
            // needed — which draws the button — or re-shows it if it was hidden.
            if (!Settings.canDrawOverlays(this)) {
                overlayStatus.text = "Overlay Permission: Permission Denied — grant it first (step 1)."
                Toast.makeText(this, "Grant overlay permission first (step 1).", Toast.LENGTH_LONG).show()
                return@outlineButton
            }
            if (OverlayCaptureService.isRunning) {
                OverlayCaptureService.showButton(this)
            } else {
                OverlayCaptureService.start(this)
            }
            refreshStatus()
            Toast.makeText(
                this,
                "Floating button shown. Switch to Facebook and tap the round camera button.",
                Toast.LENGTH_LONG,
            ).show()
        }
        val printerBtn = outlineButton("Bluetooth Printer") { BluetoothPrinterActivity.open(this) }
        val stopBtn = outlineButton("Stop capture service") {
            OverlayCaptureService.stop(this); refreshStatus()
        }
        val logoutBtn = outlineButton("Log out") {
            OverlayCaptureService.stop(this)
            store.clearSession()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }

        listOf(overlayBtn, notifyBtn, startBtn, showBtn, printerBtn, stopBtn, logoutBtn)
            .forEach { root.addView(it, wide().apply { topMargin = dp(8) }) }
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        // Heartbeat: tell the backend this capture device is active, so the web
        // System Check shows "Registered Screenshot Device" + "Floating Screenshot
        // App" as Ready while the app is open. Best-effort, off the UI thread.
        thread { ApiClient(this).pingSession() }
        // Start the print pump so label jobs print to the selected Bluetooth printer
        // while the operator works — no PC needed. Idempotent; only acts once a printer
        // is selected + signed in. The always-on capture service also keeps it running.
        if (!SecureStore.get(this).printerAddress.isNullOrBlank()) PrintJobPoller.start(this)
    }

    private fun refreshStatus() {
        val overlay = if (Settings.canDrawOverlays(this)) "Granted" else "Required"
        val notify = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) "Granted" else "Required"
        val running = OverlayCaptureService.isRunning
        overlayStatus.text = "Overlay Permission: $overlay"
        notifyStatus.text = "Notification Permission: $notify"
        // Screen-capture consent is per-session and requested at the first tap; while
        // the service runs it is ready to request/reuse the grant.
        captureStatus.text = "Screen Capture Permission: " + if (running) "Requested on capture" else "Required"
        serviceStatus.text = "Capture Service Status: " + if (running) "Active" else "Stopped"
        tint(overlayStatus, overlay == "Granted")
        tint(notifyStatus, notify == "Granted")
        tint(serviceStatus, running)
    }

    private fun tint(tv: TextView, ok: Boolean) =
        tv.setTextColor(if (ok) Color.parseColor("#7CCB7C") else beige)

    // ---- tiny view helpers ---------------------------------------------------

    private fun title(text: String) = TextView(this).apply {
        this.text = text; textSize = 22f; setTextColor(ivory)
    }
    private fun statusLine(label: String) = TextView(this).apply {
        text = "$label: …"; setTextColor(beige); textSize = 13f; setPadding(0, dp(4), 0, dp(4))
    }
    private fun goldButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false
        setTextColor(Color.parseColor("#111111")); setBackgroundColor(gold)
        setOnClickListener { onClick() }
    }
    private fun outlineButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false
        setTextColor(ivory); setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { onClick() }
    }
    private fun wide() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    )
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
