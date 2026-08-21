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
}
