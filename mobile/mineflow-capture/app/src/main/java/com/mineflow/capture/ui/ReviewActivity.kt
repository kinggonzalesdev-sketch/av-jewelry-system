package com.mineflow.capture.ui

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.mineflow.capture.data.ApiClient
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * Review screen (Owner rules): the captured screenshot + editable, staff-confirmed
 * details. NOTHING is uploaded, ordered, or sent until the operator taps a button.
 * OCR is not run here — the operator confirms the customer + item explicitly. The
 * item is chosen from Active Inventory (never inferred from the screenshot alone).
 */
class ReviewActivity : AppCompatActivity() {

    private lateinit var api: ApiClient
    private var captureId: String = ""
    private var screenshotPath: String? = null
    private var selectedItemId: String? = null

    private lateinit var status: TextView
    private lateinit var results: LinearLayout
    private lateinit var price: EditText
    private lateinit var grams: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = ApiClient(this)

        val path = intent.getStringExtra(EXTRA_PATH)
        captureId = File(path ?: "").nameWithoutExtension.ifBlank {
            "cap-${System.currentTimeMillis()}"
        }

        val pad = dp(16)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        val shot = ImageView(this).apply {
            adjustViewBounds = true
            if (path != null) setImageBitmap(BitmapFactory.decodeFile(path))
        }
        val customer = field("Customer name")
        val itemSearch = field("Search Active Inventory (code or name)")
        val searchBtn = Button(this).apply { text = "Search inventory" }
        results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        price = field("Price")
        grams = field("Grams (optional)")
        val conversation = field("Pancake conversation id (for send)")
        val message = field("Message").apply {
            // Default template; the operator edits before sending. (The live template
            // lives in MineFlow Settings and can be fetched server-side later.)
            setText("Hi! Confirmed ang mined item mo.")
        }
        status = TextView(this).apply { setPadding(0, dp(8), 0, dp(8)) }

        val createBtn = Button(this).apply { text = "Create Order" }
        val createSendBtn = Button(this).apply { text = "Create & Send" }
        val retake = Button(this).apply { text = "Retake / Cancel" }

        listOf(
            shot, customer, itemSearch, searchBtn, results, price, grams,
            conversation, message, status, createBtn, createSendBtn, retake,
        ).forEach { root.addView(it, wide()) }

        setContentView(ScrollView(this).apply { addView(root) })

        searchBtn.setOnClickListener { runSearch(itemSearch.text.toString()) }
        retake.setOnClickListener { finish() }

        createBtn.setOnClickListener {
            submit(customer.text.toString(), conversation.text.toString(), message.text.toString(), send = false)
        }
        createSendBtn.setOnClickListener {
            submit(customer.text.toString(), conversation.text.toString(), message.text.toString(), send = true)
        }
    }

    private fun runSearch(q: String) {
        status.text = "Searching…"
        thread {
            val items = api.searchInventory(q)
            runOnUiThread {
                results.removeAllViews()
                status.text = "${items.length()} item(s)"
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    val btn = Button(this).apply {
                        text = "${item.optString("itemCode")}  ·  ${item.optString("grams", "—")}g"
                        setOnClickListener {
                            selectedItemId = item.optString("id")
                            price.setText(item.optString("unitPrice", ""))
                            grams.setText(item.optString("grams", ""))
                            status.text = "Selected ${item.optString("itemCode")}"
                        }
                    }
                    results.addView(btn, wide())
                }
            }
        }
    }

    private fun submit(customer: String, conversationId: String, message: String, send: Boolean) {
        val itemId = selectedItemId
        if (customer.isBlank()) { status.text = "Enter the customer name."; return }
        if (itemId.isNullOrBlank()) { status.text = "Select an inventory item."; return }
        if (price.text.isBlank()) { status.text = "Enter a price."; return }
        if (send && conversationId.isBlank()) { status.text = "Confirm a Pancake conversation id to send."; return }

        status.text = "Working…"
        thread {
            val bytes = File(cacheDirCapture()).takeIf { it.exists() }?.readBytes()
            // Upload the screenshot first (best-effort; the order still records the path).
            if (bytes != null && screenshotPath == null) {
                screenshotPath = api.uploadScreenshot(captureId, "image/png", bytes)
            }
            val ocr = JSONObject().put("note", "confirmed by operator")
            val res = api.createOrder(
                captureId, customer.trim(), itemId, price.text.toString().trim(),
                grams.text.toString().trim().ifBlank { null }, screenshotPath, ocr,
            )
            var msg = if (res.ok) {
                "Order ${res.body.optString("order_number")} created" +
                    if (res.body.optBoolean("idempotent")) " (already existed)" else ""
            } else res.body.optString("error", "Order failed.")

            if (res.ok && send) {
                val s = api.send(captureId, conversationId.trim(), message.trim(), screenshotPath)
                msg += if (s.ok) " · sent to Pancake" else " · send failed: ${s.body.optString("error")}"
            }
            runOnUiThread { status.text = msg }
        }
    }

    private fun cacheDirCapture(): String =
        File(File(cacheDir, "captures"), "$captureId.png").absolutePath

    private fun field(hint: String) = EditText(this).apply { this.hint = hint }
    private fun wide() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { gravity = Gravity.CENTER_HORIZONTAL }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val EXTRA_PATH = "path"
        fun open(context: Context, path: String) {
            context.startActivity(
                Intent(context, ReviewActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(EXTRA_PATH, path),
            )
        }
    }
}
