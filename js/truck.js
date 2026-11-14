// Pickup truck: a rigid body with spring wheel contacts.
// Per physics step: beginStep() -> terrainForces() -> (World adds prop/shelf/cable forces) -> finishStep()
// controls: { gas: bool, tilt: -1 | 0 | 1 }   env: { gravity, boost }
class Truck extends RigidBody {
  constructor() {
    const T = CONFIG.truck;
    super(T.width, T.height, T.mass);
    this.inertia *= T.inertiaScale;
    this.contacts = [];
    this.comp = T.wheels.map(() => 0);       // suspension compression this step (px)
    this.drawComp = T.wheels.map(() => 0);   // smoothed, for drawing
    this.hullFriction = makeFriction(T.hullFriction, 0.2);
    this.propHullFriction = makeFriction(T.propHullFriction, 0.2);  // plastic devices are slippery
    this.wheelFns = T.wheels.map((w) => (N, vt) => this._wheelForce(w, N, vt));
    this.env = { gravity: CONFIG.physics.gravity, boost: false };
    this.controls = { gas: false, tilt: 0 };
    this.reset(0, 0);
  }

  // wheelRadius is per-truck (the Bigger Tires upgrade grows it); reset() restores the default
  reset(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = 0; this.angVel = 0;
    this.wheelRot = 0;
    this.wheelRadius = CONFIG.truck.wheelRadius;
    this.throttle = 0;
    this.reversing = false;
    this.fwd = 0;
    this.grounded = false;
    this.crashed = false;
    this.contacts.length = 0;
  }

  // Change tyre size; lifts the truck so the bigger wheels don't spawn inside the ground
  setWheelRadius(r) {
    this.y -= r - this.wheelRadius;
    this.wheelRadius = r;
  }

  // Buzzsaw (Sirkkeli power-up) blade centre in world space
  sawCenter() {
    const S = CONFIG.sirkkeli;
    return this.localToWorld(S.mountX, S.mountY);
  }

  get forwardSpeed() {
    return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
  }

  _wheelForce(w, N, vt) {
    const T = CONFIG.truck;
    let f = -clamp(vt * 0.1, -1, 1) * T.rollingResistance * N;
    if (this.throttle > 0 && this.reversing) {
      if (this.fwd > 20) {
        f -= Math.min(T.brakeForce * w.drive * 2 * this.throttle, T.grip * N);   // brake
      } else {
        const back = T.reverseForce * w.drive * 2 * Math.max(0, 1 + this.fwd / T.reverseMaxSpeed);
        const crawl = T.crawlForce * Math.max(0, 1 - Math.abs(this.fwd) / T.crawlSpeed);
        f -= Math.min((back + crawl) * this.throttle, T.grip * N);
      }
    } else if (this.throttle > 0) {
      const boost = this.env.boost;
      const engine = T.engineForce * (boost ? T.boostEngineMult : 1);
      const maxSpeed = T.maxSpeed * (boost ? T.boostSpeedMult : 1);
      // Cruise force fades towards top speed; extra crawl torque at low speed helps climb ledges
      const cruise = engine * w.drive * Math.max(0, 1 - this.fwd / maxSpeed);
      const crawl = T.crawlForce * Math.max(0, 1 - Math.abs(this.fwd) / T.crawlSpeed);
      f += Math.min((cruise + crawl) * this.throttle, T.grip * N);
    }
    return f;
  }

  // World position of wheel i's centre with the suspension fully extended
  wheelCenter(i) {
    const w = CONFIG.truck.wheels[i];
    return this.localToWorld(w.x, w.y + CONFIG.truck.suspension.travel);
  }

  // Wheel i touching something (B = other body, or null for static). Point = contact patch.
  // massScale scales the springs for contacts with light props (reduced mass).
  wheelContact(i, B, px, py, nx, ny, depth, massScale = 1) {
    const T = CONFIG.truck, S = T.suspension;
    const soft = Math.min(depth, S.travel), hard = Math.max(0, depth - S.travel);
    this.comp[i] = Math.max(this.comp[i], soft);
    // applyContact computes N = k*depth - c*vn; feed it the combined spring force with k = 1
    const spring = (S.stiffness * soft + T.contactStiffness * hard) * massScale;
    const damp = (hard > 0 ? T.contactDamping : S.damping) * massScale;
    const N = applyContact(this, B, px, py, nx, ny, spring, 1, damp, this.wheelFns[i]);
    if (N > 0) {
      this.grounded = true;
      this.contacts.push({ x: px, y: py, nx, ny });
    }
    return N;
  }

