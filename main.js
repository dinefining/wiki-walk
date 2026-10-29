// Wiki Walk: a pixel forest of Wikipedia articles, walked through together.
(() => {
  'use strict';

  // Bump with index.html's ?v= tags when you publish changes, so browsers fetch fresh files.
  const VERSION = '2026-10-29f';
  const CFG = window.WIKIPARK_CONFIG || {};
  const $ = s => document.querySelector(s);
  const canvas = $('#world');
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  motionQuery.addEventListener && motionQuery.addEventListener('change', e => { reducedMotion = e.matches; });

  // ------------------------------------------------------------ storage ---

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ }
    },
  };

  // ------------------------------------------------------------ palette ---

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
  // ImageData pixels as little-endian uint32: 0xAABBGGRR
  const u32 = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const rgbOf = p => [p & 255, (p >> 8) & 255, (p >> 16) & 255];

  // Ground per biome mask (bit0 nature, bit1 technology, bit2 human): barely different.
  const GROUND = {
    0: hex('#009400'), 1: [0, 142, 0], 2: [4, 148, 10], 4: [6, 154, 0],
    3: [2, 145, 6], 5: [4, 149, 0], 6: [6, 152, 6], 7: [10, 158, 10],
  };
  // Terrain: elevation terraces nudge the green channel; features are flat blocks.
  const BAND_G = [-10, -6, -2, 2, 6, 10];
  const VEG = [0, 112, 4], VEG_DEEP = [0, 92, 4];
  const WATER = hex('#3476a8'), WATER_LIGHT = hex('#5496c8');
  const SAND = hex('#be9b65');
  const PATH = hex('#a08a5e'), BRIDGE = hex('#8a6a44');
  // Lily pads: p/P pad, f flower.
  const SCENERY_COLOURS = { p: '#4f8f3c', P: '#6aa84e', f: '#f2d6e8' };
  const SCENERY = { lilies: [['Pp', 'p.'], ['pP', '.p'], ['Pf', 'pp'], ['pPp', 'pp.']] };
  // Articles: a mix of pine green (nature), blue spruce (technology) and
  // heather (human individuality), in quarters. Flowers are paler, like
  // blossoms; trees darker, like canopies.
  const SET_COLOURS = [hex('#f4fc8c'), hex('#86e2fa'), hex('#eeaef4')]; // nature, technology, being human
  const SIZE_TONE = [0, 0, -0.08]; // cross, ring, diamond: diamonds a touch deeper
  const mixKey = a => (a[4] * 25 + a[5] * 5 + a[6]) * 3 + a[7];
  const ART_CSS = new Map(), ART_HOVER_CSS = new Map();
  for (let n = 0; n <= 4; n++) for (let t = 0; t <= 4 - n; t++) for (let size = 0; size < 3; size++) {
    const h = 4 - n - t;
    const tone = SIZE_TONE[size];
    const c = [0, 1, 2].map(k => {
      const v = (SET_COLOURS[0][k] * n + SET_COLOURS[1][k] * t + SET_COLOURS[2][k] * h) / 4;
      return Math.round(tone > 0 ? v + (255 - v) * tone : v * (1 + tone));
    });
    const key = (n * 25 + t * 5 + h) * 3 + size;
    ART_CSS.set(key, css(c));
    // Hover: one shade brighter.
    ART_HOVER_CSS.set(key, css(c.map(v => Math.min(255, Math.round(v + (255 - v) * 0.3 + 18)))));
  }
  // Lantern tiers, fresh to nearly faded (30 days).
  const LANTERN = ['#f5d142', '#d4b436', '#a88c28', '#7c681c'].map(hex);
  const LANTERN_CSS = LANTERN.map(css);
  const LANTERN_NIGHT_HALO = [hex('#5c4c14'), hex('#40340c'), hex('#2c2408'), hex('#201a04')];
  const WARM = new Set(LANTERN.map(u32));
  // Pale walker tints: cursors, and the tiny dot on squares a walker planted.
  const TINTS = ['#dcecff', '#e8dcff', '#d4fff0', '#f0f0f0', '#ffdcf4', '#dcfffa', '#ece4ff', '#e0ffe0'].map(hex).map(css);

  // Light levels: 0 day, 1-3 dusk/dawn steps, 4 night.
  const LEVEL_FACTOR = [1, 0.78, 0.56, 0.36, 0.15];
  // Golden hour, then a heather dusk, then blue twilight.
  const LEVEL_TINT = [[0, 0, 0], [22, 6, 0], [14, 0, 12], [0, 0, 14], [0, 0, 0]];
  const levelMaps = [null, new Map(), new Map(), new Map(), new Map()];
  function shift(p, level) {
    if (level === 0 || WARM.has(p)) return p;
    const m = levelMaps[level];
    let out = m.get(p);
    if (out === undefined) {
      const [r, g, b] = rgbOf(p);
      const f = LEVEL_FACTOR[level];
      const q = v => Math.min(255, Math.max(0, Math.round(v / 4) * 4));
      const [tr, tg, tb] = LEVEL_TINT[level];
      out = u32([q(r * f + tr), q(g * f + tg), q(b * f + tb)]);
      m.set(p, out);
    }
    return out;
  }

  // At night, what a light reaches looks lamp-lit, not like daylight: warm, and
  // dimmer in stepped tones away from the light (dithered between steps).
  const LAMP_FACTOR = [0.86, 0.64, 0.45, 0.29];
  const LAMP_TINT = [[12, 4, -6], [10, 3, -5], [7, 1, -3], [4, 0, -1]];
  const lampMaps = LAMP_FACTOR.map(() => new Map());
  function lamp(p, tone) {
    const m = lampMaps[tone];
    let out = m.get(p);
    if (out === undefined) {
      const [r, g, b] = rgbOf(p);
      const f = LAMP_FACTOR[tone], [tr, tg, tb] = LAMP_TINT[tone];
      const q = v => Math.min(255, Math.max(0, Math.round(v / 4) * 4));
      out = u32([q(r * f + tr), q(g * f + tg), q(b * f + tb)]);
      m.set(p, out);
    }
    return out;
  }

  // By day a lantern warms the ground around it in three round steps.
  const HALO_MIX = [0.42, 0.25, 0.12];
  const haloMaps = new Map();
  function warmth(p, v) {
    let m = haloMaps.get(v);
    if (!m) haloMaps.set(v, m = new Map());
    let out = m.get(p);
    if (out === undefined) {
      const [r, g, b] = rgbOf(p), L = LANTERN[Math.floor(v / 3)], k = HALO_MIX[v % 3];
      out = u32([0, 1, 2].map(c => Math.round([r, g, b][c] + (L[c] - [r, g, b][c]) * k)));
      m.set(p, out);
    }
    return out;
  }

  // At night everything outside a light is one flat, almost-black green.
  const NIGHT = [0, 20, 4];
  const NIGHT_U32 = u32(NIGHT);

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);

  // Cursor sprite, 5x7.
  // Other walkers: a clean pointer arrowhead, no tail.
  const ARROW = [
    '1.....',
    '11....',
    '111...',
    '1111..',
    '11111.',
    '111111',
    '11....',
    '1.....',
  ];

  // -------------------------------------------------------------- world ---

  let world = null;      // parsed world.json
  let ground = null;     // offscreen canvas, day colours
  let grid = null;       // spatial hash of article indices
  const titleIndex = new Map(); // title -> article index
  let taken = null;             // world pixels covered by a plant or the gap around it
  let spritePx = [];            // per size: [dx, dy] offsets from a plant's centre
  let terrainCells = null;      // per-block terrain codes from world.json
  let wallPattern = null;       // the forest wall beyond the world's edge
  const CELL = 32;
  let gridCols = 0;

  async function loadWorld() {
    const res = await fetch(`world.json?v=${VERSION}`);
    if (!res.ok) throw new Error(`world.json: HTTP ${res.status}`);
    world = await res.json();
    buildGrid();   // first, so the scenery drawn with the ground can keep clear of plants
    buildGround();
  }

  function regionAt(x, y) {
    let m = 0;
    world.circles.forEach(([cx, cy, r], i) => { if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) m |= 1 << i; });
    return m;
  }

  function buildGround() {
    const { w, h, block, gw, terrain, bands } = world;
    ground = document.createElement('canvas');
    ground.width = w; ground.height = h;
    const g = ground.getContext('2d');
    const img = g.createImageData(w, h);
    const px = new Uint32Array(img.data.buffer);
    // Ground colour = biome × terrace × moisture. Dry patches lean yellow,
    // damp ones blue-green, so the land shifts gently as you walk.
    const MOIST = [[12, 4, -4], [0, 0, 0], [-6, -6, 10]];
    const shade = ([r, gg, bb]) => u32([r, gg, bb].map(v => Math.max(0, Math.min(255, Math.round(v)))));
    const pal = new Uint32Array(8 * bands * 3), tuftLight = new Uint32Array(pal.length), tuftDark = new Uint32Array(pal.length), moss = new Uint32Array(pal.length);
    for (let m = 0; m < 8; m++) for (let b = 0; b < bands; b++) for (let k = 0; k < 3; k++) {
      const [r, gg, bb] = GROUND[m], [mr, mg, mb] = MOIST[k], i = (m * bands + b) * 3 + k;
      const base = [r + mr, gg + BAND_G[b] + mg, bb + mb];
      pal[i] = shade(base);
      tuftLight[i] = shade([base[0], base[1] + 14, base[2]]);
      tuftDark[i] = shade([base[0], base[1] - 12, base[2]]);
      moss[i] = shade([base[0] - 4, base[1] - 22, base[2] + 2]);
    }
    const PEBBLE = u32(hex('#9aa08e')), PEBBLE_DARK = u32(hex('#7c8274'));
    // Water is drawn flat here; small moving glints are added each frame.
    // Features: 1-2 thicket, 3-4 water, 5 sand, 6 path, 7 bridge.
    const featPal = [0, u32(VEG), u32(VEG_DEEP), u32(WATER), u32(WATER), u32(SAND), u32(PATH), u32(BRIDGE)];
    const PATH_LIGHT = u32(hex('#b29c6e')), PATH_DARK = u32(hex('#8c7650')), PLANK_GAP = u32(hex('#6c5034'));
    const wallPal = [u32(VEG_DEEP), u32([0, 78, 6]), u32([0, 66, 10]), u32(VEG_DEEP)];
    const cells = terrainCells = new Uint8Array(terrain.length);
    const alphabet = world.terrainAlphabet || '0123456789abcdefghijklmnopqrstuvwxyz';
    const code = {};
    [...alphabet].forEach((ch, i) => { code[ch] = i; });
    for (let i = 0; i < terrain.length; i++) cells[i] = code[terrain[i]];
    // Moisture per block, from two layers of smooth noise.
    const moisture = new Uint8Array(cells.length);
    for (let by = 0; by < world.gh; by++) for (let bx = 0; bx < gw; bx++) {
      const v = valueNoise(bx / 22, by / 22, 11) * 0.65 + valueNoise(bx / 7, by / 7, 12) * 0.35;
      moisture[by * gw + bx] = v < 0.4 ? 0 : v > 0.6 ? 2 : 1;
    }
    const c = world.circles;
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / block) * gw;
      for (let x = 0; x < w; x++) {
        const ci = row + Math.floor(x / block);
        const cell = cells[ci];
        const feat = Math.floor(cell / bands);
        if (feat && feat !== 8) {
          let col = featPal[feat];
          // Paths: packed earth with lighter and darker grit.
          if (feat === 6) { const t = hash3(x, y, 21); col = t < 0.12 ? PATH_LIGHT : t < 0.22 ? PATH_DARK : col; }
          px[y * w + x] = col;
          continue;
        }
        let m = 0;
        for (let i = 0; i < c.length; i++) {
          const dx = x - c[i][0], dy = y - c[i][1];
          if (dx * dx + dy * dy < c[i][2] * c[i][2]) m |= 1 << i;
        }
        const k = moisture[ci];
        const base = (m * bands + (cell % bands)) * 3 + k;
        // Texture: grass tufts everywhere, pebbles now and then, moss in damp ground.
        const t = hash3(x, y, 1);
        let col = t < 0.022 ? tuftLight[base] : t < 0.034 ? tuftDark[base] : pal[base];
        const pb = hash3(x, y, 9);
        if (pb < 0.0016) col = PEBBLE;
        else if (pb < 0.0026) col = PEBBLE_DARK;
        else if (k === 2 && hash3(x >> 1, y >> 1, 13) < 0.05) col = moss[base];
        // Where a trail fades out, earth and grass mix pixel by pixel.
        if (feat === 8) { const f = hash3(x, y, 23); if (f < 0.42) col = f < 0.06 ? PATH_DARK : featPal[6]; }
        px[y * w + x] = col;
      }
    }
    addScenery(px, w, h);
    // A ragged band of forest wall along the world's edge.
    for (let by = 0; by < world.gh; by++) for (let bx = 0; bx < gw; bx++) {
      const d = Math.min(bx, by, gw - 1 - bx, world.gh - 1 - by);
      if (d > 3 || hash3(bx, by, 7) > 1 - d / 4) continue;
      const c = wallPal[Math.floor(hash3(bx, by, 3) * wallPal.length)];
      for (let y = by * block; y < by * block + block; y++) px.fill(c, y * w + bx * block, y * w + bx * block + block);
    }
    g.putImageData(img, 0, 0);

    // Beyond the edge: the same wall as a repeating tile.
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const tc = tile.getContext('2d');
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      tc.fillStyle = css(rgbOf(wallPal[Math.floor(hash3(bx, by, 5) * wallPal.length)]));
      tc.fillRect(bx * 4, by * 4, 4, 4);
    }
    wallPattern = ctx.createPattern(tile, 'repeat');
  }

  // Lily pads on the water: scenery, never clickable. Placed from a fixed seed
  // so everyone sees the same.
  function addScenery(px, w, h) {
    const rng = seeded(777);
    const featAt = (x, y) => {
      const bx = Math.floor(x / world.block), by = Math.floor(y / world.block);
      if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) return -1;
      return Math.floor(terrainCells[by * world.gw + bx] / world.bands);
    };
    const colours = {};
    for (const [k, v] of Object.entries(SCENERY_COLOURS)) colours[k] = u32(hex(v));
    // Fits if every pixel (plus a one-pixel margin) is free and on allowed ground.
    const fits = (rows, x0, y0, allowed) => {
      for (let y = -1; y <= rows.length; y++) for (let x = -1; x <= rows[0].length; x++) {
        const X = x0 + x, Y = y0 + y;
        if (X < 8 || Y < 8 || X >= w - 8 || Y >= h - 8 || taken[Y * w + X]) return false;
        const inside = y >= 0 && x >= 0 && y < rows.length && x < rows[0].length && rows[y][x] !== '.';
        if (inside && !allowed(featAt(X, Y))) return false;
      }
      return true;
    };
    const put = (rows, x0, y0, claim) => {
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '.') return;
        px[(y0 + y) * w + x0 + x] = colours[ch];
        if (claim) taken[(y0 + y) * w + x0 + x] = 1;
      }));
    };
    const scatter = (count, tries, pick, allowed, claim) => {
      for (let n = 0, t = 0; n < count && t < tries; t++) {
        const rows = pick();
        const x = Math.floor(16 + rng() * (w - 32)), y = Math.floor(16 + rng() * (h - 32));
        if (!fits(rows, x, y, allowed)) continue;
        put(rows, x, y, claim);
        n++;
      }
    };
    const wet = f => f === 3 || f === 4;
    scatter(260, 60000, () => SCENERY.lilies[Math.floor(rng() * SCENERY.lilies.length)], wet, false);
  }

  function buildGrid() {
    gridCols = Math.ceil(world.w / CELL);
    grid = new Map();
    taken = new Uint8Array(world.w * world.h);
    spritePx = world.sprites.map(rows => {
      const half = (rows.length - 1) / 2, px = [];
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') px.push([x - half, y - half]); }));
      return px;
    });
    world.articles.forEach((a, i) => indexArticle(i));
  }

  // Articles: [title, mask, centreX, centreY, n, t, h, size(, planterTint)]
  // Half the width of a plant's shape, plus one: just outside its edge.
  const halfOf = a => (world.sprites[a[7]].length - 1) / 2 + 1;

  function indexArticle(i) {
    const a = world.articles[i];
    titleIndex.set(a[0], i);
    for (const [dx, dy] of spritePx[a[7]]) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = a[2] + dx + ox, y = a[3] + dy + oy;
      if (x >= 0 && y >= 0 && x < world.w && y < world.h) taken[y * world.w + x] = 1;
    }
    const k = Math.floor(a[2] / CELL) + Math.floor(a[3] / CELL) * gridCols;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  function articlesIn(x0, y0, x1, y1, cb) {
    const cx0 = Math.max(0, Math.floor((x0 - 4) / CELL)), cy0 = Math.max(0, Math.floor((y0 - 4) / CELL));
    const cx1 = Math.floor((x1 + 4) / CELL), cy1 = Math.floor((y1 + 4) / CELL);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1 && cx < gridCols; cx++) {
      const list = grid.get(cx + cy * gridCols);
      if (list) for (const i of list) cb(i, world.articles[i]);
    }
  }

  function articleAt(wx, wy) {
    let hit = -1;
    articlesIn(wx, wy, wx, wy, (i, a) => {
      const h = halfOf(a) - 1;
      if (Math.abs(wx - a[2]) <= h && Math.abs(wy - a[3]) <= h) hit = i;
    });
    return hit;
  }

  function nearestArticle(wx, wy, maxD) {
    let best = -1, bd = maxD * maxD;
    articlesIn(wx - maxD, wy - maxD, wx + maxD, wy + maxD, (i, a) => {
      const d = (a[2] - wx) ** 2 + (a[3] - wy) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ------------------------------------------------------------- camera ---

  let scale = 6, vw = 0, vh = 0;
  const cam = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const pointer = { x: null, y: null, inside: false, touch: false }; // screen px
  let frame = null, lightBuf = null, warmBuf = null, toneBuf = null, haloBuf = null;

  function resize() {
    // About 75 world pixels across the short side of the screen: a walker's view, not a map.
    scale = Math.max(6, Math.round(Math.min(innerWidth, innerHeight) / 75));
    vw = Math.ceil(innerWidth / scale) + 1;
    vh = Math.ceil(innerHeight / scale) + 1;
    canvas.width = vw; canvas.height = vh;
    canvas.style.width = `${vw * scale}px`;
    canvas.style.height = `${vh * scale}px`;
    lightBuf = new Float32Array(vw * vh);
    resizePeople();
    warmBuf = new Int8Array(vw * vh);
    toneBuf = new Float32Array(vw * vh);
    haloBuf = new Int8Array(vw * vh);
    ctx.imageSmoothingEnabled = false;
    clampTarget();
  }

  // You can look a little past the world's edge, where a wall of dense forest
  // shows that this is as far as the forest goes. Returns true if clamped.
  function clampTarget() {
    if (!world) return false;
    const viewW = innerWidth / scale, viewH = innerHeight / scale;
    const pad = Math.round(Math.min(viewW, viewH) * 0.3);
    const x = Math.min(world.w - viewW + pad, Math.max(-pad, target.x));
    const y = Math.min(world.h - viewH + pad, Math.max(-pad, target.y));
    const hit = x !== target.x || y !== target.y;
    target.x = x; target.y = y;
    return hit;
  }

  function centerOn(x, y) {
    target.x = x - innerWidth / scale / 2;
    target.y = y - innerHeight / scale / 2;
    clampTarget();
    cam.x = target.x; cam.y = target.y;
  }

  // The visitor's position in the world: the mouse, or the middle of the view on touch.
  function myWorldPos() {
    if (pointer.inside && !pointer.touch && pointer.x != null) {
      return { x: cam.x + pointer.x / scale, y: cam.y + pointer.y / scale };
    }
    return { x: cam.x + innerWidth / scale / 2, y: cam.y + innerHeight / scale / 2 };
  }

  // -------------------------------------------------------- time of day ---

  // For now it's always night. Set to false to bring back the day, which
  // follows the visitor's local time.
  const ALWAYS_NIGHT = true;
  let levelOverride = null;
  const OVERRIDES = [null, 0, 2, 4];
  const OVERRIDE_NAMES = ['time: local', 'time: day', 'time: dusk', 'time: night'];

  function autoLevel(now = new Date()) {
    const start = new Date(now.getFullYear(), 0, 0);
    const doy = (now - start) / 864e5;
    const season = Math.cos(2 * Math.PI * (doy - 172) / 365); // 1 at midsummer
    const duskStart = 18.75 + 1.25 * season; // ~20:00 in June, ~17:30 in December
    const dawnStart = 6.0 - 0.75 * season;   // ~05:15 in June, ~06:45 in December
    const h = now.getHours() + now.getMinutes() / 60;
    if (h >= duskStart && h < duskStart + 1) return Math.min(4, 1 + Math.floor((h - duskStart) * 4));
    if (h >= dawnStart && h < dawnStart + 1) return 3 - Math.floor((h - dawnStart) * 4);
    if (h >= duskStart + 1 || h < dawnStart) return 4;
    return 0;
  }

  let level = 0;
  function updateLevel() {
    level = levelOverride != null ? levelOverride : ALWAYS_NIGHT ? 4 : autoLevel();
    const bg = level === 0 ? GROUND[0] : level === 4 ? NIGHT : rgbOf(shift(u32(GROUND[0]), level));
    document.body.style.backgroundColor = css(bg);
    updateClock();
  }

  // ----------------------------------------------------------- lanterns ---

  const LANTERN_DAYS = 30;
  const lanterns = new Map(); // id -> { id, article_title, x, y, created_at }
  let lanternGroups = [];     // aggregated by article position

  // Lanterns on things that aren't plants (a well, the owl, the ancient tree)
  // are titled with this mark and stay where they were left.
  const SPOT_MARK = '✦ ';
  const spotName = title => title.startsWith(SPOT_MARK) ? title.slice(SPOT_MARK.length) : title;

  function addLantern(l) {
    if (!l || !l.article_title) return;
    const id = l.id != null ? String(l.id) : `local-${l.article_title}-${l.created_at}`;
    if (l.article_title.startsWith(SPOT_MARK)) {
      const x = Number(l.x), y = Number(l.y);
      if (!(x >= 0 && y >= 0 && x < world.w && y < world.h)) return;
      lanterns.set(id, { ...l, id, x, y, size: 1 });
    } else {
      // Plants: anchored by title, so lanterns survive a rebuilt world.json.
      const i = titleIndex.get(l.article_title);
      if (i === undefined) return;
      const a = world.articles[i];
      lanterns.set(id, { ...l, id, x: a[2], y: a[3], size: a[7] });
    }
    groupLanterns();
  }

  function groupLanterns() {
    const now = Date.now();
    const groups = new Map();
    for (const l of lanterns.values()) {
      const age = (now - new Date(l.created_at).getTime()) / 864e5;
      if (age >= LANTERN_DAYS) continue;
      const strength = 1 - Math.max(0, age) / LANTERN_DAYS;
      const k = `${l.x},${l.y}`;
      const g = groups.get(k) || { x: +l.x, y: +l.y, size: l.size || 0, sum: 0, fresh: 0 };
      g.sum += strength;
      g.fresh = Math.max(g.fresh, strength);
      groups.set(k, g);
    }
    lanternGroups = [...groups.values()].map(g => ({
      ...g,
      tier: Math.min(3, Math.floor((1 - g.fresh) * 4)),
      r: g.size + 3 + Math.min(4, Math.floor(Math.sqrt(g.sum) * 1.5)),
    }));
  }

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function dailyLeft(key, max) {
    const s = store.get(key, null);
    return s && s.day === todayKey() ? Math.max(0, max - s.used) : max;
  }
  function spendDaily(key, max) {
    store.set(key, { day: todayKey(), used: max - dailyLeft(key, max) + 1 });
  }

  function loadLocalLanterns() {
    const list = store.get('wikipark.lanterns', []);
    const cutoff = Date.now() - LANTERN_DAYS * 864e5;
    const fresh = list.filter(l => new Date(l.created_at).getTime() > cutoff);
    if (fresh.length !== list.length) store.set('wikipark.lanterns', fresh);
    fresh.forEach(addLantern);
  }

  // Lanterns you left, so you can take them back: id -> secret. With Supabase
  // only a hash of the secret is stored, and the remove_lantern function checks it.
  const mine = new Map(Object.entries(store.get('wikipark.mine', {})));
  const saveMine = () => store.set('wikipark.mine', Object.fromEntries(mine));

  function myLanternOn(title) {
    for (const l of lanterns.values()) if (l.article_title === title && mine.has(l.id)) return l;
    return null;
  }

  async function sha256hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // spot: { title, x, y }, a plant or a special place.
  async function leaveLantern(spot) {
    const row = { article_title: spot.title, x: Math.round(spot.x), y: Math.round(spot.y) };
    const created = new Date().toISOString();
    if (net.client) {
      const secret = newId();
      const { data, error } = await net.client.from('lanterns')
        .insert({ ...row, secret_hash: await sha256hex(secret) })
        .select('id, article_title, x, y, created_at').single();
      if (error) {
        console.warn('Wiki Walk: lantern not saved', error);
        const id = `local-${Date.now()}`;
        mine.set(id, 'local');
        addLantern({ ...row, id, created_at: created });
      } else {
        mine.set(String(data.id), secret);
        addLantern(data);
      }
    } else {
      const l = { ...row, id: `local-${Date.now()}`, created_at: created };
      store.set('wikipark.lanterns', store.get('wikipark.lanterns', []).concat(l));
      mine.set(l.id, 'local');
      addLantern(l);
    }
    saveMine();
    updateLanternButton();
  }

  async function takeBackLantern(l) {
    const secret = mine.get(l.id);
    if (net.client && !l.id.startsWith('local-')) {
      const { data, error } = await net.client.rpc('remove_lantern', { lantern_id: Number(l.id), secret });
      if (error || !data) { toast('that lantern could not be taken back'); return; }
    } else {
      store.set('wikipark.lanterns', store.get('wikipark.lanterns', []).filter(x => String(x.id) !== l.id));
    }
    lanterns.delete(l.id);
    mine.delete(l.id);
    saveMine();
    groupLanterns();
    updateLanternButton();
  }

  // L or the card's lantern icon: leave one, or take back your own.
  const spotOf = i => ({ title: world.articles[i][0], x: world.articles[i][2], y: world.articles[i][3] });
  // Three lanterns a day. Counted from your own lanterns left today, so taking
  // one back gives it back to you.
  const DAILY_LANTERNS = 3;
  function lanternsLeftToday() {
    const today = new Date().toDateString();
    let used = 0;
    for (const id of mine.keys()) {
      const l = lanterns.get(id);
      if (l && new Date(l.created_at).toDateString() === today) used++;
    }
    return Math.max(0, DAILY_LANTERNS - used);
  }
  function toggleLantern(spot) {
    const own = myLanternOn(spot.title);
    if (own) { takeBackLantern(own); toast(`lantern taken back: ${spotName(spot.title)}`); return; }
    const left = lanternsLeftToday();
    if (!left) { toast('you have left your three lanterns for today'); return; }
    leaveLantern(spot);
    toast(`lantern left: ${spotName(spot.title)} · ${left - 1} left today`);
  }

  // ----------------------------------------------------------- planting ---
  // Walkers can leave one new article a day on open ground. Planted squares
  // carry a tiny dot in their planter's tint and stay in the forest.

  const DAILY_PLANTS = 1;
  const plantsLeft = () => dailyLeft('wikipark.planted', DAILY_PLANTS);
  const KEYWORDS = [
    /ecolog|biolog|botan|plant|flower|animal|species|fung|myco|lichen|moss|tree|forest|river|lake|wetland|soil|bird|insect|etholog|zoolog|flora|fauna|habitat|conservation|biodiversity|evolution|organism|pollinat|marine|ocean|nature|natural|environment|climate|geolog|landform|weather|agricultur|garden/i,
    /comput|software|technolog|robot|electronic|engineer|internet|online|digital|energy|sensor|algorithm|artificial intelligence|machine|programm|network|data|device|video game|telecommunic|hardware|web|electric|solar|wind power|invent|synthesi[sz]er|graphics|cyber|virtual|information/i,
    /psycholog|emotion|identity|memory|perception|cognit|personality|self|craft|\bart|artist|play|hobb|creativ|imagination|sense|philosoph|culture|social|music|mind|conscious|aesthetic|design|toy|sport|textile|folk|human|wellbeing|well-being|spiritual|literature|writing/i,
  ];

  // Every pixel of the plant on open ground or thicket, inside the world, not taken.
  function spotFree(cx, cy, size) {
    for (const [dx, dy] of spritePx[size]) {
      const x = cx + dx, y = cy + dy;
      if (x < 2 || y < 2 || x >= world.w - 2 || y >= world.h - 2 || taken[y * world.w + x]) return false;
      const cell = terrainCells[Math.floor(y / world.block) * world.gw + Math.floor(x / world.block)];
      if (Math.floor(cell / world.bands) > 2) return false;
      if (besideTrail(x, y)) return false;
    }
    return true;
  }
  // Within a block of a trail: plants keep a strip of grass beside every path.
  function besideTrail(x, y) {
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-4, -4], [4, 4], [-4, 4], [4, -4]]) {
      const bx = Math.floor((x + dx) / world.block), by = Math.floor((y + dy) / world.block);
      if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) continue;
      const f = Math.floor(terrainCells[by * world.gw + bx] / world.bands);
      if (f === 6 || f === 8) return true;
    }
    return false;
  }

  function addPlanting(p) {
    if (!p || !p.article_title || titleIndex.has(p.article_title)) return -1;
    const x = Number(p.x) | 0, y = Number(p.y) | 0;
    const mix = [p.n, p.t, p.h].map(Number);
    const size = [0, 1, 2].includes(Number(p.size)) ? Number(p.size) : 0;
    if (!spotFree(x, y, size)) return -1;
    if (mix.some(v => !(v >= 0 && v <= 4)) || mix[0] + mix[1] + mix[2] !== 4) return -1;
    const tint = Math.abs(Number(p.tint) | 0) % TINTS.length;
    world.articles.push([p.article_title, regionAt(x, y), x, y, ...mix, size, tint]);
    indexArticle(world.articles.length - 1);
    plantedCount++;
    updateStats();
    return world.articles.length - 1;
  }

  function loadLocalPlantings() {
    store.get('wikipark.plantings', []).forEach(addPlanting);
  }

  function summaryUrl(title) {
    return `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }

  // A title or an English Wikipedia link -> the article's canonical title.
  async function resolveArticle(input) {
    let t = input.trim();
    const m = t.match(/^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i);
    if (m) t = decodeURIComponent(m[1]);
    else if (/^https?:\/\//i.test(t)) throw new Error('only English Wikipedia links grow here');
    t = t.replace(/_/g, ' ').trim();
    if (!t) throw new Error('type a title first');
    const r = await fetch(summaryUrl(t));
    if (r.status === 404) throw new Error('no article by that name');
    if (!r.ok) throw new Error('Wikipedia did not answer, try again');
    const d = await r.json();
    if (d.type === 'disambiguation') throw new Error('that title has many meanings, pick one');
    if (d.namespace && d.namespace.id !== 0) throw new Error('only articles can be planted');
    return (d.titles && d.titles.normalized) || d.title;
  }

  // What may grow (the same rules as prepare.js): a real, substantial article.
  // People and companies only when their categories bridge at least two of
  // the themes.
  const MIN_BYTES = 4000;
  const STUB = /stubs?$|stub articles/i;
  const MANY_MEANINGS = /set index|disambiguation/i;
  const PERSON = /\b(births|deaths)$|^living people$|^people from/i;
  const COMPANY = /companies|^brands$/i;
  const THEMES = [
    /ecolog|botan|zoolog|ornitholog|entomolog|mycolog|herpetolog|biolog|naturalist|conservation|environmental|etholog|wildlife|forestry|bioacoustic|evolutionary|primatolog|marine scien|ecosystem|biodiversity/i,
    /comput|robot|artificial intelligence|engineer|software|electronic|internet|digital|sensor|cybernetic|programm|hardware|wearable|information technolog|human–computer|virtual reality/i,
    /psycholog|cognitiv|neuroscien|philosoph|perception|consciousness|emotion|identity|crafts|craftspeople|artists|new media|installation art|sound art|designers|creativity/i,
  ];
  const NOISE = /records artists|internet memes|internet[- ]related controversies|internet culture|internet characters|internet properties|internet celebrities|youtubers|streamers|vtubers|retailers/i;
  function bridgesThemes(cats) {
    const own = cats.filter(c => !PERSON.test(c) && !COMPANY.test(c) && !NOISE.test(c));
    return [0, 1, 2].filter(k => own.some(c => THEMES[k].test(c))).length >= 2;
  }
  function whyNotHere(title, page, cats) {
    if (/^(List|Lists|Index|Outline|Glossary|Timeline|Bibliography) of|\bin popular culture\b/i.test(title)) return 'lists don\'t grow here, only articles';
    if ((page && page.pageprops && 'disambiguation' in page.pageprops) || cats.some(c => MANY_MEANINGS.test(c))) return 'that title has many meanings, pick one';
    if (cats.some(c => STUB.test(c)) || ((page && page.length) || 0) < MIN_BYTES) return 'that article is still a seedling, too short to grow here';
    const person = cats.some(c => PERSON.test(c)), company = cats.some(c => COMPANY.test(c));
    if ((person || company) && !bridgesThemes(cats)) {
      return `${person ? 'people' : 'companies'} grow here only when their work bridges nature, technology and human individuality`;
    }
    return null;
  }

  // Colour from the article's categories (nudged by the biome it's planted in),
  // size from its length. Throws if the article may not grow here.
  async function plantTraits(title, x, y) {
    const region = regionAt(x, y);
    let page = null, cats = [];
    try {
      const u = `https://en.wikipedia.org/w/api.php?action=query&prop=categories|info|pageprops&ppprop=disambiguation&redirects=1&titles=${encodeURIComponent(title)}&cllimit=max&clshow=!hidden&format=json&formatversion=2&origin=*`;
      const d = await fetch(u).then(r => r.json());
      page = d.query && d.query.pages && d.query.pages[0];
      cats = ((page && page.categories) || []).map(c => c.title.replace(/^Category:/, ''));
    } catch (e) {
      throw new Error('Wikipedia did not answer, try again');
    }
    const why = whyNotHere(title, page, cats);
    if (why) throw new Error(why);
    const length = (page && page.length) || 0;
    const text = [title, ...cats];
    let score = [0, 1, 2].map(k => (region & (1 << k) ? 1.5 : 0) + text.filter(t => KEYWORDS[k].test(t)).length);
    if (!score.some(Boolean)) score = [1, 1, 1];
    const sum = score[0] + score[1] + score[2];
    const raw = score.map(v => (v / sum) * 4);
    const q = raw.map(Math.floor);
    let left = 4 - q[0] - q[1] - q[2];
    raw.map((v, k) => [v - q[k], k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { q[k]++; left--; } });
    // Same shapes as prepare.js: a ring where themes mix, a diamond if long, else a cross.
    const size = q.filter(Boolean).length > 1 ? 1 : length >= world.diamondBytes ? 2 : 0;
    return { mix: q, size };
  }

  // -------------------------------------------------------------- people --

  const newId = () => (crypto.randomUUID && crypto.randomUUID()) || `w${Math.random().toString(36).slice(2)}${Date.now()}`;
  const myId = newId(); // per tab, for presence
  // Per visitor, so your tint (cursor and planted dots) stays the same between visits.
  const visitorId = store.get('wikipark.visitor', null) || newId();
  store.set('wikipark.visitor', visitorId);
  const others = new Map(); // id -> { x, y, tx, ty, last, tint }
  const net = { client: null, channel: null, lastSend: 0, lastX: null, lastY: null };

  function tintIndex(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) % TINTS.length;
  }
  const myTint = tintIndex(visitorId);

  function receiveCursor(p) {
    if (!p || p.id === myId || typeof p.x !== 'number' || typeof p.y !== 'number') return;
    let o = others.get(p.id);
    if (!o) {
      const c = Number.isInteger(p.c) && p.c >= 0 && p.c < TINTS.length ? p.c : tintIndex(p.id);
      o = { x: p.x, y: p.y, tx: p.x, ty: p.y, tint: TINTS[c] };
      others.set(p.id, o);
    }
    o.tx = p.x; o.ty = p.y; o.last = performance.now();
  }

  function sendCursor(now) {
    if (!net.channel || !net.ready) return;
    const p = myWorldPos();
    const x = Math.round(p.x * 10) / 10, y = Math.round(p.y * 10) / 10;
    const moved = x !== net.lastX || y !== net.lastY;
    if ((moved && now - net.lastSend >= 100) || now - net.lastSend >= 2000) {
      net.lastSend = now; net.lastX = x; net.lastY = y;
      net.channel.send({ type: 'broadcast', event: 'cursor', payload: { id: myId, x, y, c: myTint } });
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function connect() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      loadLocalPlantings();
      loadLocalLanterns();
      return;
    }
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
      const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 20 } },
      });
      net.client = sb;

      // Plantings first, so lanterns on planted articles find their square.
      const planted = await sb.from('plantings').select('*').order('created_at').limit(20000);
      if (planted.error) console.warn('Wiki Walk: no plantings table yet', planted.error);
      else planted.data.forEach(addPlanting);
      sb.channel('wikipark-plantings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plantings' }, p => addPlanting(p.new))
        .subscribe();

      const since = new Date(Date.now() - LANTERN_DAYS * 864e5).toISOString();
      const { data, error } = await sb.from('lanterns').select('*').gte('created_at', since).limit(10000);
      if (error) throw error;
      data.forEach(addLantern);

      sb.channel('wikipark-lanterns')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lanterns' }, p => addLantern(p.new))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'lanterns' }, p => {
          if (p.old && p.old.id != null && lanterns.delete(String(p.old.id))) { groupLanterns(); updateLanternButton(); }
        })
        .subscribe();

      const ch = sb.channel('wikipark-walk', { config: { broadcast: { self: false }, presence: { key: myId } } });
      ch.on('broadcast', { event: 'cursor' }, ({ payload }) => receiveCursor(payload))
        .on('presence', { event: 'leave' }, ({ key }) => others.delete(key))
        .on('presence', { event: 'sync' }, () => {
          onlineCount = Math.max(1, Object.keys(ch.presenceState()).length);
          updateStats();
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') { net.ready = true; ch.track({ since: Date.now() }); }
        });
      net.channel = ch;
    } catch (e) {
      console.warn('Wiki Walk: could not reach Supabase, walking solo.', e);
      net.client = null; net.channel = null;
      loadLocalPlantings();
      loadLocalLanterns();
    }
  }

  // ------------------------------------------------------------- render ---

  let hovered = -1;

  function render(now) {
    const ix = Math.floor(cam.x), iy = Math.floor(cam.y);
    const fx = cam.x - ix, fy = cam.y - iy;
    canvas.style.transform = `translate3d(${-Math.round(fx * scale)}px, ${-Math.round(fy * scale)}px, 0)`;

    // Ground, with the forest wall beyond the edge.
    wallPattern.setTransform(new DOMMatrix([1, 0, 0, 1, -ix, -iy]));
    ctx.fillStyle = wallPattern;
    ctx.fillRect(0, 0, vw, vh);
    const sx = Math.max(0, ix), sy = Math.max(0, iy);
    const ex = Math.min(world.w, ix + vw), ey = Math.min(world.h, iy + vh);
    if (ex > sx && ey > sy) ctx.drawImage(ground, sx, sy, ex - sx, ey - sy, sx - ix, sy - iy, ex - sx, ey - sy);

    const night = level === 4;
    const ft = reducedMotion ? 0 : now; // animation time; frozen with reduced motion

    // Water glints: short ripples drifting downstream and blinking.
    drawGlints(ix, iy, ft);

    // Articles, grouped by colour to keep fillStyle changes low.
    const byColour = new Map();
    articlesIn(ix, iy, ix + vw, iy + vh, (i, a) => {
      const fill = (i === hovered ? ART_HOVER_CSS : ART_CSS).get(mixKey(a));
      if (!byColour.has(fill)) byColour.set(fill, []);
      byColour.get(fill).push(a);
    });
    for (const [fill, list] of byColour) {
      ctx.fillStyle = fill;
      for (const a of list) {
        const x = a[2] - ix, y = a[3] - iy;
        for (const [dx, dy] of spritePx[a[7]]) ctx.fillRect(x + dx, y + dy, 1, 1);
      }
    }
    // Planted articles: a tiny dot in the planter's tint, just off the top-right corner.
    for (const list of byColour.values()) for (const a of list) {
      if (a[8] === undefined) continue;
      const h = halfOf(a);
      ctx.fillStyle = TINTS[a[8]];
      ctx.fillRect(a[2] + h - ix, a[3] - h - iy, 1, 1);
    }
    // The spot you're about to plant on: a checkered ghost flower in your tint.
    if (plantSpot) {
      ctx.fillStyle = TINTS[myTint];
      for (const [dx, dy] of spritePx[2]) {
        if ((dx + dy) % 2 === 0) ctx.fillRect(plantSpot.x + dx - ix, plantSpot.y + dy - iy, 1, 1);
      }
    }

    drawSecrets(ix, iy, ft);

    // Lanterns: a warm pixel in the article, and a sparse dithered glow by day.
    const visibleLanterns = [];
    for (const g of lanternGroups) {
      const lx = g.x - ix, ly = g.y - iy;
      const reach = g.r + 4;
      if (lx < -reach || ly < -reach || lx > vw + reach || ly > vh + reach) continue;
      visibleLanterns.push(g);
      // The lantern itself: a small warm cross at the plant's heart.
      ctx.fillStyle = LANTERN_CSS[Math.min(3, g.tier + 1)];
      ctx.fillRect(lx - 1, ly, 3, 1);
      ctx.fillRect(lx, ly - 1, 1, 3);
      ctx.fillStyle = LANTERN_CSS[g.tier];
      ctx.fillRect(lx, ly, 1, 1);
    }

    // Pixel pass. By day and dusk: lantern halos, the palette shift and the
    // walker's wide circle of view. At night: dithered pools of light.
    {
      const img = ctx.getImageData(0, 0, vw, vh);
      const px = new Uint32Array(img.data.buffer);
      if (!night) {
        // Lantern halos: the ground warms in stepped, perfectly round rings that breathe.
        haloBuf.fill(-1);
        for (const g of visibleLanterns) {
          const r = g.r + 1 + Math.sin(ft / 900 + g.x) * 0.8;
          const cx = g.x + 0.5 - ix, cy = g.y + 0.5 - iy;
          for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(vh - 1, Math.ceil(cy + r)); y++) {
            for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(vw - 1, Math.ceil(cx + r)); x++) {
              const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
              if (d > 1) continue;
              const band = d <= 0.42 ? 0 : d <= 0.72 ? 1 : 2;
              const i = y * vw + x, v = g.tier * 3 + band;
              if (haloBuf[i] < 0 || v < haloBuf[i]) haloBuf[i] = v;
            }
          }
        }
        // By day you see the whole screen.
        for (let i = 0; i < px.length; i++) {
          let p = px[i];
          if (WARM.has(p)) continue;
          if (haloBuf[i] >= 0) p = warmth(p, haloBuf[i]);
          if (level > 0) p = shift(p, level);
          px[i] = p;
        }
      } else {
        lightBuf.fill(0);
        warmBuf.fill(-1);
        toneBuf.fill(1);
        const me = myWorldPos();
        addLight(me.x - ix, me.y - iy, 13, -1);
        for (const o of others.values()) addLight(o.x - ix, o.y - iy, 5, -1);
        // The library keeps a soft, cool light on all night.
        if (secrets.library) addLight(secrets.library.x + 0.5 - ix, secrets.library.y + 0.5 - iy, 10, -1);
        for (const g of visibleLanterns) {
          addLight(g.x + 0.5 - ix, g.y + 0.5 - iy, g.r + 1 + Math.sin(ft / 480 + g.x * 0.7) * 0.7, g.tier);
        }
        for (const f of fireflies) if (f.on) addGlow(Math.round(f.x) - ix, Math.round(f.y) - iy);
        // The warm halo's dither moves, so lanterns flicker; everything else stays put.
        const wob = Math.floor(ft / 160) & 3;
        for (let y = 0; y < vh; y++) {
          const by = ((y + iy) & 3) * 4;
          const wy = ((y + iy + wob) & 3) * 4;
          for (let x = 0; x < vw; x++) {
            const i = y * vw + x;
            const p = px[i];
            if (WARM.has(p)) continue;
            const L = lightBuf[i];
            const thr = warmBuf[i] >= 0 ? BAYER[wy + ((x + ix + wob * 3) & 3)] : BAYER[by + ((x + ix) & 3)];
            if (L > 0 && L > thr) {
              if (L < 1 && warmBuf[i] >= 0) px[i] = u32(LANTERN_NIGHT_HALO[warmBuf[i]]);
              else {
                const tone = Math.floor(toneBuf[i] * 3.4 + (BAYER[by + ((x + ix) & 3)] - 0.5) * 0.9);
                px[i] = lamp(p, tone < 0 ? 0 : tone > 3 ? 3 : tone);
              }
            } else {
              px[i] = NIGHT_U32;
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    drawCreatures(ix, iy, ft);
    drawWarp(ix, iy, now);
    drawPeople();
  }

  function drawGlints(ix, iy, ft) {
    const { block, gw, gh, bands } = world;
    const flow = Math.floor(ft / 260);   // drift one pixel every quarter second
    const blink = Math.floor(ft / 700);
    ctx.fillStyle = css(WATER_LIGHT);
    const bx0 = Math.max(0, Math.floor(ix / block)), by0 = Math.max(0, Math.floor(iy / block));
    const bx1 = Math.min(gw - 1, Math.floor((ix + vw) / block)), by1 = Math.min(gh - 1, Math.floor((iy + vh) / block));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const f = Math.floor(terrainCells[by * gw + bx] / bands);
      if (f !== 3 && f !== 4) continue;
      for (let y = by * block; y < by * block + block; y++) for (let x = bx * block; x < bx * block + block; x++) {
        const h = hash3(x - flow, y, (blink + ((x * 7 + y) & 7)) >> 3);
        if (h < 0.012) ctx.fillRect(x - ix, y - iy, 2, 1);
      }
    }
  }

  // Smooth value noise in 0..1 on an integer lattice.
  function valueNoise(x, y, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash3(x0, y0, seed), b = hash3(x0 + 1, y0, seed), c = hash3(x0, y0 + 1, seed), d = hash3(x0 + 1, y0 + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  function hash3(x, y, z) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------ creatures --
  // Fireflies drift around you at dusk and night; butterflies by day.

  const fireflies = [];
  const butterflies = [];
  const FIREFLY = css(hex('#e4f48c'));
  const BUTTERFLY_TINTS = ['#e9c8f4', '#f6f4ea', '#c8e2fa', '#f8d8e8', '#d8f4d0', '#e2d4fa'].map(hex).map(css);
  const FLUFF = css(hex('#f2f4e6'));
  const fluff = [];
  const breeze = { x: 1, y: 0.3 };

  function wander(list, count, t, dt, speed) {
    const cx = cam.x + vw / 2, cy = cam.y + vh / 2;
    while (list.length < count) {
      list.push({ x: cam.x + Math.random() * vw, y: cam.y + Math.random() * vh, vx: 0, vy: 0, phase: Math.random() * 10 });
    }
    list.length = count;
    for (const c of list) {
      c.vx = (c.vx + (Math.random() - 0.5) * speed * dt * 6) * (1 - dt * 0.8);
      c.vy = (c.vy + (Math.random() - 0.5) * speed * dt * 6) * (1 - dt * 0.8);
      c.x += c.vx * dt; c.y += c.vy * dt;
      // Out of sight: come back somewhere near the walker.
      if (Math.abs(c.x - cx) > vw * 0.75 || Math.abs(c.y - cy) > vh * 0.75) {
        c.x = cam.x + Math.random() * vw; c.y = cam.y + Math.random() * vh; c.vx = c.vy = 0;
      }
    }
  }

  function updateCreatures(t, dt) {
    if (reducedMotion) { fireflies.length = 0; butterflies.length = 0; fluff.length = 0; return; }
    wander(fireflies, level >= 2 ? 5 : 0, t, dt, 5);
    for (const f of fireflies) f.on = Math.sin(t / 1300 + f.phase) > 0.55;
    wander(butterflies, level <= 1 ? 6 : 0, t, dt, 14);
    // Dandelion fluff rides a slowly turning breeze across the meadows by day.
    const a = Math.sin(t / 23000) * 1.2 + 0.4;
    breeze.x = Math.cos(a) * 3.2; breeze.y = Math.sin(a) * 3.2;
    wander(fluff, level <= 1 ? 9 : 0, t, dt, 2);
    for (const f of fluff) { f.x += breeze.x * dt; f.y += breeze.y * dt + Math.sin(t / 600 + f.phase) * dt * 1.5; }
  }

  function drawCreatures(ix, iy, ft) {
    const seen = c => level === 4 || canSeeAt(c.x, c.y);
    ctx.fillStyle = FLUFF;
    for (const f of fluff) if (seen(f)) ctx.fillRect(Math.round(f.x) - ix, Math.round(f.y) - iy, 1, 1);
    ctx.fillStyle = FIREFLY;
    for (const f of fireflies) if (f.on && seen(f)) ctx.fillRect(Math.round(f.x) - ix, Math.round(f.y) - iy, 1, 1);
    butterflies.forEach((b, k) => {
      if (!seen(b)) return;
      const x = Math.round(b.x) - ix, y = Math.round(b.y) - iy;
      ctx.fillStyle = BUTTERFLY_TINTS[k % BUTTERFLY_TINTS.length];
      const open = Math.floor(ft / 140 + b.phase) % 2 === 0;
      ctx.fillRect(x, y + 1, 1, 1);
      if (open) { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1); }
      else ctx.fillRect(x, y, 1, 1);
    });
  }

  // Other walkers stay cursor-sized whatever the world's zoom, on their own
  // overlay canvas where one pixel is always PEOPLE_SCALE screen pixels.
  const people = $('#people');
  const pctx = people.getContext('2d');
  const PEOPLE_SCALE = 3;
  function resizePeople() {
    people.width = Math.ceil(innerWidth / PEOPLE_SCALE);
    people.height = Math.ceil(innerHeight / PEOPLE_SCALE);
    people.style.width = `${people.width * PEOPLE_SCALE}px`;
    people.style.height = `${people.height * PEOPLE_SCALE}px`;
  }
  function drawPeople() {
    pctx.clearRect(0, 0, people.width, people.height);
    for (const o of others.values()) {
      // By day you see other walkers only inside your circle of view; at night they carry lights.
      if (level !== 4 && !canSeeAt(o.x, o.y)) continue;
      const cx = Math.round(((o.x - cam.x) * scale) / PEOPLE_SCALE);
      const cy = Math.round(((o.y - cam.y) * scale) / PEOPLE_SCALE);
      if (cx < -6 || cy < -8 || cx > people.width || cy > people.height) continue;
      pctx.fillStyle = o.tint;
      for (let r = 0; r < ARROW.length; r++) {
        for (let c = 0; c < ARROW[r].length; c++) if (ARROW[r][c] === '1') pctx.fillRect(cx + c, cy + r, 1, 1);
      }
    }
  }

  // A firefly lights barely more than itself: its own pixel, dimly, and a
  // sparse flicker on its four neighbours.
  function addGlow(x, y) {
    const set = (px, py, v, tone) => {
      if (px < 0 || py < 0 || px >= vw || py >= vh) return;
      const i = py * vw + px;
      if (v > lightBuf[i]) { lightBuf[i] = v; warmBuf[i] = -1; }
      if (tone < toneBuf[i]) toneBuf[i] = tone;
    };
    set(x, y, 1, 0.85);
    set(x + 1, y, 0.3, 1); set(x - 1, y, 0.3, 1); set(x, y + 1, 0.3, 1); set(x, y - 1, 0.3, 1);
  }

  // Light falls off in dithered rings: full inside r, then three sparser bands.
  function addLight(cx, cy, r, tier) {
    const outer = r + 3.5;
    const x0 = Math.max(0, Math.floor(cx - outer)), x1 = Math.min(vw - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer)), y1 = Math.min(vh - 1, Math.ceil(cy + outer));
    const b1 = (r + 1.2) ** 2, b2 = (r + 2.3) ** 2, b3 = outer ** 2, r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        const v = d2 <= r2 ? 1 : d2 <= b1 ? 0.6 : d2 <= b2 ? 0.32 : d2 <= b3 ? 0.12 : 0;
        if (!v) continue;
        const i = y * vw + x;
        const tone = Math.min(1, Math.sqrt(d2) / (r + 2.5));
        if (tone < toneBuf[i]) toneBuf[i] = tone;
        if (v > lightBuf[i]) {
          lightBuf[i] = v;
          warmBuf[i] = v < 1 ? tier : -1;
        }
      }
    }
  }

  // ------------------------------------------------------------- secrets --
  // Things you stumble on while walking. Fixed ones (wells, fairy rings, the
  // ancient tree) are placed from a fixed seed, so they're in the same spots
  // for everyone; the bottle, the owl and the deer come and go.

  const secrets = { library: null, wells: [], rings: [], ancient: null, bottle: null, owl: null, deer: null, frog: null, bird: null,
    nextBottle: 0, nextOwl: 0, nextDeer: 0, nextFrog: 0, nextBird: 0, warp: null };

  // Atlas Shrugged's first surviving edit is from 28 January 2001, two weeks
  // after Wikipedia began: one of its oldest articles.
  const ANCIENT = { title: 'Atlas Shrugged', since: '28 January 2001' };

  // A library at the middle of the park, drawn like Medellín's Parque
  // Biblioteca España (dark rock-like buildings on a hillside), where every
  // first walk begins. It opens the article on library parks.
  const LIBRARY = { title: 'Library park (Colombia)' };
  const LIBRARY_PX = [
    '...ab..',
    '..aab..',
    '..awb.a',
    'a.aabab',
    'abawbab',
    'abaabwb',
    'ccccccc',
  ];
  const LIBRARY_COLOURS = { a: css(hex('#5c5c68')), b: css(hex('#3a3a44')), w: css(hex('#d0e8f4')), c: css(hex('#b0ac98')) };

  const WELL_KINDS = { 1: 'picture', 2: 'featured', 4: 'onthisday' };
  const STONE = [css(hex('#9c9a8c')), css(hex('#7e7c70'))];
  const WELL_WATER = css(hex('#1c3c5c'));
  // Toadstools: c cap, d spots, u the cap's darker underside, s stem, * a twinkle.
  // Muted toward the meadow, but still the palest thing around: it should read as special.
  const TOADSTOOL_COLOURS = { c: css(hex('#d2c9ab')), d: css(hex('#ada285')), u: css(hex('#978d6e')), s: css(hex('#dcd5c0')), '*': css(hex('#f2eedf')) };
  const TOADSTOOL_BIG = ['..ccc..', '.cdccc.', 'ccccdcc', '.uuuuu.', '...s...', '..sss..'];
  const ANCIENT_COLOURS = ['#2c5c2c', '#3c6c34', '#4c7c3c', '#9cac8c'].map(hex).map(css);
  const BOTTLE = css(hex('#5c9c7c')), CORK = css(hex('#be9b65'));
  // Every animal sits on the same pale, rounded base (a plant's shape), with
  // a 3×3 animal drawn on top, so they read as one family.
  const ANIMAL_BASE = ['.###.', '#####', '#####', '#####', '.###.'];
  const BASE = css(hex('#dfe5c6'));
  const OWL = css(hex('#7c6c54')), OWL_EYE = css(hex('#f0e6a0'));
  const DEER = css(hex('#7c5a3a')), DEER_ANTLER = css(hex('#b08a5c'));
  const FROG = css(hex('#4c7c34')), FROG_EYE = css(hex('#1c2c14'));
  const BIRD = css(hex('#2c2a26')), BIRD_BEAK = css(hex('#d8c27a'));
  function drawAnimal(rows, colours, x, y, ix, iy) {
    drawSprite(ANIMAL_BASE, x - 2 - ix, y - 2 - iy, { '#': BASE });
    drawSprite(rows, x - 1 - ix, y - 1 - iy, colours);
  }

  const WELL_PX = ['..###..', '.#####.', '##ooo##', '##ooo##', '##ooo##', '.#####.', '..###..'];
  const ANCIENT_PX = [
    '....aab.a....',
    '..aabbbbaa...',
    '.abbbcbbbba..',
    '.abbccccbbaa.',
    'abbcccdcccba.',
    'abccdcccccbba',
    'abbccccdccbba',
    '.abcccccccba.',
    '.abbccdccbbaa',
    '..abbccccba..',
    '..aabbbbbaa..',
    '....aaab.a...',
    '......a......',
  ];

  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Open ground only (no thicket, water or sand), no plants, within r of (cx, cy).
  function clearArea(cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 8 || y < 8 || x >= world.w - 8 || y >= world.h - 8 || taken[y * world.w + x]) return false;
      const cell = terrainCells[Math.floor(y / world.block) * world.gw + Math.floor(x / world.block)];
      if (Math.floor(cell / world.bands) !== 0) return false;
    }
    return true;
  }
  function claim(cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) taken[y * world.w + x] = 1;
  }
  function findSpot(rng, r, wantRegion) {
    for (let k = 0; k < 20000; k++) {
      const x = Math.round(40 + rng() * (world.w - 80)), y = Math.round(40 + rng() * (world.h - 80));
      if (wantRegion !== undefined && regionAt(x, y) !== wantRegion) continue;
      if (clearArea(x, y, r)) { claim(x, y, r); return { x, y }; }
    }
    return null;
  }

  function placeSecrets() {
    const rng = seeded(2001);
    // The library: in its clearing at the middle of the park (older worlds
    // without one get the open spot nearest the middle).
    if (world.library) {
      secrets.library = { x: world.library[0], y: world.library[1] };
      claim(secrets.library.x, secrets.library.y, 7);
    }
    for (let d = 0; d < world.w / 2 && !secrets.library; d += 4) {
      for (let k = 0; k < 24 && !secrets.library; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = Math.round(world.w / 2 + Math.cos(a) * d), y = Math.round(world.h / 2 + Math.sin(a) * d);
        if (clearArea(x, y, 7)) { claim(x, y, 7); secrets.library = { x, y }; }
      }
    }
    // The ancient tree stands alone in an open patch.
    secrets.ancient = findSpot(rng, 12);
    // Three wells, well apart from one another.
    for (const bit of [1, 2, 4]) {
      for (let k = 0; k < 40; k++) {
        const s = findSpot(rng, 6);
        if (!s) break;
        if (secrets.wells.every(w => Math.hypot(w.x - s.x, w.y - s.y) > 350) || k === 39) {
          secrets.wells.push({ ...s, kind: WELL_KINDS[bit] });
          break;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      const s = findSpot(rng, 8);
      if (s) secrets.rings.push(s);
    }
  }

  function drawSprite(rows, x0, y0, colours) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = colours[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }));
  }
  const near = (s, ix, iy, r) => s && s.x > ix - r && s.y > iy - r && s.x < ix + vw + r && s.y < iy + vh + r;

  function drawSecrets(ix, iy, ft) {
    // Fairy toadstools: one big toadstool that twinkles now and then. Click it
    // to be whisked away.
    for (const r of secrets.rings) {
      if (!near(r, ix, iy, 12)) continue;
      drawSprite(TOADSTOOL_BIG, r.x - 3 - ix, r.y - 3 - iy, TOADSTOOL_COLOURS);
      if (Math.floor(ft / 450 + r.x) % 5 === 0) drawSprite(['*'], r.x + 2 - ix, r.y - 5 - iy, TOADSTOOL_COLOURS);
    }
    for (const w of secrets.wells) {
      if (near(w, ix, iy, 6)) drawSprite(WELL_PX, w.x - 3 - ix, w.y - 3 - iy, { '#': STONE[(w.x + w.y) & 1], o: WELL_WATER });
    }
    const lib = secrets.library;
    if (near(lib, ix, iy, 6)) drawSprite(LIBRARY_PX, lib.x - 3 - ix, lib.y - 3 - iy, LIBRARY_COLOURS);
    const t = secrets.ancient;
    if (near(t, ix, iy, 8)) drawSprite(ANCIENT_PX, t.x - 6 - ix, t.y - 6 - iy, { a: ANCIENT_COLOURS[0], b: ANCIENT_COLOURS[1], c: ANCIENT_COLOURS[2], d: ANCIENT_COLOURS[3] });
    const b = secrets.bottle;
    if (b) {
      const bx = Math.round(b.x) - ix, by = Math.round(b.y) - iy;
      ctx.fillStyle = BOTTLE; ctx.fillRect(bx - 1, by, 3, 1);
      ctx.fillStyle = CORK; ctx.fillRect(bx + 2, by, 1, 1);
    }
    const o = secrets.owl;
    if (o) drawAnimal(['#.#', 'e#e', '###'], { '#': OWL, e: OWL_EYE }, o.x, o.y, ix, iy);
    const fr = secrets.frog;
    if (fr) drawAnimal(['e.e', '###', '#.#'], { '#': FROG, e: FROG_EYE }, fr.x, fr.y, ix, iy);
    const bd = secrets.bird;
    if (bd) drawAnimal(['.y.', '###', '.#.'], { '#': BIRD, y: BIRD_BEAK }, bd.x, bd.y, ix, iy);
    const d = secrets.deer;
    if (d) drawAnimal(['a.a', '###', '#.#'], { '#': DEER, a: DEER_ANTLER }, d.x, d.y, ix, iy);
  }

  function isWater(x, y) {
    const bx = Math.floor(x / world.block), by = Math.floor(y / world.block);
    if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) return false;
    const f = Math.floor(terrainCells[by * world.gw + bx] / world.bands);
    return f === 3 || f === 4;
  }
  function isSand(x, y) {
    const bx = Math.floor(x / world.block), by = Math.floor(y / world.block);
    if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) return false;
    return Math.floor(terrainCells[by * world.gw + bx] / world.bands) === 5;
  }
  function isMeadow(x, y) {
    const bx = Math.floor(x / world.block), by = Math.floor(y / world.block);
    if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) return false;
    return Math.floor(terrainCells[by * world.gw + bx] / world.bands) === 0;
  }

  function updateSecrets(t, dt) {
    if (!world) return;
    const me = { x: cam.x + innerWidth / scale / 2, y: cam.y + innerHeight / scale / 2 };
    const still = reducedMotion ? 0 : 1;

    // A bottle drifts along nearby water now and then.
    if (!secrets.bottle && t > secrets.nextBottle) {
      secrets.nextBottle = t + 25000 + Math.random() * 35000;
      for (let k = 0; k < 60 && Math.random() < 0.6; k++) {
        const x = cam.x + Math.random() * vw, y = cam.y + Math.random() * vh;
        if (isWater(x, y) && isWater(x + 6, y) && isWater(x - 6, y) && isWater(x, y + 6) && isWater(x, y - 6)) {
          secrets.bottle = { x, y, a: Math.random() * Math.PI * 2, born: t };
          break;
        }
      }
    }
    const b = secrets.bottle;
    if (b) {
      // Bob along the water, turning where the bank is.
      for (const turn of [0, 0.5, -0.5, 1.2, -1.2, Math.PI]) {
        const a = b.a + turn, nx = b.x + Math.cos(a) * 3, ny = b.y + Math.sin(a) * 3;
        if (isWater(nx, ny)) { b.a = a + (Math.random() - 0.5) * 0.05; break; }
      }
      b.x += Math.cos(b.a) * 2.5 * dt * still; b.y += Math.sin(b.a) * 2.5 * dt * still;
      if (t - b.born > 60000 || Math.hypot(b.x - me.x, b.y - me.y) > 160) secrets.bottle = null;
    }

    // At night an owl sometimes perches on a tree or bush inside your light.
    if (level === 4 && !secrets.owl && t > secrets.nextOwl) {
      secrets.nextOwl = t + 30000 + Math.random() * 50000;
      const p = myWorldPos();
      const trees = [];
      articlesIn(p.x - 10, p.y - 10, p.x + 10, p.y + 10, (i, a) => { if (a[7] >= 1 && isLit(i)) trees.push(a); });
      if (!trees.length) secrets.nextOwl = t + 4000; // look again soon, once you're near a tree
      else if (Math.random() < 0.7) {
        const a = trees[Math.floor(Math.random() * trees.length)];
        secrets.owl = { x: a[2], y: a[3], born: t };
        playSample('Tawny owl', hoot);
      }
    }
    if (secrets.owl && (level !== 4 || t - secrets.owl.born > 30000)) secrets.owl = null;

    // By day a blackbird sometimes lands on a tree or bush near you and sings.
    if (level <= 1 && !secrets.bird && t > secrets.nextBird) {
      secrets.nextBird = t + 40000 + Math.random() * 60000;
      const perches = [];
      articlesIn(cam.x, cam.y, cam.x + vw, cam.y + vh, (i, a) => { if (a[7] >= 1) perches.push(a); });
      if (perches.length && Math.random() < 0.6) {
        const a = perches[Math.floor(Math.random() * perches.length)];
        secrets.bird = { x: a[2], y: a[3], born: t };
        playSample('Common blackbird');
      }
    }
    if (secrets.bird && (level > 1 || t - secrets.bird.born > 30000)) secrets.bird = null;

    // At dusk and night a frog sometimes sits on a bank near you and calls.
    if (level >= 2 && !secrets.frog && t > secrets.nextFrog) {
      secrets.nextFrog = t + 40000 + Math.random() * 60000;
      const p = level === 4 ? myWorldPos() : me, r = level === 4 ? 9 : 40;
      for (let k = 0; k < 80; k++) {
        const x = Math.round(p.x + (Math.random() - 0.5) * 2 * r), y = Math.round(p.y + (Math.random() - 0.5) * 2 * r);
        if ((isMeadow(x, y) || isSand(x, y)) && (isWater(x + 3, y) || isWater(x - 3, y) || isWater(x, y + 3) || isWater(x, y - 3)) && articleAt(x, y) < 0) {
          secrets.frog = { x, y, born: t };
          playSample('Common frog');
          break;
        }
      }
    }
    if (secrets.frog && (level < 2 || t - secrets.frog.born > 40000)) secrets.frog = null;

    // By day a deer may be standing in a meadow near you, grazing.
    if (level <= 2 && !secrets.deer && t > secrets.nextDeer) {
      secrets.nextDeer = t + 45000 + Math.random() * 60000;
      if (Math.random() < 0.45) {
        for (let k = 0; k < 40; k++) {
          const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 22;
          const x = Math.round(me.x + Math.cos(a) * r), y = Math.round(me.y + Math.sin(a) * r);
          if (isMeadow(x - 4, y) && isMeadow(x + 4, y) && articleAt(x, y) < 0) {
            secrets.deer = { x, y, born: t };
            break;
          }
        }
      }
    }
    const d = secrets.deer;
    if (d && (Math.hypot(d.x - me.x, d.y - me.y) > 150 || t - d.born > 120000 || level > 2)) secrets.deer = null;

    if (secrets.warp && t - secrets.warp.start > secrets.warp.half && !secrets.warp.moved) {
      secrets.warp.moved = true;
      const a = world.articles[Math.floor(Math.random() * world.articles.length)];
      dir.x = dir.y = 0;
      centerOn(a[2] + (Math.random() < 0.5 ? -12 : 12), a[3] + (Math.random() < 0.5 ? -9 : 9));
      toast('a fairy ring whisked you away');
    }
    if (secrets.warp && t - secrets.warp.start > secrets.warp.half * 2) {
      secrets.warp = null;
    }
  }

  function startWarp(t) {
    closePanel(); closePlant();
    secrets.warp = { start: t, half: reducedMotion ? 0 : 650, moved: false };
    chime();
  }

  // The fairy-ring dissolve: dark pixels fill in by a dither pattern, then clear.
  function drawWarp(ix, iy, t) {
    const w = secrets.warp;
    if (!w || !w.half) return;
    const p = (t - w.start) / w.half;
    const cover = p < 1 ? p : 2 - p;
    ctx.fillStyle = css(NIGHT);
    for (let y = 0; y < vh; y++) for (let x = 0; x < vw; x++) {
      if (BAYER[((y + iy) & 3) * 4 + ((x + ix) & 3)] < cover) ctx.fillRect(x, y, 1, 1);
    }
  }

  function secretAt(wx, wy) {
    const hit = (s, r) => s && Math.abs(wx - s.x) <= r && Math.abs(wy - s.y) <= r;
    for (const w of secrets.wells) if (hit(w, 3)) return () => openWell(w);
    for (const r of secrets.rings) if (hit(r, 3)) return () => { if (!secrets.warp) startWarp(performance.now()); };
    const here = o => ({ x: Math.round(o.x), y: Math.round(o.y) });
    if (hit(secrets.library, 4)) return () => openTitle(LIBRARY.title, '', here(secrets.library));
    if (hit(secrets.ancient, 6)) return () => openTitle(ANCIENT.title, `the ancient tree · first written ${ANCIENT.since}`, here(secrets.ancient));
    if (hit(secrets.bottle, 2)) return () => { const at = here(secrets.bottle); secrets.bottle = null; openBottle(at); };
    if (hit(secrets.owl, 2)) return () => { playSample('Tawny owl', hoot); openTitle('Owl', 'a night owl', here(secrets.owl)); };
    if (hit(secrets.frog, 2)) return () => { playSample('Common frog'); openTitle('Common frog', 'a frog by the water', here(secrets.frog)); };
    if (hit(secrets.bird, 2)) return () => { playSample('Common blackbird'); openTitle('Common blackbird', 'a blackbird', here(secrets.bird)); };
    if (hit(secrets.deer, 2)) return () => { playSample('Red deer'); openTitle('Deer', 'a deer', here(secrets.deer)); };
    // A lantern left on something that has since moved on (an animal, the
    // bottle, a well before a rebuild) still opens what it was left on.
    for (const l of lanterns.values()) {
      if (!l.article_title.startsWith(SPOT_MARK) || !hit(l, 2)) continue;
      const name = spotName(l.article_title);
      const kind = Object.keys(WELL_NAMES).find(k => WELL_NAMES[k] === name);
      const well = kind && secrets.wells.find(w => w.kind === kind);
      if (well) return () => openWell(well);
      return () => openTitle(name, 'a lantern left here', { x: l.x, y: l.y });
    }
    return null;
  }

  // ---- Wikipedia's daily feed, for the wells and the bottle.

  const feeds = new Map();
  function feedFor(date) {
    const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    if (!feeds.has(key)) {
      feeds.set(key, fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${key}`)
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .catch(e => { feeds.delete(key); throw e; }));
    }
    return feeds.get(key);
  }
  const trim = (s, n = 480) => {
    s = (s || '').trim();
    return s.length > n ? `${s.slice(0, n - 10).replace(/\s+\S*$/, '')}…` : s;
  };
  const pageUrl = p => p && p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page;

  const WELL_NAMES = { picture: 'the picture well', featured: 'the well of featured articles', onthisday: 'the well of days' };
  async function openWell(w) {
    const spot = { title: SPOT_MARK + WELL_NAMES[w.kind], x: w.x, y: w.y };
    const kickers = { picture: 'a well · picture of the day', featured: "a well · today's featured article", onthisday: 'a well · on this day' };
    openSpecial({ kicker: kickers[w.kind], title: 'the water stirs…', text: '' , spot });
    const token = cardToken;
    try {
      const f = await feedFor(new Date());
      if (token !== cardToken) return;
      if (w.kind === 'featured' && f.tfa) {
        openSpecial({ kicker: kickers.featured, title: (f.tfa.titles && f.tfa.titles.normalized) || f.tfa.title, text: trim(f.tfa.extract), thumb: f.tfa.thumbnail && f.tfa.thumbnail.source, url: pageUrl(f.tfa), tuneTitle: f.tfa.title , spot });
      } else if (w.kind === 'picture' && f.image) {
        const name = (f.image.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
        const text = f.image.description && (f.image.description.text || '').replace(/<[^>]+>/g, '');
        openSpecial({ kicker: kickers.picture, title: name, text: trim(text), thumb: f.image.thumbnail && f.image.thumbnail.source, url: f.image.file_page , spot });
      } else if (w.kind === 'onthisday' && f.onthisday && f.onthisday.length) {
        const events = f.onthisday.slice().sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a.year - b.year);
        const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        openSpecial({ kicker: kickers.onthisday, title: today, text: events.map(e => `${e.year}: ${e.text}`).join('\n\n'), url: pageUrl(events[0].pages && events[0].pages[0]) , spot });
      } else {
        openSpecial({ kicker: kickers[w.kind], title: 'the well is quiet today', text: 'Come back tomorrow.' , spot });
      }
    } catch (e) {
      if (token === cardToken) openSpecial({ kicker: kickers[w.kind], title: 'the well is quiet', text: 'Wikipedia could not be reached just now.' , spot });
    }
  }

  // A featured article from a random day since 2010.
  async function openBottle(at) {
    openSpecial({ kicker: 'a message in a bottle', title: 'unrolling the paper…', text: '' });
    const token = cardToken;
    const from = new Date(2010, 0, 1).getTime(), to = Date.now() - 864e5;
    for (let k = 0; k < 4; k++) {
      const date = new Date(from + Math.random() * (to - from));
      try {
        const f = await feedFor(date);
        if (token !== cardToken) return;
        if (!f.tfa) continue;
        const when = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        openSpecial({ kicker: `a message in a bottle · featured on ${when}`, title: (f.tfa.titles && f.tfa.titles.normalized) || f.tfa.title, text: trim(f.tfa.extract), thumb: f.tfa.thumbnail && f.tfa.thumbnail.source, url: pageUrl(f.tfa), tuneTitle: f.tfa.title,
          spot: at && { title: SPOT_MARK + ((f.tfa.titles && f.tfa.titles.normalized) || f.tfa.title), x: at.x, y: at.y } });
        return;
      } catch (e) { /* try another day */ }
    }
    if (token === cardToken) openSpecial({ kicker: 'a message in a bottle', title: 'the ink has run', text: 'The message could not be read.' });
  }

  // An article by title: its own card if it grows in the forest, else a special one.
  // where: the place you met it (owl, frog, deer, the ancient tree), so a
  // lantern stays there. Without it, a plant's own card if it grows here.
  function openTitle(title, kicker, where) {
    const i = titleIndex.get(title);
    if (i !== undefined && !where) { openPanel(i, kicker); return; }
    const spot = where && { title: SPOT_MARK + title, x: where.x, y: where.y };
    openSpecial({ kicker, title, text: '…', url: wikiUrl(title), spot });
    const token = cardToken;
    fetch(summaryUrl(title)).then(r => r.json()).then(d => {
      if (token !== cardToken) return;
      const name = (d.titles && d.titles.normalized) || title;
      openSpecial({ kicker, title: name, text: trim(d.extract), thumb: d.thumbnail && d.thumbnail.source, url: pageUrl(d) || wikiUrl(title), tuneTitle: name, spot });
    }).catch(() => {});
  }

  // ---- little sounds for the secrets (only with sound on)

  function hoot() {
    if (!sound.on || !sound.ctx || sound.ctx.state !== 'running') return;
    const t0 = sound.ctx.currentTime + 0.1, pan = Math.random() - 0.5;
    tone(390, 360, t0, 0.32, 0.05, pan);
    tone(400, 370, t0 + 0.5, 0.22, 0.04, pan);
    tone(380, 340, t0 + 0.8, 0.45, 0.045, pan);
  }
  function chime() {
    if (!sound.on || !sound.ctx || sound.ctx.state !== 'running') return;
    const t0 = sound.ctx.currentTime + 0.02;
    [1318, 1568, 1976, 2637].forEach((f, k) => tone(f, f * 1.002, t0 + k * 0.09, 0.5, 0.03, 0));
  }

  // --------------------------------------------------------------- loop ---

  const keys = new Set();
  let rafId = 0, lastT = 0, lastSave = 0, lastLevelCheck = 0;

  // ------------------------------------------------------------ walking --
  // Scrolling, dragging and the keys don't fly you across the forest: they say
  // where you want to go, and you get there on foot. Push gently and you walk;
  // push harder (fast scrolling or dragging, or Shift with the keys) and you jog,
  // but only for a few seconds: out of breath, you're slower than walking and
  // can't jog again until you've mostly caught it. FREE_SCROLL in config.js brings back direct scrolling.
  const FREE_SCROLL = !!CFG.FREE_SCROLL;
  const KEY_SPEED = 30;                    // free-scroll key speed, world px/s
  const WALK = 26, JOG = 60, TIRED = 13;   // world px per second
  const JOG_SECONDS = 4, RECOVER_SECONDS = 16;
  const JOG_AGAIN = 0.8; // breath needed before you can jog again
  // Scrolling and dragging work like holding a key: you walk while the input
  // keeps coming and stop as soon as it does. How hard you push (the distance
  // asked for per second) decides between walking and jogging.
  const STOP_AFTER = 110;                  // ms without input before you stop
  const dir = { x: 0, y: 0 };              // where the latest input points
  let asked = 0, askRate = 0, lastAsk = -1e9;
  const legs = { stamina: 1, tired: false, pace: 'still' };

  function push(dx, dy) {
    if (FREE_SCROLL) { target.x += dx; target.y += dy; clampTarget(); return; }
    // Lean the direction toward the new input rather than replacing it, so
    // jittery trackpad deltas don't make you zigzag.
    dir.x = dir.x * 0.5 + dx; dir.y = dir.y * 0.5 + dy;
    asked += Math.hypot(dx, dy);
    lastAsk = performance.now();
  }

  function walk(dt, kx, ky, shift) {
    const now = performance.now();
    let mx = 0, my = 0, jog = false;
    if (kx || ky) {
      mx = kx; my = ky; jog = shift;
    } else if (now - lastAsk < STOP_AFTER && (dir.x || dir.y)) {
      mx = dir.x; my = dir.y;
      askRate += (asked / Math.max(dt, 0.001) - askRate) * (1 - Math.exp(-dt * 8));
      jog = askRate > 80 || (legs.pace === 'jog' && askRate > 45);
    } else {
      dir.x = dir.y = 0; askRate = 0;
    }
    asked = 0;
    const m = Math.hypot(mx, my);
    const speed = m === 0 ? 0 : legs.tired ? TIRED : jog ? JOG : WALK;
    const stepLen = speed * dt;
    if (stepLen > 0) {
      target.x += (mx / m) * stepLen; target.y += (my / m) * stepLen;
      if (clampTarget()) { dir.x = dir.y = 0; } // bumped into the forest wall
    }
    legs.pace = stepLen <= 0 ? 'still' : speed === JOG ? 'jog' : speed === TIRED ? 'tired' : 'walk';
    if (legs.pace === 'jog') legs.stamina -= dt / JOG_SECONDS;
    else legs.stamina += dt / (legs.pace === 'still' ? RECOVER_SECONDS * 0.6 : RECOVER_SECONDS);
    legs.stamina = Math.max(0, Math.min(1, legs.stamina));
    if (legs.stamina === 0) legs.tired = true;
    if (legs.tired && legs.stamina >= JOG_AGAIN) legs.tired = false;
  }



  function tick(t) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
    lastT = t;

    // Keyboard walking.
    let kx = 0, ky = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) kx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) kx += 1;
    if (keys.has('ArrowUp') || keys.has('w')) ky -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) ky += 1;
    if (FREE_SCROLL) {
      if (kx || ky) {
        const n = Math.hypot(kx, ky);
        target.x += (kx / n) * KEY_SPEED * dt;
        target.y += (ky / n) * KEY_SPEED * dt;
        clampTarget();
      }
    } else {
      walk(dt, kx, ky, keys.has('Shift'));
    }

    // Eased camera.
    if (reducedMotion) { cam.x = target.x; cam.y = target.y; }
    else {
      const k = 1 - Math.exp(-dt * (drag.active ? 30 : FREE_SCROLL ? 9 : 22));
      cam.x += (target.x - cam.x) * k;
      cam.y += (target.y - cam.y) * k;
      if (Math.abs(target.x - cam.x) < 0.05) cam.x = target.x;
      if (Math.abs(target.y - cam.y) < 0.05) cam.y = target.y;
    }

    // Other walkers glide toward their latest reported position.
    const kk = 1 - Math.exp(-dt * 10);
    for (const [id, o] of others) {
      if (t - o.last > 12000) { others.delete(id); continue; }
      o.x += (o.tx - o.x) * kk;
      o.y += (o.ty - o.y) * kk;
    }

    // Hover.
    let h = -1, overSecret = false;
    if (pointer.inside && pointer.overCanvas && !pointer.touch && pointer.x != null && !drag.moved) {
      const wx = Math.floor(cam.x + pointer.x / scale), wy = Math.floor(cam.y + pointer.y / scale);
      overSecret = !!secretAt(wx, wy) && canSeeAt(wx, wy);
      h = overSecret ? -1 : articleAt(wx, wy);
      if (h >= 0 && !canSee(h)) h = -1;
    }
    const cursor = drag.active && drag.moved ? 'grabbing' : h >= 0 || overSecret ? 'pointer' : '';
    if (h !== hovered || canvas.style.cursor !== cursor) {
      hovered = h;
      canvas.style.cursor = cursor;
    }

    if (t - lastLevelCheck > 30000) { lastLevelCheck = t; updateLevel(); }

    updateCreatures(t, dt);
    updateSecrets(t, dt);
    render(t);
    updateSound(t);
    sendCursor(t);

    if (t - lastSave > 2000) { lastSave = t; savePosition(); }
  }

  // At night only lit articles can be found.
  function isLit(i) {
    const a = world.articles[i];
    return litAt(a[2], a[3]);
  }
  function litAt(wx, wy) {
    const x = wx - Math.floor(cam.x), y = wy - Math.floor(cam.y);
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    return lightBuf[y * vw + x] >= 0.32;
  }
  // Can the walker see this spot? At night: inside a light. By day: anywhere on screen.
  function canSeeAt(wx, wy) {
    if (level === 4) return litAt(wx, wy);
    return wx >= cam.x && wy >= cam.y && wx < cam.x + innerWidth / scale && wy < cam.y + innerHeight / scale;
  }
  const canSee = i => canSeeAt(world.articles[i][2], world.articles[i][3]);

  function savePosition() {
    if (!world) return;
    store.set('wikipark.pos', { x: Math.round(cam.x + innerWidth / scale / 2), y: Math.round(cam.y + innerHeight / scale / 2) });
  }

  function start() { if (!rafId) { lastT = 0; rafId = requestAnimationFrame(tick); } }
  function stop() { cancelAnimationFrame(rafId); rafId = 0; }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { savePosition(); stop(); }
    else if (world && ground && wallPattern) { updateLevel(); start(); } // not before the world has loaded
  });
  addEventListener('pagehide', savePosition);

  // -------------------------------------------------------------- input ---

  const drag = { active: false, moved: false, id: null, sx: 0, sy: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0, press: 0, pressed: false };

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.focus({ preventScroll: true });
    pointer.touch = e.pointerType !== 'mouse';
    Object.assign(drag, { active: true, moved: false, id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vy: 0, pressed: false });
    canvas.setPointerCapture(e.pointerId);
    // Long-press on touch plants, like a double-click with a mouse.
    clearTimeout(drag.press);
    if (e.pointerType !== 'mouse') {
      drag.press = setTimeout(() => {
        if (drag.active && !drag.moved) { drag.pressed = true; tryPlantAt(drag.sx, drag.sy); }
      }, 550);
    }
  });

  // The pointer is tracked over the whole page, so your light stays with your
  // mouse when it moves over a panel instead of jumping to the middle.
  document.addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
    pointer.touch = e.pointerType !== 'mouse';
    pointer.overCanvas = e.target === canvas;
  });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget && e.pointerType === 'mouse') pointer.inside = false; });

  canvas.addEventListener('pointermove', e => {
    if (!drag.active || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      clearTimeout(drag.press);
      canvas.style.cursor = 'grabbing';
    }
    if (drag.moved) {
      const now = performance.now();
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      push(-dx / scale, -dy / scale);
      const dtm = Math.max(1, now - drag.lt);
      drag.vx = drag.vx * 0.6 + (dx / dtm) * 0.4;
      drag.vy = drag.vy * 0.6 + (dy / dtm) * 0.4;
      drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.active = false;
    clearTimeout(drag.press);
    if (drag.pressed) {
      drag.pressed = false;
    } else if (drag.moved) {
      if (FREE_SCROLL && !reducedMotion && performance.now() - drag.lt < 80) {
        target.x -= (drag.vx * 220) / scale;
        target.y -= (drag.vy * 220) / scale;
        clampTarget();
      }
      canvas.style.cursor = '';
    } else {
      const wx = Math.floor(cam.x + e.clientX / scale), wy = Math.floor(cam.y + e.clientY / scale);
      // Secrets first: the owl sits on top of a plant.
      const secret = canSeeAt(wx, wy) ? secretAt(wx, wy) : null;
      if (secret) { secret(); drag.moved = false; return; }
      let i = articleAt(wx, wy);
      if (i >= 0 && !canSee(i)) i = -1;
      if (i >= 0) openPanel(i, undefined, { clicked: true }); else { closePanel(); closePlant(); }
    }
    drag.moved = false;
  });

  canvas.addEventListener('dblclick', e => tryPlantAt(e.clientX, e.clientY));

  function tryPlantAt(cx, cy) {
    const wx = Math.floor(cam.x + cx / scale), wy = Math.floor(cam.y + cy / scale);
    if (articleAt(wx, wy) >= 0) return;
    if (!canSeeAt(wx, wy)) return;
    if (!spotFree(wx, wy, 0)) { toast('articles only grow on open ground'); return; }
    openPlant(wx, wy);
  }

  canvas.addEventListener('pointercancel', () => { drag.active = false; drag.moved = false; });

  addEventListener('wheel', e => {
    if (e.target.closest && e.target.closest('.panel, .card')) return;
    e.preventDefault();
    const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    let dx = e.deltaX * mult, dy = e.deltaY * mult;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    push(dx / scale, dy / scale);
  }, { passive: false });

  const WALK_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's']);
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('.panel, .card') && e.key !== 'Escape') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Shift') { keys.add('Shift'); return; }
    if (WALK_KEYS.has(k)) { keys.add(k); e.preventDefault(); return; }
    if (k === 'Escape') { closePanel(); closePlant(); return; }
    if (k === 't') {
      const idx = (OVERRIDES.indexOf(levelOverride) + 1) % OVERRIDES.length;
      levelOverride = OVERRIDES[idx];
      updateLevel();
      toast(OVERRIDE_NAMES[idx]);
      return;
    }
    if (k === 'l') { lanternShortcut(); return; }
    if (k === 'Enter' || k === ' ') {
      const p = myWorldPos();
      const i = nearestArticle(p.x, p.y, level === 4 ? 10 : 24);
      if (i >= 0) { e.preventDefault(); openPanel(i); }
    }
  });
  addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener('blur', () => keys.clear());
  addEventListener('resize', () => { resize(); });

  // --------------------------------------------------------------- panel --

  const panel = $('#panel');
  const pTitle = $('#panel-title'), pText = $('#panel-text'), pLink = $('#panel-link');
  const pThumb = $('#panel-thumb'), pBtn = $('#panel-lantern');
  // ↗ beside the title opens the article on Wikipedia.
  const LINK_ARROW = ['..#####', '.....##', '....#.#', '...#..#', '..#....', '.#.....', '#......'];
  const LINK_ARROW_SMALL = ['.####', '...##', '..#.#', '.#..#', '#....'];
  function drawArrow(canvas, rows = LINK_ARROW) {
    const c = canvas.getContext('2d');
    c.fillStyle = '#b4d48c';
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') c.fillRect(x, y, 1, 1); }));
  }
  drawArrow(pLink.querySelector('canvas'));
  // A summary cut short ends in … and the same ↗, to read on.
  function setText(text) {
    pText.textContent = text;
    if (!/(…|\.\.\.)$/.test(text) || pLink.hidden) return;
    const more = document.createElement('a');
    more.className = 'more-link';
    more.href = pLink.href; more.target = '_blank'; more.rel = 'noopener';
    more.setAttribute('aria-label', 'read the rest on Wikipedia');
    more.title = 'read the rest on Wikipedia';
    const cv = document.createElement('canvas');
    cv.width = 5; cv.height = 5; cv.setAttribute('aria-hidden', 'true');
    drawArrow(cv, LINK_ARROW_SMALL);
    more.append(cv);
    pText.append(more);
  }
  const summaries = new Map();
  let openIdx = -1;

  function wikiUrl(title) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }

  // Every card opened gets a token, so late answers for an old card are ignored.
  let cardToken = 0;
  let cardSpot = null; // where a lantern from this card goes
  const pKicker = $('#panel-kicker');

  // opts.clicked: opened by clicking the plant in the forest, so an animal
  // plays a short sample of its call.
  function openPanel(i, kicker, opts = {}) {
    const a = world.articles[i];
    closePlant();
    openIdx = i;
    const token = ++cardToken;
    cardSpot = spotOf(i);
    markSeen(a[0]);
    pKicker.textContent = kicker || '';
    pKicker.hidden = !kicker;
    pBtn.hidden = false;
    pTitle.textContent = a[0];
    offerTune(a[0], token);
    pText.textContent = '…';
    pLink.href = wikiUrl(a[0]);
    pLink.hidden = false;
    pThumb.hidden = true;
    panel.hidden = false;
    updateLanternButton();

    const show = s => {
      if (openIdx !== i) return;
      if (s.url) pLink.href = s.url;
      setText(s.extract || 'No summary yet. The full article is a step away.');
      if (s.thumb) drawThumb(s.thumb, token);
      if (opts.clicked && isAnimal(s.description)) playSample(a[0]);
    };
    if (summaries.has(a[0])) { show(summaries.get(a[0])); return; }
    fetch(summaryUrl(a[0]))
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => {
        let extract = (d.extract || '').trim();
        if (extract.length > 480) extract = `${extract.slice(0, 470).replace(/\s+\S*$/, '')}…`;
        const s = {
          extract,
          description: d.description || '',
          thumb: d.thumbnail && d.thumbnail.source,
          url: d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page,
        };
        summaries.set(a[0], s);
        show(s);
      })
      .catch(() => { if (openIdx === i) pText.textContent = 'The summary could not be fetched right now.'; });
  }

  // A card for something that isn't a plant: a well, a bottle, the ancient tree.
  function openSpecial({ kicker, title, text, thumb, url, tuneTitle, spot }) {
    closePlant();
    openIdx = -1;
    const token = ++cardToken;
    cardSpot = spot || null;
    pKicker.textContent = kicker || '';
    pKicker.hidden = !kicker;
    pBtn.hidden = !spot;
    if (spot) updateLanternButton();
    pTitle.textContent = title;
    offerTune(tuneTitle, token);
    pLink.hidden = !url;
    if (url) pLink.href = url;
    setText(text || '');
    pThumb.hidden = true;
    if (thumb) drawThumb(thumb, token);
    panel.hidden = false;
  }

  // Thumbnails are redrawn small and scaled up so they match the pixel world.
  // PNGs (diagrams, logos, drawings, often transparent) sit on a pale card
  // with a margin, rather than edge to edge on the dark panel.
  const THUMB_PAPER = css(hex('#e4e8d2'));
  function drawThumb(src, token) {
    const img = new Image();
    img.onload = () => {
      if (token !== cardToken) return;
      const w = 72;
      const paper = /\.(png|svg|gif)(\?|$)/i.test(src);
      const pad = paper ? 6 : 0;
      const iw = w - pad * 2;
      const ih = Math.max(1, Math.min(72 - pad * 2, Math.round((img.naturalHeight / img.naturalWidth) * iw)));
      const fitW = Math.round(Math.min(iw, (ih * img.naturalWidth) / img.naturalHeight));
      pThumb.width = w; pThumb.height = ih + pad * 2;
      const c = pThumb.getContext('2d');
      if (paper) { c.fillStyle = THUMB_PAPER; c.fillRect(0, 0, w, pThumb.height); }
      c.imageSmoothingEnabled = true;
      c.drawImage(img, Math.round((w - fitW) / 2), pad, fitW, ih);
      pThumb.hidden = false;
    };
    img.src = src;
  }

  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    openIdx = -1;
    cardToken++;
    cardSpot = null;
    stopTune();
    canvas.focus({ preventScroll: true });
  }

  // A small lantern in the card's corner: dim when unlit, faintly warm when
  // someone has left one here, glowing once you've left yours.
  // A lantern: handle, cap, glass (g) and base.
  const LANTERN_ICON = ['..###..', '..#.#..', '.#####.', '.#ggg#.', '.#ggg#.', '.#ggg#.', '.#####.', '..###..'];
  function updateLanternButton() {
    const sp = cardSpot;
    const leftHere = !!(sp && myLanternOn(sp.title));
    const others = sp && lanternGroups.some(g => g.x === Math.round(sp.x) && g.y === Math.round(sp.y));
    const c = pBtn.querySelector('canvas').getContext('2d');
    c.clearRect(0, 0, 7, 8);
    // unlit: dark glass; someone else's: a dim glow; yours: lit, with a flame.
    const [frame, glass] = leftHere ? ['#c8a838', '#f5d142'] : others ? ['#a88c28', '#7c681c'] : ['#7c9c5c', '#26401e'];
    LANTERN_ICON.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      c.fillStyle = ch === 'g' ? glass : frame;
      c.fillRect(x, y, 1, 1);
    }));
    if (leftHere) { c.fillStyle = '#fff6c0'; c.fillRect(3, 4, 1, 1); }
    pBtn.setAttribute('aria-pressed', String(leftHere));
    const left = lanternsLeftToday();
    pBtn.title = leftHere ? 'your lantern glows here. take it back (L)'
      : !left ? 'no lanterns left today'
      : `${others ? 'lanterns glow here. leave yours' : 'leave a lantern'} (L) · ${left} left today`;
    pBtn.setAttribute('aria-label', pBtn.title);
  }

  // L leaves a lantern, or takes yours back: on the open article, else the one
  // under the mouse, else the nearest one you can see.
  function lanternShortcut() {
    if (!panel.hidden && cardSpot) { toggleLantern(cardSpot); return; }
    let i = hovered;
    if (i < 0) {
      const p = myWorldPos();
      i = nearestArticle(p.x, p.y, level === 4 ? 10 : 16);
      if (i >= 0 && !canSee(i)) i = -1;
    }
    if (i < 0) { toast('walk up to a plant to leave a lantern'); return; }
    toggleLantern(spotOf(i));
  }

  pBtn.addEventListener('click', () => { if (cardSpot) toggleLantern(cardSpot); });

  // × below the lantern closes the card.
  const pClose = $('#panel-close');
  pClose.addEventListener('click', () => closePanel());
  (() => {
    const c = pClose.querySelector('canvas').getContext('2d');
    c.fillStyle = '#b4d48c';
    ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'].forEach((row, y) =>
      [...row].forEach((ch, x) => { if (ch === '#') c.fillRect(x, y, 1, 1); }));
  })();

  // ------------------------------------------------------- plant panel --

  const plant = $('#plant'), plantForm = $('#plant-form'), plantInput = $('#plant-input');
  const plantBtn = $('#plant-button'), plantLeft = $('#plant-left'), plantStatus = $('#plant-status');
  let plantSpot = null;
  let planting = false;

  function openPlant(x, y) {
    closePanel();
    plantSpot = { x, y };
    plantInput.value = '';
    plantStatus.textContent = plantsLeft() ? '' : 'You have planted today. Come back tomorrow.';
    plant.hidden = false;
    updatePlantButton();
    if (plantsLeft()) plantInput.focus({ preventScroll: true });
  }

  function closePlant() {
    if (plant.hidden) return;
    plant.hidden = true;
    plantSpot = null;
    canvas.focus({ preventScroll: true });
  }

  function updatePlantButton() {
    const left = plantsLeft();
    plantBtn.disabled = left === 0 || planting;
    plantInput.disabled = left === 0;
    plantBtn.textContent = planting ? 'planting…' : left === 0 ? 'planted today' : 'plant it here';
    plantLeft.replaceChildren(...Array.from({ length: DAILY_PLANTS }, (_, k) => {
      const dot = document.createElement('i');
      if (k >= left) dot.className = 'used';
      return dot;
    }));
    plantLeft.setAttribute('aria-label', `${left} of ${DAILY_PLANTS} plantings left today`);
  }

  plantForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!plantSpot || planting || plantsLeft() === 0) return;
    const spot = plantSpot;
    planting = true;
    updatePlantButton();
    plantStatus.textContent = 'looking for it…';
    try {
      const title = await resolveArticle(plantInput.value);
      if (titleIndex.has(title)) throw new Error('that one already grows somewhere in this forest');
      const { mix: [n, t, h], size: wanted } = await plantTraits(title, spot.x, spot.y);
      // A tree that doesn't fit here grows as a bush, or a flower.
      let size = wanted;
      while (size > 0 && !spotFree(spot.x, spot.y, size)) size--;
      if (!spotFree(spot.x, spot.y, size)) throw new Error('someone just planted on this spot');
      const row = { article_title: title, x: spot.x, y: spot.y, n, t, h, size, tint: myTint };
      let saved;
      if (net.client) {
        const { data, error } = await net.client.from('plantings').insert(row).select().single();
        if (error) throw new Error(error.code === '23505' ? 'someone just planted that, or on this spot' : 'it could not be planted right now');
        saved = data;
      } else {
        saved = { ...row, created_at: new Date().toISOString() };
        store.set('wikipark.plantings', store.get('wikipark.plantings', []).concat(saved));
      }
      spendDaily('wikipark.planted', DAILY_PLANTS);
      addPlanting(saved); // realtime may deliver it too; duplicates are ignored
      planting = false;
      closePlant();
      const i = titleIndex.get(title);
      if (i !== undefined) openPanel(i);
    } catch (err) {
      plantStatus.textContent = err.message || 'it could not be planted right now';
    } finally {
      planting = false;
      if (!plant.hidden) updatePlantButton();
    }
  });

  // Click anywhere outside a panel closes it (canvas clicks are handled above).
  document.addEventListener('pointerdown', e => {
    if (e.target === canvas) return;
    if (!panel.hidden && !panel.contains(e.target)) closePanel();
    if (!plant.hidden && !plant.contains(e.target)) closePlant();
  });

  // ----------------------------------------------------------------- hud --
  // Minimal stats bottom-right, as tiny pixel icons and numbers.

  const ICONS = {
    seen: ['.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......'],
    people: ['..##...', '..##.#.', '.......', '.####..', '.####.#', '.####.#', '.......'],
    'sound-on': ['..#..#.', '.##...#', '###.#.#', '###.#.#', '###.#.#', '.##...#', '..#..#.'],
    'sound-off': ['..#....', '.##....', '###.#.#', '###..#.', '###.#.#', '.##....', '..#....'],
  };
  function drawIcon(el, name, colour) {
    const c = el.getContext('2d');
    c.clearRect(0, 0, 7, 7);
    c.fillStyle = colour;
    ICONS[name].forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') c.fillRect(x, y, 1, 1); }));
  }
  document.querySelectorAll('.ico[data-icon]').forEach(el => drawIcon(el, el.dataset.icon, '#b4d48c'));

  const seen = new Set(store.get('wikipark.seen', []));
  let plantedCount = 0;
  let onlineCount = 1;
  const statSeen = $('#stat-seen'), statTotal = $('#stat-total');
  const statOnline = $('#stat-online'), statPlanted = $('#stat-planted');
  const fmt = n => n.toLocaleString('en-US');

  function markSeen(title) {
    if (seen.has(title)) return;
    seen.add(title);
    store.set('wikipark.seen', [...seen]);
    updateStats();
  }

  function updateStats() {
    if (!world) return;
    statSeen.textContent = fmt(seen.size);
    statTotal.textContent = fmt(world.articles.length);
    statOnline.textContent = fmt(onlineCount);
    statPlanted.textContent = fmt(plantedCount);
  }

  // Pointer, bottom-left: the lantern icon, with a bright mark on the box's
  // rim showing which way the nearest lantern is (8 directions): a bar along
  // a side for north, east, south and west, a corner bracket for the diagonals.
  const pointerBox = $('#pointer');
  const pointerCtx = pointerBox.querySelector('canvas').getContext('2d');
  // Drawn at one canvas pixel per screen pixel; the lantern is doubled to
  // match the card's. Its glass spans x 10-19 and its body y 11-20, so the
  // side bars are as long as the lantern is wide (or its body tall).
  const PN = 30, RIM = 2, ARM = 6;
  const RIM_MARKS = [
    [[PN - RIM, 11, RIM, 10]],                                   // 0 east
    [[PN - ARM, PN - RIM, ARM, RIM], [PN - RIM, PN - ARM, RIM, ARM]], // 1 south-east
    [[10, PN - RIM, 10, RIM]],                                   // 2 south
    [[0, PN - RIM, ARM, RIM], [0, PN - ARM, RIM, ARM]],          // 3 south-west
    [[0, 11, RIM, 10]],                                          // 4 west
    [[0, 0, ARM, RIM], [0, 0, RIM, ARM]],                        // 5 north-west
    [[10, 0, 10, RIM]],                                          // 6 north
    [[PN - ARM, 0, ARM, RIM], [PN - RIM, 0, RIM, ARM]],          // 7 north-east
  ];
  let pointerKey = '';
  function updateCompass() {
    // Measured from the walker (the middle of the view), not the mouse.
    const me = { x: cam.x + innerWidth / scale / 2, y: cam.y + innerHeight / scale / 2 };
    let best = null, bd = Infinity;
    for (const g of lanternGroups) {
      const d = Math.hypot(g.x - me.x, g.y - me.y);
      if (d < bd) { bd = d; best = g; }
    }
    // Nothing to point at, or the lantern is already in view: no pointer.
    // (A lantern shows anywhere on screen: its glow at night, the lantern by day.)
    const halfW = innerWidth / scale / 2 - 2, halfH = innerHeight / scale / 2 - 2;
    const inView = best && Math.abs(best.x - me.x) < halfW && Math.abs(best.y - me.y) < halfH;
    pointerBox.hidden = !best || inView;
    if (pointerBox.hidden) { pointerKey = ''; return; }
    pointerBox.title = `nearest lantern: about ${Math.max(1, Math.round(bd / 4))} steps`;
    const step = ((Math.round(Math.atan2(best.y - me.y, best.x - me.x) / (Math.PI / 4)) % 8) + 8) % 8;
    if (String(step) === pointerKey) return;
    pointerKey = String(step);
    pointerCtx.clearRect(0, 0, PN, PN);
    // The lantern, lit, as on the cards.
    LANTERN_ICON.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      pointerCtx.fillStyle = ch === 'g' ? '#f5d142' : '#c8a838';
      pointerCtx.fillRect(8 + x * 2, 7 + y * 2, 2, 2);
    }));
    pointerCtx.fillStyle = '#fff6c0';
    pointerCtx.fillRect(14, 15, 2, 2);
    // The mark on the rim, in the lantern's direction.
    pointerCtx.fillStyle = '#f5d142';
    for (const [x, y, w, h] of RIM_MARKS[step]) pointerCtx.fillRect(x, y, w, h);
  }

  const clockTime = $('#clock-time');
  function updateClock() {
    const now = new Date();
    const text = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (clockTime.textContent !== text) {
      clockTime.textContent = text;
      clockTime.dateTime = text;
    }
  }

  // Info panel, top-left.
  const info = $('#info'), infoToggle = $('#info-toggle');
  function setInfo(open) {
    info.hidden = !open;
    infoToggle.setAttribute('aria-expanded', String(open));
  }
  infoToggle.addEventListener('click', () => setInfo(info.hidden));
  document.addEventListener('pointerdown', e => {
    if (!info.hidden && !info.contains(e.target) && e.target !== infoToggle) setInfo(false);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') setInfo(false); });

  // --------------------------------------------------------------- sound --
  // A soothing forest, synthesized: no audio files. Footsteps match the ground
  // under you, birds sing by day and crickets at night, leaves rustle in a
  // drifting breeze, and the stream grows louder as you come near water.
  // Off by default; the toggle remembers your choice.

  const sound = { ctx: null, on: store.get('wikipark.sound', false), nextBird: 0, nextBreeze: 0, nextStream: 0, stride: 0, lastStep: 0, px: null, py: null };
  const soundToggle = $('#sound-toggle');

  function noiseBuffer(ac, brown) {
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  function loopThrough(ac, buf, nodes) {
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    let prev = src;
    for (const n of nodes) { prev.connect(n); prev = n; }
    src.start();
    return prev;
  }

  function startAudio() {
    if (sound.ctx) { sound.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = sound.ctx = new AC();
    sound.master = ac.createGain();
    sound.master.gain.setValueAtTime(0, ac.currentTime);
    sound.master.gain.linearRampToValueAtTime(0.9, ac.currentTime + 2);
    sound.master.connect(ac.destination);
    sound.white = noiseBuffer(ac, false);
    const brown = noiseBuffer(ac, true);

    // Leaves in a breeze.
    const leafFilter = ac.createBiquadFilter();
    leafFilter.type = 'bandpass'; leafFilter.frequency.value = 1400; leafFilter.Q.value = 0.6;
    sound.breeze = ac.createGain(); sound.breeze.gain.value = 0.015;
    loopThrough(ac, sound.white, [leafFilter, sound.breeze]).connect(sound.master);

    // Water: a low murmur and a brighter babble.
    sound.water = ac.createGain(); sound.water.gain.value = 0;
    sound.water.connect(sound.master);
    const low = ac.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 700;
    loopThrough(ac, brown, [low]).connect(sound.water);
    const babble = ac.createBiquadFilter(); babble.type = 'bandpass'; babble.frequency.value = 2400; babble.Q.value = 1.5;
    const babbleGain = ac.createGain(); babbleGain.gain.value = 0.12;
    loopThrough(ac, sound.white, [babble, babbleGain]).connect(sound.water);
  }

  function showSound(on) {
    soundToggle.setAttribute('aria-pressed', String(on));
    drawIcon(soundToggle.querySelector('canvas'), on ? 'sound-on' : 'sound-off', on ? '#e4f2c8' : '#b4d48c');
  }
  function setSound(on) {
    sound.on = on;
    store.set('wikipark.sound', on);
    showSound(on);
    if (on) startAudio();
    else if (sound.ctx) sound.ctx.suspend();
  }
  soundToggle.addEventListener('click', () => setSound(!sound.on));
  showSound(sound.on);
  if (sound.on) {
    // Browsers only allow sound after a click or key press, so a remembered
    // "on" starts with the first one.
    const kick = e => {
      removeEventListener('pointerdown', kick, true);
      removeEventListener('keydown', kick, true);
      if (e.target !== soundToggle && !soundToggle.contains(e.target) && sound.on) startAudio();
    };
    addEventListener('pointerdown', kick, true);
    addEventListener('keydown', kick, true);
  }

  function surfaceAt(wx, wy) {
    const bx = Math.floor(wx / world.block), by = Math.floor(wy / world.block);
    if (bx < 0 || by < 0 || bx >= world.gw || by >= world.gh) return 'thicket';
    const f = Math.floor(terrainCells[by * world.gw + bx] / world.bands);
    return f === 1 || f === 2 ? 'thicket' : f === 3 || f === 4 ? 'water' : f === 5 || f === 6 ? 'sand' : f === 7 ? 'bridge' : 'grass';
  }

  function burst(filterType, freq, q, dur, vol, rate) {
    const ac = sound.ctx, t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = sound.white;
    src.playbackRate.value = rate;
    const f = ac.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sound.master);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  function step(surface) {
    const r = 0.85 + Math.random() * 0.3;
    if (surface === 'thicket') burst('bandpass', 1900 * r, 0.5, 0.2, 0.08, 1);
    else if (surface === 'sand') burst('highpass', 2200 * r, 0.7, 0.08, 0.07, 1);
    else if (surface === 'water') burst('lowpass', 520 * r, 1.2, 0.26, 0.12, 0.8);
    else if (surface === 'bridge') burst('bandpass', 380 * r, 2.5, 0.13, 0.14, 1); // hollow wooden knock
    else burst('bandpass', 800 * r, 0.9, 0.11, 0.11, 1);
  }

  function tone(freqFrom, freqTo, start, dur, vol, pan, type = 'sine') {
    const ac = sound.ctx;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqFrom, start);
    o.frequency.exponentialRampToValueAtTime(freqTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(sound.master); }
    else g.connect(sound.master);
    o.start(start); o.stop(start + dur + 0.02);
  }

  function birdSong() {
    const t0 = sound.ctx.currentTime + 0.05, pan = Math.random() * 1.6 - 0.8;
    const base = 2400 + Math.random() * 2000, notes = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < notes; k++) {
      const f = base * (0.9 + Math.random() * 0.25);
      tone(f, f * (1.15 + Math.random() * 0.3), t0 + k * (0.1 + Math.random() * 0.06), 0.08, 0.035, pan);
    }
  }

  function crickets() {
    const t0 = sound.ctx.currentTime + 0.05, pan = Math.random() * 1.4 - 0.7;
    const f = 4300 + Math.random() * 700;
    for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) tone(f, f * 1.01, t0 + k * 0.06, 0.035, 0.012, pan, 'triangle');
  }

  function waterNearby(wx, wy) {
    const R = 16; // blocks
    const bx = Math.floor(wx / world.block), by = Math.floor(wy / world.block);
    let best = Infinity;
    for (let y = by - R; y <= by + R; y++) for (let x = bx - R; x <= bx + R; x++) {
      if (x < 0 || y < 0 || x >= world.gw || y >= world.gh) continue;
      const f = Math.floor(terrainCells[y * world.gw + x] / world.bands);
      if (f === 3 || f === 4) best = Math.min(best, Math.hypot(x - bx, y - by));
    }
    return best <= R ? (1 - best / R) ** 2 : 0;
  }

  function updateSound(t) {
    if (!sound.on || !sound.ctx || sound.ctx.state !== 'running' || !world) return;
    const ac = sound.ctx, now = ac.currentTime;
    const cx = cam.x + innerWidth / scale / 2, cy = cam.y + innerHeight / scale / 2;

    // Footsteps: one roughly every five world pixels walked, never faster than a brisk walk.
    if (sound.px !== null) sound.stride += Math.hypot(cx - sound.px, cy - sound.py);
    sound.px = cx; sound.py = cy;
    if (sound.stride > 5) {
      sound.stride = 0;
      if (t - sound.lastStep > 240) { sound.lastStep = t; step(surfaceAt(cx, cy)); }
    }

    if (t > sound.nextBreeze) {
      sound.nextBreeze = t + 2500 + Math.random() * 3000;
      const top = level === 4 ? 0.02 : 0.045;
      sound.breeze.gain.linearRampToValueAtTime(0.006 + Math.random() * top, now + 2.5);
    }
    if (t > sound.nextStream) {
      sound.nextStream = t + 300;
      sound.water.gain.linearRampToValueAtTime(0.22 * waterNearby(cx, cy), now + 0.4);
    }
    if (t > sound.nextBird) {
      if (level <= 1) { birdSong(); sound.nextBird = t + 2000 + Math.random() * 6000; }
      else if (level === 2) { birdSong(); sound.nextBird = t + 6000 + Math.random() * 9000; }
      else if (level === 4) { crickets(); sound.nextBird = t + 700 + Math.random() * 2200; }
      else sound.nextBird = t + 3000;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!sound.ctx) return;
    if (document.hidden) sound.ctx.suspend();
    else if (sound.on) sound.ctx.resume();
  });

  // ---------------------------------------------------------- recordings --
  // Real recordings from Wikipedia: a bird's song, a frog's call, a theremin.
  // Clicking an animal in the forest plays a short sample cut from its
  // recording (with sound on); a card shows ♪ when its article has a
  // recording, and ♪ plays all of it. Pronunciations and spoken articles are
  // never used.

  const NOT_A_RECORDING = /pronunc|spoken|-article\.|^File:(En|LL-Q\d+|[A-Z][a-z](-[a-z]{2,3})?)[-_ ]/i;
  const ANIMAL = /\b(bird|birds|owl|owls|thrush|songbird|warbler|wren|finch|mammal|mammals|amphibian|frog|frogs|toad|insect|insects|cricket|cicada|whale|whales|dolphin|bat|bats|primate|monkey|ape|reptile|deer|wolf|fox|bear|seal)\b/i;
  const NOT_ANIMAL = /\b(plant|plants|tree|trees|fung|flower|moss|lichen|alga|shrub|herb)\b/i;
  const isAnimal = description => !!description && ANIMAL.test(description) && !NOT_ANIMAL.test(description);

  const recordings = new Map(); // title -> Promise<{ url, duration } | null>
  function recordingFor(title) {
    if (!recordings.has(title)) {
      recordings.set(title, (async () => {
        const list = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`)
          .then(r => (r.ok ? r.json() : null));
        const audio = ((list && list.items) || []).filter(it => it.type === 'audio' && !NOT_A_RECORDING.test(it.title)
          && !NOT_A_RECORDING.test((it.caption && it.caption.text) || ''));
        if (!audio.length) return null;
        const info = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(audio[0].title)}&prop=videoinfo&viprop=url|derivatives&format=json&formatversion=2&origin=*`)
          .then(r => r.json());
        const vi = info.query && info.query.pages && info.query.pages[0].videoinfo && info.query.pages[0].videoinfo[0];
        if (!vi) return null;
        // MP3 plays everywhere; Wikimedia keeps one beside most Ogg files.
        const mp3 = (vi.derivatives || []).find(x => /audio\/mpeg/.test(x.type));
        return { url: mp3 ? mp3.src : vi.url, duration: vi.duration || 0 };
      })().catch(() => null));
    }
    return recordings.get(title);
  }

  // A short sample: ~2.5s from the loudest stretch of the recording, faded in and out.
  const decoded = new Map(); // url -> Promise<AudioBuffer>
  let sampleNode = null;
  async function playSample(title, fallback) {
    if (!sound.on || !sound.ctx || sound.ctx.state !== 'running') return;
    const rec = await recordingFor(title);
    if (!rec || rec.duration > 240) { if (fallback) fallback(); return; }
    if (!decoded.has(rec.url)) {
      decoded.set(rec.url, fetch(rec.url).then(r => r.arrayBuffer()).then(b => sound.ctx.decodeAudioData(b)));
    }
    let buf;
    try { buf = await decoded.get(rec.url); } catch (e) { decoded.delete(rec.url); if (fallback) fallback(); return; }
    const ac = sound.ctx, len = Math.min(2.5, buf.duration), t0 = ac.currentTime + 0.02;
    const start = loudestStart(buf, len);
    if (sampleNode) { try { sampleNode.stop(); } catch (e) { /* already ended */ } }
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.55, t0 + 0.06);
    g.gain.setValueAtTime(0.55, t0 + len - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(g); g.connect(sound.master);
    src.start(t0, start, len);
    sampleNode = src;
  }

  function loudestStart(buf, len) {
    const data = buf.getChannelData(0), rate = buf.sampleRate, hop = Math.floor(rate * 0.25), win = Math.floor(rate * len);
    let best = 0, bestE = -1;
    for (let s = 0; s + win <= data.length; s += hop) {
      let e = 0;
      for (let i = s; i < s + win; i += 64) e += data[i] * data[i];
      if (e > bestE) { bestE = e; best = s; }
    }
    return best / rate;
  }

  // ♪ in the card: the whole recording, on demand (an explicit click, so it
  // plays even with forest sounds off).
  const pTune = $('#panel-tune');
  let tune = null;
  (() => {
    const c = pTune.querySelector('canvas').getContext('2d');
    c.fillStyle = '#b4d48c';
    ['...##..', '...#.#.', '...#..#', '...#...', '.###...', '####...', '.##....'].forEach((row, y) =>
      [...row].forEach((ch, x) => { if (ch === '#') c.fillRect(x, y, 1, 1); }));
  })();

  function stopTune() {
    if (tune) { tune.pause(); tune = null; }
    pTune.setAttribute('aria-pressed', 'false');
  }

  function offerTune(title, token) {
    stopTune();
    pTune.hidden = true;
    if (!title) return;
    recordingFor(title).then(rec => {
      if (!rec || token !== cardToken) return;
      pTune.hidden = false;
      pTune.onclick = () => {
        if (tune) { stopTune(); return; }
        tune = new Audio(rec.url);
        tune.volume = 0.8;
        tune.addEventListener('ended', stopTune);
        tune.play().catch(stopTune);
        pTune.setAttribute('aria-pressed', 'true');
      };
    });
  }

  // --------------------------------------------------------------- toast --

  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1600);
  }

  // --------------------------------------------------------------- start --

  async function init() {
    resize();
    updateLevel();
    try {
      await loadWorld();
    } catch (e) {
      console.error(e);
      toast('the forest could not be loaded');
      return;
    }
    resize();
    placeSecrets();
    const saved = store.get('wikipark.pos', null);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      centerOn(saved.x, saved.y);
    } else if (secrets.library) {
      centerOn(secrets.library.x, secrets.library.y); // first visit: at the library
    } else {
      const a = world.articles[Math.floor(Math.random() * world.articles.length)];
      centerOn(a[2] + (Math.random() - 0.5) * 30, a[3] + (Math.random() - 0.5) * 30);
    }
    canvas.focus({ preventScroll: true });
    updateStats();
    updateClock();
    connect();
    setInterval(groupLanterns, 10 * 60 * 1000); // lanterns slowly dim
    setInterval(updateClock, 1000);
    setInterval(updateCompass, 200);
    start();
  }

  init();
})();
