// Physical props: network devices (router, hub, computer) and decorations
// (flower pot, pencil case, pencils). All are rigid boxes simulated by World.
class Prop extends RigidBody {
  constructor(kind, x, surfaceY) {
    const def = CONFIG.props[kind];
    super(def.w, def.h, def.mass);
    this.kind = kind;
    this.def = def;
    this.isDevice = !!def.device;
    this.collidesProps = def.collidesProps !== false;
    this.friction = makeFriction(def.friction);
    this.x = x;
    this.y = surfaceY - def.h / 2;
    this.corner = Math.min(CONFIG.physics.propCorner, def.h / 2, def.w / 2);
    this.innerBox = { x0: -def.w / 2 + this.corner, y0: -def.h / 2 + this.corner, x1: def.w / 2 - this.corner, y1: def.h / 2 };
    this.parent = null;      // pencils ride in their case until it gets knocked
    this.children = [];
    this.ports = [];         // local cable attachment points
    this.blink = Math.random() * 10;

    // Collision sample points (local): corners + top/bottom middles
    const hw = def.w / 2, hh = def.h / 2;
    this.samples = [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
      { x: 0, y: hh }, { x: 0, y: -hh },
      { x: 0, y: 0 },   // centre: separates bodies that end up exactly on top of each other
    ];
  }

  portWorld(i) {
    const p = this.ports[i];
    return this.localToWorld(p.x, p.y);
  }

  // Rounded-box contact for a circle given in world coords. Normal is in world space.
  circleContact(cx, cy, r) {
    const l = this.worldToLocal(cx, cy);
    const hit = circleRectContact(l.x, l.y, r + this.corner, this.innerBox);
    if (!hit) return null;
    const n = this.dirToWorld(hit.nx, hit.ny);
    return { depth: hit.depth, nx: n.x, ny: n.y };
  }

  // Point inside this box? Returns world-space contact (normal points out of the box) or null
  pointContact(px, py, inflate = 0) {
    const l = this.worldToLocal(px, py);
    const hit = pointInBoxes(l.x, l.y, [this.localBox], inflate);
    if (!hit) return null;
    const n = this.dirToWorld(hit.nx, hit.ny);
    return { depth: hit.depth, nx: n.x, ny: n.y };
  }

  attachChild(child, lx, ly, angle) {
    child.parent = this;
    child.attachLocal = { x: lx, y: ly, angle };
    this.children.push(child);
    child.followParent();
  }

  followParent() {
    const p = this.parent, a = this.attachLocal;
    const w = p.localToWorld(a.x, a.y);
    this.x = w.x; this.y = w.y;
    this.angle = p.angle + a.angle;
    const v = p.pointVelocity(w.x, w.y);
    this.vx = v.x; this.vy = v.y; this.angVel = p.angVel;
  }

  release() {
    this.parent = null;
    this.vx += rand(-60, 60);
    this.vy -= rand(40, 140);
    this.angVel += rand(-6, 6);
  }

  update(dt) { this.blink += dt; this.age = (this.age || 0) + dt; }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    this.drawShape(ctx, this.w, this.h, Math.floor(this.blink * 4) % 2 === 0);
    ctx.restore();
  }

  drawShape(ctx, w, h) {
    ctx.fillStyle = '#888';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
}

class Router extends Prop {
  constructor(x, y) {
    super('router', x, y);
    this.ports = [{ x: this.w / 2 - 3, y: 2 }];
  }

  // Put the single port on the side facing the hub
  facePortTo(wx) {
    this.ports[0].x = (wx >= this.x ? 1 : -1) * (this.w / 2 - 3);
  }

  // Local positions/angles of the two antennas (they snap off when the router breaks)
  antennaMounts() {
    const w = this.w, h = this.h, tilt = Math.atan2(4, 14);
    return [{ x: -w / 2 + 6, y: -h / 2 - 7, angle: -tilt }, { x: w / 2 - 6, y: -h / 2 - 7, angle: tilt }];
  }

