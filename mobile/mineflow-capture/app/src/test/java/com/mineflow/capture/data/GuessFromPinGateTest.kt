package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Owner 2026-08-29 — the VISUAL PIN GATE wired into guessFrom(). Proves:
 *   • gate OFF (no pinDetect, every existing caller) → behaviour is byte-for-byte the old behaviour;
 *   • gate ON  → a block prints ONLY when a confident pin sits on ITS avatar and it is the unique
 *     pinned block. No pin → null (Waiting); pin elsewhere / two pins → null (Needs Review). NEVER a
 *     fallback to the positional (bottom-most) pick.
 * The pin detector is injected as a lambda so the rule is testable without pixels.
 */
class GuessFromPinGateTest {

    private fun n(text: String, top: Int) = OLine(text, Box(95, top, 320, top + 40))
    private fun c(text: String, top: Int) = OLine(text, Box(95, top, 230, top + 34))

    // Avatar of a name at `top` = square just left of x=95 (see PinnedCommentSelector.avatarRegionFor);
    // a marker at x[65,95] over the block's vertical span overlaps it.
    private fun pinOnBlock(top: Int, bottom: Int) = PinMarker(Box(65, top + 10, 95, bottom), 0.9)

    private val king = n("King Gonzales", 100)
    private val kingClaim = c("Mine 10", 145)

