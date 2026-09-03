package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/**
 * BOX CAPTURE overlay (Owner-approved reference, 2026-09-03). Draws ONLY the Capture Box: a thin gold
 * PLAIN-RECTANGLE outline (clean square corners — no notch), a transparent interior (comments stay
 * readable), and a nested lower-right resize corner while editing.
 *
 * The Lock + Check controls are NOT drawn here — they are a SEPARATE small circular window OUTSIDE the
 * box's upper-right ([BoxControlsView]), owned by the service, so they never enter the OCR crop.
 *
 * The OCR content ROI is exactly this rectangle (the window bounds — see CaptureRoi/toPixelRoi).
 * Draw-only; the whole view is hidden during the screenshot so no gold pixel can contaminate OCR.
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

    /** The visual outline: a clean gold rectangle (Owner-approved 2026-09-03 — no notch, square corners).
     *  The stroke is kept fully inside the window so it matches the OCR crop rectangle exactly. */
    private fun outlinePath(): Path {
        val w = width.toFloat(); val h = height.toFloat()
        val i = stroke.strokeWidth
        return Path().apply {
            moveTo(i, i)
            lineTo(w - i, i)       // top
            lineTo(w - i, h - i)   // right
            lineTo(i, h - i)       // bottom
            close()                // left
        }
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawPath(outlinePath(), stroke)
        if (editUi) drawResizeGrip(canvas)
    }

    /** The nested lower-right resize corner (Owner reference): an inner L-bracket set in from the bottom-
     *  right corner plus a short diagonal tick pointing to it — a clear, gold, integrated affordance. */
    private fun drawResizeGrip(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val i = stroke.strokeWidth
        val s = 20f * d          // bracket arm length
        val off = 8f * d         // inset from the visible corner
        val gx = w - i - off; val gy = h - i - off
        canvas.drawLine(gx - s, gy, gx, gy, grip)  // ─ bottom arm
        canvas.drawLine(gx, gy - s, gx, gy, grip)  // │ right arm
        // diagonal tick pointing into the corner
        canvas.drawLine(gx - s * 0.55f, gy - s * 0.55f, gx - s * 0.12f, gy - s * 0.12f, grip)
    }
}
