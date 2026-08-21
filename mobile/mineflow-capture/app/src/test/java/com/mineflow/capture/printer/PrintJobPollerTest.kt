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

    // --- Rate OWNERSHIP reconcile (Owner 2026-08-21): a fresh local Save Rate wins; a stale server
    //     copy never reverts it; a genuinely newer server revision syncs. Build-15 regression fix. -

    @Test
    fun sharedRev_present_absent_null() {
        assertEquals("1734", PrintJobPoller.sharedRev(JSONObject().put("pricePerGramRev", 1734)))
        assertEquals("1734", PrintJobPoller.sharedRev(JSONObject().put("pricePerGramRev", "1734")))
        assertNull(PrintJobPoller.sharedRev(JSONObject().put("claimed", false)))         // absent
        assertNull(PrintJobPoller.sharedRev(JSONObject().put("pricePerGramRev", JSONObject.NULL)))
    }

    @Test
    fun revNewer_rules() {
        assertTrue(PrintJobPoller.revNewer("200", "100"))
        assertFalse(PrintJobPoller.revNewer("100", "200"))
        assertFalse(PrintJobPoller.revNewer("100", "100"))  // equal → not newer
        assertTrue(PrintJobPoller.revNewer("100", null))    // never synced → accept server
        assertTrue(PrintJobPoller.revNewer("100", ""))
        assertFalse(PrintJobPoller.revNewer(null, "100"))   // no server rev → keep local
        assertFalse(PrintJobPoller.revNewer("abc", "100"))  // non-numeric → keep local
    }

    // Local save: initial 6800, operator saves 7000 → dirty. The poll PUSHES 7000 and NEVER reverts
    // to a stale server 6800. (Offline: the executor only clears dirty on a successful push, so a
    // failed push keeps 7000 authoritative — same 'push' decision, retried next poll.)
    @Test
    fun localSave_dirty_pushesLocal_neverReverts() {
        val d = PrintJobPoller.rateDecision(
            present = true, dirty = true,
            localRate = "7000", localRev = "100",
            serverRate = "6800", serverRev = "50", // stale server
        )
        assertEquals("push", d.action)
        assertEquals("7000", d.rate) // the LOCAL value goes up; local stays authoritative
    }

    // Not dirty + a genuinely newer server revision → pull it (cross-phone sync).
    @Test
    fun notDirty_serverNewer_pulls() {
        val d = PrintJobPoller.rateDecision(
            present = true, dirty = false,
            localRate = "6800", localRev = "100",
            serverRate = "7000", serverRev = "200",
        )
        assertEquals("pull", d.action)
        assertEquals("7000", d.rate)
        assertEquals("200", d.rev)
    }

    // Not dirty but server is same/older → keep local (no revert).
    @Test
    fun notDirty_serverNotNewer_none() {
        assertEquals(
            "none",
            PrintJobPoller.rateDecision(
                present = true, dirty = false, localRate = "7000", localRev = "200",
                serverRate = "6800", serverRev = "150",
            ).action,
        )
        assertEquals(
            "none",
            PrintJobPoller.rateDecision(
                present = true, dirty = false, localRate = "7000", localRev = "200",
                serverRate = "7000", serverRev = "200", // equal rev
            ).action,
        )
    }

    // Older server that doesn't advertise the rate fields → never touches local (either state).
    @Test
    fun absentRateField_none() {
        assertEquals(
            "none",
            PrintJobPoller.rateDecision(
                present = false, dirty = false, localRate = "7000", localRev = "200",
                serverRate = null, serverRev = null,
            ).action,
        )
        assertEquals(
            "none",
            PrintJobPoller.rateDecision(
                present = false, dirty = true, localRate = "7000", localRev = "200",
                serverRate = null, serverRev = null,
            ).action,
        )
    }
}
