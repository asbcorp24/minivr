package ru.specdpo.minivr

import android.app.Activity
import android.graphics.Bitmap
import android.util.LruCache
import android.widget.ImageView
import java.util.concurrent.Executors

/** Small, async, disk-cached artwork for native material and scene cards. */
class NativeThumbnailLoader(private val activity: Activity, private val api: MiniVrApi) {
    private val pool = Executors.newFixedThreadPool(2)
    private val memory = object : LruCache<String, Bitmap>(12 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int =
            (value.byteCount / 1024).coerceAtLeast(1)
    }

    fun load(path: String?, target: ImageView) {
        target.tag = path
        target.setImageDrawable(null)
        if (path.isNullOrBlank()) return
        synchronized(memory) { memory.get(path) }?.let {
            target.setImageBitmap(it)
            return
        }
        pool.execute {
            val bitmap = runCatching { api.bitmap(path, 512) }.getOrNull() ?: return@execute
            synchronized(memory) { memory.put(path, bitmap) }
            activity.runOnUiThread {
                if (target.tag == path && target.isAttachedToWindow) target.setImageBitmap(bitmap)
            }
        }
    }

    fun shutdown() { pool.shutdownNow() }
}
