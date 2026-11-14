// Holds every dynamic thing besides the truck/packet: props, cables, shelves.
// step() adds all contact forces (props vs ground/shelves/each other/truck, cables)
// and integrates the props. The truck integrates itself afterwards.
class World {
  constructor() { this.reset(); }

  reset() {
    this.props = [];
    this.cables = [];
    this.cableLifeScale = 1;   // Cable Management upgrade shrinks this
    if (this.sparks) this.sparks.reset(); else this.sparks = new Sparks();
    this.shelves = [];      // static rects { x0, y0, x1, y1 }
  }

  addProp(p) { this.props.push(p); return p; }
  addCable(c) { this.cables.push(c); return c; }
  addShelf(s) { this.shelves.push(s); return s; }

  shelvesNear(x0, x1) { return this.shelves.filter((s) => s.x1 >= x0 && s.x0 <= x1); }

  step(dt, truck, terrain, gravity) {
    const P = CONFIG.physics;
    const free = [];
    for (const p of this.props) {
      if (p.parent) {
        // Riding in a pencil case until the case gets knocked
        if (p.parent.speed > P.releaseSpeed || Math.abs(p.parent.angVel) > P.releaseSpin) p.release();
        else continue;
      }
      p.clearForces(gravity);
      p.truckLoad = 0;      // downward force from the truck this step (for crushing)
      free.push(p);
    }

    for (const p of free) {
      const k = P.propK * p.mass, c = P.propC * p.mass;
      this._propVsTerrain(p, terrain, k, c);
      for (const s of this.shelvesNear(p.x - p.radius, p.x + p.radius)) this._bodyVsRect(p, s, k, c);
    }

    this._propVsProp(free);
    for (const p of free) {
      if (Math.abs(p.x - truck.x) < p.radius + 90 && Math.abs(p.y - truck.y) < p.radius + 90) this._truckVsProp(truck, p);
    }
    for (const s of this.shelvesNear(truck.x - 90, truck.x + 90)) this._truckVsRect(truck, s);

    const nearShelves = this.shelves;
    for (const cable of this.cables) { cable.lifeScale = this.cableLifeScale; cable.step(dt, gravity, terrain, nearShelves, truck); }
    if (truck.sawActive) this._sawStep(dt, truck, terrain);

    // Cables the truck hit hard enough snap in two at the hit point
    for (let ci = this.cables.length - 1; ci >= 0; ci--) {
      const c = this.cables[ci];
      if (c.snapAt == null) continue;
      const at = c.pts[c.snapAt];
      const halves = c.snap(c.snapAt);
      c.snapAt = null;
      if (!halves) continue;
      this.cables.splice(ci, 1, ...halves);
      this.sparks.burst(at.x, at.y, CONFIG.cables.snapSparks, 60, 220);
      if (this.onCableSnap) this.onCableSnap(at.x, at.y);   // scoring hook (set by Game)
    }
    if (this.cables.some((c) => c.expired)) this.cables = this.cables.filter((c) => !c.expired);

    const broken = [];
    for (const p of free) {
      p.integrate(dt, P.propLinDrag, P.propAngDrag);
      const sp = p.speed;
      if (sp > P.propMaxSpeed) { p.vx *= P.propMaxSpeed / sp; p.vy *= P.propMaxSpeed / sp; }
      if (p.def.breakable && !p.broken && (this._hitHard(p) || this._crushed(p, dt))) broken.push(p);
    }
    for (const p of broken) this.breakProp(p);
    for (const p of this.props) {
      p.update(dt);
      if (p.parent) p.followParent();
    }
  }

