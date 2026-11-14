// Game states: 'menu' -> 'ready' -> 'running' -> 'over' | 'complete'   (plus a paused flag)
//   ('shop' = Progression mode's upgrade shop pause)
// Modes: { type: 'infinite' }, { type: 'progression' }, { type: 'hacker' } or { type: 'level', index }
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input();
    this.terrain = new Terrain();
    this.world = new World();
    this.spawner = new Spawner(this.world);
    this.powerups = new PowerUpManager();
    this.coins = new CoinManager();
    this.firewall = new Firewall();
    this.truck = new Truck();
    this.packet = new Packet();
    this.camera = { x: 0, y: 0 };
    // Saved data from an older save version is wiped (records, unlocks)
    if (Storage.get('packetracer.saveVersion', 1) !== CONFIG.saveVersion) {
      Storage.remove('packetracer.best');
      Storage.remove('packetracer.levelTimes');
      Storage.set('packetracer.saveVersion', CONFIG.saveVersion);
    }
    this.best = Storage.get('packetracer.best', 0);
    this.progressBest = Storage.get('packetracer.progressBest', 0);
    this.hackerBest = Storage.get('packetracer.hackerBest', 0);   // best score
    this.levelRecords = Storage.get('packetracer.levelTimes', {});   // { levelIndex: seconds }
    this.mode = { type: 'infinite' };
    this.debug = false;
    this.paused = false;

    this.hud = {
      speed: document.getElementById('hud-speed'),
      distance: document.getElementById('hud-distance'),
      best: document.getElementById('hud-best'),
      score: document.getElementById('hud-score'),
      scoreStat: document.getElementById('stat-score'),
      bestLabel: document.getElementById('hud-best-label'),
      bestUnit: document.getElementById('hud-best-unit'),
      time: document.getElementById('hud-time'),
      timeStat: document.getElementById('stat-time'),
      timeLabel: document.getElementById('hud-time-label'),
      btc: document.getElementById('hud-btc'),
      btcStat: document.getElementById('stat-btc'),
      fuel: document.getElementById('fuel'),
      fuelFill: document.getElementById('fuel-fill'),
      firewall: document.getElementById('hud-firewall'),
      firewallStat: document.getElementById('stat-firewall'),
      msg: document.getElementById('message'),
      msgTitle: document.getElementById('message-title'),
      msgSub: document.getElementById('message-sub'),
      fx: {},
    };
    for (const k of ['boost', 'gravDouble', 'gravHalf', 'bigTires', 'sirkkeli', 'backup', 'upgrades', 'backupUsed', 'timeout']) {
      const el = document.getElementById(`fx-${k}`);
      this.hud.fx[k] = { el, value: el.querySelector('span') };
    }

    this.menu = new Menu(this);
    this.world.onBreak = (p) => this.onDeviceDestroyed(p);
    this.world.onCableSnap = (x, y) => {
      if (this.state !== 'running' || this.effects.sirkkeli > 0) return;   // the saw cuts everything: no bonus
      this.addScore(CONFIG.scoring.snagPoints, `SNAGGING BONUS! +${CONFIG.scoring.snagPoints}`, x, y - 10, '#f1c40f');
      this._log('snag', CONFIG.scoring.snagPoints);
    };
    this.shop = new Shop(this);
    this.leaderboard = new Leaderboard();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.reset();
    this.openMenu();
  }

  // ---------- Modes & menu ----------
  get level() { return this.mode.type === 'level' ? CONFIG.levels[this.mode.index] : null; }

  isLevelUnlocked(i) { return i === 0 || this.levelRecords[i - 1] != null; }

  startInfinite() {
    this.mode = { type: 'infinite' };
    this.menu.hide();
    this.reset();
  }

  startProgression() {
    this.mode = { type: 'progression' };
    this.menu.hide();
    this.reset();
  }

  get isProgression() { return this.mode.type === 'progression'; }

  get isHacker() { return this.mode.type === 'hacker'; }

  startHacker() {
    this.mode = { type: 'hacker' };
    this.menu.hide();
    this.reset();
  }

  openShop() {
    this.state = 'shop';
    this.shop.open();
  }

  resumeFromShop() {
    this.state = 'running';
    this.accumulator = 0;
  }

  startLevel(i) {
    if (!this.isLevelUnlocked(i)) return;
    this.mode = { type: 'level', index: i };
    this.menu.hide();
    this.reset();
  }

  openMenu(page = 'modes') {
    this.state = 'menu';
    this.paused = false;
    this.hideMessage();
    this.hideResults();
    this.shop.hide();
    this.menu.show(page);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * dpr);
    this.canvas.height = Math.floor(this.viewH * dpr);
    this.zoom = clamp(this.viewH / CONFIG.camera.referenceHeight, 0.5, 1.5);
  }

  get view() {
    return { x: this.camera.x, y: this.camera.y, w: this.viewW / this.zoom, h: this.viewH / this.zoom };
  }

  reset() {
    const lv = this.level;
    const rules = lv || CONFIG.infinite;
    const startX = 200;
    this.finishX = lv ? startX + lv.length * CONFIG.world.pxPerMeter : Infinity;
    this.terrain.reset(rules.difficultyBase);
    this.world.reset();
    this.spawner.reset(rules, this.finishX - 150);
    this.powerups.reset();
    this.effects = { boost: 0, gravDouble: 0, gravHalf: 0, bigTires: 0, sirkkeli: 0 };
    this.popups = [];
    this.score = 0;          // true score
    this.scoreBanked = 0;    // points whose popup has reached the meter
    this.scoreShown = 0;     // what the meter shows (counts up to scoreBanked)
    this.scoreFly = [];      // points popups on their way to the meter
    this.combo = 1;
    this.comboTimer = Infinity;
    this.maxCombo = 1;
    this.timeBonuses = 0;
    // Breakdown for the results window: { key: { n, pts } }
    this.scoreLog = {};
    this.hackerTime = CONFIG.hacker.startTime;
    this.nextTimeBonusX = startX + CONFIG.hacker.bonusEvery * CONFIG.world.pxPerMeter;
    this.destroyedCount = 0;
    this.sysadminFound = false;
    this.truck.sawActive = false;
    this.stuckTimer = 0;
    this.runTime = 0;
    this.backups = 0;              // spare packets glued to the truck
    this.backupFlash = 0;
    this.jetFuelMax = CONFIG.jetpack.fuel;   // Jetpack Fuel upgrade raises this
    this.jetRefillMult = 1;                  // Jetpack Recharge upgrade raises this
    this.fuel = this.jetFuelMax;             // jetpack starts full
    this.btc = 0;
    if (this.coins) this.coins.reset();
    this.upgradeLevels = {};
    this.nextUpgradeX = startX + CONFIG.progression.every * CONFIG.world.pxPerMeter;
    if (this.shop) this.shop.hide();
    this.hideResults();
    this.droppedPackets = [];      // lost packets left lying around
    this.nextBackupX = startX + CONFIG.backup.every * CONFIG.world.pxPerMeter;
    this.startX = startX;
    this.truck.reset(startX, this.terrain.heightAt(startX) - 40);
    this.packet.reset(this.truck);
    this.firewall.reset(startX);
    this.terrain.ensure(startX + 3000);
    this._spawnOnNewBars();
    this.accumulator = 0;
    this.distance = 0;
    this.state = 'ready';
    this.paused = false;
    this._snapCamera();
    if (lv) {
      const rec = this.levelRecords[this.mode.index];
      this.showMessage(lv.name.toUpperCase(), `Deliver the packet ${lv.length} m to its destination.\n` +
        (rec != null ? `Record: ${formatTime(rec)}\n` : '') + '\nHold SPACE to start');
    } else if (this.isHacker) {
      const H = CONFIG.hacker;
      this.showMessage('HACKER', `No packet - smash routers, switches and computers for points.\n` +
        `${H.startTime} s on the clock, +${H.timeBonus} s every ${H.bonusEvery} m.\n` +
        (this.hackerBest ? `Best: ${this.hackerBest} pts\n` : '') + '\nHold SPACE to start');
    } else if (this.isProgression) {
      this.showMessage('PROGRESSION', `Collect ₿ and spend it in the shop every ${CONFIG.progression.every} m.\n` +
        (this.progressBest ? `Best: ${this.progressBest} m\n` : '') + '\nHold SPACE to start');
    } else {
      this.showMessage('INFINITE', 'Hold SPACE to accelerate.\nDeliver the packet - don\'t drop it!');
    }
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.handleInput();
    if (!this.paused && this.state !== 'shop') this.update(dt);
    if (!this.paused) this._tickScore(dt);
    this.render();
    this.updateHud();
    this.input.endFrame();

    requestAnimationFrame((t) => this.frame(t));
  }

  handleInput() {
    const inp = this.input;
    if (inp.pressed('KeyD')) this.debug = !this.debug;
    if (this.state === 'menu') { this.menu.handleInput(inp); return; }
    if (this.state === 'shop') {
      if (inp.pressed('Escape')) { this.openMenu(); return; }
      this.shop.handleInput(inp);
      return;
    }
    if (inp.pressed('Escape')) { this.openMenu(this.level ? 'levels' : 'modes'); return; }
    if (inp.pressed('KeyR')) { this.reset(); return; }

    if (this.state === 'ready' && (inp.pressed('Space') || inp.pressed('ArrowUp'))) {
      this.state = 'running';
      this.hideMessage();
    } else if (this.state === 'running' && inp.pressed('KeyP')) {
      this.paused = !this.paused;
      this.paused ? this.showMessage('PAUSED', 'Press P to continue') : this.hideMessage();
    } else if (this.state === 'over' && inp.pressed('Enter')) {
      this.reset();
    } else if (this.state === 'complete' && inp.pressed('Enter')) {
      const next = this.mode.index + 1;
      if (next < CONFIG.levels.length) this.startLevel(next); else this.openMenu('levels');
    }
  }

  update(dt) {
    const step = CONFIG.physics.dt;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < CONFIG.physics.maxStepsPerFrame && this.state !== 'shop') {
      this.fixedStep(step);
      this.accumulator -= step;
      steps++;
    }
    if (steps === CONFIG.physics.maxStepsPerFrame) this.accumulator = 0;

    this.world.updateEffects(dt, this.terrain, CONFIG.physics.gravity * this.gravityScale);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < p.life);

    // World streaming
    const v = this.view;
    this.terrain.ensure(v.x + v.w + 3000);  // far enough that clusters settle off-screen
    this._spawnOnNewBars();
    this.terrain.prune(v.x - 800);
    this.world.prune(v.x - 800);
    this.droppedPackets = this.droppedPackets.filter((p) => p.x > v.x - 800);
    this.powerups.prune(v.x - 800);
    this.coins.prune(v.x - 800);

    this._updateCamera(dt);
  }

  _spawnOnNewBars() {
    const bars = this.terrain.newBars;
    this.powerups.spawnOnBars(bars, this.isProgression ? CONFIG.powerups.notInProgression : []);
    // Backup-packet pickups every N metres (once the terrain there exists)
    const B = CONFIG.backup;
    // (not in Progression: there Extra Life is an upgrade instead)
    while (!this.isProgression && !this.isHacker && this.terrain.genX > this.nextBackupX + 50 && this.nextBackupX < this.finishX + 1) {
      const x = this.nextBackupX;
      this.powerups.addAt('backup', x, this.terrain.heightAt(x) - B.floatHeight);
      this.nextBackupX += B.every * CONFIG.world.pxPerMeter;
    }
    this.spawner.update(this.terrain);
    if (this.isProgression) {
      this.coins.spawnOnGround(bars);
      this.coins.spawnOnShelves(this.world.shelves);
    }
    bars.length = 0;
  }

  get gravityScale() {
    const G = CONFIG.powerups.gravityScale;
    if (this.effects.gravDouble > 0) return G.gravDouble;
    if (this.effects.gravHalf > 0) return G.gravHalf;
    return 1;
  }

  // ---------- Scoring ----------
  // A router / computer / switch broke (World calls this)
  onDeviceDestroyed(p) {
    if (this.state !== 'running') return;
    const S = CONFIG.scoring;
    this.combo = this.comboTimer < S.comboWindow ? this.combo + S.comboStep : 1;
    this.comboTimer = 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const pts = Math.round(S.destroyPoints * this.combo);
    this.addScore(pts, `+${pts}`, p.x, p.y - 12, '#ffe66d');
    this._log(p.kind, S.destroyPoints);
    this._log('combo', pts - S.destroyPoints, false);
    if (this.world.isOnShelf(p)) {
      const sb = Math.round(S.shelfBonus * this.combo);
      this.addScore(sb, `SHELF BONUS! +${sb}`, p.x, p.y - 24, '#a1887f');
      this._log('shelf', S.shelfBonus);
      this._log('combo', sb - S.shelfBonus, false);
    }
    const brutal = this.truck.speed > S.brutalSpeed && Math.hypot(p.x - this.truck.x, p.y - this.truck.y) < S.brutalDistance;
    if (brutal) {
      const b = Math.round(S.brutalBonus * this.combo);
      this.addScore(b, `BRUTAL SMASH! +${b}`, p.x, p.y - 40, '#ff4757');
      this._log('brutal', S.brutalBonus);
      this._log('combo', b - S.brutalBonus, false);
      this.world.sparks.burst(p.x, p.y, S.brutalSparks, 150, 520);
    }
    if (this.combo > 1) this.addPopup(`COMBO ×${this.combo.toFixed(1)}`, p.x, p.y - 56, '#38e8ff');
    this.destroyedCount++;
    const H = CONFIG.hacker;
    if (this.isHacker && this.destroyedCount % H.angerEvery === 0) {
      this.firewall.speedMult *= H.angerSpeedup;
      this.addPopup('SYSADMIN IS REALLY MAD!', this.truck.x, this.truck.y - 95, '#ff4757', true);
    }
  }

  // Record points for the results breakdown (count = false: add points without counting an event)
  _log(key, pts, count = true) {
    const e = this.scoreLog[key] || (this.scoreLog[key] = { n: 0, pts: 0 });
    if (count) e.n++;
    e.pts += pts;
  }

  addScore(value, text, x, y, color) {
    this.score += value;
    this.scoreFly.push({ value, text, x, y, color, t: 0 });
  }

  // Per frame: move points popups to the meter, count the meter up
  _tickScore(dt) {
    const S = CONFIG.scoring;
    for (const f of this.scoreFly) {
      f.t += dt;
      if (f.t >= S.floatTime + S.flyTime && !f.done) {
        f.done = true;
        this.scoreBanked += f.value;
        this._pulseScore();
      }
    }
    this.scoreFly = this.scoreFly.filter((f) => !f.done);
    if (this.scoreShown < this.scoreBanked) {
      const step = Math.max(1, Math.ceil((this.scoreBanked - this.scoreShown) * S.tickRate * dt));
      this.scoreShown = Math.min(this.scoreBanked, this.scoreShown + step);
    }
  }

  _pulseScore() {
    const el = this.hud.scoreStat;
    el.classList.add('pulse');
    clearTimeout(this._pulseTimer);
    this._pulseTimer = setTimeout(() => el.classList.remove('pulse'), 140);
  }

  // Screen position of the score meter (where points popups fly to)
  _scoreTarget() {
    const el = this.hud.score;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: 60, y: 24 };
  }

  // Points popups, in screen space: float up at the smash, then fly into the meter
  _drawScoreFly(ctx) {
    if (!this.scoreFly.length) return;
    const S = CONFIG.scoring, target = this._scoreTarget();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    for (const f of this.scoreFly) {
      // where it floats in the world, converted to screen coordinates
      const rise = 26 * Math.min(1, f.t / S.floatTime);
      const sx = (f.x - this.camera.x) * this.zoom, sy = (f.y - rise - this.camera.y) * this.zoom;
      let x = sx, y = sy, size = 15;
      if (f.t > S.floatTime) {
        const k = Math.min(1, (f.t - S.floatTime) / S.flyTime), e = k * k;   // ease in
        x = lerp(sx, target.x, e); y = lerp(sy, target.y, e);
        size = lerp(15, 10, e);
      }
      ctx.font = `bold ${size.toFixed(1)}px monospace`;
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.restore();
  }

  // Floating text that rises and fades (e.g. the name of a power-up you just picked up)
  addPopup(text, x, y, color, big = false) {
    // stack above any popup that is still close by, so they don't overlap
    const near = this.popups.filter((p) => Math.abs(p.x - x) < 90 && p.t < 0.6).length;
    this.popups.push({ text, x, y: y - near * 16, color, t: 0, big, life: CONFIG.popups.life * (big ? 1.8 : 1) });
  }

  _drawPopups(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    for (const p of this.popups) {
      ctx.font = `bold ${p.big ? 20 : 14}px monospace`;
      const k = p.t / p.life;
      const y = p.y - 18 - CONFIG.popups.rise * (1 - Math.pow(1 - k, 2));   // eases out as it rises
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const scale = k < 0.12 ? 0.7 + k / 0.12 * 0.3 : 1;                   // quick pop-in
      ctx.save();
      ctx.translate(p.x, y);
      ctx.scale(scale, scale);
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  applyPowerUp(type) {
    if (type === 'backup') { this.backups = Math.min(CONFIG.backup.max, this.backups + 1); return; }
    // Double and half gravity cancel each other out
    if (type === 'gravDouble') this.effects.gravHalf = 0;
    if (type === 'gravHalf') this.effects.gravDouble = 0;
    this.effects[type] = CONFIG.powerups.duration[type];
  }

  fixedStep(dt) {
    const running = this.state === 'running';
    const inp = this.input;
    const controls = {
      gas: running && (inp.isDown('Space') || inp.isDown('ArrowUp')),
      reverse: running && (inp.isDown('ControlLeft') || inp.isDown('ControlRight') || inp.isDown('ArrowDown')),
      jet: false,
      tilt: running ? (inp.isDown('ArrowRight') ? 1 : 0) - (inp.isDown('ArrowLeft') ? 1 : 0) : 0,
    };
    // Jetpack fuel: burns while Shift is held, refills (empty -> full in refillTime) otherwise
    const J = CONFIG.jetpack;
    const wantsJet = running && (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight'));
    if (wantsJet && this.fuel > 0) {
      controls.jet = true;
      this.fuel = Math.max(0, this.fuel - dt);
    } else if (!wantsJet) {
      // base rate fills the base tank in refillTime; Recharge upgrades speed it up
      this.fuel = Math.min(this.jetFuelMax, this.fuel + dt * (J.fuel / J.refillTime) * this.jetRefillMult);
    }
    const env = { gravity: CONFIG.physics.gravity * this.gravityScale, boost: this.effects.boost > 0 };

    this.truck.sawActive = this.effects.sirkkeli > 0;
    this.truck.beginStep(dt, controls, env);
    this.truck.terrainForces(this.terrain);
    this.world.step(dt, this.truck, this.terrain, env.gravity);   // props, shelves, cables
    this.truck.finishStep(dt, this.terrain, this.world);
    if (!this.isHacker) this.packet.step(dt, this.truck, this.terrain, this.world, env.gravity);
    for (const p of this.droppedPackets) p.step(dt, this.truck, this.terrain, this.world, env.gravity);
    if (this.backupFlash > 0) this.backupFlash -= dt;
    this.firewall.update(dt, this.truck.x, running);

    for (const k in this.effects) this.effects[k] = Math.max(0, this.effects[k] - dt);
    // Big Tires power-up (other modes; in Progression tyre size comes from upgrades)
    if (!this.isProgression) {
      const r = CONFIG.truck.wheelRadius * (this.effects.bigTires > 0 ? CONFIG.powerups.bigTiresScale : 1);
      if (Math.abs(this.truck.wheelRadius - r) > 1e-6) this.truck.setWheelRadius(r);
    }
    if (!running) return;

    const canCollect = (type) => type !== 'backup' || this.backups < CONFIG.backup.max;
    for (const got of this.powerups.update(dt, this.truck, canCollect)) {
      this.applyPowerUp(got.type);
      const s = POWERUP_STYLES[got.type];
      this.addPopup(s.name || got.type, got.x, got.y, s.color);
    }

    this.runTime += dt;
    this.comboTimer += dt;
    this.distance = Math.max(this.distance, (this.truck.x - this.startX) / CONFIG.world.pxPerMeter);

    // Progression: collect BTC; every N metres the shop opens
    if (this.isProgression) {
      this.btc += this.coins.update(dt, this.truck);
      if (this.truck.x >= this.nextUpgradeX) {
        this.nextUpgradeX += CONFIG.progression.every * CONFIG.world.pxPerMeter;
        this.openShop();
        return;
      }
    }

    // Level finish: the packet itself has to arrive
    if (this.level && this.packet.x >= this.finishX && !this.packet.lost) { this.levelComplete(); return; }

    const R = CONFIG.rules;
    this.stuckTimer = this.truck.speed < R.stuckSpeed ? this.stuckTimer + dt : 0;

    if (this.isHacker) { this._hackerStep(dt); return; }

    if (this.firewall.touches(this.packet)) this.gameOver('BLOCKED BY FIREWALL', 'The firewall caught your packet.');
    else if (this.packet.lost && this.backups > 0) this.activateBackup();
    else if (this.packet.lost) this.gameOver('PACKET LOST', 'The packet fell off the truck.');
    else if (this.truck.crashed && CONFIG.rules.crashEnabled) this.gameOver('CRASHED', 'Your truck flipped over.');
    else if (this.stuckTimer > R.stuckTime) this.gameOver('TIMEOUT', 'You got stuck - the connection timed out.');
  }

  // Hacker mode: the clock, time bonuses, and how a run ends (no packet, so no packet loss)
  _hackerStep(dt) {
    const H = CONFIG.hacker;
    this.hackerTime = Math.max(0, this.hackerTime - dt);
    if (this.truck.x >= this.nextTimeBonusX) {
      this.nextTimeBonusX += H.bonusEvery * CONFIG.world.pxPerMeter;
      this.hackerTime += H.timeBonus;
      this.timeBonuses++;
      this.addPopup(`+${H.timeBonus} s`, this.truck.x, this.truck.y - 70, '#2ed573', true);
    }
    // Clock runs out: no instant loss - the sysadmin finds you and the firewall speeds up.
    // (A later time bonus starts the clock again; running out again doubles it again.)
    if (this.hackerTime <= 0 && !this.sysadminFound) {
      this.sysadminFound = true;
      this.firewall.speedMult *= H.foundSpeedup;
      this.addPopup('SYSADMIN FOUND YOU!', this.truck.x, this.truck.y - 110, '#ff4757', true);
    } else if (this.hackerTime > 0) {
      this.sysadminFound = false;
    }
    if (this.firewall.touchesTruck(this.truck)) {
      this.gameOver('BLOCKED BY FIREWALL', this.sysadminFound ? 'The sysadmin found you - the firewall caught you.' : 'The firewall caught you.');
    } else if (this.truck.crashed && CONFIG.rules.crashEnabled) this.gameOver('CRASHED', 'Your truck flipped over.');
  }

  // Extra life: the spare packet glued to the truck moves into the bed and takes over
  activateBackup() {
    this.backups--;
    this.droppedPackets.push(this.packet);
    this.packet = new Packet();
    this.packet.reset(this.truck);
    // the spare was waiting right behind the cab: it becomes the real packet there
    const l = Packet.backupLocal(), w = this.truck.localToWorld(l.x, l.y);
    this.packet.x = w.x; this.packet.y = w.y;
    const v = this.truck.pointVelocity(w.x, w.y);
    this.packet.vx = v.x; this.packet.vy = v.y;
    this.packet.flash = CONFIG.backup.flashTime;
    this.backupFlash = CONFIG.backup.flashTime;
  }

  // The leaderboard mode key for the current run: 'infinite' / 'progression' / 'hacker' /
  // 'level1', 'level2', ... Used only when a run finishes - see gameOver() and levelComplete().
  _leaderboardMode() {
    return this.mode.type === 'level' ? `level${this.mode.index + 1}` : this.mode.type;
  }

  gameOver(title, reason) {
    this.state = 'over';
    this.leaderboard.submitRun(this._leaderboardMode(), this.score);
    const d = Math.floor(this.distance);
    const lv = this.level;
    let sub;
    if (lv) {
      sub = `${reason}\nReached ${Math.min(d, lv.length)} / ${lv.length} m`;
    } else if (this.isHacker) {
      const newBest = this.score > this.hackerBest;
      if (newBest) {
        this.hackerBest = this.score;
        Storage.set('packetracer.hackerBest', this.score);
      }
      this.showResults(title, reason, newBest);
      return;
    } else if (this.isProgression) {
      sub = `${reason}\nDistance: ${d} m`;
      if (d > this.progressBest) {
        this.progressBest = d;
        Storage.set('packetracer.progressBest', d);
        sub += '  (new best!)';
      }
    } else {
      sub = `${reason}\nDistance: ${d} m`;
      if (d > this.best) {
        this.best = d;
        Storage.set('packetracer.best', d);
        sub += '  (new best!)';
      }
    }
    this.showMessage(title, sub + `\nScore: ${this.score}` + '\n\nENTER retry · ESC menu', true);
  }

  // Hacker mode results: every kind of points collected, as a list
  showResults(title, reason, newBest) {
    const L = this.scoreLog, rows = [];
    const row = (label, key) => { const e = L[key]; if (e && e.n) rows.push([label, `×${e.n}`, e.pts]); };
    row('Routers destroyed', 'router');
    row('Switches destroyed', 'hub');
    row('Computers destroyed', 'computer');
    row('BRUTAL SMASH!', 'brutal');
    row('SHELF BONUS!', 'shelf');
    row('SNAGGING BONUS!', 'snag');
    if (L.combo && L.combo.pts) rows.push([`Combo bonus (best ×${this.maxCombo.toFixed(1)})`, '', L.combo.pts]);
    const el = document.getElementById('results');
    document.getElementById('results-title').textContent = title;
    document.getElementById('results-reason').textContent = reason;
    const body = rows.length
      ? rows.map(([a, n, p]) => `<tr><td>${a}</td><td class="n">${n}</td><td class="pts">+${p}</td></tr>`).join('')
      : '<tr><td colspan="3" class="none">No points this time - go smash some network gear!</td></tr>';
    document.getElementById('results-table').innerHTML = body +
      `<tr class="total"><td>TOTAL</td><td></td><td class="pts">${this.score}</td></tr>`;
    document.getElementById('results-stats').textContent =
      `Distance ${Math.floor(this.distance)} m · ${this.destroyedCount} devices destroyed · ${this.timeBonuses} time bonus${this.timeBonuses === 1 ? '' : 'es'}`;
    const best = document.getElementById('results-best');
    best.textContent = newBest ? 'NEW BEST SCORE!' : `Best: ${this.hackerBest} pts`;
    best.classList.toggle('new', newBest);
    this.hideMessage();
    el.classList.remove('hidden');
  }

  hideResults() { const el = document.getElementById('results'); if (el) el.classList.add('hidden'); }

  levelComplete() {
    this.state = 'complete';
    this.leaderboard.submitRun(this._leaderboardMode(), this.score);
    const i = this.mode.index, lv = this.level, t = this.runTime;
    const prev = this.levelRecords[i];
    let sub = `Time: ${formatTime(t)}  ·  Score: ${this.score}`;
    if (prev == null || t < prev) {
      this.levelRecords[i] = t;
      Storage.set('packetracer.levelTimes', this.levelRecords);
      if (prev != null) sub += '  (new record!)';
    } else {
      sub += `\nRecord: ${formatTime(prev)}`;
    }
    const next = CONFIG.levels[i + 1];
    sub += next
      ? `\n\n${prev == null ? next.name + ' unlocked!\n' : ''}ENTER next level · R retry · ESC menu`
      : '\n\nAll levels complete!\nENTER level select · R retry';
    this.showMessage(`${lv.name.toUpperCase()} COMPLETE`, sub);
  }

  _cameraTarget() {
    const C = CONFIG.camera, v = this.view;
    return {
      x: this.truck.x - v.w * C.leadX + this.truck.vx * C.lookAhead,
      y: this.truck.y - v.h * C.leadY,
    };
  }

  _snapCamera() {
    const t = this._cameraTarget();
    this.camera.x = t.x; this.camera.y = t.y;
  }

  _updateCamera(dt) {
    const t = this._cameraTarget();
    const k = 1 - Math.exp(-CONFIG.camera.smoothing * dt);
    this.camera.x = lerp(this.camera.x, t.x, k);
    this.camera.y = lerp(this.camera.y, t.y, k);
  }

  // ---------- Rendering ----------
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
    const v = this.view;
    this.terrain.draw(ctx, v);
    this.drawFinish(ctx, v);
    if (this.isProgression) this.drawShopLine(ctx, v);
    this.world.draw(ctx, v);
    this.powerups.draw(ctx, v);
    this.coins.draw(ctx, v);
    this.truck.draw(ctx, this.debug, this.effects.boost > 0);
    for (const p of this.droppedPackets) p.draw(ctx);
    if (!this.isHacker) {
      if (this.backups > 0) Packet.drawBackup(ctx, this.truck, this.backups);   // under the real packet
      this.packet.draw(ctx);
    }
    this.drawEffectIcons(ctx);
    this._drawHackerTimer(ctx);
    this._drawTruckFuel(ctx);
    this._drawPopups(ctx);
    this.firewall.draw(ctx, v);
    ctx.restore();

    this._drawScoreFly(ctx);
    if (this.debug) this.drawDebug(ctx);
  }

  // Background colour + grid colour for the current distance (blended between stages)
  _backgroundColors() {
    const B = CONFIG.backgrounds, st = B.stages, d = this.distance;
    let i = 0;
    while (i + 1 < st.length && d >= st[i + 1].at) i++;
    const cur = st[i], prev = st[Math.max(0, i - 1)];
    const t = i === 0 ? 1 : clamp((d - cur.at) / B.blend, 0, 1);
    const a = hexToRgb(prev.color), b = hexToRgb(cur.color);
    const bg = a.map((v, k) => Math.round(lerp(v, b[k], t)));
    const grid = prev.grid.map((v, k) => lerp(v, cur.grid[k], t));
    return { bg: `rgb(${bg.join(',')})`, grid: `rgba(${grid.slice(0, 3).map(Math.round).join(',')},${grid[3].toFixed(3)})` };
  }

  drawBackground(ctx) {
    const w = this.viewW, h = this.viewH;
    const colors = this._backgroundColors();
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    // Parallax monitoring-chart grid
    const spacing = 60;
    const ox = -((this.camera.x * 0.3 * this.zoom) % spacing);
    const oy = -((this.camera.y * 0.3 * this.zoom) % spacing);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y < h; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // Small jetpack fuel bar under the truck; only shown while the tank isn't full (fades out when full)
  _drawTruckFuel(ctx) {
    const frac = clamp(this.fuel / this.jetFuelMax, 0, 1);
    const target = frac < 0.999 ? 1 : 0;
    this.fuelBarAlpha = lerp(this.fuelBarAlpha ?? 0, target, 0.12);   // smooth fade in/out
    if (this.fuelBarAlpha < 0.02) return;
    const T = CONFIG.truck, J = CONFIG.jetpack;
    const w = 50, h = 5, x = this.truck.x - w / 2;
    const y = this.truck.y + T.wheels[0].y + T.suspension.travel + this.truck.wheelRadius + 8;
    ctx.save();
    ctx.globalAlpha = this.fuelBarAlpha * 0.9;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const low = frac < J.lowFuel;
    ctx.fillStyle = this.truck.jetting ? '#ffe66d' : low ? '#ff5d6c' : '#ffa502';
    ctx.fillRect(x, y, w * frac, h);
    ctx.strokeStyle = low ? 'rgba(255, 93, 108, 0.8)' : 'rgba(255, 165, 2, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    ctx.restore();
  }

  // Height of the power-up icon row above the truck
  _iconRowY() { return this.truck.y - CONFIG.truck.height - 34 - (this.truck.wheelRadius - CONFIG.truck.wheelRadius); }

  // Hacker mode countdown, floating above the truck (above any power-up icons)
  _drawHackerTimer(ctx) {
    if (!this.isHacker || this.state === 'menu') return;
    const icons = Object.keys(this.effects).some((k) => this.effects[k] > 0 && POWERUP_STYLES[k]);
    const t = Math.max(0, this.hackerTime);
    const y = this._iconRowY() - (icons ? 38 : 6), x = this.truck.x;
    const low = t < 10 || this.sysadminFound;
    const text = this.sysadminFound ? '⚠ FOUND!' : `⏱ ${t.toFixed(1)}`;
    ctx.save();
    const clock = this.sysadminFound ? performance.now() / 1000 : t;   // keep blinking once the clock is frozen at 0
    ctx.globalAlpha = (low && this.state === 'running' && Math.floor(clock * 4) % 2 === 0) ? 0.55 : 0.9;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // no frame: just the text, with a dark outline so it stays readable
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.strokeText(text, x, y + 1);
    ctx.fillStyle = low ? '#ff4757' : '#e8f0ff';
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  // Active power-ups floating above the truck: icon + draining ring + seconds left
  drawEffectIcons(ctx) {
    const active = Object.keys(this.effects).filter((k) => this.effects[k] > 0 && POWERUP_STYLES[k]);
    if (!active.length) return;
    const r = 11, gap = 30;
    const y = this._iconRowY();
    const x0 = this.truck.x - (active.length - 1) * gap / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    active.forEach((k, i) => {
      const s = POWERUP_STYLES[k], x = x0 + i * gap, left = this.effects[k];
      const frac = clamp(left / CONFIG.powerups.duration[k], 0, 1);
      const blink = left < 2 && Math.floor(left * 6) % 2 === 0;   // blinks in the last 2 s
      ctx.globalAlpha = (blink ? 0.45 : 1) * 0.85;   // 15% see-through
      ctx.fillStyle = 'rgba(11, 16, 32, 0.8)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = s.color;                                   // remaining time
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
      if (s.saw) {
        drawSawBlade(ctx, x, y, r * 0.7, performance.now() / 60, s.color);
      } else {
        ctx.fillStyle = s.color;
        ctx.font = `bold ${s.label.length > 1 ? 8 : 13}px monospace`;
        ctx.fillText(s.label, x, y + 1);
      }
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#e8f0ff';
      ctx.fillText(left.toFixed(1), x, y + r + 9);
    });
    ctx.restore();
  }

  // Progression: crossing this line opens the shop
  drawShopLine(ctx, v) {
    const x = this.nextUpgradeX;
    if (x < v.x - 60 || x > v.x + v.w + 60) return;
    const g = this.terrain.heightAt(x);
    const t = performance.now() / 1000;
    ctx.save();
    ctx.strokeStyle = '#f7931a';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#f7931a';
    ctx.shadowBlur = 10;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -t * 30;   // marching dashes
    ctx.beginPath(); ctx.moveTo(x, v.y - 20); ctx.lineTo(x, g); ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // banner
    const by = g - 150;
    ctx.fillStyle = 'rgba(11, 16, 32, 0.85)';
    ctx.fillRect(x - 38, by - 14, 76, 24);
    ctx.strokeStyle = '#f7931a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 38, by - 14, 76, 24);
    ctx.fillStyle = '#f7931a';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₿ SHOP', x, by - 2);
    ctx.restore();
  }

  // Destination flag at the end of a level
  drawFinish(ctx, v) {
    const x = this.finishX;
    if (!isFinite(x) || x < v.x - 100 || x > v.x + v.w + 100) return;
    const g = this.terrain.heightAt(x), top = g - 170;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(x, v.y); ctx.lineTo(x, g); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#dfe6f0';
    ctx.fillRect(x - 3, top, 6, g - top);
    const cs = 10;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(x + 3 + c * cs, top + r * cs, cs, cs);
      }
    }
    ctx.fillStyle = '#38e8ff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('DESTINATION', x - 3, top - 8);
  }

  drawDebug(ctx) {
    const t = this.truck, p = this.packet;
    const lines = [
      `pos ${t.x.toFixed(0)}, ${t.y.toFixed(0)}  vel ${t.vx.toFixed(0)}, ${t.vy.toFixed(0)}`,
      `angle ${(t.angle * 180 / Math.PI).toFixed(1)}  grounded ${t.grounded}  throttle ${t.throttle.toFixed(2)}`,
      `packet onTruck ${p.onTruck}  lost ${p.lost}`,
      `points ${this.terrain.points.length}  props ${this.world.props.length}  cables ${this.world.cables.length}  shelves ${this.world.shelves.length}`,
    ];
    ctx.fillStyle = '#ff0';
    ctx.font = '12px monospace';
    lines.forEach((l, i) => ctx.fillText(l, 12, this.viewH - 70 + i * 15));
  }

  // ---------- HUD ----------
  updateHud() {
    this.hud.speed.textContent = Math.round(Math.max(0, this.truck.forwardSpeed) / 10);
    const lv = this.level;
    const d = Math.floor(this.distance);
    this.hud.distance.textContent = lv ? `${Math.min(d, lv.length)}/${lv.length}` : d;
    this.hud.timeStat.classList.toggle('hidden', !lv);   // Hacker's countdown is drawn above the truck instead
    this.hud.timeLabel.textContent = this.isHacker ? 'Time left' : 'Time';
    this.hud.btcStat.classList.toggle('hidden', !this.isProgression);
    this.hud.btc.textContent = this.btc;
    if (this.isHacker) {
      this.hud.time.textContent = Math.max(0, this.hackerTime).toFixed(1);
      this.hud.timeStat.classList.toggle('danger', this.hackerTime < 10 && this.state === 'running');
      this.hud.bestLabel.textContent = 'Best';
      this.hud.best.textContent = this.hackerBest;
      this.hud.bestUnit.textContent = 'pts';
    } else if (lv) {
      this.hud.timeStat.classList.remove('danger');
      // Levels show time records instead of best distance
      const rec = this.levelRecords[this.mode.index];
      this.hud.time.textContent = this.runTime.toFixed(1);
      this.hud.bestLabel.textContent = 'Record';
      this.hud.best.textContent = rec != null ? rec.toFixed(2) : '--';
      this.hud.bestUnit.textContent = rec != null ? 's' : '';
    } else {
      this.hud.bestLabel.textContent = 'Best';
      this.hud.best.textContent = this.isProgression ? this.progressBest : this.best;
      this.hud.bestUnit.textContent = 'm';
    }
    const fwGap = Math.max(0, (this.isHacker ? this.truck.x : this.packet.x) - this.firewall.x);
    this.hud.firewall.textContent = Math.floor(fwGap / CONFIG.world.pxPerMeter);
    this.hud.firewallStat.classList.toggle('danger', fwGap < CONFIG.firewall.warnDistance);

    const fuelFrac = this.fuel / this.jetFuelMax;
    this.hud.score.textContent = this.scoreShown;
    this.hud.fuelFill.style.width = `${(fuelFrac * 100).toFixed(1)}%`;
    this.hud.fuel.classList.toggle('low', fuelFrac < CONFIG.jetpack.lowFuel);
    this.hud.fuel.classList.toggle('firing', !!this.truck.jetting);

    const fx = this.hud.fx;
    const show = (k, t) => {
      fx[k].el.classList.toggle('hidden', !(t > 0));
      if (t > 0) fx[k].value.textContent = t.toFixed(1);
    };
    show('boost', this.effects.boost);
    show('gravDouble', this.effects.gravDouble);
    show('gravHalf', this.effects.gravHalf);
    show('bigTires', this.effects.bigTires);
    show('sirkkeli', this.effects.sirkkeli);
    fx.backup.el.classList.toggle('hidden', this.backups <= 0);
    fx.backup.value.textContent = this.backups;
    fx.backupUsed.el.classList.toggle('hidden', !(this.backupFlash > 0));
    const ups = Object.entries(this.upgradeLevels || {}).filter(([id]) => id !== 'extraLife');
    fx.upgrades.el.classList.toggle('hidden', !this.isProgression || !ups.length);
    fx.upgrades.value.textContent = ups.map(([id, l]) => `${UPGRADES[id].name} Lv${l}`).join(' · ');
    const warn = this.state === 'running' && this.stuckTimer > CONFIG.rules.stuckWarnTime;
    show('timeout', warn ? CONFIG.rules.stuckTime - this.stuckTimer : 0);
  }

  showMessage(title, sub, danger = false) {
    this.hud.msgTitle.textContent = title;
    this.hud.msgSub.textContent = sub;
    this.hud.msg.classList.toggle('danger', danger);
    this.hud.msg.classList.remove('hidden');
  }

  hideMessage() { this.hud.msg.classList.add('hidden'); }
}
