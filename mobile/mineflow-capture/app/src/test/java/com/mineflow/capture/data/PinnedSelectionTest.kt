package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Owner 2026-08-29 — PIN-GATED selection decision core (visual pin badge = eligibility gate). These
 * exercise the DECISION logic with synthetic geometry that mirrors the two supplied Facebook layouts
 * (avatar at the block's left edge; pin overlaps the avatar's lower-right; name right of the avatar,
 * claim directly below). The pixel DETECTOR that produces PinMarkers is a separate component (pending
 * the real pin-badge image file); here we prove the rule given its output.
 */
class PinnedSelectionTest {

    private fun name(text: String, top: Int, left: Int = 95, right: Int = 320) =
        OLine(text, Box(left, top, right, top + 40))

    private fun claim(text: String, top: Int, left: Int = 95, right: Int = 230) =
        OLine(text, Box(left, top, right, top + 34))

    // A — Glaiza pinned → eligible (Glaiza / Mine 8.9).
    @Test
    fun A_glaizaPinned_selected() {
        val n = name("Glaiza Sale Galang", 1695, left = 120, right = 410)
        val c = claim("Mine 8.9", 1745, left = 120, right = 260)
        val pin = PinMarker(Box(85, 1748, 122, 1782), 0.9) // on Glaiza avatar's lower-right
        val r = PinnedCommentSelector.select(listOf(n), listOf(c), listOf(pin))
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Glaiza Sale Galang", r.name.text)
        assertEquals("Mine 8.9", r.claim?.text)
    }

    // B — Ruby (no pin) vs Nez (pin) → Nez selected, Ruby ignored (never Needs Review despite same 1.72).
    @Test
    fun B_rubyNoPin_nezPin_selectsNez() {
        val ruby = name("Ruby Rose", 1130)
        val rubyClaim = claim("mine 1.72", 1178)
        val nez = name("Nez Candava", 1240)
        val nezClaim = claim("1.72", 1288, right = 170)
        val pinNez = PinMarker(Box(58, 1288, 97, 1322), 0.9) // on Nez avatar
        val r = PinnedCommentSelector.select(listOf(ruby, nez), listOf(rubyClaim, nezClaim), listOf(pinNez))
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Nez Candava", r.name.text)
        assertEquals("1.72", r.claim?.text)
    }

    // C — same screen, NO pin → Waiting for Pinned Comment (no auto-selection).
    @Test
    fun C_sameScreenNoPin_waiting() {
        val ruby = name("Ruby Rose", 1130)
        val rubyClaim = claim("mine 1.72", 1178)
        val nez = name("Nez Candava", 1240)
        val nezClaim = claim("1.72", 1288)
        val r = PinnedCommentSelector.select(listOf(ruby, nez), listOf(rubyClaim, nezClaim), emptyList())
        assertEquals(PinnedSelection.WaitingForPin, r)
    }

    // D — a perfectly valid bottom comment but NO pin → no automatic selection (Waiting).
    @Test
    fun D_validBottomNoPin_waiting() {
        val n = name("King Gonzales", 1240)
        val c = claim("Mine 10", 1288)
        val r = PinnedCommentSelector.select(listOf(n), listOf(c), emptyList())
        assertEquals(PinnedSelection.WaitingForPin, r)
    }

    // E — TWO pins (both customers pinned) → Needs Review (never auto-pick one).
    @Test
    fun E_twoPins_needsReview() {
        val ruby = name("Ruby Rose", 1130)
        val rubyClaim = claim("mine 1.72", 1178)
        val nez = name("Nez Candava", 1240)
        val nezClaim = claim("1.72", 1288)
        val pinRuby = PinMarker(Box(58, 1178, 97, 1212), 0.9)
        val pinNez = PinMarker(Box(58, 1288, 97, 1322), 0.9)
        val r = PinnedCommentSelector.select(
            listOf(ruby, nez), listOf(rubyClaim, nezClaim), listOf(pinRuby, pinNez),
        )
        assertEquals(PinnedSelection.NeedsReview, r)
    }

    // F — a high-confidence pin-like match OUTSIDE any avatar geometry → not accepted → Waiting.
    @Test
    fun F_pinOutsideAvatarGeometry_rejected_waiting() {
        val n = name("King Gonzales", 1240)
        val c = claim("Mine 10", 1288)
        val stray = PinMarker(Box(500, 400, 540, 440), 0.95) // strong template match, but not on an avatar
        val r = PinnedCommentSelector.select(listOf(n), listOf(c), listOf(stray))
        assertEquals(PinnedSelection.WaitingForPin, r)
    }

    // K — pinned valid customer + a nameless scene number "220" → pinned customer wins; 220 irrelevant.
    @Test
    fun K_pinnedCustomer_sceneNumberIgnored() {
        val n = name("Marivic Bantigue", 1240, right = 340)
        val c = claim("Mine 0.97", 1288, right = 220)
        val scene = claim("220", 900, left = 400, right = 470) // scene noise, elsewhere on screen
        val pin = PinMarker(Box(58, 1288, 97, 1322), 0.9)
        val r = PinnedCommentSelector.select(listOf(n), listOf(c, scene), listOf(pin))
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Marivic Bantigue", r.name.text)
        assertEquals("Mine 0.97", r.claim?.text)
    }

    // L — pinned customer + a DIFFERENT-valued UNPINNED customer → pinned selected; no competition review.
    @Test
    fun L_pinnedVsUnpinned_diffValues_selectsPinned() {
        val a = name("Customer A", 1130)
        val ac = claim("Mine .44", 1178)
        val b = name("Customer B", 1240)
        val bc = claim("Mine .99", 1288)
        val pinB = PinMarker(Box(58, 1288, 97, 1322), 0.9)
        val r = PinnedCommentSelector.select(listOf(a, b), listOf(ac, bc), listOf(pinB))
        assertTrue("expected Selected", r is PinnedSelection.Selected)
        r as PinnedSelection.Selected
        assertEquals("Customer B", r.name.text)
        assertEquals("Mine .99", r.claim?.text)
    }

    // A below-confidence pin is ignored (the detector threshold is respected) → Waiting.
    @Test
    fun belowConfidencePin_ignored_waiting() {
        val n = name("King Gonzales", 1240)
        val c = claim("Mine 10", 1288)
        val weak = PinMarker(Box(60, 1288, 97, 1322), 0.3)
        val r = PinnedCommentSelector.select(listOf(n), listOf(c), listOf(weak))
        assertEquals(PinnedSelection.WaitingForPin, r)
    }
}
