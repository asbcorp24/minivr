package ru.specdpo.minivr

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/** CPU-side decoded triangle mesh. Coordinates are normalized around the model center. */
data class NativeMesh(
    val positions: FloatArray,
    val normals: FloatArray,
    val indices: IntArray,
    val baseColor: FloatArray = floatArrayOf(.78f, .84f, .92f, 1f),
    val metallic: Float = .0f,
    val roughness: Float = .55f
) {
    val vertexCount: Int get() = positions.size / 3
    val triangleCount: Int get() = indices.size / 3
}

/** Minimal native GLB 2.0 and STL decoder; no WebView or external runtime. */
object Native3DModelLoader {
    private const val GLB_MAGIC = 0x46546C67
    private const val JSON_CHUNK = 0x4E4F534A
    private const val BIN_CHUNK = 0x004E4942

    fun load(bytes: ByteArray, fileName: String): NativeMesh {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "stl" -> loadStl(bytes)
            "glb" -> loadGlb(bytes)
            else -> error("Поддерживаются только GLB и STL")
        }
    }

    fun loadStl(bytes: ByteArray): NativeMesh {
        require(bytes.size >= 84) { "Некорректный STL" }
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val count = buffer.getInt(80)
        val binaryExpected = 84L + count.toLong() * 50L
        val triangles = if (count >= 0 && binaryExpected == bytes.size.toLong()) {
            val out = ArrayList<Float>(count * 9)
            repeat(count) {
                val nx = buffer.getFloat(); val ny = buffer.getFloat(); val nz = buffer.getFloat()
                repeat(3) { out.add(buffer.getFloat()); out.add(buffer.getFloat()); out.add(buffer.getFloat()) }
                buffer.position(buffer.position() + 2)
            }
            out.toFloatArray()
        } else {
            val text = bytes.toString(Charsets.UTF_8)
            val values = Regex("vertex\\s+([-+0-9.eE]+)\\s+([-+0-9.eE]+)\\s+([-+0-9.eE]+)", RegexOption.IGNORE_CASE)
                .findAll(text).map { it.groupValues.drop(1).map(String::toFloat) }.toList()
            require(values.isNotEmpty() && values.size % 3 == 0) { "Не удалось прочитать STL" }
            values.flatten().toFloatArray()
        }
        require(triangles.isNotEmpty() && triangles.size % 9 == 0) { "STL не содержит треугольников" }
        val normals = FloatArray(triangles.size)
        for (i in triangles.indices step 9) {
            val ax=triangles[i+3]-triangles[i]; val ay=triangles[i+4]-triangles[i+1]; val az=triangles[i+5]-triangles[i+2]
            val bx=triangles[i+6]-triangles[i]; val by=triangles[i+7]-triangles[i+1]; val bz=triangles[i+8]-triangles[i+2]
            val nx=ay*bz-az*by; val ny=az*bx-ax*bz; val nz=ax*by-ay*bx
            val len=sqrt(nx*nx+ny*ny+nz*nz).coerceAtLeast(1e-8f)
            repeat(3) { j -> normals[i+j*3]=nx/len; normals[i+j*3+1]=ny/len; normals[i+j*3+2]=nz/len }
        }
        return normalized(triangles, normals, IntArray(triangles.size/3) { it })
    }

    fun loadGlb(bytes: ByteArray): NativeMesh {
        val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        require(bytes.size >= 20 && b.int == GLB_MAGIC) { "Не GLB 2.0" }
        require(b.int == 2) { "Поддерживается GLB 2.0" }
        val total=b.int
        require(total <= bytes.size && total >= 20) { "Повреждён GLB" }
        var json: JSONObject?=null; var binary: ByteArray?=null
        while (b.position()+8 <= total) {
            val length=b.int; val type=b.int
            require(length >= 0 && b.position().toLong()+length <= total) { "Повреждён chunk GLB" }
            val chunk=ByteArray(length); b.get(chunk)
            when(type) {
                JSON_CHUNK -> json=JSONObject(chunk.toString(Charsets.UTF_8).trimEnd(' ','\\u0000'))
                BIN_CHUNK -> binary=chunk
            }
        }
        val root=requireNotNull(json) { "В GLB нет JSON chunk" }
        val bin=requireNotNull(binary) { "В GLB нет BIN chunk" }
        val meshes=root.getJSONArray("meshes")
        require(meshes.length()>0) { "В GLB нет мешей" }
        val primitive=meshes.getJSONObject(0).getJSONArray("primitives").getJSONObject(0)
        val attrs=primitive.getJSONObject("attributes")
        val views=root.getJSONArray("bufferViews"); val accessors=root.getJSONArray("accessors")
        fun accessor(index:Int): Pair<ByteBuffer,JSONObject> {
            val a=accessors.getJSONObject(index); val view=views.getJSONObject(a.getInt("bufferView"))
            val offset=view.optInt("byteOffset",0)+a.optInt("byteOffset",0)
            val data=ByteBuffer.wrap(bin).order(ByteOrder.LITTLE_ENDIAN);data.position(offset)
            return data to a
        }
        val (posBuffer,posAcc)=accessor(attrs.getInt("POSITION"))
        require(posAcc.getString("type")=="VEC3" && posAcc.getInt("componentType")==5126) { "POSITION должен быть FLOAT VEC3" }
        val vertexCount=posAcc.getInt("count"); require(vertexCount in 1..500000)
        val positions=FloatArray(vertexCount*3) { posBuffer.getFloat() }
        val normals=FloatArray(vertexCount*3)
        if(attrs.has("NORMAL")) {
            val (nb,na)=accessor(attrs.getInt("NORMAL"))
            if(na.getInt("componentType")==5126) repeat(normals.size){normals[it]=nb.getFloat()}
        }
        var indices=IntArray(0)
        if(primitive.has("indices")) {
            val (ib,ia)=accessor(primitive.getInt("indices")); val n=ia.getInt("count")
            indices=IntArray(n) { when(ia.getInt("componentType")) { 5121 -> ib.get().toInt() and 255; 5123 -> ib.short.toInt() and 65535; 5125 -> ib.int; else -> error("Неподдерживаемый тип индексов") } }
        } else indices=IntArray(vertexCount){it}
        if(normals.all { it==0f }) {
            for(i in indices.indices step 3) {
                val a=indices[i]*3;val c=indices[i+1]*3;val d=indices[i+2]*3
                val ux=positions[c]-positions[a];val uy=positions[c+1]-positions[a+1];val uz=positions[c+2]-positions[a+2]
                val vx=positions[d]-positions[a];val vy=positions[d+1]-positions[a+1];val vz=positions[d+2]-positions[a+2]
                val nx=uy*vz-uz*vy;val ny=uz*vx-ux*vz;val nz=ux*vy-uy*vx
                for(k in listOf(a,c,d)){normals[k]+=nx;normals[k+1]+=ny;normals[k+2]+=nz}
            }
            for(i in 0 until vertexCount){val p=i*3;val l=sqrt(normals[p]*normals[p]+normals[p+1]*normals[p+1]+normals[p+2]*normals[p+2]).coerceAtLeast(1e-8f);normals[p]/=l;normals[p+1]/=l;normals[p+2]/=l}
        }
        var color=floatArrayOf(.78f,.84f,.92f,1f);var metallic=0f;var roughness=.55f
        if(primitive.has("material")) {
            val materials=root.optJSONArray("materials");val material=materials?.optJSONObject(primitive.getInt("material"))
            val pbr=material?.optJSONObject("pbrMetallicRoughness")
            pbr?.optJSONArray("baseColorFactor")?.let{if(it.length()>=4)color=FloatArray(4){i->it.getDouble(i).toFloat()}}
            metallic=pbr?.optDouble("metallicFactor",0.0)?.toFloat()?:0f
            roughness=pbr?.optDouble("roughnessFactor",.55)?.toFloat()?:.55f
        }
        val mesh=normalized(positions,normals,indices)
        return mesh.copy(baseColor=color,metallic=metallic,roughness=roughness)
    }

    private fun normalized(p:FloatArray,n:FloatArray,idx:IntArray):NativeMesh {
        var minX=Float.POSITIVE_INFINITY;var minY=minX;var minZ=minX
        var maxX=Float.NEGATIVE_INFINITY;var maxY=maxX;var maxZ=maxX
        for(i in p.indices step 3){minX=minOf(minX,p[i]);maxX=maxOf(maxX,p[i]);minY=minOf(minY,p[i+1]);maxY=maxOf(maxY,p[i+1]);minZ=minOf(minZ,p[i+2]);maxZ=maxOf(maxZ,p[i+2])}
        val cx=(minX+maxX)/2;val cy=(minY+maxY)/2;val cz=(minZ+maxZ)/2
        val scale=maxOf(maxX-minX,maxY-minY,maxZ-minZ).coerceAtLeast(1e-6f)
        val out=p.copyOf();for(i in out.indices step 3){out[i]=(out[i]-cx)/scale*2;out[i+1]=(out[i+1]-cy)/scale*2;out[i+2]=(out[i+2]-cz)/scale*2}
        return NativeMesh(out,n,idx)
    }
}
