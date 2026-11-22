package ru.specdpo.minivr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class NativeViewOrientationTest {
    // Rotation matrices transform device axes (right, top, front) into world X/Y/Up.
    private val north = floatArrayOf(
        1f, 0f, 0f,
        0f, 0f, -1f,
        0f, 1f, 0f
    )
    private val east = floatArrayOf(
        0f, 0f, -1f,
        -1f, 0f, 0f,
        0f, 1f, 0f
    )

    private fun lookingNorthAt(elevationDegrees: Double): FloatArray {
        val elevation = Math.toRadians(elevationDegrees)
        val s = sin(elevation).toFloat()
        val c = cos(elevation).toFloat()
        return floatArrayOf(1f, 0f, 0f, 0f, -s, -c, 0f, c, -s)
    }

    @Test fun fingerDragFollowsThePanorama() {
        assertTrue(NativeViewOrientation.dragPitchDelta(100f) > 0f)
        assertTrue(NativeViewOrientation.dragPitchDelta(-100f) < 0f)
        assertEquals(0f, NativeViewOrientation.dragPitchDelta(0f), 0f)
    }

    @Test fun tiltingPhoneUpMovesCameraUpWithoutEulerFlip() {
        val start = NativeViewOrientation.fromRotationMatrix(north)!!
        val upward = NativeViewOrientation.fromRotationMatrix(lookingNorthAt(30.0))!!
        val downward = NativeViewOrientation.fromRotationMatrix(lookingNorthAt(-30.0))!!
        assertEquals(30f, NativeViewOrientation.relativeView(start, upward).pitch, .01f)
        assertEquals(-30f, NativeViewOrientation.relativeView(start, downward).pitch, .01f)
        assertEquals(0f, NativeViewOrientation.relativeView(start, upward).yaw, .01f)
    }

    @Test fun portraitAndLandscapeRollUseTheSameViewingDirection() {
        // 90-degree device roll changes screen X/Y, but not the rear-facing -Z ray.
        val landscape = floatArrayOf(
            0f, -1f, 0f,
            0f, 0f, -1f,
            1f, 0f, 0f
        )
        val before = NativeViewOrientation.fromRotationMatrix(north)!!
        val after = NativeViewOrientation.fromRotationMatrix(landscape)!!
        assertEquals(0f, NativeViewOrientation.relativeView(before, after).yaw, .01f)
        assertEquals(0f, NativeViewOrientation.relativeView(before, after).pitch, .01f)
    }

    @Test fun rightTurnIncreasesCameraYaw() {
        val before = NativeViewOrientation.fromRotationMatrix(north)!!
        val after = NativeViewOrientation.fromRotationMatrix(east)!!
        assertEquals(90f, NativeViewOrientation.relativeView(before, after).yaw, .01f)
        assertEquals(0f, NativeViewOrientation.relativeView(before, after).pitch, .01f)
    }

    @Test fun crossingTheZeroDegreeSeamIsSmooth() {
        val before = NativeViewOrientation.GyroAngles(179f, 0f)
        val after = NativeViewOrientation.GyroAngles(-179f, 0f)
        assertEquals(-2f, NativeViewOrientation.relativeView(before, after).yaw, .001f)
    }

    @Test fun aPerfectlyVerticalPhoneDirectionDoesNotProduceUnstableHeading() {
        val up = floatArrayOf(1f, 0f, 0f, 0f, -1f, 0f, 0f, 0f, -1f)
        assertNull(NativeViewOrientation.fromRotationMatrix(up))
    }
}
