package com.mineflow.capture.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Box Capture ROI model — normalized coords + safe pixel mapping (PHASE 4 + PHASE 15). */
class CaptureRoiTest {

    @Test
    fun default_isValid_and_mapsToExpectedPixels() {
        val roi = CaptureRoi.default()
        assertTrue(roi.isValid())
        // 1080×2400 (a common portrait phone).
        val px = roi.toPixelRoi(1080, 2400)!!
        assertEquals(Math.round(0.176f * 1080), px.left)
        assertEquals(Math.round(0.60f * 2400), px.top)
        assertEquals(Math.round(0.648f * 1080), px.width)
        assertEquals(Math.round(0.042f * 2400), px.height)
        // Fully inside the bitmap.
        assertTrue(px.left + px.width <= 1080)
        assertTrue(px.top + px.height <= 2400)
    }

    @Test
    fun offScreen_box_isInvalid_andCropsToNull() {
        assertFalse(CaptureRoi(0.9f, 0f, 0.5f, 0.5f).isValid()) // left+width > 1
        assertNull(CaptureRoi(0.9f, 0f, 0.5f, 0.5f).toPixelRoi(1080, 2400))
        assertFalse(CaptureRoi(0f, 0.8f, 0.5f, 0.5f).isValid()) // top+height > 1
        assertFalse(CaptureRoi(-0.1f, 0f, 0.5f, 0.2f).isValid()) // negative left
    }

    @Test
    fun tooSmall_box_isInvalid() {
        assertFalse(CaptureRoi(0.1f, 0.1f, 0.02f, 0.2f).isValid()) // width < MIN_FRACTION
        assertFalse(CaptureRoi(0.1f, 0.1f, 0.2f, 0.02f).isValid()) // height < MIN_HEIGHT_FRACTION
    }

    // Owner 2026-09-02 (reference): the box may be SHORT (hug one comment), but a hairline-thin box is
    // still rejected. A height below MIN_HEIGHT_FRACTION (0.045) is invalid; a short one-comment box is ok.
    @Test
    fun shallowBox_belowOneCommentMinimum_isInvalid() {
        assertFalse(CaptureRoi(0.1f, 0.1f, 0.5f, 0.03f).isValid()) // height < MIN_HEIGHT_FRACTION
        assertTrue(CaptureRoi(0.1f, 0.1f, 0.5f, 0.06f).isValid())  // short but usable → ok
    }

    @Test
    fun belowMinimumPixels_returnsNull_evenWhenNormalizedValid() {
        // width 0.06 of a 200px-wide screen = 12px < MIN_PX (40) → no crop (height kept valid at 0.10).
        val roi = CaptureRoi(0.1f, 0.1f, 0.06f, 0.10f)
        assertTrue(roi.isValid())
        assertNull(roi.toPixelRoi(200, 200))
        // Same box on a full-size screen is fine (width 65px, height 240px both clear the floors).
        assertTrue(roi.toPixelRoi(1080, 2400) != null)
    }

    // A crop that is wide enough but SHORTER than MIN_HEIGHT_PX yields no crop (one-comment pixel floor).
    @Test
    fun belowMinimumHeightPixels_returnsNull() {
        // height 0.08 of an 800px-tall screen = 64px < MIN_HEIGHT_PX (72) → null; width is ample.
        val roi = CaptureRoi(0.1f, 0.1f, 0.6f, 0.08f)
        assertTrue(roi.isValid())
        assertNull(roi.toPixelRoi(1080, 800))
    }

    @Test
    fun roundingOvershoot_isClampedInsideTheBitmap() {
        // A box that reaches the far edge must never produce left+width > screenW.
        val roi = CaptureRoi(0.5f, 0.5f, 0.5f, 0.5f)
        val px = roi.toPixelRoi(1081, 2401)!!
        assertTrue(px.left + px.width <= 1081)
        assertTrue(px.top + px.height <= 2401)
    }

    @Test
    fun zeroOrNegativeScreen_returnsNull() {
        assertNull(CaptureRoi.default().toPixelRoi(0, 2400))
        assertNull(CaptureRoi.default().toPixelRoi(1080, 0))
    }

    @Test
    fun normalized_clampsAnEditedBoxBackOnScreen() {
        // Dragged partly off the right/bottom → clamped so it stays fully on screen.
        val n = CaptureRoi(0.8f, 0.9f, 0.5f, 0.4f).normalized()
        assertTrue(n.isValid())
        assertTrue(n.left + n.width <= 1f + 0.001f)
        assertTrue(n.top + n.height <= 1f + 0.001f)
    }

}