  drawShape(ctx, w, h, on) {
    if (!this.broken) {
      ctx.strokeStyle = '#9aa4b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 8, -h / 2); ctx.lineTo(-w / 2 + 4, -h / 2 - 14);
      ctx.moveTo(w / 2 - 8, -h / 2);  ctx.lineTo(w / 2 - 4, -h / 2 - 14);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8ecf3';
    roundedRect(ctx, -w / 2, -h / 2, w, h, this.corner);
    if (this.broken) {
      // snapped-off antenna stubs + dead/red status lights
      ctx.fillStyle = '#6b7385';
      ctx.fillRect(-w / 2 + 6, -h / 2 - 3, 3, 3);
      ctx.fillRect(w / 2 - 9, -h / 2 - 3, 3, 3);
    }
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = this.broken ? (on && k === 0 ? '#ff4757' : '#3a1a1e') : (on || k % 2 ? '#2ed573' : '#1e3d2a');
      ctx.fillRect(-w / 2 + 8 + k * 8, 1, 4, 3);
    }
    ctx.fillStyle = '#333';
    ctx.fillRect(this.ports[0].x - 3, this.ports[0].y - 3, 6, 6);
  }
}

class Hub extends Prop {
  constructor(x, y) {
    super('hub', x, y);
    for (let i = 0; i < 8; i++) this.ports.push({ x: -this.w / 2 + 8 + i * 8, y: -this.h / 2 + 4 });
    this.portLinks = new Array(8).fill(null); // cable plugged into each port
  }

  nextFreePort(from = 1) {
    for (let i = from; i < 8; i++) if (!this.portLinks[i]) return i;
    return -1;
  }

  drawShape(ctx, w, h, on) {
    ctx.fillStyle = '#2f3542';
    const D = Hub.DENT;
    if (this.broken) {
      // casing with a jagged crater crushed into the middle of the top
      if (!this.dent) this.dent = makeHubDent(w, h);
      const top = -h / 2, r = this.corner;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, top + r);
      ctx.arcTo(-w / 2, top, -w / 2 + r, top, r);
      for (const p of this.dent.edge) ctx.lineTo(p.x, p.y);
      ctx.lineTo(w / 2 - r, top);
      ctx.arcTo(w / 2, top, w / 2, top + r, r);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      ctx.fill();
      // crumpled metal highlight along the crater rim + cracks
      ctx.strokeStyle = '#596075';
      ctx.lineWidth = 1;
      ctx.beginPath();
      this.dent.edge.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + 1.5) : ctx.moveTo(p.x, p.y + 1.5)));
      ctx.stroke();
      ctx.strokeStyle = '#ffcf6b';
      for (const c of this.dent.cracks) {
        ctx.beginPath();
        c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    } else {
      roundedRect(ctx, -w / 2, -h / 2, w, h, this.corner);
    }
    for (let i = 0; i < 8; i++) {
      const p = this.ports[i];
      if (this.broken && Math.abs(p.x) < D.halfWidth) continue;   // crushed ports
      ctx.fillStyle = '#111';
      ctx.fillRect(p.x - 3, p.y - 2, 6, 5);
      const link = this.portLinks[i];
      const live = link && link.isPlugged(this);
      ctx.fillStyle = live ? (on || i % 3 ? '#2ed573' : '#1e5a35') : '#4a3a10';
      ctx.fillRect(p.x - 2, p.y + 5, 3, 2);
    }
    ctx.fillStyle = '#ffa502';
    ctx.font = "5px 'Pixel12x10', monospace";
    ctx.fillText('1', this.ports[0].x - 2, h / 2 - 1);
  }
}

Hub.DENT = { halfWidth: 18, depth: 0.65 };   // dent size when a hub breaks

// Random jagged crater for a broken hub's top edge (+ cracks running down from it)
function makeHubDent(w, h) {
  const D = Hub.DENT, top = -h / 2, dw = D.halfWidth * rand(0.85, 1.15), dd = h * D.depth;
  const n = 11, edge = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = lerp(-dw, dw, t) + (i && i < n ? rand(-1.5, 1.5) : 0);
    // V-ish profile, deepest a bit off-centre, with sharp random zig-zags
    const prof = 1 - Math.abs((t - 0.5 + rand(-0.06, 0.06)) * 2);
    const y = (i === 0 || i === n) ? top : top + dd * Math.pow(prof, 0.8) * rand(0.6, 1.15) + (i % 2 ? 1.5 : -1);
    edge.push({ x, y: (i === 0 || i === n) ? top : clamp(y, top + 0.5, h / 2 - 2) });   // never bulges above the top
  }
  const cracks = [];
  for (let k = 0; k < 4; k++) {
    const start = edge[2 + Math.floor(Math.random() * (n - 3))];
    const pts = [{ ...start }];
    let x = start.x, y = start.y;
    for (let s = 0; s < 3; s++) { x += rand(-4, 4); y += rand(1.5, 3); pts.push({ x, y: Math.min(y, h / 2 - 1) }); }
    cracks.push(pts);
  }
  return { edge, cracks, deepest: Math.max(...edge.map((p) => p.y)) };
}

