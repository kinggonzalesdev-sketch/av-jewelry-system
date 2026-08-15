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
}
