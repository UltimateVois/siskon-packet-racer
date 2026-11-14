// All tunable numbers live here. Units: pixels, seconds. World y grows DOWN (canvas style).
const CONFIG = {
  version: 'a0.2.0',      // game version (shown in the main menu; see CHANGELOG.md)
  saveVersion: 2,         // bump to wipe saved records/unlocks on next load

  // Player identity (js/identity.js): a chosen username + a stable anonymous playerId.
  // Both persist forever in localStorage and are never touched by `saveVersion` wipes.
  username: {
    minLength: 3,
    maxLength: 16,
    pattern: /^[A-Za-z0-9_-]+$/,   // letters, digits, underscore, hyphen only
  },

  // Online leaderboard (js/leaderboard.js). Talks to Supabase's REST (PostgREST) endpoint
  // directly with fetch - no Supabase SDK, to keep the project dependency-free. Leave
  // supabaseUrl/supabaseAnonKey blank to keep the leaderboard fully offline (no network calls).
  leaderboard: {
    enabled: true,            // master switch; false disables all leaderboard network calls
    supabaseUrl: '',          // e.g. 'https://xxxxxxxx.supabase.co' (no trailing slash)
    supabaseAnonKey: '',      // Supabase anon/public API key (safe to ship client-side)
    table: 'scores',          // table that receives score submissions
    minScore: 1,              // don't submit runs scoring below this (nothing worth posting)
    toastTime: 4,             // seconds the "couldn't upload score" notice stays on screen
  },

  physics: {
    gravity: 600,         // 33% lighter than the original 900
    dt: 1 / 240,          // fixed physics step
    maxStepsPerFrame: 24, // avoid spiral of death after tab switches
    propK: 4000,          // prop contact stiffness per unit mass
    propC: 40,            // prop contact damping per unit mass
    propCorner: 6,        // rounded collision corners (wheels can roll onto low props)
    propLinDrag: 0.05,
    propAngDrag: 0.3,
    propMaxSpeed: 1400,   // safety cap (light pencils can get flung hard)
    releaseSpeed: 40,     // pencils pop out when their case moves faster than this...
    releaseSpin: 1.5,     // ...or spins faster than this (rad/s)
  },

  world: {
    pxPerMeter: 40,       // for the distance display
  },

  // Background colour by distance (all modes). Each stage fades in over `blend` metres.
  backgrounds: {
    blend: 10,
    stages: [
      { at: 0,   color: '#05080f', grid: [56, 232, 255, 0.06] },   // very dark navy, almost black
      { at: 100, color: '#140305', grid: [255, 120, 120, 0.06] },  // very dark red, almost black
      { at: 200, color: '#1d0a2c', grid: [200, 140, 255, 0.07] },  // dark purple
      { at: 300, color: '#000000', grid: [140, 140, 150, 0.06] },  // pitch black
    ],
  },

  camera: {
    leadX: 0.3,           // truck sits at 30% of screen width
    leadY: 0.6,
    lookAhead: 0.25,      // seconds of velocity to look ahead
    smoothing: 5,
    referenceHeight: 650, // zoom = screenHeight / referenceHeight (clamped)
  },

  truck: {
    mass: 1,
    width: 112,
    height: 46,
    inertiaScale: 1.0,
    wheelRadius: 16,
    // Local frame: origin = centre of mass, +x forward, +y down
    wheels: [
      { x: -36, y: 12, drive: 0.5 },
      { x: 36, y: 12, drive: 0.5 },
    ],
    // Solid parts of the truck (local AABBs). The packet collides with these.
    boxes: {
      chassis:  { x0: -56, y0: -6,  x1: 56,  y1: 10 },
      tailgate: { x0: -56, y0: -15, x1: -52, y1: -6 },   // low tailgate = harder
      cab:      { x0: 4,   y0: -36, x1: 38,  y1: -6 },
      hood:     { x0: 38,  y0: -18, x1: 56,  y1: -6 },
    },
    // Points on the hull that collide with the ground (penalty contacts)
    hullPoints: [
      { x: 56, y: 2 }, { x: 56, y: -16 }, { x: -56, y: 10 }, { x: -56, y: -15 },
      { x: 38, y: -36 }, { x: 4, y: -36 },
    ],
    // Touching the ground with any of these = crash
    roofPoints: [{ x: 8, y: -36 }, { x: 34, y: -36 }],

    // Suspension: each wheel hangs `travel` px below its mount. Compressing that gap is a
    // soft, lightly damped spring (bouncy); beyond it the tyre bottoms out (stiff contact).
    suspension: {
      travel: 9,
      stiffness: 130,     // per wheel (static sag ~3.5 px at normal gravity)
      damping: 5,         // low = bouncier
    },
    contactStiffness: 6000,
    contactDamping: 65,   // lower = bouncier ride (harder to keep the packet)
    hullFriction: 0.8,
    propHullFriction: 0.15, // belly vs props: low, so you can slide off a computer you got stuck on
    rollingResistance: 0.02,
    grip: 1.5,            // max drive force = grip * normal force
    engineForce: 650,
    maxSpeed: 712,        // px/s, engine force fades to 0 here (25% below the original 950)
    crawlForce: 550,      // extra per-wheel force at very low speed (climbing ledges)
    crawlSpeed: 150,
    scrabbleForce: 320,   // forward push when high-centred on something
    reverseForce: 450,    // per-wheel reverse drive (Ctrl)
    reverseMaxSpeed: 250, // px/s backwards
    brakeForce: 500,      // Ctrl while still rolling forward brakes first
    throttleRise: 4,      // how fast throttle ramps up (per second)
    airDrag: 0.05,
    angularDamping: 0.4,
    tiltTorqueGround: 5,  // arrow-key tilt, angular accel in rad/s^2
    tiltTorqueAir: 9,
    boostEngineMult: 1.8,
    boostSpeedMult: 1.5,
  },

  packet: {
    size: 20,
    restitution: 0.35,
    bounceThreshold: 40,  // below this impact speed, no bounce (stops jitter)
    friction: 0.5,
    lostDistance: 350,
    safeRadius: 45,       // within this distance of the bed centre the packet can't be "dropped"
                          // (a device bumping it while it's still on the truck doesn't count)
    startLocalX: -26,
  },

  terrain: {
    baseY: 600,           // "0" line of the traffic chart
    startHeight: 120,
    runwayLength: 700,
    barWidth: 20,         // every bar is this wide...
    barGap: 3,            // ...with this gap between bars (visual only)
    slopeColsMin: 1,      // curved slopes span this many bars
    slopeColsMax: 3,
    flatColsMin: 1,       // normal flat run between slopes (bars)
    flatColsMax: 3,
    plateauChance: 0.35,  // chance the flat run is a long plateau (room for devices)
    plateauColsMin: 4,
    plateauColsMax: 8,
    minBarHeight: 40,
    maxBarHeight: 380,
    minDelta: 30,         // height change between bars at the start...
    maxDelta: 130,        // ...growing to this
    maxUpSlope: 0.5,      // a rise can be at most slopeWidth * this (keeps it climbable)
    difficultyDistance: 15000,
    stepsPerColumn: 5,    // polyline points per bar on slopes (smootherstep S-curve)
  },

  // Physical props. mass is relative to the truck (1). device = kills the packet on touch.
  props: {
    router:     { w: 46, h: 18, mass: 0.15, friction: 0.5, device: true,    // lightest
                  breakable: true, breakSpeed: 300 },  // light, so it needs a harder jolt to count
    hub:        { w: 72, h: 14, mass: 0.35, friction: 0.6, device: true,    // moderate, 8 ports
                  breakable: true, breakSpeed: 200 },
    computer:   { w: 30, h: 36, mass: 0.7,  friction: 0.7, device: true, breakable: true },  // heavy tower PC (narrower
                                                                            // than the wheel gap, so it can't wedge the truck)
    computerPart: { w: 15, h: 18, mass: 0.175, friction: 0.7, device: true },  // a quarter of a computer
    routerPart:   { w: 23, h: 18, mass: 0.075, friction: 0.5, device: true },  // half a router
    flowerPot:  { w: 18, h: 22, mass: 0.1,  friction: 0.5, breakable: true, breakSpeed: 200 },
    potShard:   { w: 9,  h: 11, mass: 0.025, friction: 0.6, collidesProps: false, crackColor: '#6e2e18', noSparks: true },
    plant:      { w: 10, h: 22, mass: 0.02, friction: 0.5, collidesProps: false },   // flies out of a broken pot
    pencilCase: { w: 18, h: 20, mass: 0.06, friction: 0.5 },
    antenna:    { w: 2,  h: 14, mass: 0.01, friction: 0.4, collidesProps: false },  // flies off a broken router
    pencil:     { w: 4,  h: 30, mass: 0.015, friction: 0.4, collidesProps: false },
  },

  // Computers split into 4 pieces when hit hard enough
  breakage: {
    breakSpeed: 161,      // velocity change (px/s) within `window` physics steps that breaks it
                          // (30% below the original 230: breaks from ~100 px/s rams or short falls)
    window: 12,           // = 0.05 s at 240 Hz (contacts are springy, impacts take a few steps)
    armTime: 1.0,         // no breaking right after spawning
    crushForce: 200,      // the truck pressing down this hard (one wheel ~ 300 at normal gravity)...
    crushTime: 0.08,      // ...for this long crushes it (driving over it)
    partBurstMin: 40,     // pieces fly apart at this speed (px/s)...
    partBurstMax: 140,
    burstSparks: 28,      // sparks when it breaks
    sparkTimeMin: 1.5,    // each broken piece keeps sparking for a while
    sparkTimeMax: 4,
    sparkRate: 14,        // sparks per second per piece (fades out)
    maxSparks: 500,
    dirtParticles: 30,    // dirt spraying out of a broken flower pot
  },

  cables: {
    colors: ['#f1c40f', '#2ecc71'],  // yellow or green CAT cable
    segment: 14,          // rope resolution (px per spring)
    stiffness: 25,        // per-segment spring constant (soft = stretchy)
    damping: 0.3,
    particleMass: 0.004,
    airDrag: 1.5,
    radius: 2,
    slackMin: 1.08,       // rest length vs. draped distance between ports
    slackMax: 1.3,
    plugStrength: 45,     // pull (force) that pops a plug ~= 13% local stretch; below the
                          // router's ground friction, so cables pop before dragging devices
    armTime: 1.0,         // seconds after spawn before cables can detach
    detachCooldown: 0.6,  // after one plug pops, wait before the other can
    snagFriction: 0.85,   // how strongly the cable sticks to the truck body
    snapSpeed: 300,       // truck hitting a cable faster than this (px/s) snaps it in two there
    snapSparks: 10,
    snapMinSegments: 3,   // each piece keeps at least this many segments (no tiny fragments)
    snapCooldown: 0.5,    // pieces can't snap again right away
    looseLifetime: 10,    // a fully unplugged cable disappears after this many seconds...
    looseFadeTime: 2,     // ...fading out over the last part
  },

  spawner: {
    start: 1000,
    lookahead: 1500,      // generate this far ahead of the terrain edge's need
    clusterChanceStart: 0.45,
    clusterChanceEnd: 0.75,
    extraComputerChanceStart: 0.15,  // chance of each extra computer on a hub...
    extraComputerChanceEnd: 0.7,     // ...grows with distance
    maxClusterSpan: 1300,
    deviceGapMin: 30,
    deviceGapMax: 140,
    gapMin: 150,
    gapMax: 500,
    officeShelfChance: 0.55,   // office supplies (flower pots, pencil cases) only live on shelves
    officeItemsMax: 3,         // items per shelf
    officeGapMin: 120,
    officeGapMax: 320,
    decorWeights: { flowerPot: 1, pencilCase: 1 },
    shelfWidthMin: 80,
    shelfWidthMax: 150,
    shelfThickness: 8,
    shelfClearanceMin: 95,  // gap between the terrain and the shelf's underside
    shelfClearanceMax: 150,
  },

  powerups: {
    safeStart: 900,
    chancePerBar: 0.1,
    radius: 16,
    floatMin: 45,         // height above the bar
    floatMax: 110,
    weights: { boost: 2, gravDouble: 1, gravHalf: 1, bigTires: 1, sirkkeli: 1 },
    duration: { boost: 10, gravDouble: 10, gravHalf: 10, bigTires: 10, sirkkeli: 10 },
    bigTiresScale: 1.25,  // Big Tires power-up: tyres this much bigger while active
    notInProgression: ['bigTires'],   // Progression has the Bigger Tires upgrade instead
    gravityScale: { gravDouble: 2, gravHalf: 0.5 },
  },

  jetpack: {
    thrust: 800,          // px/s^2 along the truck's "up" (normal gravity is 600)
    fuel: 1,              // seconds of continuous flight on a full tank
    refillTime: 10,       // seconds from empty to full (refills while not firing)
    lowFuel: 0.25,        // gauge turns red below this fraction
  },

  // Progression mode: pick an upgrade every `every` metres
  progression: {
    every: 100,             // a shop opens every this many metres
    baseCost: 10,           // BTC for an upgrade's first level...
    costGrowth: 2,          // ...x this per level of that upgrade
    coinStart: 400,         // no coins before this x
    groundCoinChance: 0.2,  // chance per flat run of a coin (or short row) near the ground
    groundCoinRowMax: 3,
    groundCoinHeight: 24,   // above the surface (truck-body height, so you drive through it)
    groundCoinValue: 1,
    shelfCoinChance: 0.6,   // chance per shelf of a coin on top of it
    shelfCoinValue: 2,
    coinRadius: 8,
    coinSpacing: 24,
    jetRechargeStep: 0.25,  // Jetpack Recharge: +25% refill speed per level
    jetFuelStep: 0.25,      // Jetpack Fuel: +25% of the base tank per level
    tireGrowth: 1.25,       // Bigger Tires: radius x this per pick...
    maxWheelRadius: 34,     // ...up to this (wheels would touch beyond it)
    cableSpeedup: 1.33,     // Cable Management: loose cables vanish this much faster per pick
  },

  // "Sirkkeli" power-up: a buzzsaw on the front bumper
  sirkkeli: {
    mountX: 63, mountY: -12,  // blade centre (truck-local), over the headlight
    radius: 13,
    spin: -70,              // rad/s; negative = teeth sweep up & forward at the front-bottom
    fling: 0.65,            // things hit leave at this fraction of the blade's rim speed...
    push: 220,              // ...plus this much straight away from the blade
    wild: 0.7,              // random direction jitter (radians) - "flying wildly"
    flingCooldown: 0.15,    // a thing can only be flung this often
    grindSparks: 150,       // sparks/s while grinding on the ground or a shelf
  },

  scoring: {
    destroyPoints: 100,     // router / computer / switch destroyed
    snagPoints: 25,         // "SNAGGING BONUS!" for snapping a network cable in half (not with Sirkkeli)
    shelfBonus: 25,         // "SHELF BONUS!" when the destroyed device was sitting on a shelf
    brutalBonus: 50,        // "BRUTAL SMASH!" bonus...
    brutalSpeed: 400,       // ...when the truck is going faster than this (px/s)...
    brutalDistance: 130,    // ...and is this close to the device
    brutalSparks: 60,       // extra sparks for a brutal smash
    comboWindow: 1.0,       // destroy the next one within this many seconds to keep the combo
    comboStep: 0.5,         // multiplier +0.5x per hit in a combo
    floatTime: 0.45,        // points popup floats here first...
    flyTime: 0.6,           // ...then flies to the score meter
    tickRate: 8,            // how fast the meter counts up to the new score
  },

  // Hacker mode: no packet, score as much as you can before time runs out
  hacker: {
    startTime: 60,          // seconds on the clock at the start...
    timeBonus: 30,          // ...plus this much...
    bonusEvery: 100,        // ...every this many metres
    angerEvery: 10,         // every N network devices destroyed...
    angerSpeedup: 1.1,      // ...the firewall gets this much faster ("SYSADMIN IS REALLY MAD!")
    foundSpeedup: 2,        // clock hits 0: "Sysadmin found you!" - the firewall goes this much faster
  },

  popups: {
    life: 1.2,            // seconds a pickup popup floats
    rise: 40,             // px it rises
  },

  backup: {
    every: 100,           // a backup-packet pickup every this many metres
    max: 1,               // backups you can carry (pickups are left alone while full)
    floatHeight: 70,      // pickup height above the ground
    flashTime: 2,         // seconds the "BACKUP ACTIVATED" notice shows
  },

  firewall: {
    startGap: 700,        // starts this far behind the truck
    speed: 93,            // px/s at the start... (all three are 1.33x the original 70 / 0.8 / 220)
    accel: 1.06,          // ...+ this much per second...
    maxSpeed: 293,        // ...up to this
    maxGap: 1400,         // never lags further behind the truck than this (just off-screen)
    warnDistance: 450,    // HUD turns red when it's this close to the packet
  },

  // Infinite mode: devices sit on the floor with this chance (else on a shelf)
  infinite: {
    difficultyBase: 0,
    floorChance: { router: 0.75, hub: 0.75, computer: 0.75 },
  },

  // Level mode. A level must be beaten to unlock the next. Office supplies are always on shelves.
  levels: [
    { name: 'Level 1', length: 100, difficultyBase: 0.0,          // everything on shelves
      floorChance: { router: 0, hub: 0, computer: 0 } },
    { name: 'Level 2', length: 150, difficultyBase: 0.2,          // routers + hubs on the floor, PCs on shelves
      floorChance: { router: 1, hub: 1, computer: 0 } },
    { name: 'Level 3', length: 200, difficultyBase: 0.4,          // PCs sometimes on the floor
      floorChance: { router: 1, hub: 1, computer: 0.3 } },
  ],

  rules: {
    crashEnabled: false,  // flipping onto the roof ends the run (disabled for now)
    stuckSpeed: 25,       // below this speed (px/s)...
    stuckTime: 8,         // ...for this long = connection timeout
    stuckWarnTime: 3,
  },
};
