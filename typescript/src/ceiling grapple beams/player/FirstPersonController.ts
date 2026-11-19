import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';

export class FirstPersonController {
  public readonly camera: THREE.PerspectiveCamera;
  public isLocked = false;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private readonly flashlight: THREE.SpotLight;
  private readonly beamCone: THREE.Mesh;
  private flashlightOn = true;

  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private grounded = false;

  private stamina = 1.0;
  private exhausted = false;
  private bobTimer = 0;
  private currentEyeHeight = 1.65;

  private readonly staminaWrap = document.getElementById('stamina-wrap')!;
  private readonly staminaBar = document.getElementById('stamina-bar')!;

  constructor(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    world: RAPIER.World,
    spawnPos: THREE.Vector3
  ) {
    this.camera = camera;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawnPos.x,
      spawnPos.y,
      spawnPos.z
    );
    this.body = world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.55, 0.35);
    this.collider = world.createCollider(colliderDesc, this.body);

    this.controller = world.createCharacterController(0.04);
    this.controller.enableAutostep(0.45, 0.25, true);
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.flashlight = new THREE.SpotLight(0xeef6ff, 55, 34, Math.PI / 5.5, 0.45, 1.4);
    this.flashlight.position.set(0.18, -0.14, -0.1);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.25;
    this.flashlight.shadow.camera.far = 34;
    this.flashlight.shadow.bias = -0.0004;

    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);

    const coneLen = 11;
    const coneRad = Math.tan(Math.PI / 5.5) * coneLen;
    const coneGeo = new THREE.ConeGeometry(coneRad, coneLen, 24, 1, true);
    coneGeo.translate(0, -coneLen * 0.5, 0);
    coneGeo.rotateX(Math.PI * 0.5);

    const coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(0xcfe8ff) },
        uOpacity: { value: 0.055 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPos.xyz;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPos;
        void main() {
          vec3 viewDir = normalize(vViewPos);
          float edgeFade = pow(abs(dot(vNormalView, viewDir)), 1.8);
          float lengthFade = smoothstep(0.0, 0.85, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
          float alpha = edgeFade * lengthFade * uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    this.beamCone = new THREE.Mesh(coneGeo, coneMat);
    this.beamCone.position.copy(this.flashlight.position);
    this.camera.add(this.beamCone);

    scene.add(this.camera);
    this.bindEvents();
  }

  private bindEvents(): void {
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement !== null;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sensitivity = 0.0021;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      const maxPitch = Math.PI * 0.48;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.isLocked) {
        this.flashlightOn = !this.flashlightOn;
        this.flashlight.visible = this.flashlightOn;
        this.beamCone.visible = this.flashlightOn;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  public isReelingWinch(): boolean {
    return this.isLocked && this.keys.has('KeyR');
  }

  public getEyePosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  public getHarnessPosition(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y + 0.25, t.z);
  }

  public getFootPosition(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - 0.9, t.z);
  }

  public getForwardDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.camera.quaternion);
    return dir.normalize();
  }

  public update(
    dt: number,
    speedMultiplier = 1.0,
    ropePull = new THREE.Vector3(),
    ropeAttached = false
  ): void {
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    const forwardInput =
      (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafeInput =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    const wantsCrouch = this.keys.has('KeyC') || this.keys.has('ControlLeft');
    const wantsSprint =
      this.keys.has('ShiftLeft') && forwardInput > 0 && !wantsCrouch && !this.exhausted;

    if (wantsSprint && this.isLocked) {
      this.stamina = Math.max(0, this.stamina - dt * 0.28);
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.22);
      if (this.stamina > 0.3) this.exhausted = false;
    }

    this.staminaBar.style.transform = `scaleX(${this.stamina.toFixed(3)})`;
    this.staminaWrap.classList.toggle('active', this.stamina < 0.99);

    let speed = 4.6 * speedMultiplier;
    if (wantsCrouch) speed = 2.3 * speedMultiplier;
    else if (wantsSprint) speed = 7.4 * speedMultiplier;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let moveX = -sinY * forwardInput + cosY * strafeInput;
    let moveZ = -cosY * forwardInput - sinY * strafeInput;
    const len = Math.hypot(moveX, moveZ);
    if (len > 0.001) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
    }

    if (!this.isLocked) {
      moveX = 0;
      moveZ = 0;
    }

    // Reduced gravity while suspended on grappling cable
    if (this.grounded && this.verticalVelocity < 0) {
      this.verticalVelocity = -2.0;
    } else {
      const grav = ropeAttached ? 8.5 : 20.0;
      this.verticalVelocity = Math.max(-18.0, this.verticalVelocity - grav * dt);
    }

    if (ropePull.y > 0.001) {
      this.verticalVelocity = Math.max(0, this.verticalVelocity * 0.6);
    }

    if (this.grounded && this.keys.has('Space') && !wantsCrouch && this.isLocked) {
      this.verticalVelocity = 6.8;
      this.grounded = false;
    }

    const desiredTranslation = {
      x: moveX * dt + ropePull.x,
      y: this.verticalVelocity * dt + ropePull.y,
      z: moveZ * dt + ropePull.z,
    };

    this.controller.computeColliderMovement(this.collider, desiredTranslation);
    this.grounded = this.controller.computedGrounded();
    const corrected = this.controller.computedMovement();

    const pos = this.body.translation();
    const nextX = pos.x + corrected.x;
    const nextY = pos.y + corrected.y;
    const nextZ = pos.z + corrected.z;
    this.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });

    const targetEye = wantsCrouch ? 1.05 : 1.65;
    this.currentEyeHeight += (targetEye - this.currentEyeHeight) * Math.min(1, dt * 10);

    const horizSpeed = Math.hypot(corrected.x, corrected.z) / Math.max(dt, 0.0001);
    let bobOffset = 0;
    if (this.grounded && horizSpeed > 0.4) {
      this.bobTimer += dt * (wantsSprint ? 13.5 : 9.5);
      bobOffset = Math.sin(this.bobTimer) * (wantsSprint ? 0.045 : 0.025);
    } else {
      this.bobTimer = 0;
    }

    this.camera.position.set(nextX, nextY - 0.9 + this.currentEyeHeight + bobOffset, nextZ);
  }
}