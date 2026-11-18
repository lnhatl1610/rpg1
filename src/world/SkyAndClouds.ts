import * as THREE from 'three';
import { createSparkleTexture } from '../utils/noise';

export interface SkyLightingState {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  ambientSkyColor: THREE.Color;
  ambientGroundColor: THREE.Color;
  ambientIntensity: number;
  fogColor: THREE.Color;
  cloudLitColor: THREE.Color;
  cloudShadowColor: THREE.Color;
  rimColor: THREE.Color;
  nightFactor: number;
  sunsetFactor: number;
}

export class SkyAndClouds {
  public group = new THREE.Group();
  public lighting: SkyLightingState;

  private skyMesh: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;

  private flyClouds: THREE.Mesh;
  private flyPosAttr: THREE.InstancedBufferAttribute;
  private wispCloudMat: THREE.ShaderMaterial;

  private skySparkles: THREE.Points;
  private skySparkleMat: THREE.ShaderMaterial;

  private flyCloudData: Array<{
    basePos: THREE.Vector3;
    scaleX: number;
    scaleY: number;
    driftSpeed: number;
    phase: number;
    seed: number;
  }> = [];

  constructor(noiseTex: THREE.DataTexture) {
    this.lighting = {
      sunDirection: new THREE.Vector3(0.45, 0.65, -0.6).normalize(),
      sunColor: new THREE.Color('#fff9ec'),
      sunIntensity: 2.3,
      ambientSkyColor: new THREE.Color('#8ec8ff'),
      ambientGroundColor: new THREE.Color('#5fb878'),
      ambientIntensity: 1.05,
      fogColor: new THREE.Color('#d8f6ff'),
      cloudLitColor: new THREE.Color('#ffffff'),
      cloudShadowColor: new THREE.Color('#8eb4eb'),
      rimColor: new THREE.Color('#fff4d4'),
      nightFactor: 0,
      sunsetFactor: 0,
    };

    const sparkleTex = createSparkleTexture(128);

    // 1. Sky Dome + True 3D Volumetric Raymarched Sparse Realistic Clouds!
    const skyGeo = new THREE.SphereGeometry(1950, 64, 48);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCameraWorld: { value: new THREE.Vector3() },
        uSunDir: { value: this.lighting.sunDirection.clone() },
        uZenithColor: { value: new THREE.Color('#0c47ba') },
        uUpperMidColor: { value: new THREE.Color('#2a94f7') },
        uLowerMidColor: { value: new THREE.Color('#78dcff') },
        uHorizonColor: { value: new THREE.Color('#e3faff') },
        uSunGlowColor: { value: new THREE.Color('#ffe9b8') },
        uCloudSunColor: { value: new THREE.Color('#ffffff') },
        uCloudAmbientColor: { value: new THREE.Color('#8eb5eb') },
        uNightFactor: { value: 0.0 },
        uSunsetFactor: { value: 0.0 },
        uNoiseTex: { value: noiseTex },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCameraWorld;
        uniform vec3 uSunDir;
        uniform vec3 uZenithColor;
        uniform vec3 uUpperMidColor;
        uniform vec3 uLowerMidColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunGlowColor;
        uniform vec3 uCloudSunColor;
        uniform vec3 uCloudAmbientColor;
        uniform float uNightFactor;
        uniform float uSunsetFactor;
        uniform sampler2D uNoiseTex;
        varying vec3 vWorldDir;

        float hash31(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        // Smooth 3D noise interpolated across Y slices of our seamless 2D noise texture
        float noise3D(vec3 p) {
          float yi = floor(p.y);
          float yf = fract(p.y);
          yf = yf * yf * (3.0 - 2.0 * yf);
          vec2 uv0 = p.xz * 0.0625 + yi * vec2(0.3183, 0.7548);
          vec2 uv1 = p.xz * 0.0625 + (yi + 1.0) * vec2(0.3183, 0.7548);
          float a = texture2D(uNoiseTex, uv0).r;
          float b = texture2D(uNoiseTex, uv1).r;
          return mix(a, b, yf);
        }

        // Sparse, natural, realistic 3D cumulus cloud density field
        float sampleCloudDensity(vec3 pos) {
          const float bottomY = 440.0;
          const float topY = 860.0;
          float hFrac = (pos.y - bottomY) / (topY - bottomY);
          if (hFrac <= 0.0 || hFrac >= 1.0) return 0.0;

          // Natural cumulus vertical profile: flat-soft condensation base, rounded fluffy anvil top
          float heightProfile = smoothstep(0.0, 0.16, hFrac) * smoothstep(1.0, 0.42, hFrac);

          // Wind drift + subtle vertical wind shear for realistic feathery wisps
          vec3 wind = vec3(uTime * 11.0, 0.0, uTime * 4.5);
          vec3 q = (pos + wind + vec3(hFrac * 55.0, 0.0, 0.0)) * 0.0028;

          // Macro weather map -> keeps clouds SPARSE (~72% open clear sky!)
          float macro = texture2D(uNoiseTex, q.xz * 0.14 + vec2(0.13, 0.37)).r;
          float macro2 = texture2D(uNoiseTex, q.xz * 0.31 - vec2(uTime * 0.0008, 0.0)).g;
          float weather = macro * 0.65 + macro2 * 0.35;

          // High threshold = sparse scattered cloud islands instead of overcast wall!
          float coverage = smoothstep(0.54, 0.80, weather);
          if (coverage <= 0.002) return 0.0;

          // Multi-octave 3D billowing vapor detail
          float n1 = noise3D(q * 3.2);
          float n2 = noise3D(q * 7.4 + 4.1);
          float n3 = noise3D(q * 16.5 - 2.3);
          float fbm = n1 * 0.56 + n2 * 0.30 + n3 * 0.14;

          // Erode outer edges softly with billowing vapor wisps
          float raw = coverage * heightProfile - (1.0 - fbm) * 0.44;
          return clamp(raw * 1.65, 0.0, 1.0);
        }

        // Dual-lobe Henyey-Greenstein phase function for realistic silver-lining & soft glow
        float hgPhase(float cosTheta, float g) {
          float g2 = g * g;
          float denom = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-3);
          return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, -0.15, 1.0);
          float upH = clamp(dir.y, 0.0, 1.0);

          // 1. Clear Atmospheric Sky Gradient
          vec3 skyCol = mix(uHorizonColor, uLowerMidColor, smoothstep(0.0, 0.16, upH));
          skyCol = mix(skyCol, uUpperMidColor, smoothstep(0.14, 0.48, upH));
          skyCol = mix(skyCol, uZenithColor, smoothstep(0.42, 0.92, upH));

          vec3 sDir = normalize(uSunDir);
          float sunDot = dot(dir, sDir);
          float sunVis = smoothstep(-0.08, 0.06, sDir.y);

          // Warm Mie scattering near sun horizon
          float horizBand = (1.0 - smoothstep(0.0, 0.42, upH)) * smoothstep(-0.1, 0.02, h);
          float sunAzimuthGlow = pow(clamp(sunDot * 0.5 + 0.5, 1e-5, 1.0), 3.0);
          skyCol += uSunGlowColor * horizBand * sunAzimuthGlow * 0.25 * sunVis;

          if (h < 0.0) {
            skyCol = mix(uHorizonColor, uHorizonColor * 0.86, clamp(-h * 4.0, 0.0, 1.0));
          }

          // Delicate high-altitude wispy cirrus streaks (very subtle & airy)
          if (upH > 0.08) {
            vec2 cirUv = dir.xz / (upH + 0.22) * 0.09;
            float warp = texture2D(uNoiseTex, cirUv * 0.7 + vec2(uTime * 0.0012, 0.0)).r;
            vec2 sUv = vec2(cirUv.x * 1.8 + warp * 0.28 + uTime * 0.002, cirUv.y * 0.5 - warp * 0.15);
            float cVal = texture2D(uNoiseTex, sUv).g * 0.7 + texture2D(uNoiseTex, sUv * 2.4).b * 0.3;
            float cirrus = smoothstep(0.64, 0.90, cVal) * smoothstep(0.08, 0.30, upH) * (1.0 - smoothstep(0.75, 0.98, upH));
            vec3 cirrusCol = mix(vec3(1.03, 1.04, 1.06), uSunGlowColor * 1.12, uSunsetFactor * 0.7);
            cirrusCol = mix(cirrusCol, vec3(0.28, 0.44, 0.78), uNightFactor * 0.85);
            skyCol = mix(skyCol, cirrusCol, cirrus * 0.24);
          }

          // Night Stars, Milky Way, Celestial Aurora & Moon!
          if (uNightFactor > 0.01) {
            float bandCoord = abs(dot(dir, normalize(vec3(0.55, 0.48, -0.68))));
            vec2 mwUv = dir.xz * 0.42 + vec2(dir.y * 0.28);
            float mw1 = texture2D(uNoiseTex, mwUv * 1.5).r;
            float mw2 = texture2D(uNoiseTex, mwUv * 3.8 + 0.3).g;
            float mwNoise = mw1 * 0.62 + mw2 * 0.38;
            float milkyWay = smoothstep(0.42, 0.0, bandCoord) * smoothstep(0.30, 0.82, mwNoise) * smoothstep(0.02, 0.26, upH);

            skyCol += vec3(0.22, 0.48, 0.98) * milkyWay * uNightFactor * 0.95;
            skyCol += vec3(0.56, 0.34, 0.88) * milkyWay * mw2 * uNightFactor * 0.58;

            // Ethereal swaying Celestial Aurora Borealis curtains over northern horizon!
            if (upH > 0.04 && upH < 0.68 && dir.z < 0.35) {
              vec2 aurUv = vec2(dir.x * 0.85 + dir.z * 0.35, upH * 2.2);
              float curtainWave = sin(aurUv.x * 5.2 + uTime * 0.28 + mw1 * 3.2) * 0.5 + 0.5;
              float curtainDetail = texture2D(uNoiseTex, vec2(aurUv.x * 1.8 - uTime * 0.012, upH * 0.35)).g;
              float vertBand = smoothstep(0.05, 0.20, upH) * (1.0 - smoothstep(0.24, 0.62, upH));
              float northMask = smoothstep(0.35, -0.35, dir.z);
              float aurora = smoothstep(0.42, 0.88, curtainWave * 0.6 + curtainDetail * 0.4) * vertBand * northMask;
              vec3 aurCol = mix(vec3(0.18, 0.98, 0.72), vec3(0.56, 0.36, 1.05), smoothstep(0.16, 0.48, upH));
              skyCol += aurCol * aurora * uNightFactor * 0.52;
            }

            // Crisp multi-scale twinkling stars
            for (int layer = 0; layer < 2; layer++) {
              float grid = layer == 0 ? 300.0 : 140.0;
              float thresh = layer == 0 ? 0.987 : 0.9945;
              vec3 starCell = floor(dir * grid + float(layer) * 19.3);
              float starRand = hash31(starCell);
              if (starRand > thresh && upH > 0.02) {
                vec3 cellCenter = normalize(starCell + 0.5);
                float d = length(dir - cellCenter) * grid;
                float twinkle = 0.58 + 0.42 * sin(uTime * (2.2 + starRand * 6.5) + starRand * 90.0);
                float radius = layer == 0 ? 0.42 : 0.50;
                float starBright = smoothstep(radius, 0.03, d) * twinkle * smoothstep(0.02, 0.16, upH);
                vec3 starTint = mix(vec3(0.80, 0.95, 1.40), vec3(1.40, 1.15, 0.86), fract(starRand * 41.0));
                skyCol += starTint * starBright * uNightFactor * (layer == 0 ? 1.55 : 2.35);
              }
            }

            // Luminous Anime Moon + Silver Corona
            vec3 moonDir = normalize(vec3(-sDir.x, abs(sDir.y) * 0.62 + 0.34, -sDir.z));
            float moonDot = dot(dir, moonDir);
            float moonWide = pow(clamp(moonDot, 1e-5, 1.0), 8.0) * 0.16;
            float moonHalo = pow(clamp(moonDot, 1e-5, 1.0), 36.0) * 0.58;
            float moonDisc = smoothstep(0.9986, 0.9993, moonDot) * 2.1;
            skyCol += vec3(0.45, 0.68, 1.10) * moonWide * uNightFactor;
            skyCol += vec3(0.72, 0.90, 1.28) * moonHalo * uNightFactor;
            skyCol += vec3(1.38, 1.44, 1.58) * moonDisc * uNightFactor;

            // Shooting Stars streaking across the night sky
            float shootCycle = floor(uTime * 0.26);
            float shootFrac = fract(uTime * 0.26);
            if (shootFrac < 0.26) {
              float t = shootFrac / 0.26;
              float seed = fract(sin(shootCycle * 91.7) * 43758.5);
              vec3 startDir = normalize(vec3(sin(seed * 6.28), 0.52 + seed * 0.28, cos(seed * 6.28)));
              vec3 endDir = normalize(startDir + vec3(0.32, -0.20, 0.24));
              vec3 head = normalize(mix(startDir, endDir, t));
              float trail = smoothstep(0.02, 0.0, length(dir - head)) * sin(t * 3.14159);
              skyCol += vec3(1.2, 1.45, 1.8) * trail * uNightFactor * 2.2;
            }
          }

          // Sun Disc & Soft Corona (drawn before volumetric clouds so clouds drift realistically in front of sun!)
          if (sunVis > 0.001) {
            float wideBloom = pow(clamp(sunDot, 1e-5, 1.0), 5.0) * 0.30;
            float midCorona = pow(clamp(sunDot, 1e-5, 1.0), 28.0) * 0.62;
            float crispDisc = smoothstep(0.9990, 0.9996, sunDot) * 2.5;

            vec3 tangent = normalize(cross(sDir, vec3(0.0, 1.0, 0.01)));
            vec3 bitangent = cross(sDir, tangent);
            float bx = dot(dir, bitangent);
            float tx = dot(dir, tangent);
            float rayAngle = (abs(bx) + abs(tx) > 1e-4) ? atan(bx, tx) : 0.0;
            float rayWave = sin(rayAngle * 9.0 + uTime * 0.22) * 0.5 + 0.5;
            rayWave *= sin(rayAngle * 15.0 - uTime * 0.15) * 0.5 + 0.5;
            float godRays = pow(clamp(sunDot, 1e-5, 1.0), 10.0) * smoothstep(0.3, 0.85, rayWave) * 0.34;

            skyCol += uSunGlowColor * (wideBloom + midCorona + godRays) * sunVis;
            skyCol += vec3(1.6, 1.52, 1.35) * crispDisc * sunVis;
          }

          // 2. True 3D Volumetric Raymarched Cumulus Clouds (Realistic, Soft, Sparse & Airy!)
          if (dir.y > 0.018) {
            // Gently curved earth-shell intersection so distant horizon clouds stay realistic
            float effY = max(dir.y, 0.055);
            float camY = clamp(uCameraWorld.y, 0.0, 350.0);
            float tStart = (440.0 - camY) / effY;
            float tEnd   = (860.0 - camY) / effY;

            // Clamp maximum march distance for crisp horizon fade
            if (tStart < 9500.0) {
              const int STEPS = 14;
              float dt = (tEnd - tStart) / float(STEPS);

              // Dither start slightly by ray hash to eliminate any banding
              float jitter = hash31(dir * 512.0) * 0.85;
              float t = tStart + dt * jitter;

              vec3 activeLightDir = uNightFactor > 0.6
                ? normalize(vec3(-sDir.x, abs(sDir.y) * 0.62 + 0.34, -sDir.z))
                : sDir;
              float cosAngle = dot(dir, activeLightDir);
              float phase = mix(hgPhase(cosAngle, 0.58), hgPhase(cosAngle, -0.22), 0.32) * 2.1 + 0.45;

              float transmittance = 1.0;
              vec3 accumCloud = vec3(0.0);

              for (int i = 0; i < STEPS; i++) {
                if (transmittance < 0.03) break;
                vec3 samplePos = vec3(uCameraWorld.x, camY, uCameraWorld.z) + dir * t;
                // Restore exact slab Y for spherical horizon feel
                samplePos.y = camY + effY * t;

                float dens = sampleCloudDensity(samplePos);
                if (dens > 0.003) {
                  // 2-step volumetric sun-shadow march inside the cloud
                  float sunShadowDens =
                    sampleCloudDensity(samplePos + activeLightDir * 55.0) +
                    sampleCloudDensity(samplePos + activeLightDir * 135.0) * 0.85;

                  float sunTrans = exp(-sunShadowDens * 1.45);
                  // Beer-Powder soft cotton rim glow
                  float powder = 1.0 - exp(-dens * 3.8);
                  float lightEnergy = sunTrans * mix(1.0, powder * 1.85, 0.45) * phase;

                  float hNorm = clamp((samplePos.y - 440.0) / 420.0, 0.0, 1.0);
                  vec3 ambient = uCloudAmbientColor * mix(0.72, 1.08, hNorm);
                  vec3 direct = uCloudSunColor * lightEnergy * 1.15;

                  vec3 stepCol = ambient + direct;

                  // Physically based Beer-Lambert step integration
                  float sigma = dens * 0.011 * dt;
                  float stepTrans = exp(-sigma);
                  accumCloud += transmittance * (1.0 - stepTrans) * stepCol;
                  transmittance *= stepTrans;
                }
                t += dt;
              }

              float cloudAlpha = 1.0 - transmittance;
              if (cloudAlpha > 0.002) {
                // Blend distant clouds seamlessly into atmospheric horizon mist
                float horizonFade = smoothstep(0.018, 0.14, dir.y) * exp(-tStart * 0.00014);
                vec3 finalCloudCol = accumCloud / max(cloudAlpha, 1e-4);
                finalCloudCol = mix(skyCol, finalCloudCol, horizonFade);
                skyCol = mix(skyCol, finalCloudCol, cloudAlpha * horizonFade);
              }
            }
          }

          // Subtle daytime sky sparkle glints
          if (uNightFactor < 0.7 && upH > 0.14) {
            vec3 glintCell = floor(dir * 170.0);
            float gRand = hash31(glintCell + 11.0);
            if (gRand > 0.9965) {
              float pulse = pow(clamp(sin(uTime * 1.8 + gRand * 50.0), 1e-5, 1.0), 5.0);
              skyCol += vec3(0.70, 0.90, 1.20) * pulse * (1.0 - uNightFactor) * 0.55;
            }
          }

          gl_FragColor = vec4(skyCol, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.group.add(this.skyMesh);

    // 2. Sparse, Delicate Translucent Mist Wisps near Sky Islands (ONLY 28 airy wisps!)
    this.wispCloudMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uNoiseTex: { value: noiseTex },
        uTime: { value: 0 },
        uLitColor: { value: new THREE.Color('#ffffff') },
        uShadowColor: { value: new THREE.Color('#a8c8f7') },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aCloudPosSeed;
        attribute vec2 aCloudScale;
        varying vec2 vUv;
        varying float vViewDist;
        varying float vSeed;

        void main() {
          vUv = uv;
          vSeed = aCloudPosSeed.w;

          vec3 center = aCloudPosSeed.xyz;
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          vec3 worldPos = center
            + camRight * position.x * aCloudScale.x
            + camUp * position.y * aCloudScale.y;

          vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
          vViewDist = -mvPos.z;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoiseTex;
        uniform float uTime;
        uniform vec3 uLitColor;
        uniform vec3 uShadowColor;

        varying vec2 vUv;
        varying float vViewDist;
        varying float vSeed;

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          // Soft elliptical Gaussian mist envelope — zero hard edges!
          float radial = exp(-dot(p * vec2(1.0, 1.45), p * vec2(1.0, 1.45)) * 2.6);
          vec2 seedUv = vec2(vSeed * 1.7, vSeed * 3.1);
          float n1 = texture2D(uNoiseTex, vUv * 0.85 + seedUv + vec2(uTime * 0.004, 0.0)).r;
          float n2 = texture2D(uNoiseTex, vUv * 2.1 - seedUv).g;
          float vapor = radial * smoothstep(0.24, 0.82, n1 * 0.65 + n2 * 0.35);

          float nearFade = smoothstep(3.0, 22.0, vViewDist);
          float farFade = 1.0 - smoothstep(220.0, 420.0, vViewDist);
          float alpha = vapor * nearFade * farFade * 0.38;
          if (alpha < 0.004) discard;

          vec3 col = mix(uShadowColor, uLitColor, clamp(vUv.y * 0.75 + n1 * 0.35, 0.0, 1.0));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    const flyCount = 28;
    const baseQuad = new THREE.PlaneGeometry(1, 1);
    const fInstGeo = new THREE.InstancedBufferGeometry();
    fInstGeo.index = baseQuad.index;
    fInstGeo.attributes.position = baseQuad.attributes.position;
    fInstGeo.attributes.uv = baseQuad.attributes.uv;

    const fPosSeed = new Float32Array(flyCount * 4);
    const fScale = new Float32Array(flyCount * 2);

    for (let i = 0; i < flyCount; i++) {
      const r = 45 + Math.sqrt((i + 0.5) / flyCount) * 230;
      const theta = i * 2.39996;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r - 25;
      const y = 78 + (i % 5) * 11.5;
      const sx = 46 + (i % 4) * 16;
      const sy = sx * 0.42;
      const seed = (i * 0.6180339) % 10.0;

      this.flyCloudData.push({
        basePos: new THREE.Vector3(x, y, z),
        scaleX: sx,
        scaleY: sy,
        driftSpeed: 1.1 + (i % 3) * 0.35,
        phase: i * 0.9,
        seed,
      });

      fPosSeed[i * 4 + 3] = seed;
      fScale[i * 2] = sx;
      fScale[i * 2 + 1] = sy;
    }

    this.flyPosAttr = new THREE.InstancedBufferAttribute(fPosSeed, 4);
    this.flyPosAttr.setUsage(THREE.DynamicDrawUsage);
    fInstGeo.setAttribute('aCloudPosSeed', this.flyPosAttr);
    fInstGeo.setAttribute('aCloudScale', new THREE.InstancedBufferAttribute(fScale, 2));
    fInstGeo.instanceCount = flyCount;

    this.flyClouds = new THREE.Mesh(fInstGeo, this.wispCloudMat);
    this.flyClouds.frustumCulled = false;
    this.group.add(this.flyClouds);

    // 3. Sparkling Sky Motes & Meadow Sunlight Pollen
    const moteCount = 850;
    const moteGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(moteCount * 3);
    const scales = new Float32Array(moteCount);
    const phases = new Float32Array(moteCount);

    for (let i = 0; i < moteCount; i++) {
      const isSkyMote = i >= 450;
      const radius = isSkyMote ? 180 : 90;
      positions[i * 3] = (Math.random() - 0.5) * radius * 2;
      positions[i * 3 + 1] = isSkyMote
        ? 32 + Math.random() * 115
        : 0.7 + Math.random() * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * radius * 2;
      scales[i] = isSkyMote ? 1.3 + Math.random() * 2.1 : 0.55 + Math.random() * 1.05;
      phases[i] = Math.random() * Math.PI * 2;
    }

    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    moteGeo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.skySparkleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uTex: { value: sparkleTex },
        uFocusPos: { value: new THREE.Vector3() },
        uColorA: { value: new THREE.Color('#fff9d2') },
        uColorB: { value: new THREE.Color('#8cf0ff') },
      },
      vertexShader: /* glsl */ `
        attribute float aScale;
        attribute float aPhase;
        uniform float uTime;
        uniform vec3 uFocusPos;
        varying float vAlpha;
        varying float vMix;

        void main() {
          vec3 p = position;
          float range = p.y > 28.0 ? 180.0 : 90.0;
          p.x = uFocusPos.x + mod(p.x - uFocusPos.x + range, range * 2.0) - range;
          p.z = uFocusPos.z + mod(p.z - uFocusPos.z + range, range * 2.0) - range;
          p.y += sin(uTime * 0.9 + aPhase) * 0.85;
          p.x += cos(uTime * 0.55 + aPhase * 1.3) * 0.65;

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          float dist = -mvPos.z;

          float twinkle = 0.35 + 0.65 * pow(clamp(0.5 + 0.5 * sin(uTime * 2.6 + aPhase * 3.0), 1e-5, 1.0), 2.0);
          float distFade = 1.0 - smoothstep(range * 0.55, range, dist);
          vAlpha = twinkle * distFade * smoothstep(1.2, 5.0, dist);
          vMix = fract(aPhase * 1.7);

          gl_PointSize = clamp((aScale * 155.0) / max(dist, 1.0), 2.0, 30.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying float vAlpha;
        varying float vMix;

        void main() {
          vec4 sp = texture2D(uTex, gl_PointCoord);
          if (sp.a * vAlpha < 0.01) discard;
          vec3 c = mix(uColorA, uColorB, vMix) * 1.32;
          gl_FragColor = vec4(c * sp.rgb, sp.a * vAlpha);
        }
      `,
    });

