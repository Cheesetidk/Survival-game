import * as THREE from 'three';
import { joinRoom } from 'trystero';
import type { StalkerSyncState } from '../ai/BiomassStalker';

type TrysteroRoom = ReturnType<typeof joinRoom>;

type PosePacket = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flash: boolean;
};

type WorldEventPacket =
  | { kind: 'door'; open: boolean }
  | { kind: 'chemlight'; ox: number; oy: number; oz: number; fx: number; fy: number; fz: number }
  | { kind: 'uvlamp'; ox: number; oy: number; oz: number; fx: number; fy: number; fz: number }
  | { kind: 'sealant'; x: number; z: number }
  | { kind: 'loot'; nodeId: string }
  | { kind: 'stalker'; data: StalkerSyncState };

interface RemoteSurvivor {
  root: THREE.Group;
  headPivot: THREE.Group;
  flashlight: THREE.SpotLight;
  targetPos: THREE.Vector3;
  targetYaw: number;
  targetPitch: number;
}

export interface WorldEventHandlers {
  onDoorSync: (open: boolean) => void;
  onChemLight: (origin: THREE.Vector3, forward: THREE.Vector3) => void;
  onUVLamp: (origin: THREE.Vector3, forward: THREE.Vector3) => void;
  onSealant: (x: number, z: number) => void;
  onLootClaimed: (nodeId: string) => void;
  onStalkerSync: (state: StalkerSyncState) => void;
  onRequestSnapshot: () => { doorOpen: boolean; claimedLootIds: string[] };
}

export class P2PSession {
  private readonly scene: THREE.Scene;
  private readonly handlers: WorldEventHandlers;
  private readonly badgeEl = document.getElementById('net-badge')!;

  private room: TrysteroRoom | null = null;
  private roomCode = '';
  private readonly peers = new Map<string, RemoteSurvivor>();

  private sendPoseFn: ((data: PosePacket) => void) | null = null;
  private sendEventFn: ((data: WorldEventPacket) => void) | null = null;
  private poseTimer = 0;

  constructor(scene: THREE.Scene, handlers: WorldEventHandlers) {
    this.scene = scene;
    this.handlers = handlers;
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  public async connect(code: string): Promise<void> {
    const cleanCode = code.trim().toUpperCase() || 'SEC-04';
    if (this.room && this.roomCode === cleanCode) return;

    if (this.room) {
      await this.room.leave();
      for (const [, avatar] of this.peers) {
        this.scene.remove(avatar.root);
      }
      this.peers.clear();
    }

    this.roomCode = cleanCode;
    window.location.hash = `room=${encodeURIComponent(cleanCode)}`;

    // identity: 'none' creates a unique peer ID per tab so local multi-tab testing works cleanly
    const room = joinRoom(
      {
        appId: 'arcology-sector-04-slice',
        maxUsers: 4,
        identity: 'none',
      },
      cleanCode
    );
    this.room = room;

    const poseAction = room.makeAction<PosePacket>('pose');
    const eventAction = room.makeAction<WorldEventPacket>('event');

    this.sendPoseFn = (data) => {
      void poseAction.send(data);
    };
    this.sendEventFn = (data) => {
      void eventAction.send(data);
    };

    poseAction.onMessage((data, { userId }) => {
      const avatar = this.peers.get(userId);
      if (!avatar) return;
      avatar.targetPos.set(data.x, data.y, data.z);
      avatar.targetYaw = data.yaw;
      avatar.targetPitch = data.pitch;
      avatar.flashlight.visible = data.flash;
    });

    eventAction.onMessage((ev) => {
      if (ev.kind === 'door') {
        this.handlers.onDoorSync(ev.open);
      } else if (ev.kind === 'chemlight') {
        this.handlers.onChemLight(
          new THREE.Vector3(ev.ox, ev.oy, ev.oz),
          new THREE.Vector3(ev.fx, ev.fy, ev.fz)
        );
      } else if (ev.kind === 'uvlamp') {
        this.handlers.onUVLamp(
          new THREE.Vector3(ev.ox, ev.oy, ev.oz),
          new THREE.Vector3(ev.fx, ev.fy, ev.fz)
        );
      } else if (ev.kind === 'sealant') {
        this.handlers.onSealant(ev.x, ev.z);
      } else if (ev.kind === 'loot') {
        this.handlers.onLootClaimed(ev.nodeId);
      } else if (ev.kind === 'stalker') {
        this.handlers.onStalkerSync(ev.data);
      }
    });

    room.onUserJoin(({ userId }) => {
      if (!this.peers.has(userId)) {
        this.peers.set(userId, this.createRemoteAvatar(userId));
      }
      this.updateBadge();

      // Send current sector state to newly joined survivors
      const snap = this.handlers.onRequestSnapshot();
      this.broadcastDoor(snap.doorOpen);
      for (const nodeId of snap.claimedLootIds) {
        this.broadcastLootClaimed(nodeId);
      }
    });

    room.onUserLeave(({ userId }) => {
      const avatar = this.peers.get(userId);
      if (avatar) {
        this.scene.remove(avatar.root);
        this.peers.delete(userId);
      }
      this.updateBadge();
    });

    room.onError((err) => {
      this.badgeEl.textContent = `P2P WARN: ${err.code}`;
    });

    this.updateBadge();
  }

  private updateBadge(): void {
    const count = this.peers.size + 1;
    this.badgeEl.textContent = `SECTOR ${this.roomCode} // SURVIVORS: ${count}/4`;
  }

  private createRemoteAvatar(userId: string): RemoteSurvivor {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) | 0;
    }
    const palette = [0x38bdf8, 0x34d399, 0xfbbf24, 0xf472b6];
    const suitColor = palette[Math.abs(hash) % palette.length];

