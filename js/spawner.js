// Fills the track ahead with network clusters (router -> hub port 1, hub -> computers),
// floating shelves, and decorations (flower pots, pencil cases full of pencils).
class Spawner {
  constructor(world) {
    this.world = world;
    this.reset(CONFIG.infinite, Infinity);
  }

  // rules: { difficultyBase, floorChance: { router, hub, computer } }; nothing spawns past endX
  reset(rules, endX = Infinity) {
    this.rules = rules;
    this.endX = endX;
    this.cursor = CONFIG.spawner.start;
  }

  update(terrain) {
    const S = CONFIG.spawner;
    while (terrain.genX > this.cursor + S.lookahead && this.cursor < this.endX) {
      const d = clamp(this.rules.difficultyBase + this.cursor / CONFIG.terrain.difficultyDistance, 0, 1);
      let end = this.cursor;
      if (Math.random() < lerp(S.clusterChanceStart, S.clusterChanceEnd, d)) end = this._cluster(terrain, this.cursor, d);
      const gapEnd = end + rand(S.gapMin, S.gapMax);
      this._decorate(terrain, end + 40, gapEnd);
      this.cursor = gapEnd;
    }
  }

  // Next spot of width w on a bar top, starting at xMin and ending before xMax
  // Flat surfaces: neighbouring flat bars of equal height merged into one span (across the gaps)
  _surfaces(terrain) {
    const out = [];
    for (const b of terrain.bars) {
      const last = out[out.length - 1];
      if (!b.flat) continue;
      if (last && Math.abs(last.top - b.top) < 0.5 && b.x0 - last.x1 <= CONFIG.terrain.barGap + 1) last.x1 = b.x1;
      else out.push({ x0: b.x0, x1: b.x1, top: b.top });
    }
    return out;
  }

  _findSpot(terrain, xMin, xMax, w) {
    xMax = Math.min(xMax, this.endX);
    for (const b of this._surfaces(terrain)) {
      const start = Math.max(b.x0 + 4, xMin);
      if (start + w + 4 > b.x1) continue;
      if (start + w > xMax) return null;
      return { x: start + w / 2, top: b.top };
    }
    return null;
  }

  // Shelf floating above the terrain around x. Returns the shelf rect.
  _addShelf(terrain, x, minWidth) {
    const S = CONFIG.spawner;
    const width = Math.max(minWidth + rand(16, 50), rand(S.shelfWidthMin, S.shelfWidthMax));
    const x0 = x - width / 2, x1 = x + width / 2;
    let highest = Infinity;
    for (let sx = x0 - 30; sx <= x1 + 30; sx += 10) highest = Math.min(highest, terrain.heightAt(sx));
    const bottom = highest - rand(S.shelfClearanceMin, S.shelfClearanceMax);
    return this.world.addShelf({ x0, x1, y0: bottom - S.shelfThickness, y1: bottom });
  }

  _cluster(terrain, x0, d) {
    const S = CONFIG.spawner;
    let computers = 1;
    const extra = lerp(S.extraComputerChanceStart, S.extraComputerChanceEnd, d);
    while (computers < 7 && Math.random() < extra) computers++;

    const kinds = shuffle(['router', 'hub', ...Array(computers).fill('computer')]);
    const placed = [];
    let x = x0;
    for (const kind of kinds) {
      const w = CONFIG.props[kind].w;
      const spot = this._findSpot(terrain, x, x0 + S.maxClusterSpan, w);
      if (!spot) break;
      let surface = spot.top;
      if (Math.random() >= this.rules.floorChance[kind]) surface = this._addShelf(terrain, spot.x, w).y0;
      placed.push(this.world.addProp(makeProp(kind, spot.x, surface)));
      x = spot.x + w / 2 + rand(S.deviceGapMin, S.deviceGapMax);
    }

    const hub = placed.find((p) => p.kind === 'hub');
    if (hub) {
      const router = placed.find((p) => p.kind === 'router');
      if (router) { router.facePortTo(hub.x); this._connect(terrain, router, 0, hub, 0); }
      for (const pc of placed.filter((p) => p.kind === 'computer')) {
        const port = hub.nextFreePort(1);
        if (port < 0) break;
        pc.facePortTo(hub.x);
        this._connect(terrain, pc, 0, hub, port);
      }
    }
    return x;
  }

  _connect(terrain, a, ai, b, bi) {
    const C = CONFIG.cables;
    const pa = a.portWorld(ai), pb = b.portWorld(bi);
    // Path length if the cable is draped over the terrain in between
    let len = 0, prev = pa;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const x = lerp(pa.x, pb.x, t);
      const y = i === 16 ? pb.y : Math.min(lerp(pa.y, pb.y, t), terrain.heightAt(x) - 3);
      len += Math.hypot(x - prev.x, y - prev.y);
      prev = { x, y };
    }
    const rest = Math.max(len, 20) * rand(C.slackMin, C.slackMax);
    this.world.addCable(new Cable({ body: a, port: ai }, { body: b, port: bi }, rest, pick(C.colors)));
  }

  // Office supplies (flower pots, pencil cases) only ever sit on shelves
  _decorate(terrain, from, to) {
    const S = CONFIG.spawner;
    to = Math.min(to, this.endX - 150);
    let x = from + rand(0, S.officeGapMin);
    while (x < to) {
      if (Math.random() < S.officeShelfChance) {
        const kinds = Array.from({ length: 1 + Math.floor(Math.random() * S.officeItemsMax) }, () => weightedPick(S.decorWeights));
        const gap = 10;
        const needed = kinds.reduce((sum, k) => sum + CONFIG.props[k].w, 0) + gap * (kinds.length - 1);
        const shelf = this._addShelf(terrain, x, needed);
        // spread the items along the shelf
        let ix = (shelf.x0 + shelf.x1) / 2 - needed / 2;
        for (const kind of kinds) {
          const w = CONFIG.props[kind].w;
          this._addDecor(kind, ix + w / 2, shelf.y0);
          ix += w + gap;
        }
        x = shelf.x1;
      }
      x += rand(S.officeGapMin, S.officeGapMax);
    }
  }

  _addDecor(kind, x, surface) {
    const p = makeProp(kind, x, surface);
    if (kind === 'pencilCase') {   // pencils are added first so they draw behind the cup
      const count = 2 + Math.floor(Math.random() * 3);
      const ph = CONFIG.props.pencil.h;
      for (let i = 0; i < count; i++) {
        const pencil = this.world.addProp(makeProp('pencil', x, surface));
        const lx = lerp(-p.w / 2 + 4, p.w / 2 - 4, count === 1 ? 0.5 : i / (count - 1));
        p.attachChild(pencil, lx, p.h / 2 - 2 - ph / 2, rand(-0.25, 0.25));
      }
    }
    this.world.addProp(p);
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
