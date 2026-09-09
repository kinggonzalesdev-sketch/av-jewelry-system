package com.mineflow.capture.boot

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.mineflow.capture.App
import com.mineflow.capture.capture.OverlayCaptureService
import com.mineflow.capture.data.SecureStore
import com.mineflow.capture.ui.MainActivity

/**
 * Bring order-sticker printing back after a reboot (Owner 2026-09-09).
 *
 * WHY. Nothing in the app survived a restart: no boot receiver, no scheduler, and App.onCreate only
 * created a notification channel. A phone that rebooted overnight — or after an OS update, or a
 * flat battery — polled nothing until somebody happened to reopen the app. Staff would keep
 * clicking Print at the counter and get nothing, with no signal that the phone was not listening.
 *
 * WHAT IT DOES. Only restarts what was ALREADY set up: it starts the capture service (which owns
 * PrintJobPoller) when the operator is signed in AND a printer is configured. It never signs anyone
 * in, never enables a printer, and never starts a screen capture. That keeps it inside the Owner's
 * "nothing more, nothing less" rule: it restores a state the operator chose, rather than inventing
 * one.
 *
 * DEGRADES INSTEAD OF CRASHING. Android restricts starting a foreground service from the
 * background, and BOOT_COMPLETED is an allowlisted case for most FGS types — but not universally,
 * and OEM builds vary. If the start is refused we do NOT let the exception escape (that would be a
 * crash on every boot, on a device we cannot test). We post an ordinary tappable notification
 * instead, so the worst case is one tap rather than a silent dead printer.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // The WHOLE body is guarded. A receiver that throws crashes the app, and this one runs on
        // every boot with nobody in front of the phone — the one place an unhandled exception turns
        // into a boot loop the Owner cannot diagnose.
        runCatching { handle(context, intent) }
            .onFailure { Log.w(TAG, "boot handling failed: ${it.javaClass.simpleName}") }
    }

    private fun handle(context: Context, intent: Intent) {
        val action = intent.action ?: return
        // ONLY protected broadcasts. QUICKBOOT_POWERON was here for old vendor ROMs, but it is NOT
        // a protected broadcast in AOSP — any app on the phone could send it to this package and
        // start our foreground service at will. minSdk is 26, long past the Android 4.x era that
        // needed it, so the compatibility value does not come close to paying for that.
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            return
        }

        // Guarded: SecureStore is EncryptedSharedPreferences, and a keystore that is not ready this
        // early in boot throws. Nothing to restore is a fine outcome; crashing is not.
        val store = runCatching { SecureStore.get(context) }.getOrNull()
        if (store == null) {
            Log.w(TAG, "boot: secure store unavailable this early — skipping")
            return
        }
        // Not signed in, or no printer chosen: there is nothing to restore, and starting a
        // foreground service to do nothing would just be a notification the operator did not ask for.
        if (!store.isLoggedIn || store.printerAddress.isNullOrBlank()) {
            Log.i(TAG, "boot: nothing to restore (loggedIn=${store.isLoggedIn})")
            return
        }

        val started = runCatching { OverlayCaptureService.startForPrinting(context) }.isSuccess
        if (started) {
            // NOTE: startForegroundService only ENQUEUES the service. The API 31+ background-start
            // refusal is thrown synchronously and is caught here, but a failure raised later inside
            // onCreate cannot be — the service's own startAsForeground is where that would surface.
            Log.i(TAG, "boot: capture service start requested, printing should resume")
        } else {
            Log.w(TAG, "boot: foreground start refused — posting a tap-to-resume notification")
            runCatching { postResumeNotification(context) }
        }
    }

    /** Fallback when Android refuses a background foreground-service start: make it one tap. */
    private fun postResumeNotification(context: Context) {
        val open = android.app.PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notif = NotificationCompat.Builder(context, App.CAPTURE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Tap to resume sticker printing")
            .setContentText("A.V. Jewelry Capture stopped when the phone restarted.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // A DIFFERENT id from the ongoing service notification — this one must be dismissible and
        // must never collide with (or replace) the foreground-service notification.
        manager.notify(BOOT_RESUME_NOTIFICATION_ID, notif)
    }

    private companion object {
        private const val TAG = "MineFlowBoot"
        private const val BOOT_RESUME_NOTIFICATION_ID = 4202
    }
}
