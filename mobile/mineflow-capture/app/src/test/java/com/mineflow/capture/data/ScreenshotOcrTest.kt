package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure-JVM tests for the PINNED-comment selection (no device / no ML Kit needed — we feed
 * the recognised lines + boxes directly to guessFrom). Layout mirrors the real FB Live
 * broadcaster screen the operator uses: scrolling "…is watching" bubbles above, the PINNED
 * comment (name then "Mine X") at the bottom.
 */
class ScreenshotOcrTest {

    /** One recognised line at vertical position `top`. All lines share an x-range so the only
     *  discriminator is VERTICAL position (name directly above its claim). */
    private fun line(text: String, top: Int) = OLine(text, Box(40, top, 400, top + 40))

    private fun pinnedGrams(claim: String): String? =
        ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line(claim, 900))).grams

    // Test 1 — the pinned name wins; an unrelated visible name is ignored.
    @Test
    fun test1_pinnedName_ignoresOtherVisibleName() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Andrea Dela Cruz is watching.", 100),
                line("Ulymay Alazne Pedericoc", 200), // visible elsewhere — NOT pinned
                line("Khim Escarez is watching.", 400),
                line("Chin Cha", 850), // pinned name (bottom)
                line("Mine 5.5", 900), // pinned claim, directly below
            ),
        )
        assertEquals("Chin Cha", g.fbName)
        assertEquals("5.5", g.grams)
    }

    // Test 2 — several claims visible; the PINNED (bottom-most) one is chosen, with ITS name.
    @Test
    fun test2_multipleClaims_picksBottomMostPinned() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Maria Reyes", 400),
                line("Mine 8.2", 450), // a scrolling claim (higher)
                line("Chin Cha", 850), // pinned (bottom)
                line("Mine 5.5", 900),
            ),
        )
        assertEquals("Chin Cha", g.fbName)
        assertEquals("5.5", g.grams)
    }

    // Test 4 — grams formats (Mine / M / bare / .5 / whole).
    @Test
    fun test4_gramsFormats() {
        assertEquals("10.5", pinnedGrams("Mine 10.5"))
        assertEquals("10.5", pinnedGrams("M 10.5"))
        assertEquals("10.5", pinnedGrams("10.5"))
        assertEquals("0.5", pinnedGrams(".5"))
        assertEquals("11", pinnedGrams("11"))
    }

    // Low confidence — a claim with no name-like line directly above it → needs review
    // (fbName null), never a guessed name. Grams are still kept.
    @Test
    fun lowConfidence_noNameAbove_needsReview() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Andrea Dela Cruz is watching.", 100), // filtered + far above
                line("Mine 5.5", 900),
            ),
        )
        assertNull(g.fbName)
        assertEquals("5.5", g.grams)
    }

    // The real layouts from the operator's screenshots (multi-word names, varied claims).
    @Test
    fun realLayouts_fromScreenshots() {
        fun run(name: String, claim: String): OcrGuess = ScreenshotOcr.guessFrom(
            listOf(
                line("Ericka Dilag De Dios is watching.", 100),
                line("Andrea Dela Cruz is watching.", 300),
                line("Khim Escarez is watching.", 500),
                line(name, 850),
                line(claim, 900),
            ),
        )
        run("Ericka Dilag De Dios", "Mine 2.33").let {
            assertEquals("Ericka Dilag De Dios", it.fbName); assertEquals("2.33", it.grams)
        }
        run("Khim Escarez", "Mine 8.60").let {
            assertEquals("Khim Escarez", it.fbName); assertEquals("8.6", it.grams)
        }
        run("Andrea Dela Cruz", "MINE 1.23").let {
            assertEquals("Andrea Dela Cruz", it.fbName); assertEquals("1.23", it.grams)
        }
    }

    // The VIEWER (customer) live layout from the attached screenshots: pinned comments with
    // TRAILING TEXT and unrelated question-comments above (incl. the real "Ulymay" case).
    @Test
    fun viewerLayout_trailingText_and_unrelatedComments() {
        // SS4: pinned "Elve Cano / 13.91"; "Ulymay Alazne Pedericos ..." is a normal question
        // above (no leading number) and must NOT be selected.
        val ss4 = ScreenshotOcr.guessFrom(
            listOf(
                line("Rodora Bellones Canete", 200),
                line("Madam bracelet na suot mo mam hardware", 250),
                line("Ulymay Alazne Pedericos", 350),
                line("anu po pendant na panlalaki meron kayu maam?", 400),
                line("Charvin BPagtakhan", 600),
                line("Mine type ko yung tri color maam ko hehhehe", 650),
                line("Elve Cano", 850),
                line("13.91", 900),
            ),
        )
        assertEquals("Elve Cano", ss4.fbName)
        assertEquals("13.91", ss4.grams)

        // SS2: "Mine 2.43g LV" — trailing "g LV" must not reject the claim.
        val ss2 = ScreenshotOcr.guessFrom(
            listOf(line("Lhean Elbanbuena", 850), line("Mine 2.43g LV", 900)),
        )
        assertEquals("Lhean Elbanbuena", ss2.fbName)
        assertEquals("2.43", ss2.grams)
        assertEquals("2.43", ss2.itemQuery)

        // SS5: "Mine 5.67 foxtail".
        val ss5 = ScreenshotOcr.guessFrom(
            listOf(line("Abby Gicain", 850), line("Mine 5.67 foxtail", 900)),
        )
        assertEquals("Abby Gicain", ss5.fbName)
        assertEquals("5.67", ss5.grams)

        // SS3: bare number "6.53".
        val ss3 = ScreenshotOcr.guessFrom(
            listOf(line("Divina Bose Madayam", 850), line("6.53", 900)),
        )
        assertEquals("Divina Bose Madayam", ss3.fbName)
        assertEquals("6.53", ss3.grams)
    }

    // Fixed-price pinned comments: the value is extracted (itemQuery) so the PC can price it,
    // but grams stays null (never a grams sticker on the phone). Name still from the block.
    @Test
    fun fixedPrice_valuesExtracted_gramsNull() {
        fun g(claim: String) =
            ScreenshotOcr.guessFrom(listOf(line("Buyer Name", 850), line(claim, 900)))
        g("Mine 12000").let { assertEquals("12000", it.itemQuery); assertNull(it.grams) }
        g("12,000").let { assertEquals("12,000", it.itemQuery); assertNull(it.grams) }
        g("12k").let { assertEquals("12k", it.itemQuery); assertNull(it.grams) }
        g("12.5k").let { assertEquals("12.5k", it.itemQuery); assertNull(it.grams) }
        g("12500").let { assertEquals("12500", it.itemQuery); assertNull(it.grams) }
        assertEquals("Buyer Name", g("Mine 12000").fbName)
    }

    // Owner acceptance grams matrix (2026-08-18): leading decimals normalized, keyword BEFORE
    // and AFTER the number, case-insensitive, numeric-only, "g" suffix — all from the pinned block.
    @Test
    fun acceptanceGramsMatrix_allFormats() {
        assertEquals("0.6", pinnedGrams(".6"))
        assertEquals("0.7", pinnedGrams(".7"))
        assertEquals("0.8", pinnedGrams(".8"))
        assertEquals("0.9", pinnedGrams(".9"))
        assertEquals("1.5", pinnedGrams("M 1.5"))
        assertEquals("1.5", pinnedGrams("Mine 1.5"))
        assertEquals("1.5", pinnedGrams("MINE 1.5"))
        assertEquals("1.5", pinnedGrams("mine 1.5"))
        assertEquals("1.5", pinnedGrams("1.5 M"))
        assertEquals("1.5", pinnedGrams("1.5 Mine"))
        assertEquals("1.5", pinnedGrams("1.5 mine"))
        assertEquals("1.5", pinnedGrams("1.5g"))
        assertEquals("1.5", pinnedGrams("1.5 g"))
        assertEquals("11", pinnedGrams("11"))
        assertEquals("10.5", pinnedGrams("10.5"))
        // keyword AFTER a leading-decimal, both orders:
        assertEquals("0.7", pinnedGrams("M .7"))
        assertEquals("0.7", pinnedGrams("Mine .7"))
        assertEquals("0.7", pinnedGrams(".7 M"))
        assertEquals("0.7", pinnedGrams(".7 Mine"))
    }

    // Name + grams come from the SAME pinned block.
    @Test
    fun acceptanceNameAndGrams_sameBlock() {
        val g = ScreenshotOcr.guessFrom(listOf(line("Juan Dela Cruz", 850), line("Mine .7", 900)))
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("0.7", g.grams)
    }

    // Facebook UI tab "Overview" sitting DIRECTLY above the claim must NOT become the printed
    // name — it is rejected → needs review (null), never a guessed identity. Grams still kept.
    @Test
    fun overviewDirectlyAboveClaim_isRejected_notPrinted() {
        val g = ScreenshotOcr.guessFrom(listOf(line("Overview", 860), line("Mine .7", 900)))
        assertNull(g.fbName)
        assertEquals("0.7", g.grams)
    }

    // With FB tab chrome AND a real pinned name on screen, the real name wins; tabs never do.
    @Test
    fun realNameWinsOverUiTabs() {
        val g = ScreenshotOcr.guessFrom(
            listOf(
                line("Overview", 815),
                line("Live chat", 835),
                line("Your replies", 850),
                line("Juan Dela Cruz", 862),
                line("11.5", 905),
            ),
        )
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("11.5", g.grams)
    }

    // Full-screen FALLBACK safety (minClaimTop = the pinned/bottom zone): a claim ABOVE the pinned
    // zone is NEVER used — the fallback must positively locate the pinned block in the bottom band,
    // else no local sticker data (needs review). A non-pinned/scrolling comment can't become data.
    @Test
    fun fullScreenFallback_rejectsClaimAbovePinnedZone() {
        val lines = listOf(line("Maria Reyes", 300), line("Mine 8.2", 350))
        val gated = ScreenshotOcr.guessFrom(lines, minClaimTop = 500)
        assertNull(gated.fbName)
        assertNull(gated.grams)
        // Prove the GATE is what blocks it: unconstrained (ROI-crop pass), the same block is used.
        val ungated = ScreenshotOcr.guessFrom(lines)
        assertEquals("Maria Reyes", ungated.fbName)
        assertEquals("8.2", ungated.grams)
    }

    @Test
    fun fullScreenFallback_usesPinnedZoneBlock() {
        val g = ScreenshotOcr.guessFrom(
            listOf(line("Juan Dela Cruz", 850), line("Mine .7", 900)),
            minClaimTop = 500,
        )
        assertEquals("Juan Dela Cruz", g.fbName)
        assertEquals("0.7", g.grams)
    }
}
