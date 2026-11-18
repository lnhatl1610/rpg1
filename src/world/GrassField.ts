import * as THREE from 'three';
import { fbm2D } from '../utils/noise';
import { WATER_LEVEL, WorldTerrain } from './Terrain';
import { SkyLightingState } from './SkyAndClouds';

export class GrassField {
  public group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private mat: THREE.ShaderMaterial;
  private terrain: WorldTerrain;

  constructor(terrain: WorldTerrain, noiseTex: THREE.DataTexture, initialCount: number) {
    this.terrain = terrain;

    this.mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTex: { value: noiseTex },
        uPlayerPos: { value: new THREE.Vector3(0, 5, 18) },
        uPlayerVel: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0.45, 0.65, -0.6).normalize() },
        uSunColor: { value: new THREE.Color('#fff9eb') },
        uSkyAmbient: { value: new THREE.Color('#8fd2ff') },
        uRootDarkColor: { value: new THREE.Color('#2d8c47') },
        uRootWarmColor: { value: new THREE.Color('#64c456') },
        uMidBladeColor: { value: new THREE.Color('#5cd660') },
        uTipFreshColor: { value: new THREE.Color('#9ef26d') },
        uTipGoldenColor: { value: new THREE.Color('#def783') },
        uWindSheenColor: { value: new THREE.Color('#edffb5') },
        uFogColor: { value: new THREE.Color('#e3faff') },
        uCloudShadowStrength: { value: 0.25 },
        uNightFactor: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aInstancePosScale; // xyz = world pos, w = height scale
        attribute vec4 aInstanceRotSlope; // x = yaw, y = colorVar, z = slopeNx, w = slopeNz

        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform vec3 uPlayerPos;
        uniform vec3 uPlayerVel;

        varying float vHeightFrac;
        varying float vCenterEdge;
        varying float vWindWave;
        varying float vColorVar;
        varying vec3 vSlopeNormal;
        varying vec3 vBladeDir;
        varying vec3 vWorldPos;

        void main() {
          vec3 baseWorld = aInstancePosScale.xyz;
          float hScale = aInstancePosScale.w;
          float yaw = aInstanceRotSlope.x;
          vColorVar = aInstanceRotSlope.y;
          vSlopeNormal = normalize(vec3(aInstanceRotSlope.z, 1.0, aInstanceRotSlope.w));

          vHeightFrac = clamp(uv.y, 0.0, 1.0);
          vCenterEdge = abs(uv.x - 0.5) * 2.0;

          float camHorizDist = length(baseWorld.xz - cameraPosition.xz);
          float distScale = 1.0 - smoothstep(138.0, 178.0, camHorizDist);

          if (distScale <= 0.005) {
            vWindWave = 0.0;
            vBladeDir = vec3(0.0, 1.0, 0.0);
            vWorldPos = baseWorld;
            gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
            return;
          }

          // Slightly thicken blade width at medium distance to prevent subpixel shimmering
          float distWidthBoost = 1.0 + smoothstep(18.0, 75.0, camHorizDist) * 0.45;

          vec3 local = position;
          local.y *= hScale * distScale;
          local.x *= (0.92 + vColorVar * 0.35) * distWidthBoost;

          // Graceful parabolic Ghibli/Genshin blade arch
          float curve = vHeightFrac * vHeightFrac;
          local.z += curve * 0.24 * hScale;
          local.y -= curve * 0.05 * hScale;

          float c = cos(yaw);
          float s = sin(yaw);
          vec3 rotated = vec3(
            local.x * c - local.z * s,
            local.y,
            local.x * s + local.z * c
          );

          // Layered rolling meadow wind waves + delicate tip flutter
          vec2 windDir = normalize(vec2(0.82, 0.57));
          vec2 waveUv1 = baseWorld.xz * 0.016 - windDir * (uTime * 0.11);
          vec2 waveUv2 = baseWorld.xz * 0.042 - windDir * (uTime * 0.18);
          float w1 = texture2D(uNoiseTex, waveUv1).r;
          float w2 = texture2D(uNoiseTex, waveUv2).g;

          float gust = smoothstep(0.28, 0.86, w1 * 0.68 + w2 * 0.32);
          float microFlutter = sin(uTime * 3.4 + baseWorld.x * 0.8 + baseWorld.z * 0.6 + vColorVar * 6.28) * 0.08;

          float bend = (gust * 0.68 + 0.14 + microFlutter) * curve * hScale;
          rotated.xz += windDir * bend;
          rotated.y -= bend * 0.30;

          // Player footstep & low-flight wind wash parting
          vec3 toBlade = baseWorld - uPlayerPos;
          float horizDist = length(toBlade.xz);
          float vertDist = abs(toBlade.y);
          if (horizDist < 2.8 && vertDist < 3.4) {
            float pushRadius = mix(1.6, 2.7, clamp(length(uPlayerVel) * 0.08, 0.0, 1.0));
            float push = (1.0 - smoothstep(0.15, pushRadius, horizDist)) * (1.0 - smoothstep(0.5, 3.2, vertDist));
            vec2 pushDir = horizDist > 0.001 ? normalize(toBlade.xz) : vec2(1.0, 0.0);
            rotated.xz += pushDir * push * vHeightFrac * 0.95;
            rotated.y -= push * vHeightFrac * 0.44;
          }

          vWindWave = gust;
          vBladeDir = normalize(vec3(rotated.x, max(rotated.y, 0.15), rotated.z));
          vec3 finalWorld = baseWorld + rotated;
          vWorldPos = finalWorld;

          gl_Position = projectionMatrix * viewMatrix * vec4(finalWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoiseTex;
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyAmbient;
        uniform vec3 uRootDarkColor;
        uniform vec3 uRootWarmColor;
        uniform vec3 uMidBladeColor;
        uniform vec3 uTipFreshColor;
        uniform vec3 uTipGoldenColor;
        uniform vec3 uWindSheenColor;
        uniform vec3 uFogColor;
        uniform float uCloudShadowStrength;
        uniform float uNightFactor;

        varying float vHeightFrac;
        varying float vCenterEdge;
        varying float vWindWave;
        varying float vColorVar;
        varying vec3 vSlopeNormal;
        varying vec3 vBladeDir;
        varying vec3 vWorldPos;

        void main() {
          // 1. Exact color-matched root fused seamlessly with Terrain.ts!
          float macroPatch = texture2D(uNoiseTex, vWorldPos.xz * 0.012).r;
          float meadowTapestry = texture2D(uNoiseTex, vWorldPos.xz * 0.028 + 0.35).g;

          vec3 rootCol = mix(uRootDarkColor, uRootWarmColor, smoothstep(0.28, 0.76, macroPatch));

          // 2. Painterly 3-hue Ghibli/Genshin tip tapestry (Emerald -> Spring Lime -> Golden Wheat patches)
          vec3 tipHue = mix(uTipFreshColor, uTipGoldenColor, smoothstep(0.38, 0.78, meadowTapestry * 0.75 + vColorVar * 0.25));
          vec3 midHue = mix(uMidBladeColor, tipHue * 0.88, meadowTapestry * 0.45);

          vec3 col = mix(rootCol, midHue, smoothstep(0.0, 0.48, vHeightFrac));
          col = mix(col, tipHue, smoothstep(0.42, 1.0, vHeightFrac));

          // Subtle center-rib 3D fullness across blade width (makes each blade look lush & dimensional)
          float rib = 1.0 - vCenterEdge * 0.09 * vHeightFrac;
          col *= rib;

          // Soft root ambient occlusion nestled into turf
          float rootAO = mix(0.84, 1.04, smoothstep(0.0, 0.38, vHeightFrac));
          col *= rootAO;

          // 3. Hillside directional sunlight + sky bounce (eliminates flat shading!)
          vec3 sDir = normalize(uSunDir);
          float hillSun = clamp(dot(normalize(vSlopeNormal), sDir) * 0.5 + 0.5, 0.0, 1.0);
          vec3 hillLight = mix(uSkyAmbient * 0.68, vec3(1.06, 1.04, 0.98), smoothstep(0.25, 0.78, hillSun));
          col *= mix(vec3(1.0), hillLight, 0.42 * (1.0 - uNightFactor * 0.5));

          // 4. Silky anisotropic wind-wave sheen sweeping across hillside tips
          float sheen = smoothstep(0.46, 0.90, vWindWave) * pow(clamp(vHeightFrac, 1e-4, 1.0), 1.6);
          col = mix(col, uWindSheenColor, sheen * 0.38 * (1.0 - uNightFactor * 0.7));

          // 5. Warm golden subsurface translucency + Kajiya-Kay-like specular sun glint on curved blades!
          vec3 toFrag = vWorldPos - cameraPosition;
          vec3 viewDir = length(toFrag) > 1e-4 ? normalize(toFrag) : vec3(0.0, 0.0, -1.0);
          float backScatter = pow(clamp(dot(viewDir, sDir), 1e-5, 1.0), 3.2);

          vec3 halfV = normalize(sDir - viewDir);
          float sinTH = sqrt(clamp(1.0 - pow(dot(vBladeDir, halfV), 2.0), 1e-5, 1.0));
          float strandSpec = pow(sinTH, 24.0) * vHeightFrac * 0.16;

          col += uSunColor * (backScatter * 0.36 * vHeightFrac + strandSpec) * (1.0 - uNightFactor * 0.72);

          // Synchronized drifting cloud shadow
          vec2 cloudUv = vWorldPos.xz * 0.0038 + vec2(uTime * 0.0055, uTime * 0.0022);
          float cloudMask = smoothstep(0.45, 0.76, texture2D(uNoiseTex, cloudUv).r);
          col *= mix(1.0, 1.0 - uCloudShadowStrength, cloudMask);

          // Distance atmospheric perspective
          float camDist = length(vWorldPos - cameraPosition);
          float fogFactor = smoothstep(95.0, 260.0, camDist);
          col = mix(col, uFogColor, fogFactor * 0.45);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.rebuildGrass(initialCount);
  }

  private createBladeGeometry(): THREE.BufferGeometry {
    const segs = 5;
    const baseHalfWidth = 0.046;
    const height = 0.68;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const y = t * height;
      // Smooth organic leaf taper (slightly fuller belly in lower-mid, graceful fine point at top)
      const taper = Math.cos(t * Math.PI * 0.46);
      const w = baseHalfWidth * taper;
      positions.push(-w, y, 0);
      positions.push(w, y, 0);
      uvs.push(0, t);
      uvs.push(1, t);
    }

    positions.push(0, height, 0.015);
    uvs.push(0.5, 1.0);
    const tipIndex = segs * 2;

    for (let i = 0; i < segs - 1; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2);
      indices.push(b + 1, b + 3, b + 2);
    }
    const lastBase = (segs - 1) * 2;
    indices.push(lastBase, lastBase + 1, tipIndex);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  public rebuildGrass(totalCount: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }

    const baseGeo = this.createBladeGeometry();
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGeo.index;
    instGeo.attributes.position = baseGeo.attributes.position;
    instGeo.attributes.uv = baseGeo.attributes.uv;
    instGeo.attributes.normal = baseGeo.attributes.normal;

    const posScale = new Float32Array(totalCount * 4);
    const rotSlope = new Float32Array(totalCount * 4);

    const skyIslandShare = Math.min(15000, Math.floor(totalCount * 0.09));
    const meadowShare = totalCount - skyIslandShare;

    let placed = 0;
    let attempts = 0;
    const maxAttempts = meadowShare * 3;

    // Clumped natural meadow tuft placement!
    let tuftCenterX = 0;
    let tuftCenterZ = 18;
    let tuftRemaining = 0;

    while (placed < meadowShare && attempts < maxAttempts) {
      attempts++;

      let x: number;
      let z: number;

      if (tuftRemaining > 0) {
        // Spawn blade inside natural lush clump
        const ca = Math.random() * Math.PI * 2;
        const cr = Math.random() * 0.42;
        x = tuftCenterX + Math.cos(ca) * cr;
        z = tuftCenterZ + Math.sin(ca) * cr;
        tuftRemaining--;
      } else {
        const u = Math.random();
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.pow(u, 0.62) * 142.0;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius - 10.0;
        tuftCenterX = x;
        tuftCenterZ = z;
        tuftRemaining = 4 + Math.floor(Math.random() * 4);
      }

      const y = this.terrain.getMeadowHeight(x, z);
      if (y < WATER_LEVEL + 0.34) {
        tuftRemaining = 0;
        continue;
      }

      const pathF = this.terrain.getPathFactor(x, z);
      if (pathF > 0.36 && Math.random() < pathF * 1.25) continue;

      const hDx = (this.terrain.getMeadowHeight(x + 0.5, z) - y) / 0.5;
      const hDz = (this.terrain.getMeadowHeight(x, z + 0.5) - y) / 0.5;
      if (Math.hypot(hDx, hDz) > 0.92) continue;

      // Rolling natural meadow patch height variation (short velvety clover -> tall swaying plumes)
      const patchHeight = 0.72 + fbm2D(x * 0.055, z * 0.055, 2) * 0.34;
      const pathTrim = 1.0 - pathF * 0.45;

      const idx4 = placed * 4;
      posScale[idx4] = x;
      posScale[idx4 + 1] = y - 0.025;
      posScale[idx4 + 2] = z;
      posScale[idx4 + 3] = Math.max(0.42, (patchHeight + (Math.random() - 0.5) * 0.28) * pathTrim);

      rotSlope[idx4] = Math.random() * Math.PI * 2;
      rotSlope[idx4 + 1] = Math.random();
      rotSlope[idx4 + 2] = -hDx;
      rotSlope[idx4 + 3] = -hDz;
      placed++;
    }

    // Lush Celestial Grass on top of Floating Sky Islands & Karst Stone Pillars!
    const plateaus = [...this.terrain.skyIslands, ...this.terrain.stonePillars];
    while (placed < totalCount) {
      const plat = plateaus[placed % plateaus.length];
      const isSkyIsl = plat.id.startsWith('island');
      const r = Math.sqrt(Math.random()) * (plat.radius - 0.85);
      if (isSkyIsl && r < 3.1) continue;
      const a = Math.random() * Math.PI * 2;

      const x = plat.x + Math.cos(a) * r;
      const z = plat.z + Math.sin(a) * r;
      const y = this.terrain.getSurfaceHeight(x, z, plat.topY + 1.0);

      const idx4 = placed * 4;
      posScale[idx4] = x;
      posScale[idx4 + 1] = y - 0.025;
      posScale[idx4 + 2] = z;
      posScale[idx4 + 3] = 0.62 + Math.random() * 0.48;

      rotSlope[idx4] = Math.random() * Math.PI * 2;
      rotSlope[idx4 + 1] = Math.random();
      rotSlope[idx4 + 2] = 0;
      rotSlope[idx4 + 3] = 0;
      placed++;
    }

    instGeo.setAttribute('aInstancePosScale', new THREE.InstancedBufferAttribute(posScale, 4));
    instGeo.setAttribute('aInstanceRotSlope', new THREE.InstancedBufferAttribute(rotSlope, 4));
    instGeo.instanceCount = placed;

    this.mesh = new THREE.Mesh(instGeo, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  public update(
    elapsed: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    lighting: SkyLightingState
  ): void {
    const u = this.mat.uniforms;
    u.uTime.value = elapsed;
    u.uPlayerPos.value.copy(playerPos);
    u.uPlayerVel.value.copy(playerVel);
    u.uSunDir.value.copy(lighting.sunDirection);
    u.uSunColor.value.copy(lighting.sunColor);
    u.uSkyAmbient.value.copy(lighting.ambientSkyColor);
    u.uFogColor.value.copy(lighting.fogColor);
    u.uNightFactor.value = lighting.nightFactor;
    u.uCloudShadowStrength.value = THREE.MathUtils.lerp(0.24, 0.08, lighting.nightFactor);

    u.uRootDarkColor.value
      .set('#3ca655')
      .lerp(new THREE.Color('#4f8f46'), lighting.sunsetFactor * 0.5)
      .lerp(new THREE.Color('#0f2d33'), lighting.nightFactor * 0.88);

    u.uRootWarmColor.value
      .set('#7ee063')
      .lerp(new THREE.Color('#b0c954'), lighting.sunsetFactor * 0.55)
      .lerp(new THREE.Color('#1c5257'), lighting.nightFactor * 0.88);

    u.uMidBladeColor.value
      .set('#58cf62')
      .lerp(new THREE.Color('#9ec456'), lighting.sunsetFactor * 0.55)
      .lerp(new THREE.Color('#174750'), lighting.nightFactor * 0.88);

    u.uTipFreshColor.value
      .set('#9bf26d')
      .lerp(new THREE.Color('#ffd06b'), lighting.sunsetFactor * 0.62)
      .lerp(new THREE.Color('#2e7c82'), lighting.nightFactor * 0.86);

    u.uTipGoldenColor.value
      .set('#dcf786')
      .lerp(new THREE.Color('#ffe18c'), lighting.sunsetFactor * 0.7)
      .lerp(new THREE.Color('#52a8b8'), lighting.nightFactor * 0.85);

    u.uWindSheenColor.value
      .set('#edffb5')
      .lerp(new THREE.Color('#9cd8ff'), lighting.nightFactor * 0.9);
  }
}
