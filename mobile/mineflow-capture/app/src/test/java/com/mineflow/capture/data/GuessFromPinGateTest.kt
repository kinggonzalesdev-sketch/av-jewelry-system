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

    // 6 — gate ON, only the TOP block (A) is pinned while B is the positional pick → NO fallback to the
    //     unpinned B → null (the pin is authoritative; an unpinned bottom comment must not print).
    @Test
    fun gateOn_topPinnedBottomUnpinned_null() {
        val g = ScreenshotOcr.guessFrom(two) { listOf(pinOnBlock(100, 179)) }
        assertNull(g.fbName)
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
    }
}
