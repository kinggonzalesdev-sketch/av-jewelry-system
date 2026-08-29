package com.mineflow.capture.data

import org.junit.Test

/**
 * DIAGNOSTIC (not asserting): programmatically locate the real pin badge in the fixtures and measure
 * its score/scale/geometry, so the detector's threshold + avatar geometry are set from real data (not
 * eyeballed). Writes build/pin-calibration.txt. Kept in the suite as a living measurement record.
 */
class PinCalibrationTest {

    private val scales = doubleArrayOf(0.7, 0.85, 1.0, 1.2, 1.5, 1.8, 2.2, 2.6)

    private fun asciiMap(tpl: ArgbImage): String {
        val ramp = " .:-=+*#%@"
        val sb = StringBuilder()
        for (y in 0 until tpl.height) {
            for (x in 0 until tpl.width) {
                val i = y * tpl.width + x
                if (tpl.alphaAt(i) < 128) { sb.append('.'); continue }
                val l = tpl.lumAt(i) / 255.0
                sb.append(ramp[(l * (ramp.length - 1)).toInt().coerceIn(0, ramp.length - 1)])
            }
            sb.append('\n')
        }
        return sb.toString()
    }

    private fun bandBest(img: ArgbImage, tpl: ArgbImage, label: String, l: Int, t: Int, r: Int, b: Int): String {
        val m = PinPixelDetector.bestMatchIn(img, tpl, Box(l, t, r, b), scales, stride = 1)
        return "%-16s best=%.3f  box=%s  scale=%.2f".format(
            label, m?.score ?: -1.0, m?.box?.let { "[${it.left},${it.top} ${it.width}x${it.height}]" } ?: "none", m?.scale ?: 0.0,
        )
    }

    @Test
    fun calibrate() {
        val tpl = PinFixtures.load("facebook_pin_badge.png")
        val glaiza = PinFixtures.load("glaiza_pinned_live.png")
        val rubynez = PinFixtures.load("ruby_nez_pinned_live.png")

        var opaque = 0
        var lmin = 255.0; var lmax = 0.0
        for (i in tpl.pixels.indices) if (tpl.alphaAt(i) >= 128) { opaque++; lmin = minOf(lmin, tpl.lumAt(i)); lmax = maxOf(lmax, tpl.lumAt(i)) }

        val sb = StringBuilder()
        sb.append("=== TEMPLATE facebook_pin_badge.png ===\n")
        sb.append("dims=${tpl.width}x${tpl.height} opaquePx=$opaque lum[$lmin..$lmax]\n")
        sb.append("alpha present=${tpl.pixels.any { (it ushr 24) and 0xFF < 255 }}\n")
        sb.append(asciiMap(tpl)).append("\n")

        sb.append("=== GLAIZA (945x2048) — scan bottom-left block for the pin ===\n")
        sb.append(bandBest(glaiza, tpl, "glaiza-wide", 5, 1500, 320, 1920)).append("\n")
        // Report a few coarse candidates across the bottom to see the score landscape.
        for (yb in intArrayOf(1550, 1620, 1690, 1760, 1830)) {
            sb.append(bandBest(glaiza, tpl, "  y~$yb", 5, yb, 260, yb + 90)).append("\n")
        }
        sb.append("\n=== RUBY/NEZ (720x1600) — per comment band (avatar column x[15..118]) ===\n")
        sb.append(bandBest(rubynez, tpl, "Dan(nopin)", 15, 1030, 118, 1100)).append("\n")
        sb.append(bandBest(rubynez, tpl, "Ruby(nopin)", 15, 1118, 118, 1195)).append("\n")
        sb.append(bandBest(rubynez, tpl, "Nez(PIN)", 15, 1225, 118, 1305)).append("\n")
        // Background baseline (a plain region with no icon) to gauge the false-score floor.
        sb.append(bandBest(rubynez, tpl, "bg-baseline", 300, 300, 420, 380)).append("\n")

        sb.append("\n=== ROI-BASED detect scores (pinRoiFor + DEFAULT_SCALES) — what detectPins sees ===\n")
        val cases = listOf(
            Triple("glaiza(PIN)", glaiza, Box(122, 1731, 413, 1765)),
            Triple("ruby(nopin)", rubynez, Box(95, 1128, 205, 1160)),
            Triple("nez(PIN)", rubynez, Box(95, 1232, 232, 1264)),
            Triple("dan(nopin)", rubynez, Box(95, 1042, 225, 1074)),
        )
        for ((label, im, nb) in cases) {
            val roi = PinPixelDetector.pinRoiFor(nb)
            val m = PinPixelDetector.bestMatchIn(im, tpl, roi, PinPixelDetector.DEFAULT_SCALES, 1)
            sb.append(
                "%-14s score=%.3f  matchBox=%s scale=%.2f  roi=[%d,%d %dx%d]\n".format(
                    label, m?.score ?: -1.0,
                    m?.box?.let { "[${it.left},${it.top} ${it.right - it.left}x${it.bottom - it.top}]" } ?: "none",
                    m?.scale ?: 0.0, roi.left, roi.top, roi.right - roi.left, roi.bottom - roi.top,
                ),
            )
        }
        // Masked Nez (pin painted over) — proves no-pin fail-closed.
        val nezMasked = PinFixtures.maskBox(rubynez, Box(30, 1258, 95, 1305))
        val mm = PinPixelDetector.bestMatchIn(
            nezMasked, tpl, PinPixelDetector.pinRoiFor(Box(95, 1232, 232, 1264)), PinPixelDetector.DEFAULT_SCALES, 1,
        )
        sb.append("nez-MASKED     score=%.3f\n".format(mm?.score ?: -1.0))

        val path = PinFixtures.writeReport("pin-calibration.txt", sb.toString())
        println("CALIBRATION WRITTEN: $path")
    }
}
