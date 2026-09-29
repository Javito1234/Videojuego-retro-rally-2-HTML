'use strict';
// ============================================================================
// RETRO RALLY 2 - CAMPEONATO DE ETAPAS
// Juego nuevo de la saga (no es una modificación de Retro Rally 1).
//  - Etapas punto a punto contra el reloj, con checkpoints que suman tiempo.
//  - Superficies con física propia: asfalto, tierra y nieve (cambian dentro de una etapa).
//  - Copiloto con notas de pista (texto + voz opcional).
//  - Campeonato de 3 etapas con medallas, daño acumulado y récords.
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const WIDTH = 800, HEIGHT = 450;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const STEP = 1 / 60;
const SEG_LEN = 200;          // largo de cada segmento de ruta (unidades de mundo)
const ROAD_W = 2000;          // semiancho de la ruta
const RUMBLE_LEN = 3;
const LANES = 3;
const DRAW_DIST = 240;        // segmentos que se dibujan hacia adelante
const CAM_DEPTH = 0.84;
const CAM_H = 1000;
const PLAYER_Z = CAM_H * CAM_DEPTH;   // el auto va "adelante" de la cámara
const KMH_WORLD = 45;         // unidades de mundo por segundo por cada km/h
const M_PER_UNIT = 0.00617;   // para mostrar metros en las notas del copiloto
const RUNOUT_SEGS = 160;      // tramo de frenado después de la meta
const BARRIER_X = 2.3;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
const easeInOut = (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);

function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}

// ---------------------------------------------------------------------------
// DATOS: vehículos, superficies, temas, dificultad y etapas
// ---------------------------------------------------------------------------
const carImgs = ['escarabajo.png', 'coupe.png', 'hypercar.png'].map(function (n) {
    const im = new Image(); im.src = n; return im;
});

// top = km/h máx. | a0 = aceleración base (km/h por seg) | brake = frenada | steer = respuesta de dirección
// surf = multiplicador de agarre por superficie (el Hypercar vuela en asfalto y sufre en nieve)
const VEHICLES = [
    { name: 'VW Escarabajo', top: 172, a0: 33, brake: 120, steer: 2.25, surf: { asphalt: 0.95, gravel: 1.12, snow: 1.05 }, rpmMax: 5600, pulses: 2, tone: 0.55 },
    { name: 'Coupé GT',      top: 205, a0: 42, brake: 135, steer: 2.35, surf: { asphalt: 1.00, gravel: 1.00, snow: 1.00 }, rpmMax: 7000, pulses: 2, tone: 0.80 },
    { name: 'V12 Hypercar',  top: 242, a0: 58, brake: 150, steer: 2.45, surf: { asphalt: 1.06, gravel: 0.84, snow: 0.74 }, rpmMax: 8500, pulses: 3, tone: 1.10 }
];

const SURFACES = {
    asphalt: { name: 'ASFALTO', grip: 1.00, push: 1.00, accel: 1.00, brake: 1.00, top: 1.00, road: ['#4b4b50', '#444449'], rumble: ['#ffffff', '#d61f1f'], noiseF: 1400, noiseG: 0.030 },
    gravel:  { name: 'TIERRA',  grip: 0.74, push: 1.25, accel: 0.93, brake: 0.78, top: 0.92, road: ['#b58f5a', '#a9844f'], rumble: ['#8a6b3f', '#7a5c34'], noiseF: 900,  noiseG: 0.090 },
    snow:    { name: 'NIEVE',   grip: 0.56, push: 1.50, accel: 0.85, brake: 0.55, top: 0.84, road: ['#e2eaf3', '#d5e0ec'], rumble: ['#9db4cb', '#8aa5c0'], noiseF: 500,  noiseG: 0.040 }
};

const THEMES = {
    coast: {
        skyTop: '#2b7fd8', skyMid: '#79c0f2', skyBottom: '#f2fbff', mt1: '#7d9db8', mt2: '#5f8d7a',
        grass: ['#d8c88c', '#cdbd80'], fog: '#dff1fb', fogD: 2.0,
        sun: { x: 0.72, y: 95, r: 26, color: '#fff6c2' },
        deco: [{ k: 'palm', w: 3 }, { k: 'bush', w: 4 }, { k: 'rock', w: 2 }, { k: 'hay', w: 1 }],
        snowfall: false
    },
    sunset: {
        skyTop: '#2a1440', skyMid: '#c2410c', skyBottom: '#ffb347', mt1: '#3b1f4a', mt2: '#5a2a3e',
        grass: ['#7a8a3a', '#6f7f33'], fog: '#f0a35a', fogD: 2.6,
        sun: { x: 0.30, y: 20, r: 46, color: '#ffd27a' },
        deco: [{ k: 'pine', w: 5 }, { k: 'bush', w: 2 }, { k: 'rock', w: 2 }],
        snowfall: false
    },
    snow: {
        skyTop: '#0c1a33', skyMid: '#465f85', skyBottom: '#b9cde3', mt1: '#8ea3bf', mt2: '#c3d2e4',
        grass: ['#f4f8fc', '#e9f0f7'], fog: '#c9d8e8', fogD: 4.0,
        sun: null,
        deco: [{ k: 'snowpine', w: 6 }, { k: 'rock', w: 2 }],
        snowfall: true
    }
};

// Ratios "velocidad media / velocidad ideal de la etapa" que definen las medallas, y ratio mínimo que
// alcanza para llegar a cada checkpoint (allow). Un piloto automático casi perfecto logra ~0.95-0.98.
// NOTA: estos números están calibrados con simulación, no con jugadores reales: son lo primero a retocar.
const DIFFS = [
    { name: 'Fácil',   gold: 0.78, silver: 0.68, bronze: 0.56, allow: 0.42 },
    { name: 'Media',   gold: 0.86, silver: 0.76, bronze: 0.64, allow: 0.50 },
    { name: 'Difícil', gold: 0.92, silver: 0.83, bronze: 0.72, allow: 0.58 }
];

// Cada sección: [entrada, tramo, salida, curva, desnivel, superficie(opcional)]
// curva: + derecha / - izquierda (2 suave ... 7-8 horquilla). desnivel en múltiplos de SEG_LEN.
const STAGE_DEFS = [
    {
        name: 'Costa del Faro', surface: 'asphalt', theme: 'coast', seed: 11,
        landmarks: [{ seg: 420, kind: 'lighthouse', offset: -5.5 }, { seg: 1500, kind: 'lighthouse', offset: 6.0 }],
        sections: [
            [0, 60, 0, 0, 0], [25, 40, 25, 2, 0], [20, 70, 20, 0, 12], [20, 40, 20, -4, 0], [15, 30, 15, 4, -6],
            [25, 110, 25, 0, 18], [30, 80, 30, -3, 0], [20, 60, 20, 0, -28], [12, 26, 12, 7, 0], [15, 30, 15, -4, 0],
            [15, 30, 15, 4, 0], [0, 80, 0, 0, 0], [20, 50, 20, 5, 10], [20, 50, 20, -5, -10], [25, 90, 25, 2.5, 0],
            [15, 20, 15, -6, 0], [20, 60, 20, 0, 14], [20, 40, 20, 3.5, -14], [10, 20, 10, -7, 0], [20, 80, 20, 0, 0],
            [25, 60, 25, -3, 8], [25, 60, 25, 3, -8], [15, 35, 15, 6, 0], [15, 35, 15, -6, 0], [30, 120, 30, 0, 0],
            [20, 50, 20, 4, 0], [0, 60, 0, 0, 0]
        ]
    },
    {
        name: 'Valle Dorado', surface: 'gravel', theme: 'sunset', seed: 22,
        landmarks: [],
        sections: [
            [0, 50, 0, 0, 0], [25, 50, 25, 3, 0], [20, 60, 20, 0, 15], [20, 40, 20, -5, -5], [15, 30, 15, 5, 0],
            [15, 25, 15, -5, 0], [25, 90, 25, 0, 22], [15, 30, 15, 6, -10], [10, 22, 10, -7, -15], [20, 80, 20, 0, -25],
            [25, 60, 25, 4, 0], [20, 50, 20, -4, 10], [20, 50, 20, 4, -5],
            [20, 80, 20, 0, 0, 'asphalt'], [25, 90, 25, -3, 12, 'asphalt'], [20, 60, 20, 3, -12, 'asphalt'],
            [15, 40, 15, -6, 0, 'gravel'], [12, 25, 12, 7, 8], [20, 70, 20, 0, 20], [20, 50, 20, -5, -20],
            [15, 35, 15, 5, 0], [15, 35, 15, -5, 0], [15, 35, 15, 5, 0], [30, 110, 30, 0, -10], [20, 45, 20, -6, 0],
            [20, 60, 20, 4, 15], [25, 80, 25, -3, -15], [10, 20, 10, 8, 0], [30, 100, 30, 0, 0], [20, 50, 20, 4, 0],
            [0, 60, 0, 0, 0]
        ]
    },
    {
        name: 'Paso Nevado', surface: 'snow', theme: 'snow', seed: 33,
        landmarks: [{ seg: 900, kind: 'cabin', offset: -4.5 }, { seg: 2000, kind: 'cabin', offset: 5.0 }],
        sections: [
            [0, 50, 0, 0, 0], [25, 60, 25, 2, 0], [20, 50, 20, -3, 10], [20, 70, 20, 0, 20], [15, 30, 15, 5, -5],
            [15, 30, 15, -5, -5], [12, 22, 12, 7, 0], [25, 90, 25, 0, -25], [20, 50, 20, 4, 0], [20, 50, 20, -4, 15],
            [15, 30, 15, -6, 10], [25, 110, 25, 0, 20], [30, 70, 30, 3, 0], [20, 40, 20, -5, -30], [12, 25, 12, 7, -10],
            [12, 25, 12, -7, -10],
            [20, 70, 20, 0, 0, 'asphalt'], [25, 60, 25, 4, 0, 'asphalt'], [20, 50, 20, -4, 0, 'asphalt'],
            [15, 30, 15, 6, 0, 'snow'], [20, 80, 20, 0, 18], [15, 30, 15, -5, 0], [15, 30, 15, 5, 0], [10, 20, 10, -8, 0],
            [25, 90, 25, 0, -20], [20, 60, 20, 3, 0], [20, 60, 20, -3, 0], [30, 100, 30, 0, 0], [15, 35, 15, 5, 0],
            [0, 60, 0, 0, 0]
        ]
    }
];

