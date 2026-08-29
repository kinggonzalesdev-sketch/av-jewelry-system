package com.mineflow.capture.data

/**
 * Local VISUAL pin-badge detector (Owner 2026-08-29). Screenshot pixels → PinMarkers, which feed the
 * already-tested PinnedCommentSelector. Pin source = ON-SCREEN VISUAL ICON ONLY (no Pancake/Meta
 * metadata). Operates on a pure ARGB abstraction (not android.graphics.Bitmap) so it is JVM-unit-
 * testable against the real screenshot fixtures via ImageIO; the live path converts a Bitmap with
 * getPixels(). Bounded: it scans ONLY the lower-right sub-region of each comment's avatar, never the
 * whole screen, and template-only similarity is NOT enough — a candidate must also pass avatar
 * geometry + plausible size, so a Stars/reaction/other glyph elsewhere can never authorize Capture.
 */

/** A pure ARGB image (row-major, 0xAARRGGBB). No Android types → unit-testable on the desktop JVM. */
internal class ArgbImage(val pixels: IntArray, val width: Int, val height: Int) {
    fun alphaAt(i: Int): Int = (pixels[i] ushr 24) and 0xFF
    fun lumAt(i: Int): Double {
        val p = pixels[i]
        val r = (p ushr 16) and 0xFF
        val g = (p ushr 8) and 0xFF
        val b = p and 0xFF
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
}

/** A template match: its screen box, the scale used, and the ZNCC similarity in [-1, 1]. */
internal data class PinMatch(val box: Box, val scale: Double, val score: Double)

/** Box carries `height`; the detector also needs width. Local so ScreenshotOcr.kt stays untouched. */
internal val Box.width: Int get() = right - left

internal object PinPixelDetector {

    /** ZNCC acceptance floor. Calibrated on the real fixtures: within an avatar ROI the true pins
     *  score ~0.70 (Glaiza) / ~0.82 (Nez) while pin-less avatars top out ~0.60 (Ruby) / ~0.56 (Dan). */
    const val DEFAULT_THRESHOLD = 0.66

    /** Template scales searched — the supplied 18×13 crop is a downscaled pin, so it must be UPSCALED
     *  (~2.2× viewer / ~2.6× broadcaster) to match on-screen; a spread of scales covers device density. */
    val DEFAULT_SCALES = doubleArrayOf(0.85, 1.0, 1.25, 1.5, 1.8, 2.1, 2.4, 2.8)

    /** Only template pixels this opaque are compared (the pin shape; transparent border ignored). */
    private const val ALPHA_MIN = 128

    /**
     * Zero-normalised cross-correlation (ZNCC) of `tpl` (scaled by `scale`, nearest-neighbour) against
     * the window of `img` at top-left (ox,oy), over the template's OPAQUE pixels only. Returns a value
     * in [-1,1] (higher = more similar); -1.0 for out-of-bounds / too few opaque pixels / a flat window.
     * ZNCC is invariant to brightness/contrast, so it tolerates anti-aliasing, mild compression, and
     * lighting differences without exact-RGB matching.
     */
    fun matchScore(img: ArgbImage, tpl: ArgbImage, ox: Int, oy: Int, scale: Double): Double {
        val tw = Math.round(tpl.width * scale).toInt()
        val th = Math.round(tpl.height * scale).toInt()
        if (tw < 4 || th < 3) return -1.0
        if (ox < 0 || oy < 0 || ox + tw > img.width || oy + th > img.height) return -1.0
        var n = 0
        var sumT = 0.0
        var sumW = 0.0
        var sumTT = 0.0
        var sumWW = 0.0
        var sumTW = 0.0
        for (ty in 0 until th) {
            val sty = Math.min((ty / scale).toInt(), tpl.height - 1)
            val rowT = sty * tpl.width
            val rowW = (oy + ty) * img.width
            for (tx in 0 until tw) {
                val stx = Math.min((tx / scale).toInt(), tpl.width - 1)
                val ti = rowT + stx
                if (tpl.alphaAt(ti) < ALPHA_MIN) continue
                val t = tpl.lumAt(ti)
                val w = img.lumAt(rowW + ox + tx)
                n++
                sumT += t; sumW += w; sumTT += t * t; sumWW += w * w; sumTW += t * w
            }
        }
        if (n < 12) return -1.0
        val nn = n.toDouble()
        val cov = sumTW / nn - (sumT / nn) * (sumW / nn)
        val varT = sumTT / nn - (sumT / nn) * (sumT / nn)
        val varW = sumWW / nn - (sumW / nn) * (sumW / nn)
        if (varT <= 1e-6 || varW <= 1e-6) return -1.0 // flat template or flat window → no structure
        return cov / Math.sqrt(varT * varW)
    }

