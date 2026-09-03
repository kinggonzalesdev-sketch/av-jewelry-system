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

        /** (Owner 2026-09-03) A box shorter than this fraction is rejected. Kept just below the thin
         *  ~4.2% default so the operator can shrink a little, while a fraction scales with the screen.
         *  The hard pixel floor for tiny screens is MIN_HEIGHT_PX. */
        const val MIN_HEIGHT_FRACTION = 0.035f

        /** A crop narrower than this many pixels is rejected (too little to OCR). */
        const val MIN_PX = 40

        /** A crop shorter than this many pixels is rejected — a one-comment floor. Lowered so the thin
         *  ~100 px default is valid on shorter (1920 px) screens too. */
        const val MIN_HEIGHT_PX = 72
        private const val EPS = 0.001f

        /** Sensible starting box: a LONG, THIN band over one comment, CENTERED horizontally (left 0.176
         *  = right margin 0.176). Owner-tuned 2026-09-03 to 64.8% × 4.2% at (0.176, 0.60) — ≈ 700 × 100 px
         *  on a 1080×2400 phone (~7:1), sized to just "Name + one claim line". */
        fun default(): CaptureRoi = CaptureRoi(0.176f, 0.60f, 0.648f, 0.042f)
    }
}

/** Integer pixel crop rectangle within a screenshot bitmap (left/top + width/height). */
data class PixelRoi(val left: Int, val top: Int, val width: Int, val height: Int)
