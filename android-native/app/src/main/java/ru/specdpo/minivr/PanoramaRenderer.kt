package ru.specdpo.minivr

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
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
    @Volatile var format = PanoramaFormat()
        private set

    private data class NewImage(val bitmap: Bitmap, val format: PanoramaFormat)
    private var nextImage: NewImage? = null
    private var program = 0
    private var texture = 0
    private var hasTexture = false
    private var width = 1
    private var height = 1
    private val quad = ByteBuffer.allocateDirect(12 * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, -1f, 1f, 1f, -1f, 1f))
            position(0)
        }

    @Synchronized fun offerImage(bitmap: Bitmap, spec: PanoramaFormat) {
        nextImage?.bitmap?.recycle()
        nextImage = NewImage(bitmap, spec)
    }
    @Synchronized private fun takeImage(): NewImage? = nextImage.also { nextImage = null }

    private val vertexShader = """
        attribute vec2 position;
        varying vec2 screenPoint;
        void main() {
            screenPoint = position;
            gl_Position = vec4(position, 0.0, 1.0);
        }
    """.trimIndent()

    private val fragmentShader = """
        precision highp float;
        varying vec2 screenPoint;
        uniform sampler2D panorama;
        uniform float yaw;
        uniform float pitch;
        uniform float tangent;
        uniform float aspect;
        uniform float imageAspect;
        uniform int projection;
        uniform int sourceStereo;
        uniform int eye;
        uniform int mirrorImage;
        const float PI = 3.14159265358979323846;
        void main() {
            float cy = cos(yaw), sy = sin(yaw);
            float cp = cos(pitch), sp = sin(pitch);
            vec3 forward = vec3(cp * cy, sp, cp * sy);
            vec3 right = vec3(-sy, 0.0, cy);
            vec3 up = vec3(-sp * cy, cp, -sp * sy);
            vec3 ray = normalize(forward + right * screenPoint.x * tangent * aspect + up * screenPoint.y * tangent);
            float longitude = atan(ray.z, ray.x);
            vec2 uv;
            if (projection == 0) {
                uv = vec2(0.5 - longitude / (2.0 * PI), 0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
            } else if (projection == 1) {
                if (abs(longitude) > PI * 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
                uv = vec2(0.5 - longitude / PI, 0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
            } else {
                // A flat picture on a virtual plane at X=1, preserving aspect ratio.
                if (ray.x <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
                float halfHeight = 0.75;
                uv = vec2(0.5 + ray.z / (ray.x * 2.0 * halfHeight * imageAspect),
                          0.5 - ray.y / (ray.x * 2.0 * halfHeight));
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
                }
            }
            if (mirrorImage == 1) uv.x = 1.0 - uv.x;
            if (sourceStereo == 1) uv.x = uv.x * 0.5 + float(eye) * 0.5;
            if (sourceStereo == 2) uv.y = uv.y * 0.5 + float(eye) * 0.5;
            gl_FragColor = texture2D(panorama, uv);
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
        val fragment = compile(GLES20.GL_FRAGMENT_SHADER, fragmentShader)
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vertex)
        GLES20.glAttachShader(program, fragment)
        GLES20.glLinkProgram(program)
        val result = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, result, 0)
        check(result[0] != 0) { GLES20.glGetProgramInfoLog(program) }
        GLES20.glDeleteShader(vertex)
        GLES20.glDeleteShader(fragment)
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        texture = textures[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        hasTexture = false
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w.coerceAtLeast(1)
        height = h.coerceAtLeast(1)
    }

    override fun onDrawFrame(gl: GL10?) {
        takeImage()?.let { image ->
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, image.bitmap, 0)
            image.bitmap.recycle()
            format = image.format
            hasTexture = true
        }
        GLES20.glViewport(0, 0, width, height)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        if (!hasTexture) return
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        fun location(name: String) = GLES20.glGetUniformLocation(program, name)
        val position = GLES20.glGetAttribLocation(program, "position")
        quad.position(0)
        GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glEnableVertexAttribArray(position)
        GLES20.glUniform1i(location("panorama"), 0)
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
    }
}
