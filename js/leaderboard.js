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
  // time: seconds (optional) - a level's completion time. Levels rank by this, not score.
  // distance: metres (optional) - Infinite ranks by this, not score.
  // A run with a time or distance is always worth posting even if it scored 0 (minScore only
  // guards the purely score-based modes, where a 0-point run really is nothing worth posting).
  // Returns true once the row actually landed (so a caller can refresh a leaderboard view that's
  // already on screen - see GuestSubmitPrompt and Game.refreshEndLeaderboard()); falsy
  // otherwise (nothing to post, no identity, or the upload failed).
  async submitRun(mode, score, { time, distance } = {}) {
    const L = CONFIG.leaderboard;
    if (!L.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return;   // leaderboard not configured
    const hasTime = typeof time === 'number' && isFinite(time);
    const hasDistance = typeof distance === 'number' && isFinite(distance) && distance > 0;
    if (!hasTime && !hasDistance && !(score >= L.minScore)) return;   // nothing worth posting

    const username = Identity.getUsername();
    if (!username || Identity.isGuest()) return;   // no identity yet, or still a guest: skip quietly
    const playerId = Identity.getPlayerId();                          // regenerates on its own if missing

    const payload = {
      player_id: playerId,
      username,
      score: Math.round(score),
      mode,
      game_version: CONFIG.version,
    };
    if (hasTime) payload.time = Math.round(time * 100) / 100;   // seconds, 2 decimals
    if (hasDistance) payload.distance = Math.round(distance);   // metres

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
      this._topCache.delete(mode);   // this mode's cached top list no longer includes this row
      return true;
    } catch (err) {
      console.error('[leaderboard] score upload failed:', err);
      this._showToast('Could not upload score to leaderboard');
    }
  }

  // Top N rows for one mode, as [{ username, score, time, distance }, ...], best first, one row
  // per username (see dedupeByUsername() - a player with several runs on the board only ever
  // occupies their single best slot). Used by the main menu's side panel, the end-of-run
  // screens, and (for a distance-ranked mode) Game's visual run markers/rank-passing popups -
  // see Game._loadTopRunMarkers(), which reads this same list. Levels rank by time ascending
  // (fastest first); Infinite ranks by distance descending; every other mode ranks by score
  // descending. Results are cached briefly (topCacheTime) so moving focus/hover between mode
  // buttons doesn't hammer the network; returns [] rather than throwing when unconfigured,
  // offline, or the request fails (stale cached rows are reused if we have any).
  async fetchTop(mode, limit = CONFIG.leaderboard.topCount) {
    const L = CONFIG.leaderboard;
    const cached = this._topCache.get(mode);
    if (cached && Date.now() - cached.t < L.topCacheTime * 1000) return cached.rows;
    if (!L.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return cached ? cached.rows : [];

    try {
      if (typeof fetch !== 'function') return cached ? cached.rows : [];
      // Only select the metric column this mode actually ranks by - a column that doesn't
      // exist yet in the table (e.g. a new metric added before its ALTER TABLE was run) then
      // only breaks that one mode's panel instead of every mode's (PostgREST rejects the
      // whole query if any requested column is missing).
      const metric = leaderboardMetric(mode);
      const order = metric === 'time' ? 'time.asc.nullslast'
        : metric === 'distance' ? 'distance.desc.nullslast' : 'score.desc';
      const extraCol = metric === 'score' ? '' : `,${metric}`;
      // Overfetch and dedupe client-side (PostgREST has no "distinct on" over a REST filter):
      // one player's several attempts could otherwise fill most of the raw top rows, crowding
      // out other players - 5x covers that with a small, fixed-size payload.
      const fetchLimit = limit * 5;
      const url = `${L.supabaseUrl}/rest/v1/${L.table}?select=username,score${extraCol}&mode=eq.${encodeURIComponent(mode)}` +
        `&order=${order}&limit=${fetchLimit}`;
      const res = await fetch(url, {
        headers: { apikey: L.supabaseAnonKey, Authorization: `Bearer ${L.supabaseAnonKey}` },
      });
      if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
      const raw = await res.json();
      const rows = dedupeByUsername(raw).slice(0, limit);
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

// Keeps only each username's best row from a fetchTop() query. Rows arrive already ordered
// best-first, so a username's first occurrence is its top entry - every later one is a worse
// run by the same player and gets dropped.
function dedupeByUsername(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.username)) return false;
    seen.add(r.username);
    return true;
  });
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

// Which field a mode ranks by: Levels by completion time, Infinite and Progression by distance
// covered, everything else by score. Shared by fetchTop() (ordering) and leaderboardValueFn()
// (display).
function leaderboardMetric(mode) {
  if (/^level\d+$/.test(mode || '')) return 'time';
  if (mode === 'infinite' || mode === 'progression') return 'distance';
  return 'score';
}

