package com.mineflow.capture.printer

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Native sticker encoder — a faithful port of the web's receipt-encoders.ts +
 * order-receipt.ts, so the phone prints the SAME sticker as the PC (Owner-approved
 * format): Facebook Name · grams • ₱rate/g · Date, centered on a 40×30 mm label.
 *
 * Two printer languages (a thermal device speaks one or the other):
 *   - TSPL   — TSC/label printers (the XP-236B is a 40×30 mm label printer).
 *   - ESC/POS — receipt printers / thermal printers in receipt mode.
 * The active language is chosen in Bluetooth Printer settings.
 *
 * Money is passed through as the authoritative string — never re-computed here.
 */
object StickerEncoder {

    private const val ESC = 0x1b
    private const val GS = 0x1d
    private const val LF = 0x0a

    // 40×30 mm @ 203 dpi = 320×240 dots. Matches the web TSPL layout exactly.
    private const val LABEL_W = 320
    private const val LABEL_H = 240
    private const val MARGIN_X = 16
    private val PRINTABLE_W = LABEL_W - MARGIN_X * 2
    private const val LINE_GAP = 10

    /** TSC internal bitmap font cell sizes (dots). */
    private val TSPL_FONT = mapOf(
        "1" to Pair(8, 12), "2" to Pair(12, 20), "3" to Pair(16, 24), "4" to Pair(24, 32),
    )
    private fun cell(font: String): Pair<Int, Int> = TSPL_FONT[font] ?: Pair(12, 20)

    /** One sticker's data (mirrors OrderReceiptData). */
    data class Sticker(
        val customerName: String,
        val grams: String?,
        val quantity: Int,
        val unitPrice: String?,
        val pricePerGram: String?,
        val date: String,
        /** A FIXED-PRICE capture prints "FIXED • ₱X" (no /g) instead of the grams line. */
        val fixedPrice: String? = null,
    )

    private data class SizedLine(val text: String, val font: String)
    private data class Kinded(val text: String, val kind: String)

    /** Today in long words, e.g. "August 6, 2026" (Owner request — not 08/06/2026). */
    fun today(): String =
        SimpleDateFormat("MMMM d, yyyy", Locale.US).format(Date())

    /**
     * Build the sticker from a claimed label-job payload + the device's price-per-gram
     * rate (from Bluetooth Printer settings, matching the web's Sticker Settings). The
     * job carries customer/item/grams/price; the per-gram rate is a device setting.
     */
    /** Build the live-capture sticker from a claimed capture (fb name + grams) + the
     *  device's price-per-gram rate. Same format as the PC's capture sticker. */
    fun fromCapture(fbName: String, grams: String?, pricePerGram: String?): Sticker = Sticker(
        customerName = fbName.ifBlank { "—" },
        grams = normalizeGrams(grams),
        quantity = 1,
        unitPrice = null,
        pricePerGram = pricePerGram?.trim()?.takeIf { it.isNotEmpty() },
        date = today(),
    )

    fun fromLabelJob(job: JSONObject, pricePerGram: String?): Sticker = Sticker(
        customerName = job.optString("customer_display_name").ifBlank { "—" },
        grams = normalizeGrams(job.opt("grams_per_piece")?.toString()),
        quantity = job.optInt("quantity", 1),
        unitPrice = job.opt("total_price")?.toString()?.takeIf { it.isNotBlank() && it != "null" },
        pricePerGram = pricePerGram?.trim()?.takeIf { it.isNotEmpty() },
        date = today(),
    )