  // Sirkkeli buzzsaw: cuts cables, breaks anything breakable on touch, flings what it hits,
  // and physically collides with the ground, shelves and props (grinding sparks)
  _sawStep(dt, truck, terrain) {
    const S = CONFIG.sirkkeli, T = CONFIG.truck;
    truck.sawAngle = (truck.sawAngle || 0) + S.spin * dt;
    const c = truck.sawCenter(), R = S.radius;
    const k = T.contactStiffness, damp = T.contactDamping;

    // fling velocity for something touching the rim at world point (px, py), normal n out of it
    const flingAt = (px, py, nx, ny) => {
      const rx = px - c.x, ry = py - c.y;
      const tv = truck.pointVelocity(c.x, c.y);
      const a = rand(-S.wild, S.wild), ca = Math.cos(a), sa = Math.sin(a);
      let fx = -S.spin * ry * S.fling, fy = S.spin * rx * S.fling;   // rim velocity (omega x r)
      [fx, fy] = [fx * ca - fy * sa, fx * sa + fy * ca];
      return { vx: tv.x + fx - nx * S.push, vy: tv.y + fy - ny * S.push };
    };

    // Props: break, fling, and push back on the truck
    const breakNow = [];
    for (const p of this.props) {
      if (p.parent || Math.abs(p.x - c.x) > p.radius + R || Math.abs(p.y - c.y) > p.radius + R) continue;
      const hit = p.circleContact(c.x, c.y, R);
      if (!hit) continue;
      const px = c.x - hit.nx * R, py = c.y - hit.ny * R;   // contact on the blade rim
      if (p.def.breakable && !p.broken) breakNow.push(p);
      const m = reducedMass(truck.mass, p.mass);
      applyContact(truck, p, px, py, hit.nx, hit.ny, hit.depth, k * m, damp * m, null);
      if (!(p.sawFlungUntil > p.age)) {
        const v = flingAt(px, py, hit.nx, hit.ny);
        p.vx = v.vx; p.vy = v.vy;
        p.angVel = rand(-25, 25);
        p.sawFlungUntil = (p.age || 0) + S.flingCooldown;
        this.sparks.burst(px, py, 6, 80, 260);
      }
    }
    for (const p of breakNow) if (this.props.includes(p)) this.breakProp(p);

    // Cables: cut wherever the blade touches (too-short cables just get unplugged)
    for (const cable of this.cables) {
      if (cable.snapAt != null || cable.snapCooldown > 0) continue;   // fresh pieces get a moment
      const pts = cable.pts;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (Math.hypot(q.x - c.x, q.y - c.y) > R + CONFIG.cables.radius) continue;
        if (pts.length - 1 >= 2 * CONFIG.cables.snapMinSegments + 1) cable.snapAt = i;
        else cable.ends.forEach((e, j) => { if (e.attached) cable.detach(j); });
        const v = flingAt(q.x, q.y, (q.x - c.x) / R, (q.y - c.y) / R);
        q.vx = v.vx; q.vy = v.vy;
        break;
      }
    }

