package com.mineflow.capture.capture

import org.junit.Assert.assertEquals
import org.junit.Test

/** Pure gesture math for edge/corner resize + move (Owner 2026-09-02). */
class BoxGestureTest {

    // ---- hitZone: a 400x200 box, 20px edge band -------------------------------------------------
    private fun z(x: Int, y: Int) = BoxGesture.hitZone(400, 200, 20, x, y)

    @Test fun interior_isMove() { assertEquals(ResizeZone.MOVE, z(200, 100)) }
    @Test fun topEdge() { assertEquals(ResizeZone.TOP, z(200, 5)) }
    @Test fun bottomEdge() { assertEquals(ResizeZone.BOTTOM, z(200, 195)) }
    @Test fun leftEdge() { assertEquals(ResizeZone.LEFT, z(5, 100)) }
    @Test fun rightEdge() { assertEquals(ResizeZone.RIGHT, z(395, 100)) }
    @Test fun topLeftCorner() { assertEquals(ResizeZone.TOP_LEFT, z(5, 5)) }
    @Test fun topRightCorner() { assertEquals(ResizeZone.TOP_RIGHT, z(395, 5)) }
    @Test fun bottomLeftCorner() { assertEquals(ResizeZone.BOTTOM_LEFT, z(5, 195)) }
    @Test fun bottomRightCorner() { assertEquals(ResizeZone.BOTTOM_RIGHT, z(395, 195)) }
    @Test fun outside_isNone() { assertEquals(ResizeZone.NONE, z(500, 100)) }

    // A short box still leaves an interior MOVE region (bands capped at 40% per side).
    @Test fun shortBox_stillHasMoveInterior() {
        // 400x90, band 40 → vertical band capped at 36; center is MOVE, top/bottom are edges.
        assertEquals(ResizeZone.MOVE, BoxGesture.hitZone(400, 90, 40, 200, 45))
        assertEquals(ResizeZone.TOP, BoxGesture.hitZone(400, 90, 40, 200, 3))
        assertEquals(ResizeZone.BOTTOM, BoxGesture.hitZone(400, 90, 40, 200, 87))
    }

    // ---- applyResize --------------------------------------------------------------------------
    private val start = WinRect(100, 100, 400, 200)
    private fun r(zone: ResizeZone, dx: Int, dy: Int) =
        BoxGesture.applyResize(zone, start, dx, dy, 1080, 2400, 64, 96)

    @Test fun move_translates() {
        assertEquals(WinRect(150, 130, 400, 200), r(ResizeZone.MOVE, 50, 30))
    }

    @Test fun rightEdge_growsWidth_originStays() {
        assertEquals(WinRect(100, 100, 460, 200), r(ResizeZone.RIGHT, 60, 0))
    }

    @Test fun bottomEdge_growsHeight_originStays() {
        assertEquals(WinRect(100, 100, 400, 260), r(ResizeZone.BOTTOM, 0, 60))
    }

    @Test fun leftEdge_movesOrigin_oppositeEdgeStays() {
        // drag left edge right by 40 → x 100→140, width 400→360; right edge (x+w=500) unchanged.
        val nr = r(ResizeZone.LEFT, 40, 0)
        assertEquals(WinRect(140, 100, 360, 200), nr)
        assertEquals(500, nr.x + nr.w)
    }

    @Test fun topEdge_movesOrigin_bottomStays() {
        // drag top edge up by 50 → y 100→50, height 200→250; bottom (y+h=300) unchanged.
        val nr = r(ResizeZone.TOP, 0, -50)
        assertEquals(WinRect(100, 50, 400, 250), nr)
        assertEquals(300, nr.y + nr.h)
    }

    @Test fun corner_resizesBothDimensions() {
        assertEquals(WinRect(100, 100, 460, 260), r(ResizeZone.BOTTOM_RIGHT, 60, 60))
    }

    @Test fun minHeight_clamped_draggingBottomUp() {
        // shrink height far below the 96 floor → clamped at 96.
        assertEquals(96, r(ResizeZone.BOTTOM, 0, -400).h)
    }

    @Test fun minWidth_clamped() {
        assertEquals(64, r(ResizeZone.RIGHT, -1000, 0).w)
    }

    @Test fun topEdge_cannotShrinkBelowMin_norPushPastBottom() {
        // drag top edge DOWN a lot → height floors at 96, y moves down but never past (bottom - min).
        val nr = r(ResizeZone.TOP, 0, 1000)
        assertEquals(96, nr.h)
        assertEquals(300, nr.y + nr.h) // bottom edge stays put
    }
}
