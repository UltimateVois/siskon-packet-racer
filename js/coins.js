// Bitcoin pickups (Progression mode): 1 BTC near the ground, 2 BTC on shelves.
class Coin {
  constructor(x, y, value) {
    this.x = x; this.baseY = y; this.y = y;
    this.value = value;
    this.t = Math.random() * 10;
  }

  update(dt) {
    this.t += dt;
    this.y = this.baseY + Math.sin(this.t * 4) * 3;
  }

  draw(ctx) {
    const r = CONFIG.progression.coinRadius * (this.value > 1 ? 1.2 : 1);
    const squash = Math.abs(Math.cos(this.t * 2.5)) * 0.7 + 0.3;   // spinning coin
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = '#f7931a';
    ctx.shadowBlur = this.value > 1 ? 14 : 8;
    ctx.fillStyle = this.value > 1 ? '#ffb43a' : '#f7931a';
    ctx.beginPath(); ctx.ellipse(0, 0, r * squash, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffe2a8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (squash > 0.55) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.3)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₿', 0, 1);
    }
    if (this.value > 1) {
      ctx.fillStyle = '#ffe2a8';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('×2', 0, -r - 5);
    }
    ctx.restore();
  }
}

class CoinManager {
  constructor() { this.list = []; }

  reset() { this.list = []; }

  // Coins hovering over flat runs of the ground (sometimes a short row)
  spawnOnGround(runs) {
    const P = CONFIG.progression;
    for (const run of runs) {
      if (run.x0 < P.coinStart || Math.random() > P.groundCoinChance) continue;
      const room = run.x1 - run.x0 - 10;
      const n = Math.max(1, Math.min(1 + Math.floor(Math.random() * P.groundCoinRowMax), Math.floor(room / P.coinSpacing) + 1));
      const span = (n - 1) * P.coinSpacing;
      const x0 = (run.x0 + run.x1) / 2 - span / 2;
      for (let i = 0; i < n; i++) this.list.push(new Coin(x0 + i * P.coinSpacing, run.top - P.groundCoinHeight, P.groundCoinValue));
    }
  }

  // Coins sitting on shelves (worth more: you need to get up there)
  spawnOnShelves(shelves) {
    const P = CONFIG.progression;
    for (const s of shelves) {
      if (s.coinChecked) continue;
      s.coinChecked = true;
      if (s.x0 < P.coinStart || Math.random() > P.shelfCoinChance) continue;
      this.list.push(new Coin(rand(s.x0 + 12, s.x1 - 12), s.y0 - P.coinRadius - 4, P.shelfCoinValue));
    }
  }

  // Returns BTC collected this step
  update(dt, truck) {
    let got = 0;
    const r = CONFIG.progression.coinRadius;
    this.list = this.list.filter((c) => {
      c.update(dt);
      if (truck.touchesCircle(c.x, c.y, r)) { got += c.value; return false; }
      return true;
    });
    return got;
  }

  prune(beforeX) { this.list = this.list.filter((c) => c.x > beforeX); }

  draw(ctx, view) {
    for (const c of this.list) if (c.x > view.x - 30 && c.x < view.x + view.w + 30) c.draw(ctx);
  }
}
