package ru.specdpo.minivr

import android.opengl.GLES20
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import kotlin.math.*

/** World-anchored GLES2 particle sprites. Screen-space quads are not attached
 *  to the camera; turning the phone reveals genuine near/mid/far layers. */
class NativeParticleLayer {
    private data class Particle(
        var x: Float, var y: Float, var z: Float,
        val radius: Float, val velocity: Float, val phase: Float,
        val size: Float, val r: Float, val g: Float, val b: Float
    )

    private var program = 0
    val supported: Boolean get() = program != 0
    private var kind = -1
    private var density = -1f
    private var fireflies = -1f
    private var previousTime = 0f
    private var sprites = mutableListOf<Particle>()
    private var lights = mutableListOf<Particle>()
    private var maxPointSize = 48f
    private val vertices = ByteBuffer.allocateDirect(360 * 7 * 4)
        .order(ByteOrder.nativeOrder()).asFloatBuffer()

    private val vertex = """
        attribute vec2 position;
        attribute float pointSize;
        attribute vec3 tint;
        attribute float phase;
        varying vec3 vTint;
        varying float vPhase;
        void main() {
            vTint=tint;
            vPhase=phase;
            gl_Position=vec4(position,0.0,1.0);
            gl_PointSize=pointSize;
        }
    """.trimIndent()

    private val fragment = """
        precision mediump float;
        uniform float clockTime;
        uniform float opacity;
        uniform int kind;
        varying vec3 vTint;
        varying float vPhase;
        const float PI=3.14159265;
        void main() {
            vec2 p=gl_PointCoord*2.0-1.0;
            float radius=length(p);
            float a=0.0;
            if (kind==1) {
                a=(1.0-smoothstep(0.06,0.20,abs(p.x+p.y*0.17)))*
                  (1.0-smoothstep(0.72,1.0,abs(p.y)))*0.66;
            } else if (kind==2) {
                float spokes=1.0-smoothstep(0.06,0.15,abs(sin(atan(p.y,p.x)*3.0))*radius);
                float crystal=spokes*(1.0-smoothstep(0.58,0.97,radius));
                float soft=1.0-smoothstep(0.20,0.94,radius);
                a=mix(soft,crystal,max(0.0,step(0.75,fract(vPhase*3.7))))*0.92;
            } else if (kind==3) {
                float angle=atan(p.y,p.x)+clockTime*0.7+vPhase;
                float edge=0.66+0.15*sin(angle*5.0)+0.06*sin(angle*11.0);
                a=(1.0-smoothstep(edge-0.08,edge+0.07,radius))*0.87;
                a*=smoothstep(-0.78,0.3,p.y);
            } else if (kind==4) {
                float flap=sin(clockTime*31.0+vPhase);
                float wing=abs(p.y-0.25*flap);
                float body=1.0-smoothstep(0.08,0.25,length(p*vec2(1.4,1.0)));
                float wings=(1.0-smoothstep(0.06,0.17,wing))*
                            (1.0-smoothstep(0.55,0.88,abs(p.x)));
                a=max(body,wings*0.68);
            } else if (kind==5) {
                float halo=1.0-smoothstep(0.12,0.95,radius);
                float core=1.0-smoothstep(0.02,0.32,radius);
                a=(halo*0.42+core*0.42)*(0.78+0.22*sin(clockTime*1.4+vPhase));
            } else if (kind==6) {
                float flap=sin(clockTime*6.5+vPhase);
                float wings=abs(p.y-(0.08+0.35*abs(p.x))*flap);
                a=(1.0-smoothstep(0.045,0.13,wings))*
                  (1.0-smoothstep(0.65,0.92,abs(p.x)));
                a=max(a,1.0-smoothstep(0.06,0.18,length(p*vec2(2.8,1.0))));
            } else if (kind==7) {
                float wobble=radius+0.02*sin(clockTime*2.7+vPhase);
                float ring=1.0-smoothstep(0.035,0.11,abs(wobble-0.76));
                float shine=exp(-dot(p-vec2(-0.24,-0.3),p-vec2(-0.24,-0.3))*22.0);
                a=ring*0.69+shine*0.34+(1.0-smoothstep(0.0,0.7,radius))*0.08;
            } else if (kind==8) {
                float pulse=0.57+0.43*sin(clockTime*3.1+vPhase);
                a=pow(max(0.0,1.0-smoothstep(0.0,1.0,radius)),1.5)*pulse;
            }
            if(a<0.015)discard;
            gl_FragColor=vec4(vTint,a*opacity);
        }
    """.trimIndent()