// ---------------------------------------------------------------------------
// CONSTRUCCIÓN DE ETAPAS
// ---------------------------------------------------------------------------
const STAGE_CACHE = [];
function getStage(i) {
    if (!STAGE_CACHE[i]) STAGE_CACHE[i] = buildStage(i);
    return STAGE_CACHE[i];
}

function pickWeighted(list, rng) {
    let total = 0;
    for (const e of list) total += e.w;
    let r = rng() * total;
    for (const e of list) { r -= e.w; if (r <= 0) return e.k; }
    return list[0].k;
}

function gradeFor(peak) {
    if (peak >= 7) return 1;
    if (peak >= 5.5) return 2;
    if (peak >= 4.2) return 3;
    if (peak >= 3) return 4;
    if (peak >= 2.2) return 5;
    return 6;
}
const GRADE_WORDS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];

function detectNotes(segs) {
    const notes = [];
    const N = segs.length;
    let i = 0;
    while (i < N) {
        const c = segs[i].curve;
        if (Math.abs(c) >= 1.2) {
            const sign = Math.sign(c);
            let j = i, peak = 0;
            while (j < N && Math.sign(segs[j].curve) === sign && Math.abs(segs[j].curve) >= 0.5) {
                peak = Math.max(peak, Math.abs(segs[j].curve));
                j++;
            }
            if (peak >= 2) {
                const grade = gradeFor(peak);
                const len = j - i;
                const note = { seg: i, end: j, dir: sign < 0 ? 'L' : 'R', grade: grade, len: len, long: len >= 70, hairpin: grade === 1 };
                note.voice = (note.dir === 'L' ? 'izquierda ' : 'derecha ') + GRADE_WORDS[grade] +
                    (note.hairpin ? ', horquilla' : '') + (note.long ? ', larga' : '');
                notes.push(note);
            }
            i = j;
        } else {
            i++;
        }
    }
    return notes;
}

function buildStage(idx) {
    const def = STAGE_DEFS[idx];
    const theme = THEMES[def.theme];
    const rng = mulberry32(def.seed);
    const segs = [];

    function lastY() { return segs.length ? segs[segs.length - 1].p2.world.y : 0; }
    function mkPt(z, y) { return { world: { x: 0, y: y, z: z }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } }; }

    function addSegment(curve, y, surface) {
        const n = segs.length;
        const alt = Math.floor(n / RUMBLE_LEN) % 2;
        const surf = SURFACES[surface];
        segs.push({
            index: n,
            p1: mkPt(n * SEG_LEN, lastY()),
            p2: mkPt((n + 1) * SEG_LEN, y),
            curve: curve,
            surface: surface,
            colors: { grass: theme.grass[alt], road: surf.road[alt], rumble: surf.rumble[alt] },
            alt: alt,
            objs: [],
            gate: null,
            clip: 0
        });
    }

    function addRoad(enter, hold, leave, curve, hill, surface) {
        const startY = lastY();
        const endY = startY + (hill || 0) * SEG_LEN;
        const total = enter + hold + leave;
        let n;
        for (n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total), surface);
        for (n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total), surface);
        for (n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total), surface);
    }

    for (const s of def.sections) addRoad(s[0], s[1], s[2], s[3], s[4], s[5] || def.surface);
    addRoad(0, RUNOUT_SEGS, 0, 0, 0, def.surface);

    const N = segs.length;
    const finishSeg = N - RUNOUT_SEGS;
    const usable = finishSeg;
    const cps = [0.27, 0.54, 0.79].map(function (f) { return Math.round(usable * f); });

    segs[14].gate = 'start';
    cps.forEach(function (c) { segs[c].gate = 'cp'; });
    segs[finishSeg].gate = 'finish';

    // Decorado (determinístico por semilla)
    for (let i = 24; i < N; i++) {
        const s = segs[i];
        if (i % 3 === 0) {
            for (const side of [-1, 1]) {
                if (rng() < 0.55) {
                    const kind = pickWeighted(theme.deco, rng);
                    const off = side * (1.55 + rng() * 3.2);
                    let hit = 0;
                    if ((kind === 'pine' || kind === 'snowpine') && Math.abs(off) < 2.1) hit = 0.12;
                    if (kind === 'rock' && Math.abs(off) < 2.1) hit = 0.16;
                    s.objs.push({ kind: kind, offset: off, size: 0.8 + rng() * 0.6, hitW: hit });
                }
            }
        }
        // Rocas pegadas a la ruta: castigan a quien corta las curvas
        if (rng() < 0.012 && i < finishSeg - 10) {
            const side = rng() < 0.5 ? -1 : 1;
            s.objs.push({ kind: 'rock', offset: side * (1.08 + rng() * 0.25), size: 0.7 + rng() * 0.4, hitW: 0.16 });
        }
        // Chevrones de curva cerrada en el lado exterior
        if (Math.abs(s.curve) >= 3.5 && i % 4 === 0) {
            s.objs.push({ kind: 'chevron', offset: -Math.sign(s.curve) * 1.3, dir: Math.sign(s.curve), size: 1, hitW: 0.07 });
        }
    }
    for (const lm of def.landmarks) segs[lm.seg].objs.push({ kind: lm.kind, offset: lm.offset, size: 1, hitW: 0 });

    // Minimapa (trazado integrando el rumbo)
    let h = -Math.PI / 2, mx = 0, my = 0;
    const raw = [];
    for (let i = 0; i < finishSeg; i++) {
        h += segs[i].curve * 0.0075;
        mx += Math.cos(h); my += Math.sin(h);
        if (i % 6 === 0) raw.push({ x: mx, y: my });
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const mini = {
        pts: raw.map(function (p) { return { x: (p.x - minX) / span, y: (p.y - minY) / span }; }),
        w: (maxX - minX) / span,
        h: (maxY - minY) / span
    };

    const surfSeen = [];
    for (let i = 0; i < finishSeg; i++) if (surfSeen.indexOf(segs[i].surface) < 0) surfSeen.push(segs[i].surface);

    return {
        idx: idx, def: def, theme: theme, segs: segs, N: N, finishSeg: finishSeg, cps: cps,
        notes: detectNotes(segs.slice(0, finishSeg)), mini: mini,
        km: finishSeg * SEG_LEN * M_PER_UNIT / 1000,
        surfaces: surfSeen.map(function (k) { return SURFACES[k].name; })
    };
}

// Velocidad "ideal" por segmento (km/h) para un auto en una etapa: tope de la superficie, límite de agarre en
// cada curva (misma fórmula que la física) y límites de frenada/aceleración entre segmentos.
// Sirve de referencia para medallas y para el tiempo que suman los checkpoints.
function idealSpeeds(stg, vehIdx) {
    if (!stg.vcache) stg.vcache = [];
    if (stg.vcache[vehIdx]) return stg.vcache[vehIdx];
    const veh = VEHICLES[vehIdx], n = stg.finishSeg, v = new Array(n);
    for (let i = 0; i < n; i++) {
        const seg = stg.segs[i], surf = SURFACES[seg.surface], vs = veh.surf[seg.surface];
        const effGrip = surf.grip * vs, topSeg = veh.top * surf.top, c = Math.abs(seg.curve);
        let vc = topSeg;
        if (c > 0.3) vc = Math.min(topSeg, veh.top * 0.85 * veh.steer * effGrip / (c * 0.42 * surf.push / vs));
        v[i] = Math.max(35, vc);
    }
    for (let i = n - 2; i >= 0; i--) {   // frenar a tiempo antes de la curva
        const surf = SURFACES[stg.segs[i].surface];
        v[i] = Math.min(v[i], v[i + 1] + 3.2 * (veh.brake / 135) * surf.brake);
    }
    let prev = 20;
    for (let i = 0; i < n; i++) {        // acelerar de a poco a la salida
        const surf = SURFACES[stg.segs[i].surface];
        v[i] = Math.min(v[i], prev + 1.3 * (veh.a0 / 42) * surf.accel);
        prev = v[i];
    }
    stg.vcache[vehIdx] = v;
    return v;
}

