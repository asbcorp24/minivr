package ru.specdpo.minivr

import android.media.MediaPlayer

/** Native audio with the same scene/point precedence as the MiniVR web player. */
class NativeAudioGuide(private val resolve: (String?) -> String?) {
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
            }
            player.setOnCompletionListener { track.finished = true; onEnd() }
            player.setOnErrorListener { _, _, _ -> track.finished = true; onEnd(); true }
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
    }

    fun togglePause(): Boolean {
        paused = !paused
        if (paused) { scene?.pause(); point?.pause() }
        else (point ?: scene)?.resume()
        return paused
    }

    fun pause() {
        paused = true
        scene?.pause()
        point?.pause()
    }

    fun stop() {
        point?.release(); point = null
        scene?.release(); scene = null
        paused = false
    }
}
