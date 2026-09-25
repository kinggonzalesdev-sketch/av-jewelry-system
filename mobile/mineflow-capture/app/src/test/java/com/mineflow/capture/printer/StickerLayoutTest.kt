package com.mineflow.capture.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * Sticker typography (Owner 2026-09-25): short month names, every line centered inside the 40 mm
 * label, and the customer name always on ONE line, sized to the printable width.
 *
 * The TSPL program is parsed back into its TEXT commands and each line is MEASURED in printer dots
 * (the built-in fonts are fixed-width: characters × cell width × multiplier), then checked against
 * the 320-dot label and its 16-dot side margins.
 */
class StickerLayoutTest {

    private data class Printed(val x: Int, val font: String, val xMul: Int, val yMul: Int, val text: String) {
        val width: Int get() = text.length * CELL_W.getValue(font) * xMul
        val leftGap: Int get() = x
        val rightGap: Int get() = LABEL_W - x - width
    }

    private fun tspl(s: StickerEncoder.Sticker): List<Printed> =
        String(StickerEncoder.encode(s, tspl = true), Charsets.US_ASCII).lines()
            .mapNotNull { TEXT.matchEntire(it.trim()) }
            .map { m -> m.groupValues.let { Printed(it[1].toInt(), it[3], it[4].toInt(), it[5].toInt(), it[6]) } }

    private fun sticker(name: String, date: String = "Sept 25, 2026") =
        StickerEncoder.Sticker(name, "11.5", 1, null, "6800", date)

    private fun assertCenteredInside(p: Printed) {
        assertTrue("'${p.text}' starts in the left margin (x=${p.x})", p.x >= MARGIN)
        assertTrue("'${p.text}' runs past the right margin (ends at ${p.x + p.width})", p.x + p.width <= LABEL_W - MARGIN)
        assertTrue("'${p.text}' is off-center (${p.leftGap} vs ${p.rightGap})", kotlin.math.abs(p.leftGap - p.rightGap) <= 1)
    }

    private fun onDay25(month: Int): java.util.Date =
        Calendar.getInstance(UTC).apply { clear(); set(2026, month, 25, 12, 0) }.time

    // ---- 1. Month names ------------------------------------------------------------------------

    @Test
    fun monthNames_areTheOwnersExactList() {
        val expected = listOf(
            "Jan 25, 2026", "Feb 25, 2026", "Mar 25, 2026", "Apr 25, 2026", "May 25, 2026", "June 25, 2026",
            "July 25, 2026", "Aug 25, 2026", "Sept 25, 2026", "Oct 25, 2026", "Nov 25, 2026", "Dec 25, 2026",
        )
        (0..11).forEach { assertEquals(expected[it], StickerEncoder.stickerDate(onDay25(it), UTC)) }
    }

    @Test
    fun dayAndYear_areKept() {
        val jan8 = Calendar.getInstance(UTC).apply { clear(); set(2026, Calendar.JANUARY, 8, 9, 0) }.time
        assertEquals("Jan 8, 2026", StickerEncoder.stickerDate(jan8, UTC))
        val dec31 = Calendar.getInstance(UTC).apply { clear(); set(2027, Calendar.DECEMBER, 31, 9, 0) }.time
        assertEquals("Dec 31, 2027", StickerEncoder.stickerDate(dec31, UTC))
    }

    @Test
    fun theDate_usesThePhonesTimeZone_asBefore() {
        // 5 PM UTC on Sept 24 is already Sept 25 in Manila — the day comes from the given zone.
        val instant = Calendar.getInstance(UTC).apply { clear(); set(2026, Calendar.SEPTEMBER, 24, 17, 0) }.time
        assertEquals("Sept 25, 2026", StickerEncoder.stickerDate(instant, TimeZone.getTimeZone("Asia/Manila")))
        assertEquals("Sept 24, 2026", StickerEncoder.stickerDate(instant, UTC))
    }

