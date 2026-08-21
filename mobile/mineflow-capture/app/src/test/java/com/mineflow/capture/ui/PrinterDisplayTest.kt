package com.mineflow.capture.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** The printer status priority — especially that a LIVE connection beats a lingering `connecting`
 *  flag, so "Connecting…" can never stick once the socket is actually up (Owner 2026-08-21). */
class PrinterDisplayTest {

    @Test
    fun noPrinter_regardlessOfFlags() {
        assertEquals(PrinterDisplay.NO_PRINTER, resolvePrinterDisplay(false, false, true, true))
    }

    // THE fix: connected wins over a still-set connecting flag → loading stops immediately.
    @Test
    fun connected_beats_lingeringConnecting() {
        assertEquals(PrinterDisplay.CONNECTED, resolvePrinterDisplay(true, true, true, false))
    }

    @Test
    fun connected_beats_failedFlag() {
        assertEquals(PrinterDisplay.CONNECTED, resolvePrinterDisplay(true, true, false, true))
    }

    @Test
    fun connecting_onlyWhileNotConnected() {
        assertEquals(PrinterDisplay.CONNECTING, resolvePrinterDisplay(true, false, true, false))
    }

    @Test
    fun failed_whenNoSocketAndNoAttempt() {
        assertEquals(PrinterDisplay.FAILED, resolvePrinterDisplay(true, false, false, true))
    }

    @Test
    fun disconnected_default() {
        assertEquals(PrinterDisplay.DISCONNECTED, resolvePrinterDisplay(true, false, false, false))
    }
}
