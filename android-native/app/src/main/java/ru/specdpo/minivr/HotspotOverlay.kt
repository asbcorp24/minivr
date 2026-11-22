package ru.specdpo.minivr

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

/**
 * Native 2D labels projected over the GPU panorama.
 * In Cardboard mode the same labels are drawn for both eyes and activated by gaze.
 */
class HotspotOverlay(
    context: Context,
    private val renderer: PanoramaRenderer,
    private val onActivate: (HotspotEntry) -> Unit
) : View(context) {
    var hotspots: List<HotspotEntry> = emptyList()
        set(value) { field = value; gazeId = null; invalidate() }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val activeAreas = mutableListOf<Pair<RectF, HotspotEntry>>()
    private var down: HotspotEntry? = null
    private var gazeId: HotspotEntry? = null
    private var gazeStart = 0L
    private var gazeArmed = true
    private val density = resources.displayMetrics.density

    private fun point(hotspot: HotspotEntry, eye: Int, eyes: Int): Pair<Float, Float>? {
        val hYaw = Math.toRadians(hotspot.yaw.toDouble())
        val hPitch = Math.toRadians(hotspot.pitch.toDouble())
        val yaw = Math.toRadians(renderer.yaw.toDouble())
        val pitch = Math.toRadians(renderer.pitch.toDouble())
        val hx = cos(hPitch) * cos(hYaw)
        val hy = sin(hPitch)
        val hz = cos(hPitch) * sin(hYaw)
        val cy = cos(yaw); val sy = sin(yaw)
        val cp = cos(pitch); val sp = sin(pitch)
        val z = hx * cp * cy + hy * sp + hz * cp * sy
        if (z <= 0.001) return null
        val x = (hx * -sy + hz * cy) / z
        val y = (hx * -sp * cy + hy * cp + hz * -sp * sy) / z
        val tanHalf = tan(Math.toRadians(renderer.fieldOfView.toDouble() / 2.0))
        val eyeWidth = width.toDouble() / eyes
        val nx = x / (tanHalf * (eyeWidth / height.coerceAtLeast(1)))
        val ny = y / tanHalf
        if (abs(nx) > 1.08 || abs(ny) > 1.08) return null
        return Pair(((nx + 1.0) * eyeWidth / 2 + eye * eyeWidth).toFloat(),
            ((1.0 - ny) * height / 2).toFloat())
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        activeAreas.clear()
        if (height == 0 || width == 0) return
        val eyes = if (renderer.cardboard) 2 else 1
        val radius = 18f * density
        var gazeTarget: HotspotEntry? = null
        for (eye in 0 until eyes) {
            for (hotspot in hotspots) {
                val location = point(hotspot, eye, eyes) ?: continue
                val (x, y) = location
                paint.color = if (hotspot.type == "scene") 0xDD14B8D4.toInt() else 0xDDA8E7F0.toInt()
                canvas.drawCircle(x, y, radius, paint)
                paint.color = 0xFF051927.toInt()
                paint.textSize = 17f * density
                paint.textAlign = Paint.Align.CENTER
                paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
                val symbol = when (hotspot.type) { "scene" -> "➜"; "image" -> "▣"; else -> "i" }
                canvas.drawText(symbol, x, y + 6f * density, paint)
                activeAreas.add(RectF(x-radius, y-radius, x+radius, y+radius) to hotspot)
                if (!renderer.cardboard) {
                    paint.textSize = 12f * density
                    paint.color = Color.WHITE
                    paint.setShadowLayer(4f * density, 0f, 1f, Color.BLACK)
                    canvas.drawText(hotspot.label.take(28), x, y + radius + 16f * density, paint)
                    paint.clearShadowLayer()
                } else if (eye == 0 && abs(x - width / 4f) < radius && abs(y - height / 2f) < radius) {
                    gazeTarget = hotspot
                }
            }
        }
        if (renderer.cardboard) {
            val now = SystemClock.uptimeMillis()
            if (gazeTarget != gazeId) {
                gazeId = gazeTarget
                gazeStart = now
                gazeArmed = true
            }
            val target = gazeTarget
            if (target != null && gazeArmed) {
                val progress = ((now - gazeStart) / 1400f).coerceIn(0f, 1f)
                paint.color = 0xFF5EEDFF.toInt()
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 3f * density
                for (eye in 0 until 2) {
                    val cx = (eye + .5f) * width / 2f
                    canvas.drawArc(cx - radius, height/2f - radius, cx + radius, height/2f + radius,
                        -90f, progress * 360f, false, paint)
                }
                paint.style = Paint.Style.FILL
                if (progress >= 1f) {
                    gazeArmed = false
                    post { onActivate(target) }
                }
            }
        } else gazeId = null
        postInvalidateDelayed(33L)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (renderer.cardboard) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                down = activeAreas.lastOrNull { it.first.contains(event.x, event.y) }?.second
                return down != null
            }
            MotionEvent.ACTION_UP -> {
                val pressed = down
                down = null
                if (pressed != null && activeAreas.any { it.second == pressed && it.first.contains(event.x, event.y) })
                    onActivate(pressed)
                return pressed != null
            }
            MotionEvent.ACTION_CANCEL -> { down = null; return false }
        }
        return down != null
    }
}
