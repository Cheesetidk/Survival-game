import * as THREE from 'three';
import { BiomassGrid } from '../biomass/BiomassGrid';
import { AcousticEngine } from '../audio/AcousticEngine';

export type StalkerAIState = 'PATROL' | 'HUNT' | 'STAGGERED';

export interface StalkerSyncState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: StalkerAIState;
}

export class BiomassStalker {
  public readonly root = new THREE.Group();

  private readonly legs: THREE.Mesh[] = [];
  private readonly eyeMat: THREE.MeshStandardMaterial;

  private readonly position = new THREE.Vector3(0, 0, -21.5);
  private yaw = 0;
  private state: StalkerAIState = 'PATROL';
  private staggerTimer = 0;
  private attackCooldown = 0;
  private stridePhase = 0;
  private clickTimer = 0;
  private patrolAngle = 0;

  constructor(scene: THREE.Scene) {
    this.root.position.copy(this.position);

    const carapaceMat = new THREE.MeshStandardMaterial({
      color: 0x261224,
      roughness: 0.28,
      metalness: 0.15,
      flatShading: true,
    });

    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 3.2,
    });

    // Stylized low-poly hunched carapace
    const thorax = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.44, 1.15), carapaceMat);
    thorax.position.set(0, 0.62, 0);
    thorax.castShadow = true;
    this.root.add(thorax);

    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), carapaceMat);
    head.position.set(0, 0.66, 0.65);
    head.castShadow = true;
    this.root.add(head);

    // Dual glowing sensor eyes
    for (const side of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), this.eyeMat);
      eye.position.set(side, 0.72, 0.86);
      this.root.add(eye);
    }

    // Four articulated insectoid limbs
    const legOffsets: [number, number][] = [
      [-0.44, 0.38],
      [0.44, 0.38],
      [-0.44, -0.38],
      [0.44, -0.38],
    ];
    for (const [lx, lz] of legOffsets) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.64, 0.14), carapaceMat);
      leg.position.set(lx, 0.32, lz);
      leg.castShadow = true;
      this.root.add(leg);
      this.legs.push(leg);
    }

    scene.add(this.root);
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public getState(): StalkerAIState {
    return this.state;
  }

  public getSyncState(): StalkerSyncState {
    return {
      x: Number(this.position.x.toFixed(3)),
      y: Number(this.position.y.toFixed(3)),
      z: Number(this.position.z.toFixed(3)),
      yaw: Number(this.yaw.toFixed(3)),
      state: this.state,
    };
  }

  public applyRemoteState(sync: StalkerSyncState): void {
    this.position.set(sync.x, sync.y, sync.z);
    this.yaw = sync.yaw;
    this.state = sync.state;
  }

  public tryArcStun(playerEye: THREE.Vector3, forward: THREE.Vector3): boolean {
    const toStalker = new THREE.Vector3().subVectors(
      new THREE.Vector3(this.position.x, 0.7, this.position.z),
      playerEye
    );
    const dist = toStalker.length();
    if (dist > 3.4 || dist < 0.1) return false;

    toStalker.normalize();
    if (toStalker.dot(forward) > 0.72) {
      this.state = 'STAGGERED';
      this.staggerTimer = 3.2;
      // Knock Stalker backward away from player
      this.position.x += toStalker.x * 1.4;
      this.position.z += toStalker.z * 1.4;
      this.clampArenaBounds(true);
      return true;
    }
    return false;
  }

  public update(
    dt: number,
    playerFeet: THREE.Vector3,
    playerForward: THREE.Vector3,
    flashlightOn: boolean,
    playerNoise: number,
    doorOpen: boolean,
    biomass: BiomassGrid,
    chemLightPositions: ReadonlyArray<THREE.Vector3>,
    audio: AcousticEngine
  ): number {
    let damageDealt = 0;

    if (this.attackCooldown > 0) {
      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    }

    // Check UV-C floodlight exposure or close proximity to thrown Chem-Lights
    const inUV = biomass.isLitByUV(this.position.x, this.position.z);
    let nearChemLight = false;
    for (const cPos of chemLightPositions) {
      if (Math.hypot(cPos.x - this.position.x, cPos.z - this.position.z) < 2.2) {
        nearChemLight = true;
        break;
      }
    }

    if ((inUV || nearChemLight) && this.state !== 'STAGGERED') {
      this.state = 'STAGGERED';
      this.staggerTimer = 2.4;
    }

    if (this.state === 'STAGGERED') {
      this.staggerTimer -= dt;
      this.eyeMat.emissiveIntensity = 0.4;
      if (this.staggerTimer <= 0) {
        this.state = 'PATROL';
      }
      this.syncMesh(dt, 0);
      return 0;
    }

    // Sensory detection: checks line-of-passage through blast door, flashlight cone, or sprint noise
    const sameSideOfWall = (playerFeet.z > -12) === (this.position.z > -12);
    const canTraverseDoorway = sameSideOfWall || doorOpen;
    const distToPlayer = Math.hypot(
      playerFeet.x - this.position.x,
      playerFeet.z - this.position.z
    );

    // Ignore players standing safely on the high upper catwalks (y > 3.2m)
    const playerOnGroundTier = playerFeet.y < 3.0;

    let flashlightSpotted = false;
    if (flashlightOn && canTraverseDoorway && distToPlayer < 16) {
      const toStalker = new THREE.Vector3(
        this.position.x - playerFeet.x,
        0,
        this.position.z - playerFeet.z
      ).normalize();
      const flatFwd = new THREE.Vector3(playerForward.x, 0, playerForward.z).normalize();
      if (toStalker.dot(flatFwd) > 0.82) {
        flashlightSpotted = true;
      }
    }

    const heardNoise = canTraverseDoorway && distToPlayer < playerNoise * 13.5;

    if (playerOnGroundTier && canTraverseDoorway && (flashlightSpotted || heardNoise || distToPlayer < 6.5)) {
      this.state = 'HUNT';
    } else if (!canTraverseDoorway || !playerOnGroundTier || distToPlayer > 18) {
      this.state = 'PATROL';
    }

    let moveSpeed = 0;
    if (this.state === 'HUNT') {
      this.eyeMat.emissiveIntensity = 4.2;
      moveSpeed = 5.3;

      // Route through central blast door aperture (x = 0, z = -12) when crossing the partition
      let targetX = playerFeet.x;
      let targetZ = playerFeet.z;
      if (!sameSideOfWall && doorOpen) {
        targetX = 0;
        targetZ = playerFeet.z > -12 ? -11.2 : -12.8;
      }

      const dx = targetX - this.position.x;
      const dz = targetZ - this.position.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        this.yaw = Math.atan2(dx, dz);
        this.position.x += (dx / len) * moveSpeed * dt;
        this.position.z += (dz / len) * moveSpeed * dt;
      }

      // Melee strike when closing in on survivor
      if (distToPlayer < 1.35 && playerOnGroundTier && this.attackCooldown === 0) {
        damageDealt = 28;
        this.attackCooldown = 1.6;
        // Brief post-strike recoil so player can dodge or slam the blast door
        this.position.x -= Math.sin(this.yaw) * 1.1;
        this.position.z -= Math.cos(this.yaw) * 1.1;
      }
    } else {
      // Patrol circuit in the rear transit bay
      this.eyeMat.emissiveIntensity = 2.4;
      moveSpeed = 2.1;
      this.patrolAngle += dt * 0.55;
      const waypointX = Math.sin(this.patrolAngle) * 4.8;
      const waypointZ = -20.5 + Math.cos(this.patrolAngle * 0.7) * 4.2;

      const dx = waypointX - this.position.x;
      const dz = waypointZ - this.position.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.1) {
        this.yaw = Math.atan2(dx, dz);
        this.position.x += (dx / len) * moveSpeed * dt;
        this.position.z += (dz / len) * moveSpeed * dt;
      }
    }

    this.clampArenaBounds(doorOpen);

    // Rhythmic acoustic clicks
    this.clickTimer += dt;
    const clickInterval = this.state === 'HUNT' ? 0.42 : 1.35;
    if (this.clickTimer >= clickInterval) {
      this.clickTimer = 0;
      audio.playStalkerClick(this.position, playerFeet, this.state === 'HUNT');
    }

    this.syncMesh(dt, moveSpeed);
    return damageDealt;
  }

  private clampArenaBounds(doorOpen: boolean): void {
    this.position.x = Math.max(-6.6, Math.min(6.6, this.position.x));
    this.position.z = Math.max(-26.8, Math.min(6.8, this.position.z));

    // Solid partition wall at z = -12 except through open central aperture (|x| < 1.5)
    if (Math.abs(this.position.z + 12) < 0.75) {
      if (!doorOpen || Math.abs(this.position.x) > 1.45) {
        this.position.z = this.position.z < -12 ? -12.8 : -11.2;
      }
    }
  }

  private syncMesh(dt: number, speed: number): void {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;

    if (speed > 0.1) {
      this.stridePhase += dt * speed * 3.4;
      for (let i = 0; i < this.legs.length; i++) {
        const phase = this.stridePhase + (i % 2 === 0 ? 0 : Math.PI);
        this.legs[i].rotation.x = Math.sin(phase) * 0.48;
      }
    } else {
      for (const leg of this.legs) {
        leg.rotation.x *= 0.85;
      }
    }
  }
}