package com.mineflow.capture

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * MineFlow Capture application.
 *
 * Holds the app-wide notification channel used by the foreground capture service.
 * Everything privileged (orders, Pancake, storage) happens on the MineFlow backend
 * — this app only authenticates, captures a still, and calls those endpoints.
 */
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        createCaptureChannel()
    }

    private fun createCaptureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CAPTURE_CHANNEL_ID,
                "A.V. Jewelry Capture",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Shows while the Capture Mine button is active." }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CAPTURE_CHANNEL_ID = "mineflow_capture"
        const val CAPTURE_NOTIFICATION_ID = 4201
    }
}
