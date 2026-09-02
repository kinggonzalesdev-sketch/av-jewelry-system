package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/**
 * The tiny tap-to-unlock LOCK chip shown at the LOCKED Capture Box's upper-right (Owner 2026-09-02,
 * Box Capture v2). It is a SEPARATE small overlay window — not part of the box outline — so the locked
 * box itself can stay NOT_TOUCHABLE (comments under it remain tappable) while this ~34dp chip is the
 * one small touchable spot that returns to Edit Mode. Hidden during the screenshot like every overlay.
 */
class LockChipView(context: Context) : View(context) {
    private val d = resources.displayMetrics.density
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.argb(220, 17, 17, 17) }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.parseColor("#C9A227"); strokeWidth = 1.5f * d }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = Color.parseColor("#F5EFE0"); strokeWidth = 2.2f * d
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.parseColor("#F5EFE0") }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val r = minOf(w, h) / 2f - 1.5f * d
        canvas.drawCircle(w / 2f, h / 2f, r, bg)
        canvas.drawCircle(w / 2f, h / 2f, r, ring)
        // padlock (closed)
        val bw = w * 0.34f
        val bh = h * 0.24f
        val cx = w / 2f
        val bodyTop = h * 0.50f
        val body = RectF(cx - bw / 2, bodyTop, cx + bw / 2, bodyTop + bh)
        canvas.drawRoundRect(body, 2f * d, 2f * d, fill)
        val sr = bw * 0.6f
        val arc = RectF(cx - sr, bodyTop - sr * 1.15f, cx + sr, bodyTop + sr * 0.15f)
        canvas.drawArc(arc, 180f, 180f, false, stroke)
    }
}
