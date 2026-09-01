package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner 2026-08-31 — WHY do pinned "King Gonzales" comments fail as "Name not read" while
 * Danica Dayoha / Glaiza Sale Galang succeed? Pure-JVM reproduction of the reported layout
 * (stacked same-name comments, a verified badge near the name/avatar, one real pin, leading-decimal
 * claims). The pin detector is injected as a lambda so the whole selection path is exercised without
 * pixels. These fixtures LOCATE the exact stage where the name is lost — no decimal-parser change,
 * no name-specific hardcoding.
 *
 * Box convention (matches GuessFromPinGateTest): a name/claim starts at x=95, so the avatar sits in
 * x[0,95); a pin marker at x[65,95] over the block's vertical span overlaps that avatar.
 */
class KingNameFailureTest {

    private fun n(t: String, top: Int) = OLine(t, Box(95, top, 320, top + 40))
    private fun c(t: String, top: Int) = OLine(t, Box(95, top, 230, top + 34))
    private fun pin(top: Int, bottom: Int) = PinMarker(Box(65, top + 10, 95, bottom), 0.9)

    // ---- OBJECTIVE 3: repeated same-name comments, one pinned -> pinned block ONLY ----
    @Test
    fun stackedKing_onePinBottom_selectsPinnedBlockOnly() {
        val lines = listOf(
            n("King Gonzales", 100), c(".22", 145),
            n("King Gonzales", 195), c(".33", 240),
            n("King Gonzales", 290), c(".44", 335),
            n("King Gonzales", 385), c(".55", 430),
            n("King Gonzales", 480), c(".23", 525),
        )
        val g = ScreenshotOcr.guessFrom(lines) { listOf(pin(480, 525)) }
        assertEquals(PinGate.SELECTED, g.pinGate)
        assertEquals("King Gonzales", g.fbName)
        assertEquals("0.23", g.grams)
    }

    // ---- REQUIRED REGRESSION CASES 1 & 2: verified King + one real pin ----
    @Test
    fun king_pin_leadingDecimal_23() {
        val g = ScreenshotOcr.guessFrom(listOf(n("King Gonzales", 480), c(".23", 525))) { listOf(pin(480, 525)) }
        assertEquals("King Gonzales", g.fbName); assertEquals("0.23", g.grams)
    }

    @Test
    fun king_pin_leadingDecimal_64() {
        val g = ScreenshotOcr.guessFrom(listOf(n("King Gonzales", 480), c(".64", 525))) { listOf(pin(480, 525)) }
        assertEquals("King Gonzales", g.fbName); assertEquals("0.64", g.grams)
    }

    // ---- REQUIRED REGRESSION CASE 4: verified badge WITHOUT a real pin -> Waiting ----
    @Test
    fun king_noPin_waitingForPin() {
        val g = ScreenshotOcr.guessFrom(listOf(n("King Gonzales", 480), c(".23", 525))) { emptyList() }
        assertEquals(PinGate.WAITING, g.pinGate); assertNull(g.fbName)
    }

    // ---- REQUIRED REGRESSION CASES 6 & 7: the working controls ----
    @Test
    fun danica_pin_works() {
        val g = ScreenshotOcr.guessFrom(listOf(n("Danica Dayoha", 480), c("Mine 2.3", 525))) { listOf(pin(480, 525)) }
        assertEquals("Danica Dayoha", g.fbName); assertEquals("2.3", g.grams)
    }

    @Test
    fun glaiza_pin_works() {
        val g = ScreenshotOcr.guessFrom(listOf(n("Glaiza Sale Galang", 480), c("Mine 8.6", 525))) { listOf(pin(480, 525)) }
        assertEquals("Glaiza Sale Galang", g.fbName); assertEquals("8.6", g.grams)
    }

    // ==== DIAGNOSTICS — which OCR anomaly loses the name? (documents current behavior) ====

    // H — the verified badge OCR'd as a trailing DIGIT fused to the name ("King Gonzales 0"):
    // parseClaim(name) != null, so the line is EXCLUDED from name candidates -> Name not read.
    @Test
    fun diag_badgeAsDigit_dropsName() {
        val g = ScreenshotOcr.guessFrom(listOf(n("King Gonzales 0", 480), c(".23", 525))) { listOf(pin(480, 525)) }
        assertNull(g.fbName) // DOCUMENTS: digit fused to the name -> dropped -> "Name not read"
    }

    // I — the badge OCR'd as a trailing LETTER ("King Gonzales O"): the name IS read (wrong), so this
    // is a Facebook-MATCH failure ("No Facebook match"), NOT a "Name not read".
    @Test
    fun diag_badgeAsLetter_readsWrongName() {
        val g = ScreenshotOcr.guessFrom(listOf(n("King Gonzales O", 480), c(".23", 525))) { listOf(pin(480, 525)) }
        assertNotNull(g.fbName)
    }

    // J — the badge OCR'd as a SEPARATE tiny line to the right of the name: filtered out, clean name survives.
    @Test
    fun diag_badgeSeparateLine_nameSurvives() {
        val g = ScreenshotOcr.guessFrom(
            listOf(n("King Gonzales", 480), OLine("0", Box(325, 480, 345, 510)), c(".23", 525)),
        ) { listOf(pin(480, 525)) }
        assertEquals("King Gonzales", g.fbName); assertEquals("0.23", g.grams)
    }

    // K — OCR SPLITS the name onto two lines ("King" / "Gonzales") stacked at the avatar: the pin can
    // overlap both, or only a partial name is taken -> documents split-name behavior.
    @Test
    fun diag_nameSplit_behavior() {
        val g = ScreenshotOcr.guessFrom(
            listOf(n("King", 470), n("Gonzales", 480), c(".23", 525)),
        ) { listOf(pin(470, 525)) }
        assertTrue(g.pinGate == PinGate.SELECTED || g.pinGate == PinGate.NEEDS_REVIEW)
    }
}