    fun initialize() {
        fun compile(type: Int, src: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, src)
            GLES20.glCompileShader(shader)
            val result = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, result, 0)
            check(result[0] != 0) { GLES20.glGetShaderInfoLog(shader) }
            return shader
        }
        program = runCatching {
            val v = compile(GLES20.GL_VERTEX_SHADER, vertex)
            val f = compile(GLES20.GL_FRAGMENT_SHADER, fragment)
            val p = GLES20.glCreateProgram()
            GLES20.glAttachShader(p, v)
            GLES20.glAttachShader(p, f)
            GLES20.glLinkProgram(p)
            val linked = IntArray(1)
            GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, linked, 0)
            check(linked[0] != 0) { GLES20.glGetProgramInfoLog(p) }
            GLES20.glDeleteShader(v)
            GLES20.glDeleteShader(f)
            p
        }.getOrElse { Log.w("MiniVR", "Native particle shader unavailable", it); 0 }
        val sizeRange = FloatArray(2)
        GLES20.glGetFloatv(GLES20.GL_ALIASED_POINT_SIZE_RANGE, sizeRange, 0)
        maxPointSize = sizeRange[1].coerceAtLeast(1f)
        if (maxPointSize < 6f) program = 0
        reset()
    }

    fun reset() {
        kind = -1; density = -1f; fireflies = -1f
        previousTime = 0f
        sprites.clear(); lights.clear()
    }

    private fun spawn(rand: Random, type: Int, position: Int): Particle {
        val layer = position % 3
        val depth = when (type) {
            6 -> floatArrayOf(12f,20f,28f)[layer]
            4,8 -> floatArrayOf(3f,5f,8f)[layer]
            5 -> floatArrayOf(2.5f,5f,9f)[layer]
            else -> floatArrayOf(5f,11f,20f)[layer]
        }
        val radius=depth*(.55f+.45f*rand.nextFloat())
        val angle=rand.nextFloat()*(2.0*Math.PI).toFloat()
        val y=when (type) {
            6 -> 2f+rand.nextFloat()*7f
            4,8 -> -2f+rand.nextFloat()*6f
            else -> (rand.nextFloat()-.5f)*22f
        }
        val size=when(type) {
            1 -> .035f+rand.nextFloat()*.035f
            2 -> .08f+rand.nextFloat()*.13f
            3 -> .18f+rand.nextFloat()*.31f
            4 -> .13f+rand.nextFloat()*.14f
            5 -> .08f+rand.nextFloat()*.25f
            6 -> 1.4f+rand.nextFloat()*1.6f
            7 -> .13f+rand.nextFloat()*.27f
            else -> .12f+rand.nextFloat()*.16f
        }
        val colors = when(type) {
            3 -> arrayOf(floatArrayOf(.79f,.43f,.14f),floatArrayOf(.88f,.67f,.3f),floatArrayOf(.64f,.29f,.12f))
            4 -> arrayOf(floatArrayOf(.96f,.86f,.48f),floatArrayOf(.84f,.93f,.67f))
            5 -> arrayOf(floatArrayOf(1f,.96f,.85f),floatArrayOf(.78f,.85f,.9f))
            6 -> arrayOf(floatArrayOf(.10f,.15f,.21f),floatArrayOf(.23f,.29f,.34f))
            7 -> arrayOf(floatArrayOf(.68f,.88f,1f),floatArrayOf(.84f,.95f,1f))
            8 -> arrayOf(floatArrayOf(1f,.85f,.44f))
            else -> arrayOf(floatArrayOf(1f,1f,1f),floatArrayOf(.83f,.94f,1f))
        }
        val c=colors[position%colors.size]
        return Particle(cos(angle)*radius,y,sin(angle)*radius,radius,
            .4f+rand.nextFloat()*.8f,rand.nextFloat()*6.283f,size,c[0],c[1],c[2])
    }

    private fun configure(fx: NativeSceneEffects) {
        if (fx.particles == kind && fx.particleDensity == density && fx.fireflyDensity == fireflies) return
        kind = fx.particles; density=fx.particleDensity; fireflies=fx.fireflyDensity
        val rnd=Random(1987291L)
        val count = (fx.particleDensity * when (kind) {
            1 -> 250; 2 -> 220; 3 -> 125; 4 -> 95; 5 -> 215; 6 -> 35; 7 -> 170; else -> 0
        }).toInt().coerceIn(0,310)
        sprites=MutableList(count) { spawn(rnd,kind,it) }
        lights=MutableList((fx.fireflyDensity*85).toInt().coerceIn(0,80)) { spawn(rnd,8,it) }
    }

    private fun step(fx: NativeSceneEffects, dt: Float, time: Float) {
        fun move(items: List<Particle>, type: Int) {
            for (p in items) {
                val speed=if(type==8) 1f else fx.particleSpeed
                val fall=when(type) {
                    1 -> -17f; 2 -> -2f; 3 -> -1.35f; 4 -> .18f
                    5 -> .12f; 6 -> .3f; 7 -> 1.6f; else -> .11f
                }
                p.y+=dt*speed*p.velocity*fall
                p.x+=dt*speed*(fx.wind*.22f+sin(time*(if(type==4) 2.5f else .65f)+p.phase)*
                    (if(type==3) 1.2f else .45f))
                p.z+=dt*cos(time*.75f+p.phase)*(if(type==4) .55f else .2f)
                if(p.y < -11f || p.y > 11f || abs(p.x)>26f || abs(p.z)>26f) {
                    val angle=p.phase+time*.07f
                    p.x=cos(angle)*p.radius
                    p.z=sin(angle)*p.radius
                    p.y=if(fall<0f) 11f else if(type==7) -11f else 0f
                }
            }
        }
        if (kind>0) move(sprites,kind)
        move(lights,8)
    }

    private fun drawBatch(items: List<Particle>, type: Int, opacity: Float,
                          eye: Int, eyes: Int, width: Int, height: Int,
                          yaw: Float, pitch: Float, tangent: Float, time: Float) {
        if (items.isEmpty()) return
        val a=Math.toRadians(yaw.toDouble()).toFloat()
        val b=Math.toRadians(pitch.toDouble()).toFloat()
        val ca=cos(a); val sa=sin(a); val cb=cos(b); val sb=sin(b)
        val fx=cb*ca;val fy=sb;val fz=cb*sa
        val rx=-sa;val rz=ca
        val ux=-sb*ca;val uy=cb;val uz=-sb*sa
        val viewWidth=width/eyes
        val aspect=viewWidth.toFloat()/height
        val eyeOffset=(eye-(eyes-1)*.5f)*.065f
        vertices.clear()
        for (particle in items) {
            val px=particle.x-rx*eyeOffset
            val py=particle.y
            val pz=particle.z-rz*eyeOffset
            val depth=px*fx+py*fy+pz*fz
            val x=if(depth>.1f) (px*rx+pz*rz)/(depth*tangent*aspect) else 2.5f
            val y=if(depth>.1f) (px*ux+py*uy+pz*uz)/(depth*tangent) else 2.5f
            val apparent=(particle.size*height/(2f*depth.coerceAtLeast(.1f)*tangent))
            val size=if(abs(x)>1.3f||abs(y)>1.3f||depth<=.1f) 0f else
                apparent.coerceIn(if(type==6) 6f else 2f,maxPointSize)
            vertices.put(x);vertices.put(y);vertices.put(size)
            vertices.put(particle.r);vertices.put(particle.g);vertices.put(particle.b)
            vertices.put(particle.phase)
        }
        vertices.position(0)
        val stride=7*4
        val pos=GLES20.glGetAttribLocation(program,"position")
        val psize=GLES20.glGetAttribLocation(program,"pointSize")
        val tint=GLES20.glGetAttribLocation(program,"tint")
        val phase=GLES20.glGetAttribLocation(program,"phase")
        vertices.position(0);GLES20.glVertexAttribPointer(pos,2,GLES20.GL_FLOAT,false,stride,vertices)
        vertices.position(2);GLES20.glVertexAttribPointer(psize,1,GLES20.GL_FLOAT,false,stride,vertices)
        vertices.position(3);GLES20.glVertexAttribPointer(tint,3,GLES20.GL_FLOAT,false,stride,vertices)
        vertices.position(6);GLES20.glVertexAttribPointer(phase,1,GLES20.GL_FLOAT,false,stride,vertices)
        for (attr in intArrayOf(pos,psize,tint,phase)) GLES20.glEnableVertexAttribArray(attr)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(program,"kind"),type)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"opacity"),opacity)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(program,"clockTime"),time)
        GLES20.glViewport(eye*viewWidth,0,viewWidth,height)
        GLES20.glDrawArrays(GLES20.GL_POINTS,0,items.size)
        for (attr in intArrayOf(pos,psize,tint,phase)) GLES20.glDisableVertexAttribArray(attr)
    }

    fun draw(fx: NativeSceneEffects, clock: Float, screenWidth: Int, screenHeight: Int,
             yaw: Float, pitch: Float, fov: Float, eyes: Int) {
        if (program==0) return
        configure(fx)
        if (sprites.isEmpty() && lights.isEmpty()) return
        val dt=if(previousTime<=0f) 0f else (clock-previousTime).coerceIn(0f,.05f)
        previousTime=clock
        step(fx,dt,clock)
        GLES20.glUseProgram(program)
        GLES20.glEnable(GLES20.GL_BLEND)
        val tangent=tan(Math.toRadians((fov/2f).toDouble())).toFloat()
        for (eye in 0 until eyes) {
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA,GLES20.GL_ONE_MINUS_SRC_ALPHA)
            drawBatch(sprites,kind,fx.particleOpacity,eye,eyes,screenWidth,screenHeight,yaw,pitch,tangent,clock)
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA,GLES20.GL_ONE)
            drawBatch(lights,8,.8f,eye,eyes,screenWidth,screenHeight,yaw,pitch,tangent,clock)
        }
        GLES20.glDisable(GLES20.GL_BLEND)
    }
}
