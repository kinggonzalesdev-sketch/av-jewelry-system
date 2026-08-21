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
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.BluetoothPrinterManager
import com.mineflow.capture.printer.PrintJobPoller
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
    private lateinit var printerSpinner: Spinner

    // address -> printer, merged from bonded + discovery so the dropdown is one set.
    private val found = LinkedHashMap<String, BluetoothPrinterManager.Printer>()
    private var scanning = false
    private var pendingScan = false
    // Connection state: `connecting` is TRANSIENT (an attempt is in flight); the resumed-only
    // status tick clears it the moment the ACTUAL socket is connected — the UI never trusts a stale
    // boolean. `connectFailed` shows the one-shot "Connection failed" until the next attempt.
    private var connecting = false
    private var connectFailed = false
    private var connectStartMs = 0L
    private val ui = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore.get(this)
        val pad = dp(20)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(black)
            setPadding(pad, pad, pad, pad)
        }

        root.addView(title("Bluetooth Printer"))

        // Live connection status of the selected printer (compact — no MAC/paired clutter).
        statusText = TextView(this).apply { setTextColor(beige); textSize = 15f; setPadding(0, dp(4), 0, dp(2)) }
        root.addView(statusText, wide())

        // ---- ONE dropdown of available / paired / discovered printers (replaces the old list) ----
        root.addView(fieldLabel("Printer"))
        printerSpinner = Spinner(this)
        root.addView(printerSpinner, wide())
        scanBtn = outlineButton(scanIdleLabel()) { onScanClicked() }
        root.addView(scanBtn, wide().apply { topMargin = dp(2) })

        // Connect / Disconnect (reconnect to the selected printer — no scan) + Test Print.
        toggleBtn = goldButton("") { onToggleClicked() }
        root.addView(toggleBtn, wide().apply { topMargin = dp(8) })
        root.addView(outlineButton("Test Print") { onTestPrint() }, wide().apply { topMargin = dp(6) })

        // ---- Sticker Price Per Gram → Save Rate (DIRECTLY below Test Print) ----
        root.addView(sectionHeader("Sticker Price Per Gram"))
        val rate = EditText(this).apply {
            setText(store.pricePerGram ?: "")
            hint = "₱ e.g. 7500"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setTextColor(ivory); setHintTextColor(beige)
        }
        root.addView(rate, wide())
        root.addView(goldButton("Save Rate") { onSaveRate(rate) }, wide().apply { topMargin = dp(4) })

        // Printer language (TSPL/ESC-POS) — capability preserved, kept compact at the bottom.
        langBtn = outlineButton("") { store.printerTspl = !store.printerTspl; updateLangLabel() }
        updateLangLabel()
        root.addView(langBtn, wide().apply { topMargin = dp(16) })

        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)
    }

    /** Save Rate: the LOCAL value becomes authoritative IMMEDIATELY (the very next Capture uses it,
     *  zero server wait), and is pushed to the shared server in the background so other phones sync
     *  later. A failed push keeps the local rate (still dirty → the poller retries). Never reverts. */
    private fun onSaveRate(rate: EditText) {
        val v = rate.text.toString().trim()
        if (v.isNotEmpty() && !Regex("^\\d{1,9}(\\.\\d{1,2})?$").matches(v)) {
            toast("Enter a valid rate, e.g. 7500."); return
        }
        store.pricePerGram = v.ifEmpty { null }
        store.pricePerGramDirty = true // LOCAL wins now — the background poll must not overwrite it.
        toast(if (v.isEmpty()) "Rate cleared." else "Rate saved — next sticker prints ₱$v/g.")
        val ctx = applicationContext
        thread {
            val res = ApiClient(ctx).pushStickerRate(store.pricePerGram)
            if (res.ok) { store.pricePerGramServerRev = res.rev; store.pricePerGramDirty = false }
        }
    }

    override fun onResume() {
        super.onResume()
        // Show already-paired printers immediately (needs CONNECT on Android 12+).
        if (hasBtPermissions()) loadBonded() else ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
        // Keep the warm connection + print pump running when the printer is ON.
        if (!store.printerAddress.isNullOrBlank() && store.printerEnabled) PrintJobPoller.start(this)
        // Entering the screen shows the ACTUAL connection state — never a stale connecting/failed
        // flag carried over from a previous visit (test 6: correct saved printer + real state).
        connecting = false
        connectFailed = false
        rebuildPrinterSpinner()
        startStatusTick()
    }

    override fun onPause() {
        super.onPause()
        ui.removeCallbacks(statusTick)
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false }
    }

    // ---- Live status: the UI always reflects the REAL socket state (not a stale boolean) --------

    private fun startStatusTick() {
        ui.removeCallbacks(statusTick)
        ui.post(statusTick)
    }

    /** Runs only while the screen is resumed. Clears the transient `connecting` the instant the
     *  actual socket is connected, or marks it failed after a timeout, then repaints — so
     *  "Connecting…" can never stick once the printer is really connected. */
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

    /** Begin a connection attempt: keep-alive warms the socket in the background AND we fire an
     *  immediate explicit connect; the status tick owns the UI so it flips to Connected the moment
     *  the socket is up (whichever path wins) and never waits on the blocking connect() to return. */
    private fun beginConnect(addr: String) {
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        store.printerEnabled = true
        connectFailed = false
        connecting = true
        connectStartMs = SystemClock.elapsedRealtime()
        refreshPrinterUi()
        PrintJobPoller.start(this) // keep-alive + print pump (warms the socket)
        thread { BluetoothPrinterManager.connect(this, addr) } // immediate attempt; tick owns the UI state
        startStatusTick()
    }

    // ---- ON/OFF toggle -------------------------------------------------------

    private fun onToggleClicked() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { toast("Choose a printer from the dropdown first."); return }
        if (connecting) return // an attempt is already in flight — protect against duplicate taps
        if (BluetoothPrinterManager.isConnected(addr)) confirmTurnOff() else beginConnect(addr)
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
        connectFailed = false
        thread {
            // Close the socket cleanly; the keep-alive won't reconnect and the poller won't print
            // while OFF (both gate on printerEnabled), so OFF stays off.
            BluetoothPrinterManager.disconnect()
            runOnUiThread { refreshPrinterUi(); toast("Printer disconnected. Auto-print paused.") }
        }
    }

    // ---- Select / Change Printer (scan) --------------------------------------

    private fun scanIdleLabel(): String = "Scan for printers"

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
            loadBonded(); rebuildPrinterSpinner()
            return
        }
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false; scanBtn.text = scanIdleLabel(); return }
        loadBonded()
        scanning = true
        scanBtn.text = "Scanning… (tap to stop)"
        val started = BluetoothPrinterManager.startDiscovery(
            this,
            onFound = { p -> runOnUiThread { found[p.address] = p; rebuildPrinterSpinner() } },
            onFinished = { runOnUiThread { scanning = false; scanBtn.text = scanIdleLabel() } },
        )
        if (!started) { scanning = false; scanBtn.text = scanIdleLabel(); toast("Could not start scan.") }
    }

    private fun setActive(p: BluetoothPrinterManager.Printer) {
        if (!p.bonded) {
            toast("Pairing ${p.name}… accept on the phone, then pick it again from the dropdown.")
            BluetoothPrinterManager.pair(this, p.address)
            return
        }
        store.printerAddress = p.address
        store.printerName = p.name
        rebuildPrinterSpinner()      // reflect the new active (✓) in the dropdown
        toast("${p.name} selected.") // genuine user change only (the listener ignores re-selects)
        beginConnect(p.address)      // connect + drive the live status via the tick
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

    /** Rebuild the single printer dropdown from the merged bonded + discovered set. Selecting an
     *  item makes it the active printer (pair if needed, then connect); the active one is pre-
     *  selected and marked ✓. Only the NAME shows — a short MAC suffix appears ONLY to disambiguate
     *  duplicate names (no paired/connected/MAC clutter for normal staff). Device-local: the choice
     *  is remembered per phone and never shared. */
    private fun rebuildPrinterSpinner() {
        val printers = found.values.toList()
        val selected = store.printerAddress
        val nameCounts = printers.groupingBy { it.name }.eachCount()
        val labels = printers.map { p ->
            val suffix = if ((nameCounts[p.name] ?: 0) > 1) "  (…${p.address.takeLast(5)})" else ""
            val mark = if (p.address == selected) "  ✓" else ""
            p.name + suffix + mark
        }
        val display = labels.ifEmpty { listOf("No printers — tap Scan for printers") }
        printerSpinner.adapter =
            ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, display)
        val idx = printers.indexOfFirst { it.address == selected }
        if (idx >= 0) printerSpinner.setSelection(idx)
        printerSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                // Act ONLY on a genuine user CHANGE. A programmatic pre-select / restore / re-pick of
                // the already-active printer selects the SAME address → ignored: no "selected" toast,
                // no reconnect. This replaces the timing-fragile suppress flag (fixes both issues).
                val p = printers.getOrNull(position) ?: return
                if (p.address == store.printerAddress) return
                setActive(p)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    /** Reflect the ACTUAL socket state — never a stale boolean. `connected` (live isConnected) wins,
     *  so the loading state stops the instant the printer is really connected even if the blocking
     *  connect() call hasn't returned. `connecting` shows only during a live attempt (the status tick
     *  clears it); "Connection failed" is a one-shot until the next attempt. */
    private fun refreshPrinterUi() {
        val addr = store.printerAddress
        val name = store.printerName ?: "Printer"
        val connected = !addr.isNullOrBlank() && BluetoothPrinterManager.isConnected(addr)
        when (
            resolvePrinterDisplay(
                hasPrinter = !addr.isNullOrBlank(),
                connected = connected,
                connecting = connecting,
                connectFailed = connectFailed,
            )
        ) {
            PrinterDisplay.NO_PRINTER -> {
                statusText.text = "No printer selected"; statusText.setTextColor(beige)
                toggleBtn.text = "Connect"; toggleBtn.isEnabled = false
            }
            PrinterDisplay.CONNECTED -> {
                statusText.text = "$name  ·  Connected"; statusText.setTextColor(green)
                toggleBtn.text = "Disconnect"; toggleBtn.isEnabled = true
            }
            PrinterDisplay.CONNECTING -> {
                statusText.text = "$name  ·  Connecting…"; statusText.setTextColor(gold)
                toggleBtn.text = "Connecting…"; toggleBtn.isEnabled = false // protect from duplicate taps
            }
            PrinterDisplay.FAILED -> {
                statusText.text = "$name  ·  Connection failed"; statusText.setTextColor(gold)
                toggleBtn.text = "Connect"; toggleBtn.isEnabled = true
            }
            PrinterDisplay.DISCONNECTED -> {
                statusText.text = "$name  ·  Not connected"; statusText.setTextColor(beige)
                toggleBtn.text = "Connect"; toggleBtn.isEnabled = true
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
                loadBonded(); rebuildPrinterSpinner(); refreshPrinterUi()
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
    private fun fieldLabel(text: String) = TextView(this).apply {
        this.text = text; setTextColor(beige); textSize = 12f; setPadding(0, dp(10), 0, dp(2))
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
        private const val CONNECT_TIMEOUT_MS = 12_000L // after this with no live socket → "Connection failed"
        private const val STATUS_TICK_MS = 700L        // how often the resumed screen re-reads the real state
        fun open(context: Context) {
            context.startActivity(Intent(context, BluetoothPrinterActivity::class.java))
        }
    }
}
