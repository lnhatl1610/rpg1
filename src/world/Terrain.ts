import * as THREE from 'three';
import { fbm2D, smoothstep } from '../utils/noise';
import { SkyLightingState } from './SkyAndClouds';
import { LandmarkInfo } from '../types';

export interface WalkablePlateau {
  id: string;
  name: string;
  x: number;
  topY: number;
  z: number;
  radius: number;
  domeHeight: number;
}

export const WATER_LEVEL = -1.45;

export class WorldTerrain {
  public group = new THREE.Group();

  public skyIslands: WalkablePlateau[] = [
    { id: 'island-1', name: 'Đảo Gió Bạc', x: 44, topY: 74, z: -42, radius: 15, domeHeight: 0.85 },
    { id: 'island-2', name: 'Đảo Mây Lưu Ly', x: -52, topY: 94, z: -28, radius: 17, domeHeight: 0.85 },
    { id: 'island-3', name: 'Đài Thiên Không Celestia', x: 4, topY: 118, z: -78, radius: 21, domeHeight: 0.9 },
  ];

  // Tall Liyue-style Karst Stone Pillars with walkable mossy summits!
  public stonePillars: WalkablePlateau[] = [
    { id: 'pillar-main', name: 'Rừng Đá Thiên Trụ', x: -84, topY: 46, z: 24, radius: 9.5, domeHeight: 0.5 },
    { id: 'pillar-sub1', name: 'Cột Đá Phong Vân', x: -104, topY: 38, z: 10, radius: 7.2, domeHeight: 0.45 },
    { id: 'pillar-sub2', name: 'Cột Đá Tinh Vân', x: -72, topY: 33, z: 42, radius: 6.8, domeHeight: 0.4 },
  ];

  private waterMat: THREE.ShaderMaterial;
  private waterfallMat: THREE.ShaderMaterial;
  private mistMat: THREE.ShaderMaterial;

  private crystalMat: THREE.MeshStandardMaterial;

  private terrainUniforms: {
    uTime: { value: number };
    uNoiseTex: { value: THREE.DataTexture };
    uCloudShadowStrength: { value: number };
    uGrassBaseColor: { value: THREE.Color };
    uGrassWarmColor: { value: THREE.Color };
    uNightFactor: { value: number };
  };

  private floatingShards: Array<{
    mesh: THREE.Mesh;
    baseY: number;
    orbitAngle: number;
    orbitRadius: number;
    center: THREE.Vector3;
    speed: number;
  }> = [];

  constructor(noiseTex: THREE.DataTexture) {
    this.terrainUniforms = {
      uTime: { value: 0 },
      uNoiseTex: { value: noiseTex },
      uCloudShadowStrength: { value: 0.28 },
      uGrassBaseColor: { value: new THREE.Color('#42a859') },
      uGrassWarmColor: { value: new THREE.Color('#7ed665') },
      uNightFactor: { value: 0.0 },
    };

    this.crystalMat = new THREE.MeshStandardMaterial({
      color: '#5ef2ff',
      emissive: '#1fb8ff',
      emissiveIntensity: 0.95,
      roughness: 0.14,
      metalness: 0.2,
    });

    this.waterMat = this.buildWaterMaterial(noiseTex);
    this.waterfallMat = this.buildWaterfallMaterial(noiseTex);
    this.mistMat = this.buildWaterfallMistMaterial();

    this.buildMainMultiBiomeTerrain();
    this.buildStarlightLakeAndTarn();
    this.buildTwinWaterfallAndGorge();
    this.buildStonePillarForest();
    this.buildNaturalStoneArch();
    this.buildLuminescentCrystalCanyon();
    this.buildTravertineJadePools();
    this.buildFloatingSkyIslands();
  }

