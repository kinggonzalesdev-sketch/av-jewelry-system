package com.mineflow.capture.data

import android.graphics.Bitmap
import android.graphics.Rect
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

/**
 * On-device OCR (ML Kit, offline) for a Facebook Live capture.
 *
 * CORRECTNESS RULE (2026-08-15): the Facebook name + grams come ONLY from the PINNED
 * comment — never from another visible name elsewhere on the screen. The old code ran
 * full-screen OCR, discarded ML Kit's bounding boxes, and picked "the name above the last
 * `Mine` line in READING ORDER" — which grabbed unrelated names (e.g. a spectator or a
 * different commenter like `Ulymay Alazne Pedericoc`).
 *
 * Now we KEEP ML Kit's per-line bounding boxes and select SPATIALLY:
 *   1. find CLAIM lines — "Mine X" / "M X" / a bare weight like "10.5", ".5", "11",
 *   2. the PINNED claim = the bottom-most one on screen (closest to the comment box),
 *   3. its name = the name-like line DIRECTLY ABOVE that claim (same column, within ~2
 *      line-heights) — i.e. the SAME comment block,
 *   4. if no name is tightly associated, fbName = null → the PC shows "needs review" and
 *      the sticker never prints a guessed identity. We NEVER substitute a name from
 *      elsewhere on the screen.
 *
 * The full screenshot is still uploaded for review/sending — only the identity source
 * changed. (A future refinement can crop a normalized pinned-comment ROI once the exact
 * Live layout is confirmed, to cut OCR latency further; the spatial selection here already
 * fixes the wrong-name correctness bug without a hardcoded region.)
 */
object ScreenshotOcr {

    // ONE reused recognizer (was re-created on every capture). Held for the session; the
    // model loads once — warmUp() primes it before the first real capture.
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

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
    // An inventory-code-ish token, e.g. BN-A-1001, SBA-P 2265, K18.
    private val CODE = Regex("[A-Za-z]{1,4}[\\-\\s]?[A-Za-z]?[\\-\\s]?\\d{2,}")
    private val MINE = Regex("\\bmine\\b|\\bakin\\b|\\bsakin\\b", RegexOption.IGNORE_CASE)
    private val NUMBER = Regex("\\d{1,3}(?:[.,]\\d{1,3})?")

    // A PINNED-COMMENT CLAIM line: optional "Mine"/"M", then a weight-like number (≤3 integer
    // digits, optional decimals, optional trailing "g") and NOTHING else — so "10:45", "85%",
    // "1.2K", "234 viewers", 4-digit years and names never register as grams. Group 1 = number.
    private val CLAIM = Regex(
        "^\\s*(?:mine|m)?\\s*[:.\\-]?\\s*(\\.?\\d{1,3}(?:[.,]\\d{1,3})?)\\s*g?\\s*$",
        RegexOption.IGNORE_CASE,
    )

    private data class OLine(val text: String, val box: Rect)

    fun analyze(bitmap: Bitmap, onResult: (OcrGuess) -> Unit) {
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { text ->
                val olines = ArrayList<OLine>()
                for (block in text.textBlocks) {
                    for (line in block.lines) {
                        val box = line.boundingBox ?: continue
                        val t = line.text.trim()
                        if (t.isNotBlank()) olines.add(OLine(t, box))
                    }
                }
                onResult(guessFrom(olines))
            }
            .addOnFailureListener { onResult(OcrGuess(null, null, null, emptyList())) }
    }

    private fun isUiNoise(s: String): Boolean =
        UI_NOISE.containsMatchIn(s) || WATCHING.containsMatchIn(s) ||
            BLOCK.containsMatchIn(s) || s.length < 2

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

    /**
     * Grams from a CLAIM line, normalized: ".5"→"0.5", "5.50"→"5.5", "11"→"11". Null when the
     * line is not a weight claim (so arbitrary numbers elsewhere never become grams).
     */
    private fun gramsFromClaim(raw: String): String? {
        val m = CLAIM.find(raw.trim()) ?: return null
        var num = m.groupValues[1].replace(',', '.')
        if (num.startsWith(".")) num = "0$num"
        val n = num.toDoubleOrNull() ?: return null
        if (n <= 0.0 || n > 999.0) return null
        return if (n == Math.floor(n)) n.toLong().toString()
        else n.toString().trimEnd('0').trimEnd('.')
    }

    private fun horizontalOverlap(a: Rect, b: Rect): Boolean =
        minOf(a.right, b.right) - maxOf(a.left, b.left) > 0

    /**
     * The Facebook name for a claim: the name-like line DIRECTLY ABOVE the claim (within ~2
     * line-heights), horizontally overlapping it — i.e. the SAME comment block. A name from a
     * different comment / column / far away is never used. Null when none qualifies (→ needs
     * review, rather than a wrong name).
     */
    private fun nameForClaim(clean: List<OLine>, claim: OLine): String? {
        val maxGap = maxOf(claim.box.height() * 2, 24)
        return clean
            .filter { ol ->
                ol !== claim &&
                    looksLikeName(ol.text) &&
                    !MINE.containsMatchIn(ol.text) &&
                    gramsFromClaim(ol.text) == null &&
                    ol.box.bottom <= claim.box.top &&
                    (claim.box.top - ol.box.bottom) <= maxGap &&
                    horizontalOverlap(ol.box, claim.box)
            }
            .maxByOrNull { it.box.bottom }
            ?.text
    }

    private fun guessFrom(olines: List<OLine>): OcrGuess {
        val rawLines = olines.map { it.text }
        val clean = olines.filterNot { isUiNoise(it.text) }
        if (clean.isEmpty()) return OcrGuess(null, null, null, rawLines)

        // 1) Every CLAIM line with a valid weight (Mine/M/bare-number).
        val claims = clean.mapNotNull { ol -> gramsFromClaim(ol.text)?.let { ol to it } }
        // No confident weight claim → nothing to pin on → needs review (no name, no grams).
        if (claims.isEmpty()) return OcrGuess(null, null, null, rawLines)

        // 2) PINNED claim = the bottom-most one on screen (max top = lowest, nearest the box).
        val (pinnedLine, grams) = claims.maxByOrNull { it.first.box.top }!!

        // 3) Name from the SAME block only — else null (never a name from elsewhere).
        val name = nameForClaim(clean, pinnedLine)
            ?: stripClaim(pinnedLine.text).takeIf { it.isNotBlank() && looksLikeName(it) }

        // 4) Grams are kept even when the name is unknown (grams-only needs-review); the name
        //    is NEVER guessed from another comment.
        return OcrGuess(
            fbName = name,
            itemQuery = NUMBER.find(pinnedLine.text)?.value
                ?: CODE.find(pinnedLine.text)?.value
                ?: grams,
            grams = grams,
            rawLines = rawLines,
        )
    }
}
