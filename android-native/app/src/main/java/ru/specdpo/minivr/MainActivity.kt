package ru.specdpo.minivr

import android.app.Activity
import android.os.Bundle
import android.graphics.BitmapFactory
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.opengl.GLSurfaceView
import android.view.MotionEvent
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MainActivity:Activity(),SensorEventListener {
 private lateinit var surface:GLSurfaceView
 private val renderer=PanoramaRenderer()
 private lateinit var sensors:SensorManager
 private var gyro=false
 private var lastX=0f
 private var lastY=0f
 private var lastSensorTime=0L
 private val base=BuildConfig.API_BASE.trimEnd('/')
 private val items=mutableListOf<Pair<Int,String>>()
 override fun onCreate(savedInstanceState:Bundle?){
  super.onCreate(savedInstanceState)
  sensors=getSystemService(SENSOR_SERVICE) as SensorManager
  val root=FrameLayout(this)
  surface=GLSurfaceView(this).apply{
   setEGLContextClientVersion(2)
   setRenderer(renderer)
   renderMode=GLSurfaceView.RENDERMODE_CONTINUOUSLY
   setOnTouchListener { _,e ->
    when(e.actionMasked){
     MotionEvent.ACTION_DOWN->{lastX=e.x;lastY=e.y;true}
     MotionEvent.ACTION_MOVE->{
      if(!gyro){
       renderer.yaw+=(e.x-lastX)*.15f
       renderer.pitch=(renderer.pitch+(e.y-lastY)*.15f).coerceIn(-89f,89f)
      }
      lastX=e.x;lastY=e.y;true
     }
     else->true
    }
   }
  }
  root.addView(surface)
  val bar=LinearLayout(this).apply{
   orientation=LinearLayout.HORIZONTAL
   setBackgroundColor(0xBB071622.toInt())
   setPadding(8,8,8,8)
  }
  val list=Button(this).apply{text="Панорамы";setOnClickListener{showCatalog()}}
  val motion=Button(this).apply{text="GYRO: выкл";setOnClickListener{
   gyro=!gyro;text=if(gyro)"GYRO: вкл" else "GYRO: выкл"
   if(gyro)startGyro() else stopGyro()
  }}
  val zoomIn=Button(this).apply{text="+";setOnClickListener{renderer.fieldOfView=(renderer.fieldOfView-8).coerceAtLeast(35f)}}
  val zoomOut=Button(this).apply{text="−";setOnClickListener{renderer.fieldOfView=(renderer.fieldOfView+8).coerceAtMost(100f)}}
  bar.addView(list);bar.addView(motion);bar.addView(zoomIn);bar.addView(zoomOut)
  root.addView(bar,FrameLayout.LayoutParams(-1,-2))
  setContentView(root)
  showCatalog()
 }
 private fun fetch(path:String):ByteArray{
  val connection=URL(base+path).openConnection() as HttpURLConnection
  connection.connectTimeout=15000;connection.readTimeout=30000
  try{
   check(connection.responseCode==200){"HTTP ${connection.responseCode}"}
   return connection.inputStream.use{it.readBytes()}
  }finally{connection.disconnect()}
 }
 private fun showCatalog(){
  thread{
   try{
    val data=JSONObject(String(fetch("/api/mobile.php?action=catalog"),Charsets.UTF_8))
    val array=data.getJSONArray("panoramas")
    val names=ArrayList<String>();val ids=ArrayList<Int>()
    for(i in 0 until array.length()){val p=array.getJSONObject(i);names.add(p.getString("title"));ids.add(p.getInt("id"))}
    runOnUiThread{
     if(names.isEmpty()){Toast.makeText(this,"Нет опубликованных панорам",Toast.LENGTH_LONG).show();return@runOnUiThread}
     AlertDialog.Builder(this).setTitle("Панорамы MiniVR").setItems(names.toTypedArray()){_,which->loadPanorama(ids[which])}.setNegativeButton("Закрыть",null).show()
    }
   }catch(e:Exception){runOnUiThread{Toast.makeText(this,"Каталог: ${e.message}",Toast.LENGTH_LONG).show()}}
  }
 }
 private fun loadPanorama(id:Int){
  thread{
   try{
    val data=JSONObject(String(fetch("/api/mobile.php?action=panorama&id=$id"),Charsets.UTF_8)).getJSONObject("panorama")
    val url=data.getString("image")
    val target=if(url.startsWith("https://"))url else base+"/"+url.trimStart('/')
    val connection=URL(target).openConnection() as HttpURLConnection
    connection.connectTimeout=15000;connection.readTimeout=60000
    val bitmap=try{connection.inputStream.use{BitmapFactory.decodeStream(it)}}finally{connection.disconnect()}
    check(bitmap!=null){"Изображение не загружено"}
    renderer.stereo=data.optString("stereo","mono").lowercase()
    renderer.projection=data.optString("projection","360")
    renderer.pendingBitmap=bitmap
    renderer.yaw=0f;renderer.pitch=0f
    runOnUiThread{Toast.makeText(this,data.getString("title"),Toast.LENGTH_SHORT).show()}
   }catch(e:Exception){runOnUiThread{Toast.makeText(this,"Загрузка: ${e.message}",Toast.LENGTH_LONG).show()}}
  }
 }
 private fun startGyro(){
  lastSensorTime=0L
  val sensor=sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
  if(sensor==null){gyro=false;Toast.makeText(this,"Гироскоп отсутствует",Toast.LENGTH_SHORT).show();return}
  sensors.registerListener(this,sensor,SensorManager.SENSOR_DELAY_GAME)
 }
 private fun stopGyro(){sensors.unregisterListener(this);lastSensorTime=0L}
 override fun onSensorChanged(event:SensorEvent){
  if(!gyro)return
  val now=event.timestamp
  if(lastSensorTime!=0L){
   val dt=((now-lastSensorTime)*1e-9f).coerceIn(0f,.1f)
   renderer.yaw-=Math.toDegrees((event.values[1]*dt).toDouble()).toFloat()
   renderer.pitch=(renderer.pitch-Math.toDegrees((event.values[0]*dt).toDouble()).toFloat()).coerceIn(-89f,89f)
  }
  lastSensorTime=now
 }
 override fun onAccuracyChanged(sensor:Sensor?,accuracy:Int){}
 override fun onPause(){stopGyro();surface.onPause();super.onPause()}
 override fun onResume(){super.onResume();surface.onResume();if(gyro)startGyro()}
}
