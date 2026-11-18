import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GraphicsSettings } from '../types';

const GLSL_SAFE_VEC3 = /* glsl */ `
  vec3 sanitizeHDR(vec3 c) {
    float r = (c.r >= 0.0 && c.r < 32.0) ? c.r : 0.0;
    float g = (c.g >= 0.0 && c.g < 32.0) ? c.g : 0.0;
    float b = (c.b >= 0.0 && c.b < 32.0) ? c.b : 0.0;
    return vec3(r, g, b);
  }
`;

export class PostProcessPipeline {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private msaaSceneTarget!: THREE.WebGLRenderTarget;
  private brightTarget!: THREE.WebGLRenderTarget;
  private blurTargetsH: THREE.WebGLRenderTarget[] = [];
  private blurTargetsV: THREE.WebGLRenderTarget[] = [];

  private fsQuad: FullScreenQuad;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;

  private currentSamples = 4;
  private bloomStrength = 0.36;
  private readonly mipCount = 3;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    settings: GraphicsSettings
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.bloomStrength = settings.bloomIntensity;

    const maxSamples = renderer.capabilities.maxSamples || 4;
    this.currentSamples = Math.min(settings.msaaSamples, maxSamples);

    this.brightMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: 1.05 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform float uThreshold;
        varying vec2 vUv;
        ${GLSL_SAFE_VEC3}
        void main() {
          vec3 col = sanitizeHDR(texture2D(tScene, vUv).rgb);
          float br = max(col.r, max(col.g, col.b));
          float soft = clamp(br - uThreshold + 0.25, 0.0, 0.5);
          soft = (soft * soft) / 1.0;
          float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
          gl_FragColor = vec4(col * clamp(contrib, 0.0, 1.0), 1.0);
        }
      `,
    });

    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexelSize: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput;
        uniform vec2 uDirection;
        uniform vec2 uTexelSize;
        varying vec2 vUv;
        ${GLSL_SAFE_VEC3}
        void main() {
          vec2 off1 = vec2(1.3846153846) * uDirection * uTexelSize;
          vec2 off2 = vec2(3.2307692308) * uDirection * uTexelSize;
          vec3 sum = sanitizeHDR(texture2D(tInput, vUv).rgb) * 0.2270270270;
          sum += sanitizeHDR(texture2D(tInput, vUv + off1).rgb) * 0.3162162162;
          sum += sanitizeHDR(texture2D(tInput, vUv - off1).rgb) * 0.3162162162;
          sum += sanitizeHDR(texture2D(tInput, vUv + off2).rgb) * 0.0702702703;
          sum += sanitizeHDR(texture2D(tInput, vUv - off2).rgb) * 0.0702702703;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBloom0: { value: null },
        tBloom1: { value: null },
        tBloom2: { value: null },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uBloomStrength: { value: settings.bloomIntensity },
        uSharpness: { value: settings.sharpness },
        uExposure: { value: 1.04 },
        uVignette: { value: 0.12 },
        uSaturation: { value: 1.1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tBloom0;
        uniform sampler2D tBloom1;
        uniform sampler2D tBloom2;
        uniform vec2 uResolution;
        uniform float uBloomStrength;
        uniform float uSharpness;
        uniform float uExposure;
        uniform float uVignette;
        uniform float uSaturation;
        varying vec2 vUv;

        ${GLSL_SAFE_VEC3}

        vec3 sampleBloom(vec2 uv) {
          vec3 b0 = sanitizeHDR(texture2D(tBloom0, uv).rgb);
          vec3 b1 = sanitizeHDR(texture2D(tBloom1, uv).rgb);
          vec3 b2 = sanitizeHDR(texture2D(tBloom2, uv).rgb);
          return (b0 * 0.45 + b1 * 0.35 + b2 * 0.25) * uBloomStrength;
        }

        vec3 animeTonemap(vec3 hdr) {
          vec3 x = max(vec3(0.0), hdr * uExposure);
          const float a = 2.42;
          const float b = 0.042;
          const float c = 2.38;
          const float d = 0.56;
          const float e = 0.14;
          vec3 mapped = clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);

          float luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
          float satMask = 1.0 - smoothstep(0.75, 1.0, luma) * 0.5;
          mapped = mix(vec3(luma), mapped, mix(1.0, uSaturation, satMask));

          return pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2));
        }

        vec3 evalPixel(vec2 uv, vec3 bloom) {
          vec3 hdr = sanitizeHDR(texture2D(tScene, uv).rgb) + bloom;
          return animeTonemap(hdr);
        }

        void main() {
          vec2 texel = 1.0 / max(uResolution, vec2(1.0));
          vec3 bloom = sampleBloom(vUv);

          vec3 c = evalPixel(vUv, bloom);

          if (uSharpness > 0.001) {
            vec3 n = evalPixel(vUv + vec2(0.0, -texel.y), bloom);
            vec3 s = evalPixel(vUv + vec2(0.0,  texel.y), bloom);
            vec3 w = evalPixel(vUv + vec2(-texel.x, 0.0), bloom);
            vec3 e = evalPixel(vUv + vec2( texel.x, 0.0), bloom);

            vec3 mnRGB = min(min(min(n, s), min(w, e)), c);
            vec3 mxRGB = max(max(max(n, s), max(w, e)), c);

            vec3 amp = clamp(min(mnRGB, 2.0 - mxRGB) / max(mxRGB, vec3(1e-4)), 0.0, 1.0);
            amp = sqrt(amp);

            float peak = -mix(0.0, 0.24, clamp(uSharpness, 0.0, 1.0));
            vec3 weight = amp * peak;
            vec3 rcpWeight = 1.0 / max(vec3(0.1), 1.0 + 4.0 * weight);

            c = clamp((c + (n + s + w + e) * weight) * rcpWeight, 0.0, 1.0);
          }

          if (uVignette > 0.001) {
            vec2 centered = vUv - 0.5;
            float distSq = dot(centered, centered);
            c *= mix(1.0, smoothstep(0.68, 0.14, distSq), uVignette);
          }

          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });

    this.fsQuad = new FullScreenQuad(this.compositeMat);
    this.allocateTargets();
  }

  private allocateTargets(): void {
    this.disposeTargets();

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x));
    const h = Math.max(2, Math.floor(size.y));

    // Dedicated Hardware MSAA target — ONLY cleared + rendered once per frame, never re-bound!
    this.msaaSceneTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: this.currentSamples,
      depthBuffer: true,
      stencilBuffer: false,
    });

    let bw = Math.max(2, Math.floor(w / 2));
    let bh = Math.max(2, Math.floor(h / 2));

    this.brightTarget = new THREE.WebGLRenderTarget(bw, bh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.blurTargetsH = [];
    this.blurTargetsV = [];

    for (let i = 0; i < this.mipCount; i++) {
      const rtOpts: THREE.RenderTargetOptions = {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        samples: 0,
        depthBuffer: false,
        stencilBuffer: false,
      };
      this.blurTargetsH.push(new THREE.WebGLRenderTarget(bw, bh, rtOpts));
      this.blurTargetsV.push(new THREE.WebGLRenderTarget(bw, bh, rtOpts));
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }

    this.compositeMat.uniforms.uResolution.value.set(w, h);
  }

  private disposeTargets(): void {
    this.msaaSceneTarget?.dispose();
    this.brightTarget?.dispose();
    for (const rt of this.blurTargetsH) rt.dispose();
    for (const rt of this.blurTargetsV) rt.dispose();
    this.blurTargetsH = [];
    this.blurTargetsV = [];
  }

  public updateSettings(settings: GraphicsSettings): void {
    this.bloomStrength = settings.bloomIntensity;
    this.compositeMat.uniforms.uBloomStrength.value = settings.bloomIntensity;
    this.compositeMat.uniforms.uSharpness.value = settings.sharpness;

    const maxSamples = this.renderer.capabilities.maxSamples || 4;
    const targetSamples = Math.min(settings.msaaSamples, maxSamples);

    if (targetSamples !== this.currentSamples) {
      this.currentSamples = targetSamples;
      this.allocateTargets();
    } else {
      this.resize();
    }
  }

  public setPhotoEnhancements(vignette: number, exposure = 1.04): void {
    this.compositeMat.uniforms.uVignette.value = vignette;
    this.compositeMat.uniforms.uExposure.value = exposure;
  }

  public resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x));
    const h = Math.max(2, Math.floor(size.y));

    this.msaaSceneTarget.setSize(w, h);

    let bw = Math.max(2, Math.floor(w / 2));
    let bh = Math.max(2, Math.floor(h / 2));
    this.brightTarget.setSize(bw, bh);

    for (let i = 0; i < this.mipCount; i++) {
      this.blurTargetsH[i].setSize(bw, bh);
      this.blurTargetsV[i].setSize(bw, bh);
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }

    this.compositeMat.uniforms.uResolution.value.set(w, h);
  }

  public render(): void {
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    // 1. Render 3D scene once into dedicated Hardware MSAA target
    this.renderer.setRenderTarget(this.msaaSceneTarget);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.camera);

    // 2. Extract HDR bright highlights (switching target resolves MSAA cleanly once!)
    this.brightMat.uniforms.tScene.value = this.msaaSceneTarget.texture;
    this.fsQuad.material = this.brightMat;
    this.renderer.setRenderTarget(this.brightTarget);
    this.renderer.clear(true, false, false);
    this.fsQuad.render(this.renderer);

    // 3. Progressive separable blur mips (all single-sample, zero MSAA feedback!)
    this.fsQuad.material = this.blurMat;
    let srcTex = this.brightTarget.texture;

    for (let i = 0; i < this.mipCount; i++) {
      const rtH = this.blurTargetsH[i];
      const rtV = this.blurTargetsV[i];

      this.blurMat.uniforms.uTexelSize.value.set(1 / rtH.width, 1 / rtH.height);

      this.blurMat.uniforms.tInput.value = srcTex;
      this.blurMat.uniforms.uDirection.value.set(1, 0);
      this.renderer.setRenderTarget(rtH);
      this.renderer.clear(true, false, false);
      this.fsQuad.render(this.renderer);

      this.blurMat.uniforms.tInput.value = rtH.texture;
      this.blurMat.uniforms.uDirection.value.set(0, 1);
      this.renderer.setRenderTarget(rtV);
      this.renderer.clear(true, false, false);
      this.fsQuad.render(this.renderer);

      srcTex = rtV.texture;
    }

    // 4. Composite MSAA Scene + Selective Bloom + Anime Tonemap + CAS Sharpening to Screen
    this.compositeMat.uniforms.tScene.value = this.msaaSceneTarget.texture;
    this.compositeMat.uniforms.tBloom0.value = this.blurTargetsV[0].texture;
    this.compositeMat.uniforms.tBloom1.value = this.blurTargetsV[1].texture;
    this.compositeMat.uniforms.tBloom2.value = this.blurTargetsV[2].texture;

    this.fsQuad.material = this.compositeMat;
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, false);
    this.fsQuad.render(this.renderer);

    this.renderer.autoClear = prevAutoClear;
  }

  public dispose(): void {
    this.disposeTargets();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
    this.fsQuad.dispose();
  }
}
