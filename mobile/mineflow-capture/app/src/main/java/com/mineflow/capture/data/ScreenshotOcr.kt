package com.mineflow.capture.data

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** A best-effort read of the pinned comment in a capture: the customer's Facebook name
 *  and the mined-item text, plus every recognised line so the operator can correct. */
data class OcrGuess(
    val fbName: String?,
    val itemQuery: String?,
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
            .addOnFailureListener { onResult(OcrGuess(null, null, emptyList())) }
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

    private fun guessFrom(lines: List<String>): OcrGuess {
        val clean = lines.filterNot { isUiNoise(it) }

        // Anchor on the PINNED claim: the LAST "Mine …" line (bottom of the overlay).
        val mineIdx = clean.indexOfLast { MINE.containsMatchIn(it) }
        if (mineIdx >= 0) {
            val mineLine = clean[mineIdx]
            // Item query: the weight/number in the claim, else a code, else the raw claim.
            val itemQuery = NUMBER.find(mineLine)?.value
                ?: CODE.find(mineLine)?.value
                ?: mineLine
            // Name: nearest name-like line ABOVE the claim (viewer list already dropped),
            // else a name OCR merged onto the claim line itself.
            val fbName = (mineIdx - 1 downTo 0)
                .asSequence()
                .map { clean[it] }
                .firstOrNull { looksLikeName(it) && !MINE.containsMatchIn(it) }
                ?: stripClaim(mineLine).takeIf { it.isNotBlank() && looksLikeName(it) }
            return OcrGuess(fbName, itemQuery, lines)
        }

        // No claim recognised — fall back to the original conservative guess.
        val itemQuery = clean.firstOrNull { CODE.containsMatchIn(it) }
        val fbName = clean.firstOrNull { looksLikeName(it) && it != itemQuery }
        return OcrGuess(fbName, itemQuery, lines)
    }
}
