package com.mineflow.capture.ui

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.text.format.Formatter
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.mineflow.capture.data.ApiClient
import com.mineflow.capture.data.CaptureDraftStore
import com.mineflow.capture.data.ScreenshotOcr
import com.mineflow.capture.data.SecureStore
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Screenshot preview (Phase 1: capture only). Two modes:
 *   - CAPTURE: a fresh temp screenshot → Retake · Save Draft · Discard.
 *   - VIEW: an existing saved draft (from Capture History) → Close · Delete Draft.
 *
 * It shows ONLY the image + capture metadata + zoom/pan. NO Create Order, Send,
 * Print, Pancake, or OCR — those belong to later phases.
 */
class PreviewActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#8C7C55")
    private val black = Color.parseColor("#0B0B0B")

    private var mode = MODE_CAPTURE
    private var tempPath: String? = null
    private var draftId: String? = null
    private var filePath: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Back arrow in the top bar → returns to the previous section.
        supportActionBar?.apply {
            title = "Screenshot"
            setDisplayHomeAsUpEnabled(true)
        }
        mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_CAPTURE
        tempPath = intent.getStringExtra(EXTRA_PATH)
        draftId = intent.getStringExtra(EXTRA_DRAFT_ID)

        val store = SecureStore.get(this)
        val drafts = CaptureDraftStore.get(this)

        // Resolve the file + metadata for the mode.
        var capturedBy = store.staffName ?: "MineFlow staff"
        var capturedAt = System.currentTimeMillis()
        if (mode == MODE_VIEW) {
            val d = draftId?.let { drafts.getDraft(it) }
            if (d == null) { finish(); return }
            filePath = d.filePath
            capturedBy = d.capturedBy
            capturedAt = d.capturedAtEpochMs
        } else {
            filePath = tempPath
        }
        val file = filePath?.let { File(it) }
        if (file == null || !file.exists()) {
            toast("Screenshot not found.")
            finish(); return
        }

        // Image dimensions without loading full bitmap into memory.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val dims = "${bounds.outWidth} × ${bounds.outHeight}px"
        val size = Formatter.formatShortFileSize(this, file.length())
        val stamp = SimpleDateFormat("MMM d, yyyy · h:mm a", Locale.getDefault()).format(Date(capturedAt))

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(black)
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }

        val image = ZoomableImageView(this).apply {
            setImageBitmap(BitmapFactory.decodeFile(file.absolutePath))
        }
        root.addView(image, LinearLayout.LayoutParams(MATCH, 0, 1f))

        val meta = TextView(this).apply {
            setTextColor(ivory)
            textSize = 12f
            setPadding(dp(2), dp(10), dp(2), dp(10))
            text = buildString {
                append("📅 $stamp\n")
                append("👤 $capturedBy\n")
                append("📐 $dims   ·   💾 $size")
            }
        }
        root.addView(meta, wide())

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        if (mode == MODE_CAPTURE) {
            // PRIMARY action: send the screenshot to MineFlow so it appears on the PC's
            // "Incoming Captures" (with the OCR'd name + item) for the operator to
            // confirm into an order. Save Draft stays as the offline fallback.
            buttons.addView(outlineButton("Retake") { retake() }, weight())
            buttons.addView(outlineButton("Discard") { discard() }, weight())
            buttons.addView(outlineButton("Save Draft") { saveDraft(file, bounds.outWidth, bounds.outHeight) }, weight())
        } else {
            buttons.addView(outlineButton("Delete Draft") { deleteDraft() }, weight())
            buttons.addView(goldButton("Close") { finish() }, weight())
        }
        root.addView(buttons, wide())

        if (mode == MODE_CAPTURE) {
            sendButton = goldButton("Send to MineFlow") { sendToMineflow(file) }
            root.addView(sendButton, wide().apply { topMargin = dp(8) })
        }

        setContentView(root)
    }

    private var sendButton: android.widget.Button? = null

    /**
     * Read the screenshot with on-device OCR, upload it to MineFlow, and create a
     * PENDING capture (screenshot + OCR guess) that surfaces on the PC's "Incoming
     * Captures". Nothing is ordered/printed/sent here — the operator confirms on the
     * PC. Idempotent on the backend, so a repeated tap is one pending row.
     */
    private fun sendToMineflow(file: File) {
        val store = SecureStore.get(this)
        if (!store.isLoggedIn) {
            toast("Sign in to MineFlow first.")
            return
        }
        sendButton?.isEnabled = false
        sendButton?.text = "Reading + uploading…"
        val bmp = BitmapFactory.decodeFile(file.absolutePath)
        if (bmp == null) {
            toast("Screenshot could not be read.")
            sendButton?.isEnabled = true
            sendButton?.text = "Send to MineFlow"
            return
        }
        val api = ApiClient(this)
        val captureId = file.nameWithoutExtension.ifBlank { "cap-${System.currentTimeMillis()}" }
        // OCR (best-effort); its callback fires on the main thread, then we upload off it.
        ScreenshotOcr.analyze(bmp) { guess ->
            thread {
                val path = runCatching { api.uploadScreenshot(captureId, "image/png", file.readBytes()) }
                    .getOrNull()
                val ocr = JSONObject()
                    .putOpt("fbName", guess.fbName)
                    .putOpt("itemQuery", guess.itemQuery)
                    .putOpt("grams", guess.grams)
                val res = api.createPendingCapture(captureId, path, ocr)
                runOnUiThread {
                    if (res.ok) {
                        toast("Sent to MineFlow. Confirm it on the PC.")
                        finish()
                    } else {
                        toast("Send failed: ${res.body.optString("error", "please try again")}")
                        sendButton?.isEnabled = true
                        sendButton?.text = "Send to MineFlow"
                    }
                }
            }
        }
    }

    // ---- capture-mode actions ------------------------------------------------

    private fun retake() {
        // Delete the temp screenshot, keep the service + floating button active, and
        // return to the previous app (Facebook) so the operator can re-capture.
        tempPath?.let { runCatching { File(it).delete() } }
        finish()
    }

    private fun discard() {
        tempPath?.let { runCatching { File(it).delete() } }
        toast("Screenshot discarded.")
        finish()
    }

    private fun saveDraft(file: File, width: Int, height: Int) {
        val store = SecureStore.get(this)
        val draft = CaptureDraftStore.get(this).saveDraft(
            tempFile = file,
            capturedBy = store.staffName ?: "MineFlow staff",
            deviceInstallationId = store.deviceInstallationId,
            width = width,
            height = height,
        )
        if (draft == null) {
            toast("Draft save failed — check available storage.")
            return
        }
        tempPath?.let { runCatching { File(it).delete() } }
        toast("Screenshot saved as draft.")
        finish()
    }

    // ---- view-mode actions ---------------------------------------------------

    private fun deleteDraft() {
        draftId?.let { CaptureDraftStore.get(this).deleteDraft(it) }
        toast("Draft deleted.")
        finish()
    }

    // ---- tiny view helpers ---------------------------------------------------

    private fun goldButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(Color.parseColor("#111111"))
        setBackgroundColor(gold)
        setOnClickListener { onClick() }
    }

    private fun outlineButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(ivory)
        setBackgroundColor(Color.TRANSPARENT)
        setOnClickListener { onClick() }
    }.also { it.setPadding(dp(8), dp(8), dp(8), dp(8)) }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun wide() = LinearLayout.LayoutParams(MATCH, WRAP)
    private fun weight() = LinearLayout.LayoutParams(0, WRAP, 1f).apply { setMargins(dp(4), 0, dp(4), 0) }
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        private const val EXTRA_PATH = "path"
        private const val EXTRA_MODE = "mode"
        private const val EXTRA_DRAFT_ID = "draft_id"
        const val MODE_CAPTURE = "capture"
        const val MODE_VIEW = "view"

        /** Open the fresh-capture preview (Retake / Save Draft / Discard). */
        fun openCapture(context: Context, path: String) {
            context.startActivity(
                Intent(context, PreviewActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(EXTRA_MODE, MODE_CAPTURE)
                    .putExtra(EXTRA_PATH, path),
            )
        }

        /** Open a saved draft read-only (Close / Delete Draft). */
        fun openDraft(context: Context, draftId: String) {
            context.startActivity(
                Intent(context, PreviewActivity::class.java)
                    .putExtra(EXTRA_MODE, MODE_VIEW)
                    .putExtra(EXTRA_DRAFT_ID, draftId),
            )
        }
    }
}
