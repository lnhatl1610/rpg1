import * as THREE from 'three';
import { CameraRig } from '../core/CameraRig';
import { FlightMode } from '../types';
import { WATER_LEVEL } from '../world/Terrain';

export class FlightController {
  public position = new THREE.Vector3(0, 6, 18);
  public velocity = new THREE.Vector3();
  public heading = Math.PI; // Facing north toward Starlight Lake & Great Windrise Tree!
  public bankAngle = 0;
  public pitchAngle = 0;

  public mode: FlightMode = 'grounded';
  public isSprinting = false;
  public isBoosting = false;
  public stamina = 100;

  private keys = new Set<string>();
  private jumpPressCount = 0;
  private lastSpaceTime = 0;
  private wasBoostActive = false;

  public onBoostTrigger?: (pos: THREE.Vector3, dir: THREE.Vector3) => void;

  constructor(initialY: number) {
    this.position.set(0, initialY, 18);
    this.bindKeyboard();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }

      const code = e.code;
      const firstPress = !this.keys.has(code);
      this.keys.add(code);

      if (!firstPress) return;

      if (code === 'KeyF') {
        this.toggleFreeFlight();
      } else if (code === 'Space') {
        e.preventDefault();
        this.handleSpacePress();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  public toggleFreeFlight(): void {
    if (this.mode === 'flying') {
      this.mode = 'gliding';
    } else {
      this.mode = 'flying';
      if (this.velocity.y < 3.5) {
        this.velocity.y = 5.2;
      }
    }
  }

  private handleSpacePress(): void {
    const now = performance.now();
    const doubleTap = now - this.lastSpaceTime < 280;
    this.lastSpaceTime = now;

    if (this.mode === 'grounded') {
      this.velocity.y = 7.4;
      this.mode = 'jumping';
      this.jumpPressCount = 1;
    } else if (this.mode === 'jumping') {
      if (doubleTap) {
        this.mode = 'flying';
        this.velocity.y = Math.max(this.velocity.y, 5.5);
      } else {
        this.mode = 'gliding';
        this.velocity.y = Math.max(this.velocity.y, -1.2);
      }
    } else if (this.mode === 'gliding') {
      if (doubleTap) {
        this.mode = 'flying';
        this.velocity.y = 5.5;
      } else {
        this.mode = 'jumping';
      }
    }
  }

  public teleportTo(x: number, y: number, z: number, fly = false): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.mode = fly ? 'flying' : 'grounded';
  }

  public update(
    dt: number,
    cameraRig: CameraRig,
    getSurfaceHeight: (x: number, z: number, refY: number) => number,
    inUpdraft: boolean,
    infiniteStamina: boolean,
    frozenByPhotoMode: boolean
  ): void {
    if (frozenByPhotoMode) return;

    const moveZ =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveX =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    const shiftHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const spaceHeld = this.keys.has('Space');
    const descendHeld =
      this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');

    const camForward = cameraRig.getForwardPlanar();
    const camRight = cameraRig.getRightPlanar();

    const inputPlanar = new THREE.Vector3()
      .addScaledVector(camForward, moveZ)
      .addScaledVector(camRight, moveX);
    const hasMoveInput = inputPlanar.lengthSq() > 0.001;
    if (hasMoveInput) inputPlanar.normalize();

    const groundY = getSurfaceHeight(this.position.x, this.position.z, this.position.y);

    // Updraft automatic lift into Wind Glider!
    if (inUpdraft && this.mode !== 'flying') {
      if (this.mode === 'grounded' && spaceHeld) {
        this.mode = 'gliding';
      }
      if (this.mode === 'jumping' || this.mode === 'gliding') {
        this.mode = 'gliding';
        this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, 8.8, 1.0 - Math.exp(-5.0 * dt));
      }
    }

    if (this.mode === 'flying') {
      // 360° Free Sky Flight
      const canBoost = shiftHeld && (infiniteStamina || this.stamina > 5);
      this.isBoosting = canBoost && (hasMoveInput || spaceHeld);
      this.isSprinting = false;

      if (this.isBoosting && !this.wasBoostActive) {
        const burstDir = hasMoveInput ? inputPlanar.clone() : cameraRig.getAimDirection();
        this.onBoostTrigger?.(this.position, burstDir);
      }
      this.wasBoostActive = this.isBoosting;

      const flySpeed = this.isBoosting ? 24.5 : 13.2;
      const aim3D = cameraRig.getAimDirection();

      const desiredVel = new THREE.Vector3();
      if (moveZ !== 0) {
        desiredVel.addScaledVector(aim3D, moveZ * flySpeed);
      }
      if (moveX !== 0) {
        desiredVel.addScaledVector(camRight, moveX * flySpeed * 0.88);
      }
      if (spaceHeld) {
        desiredVel.y += this.isBoosting ? 12.5 : 7.8;
      }
      if (descendHeld) {
        desiredVel.y -= 8.5;
      }

      this.velocity.lerp(desiredVel, 1.0 - Math.exp(-6.5 * dt));

      // Update heading, banking roll & pitch for graceful aerial pose
      const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (horizSpeed > 0.35) {
        const targetHeading = Math.atan2(this.velocity.x, this.velocity.z);
        let diff = targetHeading - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        this.heading += diff * (1.0 - Math.exp(-9.0 * dt));
        this.bankAngle = THREE.MathUtils.lerp(
          this.bankAngle,
          THREE.MathUtils.clamp(-diff * 1.15, -0.58, 0.58),
          1.0 - Math.exp(-7.0 * dt)
        );
      } else {
        this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, 0, 1.0 - Math.exp(-6.0 * dt));
      }

