package com.mineflow.capture.printer

import org.json.JSONObject
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

    /** One printed TSPL line: text in a bitmap font, scaled xMul × yMul. */
    private data class SizedLine(val text: String, val font: String, val xMul: Int = 1, val yMul: Int = 1)
    private data class Kinded(val text: String, val kind: String)

    // ---- Date (Owner 2026-09-25: short month names) ------------------------------------------
    /** The Owner's exact month names. NOT SimpleDateFormat "MMM" — that gives Sep / Jun / Jul. */
    private val SHORT_MONTHS = listOf(
        "Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec",
    )
    private val LONG_MONTHS = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )

    /** Today, e.g. "Sept 25, 2026". The phone's own clock and time zone, exactly as before. */
    fun today(): String = stickerDate(Date())

    /** A date in the sticker format: short month, day, year ("Jan 8, 2026", "Sept 25, 2026"). */
    internal fun stickerDate(date: Date, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
        val c = java.util.Calendar.getInstance(zone, Locale.US).apply { time = date }
        return "${SHORT_MONTHS[c.get(java.util.Calendar.MONTH)]} " +
            "${c.get(java.util.Calendar.DAY_OF_MONTH)}, ${c.get(java.util.Calendar.YEAR)}"
    }

    /** A date LINE received as text (the web's Order sticker says "September 25, 2026"): only a
     *  leading full month name is shortened; the day and year are kept as they are. */
    fun shortenMonth(text: String): String {
        val t = text.trim()
        val i = LONG_MONTHS.indexOfFirst { t.startsWith("$it ") }
        return if (i < 0) t else SHORT_MONTHS[i] + t.substring(LONG_MONTHS[i].length)
    }

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

    // ---- Customer name: ONE line, sized to the printable width (Owner 2026-09-25) --------------
    /**
     * The name sizes, largest first. TSPL's built-in fonts are fixed-width bitmap fonts: every
     * character is exactly one cell wide, so a line's printed width in dots is its character count
     * × the cell width × the width multiplier — the exact width, not an estimate.
     *   1. font "3" 16×24 dots — the approved size, up to 18 characters in 288 dots
     *   2. font "2" 12×20 dots — slightly smaller, up to 24 characters
     *   3. font "1" 8×12 at double height = 8×24 dots (1 mm wide, 3 mm tall) — the MINIMUM readable
     *      size, up to 36 characters. Nothing smaller is used.
     */
    private val NAME_SIZES = listOf(
        SizedLine("", "3"), SizedLine("", "2"), SizedLine("", "1", xMul = 1, yMul = 2),
    )

    /** How a customer name fits the sticker: the line to print, and whether the WHOLE name fit. */
    data class NameFit(val text: String, val font: String, val xMul: Int, val yMul: Int, val fits: Boolean) {
        /** Printed width in dots. */
        val widthDots: Int get() = text.length * cellW(font) * xMul
    }

    private fun cellW(font: String): Int = cell(font).first

    /**
     * The customer name on ONE line, never wrapped: the largest size at which the whole name fits
     * the printable width. A name too long even at the minimum size (over 36 characters) prints at
     * the minimum size cut after the last whole word that fits, and is reported with fits = false —
     * it is never wrapped onto a second line and never shrunk below the minimum.
     */
    fun nameFit(name: String): NameFit {
        val t = asciify(name).replace("\"", "").trim().replace(Regex("\\s+"), " ").ifEmpty { "-" }
        for (s in NAME_SIZES) {
            if (t.length * cellW(s.font) * s.xMul <= PRINTABLE_W) return NameFit(t, s.font, s.xMul, s.yMul, true)
        }
        val min = NAME_SIZES.last()
        val maxChars = PRINTABLE_W / (cellW(min.font) * min.xMul)
        val cut = t.substring(0, maxChars)
        // Keep whole words: cut at the last space, unless the cut already ends exactly at a word.
        val atWord = if (t[maxChars] == ' ') cut.trimEnd()
            else cut.substring(0, cut.lastIndexOf(' ').takeIf { it > 0 } ?: maxChars).trimEnd()
        return NameFit(atWord, min.font, min.xMul, min.yMul, false)
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

    /**
     * CENTERING (Owner 2026-09-25): each line's printed width in dots (fixed-width font: characters
     * × cell width × multiplier) is centered on the 320-dot label, then held inside the 16-dot side
     * margins, so no line — the date included — can run past the right edge.
     */
    private fun centeredX(lineW: Int): Int =
        if (lineW >= PRINTABLE_W) MARGIN_X
        else ((LABEL_W - lineW) / 2).coerceIn(MARGIN_X, LABEL_W - MARGIN_X - lineW)

    private fun layoutTsplText(lines: List<SizedLine>): List<String> {
        val heights = lines.map { cell(it.font).second * it.yMul }
        val totalH = heights.sum() + LINE_GAP * maxOf(0, lines.size - 1)
        var y = maxOf(8, (LABEL_H - totalH) / 2)
        val cmds = ArrayList<String>()
        lines.forEachIndexed { i, l ->
            val lineW = l.text.length * cell(l.font).first * l.xMul
            cmds.add("TEXT ${centeredX(lineW)},$y,\"${l.font}\",0,${l.xMul},${l.yMul},\"${l.text}\"")
            y += (heights.getOrElse(i) { 0 }) + LINE_GAP
        }
        return cmds
    }

    private fun encodeTspl(d: Sticker): ByteArray = encodeTsplKinded(lineItems(d))

    /** One sticker line laid out: the name on ONE line (nameFit), a date line with the short month,
     *  every other line exactly as before. */
    private fun sizeTspl(l: Kinded): List<SizedLine> = when (l.kind) {
        "name" -> nameFit(l.text).let { listOf(SizedLine(it.text, it.font, it.xMul, it.yMul)) }
        "date" -> fitElement(shortenMonth(l.text), TSPL_FONT_BY_KIND.getValue("date"))
        else -> fitElement(l.text, TSPL_FONT_BY_KIND[l.kind] ?: listOf("2"))
    }

    private fun encodeTsplKinded(lines: List<Kinded>): ByteArray {
        val sized = lines.flatMap { sizeTspl(it) }
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

    /**
     * ESC/POS customer name, ONE line (Owner 2026-09-25). ESC/POS fonts are fixed-width too:
     * Font A is 12 dots per character, Font B 9. In the same 288-dot width that allows 24
     * characters in Font A — the approved double-height bold name — and 32 in Font B, the smallest
     * the printer has. Longer names are cut after the last whole word that fits, never wrapped.
     * Returns the text and whether it is Font B.
     */
    internal fun escPosName(name: String): Pair<String, Boolean> {
        val t = asciify(name).replace(Regex("\\s+"), " ").trim().ifEmpty { "-" }
        val fontA = PRINTABLE_W / ESC_FONT_A_W
        val fontB = PRINTABLE_W / ESC_FONT_B_W
        if (t.length <= fontA) return t to false
        if (t.length <= fontB) return t to true
        val cut = t.substring(0, fontB)
        val atWord = if (t[fontB] == ' ') cut.trimEnd()
            else cut.substring(0, cut.lastIndexOf(' ').takeIf { it > 0 } ?: fontB).trimEnd()
        return atWord to true
    }

    private const val ESC_FONT_A_W = 12
    private const val ESC_FONT_B_W = 9

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
        // Center: the PRINTER centers each line on its own printable width, measuring the real
        // glyph widths — no character-count padding from us.
        out.addAll(listOf(ESC, 0x61, 0x01))
        out.add(LF)                         // top spacing
        for (l in lines) {
            val s = ESC_STYLE_BY_KIND[l.kind] ?: EscStyle(1, 1, false, null)
            when (l.kind) {
                "name" -> {
                    // One line always: Font B (ESC M 1) only when Font A is too wide; never wrapped.
                    val (text, small) = escPosName(l.text)
                    if (small) out.addAll(listOf(ESC, 0x4d, 0x01))
                    emit(text, s.w, s.h, s.bold, null)
                    if (small) out.addAll(listOf(ESC, 0x4d, 0x00))
                }
                "date" -> emit(shortenMonth(l.text), s.w, s.h, s.bold, s.max)
                else -> emit(l.text, s.w, s.h, s.bold, s.max)
            }
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
