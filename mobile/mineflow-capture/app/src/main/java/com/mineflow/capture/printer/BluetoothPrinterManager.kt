package com.mineflow.capture.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.mineflow.capture.data.SecureStore
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.concurrent.withLock

/**
 * Native Classic-Bluetooth (RFCOMM/SPP) thermal-printer transport. This is the
 * Android-native replacement for the PC's Web Bluetooth path — no PC or browser
 * required. Thermal/label printers (XP-236B etc.) expose the Serial Port Profile, so
 * we open an RFCOMM socket to the well-known SPP UUID and write the raw sticker bytes.
 *
 * Singleton: it holds ONE live socket so print jobs reuse the connection (auto-
 * reconnect when it drops). All Bluetooth calls are permission-guarded by the caller
 * (BluetoothPrinterActivity requests CONNECT/SCAN) and defensively try/catch here.
 */
object BluetoothPrinterManager {

    private const val TAG = "MineFlowPrinter"
    private val SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @Volatile private var socket: BluetoothSocket? = null
    @Volatile var connectedAddress: String? = null
        private set

    private var discoveryReceiver: BroadcastReceiver? = null

    // Serialises ALL printer I/O (connect / write / keep-alive probe). A ReentrantLock — NOT
    // @Synchronized — so the keep-alive can tryLock() and YIELD to a live capture print,
    // instead of ever blocking it behind a slow reconnect.
    private val ioLock = ReentrantLock()

    // ── Keep-alive ──────────────────────────────────────────────────────────────
    // A dedicated heartbeat holds the RFCOMM link open so the printer never idles out and
    // drops it (the XP-236B "disconnects on its own"), and reconnects IMMEDIATELY (short
    // backoff — NOT the old 8s) if it ever does. Goal: a capture print ALWAYS finds
    // isConnected=true and never runs the multi-second s.connect() itself.
    private const val HEARTBEAT_MS = 3000L
    private const val RECONNECT_BACKOFF_MS = 2500L
    // ESC/POS keep-alive = ESC @ (initialise): no print, no feed, no response — and exactly
    // what each sticker already starts with, so it is a true no-op between jobs.
    private val ESCPOS_KEEPALIVE = byteArrayOf(0x1b.toByte(), 0x40.toByte())
    // TSPL keep-alive = a bare CRLF: an empty command TSPL ignores (no CLS / no PRINT), so
    // nothing ever prints — it only keeps traffic on the link.
    private val TSPL_KEEPALIVE = "\r\n".toByteArray(Charsets.US_ASCII)
    @Volatile private var keepAliveRunning = false
    @Volatile private var keepAliveThread: Thread? = null
    @Volatile private var lastFailedConnectAt = 0L

    data class Printer(
        val name: String,
        val address: String,
        val bonded: Boolean,
        val connected: Boolean,
    )

    data class PrintResult(val ok: Boolean, val error: String? = null)

    fun adapter(context: Context): BluetoothAdapter? {
        val mgr = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return mgr?.adapter
    }

    fun isBluetoothOn(context: Context): Boolean = adapter(context)?.isEnabled == true

    /** Already-paired devices, each flagged connected when it is the live socket. */
    @SuppressLint("MissingPermission")
    fun bondedPrinters(context: Context): List<Printer> {
        val a = adapter(context) ?: return emptyList()
        return try {
            a.bondedDevices.orEmpty().map {
                Printer(
                    name = safeName(it),
                    address = it.address,
                    bonded = true,
                    connected = it.address == connectedAddress && socket?.isConnected == true,
                )
            }.sortedBy { it.name.lowercase() }
        } catch (e: SecurityException) {
            Log.w(TAG, "bondedDevices denied: ${e.message}")
            emptyList()
        }
    }

    @SuppressLint("MissingPermission")
    private fun safeName(d: BluetoothDevice): String =
        try { d.name ?: d.address } catch (_: SecurityException) { d.address }

