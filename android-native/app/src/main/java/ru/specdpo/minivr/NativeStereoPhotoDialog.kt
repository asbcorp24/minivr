package ru.specdpo.minivr

import android.app.Activity
import android.app.Dialog
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.graphics.Typeface
import android.opengl.GLSurfaceView
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import kotlin.concurrent.thread

/** Fullscreen native GPU viewer of a stereo photo in a tour hotspot. */
class NativeStereoPhotoDialog(private val activity: Activity, private val api: MiniVrApi) {
    fun show(path: String, stereo: String, label: String) {
        fun dp(n: Int) = MiniVrStyle.dp(activity, n)
        val previousOrientation = activity.requestedOrientation
        val renderer = PanoramaRenderer()
        val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val root = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        val pinch = ScaleGestureDetector(activity,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    renderer.fieldOfView = (renderer.fieldOfView / detector.scaleFactor).coerceIn(30f, 100f)
                    return true
                }
            })
        var touchX = 0f
        var touchY = 0f
        val gl = GLSurfaceView(activity).apply {
            setEGLContextClientVersion(2)
            setPreserveEGLContextOnPause(true)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            setOnTouchListener { _, event ->
                pinch.onTouchEvent(event)
                when (event.actionMasked) {
                    MotionEvent.ACTION_MOVE -> if (event.pointerCount == 1 && !pinch.isInProgress) {
                        renderer.yaw -= (event.x - touchX) * .14f
                        renderer.pitch = (renderer.pitch + (touchY - event.y) * .14f).coerceIn(-75f, 75f)
                    }
                }
                touchX = event.x
                touchY = event.y
                true
            }
        }
        root.addView(gl, FrameLayout.LayoutParams(-1, -1))

        fun control(text: String, onClick: () -> Unit) = Button(activity).apply {
            this.text = text
            isAllCaps = false
            textSize = 12f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            setTextColor(MiniVrStyle.text)
            background = MiniVrStyle.touchBackground(activity)
            setPadding(dp(6), 0, dp(6), 0)
            setOnClickListener { onClick() }
        }
        val toolbar = LinearLayout(activity).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = MiniVrStyle.border(activity, MiniVrStyle.glass, MiniVrStyle.cyan, 12)
        }
        val vrToggle = control("VR / SBS") {}
        vrToggle.setOnClickListener {
            renderer.cardboard = !renderer.cardboard
            activity.requestedOrientation = if (renderer.cardboard) ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                else previousOrientation
            vrToggle.text = if (renderer.cardboard) "ВЫЙТИ VR" else "VR / SBS"
        }
        fun add(button: Button, weight: Float) {
            toolbar.addView(button, LinearLayout.LayoutParams(0, dp(53), weight).apply {
                leftMargin = dp(3)
                rightMargin = dp(3)
            })
        }
        add(control("✕ ЗАКРЫТЬ") { dialog.dismiss() }, 1.5f)
        add(vrToggle, 1.4f)
        add(control("−") { renderer.fieldOfView = (renderer.fieldOfView + 8).coerceAtMost(100f) }, .7f)
        add(control("+") { renderer.fieldOfView = (renderer.fieldOfView - 8).coerceAtLeast(30f) }, .7f)
        root.addView(toolbar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply {
            leftMargin = dp(10)
            rightMargin = dp(10)
            bottomMargin = dp(10)
        })
        dialog.setContentView(root)
        dialog.setOnShowListener { gl.onResume() }
        dialog.setOnDismissListener {
            gl.onPause()
            renderer.discardPendingImage()
            activity.requestedOrientation = previousOrientation
        }
        dialog.show()
        dialog.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)

        thread(name = "MiniVR-stereo-photo") {
            try {
                val bitmap = api.bitmap(path)
                if (!dialog.isShowing) { bitmap.recycle(); return@thread }
                val eyeAspect = when (stereo.lowercase()) {
                    "sbs" -> bitmap.width.toFloat() / (2f * bitmap.height)
                    "tb" -> (2f * bitmap.width) / bitmap.height
                    else -> bitmap.width.toFloat() / bitmap.height
                }
                renderer.offerImage(bitmap, PanoramaFormat("flat", stereo, false, eyeAspect))
            } catch (error: Exception) {
                activity.runOnUiThread {
                    if (dialog.isShowing) Toast.makeText(activity,
                        "Не удалось открыть $label: ${error.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
