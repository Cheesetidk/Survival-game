import * as THREE from 'three';

export interface ConcretePBRSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

function createSeededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createBrutalistConcreteTextures(repeatX = 4, repeatY = 4): ConcretePBRSet {
  const size = 512;
  const rand = createSeededRandom(40926);

  const albedoCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  albedoCanvas.width = roughCanvas.width = bumpCanvas.width = size;
  albedoCanvas.height = roughCanvas.height = bumpCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;

  // Base concrete tone
  aCtx.fillStyle = '#4a4e54';
  aCtx.fillRect(0, 0, size, size);

  // Damp brutalist surface defaults to semi-wet specular patches (mid-dark roughness)
  rCtx.fillStyle = '#9a9a9a';
  rCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Aggregate pitting & formwork grain
  for (let i = 0; i < 16000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 1 + rand() * 3;
    const h = 1 + rand() * 3;
    const dark = rand() > 0.45;

    aCtx.fillStyle = dark ? 'rgba(20, 22, 25, 0.16)' : 'rgba(130, 136, 144, 0.12)';
    aCtx.fillRect(x, y, w, h);

    bCtx.fillStyle = dark ? 'rgba(40, 40, 40, 0.25)' : 'rgba(210, 210, 210, 0.18)';
    bCtx.fillRect(x, y, w, h);
  }

  // Moisture stains & vertical water seepage streaks
  for (let i = 0; i < 28; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 24 + rand() * 64;

    const grad = rCtx.createRadialGradient(x, y, 2, x, y, radius);
    grad.addColorStop(0, 'rgba(35, 35, 35, 0.45)'); // Low roughness = wet sheen
    grad.addColorStop(1, 'rgba(154, 154, 154, 0)');
    rCtx.fillStyle = grad;
    rCtx.fillRect(0, 0, size, size);

    const stain = aCtx.createRadialGradient(x, y, 2, x, y, radius);
    stain.addColorStop(0, 'rgba(18, 22, 24, 0.24)');
    stain.addColorStop(1, 'rgba(74, 78, 84, 0)');
    aCtx.fillStyle = stain;
    aCtx.fillRect(0, 0, size, size);
  }

  // Cast-concrete formwork panel seams & tie-rod holes
  const panels = 2;
  const step = size / panels;
  aCtx.strokeStyle = 'rgba(15, 17, 20, 0.55)';
  aCtx.lineWidth = 2;
  bCtx.strokeStyle = 'rgba(20, 20, 20, 0.85)';
  bCtx.lineWidth = 3;

  for (let p = 0; p < panels; p++) {
    const offset = p * step;
    aCtx.strokeRect(offset + 1, 1, step - 2, size - 2);
    bCtx.strokeRect(offset + 1, 1, step - 2, size - 2);

    // Formwork tie-rod indentations
    for (const ty of [step * 0.25, step * 0.75, step * 1.25, step * 1.75]) {
      for (const tx of [offset + 28, offset + step - 28]) {
        bCtx.fillStyle = '#181818';
        bCtx.beginPath();
        bCtx.arc(tx, ty, 4, 0, Math.PI * 2);
        bCtx.fill();

        aCtx.fillStyle = '#23262b';
        aCtx.beginPath();
        aCtx.arc(tx, ty, 4, 0, Math.PI * 2);
        aCtx.fill();
      }
    }
  }

  const configure = (canvas: HTMLCanvasElement, isColor: boolean): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 8;
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    return tex;
  };

  return {
    map: configure(albedoCanvas, true),
    roughnessMap: configure(roughCanvas, false),
    bumpMap: configure(bumpCanvas, false),
  };
}