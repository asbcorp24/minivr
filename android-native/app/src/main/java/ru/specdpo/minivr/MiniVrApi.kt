package ru.specdpo.minivr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.io.IOException

data class CatalogEntry(val id: Int, val title: String, val isTour: Boolean)

data class SceneEntry(
    val id: Int,
    val panoramaId: Int,
    val title: String,
    val description: String,
    val image: String,
    val projection: String,
    val stereo: String,
    val effects: JSONObject,
    val durationSeconds: Int?,
    val audio: String?,
    val guidedPoints: JSONArray,
    val lat: Double?,
    val lng: Double?
)

data class HotspotEntry(
    val sceneId: Int,
    val type: String,
    val label: String,
    val yaw: Float,
    val pitch: Float,
    val content: String?,
    val targetSceneId: Int?,
    val imageStereo: String
)

data class TourEntry(
    val id: Int,
    val title: String,
    val startSceneId: Int?,
    val scenes: List<SceneEntry>,
    val hotspots: List<HotspotEntry>
)

/** HTTPS read-only client. PHP remains the source of published assets and tour permissions. */
class MiniVrApi(baseUrl: String, private val imageCache: File) {
    private val base = URL(baseUrl.trimEnd('/') + "/")
    init { require(base.protocol == "https") { "Only HTTPS MiniVR servers are supported" } }

    fun url(path: String?): String? {
        if (path.isNullOrBlank() || path == "null") return null
        val resolved = URL(base, path)
        require(resolved.protocol == "https") { "Media must use HTTPS" }
        return resolved.toString()
    }

    private fun connection(path: String): HttpURLConnection {
        val target = URL(base, path)
        require(target.protocol == "https")
        return (target.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 60000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json, image/*")
        }
    }

    private fun json(path: String): JSONObject {
        if (!imageCache.exists()) imageCache.mkdirs()
        val key = digest(path)
        val cached = File(imageCache, "$key.json")
        try {
            val request = connection(path)
            val content = try {
                check(request.responseCode == 200) { "HTTP ${request.responseCode}" }
                request.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            } finally { request.disconnect() }
            val result = JSONObject(content)
            val tmp = File.createTempFile("minivr-json-", ".part", imageCache)
            try {
                tmp.writeText(content)
                if (!tmp.renameTo(cached)) { cached.delete(); tmp.renameTo(cached) }
            } finally { tmp.delete() }
            return result
        } catch (network: IOException) {
            if (cached.exists()) return JSONObject(cached.readText())
            throw network
        }
    }

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    fun catalog(): List<CatalogEntry> {
        val data = json("api/mobile.php?action=catalog")
        val entries = mutableListOf<CatalogEntry>()
        for ((field, isTour) in listOf("tours" to true, "panoramas" to false)) {
            val items = data.optJSONArray(field) ?: continue
            for (index in 0 until items.length()) {
                val row = items.getJSONObject(index)
                entries.add(CatalogEntry(row.getInt("id"), row.getString("title"), isTour))
            }
        }
        return entries
    }

    private fun JSONObject.audioUrl(name: String): String? = optString(name).takeIf { it.isNotBlank() && it != "null" }

    private fun scene(row: JSONObject): SceneEntry = SceneEntry(
        row.getInt("id"),
        row.getInt("panorama_id"),
        row.optString("title", "Панорама"),
        row.optString("description", ""),
        row.getString("image"),
        row.optString("projection", "360"),
        row.optString("stereo", "mono"),
        row.optJSONObject("effects") ?: JSONObject(),
        if (row.isNull("duration_seconds")) null else row.optInt("duration_seconds"),
        row.audioUrl("scene_audio"),
        row.optJSONArray("guided_points") ?: JSONArray(),
        if (row.isNull("geo_lat")) null else row.optDouble("geo_lat"),
        if (row.isNull("geo_lng")) null else row.optDouble("geo_lng")
    )

    fun panorama(id: Int): SceneEntry {
        val row = json("api/mobile.php?action=panorama&id=$id").getJSONObject("panorama")
        return SceneEntry(
            id, id, row.getString("title"), row.optString("description", ""),
            row.getString("image"), row.optString("projection", "360"),
            row.optString("stereo", "mono"), row.optJSONObject("effects") ?: JSONObject(),
            null, null, JSONArray(), null, null
        )
    }

    fun tour(id: Int): TourEntry {
        val data = json("api/mobile.php?action=tour&id=$id")
        val row = data.getJSONObject("tour")
        val sceneRows = data.getJSONArray("scenes")
        val scenes = (0 until sceneRows.length()).map { scene(sceneRows.getJSONObject(it)) }
        val hotspotRows = data.getJSONArray("hotspots")
        val hotspots = (0 until hotspotRows.length()).map { index ->
            val item = hotspotRows.getJSONObject(index)
            HotspotEntry(
                item.getInt("scene_id"), item.optString("type", "info"),
                item.optString("label"), item.optDouble("yaw", 0.0).toFloat(),
                item.optDouble("pitch", 0.0).toFloat(), item.audioUrl("content"),
                if (item.isNull("target_scene_id")) null else item.optInt("target_scene_id"),
                item.optString("image_stereo", "mono")
            )
        }
        return TourEntry(
            id, row.optString("title", "Экскурсия"),
            if (row.isNull("start_scene_id")) null else row.optInt("start_scene_id"),
            scenes, hotspots
        )
    }

    /**
     * Images are cached on disk, and decoded to <= 4096 pixels per axis.
     * This keeps 8K panoramas from exhausting the GPU or Java heap.
     */
    fun bitmap(path: String): Bitmap {
        val mediaUrl = url(path) ?: error("Image URL is empty")
        val key = digest(mediaUrl)
        if (!imageCache.exists()) imageCache.mkdirs()
        val cached = File(imageCache, "$key.img")
        if (!cached.exists() || cached.length() == 0L) {
            val request = connection(mediaUrl)
            val tmp = File.createTempFile("minivr-", ".part", imageCache)
            try {
                check(request.responseCode == 200) { "Image HTTP ${request.responseCode}" }
                tmp.outputStream().use { out -> request.inputStream.use { it.copyTo(out) } }
                check(tmp.length() > 0L) { "Empty image" }
                check(tmp.renameTo(cached)) { "Could not cache image" }
            } finally { request.disconnect(); tmp.delete() }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(cached.path, bounds)
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Unsupported image format" }
        var sample = 1
        while (bounds.outWidth / sample > 4096 || bounds.outHeight / sample > 4096) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeFile(cached.path, options) ?: error("Image decode failed")
    }
}
