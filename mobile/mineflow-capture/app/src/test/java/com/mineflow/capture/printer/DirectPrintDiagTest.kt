package com.mineflow.capture.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** Pure tests for the durable direct-print diagnostic: correct result/attempted/timing mapping,
 *  and — critically — that the persisted map is technical-ONLY (no customer PII). */
class DirectPrintDiagTest {

    // Tokens that must NEVER appear in the diagnostic (name/grams/printer address/etc.).
    private val forbidden = listOf("king", "gonzales", "xp-236b", "00:", "mac", "token", "grams")

    @Test
    fun success_recordsSuccess_attempted_noError() {
        val m = DirectPrintDiag("success", socketWarm = true, errorClass = null, durationMs = 420)
            .asDiagMap(1_700_000_000_000L)
        assertEquals("success", m["result"])
        assertEquals(true, m["attempted"])
        assertEquals(true, m["socket_warm"])
        assertNull(m["error_class"])
        assertEquals(420L, m["duration_ms"])
        assertEquals(1_700_000_000_000L, m["attempted_at"])
    }

    @Test
    fun failed_recordsFailure_withErrorClassAndColdSocket() {
        val m = DirectPrintDiag("failed", socketWarm = false, errorClass = "IOException", durationMs = 5200)
            .asDiagMap(1L)
        assertEquals("failed", m["result"])
        assertEquals(true, m["attempted"])
        assertEquals(false, m["socket_warm"])
        assertEquals("IOException", m["error_class"])
        assertEquals(5200L, m["duration_ms"])
    }

    @Test
    fun skipped_recordsReason_notAttempted() {
        val d = DirectPrintDiag.skipped("no_printer")
        assertEquals("skipped", d.result)
        assertFalse(d.attempted)
        val m = d.asDiagMap(1L)
        assertEquals(false, m["attempted"])
        assertNull(m["socket_warm"])
        assertEquals("no_printer", m["error_class"])
    }

    @Test
    fun diagMap_isTechnicalOnly_noPII() {
        val m = DirectPrintDiag("failed", true, "SecurityException", 999).asDiagMap(1L)
        assertEquals(
            setOf("attempted", "result", "socket_warm", "error_class", "duration_ms", "attempted_at"),
            m.keys,
        )
        val blob = m.values.joinToString(" ").lowercase()
        for (tok in forbidden) assertFalse("diag must not contain PII token '$tok'", blob.contains(tok))
    }
}
