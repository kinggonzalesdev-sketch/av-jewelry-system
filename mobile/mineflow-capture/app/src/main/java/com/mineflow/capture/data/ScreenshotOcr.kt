package com.mineflow.capture.data

import android.graphics.Bitmap
import android.util.Log
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
 *   2. FALLBACK — if the band was inconclusive, OCR the full screen. It re-checks the established
 *      bottom-40% zone AND (Owner 2026-08-21) a recovery area down to the bottom 55%, to catch a
 *      pinned comment pushed up by large fonts / FB display scaling. A recovery-area claim is used
 *      ONLY when it is the SINGLE unambiguous strong candidate — else "needs review", never a guess.
 *   3. SELECT SPATIALLY (via ML Kit bounding boxes, not reading order): the pinned claim =
 *      the bottom-most `Mine`/`M`/bare-weight line; its name = the name-like line DIRECTLY
 *      above it (same column, within ~2 line-heights).
 *   4. No confident pinned name → `fbName = null` AND grams/value dropped → PC "needs review"
 *      (a UI banner number such as "Send 200 Stars…" can never become grams). The sticker
 *      never prints a guessed identity, and grams is only kept when tied to a real name block.
 *
 * The full screenshot is still uploaded for review/sending — only the identity source is
 * the pinned block.
 */
object ScreenshotOcr {

    private const val TAG = "MineFlowOcr"

