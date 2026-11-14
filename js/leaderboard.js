// Leaderboard service: the only thing in the game that talks to Supabase. Game (js/game.js)
// just calls submitRun() once when a run finishes; everything else - payload shape, endpoint,
// spam guards, failure UI - lives here, isolated from gameplay logic. This keeps the door open
// for later additions (top scores, personal bests, a leaderboard screen, mode filtering, extra
// metadata) as new methods on this class without touching Game.
class Leaderboard {
  constructor() {
    this.toastEl = document.getElementById('leaderboard-toast');
    this._toastTimer = null;
    this._topCache = new Map();   // mode -> { t: Date.now(), rows }
  }

  // mode: 'infinite' | 'progression' | 'hacker' | 'level1' / 'level2' / ...
  // score: the run's final point total.
  // time: seconds (optional) - a level's completion time. Levels rank by this, not score, so a
  // run with a time is always worth posting even if it scored 0 (minScore only guards the
  // score-only modes, where a 0-point run really is nothing worth posting).
  async submitRun(mode, score, { time } = {}) {
    const L = CONFIG.leaderboard;
    if (!L.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return;   // leaderboard not configured
    const hasTime = typeof time === 'number' && isFinite(time);
    if (!hasTime && !(score >= L.minScore)) return;                   // nothing worth posting

    const username = Identity.getUsername();
    if (!username) return;                                            // no identity yet: skip quietly
    const playerId = Identity.getPlayerId();                          // regenerates on its own if missing

    const payload = {
      player_id: playerId,
      username,
      score: Math.round(score),
      mode,
      game_version: CONFIG.version,
    };
    if (hasTime) payload.time = Math.round(time * 100) / 100;   // seconds, 2 decimals

    try {
      if (typeof fetch !== 'function') return;   // no network in this environment (e.g. headless tests)
      const res = await fetch(`${L.supabaseUrl}/rest/v1/${L.table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: L.supabaseAnonKey,
          Authorization: `Bearer ${L.supabaseAnonKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Supabase responded ${res.status}: ${body}`);
      }
    } catch (err) {
      console.error('[leaderboard] score upload failed:', err);
      this._showToast('Could not upload score to leaderboard');
    }
  }

  // Top N rows for one mode, as [{ username, score, time }, ...], best first. Used by the main
  // menu's side panel and the end-of-run screens. Levels rank by time ascending (fastest first);
  // every other mode ranks by score descending. Results are cached briefly (topCacheTime) so
  // moving focus/hover between mode buttons doesn't hammer the network; returns [] rather than
  // throwing when unconfigured, offline, or the request fails (stale cached rows are reused if
  // we have any).
  async fetchTop(mode, limit = CONFIG.leaderboard.topCount) {
    const L = CONFIG.leaderboard;
    const cached = this._topCache.get(mode);
    if (cached && Date.now() - cached.t < L.topCacheTime * 1000) return cached.rows;
    if (!L.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return cached ? cached.rows : [];

    try {
      if (typeof fetch !== 'function') return cached ? cached.rows : [];
      const order = /^level\d+$/.test(mode) ? 'time.asc.nullslast' : 'score.desc';
      const url = `${L.supabaseUrl}/rest/v1/${L.table}?select=username,score,time&mode=eq.${encodeURIComponent(mode)}` +
        `&order=${order}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { apikey: L.supabaseAnonKey, Authorization: `Bearer ${L.supabaseAnonKey}` },
      });
      if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
      const rows = await res.json();
      this._topCache.set(mode, { t: Date.now(), rows });
      return rows;
    } catch (err) {
      console.error('[leaderboard] fetching top scores failed:', err);
      return cached ? cached.rows : [];
    }
  }

  _showToast(message) {
    const el = this.toastEl;
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), CONFIG.leaderboard.toastTime * 1000);
  }
}

// Human-readable title for a leaderboard mode key ('infinite', 'level2', ...). Used by every
// top-scores panel (main menu and the end-of-run screens) so they all label consistently.
function leaderboardModeLabel(mode) {
  if (mode === 'infinite') return 'INFINITE';
  if (mode === 'progression') return 'PROGRESSION';
  if (mode === 'hacker') return 'HACKER';
  const m = /^level(\d+)$/.exec(mode || '');
  if (m) {
    const lv = CONFIG.levels[+m[1] - 1];
    return lv ? lv.name.toUpperCase() : mode.toUpperCase();
  }
  return String(mode || '').toUpperCase();
}

// valueFn for renderLeaderboardRows() (utils.js), picked by mode: Levels show a formatted
// completion time, every other mode shows the raw score.
function leaderboardValueFn(mode) {
  if (!/^level\d+$/.test(mode || '')) return undefined;
  return (r) => (typeof r.time === 'number' ? formatTime(r.time) : '--');
}
