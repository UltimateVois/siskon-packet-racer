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
    this.usernameForced = true;
    this.page = 'modes';
    this.leaderboardPanel = document.getElementById('menu-leaderboard');
    this.leaderboardTitle = document.getElementById('menu-leaderboard-title');
    this.leaderboardList = document.getElementById('menu-leaderboard-list');
    this._lbRequestMode = null;
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
    });
    // It's a separate floating window (see index.html), so it has to be told where #menu
    // actually ended up - keep it pinned alongside it if the browser window resizes.
    window.addEventListener('resize', () => this._positionLeaderboardWindow());
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  show(page = 'modes') {
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
    this._positionLeaderboardWindow();
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

  _refreshUsernameBanner() {
    if (this.usernameDisplay) this.usernameDisplay.textContent = Identity.getUsername() || '';
  }

  // hasUsername === false means this is the forced first-launch prompt: no way to cancel out
  // of it, since a mode can't be started without a username.
  _openUsernameForm(hasUsername) {
    this.usernameForced = !hasUsername;
    if (this.usernameCancel) this.usernameCancel.classList.toggle('hidden', this.usernameForced);
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
    this.show('modes');
  }

  hide() {
    this.el.classList.add('hidden');
    if (this.leaderboardPanel) this.leaderboardPanel.classList.add('hidden');
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
