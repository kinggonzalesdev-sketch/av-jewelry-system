package com.mineflow.capture.data

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** A best-effort read of the PINNED comment in a capture: the customer's Facebook name,
 *  the mined-item text, the weight in grams, plus every recognised line so the operator
 *  can correct. `fbName`/`grams` are null when the pinned comment could not be read
 *  confidently (a "needs review" capture the PC won't auto-print). */
data class OcrGuess(
    val fbName: String?,
    val itemQuery: String?,
    val grams: String?,
    val rawLines: List<String>,
)

/** A recognised line's screen rectangle — a plain value type (not android.graphics.Rect) so
 *  the selection logic is pure-JVM unit-testable. */
internal data class Box(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val height: Int get() = bottom - top
}

internal data class OLine(val text: String, val box: Box)

/**
 * On-device OCR (ML Kit, offline) for a Facebook Live capture.
 *
 * PINNED-COMMENT ONLY (2026-08-15). On the operator's FB Live broadcaster screen the PINNED
 * comment is always at the BOTTOM (just above the toolbar): `[avatar] Name` then `Mine X`
 * directly below it; the scrolling "…is watching / Bring them on camera" bubbles are above
 * it. We take the Facebook name + grams ONLY from that pinned block — never from another
 * visible name (e.g. a spectator or `Ulymay Alazne Pedericoc`).
 *
 * How:
 *   1. FAST PATH — OCR just the bottom band (where the pinned comment sits) → materially
 *      faster than full-screen OCR. If it yields a confident name+grams, use it.
 *   2. FALLBACK — if the band was inconclusive, OCR the full screen (never miss a pinned
 *      comment placed unusually high).
 *   3. SELECT SPATIALLY (via ML Kit bounding boxes, not reading order): the pinned claim =
 *      the bottom-most `Mine`/`M`/bare-weight line; its name = the name-like line DIRECTLY
 *      above it (same column, within ~2 line-heights).
 *   4. No confident pinned name → `fbName = null` → PC "needs review"; the sticker never
 *      prints a guessed identity. Grams may still be kept.
 *
 * The full screenshot is still uploaded for review/sending — only the identity source is
 * the pinned block.
 */
object ScreenshotOcr {

    // ONE reused recognizer (was re-created every capture). warmUp() primes the model.
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    // OCR the bottom 40% first — the pinned comment always sits there on the FB Live screen.
    private const val PINNED_ROI_TOP_FRACTION = 0.60

    /** Prime the ML Kit model (and download if needed) so the first real capture is fast. */
    fun warmUp() {
        try {
            val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
            recognizer.process(InputImage.fromBitmap(bmp, 0))
                .addOnCompleteListener { runCatching { bmp.recycle() } }
        } catch (_: Exception) {
            /* best-effort warm-up — never fatal */
        }
    }

    private val UI_NOISE = Regex(
        "^(like|reply|comment|share|pinned|top fan|author|follow|message|" +
            "see (more|translation)|view( \\d+)?( more)? repl(y|ies)|hide|edited|·|" +
            "\\d+\\s*(m|h|d|w|y|min|hr|sec)s?)\\b",
        RegexOption.IGNORE_CASE,
    )
    // Facebook Live chrome + the viewer list — names here are spectators, not the buyer.
    private val WATCHING = Regex(
        "\\b(is|are)\\s+watching\\b|\\bwatching now\\b|\\bbring them on camera\\b|" +
            "\\bjoined\\b|\\breacted\\b|\\b(is|went)\\s+live\\b|\\bboost(ed)?\\b|" +
            "\\bviewers?\\b|\\bmost relevant\\b|\\bnewest\\b|\\ball comments\\b|" +
            "\\bview \\d+ (more )?comments?\\b|\\btap to\\b|\\b(add|write) a comment\\b|" +
            "\\bprivate group\\b|\\bfinish\\b",
        RegexOption.IGNORE_CASE,
    )
    // Hard blocklist: this app's own overlay/notification chrome + a Live badge burned into
    // the video — never a buyer's name.
    private val BLOCK = Regex(
        "\\bmineflow\\b|\\bcapture\\b|\\bglive\\b|\\bcamera\\b|\\bfloating button\\b|" +
            "\\bopen app\\b|^g?\\s*live(\\s*\\d+)?$",
        RegexOption.IGNORE_CASE,
    )
    // Facebook Live PANEL / NAVIGATION tab labels — the "Overview / Live chat / Your replies"
    // tab bar (and similar chrome) that leaks into full-screen OCR. These must NEVER become
    // operational print data (customer name / grams) — Owner 2026-08-18. Anchored EXACT-line
    // match so a real name that merely contains such a word ("Home Reyes") is never blocked.
    // They still survive in rawLines as non-operational diagnostics.
    private val UI_TAB = Regex(
        "^(overview|live chat|your replies|replies|comments?|discussion|details|home|menu|" +
            "notifications?|marketplace|watch|reels?|feed|share|save|report|more)$",
        RegexOption.IGNORE_CASE,
    )
    // An inventory-code-ish token, e.g. BN-A-1001, SBA-P 2265, K18.
    private val CODE = Regex("[A-Za-z]{1,4}[\\-\\s]?[A-Za-z]?[\\-\\s]?\\d{2,}")
    private val MINE = Regex("\\bmine\\b|\\bakin\\b|\\bsakin\\b", RegexOption.IGNORE_CASE)
    private val NUMBER = Regex("\\d{1,3}(?:[.,]\\d{1,3})?")

    // A PINNED-COMMENT CLAIM line: optional "Mine"/"M", then a weight-like number (≤3 integer
    // digits, optional decimals, optional trailing "g") and NOTHING else — so "10:45", "85%",
    // "1.2K", "234 viewers", 4-digit years and names never register. Group 1 = the number.
    // A pinned-comment CLAIM: after an optional "Mine"/"M", the line STARTS with a numeric
    // value (a weight OR a price). Trailing text is allowed and ignored — "Mine 2.43g LV",
    // "Mine 5.67 foxtail". A line that starts with words (a question / normal comment like
    // "anu po pendant…") is NOT a claim. Captures the leading value token: "2.43", "13.91",
    // "12000", "12,000", "12k", "12.5k", ".5". Separator is ":"/"-" only (a "." would eat the
    // decimal point of a bare ".5"). NOT end-anchored, so trailing words don't reject it.
    private val CLAIM = Regex(
        "^\\s*(?:mine\\b|m\\b)?\\s*[:\\-]?\\s*(\\.?\\d[\\d,]*(?:\\.\\d+)?k?)",
        RegexOption.IGNORE_CASE,
    )

    fun analyze(bitmap: Bitmap, onResult: (OcrGuess) -> Unit) {
        val h = bitmap.height
        val w = bitmap.width
        val roiTop = (h * PINNED_ROI_TOP_FRACTION).toInt().coerceIn(0, maxOf(0, h - 1))
        val roi = if (h - roiTop >= 8 && w >= 8) {
            runCatching { Bitmap.createBitmap(bitmap, 0, roiTop, w, h - roiTop) }.getOrNull()
        } else {
            null
        }
        if (roi == null) {
            ocr(bitmap) { onResult(guessFrom(it)) }
            return
        }
        // FAST PATH: the small bottom band. If it confidently yields the pinned name + grams,
        // use it; otherwise fall back to the full screen so we never miss the pinned comment.
        ocr(roi) { roiLines ->
            runCatching { roi.recycle() }
            val g = guessFrom(roiLines)
            if (g.fbName != null && g.itemQuery != null) {
                onResult(g)
            } else {
                ocr(bitmap) { full -> onResult(guessFrom(full)) }
            }
        }
    }

    /** Run the recognizer on a bitmap and hand back its lines with bounding boxes. */
    private fun ocr(bitmap: Bitmap, onLines: (List<OLine>) -> Unit) {
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { text ->
                val olines = ArrayList<OLine>()
                for (block in text.textBlocks) {
                    for (line in block.lines) {
                        val r = line.boundingBox ?: continue
                        val t = line.text.trim()
                        if (t.isNotBlank()) olines.add(OLine(t, Box(r.left, r.top, r.right, r.bottom)))
                    }
                }
                onLines(olines)
            }
            .addOnFailureListener { onLines(emptyList()) }
    }

    private fun isUiNoise(s: String): Boolean =
        UI_NOISE.containsMatchIn(s) || WATCHING.containsMatchIn(s) ||
            BLOCK.containsMatchIn(s) || UI_TAB.matches(s.trim()) || s.length < 2

    /** A name-like line: 1–5 words, mostly letters, no long digit runs, Title Case. */
    private fun looksLikeName(s: String): Boolean {
        if (Regex("\\d{3,}").containsMatchIn(s)) return false
        val words = s.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.size !in 1..5) return false
        val letters = s.count { it.isLetter() }
        val titleish = words.all { it.first().isUpperCase() || !it.first().isLetter() }
        return letters >= s.length * 0.6 && titleish
    }

    /** Strip the "mine <number>" claim from a line to isolate a name OCR merged onto it. */
    private fun stripClaim(s: String): String =
        s.replace(MINE, "").replace(NUMBER, "").trim().trim('·', '-', ':', '•').trim()

    /** The raw leading value token of a CLAIM line ("2.43", "12000", "12,000", "12k"), or null
     *  when the line does not START with a value (a question / normal comment). */
    private fun valueFromClaim(raw: String): String? {
        val v = CLAIM.find(raw.trim())?.groupValues?.get(1) ?: return null
        return if (v.any { it.isDigit() }) v else null
    }

    /**
     * Grams from a claim value, normalized: ".5"→"0.5", "5.50"→"5.5", "11"→"11". Null for a
     * FIXED-price form (a "k" suffix, a comma, or a value > 999) — those are treated as a
     * fixed price on the PC, never printed as grams on the phone.
     */
    private fun gramsFromValue(rawValue: String): String? {
        val s = rawValue.trim().lowercase()
        if (s.endsWith("k") || s.contains(",")) return null
        var num = s
        if (num.startsWith(".")) num = "0$num"
        val n = num.toDoubleOrNull() ?: return null
        if (n <= 0.0 || n > 999.0) return null
        return if (n == Math.floor(n)) n.toLong().toString()
        else n.toString().trimEnd('0').trimEnd('.')
    }

    private fun horizontalOverlap(a: Box, b: Box): Boolean =
        minOf(a.right, b.right) - maxOf(a.left, b.left) > 0

    /**
     * The Facebook name for a claim: the name-like line DIRECTLY ABOVE the claim (within ~2
     * line-heights), horizontally overlapping it — i.e. the SAME comment block. A name from a
     * different comment / column / far away is never used. Null when none qualifies.
     */
    private fun nameForClaim(clean: List<OLine>, claim: OLine): String? {
        val maxGap = maxOf(claim.box.height * 2, 24)
        return clean
            .filter { ol ->
                ol !== claim &&
                    looksLikeName(ol.text) &&
                    !MINE.containsMatchIn(ol.text) &&
                    valueFromClaim(ol.text) == null &&
                    ol.box.bottom <= claim.box.top &&
                    (claim.box.top - ol.box.bottom) <= maxGap &&
                    horizontalOverlap(ol.box, claim.box)
            }
            .maxByOrNull { it.box.bottom }
            ?.text
    }

    /** PINNED-ONLY extraction (see class doc). `internal` so it is unit-testable. */
    internal fun guessFrom(olines: List<OLine>): OcrGuess {
        val rawLines = olines.map { it.text }
        val clean = olines.filterNot { isUiNoise(it.text) }
        if (clean.isEmpty()) return OcrGuess(null, null, null, rawLines)

        val claims = clean.mapNotNull { ol -> valueFromClaim(ol.text)?.let { ol to it } }
        if (claims.isEmpty()) return OcrGuess(null, null, null, rawLines)

        // Pinned claim = the bottom-most one on screen (nearest the comment box).
        val (pinnedLine, value) = claims.maxByOrNull { it.first.box.top }!!

        // Name from the SAME block only — else null (never a name from elsewhere).
        val name = nameForClaim(clean, pinnedLine)
            ?: stripClaim(pinnedLine.text).takeIf { it.isNotBlank() && looksLikeName(it) }

        // itemQuery = the raw pinned value (the PC reinterprets grams vs fixed price); grams is
        // set only for a real weight — a fixed-price form (k / comma / >999) leaves it null.
        return OcrGuess(
            fbName = name,
            itemQuery = value,
            grams = gramsFromValue(value),
            rawLines = rawLines,
        )
    }
}
