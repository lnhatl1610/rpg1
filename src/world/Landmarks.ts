import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLeafBouquetTexture } from '../utils/noise';
import { WATER_LEVEL, WorldTerrain } from './Terrain';
import { SkyLightingState } from './SkyAndClouds';

export interface UpdraftZone {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

interface CanopyDome {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  density: number;
  tintBias: number;
}

export class WorldLandmarks {
  public group = new THREE.Group();
  public updrafts: UpdraftZone[] = [];

  private foliageMat: THREE.ShaderMaterial;
  private barkMat: THREE.MeshStandardMaterial;
  private windRibbonMeshes: THREE.Mesh[] = [];
  private fallingLeaves: THREE.Points;
  private leafParticleMat: THREE.ShaderMaterial;
  private sunbeamMat: THREE.ShaderMaterial;
  private flowerMats: THREE.MeshBasicMaterial[] = [];

  private foliageDomes: CanopyDome[] = [];

  constructor(private terrain: WorldTerrain) {
    const leafTex = createLeafBouquetTexture(256);
    this.foliageMat = this.createGenshinFoliageMaterial(leafTex);
    this.barkMat = this.createMossyBarkMaterial();
    this.sunbeamMat = this.createSunbeamMaterial();

    this.buildGreatWindriseTree();
    this.buildScenicTrees();
    this.buildSkyIslandTrees();
    this.buildAllLeafBouquetCanopies();

    this.buildSkyViewingPavilion();
    this.buildWildflowerClusters();
    this.buildWindUpdrafts();

    this.leafParticleMat = this.createFallingLeavesMaterial();
    this.fallingLeaves = this.buildFallingLeaves();
    this.group.add(this.fallingLeaves);
  }

  /**
   * Sculpted organic tapered branch/root tube with natural bark flutes!
   */
  private createTaperedBranchGeometry(
    points: THREE.Vector3[],
    rStart: number,
    rEnd: number,
    tubularSegs = 22,
    radialSegs = 10
  ): THREE.BufferGeometry {
    const curve = new THREE.CatmullRomCurve3(points);
    const frames = curve.computeFrenetFrames(tubularSegs, false);

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= tubularSegs; i++) {
      const t = i / tubularSegs;
      const center = curve.getPointAt(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];

      // Smooth organic taper
      const baseRadius = THREE.MathUtils.lerp(rStart, rEnd, Math.pow(t, 0.78));

      for (let j = 0; j <= radialSegs; j++) {
        const v = j / radialSegs;
        const theta = v * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Gnarled bark longitudinal ridges near base
        const flute = 1.0 + (1.0 - t * 0.65) * 0.11 * Math.sin(theta * 6.0 + t * 5.0);
        const r = baseRadius * flute;

        const nx = cosT * N.x + sinT * B.x;
        const ny = cosT * N.y + sinT * B.y;
        const nz = cosT * N.z + sinT * B.z;

        positions.push(center.x + nx * r, center.y + ny * r, center.z + nz * r);
        normals.push(nx, ny, nz);
        uvs.push(v, t * 4.0);
      }
    }

