package com.mineflow.capture.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View

/** Which on-box control a touch landed on (Owner 2026-09-02, Box Capture v2). */
enum class BoxControl { NONE, DONE, LOCK, RESIZE }

/**
 * BOX CAPTURE overlay (Owner 2026-09-02, v2 — controls ON the box). The visible Capture Box the
 * operator moves/resizes/locks over the Facebook comment area. Its editing controls live ON the box
 * so the operator never has to return to the dashboard to finish positioning:
 *   • UNLOCKED: a thin gold outline + a subtle interior wash, a DONE (✓) and LOCK cluster at the
 *     UPPER-RIGHT, and a resize grip at the BOTTOM-RIGHT corner.
 *   • LOCKED: just a clean outline (the tiny tap-to-unlock lock CHIP is a separate small window so the
 *     comments under the locked box stay tappable — drawn by the service, not here).
 *
 * Draw-only. Position/size + touch routing are owned by OverlayCaptureService via the window
 * LayoutParams + [hitControl]. The whole view is HIDDEN during the screenshot, so NONE of these
 * decorations (border, icons, grip) can ever contaminate the OCR bitmap.
 */
class CaptureBoxView(context: Context) : View(context) {

    /** Locked hides the edit controls/handles and shows the plain outline; unlocked shows them. */
    var locked: Boolean = false
        set(value) {
            field = value
            invalidate()
        }

    private val d = resources.displayMetrics.density
    /** Corner resize-grip half-size in px (touch target ~2×). Read by the service's touch listener. */
    val handlePx: Float = 20f * d

    private val pad = 8f * d
    private val ctrlSize = 40f * d      // DONE / LOCK touch target
    private val gap = 8f * d
    private val resizeSize = 44f * d    // bottom-right resize touch area

    private val gold = Color.parseColor("#C9A227")
    private val ink = Color.parseColor("#111111")
    private val ivory = Color.parseColor("#F5EFE0")

    private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = gold; strokeWidth = 2f * d
    }
    private val interior = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL; color = Color.argb(20, 201, 162, 39) // ~8% gold wash
    }
    private val chipBg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.argb(220, 17, 17, 17) }
    private val chipRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = gold; strokeWidth = 1.5f * d }
    private val iconStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = ivory; strokeWidth = 2.4f * d
        strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    private val iconFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = ivory }
    private val grip = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = gold; strokeWidth = 2f * d; strokeCap = Paint.Cap.ROUND
    }

    // --- Control geometry (top-right cluster + bottom-right grip) ---------------
    private fun lockRect(): RectF {
        val w = width.toFloat()
        return RectF(w - pad - ctrlSize, pad, w - pad, pad + ctrlSize)
    }
    private fun doneRect(): RectF {
        val l = lockRect()
        return RectF(l.left - gap - ctrlSize, pad, l.left - gap, pad + ctrlSize)
    }
    private fun resizeRect(): RectF {
        val w = width.toFloat(); val h = height.toFloat()
        return RectF(w - resizeSize, h - resizeSize, w, h)
    }

    /** Which control a touch at (x,y) — in view pixels — landed on. Only meaningful while UNLOCKED. */
    fun hitControl(x: Float, y: Float): BoxControl = when {
        locked -> BoxControl.NONE
        doneRect().contains(x, y) -> BoxControl.DONE
        lockRect().contains(x, y) -> BoxControl.LOCK
        resizeRect().contains(x, y) -> BoxControl.RESIZE
        else -> BoxControl.NONE
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val inset = border.strokeWidth
        if (!locked) canvas.drawRect(inset, inset, w - inset, h - inset, interior)
        canvas.drawRect(inset, inset, w - inset, h - inset, border)
        if (locked) return // clean border only; the tap-to-unlock chip is a separate small window

        drawControl(canvas, doneRect()) { r -> drawCheck(canvas, r) }
        drawControl(canvas, lockRect()) { r -> drawLock(canvas, r, closed = true) }
        drawGrip(canvas, resizeRect())
    }

    private inline fun drawControl(canvas: Canvas, r: RectF, icon: (RectF) -> Unit) {
        val rad = 8f * d
        canvas.drawRoundRect(r, rad, rad, chipBg)
        canvas.drawRoundRect(r, rad, rad, chipRing)
        icon(r)
    }

    /** A checkmark inside r. */
    private fun drawCheck(canvas: Canvas, r: RectF) {
        val p = Path()
        p.moveTo(r.left + r.width() * 0.26f, r.top + r.height() * 0.52f)
        p.lineTo(r.left + r.width() * 0.44f, r.top + r.height() * 0.70f)
        p.lineTo(r.left + r.width() * 0.76f, r.top + r.height() * 0.32f)
        canvas.drawPath(p, iconStroke)
    }

    /** A small padlock inside r (closed shackle). */
    private fun drawLock(canvas: Canvas, r: RectF, closed: Boolean) {
        val bw = r.width() * 0.46f
        val bh = r.height() * 0.34f
        val cx = r.centerX()
        val bodyTop = r.top + r.height() * 0.48f
        val body = RectF(cx - bw / 2, bodyTop, cx + bw / 2, bodyTop + bh)
        canvas.drawRoundRect(body, 2.5f * d, 2.5f * d, iconFill)
        // shackle: a top arc sitting on the body
        val sr = bw * 0.62f
        val arc = RectF(cx - sr, bodyTop - sr * (if (closed) 1.15f else 1.35f), cx + sr, bodyTop + sr * 0.15f)
        canvas.drawArc(arc, 180f, 180f, false, iconStroke)
    }

    /** A bottom-right resize grip: two short diagonal strokes. */
    private fun drawGrip(canvas: Canvas, r: RectF) {
        val inset = 10f * d
        canvas.drawLine(r.right - inset, r.bottom - inset * 2.2f, r.right - inset * 2.2f, r.bottom - inset, grip)
        canvas.drawLine(r.right - inset, r.bottom - inset * 1.1f, r.right - inset * 1.1f, r.bottom - inset, grip)
    }
}
