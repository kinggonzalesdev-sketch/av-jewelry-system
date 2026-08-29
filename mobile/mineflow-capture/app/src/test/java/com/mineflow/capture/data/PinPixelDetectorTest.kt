package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner 2026-08-29 — end-to-end VISUAL pin detector over the REAL Facebook fixtures (loaded as pure
 * ArgbImage via PinFixtures' PNG decoder). Proves the full path: screenshot pixels → detectPins →
 * PinnedCommentSelector → Selected / WaitingForPin / NeedsReview, using the actual pin badge template.
 *
 * Ground truth (Owner): glaiza = broadcaster view, Glaiza pinned (Mine 8.9); ruby_nez = viewer view,
 * Nez pinned (1.72) while Ruby is UNPINNED with the same 1.72 and must NOT be selected. Name/claim
 * boxes below are measured from the fixtures (see PinCalibrationTest / task notes). The pin is found
 * purely from pixels — no name/coord is hard-coded into the detector, only into these test inputs.
 */
class PinPixelDetectorTest {

    private val tpl = PinFixtures.load("facebook_pin_badge.png")
    private val glaiza by lazy { PinFixtures.load("glaiza_pinned_live.png") }      // 945×2048 broadcaster
    private val rubyNez by lazy { PinFixtures.load("ruby_nez_pinned_live.png") }   // 720×1600 viewer

    // ---- measured comment geometry -------------------------------------------------------------
    private val glaizaName = OLine("Glaiza Sale Galang", Box(122, 1731, 413, 1765))
    private val glaizaClaim = OLine("Mine 8.9", Box(122, 1780, 250, 1811))

    private val danName = OLine("Dan Ollugrac", Box(95, 1042, 225, 1074))
    private val danClaim = OLine("Up", Box(95, 1078, 140, 1105))
    private val rubyName = OLine("Ruby Rose", Box(95, 1128, 205, 1160))
    private val rubyClaim = OLine("mine 1.72", Box(95, 1165, 195, 1195))
    private val nezName = OLine("Nez Candava", Box(95, 1232, 232, 1264))
    private val nezClaim = OLine("1.72", Box(95, 1268, 140, 1298))

    private fun boxesOf(vararg o: OLine) = o.map { it.box }

    // A — broadcaster view, Glaiza's real pin → Selected(Glaiza / Mine 8.9).
    @Test
    fun A_glaizaRealPin_selected() {
        val pins = PinPixelDetector.detectPins(glaiza, tpl, boxesOf(glaizaName))
        assertEquals("exactly one pin on Glaiza's avatar", 1, pins.size)
        val r = PinnedCommentSelector.select(listOf(glaizaName), listOf(glaizaClaim), pins)
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Glaiza Sale Galang", r.name.text)
        assertEquals("Mine 8.9", r.claim?.text)
    }

    // B — viewer view: Ruby (no pin) vs Nez (pin). Only Nez detected; Ruby never selected though 1.72==1.72.
    @Test
    fun B_rubyNoPin_nezRealPin_selectsNez() {
        val pins = PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName, nezName))
        assertEquals("only Nez's avatar carries a pin", 1, pins.size)
        val r = PinnedCommentSelector.select(
            listOf(danName, rubyName, nezName), listOf(danClaim, rubyClaim, nezClaim), pins,
        )
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Nez Candava", r.name.text)
        assertEquals("1.72", r.claim?.text)
    }

    // C — mask Nez's pin (paint it over) → NO pin anywhere → WaitingForPin (proves no bottom-comment fallback).
    @Test
    fun C_maskedPin_waiting() {
        val masked = PinFixtures.maskBox(rubyNez, Box(28, 1256, 96, 1300))
        val pins = PinPixelDetector.detectPins(masked, tpl, boxesOf(danName, rubyName, nezName))
        assertEquals("no pin after masking", 0, pins.size)
        val r = PinnedCommentSelector.select(
            listOf(danName, rubyName, nezName), listOf(danClaim, rubyClaim, nezClaim), pins,
        )
        assertEquals(PinnedSelection.WaitingForPin, r)
    }

    // D — perfectly readable comments but (Dan + Ruby only) NO pin → WaitingForPin, never auto-picked.
    @Test
    fun D_readableCommentsNoPin_waiting() {
        val pins = PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName))
        assertEquals(0, pins.size)
        val r = PinnedCommentSelector.select(
            listOf(danName, rubyName), listOf(danClaim, rubyClaim), pins,
        )
        assertEquals(PinnedSelection.WaitingForPin, r)
    }

    // E — the 💫 Stars CTA icon and the ❤️ reaction are pin-like glyphs but sit OUTSIDE any comment
    //     avatar's lower-right; fake name boxes whose ROI covers them must yield NO pin (false-positive guard).
    @Test
    fun E_starAndReactionIcons_notDetected() {
        val starRoiName = Box(78, 1360, 200, 1390)   // ROI reaches left to the "Send 200 Stars" star
        val heartRoiName = Box(712, 1452, 720, 1482) // ROI reaches left to the ❤️ reaction button
        val pins = PinPixelDetector.detectPins(rubyNez, tpl, listOf(starRoiName, heartRoiName))
        assertEquals("stars/reaction glyphs are not accepted as pins", 0, pins.size)
    }

    // F — device-density tolerance: shrink to 0.8× and enlarge to 1.2×, scale the name box the same, still detects.
    @Test
    fun F_scaleTolerance_downAndUp() {
        for (f in doubleArrayOf(0.8, 1.2)) {
            val img = PinFixtures.rescale(rubyNez, f)
            val nb = Box(
                (nezName.box.left * f).toInt(), (nezName.box.top * f).toInt(),
                (nezName.box.right * f).toInt(), (nezName.box.bottom * f).toInt(),
            )
            val pins = PinPixelDetector.detectPins(img, tpl, listOf(nb))
            assertTrue("pin must survive ${f}× rescale", pins.isNotEmpty())
        }
    }

    // G — compression / anti-alias softening (3×3 blur) still detects the pin.
    @Test
    fun G_compressionSoftening_stillDetects() {
        val soft = PinFixtures.softBlur(rubyNez)
        val pins = PinPixelDetector.detectPins(soft, tpl, boxesOf(nezName))
        assertTrue("pin must survive mild softening", pins.isNotEmpty())
    }

    // H — TWO real pins (Nez's pin copied onto Ruby's avatar) → NeedsReview (never auto-pick one of two).
    @Test
    fun H_twoRealPins_needsReview() {
        val twoPins = PinFixtures.pasteRegion(rubyNez, rubyNez, Box(40, 1250, 90, 1295), 40, 1150)
        val pins = PinPixelDetector.detectPins(twoPins, tpl, boxesOf(rubyName, nezName))
        assertEquals("both avatars now carry a pin", 2, pins.size)
        val r = PinnedCommentSelector.select(
            listOf(rubyName, nezName), listOf(rubyClaim, nezClaim), pins,
        )
        assertEquals(PinnedSelection.NeedsReview, r)
    }

    // H2 — the LIVE path samples every 2nd pixel (stride=2) for speed; the pins must still be found.
    @Test
    fun H2_liveStride2_stillDetects() {
        val g = PinPixelDetector.detectPins(glaiza, tpl, boxesOf(glaizaName), stride = 2)
        assertEquals("Glaiza pin at stride=2", 1, g.size)
        val rn = PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName, nezName), stride = 2)
        assertEquals("only Nez pin at stride=2", 1, rn.size)
    }

    // I — runtime budget. Reports both stride=1 (full accuracy, used by the other tests) and stride=2
    //     (the LIVE path config). Asserts the live config, which is what the ~1s print budget must fit.
    @Test
    fun I_runtimeIsFast() {
        fun timeMs(block: () -> Unit): Double {
            val t = System.nanoTime(); block(); return (System.nanoTime() - t) / 1_000_000.0
        }
        // warm up the JIT so the reported numbers reflect steady state
        repeat(3) {
            PinPixelDetector.detectPins(glaiza, tpl, boxesOf(glaizaName))
            PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName, nezName), stride = 2)
        }
        val g1 = timeMs { PinPixelDetector.detectPins(glaiza, tpl, boxesOf(glaizaName)) }
        val r1 = timeMs { PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName, nezName)) }
        val g2 = timeMs { PinPixelDetector.detectPins(glaiza, tpl, boxesOf(glaizaName), stride = 2) }
        val r2 = timeMs { PinPixelDetector.detectPins(rubyNez, tpl, boxesOf(danName, rubyName, nezName), stride = 2) }
        println(
            "PIN-DETECT-MS stride1 glaiza=%.1f ruby_nez=%.1f | LIVE stride2 glaiza=%.1f ruby_nez=%.1f"
                .format(g1, r1, g2, r2),
        )
        assertTrue("live (stride=2) detect must be well under budget (g=$g2 r=$r2)", g2 < 250 && r2 < 250)
    }
}
