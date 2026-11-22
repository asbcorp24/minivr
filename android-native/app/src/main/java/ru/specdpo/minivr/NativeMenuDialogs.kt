package ru.specdpo.minivr

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
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
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Large high-contrast, keyboard-accessible native selectors. No WebView. */
class NativeMenuDialogs(private val activity: Activity) {
    data class Item(
        val id: Int,
        val title: String,
        val caption: String,
        val icon: String,
        val group: String = "",
        val selected: Boolean = false
    )
    data class Control(
        val title: String,
        val detail: String,
        val icon: String,
        val section: String,
        val enabled: () -> Boolean = { true },
        val active: () -> Boolean = { false },
        val closeAfterTap: Boolean = false,
        val tap: () -> Unit
    )

    private val bg = 0xFF071722.toInt()
    private val card = 0xFF123041.toInt()
    private val selectedCard = 0xFF165067.toInt()
    private val cyan = 0xFF65ECFF.toInt()
    private val muted = 0xFFB4CDD6.toInt()
    private fun dp(n: Int) = (n * activity.resources.displayMetrics.density).toInt()

    private fun shape(fill: Int, stroke: Int, strokeDp: Int = 1): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(14).toFloat()
            setStroke(dp(strokeDp), stroke)
        }

    private fun label(text: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false) =
        TextView(activity).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(null, Typeface.BOLD)
            gravity = Gravity.CENTER_VERTICAL
        }

    private fun action(text: String, click: () -> Unit) = Button(activity).apply {
        this.text = text
        isAllCaps = false
        textSize = 15f
        setTextColor(Color.WHITE)
        background = shape(card, 0xFF3B7284.toInt())
        minHeight = dp(52)
        setPadding(dp(12), 0, dp(12), 0)
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
            setPadding(dp(16), dp(16), dp(16), dp(14))
            setBackgroundColor(bg)
            isFocusableInTouchMode = true
        }
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(label(title, 23f, Color.WHITE, true).apply {
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        },
            LinearLayout.LayoutParams(0, dp(56), 1f))
        header.addView(action("✕") { dialog.dismiss() },
            LinearLayout.LayoutParams(dp(52), dp(52)))
        root.addView(header)
        val caption = label(description, 14f, muted)
        caption.setPadding(0, dp(2), 0, dp(12))
        root.addView(caption)

        if (searchable) {
            val search = EditText(activity).apply {
                hint = "Поиск по названию…"
                setHintTextColor(0xFF8FAEBA.toInt())
                setTextColor(Color.WHITE)
                textSize = 17f
                setSingleLine(true)
                background = shape(0xFF163241.toInt(), 0xFF3E7285.toInt())
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
                setPadding(dp(14), dp(12), dp(14), dp(12))
                minimumHeight = dp(86)
                isClickable = true
                isFocusable = true
                isSelected = entry.selected
                contentDescription = "${entry.title}. ${entry.caption}" +
                    if (entry.selected) ". Сейчас выбрано" else ""
                background = shape(if (entry.selected) selectedCard else card,
                    if (entry.selected) cyan else 0xFF2B5364.toInt(), if (entry.selected) 2 else 1)
            }
            val symbol = label(entry.icon, 25f, cyan, true).apply {
                gravity = Gravity.CENTER
            }
            row.addView(symbol, LinearLayout.LayoutParams(dp(46), dp(52)))
            val textBox = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
            val name = label(entry.title, 18f, Color.WHITE, true).apply { maxLines = 3 }
            textBox.addView(name)
            val description = label(if (entry.selected) "✓ СЕЙЧАС ВЫБРАНО · ${entry.caption}"
                else entry.caption, 13f, if (entry.selected) cyan else muted)
            description.setPadding(0, dp(5), 0, 0)
            textBox.addView(description)
            row.addView(textBox, LinearLayout.LayoutParams(0, -2, 1f))
            val check = label(if (entry.selected) "✓" else "›", 25f,
                if (entry.selected) cyan else 0xFF9BB9C7.toInt(), true)
            check.gravity = Gravity.CENTER
            row.addView(check, LinearLayout.LayoutParams(dp(38), dp(52)))
            container.addView(row, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(10)
            })
            rows.add(row to entry)
            row.setOnFocusChangeListener { _, focused ->
                row.background = shape(if (focused || entry.selected) selectedCard else card,
                    if (focused || entry.selected) cyan else 0xFF2B5364.toInt(),
                    if (focused || entry.selected) 2 else 1)
            }
            row.setOnClickListener {
                if (pending) return@setOnClickListener
                pending = true
                for ((itemView, _) in rows) {
                    itemView.isSelected = itemView === row
                    itemView.background = shape(if (itemView === row) selectedCard else card,
                        if (itemView === row) cyan else 0xFF2B5364.toInt(),
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
            layout.caption.text = "${visible.size} материалов · выберите карточку"
            drawRows(layout.list, layout.dialog, visible, onSelect)
            toursButton?.background = shape(if (category == "tour") selectedCard else card,
                if (category == "tour") cyan else 0xFF2B5364.toInt(), if (category == "tour") 2 else 1)
            panoramasButton?.background = shape(if (category == "panorama") selectedCard else card,
                if (category == "panorama") cyan else 0xFF2B5364.toInt(), if (category == "panorama") 2 else 1)
        }
        layout = shell("Каталог MiniVR", "Текущий материал выделен голубой рамкой.",
            searchable = true) {
            searchTerm = it
            refresh()
        }
        toursButton = action("Экскурсии ($tours)") { category = "tour"; refresh() }
        panoramasButton = action("Панорамы ($panoramas)") { category = "panorama"; refresh() }
        tabs.addView(toursButton, LinearLayout.LayoutParams(0, dp(55), 1f).apply { rightMargin = dp(6) })
        tabs.addView(panoramasButton, LinearLayout.LayoutParams(0, dp(55), 1f).apply { leftMargin = dp(6) })
        layout.root.addView(tabs, 2)
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
        val layout = shell("Управление", "Все функции доступны крупными кнопками. Голубой цвет — включено.",
            searchable = false) { }
        var lastAction: String? = null
        fun redraw() {
            val previousScroll = layout.scroll.scrollY
            layout.list.removeAllViews()
            var lastSection = ""
            for (control in controls) {
                if (control.section != lastSection) {
                    lastSection = control.section
                    layout.list.addView(label(lastSection, 16f, cyan, true),
                        LinearLayout.LayoutParams(-1, dp(38)).apply { topMargin = dp(8) })
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
                        if ((active || justUsed) && canUse) cyan else 0xFF305A6C.toInt(),
                        if ((active || justUsed) && canUse) 2 else 1)
                    isClickable = canUse
                    isFocusable = canUse
                    alpha = if (canUse) 1f else .42f
                    contentDescription = control.title + ". " + control.detail +
                        if (active) ". Включено" else ""
                }
                row.addView(label(control.icon, 26f, cyan, true).apply {
                    gravity = Gravity.CENTER
                }, LinearLayout.LayoutParams(dp(48), dp(48)))
                val texts = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
                texts.addView(label(control.title, 17f, Color.WHITE, true))
                texts.addView(label(if (!canUse) "Недоступно для этой сцены" else
                    if (justUsed) "✓ ВЫБРАНО · ${control.detail}" else
                    if (active) "✓ ВКЛЮЧЕНО · ${control.detail}" else control.detail,
                    13f, if ((active || justUsed) && canUse) cyan else muted).apply {
                    setPadding(0, dp(4), 0, 0)
                })
                row.addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
                row.addView(label(if (active || justUsed) "✓" else "›", 24f,
                    if (active || justUsed) cyan else muted, true), LinearLayout.LayoutParams(dp(28), -2))
                row.setOnFocusChangeListener { _, focused ->
                    row.background = shape(if (focused || active || justUsed) selectedCard else card,
                        if (focused || active || justUsed) cyan else 0xFF305A6C.toInt(),
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
}
