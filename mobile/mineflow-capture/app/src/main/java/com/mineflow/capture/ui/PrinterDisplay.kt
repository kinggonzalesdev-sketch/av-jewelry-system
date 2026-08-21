package com.mineflow.capture.ui

/** The five printer status presentations the Bluetooth Printer screen can show. */
internal enum class PrinterDisplay { NO_PRINTER, CONNECTED, CONNECTING, FAILED, DISCONNECTED }

/**
 * PURE priority for the printer status line + Connect/Disconnect button (unit-tested).
 *
 * The LIVE `connected` (actual `isConnected`) wins over a lingering `connecting` flag — so the
 * loading state stops the instant the socket is really up, even if the blocking connect() call
 * hasn't returned yet. This is the fix for "XP-236B · Connecting…" sticking after the printer is
 * already connected. `connectFailed` is a one-shot shown only when there is no live socket and no
 * attempt in flight.
 */
internal fun resolvePrinterDisplay(
    hasPrinter: Boolean,
    connected: Boolean,
    connecting: Boolean,
    connectFailed: Boolean,
): PrinterDisplay = when {
    !hasPrinter -> PrinterDisplay.NO_PRINTER
    connected -> PrinterDisplay.CONNECTED
    connecting -> PrinterDisplay.CONNECTING
    connectFailed -> PrinterDisplay.FAILED
    else -> PrinterDisplay.DISCONNECTED
}
