package ru.specdpo.minivr

import android.media.MediaPlayer

/** Native audio with the same scene/point precedence as the MiniVR web player. */
class NativeAudioGuide(
    private val resolve: (String?) -> String?,
    private val onNarrationChanged: (Boolean) -> Unit = {}
) {
    private class Track(val player: MediaPlayer) {
        var prepared = false
        var finished = false
        fun resume() {
            if (prepared && !finished) runCatching { player.start() }
        }
        fun pause() {
            if (prepared && !finished) runCatching { if (player.isPlaying) player.pause() }
        }
        fun release() { runCatching { player.release() } }
    }

    private var scene: Track? = null
    private var point: Track? = null
    private var paused = false

    private fun updateNarration() {
        val active = (point ?: scene)?.let { it.prepared && !it.finished && !paused } == true
        onNarrationChanged(active)
    }

    private fun create(path: String?, role: String, onEnd: () -> Unit): Track? {
        val source = resolve(path) ?: return null
        if (!source.startsWith("https://")) return null
        val player = MediaPlayer()
        val track = Track(player)
        try {
            player.setDataSource(source)
            player.setOnPreparedListener {
                track.prepared = true
                val selected = if (role == "scene") scene === track && point == null else point === track
                if (!paused && selected) track.resume()
                updateNarration()
            }
            player.setOnCompletionListener { track.finished = true; onEnd(); updateNarration() }
            player.setOnErrorListener { _, _, _ -> track.finished = true; onEnd(); updateNarration(); true }
            player.prepareAsync()
            return track
        } catch (error: Exception) {
            track.release()
            return null
        }
    }

    fun enterScene(path: String?) {
        stop()
        scene = create(path, "scene") {
            scene?.release()
            scene = null
        }
        updateNarration()
    }

    fun playPoint(path: String?, onEnd: () -> Unit = {}) {
        point?.release()
        point = null
        scene?.pause()
        point = create(path, "point") {
            point?.release()
            point = null
            if (!paused) scene?.resume()
            onEnd()
        }
        if (point == null && !paused) scene?.resume()
        updateNarration()
    }

    fun togglePause(): Boolean {
        paused = !paused
        if (paused) { scene?.pause(); point?.pause() }
        else (point ?: scene)?.resume()
        updateNarration()
        return paused
    }

    fun pause() {
        paused = true
        scene?.pause()
        point?.pause()
        updateNarration()
    }

    fun stop() {
        point?.release(); point = null
        scene?.release(); scene = null
        paused = false
        updateNarration()
    }
}
