package ru.specdpo.minivr

import android.media.AudioAttributes
import android.media.MediaPlayer

/** Native soundtrack playlist; independent from the scene/point voice-over. */
class NativeMusicPlayer(private val resolve: (String?) -> String?) {
    private var tracks = emptyList<MusicTrack>()
    private var index = -1
    private var player: MediaPlayer? = null
    private var ready = false
    private var wantsPlay = false
    private var ducked = false
    private var resumeWhenForeground = false

    fun setTracks(items: List<MusicTrack>) {
        tracks = items
        if (index >= tracks.size) { stop(); index = -1 }
    }

    fun currentTitle(): String = if (index in tracks.indices) tracks[index].title else "Музыка"
    fun hasTracks(): Boolean = tracks.isNotEmpty()
    fun isPlayingRequested(): Boolean = wantsPlay

    fun selectTrack(id: Int) {
        // id=0 means this scene has no override: keep the current soundtrack.
        if (id <= 0) return
        val next = tracks.indexOfFirst { it.id == id }
        if (next < 0) return
        // Do not restart the same track on every scene transition.
        if (next == index && player != null) return
        load(next, true)
    }

    fun currentTrackId(): Int? = tracks.getOrNull(index)?.id

    fun skip(delta: Int): String? {
        if (tracks.isEmpty()) return null
        load((index.coerceAtLeast(0) + delta + tracks.size) % tracks.size, true)
        return currentTitle()
    }

    fun toggle(): Boolean {
        if (tracks.isEmpty()) return false
        resumeWhenForeground = false
        if (index !in tracks.indices) load(0, true)
        else {
            wantsPlay = !wantsPlay
            if (ready) runCatching {
                if (wantsPlay) player?.start() else player?.pause()
            }
        }
        return wantsPlay
    }

    fun duck(active: Boolean) {
        ducked = active
        runCatching { player?.setVolume(if (active) .18f else 1f, if (active) .18f else 1f) }
    }

    private fun load(position: Int, play: Boolean) {
        stop()
        index = position
        val source = resolve(tracks[position].path) ?: return
        if (!source.startsWith("https://")) return
        val next = MediaPlayer()
        player = next
        wantsPlay = play
        try {
            next.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            next.setDataSource(source)
            next.setOnPreparedListener { prepared ->
                if (prepared !== player) return@setOnPreparedListener
                ready = true
                duck(ducked)
                if (wantsPlay) runCatching { prepared.start() }
            }
            next.setOnCompletionListener { if (next === player) skip(1) }
            next.setOnErrorListener { _, _, _ ->
                if (next === player) stop()
                true
            }
            next.prepareAsync()
        } catch (_: Exception) { stop() }
    }

    /** Pause output while the activity is backgrounded, remembering user intent. */
    fun pause() {
        resumeWhenForeground = wantsPlay
        if (ready) runCatching { player?.pause() }
    }

    fun resume() {
        if (!resumeWhenForeground) return
        resumeWhenForeground = false
        if (wantsPlay && ready) runCatching { player?.start() }
    }

    fun stop() {
        val old = player
        player = null
        ready = false
        wantsPlay = false
        resumeWhenForeground = false
        runCatching { old?.release() }
    }
}
