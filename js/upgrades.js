// Progression-mode upgrades, bought with BTC in the shop that opens every N metres.
// Each: name, icon, desc(game), maxed(game), apply(game). Cost = baseCost * costGrowth^level.
// To add an upgrade, add an entry here - it shows up in the shop automatically.
const UPGRADES = {
  extraLife: {
    name: 'Extra Life',
    icon: '+PKT',
    desc: () => 'A backup packet takes over if your packet is lost.',
    maxed: () => false,
    apply: (game) => { game.backups++; },
  },
  biggerTires: {
    name: 'Bigger Tires',
    icon: '◎',
    desc: (game) => `Tires 25% bigger (${Math.round(game.truck.wheelRadius * 2)} → ${Math.round(nextTireRadius(game) * 2)} px).`,
    maxed: (game) => game.truck.wheelRadius >= CONFIG.progression.maxWheelRadius - 0.01,
    apply: (game) => game.truck.setWheelRadius(nextTireRadius(game)),
  },
  cableManagement: {
    name: 'Cable Management',
    icon: '≋',
    desc: (game) => `Loose cables disappear 33% faster (${(CONFIG.cables.looseLifetime * game.world.cableLifeScale).toFixed(1)} → ` +
      `${(CONFIG.cables.looseLifetime * game.world.cableLifeScale / CONFIG.progression.cableSpeedup).toFixed(1)} s).`,
    maxed: () => false,
    apply: (game) => { game.world.cableLifeScale /= CONFIG.progression.cableSpeedup; },
  },
  jetpackRecharge: {
    name: 'Jetpack Recharge',
    icon: '⟳',
    desc: (game) => `Jetpack refills 25% faster (${game.jetRefillMult.toFixed(2)}x → ${(game.jetRefillMult + CONFIG.progression.jetRechargeStep).toFixed(2)}x).`,
    maxed: () => false,
    apply: (game) => { game.jetRefillMult += CONFIG.progression.jetRechargeStep; },
  },
  jetpackFuel: {
    name: 'Jetpack Fuel',
    icon: '⛽',
    desc: (game) => `25% more fuel (${game.jetFuelMax.toFixed(2)} → ${(game.jetFuelMax + CONFIG.jetpack.fuel * CONFIG.progression.jetFuelStep).toFixed(2)} s).`,
    maxed: () => false,
    apply: (game) => {
      const extra = CONFIG.jetpack.fuel * CONFIG.progression.jetFuelStep;
      game.jetFuelMax += extra;
      game.fuel += extra;   // the new capacity comes filled
    },
  },
};

function nextTireRadius(game) {
  const P = CONFIG.progression;
  return Math.min(P.maxWheelRadius, game.truck.wheelRadius * P.tireGrowth);
}

function upgradeCost(level) {
  const P = CONFIG.progression;
  return Math.round(P.baseCost * Math.pow(P.costGrowth, level));
}

// The shop overlay: buy any number of upgrades you can afford, then continue
class Shop {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('upgrade');
    this.list = document.getElementById('upgrade-list');
    this.sub = document.getElementById('upgrade-sub');
    this.ids = Object.keys(UPGRADES);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.action === 'continue') this.close();
      else this.buy(b.dataset.id);
    });
  }

  get visible() { return !this.el.classList.contains('hidden'); }

  open() {
    this.render();
    this.el.classList.remove('hidden');
    const cont = this.el.querySelector('[data-action="continue"]');
    if (cont) cont.focus();   // Enter = continue
  }

  render() {
    const g = this.game;
    this.sub.textContent = `You have ${g.btc} BTC`;
    this.list.innerHTML = '';
    this.ids.forEach((id, i) => {
      const u = UPGRADES[id], lvl = g.upgradeLevels[id] || 0, cost = upgradeCost(lvl);
      const maxed = u.maxed(g);
      const b = document.createElement('button');
      b.dataset.id = id;
      b.disabled = maxed || g.btc < cost;
      b.innerHTML = `<span class="key">${i + 1}</span> ${u.icon} ${u.name}` +
        `<span class="len">${maxed ? 'MAX' : cost + ' BTC'}</span>` +
        `<small>${maxed ? 'Fully upgraded.' : u.desc(g)}${lvl ? ' · Lv ' + lvl : ''}</small>`;
      this.list.appendChild(b);
    });
    const c = document.createElement('button');
    c.dataset.action = 'continue';
    c.className = 'secondary';
    c.textContent = 'CONTINUE (ENTER)';
    this.list.appendChild(c);
  }

  buy(id) {
    const g = this.game, u = UPGRADES[id];
    if (!u) return false;
    const lvl = g.upgradeLevels[id] || 0, cost = upgradeCost(lvl);
    if (u.maxed(g) || g.btc < cost) return false;
    g.btc -= cost;
    u.apply(g);
    g.upgradeLevels[id] = lvl + 1;
    this.render();
    const cont = this.el.querySelector('[data-action="continue"]');
    if (cont) cont.focus();
    return true;
  }

  close() {
    if (!this.visible) return;
    this.el.classList.add('hidden');
    this.game.resumeFromShop();
  }

  hide() { this.el.classList.add('hidden'); }

  handleInput(input) {
    this.ids.forEach((id, i) => {
      if (input.pressed(`Digit${i + 1}`) || input.pressed(`Numpad${i + 1}`)) this.buy(id);
    });
    if (input.pressed('KeyC')) { this.close(); return; }
    const btns = [...this.list.querySelectorAll('button')].filter((b) => !b.disabled);
    const i = btns.indexOf(document.activeElement);
    if (input.pressed('ArrowDown') && btns.length) btns[(i + 1) % btns.length].focus();
    if (input.pressed('ArrowUp') && btns.length) btns[(i - 1 + btns.length) % btns.length].focus();
  }
}
