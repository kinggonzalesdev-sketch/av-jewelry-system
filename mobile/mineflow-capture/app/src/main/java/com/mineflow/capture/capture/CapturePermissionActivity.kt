package com.mineflow.capture.capture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/**
 * Transparent activity that requests MediaProjection (screen-capture) consent and
 * hands the grant to the service. Screen capture is NEVER silent — this consent
 * dialog appears, and only a single still is taken per floating-button tap.
 */
class CapturePermissionActivity : AppCompatActivity() {

    private val request =
        registerForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
        ) { result ->
            if (result.resultCode == Activity.RESULT_OK && result.data != null) {
                OverlayCaptureService.deliverProjection(this, result.resultCode, result.data!!)
            }
            finish()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // Always capture the ENTIRE screen (the Facebook Live). On Android 14+ (API 34)
        // the consent dialog otherwise offers a "single app" choice we don't want —
        // createConfigForDefaultDisplay() pins it to the full display, so only "Entire
        // screen" is shown. Older versions have no such option and fall back cleanly.
        val intent =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                mpm.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay(),
                )
            } else {
                mpm.createScreenCaptureIntent()
            }
        request.launch(intent)
    }

    companion object {
        fun request(context: Context) {
            context.startActivity(
                Intent(context, CapturePermissionActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }
}