  /**
   * Ridged multifractal noise [0..1] for crisp, dramatic rocky ridges & alpine peaks!
   */
  private ridgedNoise(x: number, z: number, octaves = 3): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1.0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1.0 - Math.abs(fbm2D(x * freq, z * freq, 1));
      sum += n * n * amp;
      norm += amp;
      freq *= 2.1;
      amp *= 0.5;
    }
    return sum / norm;
  }

  /**
   * Winding scenic stone paths:
   * 1) Spawn hill -> around Starlight Lake -> Great Windrise Tree
   * 2) Branch trail climbing East up toward Vách Đá Hái Sao (Starsnatch Cliff)!
   */
  public getPathFactor(x: number, z: number): number {
    let mainPath = 0;
    if (z >= -64 && z <= 38) {
      const lakeBypass = Math.exp(-Math.pow((z + 20) / 24, 2)) * 22.0;
      const pathCenterX = lakeBypass + Math.sin(z * 0.065) * 4.2;
      mainPath = 1.0 - smoothstep(1.6, 3.3, Math.abs(x - pathCenterX));
    }

    // Cliff trail from (18, 0) climbing up to (82, -12)
    let cliffPath = 0;
    if (x >= 16 && x <= 84) {
      const t = (x - 16) / 68;
      const targetZ = THREE.MathUtils.lerp(2, -12, t) + Math.sin(t * Math.PI * 2) * 4.5;
      cliffPath = 1.0 - smoothstep(1.4, 3.0, Math.abs(z - targetZ));
    }

    return Math.max(mainPath, cliffPath);
  }

  /**
   * Multi-Biome Analytical Heightfield:
   * - Rolling Mondstadt Meadow & Spawn Hill
   * - Starlight Lake Basin & Winding Stream
   * - Starsnatch Cliff Promontory (Vách Đá Hái Sao - East, 44m sheer drop!)
   * - Twin-Falls Canyon Bluff (Đỉnh Thác Bạc - Northwest, 28m cliff + upper tarn!)
   * - Crystal Gorge (Hẻm Núi Tinh Thạch - Southeast, carved rock walls!)
   * - Distant Snow-Capped Dragonspine Alpine Range (Outer rim up to 132m!)
   */
  public getMeadowHeight(x: number, z: number): number {
    const r = Math.hypot(x, z);

    // 1. Base rolling meadow hills
    const rolling = fbm2D(x * 0.008 + 3.1, z * 0.008 - 1.7, 4) * 9.0;
    const detail = fbm2D(x * 0.024 - 5.2, z * 0.024 + 2.4, 3) * 2.1;
    let h = rolling + detail + 1.8;

    // 2. Spawn overlook hill at (0, 18)
    const spawnDist = Math.hypot(x, z - 18);
    h += Math.exp(-(spawnDist * spawnDist) / (22 * 22)) * 3.5;

    // 3. Starlight Lake basin at (-2, -20)
    const lakeDx = (x + 2) / 23.0;
    const lakeDz = (z + 20) / 19.0;
    h -= Math.exp(-(lakeDx * lakeDx + lakeDz * lakeDz) * 1.35) * 6.5;

    // 4. Great Windrise Tree Sanctuary plateau at (0, -58)
    const treeDist = Math.hypot(x, z + 58);
    const treePlateau = Math.exp(-(treeDist * treeDist) / (24 * 24));
    h = THREE.MathUtils.lerp(h, 6.2, treePlateau * 0.86);

    // 5. VÁCH ĐÁ HÁI SAO (Starsnatch Cliff Promontory — East around x = 42..98, z = -14)!
    // Smooth grassy ramp climbing from West (x=36 -> x=92) then SHEER 45m cliff drop at x > 92 & |z+14| > 18!
    if (x > 26 && x < 122 && z > -56 && z < 32) {
      const rampUp = smoothstep(30, 88, x);
      const sheerEastDrop = 1.0 - smoothstep(90, 97, x);
      // Wedge-shaped jutting cape narrowing toward the tip
      const halfWidth = THREE.MathUtils.lerp(28, 11, smoothstep(35, 94, x));
      const sideCliffDrop = 1.0 - smoothstep(halfWidth - 4.5, halfWidth + 2.5, Math.abs(z + 14));
      const cliffMask = rampUp * sheerEastDrop * sideCliffDrop;
      const cliffHeight = 8.0 + rampUp * 38.0 + fbm2D(x * 0.05, z * 0.05, 2) * 1.4;
      h = Math.max(h, h * (1.0 - cliffMask) + cliffHeight * cliffMask);
    }

    // 6. ĐỈNH THÁC BẠC (Twin-Falls Canyon Bluff — Northwest around (-46, -54))!
    const bluffDist = Math.hypot((x + 48) / 24, (z + 56) / 20);
    if (bluffDist < 1.6) {
      // Sharp cliff edge facing Southeast toward Starlight Lake!
      const bluffMask = 1.0 - smoothstep(0.72, 1.12, bluffDist);
      let bluffY = 27.5 + this.ridgedNoise(x * 0.03, z * 0.03, 2) * 5.0;
      // Carve upper mountain tarn depression on top of the bluff at (-50, -58)
      const tarnDist = Math.hypot(x + 50, z + 58);
      bluffY -= Math.exp(-(tarnDist * tarnDist) / (9.5 * 9.5)) * 4.8;
      // Carve waterfall notch on SE lip (-38, -44)
      const notchDist = Math.hypot(x + 38, z + 44);
      bluffY -= Math.exp(-(notchDist * notchDist) / (5.5 * 5.5)) * 3.2;
      h = THREE.MathUtils.lerp(h, bluffY, bluffMask);
    }

    // Winding mountain stream channel from Waterfall plunge pool (-30, -36) into Starlight Lake (-14, -24)
    if (x > -36 && x < -10 && z > -42 && z < -20) {
      const tStream = THREE.MathUtils.clamp((x + 34) / 22, 0, 1);
      const streamZ = THREE.MathUtils.lerp(-37, -23, tStream) + Math.sin(tStream * 3.14) * 2.5;
      const streamMask = 1.0 - smoothstep(1.8, 4.8, Math.abs(z - streamZ));
      h -= streamMask * 2.8;
    }

    // 7. HẺM NÚI PHA LÊ (Luminescent Crystal Gorge — Southeast around (60, 62))!
    if (x > 25 && x < 105 && z > 25 && z < 105) {
      // Diagonal canyon axis along (x - z ~ 0)
      const canyonAxisDist = Math.abs((x - 62) * 0.707 - (z - 62) * 0.707);
      const canyonAlong = (x - 62) * 0.707 + (z - 62) * 0.707;
      const alongMask = 1.0 - smoothstep(18, 34, Math.abs(canyonAlong));
      // Twin high rocky canyon walls flanking a deep crystal floor!
      const wallProfile =
        Math.exp(-Math.pow((canyonAxisDist - 13.5) / 6.5, 2)) * 22.0 -
        Math.exp(-Math.pow(canyonAxisDist / 5.5, 2)) * 5.5;
      h += wallProfile * alongMask;
    }

    // 8. DÃY NÚI TUYẾT VIỄN CẢNH (Jagged Alpine Ridges & Dragonspine Snow Peaks on outer horizon!)
    const rim = smoothstep(145, 315, r);
    if (rim > 0.001) {
      const ridge1 = this.ridgedNoise(x * 0.011 + 1.7, z * 0.011 - 2.3, 4);
      const ridge2 = this.ridgedNoise(x * 0.024 - 4.1, z * 0.024 + 0.8, 3);
      // Higher majestic snow-crowned peaks to the North & West
      const northWestBoost = 1.0 + 0.48 * THREE.MathUtils.clamp((-z * 0.7 - x * 0.4) / 220, 0, 1);
      const mountainH = (18.0 + ridge1 * 78.0 + ridge2 * 24.0) * northWestBoost;
      h += rim * mountainH;
    }

    // Smooth path leveling across gentle water crossings
    const pathF = this.getPathFactor(x, z);
    if (pathF > 0.01 && h < WATER_LEVEL + 0.5) {
      h = THREE.MathUtils.lerp(h, WATER_LEVEL + 0.65, pathF);
    }

    return h;
  }

  /**
   * Unified surface height supporting ground terrain, Floating Sky Islands, AND Karst Stone Pillars!
   */
  public getSurfaceHeight(x: number, z: number, currentY: number): number {
    for (const isl of this.skyIslands) {
      const d = Math.hypot(x - isl.x, z - isl.z);
      if (d <= isl.radius - 0.4 && currentY >= isl.topY - 2.6) {
        const dome = Math.cos((d / isl.radius) * Math.PI * 0.5) * isl.domeHeight;
        return isl.topY + dome;
      }
    }

    for (const pil of this.stonePillars) {
      const d = Math.hypot(x - pil.x, z - pil.z);
      if (d <= pil.radius - 0.3 && currentY >= pil.topY - 2.6) {
        const dome = Math.cos((d / pil.radius) * Math.PI * 0.5) * pil.domeHeight;
        return pil.topY + dome;
      }
    }

    return this.getMeadowHeight(x, z);
  }

  public getRegionName(x: number, y: number, z: number): string {
    if (y > 106) return 'Đài Thiên Không Celestia';
    if (y > 65) return 'Biển Mây Ngân Quang';
    if (x > 52 && z > -36 && z < 16 && y > 18) return 'Vách Đá Hái Sao';
    if (Math.hypot(x + 84, z - 24) < 34) return 'Rừng Đá Thiên Trụ';
    if (Math.hypot(x + 44, z + 50) < 28) return 'Thác Bạc Tầng Mây';
    if (Math.hypot(x - 62, z - 62) < 28) return 'Hẻm Núi Pha Lê';
    if (Math.hypot(x - 48, z + 78) < 24) return 'Cổng Đá Chân Trời';
    if (Math.hypot(x + 26, z - 52) < 20) return 'Hồ Ngọc Bậc Thang';
    if (Math.hypot(x, z + 58) < 26) return 'Đại Thụ Thiên Phong';
    if (Math.hypot(x + 2, z + 20) < 25) return 'Hồ Tinh Tú';
    return 'Cánh Đồng Gió Phong Thần';
  }

  public getLandmarks(): LandmarkInfo[] {
    return [
      { id: 'starsnatch-cliff', name: 'Vách Đá Hái Sao', x: 84, y: this.getMeadowHeight(84, -14), z: -14, type: 'shrine' },
      { id: 'twin-waterfall', name: 'Thác Bạc Tầng Mây', x: -26, y: this.getMeadowHeight(-26, -32), z: -32, type: 'lake' },
      { id: 'pillar-main', name: 'Rừng Đá Thiên Trụ', x: -84, y: 46.5, z: 24, type: 'island' },
      { id: 'crystal-canyon', name: 'Hẻm Núi Pha Lê', x: 60, y: this.getMeadowHeight(60, 60), z: 60, type: 'shrine' },
      { id: 'stone-arch', name: 'Cổng Đá Chân Trời', x: 48, y: this.getMeadowHeight(48, -62), z: -62, type: 'shrine' },
      { id: 'great-tree', name: 'Đại Thụ Thiên Phong', x: 0, y: this.getMeadowHeight(0, -58), z: -58, type: 'tree' },
      { id: 'island-3', name: 'Đài Celestia (118m)', x: 4, y: 118, z: -78, type: 'island' },
    ];
  }

  private buildMainMultiBiomeTerrain(): void {
    const size = 680;
    const segs = 320;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    // aTerrainMask: x = pathFactor, y = shoreSandFactor, z = cliffSlope, w = snowFactor
    const masks = new Float32Array(pos.count * 4);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.getMeadowHeight(x, z);
      pos.setY(i, y);

      const pathF = this.getPathFactor(x, z);
      const shoreF = 1.0 - smoothstep(WATER_LEVEL - 0.8, WATER_LEVEL + 0.95, y);

      masks[i * 4] = pathF;
      masks[i * 4 + 1] = shoreF;
      masks[i * 4 + 2] = 0;
      masks[i * 4 + 3] = 0;
    }

    geo.computeVertexNormals();

    const normals = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ny = normals.getY(i);
      // Crisp rocky cliff walls wherever slope is steep!
      const cliffF = smoothstep(0.15, 0.42, 1.0 - ny);
      // Alpine snow settles on high peaks (> 58m) especially on flatter upper ridges!
      const snowElev = smoothstep(56.0, 82.0, y);
      const snowSlopeHold = smoothstep(0.32, 0.72, ny);

      masks[i * 4 + 2] = cliffF;
      masks[i * 4 + 3] = snowElev * snowSlopeHold;
    }
    geo.setAttribute('aTerrainMask', new THREE.BufferAttribute(masks, 4));

    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.terrainUniforms.uTime;
      shader.uniforms.uNoiseTex = this.terrainUniforms.uNoiseTex;
      shader.uniforms.uCloudShadowStrength = this.terrainUniforms.uCloudShadowStrength;
      shader.uniforms.uGrassBaseColor = this.terrainUniforms.uGrassBaseColor;
      shader.uniforms.uGrassWarmColor = this.terrainUniforms.uGrassWarmColor;
      shader.uniforms.uNightFactor = this.terrainUniforms.uNightFactor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          attribute vec4 aTerrainMask;
          varying vec4 vTerrainMask;
          varying vec3 vWorldPosition;
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vTerrainMask = aTerrainMask;
          vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTime;
          uniform sampler2D uNoiseTex;
          uniform float uCloudShadowStrength;
          uniform vec3 uGrassBaseColor;
          uniform vec3 uGrassWarmColor;
          uniform float uNightFactor;
          varying vec4 vTerrainMask;
          varying vec3 vWorldPosition;
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          float macroVar = texture2D(uNoiseTex, vWorldPosition.xz * 0.012).r;
          float microVar = texture2D(uNoiseTex, vWorldPosition.xz * 0.14).g;

          // 1. Lush Meadow Ground
          vec3 meadowCol = mix(uGrassBaseColor, uGrassWarmColor, smoothstep(0.28, 0.76, macroVar));
          meadowCol *= 0.94 + microVar * 0.12;

          // 2. Shore Sand & Riverbed Pebbles
          vec3 sandCol = mix(vec3(0.82, 0.79, 0.68), vec3(0.92, 0.89, 0.80), microVar);
          vec3 col = mix(meadowCol, sandCol, clamp(vTerrainMask.y, 0.0, 1.0));

          // 3. Ancient White-Gold Cobblestone Trail
          if (vTerrainMask.x > 0.01) {
            float cobble = texture2D(uNoiseTex, vWorldPosition.xz * 0.42).b;
            vec3 stonePath = mix(vec3(0.75, 0.74, 0.70), vec3(0.90, 0.88, 0.83), smoothstep(0.35, 0.7, cobble));
            col = mix(col, stonePath, smoothstep(0.1, 0.75, vTerrainMask.x));
          }

          // 4. Crisp Stratified Anime Cliff Rock (Mondstadt / Liyue horizontal strata + vertical crevices!)
          if (vTerrainMask.z > 0.01) {
            float horizStrata = texture2D(uNoiseTex, vec2(vWorldPosition.x * 0.025 + vWorldPosition.z * 0.025, vWorldPosition.y * 0.16)).r;
            float vertCracks  = texture2D(uNoiseTex, vec2(vWorldPosition.x * 0.09 - vWorldPosition.z * 0.07, vWorldPosition.y * 0.03)).g;

            vec3 slateDark = vec3(0.31, 0.37, 0.46);
            vec3 slateMid  = vec3(0.49, 0.54, 0.61);
            vec3 warmLedge = vec3(0.67, 0.65, 0.59);

            vec3 rockCol = mix(slateDark, slateMid, smoothstep(0.24, 0.58, horizStrata));
            rockCol = mix(rockCol, warmLedge, smoothstep(0.66, 0.86, horizStrata) * 0.75);
            rockCol *= 0.82 + 0.30 * smoothstep(0.2, 0.8, vertCracks);

            col = mix(col, rockCol, clamp(vTerrainMask.z, 0.0, 1.0));
          }

          // 5. Dragonspine Alpine Snow Caps on high mountain ridges!
          if (vTerrainMask.w > 0.01) {
            vec3 snowCol = mix(vec3(0.92, 0.96, 1.0), vec3(0.48, 0.62, 0.88), uNightFactor * 0.65);
            col = mix(col, snowCol, clamp(vTerrainMask.w, 0.0, 1.0));
          }

          // Drifting cloud shadows
          vec2 cloudUv = vWorldPosition.xz * 0.0038 + vec2(uTime * 0.0055, uTime * 0.0022);
          float cloudMask = smoothstep(0.45, 0.76, texture2D(uNoiseTex, cloudUv).r);
          col *= mix(1.0, 1.0 - uCloudShadowStrength, cloudMask);

          diffuseColor.rgb = col;
          `
        );
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildWaterMaterial(noiseTex: THREE.DataTexture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTex: { value: noiseTex },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5).normalize() },
        uShallowColor: { value: new THREE.Color('#47e3db') },
        uDeepColor: { value: new THREE.Color('#1376d4') },
        uSkyReflectColor: { value: new THREE.Color('#9bd8ff') },
        uSunColor: { value: new THREE.Color('#fff7d6') },
      },
      vertexShader: /* glsl */ `
        attribute float aWaterDepth;
        varying float vDepth;
        varying vec3 vWorldPos;
        void main() {
          vDepth = aWaterDepth;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform vec3 uSunDir;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uSkyReflectColor;
        uniform vec3 uSunColor;

        varying float vDepth;
        varying vec3 vWorldPos;

        void main() {
          if (vDepth <= 0.01) discard;

          vec2 uv1 = vWorldPos.xz * 0.075 + vec2(uTime * 0.018, uTime * 0.012);
          vec2 uv2 = vWorldPos.xz * 0.11 - vec2(uTime * 0.014, uTime * 0.021);
          float r1 = texture2D(uNoiseTex, uv1).g;
          float r2 = texture2D(uNoiseTex, uv2).b;

          vec3 rippleNormal = normalize(vec3((r1 - r2) * 0.24, 1.0, (r1 + r2 - 1.0) * 0.24));
          vec3 toCam = cameraPosition - vWorldPos;
          vec3 viewDir = length(toCam) > 1e-4 ? normalize(toCam) : vec3(0.0, 1.0, 0.0);

          float fresnel = pow(clamp(1.0 - dot(viewDir, rippleNormal), 1e-5, 1.0), 3.2);
          float depthFactor = smoothstep(0.0, 2.8, vDepth);

          vec3 waterCol = mix(uShallowColor, uDeepColor, depthFactor);
          waterCol = mix(waterCol, uSkyReflectColor, clamp(fresnel * 0.78, 0.0, 0.85));

          float shoreWave = sin(vDepth * 13.0 - uTime * 2.6 + r1 * 3.0);
          float foam = smoothstep(0.55, 0.06, vDepth) * smoothstep(0.35, 0.7, shoreWave);
          foam += smoothstep(0.14, 0.02, vDepth) * 0.85;

          vec3 halfSum = normalize(uSunDir) + viewDir;
          vec3 halfVec = length(halfSum) > 1e-4 ? normalize(halfSum) : vec3(0.0, 1.0, 0.0);
          float spec = pow(clamp(dot(rippleNormal, halfVec), 1e-5, 1.0), 96.0);
          float sparkle = step(0.68, r1 * r2 * 2.1) * pow(clamp(dot(rippleNormal, halfVec), 1e-5, 1.0), 22.0);

          waterCol += vec3(1.0) * clamp(foam, 0.0, 1.0) * 0.85;
          waterCol += uSunColor * (spec * 1.65 + sparkle * 1.25);

          float alpha = clamp(smoothstep(0.0, 0.22, vDepth) * 0.88 + foam * 0.25, 0.0, 0.96);
          gl_FragColor = vec4(waterCol, alpha);
        }
      `,
    });
  }

  private buildWaterfallMaterial(noiseTex: THREE.DataTexture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uNoiseTex: { value: noiseTex },
        uBrightness: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uNoiseTex;
        uniform float uBrightness;
        varying vec2 vUv;

        void main() {
          // Fast rushing vertical anime water streaks & white crest foam!
          vec2 flowUv1 = vec2(vUv.x * 2.2, vUv.y * 1.6 + uTime * 1.35);
          vec2 flowUv2 = vec2(vUv.x * 4.5 + 0.3, vUv.y * 2.8 + uTime * 1.95);
          float n1 = texture2D(uNoiseTex, flowUv1).g;
          float n2 = texture2D(uNoiseTex, flowUv2).b;

          float edgeFade = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
          float foamStreaks = smoothstep(0.42, 0.76, n1 * 0.6 + n2 * 0.4);
          // Extra white froth at waterfall top lip & bottom splash!
          float topBottomFoam = smoothstep(0.22, 0.0, vUv.y) + smoothstep(0.76, 1.0, vUv.y);

          vec3 aquaCore = vec3(0.28, 0.84, 0.94);
          vec3 whiteFoam = vec3(1.06, 1.10, 1.14);
          vec3 col = mix(aquaCore, whiteFoam, clamp(foamStreaks + topBottomFoam * 0.85, 0.0, 1.0)) * uBrightness;

          float alpha = edgeFade * (0.76 + foamStreaks * 0.22);
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }

  private buildWaterfallMistMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBrightness: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float cycle = fract(uTime * 0.45 + aPhase);
          p.y += cycle * 4.5;
          p.x += sin(aPhase * 12.0 + uTime) * cycle * 2.2;
          p.z += cos(aPhase * 9.0 + uTime) * cycle * 2.2;

          vAlpha = sin(cycle * 3.14159) * 0.38;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(240.0 / max(-mv.z, 1.0), 6.0, 56.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uBrightness;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = exp(-dot(uv, uv) * 9.0);
          if (d * vAlpha < 0.005) discard;
          gl_FragColor = vec4(vec3(0.85, 0.96, 1.05) * uBrightness, d * vAlpha);
        }
      `,
    });
  }

  private buildStarlightLakeAndTarn(): void {
    // 1. Main Starlight Lake + Stream Mouth
    const geo = new THREE.PlaneGeometry(92, 68, 110, 90);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const depths = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) - 10;
      const wz = pos.getZ(i) - 24;
      const groundY = this.getMeadowHeight(wx, wz);
      depths[i] = Math.max(0, WATER_LEVEL - groundY);
    }
    geo.setAttribute('aWaterDepth', new THREE.BufferAttribute(depths, 1));

    const waterMesh = new THREE.Mesh(geo, this.waterMat);
    waterMesh.position.set(-10, WATER_LEVEL, -24);
    waterMesh.renderOrder = 2;
    this.group.add(waterMesh);

    // 2. Upper Canyon Tarn on top of Twin-Falls Bluff (-50, 26.2, -58)
    const tarnLevel = 25.8;
    const tarnGeo = new THREE.PlaneGeometry(24, 24, 32, 32);
    tarnGeo.rotateX(-Math.PI / 2);
    const tPos = tarnGeo.attributes.position;
    const tDepths = new Float32Array(tPos.count);
    for (let i = 0; i < tPos.count; i++) {
      const wx = tPos.getX(i) - 50;
      const wz = tPos.getZ(i) - 58;
      tDepths[i] = Math.max(0, tarnLevel - this.getMeadowHeight(wx, wz));
    }
    tarnGeo.setAttribute('aWaterDepth', new THREE.BufferAttribute(tDepths, 1));
    const tarnMesh = new THREE.Mesh(tarnGeo, this.waterMat);
    tarnMesh.position.set(-50, tarnLevel, -58);
    tarnMesh.renderOrder = 2;
    this.group.add(tarnMesh);
  }

  /**
   * Cascading 2-tier Anime Waterfall plunging from Northwest Canyon Bluff into Starlight Stream!
   */
  private buildTwinWaterfallAndGorge(): void {
    const createCascadeRibbon = (
      topPos: THREE.Vector3,
      bottomPos: THREE.Vector3,
      width: number
    ): THREE.Mesh => {
      const segsY = 18;
      const geo = new THREE.PlaneGeometry(width, 1, 8, segsY);
      const pos = geo.attributes.position;
      const dir = bottomPos.clone().sub(topPos);
      dir.y = 0;
      const forward = dir.length() > 0.01 ? dir.normalize() : new THREE.Vector3(0.7, 0, 0.7);
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const horizDist = Math.hypot(bottomPos.x - topPos.x, bottomPos.z - topPos.z);

      for (let i = 0; i < pos.count; i++) {
        const localX = pos.getX(i);
        const uvy = 0.5 - pos.getY(i); // 0 at top -> 1 at bottom
        // Parabolic gravity waterfall arc!
        const fwdDist = horizDist * Math.pow(uvy, 0.65);
        const wy = THREE.MathUtils.lerp(topPos.y, bottomPos.y, uvy * uvy * 0.75 + uvy * 0.25);
        const flare = 1.0 + uvy * 0.28;

        const wx = topPos.x + forward.x * fwdDist + right.x * localX * flare;
        const wz = topPos.z + forward.z * fwdDist + right.z * localX * flare;
        pos.setXYZ(i, wx, wy, wz);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.waterfallMat);
      m.renderOrder = 3;
      return m;
    };

    // Upper cascade (y = 25.8 -> mid rock shelf y = 11.5) & Lower cascade (y = 11.5 -> plunge pool y = -1.5)
    this.group.add(
      createCascadeRibbon(new THREE.Vector3(-42, 25.8, -48), new THREE.Vector3(-36, 11.2, -41), 5.6),
      createCascadeRibbon(new THREE.Vector3(-35.5, 11.4, -40.5), new THREE.Vector3(-29, -1.5, -34), 6.8)
    );

    // Mid-cliff rocky boulder shelf
    const rockMat = new THREE.MeshStandardMaterial({
      color: '#5a687d',
      roughness: 0.88,
      flatShading: true,
    });
    const shelf = new THREE.Mesh(new THREE.DodecahedronGeometry(4.2, 1), rockMat);
    shelf.scale.set(1.5, 0.65, 1.3);
    shelf.position.set(-36, 10.4, -41);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    this.group.add(shelf);

    // Rising waterfall mist spray at plunge pool & mid-shelf
    const mistCount = 48;
    const mistPos = new Float32Array(mistCount * 3);
    const mistPhases = new Float32Array(mistCount);
    for (let i = 0; i < mistCount; i++) {
      const upper = i < 18;
      const cx = upper ? -36 : -29;
      const cy = upper ? 11.2 : -1.2;
      const cz = upper ? -41 : -34;
      mistPos[i * 3] = cx + (Math.random() - 0.5) * 4.5;
      mistPos[i * 3 + 1] = cy;
      mistPos[i * 3 + 2] = cz + (Math.random() - 0.5) * 4.5;
      mistPhases[i] = Math.random();
    }
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
    mistGeo.setAttribute('aPhase', new THREE.BufferAttribute(mistPhases, 1));
    const mistPts = new THREE.Points(mistGeo, this.mistMat);
    mistPts.frustumCulled = false;
    this.group.add(mistPts);
  }

  /**
   * Liyue Huaguang-style Towering Karst Stone Pillars (`Rừng Đá Thiên Trụ`)!
   */
  private buildStonePillarForest(): void {
    const pillarRockMat = new THREE.MeshStandardMaterial({
      color: '#5e6b7d',
      roughness: 0.86,
      flatShading: true,
    });
    const mossCapMat = new THREE.MeshStandardMaterial({
      color: '#48b85e',
      roughness: 0.9,
    });

    for (let pIdx = 0; pIdx < this.stonePillars.length; pIdx++) {
      const pil = this.stonePillars[pIdx];
      const baseGround = this.getMeadowHeight(pil.x, pil.z) - 4.0;
      const height = pil.topY - baseGround;

      const g = new THREE.Group();
      g.position.set(pil.x, baseGround, pil.z);

      // Sculpted fluted karst column
      const colGeo = new THREE.CylinderGeometry(pil.radius * 0.95, pil.radius * 1.18, height, 14, 8);
      const pos = colGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const ang = Math.atan2(vz, vx);
        const flute = 0.88 + 0.16 * Math.sin(ang * 5.0 + pIdx * 2.0) + 0.08 * fbm2D(vx * 0.2, vy * 0.12, 2);
        pos.setX(i, vx * flute);
        pos.setZ(i, vz * flute);
      }
      colGeo.computeVertexNormals();

      const colMesh = new THREE.Mesh(colGeo, pillarRockMat);
      colMesh.position.y = height * 0.5;
      colMesh.castShadow = true;
      colMesh.receiveShadow = true;
      g.add(colMesh);

      // Lush emerald mossy summit cap
      const capMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(pil.radius, pil.radius * 0.92, 1.3, 24),
        mossCapMat
      );
      capMesh.position.y = height - 0.35;
      capMesh.receiveShadow = true;
      g.add(capMesh);

      this.group.add(g);
    }

    // Scenic hanging stone-and-gold arch bridge spanning between Pillar 0 and Pillar 1!
    const p0 = this.stonePillars[0];
    const p1 = this.stonePillars[1];
    const bridgeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(p0.x - 6, p0.topY - 0.6, p0.z - 4),
      new THREE.Vector3((p0.x + p1.x) * 0.5, (p0.topY + p1.topY) * 0.5 - 2.2, (p0.z + p1.z) * 0.5),
      new THREE.Vector3(p1.x + 5, p1.topY - 0.5, p1.z + 3),
    ]);
    const bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 20, 0.85, 6, false);
    bridgeGeo.scale(1, 0.35, 1);
    const bridgeMat = new THREE.MeshStandardMaterial({ color: '#dcd7c9', roughness: 0.7 });
    const bridgeMesh = new THREE.Mesh(bridgeGeo, bridgeMat);
    bridgeMesh.castShadow = true;
    this.group.add(bridgeMesh);
  }

  /**
   * Colossal Natural Stone Arch (`Cổng Đá Chân Trời` at (48, y, -78)) — wide enough to fly right through!
   */
  private buildNaturalStoneArch(): void {
    const ax = 48;
    const az = -78;
    const baseY = this.getMeadowHeight(ax, az) - 2.0;

    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ax - 19, baseY, az - 4),
      new THREE.Vector3(ax - 14, baseY + 15, az - 2),
      new THREE.Vector3(ax, baseY + 23.5, az),
      new THREE.Vector3(ax + 14, baseY + 15, az + 2),
      new THREE.Vector3(ax + 19, baseY, az + 4),
    ]);

    const segs = 28;
    const radial = 10;
    const frames = archCurve.computeFrenetFrames(segs, false);
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const pt = archCurve.getPointAt(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      // Thicker sturdy stone bases, graceful narrower keystone crown
      const baseR = THREE.MathUtils.lerp(4.4, 2.3, Math.sin(t * Math.PI));

      for (let j = 0; j <= radial; j++) {
        const theta = (j / radial) * Math.PI * 2;
        const jag = 0.86 + 0.24 * Math.sin(theta * 4.0 + t * 9.0);
        const r = baseR * jag;
        const nx = Math.cos(theta) * N.x + Math.sin(theta) * B.x;
        const ny = Math.cos(theta) * N.y + Math.sin(theta) * B.y;
        const nz = Math.cos(theta) * N.z + Math.sin(theta) * B.z;
        positions.push(pt.x + nx * r, pt.y + ny * r, pt.z + nz * r);
      }
    }

    const row = radial + 1;
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        const c = (i + 1) * row + (j + 1);
        const d = i * row + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
      color: '#637185',
      roughness: 0.85,
      flatShading: true,
    });
    const archMesh = new THREE.Mesh(geo, rockMat);
    archMesh.castShadow = true;
    archMesh.receiveShadow = true;
    this.group.add(archMesh);
  }

  /**
   * Luminescent Crystal Canyon (`Hẻm Núi Pha Lê` at Southeast (62, 62))!
   */
  private buildLuminescentCrystalCanyon(): void {
    const amethystMat = new THREE.MeshStandardMaterial({
      color: '#c68cff',
      emissive: '#8f42ff',
      emissiveIntensity: 0.9,
      roughness: 0.15,
      metalness: 0.2,
    });

    const clusterSpots = [
      { x: 54, z: 50, mat: this.crystalMat, scale: 1.35 },
      { x: 68, z: 58, mat: amethystMat, scale: 1.25 },
      { x: 58, z: 68, mat: this.crystalMat, scale: 1.45 },
      { x: 72, z: 70, mat: this.crystalMat, scale: 1.15 },
      { x: 48, z: 58, mat: amethystMat, scale: 1.1 },
      { x: 64, z: 52, mat: this.crystalMat, scale: 1.0 },
    ];

    const shardGeo = new THREE.CylinderGeometry(0.05, 0.55, 3.2, 6);
    shardGeo.translate(0, 1.5, 0);

    for (const sp of clusterSpots) {
      const gy = this.getMeadowHeight(sp.x, sp.z) - 0.25;
      const cluster = new THREE.Group();
      cluster.position.set(sp.x, gy, sp.z);
      cluster.scale.setScalar(sp.scale);

      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + sp.x;
        const tilt = k === 0 ? 0.08 : 0.36 + (k % 2) * 0.18;
        const shard = new THREE.Mesh(shardGeo, sp.mat);
        shard.scale.set(0.75 + (k % 2) * 0.3, k === 0 ? 1.35 : 0.72 + (k % 3) * 0.22, 0.75);
        shard.rotation.order = 'YXZ';
        shard.rotation.y = a;
        shard.rotation.z = tilt;
        shard.castShadow = true;
        cluster.add(shard);
      }

      this.group.add(cluster);
    }
  }

  /**
   * Luhua Pool-inspired Turquoise Travertine Terraces (`Hồ Ngọc Bậc Thang` at (-26, y, 52))!
   */
  private buildTravertineJadePools(): void {
    const limestoneMat = new THREE.MeshStandardMaterial({
      color: '#f2efe4',
      roughness: 0.45,
    });
    const jadePoolMat = new THREE.MeshStandardMaterial({
      color: '#42f2dc',
      emissive: '#14b8a6',
      emissiveIntensity: 0.38,
      roughness: 0.12,
      metalness: 0.1,
    });

    const steps = [
      { x: -28, z: 56, r: 7.5, hOffset: 1.6 },
      { x: -24, z: 50, r: 6.5, hOffset: 0.9 },
      { x: -20, z: 44, r: 5.8, hOffset: 0.3 },
    ];

    for (const st of steps) {
      const gy = this.getMeadowHeight(st.x, st.z) + st.hOffset;
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(st.r, st.r * 1.08, 1.4, 28),
        limestoneMat
      );
      basin.position.set(st.x, gy - 0.55, st.z);
      basin.castShadow = true;
      basin.receiveShadow = true;
      this.group.add(basin);

      const waterDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(st.r * 0.9, st.r * 0.9, 0.12, 28),
        jadePoolMat
      );
      waterDisc.position.set(st.x, gy + 0.12, st.z);
      this.group.add(waterDisc);
    }
  }

  private buildFloatingSkyIslands(): void {
    const rockMat = new THREE.MeshStandardMaterial({
      color: '#6b7b94',
      roughness: 0.85,
      flatShading: true,
    });
    const grassTopMat = new THREE.MeshStandardMaterial({
      color: '#52c46c',
      roughness: 0.9,
    });
    const marbleMat = new THREE.MeshStandardMaterial({
      color: '#f4f2eb',
      roughness: 0.35,
      metalness: 0.08,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#ffd97d',
      emissive: '#ffb84d',
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.75,
    });

    for (let idx = 0; idx < this.skyIslands.length; idx++) {
      const isl = this.skyIslands[idx];
      const islandGroup = new THREE.Group();
      islandGroup.position.set(isl.x, isl.topY, isl.z);

      const capGeo = new THREE.CylinderGeometry(isl.radius, isl.radius * 0.94, 1.5, 28);
      const cap = new THREE.Mesh(capGeo, grassTopMat);
      cap.position.y = -0.5;
      cap.receiveShadow = true;
      islandGroup.add(cap);

      const underDepth = isl.radius * 1.15;
      const coneGeo = new THREE.ConeGeometry(isl.radius * 0.93, underDepth, 14, 4);
      coneGeo.rotateX(Math.PI);
      const cPos = coneGeo.attributes.position;
      for (let i = 0; i < cPos.count; i++) {
        const vx = cPos.getX(i);
        const vy = cPos.getY(i);
        const vz = cPos.getZ(i);
        if (vy < underDepth * 0.45) {
          const jag = 0.82 + 0.28 * fbm2D(vx * 0.15 + idx * 5, vz * 0.15, 2);
          cPos.setX(i, vx * jag);
          cPos.setZ(i, vz * jag);
        }
      }
      coneGeo.computeVertexNormals();
      const underMesh = new THREE.Mesh(coneGeo, rockMat);
      underMesh.position.y = -underDepth * 0.5 - 1.1;
      underMesh.castShadow = true;
      islandGroup.add(underMesh);

      const colCount = idx === 2 ? 6 : 3;
      for (let c = 0; c < colCount; c++) {
        const a = (c / colCount) * Math.PI * 2 + 0.4;
        const r = isl.radius * 0.66;
        const h = idx === 2 ? 5.8 + (c % 2) * 2.2 : 3.8 + (c % 2) * 1.5;

        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.5, h, 12),
          marbleMat
        );
        pillar.position.set(Math.cos(a) * r, h * 0.5, Math.sin(a) * r);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        islandGroup.add(pillar);

        const trimRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.52, 0.07, 8, 20),
          goldMat
        );
        trimRing.rotation.x = Math.PI / 2;
        trimRing.position.set(Math.cos(a) * r, h - 0.3, Math.sin(a) * r);
        islandGroup.add(trimRing);
      }

      const dais = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6, 3.2, 0.45, 24),
        marbleMat
      );
      dais.position.y = 0.35;
      dais.receiveShadow = true;
      islandGroup.add(dais);

      const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), this.crystalMat);
      prism.scale.set(0.75, 1.55, 0.75);
      prism.position.y = 2.9;
      islandGroup.add(prism);

      const haloRing = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.055, 10, 40), goldMat);
      haloRing.position.y = 2.9;
      haloRing.rotation.x = Math.PI * 0.32;
      islandGroup.add(haloRing);

      this.floatingShards.push({
        mesh: prism,
        baseY: isl.topY + 2.9,
        orbitAngle: idx,
        orbitRadius: 0,
        center: new THREE.Vector3(isl.x, isl.topY + 2.9, isl.z),
        speed: 1.2,
      });

      for (let s = 0; s < 5; s++) {
        const shard = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65 + (s % 3) * 0.35, 0), rockMat);
        shard.scale.set(0.8, 1.4, 0.8);
        this.group.add(shard);
        this.floatingShards.push({
          mesh: shard,
          baseY: isl.topY - 2.5 - (s % 3) * 2.4,
          orbitAngle: (s / 5) * Math.PI * 2,
          orbitRadius: isl.radius + 3.2 + (s % 2) * 2.4,
          center: new THREE.Vector3(isl.x, isl.topY, isl.z),
          speed: 0.22 + s * 0.04,
        });
      }

      this.group.add(islandGroup);
    }
  }

  public update(elapsed: number, lighting: SkyLightingState): void {
    this.terrainUniforms.uTime.value = elapsed;
    this.terrainUniforms.uNightFactor.value = lighting.nightFactor;
    this.terrainUniforms.uCloudShadowStrength.value = THREE.MathUtils.lerp(
      0.28,
      0.1,
      lighting.nightFactor
    );

    this.terrainUniforms.uGrassBaseColor.value
      .set('#3ca655')
      .lerp(new THREE.Color('#4f8f46'), lighting.sunsetFactor * 0.5)
      .lerp(new THREE.Color('#0f2d33'), lighting.nightFactor * 0.88);

    this.terrainUniforms.uGrassWarmColor.value
      .set('#7ee063')
      .lerp(new THREE.Color('#b0c954'), lighting.sunsetFactor * 0.55)
      .lerp(new THREE.Color('#1c5257'), lighting.nightFactor * 0.88);

    const waterLightDir =
      lighting.nightFactor > 0.6
        ? new THREE.Vector3(
            -lighting.sunDirection.x,
            Math.abs(lighting.sunDirection.y) * 0.62 + 0.34,
            -lighting.sunDirection.z
          ).normalize()
        : lighting.sunDirection;

    this.waterMat.uniforms.uTime.value = elapsed;
    this.waterMat.uniforms.uSunDir.value.copy(waterLightDir);
    this.waterMat.uniforms.uSunColor.value.copy(lighting.sunColor);
    this.waterMat.uniforms.uSkyReflectColor.value.copy(lighting.ambientSkyColor);
    this.waterMat.uniforms.uShallowColor.value
      .set('#47e3db')
      .lerp(new THREE.Color('#1a6c8a'), lighting.nightFactor * 0.82);
    this.waterMat.uniforms.uDeepColor.value
      .set('#1376d4')
      .lerp(new THREE.Color('#072654'), lighting.nightFactor * 0.85);

    this.waterfallMat.uniforms.uTime.value = elapsed;
    const wfBright = THREE.MathUtils.lerp(1.0, 0.52, lighting.nightFactor);
    this.waterfallMat.uniforms.uBrightness.value = wfBright;

    this.mistMat.uniforms.uTime.value = elapsed;
    this.mistMat.uniforms.uBrightness.value = wfBright;

    // Crystals glow even more magically at night!
    this.crystalMat.emissiveIntensity = THREE.MathUtils.lerp(0.85, 1.65, lighting.nightFactor);

    for (const item of this.floatingShards) {
      if (item.orbitRadius === 0) {
        item.mesh.rotation.y = elapsed * 0.9;
        item.mesh.position.y = 2.9 + Math.sin(elapsed * 1.8 + item.orbitAngle) * 0.32;
      } else {
        const a = item.orbitAngle + elapsed * item.speed;
        item.mesh.position.set(
          item.center.x + Math.cos(a) * item.orbitRadius,
          item.baseY + Math.sin(elapsed * 1.3 + item.orbitAngle) * 0.65,
          item.center.z + Math.sin(a) * item.orbitRadius
        );
        item.mesh.rotation.y = a;
      }
    }
  }
}
