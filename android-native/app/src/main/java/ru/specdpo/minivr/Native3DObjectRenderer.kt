package ru.specdpo.minivr

import android.opengl.GLES20
import android.opengl.Matrix
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.ShortBuffer

/** GLES2 renderer for a single native mesh layer composited over the panorama. */
class Native3DObjectRenderer {
    @Volatile var mesh: NativeMesh? = null
    @Volatile var wireframe = false
    @Volatile var bloom = false
    @Volatile var bloomStrength = 1.2f
    @Volatile var distance = 4.0f
    @Volatile var yaw = 0f
    @Volatile var pitch = 0f
    @Volatile var scale = 1f
    private var program=0
    private var vertexBuffer:FloatBuffer?=null
    private var normalBuffer:FloatBuffer?=null
    private var indexBuffer:ShortBuffer?=null
    private var lineBuffer:ShortBuffer?=null
    private var indexCount=0
    private var lineCount=0
    private var loaded:NativeMesh?=null
    private val projection=FloatArray(16);private val view=FloatArray(16)
    private val model=FloatArray(16);private val mv=FloatArray(16);private val mvp=FloatArray(16)
    private val vertexShader="""
        attribute vec3 aPosition; attribute vec3 aNormal;
        uniform mat4 uMvp; uniform mat4 uModel;
        varying vec3 vNormal; varying vec3 vPosition;
        void main(){vec4 p=uModel*vec4(aPosition,1.0);vPosition=p.xyz;vNormal=mat3(uModel)*aNormal;gl_Position=uMvp*vec4(aPosition,1.0);}
    """.trimIndent()
    private val fragmentShader="""
        precision mediump float;
        uniform vec4 uColor; uniform float uMetal; uniform float uRough;
        uniform float uBloom; uniform float uBloomStrength;
        varying vec3 vNormal; varying vec3 vPosition;
        void main(){
          vec3 n=normalize(vNormal);vec3 v=normalize(-vPosition);
          vec3 l1=normalize(vec3(-.45,.8,.65));vec3 l2=normalize(vec3(.7,.15,.5));
          float d=max(dot(n,l1),0.0)*.8+max(dot(n,l2),0.0)*.35;
          vec3 h=normalize(l1+v);float spec=pow(max(dot(n,h),0.0),mix(12.0,100.0,1.0-uRough));
          float fres=pow(1.0-max(dot(n,v),0.0),3.0);
          vec3 metalTint=mix(vec3(1.0),uColor.rgb,uMetal);
          vec3 col=uColor.rgb*(.22+d*.72)+metalTint*(spec*(.25+uMetal*1.8)+fres*uMetal*.45);
          if(uBloom>.5)col+=uColor.rgb*uBloomStrength*.35;
          gl_FragColor=vec4(col,uColor.a);
        }
    """.trimIndent()

