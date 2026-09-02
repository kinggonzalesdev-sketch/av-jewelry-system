package com.mineflow.capture.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.mineflow.capture.R
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/** The pin-gate outcome on the AUTOMATIC (live) capture path — the SOLE authority for auto-Capture.
 *  `null` only on the ungated manual/legacy path (positional selection). On the gated path it is
 *  ALWAYS set, so a gated capture can never silently look like a plain "name not read":
 *   • SELECTED     — a single confident on-screen pin authorised this read (name+claim below).
 *   • WAITING      — NO confident pin, OR the detector could not operate (templates missing / pixel
 *                    snapshot failed / detector threw) → FAIL CLOSED. The capture is withheld on the
 *                    phone; it must NEVER become a "Name not read / No Facebook match" row on the PC.
 *   • NEEDS_REVIEW — a pin exists but is ambiguous (2+ pinned blocks) or its name/claim can't be read
 *                    → a manual-review capture, no auto-send / no auto-print. */
enum class PinGate { SELECTED, WAITING, NEEDS_REVIEW }

/** A best-effort read of the PINNED comment in a capture: the customer's Facebook name,
 *  the mined-item text, the weight in grams, plus every recognised line so the operator
 *  can correct. `fbName`/`grams` are null when the pinned comment could not be read
 *  confidently (a "needs review" capture the PC won't auto-print). `pinGate` records the
 *  visual-pin decision on the automatic path (null on the ungated manual path). */
data class OcrGuess(
    val fbName: String?,
    val itemQuery: String?,
    val grams: String?,
    val rawLines: List<String>,
    val pinGate: PinGate? = null,
)

/** Why a BOX CAPTURE (Owner 2026-09-02) is Needs Review, or NONE for a clean single name + claim.
 *  EMPTY = nothing usable · NO_NAME = a claim but no customer · NO_CLAIM = a name but no value ·
 *  MULTIPLE = the box holds two+ plausible comment blocks (never auto-pick one). */
enum class BoxReview { NONE, EMPTY, NO_NAME, NO_CLAIM, MULTIPLE }

/** A Box Capture result: the parsed guess (fbName/grams are null unless Selected) + the review
 *  reason, so the phone can show the right message and print ONLY on NONE. */
