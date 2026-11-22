package ru.specdpo.minivr

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Large high-contrast, keyboard-accessible native selectors. No WebView. */
class NativeMenuDialogs(private val activity: Activity, private val thumbnails: NativeThumbnailLoader) {
    data class Item(
        val id: Int,
        val title: String,
        val caption: String,
        val icon: String,
        val group: String = "",
        val selected: Boolean = false,
        val thumbnail: String? = null
    )
    data class Control(
        val title: String,
        val detail: String,
        val icon: String,
        val section: String,
        val enabled: () -> Boolean = { true },
        val active: () -> Boolean = { false },
        val closeAfterTap: Boolean = false,
        val tap: () -> Unit,
        val toggle: Boolean = false
    )

    private val bg = MiniVrStyle.background
    private val card = MiniVrStyle.panel
    private val selectedCard = MiniVrStyle.active
    private val cyan = MiniVrStyle.cyan
    private val muted = MiniVrStyle.muted
    private fun dp(n: Int) = (n * activity.resources.displayMetrics.density).toInt()

    private fun shape(fill: Int, stroke: Int, strokeDp: Int = 1): GradientDrawable =
        MiniVrStyle.border(activity, fill, stroke, 9, strokeDp)

    private fun label(text: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false) =
        MiniVrStyle.text(activity, text, size, color, bold)

    private fun action(text: String, click: () -> Unit) = Button(activity).apply {
        this.text = text
        isAllCaps = false
        textSize = 13f
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        setTextColor(MiniVrStyle.text)
        background = MiniVrStyle.touchBackground(activity)
        minHeight = dp(52)
        setPadding(dp(9), 0, dp(9), 0)
        setOnClickListener { click() }
    }

    private data class Layout(
        val dialog: Dialog,
        val root: LinearLayout,
        val list: LinearLayout,
        val caption: TextView,
        val scroll: ScrollView
    )

