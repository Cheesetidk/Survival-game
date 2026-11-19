import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createBrutalistConcreteTextures } from '../textures/concreteTextures';

interface ChemLight {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  body: RAPIER.RigidBody;
  age: number;
}

export class MegastructureRoom {
  public readonly interactables: THREE.Object3D[] = [];

  private readonly scene: THREE.Scene;
  private readonly world: RAPIER.World;

  private blastDoorMesh!: THREE.Mesh;
  private blastDoorBody!: RAPIER.RigidBody;
  private doorOpen = false;
  private doorProgress = 0; // 0 = closed, 1 = open

  private emergencyLight!: THREE.PointLight;
  private emergencyBulbMat!: THREE.MeshStandardMaterial;
  private flickerTimer = 0;

  private readonly chemLights: ChemLight[] = [];
  private chemColorIndex = 0;
  private readonly chemPalette = [0x39ff88, 0xff4d4d, 0x38bdf8, 0xfacc15];

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;
    this.buildArchitecture();
    this.buildBlastDoor();
    this.buildAtmosphereLights();
  }

  private createStaticBox(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(width * 0.5, height * 0.5, depth * 0.5);
    this.world.createCollider(colliderDesc, body);

    return mesh;
  }

  private buildArchitecture(): void {
    const floorTex = createBrutalistConcreteTextures(6, 12);
    const wallTex = createBrutalistConcreteTextures(8, 3);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex.map,
      roughnessMap: floorTex.roughnessMap,
      bumpMap: floorTex.bumpMap,
      bumpScale: 0.04,
      roughness: 0.85,
      metalness: 0.08,
    });

    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex.map,
      roughnessMap: wallTex.roughnessMap,
      bumpMap: wallTex.bumpMap,
      bumpScale: 0.05,
      roughness: 0.9,
      metalness: 0.05,
    });

    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      roughness: 0.45,
      metalness: 0.8,
    });

    // Main Transit Hall (16m wide x 9m tall x 36m long)
    this.createStaticBox(16, 0.5, 36, 0, -0.25, -10, floorMat); // Floor
    this.createStaticBox(16, 0.5, 36, 0, 9.25, -10, wallMat); // Ceiling
    this.createStaticBox(0.8, 9, 36, -8.4, 4.5, -10, wallMat); // Left wall
    this.createStaticBox(0.8, 9, 36, 8.4, 4.5, -10, wallMat); // Right wall
    this.createStaticBox(16, 9, 0.8, 0, 4.5, 8.4, wallMat); // Rear bulkhead
    this.createStaticBox(16, 9, 0.8, 0, 4.5, -28.4, wallMat); // Far bulkhead

    // Brutalist concrete support ribs along corridor
    for (const z of [2, -6, -14, -22]) {
      this.createStaticBox(1.1, 9, 1.1, -7.45, 4.5, z, wallMat);
      this.createStaticBox(1.1, 9, 1.1, 7.45, 4.5, z, wallMat);
      this.createStaticBox(16, 0.9, 1.1, 0, 8.55, z, wallMat);
    }

    // Partition Wall with Central Blast Door Aperture at z = -12
    this.createStaticBox(6.2, 9, 0.8, -4.9, 4.5, -12, wallMat); // Left wing
    this.createStaticBox(6.2, 9, 0.8, 4.9, 4.5, -12, wallMat); // Right wing
    this.createStaticBox(3.6, 5.4, 0.8, 0, 6.3, -12, wallMat); // Upper header

    // Upper Steel Observation Catwalk (y = 4.0m) in rear bay
    this.createStaticBox(5.5, 0.25, 12, -5.25, 3.88, -20, steelMat);
    this.createStaticBox(0.12, 1.0, 12, -2.55, 4.5, -20, steelMat); // Safety rail

    // Concrete Staircase ascending to Catwalk
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const stepH = 4.0 / steps;
      const y = (i + 0.5) * stepH;
      const z = -14.5 - i * 0.42;
      this.createStaticBox(2.2, stepH, 0.5, -6.8, y, z, wallMat);
    }

    // Low-poly stylized cover crates ("Unturned" silhouette contrast)
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x5c6650,
      roughness: 0.7,
      metalness: 0.15,
      flatShading: true,
    });
    this.createStaticBox(1.4, 1.4, 1.4, 3.2, 0.7, -4.5, crateMat);
    this.createStaticBox(1.1, 1.1, 1.1, 3.5, 1.95, -4.3, crateMat);
    this.createStaticBox(2.2, 1.1, 1.2, -3.6, 0.55, -7.5, crateMat);
  }

  private buildBlastDoor(): void {
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xd97706, // Hazard industrial amber
      roughness: 0.42,
      metalness: 0.65,
      flatShading: true,
    });

    this.blastDoorMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.6, 0.45), doorMat);
    this.blastDoorMesh.position.set(0, 1.8, -12);
    this.blastDoorMesh.castShadow = true;
    this.blastDoorMesh.receiveShadow = true;
    this.blastDoorMesh.name = 'blast_door';
    this.scene.add(this.blastDoorMesh);
    this.interactables.push(this.blastDoorMesh);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.8, -12);
    this.blastDoorBody = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(1.8, 1.8, 0.225);
    this.world.createCollider(colliderDesc, this.blastDoorBody);
  }

  private buildAtmosphereLights(): void {
    // Faint cold bounce so pitch-black corners retain readable silhouettes
    const hemiLight = new THREE.HemisphereLight(0x283548, 0x0b0d10, 0.22);
    this.scene.add(hemiLight);

    // Failing emergency sodium fixture near the blast door
    this.emergencyBulbMat = new THREE.MeshStandardMaterial({
      color: 0xff9e44,
      emissive: 0xff7b1c,
      emissiveIntensity: 2.2,
    });
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.35), this.emergencyBulbMat);
    fixture.position.set(0, 8.05, -9.5);
    this.scene.add(fixture);

    this.emergencyLight = new THREE.PointLight(0xff8c2b, 14, 22, 1.8);
    this.emergencyLight.position.set(0, 7.8, -9.5);
    this.emergencyLight.castShadow = false;
    this.scene.add(this.emergencyLight);
  }

  public toggleBlastDoor(): void {
    this.doorOpen = !this.doorOpen;
  }

  public spawnChemLight(origin: THREE.Vector3, forward: THREE.Vector3): void {
    const color = this.chemPalette[this.chemColorIndex % this.chemPalette.length];
    this.chemColorIndex++;

    // Compact stylized chem-light stick
    const geo = new THREE.CylinderGeometry(0.032, 0.032, 0.28, 8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 3.5,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const light = new THREE.PointLight(color, 7.5, 13, 1.7);
    light.position.copy(origin);
    this.scene.add(light);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinvel(forward.x * 11, forward.y * 11 + 2.5, forward.z * 11)
      .setAngvel({ x: 8, y: 5, z: -6 });
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(0.14, 0.032)
      .setRestitution(0.45)
      .setFriction(0.7);
    this.world.createCollider(colliderDesc, body);

    this.chemLights.push({ mesh, light, body, age: 0 });

    // Pool cap of 12 active chem-lights to keep GPU lighting fast
    if (this.chemLights.length > 12) {
      const oldest = this.chemLights.shift()!;
      this.scene.remove(oldest.mesh);
      this.scene.remove(oldest.light);
      this.world.removeRigidBody(oldest.body);
    }
  }

  public update(dt: number): void {
    // Smooth vertical blast door slide (y = 1.8m closed -> y = 5.15m open)
    const target = this.doorOpen ? 1 : 0;
    this.doorProgress += (target - this.doorProgress) * Math.min(1, dt * 4.5);
    const doorY = 1.8 + this.doorProgress * 3.35;

    this.blastDoorMesh.position.y = doorY;
    this.blastDoorBody.setNextKinematicTranslation({ x: 0, y: doorY, z: -12 });

    // Subtle electrical flicker on emergency light
    this.flickerTimer += dt;
    const pulse =
      Math.sin(this.flickerTimer * 17.0) * Math.sin(this.flickerTimer * 43.0) > 0.78 ? 0.25 : 1.0;
    this.emergencyLight.intensity = 14 * pulse;
    this.emergencyBulbMat.emissiveIntensity = 2.2 * pulse;

    // Sync thrown physical chem-lights
    for (const item of this.chemLights) {
      item.age += dt;
      const t = item.body.translation();
      const r = item.body.rotation();
      item.mesh.position.set(t.x, t.y, t.z);
      item.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      item.light.position.set(t.x, t.y + 0.08, t.z);
    }
  }
}