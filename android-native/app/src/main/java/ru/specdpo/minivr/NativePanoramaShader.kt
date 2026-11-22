package ru.specdpo.minivr

/** GLES 2.0 fragment program. Depth, tile layers and effects all run on the phone GPU. */
object NativePanoramaShader {
    /** Simple compatibility path if a phone cannot compile the advanced fragment program. */
    val fallback = """
        precision highp float;
        varying vec2 screenPoint;
        uniform sampler2D panorama;
        uniform float yaw;
        uniform float pitch;
        uniform float tangent;
        uniform float aspect;
        uniform float imageAspect;
        uniform int projection;
        uniform int sourceStereo;
        uniform int eye;
        uniform int mirrorImage;
        const float PI = 3.14159265358979323846;
        void main() {
            float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
            vec3 forward = vec3(cp * cy, sp, cp * sy);
            vec3 right = vec3(-sy, 0.0, cy);
            vec3 up = vec3(-sp * cy, cp, -sp * sy);
            vec3 ray = normalize(forward + right * screenPoint.x * tangent * aspect +
                                 up * screenPoint.y * tangent);
            float lon = atan(ray.z, ray.x);
            vec2 uv;
            if (projection == 0) uv = vec2(0.5 - lon / (2.0 * PI),
                0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
            else if (projection == 1) {
                if (abs(lon) > PI * 0.5) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
                uv = vec2(0.5 - lon / PI, 0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
            } else {
                if (ray.x <= 0.0) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
                uv = vec2(0.5 + ray.z / (ray.x * 1.5 * imageAspect),
                          0.5 - ray.y / (ray.x * 1.5));
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0,0.0,0.0,1.0); return;
                }
            }
            if (mirrorImage == 1) uv.x = 1.0 - uv.x;
            if (sourceStereo == 1) uv.x = uv.x * 0.5 + float(eye) * 0.5;
            if (sourceStereo == 2) uv.y = uv.y * 0.5 + float(eye) * 0.5;
            gl_FragColor = texture2D(panorama, uv);
        }
    """.trimIndent()