// valueFn for renderLeaderboardRows() (utils.js): formats a row's value for whichever metric
// its mode ranks by. undefined for score (renderLeaderboardRows already defaults to r.score).
function leaderboardValueFn(mode) {
  const metric = leaderboardMetric(mode);
  if (metric === 'time') return (r) => (typeof r.time === 'number' ? formatTime(r.time) : '--');
  if (metric === 'distance') return (r) => (typeof r.distance === 'number' ? `${r.distance} m` : '--');
  return undefined;
}

// Gate in front of Leaderboard.submitRun() for a run that just finished: a real identity
// submits immediately, same as always. A guest (see Identity.isGuest(), set by the main menu's
// Skip button) is asked first via a small dialog on top of the end-of-run screen - "Yes" reveals
// an inline username field (saving it ends guest status, same as the main menu's "Change
// Username", then submits the pending run for real; Cancel there backs out to the Yes/No
// choice without losing the pending submission), "No" skips just this one run, and "Don't ask
// again" skips every future prompt until the player sets a real username themselves.
class GuestSubmitPrompt {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('guest-submit');
    this.choice = document.getElementById('guest-submit-choice');
    this.form = document.getElementById('guest-submit-form');
    this.input = document.getElementById('guest-submit-input');
    this.error = document.getElementById('guest-submit-error');
    this._pending = null;   // { mode, score, opts, gen } queued while this is open

    if (this.el) {
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.action === 'guest-submit-yes') this._showForm();
        else if (b.dataset.action === 'guest-submit-no') this.close();
        else if (b.dataset.action === 'guest-submit-never') { Identity.dismissGuestPrompt(); this.close(); }
        else if (b.dataset.action === 'guest-submit-cancel') this._showChoice();
      });
    }
    if (this.form) {
      this.form.addEventListener('submit', (e) => { e.preventDefault(); this._save(); });
    }
  }

  get visible() { return !!this.el && !this.el.classList.contains('hidden'); }

  // Called instead of a direct Leaderboard.submitRun() wherever a run just finished (see
  // Game.gameOver()/levelComplete()). opts matches submitRun's own { time } / { distance }; gen
  // is that run's this._runGen, passed straight through to refreshEndLeaderboard() so a later
  // run can't have its own fresh panel clobbered by this one's (possibly much later, for a
  // guest) submission landing.
  maybeSubmit(mode, score, opts, gen) {
    if (!Identity.isGuest()) {
      this.game.leaderboard.submitRun(mode, score, opts).then((ok) => { if (ok) this.game.refreshEndLeaderboard(mode, gen); });
      this.game.eventLog.log('score_upload', mode);
      return;
    }
    if (Identity.guestPromptDismissed()) return;   // player asked never to be asked again
    this._pending = { mode, score, opts, gen };
    if (this.el) this.el.classList.remove('hidden');
    this._showChoice();
  }

  // The Yes/No/Don't-ask-again row - the dialog's opening view, and also where "Cancel" on the
  // username form backs out to (the pending submission is kept either way).
  _showChoice() {
    if (this.choice) this.choice.classList.remove('hidden');
    if (this.form) this.form.classList.add('hidden');
    if (this.error) this.error.classList.add('hidden');
    const first = this.choice && this.choice.querySelector('button');
    if (first) first.focus();
  }

  _showForm() {
    if (this.choice) this.choice.classList.add('hidden');
    if (this.form) this.form.classList.remove('hidden');
    if (this.error) this.error.classList.add('hidden');
    if (this.input) { this.input.value = ''; this.input.focus(); }
  }

  _save() {
    const result = Identity.setUsername(this.input ? this.input.value : '');
    if (!result.ok) {
      if (this.error) { this.error.textContent = result.error; this.error.classList.remove('hidden'); }
      return;
    }
    this.game.eventLog.log('username_set');
    const pending = this._pending;
    this.close();
    if (pending) {
      this.game.leaderboard.submitRun(pending.mode, pending.score, pending.opts)
        .then((ok) => { if (ok) this.game.refreshEndLeaderboard(pending.mode, pending.gen); });
      this.game.eventLog.log('score_upload', pending.mode);
    }
  }

  close() {
    this._pending = null;
    if (this.el) this.el.classList.add('hidden');
  }

  // Escape backs out one level - same as Cancel on the username form, same as "No" on the
  // Yes/No/Don't-ask-again row. Arrow keys move focus among whichever buttons are currently shown.
  handleInput(input) {
    const formVisible = this.form && !this.form.classList.contains('hidden');
    if (input.pressed('Escape')) { formVisible ? this._showChoice() : this.close(); return; }
    const scope = formVisible ? this.form : this.choice;
    if (!scope) return;
    const btns = [...scope.querySelectorAll('button')];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    if (input.pressed('ArrowDown')) btns[(i + 1) % btns.length].focus();
    if (input.pressed('ArrowUp')) btns[(i - 1 + btns.length) % btns.length].focus();
  }
}
