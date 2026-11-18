import * as THREE from 'three';
import { FlightMode } from '../types';

export class CameraRig {
  public camera: THREE.PerspectiveCamera;
  public yaw = Math.PI * 0.12;
  public pitch = 0.16;
  public targetDistance = 3.8;
  private currentDistance = 3.8;

  private currentFocus = new THREE.Vector3(0, 1.35, 0);
  private desiredPos = new THREE.Vector3();

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Photo mode overrides
  public photoMode = false;
  public photoFov = 42;
  public photoPanOffset = new THREE.Vector2(0, 0);

  private domElement: HTMLElement;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.12,
      2800
    );

    this.bindEvents();
  }

  private bindEvents(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== this.domElement) return;
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement === this.domElement) {
        this.yaw -= e.movementX * 0.0026;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch + e.movementY * 0.0024,
          -1.15,
          1.28
        );
        return;
      }

      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.yaw -= dx * 0.0048;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0042, -1.15, 1.28);
    };

    const onPointerUp = () => {
      this.isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      if (e.target !== this.domElement) return;
      e.preventDefault();
      const zoomStep = e.deltaY * 0.0032 * Math.max(0.8, this.targetDistance * 0.45);
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + zoomStep,
        1.05,
        13.5
      );
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    this.domElement.addEventListener('wheel', onWheel, { passive: false });
  }

  public getForwardPlanar(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    return out;
  }

  public getRightPlanar(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    return out;
  }

  public getAimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const cosPitch = Math.cos(this.pitch);
    out.set(
      -Math.sin(this.yaw) * cosPitch,
      -Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch
    ).normalize();
    return out;
  }

  public update(
    dt: number,
    targetPos: THREE.Vector3,
    flightMode: FlightMode,
    isBoosting: boolean,
    speed: number,
    getSurfaceHeight: (x: number, z: number, refY: number) => number
  ): void {
    const smoothFactor = 1.0 - Math.exp(-14.0 * dt);
    this.currentDistance = THREE.MathUtils.lerp(
      this.currentDistance,
      this.targetDistance,
      1.0 - Math.exp(-10.0 * dt)
    );

    // Genshin-style portrait lift: zooming closer centers cleanly on her anime face & eyes!
    const closeUpT = 1.0 - THREE.MathUtils.smoothstep(this.currentDistance, 1.05, 2.7);
    const heightOffset = THREE.MathUtils.lerp(1.26, 1.44, closeUpT);

    const targetFocus = new THREE.Vector3(
      targetPos.x,
      targetPos.y + (flightMode === 'flying' ? 1.05 : heightOffset),
      targetPos.z
    );

    if (this.photoMode) {
      const right = this.getRightPlanar();
      targetFocus.addScaledVector(right, this.photoPanOffset.x);
      targetFocus.y += this.photoPanOffset.y;
    }

    if (this.photoMode) {
      this.currentFocus.copy(targetFocus);
    } else {
      this.currentFocus.lerp(targetFocus, smoothFactor);
    }

    const cosPitch = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cosPitch * this.currentDistance;
    const offsetY = Math.sin(this.pitch) * this.currentDistance;
    const offsetZ = Math.cos(this.yaw) * cosPitch * this.currentDistance;

    this.desiredPos.set(
      this.currentFocus.x + offsetX,
      this.currentFocus.y + offsetY,
      this.currentFocus.z + offsetZ
    );

    // Prevent camera from dipping below meadow hills or floating island tops
    const minGroundY = getSurfaceHeight(this.desiredPos.x, this.desiredPos.z, this.desiredPos.y) + 0.36;
    if (this.desiredPos.y < minGroundY) {
      this.desiredPos.y = minGroundY;
    }

    this.camera.position.copy(this.desiredPos);
    this.camera.lookAt(this.currentFocus);

    // Dynamic FOV for exhilarating sky flight vs flattering portrait lens
    let desiredFov = 48;
    if (this.photoMode) {
      desiredFov = this.photoFov;
    } else if (closeUpT > 0.25) {
      desiredFov = THREE.MathUtils.lerp(48, 38, closeUpT);
    } else if (flightMode === 'flying') {
      desiredFov = isBoosting ? 66 : 55 + Math.min(6, speed * 0.2);
    } else if (flightMode === 'gliding') {
      desiredFov = 54;
    }

    if (Math.abs(this.camera.fov - desiredFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        desiredFov,
        1.0 - Math.exp(-6.5 * dt)
      );
      this.camera.updateProjectionMatrix();
    }
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}
