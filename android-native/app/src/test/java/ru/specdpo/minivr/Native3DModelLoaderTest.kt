package ru.specdpo.minivr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class Native3DModelLoaderTest {
    @Test fun binaryStlLoadsTriangleAndCentersGeometry() {
        val bytes=ByteBuffer.allocate(134).order(ByteOrder.LITTLE_ENDIAN)
        bytes.position(80);bytes.putInt(1)
        bytes.putFloat(0f).putFloat(0f).putFloat(1f)
        bytes.putFloat(0f).putFloat(0f).putFloat(0f)
        bytes.putFloat(1f).putFloat(0f).putFloat(0f)
        bytes.putFloat(0f).putFloat(1f).putFloat(0f)
        bytes.putShort(0)
        val mesh=Native3DModelLoader.loadStl(bytes.array())
        assertEquals(3,mesh.positions.size/3)
        assertEquals(1,mesh.indices.size/3)
        assertTrue(mesh.positions.all { it in -1.001f..1.001f })
        assertTrue(mesh.normals[2]>.99f)
    }

    @Test fun rejectsUnsupportedAndTruncatedFiles() {
        try { Native3DModelLoader.load(byteArrayOf(1,2,3),"model.obj"); error("Expected rejection") }
        catch (_: IllegalStateException) {}
        try { Native3DModelLoader.loadStl(byteArrayOf(1,2,3)); error("Expected rejection") }
        catch (_: IllegalArgumentException) {}
    }
}
