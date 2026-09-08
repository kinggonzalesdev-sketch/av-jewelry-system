package com.mineflow.capture.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Local draft store — app-PRIVATE storage only (never the public gallery).
 *
 * Phase 1 (capture only): a saved draft is a PNG in `filesDir/drafts/` plus a small
 * JSON index entry. Nothing is uploaded, ordered, sent, or printed here. Only DRAFT
 * screenshots live here, and only drafts may be deleted locally.
 */
class CaptureDraftStore private constructor(private val context: Context) {

    data class Draft(
        val id: String,
        val filePath: String,
        val capturedBy: String,
        val capturedAtEpochMs: Long,
        val status: String,
        val deviceInstallationId: String,
        val width: Int,
        val height: Int,
        val sizeBytes: Long,
    )

    private val dir: File get() = File(context.filesDir, "drafts").apply { mkdirs() }
    private val indexFile: File get() = File(dir, "index.json")

    /**
     * Persist a temporary capture as a DRAFT: copy the bytes into app-private storage
     * and record its metadata. The temp file is left for the caller to delete.
     * Returns the saved [Draft], or null when the copy fails (e.g. low storage).
     */
    fun saveDraft(
        tempFile: File,
        capturedBy: String,
        deviceInstallationId: String,
        width: Int,
        height: Int,
    ): Draft? {
        if (!tempFile.exists()) return null
        val id = "MFC-${System.currentTimeMillis()}"
        val dest = File(dir, "$id.png")
        return try {
            tempFile.copyTo(dest, overwrite = true)
            val draft = Draft(
                id = id,
                filePath = dest.absolutePath,
                capturedBy = capturedBy,
                capturedAtEpochMs = System.currentTimeMillis(),
                status = STATUS_DRAFT,
                deviceInstallationId = deviceInstallationId,
                width = width,
                height = height,
                sizeBytes = dest.length(),
            )
            val all = readIndex().apply { add(0, draft) }
            writeIndex(all)
            draft
        } catch (_: Throwable) {
            runCatching { dest.delete() }
            null
        }
    }

    /** Newest-first list of saved drafts, skipping any whose file has gone missing. */
    fun listDrafts(): List<Draft> = readIndex().filter { File(it.filePath).exists() }

    fun getDraft(id: String): Draft? = readIndex().firstOrNull { it.id == id }

    /** Delete a draft's file and its index entry. Only drafts are deletable. */
    fun deleteDraft(id: String): Boolean {
        val all = readIndex()
        val target = all.firstOrNull { it.id == id } ?: return false
        runCatching { File(target.filePath).delete() }
        writeIndex(all.filter { it.id != id }.toMutableList())
        return true
    }

    // ---- index (de)serialisation --------------------------------------------

    private fun readIndex(): MutableList<Draft> {
        if (!indexFile.exists()) return mutableListOf()
        return try {
            val arr = JSONArray(indexFile.readText())
            MutableList(arr.length()) { i ->
                val o = arr.getJSONObject(i)
                Draft(
                    id = o.getString("id"),
                    filePath = o.getString("filePath"),
                    capturedBy = o.optString("capturedBy", "A.V. Jewelry staff"),
                    capturedAtEpochMs = o.optLong("capturedAt", 0L),
                    status = o.optString("status", STATUS_DRAFT),
                    deviceInstallationId = o.optString("deviceId", ""),
                    width = o.optInt("width", 0),
                    height = o.optInt("height", 0),
                    sizeBytes = o.optLong("sizeBytes", 0L),
                )
            }
        } catch (_: Throwable) {
            mutableListOf()
        }
    }

    private fun writeIndex(drafts: MutableList<Draft>) {
        val arr = JSONArray()
        for (d in drafts) {
            arr.put(
                JSONObject()
                    .put("id", d.id)
                    .put("filePath", d.filePath)
                    .put("capturedBy", d.capturedBy)
                    .put("capturedAt", d.capturedAtEpochMs)
                    .put("status", d.status)
                    .put("deviceId", d.deviceInstallationId)
                    .put("width", d.width)
                    .put("height", d.height)
                    .put("sizeBytes", d.sizeBytes),
            )
        }
        runCatching { indexFile.writeText(arr.toString()) }
    }

    companion object {
        const val STATUS_DRAFT = "Draft"

        fun get(context: Context): CaptureDraftStore = CaptureDraftStore(context.applicationContext)
    }
}
