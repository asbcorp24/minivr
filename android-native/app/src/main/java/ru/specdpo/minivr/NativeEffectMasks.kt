package ru.specdpo.minivr

import android.graphics.Bitmap
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** Packs the site's independently painted regions into four opaque GLES2 textures.
 *  RGB of regions: water, river, waterfall. RGB of atmosphere: sky, light, floating.
 *  RGB of sources: bubbles, steam, spare. RG of flow: river/waterfall angle.
 *  Alpha is always 255 to avoid Android bitmap premultiplication corrupting masks. */
data class NativeEffectMasks(val regions: Bitmap, val atmosphere: Bitmap,
                             val sources: Bitmap, val flow: Bitmap) {
    fun recycle() { regions.recycle(); atmosphere.recycle(); sources.recycle(); flow.recycle() }

    companion object {
        private const val W = 512
        private const val H = 256
        private const val COUNT = W * H

        private fun channel(settings: JSONObject, name: String, default: Int,
                            supplement: Bitmap? = null): IntArray {
            val mask = NativeSceneEffects.polygonMask(settings, name)
            val bitmap = mask ?: supplement
            val pixels = IntArray(COUNT)
            if (bitmap != null) {
                bitmap.getPixels(pixels, 0, W, 0, 0, W, H)
                for (i in pixels.indices) pixels[i] = Color.alpha(pixels[i])
            } else pixels.fill(default)
            mask?.recycle()
            supplement?.recycle()
            return pixels
        }

        private fun pack(r: IntArray, g: IntArray, b: IntArray): Bitmap {
            val pixels = IntArray(COUNT)
            for (i in pixels.indices) pixels[i] = Color.rgb(r[i], g[i], b[i])
            return Bitmap.createBitmap(pixels, W, H, Bitmap.Config.ARGB_8888)
        }

        private data class Arrow(val x: Float, val y: Float, val dx: Float, val dy: Float)
        private fun arrows(settings: JSONObject, name: String): List<Arrow> {
            val array: JSONArray = settings.optJSONObject("flowArrows")?.optJSONArray(name) ?: return emptyList()
            val entries = mutableListOf<Arrow>()
            for (i in 0 until minOf(array.length(), 40)) {
                val a = array.optJSONArray(i) ?: continue
                if (a.length() != 4) continue
                val x1 = a.optDouble(0, Double.NaN)
                val y1 = a.optDouble(1, Double.NaN)
                val x2 = a.optDouble(2, Double.NaN)
                val y2 = a.optDouble(3, Double.NaN)
                if (!(x1.isFinite() && y1.isFinite() && x2.isFinite() && y2.isFinite())) continue
                val dx = ((x2 - x1) / 360.0).toFloat()
                val dy = (-(y2 - y1) / 180.0).toFloat()
                val length = hypot(dx, dy)
                if (length < .001f) continue
                entries.add(Arrow(((x1 + x2 + 360) / 720).toFloat(),
                    ((180 - y1 - y2) / 360).toFloat(), dx / length, dy / length))
            }
            return entries
        }

        private fun field(settings: JSONObject, name: String, mask: IntArray): IntArray {
            val angle = Math.toRadians(settings.optDouble("${name}Direction",
                if (name == "waterfall") 90.0 else 0.0))
            val fallbackX = cos(angle).toFloat()
            val fallbackY = -sin(angle).toFloat()
            val values = arrows(settings, name)
            val directions = IntArray(COUNT)
            for (y in 0 until H) for (x in 0 until W) {
                val at = y * W + x
                if (mask[at] == 0) { directions[at] = 128; continue }
                var dx = fallbackX
                var dy = fallbackY
                if (values.isNotEmpty()) {
                    val u = (x + .5f) / W
                    val v = (y + .5f) / H
                    var sumX = 0f; var sumY = 0f; var total = 0f
                    for (arrow in values) {
                        var offsetX = u - arrow.x
                        offsetX -= kotlin.math.floor(offsetX + .5f)
                        val offsetY = v - arrow.y
                        val weight = 1f / (.0005f + (offsetX * offsetX + offsetY * offsetY) * 160f)
                        sumX += arrow.dx * weight
                        sumY += arrow.dy * weight
                        total += weight
                    }
                    val magnitude = hypot(sumX, sumY)
                    if (total > 0f && magnitude > .0001f) { dx = sumX / magnitude; dy = sumY / magnitude }
                }
                directions[at] = (((kotlin.math.atan2(dy, dx) / Math.PI.toFloat() + 1f) * .5f)
                    .coerceIn(0f, 1f) * 255f).toInt()
            }
            return directions
        }

        fun from(settings: JSONObject): NativeEffectMasks? {
            if (listOf("liveWater", "riverFlow", "waterfallFlow", "clouds", "stars", "lightBeams",
                    "lampGlow", "bubbles", "steam", "floatingLeaves", "storm").none { settings.optBoolean(it) }) return null
            val water = channel(settings, "surface", if (settings.optBoolean("liveWater")) 255 else 0,
                NativeSceneEffects.decodeMask(settings, "parallaxWaterMask"))
            val river = channel(settings, "river", 0)
            val waterfall = channel(settings, "waterfall", 0)
            val floating = channel(settings, "floating", 255)
            val sky = channel(settings, "sky", 255)
            val light = channel(settings, "light", 255)
            val bubbles = channel(settings, "bubbles", 255)
            val steam = channel(settings, "steam", 255)
            val rx = field(settings, "river", river)
            val wx = field(settings, "waterfall", waterfall)
            return NativeEffectMasks(pack(water, river, waterfall),
                pack(sky, light, floating), pack(bubbles, steam, IntArray(COUNT)),
                pack(rx, wx, IntArray(COUNT)))
        }
    }
}
