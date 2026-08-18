package com.mineflow.capture.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.BluetoothPrinterManager
import com.mineflow.capture.printer.PrintJobPoller
import com.mineflow.capture.printer.PrinterToggle
import com.mineflow.capture.printer.PrinterToggleState
import com.mineflow.capture.printer.StickerEncoder
import kotlin.concurrent.thread

/**
 * Settings → Bluetooth / Printer.
 *
 * PRIMARY control is a simple ON/OFF toggle for the SAVED printer — the normal daily action,
 * NOT a scan. OFF is an intentional, confirmed disconnect that PRESERVES the saved printer; ON
 * auto-reconnects to that exact printer over the existing RFCOMM/SPP link (no scan). Scanning /
 * selecting a printer is demoted to a "Select / Change Printer" setup action.
 *
 * State is two INDEPENDENT facts: the printer is CONFIGURED (SecureStore.printerAddress) vs the
 * toggle is ENABLED (SecureStore.printerEnabled). OFF only flips `enabled` — it never forgets the
 * printer. Capture auto-print + Test Print refuse to print while OFF (so the PC fallback prints),
 * and a failed reconnect returns to OFF and never shows a false "Connected".
 */
class BluetoothPrinterActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#8C7C55")
    private val black = Color.parseColor("#0B0B0B")
    private val green = Color.parseColor("#7CCB7C")

    private lateinit var store: SecureStore
    private lateinit var statusText: TextView
    private lateinit var toggleBtn: Button
    private lateinit var scanBtn: Button
    private lateinit var langBtn: Button
    private lateinit var list: LinearLayout

    // address -> printer, merged from bonded + discovery so the list is one set.
    private val found = LinkedHashMap<String, BluetoothPrinterManager.Printer>()
    private var scanning = false
    private var pendingScan = false
    @Volatile private var connecting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        val pad = dp(20)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(black)
            setPadding(pad, pad, pad, pad)
        }

        root.addView(title("Bluetooth / Printer"))

        // ---- PRIMARY: ON/OFF toggle for the saved printer (no daily scan needed) ----
        statusText = TextView(this).apply { setTextColor(beige); textSize = 15f; setPadding(0, dp(4), 0, dp(2)) }
        root.addView(statusText, wide())
        toggleBtn = goldButton("") { onToggleClicked() }
        root.addView(toggleBtn, wide().apply { topMargin = dp(8) })

        val testBtn = outlineButton("Test Print") { onTestPrint() }
        root.addView(testBtn, wide().apply { topMargin = dp(6) })

        // ---- SETUP: Select / Change Printer (Bluetooth scan lives here, NOT the daily action) ----
        root.addView(sectionHeader("Select / Change Printer"))
        scanBtn = goldButton(scanIdleLabel()) { onScanClicked() }
        root.addView(scanBtn, wide().apply { topMargin = dp(4) })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list, wide())

        // ---- SETUP: printer language + sticker rate ----
        langBtn = outlineButton("") { store.printerTspl = !store.printerTspl; updateLangLabel() }
        updateLangLabel()
        root.addView(langBtn, wide().apply { topMargin = dp(12) })

        root.addView(TextView(this).apply {
            text = "Sticker price per gram (₱) — optional"; setTextColor(beige); textSize = 12f
            setPadding(0, dp(12), 0, dp(2))
        }, wide())
        val rate = EditText(this).apply {
            setText(store.pricePerGram ?: "")
            hint = "e.g. 7500"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setTextColor(ivory); setHintTextColor(beige)
        }
        root.addView(rate, wide())
        root.addView(outlineButton("Save rate") {
            store.pricePerGram = rate.text.toString().trim().ifEmpty { null }
            toast("Sticker rate saved.")
        }, wide().apply { topMargin = dp(4) })

        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        // Show already-paired printers immediately (needs CONNECT on Android 12+).
        if (hasBtPermissions()) loadBonded() else ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
        // Keep the warm connection + print pump running when the printer is ON.
        if (!store.printerAddress.isNullOrBlank() && store.printerEnabled) PrintJobPoller.start(this)
        refreshPrinterUi()
        renderList()
    }

    override fun onPause() {
        super.onPause()
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false }
    }

    // ---- ON/OFF toggle -------------------------------------------------------

    private fun onToggleClicked() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { onScanClicked(); return } // "Select Printer" state → scan
        if (store.printerEnabled) confirmTurnOff() else turnOn(addr)
    }

    /** OFF → ON: reconnect to the SAVED printer (no scan). Shows Connecting…, then Connected only
     *  once the socket is actually ready; a failed reconnect reverts to OFF and says so. */
    private fun turnOn(addr: String) {
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        store.printerEnabled = true
        connecting = true
        refreshPrinterUi()
        PrintJobPoller.start(this) // resume keep-alive + print pump
        thread {
            val res = BluetoothPrinterManager.connect(this, addr)
            runOnUiThread {
                connecting = false
                if (!res.ok) {
                    store.printerEnabled = false // do NOT pretend it's connected
                    toast("Unable to connect to ${store.printerName ?: "printer"}.")
                }
                refreshPrinterUi()
            }
        }
    }

    /** ON → OFF: confirm first (guards against an accidental tap). */
    private fun confirmTurnOff() {
        AlertDialog.Builder(this)
            .setTitle("Disconnect printer?")
            .setMessage("Auto-printing will pause until you turn the printer back on.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Disconnect") { _, _ -> turnOff() }
            .show()
    }

    private fun turnOff() {
        store.printerEnabled = false // intent OFF — keeps the saved printer (never unpaired/forgotten)
        connecting = false
        thread {
            // Close the socket cleanly; the keep-alive won't reconnect and the poller won't print
            // while OFF (both gate on printerEnabled), so OFF stays off.
            BluetoothPrinterManager.disconnect()
            runOnUiThread { refreshPrinterUi(); toast("Printer disconnected. Auto-print paused.") }
        }
    }

    // ---- Select / Change Printer (scan) --------------------------------------

    private fun scanIdleLabel(): String =
        if (store.printerAddress.isNullOrBlank()) "Select Printer" else "Change Printer"

    private fun onScanClicked() {
        if (!hasBtPermissions()) {
            pendingScan = true
            ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
            return
        }
        if (!BluetoothPrinterManager.isBluetoothOn(this)) { toast("Turn on Bluetooth first."); return }
        // Android ≤11 finds NOTHING on discovery unless Location services are ON (a system
        // requirement, separate from the permission). Guide the operator to enable it.
        if (!locationServicesOn()) {
            toast("Turn ON Location — Android needs it to scan for Bluetooth printers.")
            try { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) } catch (_: Exception) {}
            loadBonded(); renderList()
            return
        }
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false; scanBtn.text = scanIdleLabel(); return }
        loadBonded()
        scanning = true
        scanBtn.text = "Scanning… (tap to stop)"
        val started = BluetoothPrinterManager.startDiscovery(
            this,
            onFound = { p -> runOnUiThread { found[p.address] = p; renderList() } },
            onFinished = { runOnUiThread { scanning = false; scanBtn.text = scanIdleLabel() } },
        )
        if (!started) { scanning = false; scanBtn.text = scanIdleLabel(); toast("Could not start scan.") }
    }

    private fun setActive(p: BluetoothPrinterManager.Printer) {
        if (!p.bonded) {
            toast("Pairing ${p.name}… accept on the phone, then tap Set as Active again.")
            BluetoothPrinterManager.pair(this, p.address)
            return
        }
        store.printerAddress = p.address
        store.printerName = p.name
        store.printerEnabled = true // selecting a printer turns it ON
        connecting = true
        refreshPrinterUi(); renderList()
        toast("${p.name} set as active printer.")
        // Warm the connection + make sure the print pump is running.
        PrintJobPoller.start(this)
        thread {
            BluetoothPrinterManager.connect(this, p.address)
            runOnUiThread { connecting = false; refreshPrinterUi(); renderList() }
        }
    }

    private fun onTestPrint() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { toast("Set an active printer first."); return }
        // Respect an intentional OFF — do NOT silently reconnect just because Test Print was pressed.
        if (!store.printerEnabled) { toast("Printer is off. Turn it on to print."); return }
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        toast("Printing test…")
        thread {
            // Test Print = the REAL capture sticker (sample name + configured price/g + local
            // date) through the shared encoder — never the old "A.V. Jewelry / TEST PRINT".
            val bytes = StickerEncoder.encode(
                StickerEncoder.sampleSticker(store.pricePerGram),
                store.printerTspl,
            )
            val res = BluetoothPrinterManager.print(this, addr, bytes)
            runOnUiThread { toast(if (res.ok) "Test sent to printer." else (res.error ?: "Test print failed.")); refreshPrinterUi() }
        }
    }

    // ---- Rendering -----------------------------------------------------------

    private fun loadBonded() {
        BluetoothPrinterManager.bondedPrinters(this).forEach { found[it.address] = it }
    }

    private fun renderList() {
        list.removeAllViews()
        val selected = store.printerAddress
        if (found.isEmpty()) {
            list.addView(TextView(this).apply {
                text = "No printers yet. Turn ON Location + Bluetooth, then tap Select / Change Printer — or pair the printer in Android Bluetooth settings (PIN 0000) and reopen this screen."
                setTextColor(beige); textSize = 12f; setPadding(0, dp(6), 0, dp(6))
            }, wide())
            return
        }
        found.values.forEach { p ->
            val connected = BluetoothPrinterManager.isConnected(p.address)
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(10), dp(10), dp(10), dp(10))
                setBackgroundColor(if (p.address == selected) Color.parseColor("#1C1A12") else Color.parseColor("#141414"))
            }
            row.addView(TextView(this).apply {
                text = p.name + if (p.address == selected) "   ★ ACTIVE" else ""
                setTextColor(if (p.address == selected) gold else ivory); textSize = 15f
                setTypeface(null, Typeface.BOLD)
            }, wide())
            row.addView(TextView(this).apply {
                val paired = if (p.bonded) "Paired" else "Not paired"
                val conn = if (connected) "Connected" else "Disconnected"
                text = "${p.address}   ·   $paired   ·   $conn"
                setTextColor(if (connected) green else beige); textSize = 11f
            }, wide())
            row.addView(goldButton(if (p.bonded) "Set as Active Printer" else "Pair") { setActive(p) },
                wide().apply { topMargin = dp(6) })
            list.addView(row, wide().apply { topMargin = dp(8) })
        }
    }

    /** Reflect the two-fact state (configured vs enabled vs live socket) via the pure resolver. */
    private fun refreshPrinterUi() {
        val addr = store.printerAddress
        val name = store.printerName ?: "XP-236B"
        val state = PrinterToggle.resolve(
            hasPrinter = !addr.isNullOrBlank(),
            enabled = store.printerEnabled,
            connected = !addr.isNullOrBlank() && BluetoothPrinterManager.isConnected(addr),
            connecting = connecting,
        )
        when (state) {
            PrinterToggleState.NO_PRINTER -> {
                statusText.text = "No printer linked"; statusText.setTextColor(beige)
                toggleBtn.text = "Select Printer"
            }
            PrinterToggleState.OFF -> {
                statusText.text = "$name  ·  Disconnected"; statusText.setTextColor(beige)
                toggleBtn.text = "Turn ON"
            }
            PrinterToggleState.CONNECTING -> {
                statusText.text = "$name  ·  Connecting…"; statusText.setTextColor(gold)
                toggleBtn.text = "Turn OFF"
            }
            PrinterToggleState.CONNECTED -> {
                statusText.text = "$name  ·  Connected"; statusText.setTextColor(green)
                toggleBtn.text = "Turn OFF"
            }
        }
        if (!scanning) scanBtn.text = scanIdleLabel()
    }

    private fun updateLangLabel() {
        langBtn.text = "Printer language: " + if (store.printerTspl) "TSPL (label)  — tap to switch" else "ESC/POS (receipt)  — tap to switch"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) {
            if (hasBtPermissions()) {
                loadBonded(); renderList(); refreshPrinterUi()
                if (pendingScan) { pendingScan = false; onScanClicked() }
            } else {
                toast("Bluetooth permission is needed to find and print to the printer.")
            }
        }
    }

    // ---- Permissions ---------------------------------------------------------

    private fun requiredPerms(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        else
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun hasBtPermissions(): Boolean = requiredPerms().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    /** Android ≤11 needs Location SERVICES on (separate from the permission) for BT
     *  discovery — otherwise startDiscovery finds nothing. Android 12+ doesn't need it. */
    private fun locationServicesOn(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return true
        val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return true
        return try {
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (_: Exception) {
            true
        }
    }

    // ---- View helpers --------------------------------------------------------

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
    private fun title(text: String) = TextView(this).apply {
        this.text = text; textSize = 22f; setTextColor(ivory); setPadding(0, 0, 0, dp(6))
    }
    private fun sectionHeader(text: String) = TextView(this).apply {
        this.text = text; setTextColor(ivory); textSize = 15f; setTypeface(null, Typeface.BOLD)
        setPadding(0, dp(16), 0, dp(4))
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

    companion object {
        private const val REQ_PERMS = 42
        fun open(context: Context) {
            context.startActivity(Intent(context, BluetoothPrinterActivity::class.java))
        }
    }
}