// An antenna that snapped off a broken router
class Antenna extends Prop {
  constructor(router, mount) {
    super('antenna', 0, 0);
    const w = router.localToWorld(mount.x, mount.y);
    const v = router.pointVelocity(w.x, w.y);
    this.x = w.x; this.y = w.y;
    this.angle = router.angle + mount.angle;
    this.vx = v.x + Math.sign(mount.x) * rand(80, 200);
    this.vy = v.y - rand(270, 420);
    this.angVel = Math.sign(mount.x) * rand(8, 18);
    this.age = CONFIG.breakage.armTime;
  }

  drawShape(ctx, w, h) {
    ctx.fillStyle = '#9aa4b8';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.beginPath(); ctx.arc(0, -h / 2, 2, 0, Math.PI * 2); ctx.fill();
  }
}

class Computer extends Prop {
  constructor(x, y) {
    super('computer', x, y);
    this.ports = [{ x: this.w / 2 - 3, y: 4 }];
  }

  facePortTo(wx) {
    this.ports[0].x = (wx >= this.x ? 1 : -1) * (this.w / 2 - 3);
  }

  // Tower PC
  drawShape(ctx, w, h, on) {
    ctx.fillStyle = '#3a3f4d';
    roundedRect(ctx, -w / 2, -h / 2, w, h, this.corner);
    ctx.fillStyle = '#2b2f3a';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 5, w - 8, 4);    // drive bays
    ctx.fillRect(-w / 2 + 4, -h / 2 + 11, w - 8, 4);
    ctx.fillStyle = '#596075';
    for (let k = 0; k < 3; k++) ctx.fillRect(-w / 2 + 6, -h / 2 + 20 + k * 3, w - 12, 1);  // vents
    ctx.fillStyle = on ? '#38e8ff' : '#14505c';           // power LED
    ctx.fillRect(-2, h / 2 - 7, 4, 3);
    ctx.fillStyle = '#111';
    ctx.fillRect(this.ports[0].x - 3, this.ports[0].y - 3, 6, 6);
  }
}

class FlowerPot extends Prop {
  constructor(x, y) {
    super('flowerPot', x, y);
    this.flowerHue = pick([0, 45, 300, 200]);
  }

  drawShape(ctx, w, h) {
    // plant (decorative, sticks out above the box)
    if (!this.broken) drawPlant(ctx, -h / 2, this.flowerHue);
    // terracotta pot
    ctx.fillStyle = '#c0603a';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 5); ctx.lineTo(w / 2, -h / 2 + 5);
    ctx.lineTo(w / 2 - 4, h / 2); ctx.lineTo(-w / 2 + 4, h / 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9774f';
    ctx.fillRect(-w / 2, -h / 2, w, 6);   // rim
  }
}

// Stem + leaves + flower, growing up from baseY
function drawPlant(ctx, baseY, hue) {
  ctx.strokeStyle = '#2e8b57';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, baseY); ctx.lineTo(0, baseY - 16);
  ctx.moveTo(0, baseY - 6); ctx.quadraticCurveTo(-10, baseY - 12, -9, baseY - 4);
  ctx.moveTo(0, baseY - 9); ctx.quadraticCurveTo(10, baseY - 15, 9, baseY - 7);
  ctx.stroke();
  ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
  ctx.beginPath(); ctx.arc(0, baseY - 18, 4, 0, Math.PI * 2); ctx.fill();
  // a clump of dirt on the roots
  ctx.fillStyle = '#5b3a1e';
  ctx.beginPath(); ctx.ellipse(0, baseY + 1, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
}

// The plant thrown out of a broken flower pot
class Plant extends Prop {
  constructor(pot) {
    super('plant', 0, 0);
    this.flowerHue = pot.flowerHue;
    const top = pot.localToWorld(0, -pot.h / 2 - this.h / 2 + 4);
    const v = pot.pointVelocity(top.x, top.y);
    this.x = top.x; this.y = top.y; this.angle = pot.angle;
    this.vx = v.x + rand(-80, 80);
    this.vy = v.y - rand(160, 300);
    this.angVel = rand(-9, 9);
    this.age = CONFIG.breakage.armTime;
  }

