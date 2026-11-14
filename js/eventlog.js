// Event log service: logs session/gameplay events to Supabase (its own table, event_log),
// completely independent of js/leaderboard.js - neither file references the other. js/game.js
// and js/menu.js each call log() directly at the handful of places an event actually happens;
// nothing here knows about scoring, modes, or menus.
//
// Fixed detail text per event type, per spec - not computed per call.
const EVENT_LOG_DETAILS = {
  connect: 'supabase connected',
  username_set: 'username changed',
  mode_start: 'run started',
  mode_finish: 'run completed',
  score_upload: 'score submitted',
};

class EventLog {
  // event: one of connect / username_set / mode_start / mode_finish / score_upload.
  // mode: the leaderboard mode key ('infinite', 'level2', ...) when the event is tied to one;
  // omit for events that aren't (connect, username_set).
  async log(event, mode = null) {
    const E = CONFIG.eventLog, L = CONFIG.leaderboard;
    if (!E.enabled || !L.supabaseUrl || !L.supabaseAnonKey) return;   // not configured

    const payload = {
      player_id: Identity.getPlayerId(),       // regenerates on its own if missing
      username: Identity.getUsername() || null,   // may legitimately be unset (e.g. connect)
      event_type: event,
      mode,
      details: EVENT_LOG_DETAILS[event] || event,
    };

    try {
      if (typeof fetch !== 'function') return;   // no network in this environment (e.g. headless tests)
      const res = await fetch(`${L.supabaseUrl}/rest/v1/${E.table}`, {
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
      console.error('[eventlog] failed to log event:', event, err);
    }
  }
}