data class BoxGuess(val guess: OcrGuess, val review: BoxReview)

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

    /** Prime the ML Kit model (and download if needed) so the first real capture is fast. Pass a
     *  Context to ALSO load the visual pin-badge template (res/raw) that gates automatic Capture. */
    fun warmUp(context: Context? = null) {
        try {
            val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
            recognizer.process(InputImage.fromBitmap(bmp, 0))
                .addOnCompleteListener { runCatching { bmp.recycle() } }
        } catch (_: Exception) {
            /* best-effort warm-up — never fatal */
        }
        if (context != null) {
            if (appContext == null) appContext = context.applicationContext
            ensurePinTemplate()
        }
    }

    // ---- VISUAL PIN GATE (Owner 2026-08-29) ----------------------------------------------------
    // Automatic Capture is authorised ONLY when a real on-screen pin badge is confidently detected on
    // the selected comment's avatar. The template is the FB pin badge (res/raw/facebook_pin_badge.png);
    // detection + the decision rule live in PinPixelDetector + PinnedCommentSelector. If the template
    // cannot be loaded, the gate is INERT (capture behaves as before) and the failure is logged loudly
    // — an operational fail-safe, never a silent total outage. Physical validation still required.
    private var appContext: Context? = null
    @Volatile private var pinTemplates: List<ArgbImage> = emptyList()
    @Volatile private var pinTemplateTried = false

    /** Decode the pin-badge templates ONCE into pure ArgbImages (exact pixels, no density scaling).
     *  MULTI-TEMPLATE: the original 18×13 badge PLUS a real 18×17 King-pin crop — the FB pin renders
     *  slightly differently across captures, so matching the best of several real templates generalizes
     *  (the original alone missed the King "Was live" pin). */
    private fun ensurePinTemplate() {
        if (pinTemplates.isNotEmpty() || pinTemplateTried) return
        pinTemplateTried = true
        val ctx = appContext ?: return
        val loaded = ArrayList<ArgbImage>()
        for (resId in intArrayOf(R.raw.facebook_pin_badge, R.raw.facebook_pin_badge_king)) {
            try {
                val opts = BitmapFactory.Options().apply { inScaled = false }
                val bmp = ctx.resources.openRawResource(resId).use {
                    BitmapFactory.decodeStream(it, null, opts)
                }
                if (bmp != null) {
                    loaded.add(bitmapToArgb(bmp))
                    runCatching { bmp.recycle() }
                }
            } catch (e: Exception) {
                Log.e(TAG, "PIN GATE: failed to load a pin template ($resId)", e)
            }
        }
        if (loaded.isEmpty()) {
            Log.e(TAG, "PIN GATE DISABLED: no pin templates loaded")
            return
        }
        pinTemplates = loaded
        Log.i(TAG, "PIN GATE: ${loaded.size} template(s) loaded")
    }

    /** Full copy of a Bitmap's pixels into the pure ARGB image the detector consumes. */
    private fun bitmapToArgb(bmp: Bitmap): ArgbImage {
        val w = bmp.width
        val h = bmp.height
        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        return ArgbImage(px, w, h)
    }

    /** A pin-detect callback bound to one bitmap's pixels (already converted). stride=2 for speed —
     *  the on-screen badge is ~15–50 px, so every-other-pixel sampling still lands on the ZNCC peak. */
    private fun pinDetectorFor(argb: ArgbImage): ((List<Box>) -> List<PinMarker>)? {
        val tpls = pinTemplates
        if (tpls.isEmpty()) return null
        return { boxes -> PinPixelDetector.detectPins(argb, tpls, boxes, stride = 2) }
    }

    /** A pin-detect callback bound to `bmp`'s pixels, or null when the gate CANNOT operate — no
     *  templates loaded, or the pixel snapshot failed. Snapshots the pixels NOW (bitmapToArgb copies),
     *  so the caller may recycle `bmp` immediately after. A null return on the gated path makes
     *  guessFrom FAIL CLOSED (Waiting) — it must NEVER silently revert to positional selection. */
    private fun safePinDetector(bmp: Bitmap): ((List<Box>) -> List<PinMarker>)? =
        runCatching { if (pinTemplates.isNotEmpty()) pinDetectorFor(bitmapToArgb(bmp)) else null }.getOrNull()

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
            "\\bopen app\\b|^g?\\s*live(\\s*\\d+)?$|" +
            // Box Capture overlay labels (Owner 2026-09-02) — belt-and-suspenders so a
            // "Locked" / "Lock" / "Unlock" chip can never become a name/claim if it ever
            // leaks into the crop (the overlay is also hidden during the screenshot).
            "\\block(ed)?\\b|\\bunlock\\b|\\bcapture area\\b",
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
    // Pattern 4: a Mine-family MARKER with a decimal point FUSED to it, then a spaced small integer —
    // "M. 64" / "M.64" / "M . 64" / "Mine. 64". Both pieces already exist in the grammar (M = marker,
    // ". NN" = leading decimal); the DOT straddling them is what breaks parsing. REQUIRES the dot — a
    // marker without one ("M 64" / "Mine 64") is NOT matched and stays a whole number.
    private val MARKER_DOT_LEAD = Regex("^(mine|m|akin|sakin)\\s*[.·•]\\s*(\\d{1,2})$", RegexOption.IGNORE_CASE)
    // Pattern 3: a lone leading glyph OCR often makes of a decimal point (incl. O/0/°) fused onto the
    // Title-cased buyer name, e.g. "O King Gonzales". Only stripped WITH the dotless-value coupling.
    private val NAME_LEAD_GLYPH = Regex("^([O0°.·•])\\s+([A-Za-zÀ-ÿ].{1,48})$")

    fun analyze(bitmap: Bitmap, applyPinGate: Boolean = false, onResult: (OcrGuess) -> Unit) {
        val h = bitmap.height
        val w = bitmap.width
        val roiTop = (h * PINNED_ROI_TOP_FRACTION).toInt().coerceIn(0, maxOf(0, h - 1))
        // Fallback-only recovery floor (bottom 55%); never above 0 or below the established zone.
        val recoveryTop = (h * FALLBACK_MIN_CLAIM_TOP_FRACTION).toInt().coerceIn(0, roiTop)
        // Visual pin gate applies to the AUTOMATIC capture path only (OverlayCaptureService); manual
        // review screens keep the ungated OCR so the operator still sees + edits the read.
        val gate = applyPinGate
        if (gate) ensurePinTemplate() // no-op once loaded
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
                val pd = if (gate) safePinDetector(bitmap) else null
                onResult(guessFrom(it, minClaimTop = roiTop, recoveryFloor = recoveryTop, gateRequested = gate, pinDetect = pd))
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
            // Snapshot the ROI pixels for the pin gate BEFORE the ROI bitmap is recycled. The detector
            // and roiLines share the SAME (ROI-relative) coordinate space, so pin geometry lines up.
            // safePinDetector copies the pixels now, so recycling roi immediately after is safe; a null
            // result (no templates / snapshot failed) makes the gated read FAIL CLOSED (Waiting).
            val roiPd = if (gate) safePinDetector(roi) else null
            runCatching { roi.recycle() }
            val roiMs = android.os.SystemClock.elapsedRealtime() - tRoi
            val g = guessFrom(roiLines, gateRequested = gate, pinDetect = roiPd)
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
                    val pd = if (gate) safePinDetector(bitmap) else null
                    onResult(guessFrom(full, minClaimTop = roiTop, recoveryFloor = recoveryTop, gateRequested = gate, pinDetect = pd))
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

    /** The first standalone business-number token in a line ("4", "99", ".4", ".99", "12,000",
     *  "15k", "8.2"), or null. Marker-fused ("Mine 1.5") + trailing-unit ("1.5g") handled like the
     *  parser. Used ONLY by the competing-comment guard, so single-char digits count too. */
    private fun firstNumberToken(text: String): String? =
        text.trim().split(Regex("\\s+")).firstNotNullOfOrNull { t ->
            NUMBER_TOKEN.find(t)?.groupValues?.get(1)?.takeIf { it.any(Char::isDigit) }
        }

    /** A business-number carried by a line that is NOT Facebook chrome/banner/watching — the "200"
     *  in "Send 200 Stars…" is excluded here. Unlike isUiNoise it does NOT drop 1-char lines, so a
     *  dot-lost single-digit value (".4" → "4") is still seen as a competing comment. */
    private fun carriesNumber(text: String): String? {
        if (UI_NOISE.containsMatchIn(text) || WATCHING.containsMatchIn(text) ||
            BANNER.containsMatchIn(text) || BLOCK.containsMatchIn(text) || isChrome(text)
        ) {
            return null
        }
        return firstNumberToken(text)
    }

    /** Compare business values so ".4"/"4"/".99"/"99"/"15k" normalize consistently (grams where
     *  applicable, else the raw token). Distinct intended values normalize distinctly. */
    private fun normNum(s: String): String = gramsFromValue(s) ?: s.lowercase()

    private fun horizontalOverlap(a: Box, b: Box): Boolean =
        minOf(a.right, b.right) - maxOf(a.left, b.left) > 0

    /**
     * The Facebook name for a claim: the name-like line DIRECTLY ABOVE the claim (within ~2
     * line-heights), horizontally overlapping it — i.e. the SAME comment block. A name from a
     * different comment / column / far away is never used. Null when none qualifies.
     */
    private fun nameForClaim(clean: List<OLine>, claim: OLine): String? =
        nameLineForClaim(clean, claim)?.text

    /** As [nameForClaim] but returns the whole name OLine (box included) — the pin gate needs the
     *  name's rectangle to locate its avatar. Behaviour-identical to the text form. */
    private fun nameLineForClaim(clean: List<OLine>, claim: OLine): OLine? {
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

        // Pattern 4 (Owner 2026-08-30) — a Mine-family MARKER with a decimal point FUSED to it, then a
        // spaced small integer: "M. 64" → ".64" (0.64g). The customer wrote "Mine .64" and OCR/rendering
        // shoved the dot onto the marker with a space before the digits, so neither the marker-token nor
        // the ". NN" leading-decimal rule fired and it parsed as 64. The DOT is the decisive evidence:
        // "M 64" / "Mine 64" / bare "64" have NO dot and stay whole numbers. Physical case: Jeric
        // "M. 64" = 0.64g. This only reunites two pieces the grammar already has (M marker + ". NN").
        for (i in out.indices) {
            val m4 = MARKER_DOT_LEAD.matchEntire(out[i].text)
            if (m4 != null) out[i] = out[i].copy(text = "." + m4.groupValues[2])
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

    // A leading O / 0 / ° FUSED before a Capitalised name token ("ORoshelle") is a phantom UI/badge/
    // icon glyph ML Kit misread next to the avatar — NOT part of the name. Positive structural
    // evidence it is noise: a real name NEVER starts with two capitals fused (O + Capital + lowercase
    // is not a name word). So this strips it safely; every legitimate O-name is left untouched because
    // none matches: "Olivia"/"Oscar"/"Ocampo"/"Orlando" (O + lowercase), "O'Brien" (O + '), "O King"
    // (O + space), "OJ"/"OG" (no trailing lowercase). Owner 2026-08-22 (Roshelle "ORoshelle" bug).
    private val PHANTOM_LEADING_NAME_GLYPH = Regex("^[O0°]([A-Z][a-z].*)$")

    /** Remove a phantom leading O/0/° fused onto a Capitalised name ("ORoshelle Akitan Gavino" →
     *  "Roshelle Akitan Gavino"); leave every real name (incl. legitimate O-names) unchanged.
     *  `internal` so it is unit-testable. */
    internal fun sanitizeLeadingNameGlyph(name: String): String {
        val t = name.trim()
        return PHANTOM_LEADING_NAME_GLYPH.matchEntire(t)?.groupValues?.get(1)?.trim() ?: t
    }

    /**
     * PIN-LOCKED selection (Owner 2026-08-29). The on-screen visual pin is the SOLE authority: find the
     * single pinned comment block and return ITS name + own claim. Unpinned comments never participate
     * — no positional fallback, no competing-comment review (so a stack of unpinned same-customer
     * comments cannot contest the pinned one). No confident pin → WaitingForPin → null; a pin on two+
     * blocks / ambiguous → NeedsReview → null. Pure + JVM-testable: pins come from the injected detector,
     * geometry from the already-classified name/claim line boxes. Name is taken from the pinned block's
     * OWN name line (never chrome, never a broad crop); the claim is that block's OWN line, never borrowed.
     */
    private fun waiting(rawLines: List<String>) = OcrGuess(null, null, null, rawLines, PinGate.WAITING)
    private fun needsReview(rawLines: List<String>) = OcrGuess(null, null, null, rawLines, PinGate.NEEDS_REVIEW)

    private fun pinLockedGuess(
        clean: List<OLine>,
        admissible: List<Pair<OLine, Claim>>,
        rawLines: List<String>,
        pinDetect: (List<Box>) -> List<PinMarker>,
    ): OcrGuess {
        val claimLines = admissible.map { it.first }
        // ALL customer-name candidates — NOT only those that strictly associate with a claim. A pinned
        // name can be horizontally OFFSET from its own claim (the verified badge indents the name while
        // the grams sits at the left margin), so it would otherwise be dropped. The pin + avatar geometry
        // is the authority; unpinned names fall away in the selector below.
        val nameLines = clean.filter {
            looksLikeName(it.text) && !isChrome(it.text) && !MINE.containsMatchIn(it.text) && parseClaim(it.text) == null
        }
        if (nameLines.isEmpty()) return waiting(rawLines) // no comment to pin → Waiting (never positional)
        // FAIL CLOSED: a detector that THROWS on-device must NOT fall through to positional selection —
        // treat it as "cannot confirm a pin" → Waiting. (Templates-missing is already handled upstream.)
        val pins = try { pinDetect(nameLines.map { it.box }) } catch (_: Throwable) { return waiting(rawLines) }
        // Explicit, DISTINCT terminal states — Waiting (zero pin) is NOT the same as a plain null read:
        //   WaitingForPin → Waiting  (the phone withholds the capture; no PC row, no match, no send)
        //   NeedsReview   → NeedsReview (a pin exists but is ambiguous / unreadable → manual review)
        //   Selected      → read this block's OWN name + claim
        when (val sel = PinnedCommentSelector.select(nameLines, claimLines, pins)) {
            PinnedSelection.WaitingForPin -> return waiting(rawLines)
            PinnedSelection.NeedsReview -> return needsReview(rawLines)
            is PinnedSelection.Selected -> {
                val name = sel.name.text.takeIf { looksLikeName(it) && !isChrome(it) }
                    ?: return needsReview(rawLines) // a pin, but its name isn't usable → review (a pin WAS found)
                // The pinned block's claim = the nearest admissible claim DIRECTLY BELOW the pinned name
                // (small vertical gap, same column-ish). Because the block is UNIQUELY pin-identified we
                // do not require strict horizontal overlap — that handles the indented-name / left-margin
                // claim geometry — but we keep it to the name's own column so a different comment can't leak.
                val nb = sel.name.box
                val maxGap = maxOf(nb.height * 2, 30)
                val claim = admissible
                    .filter { (c, _) ->
                        c.box.top >= nb.bottom - 4 &&
                            (c.box.top - nb.bottom) <= maxGap &&
                            c.box.left <= nb.right &&
                            c.box.right >= nb.left - nb.height * 2
                    }
                    .minByOrNull { it.first.box.top }?.second
                    ?: return needsReview(rawLines) // a pinned name with no readable claim → review
                return OcrGuess(
                    fbName = sanitizeLeadingNameGlyph(name),
                    itemQuery = claim.value,
                    grams = claim.grams,
                    rawLines = rawLines,
                    pinGate = PinGate.SELECTED,
                )
            }
        }
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
    internal fun guessFrom(
        olinesIn: List<OLine>,
        minClaimTop: Int = 0,
        recoveryFloor: Int = minClaimTop,
        gateRequested: Boolean = false,
        pinDetect: ((List<Box>) -> List<PinMarker>)? = null,
    ): OcrGuess {
        val rawLines = olinesIn.map { it.text }
        // Evidence-based leading-decimal restoration BEFORE any claim/name parsing (never a blind
        // "23 → 0.23" — only when a real decimal point is structurally present, see the function).
        val olines = restoreLeadingDecimals(olinesIn)
        val clean = olines.filterNot { isUiNoise(it.text) }

        // VISUAL PIN GATE (Owner 2026-08-29/30) — the AUTOMATIC live path. The on-screen pin is the
        // SOLE authority; a gated capture NEVER falls back to positional/bottom-most selection.
        //   • detector supplied (or a pin unit-test) → pinLockedGuess (Selected / Waiting / NeedsReview),
        //     decided FIRST, before positional selection and the competing-comment guard. Every UNPINNED
        //     comment is out of scope (a stack of unpinned .66/.77/.88/.99 never contests the pinned .4).
        //   • gate REQUESTED but no detector (templates missing / pixel snapshot failed) → FAIL CLOSED →
        //     Waiting. This is the removed fail-OPEN: a requested gate can no longer silently revert to
        //     the old bottom-comment pick.
        // Inert when neither is set (manual review screens / legacy tests): the positional path below runs
        // byte-for-byte unchanged, with pinGate left null.
        if (pinDetect != null) {
            val admissible = clean
                .mapNotNull { ol -> parseClaim(ol.text)?.let { ol to it } }
                .filter { it.first.box.top >= recoveryFloor }
            return pinLockedGuess(clean, admissible, rawLines, pinDetect)
        }
        if (gateRequested) return waiting(rawLines)

        // ---- UNGATED POSITIONAL PATH (manual review / legacy) — unchanged, pinGate stays null ----
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

        // COMPETING-COMMENT SAFETY (Owner 2026-08-22, P0). A current Capture must NEVER print an
        // OLDER visible comment just because it OCR'd better. Scan the RAW lines in the established
        // band (chrome/banner excluded, but 1-char digits KEPT — a dot-lost ".4"→"4" is dropped by
        // isUiNoise's length<2 yet IS a real competing comment): the LOWEST business-number line is
        // the current comment; if ANY DIFFERENT-valued business-number line sits within ~3
        // line-heights of it, we cannot prove which comment is authoritative → "needs review", never
        // a guess. (Real cause of ".4/.5 printed 99g": the current single-digit was filtered and an
        // older 2-digit .99 won.) A single isolated pinned comment still prints; SAME-value
        // duplicates never compete; a claim scrolling FAR above (> 3 line-heights) is not a
        // competitor.
        // COMPETITOR QUALIFICATION (Owner 2026-08-29): only a number that belongs to a real CUSTOMER
        // comment may compete — i.e. it has a same-block customer NAME, decided by the SAME
        // nameForClaim association the pinned claim uses. A nameless scene/video/SKU number ("220",
        // "SBA", a QR/code fragment) is NOT another customer, so it can no longer suppress a valid
        // named comment into a false Needs Review (proven Marivic-type scene-noise defect). This
        // narrows COMPETITOR QUALIFICATION ONLY — candidate extraction (parseClaim) is unchanged, and
        // two DIFFERENT-valued NAMED comments still go to Needs Review exactly as before. Residual
        // trade-off: a genuine older comment whose NAME was OCR-dropped (only its number survived) is
        // no longer promoted to a competitor — it has no identity to act on and cannot print alone.
        val numbered = olines.filter {
            it.box.top >= minClaimTop &&
                carriesNumber(it.text) != null &&
                nameForClaim(clean, it) != null
        }
        val lowestNum = numbered.maxByOrNull { it.box.top }
        if (lowestNum != null) {
            val lowVal = normNum(carriesNumber(lowestNum.text)!!)
            val lh = maxOf(lowestNum.box.height, 24)
            val competing = numbered.any { ol ->
                ol !== lowestNum &&
                    normNum(carriesNumber(ol.text)!!) != lowVal &&
                    kotlin.math.abs(ol.box.top - lowestNum.box.top) <= lh * 3
            }
            if (competing) return OcrGuess(null, null, null, rawLines)
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
            // Strip a phantom leading O/0/° BEFORE the name leaves OCR, so the direct-local sticker,
            // the stored name, and downstream Facebook matching all get the same clean canonical name.
            fbName = sanitizeLeadingNameGlyph(name),
            itemQuery = claim.value,
            grams = claim.grams,
            rawLines = rawLines,
        )
    }

    /**
     * BOX CAPTURE selection (Owner 2026-09-02). Runs on the locked box's CROP lines ONLY — no
     * full-screen selection, NO pin gate, and NO positional bottom-most pick. The box authorizes
     * WHERE to look; OCR still validates WHAT is inside. Decimal grammar is fully preserved
     * (restoreLeadingDecimals + parseClaim): ".64"→0.64, ".18"→0.18, "M. 64"→0.64, "64"→64, and a
     * fixed price stays a fixed price (grams null).
     *
     * PHASE 6/7 rule: EXACTLY one plausible customer name AND one plausible claim → Selected (auto
     * print). Anything else → Needs Review with a specific reason — and NEVER an arbitrary pick when
     * the box holds multiple plausible comment blocks.
     */
    internal fun guessBox(olinesIn: List<OLine>): BoxGuess {
        val rawLines = olinesIn.map { it.text }
        val olines = restoreLeadingDecimals(olinesIn)
        val clean = olines.filterNot { isUiNoise(it.text) }

        val nameLines = clean.filter {
            looksLikeName(it.text) && !isChrome(it.text) && !MINE.containsMatchIn(it.text) && parseClaim(it.text) == null
        }
        val claims = clean.mapNotNull { ol -> parseClaim(ol.text)?.let { ol to it } }

        val distinctNames = nameLines
            .map { sanitizeLeadingNameGlyph(stripClaim(it.text).ifBlank { it.text }) }
            .filter { it.isNotBlank() }
            .distinct()
        val distinctClaims = claims.map { it.second.value ?: it.second.grams ?: "" }.distinct()

        val review = when {
            distinctNames.isEmpty() && distinctClaims.isEmpty() -> BoxReview.EMPTY
            distinctNames.isEmpty() -> BoxReview.NO_NAME
            distinctClaims.isEmpty() -> BoxReview.NO_CLAIM
            distinctNames.size > 1 || distinctClaims.size > 1 -> BoxReview.MULTIPLE
            else -> BoxReview.NONE
        }
        if (review != BoxReview.NONE) return BoxGuess(OcrGuess(null, null, null, rawLines), review)

        val claim = claims.first().second
        val name = sanitizeLeadingNameGlyph(
            nameForClaim(clean, claims.first().first)
                ?: stripClaim(nameLines.first().text).ifBlank { nameLines.first().text },
        )
        if (!looksLikeName(name) || isChrome(name)) {
            return BoxGuess(OcrGuess(null, null, null, rawLines), BoxReview.NO_NAME)
        }
        return BoxGuess(
            OcrGuess(fbName = name, itemQuery = claim.value, grams = claim.grams, rawLines = rawLines),
            BoxReview.NONE,
        )
    }
}