    /**
     * Start a discovery scan. `onFound` is called for each nearby device (paired or
     * not); `onFinished` when the scan ends. Returns false when discovery couldn't
     * start (Bluetooth off / permission denied).
     */
    @SuppressLint("MissingPermission")
    fun startDiscovery(context: Context, onFound: (Printer) -> Unit, onFinished: () -> Unit): Boolean {
        val a = adapter(context) ?: return false
        stopDiscovery(context)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                when (intent.action) {
                    BluetoothDevice.ACTION_FOUND -> {
                        val device: BluetoothDevice? =
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                                intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                            else @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                        device?.let {
                            onFound(
                                Printer(
                                    name = safeName(it),
                                    address = it.address,
                                    bonded = it.bondState == BluetoothDevice.BOND_BONDED,
                                    connected = it.address == connectedAddress,
                                ),
                            )
                        }
                    }
                    BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                        onFinished()
                        stopDiscovery(context)
                    }
                }
            }
        }
        discoveryReceiver = receiver
        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_FOUND)
            addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        return try {
            // Android 14 (targetSdk 34) requires an export flag; the Bluetooth actions
            // are protected system broadcasts, so NOT_EXPORTED still receives them.
            ContextCompat.registerReceiver(
                context.applicationContext, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            if (a.isDiscovering) a.cancelDiscovery()
            a.startDiscovery()
        } catch (e: Exception) {
            Log.w(TAG, "startDiscovery failed: ${e.javaClass.simpleName}")
            stopDiscovery(context)
            false
        }
    }

    @SuppressLint("MissingPermission")
    fun stopDiscovery(context: Context) {
        try { adapter(context)?.let { if (it.isDiscovering) it.cancelDiscovery() } } catch (_: Exception) {}
        discoveryReceiver?.let {
            try { context.applicationContext.unregisterReceiver(it) } catch (_: Exception) {}
        }
        discoveryReceiver = null
    }

    /** Begin pairing (system bonding dialog). Returns false if it couldn't start. */
    @SuppressLint("MissingPermission")
    fun pair(context: Context, address: String): Boolean {
        val a = adapter(context) ?: return false
        return try {
            val d = a.getRemoteDevice(address)
            if (d.bondState == BluetoothDevice.BOND_BONDED) true else d.createBond()
        } catch (e: Exception) {
            Log.w(TAG, "pair failed: ${e.javaClass.simpleName}")
            false
        }
    }

    fun isConnected(address: String): Boolean =
        address == connectedAddress && socket?.isConnected == true

    /** Open (or reuse) the RFCOMM socket to `address`. Public entry — takes the I/O lock. */
    fun connect(context: Context, address: String): PrintResult =
        ioLock.withLock { connectLocked(context, address) }

    /** The real connect. Caller MUST already hold `ioLock`. */
    @SuppressLint("MissingPermission")
    private fun connectLocked(context: Context, address: String): PrintResult {
        if (isConnected(address)) return PrintResult(true)
        disconnectLocked()
        val a = adapter(context) ?: return PrintResult(false, "Bluetooth unavailable.")
        if (!a.isEnabled) return PrintResult(false, "Turn on Bluetooth first.")
        return try {
            if (a.isDiscovering) a.cancelDiscovery() // discovery slows/blocks a connect
            val device = a.getRemoteDevice(address)
            val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
            s.connect()
            socket = s
            connectedAddress = address
            PrintResult(true)
        } catch (e: SecurityException) {
            PrintResult(false, "Bluetooth permission denied.")
        } catch (e: Exception) {
            Log.w(TAG, "connect failed: ${e.javaClass.simpleName} ${e.message}")
            disconnectLocked()
            PrintResult(false, "Could not connect to the printer.")
        }
    }

    fun disconnect() = ioLock.withLock { disconnectLocked() }

    /** The real disconnect. Caller MUST already hold `ioLock`. */
    private fun disconnectLocked() {
        try { socket?.close() } catch (_: Exception) {}
        socket = null
        connectedAddress = null
    }

    /**
     * Connect if needed, then write the raw bytes. Retries once on a broken pipe. Because the
     * keep-alive holds the link warm, `connectLocked` here is normally an INSTANT no-op
     * (isConnected==true) — the multi-second s.connect() only runs on the rare genuine drop.
     */
    fun print(context: Context, address: String, bytes: ByteArray): PrintResult =
        ioLock.withLock {
            val c = connectLocked(context, address)
            if (!c.ok) return@withLock c
            try {
                val out: OutputStream = socket!!.outputStream
                out.write(bytes)
                out.flush()
                PrintResult(true)
            } catch (e: Exception) {
                Log.w(TAG, "write failed, reconnecting once: ${e.javaClass.simpleName}")
                disconnectLocked()
                val retry = connectLocked(context, address)
                if (!retry.ok) return@withLock retry
                try {
                    socket!!.outputStream.write(bytes)
                    socket!!.outputStream.flush()
                    PrintResult(true)
                } catch (e2: Exception) {
                    disconnectLocked()
                    PrintResult(false, "Print failed — check the printer.")
                }
            }
        }

    // ── Keep-alive lifecycle ─────────────────────────────────────────────────────

    /**
     * Start the keep-alive heartbeat (idempotent). Wired to wherever the print poller starts,
     * so it runs for the whole always-on capture session and keeps the printer socket warm.
     */
    fun ensureKeepAlive(context: Context) {
        if (keepAliveRunning) return
        keepAliveRunning = true
        val app = context.applicationContext
        keepAliveThread = thread(name = "mineflow-printer-keepalive", isDaemon = true) {
            while (keepAliveRunning) {
                try {
                    keepAliveBeat(app)
                } catch (e: Exception) {
                    Log.w(TAG, "keepalive beat: ${e.javaClass.simpleName}")
                }
                try { Thread.sleep(HEARTBEAT_MS) } catch (_: InterruptedException) { break }
            }
        }
    }

    fun stopKeepAlive() {
        keepAliveRunning = false
        keepAliveThread?.interrupt()
        keepAliveThread = null
    }

    /**
     * One heartbeat. Uses `tryLock()` so it NEVER blocks a live capture print — if a print
     * holds the lock, this beat is simply skipped. Holding the lock: probe a warm link with a
     * no-op that stops the printer idling out (a failed probe write means the link actually
     * died → drop it so the next beat reconnects), or reconnect a dropped link IMMEDIATELY.
     * Only a genuinely off / out-of-range printer backs off briefly, so we never hammer it
     * with back-to-back multi-second blocking connects.
     */
    private fun keepAliveBeat(context: Context) {
        val store = SecureStore.get(context)
        val address = store.printerAddress
        if (address.isNullOrBlank()) return
        if (!isBluetoothOn(context)) return
        if (!ioLock.tryLock()) return // a print is in progress — never wait behind it
        try {
            if (isConnected(address)) {
                try {
                    val probe = if (store.printerTspl) TSPL_KEEPALIVE else ESCPOS_KEEPALIVE
                    val out = socket!!.outputStream
                    out.write(probe)
                    out.flush()
                } catch (e: Exception) {
                    Log.w(TAG, "keepalive probe failed — link dropped: ${e.javaClass.simpleName}")
                    disconnectLocked()
                }
            } else {
                val now = System.currentTimeMillis()
                if (now - lastFailedConnectAt < RECONNECT_BACKOFF_MS) return
                val res = connectLocked(context, address)
                if (!res.ok) lastFailedConnectAt = now
            }
        } finally {
            ioLock.unlock()
        }
    }
}
