package com.mineflow.capture.printer

/**
 * Technical-only diagnostic of the phone's local `maybePrintDirect()` attempt, persisted per
 * capture (capture_records.print_diag) so ONE controlled capture is diagnosable read-only from the
 * server — no Logcat / tethered phone required.
 *
 * NEVER carries PII: no customer name, grams, screenshot, message, Bluetooth address, or token —
 * only the attempt result, whether the RFCOMM socket was warm, an exception CLASS / skip reason
 * (no message text), and timing.
 */
data class DirectPrintDiag(
    val result: String, // "success" | "failed" | "skipped"
    val socketWarm: Boolean?, // null when skipped before the socket was checked
    val errorClass: String?, // exception class ("IOException") OR skip reason ("no_printer") — no message
    val durationMs: Long, // time spent inside maybePrintDirect()
) {
    val attempted: Boolean get() = result != "skipped"

    /** A flat, technical-only map for JSON persistence. Keys mirror the server diagnostic fields. */
    fun asDiagMap(attemptedAtMs: Long): Map<String, Any?> = linkedMapOf(
        "attempted" to attempted,
        "result" to result,
        "socket_warm" to socketWarm,
        "error_class" to errorClass,
        "duration_ms" to durationMs,
        "attempted_at" to attemptedAtMs,
    )

    companion object {
        /** A direct print that never ran (printer off / not configured / no confident name+grams). */
        fun skipped(reason: String) = DirectPrintDiag("skipped", null, reason, 0L)
    }
}
