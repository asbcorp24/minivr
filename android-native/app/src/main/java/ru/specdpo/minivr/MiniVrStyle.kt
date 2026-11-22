package ru.specdpo.minivr

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

/** Native interpretation of public/assets/app.css and viewer.css. No browser UI. */
object MiniVrStyle {
    val background = 0xFF02060B.toInt()
    val panel = 0xFF061019.toInt()
    val glass = 0xEE04121D.toInt()
    val line = 0xFF16384B.toInt()
    val cyan = 0xFF52EAFF.toInt()
    val text = 0xFFEDFCFF.toInt()
    val muted = 0xFF91A9B6.toInt()
    val active = 0xFF0A3444.toInt()

    fun dp(context: Context, size: Int): Int =
        (size * context.resources.displayMetrics.density + .5f).toInt()

    fun border(context: Context, fill: Int = panel, edge: Int = line,
               radius: Int = 9, stroke: Int = 1): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(context, radius).toFloat()
            setStroke(dp(context, stroke).coerceAtLeast(1), edge)
        }

    fun touchBackground(context: Context, selected: Boolean = false): RippleDrawable {
        val fill = if (selected) active else panel
        val edge = if (selected) cyan else line
        return RippleDrawable(ColorStateList.valueOf(0x5552EAFF),
            border(context, fill, edge, 9, if (selected) 2 else 1),
            border(context, Color.WHITE, Color.WHITE, 9))
    }

    fun pageBackground(): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xFF0C2836.toInt(), background, background)
    )

    fun text(context: Context, value: String, size: Float, color: Int = text,
             bold: Boolean = false, monospace: Boolean = false): TextView = TextView(context).apply {
        this.text = value
        textSize = size
        setTextColor(color)
        typeface = if (monospace) Typeface.create(Typeface.MONOSPACE,
            if (bold) Typeface.BOLD else Typeface.NORMAL)
            else Typeface.create(Typeface.DEFAULT,
                if (bold) Typeface.BOLD else Typeface.NORMAL)
        gravity = Gravity.CENTER_VERTICAL
        if (monospace) letterSpacing = .10f
    }

    fun eyebrow(context: Context, value: String): TextView =
        text(context, value, 10.5f, cyan, monospace = true).apply {
            letterSpacing = .16f
        }

    fun brand(context: Context): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(text(context, "MINI", 20f, Color.WHITE, bold = true).apply {
            letterSpacing = .17f
        })
        addView(text(context, "VR", 20f, cyan, bold = true).apply {
            letterSpacing = .17f
        })
    }
}
