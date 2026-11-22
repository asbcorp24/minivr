package ru.specdpo.minivr

import kotlin.math.atan2
import kotlin.math.hypot

/** Converts Android device motion to MiniVR camera angles, independently of display rotation. */
internal object NativeViewOrientation {
    data class GyroAngles(val heading: Float, val elevation: Float)
    data class ViewDelta(val yaw: Float, val pitch: Float)

    /** Positive screen Y is a downward drag: move the panorama down with the finger. */
    fun dragPitchDelta(deltaY: Float): Float = deltaY * .18f

    /**
     * Android's 3x3 rotation vector matrix transforms device coordinates into
     * a gravity-aligned world frame (game rotation has an arbitrary heading).
     * The view through the back of the phone
     * points along device -Z; this axis is invariant under portrait/landscape roll.
     * Unlike getOrientation()[1], elevation stays continuous when held upright.
     */
    fun fromRotationMatrix(matrix: FloatArray): GyroAngles? {
        require(matrix.size >= 9)
        val east = -matrix[2].toDouble()
        val north = -matrix[5].toDouble()
        val up = -matrix[8].toDouble()
        val horizontal = hypot(east, north)
        if (!horizontal.isFinite() || horizontal < 0.00001 || !up.isFinite()) return null
        return GyroAngles(
            Math.toDegrees(atan2(north, east)).toFloat(),
            Math.toDegrees(atan2(up, horizontal)).toFloat()
        )
    }

    /** A rightward device pan increases renderer yaw; tilting up increases pitch. */
    fun relativeView(start: GyroAngles, current: GyroAngles): ViewDelta = ViewDelta(
        -wrap(current.heading - start.heading),
        current.elevation - start.elevation
    )

    private fun wrap(degrees: Float): Float = ((degrees + 540f) % 360f) - 180f
}