// Tiempo para recorrer los segmentos [a,b) a "ratio" de la velocidad ideal
function refTime(stg, vehIdx, ratio, a, b) {
    const v = idealSpeeds(stg, vehIdx);
    let t = 0;
    for (let i = a; i < b; i++) t += SEG_LEN / (v[i] * KMH_WORLD * ratio);
    return t;
}

function medalTargets(stg, vehIdx, diffIdx) {
    const d = DIFFS[diffIdx];
    return {
        gold: refTime(stg, vehIdx, d.gold, 0, stg.finishSeg),
        silver: refTime(stg, vehIdx, d.silver, 0, stg.finishSeg),
        bronze: refTime(stg, vehIdx, d.bronze, 0, stg.finishSeg)
    };
}

// ---------------------------------------------------------------------------
// ESTADO DEL JUEGO
// ---------------------------------------------------------------------------
let gameState = 'START';   // START, COUNTDOWN, RUNNING, PAUSED, FINISHING, ENDED
let selComp = 0, selVeh = 0, selDiff = 1;
let voiceMode = 0;         // 0 voz + texto, 1 solo texto, 2 apagado
let musicOn = true;
let comp = null;           // { order:[...], k:0, results:[] }
let stage = null, stageIdx = 0, curTheme = THEMES.coast, skyGrad = null;

let position = 0, playerX = 0, vx = 0, speed = 0, steerInput = 0, slip = 0;
let stageTime = 0, timeLeft = 0, damage = 0, stageStartDamage = 0;
let crashCooldown = 0, crashFlash = 0;
let nextCp = 0, cpBonus = [], noteIdx = 0, annIdx = 0;
let popup = { t: 0, text: '', sub: '' };
let countdown = 0, lastCountNum = 4, finishTimer = 0, stageResult = null;
let rpm = 1200, gear = 1, bgX = 0;
let particles = [], flakes = [];
const keys = { left: false, right: false, up: false, down: false };
const drawList = [];

const RECORDS_KEY = 'retroRally2Records_v1';
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch (e) { return {}; } }
function saveRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {} }

function setTheme(stg) {
    curTheme = stg.theme;
    skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    skyGrad.addColorStop(0, curTheme.skyTop);
    skyGrad.addColorStop(0.6, curTheme.skyMid);
    skyGrad.addColorStop(1, curTheme.skyBottom);
    flakes = [];
    for (let i = 0; i < 130; i++) flakes.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 1 + Math.random() * 2, s: 40 + Math.random() * 60 });
}

// ---------------------------------------------------------------------------
// AUDIO (todo procedural, sin archivos)
// ---------------------------------------------------------------------------
let _ac = null;
function getAC() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    return _ac;
}
function makeNoiseBuffer(a, secs) {
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * secs), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}

let eng = null;
function startEngine() {
    try {
        stopEngine();
        const a = getAC();
        const veh = VEHICLES[selVeh];
        const master = a.createGain(); master.gain.value = 0.55; master.connect(a.destination);
        const filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.connect(master);
        const o1 = a.createOscillator(); o1.type = 'sawtooth';
        const o2 = a.createOscillator(); o2.type = 'square';
        const g1 = a.createGain(); g1.gain.value = 0.12;
        const g2 = a.createGain(); g2.gain.value = 0.05;
        o1.connect(g1); o2.connect(g2); g1.connect(filt); g2.connect(filt);
        const nb = makeNoiseBuffer(a, 1.5);
        const n1 = a.createBufferSource(); n1.buffer = nb; n1.loop = true;
        const nf = a.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
        const ng = a.createGain(); ng.gain.value = 0;
        n1.connect(nf); nf.connect(ng); ng.connect(master);
        const n2 = a.createBufferSource(); n2.buffer = nb; n2.loop = true;
        const sf = a.createBiquadFilter(); sf.type = 'highpass'; sf.frequency.value = 2200;
        const sg = a.createGain(); sg.gain.value = 0;
        n2.connect(sf); sf.connect(sg); sg.connect(master);
        const t = a.currentTime;
        o1.start(t); o2.start(t); n1.start(t); n2.start(t);
        eng = { o1: o1, o2: o2, g1: g1, g2: g2, filt: filt, n1: n1, n2: n2, nf: nf, ng: ng, sg: sg, master: master, veh: veh };
    } catch (e) { eng = null; }
}
function stopEngine() {
    if (!eng) return;
    try { eng.o1.stop(); eng.o2.stop(); eng.n1.stop(); eng.n2.stop(); eng.master.disconnect(); } catch (e) {}
    eng = null;
}
function updateEngineAudio() {
    if (!eng) return;
    try {
        const a = getAC(), t = a.currentTime, veh = eng.veh;
        const f = rpm / 60 * veh.pulses;
        eng.o1.frequency.setTargetAtTime(f, t, 0.04);
        eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        eng.filt.frequency.setTargetAtTime(350 + rpm * 0.16 * veh.tone, t, 0.05);
        eng.g1.gain.setTargetAtTime(0.08 + 0.10 * (rpm / veh.rpmMax), t, 0.05);
        const seg = stage ? stage.segs[clamp(Math.floor((position + PLAYER_Z) / SEG_LEN), 0, stage.N - 1)] : null;
        const surf = seg ? SURFACES[seg.surface] : SURFACES.asphalt;
        const sr = clamp(speed / veh.top, 0, 1);
        eng.nf.frequency.setTargetAtTime(surf.noiseF, t, 0.1);
        eng.ng.gain.setTargetAtTime(surf.noiseG * sr * (Math.abs(playerX) > 1.08 ? 1.8 : 1), t, 0.08);
        eng.sg.gain.setTargetAtTime(slip > 0.3 ? Math.min(0.10, slip * 0.10) * sr : 0, t, 0.05);
    } catch (e) {}
}

function beep(freq, len) {
    try {
        const a = getAC(), t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + len + 0.02);
    } catch (e) {}
}
function playCrashSound() {
    try {
        const a = getAC(), t = a.currentTime;
        const src = a.createBufferSource(); src.buffer = makeNoiseBuffer(a, 0.28);
        const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
        f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.24);
        const g = a.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.28);
    } catch (e) {}
}
function playCheckpointSound() { beep(660, 0.12); setTimeout(function () { beep(990, 0.22); }, 120); }
function playFinishSound() { beep(523, 0.15); setTimeout(function () { beep(659, 0.15); }, 150); setTimeout(function () { beep(784, 0.35); }, 300); }

// Música chiptune (Dm - Bb - F - C)
const MUSIC_BPM = 146;
const MUSIC_CHORDS = [
    { bass: 146.83, arp: [293.66, 349.23, 440.00, 349.23] },
    { bass: 116.54, arp: [233.08, 293.66, 349.23, 293.66] },
    { bass: 174.61, arp: [349.23, 440.00, 523.25, 440.00] },
    { bass: 130.81, arp: [329.63, 392.00, 523.25, 392.00] }
];
let _mTimer = null, _mGain = null, _mNext = 0, _mStep = 0, _mNoise = null;
function mTone(type, freq, t, len, vol) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + len + 0.02);
}
function mKick(t) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + 0.18);
}
function mSnare(t) {
    const a = getAC(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = _mNoise; f.type = 'highpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(_mGain); s.start(t); s.stop(t + 0.13);
}
function playMusicStep(step, t, dur) {
    const chord = MUSIC_CHORDS[Math.floor(step / 16) % MUSIC_CHORDS.length];
    if (step % 2 === 0) mTone('triangle', chord.bass, t, dur * 1.9, 0.9);
    mTone('square', chord.arp[step % 4], t, dur * 0.8, 0.20);
    const pos = step % 16;
    if (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 12) mTone('square', chord.arp[(pos >> 2) % 4] * 2, t, dur * 1.4, 0.16);
    if (step % 4 === 0) mKick(t);
    if (step % 8 === 4) mSnare(t);
}
function scheduleMusic() {
    try {
        const a = getAC(), stepDur = 60 / MUSIC_BPM / 4;
        while (_mNext < a.currentTime + 0.15) {
            playMusicStep(_mStep, _mNext, stepDur);
            _mNext += stepDur;
            _mStep = (_mStep + 1) % (MUSIC_CHORDS.length * 16);
        }
    } catch (e) {}
}
function startMusic() {
    try {
        if (!musicOn || _mTimer) return;
        const a = getAC();
        if (a.state === 'suspended') a.resume();
        _mGain = a.createGain(); _mGain.gain.value = 0.10; _mGain.connect(a.destination);
        _mNoise = makeNoiseBuffer(a, 0.2);
        _mNext = a.currentTime + 0.05; _mStep = 0;
        _mTimer = setInterval(scheduleMusic, 25);
    } catch (e) {}
}
function stopMusic() {
    if (_mTimer) { clearInterval(_mTimer); _mTimer = null; }
    try { if (_mGain) _mGain.disconnect(); } catch (e) {}
    _mGain = null;
}

// Copiloto por voz
function speak(text) {
    if (voiceMode !== 0) return;
    try {
        if (!('speechSynthesis' in window)) return;
        if (window.speechSynthesis.pending) window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 1.25; u.volume = 1;
        window.speechSynthesis.speak(u);
    } catch (e) {}
}
function cancelSpeech() { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {} }
function stopAllAudio() { stopEngine(); stopMusic(); cancelSpeech(); }

// ---------------------------------------------------------------------------
// ENTRADA
// ---------------------------------------------------------------------------
function initInput() {
    const NAV = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];
    window.addEventListener('keydown', function (e) {
        if (NAV.indexOf(e.key) >= 0) e.preventDefault();
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = true;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = true;
        if (e.key === 'ArrowDown' || k === 's') keys.down = true;
        if (!e.repeat && (k === 'p' || e.key === 'Escape')) togglePause();
        if (!e.repeat && k === 'm') toggleMusic();
        if (!e.repeat && k === 'c') cycleVoice();
    });
    window.addEventListener('keyup', function (e) {
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = false;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = false;
        if (e.key === 'ArrowDown' || k === 's') keys.down = false;
    });
    window.pressTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = true; };
    window.releaseTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = false; };
    window.addEventListener('blur', function () { if (gameState === 'RUNNING') togglePause(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && gameState === 'RUNNING') togglePause(); });

    document.getElementById('btnStartRace').onclick = startCompetition;
}

