// Endless terrain shaped like a network-traffic bar chart.
// The ground is a smooth height profile (curved slopes + flat runs) stored as a polyline,
// drawn as a row of equal-width bars (barWidth wide, barGap apart) whose tops follow it.
// Physics uses the smooth profile; the gaps between bars are visual only.
class Terrain {
  constructor() { this.reset(); }

  reset(difficultyBase = 0) {
    const T = CONFIG.terrain;
    this.difficultyBase = difficultyBase;
    this.points = [];
    this.bars = [];             // every column: { x0, x1, top, flat }
    this.newBars = [];          // flat runs not yet seen by the power-up spawner: { x0, x1, top }
    this.lastY = T.baseY - T.startHeight;
    // Flat runway (columns on the grid from -2000)
    this.genX = -2000;
    this.points.push({ x: this.genX, y: this.lastY });
    this._addFlat(Math.ceil((T.runwayLength + 2000) / this.pitch), false);
  }

  get pitch() { return CONFIG.terrain.barWidth + CONFIG.terrain.barGap; }

  ensure(untilX) {
    while (this.genX < untilX) this._addSegment();
  }

  _pushColumns(n, flat, top) {
    const T = CONFIG.terrain;
    for (let i = 0; i < n; i++) {
      const x0 = this.genX + i * this.pitch;
      this.bars.push({ x0, x1: x0 + T.barWidth, top, flat });
    }
  }

  _addFlat(cols, announce = true) {
    const T = CONFIG.terrain;
    this._pushColumns(cols, true, this.lastY);
    // A flat run ends at the last bar's right edge (the following gap belongs to the next slope)
    const run = { x0: this.genX, x1: this.genX + cols * this.pitch - T.barGap, top: this.lastY };
    this.genX += cols * this.pitch;
    this.points.push({ x: this.genX, y: this.lastY });
    if (announce) this.newBars.push(run);
  }

  // One curved slope followed by a flat run
  _addSegment() {
    const T = CONFIG.terrain;
    const difficulty = clamp(this.difficultyBase + this.genX / T.difficultyDistance, 0, 1);
    const maxDelta = lerp(T.minDelta, T.maxDelta, difficulty);

    // --- slope (curved, spans whole columns) ---
    const cols = randInt(T.slopeColsMin, T.slopeColsMax);
    const w = cols * this.pitch;
    const prevH = T.baseY - this.lastY;
    const mid = (T.minBarHeight + T.maxBarHeight) / 2;
    const goUp = Math.random() < (prevH < mid ? 0.6 : 0.4);
    // Rises are capped by slope width so they stay climbable; drops can be big.
    const delta = goUp ? rand(0.3, 1) * Math.min(maxDelta, w * T.maxUpSlope) : -rand(0.3, 1) * maxDelta;
    const newY = T.baseY - clamp(prevH + delta, T.minBarHeight, T.maxBarHeight);
    const steps = cols * T.stepsPerColumn;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const s = t * t * t * (t * (6 * t - 15) + 10);   // smootherstep: flat ends, S-curve
      this.points.push({ x: this.genX + w * t, y: lerp(this.lastY, newY, s) });
    }
    this._pushColumns(cols, false, Math.min(this.lastY, newY));
    this.genX += w;
    this.lastY = newY;

    // --- flat run (a plateau sometimes: wide enough for devices) ---
    const flatCols = Math.random() < T.plateauChance
      ? randInt(T.plateauColsMin, T.plateauColsMax)
      : randInt(T.flatColsMin, T.flatColsMax);
    this._addFlat(flatCols);
  }

  prune(beforeX) {
    while (this.points.length > 2 && this.points[1].x < beforeX) this.points.shift();
    while (this.bars.length > 1 && this.bars[0].x1 < beforeX) this.bars.shift();
  }

  // index i such that points[i].x <= x < points[i+1].x
  _indexAt(x) {
    const p = this.points;
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid].x <= x) lo = mid; else hi = mid;
    }
    return lo;
  }

  heightAt(x) {
    const p = this.points;
    if (x <= p[0].x) return p[0].y;
    if (x >= p[p.length - 1].x) return p[p.length - 1].y;
    const i = this._indexAt(x);
    const a = p[i], b = p[i + 1];
    return lerp(a.y, b.y, (x - a.x) / (b.x - a.x));
  }

  // Upward-pointing surface normal at x
  normalAt(x) {
    const p = this.points;
    const i = Math.min(this._indexAt(x), p.length - 2);
    const dx = p[i + 1].x - p[i].x, dy = p[i + 1].y - p[i].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dy / len, y: -dx / len };
  }

  // Circle vs ground. Returns { depth, nx, ny } (normal points out of the ground) or null.
  circleContact(cx, cy, r) {
    const ground = this.heightAt(cx);
    if (cy > ground) {
      // Centre is below the surface: push straight out along the surface normal
      const n = this.normalAt(cx);
      return { depth: r + (cy - ground) * -n.y, nx: n.x, ny: n.y };
    }
    const p = this.points;
    let best = null;
    for (let i = this._indexAt(cx - r); i < p.length - 1 && p[i].x <= cx + r; i++) {
      const q = closestPointOnSegment(cx, cy, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
      const dx = cx - q.x, dy = cy - q.y;
      const d = Math.hypot(dx, dy);
      if (d < r && d > 1e-6 && (!best || r - d > best.depth)) {
        best = { depth: r - d, nx: dx / d, ny: dy / d };
      }
    }
    return best;
  }


  draw(ctx, view) {
    const T = CONFIG.terrain;
    const bottom = view.y + view.h + 50;
    const x0 = view.x - 30, x1 = view.x + view.w + 30;

    // Bars, coloured by "utilisation" (height): green -> yellow -> red. Tops follow the ground.
    const step = T.barWidth / 4;
    for (const bar of this.bars) {
      if (bar.x1 < x0 || bar.x0 > x1) continue;
      const midY = this.heightAt((bar.x0 + bar.x1) / 2);
      const util = clamp((T.baseY - midY - T.minBarHeight) / (T.maxBarHeight - T.minBarHeight), 0, 1);
      const hue = lerp(140, 0, util);
      ctx.beginPath();
      ctx.moveTo(bar.x0, bottom);
      for (let x = bar.x0; x <= bar.x1 + 0.01; x += step) ctx.lineTo(x, this.heightAt(x));
      ctx.lineTo(bar.x1, bottom);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 70%, 45%, 0.6)`;
      ctx.fill();
      // bright cap
      ctx.beginPath();
      for (let x = bar.x0; x <= bar.x1 + 0.01; x += step) {
        if (x === bar.x0) ctx.moveTo(x, this.heightAt(x)); else ctx.lineTo(x, this.heightAt(x));
      }
      ctx.strokeStyle = `hsl(${hue}, 85%, 62%)`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Glowing traffic line along the surface
    const p = this.points;
    const start = Math.max(0, this._indexAt(x0) - 1);
    ctx.beginPath();
    ctx.moveTo(p[start].x, p[start].y);
    for (let j = start + 1; j < p.length && p[j - 1].x < x1; j++) ctx.lineTo(p[j].x, p[j].y);
    ctx.strokeStyle = 'rgba(56, 232, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#38e8ff';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
