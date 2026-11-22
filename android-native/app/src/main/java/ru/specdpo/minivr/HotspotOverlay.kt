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
        val radius = (if (renderer.cardboard) 25f else 23f) * density
        var gazeTarget: HotspotEntry? = null
        var nearest = Float.MAX_VALUE
        for (eye in 0 until eyes) {
            for (hotspot in hotspots) {
                val location = point(hotspot, eye, eyes) ?: continue
                val (x, y) = location
                val highlighted = hotspot == down || (renderer.cardboard && hotspot == gazeId)
                paint.style = Paint.Style.FILL
                paint.color = if (highlighted) 0xFF5EEDFF.toInt() else
                    if (hotspot.type == "scene") 0xF014B8D4.toInt() else 0xF0A8E7F0.toInt()
                canvas.drawCircle(x, y, radius, paint)
                if (highlighted) {
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 4f * density
                    paint.color = Color.WHITE
                    canvas.drawCircle(x, y, radius + 5f * density, paint)
                    paint.style = Paint.Style.FILL
                }
                paint.color = 0xFF051927.toInt()
                paint.textSize = 20f * density
                paint.textAlign = Paint.Align.CENTER
                paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
                val symbol = when (hotspot.type) { "scene" -> "➜"; "image" -> "▣"; else -> "i" }
                canvas.drawText(symbol, x, y + 6f * density, paint)
                val touchRadius = radius + 12f * density
                activeAreas.add(RectF(x-touchRadius, y-touchRadius, x+touchRadius, y+touchRadius) to hotspot)
                if (!renderer.cardboard) {
                    paint.textSize = 14f * density
                    paint.color = Color.WHITE
                    paint.setShadowLayer(4f * density, 0f, 1f, Color.BLACK)
                    canvas.drawText(hotspot.label.take(26), x, y + radius + 18f * density, paint)
                    paint.clearShadowLayer()
                } else if (eye == 0) {
                    val dx = x - width / 4f
                    val dy = y - height / 2f
                    val distance = dx * dx + dy * dy
                    if (distance < touchRadius * touchRadius && distance < nearest) {
                        gazeTarget = hotspot
                        nearest = distance
                    }
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
            val progress = if (target != null && gazeArmed)
                ((now - gazeStart) / 1400f).coerceIn(0f, 1f) else 0f
            // Always-visible sight in each eye; cyan and label indicate the selected point.
            for (eye in 0 until 2) {
                val cx = (eye + .5f) * width / 2f
                val cy = height / 2f
                paint.color = if (target == null) 0xDDFFFFFF.toInt() else 0xFF5EEDFF.toInt()
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2.5f * density
                canvas.drawCircle(cx, cy, 10f * density, paint)
                canvas.drawLine(cx - 19f * density, cy, cx - 13f * density, cy, paint)
                canvas.drawLine(cx + 13f * density, cy, cx + 19f * density, cy, paint)
                if (target != null) {
                    paint.strokeWidth = 4f * density
                    canvas.drawArc(cx - radius, cy - radius, cx + radius, cy + radius,
                        -90f, progress * 360f, false, paint)
                    paint.style = Paint.Style.FILL
                    val label = target.label.take(22)
                    val labelY = cy + radius + 39f * density
                    paint.textAlign = Paint.Align.CENTER
                    paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
                    paint.textSize = 15f * density
                    val halfWidth = minOf(width / 4f - 10f * density,
                        paint.measureText(label) / 2f + 17f * density)
                    paint.color = 0xEA031824.toInt()
                    canvas.drawRoundRect(RectF(cx - halfWidth, labelY - 25f * density,
                        cx + halfWidth, labelY + 10f * density), 8f * density, 8f * density, paint)
                    paint.color = Color.WHITE
                    canvas.drawText(label, cx, labelY, paint)
                }
            }
            if (target != null && gazeArmed) {
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
                invalidate()
                return down != null
            }
            MotionEvent.ACTION_UP -> {
                val pressed = down
                down = null
                invalidate()
                if (pressed != null && activeAreas.any { it.second == pressed && it.first.contains(event.x, event.y) })
                    onActivate(pressed)
                return pressed != null
            }
            MotionEvent.ACTION_CANCEL -> { down = null; return false }
        }
        return down != null
    }
}
