package ru.specdpo.minivr

import android.app.Activity
import android.app.AlertDialog
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/** Native Android UI and GPU panorama player. Never creates a WebView. */
class MainActivity : Activity(), SensorEventListener {
    private lateinit var surface: GLSurfaceView
    private lateinit var overlay: HotspotOverlay
    private lateinit var sensors: SensorManager
    private lateinit var topBar: LinearLayout
    private lateinit var bottomBar: HorizontalScrollView
    private lateinit var title: TextView
    private lateinit var notice: TextView
    private lateinit var vrButton: Button
    private lateinit var gyroButton: Button
    private lateinit var audioButton: Button
    private lateinit var exitVr: Button
    private val renderer = PanoramaRenderer()
    private val ui = Handler(Looper.getMainLooper())
    private val api by lazy { MiniVrApi(BuildConfig.API_BASE, File(filesDir, "minivr-media")) }
    private val audio by lazy { NativeAudioGuide { api.url(it) } }
    private val generation = AtomicInteger()
    private var catalog: List<CatalogEntry> = emptyList()
    private var tour: TourEntry? = null
    private var index = -1
    private var current: SceneEntry? = null
    private var gyro = false
    private var gyroSensor: Sensor? = null
    private var baseline: Pair<Float, Float>? = null
    private var baselineView = Pair(0f, 0f)
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var guidedIndex = -1
    private var autoplay = false
    private val nextScene = Runnable { if (autoplay) moveScene(1) }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()

    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        minWidth = dp(46)
        minHeight = dp(48)
        setTextColor(Color.WHITE)
        setBackgroundColor(0xFF153C4E.toInt())
        setPadding(dp(10), 0, dp(10), 0)
        setOnClickListener { action() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = 0xFF03070D.toInt()
        window.navigationBarColor = 0xFF03070D.toInt()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        sensors = getSystemService(SENSOR_SERVICE) as SensorManager
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val scale = ScaleGestureDetector(this, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                renderer.fieldOfView = (renderer.fieldOfView / detector.scaleFactor).coerceIn(35f, 100f)
                return true
            }
        })
        surface = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            setOnTouchListener { _, event ->
                scale.onTouchEvent(event)
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { lastTouchX = event.x; lastTouchY = event.y }
                    MotionEvent.ACTION_MOVE -> if (event.pointerCount == 1 && !gyro && !scale.isInProgress) {
                        renderer.yaw -= (event.x - lastTouchX) * .18f
                        renderer.pitch = (renderer.pitch + (lastTouchY - event.y) * .18f).coerceIn(-89f, 89f)
                    }
                }
                lastTouchX = event.x; lastTouchY = event.y
                true
            }
        }
        root.addView(surface, FrameLayout.LayoutParams(-1, -1))
        overlay = HotspotOverlay(this, renderer) { onHotspot(it) }
        root.addView(overlay, FrameLayout.LayoutParams(-1, -1))

        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(6), dp(8), dp(6))
            setBackgroundColor(0xCC071622.toInt())
        }
        val topRow = LinearLayout(this)
        topRow.addView(button("☰ Каталог") { openCatalog() })
        title = TextView(this).apply {
            text = "MiniVR Native"
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), 0, 0, 0)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        topRow.addView(title, LinearLayout.LayoutParams(0, dp(48), 1f))
        topBar.addView(topRow)
        notice = TextView(this).apply { textSize = 12f; setTextColor(0xFFB1DFEA.toInt()) }
        topBar.addView(notice)
        root.addView(topBar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(5), dp(5), dp(5), dp(5))
            setBackgroundColor(0xCC071622.toInt())
        }
        buttons.addView(button("‹") { moveScene(-1) })
        buttons.addView(button("Сцены") { openScenes() })
        buttons.addView(button("›") { moveScene(1) })
        buttons.addView(button("🎙 Точки") { openGuidedPoints() })
        audioButton = button("♪ Звук") { val paused = audio.togglePause(); audioButton.text = if (paused) "▶ Звук" else "♪ Звук" }
        buttons.addView(audioButton)
        gyroButton = button("GYRO") { setGyro(!gyro) }
        buttons.addView(gyroButton)
        vrButton = button("▣ SBS") { setCardboard(!renderer.cardboard) }
        buttons.addView(vrButton)
        buttons.addView(button("−") { renderer.fieldOfView = (renderer.fieldOfView + 8).coerceAtMost(100f) })
        buttons.addView(button("+") { renderer.fieldOfView = (renderer.fieldOfView - 8).coerceAtLeast(35f) })
        buttons.addView(button("⟳") { resetView() })
        bottomBar = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(buttons)
        }
        root.addView(bottomBar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        exitVr = button("✕ Закрыть VR") { setCardboard(false) }.apply { visibility = View.GONE }
        root.addView(exitVr, FrameLayout.LayoutParams(-2, dp(50), Gravity.TOP or Gravity.RIGHT).apply {
            topMargin = dp(10)
            rightMargin = dp(10)
        })
        setContentView(root)
        openCatalog()
    }

    private fun notifyUser(message: String) {
        notice.text = message
    }

    private fun loadCatalog() {
        notifyUser("Получение каталога…")
        thread(name = "MiniVR-catalog") {
            try {
                val entries = api.catalog()
                runOnUiThread {
                    catalog = entries
                    notifyUser("${entries.size} материалов и экскурсий")
                    showCatalogDialog()
                }
            } catch (error: Exception) {
                runOnUiThread { notifyUser("Ошибка каталога: ${error.message}") }
            }
        }
    }

    private fun openCatalog() {
        if (catalog.isEmpty()) loadCatalog() else showCatalogDialog()
    }

    private fun showCatalogDialog() {
        if (catalog.isEmpty()) {
            Toast.makeText(this, "Нет опубликованных материалов", Toast.LENGTH_LONG).show()
            return
        }
        val labels = catalog.map { if (it.isTour) "🗺  ${it.title}" else "◉  ${it.title}" }
        AlertDialog.Builder(this).setTitle("MiniVR · Каталог")
            .setItems(labels.toTypedArray()) { _, i ->
                val item = catalog[i]
                if (item.isTour) openTour(item.id) else openPanorama(item.id)
            }.setNegativeButton("Закрыть", null).show()
    }

    private fun openPanorama(id: Int) {
        val token = generation.incrementAndGet()
        ui.removeCallbacks(nextScene)
        notifyUser("Загрузка панорамы…")
        thread(name = "MiniVR-panorama") {
            try {
                val scene = api.panorama(id)
                runOnUiThread {
                    if (token != generation.get()) return@runOnUiThread
                    tour = null
                    index = -1
                    displayScene(scene, token)
                }
            } catch (e: Exception) { showLoadError(token, e) }
        }
    }

    private fun openTour(id: Int) {
        val token = generation.incrementAndGet()
        ui.removeCallbacks(nextScene)
        notifyUser("Загрузка экскурсии…")
        thread(name = "MiniVR-tour") {
            try {
                val loaded = api.tour(id)
                check(loaded.scenes.isNotEmpty()) { "В экскурсии нет опубликованных сцен" }
                runOnUiThread {
                    if (token != generation.get()) return@runOnUiThread
                    tour = loaded
                    val start = loaded.scenes.indexOfFirst { it.id == loaded.startSceneId }
                    index = if (start < 0) 0 else start
                    displayScene(loaded.scenes[index], token)
                }
            } catch (e: Exception) { showLoadError(token, e) }
        }
    }

    private fun displayScene(scene: SceneEntry, token: Int = generation.incrementAndGet()) {
        ui.removeCallbacks(nextScene)
        audio.stop()
        current = scene
        guidedIndex = -1
        overlay.hotspots = emptyList()
        renderer.yaw = 0f
        renderer.pitch = 0f
        renderer.fieldOfView = 75f
        baseline = null
        title.text = scene.title
        notifyUser("Загрузка изображения…")
        thread(name = "MiniVR-image") {
            try {
                val bitmap = api.bitmap(scene.image)
                if (token != generation.get()) { bitmap.recycle(); return@thread }
                val aspect = if (scene.stereo.equals("sbs", true)) bitmap.width / 2f / bitmap.height
                    else if (scene.stereo.equals("tb", true)) bitmap.width * 2f / bitmap.height
                    else bitmap.width.toFloat() / bitmap.height
                val spec = PanoramaFormat(
                    scene.projection, scene.stereo,
                    scene.effects.optBoolean("mirrorHorizontal", false), aspect
                )
                renderer.offerImage(bitmap, spec)
                runOnUiThread {
                    if (token != generation.get()) return@runOnUiThread
                    val stops = tour?.hotspots?.filter { it.sceneId == scene.id } ?: emptyList()
                    overlay.hotspots = stops
                    audio.enterScene(scene.audio)
                    notifyUser("${scene.projection}° · ${scene.stereo.uppercase()} · ${indexLabel()}")
                    if (autoplay) scheduleNext(scene)
                }
            } catch (e: Exception) { showLoadError(token, e) }
        }
    }

    private fun showLoadError(token: Int, error: Exception) {
        runOnUiThread {
            if (token == generation.get()) notifyUser("Ошибка: ${error.message}")
        }
    }

    private fun indexLabel(): String {
        val t = tour ?: return "Панорама"
        return "Сцена ${index + 1} из ${t.scenes.size}"
    }

    private fun scheduleNext(scene: SceneEntry) {
        val seconds = (scene.durationSeconds ?: scene.effects.optInt("tourDuration", 30))
        if (seconds > 0 && tour != null && index < (tour?.scenes?.lastIndex ?: 0))
            ui.postDelayed(nextScene, seconds.coerceIn(1, 3600) * 1000L)
    }

    private fun moveScene(direction: Int) {
        val scenes = tour?.scenes ?: return
        val next = index + direction
        if (next in scenes.indices) {
            index = next
            displayScene(scenes[next])
        } else Toast.makeText(this, "Конец маршрута", Toast.LENGTH_SHORT).show()
    }

    private fun openScenes() {
        val t = tour ?: return
        AlertDialog.Builder(this).setTitle(t.title)
            .setItems(t.scenes.mapIndexed { i, s -> "${i + 1}. ${s.title}" }.toTypedArray()) { _, selected ->
                index = selected
                displayScene(t.scenes[index])
            }.setNeutralButton(if (autoplay) "⏸ Автомаршрут" else "▶ Автомаршрут") { _, _ ->
                autoplay = !autoplay
                ui.removeCallbacks(nextScene)
                if (autoplay) current?.let { scheduleNext(it) }
            }.setNegativeButton("Закрыть", null).show()
    }

    private fun onHotspot(h: HotspotEntry) {
        when (h.type) {
            "scene" -> {
                val t = tour ?: return
                val destination = t.scenes.indexOfFirst { it.id == h.targetSceneId }
                if (destination >= 0) { index = destination; displayScene(t.scenes[destination]) }
            }
            "image" -> {
                val target = h.content ?: return
                val view = ImageView(this).apply { adjustViewBounds = true }
                val dialog = AlertDialog.Builder(this).setTitle(h.label).setView(view)
                    .setPositiveButton("Закрыть", null).create()
                dialog.show()
                thread(name = "MiniVR-hotspot-image") {
                    try {
                        val bmp = api.bitmap(target)
                        runOnUiThread { if (dialog.isShowing) view.setImageBitmap(bmp) else bmp.recycle() }
                    } catch (e: Exception) { runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_SHORT).show() } }
                }
            }
            else -> AlertDialog.Builder(this).setTitle(h.label)
                .setMessage(h.content ?: "").setPositiveButton("Закрыть", null).show()
        }
    }

    private fun openGuidedPoints() {
        val scene = current ?: return
        val points = scene.guidedPoints
        if (points.length() == 0) {
            Toast.makeText(this, "В этой сцене нет точек рассказа", Toast.LENGTH_SHORT).show()
            return
        }
        val labels = (0 until points.length()).map { i ->
            "${i + 1}. ${points.getJSONObject(i).optString("title", "Точка рассказа")}"
        }
        AlertDialog.Builder(this).setTitle("Точки рассказа")
            .setItems(labels.toTypedArray()) { _, i -> showGuidedPoint(i) }
            .setNegativeButton("Закрыть", null).show()
    }

    private fun showGuidedPoint(i: Int) {
        val points = current?.guidedPoints ?: return
        if (i !in 0 until points.length()) return
        val point: JSONObject = points.getJSONObject(i)
        guidedIndex = i
        renderer.yaw = point.optDouble("yaw", 0.0).toFloat()
        renderer.pitch = point.optDouble("pitch", 0.0).toFloat()
        audio.playPoint(point.optString("audio").takeIf { it.isNotBlank() && it != "null" })
        AlertDialog.Builder(this)
            .setTitle(point.optString("title", "Точка ${i + 1}"))
            .setMessage(point.optString("text", ""))
            .setPositiveButton(if (i == points.length() - 1) "Завершить" else "Следующая →") { _, _ ->
                if (i + 1 < points.length()) showGuidedPoint(i + 1)
            }.setNegativeButton("Закрыть", null).show()
    }

    private fun resetView() {
        renderer.yaw = 0f; renderer.pitch = 0f
        baseline = null
    }

    private fun setCardboard(active: Boolean) {
        renderer.cardboard = active
        requestedOrientation = if (active) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        vrButton.text = if (active) "✕ SBS" else "▣ SBS"
        topBar.visibility = if (active) View.GONE else View.VISIBLE
        bottomBar.visibility = if (active) View.GONE else View.VISIBLE
        exitVr.visibility = if (active) View.VISIBLE else View.GONE
        if (active && !gyro) setGyro(true)
        overlay.invalidate()
    }

    private fun setGyro(active: Boolean) {
        gyro = active
        baseline = null
        sensors.unregisterListener(this)
        if (active) {
            gyroSensor = sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            if (gyroSensor == null) {
                gyro = false
                Toast.makeText(this, "Нет датчика ориентации", Toast.LENGTH_SHORT).show()
            } else {
                sensors.registerListener(this, gyroSensor, SensorManager.SENSOR_DELAY_GAME)
            }
        }
        gyroButton.text = if (gyro) "◉ GYRO" else "GYRO"
    }

    private fun wrap(angle: Float): Float = ((angle + 540f) % 360f) - 180f
    override fun onSensorChanged(event: SensorEvent) {
        if (!gyro || event.sensor.type != Sensor.TYPE_GAME_ROTATION_VECTOR) return
        val rotation = FloatArray(9)
        val orientation = FloatArray(3)
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        SensorManager.getOrientation(rotation, orientation)
        val yaw = Math.toDegrees(orientation[0].toDouble()).toFloat()
        val pitch = Math.toDegrees(orientation[1].toDouble()).toFloat()
        val first = baseline
        if (first == null) {
            baseline = Pair(yaw, pitch)
            baselineView = Pair(renderer.yaw, renderer.pitch)
        } else {
            renderer.yaw = baselineView.first - wrap(yaw - first.first)
            renderer.pitch = (baselineView.second + pitch - first.second).coerceIn(-89f, 89f)
        }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    override fun onPause() {
        ui.removeCallbacks(nextScene)
        sensors.unregisterListener(this)
        audio.pause()
        surface.onPause()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        surface.onResume()
        if (gyro) setGyro(true)
    }
    override fun onDestroy() {
        generation.incrementAndGet()
        ui.removeCallbacks(nextScene)
        sensors.unregisterListener(this)
        audio.stop()
        super.onDestroy()
    }
    @Deprecated("Use system Back navigation")
    override fun onBackPressed() {
        if (renderer.cardboard) setCardboard(false)
        else if (tour != null) { tour = null; openCatalog() }
        else super.onBackPressed()
    }
}