    /** The best template match anywhere in `region`, across `scales`, sampling every `stride` px. */
    fun bestMatchIn(
        img: ArgbImage,
        tpl: ArgbImage,
        region: Box,
        scales: DoubleArray = DEFAULT_SCALES,
        stride: Int = 1,
    ): PinMatch? {
        var best: PinMatch? = null
        val left = maxOf(0, region.left)
        val top = maxOf(0, region.top)
        val right = minOf(img.width, region.right)
        val bottom = minOf(img.height, region.bottom)
        for (scale in scales) {
            val tw = Math.round(tpl.width * scale).toInt()
            val th = Math.round(tpl.height * scale).toInt()
            if (tw < 4 || th < 3) continue
            var oy = top
            while (oy + th <= bottom) {
                var ox = left
                while (ox + tw <= right) {
                    val s = matchScore(img, tpl, ox, oy, scale)
                    val b = best
                    if (b == null || s > b.score) {
                        best = PinMatch(Box(ox, oy, ox + tw, oy + th), scale, s)
                    }
                    ox += stride
                }
                oy += stride
            }
        }
        return best
    }

    /** Estimated avatar diameter for a comment ≈ 2× the name text height (a mid value between the
     *  viewer layout's ~1.7× and the broadcaster layout's ~2.2×). Used only for the size gate. */
    fun avatarDiameter(name: Box): Int = Math.round(name.height * 2.0).toInt().coerceAtLeast(16)

    /**
     * The search ROI for a comment's pin: the avatar sits to the LEFT of the name and the pin overlaps
     * its LOWER-RIGHT, so the ROI spans from ~2.4 name-heights left of the name to just past the name's
     * left edge, and from the name top down ~2.6 name-heights (covering a larger broadcaster avatar +
     * the pin below it). Name-relative, so ONE rule fits both supplied layouts without absolute coords.
     */
    fun pinRoiFor(name: Box): Box {
        val h = name.height
        val left = maxOf(0, name.left - Math.round(h * 2.4).toInt())
        val top = maxOf(0, name.top - Math.round(h * 0.2).toInt())
        val right = name.left + Math.round(h * 0.4).toInt()
        val bottom = name.top + Math.round(h * 2.6).toInt()
        return Box(left, top, right, bottom)
    }

    /** A match's badge size must be a plausible fraction of the avatar diameter (rejects giant/tiny). */
    private fun plausibleSize(match: PinMatch, name: Box): Boolean {
        val ratio = match.box.width.toDouble() / avatarDiameter(name).toDouble()
        return ratio in 0.35..1.25
    }

    /**
     * Detect confident pin badges. For each candidate NAME box, look ONLY in its avatar/lower-right ROI
     * (never the whole screen); accept a match that clears BOTH the similarity threshold AND the size
     * gate. Returns one PinMarker per pinned comment (the strongest match in that ROI). Bounded + fast.
     */
    fun detectPins(
        img: ArgbImage,
        tpl: ArgbImage,
        nameBoxes: List<Box>,
        threshold: Double = DEFAULT_THRESHOLD,
        scales: DoubleArray = DEFAULT_SCALES,
        stride: Int = 1,
    ): List<PinMarker> {
        val markers = ArrayList<PinMarker>()
        for (name in nameBoxes) {
            val roi = pinRoiFor(name)
            val best = bestMatchIn(img, tpl, roi, scales, stride) ?: continue
            if (best.score >= threshold && plausibleSize(best, name)) {
                markers.add(PinMarker(best.box, best.score))
            }
        }
        return markers
    }
}
