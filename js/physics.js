// Minimal rigid-body physics: boxes with mass/inertia, penalty (spring-damper) contacts.
class RigidBody {
  constructor(w, h, mass) {
    this.w = w;
    this.h = h;
    this.mass = mass;
    this.inertia = mass * (w * w + h * h) / 12;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.angle = 0; this.angVel = 0;
    this.fx = 0; this.fy = 0; this.torque = 0;
    this.localBox = { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 };
    this.radius = Math.hypot(w, h) / 2;
  }

  localToWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c };
  }

  worldToLocal(wx, wy) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const dx = wx - this.x, dy = wy - this.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  // Rotate a direction vector from local to world
  dirToWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: lx * c - ly * s, y: lx * s + ly * c };
  }

  pointVelocity(wx, wy) {
    return { x: this.vx - this.angVel * (wy - this.y), y: this.vy + this.angVel * (wx - this.x) };
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  clearForces(gravity) {
    this.fx = 0;
    this.fy = this.mass * gravity;
    this.torque = 0;
  }

  applyForceAt(px, py, Fx, Fy) {
    this.fx += Fx;
    this.fy += Fy;
    this.torque += (px - this.x) * Fy - (py - this.y) * Fx;
  }

  integrate(dt, linDrag = 0, angDrag = 0) {
    this.fx -= this.vx * linDrag * this.mass;
    this.fy -= this.vy * linDrag * this.mass;
    this.torque -= this.angVel * angDrag * this.inertia;
    this.vx += this.fx / this.mass * dt;
    this.vy += this.fy / this.mass * dt;
    this.angVel += this.torque / this.inertia * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.angVel * dt;
  }
}

// Spring-damper contact at world point (px,py). Normal n pushes A; B (optional) gets the
// opposite force. tangentialFn(N, vt) returns the force along the tangent (-ny, nx).
function applyContact(A, B, px, py, nx, ny, depth, k, c, tangentialFn) {
  const va = A.pointVelocity(px, py);
  let vx = va.x, vy = va.y;
  if (B) {
    const vb = B.pointVelocity(px, py);
    vx -= vb.x; vy -= vb.y;
  }
  const vn = vx * nx + vy * ny;
  const N = Math.max(0, k * depth - c * vn);
  if (N === 0) return 0;
  const tx = -ny, ty = nx;
  const Ft = tangentialFn ? tangentialFn(N, vx * tx + vy * ty) : 0;
  const Fx = N * nx + Ft * tx, Fy = N * ny + Ft * ty;
  A.applyForceAt(px, py, Fx, Fy);
  if (B) B.applyForceAt(px, py, -Fx, -Fy);
  return N;
}

// Regularised Coulomb friction
function makeFriction(mu, reg = 0.5) {
  return (N, vt) => -clamp(vt * reg, -1, 1) * mu * N;
}

// Deepest contact of a local point against a list of local AABBs: { depth, nx, ny } or null
function pointInBoxes(lx, ly, boxes, inflate = 0) {
  let best = null;
  for (const b of boxes) {
    const r = inflate ? { x0: b.x0 - inflate, y0: b.y0 - inflate, x1: b.x1 + inflate, y1: b.y1 + inflate } : b;
    const hit = pointRectContact(lx, ly, r);
    if (hit && (!best || hit.depth > best.depth)) best = hit;
  }
  return best;
}

const reducedMass = (a, b) => (a * b) / (a + b);