    this.skySparkles = new THREE.Points(moteGeo, this.skySparkleMat);
    this.skySparkles.frustumCulled = false;
    this.group.add(this.skySparkles);

    this.applyTimeOfDay(10.0);
  }

  public applyTimeOfDay(hour: number): void {
    const h = ((hour % 24) + 24) % 24;
    const sunAngle = ((h - 6.0) / 24.0) * Math.PI * 2;
    const elev = Math.sin(sunAngle);
    const azim = Math.cos(sunAngle);

    this.lighting.sunDirection.set(azim * 0.80, elev, -0.50).normalize();

    // 8 Distinct Hand-Crafted Anime Atmospheric Sessions across 24 Hours!
    interface SkyKeyframe {
      hr: number;
      zenith: string;
      upperMid: string;
      lowerMid: string;
      horizon: string;
      sunGlow: string;
      cloudLit: string;
      cloudShadow: string;
      sunCol: string;
      sunInt: number;
      ambSky: string;
      ambGnd: string;
      ambInt: number;
      rim: string;
      nightF: number;
      warmF: number;
    }

    const keys: SkyKeyframe[] = [
      // 00:00 — Deep Starry Night
      {
        hr: 0.0,
        zenith: '#020614', upperMid: '#06122e', lowerMid: '#0b1e46', horizon: '#112857',
        sunGlow: '#7caeff', cloudLit: '#6a90cc', cloudShadow: '#0a152e',
        sunCol: '#7caeff', sunInt: 0.56, ambSky: '#1d3669', ambGnd: '#0b1b2b', ambInt: 0.44,
        rim: '#7cb8ff', nightF: 1.0, warmF: 0.0,
      },
      // 04:50 — Tinh Mơ (Pre-Dawn Indigo & Blush First Light)
      {
        hr: 4.85,
        zenith: '#0b194f', upperMid: '#2f3d85', lowerMid: '#7d6ba8', horizon: '#f2a299',
        sunGlow: '#ffb5a8', cloudLit: '#d9c5e8', cloudShadow: '#2a3568',
        sunCol: '#ffc7cf', sunInt: 0.92, ambSky: '#566bb8', ambGnd: '#233b45', ambInt: 0.68,
        rim: '#ffd1dc', nightF: 0.48, warmF: 0.35,
      },
      // 06:20 — Bình Minh (Pastel Sakura-Rose & Lavender Dawn)
      {
        hr: 6.33,
        zenith: '#2868cf', upperMid: '#8a7ee6', lowerMid: '#f2a7c3', horizon: '#ffe0cf',
        sunGlow: '#ffc2b5', cloudLit: '#ffeef2', cloudShadow: '#8c7ec2',
        sunCol: '#ffe0d4', sunInt: 1.72, ambSky: '#c7a8f2', ambGnd: '#599c72', ambInt: 0.96,
        rim: '#ffe0eb', nightF: 0.04, warmF: 0.55,
      },
      // 08:30 — Ban Mai (Fresh Crystalline Turquoise-Blue Morning)
      {
        hr: 8.5,
        zenith: '#1054c4', upperMid: '#3ca8fc', lowerMid: '#8ae5ff', horizon: '#e8fcff',
        sunGlow: '#fff6d6', cloudLit: '#ffffff', cloudShadow: '#96c0f2',
        sunCol: '#fffcf2', sunInt: 2.15, ambSky: '#9be0ff', ambGnd: '#6ad17d', ambInt: 1.12,
        rim: '#fff9e6', nightF: 0.0, warmF: 0.05,
      },
      // 12:00 — Giữa Trưa (Radiant Makoto Shinkai Deep Cerulean Noon)
      {
        hr: 12.0,
        zenith: '#073ba8', upperMid: '#1f87f5', lowerMid: '#6cd8ff', horizon: '#def9ff',
        sunGlow: '#fff2c9', cloudLit: '#ffffff', cloudShadow: '#8ab2eb',
        sunCol: '#fffaf0', sunInt: 2.38, ambSky: '#8cd0ff', ambGnd: '#68c776', ambInt: 1.18,
        rim: '#fff6d9', nightF: 0.0, warmF: 0.0,
      },
      // 15:45 — Xế Chiều (Warm Golden-Honey Champagne Afternoon)
      {
        hr: 15.75,
        zenith: '#185ab0', upperMid: '#4da8db', lowerMid: '#a6e0cf', horizon: '#ffe9b0',
        sunGlow: '#ffd480', cloudLit: '#fff5de', cloudShadow: '#85a8cc',
        sunCol: '#ffe6b0', sunInt: 2.08, ambSky: '#9ed4e6', ambGnd: '#80ba62', ambInt: 1.06,
        rim: '#ffe49e', nightF: 0.0, warmF: 0.48,
      },
      // 17:40 — Hoàng Hôn (Molten Crimson-Amber Sunset)
      {
        hr: 17.67,
        zenith: '#261d6e', upperMid: '#b54373', lowerMid: '#fa7655', horizon: '#ffb357',
        sunGlow: '#ff7e38', cloudLit: '#ffc48c', cloudShadow: '#614282',
        sunCol: '#ffa159', sunInt: 1.78, ambSky: '#eb8f88', ambGnd: '#855c47', ambInt: 0.88,
        rim: '#ff9845', nightF: 0.08, warmF: 1.0,
      },
      // 18:35 — Chạng Vạng (Makoto Shinkai "Kataware-doki" Magic Violet Twilight)
      {
        hr: 18.58,
        zenith: '#0b1342', upperMid: '#3c2e82', lowerMid: '#8a4385', horizon: '#de6a88',
        sunGlow: '#f26d85', cloudLit: '#c288bf', cloudShadow: '#232254',
        sunCol: '#c48eff', sunInt: 0.88, ambSky: '#564799', ambGnd: '#252f4a', ambInt: 0.62,
        rim: '#df94ff', nightF: 0.58, warmF: 0.52,
      },
      // 20:30 — Đêm Đầu Hôm (Deep Sapphire Evening)
      {
        hr: 20.5,
        zenith: '#03081a', upperMid: '#081638', lowerMid: '#0e2452', horizon: '#153166',
        sunGlow: '#7caeff', cloudLit: '#6c92cf', cloudShadow: '#0b1733',
        sunCol: '#7caeff', sunInt: 0.58, ambSky: '#1f396e', ambGnd: '#0c1d2e', ambInt: 0.46,
        rim: '#7cb8ff', nightF: 0.96, warmF: 0.0,
      },
      // 24:00 — Wrap back to 00:00
      {
        hr: 24.0,
        zenith: '#020614', upperMid: '#06122e', lowerMid: '#0b1e46', horizon: '#112857',
        sunGlow: '#7caeff', cloudLit: '#6a90cc', cloudShadow: '#0a152e',
        sunCol: '#7caeff', sunInt: 0.56, ambSky: '#1d3669', ambGnd: '#0b1b2b', ambInt: 0.44,
        rim: '#7cb8ff', nightF: 1.0, warmF: 0.0,
      },
    ];

    let k0 = keys[0];
    let k1 = keys[1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (h >= keys[i].hr && h <= keys[i + 1].hr) {
        k0 = keys[i];
        k1 = keys[i + 1];
        break;
      }
    }

    const span = Math.max(0.001, k1.hr - k0.hr);
    const rawT = THREE.MathUtils.clamp((h - k0.hr) / span, 0, 1);
    const t = rawT * rawT * (3 - 2 * rawT); // Smoothstep cosine-like blend

    const lerpHex = (a: string, b: string) => new THREE.Color(a).lerp(new THREE.Color(b), t);

    const nightFactor = THREE.MathUtils.lerp(k0.nightF, k1.nightF, t);
    const sunsetFactor = THREE.MathUtils.lerp(k0.warmF, k1.warmF, t);

    this.lighting.nightFactor = nightFactor;
    this.lighting.sunsetFactor = sunsetFactor;

    const zenith = lerpHex(k0.zenith, k1.zenith);
    const upperMid = lerpHex(k0.upperMid, k1.upperMid);
    const lowerMid = lerpHex(k0.lowerMid, k1.lowerMid);
    const horizon = lerpHex(k0.horizon, k1.horizon);

    this.skyMat.uniforms.uSunDir.value.copy(this.lighting.sunDirection);
    this.skyMat.uniforms.uZenithColor.value.copy(zenith);
    this.skyMat.uniforms.uUpperMidColor.value.copy(upperMid);
    this.skyMat.uniforms.uLowerMidColor.value.copy(lowerMid);
    this.skyMat.uniforms.uHorizonColor.value.copy(horizon);
    this.skyMat.uniforms.uNightFactor.value = nightFactor;
    this.skyMat.uniforms.uSunsetFactor.value = sunsetFactor;
    this.skyMat.uniforms.uSunGlowColor.value.copy(lerpHex(k0.sunGlow, k1.sunGlow));

    this.lighting.cloudLitColor.copy(lerpHex(k0.cloudLit, k1.cloudLit));
    this.lighting.cloudShadowColor.copy(lerpHex(k0.cloudShadow, k1.cloudShadow));

    this.skyMat.uniforms.uCloudSunColor.value.copy(this.lighting.cloudLitColor);
    this.skyMat.uniforms.uCloudAmbientColor.value.copy(this.lighting.cloudShadowColor);

    this.wispCloudMat.uniforms.uLitColor.value.copy(this.lighting.cloudLitColor);
    this.wispCloudMat.uniforms.uShadowColor.value.copy(this.lighting.cloudShadowColor);

    this.lighting.sunColor.copy(lerpHex(k0.sunCol, k1.sunCol));
    this.lighting.sunIntensity = THREE.MathUtils.lerp(k0.sunInt, k1.sunInt, t);

    this.lighting.ambientSkyColor.copy(lerpHex(k0.ambSky, k1.ambSky));
    this.lighting.ambientGroundColor.copy(lerpHex(k0.ambGnd, k1.ambGnd));
    this.lighting.ambientIntensity = THREE.MathUtils.lerp(k0.ambInt, k1.ambInt, t);
    this.lighting.fogColor.copy(horizon);

    this.lighting.rimColor.copy(lerpHex(k0.rim, k1.rim));

    this.skySparkleMat.uniforms.uColorA.value
      .set('#fff7c2')
      .lerp(new THREE.Color('#ffd6eb'), sunsetFactor * 0.4)
      .lerp(new THREE.Color('#69ffd0'), nightFactor);
    this.skySparkleMat.uniforms.uColorB.value
      .set('#8ceeff')
      .lerp(new THREE.Color('#ffe484'), nightFactor);
  }

  public update(elapsed: number, playerPos: THREE.Vector3): void {
    this.skyMesh.position.copy(playerPos);
    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uCameraWorld.value.copy(playerPos);
    this.wispCloudMat.uniforms.uTime.value = elapsed;

    this.skySparkleMat.uniforms.uTime.value = elapsed;
    this.skySparkleMat.uniforms.uFocusPos.value.copy(playerPos);

    // Update sparse fly-through mist wisps
    const fArr = this.flyPosAttr.array as Float32Array;
    for (let i = 0; i < this.flyCloudData.length; i++) {
      const f = this.flyCloudData[i];
      const range = 260;
      const driftX = f.basePos.x + elapsed * f.driftSpeed;
      const wx = (((driftX + range) % (range * 2)) + range * 2) % (range * 2) - range;
      fArr[i * 4] = wx;
      fArr[i * 4 + 1] = f.basePos.y + Math.sin(elapsed * 0.35 + f.phase) * 1.2;
      fArr[i * 4 + 2] = f.basePos.z;
    }
    this.flyPosAttr.needsUpdate = true;
  }
}