function togglePause() {
    if (gameState === 'RUNNING') {
        gameState = 'PAUSED';
        stopAllAudio();
    } else if (gameState === 'PAUSED') {
        gameState = 'RUNNING';
        startEngine(); startMusic();
    }
}
window.togglePause = togglePause;

function toggleMusic() {
    musicOn = !musicOn;
    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN') { if (musicOn) startMusic(); else stopMusic(); }
}
function cycleVoice() {
    voiceMode = (voiceMode + 1) % 3;
    popup = { t: 1.6, text: 'COPILOTO', sub: ['VOZ + TEXTO', 'SOLO TEXTO', 'APAGADO'][voiceMode] };
    if (voiceMode !== 0) cancelSpeech();
}

// ---------------------------------------------------------------------------
// FLUJO: menú, campeonato, etapas, resultados
// ---------------------------------------------------------------------------
function readMenu() {
    const g = function (id, d) { const e = document.getElementById(id); return e ? parseInt(e.value, 10) : d; };
    selComp = g('selectComp', 0);
    selVeh = g('selectVehicle', 0);
    selDiff = g('selectDifficulty', 1);
    voiceMode = g('selectVoice', 0);
    musicOn = g('selectMusic', 1) === 1;
}

function updateMenu() {
    readMenu();
    const first = selComp === 0 ? 0 : selComp - 1;
    const stg = getStage(first);
    setBackdrop(first);

    const pc = document.getElementById('menuMapCanvas');
    if (pc) {
        const pctx = pc.getContext('2d');
        pctx.clearRect(0, 0, pc.width, pc.height);
        drawMini(pctx, 0, 0, 130, stg, -1);
    }
    const nm = document.getElementById('previewName'), inf = document.getElementById('previewInfo');
    if (nm && inf) {
        if (selComp === 0) {
            nm.textContent = 'CAMPEONATO · 3 ETAPAS';
            inf.textContent = STAGE_DEFS.map(function (d) { return d.name; }).join(' · ');
        } else {
            nm.textContent = 'ETAPA ' + selComp + ' · ' + stg.def.name.toUpperCase();
            inf.textContent = stg.surfaces.join(' + ') + ' · ' + stg.km.toFixed(1) + ' km';
        }
    }
    const rec = document.getElementById('menuRecords');
    if (rec) {
        const r = loadRecords();
        const key = selComp === 0 ? 'c_' + selVeh + '_' + selDiff : 's' + (selComp - 1) + '_' + selVeh + '_' + selDiff;
        rec.textContent = (selComp === 0 ? 'RÉCORD CAMPEONATO ' : 'RÉCORD ETAPA ') + formatTime(r[key]);
    }
}
window.updateMenu = updateMenu;

function setBackdrop(i) {
    stage = getStage(i); stageIdx = i; setTheme(stage);
    position = 0; playerX = 0; speed = 0; bgX = 0;
}

function startCompetition() {
    readMenu();
    try { const a = getAC(); if (a.state === 'suspended') a.resume(); } catch (e) {}
    comp = { order: selComp === 0 ? [0, 1, 2] : [selComp - 1], k: 0, results: [] };
    damage = 0;
    startStage(comp.order[0], false);
}

function startStage(idx, isRetry) {
    stageIdx = idx;
    stage = getStage(idx);
    setTheme(stage);
    position = 0; playerX = 0; vx = 0; speed = 0; steerInput = 0; slip = 0;
    stageTime = 0; nextCp = 0; noteIdx = 0; annIdx = 0;
    crashCooldown = 0; crashFlash = 0; particles = []; popup.t = 0;
    rpm = 1200; gear = 1; bgX = 0; stageResult = null;
    for (const sg of stage.segs) for (const ob of sg.objs) ob.down = false;   // carteles derribados vuelven a su lugar
    if (isRetry) damage = stageStartDamage;
    else if (comp.k > 0) damage = Math.round(damage * 0.4);   // el equipo repara parte del daño
    stageStartDamage = damage;

    const veh = selVeh, d = DIFFS[selDiff];
    const b = [0].concat(stage.cps, [stage.finishSeg]);
    timeLeft = refTime(stage, veh, d.allow, b[0], b[1]) + 8;
    cpBonus = [];
    for (let j = 0; j < stage.cps.length; j++) cpBonus.push(refTime(stage, veh, d.allow, b[j + 1], b[j + 2]));

    countdown = 3.6; lastCountNum = 4;
    gameState = 'COUNTDOWN';
    document.getElementById('menuStart').classList.add('hidden');
    document.getElementById('menuResult').classList.add('hidden');
    startEngine(); startMusic();
    if (stage.notes.length && voiceMode === 0) setTimeout(function () { speak('Etapa ' + (idx + 1) + ', ' + stage.def.name); }, 300);
}

function showResult(title, text, victory, primaryLabel, primaryFn, secondaryLabel, secondaryFn) {
    const t = document.getElementById('resTitle');
    t.innerText = title;
    t.style.color = victory ? '#ffb800' : '#ff3d5a';
    document.getElementById('resText').innerText = text;
    const b1 = document.getElementById('btnResPrimary'), b2 = document.getElementById('btnResSecondary');
    b1.innerText = primaryLabel; b1.onclick = primaryFn;
    if (secondaryLabel) { b2.classList.remove('hidden'); b2.innerText = secondaryLabel; b2.onclick = secondaryFn; }
    else { b2.classList.add('hidden'); b2.onclick = null; }
    document.getElementById('menuResult').classList.remove('hidden');
}

function backToMenu() {
    stopAllAudio();
    gameState = 'START';
    keys.left = keys.right = keys.up = keys.down = false;
    document.getElementById('menuResult').classList.add('hidden');
    document.getElementById('menuStart').classList.remove('hidden');
    updateMenu();
}
window.backToMenu = backToMenu;

function failStage(msg) {
    gameState = 'ENDED';
    stopAllAudio();
    showResult('ETAPA FALLIDA', msg, false, 'REINTENTAR ETAPA', function () { startStage(comp.order[comp.k], true); }, 'VOLVER AL MENÚ', backToMenu);
}

function crash(dmg, spdMul) {
    if (crashCooldown > 0) return;
    speed *= spdMul;
    damage = Math.min(100, damage + dmg);
    crashCooldown = 0.6; crashFlash = 0.35;
    playCrashSound();
    if (damage >= 100) failStage('VEHÍCULO AVERIADO\nEl daño llegó al 100%.');
}

// Se llama en el instante de cruzar la meta: fija el resultado y arranca el frenado
function onFinish() {
    gameState = 'FINISHING'; finishTimer = 0;
    const t = stageTime;
    const tg = medalTargets(stage, selVeh, selDiff);
    const medal = t <= tg.gold ? 'ORO' : t <= tg.silver ? 'PLATA' : t <= tg.bronze ? 'BRONCE' : 'SIN MEDALLA';
    const recs = loadRecords();
    const key = 's' + stageIdx + '_' + selVeh + '_' + selDiff;
    const newRecord = (recs[key] == null || t < recs[key]);
    if (newRecord) { recs[key] = t; saveRecords(recs); }
    stageResult = { stageIdx: stageIdx, time: t, medal: medal, damage: Math.round(damage), targets: tg, newRecord: newRecord };
    comp.results[comp.k] = stageResult;
    popup = { t: 3, text: 'META', sub: formatTime(t) };
    playFinishSound();
    cancelSpeech();
}

