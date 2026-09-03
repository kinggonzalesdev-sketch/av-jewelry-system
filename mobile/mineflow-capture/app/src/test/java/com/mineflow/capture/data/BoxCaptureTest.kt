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
    private fun lineAt(text: String, left: Int, top: Int, right: Int, bottom: Int) =
        OLine(text, Box(left, top, right, bottom))

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

    // Owner 2026-09-02 "prefer name-associated claim": a number STACKED below the value line (a comment
    // timestamp / actions row) is NOT the buyer's value — take the claim directly below the name.
    @Test
    fun stackedNumbers_pickValueDirectlyBelowName() {
        val r = ScreenshotOcr.guessBox(
            listOf(line("King Gonzales", 100), line(".64", 150), line(".77", 200)),
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("0.64", r.guess.grams) // the value directly below the name, not the one further down
    }

    // THE PHYSICAL BUG (2026-09-02): "King Gonzales" / "44" / "2.01"(a 2:01 timestamp OCR'd with a dot).
    // The timestamp must NOT create a false MULTIPLE — the value directly below the name (44) is taken.
    @Test
    fun timestampBelowValue_isIgnored_notMultiple() {
        val r = ScreenshotOcr.guessBox(
            listOf(line("King Gonzales", 100), line("44", 150), line("2.01", 200)),
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("44", r.guess.grams)
    }

    // Two DIFFERENT values on essentially the SAME row (side by side) is genuinely ambiguous → review.
    @Test
    fun sameRowTwoValues_needsReview() {
        val r = ScreenshotOcr.guessBox(
            listOf(
                line("King Gonzales", 100),
                lineAt(".64", 40, 150, 120, 190),
                lineAt(".77", 220, 150, 300, 190),
            ),
        )
        assertEquals(BoxReview.MULTIPLE, r.review)
        assertNull(r.guess.fbName)
    }

    // ---- STEP 5 edge-clipping guard (crop dims supplied) -------------------------------------
    // A name whose bbox is flush against the crop's RIGHT edge is probably truncated ("King Gon") →
    // CLIPPED, never auto-printed.
    @Test
    fun nameHuggingRightEdge_isClipped() {
        val r = ScreenshotOcr.guessBox(
            listOf(lineAt("King Gonzales", 40, 100, 500, 140), lineAt("64", 40, 150, 120, 190)),
            cropW = 500, cropH = 300,
        )
        assertEquals(BoxReview.CLIPPED, r.review)
        assertNull(r.guess.fbName)
    }

    // A bare whole-integer value flush against the crop's LEFT edge may have lost a clipped leading
    // decimal (".44" read as "44") → CLIPPED, never auto-print a possibly-wrong 44g.
    @Test
    fun bareIntegerHuggingLeftEdge_isClipped() {
        val r = ScreenshotOcr.guessBox(
            listOf(lineAt("King Gonzales", 120, 100, 360, 140), lineAt("44", 0, 150, 60, 190)),
            cropW = 500, cropH = 300,
        )
        assertEquals(BoxReview.CLIPPED, r.review)
    }

    // A clean name + value with comfortable margins on all sides prints normally (no false clip). A
    // whole-number value away from the left edge is NOT treated as a clipped decimal — it prints as-is.
    @Test
    fun comfortableMargins_notClipped_printsWhole() {
        val r = ScreenshotOcr.guessBox(
            listOf(lineAt("King Gonzales", 40, 100, 300, 140), lineAt("44", 40, 150, 120, 190)),
            cropW = 500, cropH = 300,
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("44", r.guess.grams)
    }

    // A genuine leading decimal away from the edge still prints (decimal grammar preserved, no clip).
    @Test
    fun leadingDecimalWithMargin_printsDecimal() {
        val r = ScreenshotOcr.guessBox(
            listOf(lineAt("King Gonzales", 40, 100, 300, 140), lineAt(".44", 40, 150, 120, 190)),
            cropW = 500, cropH = 300,
        )
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("0.44", r.guess.grams)
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

    // ---- Facebook verification-BADGE artifact (Owner 2026-09-03) ------------------------------
    // The blue badge to the LEFT of the name is sometimes OCR'd as a lone leading "O"/"0". It is stripped
    // ONLY on a lone glyph + space at the extreme LEFT — real O/0-names (fused) are NEVER touched.
    private fun nameAtLeft(text: String) = OLine(text, Box(2, 100, 360, 140))

    @Test // CASE A — badge excluded before OCR (clean name)
    fun A_verified_cleanName() {
        val r = ScreenshotOcr.guessBox(listOf(nameAtLeft("King Gonzales"), lineAt(".55", 2, 150, 120, 190)), 500, 300)
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("0.55", r.guess.grams)
    }

    @Test // CASE B — "O King Gonzales" at the extreme left → King Gonzales
    fun B_badgeO_stripped() {
        val r = ScreenshotOcr.guessBox(listOf(nameAtLeft("O King Gonzales"), lineAt(".55", 2, 150, 120, 190)), 500, 300)
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
        assertEquals("0.55", r.guess.grams)
    }

    @Test // CASE C — "0 King Gonzales" (zero) at the extreme left → King Gonzales
    fun C_badgeZero_stripped() {
        val r = ScreenshotOcr.guessBox(listOf(nameAtLeft("0 King Gonzales"), lineAt(".55", 2, 150, 120, 190)), 500, 300)
        assertEquals(BoxReview.NONE, r.review)
        assertEquals("King Gonzales", r.guess.fbName)
    }

    @Test // CASE D/E/F — real O-names are NEVER stripped (fused, no space)
    fun DEF_realONames_preserved() {
        for (n in listOf("Olivia Santos", "Oscar Reyes", "Ocampo Maria")) {
            val r = ScreenshotOcr.guessBox(listOf(nameAtLeft(n), lineAt(".55", 2, 150, 120, 190)), 500, 300)
            assertEquals(n, r.guess.fbName)
        }
    }

    // A lone "O <Name>" that is NOT at the extreme left (no icon-zone evidence) is left alone.
    @Test
    fun badgeGlyph_awayFromLeftEdge_notStripped() {
        // name box far from the left (left=300) → no spatial evidence → keep as-is.
        val r = ScreenshotOcr.guessBox(
            listOf(OLine("O King Gonzales", Box(300, 100, 620, 140)), lineAt(".55", 300, 150, 420, 190)),
            700, 300,
        )
        assertEquals("O King Gonzales", r.guess.fbName)
    }
}
