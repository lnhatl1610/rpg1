import * as THREE from 'three';
import {
  AvatarExpression,
  getActiveTimeSession,
  GraphicsSettings,
  HUDState,
  LandmarkInfo,
  PhotoPose,
  QUALITY_PRESETS,
  QualityPreset,
  TIME_SESSIONS,
} from '../types';
import { createSeamlessNoiseTexture } from '../utils/noise';
import { CameraRig } from './CameraRig';
import { PostProcessPipeline } from './PostProcess';
import { SkyAndClouds } from '../world/SkyAndClouds';
import { WorldTerrain } from '../world/Terrain';
import { GrassField } from '../world/GrassField';
import { WorldLandmarks } from '../world/Landmarks';
import { AnimeAvatar } from '../character/AnimeAvatar';
import { FlightController } from '../character/FlightSystem';
import { AmbientAudio } from '../audio/AmbientAudio';

const FALLBACK_REMOTE_VRM =
  'https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm';

export class CelestiaEngine {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public cameraRig: CameraRig;
  public postProcess: PostProcessPipeline;

  public sky: SkyAndClouds;
  public terrain: WorldTerrain;
  public grass: GrassField;
  public landmarks: WorldLandmarks;
  public avatar: AnimeAvatar;
  public flight: FlightController;
  public audio: AmbientAudio;

  public settings: GraphicsSettings;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private fog: THREE.FogExp2;

  private rafId = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;

  private timeOfDay = 9.85; // Crisp morning-noon cerulean Genshin sky!
  private targetTimeOfDay: number | null = null;
  private autoTimeFlow = false;
  private photoFrozen = false;

  private frameCounter = 0;
  private fpsAccum = 0;
  private currentFps = 60;
  private hudEmitTimer = 0;

  private onHudUpdate: (state: HUDState) => void;

