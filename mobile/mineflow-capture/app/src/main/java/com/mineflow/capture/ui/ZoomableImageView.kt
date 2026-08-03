package com.mineflow.capture.ui

import android.content.Context
import android.graphics.Matrix
import android.graphics.PointF
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import androidx.appcompat.widget.AppCompatImageView
import kotlin.math.min

/**
 * A compact pinch-to-zoom / drag-to-pan image view — no external library. Used to
 * inspect a captured screenshot so staff can confirm Facebook names, item codes,
 * prices, and grams are readable before saving a draft.
 */
class ZoomableImageView(context: Context) : AppCompatImageView(context) {

    private val matrixValues = FloatArray(9)
    private val mtx = Matrix()
    private var scale = 1f
    private val minScale = 1f
    private val maxScale = 6f

    private val last = PointF()
    private var dragging = false

    private val scaleDetector = ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                val factor = detector.scaleFactor
                val newScale = (scale * factor).coerceIn(minScale, maxScale)
                val applied = newScale / scale
                scale = newScale
                mtx.postScale(applied, applied, detector.focusX, detector.focusY)
                clamp()
                mtx.let { setImageMatrix(it) }
                return true
            }
        },
    )

    init {
        scaleType = ScaleType.MATRIX
        setImageMatrix(mtx)
    }

    @Suppress("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                last.set(event.x, event.y)
                dragging = scale > minScale
            }
            MotionEvent.ACTION_MOVE -> if (dragging && !scaleDetector.isInProgress) {
                mtx.postTranslate(event.x - last.x, event.y - last.y)
                clamp()
                setImageMatrix(mtx)
                last.set(event.x, event.y)
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
        }
        parent?.requestDisallowInterceptTouchEvent(scale > minScale)
        return true
    }

    /** Keep the image within the view bounds; recentre when fully zoomed out. */
    private fun clamp() {
        val d = drawable ?: return
        mtx.getValues(matrixValues)
        val transX = matrixValues[Matrix.MTRANS_X]
        val transY = matrixValues[Matrix.MTRANS_Y]
        val scaledW = d.intrinsicWidth * matrixValues[Matrix.MSCALE_X]
        val scaledH = d.intrinsicHeight * matrixValues[Matrix.MSCALE_Y]
        val fixX = axisFix(transX, scaledW, width.toFloat())
        val fixY = axisFix(transY, scaledH, height.toFloat())
        if (fixX != 0f || fixY != 0f) mtx.postTranslate(fixX, fixY)
    }

    private fun axisFix(trans: Float, content: Float, view: Float): Float {
        val minTrans: Float
        val maxTrans: Float
        if (content <= view) {
            minTrans = (view - content) / 2f
            maxTrans = minTrans
        } else {
            minTrans = view - content
            maxTrans = 0f
        }
        return when {
            trans < minTrans -> minTrans - trans
            trans > maxTrans -> maxTrans - trans
            else -> 0f
        }
    }

    /** Fit the freshly-set image into the view (centre + scale to width). */
    fun resetToFit() {
        val d = drawable ?: return
        if (width == 0 || height == 0) {
            post { resetToFit() }
            return
        }
        val fit = min(width.toFloat() / d.intrinsicWidth, height.toFloat() / d.intrinsicHeight)
        scale = minScale
        mtx.reset()
        mtx.postScale(fit, fit)
        val dx = (width - d.intrinsicWidth * fit) / 2f
        val dy = (height - d.intrinsicHeight * fit) / 2f
        mtx.postTranslate(dx, dy)
        setImageMatrix(mtx)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        resetToFit()
    }
}
