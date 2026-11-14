const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// Circular saw blade: teeth around a disc, hole in the middle
function drawSawBlade(ctx, x, y, r, rot, color, teeth = 14) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.6) / teeth) * Math.PI * 2;
    ctx.lineTo(Math.cos(a0) * r * 0.78, Math.sin(a0) * r * 0.78);
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);           // tooth tip
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// '#rrggbb' -> [r, g, b]
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return { x: ax + dx * t, y: ay + dy * t };
}

function circleIntersectsRect(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x0, rect.x1);
  const ny = clamp(cy, rect.y0, rect.y1);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function pointInRect(x, y, rect) {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

// Point inside an axis-aligned rect: push out along the shallowest side.
// Returns { depth, nx, ny } (normal points out of the rect) or null.
function pointRectContact(px, py, rect) {
  if (!pointInRect(px, py, rect)) return null;
  const sides = [
    { depth: px - rect.x0, nx: -1, ny: 0 },
    { depth: rect.x1 - px, nx: 1, ny: 0 },
    { depth: py - rect.y0, nx: 0, ny: -1 },
    { depth: rect.y1 - py, nx: 0, ny: 1 },
  ];
  return sides.reduce((a, b) => (b.depth < a.depth ? b : a));
}

function circleRectContact(cx, cy, r, rect) {
  const qx = clamp(cx, rect.x0, rect.x1), qy = clamp(cy, rect.y0, rect.y1);
  const dx = cx - qx, dy = cy - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { depth: r - d, nx: dx / d, ny: dy / d };
  }
  const c = pointRectContact(cx, cy, rect);
  return { depth: c.depth + r, nx: c.nx, ny: c.ny };
}

// weights: { key: number } -> random key
function weightedPick(weights) {
  const entries = Object.entries(weights);
  let roll = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
  return entries[entries.length - 1][0];
}

const Storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// Filled rect with top corners rounded (bottom sits flat on the ground)
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}
