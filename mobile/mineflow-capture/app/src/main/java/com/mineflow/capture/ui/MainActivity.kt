package com.mineflow.capture.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.mineflow.capture.data.SecureStore

/** Entry point. Routes to Login when signed out, otherwise to Setup. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SecureStore.get(this)
        val next = if (store.isLoggedIn) SetupActivity::class.java else LoginActivity::class.java
        startActivity(Intent(this, next))
        finish()
    }
}
