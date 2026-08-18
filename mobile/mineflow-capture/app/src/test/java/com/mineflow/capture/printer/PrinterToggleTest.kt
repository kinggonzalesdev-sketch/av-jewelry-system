package com.mineflow.capture.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure tests for the printer ON/OFF toggle state machine (no Android deps). Covers: OFF is a
 *  separate intent from the saved printer, OFF ignores the socket, a failed/pending reconnect
 *  never shows Connected, and local print (capture + Test Print) is blocked while OFF. */
class PrinterToggleTest {

    @Test
    fun noPrinter_whenNoneConfigured() {
        assertEquals(
            PrinterToggleState.NO_PRINTER,
            PrinterToggle.resolve(hasPrinter = false, enabled = true, connected = false, connecting = false),
        )
    }

    @Test
    fun off_whenConfiguredButDisabled_regardlessOfSocket() {
        // A saved printer toggled OFF reads OFF even if a stale socket still reports connected —
        // proving OFF is an intent flag independent of the live connection (saved printer survives).
        assertEquals(
            PrinterToggleState.OFF,
            PrinterToggle.resolve(hasPrinter = true, enabled = false, connected = false, connecting = false),
        )
        assertEquals(
            PrinterToggleState.OFF,
            PrinterToggle.resolve(hasPrinter = true, enabled = false, connected = true, connecting = false),
        )
    }

    @Test
    fun connecting_whenEnabledButNotYetConnected_neverFalseConnected() {
        assertEquals(
            PrinterToggleState.CONNECTING,
            PrinterToggle.resolve(hasPrinter = true, enabled = true, connected = false, connecting = true),
        )
        // Enabled, no socket, not actively connecting (e.g. just after a failed reconnect) must
        // NOT show Connected.
        assertEquals(
            PrinterToggleState.CONNECTING,
            PrinterToggle.resolve(hasPrinter = true, enabled = true, connected = false, connecting = false),
        )
    }

    @Test
    fun connected_onlyWhenEnabledAndSocketUp() {
        assertEquals(
            PrinterToggleState.CONNECTED,
            PrinterToggle.resolve(hasPrinter = true, enabled = true, connected = true, connecting = false),
        )
    }

    @Test
    fun mayPrint_onlyWhenConfiguredAndEnabled() {
        assertTrue(PrinterToggle.mayPrint(hasPrinter = true, enabled = true))
        // Capture auto-print AND Test Print are blocked while OFF (no Bluetooth write attempted).
        assertFalse(PrinterToggle.mayPrint(hasPrinter = true, enabled = false))
        assertFalse(PrinterToggle.mayPrint(hasPrinter = false, enabled = true))
    }
}
