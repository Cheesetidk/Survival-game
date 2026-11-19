import * as THREE from 'three';

export type ItemId =
  | 'scrap_metal'
  | 'battery_cell'
  | 'polymer_tube'
  | 'alkaline_powder'
  | 'hydro_herb'
  | 'chem_light'
  | 'uv_beacon'
  | 'alkaline_spray'
  | 'spore_suppressant';

export interface ItemDef {
  id: ItemId;
  name: string;
  w: number;
  h: number;
  maxStack: number;
  color: string;
  usableHint?: string;
}

export interface GridStack {
  uid: number;
  def: ItemDef;
  x: number;
  y: number;
  count: number;
}

export interface CraftRecipe {
  id: string;
  output: ItemId;
  outputCount: number;
  ingredients: { item: ItemId; count: number }[];
}

export interface SalvageNode {
  id: string;
  item: ItemId;
  count: number;
  mesh: THREE.Mesh;
  claimed: boolean;
}

export const ITEM_DEFS: Record<ItemId, ItemDef> = {
  scrap_metal: { id: 'scrap_metal', name: 'Scrap Plate', w: 2, h: 1, maxStack: 4, color: '#475569' },
  battery_cell: { id: 'battery_cell', name: 'Solid Cell', w: 1, h: 1, maxStack: 3, color: '#0284c7' },
  polymer_tube: { id: 'polymer_tube', name: 'Polymer Tube', w: 1, h: 2, maxStack: 4, color: '#0d9488' },
  alkaline_powder: { id: 'alkaline_powder', name: 'Alkaline Salt', w: 1, h: 1, maxStack: 5, color: '#64748b' },
  hydro_herb: { id: 'hydro_herb', name: 'Hydro-Herb', w: 1, h: 1, maxStack: 5, color: '#16a34a' },
  chem_light: {
    id: 'chem_light',
    name: 'Chem-Light',
    w: 1,
    h: 1,
    maxStack: 6,
    color: '#10b981',
    usableHint: 'Press [G] in corridor to throw',
  },
  uv_beacon: {
    id: 'uv_beacon',
    name: 'UV-C Lamp',
    w: 2,
    h: 2,
    maxStack: 2,
    color: '#9333ea',
    usableHint: 'Press [V] in corridor to deploy',
  },
  alkaline_spray: {
    id: 'alkaline_spray',
    name: 'Sealant Can',
    w: 1,
    h: 2,
    maxStack: 2,
    color: '#d97706',
    usableHint: 'Press [H] to coat floor against biomass',
  },
  spore_suppressant: {
    id: 'spore_suppressant',
    name: 'Antiviral Vial',
    w: 1,
    h: 1,
    maxStack: 3,
    color: '#e11d48',
    usableHint: 'Click to purge spore entanglement',
  },
};

export const TIER1_RECIPES: CraftRecipe[] = [
  {
    id: 'craft_chemlight',
    output: 'chem_light',
    outputCount: 2,
    ingredients: [
      { item: 'polymer_tube', count: 1 },
      { item: 'alkaline_powder', count: 1 },
    ],
  },
  {
    id: 'craft_uv_beacon',
    output: 'uv_beacon',
    outputCount: 1,
    ingredients: [
      { item: 'scrap_metal', count: 2 },
      { item: 'battery_cell', count: 1 },
    ],
  },
  {
    id: 'craft_alkaline_spray',
    output: 'alkaline_spray',
    outputCount: 1,
    ingredients: [
      { item: 'polymer_tube', count: 1 },
      { item: 'alkaline_powder', count: 2 },
    ],
  },
  {
    id: 'craft_suppressant',
    output: 'spore_suppressant',
    outputCount: 1,
    ingredients: [{ item: 'hydro_herb', count: 2 }],
  },
];

export class InventorySystem {
  public readonly cols = 6;
  public readonly rows = 4;
  public readonly salvageMeshes: THREE.Object3D[] = [];

  private readonly stacks: GridStack[] = [];
  private nextUid = 1;
  private readonly nodes = new Map<string, SalvageNode>();

  private readonly gridEl = document.getElementById('inv-grid')!;
  private readonly recipeListEl = document.getElementById('recipe-list')!;
  private readonly hintEl = document.getElementById('inv-hint')!;

