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

data class CatalogEntry(
    val id: Int,
    val title: String,
    val isTour: Boolean,
    val description: String = "",
    val thumbnail: String? = null,
    val format: String = ""
)
data class MusicTrack(val id: Int, val title: String, val artist: String, val path: String)

data class Panorama3DObject(val id:Int,val name:String,val url:String,val format:String,val settings:JSONObject)

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
    val lng: Double?,
    val tilesManifest: String?,
    val preview: String? = null,
    val objects: List<Panorama3DObject> = emptyList()
)

data class TileLevel(val number: Int, val width: Int, val height: Int, val columns: Int, val rows: Int)
data class TileManifest(val path: String, val tileSize: Int, val levels: List<TileLevel>) {
    fun imagePath(level: TileLevel, x: Int, y: Int): String =
        path.substringBeforeLast('/') + "/${level.number}/${x}_${y}.jpg"
}

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
                val thumbnail = if (isTour) row.optString("cover")
                    else row.optString("preview")
                val projection = if (isTour) "TOUR" else row.optString("projection", "360")
                entries.add(CatalogEntry(row.getInt("id"), row.getString("title"), isTour,
                    row.optString("description", ""),
                    thumbnail.takeIf { it.isNotBlank() && it != "null" }, projection))
            }
        }
        return entries
    }

    fun music(): List<MusicTrack> {
        val tracks = json("api/mobile.php?action=music").optJSONArray("tracks") ?: return emptyList()
        return (0 until tracks.length()).map { i ->
            val item = tracks.getJSONObject(i)
            MusicTrack(item.getInt("id"), item.getString("title"),
                item.optString("artist", ""), item.getString("file_path"))
        }
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
        if (row.isNull("geo_lng")) null else row.optDouble("geo_lng"),
        row.audioUrl("tiles_manifest"),
        row.audioUrl("preview"),
        parseObjects(row.optJSONArray("objects"))
    )

    fun panorama(id: Int): SceneEntry {
        val row = json("api/mobile.php?action=panorama&id=$id").getJSONObject("panorama")
        return SceneEntry(
            id, id, row.getString("title"), row.optString("description", ""),
            row.getString("image"), row.optString("projection", "360"),
            row.optString("stereo", "mono"), row.optJSONObject("effects") ?: JSONObject(),
            null, null, JSONArray(), null, null, row.audioUrl("tiles_manifest"),
            row.audioUrl("preview"), parseObjects(row.optJSONArray("objects"))
        )
    }

    private fun parseObjects(array: JSONArray?): List<Panorama3DObject> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val row=array.optJSONObject(i) ?: return@mapNotNull null
            val path=row.optString("url").takeIf { it.isNotBlank() && it!="null" } ?: return@mapNotNull null
            Panorama3DObject(row.optInt("id"),row.optString("name","3D object"),
                path,row.optString("format","glb"),row.optJSONObject("settings") ?: JSONObject())
        }
    }

    /** Downloads published model files to app cache; playback only. */
    fun modelFile(path:String): File {
        val resolved=url(path) ?: error("3D model URL is empty")
        if (!imageCache.exists()) imageCache.mkdirs()
        val extension=path.substringAfterLast('.').substringBefore('?').lowercase()
        val target=File(imageCache,"model-${digest(resolved)}.$extension")
        if(target.exists() && target.length()>0)return target
        val request=connection(path)
        try {
            check(request.responseCode==200) { "3D model HTTP ${request.responseCode}" }
            val temp=File.createTempFile("minivr-model-",".part",imageCache)
            try {
                request.inputStream.use { input -> temp.outputStream().use { output -> input.copyTo(output) } }
                check(temp.length() in 1..(50L*1024*1024)) { "3D model size is invalid" }
                if(!temp.renameTo(target)){target.delete();check(temp.renameTo(target))}
            } finally { temp.delete() }
        } finally { request.disconnect() }
        return target
    }

    fun tileManifest(path: String): TileManifest {
        val result = json(path)
        require(result.optString("projection") == "360") { "Unsupported tiled projection" }
        val size = result.optInt("tileSize", 512)
        require(size in 128..1024) { "Invalid tile size" }
        val array = result.getJSONArray("levels")
        val levels = (0 until array.length()).map { index ->
            val level = array.getJSONObject(index)
            TileLevel(level.getInt("level"), level.getInt("width"), level.getInt("height"),
                level.getInt("cols"), level.getInt("rows"))
        }
        require(levels.isNotEmpty() && levels.size <= 20 && levels.all {
            it.width > 0 && it.height > 0 && it.columns > 0 && it.rows > 0 &&
                it.width <= 131072 && it.height <= 65536 && it.columns <= 256 && it.rows <= 128
        }) { "Invalid tile manifest" }
        return TileManifest(path, size, levels)
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
    fun bitmap(path: String, maxDimension: Int = 4096): Bitmap {
        require(maxDimension in 256..4096)
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
        while (bounds.outWidth / sample > maxDimension || bounds.outHeight / sample > maxDimension) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeFile(cached.path, options) ?: error("Image decode failed")
    }
}