    @Test
    fun aDateLineFromTheWeb_isShortened_dayAndYearKept() {
        assertEquals("Sept 25, 2026", StickerEncoder.shortenMonth("September 25, 2026"))
        assertEquals("Jan 8, 2026", StickerEncoder.shortenMonth("January 8, 2026"))
        assertEquals("Aug 6, 2026", StickerEncoder.shortenMonth("August 6, 2026"))
        assertEquals("May 25, 2026", StickerEncoder.shortenMonth("May 25, 2026"))
        assertEquals("June 25, 2026", StickerEncoder.shortenMonth("June 25, 2026"))
        assertEquals("July 25, 2026", StickerEncoder.shortenMonth("July 25, 2026"))
        assertEquals("Sept 25, 2026", StickerEncoder.shortenMonth("Sept 25, 2026")) // already short
        assertEquals("25/09/2026", StickerEncoder.shortenMonth("25/09/2026"))       // not a month name
    }

    // ---- 2. Every date centered inside the label -----------------------------------------------

    @Test
    fun allTwelveDates_printOnOneLine_centered_insideTheLabel() {
        (0..11).forEach { m ->
            val date = StickerEncoder.stickerDate(onDay25(m), UTC)
            val lines = tspl(sticker("KING GONZALES", date))
            assertEquals("$date: name, grams, date", 3, lines.size)
            val d = lines.last()
            assertEquals(date, d.text)
            lines.forEach { assertCenteredInside(it) }
        }
    }

    @Test
    fun webOrderSticker_longDate_printsShort_andCentered() {
        val json = org.json.JSONArray()
            .put(org.json.JSONObject().put("text", "KING GONZALES").put("kind", "name"))
            .put(org.json.JSONObject().put("text", "11.5g • ₱6,800/g").put("kind", "pricePerGram"))
            .put(org.json.JSONObject().put("text", "September 25, 2026").put("kind", "date"))
        val out = String(StickerEncoder.encodeLines(json, tspl = true), Charsets.US_ASCII)
        assertTrue(out.contains("\"Sept 25, 2026\""))
        assertFalse(out.contains("September"))
    }

    // ---- 3. Customer name: one line, sized to fit ----------------------------------------------

    @Test
    fun theOwnersTestNames_eachPrintOnOneCenteredLine() {
        val expectFont = mapOf(
            "JEL" to "3",
            "KING GONZALES" to "3",
            "ANNAFAYE ENRIQUEZ" to "3",     // 17 characters: still the approved size
            "CATHERINE PETERSDORF" to "2",  // 20: slightly smaller
            "JAIMEE MARTIN ANCHETA" to "2", // 21: slightly smaller, still one line
        )
        expectFont.forEach { (name, font) ->
            val lines = tspl(sticker(name))
            assertEquals("$name: exactly 3 lines (no wrap)", 3, lines.size)
            val n = lines.first()
            assertEquals(name, n.text)
            assertEquals("$name font", font, n.font)
            lines.forEach { assertCenteredInside(it) }
        }
    }

    @Test
    fun sizeSteps_followThePrintedWidth() {
        // 18 characters × 16 dots = 288 = the printable width exactly: still the approved size.
        assertEquals("3", StickerEncoder.nameFit("ABCDEFGHI JKLMNOPQ").font)
        // One more character no longer fits at 16 dots: the next size down.
        assertEquals("2", StickerEncoder.nameFit("ABCDEFGHI JKLMNOPQR").font)
        // 25-36 characters: the minimum readable size (font 1 at double height, 8×24 dots).
        val long = StickerEncoder.nameFit("MARIA CRISTINA DELA CRUZ SANTOS") // 31
        assertEquals("1", long.font); assertEquals(1, long.xMul); assertEquals(2, long.yMul)
        assertTrue(long.fits)
        assertEquals("MARIA CRISTINA DELA CRUZ SANTOS", long.text)
    }