  constructor(scene: THREE.Scene, onUseItem: (item: ItemId) => void) {
    // Starter field kit
    this.addItem('chem_light', 3);
    this.addItem('uv_beacon', 1);
    this.addItem('alkaline_spray', 1);

    this.spawnWorldSalvage(scene);
    this.renderUI(onUseItem);
  }

  private spawnWorldSalvage(scene: THREE.Scene): void {
    const placements: { id: string; item: ItemId; count: number; x: number; y: number; z: number }[] = [
      { id: 'sal_01', item: 'scrap_metal', count: 2, x: 3.3, y: 1.55, z: -4.4 },
      { id: 'sal_02', item: 'battery_cell', count: 1, x: -3.5, y: 1.25, z: -7.4 },
      { id: 'sal_03', item: 'polymer_tube', count: 2, x: -5.4, y: 0.25, z: -2.5 },
      { id: 'sal_04', item: 'alkaline_powder', count: 2, x: 5.2, y: 0.25, z: -9.5 },
      { id: 'sal_05', item: 'hydro_herb', count: 2, x: -5.2, y: 4.18, z: -21.0 },
      { id: 'sal_06', item: 'battery_cell', count: 1, x: 5.6, y: 5.38, z: -20.5 },
      { id: 'sal_07', item: 'scrap_metal', count: 2, x: 4.8, y: 0.25, z: -16.5 },
    ];

    for (const p of placements) {
      const def = ITEM_DEFS[p.item];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 0.26, 0.38),
        new THREE.MeshStandardMaterial({
          color: def.color,
          emissive: def.color,
          emissiveIntensity: 0.35,
          roughness: 0.45,
          flatShading: true,
        })
      );
      mesh.position.set(p.x, p.y, p.z);
      mesh.castShadow = true;
      mesh.userData.salvageId = p.id;
      scene.add(mesh);