    // ONE reused recognizer (was re-created every capture). warmUp() primes the model.
    private val recognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }

    // OCR the bottom 40% first — the pinned comment always sits there on the FB Live screen.
    // This is the FAST PATH crop AND the established pinned zone; it is deliberately UNCHANGED.
    private const val PINNED_ROI_TOP_FRACTION = 0.60

    // FULL-SCREEN FALLBACK recovery floor (Owner 2026-08-21). ONLY when the fast-path bottom-40%
    // band yields nothing, the fallback may inspect down to the bottom 55% to recover a pinned
    // comment PUSHED UP by large fonts / Facebook display scaling / short (16:9, tablet) screens.
    // A claim in the newly admitted recovery area [0.45, 0.60) is accepted ONLY if it is the SINGLE
    // unambiguous strong candidate — NEVER a bottom-most guess among several. Wrong-customer
    // prevention over automation. The fast path and the established >=0.60 zone are untouched.
    private const val FALLBACK_MIN_CLAIM_TOP_FRACTION = 0.45

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
    // Facebook ENGAGEMENT / COMPOSER chrome that carries a NUMBER which must NEVER be grams:
    // the "Send 200 Stars to pin your comment here" gifting banner + the pin-comment prompt.
    // This is the FB control the Owner saw leak "200" into grams (2026-08-20). It's a targeted
    // reject of that UI element — the STRUCTURAL guarantee (grams only kept with an associated
    // name block, in guessFrom) is what generalises beyond this one banner.
    private val BANNER = Regex(
        "\\bpin\\s+(your\\s+)?comment\\b|\\bsend\\b[^\\n]*\\bstars?\\b|\\bstars?\\s+to\\s+pin\\b",
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
    // Individual Facebook UI/chrome WORDS. A line whose tokens are ALL chrome words is interface
    // text — even when OCR MERGES two labels onto one line ("Overview" tab + "Live" badge →
    // "Overview Live"), which the EXACT-line UI_TAB match above cannot catch. A real customer name
    // always carries a NON-chrome token ("Home Reyes" keeps "Reyes"), so an all-chrome line is
    // never a buyer. This is the STRUCTURAL rule (not a growing phrase blacklist) — Owner 2026-08-19.
    private val UI_WORD = setOf(
        "overview", "live", "chat", "replies", "reply", "comment", "comments", "discussion",
        "details", "home", "menu", "notifications", "notification", "marketplace", "watch",
        "reels", "reel", "feed", "share", "save", "report", "more", "your", "all", "most",
        "relevant", "newest", "view",
    )
    private val MINE = Regex("\\bmine\\b|\\bakin\\b|\\bsakin\\b", RegexOption.IGNORE_CASE)
    // A STANDALONE mining marker / weight-unit token — dropped (together with number tokens) when
    // isolating a name that OCR merged onto the claim line ("King Gonzales Mine 1.5" → "King Gonzales").
    private val MARKER_TOKEN = Regex("^(mine|m|g|akin|sakin)$", RegexOption.IGNORE_CASE)

    // A GRAMS/PRICE NUMBER TOKEN: a WHOLE whitespace-separated token that is just a number —
    // optionally fused with a mining marker ("M1.5") and/or a trailing unit/marker ("1.5g",
    // "1.5m"). Group 1 = the numeric core ("1.5", ".7", "12,000", "12k"). Because it must match
    // the ENTIRE token, an embedded number ("K18", "SBA-P-2265", "10:45", "85%") never registers
    // as grams. Order-independent + word-agnostic: the marker may also be a SEPARATE token
    // before/after the number ("Mine 1.5", "1.5 Mine", "rolex Mine 1.1") — handled by tokenising
    // the line, so ARBITRARY product/description words (any language, emojis) are simply ignored.
    private val NUMBER_TOKEN = Regex(
        "^(?:mine|m)?(\\.?\\d[\\d,]*(?:\\.\\d+)?k?)(?:g|m)?$",
        RegexOption.IGNORE_CASE,
    )

    // LEADING-DECIMAL RESTORATION (Owner 2026-08-22). Real Live captures showed a pinned ".23" arrive
    // as "O King Gonzales" + "23": ML Kit split/dropped/misread the decimal POINT — as a spaced token
    // (". 23"), a standalone glyph, or a stray leading char fused onto the NAME line. We restore the
    // decimal ONLY on POSITIVE, structural evidence of a real point (never a blind "23 → 0.23", since
    // 23g is legitimate). Three safe patterns, all in restoreLeadingDecimals below.
    private val LEAD_DOT_SPACED = Regex("^[.·•]\\s+(\\d{1,2})$")   // Pattern 1: ". 23" → ".23"
    private val DOT_GLYPH = Regex("^[.·•]$")                        // a standalone decimal-point line
    private val BARE_SMALL_INT = Regex("^(\\d{1,2})$")             // a dotless .xx candidate (no dot)
    // Pattern 3: a lone leading glyph OCR often makes of a decimal point (incl. O/0/°) fused onto the
    // Title-cased buyer name, e.g. "O King Gonzales". Only stripped WITH the dotless-value coupling.
    private val NAME_LEAD_GLYPH = Regex("^([O0°.·•])\\s+([A-Za-zÀ-ÿ].{1,48})$")

    fun analyze(bitmap: Bitmap, onResult: (OcrGuess) -> Unit) {
        val h = bitmap.height
        val w = bitmap.width
        val roiTop = (h * PINNED_ROI_TOP_FRACTION).toInt().coerceIn(0, maxOf(0, h - 1))
        // Fallback-only recovery floor (bottom 55%); never above 0 or below the established zone.
        val recoveryTop = (h * FALLBACK_MIN_CLAIM_TOP_FRACTION).toInt().coerceIn(0, roiTop)
        val roi = if (h - roiTop >= 8 && w >= 8) {
            runCatching { Bitmap.createBitmap(bitmap, 0, roiTop, w, h - roiTop) }.getOrNull()
        } else {
            null
        }
        if (roi == null) {
            // No crop possible → OCR the full screen but STILL gate to the pinned (bottom) zone,
            // so an arbitrary full-screen name/number can never become sticker data.
            val t0 = android.os.SystemClock.elapsedRealtime()
            ocr(bitmap) {
                Log.i(TAG, "timing: roi=none fullOcr=${android.os.SystemClock.elapsedRealtime() - t0}ms lines=${it.size}")
                onResult(guessFrom(it, minClaimTop = roiTop, recoveryFloor = recoveryTop))
            }
            return
        }
        // FAST PATH: the small bottom band. If it confidently yields the pinned name + grams,
        // use it; otherwise fall back to the full screen — for BETTER recognition — but ONLY
        // accept a claim in the pinned (bottom) zone, i.e. positively the pinned block. If the
        // pinned block isn't in that zone (missed, or placed unusually high), return nothing →
        // a "needs review" capture. Never a guessed non-pinned name/number.
        val tRoi = android.os.SystemClock.elapsedRealtime()
        ocr(roi) { roiLines ->
            runCatching { roi.recycle() }
            val roiMs = android.os.SystemClock.elapsedRealtime() - tRoi
            val g = guessFrom(roiLines)
            if (g.fbName != null && g.itemQuery != null) {
                Log.i(TAG, "timing: roiOcr=${roiMs}ms fastPath=HIT lines=${roiLines.size} (no fallback)")
                onResult(g)
            } else {
                val tFull = android.os.SystemClock.elapsedRealtime()
                ocr(bitmap) { full ->
                    Log.i(
                        TAG,
                        "timing: roiOcr=${roiMs}ms fastPath=MISS fullOcr=" +
                            "${android.os.SystemClock.elapsedRealtime() - tFull}ms (fallback ran → ~2x OCR)",
                    )
                    onResult(guessFrom(full, minClaimTop = roiTop, recoveryFloor = recoveryTop))
                }
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

    /** A line that is ENTIRELY Facebook UI/chrome — an exact tab label (UI_TAB) OR every token is a
     *  chrome word (catches OCR-merged chrome like "Overview Live"). Never a customer name. */
    private fun isChrome(s: String): Boolean {
        val t = s.trim()
        if (UI_TAB.matches(t)) return true
        val words = t.split(Regex("\\s+")).filter { it.isNotBlank() }
        return words.isNotEmpty() &&
            words.all { UI_WORD.contains(it.lowercase().trim('·', '-', ':', '•', '.', ',')) }
    }

    private fun isUiNoise(s: String): Boolean =
        UI_NOISE.containsMatchIn(s) || WATCHING.containsMatchIn(s) || BANNER.containsMatchIn(s) ||
            BLOCK.containsMatchIn(s) || isChrome(s) || s.length < 2

    /** A name-like line: 1–5 words, mostly letters, no long digit runs, Title Case. */
    private fun looksLikeName(s: String): Boolean {
        if (Regex("\\d{3,}").containsMatchIn(s)) return false
        val words = s.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.size !in 1..5) return false
        val letters = s.count { it.isLetter() }
        val titleish = words.all { it.first().isUpperCase() || !it.first().isLetter() }
        return letters >= s.length * 0.6 && titleish
    }

    /** Strip the mining marker(s) + number token(s) from a line to isolate a name OCR merged onto
     *  the claim ("King Gonzales Mine 1.5" → "King Gonzales"). Token-based, matching the SAME
     *  whole-token rule as the parser (leading decimals, "1.5g", "12k", ".7" are all dropped);
     *  arbitrary product words are left for looksLikeName to accept/reject. */
    private fun stripClaim(s: String): String =
        s.split(Regex("\\s+"))
            .filterNot { t -> NUMBER_TOKEN.matches(t) || MARKER_TOKEN.matches(t) }
            .joinToString(" ")
            .trim()
            .trim('·', '-', ':', '•')
            .trim()

    /** A parsed mining claim: `value` = the representative number for the PC (grams or price),
     *  `grams` = the normalized weight (only when unambiguous). */
    private data class Claim(val value: String?, val grams: String?)

    /**
     * GENERIC pinned-comment claim parse (Owner 2026-08-18) — extract the grams value ANYWHERE in
     * the line, independent of arbitrary product/description words (English / Filipino / brands /
     * emojis), with the optional Mine/M/g marker before OR after the number. NOT tied to any item
     * word-list. Returns:
     *   - null            → the line has NO standalone number token (a name / question / chat) → not a claim.
     *   - grams != null   → EXACTLY ONE weight-like value (≤999, not k/comma) → that is the grams.
     *   - grams == null   → a fixed price (k / comma / >999), OR 2+ weight values → NEEDS REVIEW
     *                       (it NEVER guesses which of several numbers is the grams).
     * Only whole-token numbers count, so a number embedded in a code/word ("K18") is ignored, and
     * numbers on OTHER lines never influence this line (each pinned block is parsed on its own).
     */
    private fun parseClaim(raw: String): Claim? {
        val numbers = raw.trim()
            .split(Regex("\\s+"))
            .mapNotNull { t -> NUMBER_TOKEN.find(t)?.groupValues?.get(1) }
            .filter { it.any(Char::isDigit) }
        if (numbers.isEmpty()) return null
        val gramsCandidates = numbers.mapNotNull { gramsFromValue(it) }
        val grams = if (gramsCandidates.size == 1) gramsCandidates.single() else null
        val value = when {
            numbers.size == 1 -> numbers.single()
            gramsCandidates.size == 1 -> numbers.first { gramsFromValue(it) != null }
            else -> null // 2+ weight-like numbers → ambiguous → review (no value guessed)
        }
        return Claim(value = value, grams = grams)
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
                    parseClaim(ol.text) == null &&
                    ol.box.bottom <= claim.box.top &&
                    (claim.box.top - ol.box.bottom) <= maxGap &&
                    horizontalOverlap(ol.box, claim.box)
            }
            .maxByOrNull { it.box.bottom }
            ?.text
    }

    /**
     * Restore a leading-decimal weight the OCR split/dropped/misread (Owner 2026-08-22). `internal`
     * so it is unit-testable. Returns a NEW line list; the original rawLines are kept for diagnostics.
     * Every rewrite requires POSITIVE structural evidence of a real decimal point — a dotless bare
     * integer with NO such evidence is LEFT ALONE (it may legitimately be grams, e.g. 23g):
     *   1. ". 23" (a real point, spaced from the digits in one line)      → ".23"
     *   2. a standalone "."/"·"/"•" line immediately LEFT of a bare "23"   → ".23" (drop the dot line)
     *   3. a lone leading glyph fused onto the buyer NAME ("O King …") AND a dotless bare-integer
     *      value in the SAME block below it → strip the glyph from the name AND restore ".value"
     *      (both corrections come from ONE coupled evidence, so a real initial + real grams is safe).
     */
    internal fun restoreLeadingDecimals(olines: List<OLine>): List<OLine> {
        val out = olines.toMutableList()
        val dropped = HashSet<Int>()

        // Pattern 1 — collapse ". 23" → ".23" (the decimal point IS present, just spaced).
        for (i in out.indices) {
            val m = LEAD_DOT_SPACED.matchEntire(out[i].text)
            if (m != null) out[i] = out[i].copy(text = "." + m.groupValues[1])
        }

        // Pattern 2 — a standalone decimal-point line immediately LEFT of a bare-number line on the
        // same visual row (vertical overlap + small gap) → merge into ".NN", drop the dot line.
        for (i in out.indices) {
            if (i in dropped) continue
            val numMatch = BARE_SMALL_INT.matchEntire(out[i].text) ?: continue
            for (j in out.indices) {
                if (j == i || j in dropped) continue
                if (!DOT_GLYPH.matches(out[j].text)) continue
                val dot = out[j].box
                val num = out[i].box
                val vOverlap = minOf(dot.bottom, num.bottom) - maxOf(dot.top, num.top) > 0
                val leftAdjacent = dot.right <= num.left && (num.left - dot.right) <= maxOf(num.height, 24)
                if (vOverlap && leftAdjacent) {
                    out[i] = out[i].copy(text = "." + numMatch.groupValues[1])
                    dropped.add(j)
                    break
                }
            }
        }

        // Pattern 3 — a lone leading glyph fused onto a Title-cased NAME line, coupled with a dotless
        // bare-integer value directly below it in the same block. Requires BOTH signals → safe.
        for (i in out.indices) {
            if (i in dropped) continue
            val nm = NAME_LEAD_GLYPH.matchEntire(out[i].text) ?: continue
            for (j in out.indices) {
                if (j == i || j in dropped) continue
                val vm = BARE_SMALL_INT.matchEntire(out[j].text) ?: continue
                val name = out[i].box
                val value = out[j].box
                val below = value.top >= name.top && (value.top - name.bottom) <= name.height * 2
                val hOverlap = minOf(name.right, value.right) - maxOf(name.left, value.left) > 0
                if (below && hOverlap) {
                    out[i] = out[i].copy(text = nm.groupValues[2].trim())
                    out[j] = out[j].copy(text = "." + vm.groupValues[1])
                    break
                }
            }
        }

        return out.filterIndexed { idx, _ -> idx !in dropped }
    }

    /**
     * PINNED-ONLY extraction (see class doc). `internal` so it is unit-testable.
     *
     * `minClaimTop` (FULL-SCREEN FALLBACK only): the ESTABLISHED pinned zone. A claim at/below it
     * (top >= minClaimTop) uses the current behavior — the bottom-most one is the pinned claim — so
     * a full-screen OCR can never turn a scrolling comment above the band into sticker data. The
     * ROI pass passes 0 because its crop IS already the pinned zone.
     *
     * `recoveryFloor` (FULL-SCREEN FALLBACK only, Owner 2026-08-21): a floor BELOW minClaimTop (the
     * bottom 55%) consulted ONLY when the established zone has no claim — to recover a pinned comment
     * pushed up by large fonts / Facebook display scaling. A claim in the recovery area
     * [recoveryFloor, minClaimTop) is accepted ONLY if it is the SINGLE unambiguous strong candidate
     * (exactly one admissible claim, carrying a concrete grams/fixed value, with a same-block name);
     * two+ claims or any ambiguity → "needs review". Defaults to minClaimTop (NO recovery zone), so
     * the fast path is unchanged. Never a bottom-most guess in the recovery area.
     */
    internal fun guessFrom(olinesIn: List<OLine>, minClaimTop: Int = 0, recoveryFloor: Int = minClaimTop): OcrGuess {
        val rawLines = olinesIn.map { it.text }
        // Evidence-based leading-decimal restoration BEFORE any claim/name parsing (never a blind
        // "23 → 0.23" — only when a real decimal point is structurally present, see the function).
        val olines = restoreLeadingDecimals(olinesIn)
        val clean = olines.filterNot { isUiNoise(it.text) }
        if (clean.isEmpty()) return OcrGuess(null, null, null, rawLines)

        // Every parsed claim at/below the RECOVERY floor (top >= recoveryFloor). Claims ABOVE the
        // recovery floor (higher on screen = scrolling) are ignored entirely — never sticker data.
        // For the fast path / normal fallback recoveryFloor == minClaimTop, so this IS the old gate.
        val admissible = clean
            .mapNotNull { ol -> parseClaim(ol.text)?.let { ol to it } }
            .filter { it.first.box.top >= recoveryFloor }
        if (admissible.isEmpty()) return OcrGuess(null, null, null, rawLines)

        // Two-tier selection (Owner 2026-08-21):
        //  • ESTABLISHED zone (top >= minClaimTop): the proven pinned band. If ANY claim is here,
        //    keep the CURRENT behavior — the bottom-most one (nearest the comment box) is the pinned
        //    claim. Recovery-zone claims are ignored (an established claim IS the pinned one; a
        //    recovery claim always sits above it).
        //  • RECOVERY zone only ([recoveryFloor, minClaimTop), reached when the established band is
        //    empty — a pinned comment pushed up by large fonts / FB display scaling): accept ONLY
        //    when there is EXACTLY ONE admissible claim AND it carries a concrete business value
        //    (grams or a fixed price). Two+ claims, or a lone ambiguous 2+-number blob (value null)
        //    → "needs review". NO bottom-most guess in the recovery area (wrong-customer prevention).
        val established = admissible.filter { it.first.box.top >= minClaimTop }
        val (pinnedLine, claim) = if (established.isNotEmpty()) {
            established.maxByOrNull { it.first.box.top }!!
        } else {
            admissible.singleOrNull()?.takeIf { it.second.value != null }
                ?: return OcrGuess(null, null, null, rawLines)
        }

        // Name from the SAME block only — and NEVER Facebook chrome (even merged like "Overview
        // Live"): if the only candidate is UI chrome, return null → "needs review", never a guess.
        val name = nameForClaim(clean, pinnedLine)
            ?: stripClaim(pinnedLine.text)
                .takeIf { it.isNotBlank() && looksLikeName(it) && !isChrome(it) }

        // STRUCTURAL SAFETY (Owner 2026-08-20): grams/itemQuery are OPERATIONAL data ONLY when the
        // claim belongs to a real comment block that ALSO yields a customer name (a same-block name
        // directly above). A number with NO associated name — e.g. the FB "Send 200 Stars to pin
        // your comment here" banner — is NEVER kept as grams: the capture becomes "needs review"
        // instead of a guess. This is the structural guarantee (grams tied to the name/comment
        // block) that a phrase blacklist alone cannot give.
        if (name == null) return OcrGuess(null, null, null, rawLines)

        // itemQuery = the pinned value (the PC reinterprets grams vs fixed price); grams is set
        // only for ONE real weight — a fixed price OR 2+ ambiguous numbers leaves it null (review).
        return OcrGuess(
            fbName = name,
            itemQuery = claim.value,
            grams = claim.grams,
            rawLines = rawLines,
        )
    }
}
