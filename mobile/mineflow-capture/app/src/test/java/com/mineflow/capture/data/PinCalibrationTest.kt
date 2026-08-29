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

        // ---- KING "Was live" real bitmap (720x1600): 5 stacked King comments, bottom .4 pinned ----
        sb.append("\n=== KING (720x1600) real bitmap ===\n")
        val king = PinFixtures.load("king_pinned_was_live.png")
        val kNames = listOf(
            "k1(.66)" to Box(88, 943, 250, 977),
            "k2(.77)" to Box(88, 1036, 250, 1070),
            "k3(.88)" to Box(88, 1128, 250, 1162),
            "k4(.99)" to Box(88, 1220, 250, 1254),
            "k5(.4)PIN" to Box(112, 1323, 272, 1357),
        )
        for ((label, nb) in kNames) {
            val roi = PinPixelDetector.pinRoiFor(nb)
            val m = PinPixelDetector.bestMatchIn(king, tpl, roi, PinPixelDetector.DEFAULT_SCALES, 1)
            sb.append(
                "%-10s score=%.3f matchBox=%s scale=%.2f\n".format(
                    label, m?.score ?: -1.0,
                    m?.box?.let { "[${it.left},${it.top} ${it.right - it.left}x${it.bottom - it.top}]" } ?: "none",
                    m?.scale ?: 0.0,
                ),
            )
        }
        val kingTplPng = PinFixtures.load("facebook_pin_badge_king.png")
        val kPinsOrig = PinPixelDetector.detectPins(king, listOf(tpl), kNames.map { it.second })
        val kPins = PinPixelDetector.detectPins(king, listOf(tpl, kingTplPng), kNames.map { it.second })
        sb.append("detectPins(orig-only) → ${kPinsOrig.size} pin(s); detectPins(multi) → ${kPins.size} pin(s): ")
        kPins.forEach { sb.append("[${it.box.left},${it.box.top} conf=%.3f] ".format(it.confidence)) }
        sb.append("\n")
        // Verified-badge probe: the blue check sits right of the name / left of the bottom name — NOT
        // on the avatar. Scan a small ROI over a verified badge to confirm it does not score as a pin.
        val vbadge = PinPixelDetector.bestMatchIn(king, tpl, Box(250, 945, 285, 980), PinPixelDetector.DEFAULT_SCALES, 1)
        sb.append("verified-badge(k1) score=%.3f\n".format(vbadge?.score ?: -1.0))

        fun asciiRegion(img: ArgbImage, l: Int, t: Int, r: Int, b: Int): String {
            val ramp = " .:-=+*#%@"
            val s = StringBuilder()
            for (y in t until minOf(b, img.height)) {
                for (x in l until minOf(r, img.width)) {
                    val lum = img.lumAt(y * img.width + x) / 255.0
                    s.append(ramp[(lum * (ramp.length - 1)).toInt().coerceIn(0, ramp.length - 1)])
                }
                s.append('\n')
            }
            return s.toString()
        }
        // FULL DISCRIMINATION MATRIX: two templates (original 18x13 + King-cropped pin 18x17) against
        // every known PIN and NON-PIN, to pick a robust template set + threshold that separates them.
        val kingPinTpl = PinFixtures.crop(king, Box(56, 1356, 74, 1373))
        val wide = doubleArrayOf(0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.8, 2.1, 2.4, 2.8)
        data class T(val label: String, val img: ArgbImage, val name: Box, val pin: Boolean)
        val targets = listOf(
            T("NEZ.pin", rubynez, Box(95, 1232, 232, 1264), true),
            T("GLAIZA.pin", glaiza, Box(122, 1731, 413, 1765), true),
            T("KING.4.pin", king, Box(112, 1323, 272, 1357), true),
            T("RUBY.no", rubynez, Box(95, 1128, 205, 1160), false),
            T("DAN.no", rubynez, Box(95, 1042, 225, 1074), false),
            T("KING.66.no", king, Box(88, 943, 250, 977), false),
            T("KING.77.no", king, Box(88, 1036, 250, 1070), false),
            T("KING.88.no", king, Box(88, 1128, 250, 1162), false),
            T("KING.99.no", king, Box(88, 1220, 250, 1254), false),
        )
        sb.append("\n-- DISCRIMINATION MATRIX (orig | kingcrop | MAX) --\n")
        for (t in targets) {
            val roi = PinPixelDetector.pinRoiFor(t.name)
            val so = PinPixelDetector.bestMatchIn(t.img, tpl, roi, wide, 1)?.score ?: -1.0
            val sk = PinPixelDetector.bestMatchIn(t.img, kingPinTpl, roi, wide, 1)?.score ?: -1.0
            sb.append("%-12s pin=%-5s orig=%.3f king=%.3f MAX=%.3f\n".format(
                t.label, t.pin.toString(), so, sk, maxOf(so, sk)))
        }
        // Verified badges (blue check) must score low with BOTH templates.
        for ((lbl, box) in listOf("vbadge.66" to Box(250, 945, 295, 985), "vbadge.4" to Box(88, 1322, 120, 1358))) {
            val so = PinPixelDetector.bestMatchIn(king, tpl, box, wide, 1)?.score ?: -1.0
            val sk = PinPixelDetector.bestMatchIn(king, kingPinTpl, box, wide, 1)?.score ?: -1.0
            sb.append("%-12s pin=false orig=%.3f king=%.3f MAX=%.3f\n".format(lbl, so, sk, maxOf(so, sk)))
        }

        val path = PinFixtures.writeReport("pin-calibration.txt", sb.toString())
        println("CALIBRATION WRITTEN: $path")
    }
}
