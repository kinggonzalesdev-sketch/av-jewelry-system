package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View

/**
 * BOX CAPTURE overlay (Owner 2026-09-02) — the visible Capture Box the operator moves/resizes/locks
 * over the Facebook comment area. Minimal treatment: a thin high-visibility gold outline, a subtle
 * transparent interior (never an opaque panel that hides comments), corner resize handles WHEN
 * UNLOCKED, and a clean outline (+ tiny "Locked" chip) when locked. Draw-only — position/size and
 * touch are owned by OverlayCaptureService via the window LayoutParams. The window is HIDDEN during
 * the screenshot, so nothing here can contaminate OCR.
 */
class CaptureBoxView(context: Context) : View(context) {

    /** Locked hides the resize handles and shows the plain outline; unlocked shows edit affordances. */
    var locked: Boolean = false
        set(value) {
            field = value
            invalidate()
        }

    /** Corner handle half-size in px (touch target ~2×). */
    val handlePx: Float = 22f * resources.displayMetrics.density

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")

    private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = gold
        strokeWidth = 2f * resources.displayMetrics.density
    }
    private val interior = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(20, 201, 162, 39) // ~8% gold wash — subtle, comments still readable
    }
    private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = gold
    }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ivory
        textSize = 11f * resources.displayMetrics.density
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val inset = border.strokeWidth
        canvas.drawRect(inset, inset, w - inset, h - inset, interior)
        canvas.drawRect(inset, inset, w - inset, h - inset, border)

        if (locked) {
            // Tiny "Locked" chip, top-left inside (hidden during capture; also OCR-noise-filtered).
            canvas.drawText("Locked", inset + 6f, inset + label.textSize + 4f, label)
        } else {
            // Corner handles as edit affordances (the bottom-right one resizes; the outline moves).
            val hs = handlePx * 0.5f
            for (cx in floatArrayOf(inset, w - inset)) {
                for (cy in floatArrayOf(inset, h - inset)) {
                    canvas.drawRect(cx - hs, cy - hs, cx + hs, cy + hs, handle)
                }
            }
        }
    }
}
