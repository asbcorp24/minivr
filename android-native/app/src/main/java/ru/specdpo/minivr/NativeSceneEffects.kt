package ru.specdpo.minivr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.Base64
import org.json.JSONObject

/** GPU effect parameters copied from the existing MiniVR panorama settings. */
data class NativeSceneEffects(
    val depthStrength: Float = 0f,
    val waterStrength: Float = 0f,
    val waterSpeed: Float = 1f,
    val waterYaw: Float = 0f,
    val waterPitch: Float = -35f,
    val waterRadius: Float = 20f,
    val foliageStrength: Float = 0f,
    val foliageSpeed: Float = 1f,
    val particles: Int = 0,
    val particleDensity: Float = 0f,
    val particleSpeed: Float = 1f,
    val wind: Float = 0f,
    val fog: Float = 0f,
    val storm: Float = 0f,
    val sun: Float = 0f,
    val sunYaw: Float = 0f,
    val sunPitch: Float = 35f,
    val moon: Float = 0f,
    val moonYaw: Float = 0f,
    val moonPitch: Float = 35f,
    val stars: Float = 0f,
    val clouds: Float = 0f,
    val rotationSpeed: Float = 0f
) {
    companion object {
        fun from(settings: JSONObject): NativeSceneEffects {
            fun amount(key: String, default: Double = 0.0): Float =
                (settings.optDouble(key, default).toFloat().coerceIn(0f, 100f) / 100f)
            fun velocity(key: String, default: Double = 1.0) =
                settings.optDouble(key, default).toFloat().coerceIn(0.05f, 5f)
            val particles = when (settings.optString("particles")) {
                "rain" -> 1; "snow" -> 2; "leaves" -> 3; "insects" -> 4
                "dust" -> 5; "birds" -> 6; "bubbles" -> 7; else -> 0
            }
            val waterEnabled = settings.optBoolean("parallaxWaterMotion") ||
                settings.optBoolean("liveWater") || settings.optBoolean("riverFlow") ||
                settings.optBoolean("waterfallFlow")
            return NativeSceneEffects(
                depthStrength = if (settings.optBoolean("parallaxEnabled")) amount("parallaxStrength", 75.0) else 0f,
                waterStrength = if (waterEnabled) amount("parallaxWaterStrength", 45.0) else 0f,
                waterSpeed = velocity("parallaxWaterSpeed"),
                waterYaw = settings.optDouble("waterYaw", 0.0).toFloat(),
                waterPitch = settings.optDouble("waterPitch", -35.0).toFloat(),
                waterRadius = settings.optDouble("waterRadius", 20.0).toFloat().coerceIn(2f, 70f),
                foliageStrength = if (settings.optBoolean("parallaxMicroMotion"))
                    amount("parallaxMicroMotionStrength", 60.0) else 0f,
                foliageSpeed = velocity("parallaxMicroMotionSpeed"),
                particles = particles,
                particleDensity = if (particles > 0) amount("density", 35.0) * amount("opacity", 80.0) else 0f,
                particleSpeed = velocity("speed"),
                wind = settings.optDouble("wind", 0.0).toFloat().coerceIn(-8f, 8f),
                fog = if (settings.optBoolean("fog")) amount("fogDensity", 25.0) else 0f,
                storm = if (settings.optBoolean("storm")) amount("stormIntensity", 40.0) else 0f,
                sun = if (settings.optBoolean("sunRays")) amount("sunIntensity", 30.0) else 0f,
                sunYaw = settings.optDouble("sunYaw", 0.0).toFloat(),
                sunPitch = settings.optDouble("sunPitch", 35.0).toFloat(),
                moon = if (settings.optBoolean("moon")) amount("moonIntensity", 55.0) else 0f,
                moonYaw = settings.optDouble("moonYaw", 0.0).toFloat(),
                moonPitch = settings.optDouble("moonPitch", 35.0).toFloat(),
                stars = if (settings.optBoolean("stars")) amount("starDensity", 55.0) else 0f,
                clouds = if (settings.optBoolean("clouds")) amount("cloudDensity", 35.0) else 0f,
                rotationSpeed = if (settings.optBoolean("rotation")) velocity("rotationSpeed") else 0f
            )
        }

        /** The site stores its hand-painted 512×256 masks as PNG data: URLs. */
        fun decodeMask(settings: JSONObject, name: String): Bitmap? {
            val encoded = settings.optString(name)
            if (!encoded.startsWith("data:image/png;base64,") || encoded.length > 300_000) return null
            return runCatching {
                val bytes = Base64.decode(encoded.substringAfter(','), Base64.DEFAULT)
                if (bytes.size > 225_000) return@runCatching null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?.takeIf { it.width == 512 && it.height == 256 }
            }.getOrNull()
        }

        /** Rasterize the polygon masks authored in the browser panorama editor. */
        fun polygonMask(settings: JSONObject, kind: String): Bitmap? {
            val masks = settings.optJSONObject("masks")
            val polygons = when (kind) {
                "water" -> listOfNotNull(masks?.optJSONArray("water"), masks?.optJSONArray("river"),
                    masks?.optJSONArray("waterfall"), settings.optJSONArray("waterPolygon"))
                "vegetation" -> listOfNotNull(masks?.optJSONArray("vegetation"))
                else -> emptyList()
            }
            if (polygons.isEmpty()) return null
            val result = Bitmap.createBitmap(512, 256, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(result)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
            var drawn = false
            for (polygon in polygons) {
                if (polygon.length() !in 3..80) continue
                val coords = mutableListOf<Pair<Float, Float>>()
                for (i in 0 until polygon.length()) {
                    val point = polygon.optJSONArray(i) ?: continue
                    if (point.length() != 2) continue
                    val yaw = point.optDouble(0, Double.NaN)
                    val pitch = point.optDouble(1, Double.NaN)
                    if (!yaw.isFinite() || !pitch.isFinite()) continue
                    var x = ((yaw + 180.0) / 360.0 * 512.0).toFloat()
                    if (coords.isNotEmpty()) {
                        val previous = coords.last().first
                        while (x - previous > 256f) x -= 512f
                        while (previous - x > 256f) x += 512f
                    }
                    coords.add(x to ((90.0 - pitch) / 180.0 * 256.0).toFloat())
                }
                if (coords.size < 3) continue
                val path = Path().apply {
                    moveTo(coords[0].first, coords[0].second)
                    for (i in 1 until coords.size) lineTo(coords[i].first, coords[i].second)
                    close()
                }
                for (shift in -1..1) {
                    canvas.save()
                    canvas.translate(shift * 512f, 0f)
                    canvas.drawPath(path, paint)
                    canvas.restore()
                }
                drawn = true
            }
            if (!drawn) { result.recycle(); return null }
            return result
        }
    }
}

data class TileAtlasInfo(
    val originU: Float, val originV: Float,
    val scaleU: Float, val scaleV: Float
)
