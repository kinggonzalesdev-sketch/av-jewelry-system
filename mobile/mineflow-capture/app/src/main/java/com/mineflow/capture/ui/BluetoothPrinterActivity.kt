package com.mineflow.capture.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.printer.BluetoothPrinterManager
import com.mineflow.capture.printer.PrintJobPoller
import com.mineflow.capture.printer.StickerEncoder
import kotlin.concurrent.thread

/**
 * Settings → Bluetooth Printer. Scans/lists nearby + paired thermal printers (name,
 * address, Paired/Not Paired, Connected/Disconnected), lets the operator pair one and
 * "Set as Active Printer" (remembered on this device), reconnects automatically, and
 * offers a Test Print. Native Android Bluetooth — no PC, no Web Bluetooth.
 */
class BluetoothPrinterActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#8C7C55")
    private val black = Color.parseColor("#0B0B0B")
    private val green = Color.parseColor("#7CCB7C")

    private lateinit var store: SecureStore
    private lateinit var activeStatus: TextView
    private lateinit var scanBtn: Button
    private lateinit var langBtn: Button
    private lateinit var list: LinearLayout

    // address -> printer, merged from bonded + discovery so the list is one set.
    private val found = LinkedHashMap<String, BluetoothPrinterManager.Printer>()
    private var scanning = false
    private var pendingScan = false

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
        activeStatus = TextView(this).apply { setTextColor(beige); textSize = 13f; setPadding(0, dp(6), 0, dp(10)) }
        root.addView(activeStatus, wide())

        scanBtn = goldButton("Scan for printers") { onScanClicked() }
        val testBtn = outlineButton("Test Print") { onTestPrint() }
        root.addView(scanBtn, wide().apply { topMargin = dp(6) })
        root.addView(testBtn, wide().apply { topMargin = dp(6) })

        // Printer language (label vs receipt) + the sticker price-per-gram rate.
        langBtn = outlineButton("") { store.printerTspl = !store.printerTspl; updateLangLabel() }
        updateLangLabel()
        root.addView(langBtn, wide().apply { topMargin = dp(6) })

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

        root.addView(TextView(this).apply {
            text = "Printers"; setTextColor(ivory); textSize = 15f; setTypeface(null, Typeface.BOLD)
            setPadding(0, dp(16), 0, dp(4))
        }, wide())
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list, wide())

        val scroll = ScrollView(this).apply { addView(root) }
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        // Show already-paired printers immediately (needs CONNECT on Android 12+).
        if (hasBtPermissions()) loadBonded() else ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
        refreshActiveStatus()
        renderList()
    }

    override fun onPause() {
        super.onPause()
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false }
    }

    // ---- Actions -------------------------------------------------------------

    private fun onScanClicked() {
        if (!hasBtPermissions()) {
            pendingScan = true
            ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS)
            return
        }
        if (!BluetoothPrinterManager.isBluetoothOn(this)) { toast("Turn on Bluetooth first."); return }
        if (scanning) { BluetoothPrinterManager.stopDiscovery(this); scanning = false; scanBtn.text = "Scan for printers"; return }
        loadBonded()
        scanning = true
        scanBtn.text = "Scanning… (tap to stop)"
        val started = BluetoothPrinterManager.startDiscovery(
            this,
            onFound = { p -> runOnUiThread { found[p.address] = p; renderList() } },
            onFinished = { runOnUiThread { scanning = false; scanBtn.text = "Scan for printers" } },
        )
        if (!started) { scanning = false; scanBtn.text = "Scan for printers"; toast("Could not start scan.") }
    }

    private fun setActive(p: BluetoothPrinterManager.Printer) {
        if (!p.bonded) {
            toast("Pairing ${p.name}… accept on the phone, then tap Set as Active again.")
            BluetoothPrinterManager.pair(this, p.address)
            return
        }
        store.printerAddress = p.address
        store.printerName = p.name
        refreshActiveStatus(); renderList()
        toast("${p.name} set as active printer.")
        // Warm the connection + make sure the print pump is running.
        thread { BluetoothPrinterManager.connect(this, p.address); runOnUiThread { refreshActiveStatus() } }
        PrintJobPoller.start(this)
    }

    private fun onTestPrint() {
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) { toast("Set an active printer first."); return }
        if (!hasBtPermissions()) { ActivityCompat.requestPermissions(this, requiredPerms(), REQ_PERMS); return }
        toast("Printing test…")
        thread {
            val bytes = StickerEncoder.encodeTest(store.printerTspl)
            val res = BluetoothPrinterManager.print(this, addr, bytes)
            runOnUiThread { toast(if (res.ok) "Test sent to printer." else (res.error ?: "Test print failed.")); refreshActiveStatus() }
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
                text = "No printers yet. Tap Scan, or pair the printer in Android Bluetooth settings."
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

    private fun refreshActiveStatus() {
        val name = store.printerName
        val addr = store.printerAddress
        if (addr.isNullOrBlank()) {
            activeStatus.text = "Active printer: none selected"
            activeStatus.setTextColor(beige)
            return
        }
        val connected = BluetoothPrinterManager.isConnected(addr)
        activeStatus.text = "Active printer: ${name ?: addr}\nStatus: " + if (connected) "Connected ✓" else "Disconnected"
        activeStatus.setTextColor(if (connected) green else beige)
    }

    private fun updateLangLabel() {
        langBtn.text = "Printer language: " + if (store.printerTspl) "TSPL (label)  — tap to switch" else "ESC/POS (receipt)  — tap to switch"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS) {
            if (hasBtPermissions()) {
                loadBonded(); renderList()
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

    // ---- View helpers --------------------------------------------------------

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
    private fun title(text: String) = TextView(this).apply {
        this.text = text; textSize = 22f; setTextColor(ivory); setPadding(0, 0, 0, dp(6))
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
