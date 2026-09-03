package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View

/** Which external control a touch hit. */
enum class BoxControl { NONE, LOCK, CHECK }

/**
 * The Lock + Check controls (Owner 2026-09-02, approved reference) — a SEPARATE small overlay row that
 * sits OUTSIDE the Capture Box's upper-right, so it is never part of the OCR crop. Two COMPACT gold
 * circles (~32dp visible) with charcoal icons (~22dp): a padlock (open = unlocked, closed = locked) and
 * a check (Done). Icons only, no text labels. The touch targets are a little larger than the visible
 * circles for accessibility, but the visible buttons stay small — never the large yellow discs of the
 * previous version. Hidden during the screenshot, like every overlay decoration.
 */
class BoxControlsView(context: Context) : View(context) {

    /** Padlock state: open shackle when unlocked, closed when locked. */
    var locked: Boolean = false
        set(v) { field = v; invalidate() }

    private val d = resources.displayMetrics.density
    val circle = 32f * d
    val gap = 12f * d
    /** Content size for the host window. */
    val rowW: Int get() = kotlin.math.ceil(circle * 2 + gap).toInt()
    val rowH: Int get() = kotlin.math.ceil(circle).toInt()

    private val gold = Color.parseColor("#E0A81E")
    private val ink = Color.parseColor("#3A3A3A")
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = gold }
    private val icon = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = ink; strokeWidth = 2.4f * d
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val iconFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = ink }

    private fun lockCx() = circle / 2f
    private fun checkCx() = circle + gap + circle / 2f
    private fun cy() = circle / 2f

    /** Which control a touch at (x,y) landed on (touch radius slightly > the visible circle). */
    fun hitControl(x: Float, y: Float): BoxControl {
        val r = circle / 2f + 7f * d
        val yy = cy()
        val dl = (x - lockCx()) * (x - lockCx()) + (y - yy) * (y - yy)
        val dc = (x - checkCx()) * (x - checkCx()) + (y - yy) * (y - yy)
        return when {
            dl <= r * r && dl <= dc -> BoxControl.LOCK
            dc <= r * r -> BoxControl.CHECK
            else -> BoxControl.NONE
        }
    }

    override fun onDraw(canvas: Canvas) {
        val yy = cy()
        canvas.drawCircle(lockCx(), yy, circle / 2f, fill)
        drawLock(canvas, lockCx(), yy)
        canvas.drawCircle(checkCx(), yy, circle / 2f, fill)
        drawCheck(canvas, checkCx(), yy)
    }

    private fun drawLock(canvas: Canvas, cx: Float, cy: Float) {
        val bw = 11f * d; val bh = 8f * d
        val body = RectF(cx - bw / 2, cy, cx + bw / 2, cy + bh)
        canvas.drawRoundRect(body, 2f * d, 2f * d, iconFill)
        val sr = bw * 0.42f
        val arc = RectF(cx - sr, body.top - sr * 1.9f, cx + sr, body.top + sr * 0.3f)
        if (locked) {
            canvas.drawArc(arc, 180f, 180f, false, icon)
        } else {
            // open shackle: rotate it slightly ajar
            canvas.save(); canvas.rotate(22f, cx + sr, body.top)
            canvas.drawArc(arc, 180f, 180f, false, icon); canvas.restore()
        }
    }

    private fun drawCheck(canvas: Canvas, cx: Float, cy: Float) {
        val p = Path()
        p.moveTo(cx - 6f * d, cy)
        p.lineTo(cx - 1.5f * d, cy + 5f * d)
        p.lineTo(cx + 6.5f * d, cy - 5.5f * d)
        canvas.drawPath(p, icon)
    }
}