    // Ground and shelves: solid, with grinding sparks
    const grind = (px, py) => {
      if (Math.random() < S.grindSparks * dt) {
        const rx = px - c.x, ry = py - c.y;
        this.sparks.emit(px, py, -S.spin * ry * 0.5 + rand(-60, 60), S.spin * rx * 0.5 - rand(40, 160), rand(0.2, 0.5));
      }
    };
    const g = terrain.circleContact(c.x, c.y, R);
    if (g) {
      const px = c.x - g.nx * R, py = c.y - g.ny * R;
      applyContact(truck, null, px, py, g.nx, g.ny, g.depth, k, damp, null);
      grind(px, py);
    }
    for (const s of this.shelvesNear(c.x - R, c.x + R)) {
      const h = circleRectContact(c.x, c.y, R, s);
      if (!h) continue;
      const px = c.x - h.nx * R, py = c.y - h.ny * R;
      applyContact(truck, null, px, py, h.nx, h.ny, h.depth, k, damp, null);
      grind(px, py);
    }
  }

  // Velocity changed by more than breakSpeed within the last `window` steps?
  _hitHard(p) {
    const B = CONFIG.breakage;
    const h = p.vHist || (p.vHist = []);
    h.push(p.vx, p.vy);
    if (h.length > B.window * 2) h.splice(0, 2);
    if ((p.age || 0) < B.armTime || h.length < B.window * 2) return false;
    return Math.hypot(p.vx - h[0], p.vy - h[1]) > (p.def.breakSpeed || B.breakSpeed);
  }

  // Truck pressing down on it (driving over it) for long enough?
  _crushed(p, dt) {
    const B = CONFIG.breakage;
    p.crushTimer = p.truckLoad > B.crushForce ? (p.crushTimer || 0) + dt : 0;
    return p.crushTimer > B.crushTime;
  }

  // Breaking depends on the device: computers split, routers lose their antennas, hubs dent
  breakProp(p) {
    const B = CONFIG.breakage;
    if (p.broken || !this.props.includes(p)) return;   // never break the same thing twice
    p.broken = true;
    if (p.isDevice && this.onBreak) this.onBreak(p);   // scoring hook (set by Game)
    if (p.kind === 'computer') return this._splitComputer(p);
    if (p.kind === 'flowerPot') {
      // terracotta shards + the plant fly apart, dirt sprays out
      const shards = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => new BrokenPart(p, 'potShard', dx, dy));
      this._replaceWithParts(p, shards, [new Plant(p)]);
      const top = p.localToWorld(0, -p.h / 2 + 3);
      this.sparks.dirt(top.x, top.y, B.dirtParticles);
      return;
    }
    if (p.kind === 'router') {
      // antennas fly off and the router chips into a left and a right half
      const halves = [-1, 1].map((dx) => new BrokenPart(p, 'routerPart', dx, 0));
      this._replaceWithParts(p, halves, p.antennaMounts().map((m) => new Antenna(p, m)));
      this.sparks.burst(p.x, p.y, Math.round(B.burstSparks * 0.8), 60, 280);
    } else if (p.kind === 'hub') {
      p.dent = makeHubDent(p.w, p.h);
      p.sparkPoint = { x: 0, y: p.dent.deepest };
      p.sparkTime = p.sparkTotal = rand(B.sparkTimeMin, B.sparkTimeMax) * 1.5;   // sparks for a while
      const dent = p.localToWorld(p.sparkPoint.x, p.sparkPoint.y);
      this.sparks.burst(dent.x, dent.y, B.burstSparks, 80, 300);
    }
  }

  // Split a computer into 4 quarters
  _splitComputer(p) {
    const parts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([qx, qy]) => new BrokenPart(p, 'computerPart', qx, qy));
    this._replaceWithParts(p, parts);
    this.sparks.burst(p.x, p.y, CONFIG.breakage.burstSparks, 80, 320);
  }

  // Swap a device for its pieces; a plugged-in cable moves to the piece that holds the port
  _replaceWithParts(p, parts, extras = []) {
    for (const cable of this.cables) {
      cable.ends.forEach((e) => {
        if (e.body !== p) return;
        const port = p.ports[e.port];
        // nearest piece to the port
        let part = parts[0], best = Infinity;
        for (const q of parts) { const d = Math.hypot(port.x - q.off.x, port.y - q.off.y); if (d < best) { best = d; part = q; } }
        part.ports = [{ x: port.x - part.off.x, y: port.y - part.off.y }];
        e.body = part; e.port = 0;
      });
    }
    const i = this.props.indexOf(p);
    if (i < 0) return;
    this.props.splice(i, 1, ...parts, ...extras);
  }

  // Per-frame visual effects: sparks, and broken pieces that keep sparking
  updateEffects(dt, terrain, gravity) {
    const B = CONFIG.breakage;
    for (const p of this.props) {
      if (!(p.sparkTime > 0)) continue;
      p.sparkTime -= dt;
      const rate = B.sparkRate * (p.sparkTime / p.sparkTotal);
      if (Math.random() < rate * dt) {
        const sp = p.sparkPoint || p.innerCorner;
        const c = p.localToWorld(sp.x, sp.y);
        this.sparks.emit(c.x, c.y, rand(-90, 90) + p.vx, rand(-220, -60) + p.vy, rand(0.2, 0.5));
      }
    }
    this.sparks.update(dt, terrain, gravity, this.shelves);
  }

  _propVsTerrain(p, terrain, k, c) {
    for (const sp of p.samples) {
      const w = p.localToWorld(sp.x, sp.y);
      const ground = terrain.heightAt(w.x);
      if (w.y <= ground) continue;
      const n = terrain.normalAt(w.x);
      applyContact(p, null, w.x, w.y, n.x, n.y, (w.y - ground) * -n.y, k, c, p.friction);
    }
  }

  // Body sample points into a static rect, and the rect's corners into the body
  _bodyVsRect(p, rect, k, c) {
    for (const sp of p.samples) {
      const w = p.localToWorld(sp.x, sp.y);
      const hit = pointRectContact(w.x, w.y, rect);
      if (hit) applyContact(p, null, w.x, w.y, hit.nx, hit.ny, hit.depth, k, c, p.friction);
    }
    for (const [cx, cy] of [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y1]]) {
      const hit = p.pointContact(cx, cy);
      if (hit) applyContact(p, null, cx, cy, -hit.nx, -hit.ny, hit.depth, k, c, p.friction);
    }
  }

  _propVsProp(list) {
    const P = CONFIG.physics;
    const bodies = list.filter((p) => p.collidesProps).sort((a, b) => (a.x - a.radius) - (b.x - b.radius));
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const B = bodies[j];
        if (B.x - B.radius > A.x + A.radius) break;
        if (Math.abs(A.y - B.y) > A.radius + B.radius) continue;
        const m = reducedMass(A.mass, B.mass);
        const k = P.propK * m, c = P.propC * m;
        const fr = A.friction;
        for (const sp of A.samples) {
          const w = A.localToWorld(sp.x, sp.y);
          const hit = B.pointContact(w.x, w.y);
          if (hit) applyContact(A, B, w.x, w.y, hit.nx, hit.ny, hit.depth, k, c, fr);
        }
        for (const sp of B.samples) {
          const w = B.localToWorld(sp.x, sp.y);
          const hit = A.pointContact(w.x, w.y);
          if (hit) applyContact(B, A, w.x, w.y, hit.nx, hit.ny, hit.depth, k, c, fr);
        }
      }
    }
  }

  _truckVsProp(truck, p) {
    const T = CONFIG.truck;
    const m = reducedMass(truck.mass, p.mass);
    const k = T.contactStiffness * m, c = T.contactDamping * m;

    // Wheels on the prop (drive force pushes the prop back)
    T.wheels.forEach((wh, i) => {
      const wc = truck.wheelCenter(i);
      const hit = p.circleContact(wc.x, wc.y, truck.wheelRadius);
      // the prop feels -N*n; its downward part is N * -ny
      if (hit) p.truckLoad += truck.wheelContact(i, p, wc.x - hit.nx * truck.wheelRadius, wc.y - hit.ny * truck.wheelRadius, hit.nx, hit.ny, hit.depth, m) * -hit.ny;
    });
    // Truck hull points into the prop
    for (const hp of T.hullPoints) {
      const w = truck.localToWorld(hp.x, hp.y);
      const hit = p.pointContact(w.x, w.y);
      if (hit) p.truckLoad += truck.hullContact(p, w.x, w.y, hit.nx, hit.ny, hit.depth, k, c) * -hit.ny;
    }
    // Prop corners into the truck's boxes (e.g. a router landing in the bed)
    const boxes = Object.values(T.boxes);
    for (const sp of p.samples) {
      const w = p.localToWorld(sp.x, sp.y);
      const l = truck.worldToLocal(w.x, w.y);
      const hit = pointInBoxes(l.x, l.y, boxes);
      if (!hit) continue;
      const n = truck.dirToWorld(hit.nx, hit.ny);
      // Counts as the truck's hull touching something (slippery, enables scrabble)
      const N = applyContact(p, truck, w.x, w.y, n.x, n.y, hit.depth, k, c, truck.propHullFriction);
      if (N > 0) { truck.hullTouching = true; p.truckLoad += N * n.y; }
    }
  }

  _truckVsRect(truck, rect) {
    const T = CONFIG.truck;
    const k = T.contactStiffness, c = T.contactDamping;
    T.wheels.forEach((wh, i) => {
      const wc = truck.wheelCenter(i);
      const hit = circleRectContact(wc.x, wc.y, truck.wheelRadius, rect);
      if (hit) truck.wheelContact(i, null, wc.x - hit.nx * truck.wheelRadius, wc.y - hit.ny * truck.wheelRadius, hit.nx, hit.ny, hit.depth);
    });
    for (const hp of T.hullPoints) {
      const w = truck.localToWorld(hp.x, hp.y);
      const hit = pointRectContact(w.x, w.y, rect);
      if (hit) truck.hullContact(null, w.x, w.y, hit.nx, hit.ny, hit.depth, k, c);
    }
    const boxes = Object.values(T.boxes);
    for (const [cx, cy] of [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y1]]) {
      const l = truck.worldToLocal(cx, cy);
      const hit = pointInBoxes(l.x, l.y, boxes);
      if (!hit) continue;
      const n = truck.dirToWorld(hit.nx, hit.ny);
      truck.hullContact(null, cx, cy, -n.x, -n.y, hit.depth, k, c);
    }
  }

  // ---- queries ----
  // Is this prop resting on (or right at) a shelf top?
  isOnShelf(p) {
    let bottom = -Infinity;
    for (const sp of p.samples) bottom = Math.max(bottom, p.localToWorld(sp.x, sp.y).y);
    return this.shelvesNear(p.x - p.radius, p.x + p.radius)
      .some((s) => p.x > s.x0 - 5 && p.x < s.x1 + 5 && Math.abs(bottom - s.y0) < 6);
  }

  packetTouchesDevice(x, y, half) {
    for (const p of this.props) {
      if (!p.isDevice || Math.abs(p.x - x) > p.radius + half) continue;
      const l = p.worldToLocal(x, y);
      if (Math.abs(l.x) < p.w / 2 + half && Math.abs(l.y) < p.h / 2 + half) return true;
    }
    return false;
  }

  // Roof touching a shelf or prop (only counts as a crash when upside down)
  roofHit(px, py) {
    for (const s of this.shelvesNear(px, px)) if (pointInRect(px, py, s)) return true;
    for (const p of this.props) {
      if (Math.abs(p.x - px) < p.radius && p.pointContact(px, py)) return true;
    }
    return false;
  }

  prune(minX) {
    const killY = CONFIG.terrain.baseY + 1500;
    const gone = new Set(this.props.filter((p) => p.x < minX || p.y > killY));
    if (gone.size) {
      this.props = this.props.filter((p) => !gone.has(p));
      for (const c of this.cables) c.ends.forEach((e, i) => { if (e.attached && gone.has(e.body)) e.attached = false; });
    }
    this.cables = this.cables.filter((c) => c.bounds().x1 > minX);
    this.shelves = this.shelves.filter((s) => s.x1 > minX);
  }

  draw(ctx, view) {
    const x0 = view.x - 100, x1 = view.x + view.w + 100;
    for (const s of this.shelves) if (s.x1 > x0 && s.x0 < x1) drawShelf(ctx, s);
    for (const p of this.props) if (p.x > x0 && p.x < x1) p.draw(ctx);
    for (const c of this.cables) { const b = c.bounds(); if (b.x1 > x0 && b.x0 < x1) c.draw(ctx); }
    this.sparks.draw(ctx);
  }
}

function drawShelf(ctx, s) {
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  ctx.fillStyle = '#a1887f';
  ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, 2);
  // brackets (mounted on the "wall" behind)
  ctx.fillStyle = '#5d4037';
  for (const bx of [s.x0 + 10, s.x1 - 16]) {
    ctx.beginPath();
    ctx.moveTo(bx, s.y1); ctx.lineTo(bx + 6, s.y1); ctx.lineTo(bx + 6, s.y1 + 14);
    ctx.closePath(); ctx.fill();
  }
}
