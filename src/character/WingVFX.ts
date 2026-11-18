import * as THREE from 'three';
import { FlightMode } from '../types';

export class WingVFX {
  public wingRoot = new THREE.Group();
  public worldGroup = new THREE.Group();

  private centerCrest = new THREE.Group();
  private leftShoulderPivot = new THREE.Group();
  private rightShoulderPivot = new THREE.Group();
  private leftOuterPivot = new THREE.Group();
  private rightOuterPivot = new THREE.Group();

  private featherMat: THREE.ShaderMaterial;
  private wingOpen = 0;

  // World-space silky windtip ribbons
  private readonly trailLen = 30;
  private leftPoints: THREE.Vector3[] = [];
  private rightPoints: THREE.Vector3[] = [];
  private leftTrailGeo: THREE.BufferGeometry;
  private rightTrailGeo: THREE.BufferGeometry;
  private leftTrailMesh: THREE.Mesh;
  private rightTrailMesh: THREE.Mesh;
  private trailMat: THREE.ShaderMaterial;

  private leftTipAnchor = new THREE.Object3D();
  private rightTipAnchor = new THREE.Object3D();

  // Drifting glowing feather particles in world wake
  private wakeFeathers: THREE.Points;
  private wakePosAttr: THREE.BufferAttribute;
  private wakeData: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    maxLife: number;
  }> = [];
  private wakeSpawnTimer = 0;

  // Sonic boost shockwave ring
  private boostRing: THREE.Mesh;
  private boostRingMat: THREE.MeshBasicMaterial;
  private boostRingTimer = 99;

  constructor() {
    this.featherMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpen: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aTier; // 0 = upper covert, 1 = mid azure, 2 = long primary
        varying vec2 vUv;
        varying float vTier;
        void main() {
          vUv = uv;
          vTier = aTier;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uOpen;
        varying vec2 vUv;
        varying float vTier;

        void main() {
          // Asymmetric graceful bird/angel feather silhouette with delicate barb texture
          float y = clamp(vUv.y, 0.0, 1.0);
          float widthCurve = sin(pow(clamp(y, 1e-4, 1.0), 0.62) * 3.14159265);
          widthCurve = mix(widthCurve, 1.0 - pow(clamp(y, 1e-4, 1.0), 1.65), 0.45);

          float distFromShaft = abs(vUv.x - 0.48) * 2.05;

          // Subtle diagonal feather barbs
          float barbWave = sin((y * 42.0 - distFromShaft * 14.0)) * 0.5 + 0.5;
          float notch = smoothstep(0.92, 0.99, sin(y * 19.0 + vTier * 3.0)) * 0.08 * step(0.35, y);

          float mask = smoothstep(widthCurve - notch, (widthCurve - notch) * 0.68, distFromShaft);
          mask *= smoothstep(0.0, 0.08, y);

          float alpha = mask * uOpen;
          if (alpha < 0.015) discard;

          // Genshin Wings of Companionship / Celestia palette:
          // Champagne Ivory-Gold -> Royal Cerulean -> Luminous Starlight Cyan!
          vec3 ivoryGold = vec3(1.08, 0.98, 0.82);
          vec3 royalBlue = vec3(0.20, 0.48, 0.96);
          vec3 starCyan  = vec3(0.52, 0.94, 1.18);
          vec3 goldTrim  = vec3(1.28, 1.05, 0.58);

          vec3 col;
          if (vTier < 0.5) {
            // Upper covert row: warm champagne ivory & gold filigree
            col = mix(goldTrim, ivoryGold, smoothstep(0.15, 0.85, y));
          } else if (vTier < 1.5) {
            // Mid secondary row: royal sapphire to luminous cyan with golden tips
            col = mix(ivoryGold, royalBlue, smoothstep(0.08, 0.48, y));
            col = mix(col, starCyan, smoothstep(0.55, 0.92, y));
            col = mix(col, goldTrim, smoothstep(0.84, 0.98, y) * 0.65);
          } else {
            // Long sweeping primaries: deep celestial cobalt -> radiant turquoise -> starlight tip
            col = mix(royalBlue, vec3(0.14, 0.30, 0.78), smoothstep(0.0, 0.45, y));
            col = mix(col, starCyan * 1.12, smoothstep(0.45, 0.95, y));
          }

          // Subtle barb sheen & flowing constellation shimmer
          float shimmer = 0.90 + 0.14 * sin(y * 10.0 - uTime * 3.6 + vTier);
          col *= shimmer * (0.94 + barbWave * 0.09);

          // Crisp golden central feather shaft (rachis)
          float quill = smoothstep(0.065 * (1.0 - y * 0.65), 0.008, distFromShaft);
          col = mix(col, goldTrim * 1.15, quill * 0.88);

          // Tiny glowing diamond star-rune near primary feather tip!
          if (vTier > 1.5) {
            vec2 starUv = vec2((vUv.x - 0.48) * 5.5, (y - 0.76) * 7.5);
            float diamond = 1.0 - smoothstep(0.18, 0.35, abs(starUv.x) + abs(starUv.y));
            col += vec3(0.95, 1.05, 1.25) * diamond * 0.85;
          }

          gl_FragColor = vec4(col, alpha * 0.94);
        }
      `,
    });

    this.buildSeraphicWings();
    this.wingRoot.position.set(0, 1.25, -0.14);
    this.wingRoot.scale.setScalar(0.001);

    // Initialize world-space ribbons
    for (let i = 0; i < this.trailLen; i++) {
      this.leftPoints.push(new THREE.Vector3());
      this.rightPoints.push(new THREE.Vector3());
    }

    this.leftTrailGeo = this.createRibbonGeometry();
    this.rightTrailGeo = this.createRibbonGeometry();

    this.trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float tailFade = pow(clamp(1.0 - vUv.x, 1e-5, 1.0), 1.7);
          float alpha = edge * tailFade * uOpacity;
          if (alpha < 0.005) discard;
          vec3 col = mix(vec3(1.0, 0.96, 0.82), vec3(0.48, 0.92, 1.20), vUv.x);
          gl_FragColor = vec4(col * 1.12, alpha);
        }
      `,
    });

    this.leftTrailMesh = new THREE.Mesh(this.leftTrailGeo, this.trailMat);
    this.rightTrailMesh = new THREE.Mesh(this.rightTrailGeo, this.trailMat);
    this.leftTrailMesh.frustumCulled = false;
    this.rightTrailMesh.frustumCulled = false;
    this.leftTrailMesh.visible = false;
    this.rightTrailMesh.visible = false;
    this.worldGroup.add(this.leftTrailMesh, this.rightTrailMesh);

    // Drifting glowing light-feather wake particles
    const wakeCount = 36;
    const wakePositions = new Float32Array(wakeCount * 3);
    for (let i = 0; i < wakeCount; i++) {
      this.wakeData.push({
        pos: new THREE.Vector3(0, -999, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1.5,
      });
      wakePositions[i * 3 + 1] = -999;
    }
    const wakeGeo = new THREE.BufferGeometry();
    this.wakePosAttr = new THREE.BufferAttribute(wakePositions, 3);
    this.wakePosAttr.setUsage(THREE.DynamicDrawUsage);
    wakeGeo.setAttribute('position', this.wakePosAttr);

    const wakeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(120.0 / max(-mv.z, 1.0), 2.0, 18.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float feather = 1.0 - smoothstep(0.10, 0.28, abs(uv.x) * 2.4 + abs(uv.y) * 0.85);
          if (feather < 0.02) discard;
          gl_FragColor = vec4(vec3(0.75, 0.96, 1.25), feather * 0.78);
        }
      `,
    });
    this.wakeFeathers = new THREE.Points(wakeGeo, wakeMat);
    this.wakeFeathers.frustumCulled = false;
    this.worldGroup.add(this.wakeFeathers);

    // Sonic Wind Boost Ring
    const ringGeo = new THREE.RingGeometry(0.75, 1.08, 48);
    this.boostRingMat = new THREE.MeshBasicMaterial({
      color: '#befcff',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.boostRing = new THREE.Mesh(ringGeo, this.boostRingMat);
    this.boostRing.visible = false;
    this.worldGroup.add(this.boostRing);
  }

  /**
   * Creates a 3D cambered & curved feather geometry tagged with its plumage tier!
   */
  private createCurvedFeatherGeometry(width: number, length: number, archCurve: number, tier: number): THREE.BufferGeometry {
    const segsY = 7;
    const segsX = 2;
    const geo = new THREE.PlaneGeometry(width, length, segsX, segsY);
    geo.translate(0, length * 0.5, 0);

    const pos = geo.attributes.position;
    const tiers = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const t = y / length;

      // Graceful backward sweep + subtle 3D aerodynamic camber
      const sweepX = archCurve * t * t;
      const camberZ = -Math.abs(x) * 0.18 + Math.sin(t * Math.PI) * 0.028;

      pos.setX(i, x + sweepX);
      pos.setZ(i, camberZ);
      tiers[i] = tier;
    }

    geo.setAttribute('aTier', new THREE.BufferAttribute(tiers, 1));
    geo.computeVertexNormals();
    return geo;
  }

  private createGoldenSparGeometry(side: 1 | -1, inner: boolean): THREE.BufferGeometry {
    const curve = inner
      ? new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.05, 0.02, 0),
          new THREE.Vector3(side * 0.22, 0.24, 0.02),
          new THREE.Vector3(side * 0.48, 0.34, 0.01),
          new THREE.Vector3(side * 0.68, 0.30, -0.01),
        ])
      : new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.26, 0.06, -0.01),
          new THREE.Vector3(side * 0.52, 0.16, -0.03),
          new THREE.Vector3(side * 0.72, 0.28, -0.05),
        ]);

    return new THREE.TubeGeometry(curve, 16, inner ? 0.018 : 0.013, 8, false);
  }

  private buildSeraphicWings(): void {
    const goldFiligreeMat = new THREE.MeshStandardMaterial({
      color: '#ffebb3',
      emissive: '#ffc45c',
      emissiveIntensity: 0.65,
      metalness: 0.85,
      roughness: 0.18,
    });

    const starGemMat = new THREE.MeshStandardMaterial({
      color: '#8cf4ff',
      emissive: '#4cd8ff',
      emissiveIntensity: 1.4,
      roughness: 0.1,
    });

    // 1. Floating Celestial Back Astrolabe Emblem
    const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.01, 8, 32), goldFiligreeMat);
    const centerDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.048, 0), starGemMat);
    centerDiamond.scale.set(0.8, 1.45, 0.5);
    this.centerCrest.add(haloRing, centerDiamond);
    this.wingRoot.add(this.centerCrest);

    // 2. Build Left & Right Articulated 2-Joint Seraphic Wings
    const buildSide = (
      side: 1 | -1,
      shoulderPivot: THREE.Group,
      outerPivot: THREE.Group,
      tipAnchor: THREE.Object3D
    ) => {
      // Inner curved golden spar
      const innerSpar = new THREE.Mesh(this.createGoldenSparGeometry(side, true), goldFiligreeMat);
      shoulderPivot.add(innerSpar);

      // Shoulder ornament star
      const shoulderStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.042, 0), goldFiligreeMat);
      shoulderStar.position.set(side * 0.45, 0.33, 0.02);
      shoulderPivot.add(shoulderStar);

      // Outer wrist joint positioned at end of inner spar
      outerPivot.position.set(side * 0.66, 0.30, -0.01);
      shoulderPivot.add(outerPivot);

      const outerSpar = new THREE.Mesh(this.createGoldenSparGeometry(side, false), goldFiligreeMat);
      outerPivot.add(outerSpar);

      tipAnchor.position.set(side * 0.72, 0.28, -0.05);
      outerPivot.add(tipAnchor);

      // INNER SHOULDER PLUMAGE (Coverts + Inner Secondaries pointing gracefully down-outward)
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const fx = side * THREE.MathUtils.lerp(0.12, 0.62, t);
        const fy = THREE.MathUtils.lerp(0.08, 0.31, Math.sin(t * Math.PI * 0.65));

        // Tier 0: Short Ivory-Gold Upper Covert
        const covGeo = this.createCurvedFeatherGeometry(0.10, 0.28 + t * 0.08, side * 0.04, 0);
        const covMesh = new THREE.Mesh(covGeo, this.featherMat);
        covMesh.position.set(fx, fy, 0.012);
        covMesh.rotation.z = side * (-2.65 + t * 0.35);
        shoulderPivot.add(covMesh);

        // Tier 1: Medium Sapphire-Gold Secondary Feather
        const secGeo = this.createCurvedFeatherGeometry(0.125, 0.52 + Math.sin(t * Math.PI) * 0.14, side * 0.06, 1);
        const secMesh = new THREE.Mesh(secGeo, this.featherMat);
        secMesh.position.set(fx, fy - 0.02, -0.005);
        secMesh.rotation.z = side * (-2.72 + t * 0.42);
        shoulderPivot.add(secMesh);
      }

      // OUTER WING PLUMAGE (Sweeping Primaries + Outer Coverts fanning wide to wingtip!)
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const ox = side * THREE.MathUtils.lerp(0.02, 0.68, t);
        const oy = THREE.MathUtils.lerp(0.0, 0.26, t);

        // Outer covert
        if (i < 6) {
          const oCovGeo = this.createCurvedFeatherGeometry(0.095, 0.30 - t * 0.05, side * 0.05, 0);
          const oCov = new THREE.Mesh(oCovGeo, this.featherMat);
          oCov.position.set(ox, oy, 0.012);
          oCov.rotation.z = side * (-2.25 + t * 0.65);
          outerPivot.add(oCov);
        }

        // Tier 2: Long Majestic Sweeping Primary Flight Feather!
        const primLen = 0.74 + Math.sin(t * Math.PI * 0.82) * 0.26;
        const primGeo = this.createCurvedFeatherGeometry(0.135, primLen, side * 0.11, 2);
        const prim = new THREE.Mesh(primGeo, this.featherMat);
        prim.position.set(ox, oy - 0.01, -0.012 - i * 0.002);
        // Fan gracefully from downward (-2.3 rad) out to horizontal-swept wingtip (-1.28 rad)
        prim.rotation.z = side * THREE.MathUtils.lerp(-2.28, -1.25, t);
        prim.rotation.y = -side * 0.08;
        outerPivot.add(prim);
      }
    };

    buildSide(1, this.leftShoulderPivot, this.leftOuterPivot, this.leftTipAnchor);
    buildSide(-1, this.rightShoulderPivot, this.rightOuterPivot, this.rightTipAnchor);
    this.wingRoot.add(this.leftShoulderPivot, this.rightShoulderPivot);
  }

  private createRibbonGeometry(): THREE.BufferGeometry {
    const verts = new Float32Array(this.trailLen * 2 * 3);
    const uvs = new Float32Array(this.trailLen * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i < this.trailLen; i++) {
      const u = i / (this.trailLen - 1);
      uvs[i * 4] = u;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 1;

      if (i < this.trailLen - 1) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2);
        indices.push(b + 1, b + 3, b + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  private updateRibbonBuffer(
    geo: THREE.BufferGeometry,
    pts: THREE.Vector3[],
    headWorld: THREE.Vector3,
    width: number,
    resetAll: boolean
  ): void {
    if (resetAll) {
      for (const p of pts) p.copy(headWorld);
    } else {
      for (let i = pts.length - 1; i > 0; i--) {
        pts[i].lerp(pts[i - 1], 0.78);
      }
      pts[0].copy(headWorld);
    }

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const w = width * (1.0 - i / pts.length);
      posAttr.setXYZ(i * 2, p.x, p.y + w, p.z);
      posAttr.setXYZ(i * 2 + 1, p.x, p.y - w, p.z);
    }
    posAttr.needsUpdate = true;
  }

  public triggerBoostBurst(pos: THREE.Vector3, forwardDir: THREE.Vector3): void {
    this.boostRingTimer = 0;
    this.boostRing.visible = true;
    this.boostRing.position.copy(pos).add(new THREE.Vector3(0, 1.05, 0));
    this.boostRing.lookAt(this.boostRing.position.clone().add(forwardDir));
    this.boostRing.scale.setScalar(0.4);
  }

  public update(
    dt: number,
    elapsed: number,
    flightMode: FlightMode,
    isBoosting: boolean,
    speed: number
  ): void {
    const active = flightMode === 'gliding' || flightMode === 'flying';
    const targetOpen = active ? 1.0 : 0.0;
    const wasClosed = this.wingOpen < 0.05;

    this.wingOpen = THREE.MathUtils.lerp(
      this.wingOpen,
      targetOpen,
      1.0 - Math.exp((active ? 10.5 : 8.5) * -dt)
    );

    this.featherMat.uniforms.uTime.value = elapsed;
    this.featherMat.uniforms.uOpen.value = this.wingOpen;

    const s = Math.max(0.001, this.wingOpen);
    this.wingRoot.scale.setScalar(s);
    this.wingRoot.visible = this.wingOpen > 0.015;

    this.centerCrest.rotation.z = elapsed * 0.65;

    // Organic 2-joint wingbeat with graceful outer-tip lag!
    const flapFreq = isBoosting ? 5.2 : flightMode === 'flying' ? 2.8 : 1.5;
    const flapAmp = isBoosting ? 0.30 : flightMode === 'flying' ? 0.22 : 0.10;
    const innerFlap = Math.sin(elapsed * flapFreq) * flapAmp + (isBoosting ? -0.22 : 0.06);
    const outerFlex = Math.sin(elapsed * flapFreq - 0.65) * (flapAmp * 0.72);

    this.leftShoulderPivot.rotation.y = -innerFlap;
    this.rightShoulderPivot.rotation.y = innerFlap;
    this.leftShoulderPivot.rotation.z = Math.sin(elapsed * flapFreq) * 0.08;
    this.rightShoulderPivot.rotation.z = -Math.sin(elapsed * flapFreq) * 0.08;

    this.leftOuterPivot.rotation.y = -outerFlex;
    this.rightOuterPivot.rotation.y = outerFlex;

    // Wingtip world positions
    const leftTipWorld = new THREE.Vector3();
    const rightTipWorld = new THREE.Vector3();
    this.leftTipAnchor.getWorldPosition(leftTipWorld);
    this.rightTipAnchor.getWorldPosition(rightTipWorld);

    this.updateRibbonBuffer(
      this.leftTrailGeo,
      this.leftPoints,
      leftTipWorld,
      isBoosting ? 0.068 : 0.038,
      wasClosed && active
    );
    this.updateRibbonBuffer(
      this.rightTrailGeo,
      this.rightPoints,
      rightTipWorld,
      isBoosting ? 0.068 : 0.038,
      wasClosed && active
    );

    const targetTrailOpacity = active
      ? THREE.MathUtils.clamp((speed - 2.5) * 0.05, 0.12, isBoosting ? 0.65 : 0.36)
      : 0;
    const nextOp = THREE.MathUtils.lerp(
      this.trailMat.uniforms.uOpacity.value,
      targetTrailOpacity,
      1.0 - Math.exp(-8.0 * dt)
    );
    this.trailMat.uniforms.uOpacity.value = nextOp;
    this.leftTrailMesh.visible = nextOp > 0.008;
    this.rightTrailMesh.visible = nextOp > 0.008;

    // Spawn & drift glowing wake feathers while flying
    if (active) {
      this.wakeSpawnTimer -= dt;
      if (this.wakeSpawnTimer <= 0) {
        this.wakeSpawnTimer = isBoosting ? 0.05 : 0.12;
        const slot = this.wakeData.find((w) => w.life <= 0);
        if (slot) {
          const fromLeft = Math.random() < 0.5;
          slot.pos.copy(fromLeft ? leftTipWorld : rightTipWorld);
          slot.pos.x += (Math.random() - 0.5) * 0.4;
          slot.pos.y += (Math.random() - 0.5) * 0.3;
          slot.vel.set(
            (Math.random() - 0.5) * 0.8,
            -0.35 + Math.random() * 0.5,
            (Math.random() - 0.5) * 0.8
          );
          slot.maxLife = 1.4 + Math.random() * 0.8;
          slot.life = slot.maxLife;
        }
      }
    }

    const wArr = this.wakePosAttr.array as Float32Array;
    for (let i = 0; i < this.wakeData.length; i++) {
      const w = this.wakeData[i];
      if (w.life > 0) {
        w.life -= dt;
        w.pos.addScaledVector(w.vel, dt);
        wArr[i * 3] = w.pos.x;
        wArr[i * 3 + 1] = w.pos.y;
        wArr[i * 3 + 2] = w.pos.z;
      } else {
        wArr[i * 3 + 1] = -999;
      }
    }
    this.wakePosAttr.needsUpdate = true;

    if (this.boostRingTimer < 0.65) {
      this.boostRingTimer += dt;
      const t = this.boostRingTimer / 0.65;
      this.boostRing.scale.setScalar(0.5 + Math.pow(t, 0.55) * 3.4);
      this.boostRingMat.opacity = (1.0 - t) * 0.78;
      if (t >= 1.0) {
        this.boostRing.visible = false;
      }
    }
  }
}
