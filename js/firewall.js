// FIREWALL: a burning wall creeping in from the left. Touching the packet = game over.
// It slowly speeds up, and never falls more than maxGap behind the truck so it stays a threat.
class Firewall {
  constructor() { this.reset(0); }

  reset(startX) {
    const F = CONFIG.firewall;
    this.x = startX - F.startGap;
    this.speed = F.speed;
    this.time = 0;      // time spent moving (drives the speed-up)
    this.anim = 0;      // flame animation clock
    this.speedMult = 1; // Hacker mode: the sysadmin speeds it up
  }

  update(dt, leadX, moving) {
    const F = CONFIG.firewall;
    this.anim += dt;
    if (!moving) return;
    this.time += dt;
    this.speed = Math.min(F.maxSpeed, F.speed + F.accel * this.time) * this.speedMult;
    this.x += this.speed * dt;
    if (leadX - this.x > F.maxGap) this.x = leadX - F.maxGap;
  }

  touches(packet) { return packet.x - packet.half <= this.x; }

  // Hacker mode (no packet): the truck's rear end
  touchesTruck(truck) { return truck.x - Math.abs(Math.cos(truck.angle)) * CONFIG.truck.width / 2 <= this.x; }

  draw(ctx, view) {
    const x = this.x, t = this.anim;
    if (x < view.x - 140) return;
    const top = view.y - 20, bottom = view.y + view.h + 20, h = bottom - top;

    // heat glow in front of the wall
    const g = ctx.createLinearGradient(x, 0, x + 140, 0);
    g.addColorStop(0, 'rgba(255, 70, 20, 0.45)');
    g.addColorStop(1, 'rgba(255, 70, 20, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, top, 140, h);

    // the wall itself covers everything behind it
    const left = view.x - 20;
    if (x > left) {
      ctx.fillStyle = '#5a0d0d';
      ctx.fillRect(left, top, x - left, h);
      // bricks
      ctx.strokeStyle = '#2a0505';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const bw = 40, bh = 18;
      const y0 = Math.floor(top / bh) * bh;
      for (let y = y0; y < bottom; y += bh) {
        ctx.moveTo(left, y); ctx.lineTo(x, y);
        const off = (Math.floor(y / bh) % 2) * (bw / 2);
        for (let bx = Math.floor((left - off) / bw) * bw + off; bx < x; bx += bw) {
          if (bx > left) { ctx.moveTo(bx, y); ctx.lineTo(bx, y + bh); }
        }
      }
      ctx.stroke();
    }

    // flames licking out of the front edge
    const step = 14;
    for (let y = Math.floor(top / step) * step; y < bottom; y += step) {
      const len = 22 + 14 * Math.sin(t * 8 + y * 0.13) + 7 * Math.sin(t * 13 + y * 0.37);
      ctx.fillStyle = '#ff3b1f';
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + len, y); ctx.lineTo(x, y + 9); ctx.fill();
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + len * 0.55, y); ctx.lineTo(x, y + 5); ctx.fill();
    }

    // label
    ctx.save();
    ctx.translate(x - 22, view.y + view.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255, 200, 120, 0.85)';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('FIREWALL', 0, 6);
    ctx.restore();
  }
}
