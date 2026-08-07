package com.mineflow.capture.data

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** A best-effort read of the pinned comment in a capture: the customer's Facebook name,
 *  the mined-item text, the weight in grams, plus every recognised line so the operator
 *  can correct. `grams` is null when no confident weight was read (a "needs review"
 *  capture the PC won't auto-print). */
data class OcrGuess(
    val fbName: String?,
    val itemQuery: String?,
    val grams: String?,
    val rawLines: List<String>,
)

/**
 * On-device OCR (ML Kit, offline) for a Facebook Live capture.
 *
 * The layout we read (from real Live screenshots): the PINNED comment sits at the
 * BOTTOM of the overlay — a bold name line, then its claim "Mine <weight>"
 * (e.g. "King Gonzales" / "Mine 10.7"). Above it is the live viewer list
 * ("Andrea Dela Cruz is watching", "Bring them on camera", …) which is NOT the
 * buyer and must be ignored.
 *
 * So we anchor on the LAST "Mine …" line (the pinned claim), take the name
 * directly above it, and pull the weight/number as the item query. This is still a
 * heuristic; auto-send only fires when the name resolves to a UNIQUE linked
 * customer, and the operator can always correct a capture on the PC.
 */
object ScreenshotOcr {

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
    // An inventory-code-ish token, e.g. BN-A-1001, SBA-P 2265, K18.
    private val CODE = Regex("[A-Za-z]{1,4}[\\-\\s]?[A-Za-z]?[\\-\\s]?\\d{2,}")
    // A comment that reads like a claim.
    private val MINE = Regex("\\bmine\\b|\\bakin\\b|\\bsakin\\b", RegexOption.IGNORE_CASE)
    // A weight/reference number in a claim, e.g. "10.7", "1.23", "8.60".
    private val NUMBER = Regex("\\d{1,3}(?:[.,]\\d{1,3})?")
    // A line that is ONLY a weight-like number — a bare claim such as "11.5", "0.7",
    // "20", "0.85" (optionally a trailing "g"). This is the pinned buyer's grams when
    // there is no explicit "Mine". Anchored (^…$) so times (10:45), percents (85%) and
    // abbreviated counts (1.2K, 234 viewers) are NOT mistaken for grams.
    private val WEIGHT_LINE = Regex("^\\d{1,3}(?:[.,]\\d{1,3})?\\s*g?$", RegexOption.IGNORE_CASE)

    fun analyze(bitmap: Bitmap, onResult: (OcrGuess) -> Unit) {
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val input = InputImage.fromBitmap(bitmap, 0)
        recognizer.process(input)
            .addOnSuccessListener { text ->
                val lines = text.textBlocks
                    .flatMap { it.lines }
                    .map { it.text.trim() }
                    .filter { it.isNotBlank() }
                onResult(guessFrom(lines))
            }
            .addOnFailureListener { onResult(OcrGuess(null, null, null, emptyList())) }
    }

    private fun isUiNoise(s: String): Boolean =
        UI_NOISE.containsMatchIn(s) || WATCHING.containsMatchIn(s) || s.length < 2

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

    /** The number from a claim as clean grams: "11.50" -> "11.5", "20" -> "20". Null
     *  when there is no usable positive weight (0 < g <= 999). */
    private fun normalizeGrams(raw: String?): String? {
        if (raw == null) return null
        val m = NUMBER.find(raw) ?: return null
        val n = m.value.replace(',', '.').toDoubleOrNull() ?: return null
        if (n <= 0.0 || n > 999.0) return null
        return if (n == Math.floor(n)) n.toLong().toString()
        else n.toString().trimEnd('0').trimEnd('.')
    }

    /** Nearest name-like line ABOVE index `i` (the viewer list is already dropped). */
    private fun nameAbove(clean: List<String>, i: Int): String? =
        (i - 1 downTo 0).asSequence()
            .map { clean[it] }
            .firstOrNull { looksLikeName(it) && !MINE.containsMatchIn(it) }

    private fun guessFrom(lines: List<String>): OcrGuess {
        val clean = lines.filterNot { isUiNoise(it) }

        // Anchor on the PINNED claim: the LAST "Mine …" line (bottom of the overlay).
        val mineIdx = clean.indexOfLast { MINE.containsMatchIn(it) }
        if (mineIdx >= 0) {
            val mineLine = clean[mineIdx]
            val number = NUMBER.find(mineLine)?.value
            // Weight in grams from the claim (null if the number isn't weight-like).
            val grams = normalizeGrams(number)
            // Item query: the weight/number in the claim, else a code, else the raw claim.
            val itemQuery = number ?: CODE.find(mineLine)?.value ?: mineLine
            // Name: nearest name-like line ABOVE the claim, else a name merged onto it.
            val fbName = nameAbove(clean, mineIdx)
                ?: stripClaim(mineLine).takeIf { it.isNotBlank() && looksLikeName(it) }
            return OcrGuess(fbName, itemQuery, grams, lines)
        }

        // No "Mine" — the pinned comment may be just a name + a bare weight ("KING
        // GONZALES" / "11.5"). Anchor on a bare weight LINE. SAFETY (needs review): only
        // treat it as grams when there is EXACTLY ONE such line; multiple candidates are
        // ambiguous, so leave grams null for the operator to confirm on the PC.
        val weightIdxs = clean.indices.filter { WEIGHT_LINE.matches(clean[it].trim()) }
        if (weightIdxs.size == 1) {
            val idx = weightIdxs[0]
            val grams = normalizeGrams(clean[idx])
            val fbName = nameAbove(clean, idx)
            return OcrGuess(fbName, grams, grams, lines)
        }

        // Ambiguous or no weight — conservative name-only guess (grams null → review).
        val itemQuery = clean.firstOrNull { CODE.containsMatchIn(it) }
        val fbName = clean.firstOrNull { looksLikeName(it) && it != itemQuery }
        return OcrGuess(fbName, itemQuery, null, lines)
    }
}