  constructor(container: HTMLElement, onHudUpdate: (state: HUDState) => void) {
    this.onHudUpdate = onHudUpdate;

    this.settings = {
      ...QUALITY_PRESETS.high,
      infiniteStamina: true,
    };

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(this.settings.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2('#ccf3ff', 0.00145);
    this.scene.fog = this.fog;

    this.cameraRig = new CameraRig(this.renderer.domElement);

    // Crisp player-following directional sunlight + sky hemisphere bounce
    this.hemiLight = new THREE.HemisphereLight('#8fd0ff', '#68c478', 1.12);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fffaf0', 2.25);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 140;
    const frustum = 28;
    this.sunLight.shadow.camera.left = -frustum;
    this.sunLight.shadow.camera.right = frustum;
    this.sunLight.shadow.camera.top = frustum;
    this.sunLight.shadow.camera.bottom = -frustum;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Shared procedural seamless wind/cloud noise texture
    const noiseTex = createSeamlessNoiseTexture(256);

    // Build stylized Genshin world
    this.sky = new SkyAndClouds(noiseTex);
    this.sky.applyTimeOfDay(this.timeOfDay);
    this.scene.add(this.sky.group);

    this.terrain = new WorldTerrain(noiseTex);
    this.scene.add(this.terrain.group);

    this.grass = new GrassField(this.terrain, noiseTex, this.settings.grassCount);
    this.scene.add(this.grass.group);

    this.landmarks = new WorldLandmarks(this.terrain);
    this.scene.add(this.landmarks.group);

    // Spawn anime traveler on scenic hill overlooking Starlight Lake & Great Windrise Tree
    const spawnY = this.terrain.getMeadowHeight(0, 18);
    this.flight = new FlightController(spawnY);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy() || 8;
    this.avatar = new AnimeAvatar(maxAniso);
    this.scene.add(this.avatar.root);
    this.scene.add(this.avatar.wingVFX.worldGroup);

    this.audio = new AmbientAudio();

    this.flight.onBoostTrigger = (pos, dir) => {
      this.avatar.wingVFX.triggerBoostBurst(pos, dir);
      this.audio.playBoostWhoosh();
    };

    this.postProcess = new PostProcessPipeline(
      this.renderer,
      this.scene,
      this.cameraRig.camera,
      this.settings
    );

    // Load default bundled VRM model (fallback to official Pixiv sample URL if absent)
    this.loadDefaultAvatar();

    window.addEventListener('resize', this.handleResize);
    this.clock.start();
    this.animate();
  }

  private async loadDefaultAvatar(): Promise<void> {
    try {
      await this.avatar.loadFromUrl('/models/alicia.vrm', 'Alicia Celestia');
    } catch {
      try {
        await this.avatar.loadFromUrl('/models/avatar.vrm', 'Sakura Windstrider');
      } catch {
        try {
          await this.avatar.loadFromUrl(FALLBACK_REMOTE_VRM, 'Celestia Traveler');
        } catch (err) {
          console.warn('Using stylized fallback avatar:', err);
        }
      }
    }
    this.emitHud();
  }

  public async switchPresetAvatar(preset: 'alicia' | 'traveler'): Promise<void> {
    if (preset === 'alicia') {
      await this.avatar.loadFromUrl('/models/alicia.vrm', 'Alicia Celestia');
    } else {
      await this.avatar.loadFromUrl('/models/avatar.vrm', 'Sakura Windstrider');
    }
    this.avatar.setOutlineScale(this.settings.outlineThickness);
    this.emitHud();
  }

  public async loadCustomVRM(file: File): Promise<void> {
    await this.avatar.loadFromFile(file);
    this.avatar.setOutlineScale(this.settings.outlineThickness);
    this.emitHud();
  }

  public setTimeOfDay(hour: number): void {
    this.targetTimeOfDay = null;
    this.timeOfDay = ((hour % 24) + 24) % 24;
    this.sky.applyTimeOfDay(this.timeOfDay);
    this.emitHud();
  }

  public animateToTime(hour: number): void {
    this.targetTimeOfDay = ((hour % 24) + 24) % 24;
  }

  public toggleNightMode(): void {
    const active = getActiveTimeSession(this.targetTimeOfDay ?? this.timeOfDay);
    const idx = TIME_SESSIONS.findIndex((s) => s.id === active.id);
    const next = TIME_SESSIONS[(idx + 1) % TIME_SESSIONS.length];
    this.animateToTime(next.hour);
  }

  public setAutoTimeFlow(enabled: boolean): void {
    this.autoTimeFlow = enabled;
    this.emitHud();
  }

  public applyPreset(preset: QualityPreset): void {
    const base = QUALITY_PRESETS[preset];
    this.updateGraphics({ ...base });
  }

  public updateGraphics(partial: Partial<GraphicsSettings>): void {
    const prevGrass = this.settings.grassCount;
    const prevScale = this.settings.renderScale;
    const prevOutline = this.settings.outlineThickness;
    const prevPreset = this.settings.preset;

    this.settings = { ...this.settings, ...partial };

    if (this.settings.renderScale !== prevScale) {
      this.renderer.setPixelRatio(this.settings.renderScale);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    if (this.settings.preset !== prevPreset) {
      const shadowRes = this.settings.preset === 'ultra' ? 4096 : 2048;
      if (this.sunLight.shadow.mapSize.x !== shadowRes) {
        this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
        this.sunLight.shadow.map?.dispose();
        this.sunLight.shadow.map = null;
      }
    }

    if (this.settings.grassCount !== prevGrass) {
      this.grass.rebuildGrass(this.settings.grassCount);
    }

    if (this.settings.outlineThickness !== prevOutline) {
      this.avatar.setOutlineScale(this.settings.outlineThickness);
    }

    this.postProcess.updateSettings(this.settings);
  }

  public setPhotoMode(active: boolean): void {
    this.cameraRig.photoMode = active;
    if (!active) {
      this.photoFrozen = false;
      this.avatar.photoPose = 'none';
      this.cameraRig.photoPanOffset.set(0, 0);
      this.postProcess.setPhotoEnhancements(0.12);
    } else {
      this.cameraRig.photoFov = 42;
      this.postProcess.setPhotoEnhancements(0.24);
    }
  }

  public setPhotoFreeze(frozen: boolean): void {
    this.photoFrozen = frozen;
  }

  public setPhotoPose(pose: PhotoPose): void {
    this.avatar.photoPose = pose;
  }

  public setAvatarExpression(expr: AvatarExpression): void {
    this.avatar.setExpression(expr);
  }

  public setPhotoLens(fov: number, vignette: number, panX = 0, panY = 0): void {
    this.cameraRig.photoFov = fov;
    this.cameraRig.photoPanOffset.set(panX, panY);
    this.postProcess.setPhotoEnhancements(vignette);
  }

  public captureScreenshot(): string {
    this.postProcess.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  public getLandmarks(): LandmarkInfo[] {
    return this.terrain.getLandmarks();
  }

  public teleportToLandmark(id: string): void {
    const lm = this.terrain.getLandmarks().find((item) => item.id === id);
    if (!lm) return;

    if (id === 'pillar-main') {
      const surfaceY = this.terrain.getSurfaceHeight(lm.x, lm.z, lm.y + 2);
      this.flight.teleportTo(lm.x, surfaceY, lm.z, false);
    } else if (lm.type === 'island') {
      const surfaceY = this.terrain.getSurfaceHeight(lm.x + 4, lm.z + 4, lm.y + 2);
      this.flight.teleportTo(lm.x + 4, surfaceY, lm.z + 4, false);
    } else if (id === 'twin-waterfall') {
      const viewY = this.terrain.getMeadowHeight(-22, -30);
      this.flight.teleportTo(-22, viewY, -30, false);
      this.flight.heading = -Math.PI * 0.75;
      this.cameraRig.yaw = Math.PI * 0.25;
    } else if (lm.type === 'tree') {
      const y = this.terrain.getMeadowHeight(lm.x, lm.z + 16);
      this.flight.teleportTo(lm.x, y, lm.z + 16, false);
    } else {
      const y = this.terrain.getMeadowHeight(lm.x, lm.z);
      this.flight.teleportTo(lm.x, y, lm.z, false);
    }
    this.emitHud();
  }

  public toggleAudio(): boolean {
    const state = this.audio.toggle();
    this.emitHud();
    return state;
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cameraRig.resize(w, h);
    this.renderer.setSize(w, h);
    this.postProcess.resize();
  };

  private emitHud(): void {
    const p = this.flight.position;
    const groundUnder = this.terrain.getMeadowHeight(p.x, p.z);
    const alt = Math.max(0, p.y - groundUnder);

    this.onHudUpdate({
      fps: this.currentFps,
      playerPos: { x: p.x, y: p.y, z: p.z },
      playerHeading: this.flight.heading,
      cameraHeading: this.cameraRig.yaw,
      altitude: alt,
      speed: this.flight.velocity.length(),
      flightMode: this.flight.mode,
      isBoosting: this.flight.isBoosting,
      stamina: this.flight.stamina,
      timeOfDay: this.timeOfDay,
      autoTimeFlow: this.autoTimeFlow,
      nearUpdraft: this.landmarks.isInsideUpdraft(p),
      currentRegionName: this.terrain.getRegionName(p.x, p.y, p.z),
      avatarLoaded: Boolean(this.avatar.vrm),
      avatarName: this.avatar.avatarName,
      audioEnabled: this.audio.enabled,
    });
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (!this.photoFrozen) {
      this.elapsed += dt;
    }

    if (this.targetTimeOfDay !== null) {
      let diff = this.targetTimeOfDay - this.timeOfDay;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      if (Math.abs(diff) < 0.03) {
        this.timeOfDay = this.targetTimeOfDay;
        this.targetTimeOfDay = null;
      } else {
        this.timeOfDay = ((this.timeOfDay + diff * (1.0 - Math.exp(-4.2 * dt))) % 24 + 24) % 24;
      }
      this.sky.applyTimeOfDay(this.timeOfDay);
    } else if (this.autoTimeFlow && !this.photoFrozen) {
      this.timeOfDay = (this.timeOfDay + dt * 0.14) % 24;
      this.sky.applyTimeOfDay(this.timeOfDay);
    }

    const getSurf = (x: number, z: number, refY: number) =>
      this.terrain.getSurfaceHeight(x, z, refY);

    const inUpdraft = this.landmarks.isInsideUpdraft(this.flight.position);

    this.flight.update(
      dt,
      this.cameraRig,
      getSurf,
      inUpdraft,
      this.settings.infiniteStamina,
      this.photoFrozen
    );

    const lightState = this.sky.lighting;

    // Sync scene key light & hemisphere bounce with Anime Sky
    const activeLightDir =
      lightState.nightFactor > 0.65
        ? new THREE.Vector3(
            -lightState.sunDirection.x,
            Math.abs(lightState.sunDirection.y) * 0.65 + 0.35,
            -lightState.sunDirection.z
          ).normalize()
        : lightState.sunDirection;

    const p = this.flight.position;
    // Texel-snap shadow target slightly to eliminate shadow swimming
    const snapX = Math.round(p.x * 4) / 4;
    const snapZ = Math.round(p.z * 4) / 4;

    this.sunLight.target.position.set(snapX, p.y, snapZ);
    this.sunLight.position
      .copy(this.sunLight.target.position)
      .addScaledVector(activeLightDir, 62);
    this.sunLight.color.copy(lightState.sunColor);
    this.sunLight.intensity = lightState.sunIntensity;

    this.hemiLight.color.copy(lightState.ambientSkyColor);
    this.hemiLight.groundColor.copy(lightState.ambientGroundColor);
    this.hemiLight.intensity = lightState.ambientIntensity;
    this.fog.color.copy(lightState.fogColor);

    // Update camera first so avatar face-fill light & volumetric sky align cleanly
    this.cameraRig.update(
      dt,
      p,
      this.flight.mode,
      this.flight.isBoosting,
      this.flight.velocity.length(),
      getSurf
    );

    // Update subsystems
    this.sky.update(this.elapsed, p);
    this.terrain.update(this.elapsed, lightState);
    this.grass.update(this.elapsed, p, this.flight.velocity, lightState);
    this.landmarks.update(this.elapsed, lightState);

    this.avatar.update(
      this.photoFrozen ? 0.016 : dt,
      this.elapsed,
      p,
      this.photoFrozen ? new THREE.Vector3() : this.flight.velocity,
      this.flight.heading,
      this.flight.bankAngle,
      this.flight.pitchAngle,
      this.flight.mode,
      this.flight.isSprinting,
      this.flight.isBoosting,
      lightState,
      this.cameraRig.camera.position
    );

    this.audio.update(dt, this.elapsed, this.flight.velocity.length(), this.flight.mode);

    this.postProcess.render();

    // FPS & periodic HUD sync (12 Hz so React stays feather-light!)
    this.frameCounter++;
    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 0.5) {
      this.currentFps = Math.round(this.frameCounter / this.fpsAccum);
      this.frameCounter = 0;
      this.fpsAccum = 0;
    }

    this.hudEmitTimer += rawDt;
    if (this.hudEmitTimer >= 0.08) {
      this.hudEmitTimer = 0;
      this.emitHud();
    }
  };

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.audio.stop();
    this.postProcess.dispose();
    this.renderer.dispose();
  }
}
