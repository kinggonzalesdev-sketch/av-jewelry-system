package com.mineflow.capture.printer

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure-JVM tests for the sticker formatter — grams normalization (incl. leading decimals)
 *  and the approved 3-line capture sticker (Name · grams•₱rate/g · date; no item name). */
class StickerEncoderTest {

    @Test
    fun normalizeGrams_leadingDecimalsAndTrailingZeros() {
        assertEquals("0.7", StickerEncoder.normalizeGrams(".7")) // was the ".7"->"7" bug
        assertEquals("0.6", StickerEncoder.normalizeGrams("0.60"))
        assertEquals("11.5", StickerEncoder.normalizeGrams("11.50"))
        assertEquals("11", StickerEncoder.normalizeGrams("11"))
        assertEquals("10.5", StickerEncoder.normalizeGrams("10.5"))
        assertEquals("20", StickerEncoder.normalizeGrams("20.0"))
        assertNull(StickerEncoder.normalizeGrams(null))
        assertNull(StickerEncoder.normalizeGrams(""))
        assertNull(StickerEncoder.normalizeGrams("abc"))
    }

    @Test
    fun fromCapture_normalizesGrams_noItemName() {
        val s = StickerEncoder.fromCapture("KING GONZALES", ".7", "7100")
        assertEquals("KING GONZALES", s.customerName)
        assertEquals("0.7", s.grams) // normalized before print → "0.7g"
        assertEquals("7100", s.pricePerGram)
        assertNull(s.unitPrice) // no item price on the capture sticker
    }

    @Test
    fun encode_containsNameGramsRate_noItemOrderInvoice() {
        val s = StickerEncoder.fromCapture("KING GONZALES", "11.5", "7100")
        val out = String(StickerEncoder.encode(s, tspl = true), Charsets.US_ASCII)
        assertTrue(out.contains("KING GONZALES"))
        assertTrue(out.contains("11.5g"))
        assertTrue(out.contains("7,100/g")) // ₱ asciified to P; comma-grouped
    }

    // ---- Test Print parity: the Test Print is the REAL capture sticker, never a hardcoded
    //      "A.V. Jewelry / TEST PRINT" template. -------------------------------------------------
    @Test
    fun sampleSticker_usesConfiguredRateNameGramsAndLocalDate() {
        val s = StickerEncoder.sampleSticker("7100")
        assertEquals("KING GONZALES", s.customerName) // TEST PRINT NAME
        assertEquals("11.5", s.grams)                 // TEST PRINT GRAMS
        assertEquals("7100", s.pricePerGram)          // TEST PRINT PRICE/G = configured local rate
        assertEquals(StickerEncoder.today(), s.date)  // TEST PRINT DATE = Android current local date
    }

    @Test
    fun testPrint_encodesRealSticker_notHardcodedTemplate() {
        val tspl = String(StickerEncoder.encode(StickerEncoder.sampleSticker("7100"), tspl = true), Charsets.US_ASCII)
        assertTrue(tspl.contains("KING GONZALES"))
        assertTrue(tspl.contains("11.5g"))
        assertTrue(tspl.contains("7,100/g"))               // configured price/g (₱ → P)
        assertTrue(tspl.contains(StickerEncoder.today()))  // current local date
        assertFalse(tspl.contains("A.V. Jewelry"))         // old hardcode gone
        assertFalse(tspl.contains("TEST PRINT"))           // old hardcode gone

        // ESC/POS path too — no hardcoded template there either.
        val esc = String(StickerEncoder.encode(StickerEncoder.sampleSticker("7100"), tspl = false), Charsets.US_ASCII)
        assertTrue(esc.contains("KING GONZALES"))
        assertFalse(esc.contains("A.V. Jewelry"))
        assertFalse(esc.contains("TEST PRINT"))
    }

    @Test
    fun testPrint_usesSameFormatterAsActualCapture() {
        val rate = "7100"
        val viaTestPrint = StickerEncoder.encode(StickerEncoder.sampleSticker(rate), tspl = true)
        val viaCapture = StickerEncoder.encode(
            StickerEncoder.fromCapture("KING GONZALES", "11.5", rate), tspl = true,
        )
        // Byte-identical → the Test Print and a real capture sticker share one formatter/layout.
        assertArrayEquals(viaCapture, viaTestPrint)
    }

    // ---- Actual-capture grams+price regression (Owner 2026-08-21) --------------------------------
    // The capture sticker must show "GRAMS • ₱RATE/g" using the CONFIGURED rate (₱ → P, • → - after
    // ASCII folding for the thermal codepage). The rate now mirrors the saved web Sticker Settings
    // (synced into the phone's local cache); these prove the formatter given that rate.

    // 1 — grams capture with the configured rate 6800.
    @Test
    fun capture_grams_withRate6800_showsGramsAndPerGram() {
        val out = String(
            StickerEncoder.encode(StickerEncoder.fromCapture("KING GONZALES", "11.5", "6800"), tspl = true),
            Charsets.US_ASCII,
        )
        assertTrue(out.contains("KING GONZALES"))
        assertTrue(out.contains("11.5g - P6,800/g")) // "11.5g • ₱6,800/g" asciified, one line
    }

