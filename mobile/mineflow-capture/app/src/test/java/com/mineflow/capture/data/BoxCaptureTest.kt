package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * BOX CAPTURE OCR validation (Owner 2026-09-02) — guessBox runs on the LOCKED box's crop only.
 * Exactly one name + one claim → Selected (print); anything else → Needs Review (no print), with a
 * specific reason. No pin, no positional pick. Decimal grammar preserved.
 */
class BoxCaptureTest {

    private fun line(text: String, top: Int) = OLine(text, Box(40, top, 400, top + 40))

    // ---- A/B/C: one name + one claim → Selected, decimals preserved --------------------------
    @Test
    fun A_valid_leadingDecimal_64() {
        val r = ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100), line(".64", 150)))
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("0.64", r.guess.grams)
    }

    @Test
    fun B_leadingDecimal_18() {
        val r = ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100), line(".18", 150)))
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("0.18", r.guess.grams)
    }

    @Test
    fun C_wholeNumber_stays_64() {
        val r = ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100), line("64", 150)))
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("64", r.guess.grams)
    }

    @Test
    fun mineSyntax_and_M_dot_and_wholeNumbers_preserved() {
        ScreenshotOcr.guessBox(listOf(line("Danica Dayoha", 100), line("Mine 2.3", 150))).let {
            assertEquals("Danica Dayoha", it.guess.fbName); assertEquals("2.3", it.guess.grams)
        }
        // M. 64 → 0.64 (existing fused-marker grammar), not 64.
        ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100), line("M. 64", 150))).let {
            assertEquals("0.64", it.guess.grams)
        }
        for (whole in listOf("18", "33", "55")) {
            ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100), line(whole, 150))).let {
                assertEquals(whole, it.guess.grams)
            }
        }
    }

    // ---- D: Fixed Price preserved (no fabricated grams) --------------------------------------
    @Test
    fun D_fixedPrice_keepsAmount_noGrams() {
        val r = ScreenshotOcr.guessBox(listOf(line("Ana Cruz", 100), line("15000", 150)))
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("Ana Cruz", r.guess.fbName)
        assertEquals("15000", r.guess.itemQuery)
        assertNull(r.guess.grams) // fixed price → grams stays null
    }

    // ---- E: two comment blocks in the box → Needs Review (never auto-pick) -------------------
    @Test
    fun E_twoCustomerBlocks_needsReview_noPrint() {
        val r = ScreenshotOcr.guessBox(
            listOf(
                line("King Gonzales", 100), line(".64", 150),
                line("Danica Dayoha", 250), line("Mine 2.3", 300),
            ),
        )
        assertEquals(BoxReview.MULTIPLE, r.review)
        assertNull(r.guess.fbName)
    }

    @Test
    fun twoDifferentClaims_oneName_needsReview() {
        val r = ScreenshotOcr.guessBox(
            listOf(line("King Gonzales", 100), line(".64", 150), line(".77", 200)),
        )
        assertEquals(BoxReview.MULTIPLE, r.review)
        assertNull(r.guess.fbName)
    }

    // ---- F: no name → NO_NAME, no print ------------------------------------------------------
    @Test
    fun F_noName_needsReview_noPrint() {
        val r = ScreenshotOcr.guessBox(listOf(line(".64", 150)))
        assertEquals(BoxReview.NO_NAME, r.review)
        assertNull(r.guess.fbName)
        assertNull(r.guess.grams)
    }

    // ---- G: no value → NO_CLAIM, no print ----------------------------------------------------
    @Test
    fun G_noClaim_needsReview_noPrint() {
        val r = ScreenshotOcr.guessBox(listOf(line("King Gonzales", 100)))
        assertEquals(BoxReview.NO_CLAIM, r.review)
        assertNull(r.guess.fbName)
    }

    @Test
    fun emptyBox_isEmptyReview() {
        assertEquals(BoxReview.EMPTY, ScreenshotOcr.guessBox(emptyList()).review)
    }

    // A duplicated identical comment (same name + same claim) is still ONE target → Selected.
    @Test
    fun duplicateIdenticalComment_stillSelected() {
        val r = ScreenshotOcr.guessBox(
            listOf(
                line("King Gonzales", 100), line("Mine .64", 150),
                line("King Gonzales", 250), line("Mine .64", 300),
            ),
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("0.64", r.guess.grams)
    }

    // A stray "Locked" overlay label must never become a name (belt-and-suspenders filter).
    @Test
    fun overlayLabel_isNotACustomer() {
        val r = ScreenshotOcr.guessBox(
            listOf(line("Locked", 60), line("King Gonzales", 100), line(".64", 150)),
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
    }
}