    /**
     * FIXED-PRICE classification of the RAW captured value token (Owner 2026-08-21) — decided from
     * the RAW token, and NEVER by stripping k / comma / ₱ / P / PHP first, so "15k" is a price
     * (₱15,000), never grams. Mirrors the web parseFixedPrice + classifyCaptureValue EXACTLY:
     *   fixed → a "k"/"K" suffix, a ₱ / P / PHP marker, a thousands comma, OR a bare integer >= 1000
     *   grams → a decimal / leading-decimal, or a bare integer <= 999  (returns null here)
     * Returns the peso amount ("15k"→"15000", "16.2k"→"16200", "₱15,000"→"15000", "1000"→"1000"),
     * or null when the value is NOT a fixed price (a weight, or unparseable — e.g. "200 stars").
     */
    fun fixedPricePeso(rawValue: String?): String? {
        val raw = rawValue?.trim()?.lowercase() ?: return null
        if (raw.isEmpty()) return null
        val hadMarker = Regex("^(?:₱|php|p)\\s*\\d").containsMatchIn(raw) // ₱/P/PHP price marker
        val s = raw.replace(Regex("^(?:₱|php|p)\\s*"), "")
        val hasK = s.endsWith("k")
        val hasComma = s.contains(",")
        val cleaned = s.replace(Regex("[,\\s]"), "").replace(Regex("k$"), "")
        val n = cleaned.toDoubleOrNull() ?: return null
        if (n <= 0) return null
        val bareInt = Regex("^\\d+$").matches(s)
        // FIXED only with a real price signal — never a bare decimal or a <=999 bare integer (grams).
        val isFixed = hasK || hasComma || hadMarker || (bareInt && n >= 1000)
        if (!isFixed) return null
        val pesos = if (hasK || (!hasComma && !hadMarker && n < 1000)) n * 1000 else n
        return Math.round(pesos).toString()
    }

    /** A FIXED-PRICE capture sticker (prints "FIXED • ₱X", no /g). `pesos` is the plain amount. */
    fun fromCaptureFixed(fbName: String, pesos: String): Sticker = Sticker(
        customerName = fbName.ifBlank { "—" },
        grams = null,
        quantity = 1,
        unitPrice = null,
        pricePerGram = null,
        date = today(),
        fixedPrice = pesos,
    )

    /**
     * The direct-local capture sticker, classifying the RAW value FIRST: a FIXED PRICE
     * (k / ₱ / P / PHP / comma / >=1000) → "FIXED • ₱X"; otherwise a real weight → "Xg • ₱rate/g";
     * otherwise null → the phone skips (needs review). Purely local — never a server round-trip.
     */
    fun fromCaptureAuto(
        fbName: String,
        grams: String?,
        itemQuery: String?,
        pricePerGram: String?,
    ): Sticker? {
        fixedPricePeso(itemQuery)?.let { return fromCaptureFixed(fbName, it) } // RAW-token fixed FIRST
        if (normalizeGrams(grams) != null) return fromCapture(fbName, grams, pricePerGram)
        return null
    }

    // ---- Peso formatting (port of formatPeso): ₱ + commas, 2dp only when needed -----
    private fun formatPeso(raw: String): String {
        val s = raw.trim().ifEmpty { return "₱0" }
        val neg = s.startsWith("-")
        val body = s.removePrefix("-")
        val parts = body.split(".")
        val whole = parts[0].ifEmpty { "0" }
        val frac = if (parts.size > 1) parts[1].padEnd(2, '0').substring(0, 2) else "00"
        val withCommas = whole.reversed().chunked(3).joinToString(",").reversed()
        val out = if (frac == "00") "₱$withCommas" else "₱$withCommas.$frac"
        return if (neg) "-$out" else out
    }

    /** "11.50" -> "11.5", "20" -> "20", "0.70" -> "0.7", ".7" -> "0.7", else null. Leading
     *  decimals are normalized (".7"→"0.7") so the sticker prints "0.7g", never ".7g". */
    fun normalizeGrams(value: String?): String? {
        if (value.isNullOrBlank()) return null
        // `\d*\.?\d+` also matches a bare leading decimal (".7"); a plain `\d+(?:\.\d+)?` would
        // grab only the "7" of ".7" and print the wrong weight.
        val m = Regex("\\d*\\.?\\d+").find(value.replace(",", "")) ?: return null
        var raw = m.value
        if (raw.startsWith(".")) raw = "0$raw"
        val n = raw.toDoubleOrNull() ?: return null
        if (n <= 0) return null
        // Drop trailing zeros: 11.50 -> 11.5, 20.0 -> 20.
        return if (n % 1.0 == 0.0) n.toLong().toString() else n.toString().trimEnd('0').trimEnd('.')
    }

