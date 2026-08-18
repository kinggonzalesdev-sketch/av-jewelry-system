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
}
