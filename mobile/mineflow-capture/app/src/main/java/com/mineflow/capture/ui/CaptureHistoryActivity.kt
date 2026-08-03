package com.mineflow.capture.ui

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.text.format.Formatter
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.mineflow.capture.data.CaptureDraftStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Capture History (Phase 1): a simple local list of DRAFT screenshots stored in
 * app-private storage. View opens the read-only preview; Delete Draft removes it.
 * No upload, retry-send, retry-print, or order status here — later phases.
 */
class CaptureHistoryActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#8C7C55")
    private val black = Color.parseColor("#0B0B0B")
    private val surface = Color.parseColor("#141414")

    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(black)
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        root.addView(
            TextView(this).apply {
                text = "Capture History"
                textSize = 20f
                setTextColor(ivory)
                setPadding(0, 0, 0, dp(12))
            },
            wide(),
        )
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list, wide())
        setContentView(ScrollView(this).apply { setBackgroundColor(black); addView(root) })
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        list.removeAllViews()
        val drafts = CaptureDraftStore.get(this).listDrafts()
        if (drafts.isEmpty()) {
            list.addView(
                TextView(this).apply {
                    text = "No saved drafts yet. Tap the floating Capture Mine button, then Save Draft."
                    setTextColor(beige)
                    setPadding(0, dp(8), 0, 0)
                },
                wide(),
            )
            return
        }
        val fmt = SimpleDateFormat("MMM d, yyyy · h:mm a", Locale.getDefault())
        for (d in drafts) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setBackgroundColor(surface)
                setPadding(dp(10), dp(10), dp(10), dp(10))
            }
            val thumb = ImageView(this).apply {
                val bmp = BitmapFactory.Options().apply { inSampleSize = 8 }
                setImageBitmap(BitmapFactory.decodeFile(d.filePath, bmp))
                scaleType = ImageView.ScaleType.CENTER_CROP
            }
            row.addView(thumb, LinearLayout.LayoutParams(dp(64), dp(64)))

            val info = TextView(this).apply {
                setTextColor(ivory)
                textSize = 12f
                setPadding(dp(10), 0, dp(6), 0)
                text = buildString {
                    append("${fmt.format(Date(d.capturedAtEpochMs))}\n")
                    append("👤 ${d.capturedBy}\n")
                    append("${d.status} · ${Formatter.formatShortFileSize(this@CaptureHistoryActivity, d.sizeBytes)}")
                }
            }
            row.addView(info, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

            val actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            actions.addView(
                Button(this).apply {
                    text = "View"; isAllCaps = false
                    setTextColor(Color.parseColor("#111111")); setBackgroundColor(gold)
                    setOnClickListener { PreviewActivity.openDraft(this@CaptureHistoryActivity, d.id) }
                },
            )
            actions.addView(
                Button(this).apply {
                    text = "Delete"; isAllCaps = false
                    setTextColor(ivory); setBackgroundColor(Color.TRANSPARENT)
                    setOnClickListener {
                        CaptureDraftStore.get(this@CaptureHistoryActivity).deleteDraft(d.id)
                        render()
                    }
                },
            )
            row.addView(actions, ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)

            list.addView(row, wide().apply { topMargin = dp(8) })
        }
    }

    private fun wide() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        fun open(context: Context) {
            context.startActivity(Intent(context, CaptureHistoryActivity::class.java))
        }
    }
}