      const targetPitch = THREE.MathUtils.clamp(-this.velocity.y * 0.032, -0.45, 0.45);
      this.pitchAngle = THREE.MathUtils.lerp(
        this.pitchAngle,
        targetPitch,
        1.0 - Math.exp(-7.0 * dt)
      );

      this.position.addScaledVector(this.velocity, dt);

      // Gentle landing when intentionally descending onto meadow or floating island
      const updatedGround = getSurfaceHeight(this.position.x, this.position.z, this.position.y);
      const minSurface = Math.max(updatedGround, WATER_LEVEL + 0.35);
      if (this.position.y <= minSurface) {
        this.position.y = minSurface;
        if (descendHeld || this.velocity.y < -1.5) {
          if (updatedGround >= WATER_LEVEL - 0.05) {
            this.mode = 'grounded';
            this.velocity.y = 0;
            this.isBoosting = false;
          } else {
            this.position.y = WATER_LEVEL + 0.55;
            this.velocity.y = 0;
          }
        } else {
          this.velocity.y = Math.max(0, this.velocity.y);
        }
      }
    } else {
      this.isBoosting = false;
      this.wasBoostActive = false;
      this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, 0, 1.0 - Math.exp(-8.0 * dt));

      // Ground, Jumping or Wind Glider
      this.isSprinting =
        this.mode === 'grounded' && shiftHeld && hasMoveInput && (infiniteStamina || this.stamina > 5);

      const moveSpeed =
        this.mode === 'gliding'
          ? shiftHeld
            ? 10.5
            : 7.4
          : this.isSprinting
          ? 8.4
          : 4.4;

      const targetVelX = inputPlanar.x * moveSpeed;
      const targetVelZ = inputPlanar.z * moveSpeed;
      const accel = this.mode === 'grounded' ? 12.0 : 5.5;

      this.velocity.x = THREE.MathUtils.lerp(
        this.velocity.x,
        targetVelX,
        1.0 - Math.exp(-accel * dt)
      );
      this.velocity.z = THREE.MathUtils.lerp(
        this.velocity.z,
        targetVelZ,
        1.0 - Math.exp(-accel * dt)
      );

      if (hasMoveInput) {
        const targetHeading = Math.atan2(inputPlanar.x, inputPlanar.z);
        let diff = targetHeading - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heading += diff * (1.0 - Math.exp(-11.0 * dt));
        this.bankAngle = THREE.MathUtils.lerp(
          this.bankAngle,
          this.mode === 'gliding' ? THREE.MathUtils.clamp(-diff * 0.85, -0.42, 0.42) : 0,
          1.0 - Math.exp(-8.0 * dt)
        );
      } else {
        this.bankAngle = THREE.MathUtils.lerp(this.bankAngle, 0, 1.0 - Math.exp(-8.0 * dt));
      }

      if (this.mode === 'grounded') {
        this.velocity.y = 0;
        this.position.x += this.velocity.x * dt;
        this.position.z += this.velocity.z * dt;

        const nextGround = getSurfaceHeight(this.position.x, this.position.z, this.position.y + 1.0);
        // Step off floating island edge -> enter Wind Glider or jump!
        if (this.position.y - nextGround > 2.2) {
          this.mode = 'gliding';
          this.velocity.y = -1.5;
        } else if (nextGround < WATER_LEVEL - 0.15) {
          // Skim onto Celestial Wings gracefully over deep Starlight Lake water!
          this.position.y = WATER_LEVEL + 0.55;
          this.mode = 'flying';
          this.velocity.y = 1.8;
        } else {
          this.position.y = nextGround;
        }
      } else if (this.mode === 'jumping') {
        this.velocity.y -= 18.5 * dt;
        this.position.addScaledVector(this.velocity, dt);
        const nextGround = getSurfaceHeight(this.position.x, this.position.z, this.position.y);
        if (this.position.y <= nextGround && this.velocity.y <= 0) {
          this.position.y = nextGround;
          this.velocity.y = 0;
          this.mode = 'grounded';
        }
      } else if (this.mode === 'gliding') {
        if (!inUpdraft) {
          const targetSink = -1.85;
          this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, targetSink, 1.0 - Math.exp(-4.0 * dt));
        }
        this.position.addScaledVector(this.velocity, dt);
        const nextGround = getSurfaceHeight(this.position.x, this.position.z, this.position.y);
        if (nextGround < WATER_LEVEL - 0.15 && this.position.y < WATER_LEVEL + 0.6) {
          this.position.y = WATER_LEVEL + 0.65;
          this.mode = 'flying';
          this.velocity.y = 2.0;
        } else if (this.position.y <= nextGround) {
          this.position.y = nextGround;
          this.velocity.y = 0;
          this.mode = 'grounded';
        }
      }
    }

    // Keep within expanded multi-biome valley radius (305m)
    const radialDist = Math.hypot(this.position.x, this.position.z);
    if (radialDist > 305) {
      const s = 305 / radialDist;
      this.position.x *= s;
      this.position.z *= s;
    }
    this.position.y = Math.min(this.position.y, 260);

    // Stamina management
    if (infiniteStamina) {
      this.stamina = Math.min(100, this.stamina + 40 * dt);
    } else {
      if (this.isBoosting || this.isSprinting) {
        this.stamina = Math.max(0, this.stamina - 14 * dt);
      } else if (this.mode === 'gliding') {
        this.stamina = Math.max(0, this.stamina - 4.5 * dt);
        if (this.stamina <= 0) this.mode = 'jumping';
      } else if (this.mode === 'grounded') {
        this.stamina = Math.min(100, this.stamina + 28 * dt);
      }
    }
  }
}
