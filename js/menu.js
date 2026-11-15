// Start menu: pick a game mode (Infinite / Levels), then a level. Works with mouse and keyboard.
class Menu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('menu');
    this.pages = {
      modes: document.getElementById('menu-modes'),
      levels: document.getElementById('menu-levels'),
      username: document.getElementById('menu-username'),
    };
    this.levelList = document.getElementById('level-list');
    this.usernameDisplay = document.getElementById('menu-username-display');
    this.usernameInput = document.getElementById('username-input');
    this.usernameError = document.getElementById('username-error');
    this.usernameForm = document.getElementById('username-form');
    this.usernameCancel = document.getElementById('username-cancel');
    this.usernameSkip = document.getElementById('username-skip');
    this.usernameForced = true;
    this.page = 'modes';
    // First-visit nudge: a slow pulsing golden outglow on the LEVELS button (now first in the
    // mode list), shown for this whole first visit and never again once a later visit (i.e. a
    // fresh page load) sees the flag already set - cleared early, on this same visit, as soon
    // as the player actually starts level 1 (see Game.startLevel()'s clearLevelsHighlight() call).
    this.levelsButton = this.pages.modes.querySelector('[data-mode="levels"]');
    const seenLevelsHighlight = Storage.get('packetracer.seenLevelsHighlight', false);
    if (!seenLevelsHighlight) {
      Storage.set('packetracer.seenLevelsHighlight', true);
      if (this.levelsButton) this.levelsButton.classList.add('pulse-highlight');
    }
    this.leaderboardPanel = document.getElementById('menu-leaderboard');
    this.leaderboardTitle = document.getElementById('menu-leaderboard-title');
    this.leaderboardList = document.getElementById('menu-leaderboard-list');
    this._lbRequestMode = null;
    this.changelogPanel = document.getElementById('menu-changelog');
    this.changelogBody = document.getElementById('changelog-body');
    this._renderChangelog();
    this.modeTooltip = document.getElementById('menu-mode-tooltip');
    this.modeTooltipText = document.getElementById('menu-mode-tooltip-text');
    const v = document.getElementById('menu-version');
    if (v) v.textContent = `version ${CONFIG.version}`;

    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.mode === 'infinite') this.game.startInfinite();
      else if (b.dataset.mode === 'progression') this.game.startProgression();
      else if (b.dataset.mode === 'hacker') this.game.startHacker();
      else if (b.dataset.mode === 'levels') this.show('levels');
      else if (b.dataset.level !== undefined) this.game.startLevel(+b.dataset.level);
      else if (b.dataset.action === 'back') this.show('modes');
      else if (b.dataset.action === 'change-username') this.show('username');
      else if (b.dataset.action === 'username-cancel' && !this.usernameForced) this.show('modes');
      else if (b.dataset.action === 'username-skip' && this.usernameForced) this._skipUsername();
    });

    if (this.usernameForm) {
      this.usernameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._saveUsername();
      });
    }

    // Top-10 panel: follows whichever mode/level button is currently highlighted, by
    // keyboard focus or mouse hover.
    this.el.addEventListener('focusin', (e) => this._highlightLeaderboardFor(e.target));
    this.el.addEventListener('mouseover', (e) => {
      const b = e.target.closest('button');
      if (b) this._highlightLeaderboardFor(b);
      if (b && b.dataset.desc) this._showModeTooltip(b, e);
    });
    // The mode-description tooltip only follows mouse hover (not keyboard focus) - it hides as
    // soon as the mouse leaves a described button for anything else, including another button.
    this.el.addEventListener('mouseout', (e) => {
      const b = e.target.closest('button');
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('button') : null;
      if (b && b.dataset.desc && to !== b) this._hideModeTooltip();
    });
    // While shown, the tooltip tracks the cursor instead of staying pinned to the button.
    this.el.addEventListener('mousemove', (e) => {
      if (this.modeTooltip && !this.modeTooltip.classList.contains('hidden')) this._positionModeTooltip(e.clientX, e.clientY);
    });
    // Both are separate floating windows (see index.html), so they have to be told where
    // #menu actually ended up - keep them pinned alongside it if the browser window resizes.
    window.addEventListener('resize', () => {
      this._positionLeaderboardWindow();
      this._positionChangelogWindow();
    });
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  show(page = 'modes') {
    this._hideModeTooltip();
    const hasUsername = !!Identity.getUsername();
    if (!hasUsername && page !== 'username') page = 'username';
    this.page = page;
    if (page === 'levels') this._renderLevels();
    else if (page === 'modes') this._refreshUsernameBanner();
    else if (page === 'username') this._openUsernameForm(hasUsername);
    for (const [name, el] of Object.entries(this.pages)) el.classList.toggle('hidden', name !== page);
    this.el.classList.remove('hidden');
    // Always shown, even on the username page - hiding it there used to remove it from the
    // page entirely, which (back when it shared #menu's box) changed the menu's width.
    if (this.leaderboardPanel) this.leaderboardPanel.classList.remove('hidden');
    if (this.changelogPanel) this.changelogPanel.classList.remove('hidden');
    this._positionLeaderboardWindow();
    this._positionChangelogWindow();
    if (page === 'username') {
      this._showLeaderboard(this._lbRequestMode || 'infinite');
      if (this.usernameInput) this.usernameInput.focus();
    } else {
      const first = this._buttons()[0];
      if (first) first.focus();
    }
  }

  // Which leaderboard mode key a button represents, or null if it doesn't have one (BACK,
  // CANCEL, Change Username, a locked level has none either way). LEVELS itself (before a
  // specific level is picked) defaults to Level 1's board.
  _modeKeyForButton(b) {
    if (b.dataset.mode === 'levels') return 'level1';
    if (b.dataset.mode) return b.dataset.mode;
    if (b.dataset.level !== undefined) return `level${+b.dataset.level + 1}`;
    return null;
  }

  _highlightLeaderboardFor(target) {
    if (this.page !== 'modes' && this.page !== 'levels') return;
    const b = target && target.closest ? target.closest('button') : null;
    const mode = b && this._modeKeyForButton(b);
    if (mode) this._showLeaderboard(mode);
  }

  async _showLeaderboard(mode) {
    if (this._lbRequestMode === mode) return;   // already showing/loading this one
    this._lbRequestMode = mode;
    const valueFn = leaderboardValueFn(mode);
    if (this.leaderboardTitle) this.leaderboardTitle.textContent = `TOP ${CONFIG.leaderboard.topCount} - ${leaderboardModeLabel(mode)}`;
    renderLeaderboardRows(this.leaderboardList, null, valueFn);
    const rows = await this.game.leaderboard.fetchTop(mode);
    if (this._lbRequestMode !== mode) return;   // highlight moved on again before this resolved
    renderLeaderboardRows(this.leaderboardList, rows, valueFn);
  }

  clearLevelsHighlight() {
    if (this.levelsButton) this.levelsButton.classList.remove('pulse-highlight');
  }

  _refreshUsernameBanner() {
    if (this.usernameDisplay) this.usernameDisplay.textContent = Identity.getUsername() || '';
  }

  // hasUsername === false means this is the forced first-launch prompt: no way to cancel out
  // of it (but Skip is offered instead - see _skipUsername()), since a mode can't be started
  // without a username.
  _openUsernameForm(hasUsername) {
    this.usernameForced = !hasUsername;
    if (this.usernameCancel) this.usernameCancel.classList.toggle('hidden', this.usernameForced);
    if (this.usernameSkip) this.usernameSkip.classList.toggle('hidden', !this.usernameForced);
    if (this.usernameError) this.usernameError.classList.add('hidden');
    if (this.usernameInput) this.usernameInput.value = hasUsername ? Identity.getUsername() : '';
  }

  _saveUsername() {
    const result = Identity.setUsername(this.usernameInput ? this.usernameInput.value : '');
    if (!result.ok) {
      if (this.usernameError) {
        this.usernameError.textContent = result.error;
        this.usernameError.classList.remove('hidden');
      }
      return;
    }
    this.game.eventLog.log('username_set');
    this.show('modes');
  }

  // Forced first-launch prompt only (see _openUsernameForm): lets the player start playing
  // right away under a throwaway "GuestNNNN" name instead of picking one. Leaderboard
  // submissions for guests are gated behind GuestSubmitPrompt instead of posting silently.
  _skipUsername() {
    Identity.skipUsername();
    this.show('modes');
  }

  hide() {
    this.el.classList.add('hidden');
    if (this.leaderboardPanel) this.leaderboardPanel.classList.add('hidden');
    if (this.changelogPanel) this.changelogPanel.classList.add('hidden');
    this._hideModeTooltip();
  }

  // A mode button's description (see index.html's data-desc) - its own small floating window
  // (like the leaderboard/changelog ones) so the menu's own height never depends on how long
  // any description is. Follows the mouse cursor (see the mousemove listener above) rather
  // than staying pinned to the button.
  _showModeTooltip(b, e) {
    if (!this.modeTooltip || !this.modeTooltipText) return;
    this.modeTooltipText.textContent = b.dataset.desc;
    this.modeTooltip.classList.remove('hidden');
    this._positionModeTooltip(e.clientX, e.clientY);
  }

  _positionModeTooltip(x, y) {
    if (!this.modeTooltip) return;
    this.modeTooltip.style.left = `${x + 18}px`;
    this.modeTooltip.style.top = `${y + 18}px`;
  }

  _hideModeTooltip() {
    if (this.modeTooltip) this.modeTooltip.classList.add('hidden');
  }

  // The leaderboard is its own floating window (index.html), not nested inside #menu, so its
  // size can never affect #menu's - but that means it has to be told where #menu actually is.
  // Pins its top-left just right of #menu's own rendered box.
  _positionLeaderboardWindow() {
    if (!this.leaderboardPanel || !this.el.getBoundingClientRect) return;
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;   // not laid out yet (e.g. this environment has no real DOM)
    this.leaderboardPanel.style.left = `${rect.right + 20}px`;
    this.leaderboardPanel.style.top = `${rect.top}px`;
  }

  // Same idea, mirrored to the left. changelogWidth must match .changelog-window's CSS width -
  // measuring the (possibly still-hidden) element itself isn't reliable, so it's a shared
  // constant. Height is pinned to match #menu's own rendered height exactly (overridden here
  // every time, so it keeps tracking #menu as its content/page changes), with its own
  // overflow-y:auto (css/style.css) scrolling whatever changelog content doesn't fit.
  _positionChangelogWindow() {
    if (!this.changelogPanel || !this.el.getBoundingClientRect) return;
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    const changelogWidth = 280;
    this.changelogPanel.style.left = `${rect.left - changelogWidth - 20}px`;
    this.changelogPanel.style.top = `${rect.top}px`;
    this.changelogPanel.style.height = `${rect.height}px`;
  }

  // Fills the Changelog window from CHANGELOG_VERSIONS (below) - static content, rendered once.
  // Every past version is listed, newest first, so older ones sit further down; the window's
  // own max-height + overflow-y:auto (css/style.css's .changelog-window) makes that scrollable.
  // Built with createElement/textContent, not innerHTML, for the same reason the leaderboard
  // rows are (see utils.js's renderLeaderboardRows) - force of habit here since this text is
  // actually trusted, but it costs nothing and keeps the pattern consistent.
  _renderChangelog() {
    if (!this.changelogBody) return;
    this.changelogBody.innerHTML = '';
    for (const v of CHANGELOG_VERSIONS) {
      const heading = document.createElement('h2');
      heading.className = 'version-heading';
      heading.textContent = v.version;
      this.changelogBody.appendChild(heading);
      for (const group of v.groups) {
        const h3 = document.createElement('h3');
        h3.textContent = group.title;
        this.changelogBody.appendChild(h3);
        const ul = document.createElement('ul');
        for (const item of group.items) {
          const li = document.createElement('li');
          li.textContent = item;
          ul.appendChild(li);
        }
        this.changelogBody.appendChild(ul);
      }
    }
  }

  _renderLevels() {
    const recs = this.game.levelRecords;
    this.levelList.innerHTML = '';
    CONFIG.levels.forEach((lv, i) => {
      const unlocked = this.game.isLevelUnlocked(i);
      const rec = recs[i];
      const b = document.createElement('button');
      b.dataset.level = i;
      b.disabled = !unlocked;
      b.innerHTML = `${lv.name} <span class="len">${lv.length} m</span>` +
        `<small>${!unlocked ? 'LOCKED - beat ' + CONFIG.levels[i - 1].name + ' first'
          : rec != null ? 'Record: ' + formatTime(rec) : 'Not completed yet'}</small>`;
      this.levelList.appendChild(b);
    });
  }

  _buttons() {
    return [...this.pages[this.page].querySelectorAll('button')].filter((b) => !b.disabled && !b.classList.contains('hidden'));
  }

  // Arrow keys move focus, Escape goes back (Enter/Space click the focused button natively)
  handleInput(input) {
    const btns = this._buttons();
    const i = btns.indexOf(document.activeElement);
    if (input.pressed('ArrowDown')) btns[(i + 1) % btns.length].focus();
    if (input.pressed('ArrowUp')) btns[(i - 1 + btns.length) % btns.length].focus();
    if (input.pressed('Enter') && i < 0 && btns[0]) btns[0].click();
    if (input.pressed('Escape') && this.page === 'levels') this.show('modes');
  }
}