  // Hull point touching something (B = other body or null)
  hullContact(B, px, py, nx, ny, depth, k, c) {
    const fr = B ? this.propHullFriction : this.hullFriction;
    const N = applyContact(this, B, px, py, nx, ny, depth, k, c, fr);
    if (N > 0) this.hullTouching = true;
    return N;
  }

  beginStep(dt, controls, env) {
    const T = CONFIG.truck;
    this.controls = controls;
    this.env = env;
    // Gas wins if both are held. Throttle resets when switching direction.
    const reversing = !controls.gas && !!controls.reverse;
    if (reversing !== this.reversing) this.throttle = 0;
    this.reversing = reversing;
    this.throttle = controls.gas || reversing ? Math.min(1, this.throttle + dt * T.throttleRise) : 0;
    this.fwd = this.forwardSpeed;
    this.grounded = false;
    this.hullTouching = false;
    this.contacts.length = 0;
    this.comp.fill(0);
    this.clearForces(env.gravity);
  }

  terrainForces(terrain) {
    const T = CONFIG.truck;
    const k = T.contactStiffness, c = T.contactDamping;
    T.wheels.forEach((w, i) => {
      const wc = this.wheelCenter(i);
      const hit = terrain.circleContact(wc.x, wc.y, this.wheelRadius);
      if (hit) this.wheelContact(i, null, wc.x - hit.nx * this.wheelRadius, wc.y - hit.ny * this.wheelRadius, hit.nx, hit.ny, hit.depth);
    });
    for (const hp of T.hullPoints) {
      const p = this.localToWorld(hp.x, hp.y);
      const ground = terrain.heightAt(p.x);
      if (p.y <= ground) continue;
      const n = terrain.normalAt(p.x);
      this.hullContact(null, p.x, p.y, n.x, n.y, (p.y - ground) * -n.y, k, c);
    }
  }

  finishStep(dt, terrain, world) {
    const T = CONFIG.truck;
    // Player tilt (Left = nose up / counter-clockwise, Right = nose down)
    if (this.controls.tilt) {
      const k = this.grounded ? T.tiltTorqueGround : T.tiltTorqueAir;
      this.torque += this.controls.tilt * k * this.inertia;
    }
    // High-centred (wheels in the air, belly on something): spinning tyres still scrabble forward
    if (!this.grounded && this.hullTouching && this.throttle > 0) {
      const dir = this.reversing ? -1 : 1;
      this.fx += dir * Math.cos(this.angle) * T.scrabbleForce * this.throttle;
      this.fy += dir * Math.sin(this.angle) * T.scrabbleForce * this.throttle;
    }
    // Jetpack: thrust along the truck's own "up", so tilting steers it
    this.jetting = !!this.controls.jet;
    if (this.jetting) {
      const up = this.dirToWorld(0, -1), F = CONFIG.jetpack.thrust * this.mass;
      this.fx += up.x * F;
      this.fy += up.y * F;
    }
    this.integrate(dt, T.airDrag, T.angularDamping);
    const k = 1 - Math.exp(-dt * 30);
    this.comp.forEach((cv, i) => { this.drawComp[i] += (cv - this.drawComp[i]) * k; });
    const spin = this.throttle * 300 * (this.reversing ? -1 : 1);
    this.wheelRot += (this.grounded ? this.fwd : this.fwd + spin) / this.wheelRadius * dt;

    const upsideDown = Math.cos(this.angle) < 0;
    for (const rp of T.roofPoints) {
      const p = this.localToWorld(rp.x, rp.y);
      if (p.y > terrain.heightAt(p.x) || (upsideDown && world.roofHit(p.x, p.y))) this.crashed = true;
    }
  }