    const row = radialSegs + 1;
    for (let i = 0; i < tubularSegs; i++) {
      for (let j = 0; j < radialSegs; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        const c = (i + 1) * row + (j + 1);
        const d = i * row + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Warm ancient oak bark with emerald velvet moss on top surfaces!
   */
  private createMossyBarkMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: '#6e503d',
      roughness: 0.88,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBarkWorldNormal;
          varying vec3 vBarkWorldPos;
          `
        )
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          #include <beginnormal_vertex>
          vBarkWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
          `
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          #include <begin_vertex>
          vBarkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vBarkWorldNormal;
          varying vec3 vBarkWorldPos;
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          float grain = sin(vBarkWorldPos.x * 4.5 + vBarkWorldPos.y * 1.6 + vBarkWorldPos.z * 4.5) * 0.5 + 0.5;
          vec3 darkBark = vec3(0.32, 0.22, 0.17);
          vec3 warmBark = vec3(0.50, 0.37, 0.27);
          vec3 barkCol = mix(darkBark, warmBark, smoothstep(0.25, 0.75, grain));

          // Lush emerald moss growing on upward-facing roots & boughs!
          float mossMask = smoothstep(0.36, 0.78, normalize(vBarkWorldNormal).y);
          vec3 mossCol = vec3(0.24, 0.64, 0.34);
          diffuseColor.rgb = mix(barkCol, mossCol, mossMask * 0.62);
          `
        );
    };

    return mat;
  }

  /**
   * Studio Ghibli / Genshin Windrise Leaf-Bouquet Card Shader with Spherical Dome Normals!
   */
  private createGenshinFoliageMaterial(leafTex: THREE.CanvasTexture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLeafTex: { value: leafTex },
        uSunDir: { value: new THREE.Vector3(0.45, 0.65, -0.6).normalize() },
        uSunColor: { value: new THREE.Color('#fff9ec') },
        uTopLitColor: { value: new THREE.Color('#a4f76d') },
        uMidLeafColor: { value: new THREE.Color('#38c468') },
        uDeepLeafColor: { value: new THREE.Color('#196b58') },
        uRimColor: { value: new THREE.Color('#dcff9e') },
        uFogColor: { value: new THREE.Color('#dffaff') },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aCardPosScale;  // xyz = world pos, w = card scale
        attribute vec4 aDomeNormalVar; // xyz = spherical dome normal, w = tint/phase [0..1]

        uniform float uTime;

        varying vec2 vUv;
        varying vec3 vDomeNormal;
        varying vec3 vWorldPos;
        varying float vVar;

        void main() {
          vUv = uv;
          vDomeNormal = normalize(aDomeNormalVar.xyz);
          vVar = aDomeNormalVar.w;

          vec3 center = aCardPosScale.xyz;
          float scale = aCardPosScale.w;

          // Gentle anime wind rustle & leaf flutter
          float rustle = sin(uTime * 2.2 + center.x * 0.45 + center.z * 0.38 + vVar * 6.28);
          float tiltAngle = (vVar - 0.5) * 1.35 + rustle * 0.14;
          float c = cos(tiltAngle);
          float s = sin(tiltAngle);

          vec2 rotXY = vec2(
            position.x * c - position.y * s,
            position.x * s + position.y * c
          );

          // Camera-facing billboard with slight outward dome push so crown stays voluminous from every angle!
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          vec3 swayOffset = vec3(
            rustle * 0.16,
            cos(uTime * 1.7 + center.y * 0.5 + vVar * 5.0) * 0.08,
            sin(uTime * 1.9 + center.x * 0.3) * 0.12
          );

          vec3 worldPos = center + swayOffset + camRight * rotXY.x * scale + camUp * rotXY.y * scale;
          vWorldPos = worldPos;

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLeafTex;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uTopLitColor;
        uniform vec3 uMidLeafColor;
        uniform vec3 uDeepLeafColor;
        uniform vec3 uRimColor;
        uniform vec3 uFogColor;

        varying vec2 vUv;
        varying vec3 vDomeNormal;
        varying vec3 vWorldPos;
        varying float vVar;

        void main() {
          vec4 tex = texture2D(uLeafTex, vUv);
          // Crisp individual pointed leaf cutout!
          if (tex.a < 0.44) discard;

          vec3 n = normalize(vDomeNormal);
          vec3 sDir = normalize(uSunDir);

          // Spherical dome cel-shading + per-leaf detail from bouquet texture!
          float ndl = dot(n, sDir) * 0.5 + 0.5;
          float leafTipHighlight = (tex.r - 0.72) * 0.55 + (tex.g - 0.75) * 0.25 + (vVar - 0.5) * 0.12;
          float shade = clamp(ndl + leafTipHighlight, 0.0, 1.0);

          // 3-Tone Lush Ghibli / Genshin Foliage Ramp
          vec3 col = uDeepLeafColor;
          col = mix(col, uMidLeafColor, smoothstep(0.30, 0.46, shade));
          col = mix(col, uTopLitColor,  smoothstep(0.58, 0.74, shade));

          // Golden-lime sun subsurface translucency when looking up through the boughs!
          vec3 toFrag = vWorldPos - cameraPosition;
          vec3 viewDir = length(toFrag) > 1e-4 ? normalize(toFrag) : vec3(0.0, 1.0, 0.0);
          float backLight = pow(clamp(dot(viewDir, sDir), 1e-5, 1.0), 3.0);
          float rim = pow(clamp(1.0 - abs(dot(viewDir, n)), 1e-5, 1.0), 2.4) * max(dot(n, sDir), 0.0);

          col += uSunColor * backLight * 0.30 * tex.r;
          col += uRimColor * rim * 0.32;

          // Distance atmospheric perspective
          float camDist = length(vWorldPos - cameraPosition);
          col = mix(col, uFogColor, smoothstep(125.0, 320.0, camDist) * 0.45);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }

  private createSunbeamMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color('#fff4c4') },
        uStrength: { value: 0.24 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        void main() {
          vUv = uv;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec2 vUv;
        varying vec3 vNormalView;
        void main() {
          float edgeSoft = pow(clamp(abs(vNormalView.z), 1e-5, 1.0), 2.2);
          float vertFade = smoothstep(0.0, 0.28, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
          float shimmer = 0.8 + 0.2 * sin(vUv.x * 18.84 + uTime * 0.8);
          float alpha = edgeSoft * vertFade * shimmer * uStrength;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
  }

  /**
   * Majestic Genshin Windrise Sacred Oak (`Đại Thụ Thiên Phong`)!
   * Wide 34m umbrella crown, 8 buttress roots, curved sweeping boughs, sunbeams & glowing runes!
   */
  private buildGreatWindriseTree(): void {
    const cx = 0;
    const cz = -58;
    const groundY = this.terrain.getMeadowHeight(cx, cz);

    const treeGroup = new THREE.Group();
    treeGroup.position.set(cx, groundY, cz);

    // 1. Sacred White Stone Sanctuary & Glowing Anemo Runes
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#efede4', roughness: 0.5 });
    const runeMat = new THREE.MeshStandardMaterial({
      color: '#7efce0',
      emissive: '#3ef5c8',
      emissiveIntensity: 1.45,
    });

    const outerStep = new THREE.Mesh(new THREE.CylinderGeometry(10.2, 11.2, 0.36, 36), stoneMat);
    outerStep.position.y = 0.08;
    outerStep.receiveShadow = true;
    treeGroup.add(outerStep);

    const innerStep = new THREE.Mesh(new THREE.CylinderGeometry(7.8, 8.4, 0.42, 32), stoneMat);
    innerStep.position.y = 0.26;
    innerStep.receiveShadow = true;
    treeGroup.add(innerStep);

    const runeRing1 = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.065, 8, 56), runeMat);
    runeRing1.rotation.x = Math.PI / 2;
    runeRing1.position.y = 0.49;
    treeGroup.add(runeRing1);

    const runeRing2 = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.05, 8, 64), runeMat);
    runeRing2.rotation.x = Math.PI / 2;
    runeRing2.position.y = 0.28;
    treeGroup.add(runeRing2);

    // 2. Organic Gnarled Trunk + 8 Flaring Buttress Roots + 9 Sweeping Umbrella Boughs!
    const woodGeos: THREE.BufferGeometry[] = [];

    // Main gnarled trunk with graceful S-curve
    woodGeos.push(
      this.createTaperedBranchGeometry(
        [
          new THREE.Vector3(0, -0.4, 0),
          new THREE.Vector3(0.35, 3.4, 0.2),
          new THREE.Vector3(-0.28, 7.6, -0.15),
          new THREE.Vector3(0.15, 11.8, 0.1),
          new THREE.Vector3(0, 15.6, 0),
        ],
        2.85,
        1.15,
        24,
        14
      )
    );

    // 8 Flaring Buttress Roots gripping the sanctuary terrace
    for (let r = 0; r < 8; r++) {
      const ang = (r / 8) * Math.PI * 2 + (r % 2) * 0.16;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const reach = 5.6 + (r % 3) * 1.1;

      woodGeos.push(
        this.createTaperedBranchGeometry(
          [
            new THREE.Vector3(cosA * 1.4, 3.6, sinA * 1.4),
            new THREE.Vector3(cosA * 2.8, 1.5, sinA * 2.8),
            new THREE.Vector3(cosA * (reach * 0.78), 0.55, sinA * (reach * 0.78)),
            new THREE.Vector3(cosA * reach, 0.15, sinA * reach),
          ],
          0.95,
          0.18,
          14,
          8
        )
      );
    }

    // 9 Primary Sweeping Umbrella Boughs + Secondary Sub-Forks!
    const boughCount = 9;
    for (let b = 0; b < boughCount; b++) {
      const ang = (b / boughCount) * Math.PI * 2 + 0.25;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const isUpper = b % 2 === 0;
      const startY = isUpper ? 11.6 : 9.8;
      const endR = isUpper ? 11.5 : 14.2;
      const endY = isUpper ? 19.4 : 16.2;

      const p0 = new THREE.Vector3(cosA * 0.9, startY, sinA * 0.9);
      const p1 = new THREE.Vector3(cosA * (endR * 0.42), startY + 3.2, sinA * (endR * 0.42));
      const p2 = new THREE.Vector3(
        cosA * (endR * 0.78) + sinA * 1.1,
        endY - 0.8,
        sinA * (endR * 0.78) - cosA * 1.1
      );
      const p3 = new THREE.Vector3(cosA * endR, endY, sinA * endR);

      woodGeos.push(this.createTaperedBranchGeometry([p0, p1, p2, p3], 1.05, 0.24, 18, 9));

      // Secondary upward fork from midpoint of each bough
      const forkAng = ang + (isUpper ? 0.28 : -0.26);
      const fCos = Math.cos(forkAng);
      const fSin = Math.sin(forkAng);
      woodGeos.push(
        this.createTaperedBranchGeometry(
          [
            p1.clone(),
            new THREE.Vector3(fCos * (endR * 0.68), endY + 1.4, fSin * (endR * 0.68)),
            new THREE.Vector3(fCos * (endR * 0.92), endY + 3.1, fSin * (endR * 0.92)),
          ],
          0.56,
          0.16,
          12,
          7
        )
      );

      // Register lush outer & mid foliage domes right at the bough tips!
      this.foliageDomes.push({
        cx: cx + cosA * (endR * 0.96),
        cy: groundY + endY + 0.8,
        cz: cz + sinA * (endR * 0.96),
        rx: 5.4,
        ry: 3.4,
        rz: 5.4,
        density: 165,
        tintBias: (b % 3) * 0.25,
      });

      this.foliageDomes.push({
        cx: cx + fCos * (endR * 0.82),
        cy: groundY + endY + 3.3,
        cz: cz + fSin * (endR * 0.82),
        rx: 5.0,
        ry: 3.2,
        rz: 5.0,
        density: 145,
        tintBias: 0.4 + (b % 2) * 0.3,
      });
    }

    // Grand Central Crown Tiers of the Great Windrise Tree!
    const crownTiers = [
      { dx: 0, dy: 23.6, dz: 0, rx: 8.6, ry: 4.6, rz: 8.6, count: 320 },
      { dx: -4.8, dy: 21.2, dz: 3.6, rx: 6.8, ry: 3.8, rz: 6.8, count: 210 },
      { dx: 5.0, dy: 21.4, dz: 3.2, rx: 6.8, ry: 3.8, rz: 6.8, count: 210 },
      { dx: 0.2, dy: 21.5, dz: -5.4, rx: 7.0, ry: 3.9, rz: 7.0, count: 210 },
      { dx: 0, dy: 18.8, dz: 0, rx: 10.5, ry: 3.6, rz: 10.5, count: 260 },
    ];
    for (const ct of crownTiers) {
      this.foliageDomes.push({
        cx: cx + ct.dx,
        cy: groundY + ct.dy,
        cz: cz + ct.dz,
        rx: ct.rx,
        ry: ct.ry,
        rz: ct.rz,
        density: ct.count,
        tintBias: 0.65,
      });
    }

    const mergedWood = mergeGeometries(woodGeos, false);
    for (const g of woodGeos) g.dispose();

    const trunkMesh = new THREE.Mesh(mergedWood, this.barkMat);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    treeGroup.add(trunkMesh);

    // Shadow-only canopy proxy so the Great Tree casts a rich dappled ground shadow!
    const shadowProxyMat = new THREE.ShadowMaterial({ opacity: 0.0 });
    shadowProxyMat.colorWrite = false;
    shadowProxyMat.depthWrite = false;
    const shadowDome = new THREE.Mesh(new THREE.SphereGeometry(14.2, 16, 12), shadowProxyMat);
    shadowDome.scale.set(1.0, 0.45, 1.0);
    shadowDome.position.y = 19.5;
    shadowDome.castShadow = true;
    treeGroup.add(shadowDome);

    // 3. Crepuscular Golden Sunbeams slanting down through the Great Tree's boughs!
    const beamGeo = new THREE.CylinderGeometry(1.1, 3.4, 22, 16, 1, true);
    const beamConfigs = [
      { x: -3.5, y: 11.5, z: 2.5, rz: -0.32, rx: 0.2 },
      { x: 4.2, y: 11.0, z: -1.8, rz: -0.32, rx: 0.2 },
      { x: 0.5, y: 12.0, z: 4.2, rz: -0.32, rx: 0.2 },
    ];
    for (const bc of beamConfigs) {
      const beam = new THREE.Mesh(beamGeo, this.sunbeamMat);
      beam.position.set(bc.x, bc.y, bc.z);
      beam.rotation.set(bc.rx, 0, bc.rz);
      treeGroup.add(beam);
    }

    this.group.add(treeGroup);
  }

  /**
   * Surrounding scenic curved anime meadow trees!
   */
  private buildScenicTrees(): void {
    const treeCoords = [
      [-28, -14, 1.15],
      [-35, -29, 1.0],
      [29, -18, 1.12],
      [37, -35, 1.25],
      [-23, 26, 1.02],
      [27, 22, 0.95],
      [-48, -46, 1.28],
      [46, -52, 1.2],
      [-20, -82, 1.18],
      [24, -80, 1.14],
      [54, 8, 1.08],
      [-56, 18, 1.15],
    ];

    const trunkParts: THREE.BufferGeometry[] = [];
    // Reusable organic tree trunk + 3 forks
    trunkParts.push(
      this.createTaperedBranchGeometry(
        [
          new THREE.Vector3(0, -0.2, 0),
          new THREE.Vector3(0.14, 2.2, 0.08),
          new THREE.Vector3(-0.08, 4.6, -0.05),
          new THREE.Vector3(0, 6.2, 0),
        ],
        0.58,
        0.2,
        12,
        8
      )
    );
    for (let f = 0; f < 3; f++) {
      const a = (f / 3) * Math.PI * 2 + 0.4;
      trunkParts.push(
        this.createTaperedBranchGeometry(
          [
            new THREE.Vector3(0, 3.8, 0),
            new THREE.Vector3(Math.cos(a) * 1.4, 5.2, Math.sin(a) * 1.4),
            new THREE.Vector3(Math.cos(a) * 2.5, 6.2, Math.sin(a) * 2.5),
          ],
          0.28,
          0.1,
          8,
          6
        )
      );
    }
    const singleTreeTrunkGeo = mergeGeometries(trunkParts, false);
    for (const p of trunkParts) p.dispose();

    for (let idx = 0; idx < treeCoords.length; idx++) {
      const [x, z, scale] = treeCoords[idx];
      const y = this.terrain.getMeadowHeight(x, z);
      if (y < WATER_LEVEL + 0.6) continue;

      const trunk = new THREE.Mesh(singleTreeTrunkGeo, this.barkMat);
      trunk.position.set(x, y, z);
      trunk.scale.setScalar(scale);
      trunk.rotation.y = idx * 1.9;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      this.group.add(trunk);

      // 4 overlapping foliage domes per scenic tree
      const crownOffsets = [
        { dx: 0, dy: 7.4, dz: 0, r: 3.1, cnt: 64 },
        { dx: -1.9, dy: 6.3, dz: 1.2, r: 2.5, cnt: 46 },
        { dx: 2.0, dy: 6.4, dz: 1.0, r: 2.5, cnt: 46 },
        { dx: 0.1, dy: 6.5, dz: -2.0, r: 2.6, cnt: 48 },
      ];
      for (const co of crownOffsets) {
        this.foliageDomes.push({
          cx: x + co.dx * scale,
          cy: y + co.dy * scale,
          cz: z + co.dz * scale,
          rx: co.r * scale,
          ry: co.r * 0.72 * scale,
          rz: co.r * scale,
          density: co.cnt,
          tintBias: (idx % 4) * 0.22,
        });
      }
    }
  }

  /**
   * Graceful sacred Celestia trees growing atop the Floating Sky Islands!
   */
  private buildSkyIslandTrees(): void {
    const trunkGeo = this.createTaperedBranchGeometry(
      [
        new THREE.Vector3(0, -0.2, 0),
        new THREE.Vector3(0.2, 2.0, 0),
        new THREE.Vector3(-0.1, 4.2, 0.1),
        new THREE.Vector3(0, 5.6, 0),
      ],
      0.46,
      0.16,
      12,
      8
    );

    for (const isl of [...this.terrain.skyIslands, ...this.terrain.stonePillars]) {
      const tx = isl.x - isl.radius * 0.42;
      const tz = isl.z - isl.radius * 0.32;
      const ty = this.terrain.getSurfaceHeight(tx, tz, isl.topY + 1.0);

      const trunk = new THREE.Mesh(trunkGeo, this.barkMat);
      trunk.position.set(tx, ty, tz);
      trunk.castShadow = true;
      this.group.add(trunk);

      this.foliageDomes.push(
        { cx: tx, cy: ty + 6.4, cz: tz, rx: 3.0, ry: 2.2, rz: 3.0, density: 75, tintBias: 0.85 },
        { cx: tx + 1.7, cy: ty + 5.5, cz: tz + 0.9, rx: 2.3, ry: 1.8, rz: 2.3, density: 50, tintBias: 0.75 },
        { cx: tx - 1.6, cy: ty + 5.6, cz: tz - 0.8, rx: 2.3, ry: 1.8, rz: 2.3, density: 50, tintBias: 0.75 }
      );
    }
  }

  /**
   * Packs ALL tree foliage domes (Great Windrise Tree + Meadow Groves + Sky Island Trees)
   * into ONE crisp GPU-instanced leaf-bouquet mesh (~7,200 cards, 1 draw call)!
   */
  private buildAllLeafBouquetCanopies(): void {
    let totalCards = 0;
    for (const d of this.foliageDomes) totalCards += d.density;

    const quad = new THREE.PlaneGeometry(1, 1);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = quad.index;
    instGeo.attributes.position = quad.attributes.position;
    instGeo.attributes.uv = quad.attributes.uv;

    const cardPosScale = new Float32Array(totalCards * 4);
    const domeNormalVar = new Float32Array(totalCards * 4);

    let cursor = 0;
    for (const d of this.foliageDomes) {
      for (let i = 0; i < d.density; i++) {
        // Fibonacci sphere + outer shell bias so crown silhouette is super lush & fluffy!
        const golden = i * 2.3999632;
        const yNorm = 1.0 - ((i + 0.5) / d.density) * 1.82; // Bias slightly toward upper crown [-0.82..+1.0]
        const radHoriz = Math.sqrt(Math.max(0, 1.0 - Math.min(1.0, yNorm * yNorm)));

        const shellR = 0.58 + 0.42 * Math.pow(Math.random(), 0.38);
        const dirX = Math.cos(golden) * radHoriz;
        const dirY = yNorm;
        const dirZ = Math.sin(golden) * radHoriz;

        const wx = d.cx + dirX * d.rx * shellR;
        const wy = d.cy + dirY * d.ry * shellR;
        const wz = d.cz + dirZ * d.rz * shellR;

        // Spherical puff normal pointing outward from dome heart (with slight upward sunlight lift!)
        const nx = dirX;
        const ny = dirY + 0.28;
        const nz = dirZ;
        const nLen = Math.hypot(nx, ny, nz) || 1.0;

        const baseCardSize = Math.min(d.rx, 5.5) * 0.44 + 0.72;

        const idx = cursor * 4;
        cardPosScale[idx] = wx;
        cardPosScale[idx + 1] = wy;
        cardPosScale[idx + 2] = wz;
        cardPosScale[idx + 3] = baseCardSize * (0.84 + Math.random() * 0.34);

        domeNormalVar[idx] = nx / nLen;
        domeNormalVar[idx + 1] = ny / nLen;
        domeNormalVar[idx + 2] = nz / nLen;
        domeNormalVar[idx + 3] = (d.tintBias + Math.random() * 0.45) % 1.0;

        cursor++;
      }
    }

    instGeo.setAttribute('aCardPosScale', new THREE.InstancedBufferAttribute(cardPosScale, 4));
    instGeo.setAttribute('aDomeNormalVar', new THREE.InstancedBufferAttribute(domeNormalVar, 4));
    instGeo.instanceCount = cursor;

    const foliageMesh = new THREE.Mesh(instGeo, this.foliageMat);
    foliageMesh.frustumCulled = false;
    this.group.add(foliageMesh);
  }

  private buildSkyViewingPavilion(): void {
    const px = -36;
    const pz = 8;
    const py = this.terrain.getMeadowHeight(px, pz);

    const pav = new THREE.Group();
    pav.position.set(px, py, pz);

    const marbleMat = new THREE.MeshStandardMaterial({ color: '#f3f1e8', roughness: 0.4 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: '#ffda85',
      emissive: '#ffae3d',
      emissiveIntensity: 0.45,
      metalness: 0.7,
      roughness: 0.25,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.8, 0.55, 24), marbleMat);
    base.position.y = 0.2;
    base.receiveShadow = true;
    pav.add(base);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.8, 12), marbleMat);
      col.position.set(Math.cos(a) * 3.4, 2.3, Math.sin(a) * 3.4);
      col.castShadow = true;
      pav.add(col);
    }

    const archRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.22, 10, 36), marbleMat);
    archRing.rotation.x = Math.PI / 2;
    archRing.position.y = 4.25;
    pav.add(archRing);

    const goldCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), goldMat);
    goldCrest.position.y = 5.2;
    pav.add(goldCrest);

    this.group.add(pav);
  }

  private buildWildflowerClusters(): void {
    const count = 2600;
    const petalGeo = new THREE.ConeGeometry(0.14, 0.08, 6);
    petalGeo.rotateX(Math.PI);

    const whiteMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const goldFlowerMat = new THREE.MeshBasicMaterial({ color: '#ffe66d' });
    const blueFlowerMat = new THREE.MeshBasicMaterial({ color: '#8ce8ff' });
    this.flowerMats = [whiteMat, goldFlowerMat, blueFlowerMat];

    const whiteInst = new THREE.InstancedMesh(petalGeo, whiteMat, Math.floor(count * 0.45));
    const goldInst = new THREE.InstancedMesh(petalGeo, goldFlowerMat, Math.floor(count * 0.35));
    const blueInst = new THREE.InstancedMesh(petalGeo, blueFlowerMat, Math.floor(count * 0.2));

    const dummy = new THREE.Object3D();
    const fillFlowers = (inst: THREE.InstancedMesh, seedOffset: number) => {
      let placed = 0;
      let tries = 0;
      while (placed < inst.count && tries < inst.count * 4) {
        tries++;
        const a = Math.random() * Math.PI * 2;
        const r = Math.pow(Math.random(), 0.65) * 95;
        const x = Math.cos(a) * r + Math.sin(seedOffset + placed) * 2;
        const z = Math.sin(a) * r - 12;
        const y = this.terrain.getMeadowHeight(x, z);
        if (y < WATER_LEVEL + 0.55 || this.terrain.getPathFactor(x, z) > 0.3) continue;

        dummy.position.set(x, y + 0.34 + Math.random() * 0.16, z);
        dummy.rotation.set(
          (Math.random() - 0.5) * 0.25,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 0.25
        );
        dummy.scale.setScalar(0.8 + Math.random() * 0.65);
        dummy.updateMatrix();
        inst.setMatrixAt(placed, dummy.matrix);
        placed++;
      }
      inst.count = placed;
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    };

    fillFlowers(whiteInst, 1.0);
    fillFlowers(goldInst, 7.0);
    fillFlowers(blueInst, 13.0);
  }

  private buildWindUpdrafts(): void {
    const coords = [
      { x: 12, z: 6 },
      { x: 15, z: -42 },
      { x: -30, z: 4 },
    ];

    const cylGeo = new THREE.CylinderGeometry(2.3, 1.6, 18, 24, 1, true);
    const windMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
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
        varying vec2 vUv;
        void main() {
          float spiral1 = sin(vUv.x * 18.8495 + vUv.y * 10.0 - uTime * 4.2);
          float spiral2 = sin(vUv.x * 12.5663 - vUv.y * 7.0 - uTime * 3.1);
          float ribbon = smoothstep(0.78, 0.98, spiral1) * 0.7 + smoothstep(0.84, 0.99, spiral2) * 0.5;
          float verticalFade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.65, 1.0, vUv.y));
          float alpha = ribbon * verticalFade * 0.48;
          if (alpha < 0.01) discard;
          vec3 col = mix(vec3(0.55, 1.0, 0.88), vec3(0.88, 1.0, 1.0), vUv.y);
          gl_FragColor = vec4(col * 1.25, alpha);
        }
      `,
    });