function finishStage() {
    gameState = 'ENDED';
    stopAllAudio();
    const r = stageResult, tg = r.targets;
    const last = comp.k >= comp.order.length - 1;
    const sumTime = comp.results.reduce(function (a, x) { return a + x.time; }, 0);
    let text = 'Tiempo: ' + formatTime(r.time) + (r.newRecord ? '  ★ RÉCORD' : '') +
        '\nMedalla: ' + r.medal +
        '\nOro ' + formatTime(tg.gold) + '  ·  Plata ' + formatTime(tg.silver) + '  ·  Bronce ' + formatTime(tg.bronze) +
        '\nDaño: ' + r.damage + '%';
    if (comp.order.length > 1) text += '\nAcumulado: ' + formatTime(sumTime);

    if (!last) {
        if (r.damage > 0) text += '\nEl equipo repara parte del daño: ' + r.damage + '% → ' + Math.round(r.damage * 0.4) + '%';
        showResult('ETAPA ' + (comp.k + 1) + ' COMPLETADA · ' + STAGE_DEFS[r.stageIdx].name.toUpperCase(), text, true,
            'SIGUIENTE ETAPA', function () { comp.k++; startStage(comp.order[comp.k], false); }, 'ABANDONAR', backToMenu);
        return;
    }
    if (comp.order.length === 1) {
        showResult('ETAPA COMPLETADA · ' + STAGE_DEFS[r.stageIdx].name.toUpperCase(), text, true,
            'VOLVER AL MENÚ', backToMenu, 'REPETIR ETAPA', function () { comp.k = 0; comp.results = []; damage = 0; startStage(comp.order[0], false); });
        return;
    }
    // Final del campeonato
    const recs = loadRecords();
    const ck = 'c_' + selVeh + '_' + selDiff;
    const newChamp = (recs[ck] == null || sumTime < recs[ck]);
    if (newChamp) { recs[ck] = sumTime; saveRecords(recs); }
    const counts = { ORO: 0, PLATA: 0, BRONCE: 0 };
    comp.results.forEach(function (x) { if (counts[x.medal] !== undefined) counts[x.medal]++; });
    let fin = 'CAMPEONATO FINALIZADO\n';
    comp.results.forEach(function (x, i) {
        fin += '\nE' + (i + 1) + ' ' + STAGE_DEFS[x.stageIdx].name + ': ' + formatTime(x.time) + '  [' + x.medal + ']';
    });
    fin += '\n\nTiempo total: ' + formatTime(sumTime) + (newChamp ? '  ★ RÉCORD' : '') +
        '\nMedallas: ' + counts.ORO + ' oro · ' + counts.PLATA + ' plata · ' + counts.BRONCE + ' bronce';
    showResult(counts.ORO === 3 ? '¡CAMPEÓN PERFECTO!' : '¡CAMPEONATO COMPLETADO!', fin, true, 'VOLVER AL MENÚ', backToMenu, null, null);
}

// ---------------------------------------------------------------------------
// FÍSICA
// ---------------------------------------------------------------------------
function emitParticle(color, size, life) {
    if (particles.length > 90) return;
    particles.push({
        x: WIDTH / 2 + (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25) + steerInput * 30,
        y: HEIGHT - 55 - Math.random() * 10,
        vx: (Math.random() - 0.5) * 60 - vx * 20, vy: -25 - Math.random() * 45,
        life: life, max: life, size: size, color: color
    });
}

function updateRpm(dt) {
    const veh = VEHICLES[selVeh];
    const ratio = clamp(speed / veh.top, 0, 1.05);
    const g = Math.min(5, Math.floor(ratio * 5 * 0.98) + 1);
    const within = clamp(ratio * 5 * 0.98 - (g - 1), 0, 1);
    let target = 1900 + within * (veh.rpmMax - 1900);
    if (gameState === 'COUNTDOWN') target = keys.up ? veh.rpmMax * 0.6 : 1200;
    else if (speed < 3 && !keys.up) target = 1200;
    else if (!keys.up) target = Math.max(1300, target * 0.85);
    gear = g;
    rpm += (target - rpm) * Math.min(1, dt * 10);
}

function updatePhysics(dt) {
    if (!stage) return;
    if (crashCooldown > 0) crashCooldown -= dt;
    if (crashFlash > 0) crashFlash -= dt;
    if (popup.t > 0) popup.t -= dt;

    if (gameState === 'COUNTDOWN') {
        countdown -= dt;
        const num = Math.ceil(countdown - 0.6);
        if (num !== lastCountNum) { lastCountNum = num; if (num >= 1) beep(440, 0.15); }
        if (countdown <= 0.6) {
            gameState = 'RUNNING';
            beep(880, 0.35);
            popup = { t: 1.0, text: '¡YA!', sub: '' };
        }
        updateRpm(dt); updateEngineAudio();
        return;
    }
    const finishing = (gameState === 'FINISHING');
    if (gameState !== 'RUNNING' && !finishing) return;

    const veh = VEHICLES[selVeh];
    const pz = position + PLAYER_Z;
    const idx = clamp(Math.floor(pz / SEG_LEN), 0, stage.N - 1);
    const seg = stage.segs[idx];
    const surf = SURFACES[seg.surface];
    const vs = veh.surf[seg.surface];
    const effGrip = surf.grip * vs;
    const offroad = Math.abs(playerX) > 1.08;

    if (!finishing) {
        stageTime += dt; timeLeft -= dt;
        if (timeLeft <= 0) { timeLeft = 0; failStage('TIEMPO AGOTADO\nNo llegaste al próximo checkpoint a tiempo.'); return; }
    } else {
        finishTimer += dt;
        if (finishTimer > 1.2 && (speed < 2 || finishTimer > 3.2)) { finishStage(); return; }
    }

    // ---- velocidad
    let maxEff = veh.top * surf.top * (1 - 0.25 * damage / 100);
    if (offroad) maxEff *= 0.55;
    const throttle = finishing ? false : keys.up;
    const braking = finishing ? true : keys.down;
    const slope = (seg.p2.world.y - seg.p1.world.y) / SEG_LEN;
    if (braking) {
        speed -= veh.brake * surf.brake * (finishing ? 0.7 : 1) * dt;
    } else if (throttle) {
        const x = Math.min(1, speed / maxEff);
        speed += (veh.a0 * surf.accel * (1 - Math.pow(x, 1.6)) + 2) * dt;
    } else {
        speed -= (14 + 0.30 * speed) * dt;
    }
    if (speed > 5) speed -= slope * 45 * dt;             // cuesta arriba frena, cuesta abajo ayuda
    if (speed > maxEff) speed = Math.max(maxEff, speed - 60 * dt);
    if (offroad) speed -= (10 + 0.25 * speed) * dt;
    speed = clamp(speed, 0, veh.top * 1.1);

    // ---- dirección y deslizamiento lateral
    const sr = speed / veh.top;
    let dir = 0;
    if (finishing) dir = playerX > 0.06 ? -1 : (playerX < -0.06 ? 1 : 0);
    else dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir !== 0) steerInput = clamp(steerInput + dir * dt * 5.5, -1, 1);
    else steerInput *= Math.pow(0.86, dt * 60);

    const authority = veh.steer * effGrip * (0.35 + 0.65 * Math.min(1, sr * 1.4));
    const targetLat = steerInput * authority * Math.min(1, speed / 8);
    vx += (targetLat - vx) * Math.min(1, (4 + 6 * effGrip) * dt);   // menos agarre = más inercia lateral
    const push = seg.curve * sr * 0.42 * surf.push / vs;             // fuerza centrífuga
    playerX += (vx - push) * dt;

    const overload = Math.abs(push) / Math.max(0.15, authority);
    slip = sr > 0.2 ? clamp((overload - 0.75) / 0.5, 0, 1) : 0;

    if (Math.abs(playerX) > BARRIER_X) {
        playerX = Math.sign(playerX) * BARRIER_X; vx = 0;
        crash(6, 0.55);
        if (gameState === 'ENDED') return;
    }

    // ---- avance
    const prevIdx = idx;
    position += speed * KMH_WORLD * dt;
    const maxPos = (stage.N - 3) * SEG_LEN - PLAYER_Z;
    if (position > maxPos) position = maxPos;
    const newIdx = clamp(Math.floor((position + PLAYER_Z) / SEG_LEN), 0, stage.N - 1);

    // ---- colisión con decorado (revisa todos los segmentos cruzados en este paso)
    if (!finishing) {
        for (let i = prevIdx; i <= newIdx; i++) {
            const objs = stage.segs[i].objs;
            for (let k = 0; k < objs.length; k++) {
                const o = objs[k];
                if (o.hitW > 0 && !o.down && Math.abs(playerX - o.offset) < o.hitW + 0.15) {
                    if (o.kind === 'chevron') { o.down = true; crash(3, 0.82); }   // el cartel se derriba: golpe leve, una sola vez
                    else crash(o.kind === 'rock' ? 9 : 12, 0.45);
                    playerX += (playerX >= o.offset ? 1 : -1) * 0.25;
                    if (gameState === 'ENDED') return;
                    break;
                }
            }
        }
    }

    // ---- checkpoints y meta
    if (!finishing) {
        while (nextCp < stage.cps.length && position + PLAYER_Z >= stage.cps[nextCp] * SEG_LEN) {
            timeLeft += cpBonus[nextCp];
            popup = { t: 2.2, text: 'CHECKPOINT', sub: '+' + Math.round(cpBonus[nextCp]) + ' s' };
            playCheckpointSound();
            nextCp++;
        }
        if (position + PLAYER_Z >= stage.finishSeg * SEG_LEN) { onFinish(); }
    }

    // ---- copiloto: notas de pista
    if (!finishing) {
        const notes = stage.notes;
        const curSeg = newIdx;
        while (noteIdx < notes.length && notes[noteIdx].end < curSeg) noteIdx++;
        if (annIdx < noteIdx) annIdx = noteIdx;
        const speedMs = speed / 3.6;
        const leadUnits = (60 + speedMs * 3.2) / M_PER_UNIT;
        while (annIdx < notes.length && notes[annIdx].seg * SEG_LEN - (position + PLAYER_Z) <= leadUnits) {
            speak(notes[annIdx].voice);
            annIdx++;
        }
    }

    // ---- efectos
    bgX -= seg.curve * sr * dt * 30;
    if (speed > 25) {
        if (offroad) { if (Math.random() < 0.5) emitParticle('#9e7a44', 4 + Math.random() * 4, 0.6); }
        else if (seg.surface === 'gravel') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle('#c9a56a', 4 + Math.random() * 5, 0.7); }
        else if (seg.surface === 'snow') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle('#ffffff', 3 + Math.random() * 5, 0.7); }
        if (slip > 0.3 && seg.surface === 'asphalt' && Math.random() < 0.6) emitParticle('#d8d8d8', 3 + Math.random() * 4, 0.5);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }

    updateRpm(dt);
    updateEngineAudio();
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function project(p, camX, camY, camZ) {
    const cx = p.world.x - camX, cy = p.world.y - camY, cz = p.world.z - camZ;
    p.camera.x = cx; p.camera.y = cy; p.camera.z = cz;
    const sc = cz > 0.0001 ? CAM_DEPTH / cz : 0;
    p.screen.scale = sc;
    p.screen.x = Math.round(WIDTH / 2 + sc * cx * WIDTH / 2);
    p.screen.y = Math.round(HEIGHT / 2 - sc * cy * HEIGHT / 2);
    p.screen.w = Math.round(sc * ROAD_W * WIDTH / 2);
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
}