    private fun shell(title: String, description: String, searchable: Boolean,
                      onSearch: (String) -> Unit): Layout {
        val dialog = Dialog(activity, android.R.style.Theme_Material_NoActionBar_Fullscreen)
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(14))
            background = MiniVrStyle.pageBackground()
            isFocusableInTouchMode = true
        }
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(MiniVrStyle.brand(activity), LinearLayout.LayoutParams(0, dp(58), 1f))
        header.addView(MiniVrStyle.eyebrow(activity, "ANDROID / NATIVE").apply {
            background = shape(0xFF06151E.toInt(), 0xFF285464.toInt())
            setPadding(dp(8), 0, dp(8), 0)
            gravity = Gravity.CENTER
            textSize = 9f
        }, LinearLayout.LayoutParams(-2, dp(31)).apply { rightMargin = dp(10) })
        header.addView(action("✕") { dialog.dismiss() }, LinearLayout.LayoutParams(dp(46), dp(46)))
        root.addView(header)
        val heading = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        heading.addView(MiniVrStyle.eyebrow(activity, "IMMERSIVE DIGITAL SPACE / MINIVR"),
            LinearLayout.LayoutParams(-1, dp(28)))
        heading.addView(label(title, 27f, MiniVrStyle.text, true).apply {
            maxLines = 2
            setPadding(0, dp(2), 0, dp(2))
        })
        root.addView(heading, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(10)
        })
        val caption = label(description, 13f, muted)
        caption.setPadding(0, dp(6), 0, dp(16))
        root.addView(caption)

        if (searchable) {
            val search = EditText(activity).apply {
                hint = "⌕  Поиск по названию…"
                setHintTextColor(0xFF7895A4.toInt())
                setTextColor(MiniVrStyle.text)
                textSize = 16f
                setSingleLine(true)
                background = shape(0xFF071A25.toInt(), 0xFF285464.toInt())
                setPadding(dp(16), 0, dp(16), 0)
                inputType = android.text.InputType.TYPE_CLASS_TEXT
                contentDescription = "Поиск по списку"
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                        onSearch(s?.toString().orEmpty())
                    }
                    override fun afterTextChanged(s: Editable?) {}
                })
            }
            root.addView(search, LinearLayout.LayoutParams(-1, dp(54)).apply {
                bottomMargin = dp(12)
            })
        }

        val scroll = ScrollView(activity).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = true
        }
        val list = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(4), 0, dp(4))
        }
        scroll.addView(list)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.requestFocus()
        dialog.setContentView(root)
        dialog.show()
        dialog.window?.apply {
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN or
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            statusBarColor = bg
            navigationBarColor = bg
        }
        return Layout(dialog, root, list, caption, scroll)
    }

    private fun drawRows(container: LinearLayout, dialog: Dialog, entries: List<Item>,
                         onSelect: (Item) -> Unit) {
        container.removeAllViews()
        if (entries.isEmpty()) {
            val empty = label("Ничего не найдено. Попробуйте другой запрос.", 17f, muted)
            empty.gravity = Gravity.CENTER
            container.addView(empty, LinearLayout.LayoutParams(-1, dp(110)))
            return
        }
        var pending = false
        val rows = mutableListOf<Pair<LinearLayout, Item>>()
        for (entry in entries) {
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(9), dp(10), dp(10), dp(10))
                minimumHeight = dp(105)
                isClickable = true
                isFocusable = true
                isSelected = entry.selected
                contentDescription = "${entry.title}. ${entry.caption}" +
                    if (entry.selected) ". Сейчас выбрано" else ""
                background = shape(if (entry.selected) selectedCard else card,
                    if (entry.selected) cyan else MiniVrStyle.line, if (entry.selected) 2 else 1)
            }
            val thumbnail = FrameLayout(activity).apply {
                background = shape(0xFF091521.toInt(), 0xFF285464.toInt())
                clipToOutline = true
            }
            thumbnail.addView(label(when (entry.group) {
                "tour" -> "VR"
                "point" -> "♫"
                "scene" -> "◉"
                else -> "360°"
            }, 19f, cyan, true).apply {
                gravity = Gravity.CENTER
            }, FrameLayout.LayoutParams(-1, -1))
            if (!entry.thumbnail.isNullOrBlank()) {
                val cover = ImageView(activity).apply {
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    contentDescription = "Обложка: ${entry.title}"
                }
                thumbnail.addView(cover, FrameLayout.LayoutParams(-1, -1))
                thumbnails.load(entry.thumbnail, cover)
            }
            thumbnail.addView(MiniVrStyle.eyebrow(activity, entry.icon).apply {
                textSize = 9f
                gravity = Gravity.CENTER
                background = shape(0xE6031019.toInt(), 0xFF26566A.toInt())
                setPadding(dp(5), 0, dp(5), 0)
            }, FrameLayout.LayoutParams(-2, dp(24), Gravity.RIGHT or Gravity.TOP).apply {
                topMargin = dp(5)
                rightMargin = dp(5)
            })
            row.addView(thumbnail, LinearLayout.LayoutParams(dp(106), dp(82)).apply {
                rightMargin = dp(12)
            })
            val textBox = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val name = label(entry.title, 16f, MiniVrStyle.text, true).apply { maxLines = 2 }
            textBox.addView(name)
            val description = label(entry.caption, 12f, muted).apply {
                maxLines = 2
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            description.setPadding(0, dp(5), 0, 0)
            textBox.addView(description)
            textBox.addView(MiniVrStyle.eyebrow(activity,
                if (entry.selected) "✓ СЕЙЧАС ОТКРЫТО" else "ОТКРЫТЬ ПРОСТРАНСТВО  ↗").apply {
                textSize = 9f
                setPadding(0, dp(6), 0, 0)
                maxLines = 1
            })
            row.addView(textBox, LinearLayout.LayoutParams(0, -2, 1f))
            val check = label(if (entry.selected) "✓" else "›", 22f,
                if (entry.selected) cyan else 0xFF7895A4.toInt(), true)
            check.gravity = Gravity.CENTER
            row.addView(check, LinearLayout.LayoutParams(dp(23), dp(52)))
            container.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(12)
            })
            rows.add(row to entry)
            row.setOnFocusChangeListener { _, focused ->
                row.background = shape(if (focused || entry.selected) selectedCard else card,
                    if (focused || entry.selected) cyan else MiniVrStyle.line,
                    if (focused || entry.selected) 2 else 1)
            }
            row.setOnClickListener {
                if (pending) return@setOnClickListener
                pending = true
                for ((itemView, _) in rows) {
                    itemView.isSelected = itemView === row
                    itemView.background = shape(if (itemView === row) selectedCard else card,
                        if (itemView === row) cyan else MiniVrStyle.line,
                        if (itemView === row) 2 else 1)
                }
                // Allow a short visible selection acknowledgement before loading.
                Handler(Looper.getMainLooper()).postDelayed({
                    if (!dialog.isShowing) return@postDelayed
                    dialog.dismiss()
                    onSelect(entry)
                }, 160L)
            }
        }
    }

    fun showCatalog(items: List<Item>, onSelect: (Item) -> Unit) {
        val tours = items.count { it.group == "tour" }
        val panoramas = items.count { it.group == "panorama" }
        var category = items.firstOrNull { it.selected }?.group ?: if (tours > 0) "tour" else "panorama"
        var searchTerm = ""
        lateinit var layout: Layout
        val tabs = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, 0, dp(12))
        }
        var toursButton: Button? = null
        var panoramasButton: Button? = null
        fun refresh() {
            val visible = items.filter { it.group == category &&
                it.title.contains(searchTerm, ignoreCase = true) }
            layout.caption.text = "${visible.size} материалов · открывайте панорамы и экскурсии"
            drawRows(layout.list, layout.dialog, visible, onSelect)
            toursButton?.background = shape(if (category == "tour") selectedCard else card,
                if (category == "tour") cyan else MiniVrStyle.line, if (category == "tour") 2 else 1)
            panoramasButton?.background = shape(if (category == "panorama") selectedCard else card,
                if (category == "panorama") cyan else MiniVrStyle.line, if (category == "panorama") 2 else 1)
            toursButton?.setTextColor(if (category == "tour") cyan else MiniVrStyle.muted)
            panoramasButton?.setTextColor(if (category == "panorama") cyan else MiniVrStyle.muted)
        }
        layout = shell("Выберите пространство", "Экскурсии и панорамы с сайта MiniVR.",
            searchable = true) {
            searchTerm = it
            refresh()
        }
        toursButton = action("ЭКСКУРСИИ · $tours") { category = "tour"; refresh() }
        panoramasButton = action("ПАНОРАМЫ · $panoramas") { category = "panorama"; refresh() }
        tabs.addView(toursButton, LinearLayout.LayoutParams(0, dp(55), 1f).apply { rightMargin = dp(6) })
        tabs.addView(panoramasButton, LinearLayout.LayoutParams(0, dp(55), 1f).apply { leftMargin = dp(6) })
        layout.root.addView(tabs, 3)
        refresh()
    }

    fun showList(title: String, description: String, items: List<Item>,
                 footerText: String? = null, onFooter: (() -> String)? = null,
                 onSelect: (Item) -> Unit) {
        var searchTerm = ""
        lateinit var layout: Layout
        fun refresh() {
            drawRows(layout.list, layout.dialog, items.filter {
                it.title.contains(searchTerm, ignoreCase = true)
            }, onSelect)
        }
        layout = shell(title, description, searchable = items.size >= 8) {
            searchTerm = it
            refresh()
        }
        if (footerText != null && onFooter != null) {
            lateinit var footer: Button
            footer = action(footerText) {
                footer.text = onFooter()
            }
            layout.root.addView(footer, LinearLayout.LayoutParams(-1, dp(60)).apply {
                topMargin = dp(10)
            })
        }
        refresh()
    }

    fun showControls(controls: List<Control>) {
        val layout = shell("Управление просмотром", "Функции и эффекты MiniVR. Голубой цвет — активное состояние.",
            searchable = false) { }
        var lastAction: String? = null
        fun redraw() {
            val previousScroll = layout.scroll.scrollY
            layout.list.removeAllViews()
            var lastSection = ""
            for (control in controls) {
                if (control.section != lastSection) {
                    lastSection = control.section
                    val number = when (lastSection) {
                        "Просмотр" -> "01 / VIEW"
                        "Звук" -> "02 / SOUND"
                        else -> "03 / TOUR"
                    }
                    layout.list.addView(MiniVrStyle.eyebrow(activity, "$number    •    ${lastSection.uppercase()}"),
                        LinearLayout.LayoutParams(-1, dp(42)).apply { topMargin = dp(9) })
                }
                val canUse = control.enabled()
                val active = control.active()
                val justUsed = lastAction == control.title
                val row = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    minimumHeight = dp(78)
                    setPadding(dp(12), dp(12), dp(12), dp(12))
                    background = shape(if ((active || justUsed) && canUse) selectedCard else card,
                        if ((active || justUsed) && canUse) cyan else MiniVrStyle.line,
                        if ((active || justUsed) && canUse) 2 else 1)
                    isClickable = canUse
                    isFocusable = canUse
                    alpha = if (canUse) 1f else .42f
                    contentDescription = control.title + ". " + control.detail +
                        if (active) ". Включено" else ""
                }
                row.addView(label(control.icon, 20f, cyan, true).apply {
                    gravity = Gravity.CENTER
                    background = shape(0xFF092330.toInt(), 0xFF255A69.toInt())
                }, LinearLayout.LayoutParams(dp(45), dp(45)).apply { rightMargin = dp(12) })
                val texts = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
                texts.addView(label(control.title, 17f, MiniVrStyle.text, true))
                texts.addView(label(if (!canUse) "Недоступно для этой сцены" else
                    if (control.toggle) (if (active) "● ВКЛЮЧЕНО" else "○ ВЫКЛЮЧЕНО") + " · ${control.detail}" else
                    if (justUsed) "✓ ВЫБРАНО · ${control.detail}" else control.detail,
                    13f, if ((active || justUsed) && canUse) cyan else muted).apply {
                    setPadding(0, dp(4), 0, 0)
                })
                row.addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
                row.addView(label(if (active || justUsed) "✓" else "›", 24f,
                    if (active || justUsed) cyan else muted, true), LinearLayout.LayoutParams(dp(28), -2))
                row.setOnFocusChangeListener { _, focused ->
                    row.background = shape(if (focused || active || justUsed) selectedCard else card,
                        if (focused || active || justUsed) cyan else MiniVrStyle.line,
                        if (focused || active || justUsed) 2 else 1)
                }
                row.setOnClickListener {
                    if (!canUse) return@setOnClickListener
                    if (control.closeAfterTap) layout.dialog.dismiss()
                    control.tap()
                    if (!control.closeAfterTap) {
                        lastAction = control.title
                        redraw()
                    }
                }
                layout.list.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                    bottomMargin = dp(9)
                })
            }
            layout.scroll.post { layout.scroll.scrollTo(0, previousScroll) }
        }
        redraw()
    }

    /** Centered native equivalent of the site's #hotspot-modal. */
    private fun modal(title: String, eyebrow: String, body: View,
                      nextLabel: String? = null, onNext: (() -> Unit)? = null): Dialog {
        val dialog = Dialog(activity)
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = shape(0xFF03131B.toInt(), cyan)
            elevation = dp(15).toFloat()
        }
        val top = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(MiniVrStyle.eyebrow(activity, eyebrow),
            LinearLayout.LayoutParams(0, dp(35), 1f))
        top.addView(action("✕") { dialog.dismiss() },
            LinearLayout.LayoutParams(dp(44), dp(44)))
        panel.addView(top)
        panel.addView(label(title, 24f, MiniVrStyle.text, true).apply { maxLines = 3 },
            LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(10)
                bottomMargin = dp(17)
            })
        panel.addView(body, body.layoutParams as? LinearLayout.LayoutParams
            ?: LinearLayout.LayoutParams(-1, -2))
        val buttons = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(action("ЗАКРЫТЬ") { dialog.dismiss() },
            LinearLayout.LayoutParams(0, dp(53), 1f))
        if (nextLabel != null && onNext != null) {
            buttons.addView(action(nextLabel) {
                dialog.dismiss()
                onNext()
            }.apply {
                background = shape(selectedCard, cyan)
                setTextColor(cyan)
            }, LinearLayout.LayoutParams(0, dp(53), 1.3f).apply {
                leftMargin = dp(10)
            })
        }
        panel.addView(buttons, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(20)
        })
        dialog.setContentView(panel)
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout((activity.resources.displayMetrics.widthPixels - dp(32)).coerceAtMost(dp(620)),
                WindowManager.LayoutParams.WRAP_CONTENT)
            setDimAmount(.75f)
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            statusBarColor = bg
            navigationBarColor = bg
        }
        return dialog
    }

    fun showInfo(title: String, body: String, eyebrow: String = "MINIVR / ИНФОРМАЦИЯ",
                 nextLabel: String? = null, onNext: (() -> Unit)? = null) {
        val message = label(body, 15f, 0xFF9BB4BE.toInt()).apply {
            setLineSpacing(dp(5).toFloat(), 1f)
            gravity = Gravity.TOP
            setTextIsSelectable(true)
        }
        val scroll = ScrollView(activity).apply {
            isVerticalScrollBarEnabled = true
            addView(message)
        }
        val maxHeight = (activity.resources.displayMetrics.heightPixels * .45f).toInt()
        // Short notes stay compact; longer texts scroll inside the modal.
        val approximateHeight = dp(55) + (body.length / 38 + body.count { it == '\n' }) * dp(23)
        scroll.layoutParams = LinearLayout.LayoutParams(-1, approximateHeight.coerceIn(dp(80), maxHeight))
        modal(title, eyebrow, scroll, nextLabel, onNext)
    }

    fun showImage(title: String, onReady: (ImageView, Dialog) -> Unit) {
        val photo = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
            background = shape(0xFF02060B.toInt(), MiniVrStyle.line)
            contentDescription = title
            minimumHeight = dp(170)
        }
        val area = FrameLayout(activity).apply {
            addView(photo, FrameLayout.LayoutParams(-1, -1))
        }
        area.layoutParams = LinearLayout.LayoutParams(-1,
            (activity.resources.displayMetrics.heightPixels * .53f).toInt())
        val dialog = modal(title, "MINIVR / ФОТОГРАФИЯ", area)
        onReady(photo, dialog)
    }
}
