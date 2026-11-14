// Floating pickups. Driving through one activates a timed effect (see Game.applyPowerUp).
const POWERUP_STYLES = {
  boost:       { color: '#ffa502', label: '»',    name: 'SPEED BOOST!' },
  gravDouble:  { color: '#b166ff', label: 'G×2',  name: 'DOUBLE GRAVITY!' },
  gravHalf:    { color: '#2ed573', label: 'G½',   name: 'HALF GRAVITY!' },
  bigTires:    { color: '#ff9ff3', label: '◎',    name: 'BIG TIRES!' },
  sirkkeli:    { color: '#dfe6ee', label: '', saw: true, name: 'SIRKKELI!' },   // buzzsaw (drawn, not text)
  backup:      { color: '#38e8ff', label: '+PKT', name: '+1 BACKUP PACKET' },
};

class PowerUp {
  constructor(type, x, y) {
    this.type = type;
    this.x = x;
    this.baseY = y;
    this.y = y;
    this.t = Math.random() * 10;
    this.collected = false;
  }

  update(dt) {
    this.t += dt;
    this.y = this.baseY + Math.sin(this.t * 3) * 6;
  }

  draw(ctx) {
    const s = POWERUP_STYLES[this.type];
    const r = CONFIG.powerups.radius;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(11, 16, 32, 0.8)';
    ctx.fill();
    if (s.saw) {
      drawSawBlade(ctx, 0, 0, r * 0.75, this.t * 6, s.color);
    } else {
      ctx.fillStyle = s.color;
      ctx.font = `bold ${s.label.length > 3 ? 8 : s.label.length > 1 ? 10 : 18}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.label, 0, 1);
    }
    ctx.restore();
  }
}

class PowerUpManager {
  constructor() { this.list = []; }

  reset() { this.list = []; }

  // exclude: power-up types not allowed in this mode
  spawnOnBars(bars, exclude = []) {
    const P = CONFIG.powerups;
    const weights = Object.fromEntries(Object.entries(P.weights).filter(([k]) => !exclude.includes(k)));
    for (const bar of bars) {
      if (bar.x0 < P.safeStart || Math.random() > P.chancePerBar) continue;
      const type = weightedPick(weights);
      const x = rand(bar.x0 + 10, bar.x1 - 10);
      this.list.push(new PowerUp(type, x, bar.top - rand(P.floatMin, P.floatMax)));
    }
  }

  addAt(type, x, y) { this.list.push(new PowerUp(type, x, y)); }

  // Returns the power-ups collected this step ({ type, x, y }). canCollect(type) = false leaves it in place.
  update(dt, truck, canCollect = () => true) {
    const got = [];
    for (const p of this.list) {
      p.update(dt);
      if (!p.collected && canCollect(p.type) && truck.touchesCircle(p.x, p.y, CONFIG.powerups.radius)) {
        p.collected = true;
        got.push({ type: p.type, x: p.x, y: p.y });
      }
    }
    if (got.length) this.list = this.list.filter((p) => !p.collected);
    return got;
  }

  prune(beforeX) { this.list = this.list.filter((p) => p.x > beforeX); }

  draw(ctx, view) {
    for (const p of this.list) {
      if (p.x > view.x - 30 && p.x < view.x + view.w + 30) p.draw(ctx);
    }
  }
}