      this.salvageMeshes.push(mesh);
      this.nodes.set(p.id, {
        id: p.id,
        item: p.item,
        count: p.count,
        mesh,
        claimed: false,
      });
    }
  }

  public getSalvageLabel(id: string): string {
    const node = this.nodes.get(id);
    if (!node || node.claimed) return '';
    return `[E] TAKE ${ITEM_DEFS[node.item].name.toUpperCase()} (×${node.count})`;
  }

  public claimSalvageNode(id: string, addToLocalInventory: boolean, onUseItem: (item: ItemId) => void): boolean {
    const node = this.nodes.get(id);
    if (!node || node.claimed) return false;

    if (addToLocalInventory) {
      const added = this.addItem(node.item, node.count);
      if (!added) {
        this.hintEl.textContent = 'RIG FULL — Free grid space before scavenging.';
        return false;
      }
      this.renderUI(onUseItem);
    }

    node.claimed = true;
    node.mesh.visible = false;
    const idx = this.salvageMeshes.indexOf(node.mesh);
    if (idx !== -1) this.salvageMeshes.splice(idx, 1);
    return true;
  }

  public getClaimedNodeIds(): string[] {
    const out: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.claimed) out.push(id);
    }
    return out;
  }

  public getCount(item: ItemId): number {
    return this.stacks
      .filter((s) => s.def.id === item)
      .reduce((acc, s) => acc + s.count, 0);
  }

  public consumeItem(item: ItemId, amount = 1, onUseItem?: (item: ItemId) => void): boolean {
    if (this.getCount(item) < amount) return false;
    let remaining = amount;

    for (let i = this.stacks.length - 1; i >= 0 && remaining > 0; i--) {
      const st = this.stacks[i];
      if (st.def.id !== item) continue;
      const take = Math.min(st.count, remaining);
      st.count -= take;
      remaining -= take;
      if (st.count === 0) {
        this.stacks.splice(i, 1);
      }
    }

    if (onUseItem) this.renderUI(onUseItem);
    return true;
  }

  public addItem(item: ItemId, amount = 1): boolean {
    const def = ITEM_DEFS[item];
    let remaining = amount;

    // Fill existing partial stacks first
    for (const st of this.stacks) {
      if (st.def.id === item && st.count < def.maxStack) {
        const space = def.maxStack - st.count;
        const add = Math.min(space, remaining);
        st.count += add;
        remaining -= add;
        if (remaining === 0) return true;
      }
    }

    // Place remaining items into free grid coordinates
    while (remaining > 0) {
      const slot = this.findFreeSlot(def.w, def.h);
      if (!slot) return false;
      const stackSize = Math.min(def.maxStack, remaining);
      this.stacks.push({
        uid: this.nextUid++,
        def,
        x: slot.x,
        y: slot.y,
        count: stackSize,
      });
      remaining -= stackSize;
    }
    return true;
  }

  private findFreeSlot(w: number, h: number): { x: number; y: number } | null {
    for (let y = 0; y <= this.rows - h; y++) {
      for (let x = 0; x <= this.cols - w; x++) {
        if (this.isAreaFree(x, y, w, h)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  private isAreaFree(x: number, y: number, w: number, h: number): boolean {
    for (const st of this.stacks) {
      const overlapX = x < st.x + st.def.w && x + w > st.x;
      const overlapY = y < st.y + st.def.h && y + h > st.y;
      if (overlapX && overlapY) return false;
    }
    return true;
  }

  public craft(recipe: CraftRecipe, onUseItem: (item: ItemId) => void): void {
    for (const ing of recipe.ingredients) {
      if (this.getCount(ing.item) < ing.count) {
        this.hintEl.textContent = 'MISSING SALVAGE COMPONENTS.';
        return;
      }
    }

    for (const ing of recipe.ingredients) {
      this.consumeItem(ing.item, ing.count);
    }

    const ok = this.addItem(recipe.output, recipe.outputCount);
    if (!ok) {
      // Refund if grid lacks space
      for (const ing of recipe.ingredients) {
        this.addItem(ing.item, ing.count);
      }
      this.hintEl.textContent = 'INSUFFICIENT GRID SLOTS FOR OUTPUT.';
    } else {
      this.hintEl.textContent = `FABRICATED: ${ITEM_DEFS[recipe.output].name.toUpperCase()}`;
    }

    this.renderUI(onUseItem);
  }

  public renderUI(onUseItem: (item: ItemId) => void): void {
    this.gridEl.innerHTML = '';
    for (let i = 0; i < this.cols * this.rows; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      this.gridEl.appendChild(cell);
    }

    for (const st of this.stacks) {
      const el = document.createElement('div');
      el.className = 'inv-item';
      el.style.background = st.def.color;
      el.style.left = `${6 + st.x * 45}px`;
      el.style.top = `${6 + st.y * 45}px`;
      el.style.width = `${st.def.w * 42 + (st.def.w - 1) * 3}px`;
      el.style.height = `${st.def.h * 42 + (st.def.h - 1) * 3}px`;
      el.innerHTML = `<span>${st.def.name}</span><strong>×${st.count}</strong>`;
      el.addEventListener('click', () => {
        if (st.def.id === 'spore_suppressant') {
          this.consumeItem('spore_suppressant', 1, onUseItem);
          onUseItem('spore_suppressant');
          this.hintEl.textContent = 'APPLIED SPORE SUPPRESSANT.';
        } else if (st.def.usableHint) {
          this.hintEl.textContent = st.def.usableHint;
        }
      });
      this.gridEl.appendChild(el);
    }

    this.recipeListEl.innerHTML = '';
    for (const rec of TIER1_RECIPES) {
      const outDef = ITEM_DEFS[rec.output];
      const canCraft = rec.ingredients.every((i) => this.getCount(i.item) >= i.count);
      const ingText = rec.ingredients
        .map((i) => `${i.count}× ${ITEM_DEFS[i.item].name}`)
        .join(' + ');

      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <div class="recipe-info">
          <strong>${outDef.name} (×${rec.outputCount})</strong>
          <span>${ingText}</span>
        </div>
      `;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Craft';
      btn.disabled = !canCraft;
      btn.style.opacity = canCraft ? '1' : '0.4';
      btn.addEventListener('click', () => this.craft(rec, onUseItem));

      card.appendChild(btn);
      this.recipeListEl.appendChild(card);
    }
  }
}