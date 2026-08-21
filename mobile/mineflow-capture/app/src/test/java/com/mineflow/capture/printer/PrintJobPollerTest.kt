package com.mineflow.capture.printer

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The background rate-sync rule (Owner 2026-08-21): the phone mirrors the ONE saved web Sticker
 * Settings price-per-gram — carried on the capture-claim response — into its local cache, which the
 * direct/local print reads. The print path never waits on the network; this is a background sync.
 */
class PrintJobPollerTest {

    // A present string rate is trimmed and used verbatim (₱ rate as configured on the web).
    @Test
    fun sharedRate_stringValue_isTrimmed() {
        assertEquals("6800", PrintJobPoller.sharedRate(JSONObject().put("pricePerGram", "6800")))
        assertEquals("7500", PrintJobPoller.sharedRate(JSONObject().put("pricePerGram", " 7500 ")))
    }

    // Empty / whitespace / JSON null → null (price line hidden or unset on the web → grams only).
    @Test
    fun sharedRate_emptyOrNull_isNull() {
        assertNull(PrintJobPoller.sharedRate(JSONObject().put("pricePerGram", "")))
        assertNull(PrintJobPoller.sharedRate(JSONObject().put("pricePerGram", "   ")))
        assertNull(PrintJobPoller.sharedRate(JSONObject().put("pricePerGram", JSONObject.NULL)))
    }

    // An ABSENT field (older server that doesn't send it) must be treated as "leave the local cache
    // alone" — the caller guards with resp.has(...) — NOT as "clear the rate".
    @Test
    fun absentField_isDistinctFrom_presentNull() {
        val absent = JSONObject().put("claimed", false)
        assertFalse(absent.has("pricePerGram"))

        val presentNull = JSONObject().put("pricePerGram", JSONObject.NULL)
        assertTrue(presentNull.has("pricePerGram")) // present → the caller WILL sync (to null = clear)
        assertNull(PrintJobPoller.sharedRate(presentNull))
    }
}
