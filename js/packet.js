// The network packet riding in the truck bed. A free point-mass box that collides
// with the truck's local boxes (bed floor, tailgate, cab...). Touching the ground = lost.
class Packet {
  constructor() { this.reset(null); }

  reset(truck) {
    const P = CONFIG.packet;
    this.half = P.size / 2;
    this.vx = 0; this.vy = 0;
    this.angle = 0; this.angVel = 0;
    this.onTruck = false;
    this.lost = false;
    this.flash = 0;
    if (truck) {
      const floorY = CONFIG.truck.boxes.chassis.y0;
      const p = truck.localToWorld(P.startLocalX, floorY - this.half);
      this.x = p.x; this.y = p.y;
      this.angle = truck.angle;
    } else {
      this.x = 0; this.y = 0;
    }
  }

  step(dt, truck, terrain, world, gravity) {
    const P = CONFIG.packet;
    if (this.flash > 0) this.flash -= dt;
    this.vy += gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.angVel * dt;

    this._collideTruck(truck);

    if (!this.lost) {
      // Only "dropped" once it has actually left the truck: a device bumping into the
      // packet while it's still in (or just above) the bed doesn't count.
      const hitSomething = this.y + this.half > terrain.heightAt(this.x)
        || world.packetTouchesDevice(this.x, this.y, this.half);
      const tooFar = Math.hypot(this.x - truck.x, this.y - truck.y) > P.lostDistance;
      if ((hitSomething && !this.onTruck && !this.nearTruck(truck)) || tooFar) this.lost = true;
    }
    if (this.lost) {
      // Rest on the ground once lost
      const g = terrain.heightAt(this.x);
      if (this.y + this.half > g) { this.y = g - this.half; this.vy = 0; this.vx *= 0.9; this.angVel *= 0.9; }
    }
  }

  // Close to the centre of the truck bed (in the truck's frame)?
  nearTruck(truck) {
    const B = CONFIG.truck.boxes;
    const cx = (B.tailgate.x1 + B.cab.x0) / 2, cy = B.chassis.y0 - this.half;
    const l = truck.worldToLocal(this.x, this.y);
    return Math.hypot(l.x - cx, l.y - cy) < CONFIG.packet.safeRadius;
  }

  _collideTruck(truck) {
    const P = CONFIG.packet;
    const h = this.half;
    const a = truck.angle, c = Math.cos(a), s = Math.sin(a);

    // Into the truck's local frame (position and velocity relative to the body)
    let lp = truck.worldToLocal(this.x, this.y);
    const bv = truck.pointVelocity(this.x, this.y);
    const rvx = this.vx - bv.x, rvy = this.vy - bv.y;
    let lvx = rvx * c + rvy * s;
    let lvy = -rvx * s + rvy * c;

    const wasOnTruck = this.onTruck;
    this.onTruck = false;
    for (const b of Object.values(CONFIG.truck.boxes)) {
      const ox = Math.min(lp.x + h, b.x1) - Math.max(lp.x - h, b.x0);
      const oy = Math.min(lp.y + h, b.y1) - Math.max(lp.y - h, b.y0);
      if (ox <= 0 || oy <= 0) continue;

      if (ox < oy) {
        // Side hit (cab wall / tailgate)
        const dir = lp.x < (b.x0 + b.x1) / 2 ? -1 : 1;
        lp.x += dir * ox;
        if (lvx * dir < 0) lvx = -lvx * P.restitution;
      } else {
        const dir = lp.y < (b.y0 + b.y1) / 2 ? -1 : 1;
        lp.y += dir * oy;
        if (lvy * dir < 0) {
          const impact = Math.abs(lvy);
          lvy = impact > P.bounceThreshold ? -lvy * P.restitution : 0;
          // Coulomb friction: tangential change limited by mu * normal impulse
          const jn = impact + Math.abs(lvy);
          lvx -= Math.sign(lvx) * Math.min(Math.abs(lvx), P.friction * jn);
        }
        if (dir < 0) this.onTruck = true;
      }
    }

    if (this.onTruck) { this.angle = truck.angle; this.angVel = truck.angVel; }
    else if (wasOnTruck) this.angVel += rand(-3, 3); // start tumbling when it leaves the bed

    // Back to world
    const w = truck.localToWorld(lp.x, lp.y);
    this.x = w.x; this.y = w.y;
    const nbv = truck.pointVelocity(this.x, this.y);
    this.vx = lvx * c - lvy * s + nbv.x;
    this.vy = lvx * s + lvy * c + nbv.y;
  }

  // Where a waiting backup packet sits: in the bed, right behind the cab (truck-local)
  static backupLocal() {
    const B = CONFIG.truck.boxes, h = CONFIG.packet.size / 2;
    return { x: B.cab.x0 - h - 1, y: B.chassis.y0 - h };
  }

  // Ghost of the spare packet(s): see-through blue, no collision or physics
  static drawBackup(ctx, truck, count) {
    const h = CONFIG.packet.size / 2, l = Packet.backupLocal();
    ctx.save();
    ctx.translate(truck.x, truck.y);
    ctx.rotate(truck.angle);
    ctx.translate(l.x, l.y);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#3d8bff';
    ctx.fillRect(-h, -h, h * 2, h * 2);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#7fb2ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(-h, -h, h * 2, h * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = '#d6e6ff';
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PKT', 0, 3);
    if (count > 1) {
      ctx.font = 'bold 8px monospace';
      ctx.fillText('×' + count, 0, -h - 3);
    }
    ctx.restore();
  }

  draw(ctx) {
    const h = this.half;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    // flashes for a moment after a backup packet takes over
    if (this.flash > 0 && Math.floor(this.flash * 10) % 2) ctx.globalAlpha = 0.35;
    ctx.fillStyle = this.lost ? '#ff5d6c' : '#38e8ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fillRect(-h, -h, h * 2, h * 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(-h, -h, h * 2, 5);           // header
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PKT', 0, 5);
    ctx.restore();
  }
}
