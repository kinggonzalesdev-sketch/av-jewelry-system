package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    // ================= REAL KING BITMAP (king_pinned_was_live.png, 720×1600) =================
    // Measured geometry of the five King comments on the actual "Was live" screen. The pin is found
    // purely from the real pixels via the multi-template detector — no PinMarker injection.
    private val kingImg by lazy { PinFixtures.load("king_pinned_was_live.png") }
    private val realTpls by lazy {
        listOf(PinFixtures.load("facebook_pin_badge.png"), PinFixtures.load("facebook_pin_badge_king.png"))
    }
    private val rk1 = OLine("King Gonzales", Box(88, 943, 250, 977)); private val rc1 = OLine(".66", Box(88, 980, 118, 1010))
    private val rk2 = OLine("King Gonzales", Box(88, 1036, 250, 1070)); private val rc2 = OLine(".77", Box(88, 1072, 118, 1102))
    private val rk3 = OLine("King Gonzales", Box(88, 1128, 250, 1162)); private val rc3 = OLine(".88", Box(88, 1164, 118, 1194))
    private val rk4 = OLine("King Gonzales", Box(88, 1220, 250, 1254)); private val rc4 = OLine(".99", Box(88, 1256, 118, 1286))
    private val rk5 = OLine("King Gonzales", Box(112, 1323, 272, 1357)); private val rc5 = OLine(".4", Box(88, 1358, 112, 1388))
    private val realScene = listOf(rk1, rc1, rk2, rc2, rk3, rc3, rk4, rc4, rk5, rc5)
    private val realNameBoxes = listOf(rk1, rk2, rk3, rk4, rk5).map { it.box }

    // REAL 1 — the detector finds EXACTLY ONE pin, on the bottom (.4) King avatar.
    @Test
    fun realKing_detectsExactlyOnePin_onBottomAvatar() {
        assertTrue("fixture must be present", javaClass.getResource("/pin-fixtures/king_pinned_was_live.png") != null)
        val pins = PinPixelDetector.detectPins(kingImg, realTpls, realNameBoxes)
        assertEquals("exactly one visible pin (the .4 block)", 1, pins.size)
        assertTrue("pin sits on the BOTTOM King avatar (y≈1357+)", pins[0].box.top >= 1340)
    }

    // REAL 2 — full pipeline over the real bitmap: guessFrom + real detector → King Gonzales / .4 / 0.4.
    @Test
    fun realKing_pipeline_selectsKingDotFour() {
        val g = ScreenshotOcr.guessFrom(realScene) { boxes ->
            PinPixelDetector.detectPins(kingImg, realTpls, boxes)
        }
        assertEquals("King Gonzales", g.fbName) // NOT "Name not read"
        assertEquals(".4", g.itemQuery)
        assertEquals("0.4", g.grams)
    }

    // REAL 3 — same at the LIVE stride (=2): still exactly one pin, still selects .4.
    @Test
    fun realKing_liveStride2_selectsKingDotFour() {
        val g = ScreenshotOcr.guessFrom(realScene) { boxes ->
            PinPixelDetector.detectPins(kingImg, realTpls, boxes, stride = 2)
        }
        assertEquals("King Gonzales", g.fbName)
        assertEquals(".4", g.itemQuery)
    }

    // REAL 4 — NO-PIN derived: mask ONLY the real pin badge, keep King Gonzales / .4 readable →
    //          WaitingForPin. Proves bottom position alone no longer authorizes Capture.
    @Test
    fun realKing_pinMasked_waiting() {
        val masked = PinFixtures.maskBox(kingImg, Box(52, 1352, 78, 1376)) // paint over the pin badge only
        val pins = PinPixelDetector.detectPins(masked, realTpls, realNameBoxes)
        assertEquals("no pin after masking", 0, pins.size)
        val g = ScreenshotOcr.guessFrom(realScene) { boxes ->
            PinPixelDetector.detectPins(masked, realTpls, boxes)
        }
        assertNull("Waiting for Pinned Comment (no auto-select)", g.fbName)
    }

    // REAL 5 — the four UNPINNED King comments never register a pin (same person, no badge) and the
    //          blue verified badges are not pins either.
    @Test
    fun realKing_unpinnedAndVerified_notPins() {
        val unpinnedOnly = PinPixelDetector.detectPins(kingImg, realTpls, listOf(rk1.box, rk2.box, rk3.box, rk4.box))
        assertEquals("no pins on the four unpinned King comments", 0, unpinnedOnly.size)
    }
}