  drawShape(ctx, w, h) { drawPlant(ctx, h / 2 - 2, this.flowerHue); }
}

class PencilCase extends Prop {
  constructor(x, y) {
    super('pencilCase', x, y);
    this.color = pick(['#3867d6', '#8854d0', '#20bf6b', '#eb3b5a']);
  }

  drawShape(ctx, w, h) {
    ctx.fillStyle = this.color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-w / 2, -h / 2, w, 3);
    ctx.fillRect(-w / 2 + 3, -h / 2 + 5, 2, h - 8);
  }
}

class Pencil extends Prop {
  constructor(x, y) {
    super('pencil', x, y);
    this.color = pick(['#f7b731', '#eb3b5a', '#3867d6', '#20bf6b']);
  }

  drawShape(ctx, w, h) {
    ctx.fillStyle = this.color;
    ctx.fillRect(-w / 2, -h / 2 + 5, w, h - 8);
    ctx.fillStyle = '#f5d6a0';                         // sharpened wood
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + 5); ctx.lineTo(w / 2, -h / 2 + 5); ctx.lineTo(0, -h / 2); ctx.fill();
    ctx.fillStyle = '#ff9ff3';                         // eraser
    ctx.fillRect(-w / 2, h / 2 - 3, w, 3);
  }
}

// A piece of a broken device. dx, dy = -1/0/+1: which way the piece sits from the source's
// centre (computer quarters use both, router halves only dx). Draws the source's casing
// clipped to the piece, plus a jagged crack along its broken edge(s).
class BrokenPart extends Prop {
  constructor(source, kind, dx, dy) {
    super(kind, 0, 0);
    const B = CONFIG.breakage;
    this.source = source;
    this.dir = { x: dx, y: dy };
    // piece centre in the source's frame
    this.off = { x: dx * (source.w - this.w) / 2, y: dy * (source.h - this.h) / 2 };
    const w = source.localToWorld(this.off.x, this.off.y);
    const v = source.pointVelocity(w.x, w.y);
    const d = source.dirToWorld(dx, dy), len = Math.hypot(dx, dy) || 1;
    const burst = rand(B.partBurstMin, B.partBurstMax);
    this.x = w.x; this.y = w.y; this.angle = source.angle;
    this.vx = v.x + d.x / len * burst;
    this.vy = v.y + d.y / len * burst - rand(30, 90);
    this.angVel = source.angVel + rand(-8, 8);
    this.age = B.armTime;
    this.innerCorner = { x: -dx * this.w / 2, y: -dy * this.h / 2 };   // where it sparks from
    if (!this.def.noSparks) this.sparkTime = this.sparkTotal = rand(B.sparkTimeMin, B.sparkTimeMax);
    this.crack = this._makeCrack();
  }

  // Random jagged polyline(s) along the broken edges (fixed per piece)
  _makeCrack() {
    const w = this.w, h = this.h, lines = [];
    const jag = (x0, y0, x1, y1, n, amp, nx, ny) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = (i === 0 || i === n) ? 0 : rand(-amp, amp);
        pts.push({ x: lerp(x0, x1, t) + nx * a, y: lerp(y0, y1, t) + ny * a });
      }
      return pts;
    };
    if (this.dir.x) { const x = -this.dir.x * w / 2; lines.push(jag(x, -h / 2, x, h / 2, 6, 2.5, this.dir.x, 0)); }
    if (this.dir.y) { const y = -this.dir.y * h / 2; lines.push(jag(-w / 2, y, w / 2, y, 6, 2.5, 0, this.dir.y)); }
    return lines;
  }

  drawShape(ctx, w, h) {
    ctx.save();
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
    ctx.translate(-this.off.x, -this.off.y);
    this.source.drawShape(ctx, this.source.w, this.source.h, false);   // lights off
    ctx.restore();
    ctx.strokeStyle = this.def.crackColor || '#ffcf6b';
    ctx.lineWidth = 1;
    for (const line of this.crack) {
      ctx.beginPath();
      line.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  }
}

const PROP_CLASSES = { router: Router, hub: Hub, computer: Computer, antenna: Antenna, plant: Plant, flowerPot: FlowerPot, pencilCase: PencilCase, pencil: Pencil };
const makeProp = (kind, x, surfaceY) => new PROP_CLASSES[kind](x, surfaceY);