    fun onSurfaceCreated() {
        fun compile(type:Int,source:String):Int {val s=GLES20.glCreateShader(type);GLES20.glShaderSource(s,source);GLES20.glCompileShader(s);val ok=IntArray(1);GLES20.glGetShaderiv(s,GLES20.GL_COMPILE_STATUS,ok,0);check(ok[0]!=0){GLES20.glGetShaderInfoLog(s)};return s}
        val vs=compile(GLES20.GL_VERTEX_SHADER,vertexShader);val fs=compile(GLES20.GL_FRAGMENT_SHADER,fragmentShader)
        program=GLES20.glCreateProgram();GLES20.glAttachShader(program,vs);GLES20.glAttachShader(program,fs);GLES20.glLinkProgram(program)
        val ok=IntArray(1);GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,ok,0);check(ok[0]!=0){GLES20.glGetProgramInfoLog(program)}
        GLES20.glDeleteShader(vs);GLES20.glDeleteShader(fs);loaded=null
    }

    fun setMesh(value:NativeMesh?) { mesh=value;loaded=null }
    private fun upload(m:NativeMesh) {
        require(m.vertexCount<=65535) { "Для GLES2 mesh должен содержать не более 65535 вершин" }
        vertexBuffer=ByteBuffer.allocateDirect(m.positions.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(m.positions).apply{position(0)}
        normalBuffer=ByteBuffer.allocateDirect(m.normals.size*4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(m.normals).apply{position(0)}
        val idx=if(m.indices.isEmpty())IntArray(m.vertexCount){it}else m.indices
        indexCount=idx.size
        indexBuffer=ByteBuffer.allocateDirect(idx.size*2).order(ByteOrder.nativeOrder()).asShortBuffer().apply{idx.forEach{put(it.toShort())};position(0)}
        val lines=ArrayList<Short>(idx.size*2)
        for(i in idx.indices step 3) {val a=idx[i].toShort();val b=idx[i+1].toShort();val c=idx[i+2].toShort();lines.add(a);lines.add(b);lines.add(b);lines.add(c);lines.add(c);lines.add(a)}
        lineCount=lines.size
        lineBuffer=ByteBuffer.allocateDirect(lines.size*2).order(ByteOrder.nativeOrder()).asShortBuffer().apply{lines.forEach{put(it)};position(0)}
        loaded=m
    }

    fun draw(width:Int,height:Int,viewYaw:Float,viewPitch:Float) {
        val m=mesh?:return;if(program==0)return
        if(loaded!==m)upload(m)
        val oldViewport=IntArray(4);GLES20.glGetIntegerv(GLES20.GL_VIEWPORT,oldViewport,0)
        Matrix.setIdentityM(model,0)
        Matrix.translateM(model,0,0f,0f,-distance.coerceIn(1.2f,30f))
        Matrix.rotateM(model,0,yaw,0f,1f,0f);Matrix.rotateM(model,0,pitch,1f,0f,0f);Matrix.scaleM(model,0,scale.coerceIn(.05f,8f),scale.coerceIn(.05f,8f),scale.coerceIn(.05f,8f))
        Matrix.setIdentityM(view,0)
        Matrix.rotateM(view,0,-viewPitch,1f,0f,0f);Matrix.rotateM(view,0,-viewYaw,0f,1f,0f)
        Matrix.perspectiveM(projection,0,58f,(width.toFloat()/height.coerceAtLeast(1)),.1f,100f)
        Matrix.multiplyMM(mv,0,view,0,model,0);Matrix.multiplyMM(mvp,0,projection,0,mv,0)
        GLES20.glUseProgram(program)
        val pos=GLES20.glGetAttribLocation(program,"aPosition");val nor=GLES20.glGetAttribLocation(program,"aNormal")
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER,0);GLES20.glBindBuffer(GLES20.GL_ELEMENT_ARRAY_BUFFER,0)
        vertexBuffer?.position(0);GLES20.glVertexAttribPointer(pos,3,GLES20.GL_FLOAT,false,0,vertexBuffer);GLES20.glEnableVertexAttribArray(pos)
        normalBuffer?.position(0);GLES20.glVertexAttribPointer(nor,3,GLES20.GL_FLOAT,false,0,normalBuffer);GLES20.glEnableVertexAttribArray(nor)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program,"uMvp"),1,false,mvp,0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program,"uModel"),1,false,model,0)
        GLES20.glUniform4fv(GLES20.glGetUniformLocation(program,"uColor"),1,m.baseColor,0)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"uMetal"),m.metallic)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"uRough"),m.roughness)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"uBloom"),if(bloom)1f else 0f)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"uBloomStrength"),bloomStrength.coerceIn(0f,3f))
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);GLES20.glDepthMask(true)
        if(wireframe){GLES20.glLineWidth(1.5f);lineBuffer?.position(0);GLES20.glDrawElements(GLES20.GL_LINES,lineCount,GLES20.GL_UNSIGNED_SHORT,lineBuffer)}
        else {indexBuffer?.position(0);GLES20.glDrawElements(GLES20.GL_TRIANGLES,indexCount,GLES20.GL_UNSIGNED_SHORT,indexBuffer)}
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);GLES20.glDepthMask(false)
        GLES20.glViewport(oldViewport[0],oldViewport[1],oldViewport[2],oldViewport[3])
    }
}