    // 2 — leading decimal .45 → 0.45g • ₱6,800/g.
    @Test
    fun capture_leadingDecimal045_withRate() {
        val out = String(
            StickerEncoder.encode(StickerEncoder.fromCapture("KING GONZALES", ".45", "6800"), tspl = true),
            Charsets.US_ASCII,
        )
        assertTrue(out.contains("0.45g - P6,800/g"))
    }

    // 3 — a DIFFERENT configured rate renders that rate (not a hardcoded 6800).
    @Test
    fun capture_differentConfiguredRate7500() {
        val out = String(
            StickerEncoder.encode(StickerEncoder.fromCapture("KING GONZALES", "11.5", "7500"), tspl = true),
            Charsets.US_ASCII,
        )
        assertTrue(out.contains("11.5g - P7,500/g"))
        assertFalse(out.contains("6,800"))
    }

    // 4 — a fixed-price capture never reaches the phone encoder (maybePrintDirect requires grams);
    //     even so, fromCapture(name, grams=null, rate) prints ONLY the per-gram rate line — it never
    //     invents a weight ("Ng") and never mislabels a fixed price with "/g".
    @Test
    fun capture_noGrams_neverFabricatesGramsOrCombinedLine() {
        val s = StickerEncoder.fromCapture("KING GONZALES", null, "6800")
        assertNull(s.grams)
        val out = String(StickerEncoder.encode(s, tspl = true), Charsets.US_ASCII)
        assertFalse(out.contains("null"))
        assertFalse(out.contains("g - P")) // no "<grams>g • ₱rate/g" combined line without a weight
    }

    // 5 — missing / unreadable grams is never invented.
    @Test
    fun capture_missingGrams_doesNotInventGrams() {
        assertNull(StickerEncoder.fromCapture("KING GONZALES", null, "6800").grams)
        assertNull(StickerEncoder.fromCapture("KING GONZALES", "", "6800").grams)
        assertNull(StickerEncoder.normalizeGrams("abc"))
    }

    // 6 — Test Print and an actual capture are byte-identical at the configured rate 6800.
    @Test
    fun capture_and_testPrint_identicalAt6800() {
        val cap = StickerEncoder.encode(StickerEncoder.fromCapture("KING GONZALES", "11.5", "6800"), tspl = true)
        val test = StickerEncoder.encode(StickerEncoder.sampleSticker("6800"), tspl = true)
        assertArrayEquals(cap, test)
    }

    // ---- Fixed Price: RAW-token classification decided BEFORE any grams extraction (Owner 2026-08-21)
    //      k / ₱ / P / PHP / thousands-comma / bare-integer>=1000 → FIXED; decimals & <=999 → GRAMS.

    @Test
    fun fixedPricePeso_kSuffix() {
        assertEquals("15000", StickerEncoder.fixedPricePeso("15k"))
        assertEquals("15000", StickerEncoder.fixedPricePeso("15K"))
        assertEquals("16200", StickerEncoder.fixedPricePeso("16.2k"))
        assertEquals("1000", StickerEncoder.fixedPricePeso("1k"))
    }

    @Test
    fun fixedPricePeso_currencyMarker() {
        assertEquals("15000", StickerEncoder.fixedPricePeso("₱15000"))
        assertEquals("15000", StickerEncoder.fixedPricePeso("₱15,000"))
        assertEquals("15000", StickerEncoder.fixedPricePeso("P15000"))
        assertEquals("15000", StickerEncoder.fixedPricePeso("PHP 15000"))
    }

    @Test
    fun fixedPricePeso_thousandsComma() {
        assertEquals("15000", StickerEncoder.fixedPricePeso("15,000"))
        assertEquals("16234", StickerEncoder.fixedPricePeso("16,234"))
        assertEquals("1000", StickerEncoder.fixedPricePeso("1,000"))
    }

    @Test
    fun fixedPricePeso_bareIntegerAtLeast1000() {
        assertEquals("1000", StickerEncoder.fixedPricePeso("1000"))
        assertEquals("15000", StickerEncoder.fixedPricePeso("15000"))
        assertEquals("16234", StickerEncoder.fixedPricePeso("16234"))
    }

    @Test
    fun fixedPricePeso_weightsAndJunkAreNotFixed() {
        assertNull(StickerEncoder.fixedPricePeso(".45"))
        assertNull(StickerEncoder.fixedPricePeso(".7"))
        assertNull(StickerEncoder.fixedPricePeso("1.5"))
        assertNull(StickerEncoder.fixedPricePeso("11.5"))
        assertNull(StickerEncoder.fixedPricePeso("500"))       // bare <=999 → grams, not fixed
        assertNull(StickerEncoder.fixedPricePeso("200 stars")) // banner junk → never a price
        assertNull(StickerEncoder.fixedPricePeso(null))
        assertNull(StickerEncoder.fixedPricePeso(""))
    }

