// CAT cable: a chain of point masses joined by springs that only pull (rope behaviour).
// Each end is plugged into a prop port. The truck can snag the cable; when the pull on
// the plugs exceeds plugStrength (the cable stretches a bit first) the plug closest to
// the truck pops out.
class Cable {
  constructor(endA, endB, restLength, color) {
    const C = CONFIG.cables;
    this.color = color;
    this.ends = [
      { body: endA.body, port: endA.port, attached: true },
      { body: endB.body, port: endB.port, attached: true },
    ];
    const n = Math.max(3, Math.ceil(restLength / C.segment));
    this.restLength = restLength;
    this.segLen = restLength / n;
    this.age = 0;
    this.looseTime = 0;   // seconds since both plugs came out
    this.lifeScale = 1;   // < 1 = disappears sooner (Cable Management upgrade)
    this.stretch = 1;
    this.cooldown = CONFIG.cables.armTime;   // no detaching while the cable settles after spawning

    const a = endA.body.portWorld(endA.port), b = endB.body.portWorld(endB.port);
    this.pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.pts.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), vx: 0, vy: 0, fx: 0, fy: 0 });
    }
    for (const e of this.ends) if (e.body.portLinks) e.body.portLinks[e.port] = this;
  }

  isPlugged(body) {
    return this.ends.some((e) => e.attached && e.body === body);
  }

  get anyAttached() { return this.ends[0].attached || this.ends[1].attached; }

  detach(i) {
    const e = this.ends[i];
    if (!e.attached) return;
    e.attached = false;
    this.cooldown = CONFIG.cables.detachCooldown;   // let the cable relax before the other plug can go
    const p = this.pts[i === 0 ? 0 : this.pts.length - 1];
    p.vx += rand(-80, 80);
    p.vy -= rand(60, 160);
  }

  // Bounding box of the cable (for culling and pruning)
  bounds() {
    let x0 = Infinity, x1 = -Infinity;
    for (const p of this.pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
    return { x0, x1 };
  }

  step(dt, gravity, terrain, shelves, truck) {
    const C = CONFIG.cables;
    const pts = this.pts, last = pts.length - 1;
    this.age += dt;
    if (!this.anyAttached) this.looseTime += dt;

    // Plugged ends follow their ports
    this.cooldown -= dt;
    if (this.snapCooldown > 0) this.snapCooldown -= dt;
    this.ends.forEach((e, i) => {
      if (!e.attached) return;
      const p = pts[i === 0 ? 0 : last];
      const w = e.body.portWorld(e.port), v = e.body.pointVelocity(w.x, w.y);
      p.x = w.x; p.y = w.y; p.vx = v.x; p.vy = v.y;
    });

    // Springs (pull only)
    for (const p of pts) { p.fx = 0; p.fy = 0; }
    let length = 0;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      length += d;
      if (d <= this.segLen) continue;
      const ux = dx / d, uy = dy / d;
      const relV = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
      const F = Math.max(0, C.stiffness * (d - this.segLen) + C.damping * relV);
      a.fx += F * ux; a.fy += F * uy;
      b.fx -= F * ux; b.fy -= F * uy;
    }
    this.stretch = length / this.restLength;

    // Tension on plugged ends pulls the devices
    this.ends.forEach((e, i) => {
      if (!e.attached) return;
      const p = pts[i === 0 ? 0 : last];
      e.body.applyForceAt(p.x, p.y, p.fx, p.fy);
    });

    // Integrate free particles
    const m = C.particleMass, drag = Math.exp(-C.airDrag * dt);
    for (let i = 0; i <= last; i++) {
      if ((i === 0 && this.ends[0].attached) || (i === last && this.ends[1].attached)) continue;
      const p = pts[i];
      p.vx = (p.vx + p.fx / m * dt) * drag;
      p.vy = (p.vy + (p.fy / m + gravity) * dt) * drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this._collide(p, i, dt, terrain, shelves, truck);
    }

    // Pulled too hard: pop the plug closest to the truck. Uses the tension at the plugs
    // (the cable can bunch up on the truck, so average stretch would under-read).
    let tension = 0;
    this.ends.forEach((e, i) => {
      if (!e.attached) return;
      const p = pts[i === 0 ? 0 : last];
      tension = Math.max(tension, Math.hypot(p.fx, p.fy));
    });
    this.tension = tension;
    if (this.cooldown <= 0 && tension > C.plugStrength && this.anyAttached) {
      let best = -1, bestD = Infinity;
      this.ends.forEach((e, i) => {
        if (!e.attached) return;
        const p = pts[i === 0 ? 0 : last];
        const d = Math.hypot(p.x - truck.x, p.y - truck.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      this.detach(best);
    }
  }

  _collide(p, i, dt, terrain, shelves, truck) {
    const C = CONFIG.cables, r = C.radius;

    // Truck body: snag (stick to the truck surface, push back on the truck)
    if (Math.abs(p.x - truck.x) < 80 && Math.abs(p.y - truck.y) < 80) {
      const l = truck.worldToLocal(p.x, p.y);
      const hit = pointInBoxes(l.x, l.y, Object.values(CONFIG.truck.boxes), r);
      if (hit) {
        const w = truck.localToWorld(l.x + hit.nx * hit.depth, l.y + hit.ny * hit.depth);
        const n = truck.dirToWorld(hit.nx, hit.ny);
        const tv = truck.pointVelocity(w.x, w.y);
        let rx = p.vx - tv.x, ry = p.vy - tv.y;
        const rn = rx * n.x + ry * n.y;
        // Truck's surface ramming into the cable hard enough: it snaps here (World splits it
        // after this step). Uses the truck's own speed, so a whipping loose end doesn't count.
        const ram = tv.x * n.x + tv.y * n.y;
        if (ram > C.snapSpeed && this.snapAt == null && !(this.snapCooldown > 0)) this.snapAt = i;
        if (rn < 0) { rx -= rn * n.x; ry -= rn * n.y; }
        const tn = rx * n.x + ry * n.y;           // remaining (separating) normal part
        const tx = rx - tn * n.x, ty = ry - tn * n.y;
        const nvx = tv.x + tn * n.x + tx * (1 - C.snagFriction);
        const nvy = tv.y + tn * n.y + ty * (1 - C.snagFriction);
        // Reaction on the truck = -(momentum change of the particle) / dt
        truck.applyForceAt(w.x, w.y, -C.particleMass * (nvx - p.vx) / dt, -C.particleMass * (nvy - p.vy) / dt);
        p.x = w.x; p.y = w.y; p.vx = nvx; p.vy = nvy;
      }
      // Wheels just push the cable aside (they roll over it)
      for (let wi = 0; wi < CONFIG.truck.wheels.length; wi++) {
        const c = truck.wheelCenter(wi);
        const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
        const R = truck.wheelRadius + r;
        if (d < R && d > 1e-6) { p.x = c.x + dx / d * R; p.y = c.y + dy / d * R; }
      }
    }

    // Shelves
    for (const s of shelves) {
      const hit = pointRectContact(p.x, p.y, { x0: s.x0 - r, y0: s.y0 - r, x1: s.x1 + r, y1: s.y1 + r });
      if (hit) this._pushOut(p, hit.nx, hit.ny, hit.depth);
    }

    // Ground
    const g = terrain.heightAt(p.x) - r;
    if (p.y > g) {
      const n = terrain.normalAt(p.x);
      this._pushOut(p, n.x, n.y, (p.y - g) * -n.y);
    }
  }

  _pushOut(p, nx, ny, depth) {
    p.x += nx * depth; p.y += ny * depth;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
    p.vx *= 0.9; p.vy *= 0.9;   // ground friction
  }

  // Split into two cables at particle k. Each half keeps its own plug; the cut ends are loose.
  snap(k) {
    const n = this.pts.length - 1, m = CONFIG.cables.snapMinSegments;
    if (n < 2 * m + 1) return null;           // too short to leave two real pieces
    k = clamp(k, m, n - m - 1);
    const make = (pts, endA, endB) => {
      const c = Object.create(Cable.prototype);
      Object.assign(c, {
        color: this.color, pts, ends: [endA, endB], segLen: this.segLen,
        restLength: this.segLen * (pts.length - 1), age: this.age, looseTime: 0,
        lifeScale: this.lifeScale, stretch: 1, tension: 0, cooldown: CONFIG.cables.detachCooldown,
        snapCooldown: CONFIG.cables.snapCooldown,
      });
      for (const e of c.ends) if (e.attached && e.body.portLinks) e.body.portLinks[e.port] = c;
      return c;
    };
    const cutEnd = () => ({ body: null, port: 0, attached: false, cut: true });
    const a = make(this.pts.slice(0, k + 1), this.ends[0], cutEnd());
    const b = make(this.pts.slice(k + 1), cutEnd(), this.ends[1]);
    // the cut ends whip apart a little
    const pa = a.pts[a.pts.length - 1], pb = b.pts[0];
    pa.vx -= rand(40, 120); pa.vy -= rand(20, 100);
    pb.vx += rand(40, 120); pb.vy -= rand(20, 100);
    return [a, b];
  }

  get expired() { return this.looseTime >= CONFIG.cables.looseLifetime * this.lifeScale; }

  draw(ctx) {
    const C = CONFIG.cables;
    const pts = this.pts;
    const fade = clamp((C.looseLifetime * this.lifeScale - this.looseTime) / (C.looseFadeTime * this.lifeScale), 0, 1);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    // RJ45 plugs on loose ends
    this.ends.forEach((e, i) => {
      if (e.attached) return;
      const p = pts[i === 0 ? 0 : pts.length - 1];
      const q = pts[i === 0 ? 1 : pts.length - 2];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.y - q.y, p.x - q.x));
      if (e.cut) {
        // frayed copper strands where it snapped
        ctx.strokeStyle = '#d8894a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const a of [-0.6, -0.2, 0.2, 0.6]) { ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5); }
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(220, 235, 255, 0.85)';
        ctx.fillRect(-2, -3, 7, 6);
      }
      ctx.restore();
    });
    ctx.restore();
  }
}
