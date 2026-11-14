// Leaderboard service: the only thing in the game that talks to Supabase. Game (js/game.js)
// just calls submitRun() once when a run finishes; everything else - payload shape, endpoint,
// spam guards, failure UI - lives here, isolated from gameplay logic. This keeps the door open
// for later additions (top scores, personal bests, a leaderboard screen, mode filtering, extra
// metadata) as new methods on this class without touching Game.
class Leaderboard {
  constructor() {
    this.toastEl = document.getElementById('leaderboard-toast');
    this._toastTimer = null;
  }

  // mode: 'infinite' | 'progression' | 'hacker' | 'level1' / 'level2' / ...
  // score: the run's final point total.
  async submitRun(mode, score) {
    const L = CONFIG.leaderboard;
    if (!L.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return;   // leaderboard not configured
    if (!(score >= L.minScore)) return;                               // nothing worth posting

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

  _showToast(message) {
    const el = this.toastEl;
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), CONFIG.leaderboard.toastTime * 1000);
  }
}
