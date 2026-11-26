package ru.specdpo.minivr

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

data class NativeMesh(
    val positions: FloatArray, val normals: FloatArray, val indices: IntArray,
    val baseColor: FloatArray = floatArrayOf(.78f,.84f,.92f,1f),
    val metallic: Float = 0f, val roughness: Float = .55f
) {
    val vertexCount: Int get() = positions.size / 3
}

/** Minimal native decoder for binary STL and GLB 2.0 triangle meshes. */
object Native3DModelLoader {
    fun load(bytes: ByteArray, name: String): NativeMesh =
        when(name.substringAfterLast('.').lowercase()) {
            "stl" -> loadStl(bytes)
            "glb" -> loadGlb(bytes)
            else -> error("Поддерживаются GLB и STL")
        }

    fun loadStl(bytes: ByteArray): NativeMesh {
        require(bytes.size >= 84) { "Некорректный STL" }
        val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val count=b.getInt(80)
        require(count>=0 && 84L+count.toLong()*50L==bytes.size.toLong()) {
            "Поддерживается бинарный STL"
        }
        val p=FloatArray(count*9)
        repeat(count) { t ->
            b.position(84+t*50+12)
            repeat(9) { p[t*9+it]=b.float }
        }
        require(p.isNotEmpty()) { "STL не содержит треугольников" }
        return build(p, IntArray(p.size/3){it})
    }

    fun loadGlb(bytes: ByteArray): NativeMesh {
        val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        require(bytes.size>=20 && b.int==0x46546C67 && b.int==2) { "Ожидается GLB 2.0" }
        val total=b.int; require(total in 20..bytes.size)
        var json:JSONObject?=null;var bin:ByteArray?=null
        while(b.position()+8<=total) {
            val len=b.int;val type=b.int
            require(len>=0 && b.position().toLong()+len<=total)
            val chunk=ByteArray(len);b.get(chunk)
            when(type) {
                0x4E4F534A -> json=JSONObject(chunk.toString(Charsets.UTF_8).trimEnd(' ', 0.toChar()))
                0x004E4942 -> bin=chunk
            }
        }
        val root=requireNotNull(json);val data=requireNotNull(bin)
        val primitive=root.getJSONArray("meshes").getJSONObject(0)
            .getJSONArray("primitives").getJSONObject(0)
        require(primitive.optInt("mode",4)==4) { "Поддерживаются треугольные GLB-меши" }
        val attrs=primitive.getJSONObject("attributes")
        val views=root.getJSONArray("bufferViews");val accessors=root.getJSONArray("accessors")
        fun readAccessor(id:Int):Pair<ByteBuffer,JSONObject> {
            val a=accessors.getJSONObject(id);val v=views.getJSONObject(a.getInt("bufferView"))
            val offset=v.optInt("byteOffset",0)+a.optInt("byteOffset",0)
            require(offset>=0 && offset<data.size)
            return ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN).apply{position(offset)} to a
        }
        val (pb,pa)=readAccessor(attrs.getInt("POSITION"))
        require(pa.getInt("componentType")==5126 && pa.getString("type")=="VEC3")
        val n=pa.getInt("count");require(n in 1..300000)
        val p=FloatArray(n*3){pb.float}
        val indices=if(primitive.has("indices")) {
            val (ib,ia)=readAccessor(primitive.getInt("indices"))
            val count=ia.getInt("count");require(count in 3..1500000)
            IntArray(count){when(ia.getInt("componentType")) {
                5121 -> ib.get().toInt() and 255
                5123 -> ib.short.toInt() and 65535
                5125 -> ib.int
                else -> error("Неподдерживаемый формат индексов")
            }}
        } else IntArray(n){it}
        require(indices.size%3==0 && indices.all{it in 0 until n})
        val mesh=build(p,indices)
        var color=floatArrayOf(.78f,.84f,.92f,1f);var metal=0f;var rough=.55f
        if(primitive.has("material")) {
            val m=root.optJSONArray("materials")?.optJSONObject(primitive.getInt("material"))
            val pbr=m?.optJSONObject("pbrMetallicRoughness")
            pbr?.optJSONArray("baseColorFactor")?.let{a->if(a.length()>=4)color=FloatArray(4){a.getDouble(it).toFloat()}}
            metal=pbr?.optDouble("metallicFactor",0.0)?.toFloat()?:0f
            rough=pbr?.optDouble("roughnessFactor",.55)?.toFloat()?:.55f
        }
        return mesh.copy(baseColor=color,metallic=metal,roughness=rough)
    }

    private fun build(raw:FloatArray,indices:IntArray):NativeMesh {
        var minX=Float.POSITIVE_INFINITY;var minY=minX;var minZ=minX
        var maxX=Float.NEGATIVE_INFINITY;var maxY=maxX;var maxZ=maxX
        for(i in raw.indices step 3){minX=minOf(minX,raw[i]);maxX=maxOf(maxX,raw[i]);minY=minOf(minY,raw[i+1]);maxY=maxOf(maxY,raw[i+1]);minZ=minOf(minZ,raw[i+2]);maxZ=maxOf(maxZ,raw[i+2])}
        val cx=(minX+maxX)/2;val cy=(minY+maxY)/2;val cz=(minZ+maxZ)/2
        val scale=maxOf(maxX-minX,maxY-minY,maxZ-minZ).coerceAtLeast(1e-6f)
        val p=raw.copyOf();for(i in p.indices step 3){p[i]=(p[i]-cx)*2/scale;p[i+1]=(p[i+1]-cy)*2/scale;p[i+2]=(p[i+2]-cz)*2/scale}
        val normals=FloatArray(p.size)
        for(i in indices.indices step 3) {
            val a=indices[i]*3;val c=indices[i+1]*3;val d=indices[i+2]*3
            val ux=p[c]-p[a];val uy=p[c+1]-p[a+1];val uz=p[c+2]-p[a+2]
            val vx=p[d]-p[a];val vy=p[d+1]-p[a+1];val vz=p[d+2]-p[a+2]
            val nx=uy*vz-uz*vy;val ny=uz*vx-ux*vz;val nz=ux*vy-uy*vx
            for(k in intArrayOf(a,c,d)){normals[k]+=nx;normals[k+1]+=ny;normals[k+2]+=nz}
        }
        for(i in normals.indices step 3){val l=sqrt(normals[i]*normals[i]+normals[i+1]*normals[i+1]+normals[i+2]*normals[i+2]).coerceAtLeast(1e-8f);normals[i]/=l;normals[i+1]/=l;normals[i+2]/=l}
        return NativeMesh(p,normals,indices)
    }
}
