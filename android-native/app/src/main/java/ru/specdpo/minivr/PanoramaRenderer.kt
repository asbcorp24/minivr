package ru.specdpo.minivr

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.opengl.Matrix
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.*

class PanoramaRenderer : GLSurfaceView.Renderer {
 @Volatile var yaw=0f
 @Volatile var pitch=0f
 @Volatile var fieldOfView=75f
 @Volatile var stereo="mono"
 @Volatile var projection="360"
 @Volatile var pendingBitmap: Bitmap?=null
 private var program=0
 private var texture=0
 private var vertexBuffer=ByteBuffer.allocateDirect(64*64*6*5*4).order(ByteOrder.nativeOrder()).asFloatBuffer()
 private var count=0
 private var width=1
 private var height=1
 private val vertexShader="""
 attribute vec3 position;
 attribute vec2 uv;
 uniform mat4 mvp;
 varying vec2 texCoord;
 void main(){gl_Position=mvp*vec4(position,1.0);texCoord=uv;}
 """
 private val fragmentShader="""
 precision mediump float;
 varying vec2 texCoord;
 uniform sampler2D image;
 uniform int stereoMode;
 uniform int eye;
 void main(){
  vec2 tc=texCoord;
  if(stereoMode==1)tc.x=tc.x*.5+float(eye)*.5;
  if(stereoMode==2)tc.y=tc.y*.5+float(1-eye)*.5;
  gl_FragColor=texture2D(image,tc);
 }
 """
 override fun onSurfaceCreated(gl:GL10?,config:EGLConfig?){
  GLES20.glClearColor(0f,0f,0f,1f)
  GLES20.glDisable(GLES20.GL_CULL_FACE)
  fun compile(type:Int,src:String):Int {
   val shader=GLES20.glCreateShader(type)
   GLES20.glShaderSource(shader,src);GLES20.glCompileShader(shader)
   val ok=IntArray(1);GLES20.glGetShaderiv(shader,GLES20.GL_COMPILE_STATUS,ok,0)
   check(ok[0]!=0){GLES20.glGetShaderInfoLog(shader)}
   return shader
  }
  program=GLES20.glCreateProgram()
  GLES20.glAttachShader(program,compile(GLES20.GL_VERTEX_SHADER,vertexShader))
  GLES20.glAttachShader(program,compile(GLES20.GL_FRAGMENT_SHADER,fragmentShader))
  GLES20.glLinkProgram(program)
  val ok=IntArray(1);GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,ok,0)
  check(ok[0]!=0){GLES20.glGetProgramInfoLog(program)}
  val ids=IntArray(1);GLES20.glGenTextures(1,ids,0);texture=ids[0]
  GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture)
  GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR)
  GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR)
  GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE)
  GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE)
  buildSphere()
 }
 private fun buildSphere(){
  val slices=64;val stacks=48
  val points=FloatArray(slices*stacks*6*5);var n=0
  fun add(i:Int,j:Int){
   val u=i.toFloat()/slices
   val v=j.toFloat()/stacks
   val theta=u*2f*PI.toFloat()
   val phi=v*PI.toFloat()
   val x=sin(phi)*sin(theta)
   val y=cos(phi)
   val z=-sin(phi)*cos(theta)
   points[n++]=x;points[n++]=y;points[n++]=z
   points[n++]=u;points[n++]=1f-v
  }
  for(j in 0 until stacks)for(i in 0 until slices){
   add(i,j);add(i,j+1);add(i+1,j)
   add(i+1,j);add(i,j+1);add(i+1,j+1)
  }
  vertexBuffer=ByteBuffer.allocateDirect(n*4).order(ByteOrder.nativeOrder()).asFloatBuffer()
  vertexBuffer.put(points,0,n).position(0);count=n/5
 }
 override fun onSurfaceChanged(gl:GL10?,w:Int,h:Int){width=w;height=h;GLES20.glViewport(0,0,w,h)}
 override fun onDrawFrame(gl:GL10?){
  val bitmap=pendingBitmap
  if(bitmap!=null){
   pendingBitmap=null
   GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture)
   GLUtils.texImage2D(GLES20.GL_TEXTURE_2D,0,bitmap,0)
   bitmap.recycle()
  }
  GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
  GLES20.glUseProgram(program)
  GLES20.glBindTexture(GLES20.GL_TEXTURE_2D,texture)
  val mode=when(stereo){"sbs"->1;"tb","top-bottom"->2;else->0}
  GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"stereoMode"),mode)
  val pos=GLES20.glGetAttribLocation(program,"position")
  val uv=GLES20.glGetAttribLocation(program,"uv")
  vertexBuffer.position(0);GLES20.glVertexAttribPointer(pos,3,GLES20.GL_FLOAT,false,20,vertexBuffer)
  vertexBuffer.position(3);GLES20.glVertexAttribPointer(uv,2,GLES20.GL_FLOAT,false,20,vertexBuffer)
  GLES20.glEnableVertexAttribArray(pos);GLES20.glEnableVertexAttribArray(uv)
  val view=FloatArray(16);val rot=FloatArray(16);val proj=FloatArray(16);val mvp=FloatArray(16)
  Matrix.setIdentityM(view,0);Matrix.setIdentityM(rot,0)
  Matrix.rotateM(rot,0,-pitch,1f,0f,0f)
  Matrix.rotateM(rot,0,-yaw,0f,1f,0f)
  Matrix.multiplyMM(view,0,rot,0,view,0)
  val eyes=if(mode==0)1 else 2
  for(eye in 0 until eyes){
   val viewportWidth=width/eyes
   GLES20.glViewport(eye*viewportWidth,0,viewportWidth,height)
   Matrix.perspectiveM(proj,0,fieldOfView,viewportWidth.toFloat()/height,.01f,10f)
   Matrix.multiplyMM(mvp,0,proj,0,view,0)
   GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(program,"mvp"),1,false,mvp,0)
   GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"eye"),eye)
   GLES20.glDrawArrays(GLES20.GL_TRIANGLES,0,count)
  }
 }
}
