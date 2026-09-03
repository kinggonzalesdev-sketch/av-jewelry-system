package com.mineflow.capture.capture

/**
 * Pure, JVM-testable gesture math for the Capture Box (Owner 2026-09-02) — hit-testing which edge /
 * corner / interior a touch fell on, and applying a drag delta to the box window rect. No android.*
 * so it is unit-tested directly; the service (OverlayCaptureService) owns the actual windows + touch
 * events and delegates the geometry here.
 *
 * The box WINDOW is the visible box (no extra padding). Each edge has an INVISIBLE touch band `band`
 * px thick just inside the visible border, so the thin gold outline is never thickened yet every edge
 * is easy to grab. Corners (both bands) take priority; the deep interior is MOVE.
 */
enum class ResizeZone { NONE, MOVE, TOP, BOTTOM, LEFT, RIGHT, TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT }

/** A window rectangle in screen px. */
data class WinRect(val x: Int, val y: Int, val w: Int, val h: Int)

object BoxGesture {

    private val LEFT_ZONES = setOf(ResizeZone.LEFT, ResizeZone.TOP_LEFT, ResizeZone.BOTTOM_LEFT)
    private val RIGHT_ZONES = setOf(ResizeZone.RIGHT, ResizeZone.TOP_RIGHT, ResizeZone.BOTTOM_RIGHT)
    private val TOP_ZONES = setOf(ResizeZone.TOP, ResizeZone.TOP_LEFT, ResizeZone.TOP_RIGHT)
    private val BOTTOM_ZONES = setOf(ResizeZone.BOTTOM, ResizeZone.BOTTOM_LEFT, ResizeZone.BOTTOM_RIGHT)

    /**
     * Which zone a touch at (x,y) — in box-window-local px — falls in. `band` is the edge touch-zone
     * thickness (just inside each border). Corners win over single edges; the interior (away from all
     * edges) is MOVE; a touch outside the window is NONE.
     */
    fun hitZone(w: Int, h: Int, band: Int, x: Int, y: Int): ResizeZone {
        if (w <= 0 || h <= 0 || x < 0 || y < 0 || x > w || y > h) return ResizeZone.NONE
        // On a very short/narrow box, don't let opposite bands overlap so much that MOVE disappears:
        // cap the band at ~40% of each side so an interior MOVE region always remains.
        val bx = minOf(band, (w * 0.4f).toInt().coerceAtLeast(1))
        val by = minOf(band, (h * 0.4f).toInt().coerceAtLeast(1))
        val nearL = x <= bx
        val nearR = x >= w - bx
        val nearT = y <= by
        val nearB = y >= h - by
        return when {
            nearT && nearL -> ResizeZone.TOP_LEFT
            nearT && nearR -> ResizeZone.TOP_RIGHT
            nearB && nearL -> ResizeZone.BOTTOM_LEFT
            nearB && nearR -> ResizeZone.BOTTOM_RIGHT
            nearT -> ResizeZone.TOP
            nearB -> ResizeZone.BOTTOM
            nearL -> ResizeZone.LEFT
            nearR -> ResizeZone.RIGHT
            else -> ResizeZone.MOVE
        }
    }

    /**
     * Apply a drag delta to the window rect for `zone`, clamped to the screen and to a minimum size
     * (minW × minH). MOVE translates; an edge/corner grows or shrinks the matching side(s). A LEFT/TOP
     * drag moves the origin so the OPPOSITE edge stays put; a RIGHT/BOTTOM drag keeps the origin.
     */
    fun applyResize(
        zone: ResizeZone,
        start: WinRect,
        dx: Int,
        dy: Int,
        screenW: Int,
        screenH: Int,
        minW: Int,
        minH: Int,
    ): WinRect {
        if (zone == ResizeZone.MOVE || zone == ResizeZone.NONE) {
            val x = (start.x + dx).coerceIn(0, (screenW - start.w).coerceAtLeast(0))
            val y = (start.y + dy).coerceIn(0, (screenH - start.h).coerceAtLeast(0))
            return WinRect(x, y, start.w, start.h)
        }
        var x = start.x; var y = start.y; var w = start.w; var h = start.h
        if (zone in RIGHT_ZONES) {
            w = (start.w + dx).coerceIn(minW, (screenW - start.x).coerceAtLeast(minW))
        }
        if (zone in LEFT_ZONES) {
            val nx = (start.x + dx).coerceIn(0, start.x + start.w - minW)
            w = start.w + (start.x - nx)
            x = nx
        }
        if (zone in BOTTOM_ZONES) {
            h = (start.h + dy).coerceIn(minH, (screenH - start.y).coerceAtLeast(minH))
        }
        if (zone in TOP_ZONES) {
            val ny = (start.y + dy).coerceIn(0, start.y + start.h - minH)
            h = start.h + (start.y - ny)
            y = ny
        }
        return WinRect(x, y, w, h)
    }
}
