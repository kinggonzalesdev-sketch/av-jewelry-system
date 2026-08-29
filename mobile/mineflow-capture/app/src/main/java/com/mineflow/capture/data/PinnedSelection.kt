package com.mineflow.capture.data

/**
 * PIN-GATED comment selection (Owner 2026-08-29). The NEW source-of-truth rule for AUTOMATIC Capture:
 * a Facebook comment is eligible ONLY when it carries a confidently detected VISIBLE pin badge on its
 * avatar. This file is the DECISION CORE — pure, framework-free, unit-tested. It consumes the pin
 * markers produced by the (separate) on-device pixel detector; it does NOT itself read pixels.
 *
 * HARD RULE (no exceptions, no fallback — never bottom/latest/nearest/strongest comment):
 *   • exactly ONE pinned comment block      → that block is the ONLY eligible candidate
 *   • ZERO confident pins on any avatar      → WaitingForPin  (do not auto-select anything)
 *   • TWO+ pinned blocks, or ambiguous       → NeedsReview    (never guess)
 * Unpinned comments never participate — not even as competing-comment candidates. So a valid unpinned
 * comment with the SAME value as the pinned one does NOT trigger the competing-comment guard.
 *
 * Pin source = ON-SCREEN VISUAL ICON ONLY. No Pancake/Meta pin metadata (that path stays CLOSED
 * NEGATIVE). Association is by RELATIVE geometry (pin overlaps the avatar left of the name), never an
 * absolute screen coordinate — see the geometry audit in the task notes.
 *
 * NOTE: not wired into the live analyze()/guessFrom() path yet — the pixel detector that produces the
 * PinMarkers must be built + calibrated from the real pin-badge image first. Until then v22 behaviour
 * is unchanged (this module is additive and unused at runtime).
 */
internal data class PinMarker(val box: Box, val confidence: Double)

internal sealed interface PinnedSelection {
    /** Exactly one pinned block → eligible. `claim` may be null (a name with no readable claim below). */
    data class Selected(val name: OLine, val claim: OLine?) : PinnedSelection

    /** No confident pin on any comment avatar → do not auto-select; show "Waiting for Pinned Comment". */
    object WaitingForPin : PinnedSelection

    /** 2+ pinned blocks, or a pin that can't be uniquely attributed to one avatar → Needs Review. */
    object NeedsReview : PinnedSelection
}

internal object PinnedCommentSelector {

    /** Detector confidence floor for a pin marker to count. Tunable once real pin fixtures calibrate it. */
    const val MIN_PIN_CONFIDENCE = 0.6

    /** Two rectangles share a positive area. */
    private fun overlaps(a: Box, b: Box): Boolean =
        minOf(a.right, b.right) > maxOf(a.left, b.left) &&
            minOf(a.bottom, b.bottom) > maxOf(a.top, b.top)

    /**
     * The avatar region of a comment: a square immediately LEFT of the name line, about as tall as the
     * name+claim block. The pin badge overlaps this avatar's lower-right (geometry audit). Relative
     * geometry only — derived from the name line's own box, so it scales with device density and works
     * for both supplied Facebook layouts. Left is clamped at 0.
     */
    fun avatarRegionFor(name: OLine, claim: OLine?): Box {
        val top = name.box.top
        val bottom = maxOf(claim?.box?.bottom ?: name.box.bottom, name.box.bottom)
        val size = maxOf(bottom - top, name.box.height)
        val right = name.box.left
        val left = maxOf(0, right - size)
        return Box(left, top, right, top + size)
    }

    /** The claim line for a name: the nearest line directly BELOW it (small gap, horizontally aligned). */
    private fun claimFor(name: OLine, claims: List<OLine>): OLine? {
        val maxGap = maxOf(name.box.height * 2, 24)
        return claims
            .filter { c ->
                c !== name &&
                    c.box.top >= name.box.bottom &&
                    (c.box.top - name.box.bottom) <= maxGap &&
                    minOf(name.box.right, c.box.right) > maxOf(name.box.left, c.box.left)
            }
            .minByOrNull { it.box.top }
    }

    /**
     * Apply the pin-gated rule. `names` = candidate customer-name lines and `claims` = candidate claim
     * lines (both already classified by the existing looksLikeName / parseClaim logic at integration);
     * `pins` = pin markers from the pixel detector. Pure — safe to unit-test with synthetic geometry.
     */
    fun select(names: List<OLine>, claims: List<OLine>, pins: List<PinMarker>): PinnedSelection {
        val confident = pins.filter { it.confidence >= MIN_PIN_CONFIDENCE }
        if (confident.isEmpty()) return PinnedSelection.WaitingForPin

        // A single pin overlapping 2+ different avatars cannot be uniquely attributed → ambiguous.
        for (pin in confident) {
            val avatarsHit = names.count { overlaps(pin.box, avatarRegionFor(it, claimFor(it, claims))) }
            if (avatarsHit >= 2) return PinnedSelection.NeedsReview
        }

        val pinned = names.filter { name ->
            val avatar = avatarRegionFor(name, claimFor(name, claims))
            confident.any { overlaps(it.box, avatar) }
        }
        return when {
            pinned.size >= 2 -> PinnedSelection.NeedsReview
            pinned.size == 1 -> PinnedSelection.Selected(pinned[0], claimFor(pinned[0], claims))
            // Confident pins exist but none sit on a real comment avatar → they are false pin-like
            // matches (icon outside the avatar geometry); reject them and wait for a real pin.
            else -> PinnedSelection.WaitingForPin
        }
    }
}
