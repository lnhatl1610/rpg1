import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm';
import { AvatarExpression, FlightMode, PhotoPose } from '../types';
import { SkyLightingState } from '../world/SkyAndClouds';
import { WingVFX } from './WingVFX';

interface RibbonChain {
  nodes: THREE.Vector3[];
  prevNodes: THREE.Vector3[];
  geo: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  anchorOffset: THREE.Vector3;
}

export class AnimeAvatar {
  public root = new THREE.Group();
  private tiltContainer = new THREE.Group();
  private fallbackGroup = new THREE.Group();

  public vrm: VRM | null = null;
  public wingVFX: WingVFX;
  public avatarName = 'Alicia Celestia';

  private loader: GLTFLoader;
  private maxAnisotropy = 8;

  // Soft anime portrait fill light so her face & eyes always sparkle even when backlit!
  private faceFillLight: THREE.PointLight;

  // Lumine-style glowing 5-petal starlight hair ornament
  private hairFlower: THREE.Group;

  // Twin Verlet-physics flowing celestial silk ribbons!
  private ribbons: RibbonChain[] = [];
  private ribbonMat: THREE.ShaderMaterial;
  private readonly ribbonNodesCount = 14;
  private readonly ribbonSegLen = 0.078;

  private animPhase = 0;
  private blinkTimer = 2.4;
  private blinkProgress = -1;
  private currentExpression: AvatarExpression = 'happy';
  public photoPose: PhotoPose = 'none';

  private baseOutlineWidths = new WeakMap<any, number>();

  constructor(maxAnisotropy: number) {
    this.maxAnisotropy = maxAnisotropy;
    this.root.add(this.tiltContainer);

    this.wingVFX = new WingVFX();
    this.tiltContainer.add(this.wingVFX.wingRoot);

    this.faceFillLight = new THREE.PointLight('#fff6ed', 0.52, 3.2, 1.6);
    this.faceFillLight.castShadow = false;
    this.root.add(this.faceFillLight);

    this.hairFlower = this.createInteyvatHairFlower();

    this.ribbonMat = this.createSilkRibbonMaterial();
    this.initFlowingSilkRibbons();

    this.buildStylizedPlaceholder();
    this.tiltContainer.add(this.fallbackGroup);

    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
  }

