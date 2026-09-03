package com.mineflow.capture.data

/**
 * BOX CAPTURE MODE v1 (Owner 2026-09-02). The movable/resizable/lockable Capture Box — the
 * technical OCR boundary. Stored as NORMALIZED fractions (0..1) of the screen, NOT raw pixels, so
 * one saved box behaves across resolution/scale differences and app restarts. `locked` gates
 * accidental drag/resize; Capture uses the SAVED box, never a live view position.
 *
 * PURE + dependency-free (no android.*), so the coordinate mapping and its safety checks are
 * unit-tested on the JVM. Nothing here reads pixels or does OCR — see BoxCapture for that.
 */
data class CaptureRoi(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float,
    val locked: Boolean = false,
) {
    /** Structurally valid: inside [0,1], positive, at least the minimum fraction (a TALLER minimum on
     *  height so a two-line comment fits — STEP 4), and fully on screen. An invalid box NEVER produces
     *  a crop (PHASE 15 — no silent wrong-region OCR). */
    fun isValid(): Boolean =
        left in 0f..1f && top in 0f..1f &&
            width >= MIN_FRACTION && height >= MIN_HEIGHT_FRACTION &&
            left + width <= 1f + EPS && top + height <= 1f + EPS

    /**
     * Map to integer pixel bounds for cropping a `screenW`×`screenH` screenshot, or null when the
     * box is invalid, would fall outside the bitmap, or is below the minimum pixel size. Clamps a
     * rounding overshoot back inside the bitmap; returns null rather than crop a wrong/empty region.
     */
    fun toPixelRoi(screenW: Int, screenH: Int, minPx: Int = MIN_PX): PixelRoi? {
        if (screenW <= 0 || screenH <= 0 || !isValid()) return null
        val l = Math.round(left * screenW).coerceIn(0, screenW - 1)
        val t = Math.round(top * screenH).coerceIn(0, screenH - 1)
        var w = Math.round(width * screenW)
        var h = Math.round(height * screenH)
        if (l + w > screenW) w = screenW - l
        if (t + h > screenH) h = screenH - t
        // STEP 4: height must clear a two-line minimum, width the usual side minimum.
        if (w < minPx || h < MIN_HEIGHT_PX) return null
        return PixelRoi(l, t, w, h)
    }

    /** Clamp an edited box back to a legal on-screen rectangle (used while dragging/resizing). */
    fun normalized(): CaptureRoi {
        val w = width.coerceIn(MIN_FRACTION, 1f)
        val h = height.coerceIn(MIN_HEIGHT_FRACTION, 1f)
        val l = left.coerceIn(0f, 1f - w)
        val t = top.coerceIn(0f, 1f - h)
        return copy(left = l, top = t, width = w, height = h)
    }

    companion object {
        /** A box narrower than this fraction of the screen is rejected as unusable. */
        const val MIN_FRACTION = 0.05f

        /** (Owner 2026-09-02) A box shorter than this fraction can't hold ONE two-line Facebook comment
         *  (name + value). Deliberately small so the box can hug a single comment closely (the approved
         *  reference is short), while still rejecting an unusably shallow box. A fraction → scales with
         *  the screen; the real floor for tiny screens is MIN_HEIGHT_PX. */
        const val MIN_HEIGHT_FRACTION = 0.045f

        /** A crop narrower than this many pixels is rejected (too little to OCR). */
        const val MIN_PX = 40

        /** A crop shorter than this many pixels is rejected — a one-comment (two-line) floor. ~70–90dp
         *  on common densities; small enough to fit closely around a single comment. */
        const val MIN_HEIGHT_PX = 96
        private const val EPS = 0.001f

        /** Sensible starting box: a SHORT, snug band over one comment (the operator moves/resizes it).
         *  Owner-tuned 2026-09-03 to 76% × 8.5% at (0.12, 0.612) — ≈ 821 × 204 px on a 1080×2400 phone
         *  (~4:1), tight around a single "Name + claim" comment block. */
        fun default(): CaptureRoi = CaptureRoi(0.12f, 0.612f, 0.76f, 0.085f)

        /**
         * TEXT-SAFE LEFT INSET (Owner 2026-09-03) — how many px to skip from the box's LEFT edge before
         * OCR, so the Facebook AVATAR + verification BADGE (predictable left-side icons) are excluded and
         * the badge is never misread as a leading "O"/"0" on the customer name. The VISIBLE gold box is
         * unchanged; this only shrinks the INTERNAL OCR crop (`boxLeft + inset … boxRight`).
         *
         * Device-aware: the avatar/badge is a fixed dp size, so the caller passes its width in px
         * (dp-derived). Capped at 28% of the box so a narrow box is never over-cropped, and never so much
         * that less than MIN_PX remains — the full customer name is always preserved.
         */
        fun textOcrLeftInset(boxWidthPx: Int, avatarBadgePx: Int): Int {
            if (boxWidthPx <= 0 || avatarBadgePx <= 0) return 0
            val maxInset = (boxWidthPx - MIN_PX).coerceAtLeast(0)
            return minOf(avatarBadgePx, (boxWidthPx * 0.28f).toInt(), maxInset).coerceAtLeast(0)
        }
    }
}

/** Integer pixel crop rectangle within a screenshot bitmap (left/top + width/height). */
data class PixelRoi(val left: Int, val top: Int, val width: Int, val height: Int)