    const root = new THREE.Group();

    const suitMat = new THREE.MeshStandardMaterial({
      color: suitColor,
      roughness: 0.65,
      metalness: 0.15,
      flatShading: true,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e242b,
      roughness: 0.75,
      flatShading: true,
    });

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.85, 0.28), darkMat);
    legs.position.y = 0.425;
    legs.castShadow = true;
    root.add(legs);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.65, 0.32), suitMat);
    torso.position.y = 1.15;
    torso.castShadow = true;
    root.add(torso);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.65, 0);
    root.add(headPivot);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), suitMat);
    head.castShadow = true;
    headPivot.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0x38bdf8,
        emissiveIntensity: 1.8,
      })
    );
    visor.position.set(0, 0.03, -0.17);
    headPivot.add(visor);

    const flashlight = new THREE.SpotLight(0xeef6ff, 28, 22, Math.PI / 5.5, 0.5, 1.5);
    flashlight.position.set(0.16, 0.04, -0.2);
    flashlight.castShadow = false;
    flashlight.target.position.set(0, 0, -2);
    headPivot.add(flashlight);
    headPivot.add(flashlight.target);

    this.scene.add(root);

    return {
      root,
      headPivot,
      flashlight,
      targetPos: new THREE.Vector3(0, 0, 4.5),
      targetYaw: 0,
      targetPitch: 0,
    };
  }

  public broadcastDoor(open: boolean): void {
    this.sendEventFn?.({ kind: 'door', open });
  }

  public broadcastChemLight(origin: THREE.Vector3, forward: THREE.Vector3): void {
    this.sendEventFn?.({
      kind: 'chemlight',
      ox: origin.x,
      oy: origin.y,
      oz: origin.z,
      fx: forward.x,
      fy: forward.y,
      fz: forward.z,
    });
  }

  public broadcastUVLamp(origin: THREE.Vector3, forward: THREE.Vector3): void {
    this.sendEventFn?.({
      kind: 'uvlamp',
      ox: origin.x,
      oy: origin.y,
      oz: origin.z,
      fx: forward.x,
      fy: forward.y,
      fz: forward.z,
    });
  }

  public broadcastSealant(x: number, z: number): void {
    this.sendEventFn?.({ kind: 'sealant', x, z });
  }

  public broadcastLootClaimed(nodeId: string): void {
    this.sendEventFn?.({ kind: 'loot', nodeId });
  }

  public broadcastStalker(data: StalkerSyncState): void {
    this.sendEventFn?.({ kind: 'stalker', data });
  }

  public update(
    dt: number,
    localFeet: THREE.Vector3,
    yaw: number,
    pitch: number,
    flashlightOn: boolean
  ): void {
    this.poseTimer += dt;
    if (this.poseTimer >= 0.05 && this.sendPoseFn) {
      this.poseTimer = 0;
      this.sendPoseFn({
        x: Number(localFeet.x.toFixed(3)),
        y: Number(localFeet.y.toFixed(3)),
        z: Number(localFeet.z.toFixed(3)),
        yaw: Number(yaw.toFixed(3)),
        pitch: Number(pitch.toFixed(3)),
        flash: flashlightOn,
      });
    }

    const alpha = Math.min(1, dt * 14);
    for (const [, avatar] of this.peers) {
      avatar.root.position.lerp(avatar.targetPos, alpha);
      avatar.root.rotation.y = avatar.targetYaw;
      avatar.headPivot.rotation.x = avatar.targetPitch;
    }
  }
}