  /**
   * Sculpted Lumine-inspired 5-petal glowing white & gold Inteyvat hair flower!
   */
  private createInteyvatHairFlower(): THREE.Group {
    const g = new THREE.Group();
    const petalMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#bdeeff',
      emissiveIntensity: 0.45,
      roughness: 0.25,
    });
    const stamenMat = new THREE.MeshStandardMaterial({
      color: '#ffe89c',
      emissive: '#ffc44d',
      emissiveIntensity: 1.1,
      metalness: 0.6,
      roughness: 0.2,
    });

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petalGeo = new THREE.ConeGeometry(0.018, 0.048, 6);
      petalGeo.scale(1.0, 1.0, 0.32);
      petalGeo.translate(0, 0.026, 0);

      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.rotation.z = a;
      petal.rotation.x = 0.22;
      g.add(petal);
    }

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 10), stamenMat);
    core.position.z = 0.006;
    g.add(core);

    return g;
  }

  private createSilkRibbonMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
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
          // Tapered swallowtail silk ribbon silhouette
          float edgeDist = abs(vUv.y - 0.5) * 2.0;
          float widthTaper = mix(0.65, 1.0, smoothstep(0.0, 0.3, vUv.x)) * (1.0 - smoothstep(0.78, 1.0, vUv.x) * 0.65);
          if (edgeDist > widthTaper) discard;

          // Translucent celestial pearl -> azure -> champagne gold trim!
          vec3 topPearl = vec3(0.96, 0.98, 1.02);
          vec3 midAzure = vec3(0.42, 0.78, 1.04);
          vec3 tipStar  = vec3(0.68, 0.96, 1.12);

          vec3 col = mix(topPearl, midAzure, smoothstep(0.08, 0.62, vUv.x));
          col = mix(col, tipStar, smoothstep(0.68, 1.0, vUv.x));

          // Delicate golden filigree border along ribbon edges!
          float goldBorder = smoothstep(widthTaper - 0.18, widthTaper, edgeDist);
          col = mix(col, vec3(1.18, 0.98, 0.58), goldBorder * 0.85);

          // Shimmering starlight wave
          col += vec3(0.18, 0.24, 0.32) * (0.5 + 0.5 * sin(vUv.x * 12.0 - uTime * 3.2));

          float alpha = mix(0.86, 0.32, smoothstep(0.55, 1.0, vUv.x));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
  }

  private initFlowingSilkRibbons(): void {
    const anchors = [
      new THREE.Vector3(0.11, 1.22, -0.10),
      new THREE.Vector3(-0.11, 1.22, -0.10),
    ];

    for (const anchorOffset of anchors) {
      const n = this.ribbonNodesCount;
      const nodes: THREE.Vector3[] = [];
      const prevNodes: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const p = new THREE.Vector3(anchorOffset.x, anchorOffset.y - i * this.ribbonSegLen, anchorOffset.z);
        nodes.push(p);
        prevNodes.push(p.clone());
      }

      const verts = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];

      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        uvs[i * 4] = u;
        uvs[i * 4 + 1] = 0;
        uvs[i * 4 + 2] = u;
        uvs[i * 4 + 3] = 1;
        if (i < n - 1) {
          const b = i * 2;
          indices.push(b, b + 1, b + 2);
          indices.push(b + 1, b + 3, b + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);

      const mesh = new THREE.Mesh(geo, this.ribbonMat);
      mesh.frustumCulled = false;
      this.wingVFX.worldGroup.add(mesh);

      this.ribbons.push({ nodes, prevNodes, geo, mesh, anchorOffset });
    }
  }

  private updateFlowingRibbons(dt: number, elapsed: number, velocity: THREE.Vector3): void {
    this.ribbonMat.uniforms.uTime.value = elapsed;
    const stepDt = Math.min(dt, 0.033);

    const windX = Math.sin(elapsed * 2.1) * 1.6 + 0.85;
    const windZ = Math.cos(elapsed * 1.7) * 1.2 + 0.55;

    for (let rIdx = 0; rIdx < this.ribbons.length; rIdx++) {
      const r = this.ribbons[rIdx];
      const worldAnchor = r.anchorOffset.clone();
      this.tiltContainer.localToWorld(worldAnchor);

      // Reset chain cleanly if teleported far
      if (r.nodes[0].distanceToSquared(worldAnchor) > 9.0) {
        for (let i = 0; i < r.nodes.length; i++) {
          r.nodes[i].copy(worldAnchor).y -= i * this.ribbonSegLen;
          r.prevNodes[i].copy(r.nodes[i]);
        }
      }

      r.nodes[0].copy(worldAnchor);
      r.prevNodes[0].copy(worldAnchor);

      // Verlet integration with gravity + meadow wind + flutter
      for (let i = 1; i < r.nodes.length; i++) {
        const cur = r.nodes[i];
        const prev = r.prevNodes[i];

        const vx = (cur.x - prev.x) * 0.90;
        const vy = (cur.y - prev.y) * 0.90;
        const vz = (cur.z - prev.z) * 0.90;

        prev.copy(cur);

        const flutter = Math.sin(elapsed * 4.8 - i * 0.55 + rIdx * 2.1) * 1.4;
        const ax = windX + flutter - velocity.x * 0.18;
        const ay = -5.8 + Math.min(3.5, velocity.length() * 0.25);
        const az = windZ + flutter * 0.6 - velocity.z * 0.18;

        cur.x += vx + ax * stepDt * stepDt;
        cur.y += vy + ay * stepDt * stepDt;
        cur.z += vz + az * stepDt * stepDt;
      }

      // Distance constraint relaxation (3 iterations for silky cloth feel)
      for (let iter = 0; iter < 3; iter++) {
        r.nodes[0].copy(worldAnchor);
        for (let i = 0; i < r.nodes.length - 1; i++) {
          const a = r.nodes[i];
          const b = r.nodes[i + 1];
          const diff = b.clone().sub(a);
          const dist = Math.max(diff.length(), 1e-4);
          const corr = (dist - this.ribbonSegLen) / dist;
          if (i === 0) {
            b.addScaledVector(diff, -corr);
          } else {
            a.addScaledVector(diff, corr * 0.5);
            b.addScaledVector(diff, -corr * 0.5);
          }
        }
      }

      // Build ribbon triangle strip oriented cleanly across camera/side vector
      const posAttr = r.geo.attributes.position as THREE.BufferAttribute;
      const sideVec = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);

      for (let i = 0; i < r.nodes.length; i++) {
        const p = r.nodes[i];
        const t = i / (r.nodes.length - 1);
        const halfW = 0.044 * (0.75 + 0.45 * Math.sin(t * Math.PI * 0.75));
        const twist = Math.sin(elapsed * 2.4 - t * 3.0 + rIdx) * 0.015;

        posAttr.setXYZ(
          i * 2,
          p.x + sideVec.x * halfW,
          p.y + twist,
          p.z + sideVec.z * halfW
        );
        posAttr.setXYZ(
          i * 2 + 1,
          p.x - sideVec.x * halfW,
          p.y - twist,
          p.z - sideVec.z * halfW
        );
      }
      posAttr.needsUpdate = true;
    }
  }

  private buildStylizedPlaceholder(): void {
    const skinMat = new THREE.MeshToonMaterial({ color: '#ffefe6' });
    const dressMat = new THREE.MeshToonMaterial({ color: '#f2f5ff' });
    const accentMat = new THREE.MeshToonMaterial({ color: '#5ca4ff' });
    const hairMat = new THREE.MeshToonMaterial({ color: '#f7e6b5' });

    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 20), dressMat);
    skirt.position.y = 0.72;
    skirt.castShadow = true;

    const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.36, 16), accentMat);
    bodice.position.y = 1.12;
    bodice.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 24), skinMat);
    head.position.y = 1.44;
    head.castShadow = true;

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.162, 24, 24), hairMat);
    hair.position.set(0, 1.46, -0.02);

    this.fallbackGroup.add(skirt, bodice, head, hair);
  }

  public async loadFromUrl(url: string, label = 'Alicia Celestia'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const loadedVrm = gltf.userData.vrm as VRM | undefined;
          if (!loadedVrm) {
            reject(new Error('File không chứa dữ liệu VRM hợp lệ.'));
            return;
          }
          this.mountVRM(loadedVrm, label);
          resolve();
        },
        undefined,
        (err) => {
          reject(err);
        }
      );
    });
  }

  public async loadFromFile(file: File): Promise<void> {
    const blobUrl = URL.createObjectURL(file);
    try {
      const cleanName = file.name.replace(/\.vrm$/i, '');
      await this.loadFromUrl(blobUrl, cleanName);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  private mountVRM(newVrm: VRM, label: string): void {
    if (this.hairFlower.parent) {
      this.hairFlower.parent.remove(this.hairFlower);
    }

    if (this.vrm) {
      this.tiltContainer.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }

    VRMUtils.removeUnnecessaryVertices(newVrm.scene);
    VRMUtils.combineMorphs(newVrm);
    VRMUtils.rotateVRM0(newVrm);

    newVrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const n = mesh.name.toLowerCase();
        const isFaceOrEye =
          n.includes('face') || n.includes('eye') || n.includes('head') || n.includes('brow') || n.includes('mouth');

        mesh.castShadow = true;
        mesh.receiveShadow = false; // Clean Genshin cel-shading without self-shadow blotches on her dress/legs/face!

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats as any[]) {
          if (!m) continue;

          for (const key of [
            'map',
            'shadeMultiplyTexture',
            'emissiveMap',
            'normalMap',
            'matcapTexture',
            'rimMultiplyTexture',
          ]) {
            const tex = m[key] as THREE.Texture | undefined;
            if (tex && tex.isTexture) {
              tex.anisotropy = this.maxAnisotropy;
              tex.needsUpdate = true;
            }
          }

          if (m.isMToonMaterial) {
            const matName = (m.name || '').toLowerCase();
            const isSkinOrFace =
              isFaceOrEye || matName.includes('skin') || matName.includes('face') || matName.includes('body');
            const isEyeHighlight = matName.includes('highlight') || matName.includes('iris') || matName.includes('eye');

            // Luminous porcelain anime skin with soft peach-rose cel shadow!
            if (isSkinOrFace && m.shadeColorFactor?.isColor) {
              m.shadeColorFactor.lerp(new THREE.Color('#f7c8c6'), 0.55);
            }

            if (isEyeHighlight && m.emissive?.isColor) {
              m.emissive.set('#ffffff');
              m.emissiveIntensity = matName.includes('highlight') ? 0.55 : 0.14;
            }

            if (m.shadingShiftFactor !== undefined) {
              m.shadingShiftFactor = isSkinOrFace ? 0.14 : 0.03;
            }
            if (m.shadingToonyFactor !== undefined) {
              m.shadingToonyFactor = isSkinOrFace ? 0.93 : 0.88;
            }
            if (m.parametricRimFresnelPowerFactor !== undefined) {
              m.parametricRimFresnelPowerFactor = 4.0;
            }
            if (m.parametricRimLiftFactor !== undefined) {
              m.parametricRimLiftFactor = 0.08;
            }
            if (m.parametricRimColorFactor?.isColor) {
              m.parametricRimColorFactor.set('#fff4dc');
            }
            if (m.outlineWidthFactor !== undefined) {
              if (!this.baseOutlineWidths.has(m)) {
                this.baseOutlineWidths.set(m, m.outlineWidthFactor * 0.78);
                m.outlineWidthFactor *= 0.78; // Extra delicate fine anime line-art!
              }
            }
          }
        }
      }
    });

    this.vrm = newVrm;
    const metaTitle =
      newVrm.meta?.metaVersion === '1'
        ? newVrm.meta.name
        : newVrm.meta?.metaVersion === '0'
        ? newVrm.meta.title
        : undefined;
    this.avatarName = label || metaTitle || 'Alicia Celestia';
    this.fallbackGroup.visible = false;
    this.tiltContainer.add(newVrm.scene);

    // Attach glowing 5-petal Inteyvat flower onto her Head bone!
    const rawHead = newVrm.humanoid?.getRawBoneNode(VRMHumanBoneName.Head);
    if (rawHead) {
      const fSign = newVrm.meta?.metaVersion === '0' ? -1 : 1;
      this.hairFlower.position.set(0.092 * fSign, 0.115, 0.032 * fSign);
      this.hairFlower.rotation.set(0.15 * fSign, fSign > 0 ? 0.55 : Math.PI - 0.55, -0.25 * fSign);
      rawHead.add(this.hairFlower);
    }

    // Apply soft feminine finger pose so hands never look stiff!
    this.applyGracefulFingerCurl(newVrm);

    this.setExpression(this.currentExpression);
  }

  private applyGracefulFingerCurl(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;
    const s = vrm.meta?.metaVersion === '0' ? -1 : 1;

    const fingerCurlSpecs: Array<[VRMHumanBoneName, VRMHumanBoneName, number, number]> = [
      [VRMHumanBoneName.LeftIndexProximal, VRMHumanBoneName.RightIndexProximal, 0.18, 0],
      [VRMHumanBoneName.LeftIndexIntermediate, VRMHumanBoneName.RightIndexIntermediate, 0.24, 0],
      [VRMHumanBoneName.LeftMiddleProximal, VRMHumanBoneName.RightMiddleProximal, 0.26, 0],
      [VRMHumanBoneName.LeftMiddleIntermediate, VRMHumanBoneName.RightMiddleIntermediate, 0.32, 0],
      [VRMHumanBoneName.LeftRingProximal, VRMHumanBoneName.RightRingProximal, 0.34, 0],
      [VRMHumanBoneName.LeftRingIntermediate, VRMHumanBoneName.RightRingIntermediate, 0.40, 0],
      [VRMHumanBoneName.LeftLittleProximal, VRMHumanBoneName.RightLittleProximal, 0.42, 0],
      [VRMHumanBoneName.LeftLittleIntermediate, VRMHumanBoneName.RightLittleIntermediate, 0.46, 0],
    ];

    for (const [lName, rName, curl] of fingerCurlSpecs) {
      const lNode = h.getNormalizedBoneNode(lName);
      const rNode = h.getNormalizedBoneNode(rName);
      if (lNode) lNode.rotation.z = -curl * s;
      if (rNode) rNode.rotation.z = curl * s;
    }

    const lThumb = h.getNormalizedBoneNode(VRMHumanBoneName.LeftThumbProximal);
    const rThumb = h.getNormalizedBoneNode(VRMHumanBoneName.RightThumbProximal);
    if (lThumb) {
      lThumb.rotation.y = -0.35;
      lThumb.rotation.z = -0.18 * s;
    }
    if (rThumb) {
      rThumb.rotation.y = 0.35;
      rThumb.rotation.z = 0.18 * s;
    }
  }

  public setOutlineScale(scale: number): void {
    if (!this.vrm) return;
    this.vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats as any[]) {
          if (m?.isMToonMaterial && this.baseOutlineWidths.has(m)) {
            m.outlineWidthFactor = this.baseOutlineWidths.get(m)! * scale;
          }
        }
      }
    });
  }

  public setExpression(expr: AvatarExpression): void {
    this.currentExpression = expr;
    const em = this.vrm?.expressionManager;
    if (!em) return;

    for (const name of ['happy', 'relaxed', 'surprised', 'sad', 'angry', 'blinkLeft', 'blinkRight']) {
      em.setValue(name, 0);
    }

    switch (expr) {
      case 'happy':
        em.setValue('happy', 0.56);
        break;
      case 'relaxed':
        em.setValue('relaxed', 0.75);
        break;
      case 'wink':
        em.setValue('happy', 0.35);
        em.setValue('blinkRight', 1.0);
        break;
      case 'surprised':
        em.setValue('surprised', 0.72);
        break;
      case 'neutral':
      default:
        em.setValue('relaxed', 0.16);
        break;
    }
  }

  private updateHumanoidPose(
    dt: number,
    elapsed: number,
    mode: FlightMode,
    planarSpeed: number,
    isSprinting: boolean,
    isBoosting: boolean
  ): void {
    if (!this.vrm?.humanoid) return;

    const h = this.vrm.humanoid;
    const s = this.vrm.meta?.metaVersion === '0' ? -1 : 1;
    const bone = (name: VRMHumanBoneName) => h.getNormalizedBoneNode(name);

    const hips = bone(VRMHumanBoneName.Hips);
    const spine = bone(VRMHumanBoneName.Spine);
    const chest = bone(VRMHumanBoneName.Chest);
    const neck = bone(VRMHumanBoneName.Neck);
    const head = bone(VRMHumanBoneName.Head);

    const lShoulder = bone(VRMHumanBoneName.LeftShoulder);
    const rShoulder = bone(VRMHumanBoneName.RightShoulder);
    const lUpperArm = bone(VRMHumanBoneName.LeftUpperArm);
    const rUpperArm = bone(VRMHumanBoneName.RightUpperArm);
    const lLowerArm = bone(VRMHumanBoneName.LeftLowerArm);
    const rLowerArm = bone(VRMHumanBoneName.RightLowerArm);
    const lHand = bone(VRMHumanBoneName.LeftHand);
    const rHand = bone(VRMHumanBoneName.RightHand);

    const lUpperLeg = bone(VRMHumanBoneName.LeftUpperLeg);
    const rUpperLeg = bone(VRMHumanBoneName.RightUpperLeg);
    const lLowerLeg = bone(VRMHumanBoneName.LeftLowerLeg);
    const rLowerLeg = bone(VRMHumanBoneName.RightLowerLeg);
    const lFoot = bone(VRMHumanBoneName.LeftFoot);
    const rFoot = bone(VRMHumanBoneName.RightFoot);

    const lerpRot = (
      node: THREE.Object3D | null,
      rx: number,
      ry: number,
      rz: number,
      rate = 11.0
    ) => {
      if (!node) return;
      const alpha = 1.0 - Math.exp(-rate * dt);
      node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, rx, alpha);
      node.rotation.y = THREE.MathUtils.lerp(node.rotation.y, ry, alpha);
      node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, rz, alpha);
    };

    // Gentle feminine shoulder drop
    lerpRot(lShoulder, 0, 0, -0.08 * s, 8);
    lerpRot(rShoulder, 0, 0, 0.08 * s, 8);

    if (this.photoPose !== 'none') {
      const breath = Math.sin(elapsed * 2.0) * 0.03;
      if (this.photoPose === 'peace') {
        lerpRot(spine, 0.04 * s, 0.08, -0.05 * s);
        lerpRot(head, -0.05 * s, -0.1, 0.09 * s);
        lerpRot(rUpperArm, -0.75 * s, 0.3, 0.55 * s);
        lerpRot(rLowerArm, -0.85 * s, 0, 0.35 * s);
        lerpRot(lUpperArm, 0.1 * s, 0, (-1.18 + breath) * s);
        lerpRot(lLowerArm, -0.22 * s, 0, 0);
        lerpRot(lUpperLeg, -0.06 * s, 0, 0.03 * s);
        lerpRot(rUpperLeg, 0.08 * s, 0, -0.03 * s);
        lerpRot(rLowerLeg, 0.25 * s, 0, 0);
      } else if (this.photoPose === 'stargaze') {
        lerpRot(spine, -0.12 * s, 0, 0);
        lerpRot(chest, -0.1 * s, 0, 0);
        lerpRot(head, -0.32 * s, 0.08, 0.04 * s);
        lerpRot(lUpperArm, -0.35 * s, 0.25, -0.82 * s);
        lerpRot(rUpperArm, -0.35 * s, -0.25, 0.82 * s);
        lerpRot(lLowerArm, -0.95 * s, 0, -0.25 * s);
        lerpRot(rLowerArm, -0.95 * s, 0, 0.25 * s);
      } else if (this.photoPose === 'twirl') {
        lerpRot(spine, 0.05 * s, 0.22, 0.06 * s);
        lerpRot(head, -0.04 * s, -0.18, -0.06 * s);
        lerpRot(lUpperArm, -0.15 * s, 0, -0.58 * s);
        lerpRot(rUpperArm, 0.15 * s, 0, 0.52 * s);
        lerpRot(lLowerArm, -0.25 * s, 0, -0.15 * s);
        lerpRot(rLowerArm, -0.35 * s, 0, 0.15 * s);
        lerpRot(lUpperLeg, -0.12 * s, 0, 0.02 * s);
        lerpRot(rUpperLeg, 0.24 * s, 0, -0.02 * s);
        lerpRot(rLowerLeg, 0.55 * s, 0, 0);
      } else if (this.photoPose === 'float') {
        lerpRot(spine, -0.08 * s, 0, 0);
        lerpRot(head, -0.12 * s, 0, 0.05 * s);
        lerpRot(lUpperArm, 0.12 * s, 0, (-0.65 + breath * 2.0) * s);
        lerpRot(rUpperArm, 0.12 * s, 0, (0.65 - breath * 2.0) * s);
        lerpRot(lUpperLeg, -0.18 * s, 0, 0.02 * s);
        lerpRot(rUpperLeg, 0.08 * s, 0, -0.02 * s);
        lerpRot(lLowerLeg, 0.45 * s, 0, 0);
        lerpRot(rLowerLeg, 0.28 * s, 0, 0);
      } else {
        lerpRot(spine, 0.02 * s, -0.1, 0.04 * s);
        lerpRot(head, 0.05 * s, 0.12, -0.06 * s);
        lerpRot(lUpperArm, -0.62 * s, 0.2, -0.75 * s);
        lerpRot(lLowerArm, -1.05 * s, 0, -0.25 * s);
        lerpRot(rUpperArm, 0.08 * s, 0, 1.18 * s);
        lerpRot(rLowerArm, -0.18 * s, 0, 0);
      }
      return;
    }

    if (mode === 'gliding' || mode === 'flying') {
      const hoverWave = Math.sin(elapsed * 2.6) * 0.05;
      const forwardLean = isBoosting ? 0.56 : mode === 'flying' ? 0.32 : 0.20;

      lerpRot(hips, forwardLean * s, 0, 0, 8);
      lerpRot(spine, -0.12 * s, 0, 0, 8);
      lerpRot(chest, -0.10 * s, 0, 0, 8);
      lerpRot(neck, -0.12 * s, 0, 0, 8);
      lerpRot(head, (isBoosting ? -0.26 : -0.14) * s, 0, 0, 8);

      const armSpread = isBoosting ? 0.88 : 0.56;
      const armSweepBack = isBoosting ? 0.48 : 0.24;
      lerpRot(lUpperArm, armSweepBack * s, -0.18, (-armSpread + hoverWave) * s, 9);
      lerpRot(rUpperArm, armSweepBack * s, 0.18, (armSpread - hoverWave) * s, 9);
      lerpRot(lLowerArm, -0.26 * s, 0, -0.14 * s, 9);
      lerpRot(rLowerArm, -0.26 * s, 0, 0.14 * s, 9);
      lerpRot(lHand, 0.12 * s, 0, -0.18 * s, 9);
      lerpRot(rHand, 0.12 * s, 0, 0.18 * s, 9);

      lerpRot(lUpperLeg, (0.14 + hoverWave * 0.5) * s, 0, 0.03 * s, 8);
      lerpRot(rUpperLeg, (-0.06 - hoverWave * 0.5) * s, 0, -0.03 * s, 8);
      lerpRot(lLowerLeg, (isBoosting ? 0.22 : 0.55) * s, 0, 0, 8);
      lerpRot(rLowerLeg, (isBoosting ? 0.16 : 0.28) * s, 0, 0, 8);
      lerpRot(lFoot, 0.40 * s, 0, 0, 8);
      lerpRot(rFoot, 0.36 * s, 0, 0, 8);

      if (hips) {
        hips.position.y = THREE.MathUtils.lerp(
          hips.position.y,
          Math.sin(elapsed * 2.6) * 0.04,
          1.0 - Math.exp(-8 * dt)
        );
      }
      return;
    }

    if (mode === 'jumping') {
      lerpRot(hips, 0.08 * s, 0, 0);
      lerpRot(spine, -0.06 * s, 0, 0);
      lerpRot(lUpperArm, -0.25 * s, 0, -0.72 * s);
      lerpRot(rUpperArm, -0.25 * s, 0, 0.72 * s);
      lerpRot(lLowerArm, -0.45 * s, 0, 0);
      lerpRot(rLowerArm, -0.45 * s, 0, 0);
      lerpRot(lUpperLeg, -0.32 * s, 0, 0.02 * s);
      lerpRot(rUpperLeg, 0.12 * s, 0, -0.02 * s);
      lerpRot(lLowerLeg, 0.62 * s, 0, 0);
      lerpRot(rLowerLeg, 0.35 * s, 0, 0);
      return;
    }

    if (planarSpeed < 0.25) {
      // Poised, feminine Genshin Impact idle stance!
      const breath = Math.sin(elapsed * 1.85);
      const sway = Math.sin(elapsed * 0.8);

      lerpRot(hips, -0.02 * s, 0.06 + sway * 0.025, (0.03 + sway * 0.02) * s, 7);
      lerpRot(spine, (-0.03 + breath * 0.018) * s, -0.04 - sway * 0.02, -0.025 * s, 7);
      lerpRot(chest, breath * 0.022 * s, 0, 0, 7);
      lerpRot(neck, 0, sway * 0.035, 0, 7);
      lerpRot(head, Math.sin(elapsed * 1.1) * 0.025 * s, -0.03 + sway * 0.055, 0.035 * s, 7);

      // Softly draped feminine arms & wrists
      lerpRot(lUpperArm, 0.05 * s, 0.08, (-1.24 + breath * 0.02) * s, 8);
      lerpRot(rUpperArm, -0.04 * s, -0.08, (1.22 - breath * 0.02) * s, 8);
      lerpRot(lLowerArm, -0.22 * s, 0, -0.06 * s, 8);
      lerpRot(rLowerArm, -0.26 * s, 0, 0.06 * s, 8);
      lerpRot(lHand, 0.04 * s, 0, -0.10 * s, 8);
      lerpRot(rHand, 0.04 * s, 0, 0.10 * s, 8);

      // Graceful contrapposto leg poise
      lerpRot(lUpperLeg, -0.03 * s, 0.04, 0.025 * s, 8);
      lerpRot(rUpperLeg, 0.06 * s, -0.05, -0.025 * s, 8);
      lerpRot(lLowerLeg, 0.04 * s, 0, 0, 8);
      lerpRot(rLowerLeg, 0.12 * s, 0, 0, 8);
      lerpRot(lFoot, 0, 0, 0, 8);
      lerpRot(rFoot, -0.04 * s, 0, 0, 8);

      if (hips) {
        hips.position.y = THREE.MathUtils.lerp(hips.position.y, 0, 1.0 - Math.exp(-10 * dt));
      }
    } else {
      const freq = isSprinting ? 11.2 : 8.2;
      this.animPhase += dt * freq;
      const p = this.animPhase;

      const stride = isSprinting ? 0.70 : 0.46;
      const kneeAmp = isSprinting ? 0.96 : 0.66;
      const armSwing = isSprinting ? 0.66 : 0.40;
      const lean = isSprinting ? 0.20 : 0.08;

      const lSwing = Math.sin(p);
      const rSwing = Math.sin(p + Math.PI);
      const bounce = Math.abs(Math.cos(p)) * (isSprinting ? 0.052 : 0.032);

      if (hips) {
        hips.position.y = bounce;
      }

      lerpRot(hips, lean * s, lSwing * 0.07, lSwing * 0.035 * s, 16);
      lerpRot(spine, lean * 0.55 * s, -lSwing * 0.09, 0, 16);
      lerpRot(chest, lean * 0.35 * s, -lSwing * 0.08, 0, 16);
      lerpRot(head, -lean * 0.85 * s, lSwing * 0.04, 0, 16);

      lerpRot(lUpperArm, rSwing * armSwing * s, 0, -1.08 * s, 16);
      lerpRot(rUpperArm, lSwing * armSwing * s, 0, 1.08 * s, 16);
      lerpRot(lLowerArm, (-0.54 - Math.max(0, -rSwing) * 0.34) * s, 0, -0.08 * s, 16);
      lerpRot(rLowerArm, (-0.54 - Math.max(0, -lSwing) * 0.34) * s, 0, 0.08 * s, 16);

      lerpRot(lUpperLeg, -lSwing * stride * s, 0, 0.02 * s, 18);
      lerpRot(rUpperLeg, -rSwing * stride * s, 0, -0.02 * s, 18);

      const lKnee = Math.max(0, -Math.cos(p)) * kneeAmp + 0.08;
      const rKnee = Math.max(0, -Math.cos(p + Math.PI)) * kneeAmp + 0.08;
      lerpRot(lLowerLeg, lKnee * s, 0, 0, 18);
      lerpRot(rLowerLeg, rKnee * s, 0, 0, 18);

      lerpRot(lFoot, lSwing * 0.22 * s, 0, 0, 18);
      lerpRot(rFoot, rSwing * 0.22 * s, 0, 0, 18);
    }
  }

  public update(
    dt: number,
    elapsed: number,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    heading: number,
    bankAngle: number,
    pitchAngle: number,
    mode: FlightMode,
    isSprinting: boolean,
    isBoosting: boolean,
    lighting: SkyLightingState,
    cameraWorldPos?: THREE.Vector3
  ): void {
    this.root.position.copy(position);
    this.root.rotation.y = heading;

    this.tiltContainer.rotation.z = bankAngle;
    this.tiltContainer.rotation.x = mode === 'flying' ? pitchAngle * 0.65 : 0;

    // Position soft anime portrait fill light slightly toward camera so her face & eyes always shine!
    if (cameraWorldPos) {
      const toCam = cameraWorldPos.clone().sub(position);
      toCam.y = 0;
      if (toCam.lengthSq() > 0.001) toCam.normalize();
      this.faceFillLight.position.set(toCam.x * 0.9, 1.52, toCam.z * 0.9);
      // Adjust fill warmth gently at sunset/night
      this.faceFillLight.color
        .set('#fff6ed')
        .lerp(new THREE.Color('#ffd9b3'), lighting.sunsetFactor * 0.6)
        .lerp(new THREE.Color('#b8d4ff'), lighting.nightFactor * 0.65);
    }

    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    const totalSpeed = velocity.length();

    this.updateHumanoidPose(dt, elapsed, mode, planarSpeed, isSprinting, isBoosting);

    // Natural eye blinking
    if (this.vrm?.expressionManager && this.currentExpression !== 'wink') {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && this.blinkProgress < 0) {
        this.blinkProgress = 0;
        this.blinkTimer = 2.8 + Math.random() * 3.4;
      }
      if (this.blinkProgress >= 0) {
        this.blinkProgress += dt * 7.5;
        const blinkVal = this.blinkProgress <= 1.0 ? Math.sin(this.blinkProgress * Math.PI) : 0;
        this.vrm.expressionManager.setValue('blink', blinkVal);
        if (this.blinkProgress >= 1.0) {
          this.vrm.expressionManager.setValue('blink', 0);
          this.blinkProgress = -1;
        }
      }
    }

    // Wind-reactive SpringBones on twin-tails, hair & pleated ruffled skirt!
    if (this.vrm?.springBoneManager) {
      const gust = 0.24 + 0.15 * Math.sin(elapsed * 2.3) + Math.min(0.58, totalSpeed * 0.025);
      const windX = Math.sin(elapsed * 1.1) * 0.36 - velocity.x * 0.04;
      const windZ = Math.cos(elapsed * 0.9) * 0.26 - velocity.z * 0.04;

      for (const joint of this.vrm.springBoneManager.joints) {
        joint.settings.gravityDir.set(windX, -1.0, windZ).normalize();
        joint.settings.gravityPower = Math.max(0.08, gust * 0.44);
      }
    }

    if (this.vrm) {
      this.vrm.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats as any[]) {
            if (m?.isMToonMaterial && m.parametricRimColorFactor?.isColor) {
              m.parametricRimColorFactor.copy(lighting.rimColor).multiplyScalar(0.88);
            }
          }
        }
      });

      this.vrm.update(Math.min(dt, 0.05));
    }

    this.updateFlowingRibbons(dt, elapsed, velocity);
    this.wingVFX.update(dt, elapsed, mode, isBoosting, totalSpeed);
  }
}
