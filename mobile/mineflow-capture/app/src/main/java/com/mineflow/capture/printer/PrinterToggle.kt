package com.mineflow.capture.printer

/**
 * Pure, Android-free resolution of the printer ON/OFF toggle — so it is unit-testable.
 *
 * Two INDEPENDENT facts drive it:
 *   - hasPrinter : a printer is CONFIGURED (SecureStore.printerAddress) — survives OFF.
 *   - enabled    : the user's toggle INTENT (SecureStore.printerEnabled) — OFF only flips this.
 * plus the live `connected` socket and a transient `connecting` flag.
 *
 * OFF never depends on the socket; an enabled-but-not-yet-connected printer reads CONNECTING,
 * never a false CONNECTED. A local sticker print (capture auto-print AND Test Print) is allowed
 * ONLY when a printer is configured AND enabled.
 */
enum class PrinterToggleState { NO_PRINTER, OFF, CONNECTING, CONNECTED }

object PrinterToggle {
    fun resolve(
        hasPrinter: Boolean,
        enabled: Boolean,
        connected: Boolean,
        connecting: Boolean,
    ): PrinterToggleState = when {
        !hasPrinter -> PrinterToggleState.NO_PRINTER
        !enabled -> PrinterToggleState.OFF
        connecting -> PrinterToggleState.CONNECTING
        connected -> PrinterToggleState.CONNECTED
        else -> PrinterToggleState.CONNECTING // enabled but socket not up yet → never false "Connected"
    }

    /** May a local Bluetooth sticker print be attempted? Gates capture auto-print AND Test Print. */
    fun mayPrint(hasPrinter: Boolean, enabled: Boolean): Boolean = hasPrinter && enabled
}