    /** The sticker lines: name · (FIXED • ₱X | grams+₱rate/g) · date. */
    private fun lineItems(d: Sticker): List<Kinded> {
        val out = ArrayList<Kinded>()
        out.add(Kinded(d.customerName.ifBlank { "—" }, "name"))
        if (d.fixedPrice != null) {
            // FIXED PRICE — "FIXED • ₱15,000" (never a /g rate). Matches the PC fixed-price sticker.
            out.add(Kinded("FIXED • ${formatPeso(d.fixedPrice)}", "price"))
        } else {
            // pricePerGram line: "11.5g • ₱7,500/g", or just the rate, or just grams.
            val g = normalizeGrams(d.grams)
            if (d.pricePerGram != null) {
                val perGram = "${formatPeso(d.pricePerGram)}/g"
                out.add(Kinded(if (g != null) "${g}g • $perGram" else perGram, "pricePerGram"))
            } else if (g != null) {
                out.add(Kinded("${g}g", "pricePerGram"))
            }
        }
        out.add(Kinded(d.date, "date"))
        return out
    }

    // ---- ASCII folding (thermal printers are codepage devices) --------------------
    private fun asciify(s: String): String = s
        .replace(Regex("[—–]"), "-")
        .replace(Regex("[’‘]"), "'")
        .replace(Regex("[“”]"), "\"")
        .replace(Regex("[•·]"), "-")
        .replace("₱", "P")
        .replace(Regex("[^\\x09\\x0a\\x0d\\x20-\\x7e]"), "")

    /** Greedy word-wrap to at most maxLines of maxChars; null when it doesn't fit. */
    private fun wrapWords(text: String, maxChars: Int, maxLines: Int): List<String>? {
        val words = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return listOf("")
        val lines = ArrayList<String>()
        var cur = ""
        for (w in words) {
            if (w.length > maxChars) return null
            val next = if (cur.isEmpty()) w else "$cur $w"
            if (next.length <= maxChars) cur = next
            else { lines.add(cur); cur = w; if (lines.size >= maxLines) return null }
        }
        if (cur.isNotEmpty()) lines.add(cur)
        return if (lines.size <= maxLines) lines else null
    }

    // ---- TSPL ---------------------------------------------------------------------
    private val TSPL_FONT_BY_KIND = mapOf(
        "name" to listOf("3", "2"), "item" to listOf("3", "2"),
        "price" to listOf("3", "2"), "pricePerGram" to listOf("3", "2"), "date" to listOf("2"),
    )

    private fun fitElement(text: String, fontOrder: List<String>): List<SizedLine> {
        val t = asciify(text).replace("\"", "").trim()
        for (font in fontOrder) {
            val maxChars = maxOf(1, PRINTABLE_W / cell(font).first)
            if (t.length <= maxChars) return listOf(SizedLine(t, font))
            val wrapped = wrapWords(t, maxChars, 2)
            if (wrapped != null) return wrapped.map { SizedLine(it, font) }
        }
        val font = fontOrder.lastOrNull() ?: "2"
        val maxChars = maxOf(1, PRINTABLE_W / cell(font).first)
        val lines = ArrayList<String>()
        var i = 0
        while (i < t.length) { lines.add(t.substring(i, minOf(i + maxChars, t.length))); i += maxChars }
        return (if (lines.isEmpty()) listOf("") else lines).map { SizedLine(it, font) }
    }

    private fun layoutTsplText(lines: List<SizedLine>): List<String> {
        val heights = lines.map { cell(it.font).second }
        val totalH = heights.sum() + LINE_GAP * maxOf(0, lines.size - 1)
        var y = maxOf(8, (LABEL_H - totalH) / 2)
        val cmds = ArrayList<String>()
        lines.forEachIndexed { i, l ->
            val lineW = l.text.length * cell(l.font).first
            val x = maxOf(MARGIN_X, (LABEL_W - lineW) / 2)
            cmds.add("TEXT $x,$y,\"${l.font}\",0,1,1,\"${l.text}\"")
            y += (heights.getOrElse(i) { 0 }) + LINE_GAP
        }
        return cmds
    }

    private fun encodeTspl(d: Sticker): ByteArray = encodeTsplKinded(lineItems(d))

    private fun encodeTsplKinded(lines: List<Kinded>): ByteArray {
        val sized = lines.flatMap { fitElement(it.text, TSPL_FONT_BY_KIND[it.kind] ?: listOf("2")) }
        val program = (listOf("SIZE 40 mm,30 mm", "GAP 2 mm,0 mm", "DIRECTION 1", "CLS") +
            layoutTsplText(sized) + listOf("PRINT 1,1", "")).joinToString("\r\n")
        return asciify(program).toByteArray(Charsets.US_ASCII)
    }

