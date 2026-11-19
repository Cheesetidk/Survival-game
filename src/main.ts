import * as THREE from 'three';
import RAPIER from './physics/rapier';
import { MegastructureRoom } from './world/MegastructureRoom';
import { FirstPersonController } from './player/FirstPersonController';
import { BiomassGrid } from './biomass/BiomassGrid';
import { GrappleRope } from './physics/GrappleRope';
import { InventorySystem, type ItemId } from './inventory/InventorySystem';
import { P2PSession } from './net/P2PSession';
import { AcousticEngine } from './audio/AcousticEngine';
import { BiomassStalker } from './ai/BiomassStalker';

async function bootstrap(): Promise<void> {
  const overlay = document.getElementById('overlay') as HTMLDivElement;
  const enterBtn = document.getElementById('enter-btn') as HTMLButtonElement;
  const netBadge = document.getElementById('net-badge') as HTMLDivElement;

  enterBtn.textContent = 'INITIALIZING PHYSICS...';
  enterBtn.disabled = true;

  await RAPIER.init();

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const roomInput = document.getElementById('room-input') as HTMLInputElement;
  const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  const promptEl = document.getElementById('prompt') as HTMLDivElement;
  const statusTagEl = document.getElementById('status-tag') as HTMLDivElement;
  const invModal = document.getElementById('inv-modal') as HTMLDivElement;
  const sporeVignetteEl = document.getElementById('spore-vignette') as HTMLDivElement;
  const suitLabelEl = document.getElementById('suit-label') as HTMLDivElement;
  const suitBarEl = document.getElementById('suit-bar') as HTMLDivElement;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06080b);
  scene.fog = new THREE.FogExp2(0x090c10, 0.048);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    120
  );

  const spawnPos = new THREE.Vector3(0, 1.0, 4.5);
  const world = new RAPIER.World({ x: 0.0, y: -20.0, z: 0.0 });
  const audio = new AcousticEngine();
  const room = new MegastructureRoom(scene, world);
  const biomass = new BiomassGrid(scene);
  const grapple = new GrappleRope(scene);
  const stalker = new BiomassStalker(scene);
  const player = new FirstPersonController(camera, scene, world, spawnPos);

  let suitIntegrity = 100;
  let suppressantTimer = 0;
  let inventoryOpen = false;
  let stalkerSyncTimer = 0;

  const updateSuitHUD = (): void => {
    const pct = Math.max(0, Math.round(suitIntegrity));
    suitLabelEl.textContent = `SUIT INTEGRITY // ${pct}%`;
    suitBarEl.style.transform = `scaleX(${(pct / 100).toFixed(3)})`;
    suitBarEl.style.background = pct > 45 ? '#a3be8c' : pct > 20 ? '#ebcb8b' : '#bf616a';
  };

  const handleUseItem = (item: ItemId): void => {
    if (item === 'spore_suppressant') {
      suppressantTimer = 25.0;
      suitIntegrity = Math.min(100, suitIntegrity + 35);
      updateSuitHUD();
    }
  };

  const inventory = new InventorySystem(scene, handleUseItem);

  const p2p = new P2PSession(scene, {
    onDoorSync: (open) => room.setDoorOpen(open),
    onChemLight: (origin, forward) => room.spawnChemLight(origin, forward),
    onUVLamp: (origin, forward) => biomass.deployUVLamp(scene, origin, forward),
    onSealant: (x, z) => biomass.applyAlkalineSealant(x, z),
    onLootClaimed: (nodeId) => {
      inventory.claimSalvageNode(nodeId, false, handleUseItem);
    },
    onStalkerSync: (sync) => stalker.applyRemoteState(sync),
    onRequestSnapshot: () => ({
      doorOpen: room.getDoorTargetState(),
      claimedLootIds: inventory.getClaimedNodeIds(),
    }),
  });

  const enterCorridor = (): void => {
    audio.unlock();
    overlay.classList.add('hidden');

    if (typeof canvas.requestPointerLock === 'function') {
      try {
        const lockResult = canvas.requestPointerLock() as unknown;
        if (lockResult && typeof (lockResult as Promise<void>).catch === 'function') {
          (lockResult as Promise<void>).catch(() => {
            player.enableFallbackLook();
          });
        }
      } catch {
        player.enableFallbackLook();
      }
    } else {
      player.enableFallbackLook();
    }
  };

  enterBtn.disabled = false;
  enterBtn.textContent = 'ENTER MEGACORRIDOR';
  enterBtn.addEventListener('click', enterCorridor);

  // Clicking the canvas directly re-locks the mouse if you pressed ESC
  canvas.addEventListener('click', () => {
    if (!inventoryOpen && overlay.classList.contains('hidden') && !document.pointerLockElement) {
      enterCorridor();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!inventoryOpen) {
      overlay.classList.toggle('hidden', locked);
    }
  });

  joinBtn.addEventListener('click', () => {
    void p2p.connect(roomInput.value).catch((err) => {
      console.warn('P2P reconnect failed:', err);
    });
  });

  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(window.location.href);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy Invite';
    }, 1500);
  });

  const hashMatch = window.location.hash.match(/room=([A-Za-z0-9-_]+)/);
  const initialRoom = hashMatch ? decodeURIComponent(hashMatch[1]).toUpperCase() : 'SEC-04';
  roomInput.value = initialRoom;
  void p2p.connect(initialRoom).catch(() => {
    netBadge.textContent = 'SECTOR LOCAL // SOLO MODE';
  });

  const setInventoryOpen = (open: boolean): void => {
    inventoryOpen = open;
    invModal.classList.toggle('open', open);
    if (open) {
      overlay.classList.add('hidden');
      inventory.renderUI(handleUseItem);
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } else {
      enterCorridor();
    }
  };

  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousedown', (e) => {
    if (!player.isLocked || inventoryOpen) return;
    if (e.button === 0) {
      if (player.triggerArcSwing()) {
        audio.playArcDischarge();
        stalker.tryArcStun(player.getEyePosition(), player.getForwardDirection());
      }
    } else if (e.button === 2) {
      grapple.fireOrDetach(world, player.getEyePosition(), player.getForwardDirection());
    }
  });

  const raycaster = new THREE.Raycaster();
  raycaster.far = 3.4;
  let targetedDoor = false;
  let targetedSalvageId: string | null = null;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      if (player.isLocked || inventoryOpen) {
        setInventoryOpen(!inventoryOpen);
      }
      return;
    }

    if (!player.isLocked || inventoryOpen) return;

    if (e.code === 'KeyE') {
      if (targetedDoor) {
        room.toggleBlastDoor();
        audio.playBlastDoorCycle();
        p2p.broadcastDoor(room.getDoorTargetState());
      } else if (targetedSalvageId) {
        const claimed = inventory.claimSalvageNode(targetedSalvageId, true, handleUseItem);
        if (claimed) {
          p2p.broadcastLootClaimed(targetedSalvageId);
        }
      }
    } else if (e.code === 'KeyG') {
      if (inventory.consumeItem('chem_light', 1, handleUseItem)) {
        const origin = player.getEyePosition();
        const dir = player.getForwardDirection();
        origin.addScaledVector(dir, 0.55);
        room.spawnChemLight(origin, dir);
        p2p.broadcastChemLight(origin, dir);
      }
    } else if (e.code === 'KeyV') {
      if (inventory.consumeItem('uv_beacon', 1, handleUseItem)) {
        const foot = player.getFootPosition();
        const dir = player.getForwardDirection();
        const deployPos = foot.addScaledVector(
          new THREE.Vector3(dir.x, 0, dir.z).normalize(),
          0.9
        );
        biomass.deployUVLamp(scene, deployPos, dir);
        p2p.broadcastUVLamp(deployPos, dir);
      }
    } else if (e.code === 'KeyH') {
      if (inventory.consumeItem('alkaline_spray', 1, handleUseItem)) {
        const foot = player.getFootPosition();
        biomass.applyAlkalineSealant(foot.x, foot.z, 2.5);
        p2p.broadcastSealant(foot.x, foot.z);
      }
    } else if (e.code === 'Space' && grapple.isAttached()) {
      grapple.detach();
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const fixedDt = 1 / 60;
  let accumulator = 0;
  let lastTime = performance.now();

  function animate(now: number): void {
    requestAnimationFrame(animate);

    const frameDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    accumulator += frameDt;

    while (accumulator >= fixedDt) {
      if (suppressantTimer > 0) {
        suppressantTimer = Math.max(0, suppressantTimer - fixedDt);
      }

      const foot = player.getFootPosition();
      const rawDrag = biomass.getMovementDragAt(foot.x, foot.y, foot.z);
      const dragMultiplier = suppressantTimer > 0 ? 1.0 : rawDrag;
      statusTagEl.classList.toggle('visible', dragMultiplier < 0.95);

      const ropePull = grapple.step(
        fixedDt,
        player.getHarnessPosition(),
        player.isReelingWinch()
      );

      player.update(fixedDt, dragMultiplier, ropePull, grapple.isAttached(), (sprinting) => {
        audio.playFootstep(sprinting, rawDrag < 0.95);
      });

      room.update(fixedDt);
      biomass.update(fixedDt, room.isDoorOpen());
      audio.updatePortalAcoustics(fixedDt, foot.z, room.isDoorOpen());

      const damage = stalker.update(
        fixedDt,
        foot,
        player.getForwardDirection(),
        player.isFlashlightOn(),
        player.getNoiseLevel(),
        room.isDoorOpen(),
        biomass,
        room.getActiveChemLightPositions(),
        audio
      );

      if (damage > 0) {
        suitIntegrity = Math.max(0, suitIntegrity - damage);
        updateSuitHUD();
        if (suitIntegrity === 0) {
          suitIntegrity = 100;
          updateSuitHUD();
          grapple.detach();
          player.resetToSpawn(spawnPos);
        }
      }

      const sporeDensity = suppressantTimer > 0 ? 0 : biomass.getIntensityAt(foot.x, foot.z);
      const stalkerDist = stalker.getPosition().distanceTo(foot);
      const threatProx = Math.max(0, 1 - stalkerDist / 10);
      const vignetteAlpha = Math.min(0.95, Math.max(sporeDensity * 0.75, threatProx * 0.85));
      sporeVignetteEl.style.opacity = vignetteAlpha.toFixed(2);

      world.step();

      const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
      const pitch = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').x;
      p2p.update(fixedDt, foot, yaw, pitch, player.isFlashlightOn());

      stalkerSyncTimer += fixedDt;
      if (stalkerSyncTimer >= 0.1) {
        stalkerSyncTimer = 0;
        p2p.broadcastStalker(stalker.getSyncState());
      }

      accumulator -= fixedDt;
    }

    if (player.isLocked && !inventoryOpen) {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const targets = [...room.interactables, ...inventory.salvageMeshes];
      const hits = raycaster.intersectObjects(targets, false);

      targetedDoor = false;
      targetedSalvageId = null;

      if (hits.length > 0) {
        const hitObj = hits[0].object;
        if (hitObj.name === 'blast_door') {
          targetedDoor = true;
          promptEl.textContent = '[E] CYCLE BLAST DOOR';
          promptEl.classList.add('visible');
        } else if (typeof hitObj.userData.salvageId === 'string') {
          targetedSalvageId = hitObj.userData.salvageId;
          promptEl.textContent = inventory.getSalvageLabel(targetedSalvageId);
          promptEl.classList.add('visible');
        }
      } else {
        promptEl.classList.remove('visible');
      }
    } else {
      targetedDoor = false;
      targetedSalvageId = null;
      promptEl.classList.remove('visible');
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}

bootstrap().catch((err) => {
  console.error('Boot error:', err);
  const enterBtn = document.getElementById('enter-btn') as HTMLButtonElement | null;
  if (enterBtn) {
    enterBtn.style.background = '#bf616a';
    enterBtn.textContent = `BOOT ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
});