    val fragment = """
        precision highp float;
        varying vec2 screenPoint;
        uniform sampler2D panorama;
        uniform sampler2D depthMap;
        uniform sampler2D highAtlas;
        uniform sampler2D waterMask;
        uniform sampler2D foliageMask;
        uniform float yaw;
        uniform float pitch;
        uniform float tangent;
        uniform float aspect;
        uniform float imageAspect;
        uniform float clockTime;
        uniform vec2 parallaxOffset;
        uniform vec3 depthParams;
        uniform vec4 atlasCoords;
        uniform vec4 waterParams;
        uniform vec2 waterCenter;
        uniform vec2 foliageParams;
        uniform vec4 particleParams;
        uniform vec4 atmosphereParams;
        uniform vec3 sunParams;
        uniform vec3 moonParams;
        uniform vec2 skyParams;
        uniform int projection;
        uniform int sourceStereo;
        uniform int eye;
        uniform int mirrorImage;
        uniform int hasDepth;
        uniform int hasAtlas;
        uniform int hasWaterMask;
        uniform int hasFoliageMask;
        uniform int particleKind;
        const float PI = 3.14159265358979323846;

        vec2 sphereUv(vec3 dir) {
            return vec2(0.5 - atan(dir.z, dir.x) / (2.0 * PI),
                        0.5 - asin(clamp(dir.y, -1.0, 1.0)) / PI);
        }
        vec3 sphericalDirection(vec2 angles) {
            float cy = cos(angles.x), sy = sin(angles.x);
            float cp = cos(angles.y), sp = sin(angles.y);
            // The site's authored longitude increases towards -Z.
            return vec3(cp * cy, sp, -cp * sy);
        }
        float random2(vec2 v) {
            return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise2(vec2 p) {
            vec2 i=floor(p),f=fract(p);
            f=f*f*(3.0-2.0*f);
            return mix(mix(random2(i),random2(i+vec2(1,0)),f.x),
                       mix(random2(i+vec2(0,1)),random2(i+vec2(1,1)),f.x),f.y);
        }
        vec4 panoramaPixel(vec2 uv) {
            float sourceU = projection == 0 ? fract(uv.x + 2.0) : clamp(uv.x, 0.0, 1.0);
            vec2 sampleUv = vec2(sourceU, clamp(uv.y, 0.00001, 0.99999));
            if (sourceStereo == 1) sampleUv.x = sampleUv.x * 0.5 + float(eye) * 0.5;
            if (sourceStereo == 2) sampleUv.y = sampleUv.y * 0.5 + float(eye) * 0.5;
            vec4 color = texture2D(panorama, sampleUv);
            if (hasAtlas == 1 && projection == 0 && sourceStereo == 0) {
                // Horizontal tile coordinates are allowed to cross the 360° seam.
                float du = mod(sampleUv.x - atlasCoords.x + 2.0, 1.0);
                vec2 tileUv = vec2(du * atlasCoords.z,
                                   (sampleUv.y - atlasCoords.y) * atlasCoords.w);
                if (tileUv.x > 0.0001 && tileUv.x < 0.9999 &&
                    tileUv.y > 0.0001 && tileUv.y < 0.9999) {
                    vec4 sharp = texture2D(highAtlas, tileUv);
                    color.rgb = mix(color.rgb, sharp.rgb, sharp.a);
                }
            }
            return color;
        }

        void main() {
            float cy = cos(yaw), sy = sin(yaw);
            float cp = cos(pitch), sp = sin(pitch);
            vec3 forward = vec3(cp * cy, sp, cp * sy);
            vec3 right = vec3(-sy, 0.0, cy);
            vec3 up = vec3(-sp * cy, cp, -sp * sy);
            vec3 ray = normalize(forward + right * screenPoint.x * tangent * aspect +
                                 up * screenPoint.y * tangent);
            vec2 uv;
            if (projection == 0) {
                vec3 radial = ray;
                if (hasDepth == 1 && dot(parallaxOffset, parallaxOffset) > 0.000001) {
                    vec3 cameraOffset = right * parallaxOffset.x + up * parallaxOffset.y;
                    for (int i = 0; i < 3; i++) {
                        vec2 depthUv = sphereUv(radial);
                        vec2 wrapped = vec2(fract(depthUv.x + 2.0), clamp(depthUv.y, 0.0, 1.0));
                        float d = texture2D(depthMap, wrapped).r;
                        if (i == 0) {
                            // Edge-preserving filter: smooth map noise, never mix a tree
                            // silhouette with the distant sky across a depth jump.
                            vec2 texel = depthParams.yz;
                            float leftD = texture2D(depthMap, vec2(fract(wrapped.x - texel.x + 1.0), wrapped.y)).r;
                            float rightD = texture2D(depthMap, vec2(fract(wrapped.x + texel.x), wrapped.y)).r;
                            float upperD = texture2D(depthMap, vec2(wrapped.x, max(0.0, wrapped.y - texel.y))).r;
                            float lowerD = texture2D(depthMap, vec2(wrapped.x, min(1.0, wrapped.y + texel.y))).r;
                            float sum = d * 4.0;
                            float weights = 4.0;
                            float diff = abs(leftD - d);
                            if (diff < 0.115) { sum += leftD * (1.0 - diff * 6.0); weights += 1.0 - diff * 6.0; }
                            diff = abs(rightD - d);
                            if (diff < 0.115) { sum += rightD * (1.0 - diff * 6.0); weights += 1.0 - diff * 6.0; }
                            diff = abs(upperD - d);
                            if (diff < 0.115) { sum += upperD * (1.0 - diff * 6.0); weights += 1.0 - diff * 6.0; }
                            diff = abs(lowerD - d);
                            if (diff < 0.115) { sum += lowerD * (1.0 - diff * 6.0); weights += 1.0 - diff * 6.0; }
                            d = sum / weights;
                        }
                        float polarFade = clamp(sin(PI * wrapped.y) * 8.0, 0.0, 1.0);
                        d = mix(0.5, d, polarFade);
                        d = mix(d, pow(d, 2.2), depthParams.x);
                        // MiniVR depth convention: 0 is far, 1 is near.
                        float distance = 1.0 / (1.0 / 58.0 + (1.0 / 8.0 - 1.0 / 58.0) * d);
                        float projectionLength = dot(cameraOffset, ray);
                        float disc = max(0.01, projectionLength * projectionLength +
                                                 distance * distance - dot(cameraOffset, cameraOffset));
                        float hit = -projectionLength + sqrt(disc);
                        radial = normalize(cameraOffset + ray * hit);
                    }
                }
                uv = sphereUv(radial);
            } else if (projection == 1) {
                float longitude = atan(ray.z, ray.x);
                if (abs(longitude) > PI * 0.5) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
                }
                uv = vec2(0.5 - longitude / PI,
                          0.5 - asin(clamp(ray.y, -1.0, 1.0)) / PI);
            } else {
                if (ray.x <= 0.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
                }
                float hh = 0.75;
                uv = vec2(0.5 + ray.z / (ray.x * 2.0 * hh * imageAspect),
                          0.5 - ray.y / (ray.x * 2.0 * hh));
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return;
                }
            }
            if (mirrorImage == 1) uv.x = 1.0 - uv.x;

            // Hand-painted water and foliage masks use the original image UVs.
            if (projection == 0 && sourceStereo == 0) {
                float water = 0.0;
                if (waterParams.x > 0.0) {
                    if (hasWaterMask == 1) water = texture2D(waterMask, uv).a;
                    else {
                        vec3 waterDir = sphericalDirection(waterCenter);
                        float angle = acos(clamp(dot(ray, waterDir), -1.0, 1.0));
                        water = 1.0 - smoothstep(waterParams.w * 0.4, waterParams.w, angle);
                    }
                    float wave = sin(uv.x * 106.0 + clockTime * waterParams.y * 2.1) *
                                 cos(uv.y * 67.0 - clockTime * waterParams.y * 1.4);
                    uv += vec2(wave, sin(uv.y * 95.0 + clockTime * waterParams.y * 1.9)) *
                          (0.0018 * waterParams.x * water);
                }
                if (hasFoliageMask == 1 && foliageParams.x > 0.0) {
                    float foliage = texture2D(foliageMask, uv).a;
                    uv.x += foliage * foliageParams.x * 0.0013 *
                            sin(clockTime * foliageParams.y * 1.5 + uv.y * 49.0);
                }
            }

            vec3 color = panoramaPixel(uv).rgb;
            if (projection == 0) {
                float fog = atmosphereParams.x;
                if (fog > 0.0) {
                    // Site fog banks: slow noise near the horizon, not a flat grey band.
                    float latitude = asin(clamp(ray.y,-1.0,1.0));
                    float heightOffset = atmosphereParams.z * 0.018;
                    float low = 1.0-smoothstep(-0.19+heightOffset,0.32+heightOffset,latitude);
                    float ground = smoothstep(-1.3,-0.30+heightOffset,latitude);
                    vec2 drift = vec2(atan(ray.z,ray.x)*1.7+clockTime*0.012,
                                      ray.y*5.2+clockTime*0.008);
                    float n=noise2(drift)*0.55+noise2(drift*2.15+8.3)*0.30+
                            noise2(drift*4.2+16.7)*0.15;
                    float banks=smoothstep(0.20,0.79,n);
                    float alpha=fog*(0.075+0.34*banks)*low*ground;
                    color=mix(color,vec3(0.78,0.84,0.87),clamp(alpha,0.0,0.52));
                }
                if (sunParams.x > 0.0) {
                    vec3 sunDir = sphericalDirection(sunParams.yz);
                    float glow = pow(max(0.0, dot(ray, sunDir)), 20.0);
                    float rays = pow(max(0.0, dot(ray, sunDir)), 5.0) *
                                 (0.83 + 0.17 * sin(atan(ray.y - sunDir.y, ray.z - sunDir.z) * 19.0));
                    color += vec3(1.0, 0.71, 0.37) * sunParams.x * (glow * 0.22 + rays * 0.1);
                }
                if (moonParams.x > 0.0) {
                    vec3 moonDir = sphericalDirection(moonParams.yz);
                    float d = max(0.0, dot(ray, moonDir));
                    float disk = smoothstep(0.99935, 0.99975, d);
                    float halo = pow(d, 130.0) * 0.1;
                    color += vec3(0.65, 0.8, 1.0) * moonParams.x * (disk * 0.7 + halo);
                }
                if (skyParams.x > 0.0 && ray.y > 0.04) {
                    float cloud = sin(uv.x * 31.0 + clockTime * 0.016) *
                                  sin(uv.y * 26.0 + clockTime * 0.006);
                    color = mix(color, vec3(0.91, 0.94, 0.96),
                                max(0.0, cloud) * skyParams.x * 0.08);
                }
                if (skyParams.y > 0.0 && ray.y > 0.05) {
                    vec2 starCell = floor(uv * vec2(1100.0, 550.0));
                    float star = step(1.0 - skyParams.y * 0.003, random2(starCell));
                    color += vec3(0.5, 0.62, 0.84) * star * 0.45;
                }
            }
            if (atmosphereParams.y > 0.0) {
                color *= 1.0 - atmosphereParams.y * 0.16;
            }
            if (particleKind > 0 && particleParams.x > 0.0) {
                float cells = particleKind == 1 ? 46.0 : 31.0;
                vec2 flow = vec2(particleParams.z * 0.12, -particleParams.y *
                                 (particleKind == 7 ? -0.25 : 0.55)) * clockTime;
                vec2 grid = (screenPoint * vec2(aspect, 1.0) + flow) * cells;
                vec2 cell = floor(grid);
                vec2 local = fract(grid) - vec2(0.5);
                vec2 center = vec2(random2(cell) - 0.5, random2(cell + 7.3) - 0.5) * 0.7;
                float dotDistance = length((local - center) *
                    vec2(1.0, particleKind == 1 ? 0.21 : 1.0));
                float threshold = 1.0 - particleParams.x * 0.14;
                float exists = step(threshold, random2(cell + 14.8));
                float size = particleKind == 1 ? 0.16 : 0.11;
                float strength = exists * (1.0 - smoothstep(size * 0.27, size, dotDistance)) * 0.65;
                vec3 tint = particleKind == 3 ? vec3(0.75, 0.55, 0.25) :
                            particleKind == 4 ? vec3(0.65, 0.85, 0.45) :
                            particleKind == 7 ? vec3(0.5, 0.9, 1.0) : vec3(0.85, 0.93, 1.0);
                color = mix(color, tint, strength);
            }
            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    """.trimIndent()
}
