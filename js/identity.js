// Persistent player identity: a chosen username (shown on the leaderboard) and a stable,
// anonymous playerId (ties runs from the same browser together). Both live in localStorage
// via Storage (utils.js) and persist across reloads and browser restarts.
const Identity = {
  USERNAME_KEY: 'packetracer.username',
  PLAYER_ID_KEY: 'packetracer.playerId',

  getUsername() {
    return Storage.get(this.USERNAME_KEY, null);
  },

  // Checks a candidate username without saving it. Returns { ok: true, value } or
  // { ok: false, error }.
  validateUsername(raw) {
    const name = String(raw ?? '').trim();
    const U = CONFIG.username;
    if (name.length < U.minLength) return { ok: false, error: `Username must be at least ${U.minLength} characters.` };
    if (name.length > U.maxLength) return { ok: false, error: `Username must be at most ${U.maxLength} characters.` };
    if (!U.pattern.test(name)) return { ok: false, error: 'Only letters, numbers, underscore and hyphen are allowed.' };
    return { ok: true, value: name };
  },

  // Validates and persists in one step. Invalid usernames are never saved.
  // Returns { ok: true, value } or { ok: false, error }.
  setUsername(raw) {
    const result = this.validateUsername(raw);
    if (!result.ok) return result;
    Storage.set(this.USERNAME_KEY, result.value);
    return result;
  },

  // Created once on first use and reused forever after. If it's ever missing or corrupt
  // (storage half-cleared, manual edit), a fresh one is generated so play is never blocked.
  getPlayerId() {
    const id = Storage.get(this.PLAYER_ID_KEY, null);
    if (typeof id === 'string' && id) return id;
    const fresh = this._generateUuid();
    Storage.set(this.PLAYER_ID_KEY, fresh);
    return fresh;
  },

  _generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for environments without crypto.randomUUID (older browsers, this headless sandbox)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
};
