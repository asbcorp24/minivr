package ru.specdpo.minivr

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.os.SystemClock
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.tan

/** MiniVR angles: yaw 0 looks along +X, yaw 90 along +Z. */
data class PanoramaFormat(
    val projection: String = "360",
    val stereo: String = "mono",
    val mirror: Boolean = false,
    val imageAspect: Float = 2f
)

/** Pure OpenGL ES GPU renderer: no WebView or JavaScript. */
class PanoramaRenderer : GLSurfaceView.Renderer {
    @Volatile var yaw = 0f
    @Volatile var pitch = 0f
    @Volatile var fieldOfView = 75f
    @Volatile var cardboard = false
    @Volatile var depthEnabled = true
    @Volatile var effectsEnabled = true
    @Volatile var advancedSupported = true
        private set
    @Volatile var motionX = 0f
    @Volatile var motionY = 0f
    @Volatile var viewportWidth = 1080
        private set
    @Volatile var viewportHeight = 1920
        private set
    @Volatile var sceneEffects = NativeSceneEffects()
        private set
    @Volatile var format = PanoramaFormat()
        private set

    private data class NewImage(val bitmap: Bitmap, val format: PanoramaFormat, val effects: NativeSceneEffects)
    private var nextImage: NewImage? = null
    private var nextDepth: Bitmap? = null
    private var nextWater: Bitmap? = null
    private var nextFoliage: Bitmap? = null
    private var nextAtlas: Pair<Bitmap, TileAtlasInfo>? = null
    private var program = 0
    private var texture = 0
    private var depthTexture = 0
    private var waterTexture = 0
    private var foliageTexture = 0
    private var atlasTexture = 0
    private var hasTexture = false
    private var hasDepth = false
    private var hasWater = false
    private var hasFoliage = false
    private var hasAtlas = false
    private var atlasInfo = TileAtlasInfo(0f, 0f, 1f, 1f)
    private val uniformCache = mutableMapOf<String, Int>()
    private var width = 1
    private var height = 1
    private val quad = ByteBuffer.allocateDirect(12 * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, -1f, 1f, 1f, -1f, 1f))
            position(0)
        }

    @Synchronized fun offerImage(bitmap: Bitmap, spec: PanoramaFormat, effects: NativeSceneEffects = NativeSceneEffects()) {
        nextImage?.bitmap?.recycle()
        nextDepth?.recycle(); nextDepth = null
        nextWater?.recycle(); nextWater = null
        nextFoliage?.recycle(); nextFoliage = null
        nextAtlas?.first?.recycle(); nextAtlas = null
        nextImage = NewImage(bitmap, spec, effects)
    }
    @Synchronized fun discardPendingImage() {
        nextImage?.bitmap?.recycle()
        nextImage = null
    }
    @Synchronized private fun takeImage(): NewImage? = nextImage.also { nextImage = null }
    @Synchronized fun offerDepth(bitmap: Bitmap) { nextDepth?.recycle(); nextDepth = bitmap }
    @Synchronized fun offerWaterMask(bitmap: Bitmap) { nextWater?.recycle(); nextWater = bitmap }
    @Synchronized fun offerFoliageMask(bitmap: Bitmap) { nextFoliage?.recycle(); nextFoliage = bitmap }
    @Synchronized fun offerTileAtlas(bitmap: Bitmap, info: TileAtlasInfo) {
        nextAtlas?.first?.recycle()
        nextAtlas = bitmap to info
    }
    @Synchronized private fun takeDepth(): Bitmap? = nextDepth.also { nextDepth = null }
    @Synchronized private fun takeWater(): Bitmap? = nextWater.also { nextWater = null }
    @Synchronized private fun takeFoliage(): Bitmap? = nextFoliage.also { nextFoliage = null }
    @Synchronized private fun takeAtlas(): Pair<Bitmap, TileAtlasInfo>? = nextAtlas.also { nextAtlas = null }

    private val vertexShader = """
        attribute vec2 position;
        varying vec2 screenPoint;
        void main() {
            screenPoint = position;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    """.trimIndent()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        fun compile(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val result = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, result, 0)
            check(result[0] != 0) { GLES20.glGetShaderInfoLog(shader) }
            return shader
        }
        val vertex = compile(GLES20.GL_VERTEX_SHADER, vertexShader)
        val fragment = runCatching {
            advancedSupported = true
            compile(GLES20.GL_FRAGMENT_SHADER, NativePanoramaShader.fragment)
        }.getOrElse {
            advancedSupported = false
            compile(GLES20.GL_FRAGMENT_SHADER, NativePanoramaShader.fallback)
        }
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vertex)
        GLES20.glAttachShader(program, fragment)
        GLES20.glLinkProgram(program)
        val result = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, result, 0)
        check(result[0] != 0) { GLES20.glGetProgramInfoLog(program) }
        GLES20.glDeleteShader(vertex)
        GLES20.glDeleteShader(fragment)
        uniformCache.clear()
        val textures = IntArray(5)
        GLES20.glGenTextures(5, textures, 0)
        texture = textures[0]
        depthTexture = textures[1]
        atlasTexture = textures[2]
        waterTexture = textures[3]
        foliageTexture = textures[4]
        for (id in textures) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        }
        hasTexture = false
        hasDepth = false
        hasAtlas = false
        hasWater = false
        hasFoliage = false
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w.coerceAtLeast(1)
        height = h.coerceAtLeast(1)
        viewportWidth = width
        viewportHeight = height
    }

    override fun onDrawFrame(gl: GL10?) {
        takeImage()?.let { image ->
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, image.bitmap, 0)
            image.bitmap.recycle()
            format = image.format
            sceneEffects = image.effects
            hasDepth = false
            hasWater = false
            hasFoliage = false
            hasAtlas = false
            hasTexture = true
        }
        fun upload(bitmap: Bitmap?, id: Int, unit: Int): Boolean {
            if (bitmap == null) return false
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + unit)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
            bitmap.recycle()
            return true
        }
        if (upload(takeDepth(), depthTexture, 1)) hasDepth = true
        if (upload(takeWater(), waterTexture, 3)) hasWater = true
        if (upload(takeFoliage(), foliageTexture, 4)) hasFoliage = true
        takeAtlas()?.let {
            if (upload(it.first, atlasTexture, 2)) { atlasInfo = it.second; hasAtlas = true }
        }
        GLES20.glViewport(0, 0, width, height)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        if (!hasTexture) return
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        fun location(name: String) = uniformCache.getOrPut(name) { GLES20.glGetUniformLocation(program, name) }
        val position = GLES20.glGetAttribLocation(program, "position")
        quad.position(0)
        GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glEnableVertexAttribArray(position)
        GLES20.glUniform1i(location("panorama"), 0)
        GLES20.glUniform1i(location("depthMap"), 1)
        GLES20.glUniform1i(location("highAtlas"), 2)
        GLES20.glUniform1i(location("waterMask"), 3)
        GLES20.glUniform1i(location("foliageMask"), 4)
        GLES20.glUniform1i(location("hasDepth"), if (hasDepth && depthEnabled && sceneEffects.depthStrength > 0f) 1 else 0)
        GLES20.glUniform1i(location("hasAtlas"), if (hasAtlas) 1 else 0)
        GLES20.glUniform1i(location("hasWaterMask"), if (hasWater) 1 else 0)
        GLES20.glUniform1i(location("hasFoliageMask"), if (hasFoliage) 1 else 0)
        GLES20.glUniform4f(location("atlasCoords"), atlasInfo.originU, atlasInfo.originV,
            atlasInfo.scaleU, atlasInfo.scaleV)
        val fx = sceneEffects
        GLES20.glUniform1f(location("clockTime"), (SystemClock.uptimeMillis() % 3_600_000L) / 1000f)
        GLES20.glUniform2f(location("parallaxOffset"), motionX * fx.depthStrength * 2.5f,
            motionY * fx.depthStrength * 2.5f)
        GLES20.glUniform4f(location("waterParams"), if (effectsEnabled) fx.waterStrength else 0f, fx.waterSpeed, 0f,
            Math.toRadians(fx.waterRadius.toDouble()).toFloat())
        GLES20.glUniform2f(location("waterCenter"), Math.toRadians(fx.waterYaw.toDouble()).toFloat(),
            Math.toRadians(fx.waterPitch.toDouble()).toFloat())
        GLES20.glUniform2f(location("foliageParams"), if (effectsEnabled) fx.foliageStrength else 0f, fx.foliageSpeed)
        GLES20.glUniform1i(location("particleKind"), if (effectsEnabled) fx.particles else 0)
        GLES20.glUniform4f(location("particleParams"), fx.particleDensity, fx.particleSpeed,
            fx.wind, 0f)
        GLES20.glUniform4f(location("atmosphereParams"), if (effectsEnabled) fx.fog else 0f,
            if (effectsEnabled) fx.storm else 0f, 0f, 0f)
        GLES20.glUniform3f(location("sunParams"), if (effectsEnabled) fx.sun else 0f,
            Math.toRadians(fx.sunYaw.toDouble()).toFloat(),
            Math.toRadians(fx.sunPitch.toDouble()).toFloat())
        GLES20.glUniform3f(location("moonParams"), if (effectsEnabled) fx.moon else 0f,
            Math.toRadians(fx.moonYaw.toDouble()).toFloat(),
            Math.toRadians(fx.moonPitch.toDouble()).toFloat())
        GLES20.glUniform2f(location("skyParams"), if (effectsEnabled) fx.clouds else 0f,
            if (effectsEnabled) fx.stars else 0f)
        for (unit in 1..4) {
            val id = when (unit) {
                1 -> depthTexture; 2 -> atlasTexture; 3 -> waterTexture; else -> foliageTexture
            }
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0 + unit)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, id)
        }
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glUniform1f(location("yaw"), Math.toRadians(yaw.toDouble()).toFloat())
        GLES20.glUniform1f(location("pitch"), Math.toRadians(pitch.toDouble()).toFloat())
        GLES20.glUniform1f(location("tangent"), tan(Math.toRadians((fieldOfView / 2f).toDouble())).toFloat())
        GLES20.glUniform1i(location("projection"), when (format.projection.lowercase()) { "180" -> 1; "flat" -> 2; else -> 0 })
        GLES20.glUniform1i(location("sourceStereo"), when (format.stereo.lowercase()) { "sbs" -> 1; "tb", "top-bottom" -> 2; else -> 0 })
        GLES20.glUniform1f(location("imageAspect"), format.imageAspect)
        GLES20.glUniform1i(location("mirrorImage"), if (format.mirror) 1 else 0)
        val eyes = if (cardboard) 2 else 1
        for (eye in 0 until eyes) {
            val left = eye * width / eyes
            val right = (eye + 1) * width / eyes
            val viewWidth = right - left
            GLES20.glViewport(left, 0, viewWidth, height)
            GLES20.glUniform1f(location("aspect"), viewWidth.toFloat() / height)
            GLES20.glUniform1i(location("eye"), eye)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6)
        }
        // Spring-like translation only while the user is turning or tilting.
        motionX *= .97f
        motionY *= .97f
    }
}
