// Tiny spark particles (visual only). Updated once per frame, not per physics step.
class Sparks {
  constructor() { this.list = []; }

  reset() { this.list = []; }

  emit(x, y, vx, vy, life = rand(0.25, 0.7)) {
    if (this.list.length >= CONFIG.breakage.maxSparks) return;
    this.list.push({ x, y, vx, vy, life, max: life, hue: rand(30, 55) });
  }

  // Dirt clods: brown, heavier (full gravity), barely bounce, linger on the ground a moment
  dirt(x, y, count) {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= CONFIG.breakage.maxSparks) return;
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), s = rand(50, 230);   // upward fan
      const life = rand(1.2, 2.4);
      this.list.push({ x: x + rand(-4, 4), y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        dirt: true, size: rand(1.5, 3.2), shade: rand(22, 34) });
    }
  }

  // Radial burst
  burst(x, y, count, speedMin, speedMax) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), s = rand(speedMin, speedMax);
      this.emit(x, y, Math.cos(a) * s, Math.sin(a) * s - rand(40, 120));
    }
  }

  update(dt, terrain, gravity, shelves = []) {
    for (const s of this.list) {
      s.life -= dt;
      s.vy += gravity * (s.dirt ? 1 : 0.6) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let g = terrain.heightAt(s.x);
      if (s.dirt && s.vy > 0) {   // dirt lands on shelves too
        for (const sh of shelves) if (s.x > sh.x0 && s.x < sh.x1 && s.y > sh.y0 && s.y - s.vy * dt <= sh.y0 + 1) g = Math.min(g, sh.y0);
      }
      if (s.y > g) { s.y = g; s.vy *= s.dirt ? -0.1 : -0.35; s.vx *= s.dirt ? 0.3 : 0.6; }   // bounce off the ground
    }
    this.list = this.list.filter((s) => s.life > 0);
  }

  draw(ctx) {
    ctx.lineCap = 'round';
    for (const s of this.list) {
      const t = s.life / s.max;
      if (s.dirt) {
        ctx.fillStyle = `hsla(28, 45%, ${s.shade}%, ${Math.min(1, t * 2)})`;
        ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
        continue;
      }
      ctx.strokeStyle = `hsla(${s.hue}, 100%, ${lerp(55, 92, t)}%, ${t})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025);   // short streak along the motion
      ctx.stroke();
    }
  }
}