function mountainH(u, layer) {
    const a = Math.sin(u * 0.013 + layer * 1.7) * 0.5 + Math.sin(u * 0.031 + layer * 3.1) * 0.3 + Math.sin(u * 0.071 + layer) * 0.2;
    return Math.abs(a);
}

function drawBackground() {
    const horizonY = HEIGHT / 2;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, horizonY + 1);
    const sun = curTheme.sun;
    if (sun) {
        let sx = ((sun.x * WIDTH + bgX * 0.15) % (WIDTH + 200) + (WIDTH + 200)) % (WIDTH + 200) - 100;
        ctx.fillStyle = sun.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(sx, horizonY - sun.y, sun.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer === 0 ? curTheme.mt1 : curTheme.mt2;
        const amp = layer === 0 ? 85 : 50;
        const f = layer === 0 ? 1 : 2;
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 1);
        for (let x = 0; x <= WIDTH; x += 8) ctx.lineTo(x, horizonY - (0.12 + mountainH(x - bgX * f, layer)) * amp);
        ctx.lineTo(WIDTH, horizonY + 1);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = curTheme.fog;
    ctx.fillRect(0, horizonY, WIDTH, HEIGHT - horizonY);
}

function drawSegment(seg, fogA) {
    const p1 = seg.p1.screen, p2 = seg.p2.screen, col = seg.colors;
    const x1 = p1.x, y1 = p1.y, w1 = p1.w, x2 = p2.x, y2 = p2.y, w2 = p2.w;
    const r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES), l2 = w2 / Math.max(32, 8 * LANES);
    const yb = y1 + 1;   // +1px: evita líneas finas entre segmentos

    ctx.fillStyle = col.grass;
    ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
    quad(x1 - w1 - r1, yb, x1 - w1, yb, x2 - w2, y2, x2 - w2 - r2, y2, col.rumble);
    quad(x1 + w1 + r1, yb, x1 + w1, yb, x2 + w2, y2, x2 + w2 + r2, y2, col.rumble);
    quad(x1 - w1, yb, x1 + w1, yb, x2 + w2, y2, x2 - w2, y2, col.road);

    if (seg.surface === 'asphalt') {
        if (seg.alt === 0) {
            const lw1 = w1 * 2 / LANES, lw2 = w2 * 2 / LANES;
            let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
            for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
                quad(lx1 - l1 / 2, yb, lx1 + l1 / 2, yb, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, '#f2f2f2');
            }
        }
    } else {
        const rut = seg.surface === 'gravel' ? 'rgba(0,0,0,0.13)' : 'rgba(80,110,150,0.16)';
        for (let s = -1; s <= 1; s += 2) {
            const c1 = x1 + s * w1 * 0.38, c2 = x2 + s * w2 * 0.38;
            quad(c1 - l1 * 2.2, yb, c1 + l1 * 2.2, yb, c2 + l2 * 2.2, y2, c2 - l2 * 2.2, y2, rut);
        }
    }
    if (fogA > 0.02) {
        ctx.globalAlpha = fogA;
        ctx.fillStyle = curTheme.fog;
        ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
        ctx.globalAlpha = 1;
    }
}

function tri(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
    ctx.fill(); ctx.stroke();
}

function drawObj(o, x, y, k) {
    const s = o.size;
    switch (o.kind) {
        case 'pine':
        case 'snowpine': {
            const h = 2300 * s * k, w = 1200 * s * k;
            if (h < 3) return;
            ctx.fillStyle = '#4a3018';
            ctx.fillRect(x - w * 0.06, y - h * 0.22, w * 0.12, h * 0.22);
            const snow = o.kind === 'snowpine';
            ctx.fillStyle = snow ? '#1f5a3a' : '#2f8a42';
            ctx.strokeStyle = '#0a2410';
            ctx.lineWidth = Math.max(1, w * 0.03);
            tri(x, y - h, x - w * 0.5, y - h * 0.30, x + w * 0.5, y - h * 0.30);
            tri(x, y - h * 0.68, x - w * 0.42, y - h * 0.12, x + w * 0.42, y - h * 0.12);
            if (snow) {
                ctx.fillStyle = '#f4f8fc';
                tri(x, y - h, x - w * 0.22, y - h * 0.72, x + w * 0.22, y - h * 0.72);
                tri(x, y - h * 0.68, x - w * 0.19, y - h * 0.44, x + w * 0.19, y - h * 0.44);
            }
            break;
        }
        case 'palm': {
            const h = 2100 * s * k, w = 1500 * s * k;
            if (h < 3) return;
            ctx.strokeStyle = '#6b4a26'; ctx.lineWidth = Math.max(1, w * 0.07);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.12, y - h * 0.5, x + w * 0.05, y - h); ctx.stroke();
            ctx.strokeStyle = '#2f9a48'; ctx.lineWidth = Math.max(1, w * 0.06);
            const tx = x + w * 0.05, ty = y - h;
            const ang = [-2.7, -2.1, -1.57, -1.0, -0.4];
            for (let i = 0; i < ang.length; i++) {
                ctx.beginPath(); ctx.moveTo(tx, ty);
                ctx.quadraticCurveTo(tx + Math.cos(ang[i]) * w * 0.35, ty + Math.sin(ang[i]) * w * 0.35 - w * 0.12, tx + Math.cos(ang[i]) * w * 0.55, ty + Math.sin(ang[i]) * w * 0.35 + w * 0.2);
                ctx.stroke();
            }
            break;
        }
        case 'bush': {
            const h = 650 * s * k, w = 900 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#3f8f3a';
            ctx.beginPath(); ctx.ellipse(x - w * 0.22, y - h * 0.4, w * 0.3, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + w * 0.2, y - h * 0.45, w * 0.32, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4fa848';
            ctx.beginPath(); ctx.ellipse(x, y - h * 0.55, w * 0.28, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'rock': {
            const h = 520 * s * k, w = 760 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#7d7f86'; ctx.strokeStyle = '#3b3c40'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.beginPath();
            ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h);
            ctx.lineTo(x + w * 0.25, y - h * 0.85); ctx.lineTo(x + w * 0.5, y - h * 0.25); ctx.lineTo(x + w * 0.45, y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.beginPath(); ctx.moveTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h); ctx.lineTo(x + w * 0.05, y - h * 0.6); ctx.closePath(); ctx.fill();
            break;
        }
        case 'hay': {
            const h = 480 * s * k, w = 800 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#d9b24a'; ctx.strokeStyle = '#8a6a1c'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h);
            ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.5); ctx.lineTo(x + w / 2, y - h * 0.5); ctx.stroke();
            break;
        }
        case 'chevron': {
            const h = 1300 * k, w = 700 * k;
            if (h < 4) return;
            ctx.fillStyle = '#555';
            ctx.fillRect(x - w * 0.03, y - h * 0.75, w * 0.06, h * 0.75);
            ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, w * 0.05);
            ctx.fillRect(x - w / 2, y - h, w, h * 0.5); ctx.strokeRect(x - w / 2, y - h, w, h * 0.5);
            ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, w * 0.09);
            const d = o.dir, cy = y - h * 0.75;
            ctx.beginPath();
            ctx.moveTo(x - d * w * 0.15, cy - h * 0.16); ctx.lineTo(x + d * w * 0.15, cy); ctx.lineTo(x - d * w * 0.15, cy + h * 0.16);
            ctx.stroke();
            break;
        }
        case 'lighthouse': {
            const h = 7000 * k, w = 1500 * k;
            if (h < 6) return;
            const bands = 6;
            for (let i = 0; i < bands; i++) {
                const y0 = y - h * (0.85 * (i + 1) / bands), hh = h * 0.85 / bands;
                const wt = w * (1 - 0.35 * (i / bands));
                ctx.fillStyle = i % 2 === 0 ? '#f4f4f4' : '#c8302a';
                ctx.fillRect(x - wt / 2, y0, wt, hh + 1);
            }
            ctx.fillStyle = '#2a2f3a'; ctx.fillRect(x - w * 0.34, y - h * 0.95, w * 0.68, h * 0.1);
            ctx.fillStyle = '#ffe98a'; ctx.fillRect(x - w * 0.22, y - h * 0.93, w * 0.44, h * 0.06);
            ctx.fillStyle = '#c8302a'; tri(x, y - h, x - w * 0.36, y - h * 0.95, x + w * 0.36, y - h * 0.95);
            break;
        }
        case 'cabin': {
            const h = 1800 * k, w = 2600 * k;
            if (h < 4) return;
            ctx.fillStyle = '#7a4a26'; ctx.fillRect(x - w / 2, y - h * 0.6, w, h * 0.6);
            ctx.fillStyle = '#f4f8fc'; ctx.strokeStyle = '#8fa3b8'; ctx.lineWidth = Math.max(1, w * 0.01);
            tri(x - w * 0.6, y - h * 0.6, x, y - h, x + w * 0.6, y - h * 0.6);
            ctx.fillStyle = '#ffd77a'; ctx.fillRect(x - w * 0.12, y - h * 0.45, w * 0.2, h * 0.22);
            break;
        }
    }
}