    // fromCaptureAuto: the RAW value decides FIXED vs GRAMS; neither → null (skip / needs review).
    @Test
    fun fromCaptureAuto_classifiesFixedVsGrams() {
        StickerEncoder.fromCaptureAuto("King Gonzales", null, "15k", "6800").let {
            assertEquals("15000", it!!.fixedPrice); assertNull(it.grams)
        }
        StickerEncoder.fromCaptureAuto("King Gonzales", null, "16234", "6800").let {
            assertEquals("16234", it!!.fixedPrice)
        }
        StickerEncoder.fromCaptureAuto("King Gonzales", "11.5", "11.5", "6800").let {
            assertNull(it!!.fixedPrice); assertEquals("11.5", it.grams); assertEquals("6800", it.pricePerGram)
        }
        assertNull(StickerEncoder.fromCaptureAuto("King Gonzales", null, "200 stars", "6800"))
        assertNull(StickerEncoder.fromCaptureAuto("King Gonzales", null, null, "6800"))
    }

    // Encoded FIXED sticker = "FIXED • ₱X" (asciified "FIXED - PX") and NEVER "/g".
    @Test
    fun encode_fixedPrice_showsFixed_neverPerGram() {
        fun fixed(v: String) = String(
            StickerEncoder.encode(StickerEncoder.fromCaptureAuto("KING GONZALES", null, v, "6800")!!, tspl = true),
            Charsets.US_ASCII,
        )
        // 15000 / 15k / 15,000 all render the SAME fixed sticker; 16.2k / 16234 / 1000 too.
        listOf("15000", "15k", "15,000", "₱15,000", "P15000", "PHP 15000").forEach {
            assertTrue("$it → FIXED - P15,000", fixed(it).contains("FIXED - P15,000"))
            assertFalse("$it has /g", fixed(it).contains("/g"))
        }
        assertTrue(fixed("16.2k").contains("FIXED - P16,200"))
        assertTrue(fixed("16234").contains("FIXED - P16,234"))
        assertTrue(fixed("1000").contains("FIXED - P1,000"))
        assertTrue(fixed("1k").contains("FIXED - P1,000"))
    }

    // Grams sticker still uses the CURRENT locally saved rate (unchanged path).
    @Test
    fun grams_sticker_stillUsesSavedRate() {
        val out = String(
            StickerEncoder.encode(StickerEncoder.fromCaptureAuto("KING GONZALES", "11.5", "11.5", "7000")!!, tspl = true),
            Charsets.US_ASCII,
        )
        assertTrue(out.contains("11.5g - P7,000/g"))
        assertFalse(out.contains("FIXED"))
    }

    // ---- ORDER_STICKER native path (Owner 2026-09-07, staged cutover): the phone lays out the
    //      web's AUTHORITATIVE pre-rendered Order sticker lines with the SAME engine — reproducing
    //      the EXACT web Order sticker, never recomputing values on-device. -------------------------

    private fun line(text: String, kind: String) =
        org.json.JSONObject().put("text", text).put("kind", kind)

    @Test
    fun encodeLines_grams_reproducesCaptureEngineByteForByte() {
        val lines = org.json.JSONArray()
            .put(line("KING GONZALES", "name"))
            .put(line("11.5g • ₱7,100/g", "pricePerGram"))
            .put(line(StickerEncoder.today(), "date"))
        val viaLines = String(StickerEncoder.encodeLines(lines, tspl = true), Charsets.US_ASCII)
        assertTrue(viaLines.contains("KING GONZALES"))
        assertTrue(viaLines.contains("11.5g - P7,100/g")) // asciified for the thermal codepage
        // Byte-identical to the structured sticker with the same content → ONE shared layout engine,
        // so an Order sticker matches the approved capture/label sticker exactly.
        assertArrayEquals(
            StickerEncoder.encode(StickerEncoder.fromCapture("KING GONZALES", "11.5", "7100"), tspl = true),
            StickerEncoder.encodeLines(lines, tspl = true),
        )
    }

    @Test
    fun encodeLines_fixedPriceOrderSticker_showsFixed_neverPerGram() {
        val lines = org.json.JSONArray()
            .put(line("MARIA SANTOS", "name"))
            .put(line("FIXED • ₱15,000", "pricePerGram"))
            .put(line(StickerEncoder.today(), "date"))
        val out = String(StickerEncoder.encodeLines(lines, tspl = true), Charsets.US_ASCII)
        assertTrue(out.contains("MARIA SANTOS"))
        assertTrue(out.contains("FIXED - P15,000"))
        assertFalse(out.contains("/g"))
    }

    @Test
    fun encodeLines_escpos_skipsBlankLines() {
        val lines = org.json.JSONArray()
            .put(line("ANA CRUZ", "name"))
            .put(line("", "price")) // blank → skipped, never a stray empty line
            .put(line(StickerEncoder.today(), "date"))
        val esc = String(StickerEncoder.encodeLines(lines, tspl = false), Charsets.US_ASCII)
        assertTrue(esc.contains("ANA CRUZ"))
        assertTrue(esc.contains(StickerEncoder.today()))
    }
}