    // 1 — gate OFF (default): unchanged. A valid pinned block reads name+value with no pin needed.
    @Test
    fun gateOff_readsNameAsBefore() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim))
        assertEquals("King Gonzales", g.fbName)
        assertEquals("10", g.itemQuery)
    }

    // 2 — gate ON, a confident pin on the block's avatar → still reads (Selected).
    @Test
    fun gateOn_pinOnBlock_reads() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim)) { listOf(pinOnBlock(100, 179)) }
        assertEquals("King Gonzales", g.fbName)
        assertEquals("10", g.itemQuery)
    }

    // 3 — gate ON, NO pin anywhere → null guess (Waiting for Pinned Comment), never the bottom pick.
    @Test
    fun gateOn_noPin_null() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim)) { emptyList() }
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // 4 — gate ON, a strong pin-like match OUTSIDE any avatar → rejected → null (Needs Review).
    @Test
    fun gateOn_pinOffAvatar_null() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim)) { listOf(PinMarker(Box(500, 400, 540, 440), 0.95)) }
        assertNull(g.fbName)
    }

    // Two named comments (A above, B below). guessFrom's positional pick is the bottom one (B).
    private val aaron = n("Aaron Cruz", 100)
    private val aaronClaim = c("Mine 5", 145)
    private val bella = n("Bella Reyes", 300)
    private val bellaClaim = c("Mine 8", 345)
    private val two = listOf(aaron, aaronClaim, bella, bellaClaim)

    // 5 — gate ON, only the BOTTOM block (B) is pinned → selects B (pin agrees with position).
    @Test
    fun gateOn_bottomPinned_selectsBottom() {
        val g = ScreenshotOcr.guessFrom(two) { listOf(pinOnBlock(300, 379)) }
        assertEquals("Bella Reyes", g.fbName)
        assertEquals("8", g.itemQuery)
    }

    // 6 — gate ON, only the TOP block (A) is pinned while B (bottom) is unpinned → the PIN is
    //     authoritative, so the TOP block wins regardless of position; the unpinned bottom is out of
    //     scope. (This is the core of the King fix: position never overrides the pin.)
    @Test
    fun gateOn_topPinned_selectsTopNotBottom() {
        val g = ScreenshotOcr.guessFrom(two) { listOf(pinOnBlock(100, 179)) }
        assertEquals("Aaron Cruz", g.fbName)
        assertEquals("5", g.itemQuery)
    }

    // 7 — gate ON, BOTH blocks pinned → Needs Review → null (never auto-pick one of two).
    @Test
    fun gateOn_twoPins_null() {
        val g = ScreenshotOcr.guessFrom(two) { listOf(pinOnBlock(100, 179), pinOnBlock(300, 379)) }
        assertNull(g.fbName)
    }

    // 8 — gate ON, a below-confidence pin is ignored (respects the detector floor) → null.
    @Test
    fun gateOn_weakPin_null() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim)) { listOf(PinMarker(Box(65, 150, 95, 179), 0.3)) }
        assertNull(g.fbName)
        assertEquals(PinGate.WAITING, g.pinGate)
    }

    // --- Owner 2026-08-30: zero-pin is a DISTINCT terminal state (Waiting), not "name not read", and a
    // requested gate that cannot operate FAILS CLOSED. King "Test .64" / "Test .18" physical cases. ----

    private val kName = n("King Gonzales", 100)
    private fun claimAt(text: String) = c(text, 145)

    // ZERO PIN .64 — the exact physical King capture (d5f339): a readable "Test .64" claim but NO pin
    // on screen. Must be Waiting (withheld), NOT a parsed/《name not read》row. The claim is NEVER
    // associated and NO name is emitted — the pin decision precedes selection.
    @Test
    fun zeroPin_test64_waiting_noNameNoClaim() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .64"))) { emptyList() }
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
        assertNull(g.grams)
        assertNull(g.itemQuery)
    }

    // ZERO PIN .18 — same, the Owner-reported "Test .18".
    @Test
    fun zeroPin_test18_waiting() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .18"))) { emptyList() }
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // VERIFIED BADGE is NOT a pin: a name carrying a blue verification check produces NO pin marker
    // from the detector → Waiting (never authorised). Modelled as the gated read with no pin marker.
    @Test
    fun verifiedBadge_isNotAPin_waiting() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .64"))) { emptyList() }
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
    }

    // "Send 200 Stars to pin your comment here" is Facebook UI — with no real pin it is Waiting, and
    // its "200" is never grams (banner is chrome → not an admissible claim).
    @Test
    fun starsPrompt_isNotAPin_waiting() {
        val g = ScreenshotOcr.guessFrom(
            listOf(kName, claimAt("Send 200 Stars to pin your comment here")),
        ) { emptyList() }
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // ONE REAL PIN .64 → the pinned block reads 0.64g (leading-decimal preserved through the gate).
    @Test
    fun onePin_test64_selects_0point64() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .64"))) { listOf(pinOnBlock(100, 179)) }
        assertEquals(PinGate.SELECTED, g.pinGate)
        assertEquals("King Gonzales", g.fbName)
        assertEquals("0.64", g.grams)
    }

    // ONE REAL PIN .18 → 0.18g.
    @Test
    fun onePin_test18_selects_0point18() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .18"))) { listOf(pinOnBlock(100, 179)) }
        assertEquals(PinGate.SELECTED, g.pinGate)
        assertEquals("King Gonzales", g.fbName)
        assertEquals("0.18", g.grams)
    }

    // CONTROL — one real pin, a WHOLE number "Test 64" → stays 64g (the gate never divides integers).
    @Test
    fun onePin_test64whole_selects_64() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test 64"))) { listOf(pinOnBlock(100, 179)) }
        assertEquals(PinGate.SELECTED, g.pinGate)
        assertEquals("64", g.grams)
    }

    // MULTIPLE PINS → Needs Review (never auto-pick one of two), with the explicit state.
    @Test
    fun twoPins_needsReview_state() {
        val g = ScreenshotOcr.guessFrom(two) { listOf(pinOnBlock(100, 179), pinOnBlock(300, 379)) }
        assertEquals(PinGate.NEEDS_REVIEW, g.pinGate)
        assertNull(g.fbName)
    }

    // DETECTOR FAILURE FAILS CLOSED — the caller REQUESTS the gate but no detector is available
    // (templates failed to load on-device). Must be Waiting, NOT the positional bottom pick.
    @Test
    fun gateRequested_noDetector_failsClosedWaiting() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .64")), gateRequested = true, pinDetect = null)
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
    }

    // DETECTOR THROWS → fail closed to Waiting (never fall through to positional selection).
    @Test
    fun gateOn_detectorThrows_failsClosedWaiting() {
        val g = ScreenshotOcr.guessFrom(listOf(kName, claimAt("Test .64"))) { throw RuntimeException("detector boom") }
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
    }

    // BOTTOM/POSITIONAL FALLBACK WITH PIN GATE = REMOVED: two named blocks, gate requested, no
    // detector → Waiting, NOT the bottom block "Bella Reyes" that the old positional pick returned.
    @Test
    fun gateRequested_noDetector_twoBlocks_doesNotPickBottom() {
        val g = ScreenshotOcr.guessFrom(two, gateRequested = true, pinDetect = null)
        assertEquals(PinGate.WAITING, g.pinGate)
        assertNull(g.fbName)
    }

    // Regression guard: the UNGATED manual path is untouched — no pinGate, positional read as before.
    @Test
    fun ungated_manualPath_leavesPinGateNull() {
        val g = ScreenshotOcr.guessFrom(listOf(king, kingClaim))
        assertNull(g.pinGate)
        assertEquals("King Gonzales", g.fbName)
    }
}
