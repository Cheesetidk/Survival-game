import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { MegastructureRoom } from './world/MegastructureRoom';
import { FirstPersonController } from './player/FirstPersonController';
import { BiomassGrid } from './biomass/BiomassGrid';
import { GrappleRope } from './physics/GrappleRope';

async function bootstrap(): Promise<void> {
  await RAPIER.init();

  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const overlay = document.getElementById('overlay') as HTMLDivElement;
  const promptEl = document.getElementById('prompt') as HTMLDivElement;
  const statusTagEl = document.getElementById('status-tag') as HTMLDivElement;

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

  const world = new RAPIER.World({ x: 0.0, y: -20.0, z: 0.0 });
  const room = new MegastructureRoom(scene, world);
  const biomass = new BiomassGrid(scene);
  const grapple = new GrappleRope(scene);
  const player = new FirstPersonController(
    camera,
    scene,
    world,
    new THREE.Vector3(0, 1.0, 4.5)
  );

  overlay.addEventListener('click', () => {
    canvas.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    overlay.classList.toggle('hidden', document.pointerLockElement === canvas);
  });

  // Right-click fires or detaches XPBD grappling hook
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousedown', (e) => {
    if (!player.isLocked) return;
    if (e.button === 2) {
      grapple.fireOrDetach(world, player.getEyePosition(), player.getForwardDirection());
    }
  });

  const raycaster = new THREE.Raycaster();
  raycaster.far = 3.2;
  let lookingAtDoor = false;

  window.addEventListener('keydown', (e) => {
    if (!player.isLocked) return;

    if (e.code === 'KeyE' && lookingAtDoor) {
      room.toggleBlastDoor();
    } else if (e.code === 'KeyG') {
      const origin = player.getEyePosition();
      const dir = player.getForwardDirection();
      origin.addScaledVector(dir, 0.55);
      room.spawnChemLight(origin, dir);
    } else if (e.code === 'KeyV') {
      const foot = player.getFootPosition();
      const dir = player.getForwardDirection();
      const deployPos = foot.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 0.9);
      biomass.deployUVLamp(scene, deployPos, dir);
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
      const foot = player.getFootPosition();
      const dragMultiplier = biomass.getMovementDragAt(foot.x, foot.y, foot.z);
      statusTagEl.classList.toggle('visible', dragMultiplier < 0.95);

      const ropePull = grapple.step(
        fixedDt,
        player.getHarnessPosition(),
        player.isReelingWinch()
      );

      player.update(fixedDt, dragMultiplier, ropePull, grapple.isAttached());
      room.update(fixedDt);
      biomass.update(fixedDt, room.isDoorOpen());
      world.step();
      accumulator -= fixedDt;
    }

    if (player.isLocked) {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = raycaster.intersectObjects(room.interactables, false);
      lookingAtDoor = hits.length > 0;
    } else {
      lookingAtDoor = false;
    }
    promptEl.classList.toggle('visible', lookingAtDoor);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
}

bootstrap();