package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Owner 2026-08-29 — the physical "Was live" reproduction: FIVE `King Gonzales` comments stacked
 * (.66/.77/.88/.99 unpinned, bottom `.4` PINNED). MineFlow physically returned "Name not read / Needs
 * Review" instead of the pinned `.4`. Root cause: the competing-comment guard + positional pick ran
 * BEFORE the pin locked the block, so the four unpinned same-customer comments contested the pinned
 * one. The fix routes the gated path through pinLockedGuess FIRST — the pin is the sole authority and
 * unpinned comments are out of scope.
 *
 * These use synthetic OLines mirroring the screen geometry (ML Kit cannot run in a JVM unit test); the
 * REAL-bitmap regression at the bottom auto-runs once king_pinned_was_live.png is added to fixtures.
 */
class KingStackedPinTest {

    private fun king(top: Int) = OLine("King Gonzales", Box(90, top, 270, top + 34))
    private fun claim(text: String, top: Int) = OLine(text, Box(90, top, 130, top + 30))

    private val k1 = king(948); private val c1 = claim(".66", 985)
    private val k2 = king(1040); private val c2 = claim(".77", 1077)
    private val k3 = king(1132); private val c3 = claim(".88", 1169)
    private val k4 = king(1224); private val c4 = claim(".99", 1261)
    private val k5 = king(1325); private val c5 = claim(".4", 1362) // PINNED (bottom)
    private val scene = listOf(k1, c1, k2, c2, k3, c3, k4, c4, k5, c5)

    // Pin marker on the BOTTOM King's avatar (the square immediately LEFT of the name — see
    // PinnedCommentSelector.avatarRegionFor — pin overlaps its lower-right).
    private val bottomPin = PinMarker(Box(58, 1368, 88, 1392), 0.9)

    // 1 — REQUIRED physical result: pinned `.4` selected; name read; grams 0.4; unpinned excluded.
    @Test
    fun stackedKing_bottomPinned_selectsDotFour() {
        val g = ScreenshotOcr.guessFrom(scene) { listOf(bottomPin) }
        assertEquals("King Gonzales", g.fbName) // NOT "Name not read"
        assertEquals(".4", g.itemQuery)
        assertEquals("0.4", g.grams) // leading-decimal preserved (.4 → 0.4), not fabricated
    }

    // 2 — the four unpinned .66/.77/.88/.99 must NOT trigger competing-comment Needs Review.
    @Test
    fun stackedKing_unpinnedDoNotCompete() {
        val g = ScreenshotOcr.guessFrom(scene) { listOf(bottomPin) }
        assertTrue("must not be Needs Review from unpinned comments", g.fbName != null && g.itemQuery == ".4")
    }

    // 3 — NO pin anywhere → Waiting (must NOT pick the readable bottom `.4` by position).
    @Test
    fun stackedKing_noPin_waiting() {
        val g = ScreenshotOcr.guessFrom(scene) { emptyList() }
        assertNull(g.fbName)
        assertNull(g.grams)
    }

    // 4 — the blue verified/check badge sits to the RIGHT of the name, never on the avatar's lower-
    //     right; a strong marker there must NOT authorize capture (geometry rejects verified badges).
    @Test
    fun verifiedBadgePosition_notAPin_waiting() {
        val verified = PinMarker(Box(278, 1330, 300, 1352), 0.95) // right of "King Gonzales"
        val g = ScreenshotOcr.guessFrom(scene) { listOf(verified) }
        assertNull(g.fbName)
    }

    // 5 — a pin on an UPPER unpinned block would select THAT block (pin authority > position). Here we
    //     also confirm the pinned bottom stays selected even with the full unpinned stack present.
    @Test
    fun stackedKing_onlyBottomPinned_bottomWins() {
        val g = ScreenshotOcr.guessFrom(scene) { boxes ->
            // emulate the detector: a pin only where the bottom King's avatar is
            if (boxes.any { it.top >= 1325 }) listOf(bottomPin) else emptyList()
        }
        assertEquals("King Gonzales", g.fbName)
        assertEquals(".4", g.itemQuery)
    }

    // REAL-BITMAP regression — auto-skips until the Owner adds king_pinned_was_live.png. Proves a real
    // visible pin badge exists + is detectable on the King `.4` block of the actual "Was live" screen,
    // scanning the bottom-left comment column (no exact name boxes needed).
    @Test
    fun realKingBitmap_hasDetectablePin() {
        val present = javaClass.getResource("/pin-fixtures/king_pinned_was_live.png") != null
        assumeTrue("king_pinned_was_live.png not in fixtures yet — real-bitmap regression skipped", present)
        val img = PinFixtures.load("king_pinned_was_live.png")
        val tpl = PinFixtures.load("facebook_pin_badge.png")
        // Bottom-left comment column, bottom ~30% of the screen, where the avatars/pins sit.
        val roi = Box(0, (img.height * 0.7).toInt(), (img.width * 0.18).toInt(), img.height)
        val m = PinPixelDetector.bestMatchIn(img, tpl, roi, PinPixelDetector.DEFAULT_SCALES, stride = 1)
        assertTrue(
            "expected a confident pin in the bottom-left comment column (got ${m?.score})",
            (m?.score ?: -1.0) >= PinPixelDetector.DEFAULT_THRESHOLD,
        )
    }
}
