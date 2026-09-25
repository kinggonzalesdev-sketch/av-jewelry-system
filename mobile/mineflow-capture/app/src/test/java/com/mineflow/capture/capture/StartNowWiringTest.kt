package com.mineflow.capture.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Start Now opens the Capture Box for editing (Owner 2026-09-25).
 *
 * The overlay service needs a WindowManager, so these check the WIRING in the source: Start Now
 * carries its own marker, only that marker opens the box for editing, every other start still
 * restores it locked, and Reset Box and the long-press re-edit are still there.
 */
class StartNowWiringTest {

    private fun source(path: String): String {
        val f = listOf(File(path), File("app/$path")).first { it.exists() }
        return f.readText()
    }

    private val service = source("src/main/java/com/mineflow/capture/capture/OverlayCaptureService.kt")
    private val setup = source("src/main/java/com/mineflow/capture/ui/SetupActivity.kt")

    @Test
    fun startNow_button_usesStartNow() {
        val block = Regex("\"Active\", \"Start Now\"\\) \\{[\\s\\S]*?\\n        \\}").find(setup)?.value
        assertTrue("Start Now action not found", block != null)
        assertTrue(block!!.contains("OverlayCaptureService.startNow(this)"))
        assertFalse(block.contains("resetBox"))
    }

    @Test
    fun startNow_marker_opensTheBoxForEditing_onBothStartPaths() {
        // Fresh start (null action) and SHOW (service already up for printing).
        val opens = Regex("openBoxForStartNow\\(\\)").findAll(service).count()
        assertTrue("expected the definition plus two call sites, got $opens", opens >= 3)
        assertTrue(service.contains("getBooleanExtra(EXTRA_START_NOW, false)) openBoxForStartNow()"))
        assertTrue(service.contains("} else if (startNow) {"))
    }

    @Test
    fun openBoxForStartNow_isBoxModeOnly_andEditsTheSavedBox() {
        val fn = Regex("private fun openBoxForStartNow\\(\\) \\{[\\s\\S]*?\\n    \\}").find(service)?.value
        assertTrue("openBoxForStartNow not found", fn != null)
        assertTrue(fn!!.contains("SecureStore.MODE_BOX"))
        assertTrue(fn.contains("enterEditMode()"))
        assertFalse(fn.contains("resetCaptureBox"))
        assertFalse(fn.contains("CaptureRoi.default()"))
        assertTrue(service.contains("CaptureRoi.forEditing(store.captureRoi)"))
    }

    @Test
    fun otherStarts_restoreTheBoxAsItWasLeft_neverUnlockIt() {
        // restoreOverlays is shared by sticky restarts and "Show Floating Button": it never unlocks a
        // box, but an edit left without ✓ comes back WITH its ✓ (outline-only was a dead end).
        val fn = Regex("private fun restoreOverlays\\(\\) \\{[\\s\\S]*?\\n    \\}").find(service)?.value!!
        assertTrue(fn.contains("boxEditing = !saved.locked"))
        assertFalse(fn.contains("enterEditMode"))
        assertFalse(fn.contains("openBoxForStartNow"))
        assertFalse(fn.contains("locked = false"))
    }

    @Test
    fun checkAndLock_keepTheStoredBox_andATapNeverRewritesIt() {
        val finalize = Regex("private fun finalizeBox\\(\\) \\{[\\s\\S]*?\\n    \\}").find(service)?.value!!
        val lock = Regex("private fun toggleBoxLock\\(\\) \\{[\\s\\S]*?\\n    \\}").find(service)?.value!!
        assertFalse(finalize.contains("saveBoxFromWindow()"))
        assertFalse(lock.contains("saveBoxFromWindow()"))
        assertTrue(finalize.contains("CaptureRoi.withLock(store.captureRoi, true)"))
        // A drag/resize saves itself on release — only when the window actually changed.
        assertTrue(service.contains("if (editing && WinRect(lp.x, lp.y, lp.width, lp.height) != start) saveBoxFromWindow()"))
    }

    @Test
    fun theBoxWindow_isDrawnAtTheSavedSize_withTheResizeFloors() {
        val fn = Regex("private fun showCaptureBox\\(\\) \\{[\\s\\S]*?\\n    \\}").find(service)?.value!!
        assertTrue(fn.contains("coerceAtLeast(minBoxHeightPx(sh))"))
        assertFalse(fn.contains("coerceAtLeast(dp(48))"))
    }

    @Test
    fun freshStartNow_refreshesTheNotification() {
        val branch = Regex("\\} else if \\(startNow\\) \\{[\\s\\S]*?\\} else if").find(service)?.value!!
        assertTrue(branch.contains("setOverlayStopped(false)"))
        assertTrue(branch.contains("refreshNotification()"))
    }

    @Test
    fun resetBox_andLongPressReEdit_arePreserved() {
        assertTrue(service.contains("ACTION_RESET_BOX -> resetCaptureBox()"))
        assertTrue(service.contains("private fun revealControlsFromLongPress()"))
        assertTrue(service.contains("handler.postDelayed(longPress, 500)"))
        assertTrue(service.contains("BoxControl.CHECK -> finalizeBox()"))
    }
}
