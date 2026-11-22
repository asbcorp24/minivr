package ru.specdpo.minivr

/** Second, additive GLES2 pass. Scene regions, flow fields and lighting come
 *  from the same settings as panorama-environment.js / panorama-atmosphere.js. */
object NativeEnvironmentShader {
    val fragment = """
        precision highp float;
        varying vec2 screenPoint;
        uniform sampler2D regionMap;
        uniform sampler2D atmosphereMap;
        uniform sampler2D sourceMap;
        uniform sampler2D flowMap;
        uniform float yaw;
        uniform float pitch;
        uniform float tangent;
        uniform float aspect;
        uniform float clockTime;
        uniform vec4 surfaceFx;   // live water, river, waterfall, floating leaves
        uniform vec4 surfaceSpeed; // river, waterfall, steam, bubbles
        uniform vec4 environmentFx; // clouds, stars, beams, lamps
        uniform vec4 sourceFx;    // bubbles, steam, floating, lightning
        uniform vec3 sunDirection;
        uniform float lampCount;
        uniform vec2 lampAngles[8];
        const float PI = 3.141592653589793;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                       mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
        }
        vec3 sunVector(vec2 angles) {
            return vec3(cos(angles.y)*cos(angles.x),sin(angles.y),-cos(angles.y)*sin(angles.x));
        }
        void main() {
            float cy=cos(yaw),sy=sin(yaw),cp=cos(pitch),sp=sin(pitch);
            vec3 forward=vec3(cp*cy,sp,cp*sy);
            vec3 right=vec3(-sy,0.0,cy);
            vec3 up=vec3(-sp*cy,cp,-sp*sy);
            vec3 ray=normalize(forward+right*screenPoint.x*tangent*aspect+
                               up*screenPoint.y*tangent);
            vec2 uv=vec2(fract(0.5-atan(ray.z,ray.x)/(2.0*PI)+1.0),
                         clamp(0.5-asin(clamp(ray.y,-1.0,1.0))/PI,0.0001,0.9999));
            vec4 region=texture2D(regionMap,uv);
            vec4 masks=texture2D(atmosphereMap,uv);
            vec4 sources=texture2D(sourceMap,uv);
            vec4 flow=texture2D(flowMap,uv);
            float t=clockTime;
            vec3 contribution=vec3(0.0);

            // Same three-scale water glints as the site, on painted water only.
            if (surfaceFx.x>0.0 && region.r>0.01) {
                vec2 p=uv*vec2(430.0,135.0);
                float warp=noise(p*0.025+vec2(t*0.018,-t*0.009))-0.5;
                vec2 q=p+vec2(warp*13.0,noise(p*0.055+vec2(-t*0.012,t*0.006))*7.0);
                float large=noise(q*0.11+vec2(t*0.036,t*0.008));
                float medium=noise(q*0.38+vec2(-t*0.11,t*0.028));
                float fine=noise(q*1.7+vec2(t*0.21,-t*0.04));
                float band=smoothstep(0.47,0.76,large*0.49+medium*0.38+fine*0.13);
                float glint=smoothstep(0.72,0.92,medium*0.45+fine*0.55);
                float envelope=0.48+0.52*noise(uv*vec2(15,8)+vec2(t*0.006,0));
                contribution+=vec3(0.60,0.73,0.81)*(0.018+band*0.22+glint*0.37)*
                              region.r*surfaceFx.x*envelope;
            }
            // Per-pixel direction fields are generated from the site's arrows;
            // longitude wraps, so rivers remain continuous at the 360-degree seam.
            if (surfaceFx.y>0.0 && region.g>0.01) {
                float angle=(flow.r*2.0-1.0)*PI;
                vec2 axis=vec2(cos(angle),sin(angle));
                vec2 p=uv*vec2(190.0,110.0)-axis*t*surfaceSpeed.x*0.9;
                float bend=(noise(p*0.045+vec2(t*0.08,0))-0.5)*5.0;
                float streak=noise(vec2(p.x*0.65,(p.y+bend)*0.075));
                float fine=noise(vec2(p.x*2.2,p.y*0.3));
                float bands=smoothstep(0.54,0.85,streak*0.72+fine*0.28);
                float ripple=pow(max(0.0,sin(p.x*0.28+noise(p*0.04)*6.0)),12.0)*0.12;
                contribution+=vec3(0.73,0.86,0.90)*(0.055+bands*0.48+ripple)*
                              region.g*surfaceFx.y*0.65;
            }
            if (surfaceFx.z>0.0 && region.b>0.01) {
                float angle=(flow.g*2.0-1.0)*PI;
                vec2 axis=vec2(cos(angle),sin(angle));
                vec2 advected=uv-axis*t*surfaceSpeed.y*0.0025;
                vec2 p=vec2(advected.y,-advected.x)*vec2(240,130);
                float warp=(noise(vec2(p.x*0.08,p.y*0.025))-0.5)*8.0;
                float stream=noise(vec2((p.x+warp)*0.18,p.y*0.018));
                float spray=noise(vec2(p.x*1.8,p.y*0.7));
                float strands=pow(max(0.0,sin(p.x*0.9+warp+p.y*0.08)),8.0);
                float foam=smoothstep(0.58,0.84,spray)*0.35;
                contribution+=vec3(0.83,0.94,0.97)*(0.16+stream*0.42+strands*0.52+foam)*
                              region.b*surfaceFx.z*0.45;
            }
            if (environmentFx.x>0.0 && masks.r>0.01 && ray.y>-0.17) {
                vec2 p=uv*vec2(9.0,5.0);
                float n=noise(p+vec2(t*0.009,0))*0.6+
                        noise(p*2.7+vec2(t*0.018,0))*0.4;
                float cloud=smoothstep(0.34,0.67,n)*0.58*masks.r*environmentFx.x;
                contribution+=vec3(0.78,0.82,0.85)*cloud*0.24;
            }
            if (environmentFx.y>0.0 && masks.r>0.01 && ray.y>-0.1) {
                vec2 cell=floor(uv*vec2(1500,750));
                float seed=hash(cell);
                float star=step(1.0-environmentFx.y*0.004,seed);
                float twinkle=0.52+0.30*sin(t*(1.1+fract(seed*77.0)*2.5)+seed*6.28)+
                              0.18*sin(t*4.7+seed*13.8);
                contribution+=vec3(0.73,0.83,1.0)*star*max(0.08,twinkle)*masks.r*0.64;
            }
            if (environmentFx.z>0.0 && masks.g>0.01) {
                vec3 sun=normalize(sunDirection);
                float dotSun=max(0.0,dot(ray,sun));
                float angle=atan(ray.y-sun.y,ray.z-sun.z);
                float stripes=pow(0.5+0.5*sin(angle*17.0+t*0.24),4.0);
                float shaft=pow(dotSun,6.0)*stripes*(0.84+0.16*sin(t*0.24));
                contribution+=vec3(1.0,0.88,0.65)*shaft*environmentFx.z*masks.g*0.21;
            }
            if (environmentFx.w>0.0) {
                for (int i=0;i<8;i++) {
                    if (float(i)>=lampCount) break;
                    vec3 dir=sunVector(lampAngles[i]);
                    float dotLamp=max(0.0,dot(ray,dir));
                    float halo=pow(dotLamp,75.0)*0.24;
                    float core=pow(dotLamp,900.0)*0.7;
                    contribution+=vec3(1.0,0.78,0.45)*(halo+core)*environmentFx.w;
                }
            }
            if (sourceFx.x>0.0 && sources.r>0.01 && ray.y<0.38) {
                vec2 grid=vec2(92,44);
                vec2 cell=floor(uv*grid);
                float spawn=step(0.72,hash(cell));
                float age=fract(t*(0.10+0.12*hash(cell+17.0))*surfaceSpeed.w+hash(cell+3.0));
                vec2 local=fract(uv*grid)-0.5;
                vec2 center=vec2(0.18*sin(t*0.45+hash(cell)*10.0),0.5-age);
                float radius=0.095+0.13*hash(cell+11.0);
                float d=length((local-center)*vec2(1,1.1));
                float ring=1.0-smoothstep(0.012,0.045,abs(d-radius));
                float core=(1.0-smoothstep(0.0,0.08,d))*0.24;
                contribution+=vec3(0.78,0.94,1.0)*spawn*(ring*0.72+core)*
                              (0.55+0.45*(1.0-age))*sourceFx.x*sources.r*0.45;
            }
            if (sourceFx.y>0.0 && sources.g>0.01 && ray.y<0.45) {
                vec2 p=uv*vec2(11,8);
                float drift=sin(p.y*1.8+t*0.22)*0.32;
                float n=noise(p*1.2+vec2(drift,-t*0.13))*0.6+
                        noise(p*3.3+vec2(-t*0.07,-t*0.31))*0.4;
                float body=smoothstep(0.32,0.67,n);
                float slow=noise(p*0.42+vec2(t*0.018,-t*0.05));
                contribution+=vec3(0.91,0.94,0.94)*body*(0.22+0.52*slow)*
                              sourceFx.y*sources.g*0.23;
            }
            if (sourceFx.z>0.0 && masks.b>0.01) {
                vec2 p=uv*vec2(100,45);
                p.x+=t*0.028;
                p.y+=sin(p.x*0.4+t*0.11)*0.09;
                vec2 id=floor(p),q=fract(p)-0.5;
                float seed=hash(id);
                float angle=seed*6.283+sin(t*0.19+seed*10.0)*0.3;
                vec2 r=vec2(cos(angle)*q.x-sin(angle)*q.y,sin(angle)*q.x+cos(angle)*q.y);
                float leaf=1.0-smoothstep(0.0,0.08,length(r*vec2(1.6,3.2))-0.22);
                contribution+=vec3(0.78,0.63,0.42)*step(0.93,seed)*leaf*
                              sourceFx.z*masks.b*0.36;
            }
            if (sourceFx.w>0.0) {
                float strike=mod(t,8.0+3.0*(1.0-sourceFx.w));
                float flash=(1.0-smoothstep(0.0,0.09,abs(strike-0.25))) * 0.24+
                            (1.0-smoothstep(0.0,0.12,abs(strike-0.44))) * 0.13;
                contribution+=vec3(0.76,0.86,1.0)*flash*sourceFx.w;
            }
            if (dot(contribution,contribution)<0.0000001) discard;
            gl_FragColor=vec4(clamp(contribution,0.0,1.0),1.0);
        }
    """.trimIndent()
}