function drawGate(seg, k, sx, sy) {
    const half = ROAD_W * 1.12 * k;
    const postW = Math.max(2, 90 * k);
    const top = 2100 * k, bh = 520 * k;
    if (top < 4) return;
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(sx - half - postW / 2, sy - top, postW, top);
    ctx.fillRect(sx + half - postW / 2, sy - top, postW, top);
    const bx = sx - half, bw = half * 2, by = sy - top;
    let label;
    if (seg.gate === 'finish') {
        const cols = 16, cw = bw / cols;
        for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111';
            ctx.fillRect(bx + c * cw, by + r * bh / 2, cw + 1, bh / 2 + 1);
        }
        label = 'META';
    } else {
        ctx.fillStyle = seg.gate === 'start' ? '#1fae4b' : '#ffb800';
        ctx.fillRect(bx, by, bw, bh);
        label = seg.gate === 'start' ? 'SALIDA' : 'CHECKPOINT';
    }
    if (bh > 12) {
        ctx.font = 'bold ' + Math.floor(bh * 0.6) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, bh * 0.1);
        ctx.strokeStyle = '#000';
        ctx.strokeText(label, sx, by + bh * 0.72);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, sx, by + bh * 0.72);
        ctx.textAlign = 'left';
    }
}

function renderWorld() {
    const segs = stage.segs, N = stage.N;
    const baseIdx = clamp(Math.floor(position / SEG_LEN), 0, N - 1);
    const base = segs[baseIdx];
    const basePercent = (position % SEG_LEN) / SEG_LEN;
    const pz = position + PLAYER_Z;
    const pIdx = clamp(Math.floor(pz / SEG_LEN), 0, N - 1);
    const pSeg = segs[pIdx];
    const pPct = (pz % SEG_LEN) / SEG_LEN;
    const playerY = pSeg.p1.world.y + (pSeg.p2.world.y - pSeg.p1.world.y) * pPct;

    let shakeX = 0, shakeY = 0;
    if (gameState === 'RUNNING' && speed > 20) {
        const rough = SURFACES[pSeg.surface].noiseG * 6 + (Math.abs(playerX) > 1.08 ? 1.2 : 0.2);
        const amt = (speed / VEHICLES[selVeh].top) * rough * 60;
        shakeX = (Math.random() - 0.5) * amt; shakeY = (Math.random() - 0.5) * amt;
    }
    const camX = playerX * ROAD_W + shakeX;
    const camY = playerY + CAM_H + shakeY;

    drawBackground();

    let maxy = HEIGHT, x = 0, dx = -(base.curve * basePercent);
    drawList.length = 0;
    for (let n = 0; n < DRAW_DIST; n++) {
        const idx = baseIdx + n;
        if (idx >= N) break;
        const seg = segs[idx];
        project(seg.p1, camX - x, camY, position);
        project(seg.p2, camX - x - dx, camY, position);
        x += dx; dx += seg.curve;
        seg.clip = maxy;
        if (seg.p1.camera.z <= CAM_DEPTH) continue;
        const fogA = 1 - 1 / Math.exp(Math.pow(n / DRAW_DIST, 2) * curTheme.fogD);
        drawList.push({ seg: seg, fog: fogA });
        if (seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
        drawSegment(seg, fogA);
        maxy = seg.p1.screen.y;
    }

    // Sprites de lejos a cerca
    for (let i = drawList.length - 1; i >= 0; i--) {
        const e = drawList[i], seg = e.seg;
        const sc = seg.p1.screen.scale, k = sc * WIDTH / 2;
        const sy = seg.p1.screen.y;
        const clipY = seg.clip;
        if (clipY <= 0) continue;
        if (seg.p1.camera.z < PLAYER_Z * 0.6) continue;
        const partial = sy > clipY + 0.5;
        const alpha = clamp(1 - e.fog, 0.05, 1);
        if (seg.gate) {
            if (partial) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, WIDTH, clipY); ctx.clip(); }
            ctx.globalAlpha = alpha;
            drawGate(seg, k, seg.p1.screen.x, sy);
            ctx.globalAlpha = 1;
            if (partial) ctx.restore();
        }
        for (let j = 0; j < seg.objs.length; j++) {
            const o = seg.objs[j];
            if (o.down) continue;
            const sx = seg.p1.screen.x + sc * o.offset * ROAD_W * WIDTH / 2;
            if (sx < -700 || sx > WIDTH + 700) continue;
            if (partial) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, WIDTH, clipY); ctx.clip(); }
            ctx.globalAlpha = alpha;
            drawObj(o, sx, sy, k);
            ctx.globalAlpha = 1;
            if (partial) ctx.restore();
        }
    }
    return { shakeX: shakeX, shakeY: shakeY };
}

function fitDims(img, boxW, boxH) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return { w: boxW, h: boxH };
    const ba = boxW / boxH, ia = img.naturalWidth / img.naturalHeight;
    return ia > ba ? { w: boxW, h: boxW / ia } : { w: boxH * ia, h: boxH };
}

