import * as THREE from 'three';

interface UVLamp {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  light: THREE.SpotLight;
  mesh: THREE.Group;
}

export class BiomassGrid {
  private readonly cols = 30; // 15m width at 0.5m resolution
  private readonly rows = 68; // 34m length at 0.5m resolution
  private readonly cellSize = 0.5;
  private readonly originX = -7.25;
  private readonly originZ = -27.0;

  private readonly health: Float32Array;
  private readonly nextHealth: Float32Array;
  private readonly scorched: Float32Array;

  private readonly instancedMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  private readonly uvLamps: UVLamp[] = [];
  private simAccumulator = 0;

  constructor(scene: THREE.Scene) {
    const total = this.cols * this.rows;
    this.health = new Float32Array(total);
    this.nextHealth = new Float32Array(total);
    this.scorched = new Float32Array(total);

    const geo = new THREE.BoxGeometry(0.48, 0.14, 0.48);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.25, // Wet organic sheen
      metalness: 0.08,
      flatShading: true,
    });

    this.instancedMesh = new THREE.InstancedMesh(geo, mat, total);
    this.instancedMesh.receiveShadow = true;
    this.instancedMesh.castShadow = false;
    this.instancedMesh.frustumCulled = false;

    // Seed initial Hive Core infestation beyond the blast door (z = -15 to -24)
    this.seedCluster(0, -19.5, 4.5);
    this.seedCluster(-3.5, -14.0, 2.2);

    // Initialize instance matrices & colors so instanceColor buffer exists on frame 1
    for (let i = 0; i < total; i++) {
      this.tmpColor.setHex(0x2a1428);
      this.instancedMesh.setColorAt(i, this.tmpColor);
    }
    this.syncVisuals();
    scene.add(this.instancedMesh);
  }

  private index(c: number, r: number): number {
    return r * this.cols + c;
  }

  private seedCluster(worldX: number, worldZ: number, radius: number): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const wx = this.originX + c * this.cellSize;
        const wz = this.originZ + r * this.cellSize;
        const dist = Math.hypot(wx - worldX, wz - worldZ);
        if (dist <= radius) {
          const idx = this.index(c, r);
          this.health[idx] = Math.min(1, this.health[idx] + (1 - dist / radius) * 0.95);
        }
      }
    }
  }

  public deployUVLamp(scene: THREE.Scene, origin: THREE.Vector3, forward: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.set(origin.x, 0.02, origin.z);

    const flatDir = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    if (flatDir.lengthSq() < 0.001) flatDir.set(0, 0, -1);

    // Tripod stand + glowing UV-C emitter bar
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.22, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.6, metalness: 0.7 })
    );
    stand.position.y = 0.375;
    group.add(stand);

    const emitter = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0x9333ea,
        emissiveIntensity: 4.0,
      })
    );
    emitter.position.set(0, 0.78, 0);
    emitter.lookAt(flatDir.x, 0.78, flatDir.z);
    group.add(emitter);
    scene.add(group);

    // Violet UV-C cone light
    const light = new THREE.SpotLight(0xa855f7, 48, 14, Math.PI / 4, 0.4, 1.4);
    light.position.set(origin.x, 0.85, origin.z);
    light.target.position.set(origin.x + flatDir.x * 5, 0.1, origin.z + flatDir.z * 5);
    scene.add(light);
    scene.add(light.target);

    this.uvLamps.push({
      position: light.position.clone(),
      direction: new THREE.Vector3(flatDir.x, -0.15, flatDir.z).normalize(),
      light,
      mesh: group,
    });

    // Cap at 4 deployed UV-C floodlights
    if (this.uvLamps.length > 4) {
      const oldest = this.uvLamps.shift()!;
      scene.remove(oldest.mesh);
      scene.remove(oldest.light);
      scene.remove(oldest.light.target);
    }
  }

  public getMovementDragAt(worldX: number, worldY: number, worldZ: number): number {
    // Only slows player when walking near floor level (y < 1.2m)
    if (worldY > 1.2) return 1.0;

    const c = Math.floor((worldX - this.originX + this.cellSize * 0.5) / this.cellSize);
    const r = Math.floor((worldZ - this.originZ + this.cellSize * 0.5) / this.cellSize);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return 1.0;

    const h = this.health[this.index(c, r)];
    if (h < 0.25) return 1.0;
    return Math.max(0.45, 1.0 - h * 0.55);
  }

  public update(dt: number, doorOpen: boolean): void {
    // Continuous UV-C radiation burn-back
    if (this.uvLamps.length > 0) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const idx = this.index(c, r);
          const wx = this.originX + c * this.cellSize;
          const wz = this.originZ + r * this.cellSize;

          for (const lamp of this.uvLamps) {
            const dx = wx - lamp.position.x;
            const dy = 0.05 - lamp.position.y;
            const dz = wz - lamp.position.z;
            const dist = Math.hypot(dx, dy, dz);
            if (dist > 11.5) continue;

            // Blocked if blast door is closed between lamp and cell
            if (!doorOpen && (lamp.position.z > -12) !== (wz > -12)) continue;

            const dot = (dx * lamp.direction.x + dy * lamp.direction.y + dz * lamp.direction.z) / dist;
            if (dot > 0.68) {
              this.health[idx] = Math.max(0, this.health[idx] - dt * 0.55);
              this.scorched[idx] = 1.0;
            }
          }
        }
      }
    }

    // 2 Hz cellular automata growth tick
    this.simAccumulator += dt;
    if (this.simAccumulator >= 0.5) {
      const stepDt = this.simAccumulator;
      this.simAccumulator = 0;
      this.stepGrowth(stepDt, doorOpen);
    }

    this.syncVisuals();
  }

  private stepGrowth(stepDt: number, doorOpen: boolean): void {
    this.nextHealth.set(this.health);

    for (let r = 1; r < this.rows - 1; r++) {
      for (let c = 1; c < this.cols - 1; c++) {
        const idx = this.index(c, r);
        this.scorched[idx] = Math.max(0, this.scorched[idx] - stepDt * 0.12);

        const curr = this.health[idx];
        if (curr >= 1.0 || this.scorched[idx] > 0.35) continue;

        const wz = this.originZ + r * this.cellSize;
        const wx = this.originX + c * this.cellSize;

        // Closed blast door blocks biomass from creeping through the doorway
        if (!doorOpen && Math.abs(wz + 12) < 0.65 && Math.abs(wx) < 2.2) continue;

        const neighborSum =
          this.health[this.index(c - 1, r)] +
          this.health[this.index(c + 1, r)] +
          this.health[this.index(c, r - 1)] +
          this.health[this.index(c, r + 1)];

        if (neighborSum > 0.65) {
          this.nextHealth[idx] = Math.min(1.0, curr + neighborSum * 0.025 * stepDt);
        }
      }
    }

    this.health.set(this.nextHealth);
  }

  private syncVisuals(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = this.index(c, r);
        const h = this.health[idx];

        if (h <= 0.02) {
          this.dummy.position.set(0, -10, 0);
          this.dummy.scale.set(0.001, 0.001, 0.001);
        } else {
          const wx = this.originX + c * this.cellSize;
          const wz = this.originZ + r * this.cellSize;
          const thickness = 0.15 + h * 1.1;
          this.dummy.position.set(wx, thickness * 0.07, wz);
          this.dummy.scale.set(0.85 + h * 0.25, thickness, 0.85 + h * 0.25);

          // Stage 1 dark vein -> Stage 2 crimson/violet pulse
          this.tmpColor.setRGB(0.16 + h * 0.26, 0.06 + h * 0.05, 0.15 + h * 0.22);
          this.instancedMesh.setColorAt(idx, this.tmpColor);
        }

        this.dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(idx, this.dummy.matrix);
      }
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }
}