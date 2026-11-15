// Persistent player identity: a chosen username (shown on the leaderboard) and a stable,
// anonymous playerId (ties runs from the same browser together). Both live in localStorage
// via Storage (utils.js) and persist across reloads and browser restarts.
const Identity = {
  USERNAME_KEY: 'packetracer.username',
  PLAYER_ID_KEY: 'packetracer.playerId',
  GUEST_KEY: 'packetracer.isGuest',
  GUEST_PROMPT_DISMISSED_KEY: 'packetracer.guestPromptDismissed',

  getUsername() {
    return Storage.get(this.USERNAME_KEY, null);
  },

  // True once the player has skipped the forced username prompt (see skipUsername()) and
  // stays true until they pick a real name via setUsername() - either from the main menu's
  // "Change Username", or from the guest score-submission prompt (see GuestSubmitPrompt).
  isGuest() {
    return Storage.get(this.GUEST_KEY, false);
  },

  // First-launch "Skip" choice: lets the player start without picking a username. Generates a
  // throwaway "GuestNNNN" display name (shown in the menu's username banner) and marks the
  // player as a guest. Guest runs are never silently submitted to the leaderboard - see
  // Leaderboard.submitRun()'s isGuest() guard and GuestSubmitPrompt, which asks first.
  skipUsername() {
    const name = `Guest${Math.floor(1000 + Math.random() * 9000)}`;
    Storage.set(this.USERNAME_KEY, name);
    Storage.set(this.GUEST_KEY, true);
    return name;
  },

  // Whether the player has clicked "Don't ask again" on the guest score-submission prompt.
  // Once true, runs finish without ever prompting again until a real username is set.
  guestPromptDismissed() {
    return Storage.get(this.GUEST_PROMPT_DISMISSED_KEY, false);
  },

  dismissGuestPrompt() {
    Storage.set(this.GUEST_PROMPT_DISMISSED_KEY, true);
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
    Storage.set(this.GUEST_KEY, false);   // picking a real name always ends guest status
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
