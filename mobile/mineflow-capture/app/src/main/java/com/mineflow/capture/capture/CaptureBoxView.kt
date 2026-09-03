package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/**
 * BOX CAPTURE overlay (Owner 2026-09-02, matches the approved reference image). Draws ONLY the Capture
 * Box: a thin gold outline with a distinctive NOTCHED UPPER-LEFT corner (a two-step staircase), a
 * transparent interior (comments stay readable), and a small lower-right resize grip while editing.
 *
 * The Lock + Check controls are NOT drawn here — they are a SEPARATE small circular window OUTSIDE the
 * box's upper-right ([BoxControlsView]), owned by the service, so they never enter the OCR crop.
 *
 * IMPORTANT — visualPath vs contentCropBounds: the notch is DECORATION on the drawn outline only. The
 * OCR content ROI is the plain rectangle of the window bounds (see CaptureRoi/toPixelRoi); the notch
 * never trims the crop, so Facebook text is never lost to the decorative corner. Draw-only; the whole
 * view is hidden during the screenshot so no gold pixel can contaminate OCR.
 */
class CaptureBoxView(context: Context) : View(context) {

    /** Edit mode → the lower-right resize grip is drawn. Check (Done) sets this false → outline only. */
    var editUi: Boolean = true
        set(v) { field = v; invalidate() }

    private val d = resources.displayMetrics.density
    /** Lower-right resize-grip touch radius — the service hit-tests this corner for resize vs drag. */
    val gripTouchPx: Float = 26f * d

    private val gold = Color.parseColor("#E0A81E") // reference gold/yellow
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = gold; strokeWidth = 3f * d
        strokeJoin = Paint.Join.MITER; strokeCap = Paint.Cap.SQUARE
    }
    private val grip = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = gold; strokeWidth = 3f * d; strokeCap = Paint.Cap.ROUND
    }

    /**
     * The notched visual outline (Owner 2026-09-02 approved reference) — exactly ONE clean notch in the
     * upper-left, NOT a staircase. The far-left edge begins LOWER than the main top border; going
     * clockwise from the bottom-left it rises, makes ONE short horizontal segment right, ONE vertical
     * rise up, then the main long top border. The other three corners are square. Proportional to the
     * box (~9% width, ~26% height) so it stays subtle and never oversized. This math is mirrored in the
     * SVG design preview so the on-screen shape matches the reference.
     */
    private fun outlinePath(): Path {
        val w = width.toFloat(); val h = height.toFloat()
        val i = stroke.strokeWidth // keep the stroke fully inside the window
        val innerH = (h - 2 * i).coerceAtLeast(1f)
        val nx = i + 0.09f * w        // notch horizontal width ~9% of the box width
        val ny = i + 0.26f * innerH   // notch vertical rise ~26% of the box height
        return Path().apply {
            moveTo(w - i, i)       // top-right
            lineTo(w - i, h - i)   // → bottom-right (right edge)
            lineTo(i, h - i)       // → bottom-left (bottom edge)
            lineTo(i, ny)          // → up the far-left edge to the notch (it starts LOWER than the top)
            lineTo(nx, ny)         // → ONE short horizontal segment right
            lineTo(nx, i)          // → ONE vertical rise up to the top border
            close()                // → the main long top border back to top-right
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawPath(outlinePath(), stroke)
        if (editUi) drawResizeGrip(canvas)
    }

    /** A small, subtle lower-right resize affordance: an inside L-bracket plus a short diagonal tick. */
    private fun drawResizeGrip(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val i = stroke.strokeWidth
        val s = 15f * d
        val gx = w - i - 5f * d; val gy = h - i - 5f * d
        canvas.drawLine(gx - s, gy, gx, gy, grip)              // ─
        canvas.drawLine(gx, gy - s, gx, gy, grip)              // │
        canvas.drawLine(gx - s * 0.62f, gy - s * 0.62f, gx - s * 0.18f, gy - s * 0.18f, grip) // ╲ tick
    }
}
