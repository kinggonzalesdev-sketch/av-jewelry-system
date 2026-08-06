package com.mineflow.capture.ui

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.mineflow.capture.data.ApiClient
import kotlin.concurrent.thread

/**
 * Sign in with the existing MineFlow account (Supabase Auth). The password is used
 * once to obtain a token and is never stored; the token goes to the Keystore-backed
 * SecureStore. Built programmatically to keep the scaffold layout-file-free.
 *
 * Every piece of text sets an EXPLICIT colour on the dark background so the typed
 * email/password, hints, title and errors are all clearly visible (the default
 * EditText colours were near-black on the dark theme, so typing looked invisible).
 */
class LoginActivity : AppCompatActivity() {

    private val gold = Color.parseColor("#C9A227")
    private val ivory = Color.parseColor("#F5EFE0")
    private val beige = Color.parseColor("#B7A98A") // lighter beige — readable hint on black
    private val black = Color.parseColor("#0B0B0B")
    private val surface = Color.parseColor("#1E1E1E")
    private val danger = Color.parseColor("#F1A0A0")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = dp(24)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(black)
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "MineFlow Capture"
            textSize = 26f
            setTextColor(ivory)
            setPadding(0, 0, 0, dp(6))
        }
        val subtitle = TextView(this).apply {
            text = "Sign in with your MineFlow account."
            textSize = 15f
            setTextColor(beige)
            setPadding(0, 0, 0, dp(24))
        }
        val email = field("Email").apply {
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val password = field("Password").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val error = TextView(this).apply {
            textSize = 14f
            setTextColor(danger)
            setPadding(0, dp(10), 0, 0)
        }
        val signIn = Button(this).apply {
            text = "Sign in"
            isAllCaps = false
            textSize = 16f
            setTextColor(Color.parseColor("#111111"))
            setBackgroundColor(gold)
            setPadding(0, dp(12), 0, dp(12))
        }

        root.addView(title, wide())
        root.addView(subtitle, wide())
        root.addView(email, wide().apply { topMargin = dp(6) })
        root.addView(password, wide().apply { topMargin = dp(12) })
        root.addView(signIn, wide().apply { topMargin = dp(20) })
        root.addView(error, wide())
        setContentView(root)

        signIn.setOnClickListener {
            // Trim surrounding spaces and normalize the email to lowercase (Supabase
            // treats emails case-insensitively). The password is used exactly as typed.
            val e = email.text.toString().trim().lowercase()
            val p = password.text.toString()
            if (e.isEmpty() || p.isEmpty()) {
                error.text = "Enter your email and password."
                return@setOnClickListener
            }
            signIn.isEnabled = false
            error.text = "Signing in…"
            thread {
                val problem = ApiClient(this).signIn(e, p)
                runOnUiThread {
                    signIn.isEnabled = true
                    if (problem == null) {
                        Toast.makeText(this, "Signed in", Toast.LENGTH_SHORT).show()
                        startActivity(Intent(this, SetupActivity::class.java))
                        finish()
                    } else {
                        error.text = problem
                    }
                }
            }
        }
    }

    /** A dark-surface input with LIGHT text + a readable hint, so typing is visible. */
    private fun field(hintText: String) = EditText(this).apply {
        hint = hintText
        textSize = 17f
        setTextColor(ivory)
        setHintTextColor(beige)
        setBackgroundColor(surface)
        setPadding(dp(14), dp(14), dp(14), dp(14))
    }

    private fun wide() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