function formatTime(sec) { return sec.toFixed(2) + ' s'; }

// Every version's changelog, newest first, shown in the main menu's Changelog window
// (js/menu.js's _renderChangelog()) - older versions sit further down, scrollable via that
// window's own overflow-y:auto. Kept in sync by hand with CHANGELOG.md (condensed to short
// bullets here, same as before) - fetching that file doesn't work when the game is run via a
// plain file:// open, with no server (see CLAUDE.md's golden rule on no build step/no server).
const CHANGELOG_VERSIONS = [
  { version: 'a0.2.6', groups: [
    { title: 'Main menu', items: [
      'Reordered mode buttons and cleaned up the main menu.',
    ] },
    { title: 'Guest mode', items: [
      'SKIP on the first username prompt lets you play right away as a guest.',
      'Finishing a run as a guest asks "Submit score?" before posting anything.',
    ] },
    { title: 'Leaderboard', items: [
      'Top-10 panels and top-run markers now show one entry per player, not per run.',
    ] },
    { title: 'Hacker results', items: [
      'Scoreboard rows renamed: Routers/Switches/Computers, Ethernet Cables, Brutal smashes, ' +
        'Shelf bonuses.',
    ] },
    { title: 'Changed', items: [
      'The Changelog window now scrolls through every past version, oldest at the bottom.',
    ] },
  ] },
  { version: 'a0.2.4', groups: [
    { title: 'World', items: [
      'You now receive floating text when passing top 3 players.',
    ] },
    { title: 'Fixed', items: [
      "The camera's visible distance no longer grows at extreme window sizes or when the browser " +
        'itself is zoomed out.',
    ] },
    { title: 'Event log', items: [
      'Added some minor logging to SQL server for statistics.',
    ] },
    { title: 'Changed', items: [
      'Text selection and the browser right-click menu are disabled (except typing in the ' +
        'username field).',
      'added background demo you are probably seeing right now.',
      'Added changelog. hello world!',
      'Changed UI to look way prettier.',
    ] },
  ] },
  { version: 'a0.2.2', groups: [
    { title: 'Changed', items: [
      'Progression now ranks by distance covered, like Infinite.',
      'The top-10 panel is its own floating window, so it never resizes the menu.',
    ] },
  ] },
  { version: 'a0.2.1', groups: [
    { title: 'Online leaderboard', items: [
      'Persistent username and anonymous player ID, saved across reloads.',
      'Runs from every mode submit automatically once they finish.',
      'Top-10 panels on the main menu and every end-of-run screen.',
    ] },
    { title: 'World', items: [
      'A distance marker every 50 m, and top-10 run markers in Infinite.',
    ] },
    { title: 'Changed', items: [
      "The firewall's distance now reads on the left edge of the screen.",
    ] },
  ] },
  { version: 'a0.2.0', groups: [
    { title: 'Modes', items: [
      'Infinite, Progression, Hacker and Levels 1-3.',
    ] },
    { title: 'World', items: [
      'Bar-chart terrain, breakable network devices, cables, shelves and the firewall.',
    ] },
    { title: 'Power-ups', items: [
      'Speed boost, gravity flip, big tires, Sirkkeli buzzsaw, backup packet.',
    ] },
    { title: 'Scoring', items: [
      'Points for destroyed devices, bonuses and combos.',
    ] },
  ] },
  { version: 'a0.1.0', groups: [
    { title: 'Initial framework', items: [
      'Truck physics, the packet in the bed, bar-chart terrain, static obstacles.',
    ] },
  ] },
];
