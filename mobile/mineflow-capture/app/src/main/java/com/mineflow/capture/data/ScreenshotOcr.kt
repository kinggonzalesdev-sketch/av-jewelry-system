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
 * On-device OCR (ML Kit, offline) for a capture screenshot. Recognises the text, then
 * makes a CONSERVATIVE guess at the Facebook name and the mined item from a Facebook
 * comment's layout (name line, then the comment text, then "Like · Reply"). This is a
 * heuristic — the operator always confirms/edits the pre-filled fields before sending,
 * so a wrong guess is never sent silently.
 */
object ScreenshotOcr {

    private val UI_NOISE = Regex(
        "^(like|reply|comment|share|pinned|top fan|author|follow|message|" +
            "see (more|translation)|view( \\d+)?( more)? repl(y|ies)|hide|edited|·|" +
            "\\d+\\s*(m|h|d|w|y|min|hr|sec)s?)\\b",
        RegexOption.IGNORE_CASE,
    )
    // An inventory-code-ish token, e.g. BN-A-1001, SBA-P 2265, K18.
    private val CODE = Regex("[A-Za-z]{1,4}[\\-\\s]?[A-Za-z]?[\\-\\s]?\\d{2,}")
    // A comment that reads like a claim.
    private val MINE = Regex("\\bmine\\b|\\bakin\\b|\\bsakin\\b", RegexOption.IGNORE_CASE)

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

    private fun isUiNoise(s: String): Boolean = UI_NOISE.containsMatchIn(s) || s.length < 2

    /** A name-like line: 1–5 words, mostly letters, no long digit runs, Title Case. */
    private fun looksLikeName(s: String): Boolean {
        if (Regex("\\d{3,}").containsMatchIn(s)) return false
        val words = s.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.size !in 1..5) return false
        val letters = s.count { it.isLetter() }
        val titleish = words.all { it.first().isUpperCase() || !it.first().isLetter() }
        return letters >= s.length * 0.6 && titleish
    }

    private fun guessFrom(lines: List<String>): OcrGuess {
        val clean = lines.filterNot { isUiNoise(it) }
        // Mined item: first code-looking line, else the line that reads like a claim.
        val itemQuery = clean.firstOrNull { CODE.containsMatchIn(it) }
            ?: clean.firstOrNull { MINE.containsMatchIn(it) }
        // Facebook name: the first name-like line that isn't the item/claim line.
        val fbName = clean.firstOrNull {
            looksLikeName(it) && it != itemQuery && !MINE.containsMatchIn(it)
        }
        return OcrGuess(fbName, itemQuery, lines)
    }
}
