import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';

export class GrappleRope {
  private readonly segments = 18;
  private readonly pos: THREE.Vector3[] = [];
  private readonly prevPos: THREE.Vector3[] = [];

  private readonly line: THREE.Line;
  private readonly hookMesh: THREE.Mesh;

  private attached = false;
  private readonly anchorPoint = new THREE.Vector3();
  private ropeLength = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i <= this.segments; i++) {
      this.pos.push(new THREE.Vector3());
      this.prevPos.push(new THREE.Vector3());
    }

    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array((this.segments + 1) * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const material = new THREE.LineBasicMaterial({ color: 0xebcb8b });
    this.line = new THREE.Line(geometry, material);
    this.line.visible = false;
    this.line.frustumCulled = false;
    scene.add(this.line);

    this.hookMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.11, 0),
      new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0x78350f,
        emissiveIntensity: 0.8,
        metalness: 0.85,
        roughness: 0.3,
        flatShading: true,
      })
    );
    this.hookMesh.visible = false;
    scene.add(this.hookMesh);
  }

  public isAttached(): boolean {
    return this.attached;
  }

  public fireOrDetach(
    world: RAPIER.World,
    origin: THREE.Vector3,
    direction: THREE.Vector3
  ): boolean {
    if (this.attached) {
      this.detach();
      return false;
    }

    // Offset ray origin slightly forward so it doesn't hit the player's own capsule
    const start = origin.clone().addScaledVector(direction, 0.65);
    const ray = new RAPIER.Ray(
      { x: start.x, y: start.y, z: start.z },
      { x: direction.x, y: direction.y, z: direction.z }
    );

    const hit = world.castRay(ray, 22.0, true);
    if (!hit) return false;

    const hitDist = hit.timeOfImpact;
    if (hitDist < 1.0) return false;

    this.anchorPoint.copy(start).addScaledVector(direction, hitDist);
    this.ropeLength = origin.distanceTo(this.anchorPoint);
    this.attached = true;

    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      this.pos[i].lerpVectors(this.anchorPoint, origin, t);
      this.prevPos[i].copy(this.pos[i]);
    }

    this.hookMesh.position.copy(this.anchorPoint);
    this.hookMesh.visible = true;
    this.line.visible = true;
    return true;
  }

  public detach(): void {
    this.attached = false;
    this.line.visible = false;
    this.hookMesh.visible = false;
  }

  public step(
    dt: number,
    playerAnchor: THREE.Vector3,
    reelingIn: boolean
  ): THREE.Vector3 {
    const pullDelta = new THREE.Vector3();
    if (!this.attached) return pullDelta;

    // Motorized winch shortens rope rest-length when holding [R]
    if (reelingIn) {
      this.ropeLength = Math.max(1.35, this.ropeLength - dt * 6.5);
    }

    // Pin segment 0 to world hook anchor and segment N to player harness
    this.pos[0].copy(this.anchorPoint);
    this.pos[this.segments].copy(playerAnchor);

    // Verlet integration for intermediate cable slack
    const gravity = -14.0 * dt * dt;
    for (let i = 1; i < this.segments; i++) {
      const p = this.pos[i];
      const prev = this.prevPos[i];
      const vx = (p.x - prev.x) * 0.985;
      const vy = (p.y - prev.y) * 0.985 + gravity;
      const vz = (p.z - prev.z) * 0.985;
      prev.copy(p);
      p.x += vx;
      p.y += vy;
      p.z += vz;
    }

    // XPBD distance constraint relaxation (6 iterations)
    const segLen = this.ropeLength / this.segments;
    for (let iter = 0; iter < 6; iter++) {
      this.pos[0].copy(this.anchorPoint);
      this.pos[this.segments].copy(playerAnchor);

      for (let i = 0; i < this.segments; i++) {
        const a = this.pos[i];
        const b = this.pos[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.0001) continue;

        const diff = (dist - segLen) / dist;
        const wA = i === 0 ? 0 : 0.5;
        const wB = i + 1 === this.segments ? 0 : 0.5;
        const wSum = wA + wB;
        if (wSum === 0) continue;

        a.x += dx * diff * (wA / wSum);
        a.y += dy * diff * (wA / wSum);
        a.z += dz * diff * (wA / wSum);

        b.x -= dx * diff * (wB / wSum);
        b.y -= dy * diff * (wB / wSum);
        b.z -= dz * diff * (wB / wSum);
      }
    }

    // Apply tension constraint to player if stretched beyond ropeLength
    const toAnchor = new THREE.Vector3().subVectors(this.anchorPoint, playerAnchor);
    const currentDist = toAnchor.length();
    if (currentDist > this.ropeLength && currentDist > 0.001) {
      const excess = currentDist - this.ropeLength;
      toAnchor.normalize();
      pullDelta.copy(toAnchor).multiplyScalar(Math.min(excess, dt * 12.0));
    }

    // Sync rendered cable vertices
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= this.segments; i++) {
      attr.setXYZ(i, this.pos[i].x, this.pos[i].y, this.pos[i].z);
    }
    attr.needsUpdate = true;

    return pullDelta;
  }
}