package com.mineflow.capture.printer

import org.junit.Assert.assertEquals
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
}
