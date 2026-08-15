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
}