    @Test
    fun anExtremeName_staysOnOneLine_atTheMinimumSize_andIsReported() {
        val name = "MARIA CRISTINA ANGELICA DELA CRUZ SANTOS REYES" // 46 characters
        val fit = StickerEncoder.nameFit(name)
        assertFalse(fit.fits)                       // reported, not silently wrapped
        assertEquals("1", fit.font); assertEquals(2, fit.yMul) // never below the minimum size
        assertEquals("MARIA CRISTINA ANGELICA DELA CRUZ", fit.text) // whole words only
        assertTrue(fit.widthDots <= PRINTABLE)
        val lines = tspl(sticker(name))
        assertEquals(3, lines.size)
        lines.forEach { assertCenteredInside(it) }
    }

    // ---- 4. Grams / price line and Fixed Price unchanged -----------------------------------------

    @Test
    fun gramsLine_isUnchanged() {
        val g = tspl(StickerEncoder.fromCapture("KING GONZALES", "11.5", "6800"))[1]
        assertEquals("11.5g - P6,800/g", g.text) // "11.5g • ₱6,800/g" folded for the printer, as before
        assertEquals("3", g.font); assertEquals(1, g.xMul); assertEquals(1, g.yMul)
        assertCenteredInside(g)
    }

    @Test
    fun fixedPrice_getsTheSameImprovements_andStillNoPerGram() {
        val lines = tspl(StickerEncoder.fromCaptureFixed("JAIMEE MARTIN ANCHETA", "15000"))
        assertEquals(3, lines.size)
        assertEquals("JAIMEE MARTIN ANCHETA", lines[0].text)
        assertEquals("FIXED - P15,000", lines[1].text)
        assertEquals(StickerEncoder.today(), lines[2].text)
        assertFalse(lines.any { it.text.contains("/g") })
        lines.forEach { assertCenteredInside(it) }
    }

    // ---- 5. ESC/POS: the same rules ------------------------------------------------------------

    @Test
    fun escPos_name_oneLine_fontBOnlyWhenNeeded() {
        assertEquals("JAIMEE MARTIN ANCHETA" to false, StickerEncoder.escPosName("JAIMEE MARTIN ANCHETA")) // 21 ≤ 24
        assertEquals("MARIA CRISTINA DELA CRUZ SANTOS" to true, StickerEncoder.escPosName("MARIA CRISTINA DELA CRUZ SANTOS"))
        val (cut, small) = StickerEncoder.escPosName("MARIA CRISTINA ANGELICA DELA CRUZ SANTOS REYES")
        assertTrue(small)
        assertEquals("MARIA CRISTINA ANGELICA DELA", cut)
    }

    @Test
    fun escPos_sticker_hasThreeLines_shortDate_andSelectsFontBForALongName() {
        val esc = StickerEncoder.encode(sticker("MARIA CRISTINA DELA CRUZ SANTOS"), tspl = false)
        val text = String(esc, Charsets.US_ASCII)
        assertTrue(text.contains("MARIA CRISTINA DELA CRUZ SANTOS\n")) // whole name, then ONE line feed
        assertTrue(text.contains("Sept 25, 2026"))
        assertTrue(indexOf(esc, byteArrayOf(0x1b, 0x4d, 0x01)) >= 0) // ESC M 1 = Font B
        assertTrue(indexOf(esc, byteArrayOf(0x1b, 0x4d, 0x00)) >= 0) // back to Font A after the name
        val short = StickerEncoder.encode(sticker("KING GONZALES"), tspl = false)
        assertEquals(-1, indexOf(short, byteArrayOf(0x1b, 0x4d, 0x01)))
    }

    private fun indexOf(hay: ByteArray, needle: ByteArray): Int {
        outer@ for (i in 0..hay.size - needle.size) {
            for (j in needle.indices) if (hay[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }

    private companion object {
        const val LABEL_W = 320
        const val MARGIN = 16
        const val PRINTABLE = LABEL_W - MARGIN * 2
        val CELL_W = mapOf("1" to 8, "2" to 12, "3" to 16, "4" to 24)
        val TEXT = Regex("TEXT (\\d+),(\\d+),\"(\\d)\",0,(\\d+),(\\d+),\"(.*)\"")
        val UTC: TimeZone = TimeZone.getTimeZone("UTC")
    }
}
