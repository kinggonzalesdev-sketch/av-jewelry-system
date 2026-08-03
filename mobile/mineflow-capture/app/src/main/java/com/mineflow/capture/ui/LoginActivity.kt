package com.mineflow.capture.ui

import android.content.Intent
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
 */
class LoginActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = dp(24)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "MineFlow Capture"
            textSize = 24f
            setPadding(0, 0, 0, dp(4))
        }
        val subtitle = TextView(this).apply {
            text = "Sign in with your MineFlow account."
            setPadding(0, 0, 0, dp(24))
        }
        val email = EditText(this).apply {
            hint = "Email"
            inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val password = EditText(this).apply {
            hint = "Password"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val error = TextView(this).apply { setPadding(0, dp(8), 0, 0) }
        val signIn = Button(this).apply { text = "Sign in" }

        listOf(title, subtitle, email, password, signIn, error).forEach {
            root.addView(it, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
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

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