function drawPlayerCar(shake) {
    const cW = 300, cH = 205;
    const bounce = (gameState === 'RUNNING' && speed > 5) ? Math.sin(stageTime * 16) * (speed / VEHICLES[selVeh].top) * 2.4 : 0;
    const lean = clamp(steerInput * 0.08 + vx * 0.02, -0.14, 0.14);
    const cX = WIDTH / 2 - cW / 2 + steerInput * 30 + shake.shakeX;
    const cY = HEIGHT - cH - 14 + shake.shakeY + bounce;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(WIDTH / 2 + steerInput * 30, HEIGHT - 16, cW * 0.42, 9, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(cX + cW / 2, cY + cH);
    ctx.rotate(lean);
    ctx.translate(-(cX + cW / 2), -(cY + cH));
    const img = carImgs[selVeh];
    if (img && img.complete && img.naturalWidth !== 0) {
        const d = fitDims(img, cW, cH);
        ctx.drawImage(img, cX + (cW - d.w) / 2, cY + (cH - d.h), d.w, d.h);
    } else {
        const col = ['#ff2a00', '#0066ff', '#ccaa00'][selVeh];
        ctx.fillStyle = '#0f0f14'; ctx.fillRect(cX + 6, cY + cH - 35, 24, 35); ctx.fillRect(cX + cW - 30, cY + cH - 35, 24, 35);
        ctx.fillStyle = col; ctx.fillRect(cX, cY + 25, cW, cH - 40);
        ctx.fillStyle = '#14161f'; ctx.fillRect(cX + 16, cY + 35, cW - 32, 25);
        ctx.fillStyle = keys.down ? '#ff1111' : '#660000'; ctx.fillRect(cX + 8, cY + cH - 28, 22, 10); ctx.fillRect(cX + cW - 30, cY + cH - 28, 22, 10);
    }
    ctx.restore();
}

function drawParticles(shake) {
    for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.65;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x + shake.shakeX, p.y + shake.shakeY, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawSnowfall() {
    if (!curTheme.snowfall || gameState === 'START') return;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const moving = gameState !== 'PAUSED';
    const wind = -bgX * 0.0; // el viento no depende de la curva para no marear
    for (const f of flakes) {
        if (moving) {
            f.y += f.s * STEP * (1 + speed / 260);
            f.x += Math.sin(f.y * 0.03 + f.r) * 0.4 - speed * 0.004 + wind;
            if (f.y > HEIGHT) { f.y = -4; f.x = Math.random() * WIDTH; }
            if (f.x < -4) f.x += WIDTH + 8;
        }
        ctx.fillRect(f.x, f.y, f.r, f.r);
    }
}

// ---- Minimapa (también se usa en el menú) ----
function drawMini(c, x, y, size, stg, playerSeg) {
    c.fillStyle = 'rgba(8, 14, 26, 0.85)';
    c.fillRect(x, y, size, size);
    c.strokeStyle = '#ffb800'; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, size - 2, size - 2);
    const pad = 12, span = size - pad * 2;
    const ox = x + pad + span * (1 - stg.mini.w) / 2, oy = y + pad + span * (1 - stg.mini.h) / 2;
    const pts = stg.mini.pts;
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
        const px = ox + pts[i].x * span, py = oy + pts[i].y * span;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    c.fillStyle = '#1fae4b';
    c.beginPath(); c.arc(ox + pts[0].x * span, oy + pts[0].y * span, 3.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(ox + pts[pts.length - 1].x * span, oy + pts[pts.length - 1].y * span, 3.5, 0, Math.PI * 2); c.fill();
    if (playerSeg >= 0) {
        const pi = clamp(Math.floor(playerSeg / 6), 0, pts.length - 1);
        c.fillStyle = '#ffb800'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(ox + pts[pi].x * span, oy + pts[pi].y * span, 5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
}

// ---- HUD ----
function txt(str, x, y, size, color, align, bold) {
    ctx.font = (bold === false ? '' : 'bold ') + size + 'px monospace';
    ctx.fillStyle = color; ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
}
function arrow(cx, cy, dir, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + dir * s, cy); ctx.lineTo(cx - dir * s * 0.6, cy - s * 0.9); ctx.lineTo(cx - dir * s * 0.6, cy + s * 0.9);
    ctx.closePath(); ctx.fill();
}

function drawPacenotes() {
    const notes = stage.notes;
    const rows = [];
    for (let k = 0; k < 3 && noteIdx + k < notes.length; k++) {
        const n = notes[noteIdx + k];
        const dist = (n.seg * SEG_LEN - (position + PLAYER_Z)) * M_PER_UNIT;
        if (dist > 450) break;
        rows.push({ n: n, dist: Math.max(0, dist) });
    }
    if (!rows.length) return;
    const px = WIDTH / 2 - 105, py = 10, rh = 27;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px, py, 210, rows.length * rh + 6);
    rows.forEach(function (r, i) {
        const y = py + 3 + i * rh + rh / 2;
        const g = r.n.grade;
        const col = g <= 2 ? '#ff5252' : g <= 4 ? '#ffb800' : '#6bff8a';
        const dim = i === 0 ? 1 : 0.65;
        ctx.globalAlpha = dim;
        arrow(px + 20, y, r.n.dir === 'R' ? 1 : -1, 9, col);
        txt(String(g), px + 48, y + 8, 22, col);
        const tag = (r.n.hairpin ? 'HORQ ' : '') + (r.n.long ? 'LARGA' : '');
        if (tag) txt(tag, px + 72, y + 5, 12, '#ffffff');
        txt(Math.round(r.dist / 10) * 10 + 'm', px + 200, y + 6, 16, '#ffffff', 'right');
        ctx.globalAlpha = 1;
    });
}

function drawHUD() {
    if (gameState === 'START') return;
    const veh = VEHICLES[selVeh];
    const seg = stage.segs[clamp(Math.floor((position + PLAYER_Z) / SEG_LEN), 0, stage.N - 1)];

    // Paneles de fondo para que el HUD se lea sobre cualquier paisaje
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(10, 8, 198, 94);
    ctx.fillRect(10, HEIGHT - 124, 160, 116);

    // Tiempos
    txt('ETAPA  ' + formatTime(stageTime), 20, 30, 20, '#ffffff');
    txt('LÍMITE ' + Math.ceil(Math.max(0, timeLeft)) + ' s', 20, 55, 20, timeLeft < 10 ? '#ff4d4d' : '#ffb800');
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, 66, 120, 6);
    ctx.fillStyle = damage > 66 ? '#ff4d4d' : damage > 33 ? '#ffb800' : '#6bff8a';
    ctx.fillRect(20, 66, 120 * damage / 100, 6);
    txt('DAÑO ' + Math.round(damage) + '%', 20, 90, 13, '#c8d2e0', 'left', false);

    // Minimapa + km restantes
    drawMini(ctx, WIDTH - 112, 12, 100, stage, seg.index);
    const remain = Math.max(0, (stage.finishSeg * SEG_LEN - (position + PLAYER_Z)) * M_PER_UNIT / 1000);
    ctx.fillStyle = 'rgba(8,14,26,0.85)';
    ctx.fillRect(WIDTH - 112, 112, 100, 38);
    txt(remain.toFixed(1) + ' km', WIDTH - 62, 129, 14, '#ffffff', 'center');
    txt('E' + (stageIdx + 1) + ' ' + stage.def.name.toUpperCase(), WIDTH - 62, 144, 9, '#c8d2e0', 'center', false);

    if (gameState !== 'COUNTDOWN') drawPacenotes();

    // Velocímetro
    txt(String(Math.floor(speed)), 20, HEIGHT - 30, 44, '#ffffff');
    txt('KM/H', 112, HEIGHT - 32, 14, '#9fb0c8', 'left', false);
    txt(SURFACES[seg.surface].name, 20, HEIGHT - 104, 15, '#ffb800');
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, HEIGHT - 22, 130, 7);
    ctx.fillStyle = rpm > veh.rpmMax * 0.9 ? '#ff4d4d' : '#ffb800';
    ctx.fillRect(20, HEIGHT - 22, 130 * clamp(rpm / veh.rpmMax, 0, 1), 7);
    txt('MARCHA ' + gear, 20, HEIGHT - 84, 15, '#c8d2e0', 'left', false);

    // Barra de progreso con checkpoints
    const bx = 250, bw = 300, by = HEIGHT - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx, by, bw, 4);
    const prog = clamp((position + PLAYER_Z) / (stage.finishSeg * SEG_LEN), 0, 1);
    ctx.fillStyle = '#ffb800'; ctx.fillRect(bx, by, bw * prog, 4);
    ctx.fillStyle = '#ffffff';
    stage.cps.forEach(function (c) { ctx.fillRect(bx + bw * c / stage.finishSeg - 1, by - 3, 2, 10); });

    // Cuenta regresiva y avisos
    if (gameState === 'COUNTDOWN') {
        const num = Math.ceil(countdown - 0.6);
        if (num >= 1) txt(String(num), WIDTH / 2, HEIGHT / 2 - 40, 90, '#ffb800', 'center');
    }
    if (popup.t > 0) {
        txt(popup.text, WIDTH / 2, HEIGHT / 2 - 60, 40, '#ffffff', 'center');
        if (popup.sub) txt(popup.sub, WIDTH / 2, HEIGHT / 2 - 24, 28, '#ffb800', 'center');
    }
    if (gameState === 'PAUSED') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
        txt('PAUSA', WIDTH / 2, HEIGHT / 2, 52, '#ffb800', 'center');
        txt('P / Esc: continuar  ·  M: música  ·  C: copiloto', WIDTH / 2, HEIGHT / 2 + 34, 15, '#ffffff', 'center', false);
    }
}

function renderFrame() {
    if (!stage) return;
    ctx.imageSmoothingEnabled = false;
    const shake = renderWorld();
    drawParticles(shake);
    if (gameState !== 'START') drawPlayerCar(shake);
    drawSnowfall();
    if (crashFlash > 0) {
        ctx.fillStyle = 'rgba(255, 30, 0, ' + ((crashFlash / 0.35) * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    drawHUD();
}

// ---------------------------------------------------------------------------
// LOOP PRINCIPAL (pasos fijos con acumulador: igual en cualquier navegador)
// ---------------------------------------------------------------------------
let _last = null, _acc = 0;
const MAX_STEPS = 5;
function masterLoop(now) {
    if (_last === null) _last = now;
    let d = (now - _last) / 1000;
    _last = now;
    if (d > 0.25) d = 0.25;
    _acc += d;
    let steps = 0;
    while (_acc >= STEP && steps < MAX_STEPS) { updatePhysics(STEP); _acc -= STEP; steps++; }
    renderFrame();
    requestAnimationFrame(masterLoop);
}

window.onload = function () {
    initInput();
    updateMenu();
    requestAnimationFrame(masterLoop);
};