    // ---- ESC/POS ------------------------------------------------------------------
    private fun gsSize(w: Int, h: Int): Int = ((w - 1) shl 4) or (h - 1)
    private data class EscStyle(val w: Int, val h: Int, val bold: Boolean, val max: Int?)
    private val ESC_STYLE_BY_KIND = mapOf(
        "name" to EscStyle(1, 2, true, 24), "item" to EscStyle(1, 2, true, 24),
        "price" to EscStyle(1, 2, true, null), "pricePerGram" to EscStyle(1, 2, true, null),
        "date" to EscStyle(1, 1, false, null),
    )

    private fun encodeEscPos(d: Sticker): ByteArray = encodeEscPosKinded(lineItems(d))

    private fun encodeEscPosKinded(lines: List<Kinded>): ByteArray {
        val out = ArrayList<Int>()
        fun emit(text: String, wT: Int, hT: Int, bold: Boolean, maxChars: Int?) {
            out.addAll(listOf(GS, 0x21, gsSize(wT, hT)))
            out.addAll(listOf(ESC, 0x45, if (bold) 0x01 else 0x00))
            val wrapped = if (maxChars != null) (wrapWords(asciify(text), maxChars, 2) ?: listOf(text)) else listOf(text)
            for (l in wrapped) { asciify(l).toByteArray(Charsets.US_ASCII).forEach { out.add(it.toInt() and 0xff) }; out.add(LF) }
            out.addAll(listOf(ESC, 0x45, 0x00))
            out.addAll(listOf(GS, 0x21, 0x00))
        }
        out.addAll(listOf(ESC, 0x40))       // init
        out.addAll(listOf(ESC, 0x61, 0x01)) // center
        out.add(LF)                         // top spacing
        for (l in lines) {
            val s = ESC_STYLE_BY_KIND[l.kind] ?: EscStyle(1, 1, false, null)
            emit(l.text, s.w, s.h, s.bold, s.max)
        }
        out.addAll(listOf(LF, LF, LF))
        out.addAll(listOf(ESC, 0x61, 0x00))       // left
        out.addAll(listOf(GS, 0x56, 0x42, 0x00))  // partial cut (no-op on labels)
        return ByteArray(out.size) { (out[it] and 0xff).toByte() }
    }

    /** Encode a sticker in the active language. */
    fun encode(d: Sticker, tspl: Boolean): ByteArray = if (tspl) encodeTspl(d) else encodeEscPos(d)

    /**
     * Encode PRE-RENDERED sticker lines (from the web's stickerLineItems, carried on an
     * ORDER_STICKER print job) with the SAME layout engine + per-kind fonts as a capture
     * sticker — so a New Order sticker reproduces the EXACT web Order sticker WITHOUT
     * recomputing any value on-device. `linesJson` is [{text,kind}, ...]; an unknown/blank kind
     * falls back to a safe default; blank-text lines are skipped.
     */
    fun encodeLines(linesJson: org.json.JSONArray, tspl: Boolean): ByteArray {
        val kinded = ArrayList<Kinded>(linesJson.length())
        for (i in 0 until linesJson.length()) {
            val o = linesJson.optJSONObject(i) ?: continue
            val text = o.optString("text")
            if (text.isBlank()) continue
            kinded.add(Kinded(text, o.optString("kind").ifBlank { "name" }))
        }
        return if (tspl) encodeTsplKinded(kinded) else encodeEscPosKinded(kinded)
    }

    // Test Print sample identity (Owner-approved). A Test Print is NOT a separate template —
    // it is the EXACT production capture sticker built from this sample data + the device's
    // configured price/g + today's local date, through the same fromCapture()+encode() path the
    // live capture uses. The old hardcoded "A.V. Jewelry / TEST PRINT" payload was removed, so the
    // operator verifies on paper exactly what a real capture sticker looks like.
    const val SAMPLE_TEST_NAME = "KING GONZALES"
    const val SAMPLE_TEST_GRAMS = "11.5"

    /** Build the Test Print sticker: production sample data → shared StickerEncoder (no test-only
     *  layout). `encode(sampleSticker(rate), tspl)` is byte-identical to a real capture sticker. */
    fun sampleSticker(pricePerGram: String?): Sticker =
        fromCapture(SAMPLE_TEST_NAME, SAMPLE_TEST_GRAMS, pricePerGram)
}