  touchesCircle(x, y, r) {
    const T = CONFIG.truck;
    if (Math.hypot(x - this.x, y - this.y) < r + T.height / 2) return true;
    for (let i = 0; i < T.wheels.length; i++) {
      const c = this.wheelCenter(i);
      if (Math.hypot(x - c.x, y - c.y) < r + this.wheelRadius) return true;
    }
    for (const hp of T.hullPoints) {
      const p = this.localToWorld(hp.x, hp.y);
      if (Math.hypot(x - p.x, y - p.y) < r) return true;
    }
    return false;
  }

  draw(ctx, debug, boosting) {
    const T = CONFIG.truck, B = T.boxes;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // buzzsaw on the front bumper
    if (this.sawActive) {
      const S = CONFIG.sirkkeli;
      ctx.fillStyle = '#555b6e';
      ctx.fillRect(B.hood.x1 - 2, S.mountY - 2, S.mountX - B.hood.x1 + 2, 4);   // arm
      drawSawBlade(ctx, S.mountX, S.mountY, S.radius, this.sawAngle || 0, '#dfe6ee', 16);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';                           // motion blur ring
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(S.mountX, S.mountY, S.radius - 1, 0, Math.PI * 2); ctx.stroke();
    }

    // jetpack flames out of the underside
    if (this.jetting) {
      for (const nx of [-14, 14]) {
        const len = rand(16, 30);
        ctx.fillStyle = '#ff6348';
        ctx.beginPath(); ctx.moveTo(nx - 5, B.chassis.y1); ctx.lineTo(nx, B.chassis.y1 + len); ctx.lineTo(nx + 5, B.chassis.y1); ctx.fill();
        ctx.fillStyle = '#ffe66d';
        ctx.beginPath(); ctx.moveTo(nx - 2.5, B.chassis.y1); ctx.lineTo(nx, B.chassis.y1 + len * 0.55); ctx.lineTo(nx + 2.5, B.chassis.y1); ctx.fill();
      }
      ctx.fillStyle = '#555b6e';
      ctx.fillRect(-20, B.chassis.y1 - 2, 12, 4);   // nozzles
      ctx.fillRect(8, B.chassis.y1 - 2, 12, 4);
    }

    // exhaust flame while boosting
    if (boosting && this.throttle > 0) {
      ctx.fillStyle = Math.random() < 0.5 ? '#ffa502' : '#ff6348';
      ctx.beginPath();
      ctx.moveTo(B.chassis.x0, 2);
      ctx.lineTo(B.chassis.x0 - rand(14, 26), 5);
      ctx.lineTo(B.chassis.x0, 8);
      ctx.fill();
    }

    const box = (b, color) => { ctx.fillStyle = color; ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); };
    box(B.chassis, '#d6452f');
    box(B.hood, '#e85a3c');
    box(B.cab, '#e85a3c');
    box(B.tailgate, '#b33a26');
    ctx.fillStyle = '#9fd8ff';
    ctx.fillRect(B.cab.x0 + 14, B.cab.y0 + 4, B.cab.x1 - B.cab.x0 - 18, 12);
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(B.hood.x1 - 4, B.hood.y0 + 3, 4, 5);
    ctx.fillStyle = '#ff2e2e';
    ctx.fillRect(B.chassis.x0, B.chassis.y0 + 1, 3, 5);

    T.wheels.forEach((w, i) => {
      const wy = w.y + T.suspension.travel - this.drawComp[i];
      // suspension strut
      ctx.strokeStyle = '#555b6e';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(w.x, B.chassis.y1 - 4); ctx.lineTo(w.x, wy); ctx.stroke();
      ctx.save();
      ctx.translate(w.x, wy);
      ctx.rotate(this.wheelRot);
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath(); ctx.arc(0, 0, this.wheelRadius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a93a6';
      ctx.beginPath(); ctx.arc(0, 0, this.wheelRadius * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1b1b1f';
      ctx.lineWidth = 2;
      const sp = this.wheelRadius * 0.375;
      ctx.beginPath(); ctx.moveTo(-sp, 0); ctx.lineTo(sp, 0); ctx.moveTo(0, -sp); ctx.lineTo(0, sp); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();

    if (debug) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 1;
      for (const c of this.contacts) {
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + c.nx * 20, c.y + c.ny * 20); ctx.stroke();
      }
    }
  }
}
