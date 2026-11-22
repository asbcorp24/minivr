package ru.specdpo.minivr

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import kotlin.concurrent.thread
import kotlin.math.*
import java.util.LinkedHashMap

/**
 * Native multiresolution renderer companion. 512px JPEG tiles are fetched from
 * the existing MiniVR manifest, cached on disk by MiniVrApi, and composed into
 * a 2048² transparent viewport atlas. The original giant image is never decoded.
 */
class NativeTileStreamer(
    private val api: MiniVrApi,
    private val renderer: PanoramaRenderer,
    private val manifest: TileManifest
) {
    companion object { const val ATLAS_SIZE = 2048 }

    @Volatile private var active = false
    private val tileCache = object : LinkedHashMap<String, Bitmap>(32, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?): Boolean {
            if (size <= 24) return false
            eldest?.value?.recycle()
            return true
        }
    }

    private fun bitmap(level: TileLevel, x: Int, y: Int): Bitmap {
        val wrappedX = ((x % level.columns) + level.columns) % level.columns
        val key = "${level.number}:$wrappedX:$y"
        tileCache[key]?.let { if (!it.isRecycled) return it }
        val tile = api.bitmap(manifest.imagePath(level, wrappedX, y), manifest.tileSize)
        tileCache[key] = tile
        return tile
    }

    /** Low resolution 360° is available before any high resolution tile is fetched. */
    fun baseBitmap(): Bitmap {
        val low = manifest.levels.minByOrNull { it.width } ?: error("No low resolution level")
        require(low.width <= 4096 && low.height <= 4096) { "Low resolution level is too large" }
        val result = Bitmap.createBitmap(low.width, low.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        try {
            for (y in 0 until low.rows) for (x in 0 until low.columns) {
                val img = bitmap(low, x, y)
                canvas.drawBitmap(img, (x * manifest.tileSize).toFloat(),
                    (y * manifest.tileSize).toFloat(), paint)
            }
            return result
        } catch (error: Exception) {
            result.recycle()
            throw error
        }
    }

    private fun horizontalFovRadians(): Double {
        val fov = Math.toRadians(renderer.fieldOfView.toDouble())
        val eyes = if (renderer.cardboard) 2 else 1
        val aspect = (renderer.viewportWidth.toDouble() / eyes / renderer.viewportHeight.coerceAtLeast(1))
            .coerceIn(.2, 4.0)
        return 2.0 * atan(tan(fov / 2.0) * aspect)
    }

    private fun desiredLevel(): TileLevel {
        val hFraction = horizontalFovRadians() / (2.0 * PI)
        val vFraction = renderer.fieldOfView / 180.0
        val maximum = ATLAS_SIZE - manifest.tileSize * 1.25
        val eligible = manifest.levels.filter { level ->
            max(level.width * hFraction, level.height * vFraction) <= maximum
        }
        return (eligible.maxByOrNull { it.width } ?: manifest.levels.minByOrNull { it.width })!!
    }

    private data class Region(val level: TileLevel, val x: Int, val y: Int, val columns: Int, val rows: Int)

    private fun region(): Region {
        val level = desiredLevel()
        val size = manifest.tileSize
        val fovWidth = level.width * horizontalFovRadians() / (2.0 * PI)
        val fovHeight = level.height * renderer.fieldOfView / 180.0
        val cols = (ceil(fovWidth / size).toInt() + 2).coerceIn(1, ATLAS_SIZE / size)
        val rows = (ceil(fovHeight / size).toInt() + 2).coerceIn(1, min(level.rows, ATLAS_SIZE / size))
        val yaw = renderer.yaw.toDouble()
        val pitch = renderer.pitch.toDouble()
        var u = ((0.5 - yaw / 360.0) % 1.0 + 1.0) % 1.0
        if (renderer.format.mirror) u = 1.0 - u
        val v = (0.5 - pitch / 180.0).coerceIn(0.0, 1.0)
        val centerX = floor(u * level.width / size).toInt()
        val centerY = floor(v * level.height / size).toInt()
        val x = centerX - cols / 2
        val y = (centerY - rows / 2).coerceIn(0, max(0, level.rows - rows))
        return Region(level, x, y, cols, rows)
    }

    fun start() {
        if (active) return
        active = true
        thread(name = "MiniVR-tiles") {
            try {
                var last: Region? = null
                while (active && !Thread.currentThread().isInterrupted) {
                    val next = region()
                    if (next != last && next.level != manifest.levels.minByOrNull { it.width }) {
                        val composed = Bitmap.createBitmap(ATLAS_SIZE, ATLAS_SIZE, Bitmap.Config.ARGB_8888)
                        composed.eraseColor(Color.TRANSPARENT)
                        val canvas = Canvas(composed)
                        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
                        var loaded = 0
                        try {
                            for (y in 0 until next.rows) for (x in 0 until next.columns) {
                                if (!active) break
                                val tile = bitmap(next.level, next.x + x, next.y + y)
                                canvas.drawBitmap(tile, (x * manifest.tileSize).toFloat(),
                                    (y * manifest.tileSize).toFloat(), paint)
                                loaded++
                            }
                            if (active && loaded > 0) {
                                val info = TileAtlasInfo(
                                    next.x * manifest.tileSize.toFloat() / next.level.width,
                                    next.y * manifest.tileSize.toFloat() / next.level.height,
                                    next.level.width.toFloat() / ATLAS_SIZE,
                                    next.level.height.toFloat() / ATLAS_SIZE
                                )
                                renderer.offerTileAtlas(composed, info)
                            } else composed.recycle()
                        } catch (error: Exception) {
                            composed.recycle()
                            // Network or individual corrupt tiles must not break the base image.
                        }
                        last = next
                    }
                    Thread.sleep(240L)
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } finally {
                tileCache.values.forEach { if (!it.isRecycled) it.recycle() }
                tileCache.clear()
            }
        }
    }

    fun stop() { active = false }
}
