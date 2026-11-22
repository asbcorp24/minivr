package ru.specdpo.minivr

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Typeface
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
    private lateinit var bottomBar: LinearLayout
    private lateinit var title: TextView
    private lateinit var notice: TextView
    private lateinit var previousButton: Button
    private lateinit var nextButton: Button
    private lateinit var scenesButton: Button
    private lateinit var exitVr: Button
    private val thumbnails by lazy { NativeThumbnailLoader(this, api) }
    private val menus by lazy { NativeMenuDialogs(this, thumbnails) }
    private val renderer = PanoramaRenderer()
    private val ui = Handler(Looper.getMainLooper())
    private val api by lazy { MiniVrApi(BuildConfig.API_BASE, File(filesDir, "minivr-media")) }
    private val music by lazy { NativeMusicPlayer { api.url(it) } }
    private val audio by lazy { NativeAudioGuide({ api.url(it) }) { music.duck(it) } }
    private val generation = AtomicInteger()
    private var catalog: List<CatalogEntry> = emptyList()
    private var tour: TourEntry? = null
    private var index = -1
    private var current: SceneEntry? = null
    private var selectedMaterialId: Int? = null
    private var selectedMaterialIsTour = false
    private var tileStreamer: NativeTileStreamer? = null
    private var gyro = false
    private var gyroSensor: Sensor? = null
    private var baseline: Pair<Float, Float>? = null
    private var baselineView = Pair(0f, 0f)
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var guidedIndex = -1
    private var narrationPaused = false
    private var autoplay = false
    private val nextScene = Runnable { if (autoplay) moveScene(1) }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()

    private fun button(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        textSize = 13f
        isAllCaps = false
        minWidth = dp(52)
        minHeight = dp(56)
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        setTextColor(MiniVrStyle.text)
        background = MiniVrStyle.touchBackground(this@MainActivity)
        setPadding(dp(10), 0, dp(10), 0)
        setOnClickListener { action() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = MiniVrStyle.background
        window.navigationBarColor = MiniVrStyle.background
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
            setPreserveEGLContextOnPause(true)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            setOnTouchListener { _, event ->
                scale.onTouchEvent(event)
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { lastTouchX = event.x; lastTouchY = event.y }
                    MotionEvent.ACTION_MOVE -> if (event.pointerCount == 1 && !gyro && !scale.isInProgress) {
                        renderer.yaw -= (event.x - lastTouchX) * .18f
                        renderer.pitch = (renderer.pitch + (lastTouchY - event.y) * .18f).coerceIn(-89f, 89f)
                        renderer.motionX = (renderer.motionX + (event.x - lastTouchX) * .004f).coerceIn(-.8f, .8f)
                        renderer.motionY = (renderer.motionY + (lastTouchY - event.y) * .004f).coerceIn(-.8f, .8f)
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
            setPadding(dp(10), dp(7), dp(10), dp(6))
            background = MiniVrStyle.border(this@MainActivity, MiniVrStyle.glass,
                0x883A8294.toInt(), 10)
        }
        val topRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        topRow.addView(MiniVrStyle.brand(this), LinearLayout.LayoutParams(-2, dp(55)))
        title = TextView(this).apply {
            text = "Панорамы 360°"
            setTextColor(MiniVrStyle.text)
            textSize = 14f
            setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(6), 0)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        topRow.addView(title, LinearLayout.LayoutParams(0, dp(55), 1f))
        topRow.addView(button("☰ МАТЕРИАЛЫ") { openCatalog() }.apply {
            textSize = 10.5f
            setPadding(dp(7), 0, dp(7), 0)
        }, LinearLayout.LayoutParams(-2, dp(46)))
        topBar.addView(topRow)
        notice = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
            setTextColor(MiniVrStyle.cyan)
            letterSpacing = .06f
            setPadding(dp(5), dp(2), dp(5), dp(5))
            maxLines = 2
        }
        topBar.addView(notice)
        root.addView(topBar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply {
            leftMargin = dp(10)
            rightMargin = dp(10)
            topMargin = dp(8)
        })

        bottomBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = MiniVrStyle.border(this@MainActivity,
                MiniVrStyle.glass, 0xAA3FDCED.toInt(), 12)
        }
        fun addPrimary(button: Button, weight: Float = 1f) {
            bottomBar.addView(button, LinearLayout.LayoutParams(0, dp(54), weight).apply {
                leftMargin = dp(2)
                rightMargin = dp(2)
            })
        }
        previousButton = button("◀ Назад") { moveScene(-1) }
        scenesButton = button("▦ Сцены") { openScenes() }
        nextButton = button("Далее ▶") { moveScene(1) }
        addPrimary(previousButton)
        addPrimary(scenesButton, 1.25f)
        addPrimary(nextButton)
        addPrimary(button("⚙ МЕНЮ") { openControls() })
        for (i in 0 until bottomBar.childCount) {
            (bottomBar.getChildAt(i) as Button).apply {
                textSize = 12f
                setPadding(dp(3), 0, dp(3), 0)
                setSingleLine(true)
            }
        }
        updateNavigationButtons()
        root.addView(bottomBar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply {
            leftMargin = dp(9)
            rightMargin = dp(9)
            bottomMargin = dp(10)
        })
        exitVr = button("✕ ВЫЙТИ ИЗ VR") { setCardboard(false) }.apply { visibility = View.GONE }
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
                val tracks = runCatching { api.music() }.getOrDefault(emptyList())
                runOnUiThread {
                    catalog = entries
                    music.setTracks(tracks)
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
        val entries = catalog.map { item ->
            NativeMenuDialogs.Item(
                item.id, item.title,
                item.description.ifBlank {
                    if (item.isTour) "Интерактивная виртуальная экскурсия" else "Иммерсивный VR-материал"
                },
                if (item.isTour) "TOUR" else item.format.uppercase(),
                if (item.isTour) "tour" else "panorama",
                selectedMaterialId == item.id && selectedMaterialIsTour == item.isTour,
                item.thumbnail
            )
        }
        menus.showCatalog(entries) { item ->
            if (item.group == "tour") openTour(item.id) else openPanorama(item.id)
        }
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
                    selectedMaterialId = id
                    selectedMaterialIsTour = false
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
                    selectedMaterialId = id
                    selectedMaterialIsTour = true
                    val start = loaded.scenes.indexOfFirst { it.id == loaded.startSceneId }
                    index = if (start < 0) 0 else start
                    displayScene(loaded.scenes[index], token)
                }
            } catch (e: Exception) { showLoadError(token, e) }
        }
    }

    private fun displayScene(scene: SceneEntry, token: Int = generation.incrementAndGet()) {
        ui.removeCallbacks(nextScene)
        tileStreamer?.stop()
        tileStreamer = null
        audio.stop()
        current = scene
        guidedIndex = -1
        overlay.hotspots = emptyList()
        renderer.yaw = 0f
        renderer.pitch = 0f
        renderer.fieldOfView = 75f
        renderer.motionX = 0f
        renderer.motionY = 0f
        updateNavigationButtons()
        baseline = null
        title.text = scene.title
        notifyUser("Загрузка изображения…")
        thread(name = "MiniVR-image") {
            try {
                var tiles: NativeTileStreamer? = null
                val tiled = scene.tilesManifest.takeIf {
                    scene.projection == "360" && scene.stereo == "mono"
                }
                val bitmap = if (tiled != null) {
                    runCatching {
                        val streamer = NativeTileStreamer(api, renderer, api.tileManifest(tiled))
                        val low = streamer.baseBitmap()
                        tiles = streamer
                        low
                    }.getOrElse { api.bitmap(scene.image) }
                } else api.bitmap(scene.image)
                if (token != generation.get()) { bitmap.recycle(); return@thread }
                val aspect = if (scene.stereo.equals("sbs", true)) bitmap.width / 2f / bitmap.height
                    else if (scene.stereo.equals("tb", true)) bitmap.width * 2f / bitmap.height
                    else bitmap.width.toFloat() / bitmap.height
                val spec = PanoramaFormat(
                    scene.projection, scene.stereo,
                    scene.effects.optBoolean("mirrorHorizontal", false), aspect
                )
                renderer.offerImage(bitmap, spec, NativeSceneEffects.from(scene.effects))
                loadDepthAndMasks(scene, token)
                runOnUiThread {
                    if (token != generation.get()) { tiles?.stop(); return@runOnUiThread }
                    tileStreamer = tiles
                    tiles?.start()
                    val stops = tour?.hotspots?.filter { it.sceneId == scene.id } ?: emptyList()
                    overlay.hotspots = stops
                    audio.enterScene(scene.audio)
                    narrationPaused = false
                    val trackId = scene.effects.optInt("musicTrackId", 0)
                    music.selectTrack(trackId)
                    val quality = if (tiles != null) "тайлы" else "изображение"
                    val gpu = when {
                        !renderer.advancedSupported -> "GPU Basic · "
                        !renderer.environmentSupported -> "FX Lite · "
                        else -> "FX Pro · "
                    }
                    val depth = if (scene.effects.optBoolean("parallaxEnabled") &&
                        scene.effects.optString("parallaxDepth").startsWith("/")) " · 3D" else ""
                    notifyUser("$gpu${scene.projection}° · ${scene.stereo.uppercase()} · $quality$depth · ${indexLabel()}")
                    if (autoplay) scheduleNext(scene)
                }
            } catch (e: Exception) { showLoadError(token, e) }
        }
    }

    private fun loadDepthAndMasks(scene: SceneEntry, token: Int) {
        val settings = scene.effects
        if (scene.projection != "360" || scene.stereo != "mono") return
        thread(name = "MiniVR-environment-masks") {
            runCatching { NativeEffectMasks.from(settings) }.getOrNull()?.let { masks ->
                if (token == generation.get()) renderer.offerEnvironmentMasks(masks)
                else masks.recycle()
            }
        }
        val depth = settings.optString("parallaxDepth").takeIf {
            settings.optBoolean("parallaxEnabled") && it.isNotBlank() && it != "null"
        }
        if (depth != null) thread(name = "MiniVR-depth") {
            runCatching {
                val map = api.bitmap(depth, 1024)
                if (token == generation.get()) renderer.offerDepth(map) else map.recycle()
            }
        }
        thread(name = "MiniVR-masks") {
            (NativeSceneEffects.decodeMask(settings, "parallaxWaterMask")
                ?: NativeSceneEffects.polygonMask(settings, "water"))?.let {
                if (token == generation.get()) renderer.offerWaterMask(it) else it.recycle()
            }
            (NativeSceneEffects.decodeMask(settings, "parallaxFoliageMask")
                ?: NativeSceneEffects.polygonMask(settings, "vegetation"))?.let {
                if (token == generation.get()) renderer.offerFoliageMask(it) else it.recycle()
            }
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

    private fun updateNavigationButtons() {
        if (!::previousButton.isInitialized) return
        val size = tour?.scenes?.size ?: 0
        previousButton.isEnabled = size > 0 && index > 0
        nextButton.isEnabled = size > 0 && index < size - 1
        scenesButton.isEnabled = size > 0
        previousButton.alpha = if (previousButton.isEnabled) 1f else .4f
        nextButton.alpha = if (nextButton.isEnabled) 1f else .4f
        scenesButton.alpha = if (scenesButton.isEnabled) 1f else .4f
        scenesButton.text = if (size > 0) "▦ ${index + 1}/$size" else "▦ Сцены"
    }

    private fun depthAvailable(): Boolean {
        val scene = current ?: return false
        return scene.projection == "360" && scene.stereo == "mono" &&
            scene.effects.optBoolean("parallaxEnabled") &&
            scene.effects.optString("parallaxDepth").let { it.isNotBlank() && it != "null" }
    }

    private fun openControls() {
        fun option(title: String, detail: String, icon: String, section: String,
                   enabled: () -> Boolean = { true }, active: () -> Boolean = { false },
                   close: Boolean = false, toggle: Boolean = false,
                   tap: () -> Unit) = NativeMenuDialogs.Control(
            title, detail, icon, section, enabled, active, close, tap, toggle)

        menus.showControls(listOf(
            option("Гироскоп", "Обзор поворотом телефона", "◉", "Просмотр",
                enabled = { sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR) != null },
                active = { gyro }, toggle = true) { setGyro(!gyro) },
            option("3D-параллакс", "Объём по карте глубины", "3D", "Просмотр",
                enabled = { depthAvailable() }, active = { renderer.depthEnabled }, toggle = true) {
                renderer.depthEnabled = !renderer.depthEnabled
            },
            option("Графические эффекты", "Вода, частицы, освещение", "FX", "Просмотр",
                active = { renderer.effectsEnabled }, toggle = true) {
                renderer.effectsEnabled = !renderer.effectsEnabled
            },
            option("Режим VR / SBS", "Два изображения для гарнитуры", "▣", "Просмотр",
                active = { renderer.cardboard }, close = true, toggle = true) {
                setCardboard(!renderer.cardboard)
            },
            option("Приблизить", "Уменьшить угол обзора", "+", "Просмотр") {
                renderer.fieldOfView = (renderer.fieldOfView - 8).coerceAtLeast(35f)
            },
            option("Отдалить", "Увеличить угол обзора", "−", "Просмотр") {
                renderer.fieldOfView = (renderer.fieldOfView + 8).coerceAtMost(100f)
            },
            option("Вернуть направление", "Сбросить поворот камеры", "⟳", "Просмотр") {
                resetView()
            },
            option("Аудиогид", "Приостановить или продолжить речь", "🎙", "Звук",
                enabled = { current != null }, active = { !narrationPaused }, toggle = true) {
                narrationPaused = audio.togglePause()
            },
            option("Музыка", "Воспроизведение / пауза", "♫", "Звук",
                enabled = { music.hasTracks() }, active = { music.isPlayingRequested() }, toggle = true) {
                music.toggle()
            },
            option("Предыдущий трек", "Переключить музыку назад", "◀", "Звук",
                enabled = { music.hasTracks() }) {
                music.skip(-1)?.let { Toast.makeText(this, it, Toast.LENGTH_SHORT).show() }
            },
            option("Следующий трек", "Переключить музыку вперёд", "▶", "Звук",
                enabled = { music.hasTracks() }) {
                music.skip(1)?.let { Toast.makeText(this, it, Toast.LENGTH_SHORT).show() }
            },
            option("Список сцен", "Открыть маршрут экскурсии", "▦", "Экскурсия",
                enabled = { tour != null }, close = true) {
                openScenes()
            },
            option("Точки рассказа", "Выбрать комментарий и прослушать", "◎", "Экскурсия",
                enabled = { (current?.guidedPoints?.length() ?: 0) > 0 }, close = true) {
                openGuidedPoints()
            },
            option("Описание", "Информация о панораме", "ⓘ", "Экскурсия",
                enabled = { current != null }, close = true) {
                showDescription()
            },
            option("Автомаршрут", "Автоматическая смена сцен", "↻", "Экскурсия",
                enabled = { tour != null }, active = { autoplay }, toggle = true) {
                autoplay = !autoplay
                ui.removeCallbacks(nextScene)
                if (autoplay) current?.let { scheduleNext(it) }
            }
        ))
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
        val items = t.scenes.mapIndexed { i, scene ->
            NativeMenuDialogs.Item(i, scene.title,
                "Сцена ${i + 1} из ${t.scenes.size}",
                "%02d".format(i + 1), group = "scene", selected = i == index,
                thumbnail = scene.preview)
        }
        menus.showList("Сцены экскурсии", t.title, items,
            footerText = if (autoplay) "⏸ Отключить автомаршрут" else "▶ Включить автомаршрут",
            onFooter = {
                autoplay = !autoplay
                ui.removeCallbacks(nextScene)
                if (autoplay) current?.let { scheduleNext(it) }
                if (autoplay) "⏸ Отключить автомаршрут" else "▶ Включить автомаршрут"
            }) { selected ->
                index = selected.id
                displayScene(t.scenes[index])
            }
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
                if (h.imageStereo.equals("sbs", true) || h.imageStereo.equals("tb", true)) {
                    NativeStereoPhotoDialog(this, api).show(target, h.imageStereo, h.label)
                    return
                }
                menus.showImage(h.label) { view, dialog ->
                    thread(name = "MiniVR-hotspot-image") {
                        try {
                            val bmp = api.bitmap(target)
                            runOnUiThread {
                                if (dialog.isShowing) view.setImageBitmap(bmp) else bmp.recycle()
                            }
                        } catch (e: Exception) {
                            runOnUiThread { Toast.makeText(this, e.message, Toast.LENGTH_SHORT).show() }
                        }
                    }
                }
            }
            else -> menus.showInfo(h.label, h.content.orEmpty(), "MINIVR / ТОЧКА ИНТЕРЕСА")
        }
    }

    private fun openGuidedPoints() {
        val scene = current ?: return
        val points = scene.guidedPoints
        if (points.length() == 0) {
            Toast.makeText(this, "В этой сцене нет точек рассказа", Toast.LENGTH_SHORT).show()
            return
        }
        val items = (0 until points.length()).map { i ->
            val point = points.getJSONObject(i)
            NativeMenuDialogs.Item(i,
                point.optString("title", "Точка рассказа"),
                "Аудиоточка ${i + 1} из ${points.length()}",
                "%02d".format(i + 1), group = "point", selected = i == guidedIndex)
        }
        menus.showList("Точки рассказа", current?.title.orEmpty(), items) { selected ->
            showGuidedPoint(selected.id)
        }
    }

    private fun showDescription() {
        val scene = current ?: return
        val message = scene.description.ifBlank { "Описание для этой панорамы не задано" }
        menus.showInfo(scene.title, message, "MINIVR / ОПИСАНИЕ")
    }

    private fun showGuidedPoint(i: Int) {
        val points = current?.guidedPoints ?: return
        if (i !in 0 until points.length()) return
        val point: JSONObject = points.getJSONObject(i)
        guidedIndex = i
        renderer.yaw = point.optDouble("yaw", 0.0).toFloat()
        renderer.pitch = point.optDouble("pitch", 0.0).toFloat()
        val pointAudio = point.optString("audio").takeIf { it.isNotBlank() && it != "null" }
        audio.playPoint(pointAudio)
        menus.showInfo(point.optString("title", "Точка ${i + 1}"),
            point.optString("text", ""), "MINIVR / АУДИОТОЧКА ${i + 1}",
            nextLabel = if (i == points.length() - 1) null else "СЛЕДУЮЩАЯ →",
            onNext = if (i + 1 < points.length()) ({ showGuidedPoint(i + 1) }) else null)
    }

    private fun resetView() {
        renderer.yaw = 0f; renderer.pitch = 0f
        renderer.motionX = 0f; renderer.motionY = 0f
        baseline = null
    }

    private fun setCardboard(active: Boolean) {
        renderer.cardboard = active
        requestedOrientation = if (active) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
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
            renderer.motionX = (wrap(yaw - first.first) / 45f).coerceIn(-.7f, .7f)
            renderer.motionY = ((pitch - first.second) / 45f).coerceIn(-.7f, .7f)
        }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    override fun onPause() {
        ui.removeCallbacks(nextScene)
        sensors.unregisterListener(this)
        audio.pause()
        narrationPaused = true
        music.pause()
        tileStreamer?.setPaused(true)
        surface.onPause()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        surface.onResume()
        tileStreamer?.setPaused(false)
        if (gyro) setGyro(true)
    }
    override fun onDestroy() {
        generation.incrementAndGet()
        tileStreamer?.stop()
        ui.removeCallbacks(nextScene)
        sensors.unregisterListener(this)
        audio.stop()
        music.stop()
        if (this::surface.isInitialized && this::topBar.isInitialized) thumbnails.shutdown()
        super.onDestroy()
    }
    @Deprecated("Use system Back navigation")
    override fun onBackPressed() {
        if (renderer.cardboard) setCardboard(false)
        else if (tour != null) { tour = null; index = -1; updateNavigationButtons(); openCatalog() }
        else super.onBackPressed()
    }
}