    for (const c of coords) {
      const groundY = this.terrain.getMeadowHeight(c.x, c.z);
      this.updrafts.push({
        x: c.x,
        y: groundY,
        z: c.z,
        radius: 3.0,
        height: 28,
      });

      const mesh = new THREE.Mesh(cylGeo, windMat);
      mesh.position.set(c.x, groundY + 9.0, c.z);
      this.windRibbonMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private createFallingLeavesMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vAlpha;
        varying float vPhase;
        void main() {
          vPhase = aPhase;
          vec3 p = position;
          float fall = mod(uTime * 1.15 + aPhase * 18.0, 18.0);
          p.y -= fall;
          p.x += sin(uTime * 1.2 + aPhase * 6.28) * 3.2;
          p.z += cos(uTime * 0.95 + aPhase * 6.28) * 3.2;

          vAlpha = smoothstep(0.0, 2.2, fall) * (1.0 - smoothstep(14.5, 18.0, fall));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(105.0 / max(-mv.z, 1.0), 2.5, 16.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vAlpha;
        varying float vPhase;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float ang = uTime * 1.8 + vPhase * 6.28;
          float c = cos(ang);
          float s = sin(ang);
          vec2 ruv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

          float leaf = 1.0 - smoothstep(0.16, 0.30, abs(ruv.x) * 1.9 + abs(ruv.y) * 0.85);
          if (leaf * vAlpha < 0.02) discard;
          vec3 col = mix(vec3(0.56, 1.22, 0.82), vec3(0.95, 1.25, 0.72), fract(vPhase * 7.3));
          gl_FragColor = vec4(col, leaf * vAlpha * 0.88);
        }
      `,
    });
  }

  private buildFallingLeaves(): THREE.Points {
    const count = 340;
    const pos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const treeBaseY = this.terrain.getMeadowHeight(0, -58);

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 17.5;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = treeBaseY + 17 + Math.random() * 6;
      pos[i * 3 + 2] = -58 + Math.sin(a) * r;
      phases[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    return new THREE.Points(geo, this.leafParticleMat);
  }

  public isInsideUpdraft(pos: THREE.Vector3): boolean {
    for (const u of this.updrafts) {
      const d = Math.hypot(pos.x - u.x, pos.z - u.z);
      if (d <= u.radius && pos.y >= u.y - 0.5 && pos.y <= u.y + u.height) {
        return true;
      }
    }
    return false;
  }

  public update(elapsed: number, lighting: SkyLightingState): void {
    const u = this.foliageMat.uniforms;
    u.uTime.value = elapsed;
    u.uSunDir.value.copy(lighting.sunDirection);
    u.uSunColor.value.copy(lighting.sunColor);
    u.uFogColor.value.copy(lighting.fogColor);

    u.uTopLitColor.value
      .set('#a8f76d')
      .lerp(new THREE.Color('#ffc966'), lighting.sunsetFactor * 0.65)
      .lerp(new THREE.Color('#398e96'), lighting.nightFactor * 0.85);

    u.uMidLeafColor.value
      .set('#38c468')
      .lerp(new THREE.Color('#8f8245'), lighting.sunsetFactor * 0.55)
      .lerp(new THREE.Color('#164b57'), lighting.nightFactor * 0.86);

    u.uDeepLeafColor.value
      .set('#186b57')
      .lerp(new THREE.Color('#3d385c'), lighting.sunsetFactor * 0.6)
      .lerp(new THREE.Color('#092036'), lighting.nightFactor * 0.88);

    // Sunbeams by day -> Ethereal Silver-Cyan Moonbeams under the Great Tree at night!
    this.sunbeamMat.uniforms.uTime.value = elapsed;
    this.sunbeamMat.uniforms.uColor.value
      .set('#fff5cc')
      .lerp(new THREE.Color('#ffa859'), lighting.sunsetFactor)
      .lerp(new THREE.Color('#78c4ff'), lighting.nightFactor);
    this.sunbeamMat.uniforms.uStrength.value = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(0.24, 0.34, lighting.sunsetFactor),
      0.19,
      lighting.nightFactor
    );

    // Bioluminescent Cecilia & Starflowers glowing softly across the night meadow!
    if (this.flowerMats.length === 3) {
      const glowBoost = 1.0 + lighting.nightFactor * 0.38;
      this.flowerMats[0].color.setRGB(0.95 * glowBoost, 1.0 * glowBoost, 1.05 * glowBoost);
      this.flowerMats[1].color.setRGB(1.05 * glowBoost, 0.90 * glowBoost, 0.45 * glowBoost);
      this.flowerMats[2].color.setRGB(0.50 * glowBoost, 0.95 * glowBoost, 1.12 * glowBoost);
    }

    if (this.windRibbonMeshes.length > 0) {
      (this.windRibbonMeshes[0].material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
    }
    this.leafParticleMat.uniforms.uTime.value = elapsed;
  }
}
