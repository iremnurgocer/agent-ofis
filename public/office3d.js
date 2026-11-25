// Agent Ofis — 3B ofis sahnesi (three.js)
// Her proje bir oda, her açık oturum bir çalışan. Çalışanlar durumlarına göre davranır:
//   çalışıyor → masasına oturur, klavyede yazar; ekranında yaptığı iş görünür
//   araştırma/okuma/dosya → kalkıp kitaplığa gider, raflardan bir şey alır
//   ekip yönetimi → duvar ekranının başına geçip anlatır
//   boşta → kanepeye oturur ya da kahve makinesinin yanında bekler
//   onay bekliyor → masasının yanında ayağa kalkar, sana döner, elini kaldırır
//   üzerine gelince → başını çevirip sana bakar, başını sallar
// Modeller: Kenney "Mini Characters" ve "Furniture Kit" (CC0, www.kenney.nl) — public/assets altında.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const ROLE = {
  eposta: ['✉️', 'E-posta'], mesaj: ['💬', 'Mesajlaşma'], 'is-takip': ['📋', 'İş takibi'], takvim: ['📅', 'Takvim'],
  dosya: ['📁', 'Dosyalar'], tarayici: ['🌐', 'Tarayıcı'], arastirma: ['🔎', 'Araştırma'], kod: ['✏️', 'Kod yazıyor'],
  okuma: ['📖', 'İnceliyor'], terminal: ['⌘', 'Terminal'], yonetici: ['👥', 'Ekip yönetiyor'], tasarim: ['🎨', 'Tasarım'], genel: ['⚙️', 'Çalışıyor'],
};
const role = (r) => ROLE[r] || ROLE.genel;
const DOCS_ROLES = new Set(['arastirma', 'okuma', 'dosya', 'is-takip']);
const GESTURES = ['pick-up', 'emote-yes', 'emote-no', 'interact-right', 'interact-left'];

// Ölçüler "kit birimi" cinsinden (Kenney modellerinin kendi ölçeği); dünya grubu W kat büyütülür.
const W = 2.4;
const DX = 1.05, DZ = 1.3, MAX_DESKS = 9, COLS = 3;
const DESK_TOP = 0.38, WALK = 0.62;
const CHAR_FILES = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f', 'male-g'];
const FURN = ['desk', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'bookcaseOpen', 'bookcaseClosedWide', 'books', 'pottedPlant',
  'plantSmall1', 'plantSmall2', 'plantSmall3', 'loungeSofa', 'kitchenCoffeeMachine', 'sideTable', 'rugRectangle', 'rugRounded',
  'lampSquareFloor', 'tableCoffee', 'trashcan', 'wall', 'wallWindow', 'coatRackStanding', 'televisionModern', 'lampRoundTable'];

// Ayarlar (görsel kontrolle bulunan değerler)
const T = { sitY: 0.13, sitBack: 0.0, sofaY: 0.10, sofaFwd: 0.02, charScale: 1.0, subScale: 0.72 };

let container, renderer, labelRenderer, scene, camera, controls, clock, raycaster, world;
let active = false, built = false, cb = {}, selectedId = null, hovered = null, pointerIn = false;
const pointer = new THREE.Vector2();
let lastLayoutKey = '', roomGroup = null, roomsData = [], firstFrame = true, assetsReady = false;
const models = {};       // ad → { scene, size, min }
const chars = [];        // { scene, clips }
const agents = new Map(), subs = new Map(), desks = new Map();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

// ------------------------------------------------------------------ kurulum
function mount(el, callbacks) {
  container = el; cb = callbacks || {};
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels3d';
  container.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  world = new THREE.Group(); world.scale.setScalar(W); scene.add(world);
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 500);
  camera.position.set(0, 22, 26);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 1.8; controls.maxDistance = 120;

  scene.add(new THREE.HemisphereLight(0xfafcff, 0xb9a58c, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun, sun.target); scene.userData.sun = sun;
  const fill = new THREE.DirectionalLight(0xdce8ff, 0.55); fill.position.set(-30, 18, -12); scene.add(fill);

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  applyTheme();

  const cv = renderer.domElement;
  cv.addEventListener('pointermove', (e) => { setPointer(e); pointerIn = true; });
  cv.addEventListener('pointerleave', () => { pointerIn = false; setHover(null); cb.onHover && cb.onHover(null); });
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 6) return;
    setPointer(e);
    const h = pick();
    if (h) { focus(h.id); cb.onSelect && cb.onSelect(h.id); }
  });
  new ResizeObserver(resize).observe(container);
  resize();
  loadAssets();
  built = true;
  loop();
}

async function loadAssets() {
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  try {
    await Promise.all([
      ...FURN.map(async (n) => {
        const g = await load(`assets/furniture/${n}.glb`);
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const box = new THREE.Box3().setFromObject(g.scene);
        models[n] = { scene: g.scene, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
      }),
      ...CHAR_FILES.map(async (n, i) => {
        const g = await load(`assets/chars/character-${n}.glb`);
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        chars[i] = { scene: g.scene, clips: Object.fromEntries(g.animations.map((c) => [c.name, c])) };
      }),
    ]);
    assetsReady = true;
    lastLayoutKey = '';
    cb.onReady && cb.onReady();
  } catch (err) { cb.onError && cb.onError(err); }
}

function applyTheme() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  scene.background = new THREE.Color(dark ? 0x0e141b : 0xe6e9ee);
  scene.fog = new THREE.Fog(scene.background, 120, 260);
  scene.userData.dark = dark;
}
function resize() {
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  pointer.cx = e.clientX; pointer.cy = e.clientY;
}

// ------------------------------------------------------------------ yardımcılar
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Modeli tabanı ortalanmış olarak yerleştir: (x, z) merkez, y taban yüksekliği, ry dönüş
function place(parent, name, x, z, ry = 0, y = 0, s = 1) {
  const m = models[name]; if (!m) return null;
  const inner = m.scene.clone(true);
  inner.position.set(-(m.min.x + m.size.x / 2), -m.min.y, -(m.min.z + m.size.z / 2));
  const pivot = new THREE.Group(); pivot.add(inner);
  pivot.position.set(x, y, z); pivot.rotation.y = ry; pivot.scale.setScalar(s);
  parent.add(pivot);
  return pivot;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return { canvas: c, tex: t };
}
function floorTexture(dark) {
  // parke deseni (prosedürel)
  const { tex } = canvasTex(512, 512, (c, w) => {
    const base = dark ? [74, 58, 44] : [205, 170, 128];
    for (let row = 0; row < 16; row++) {
      let x = -((row * 97) % 180);
      while (x < w) {
        const len = 140 + ((row * 31 + x) % 90);
        const v = ((row * 13 + x * 7) % 21) - 10;
        c.fillStyle = `rgb(${base[0] + v},${base[1] + v * 0.8},${base[2] + v * 0.6})`;
        c.fillRect(x, row * 32, len - 2, 30);
        c.fillStyle = 'rgba(0,0,0,.05)';
        for (let k = 0; k < 4; k++) c.fillRect(x + 8 + k * 30, row * 32 + 6 + (k % 3) * 7, len * 0.4, 1);
        x += len;
      }
      c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(0, row * 32 + 30, w, 2);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ------------------------------------------------------------------ odalar
const layoutKey = (rooms) => rooms.map((r) => r.key + ':' + r.list.map((s) => s.id).join(',')).join('|');

function buildWorld(rooms) {
  if (roomGroup) world.remove(roomGroup);
  roomGroup = new THREE.Group(); world.add(roomGroup);
  desks.clear();
  const dark = scene.userData.dark;
  const wood = floorTexture(dark);

  const total = rooms.reduce((n, r) => n + Math.min(MAX_DESKS, r.list.length), 0);
  const maxRowW = Math.max(9, Math.sqrt(total) * 3.6);
  let x = 0, z = 0, rowD = 0;
  roomsData = [];
  for (const r of rooms) {
    const n = Math.min(MAX_DESKS, r.list.length);
    const cols = Math.min(COLS, Math.max(2, n)), rows = Math.max(1, Math.ceil(n / cols));
    const w = 0.55 + cols * DX + 1.9, d = 1.05 + rows * DZ + 1.55;
    if (x > 0 && x + w > maxRowW) { x = 0; z += rowD + 0.9; rowD = 0; }
    roomsData.push({ ...r, x0: x, z0: z, w, d, cols, rows, n });
    x += w + 0.9; rowD = Math.max(rowD, d);
  }
  const TW = Math.max(...roomsData.map((r) => r.x0 + r.w)), TD = Math.max(...roomsData.map((r) => r.z0 + r.d));
  for (const r of roomsData) { r.x0 -= TW / 2; r.z0 -= TD / 2; }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(TW + 40, TD + 40), new THREE.MeshStandardMaterial({ color: dark ? 0x151b22 : 0xd3d8de, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; roomGroup.add(ground);

  for (const r of roomsData) buildRoom(r, dark, wood);

  const sun = scene.userData.sun, R = (Math.max(TW, TD) / 2 + 2) * W;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(R * 0.45, 60, R * 0.55); sun.target.position.set(0, 0, 0);

  if (firstFrame) { overview(true); firstFrame = false; }
}

function buildRoom(r, dark, wood) {
  const g = new THREE.Group(); roomGroup.add(g);
  const { x0, z0, w, d } = r;
  const ft = wood.clone(); ft.needsUpdate = true; ft.repeat.set(w / 1.6, d / 1.6);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55 }));
  floor.position.set(x0 + w / 2, -0.015, z0 + d / 2); floor.receiveShadow = true; g.add(floor);
  // duvarlar: arka (pencereli) ve sol
  const nW = Math.ceil(w), nD = Math.ceil(d);
  for (let i = 0; i < nW; i++) {
    const rest = Math.min(1, w - i);
    const seg = place(g, i % 3 === 1 && rest === 1 ? 'wallWindow' : 'wall', x0 + i + rest / 2, z0 + 0.03, 0);
    if (seg) seg.scale.x = rest;
  }
  for (let i = 0; i < nD; i++) {
    const rest = Math.min(1, d - i);
    const seg = place(g, i % 3 === 1 && rest === 1 ? 'wallWindow' : 'wall', x0 + 0.03, z0 + i + rest / 2, Math.PI / 2);
    if (seg) seg.scale.x = rest;
  }
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, d - 0.2), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.22, roughness: 0.05 }));
  glass.position.set(x0 + w - 0.01, 0.25, z0 + d / 2); g.add(glass);
  // tabela
  const busy = r.list.filter((s) => s.state === 'calisiyor').length, live = r.list.filter((s) => s.live).length;
  const sign = canvasTex(1024, 150, (c, Wc, H) => {
    c.fillStyle = dark ? '#18212b' : '#ffffff'; c.beginPath(); c.roundRect(0, 0, Wc, H, 28); c.fill();
    c.fillStyle = busy ? '#16a34a' : live ? '#64748b' : '#9ca3af'; c.beginPath(); c.arc(72, H / 2, 24, 0, 7); c.fill();
    c.fillStyle = dark ? '#e6edf3' : '#111827'; c.font = '700 62px Inter, -apple-system, system-ui, sans-serif'; c.textBaseline = 'middle';
    let name = r.name; while (c.measureText(name).width > Wc - 150 && name.length > 3) name = name.slice(0, -2); if (name !== r.name) name += '…';
    c.fillText(name, 120, H / 2 + 2);
  });
  const sw = Math.min(w - 0.4, 3.4);
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 150 / 1024), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true }));
  signM.position.set(x0 + 0.25 + sw / 2, 1.42, z0 + 0.07); g.add(signM);

  // masalar
  const deskX0 = x0 + 0.55, deskZ0 = z0 + 1.05;
  r.list.slice(0, MAX_DESKS).forEach((s, i) => {
    const col = i % r.cols, row = Math.floor(i / r.cols);
    desks.set(s.id, makeDesk(g, s, deskX0 + col * DX + DX / 2, deskZ0 + row * DZ + 0.2));
  });
  const rug = place(g, 'rugRectangle', deskX0 + (r.cols * DX) / 2, deskZ0 + (r.rows * DZ) / 2 - 0.05, 0, 0.001);
  if (rug) rug.scale.set((r.cols * DX + 0.2) / models.rugRectangle.size.x, 1, (r.rows * DZ) / models.rugRectangle.size.z);

  // sağ bölge: kitaplıklar (arka), duvar ekranı, kanepe köşesi (ön)
  const zx = x0 + 0.55 + r.cols * DX + 0.2;
  place(g, 'bookcaseOpen', zx + 0.45, z0 + 0.2, 0);
  place(g, 'bookcaseClosedWide', zx + 1.25, z0 + 0.2, 0);
  for (let k = 0; k < 3; k++) place(g, 'books', zx + 0.45 + (k - 1) * 0.1, z0 + 0.22, 0, 0.03 + k * 0.29, 0.75);
  r.docsSpot = new THREE.Vector3(zx + 0.6, 0, z0 + 0.75); r.docsFace = Math.PI;
  const tvX = x0 + Math.min(w - 2.4, 2.3);
  place(g, 'televisionModern', tvX, z0 + 0.12, 0, 0.62);
  r.boardSpot = new THREE.Vector3(tvX, 0, z0 + 0.85); r.boardFace = Math.PI;
  const sofaX = zx + 0.85, sofaZ = z0 + d - 1.25;
  place(g, 'rugRounded', sofaX, sofaZ + 0.45, 0, 0.002, 0.9);
  place(g, 'loungeSofa', sofaX, sofaZ, 0);
  place(g, 'tableCoffee', sofaX, sofaZ + 0.62, 0);
  place(g, 'plantSmall2', sofaX - 0.05, sofaZ + 0.62, 0, 0.23);
  place(g, 'lampSquareFloor', sofaX + 0.72, sofaZ, 0);
  r.sofaSeats = [new THREE.Vector3(sofaX - 0.24, 0, sofaZ + T.sofaFwd), new THREE.Vector3(sofaX + 0.24, 0, sofaZ + T.sofaFwd)];
  place(g, 'sideTable', x0 + 0.45, z0 + d - 0.3, Math.PI);
  place(g, 'kitchenCoffeeMachine', x0 + 0.35, z0 + d - 0.3, Math.PI, 0.38);
  r.coffeeSpots = [new THREE.Vector3(x0 + 0.5, 0, z0 + d - 0.75), new THREE.Vector3(x0 + 0.95, 0, z0 + d - 0.7)];
  place(g, 'pottedPlant', x0 + 0.3, z0 + 0.35, 0, 0, 1.3);
  place(g, 'pottedPlant', x0 + w - 0.3, z0 + d - 0.3, 0, 0, 1.2);
  place(g, 'trashcan', x0 + 0.25, z0 + d - 1.0, 0, 0, 0.8);
  place(g, 'coatRackStanding', zx + 0.1, z0 + d - 0.35, 0);
  r.aisleZ = deskZ0 + r.rows * DZ - 0.05;
}

function makeDesk(g, s, x, z) {
  // çalışan +z tarafında oturur, -z'ye (ekrana) bakar
  place(g, 'desk', x, z, Math.PI);
  const mon = place(g, 'computerScreen', x, z - 0.1, 0, DESK_TOP);
  place(g, 'computerKeyboard', x - 0.02, z + 0.06, 0, DESK_TOP);
  place(g, 'computerMouse', x + 0.2, z + 0.07, 0, DESK_TOP);
  if (hash(s.id) % 3 === 0) place(g, 'plantSmall' + (1 + (hash(s.id) >> 3) % 3), x - 0.27, z - 0.08, 0, DESK_TOP);
  if (hash(s.id) % 4 === 1) place(g, 'lampRoundTable', x + 0.28, z - 0.1, 0, DESK_TOP, 0.8);
  const chair = place(g, 'chairDesk', x, z + 0.31, Math.PI);
  const screen = canvasTex(400, 240, () => {});
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.2), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
  const ms = models.computerScreen;
  sm.position.set(x, DESK_TOP + ms.size.y * 0.58, z - 0.1 + ms.size.z / 2 + 0.004);
  g.add(sm);
  [mon, chair, sm].forEach((o) => o && o.traverse((m) => { m.userData.sessionId = s.id; }));
  return { x, z, screen, lastKey: '', screenMesh: sm, seat: new THREE.Vector3(x, 0, z + 0.31 + T.sitBack), seatFace: Math.PI, chair,
    standSpot: new THREE.Vector3(x + 0.34, 0, z + 0.58) };
}

function drawScreen(d, s) {
  const lt = s.lastTool;
  const working = s.state === 'calisiyor', waiting = s.state === 'bekliyor', present = s.live || working;
  const key = [s.state, lt && lt.human, Math.floor(Date.now() / 60000)].join('|');
  if (key === d.lastKey) return; d.lastKey = key;
  const c = d.screen.canvas.getContext('2d'), Wc = d.screen.canvas.width, H = d.screen.canvas.height;
  const g0 = c.createLinearGradient(0, 0, 0, H);
  g0.addColorStop(0, present ? '#14263a' : '#0b0f14'); g0.addColorStop(1, present ? '#0c1724' : '#05070a');
  c.fillStyle = g0; c.fillRect(0, 0, Wc, H);
  if (working) {
    const [ic, lbl] = lt ? role(lt.role) : ['💭', 'Düşünüyor'];
    c.fillStyle = 'rgba(43,179,154,.28)'; c.fillRect(0, 0, Wc, 44);
    c.fillStyle = '#8ef0d6'; c.font = '700 24px Inter, system-ui, sans-serif'; c.fillText(`${ic}  ${lbl}`, 16, 30);
    c.fillStyle = '#e1ebf3'; c.font = '500 21px ui-monospace, Menlo, monospace';
    wrap(c, lt ? (lt.human || lt.detail || '') : 'Bir sonraki adımı planlıyor', Wc - 32, 6).forEach((ln, i) => c.fillText(ln, 16, 76 + i * 27));
  } else if (waiting) {
    c.fillStyle = '#6b440b'; c.fillRect(0, 0, Wc, H);
    c.fillStyle = '#ffe0a8'; c.font = '700 30px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('⏳ Onayını bekliyor', Wc / 2, H / 2 + 10); c.textAlign = 'left';
  } else if (present) {
    c.fillStyle = '#6f8396'; c.font = '600 26px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('💤 Boşta', Wc / 2, H / 2 + 8); c.textAlign = 'left';
  } else {
    c.fillStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(Wc * 0.55, 0); c.lineTo(0, H * 0.8); c.fill();
  }
  d.screen.tex.needsUpdate = true;
}
function wrap(c, t, maxW, maxLines) {
  const words = String(t).split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const tr = cur ? cur + ' ' + w : w; if (c.measureText(tr).width <= maxW) cur = tr; else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; } }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

// ------------------------------------------------------------------ çalışanlar
class Person {
  constructor(s, { scale = T.charScale, look = s.id } = {}) {
    this.s = s; this.id = s.id; this.scale = scale;
    this.root = new THREE.Group(); world.add(this.root);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.targetYaw = 0;
    this.path = []; this.mode = 'stand'; this.goalKey = ''; this.base = 'idle';
    this.lookAtYou = 0; this.nextGesture = 0; this.headYaw = 0;
    const c = chars[hash(look) % chars.length] || chars[0];
    this.model = SkeletonUtils.clone(c.scene);
    this.model.scale.setScalar(scale);
    this.model.traverse((o) => { if (o.isMesh) o.userData.sessionId = s.id; });
    this.bones = {};
    this.model.traverse((o) => { if (['arm-left', 'arm-right', 'head', 'torso'].includes(o.name)) this.bones[o.name] = o; });
    // dinlenme pozu: kodla eklenen açılar birikmesin diye her karede buradan başlanır
    this.rest = Object.fromEntries(Object.entries(this.bones).map(([k, b]) => [k, b.quaternion.clone()]));
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [n, clip] of Object.entries(c.clips)) {
      const a = this.mixer.clipAction(clip);
      if (GESTURES.includes(n)) { a.loop = THREE.LoopOnce; a.clampWhenFinished = false; }
      this.actions[n] = a;
    }
    // klavye: oturma pozunun kolsuz hali + "etkileşim" animasyonlarının yalnızca kol hareketleri
    const isArm = (n) => /^arm-/.test(n.split('.')[0]);
    const sub = (clip, name, keep) => { const c2 = new THREE.AnimationClip(name, clip.duration, clip.tracks.filter((tr) => keep(tr.name))); return this.mixer.clipAction(c2); };
    if (c.clips.sit) this.actions.sitType = sub(c.clips.sit, 'sitType', (n) => !isArm(n));
    if (c.clips['interact-left']) this.typeL = sub(c.clips['interact-left'], 'typeL', (n) => n.startsWith('arm-left'));
    if (c.clips['interact-right']) this.typeR = sub(c.clips['interact-right'], 'typeR', (n) => n.startsWith('arm-right'));
    this.typing = false;
    this.mixer.addEventListener('finished', () => this.play(this.base, 0.3));
    this.play('idle', 0);
    this.label = document.createElement('div'); this.label.className = 'l3d';
    this.labelObj = new CSS2DObject(this.label); this.labelObj.position.set(0, 0.95 * scale, 0); this.root.add(this.labelObj);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.2 * scale, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.004; this.shadow = sh; this.root.add(sh);
  }
  play(name, fade = 0.3, speed = 1) {
    const next = this.actions[name]; if (!next) return;
    if (this.cur === next) { next.timeScale = speed; if (!next.isRunning()) next.reset().play(); return; }
    next.reset(); next.timeScale = speed; next.setEffectiveWeight(1); next.enabled = true;
    if (this.cur) next.crossFadeFrom(this.cur, fade, false);
    next.play(); this.cur = next; this.curName = name;
  }
  gesture(name) { if (this.actions[name] && !this.path.length) this.play(name, 0.25); }
  setBase(name) { this.base = name; if (!GESTURES.includes(this.curName)) this.play(name, 0.35); }
  // hedef: { spot, approach?, face, mode: 'sitDesk'|'sitSofa'|'stand', key }
  goTo(goal) {
    if (goal.key === this.goalKey) return;
    this.goalKey = goal.key; this.goal = goal;
    const to = goal.spot, approach = goal.approach || to;
    const dist = Math.hypot(to.x - this.pos.x, to.z - this.pos.z);
    if (dist < 0.02) { this.path = []; this.arrive(); return; }
    const pts = [];
    if (this.mode !== 'stand' && this.leaveSpot) pts.push(this.leaveSpot.clone());   // önce sandalyeden/kanepeden kalk
    const start = pts.length ? pts[pts.length - 1] : this.pos;
    if (this.room && dist > 0.8) { const az = this.room.aisleZ + 0.25; pts.push(new THREE.Vector3(start.x, 0, az), new THREE.Vector3(approach.x, 0, az)); }
    pts.push(new THREE.Vector3(approach.x, 0, approach.z));
    if (goal.approach) pts.push(new THREE.Vector3(to.x, 0, to.z));
    this.path = pts; this.mode = 'stand'; this.base = 'walk';
    this.play('walk', 0.25, 1.05);
  }
  arrive() {
    const g = this.goal; if (!g) return;
    this.targetYaw = g.face; this.pos.set(g.spot.x, 0, g.spot.z);
    this.mode = g.mode; this.leaveSpot = g.approach || null;
    this.setBase(g.mode === 'stand' ? (g.base || 'idle') : 'sit');
    if (g.mode !== 'stand') this.yaw = g.face; // oturunca tam karşıya dön
  }
  update(dt, t) {
    for (const [k, b] of Object.entries(this.bones)) b.quaternion.copy(this.rest[k]);
    this.mixer.update(dt);
    if (this.path.length) {
      const p = this.path[0];
      tmpV.set(p.x - this.pos.x, 0, p.z - this.pos.z);
      const L = tmpV.length(), step = WALK * this.scale * dt;
      if (L <= step) { this.pos.set(p.x, 0, p.z); this.path.shift(); if (!this.path.length) this.arrive(); }
      else { tmpV.multiplyScalar(step / L); this.pos.add(tmpV); this.targetYaw = Math.atan2(tmpV.x, tmpV.z); if (this.curName !== 'walk') this.play('walk', 0.2, 1.05); }
    }
    const waiting = this.s.state === 'bekliyor' && !this.isSub;
    camera.getWorldPosition(tmpV2); world.worldToLocal(tmpV2);
    const toCam = Math.atan2(tmpV2.x - this.pos.x, tmpV2.z - this.pos.z);
    let yawGoal = this.targetYaw;
    if (!this.path.length && this.mode === 'stand' && (waiting || this.lookAtYou > 0)) yawGoal = toCam;
    if (waiting && !this.path.length && t > this.nextGesture) { this.nextGesture = t + 2.6; this.gesture('interact-right'); }
    let dy = yawGoal - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 7);
    // baş: otururken bile sana döner
    let hy = 0;
    if (this.lookAtYou > 0 || waiting) { let rel = toCam - this.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); hy = THREE.MathUtils.clamp(rel, -1.1, 1.1); }
    this.headYaw += (hy - this.headYaw) * Math.min(1, dt * 6);
    if (this.bones.head) this.bones.head.rotation.y += this.headYaw;
    // klavyede yazma: masada oturup çalışırken kollar klavyeye uzanır, baş hafifçe ekrana eğik
    const typing = this.mode === 'sitDesk' && this.s.state === 'calisiyor' && !this.isSub && !this.path.length;
    if (typing !== this.typing && this.typeL && this.typeR && this.actions.sitType) {
      this.typing = typing;
      if (typing) {
        this.base = 'sitType'; this.play('sitType', 0.3);
        for (const [a, off] of [[this.typeL, 0], [this.typeR, 0.37]]) { a.reset(); a.loop = THREE.LoopPingPong; a.timeScale = T.typeSpeed; a.time = off; a.setEffectiveWeight(1); a.fadeIn(0.3).play(); }
      } else {
        this.typeL.fadeOut(0.25); this.typeR.fadeOut(0.25);
        if (this.mode === 'sitDesk') { this.base = 'sit'; this.play('sit', 0.3); }
      }
    }
    if (typing && this.bones.head && this.lookAtYou <= 0) this.bones.head.rotation.x += 0.08 + Math.sin(t * 2.1) * 0.03;
    this.lookAtYou = Math.max(0, this.lookAtYou - dt);
    this.root.position.set(this.pos.x, this.mode === 'sitDesk' ? T.sitY : this.mode === 'sitSofa' ? T.sofaY : 0, this.pos.z);
    this.root.rotation.y = this.yaw;
    this.shadow.visible = this.mode === 'stand';
  }
  setLabel(html, cls) { if (this.label._h !== html) { this.label.innerHTML = html; this.label._h = html; } const c = 'l3d ' + (cls || ''); if (this.label.className !== c) this.label.className = c; }
  dispose() { world.remove(this.root); this.labelObj.removeFromParent(); this.label.remove(); this.mixer.stopAllAction(); }
}
T.typeSpeed = 2.2;

class SubPerson extends Person {
  constructor(sub, parent) { super({ id: parent.s.id, state: 'calisiyor' }, { scale: T.subScale, look: sub.id }); this.isSub = true; this.wanderAt = 0; }
  update(dt, t) {
    if (!this.path.length && t > this.wanderAt && this.room) {
      const r = this.room;
      const spot = new THREE.Vector3(r.x0 + 0.6 + Math.random() * (r.w - 1.2), 0, r.aisleZ + 0.15 + Math.random() * 0.5);
      this.goTo({ spot, face: 0, mode: 'stand', key: 'w' + t });
      this.wanderAt = t + 3 + Math.random() * 4;
    }
    super.update(dt, t);
  }
}

function goalFor(s, room, d) {
  const r = s.lastTool ? s.lastTool.role : null;
  if (s.state === 'calisiyor' && DOCS_ROLES.has(r)) {
    const off = ((hash(s.id) % 3) - 1) * 0.3;
    return { spot: room.docsSpot.clone().add(new THREE.Vector3(off, 0, 0)), face: room.docsFace, mode: 'stand', key: 'docs' };
  }
  if (s.state === 'calisiyor' && r === 'yonetici') return { spot: room.boardSpot.clone(), face: room.boardFace, mode: 'stand', key: 'board' };
  if (s.state === 'bekliyor') return { spot: d.standSpot.clone(), face: 0, mode: 'stand', key: 'ask' };
  if (s.state === 'bosta') {
    const i = room.idleIdx.get(s.id) || 0;
    if (i < room.sofaSeats.length) {
      const seat = room.sofaSeats[i];
      return { spot: seat.clone(), approach: seat.clone().add(new THREE.Vector3(0, 0, 0.42)), face: 0, mode: 'sitSofa', key: 'sofa' + i };
    }
    const c = room.coffeeSpots[(i - room.sofaSeats.length) % room.coffeeSpots.length];
    return { spot: c.clone(), face: Math.PI * 0.15, mode: 'stand', key: 'coffee' + i };
  }
  return { spot: d.seat.clone(), approach: d.seat.clone().add(new THREE.Vector3(0, 0, 0.32)), face: d.seatFace, mode: 'sitDesk', key: 'desk' };
}

// ------------------------------------------------------------------ app.js'den güncelleme
function update(rooms, selected) {
  if (!built) return;
  if (window.__o3 && window.__o3.transform) rooms = window.__o3.transform(rooms); // yalnızca test için
  selectedId = selected;
  if (!assetsReady) return;
  const key = layoutKey(rooms) + (scene.userData.dark ? 'd' : 'l');
  if (key !== lastLayoutKey) { buildWorld(rooms); lastLayoutKey = key; for (const a of agents.values()) a.goalKey = ''; }
  // her güncellemede odaların oturum listesini tazele (durumlar değişir, yerleşim aynı kalır)
  const fresh = new Map(rooms.map((r) => [r.key, r.list]));
  for (const r of roomsData) if (fresh.has(r.key)) r.list = fresh.get(r.key);
  const seen = new Set(), seenSubs = new Set();
  for (const r of roomsData) {
    r.idleIdx = new Map(r.list.filter((s) => s.state === 'bosta' && s.live).map((s, i) => [s.id, i]));
    for (const s of r.list.slice(0, MAX_DESKS)) {
      const d = desks.get(s.id); if (!d) continue;
      drawScreen(d, s);
      if (!(s.live || s.state === 'calisiyor')) continue;
      seen.add(s.id);
      let a = agents.get(s.id);
      if (!a) {
        a = new Person(s); a.room = r;
        // ilk açılışta herkes doğrudan yerinde başlasın
        const g0 = goalFor(s, r, d); a.goal = g0; a.goalKey = g0.key; a.arrive(); a.yaw = g0.face;
        agents.set(s.id, a);
      }
      a.s = s; a.room = r;
      a.goTo(goalFor(s, r, d));
      const lt = s.lastTool;
      if (s.state === 'calisiyor' && !a.path.length && a.mode === 'stand') {
        const now = clock.elapsedTime;
        if (now > a.nextGesture) { a.nextGesture = now + 3.5 + (hash(s.id) % 20) / 10; a.gesture(DOCS_ROLES.has(lt && lt.role) ? (Math.random() < 0.5 ? 'pick-up' : 'interact-right') : 'interact-left'); }
      }
      const sel = s.id === selectedId ? ' sel' : '';
      if (s.state === 'bekliyor') a.setLabel(`<div class="bubble ask">🙋 Sana bir şey soracak</div><div class="nm">${esc(s.name)}</div>`, 'bekliyor' + sel);
      else if (s.state === 'calisiyor') a.setLabel(`<div class="bubble">${lt ? role(lt.role)[0] + ' ' + esc(role(lt.role)[1]) : '💭 Düşünüyor'}</div><div class="nm">${esc(s.name)}</div>`, 'calisiyor' + sel);
      else a.setLabel(`<div class="nm">💤 ${esc(s.name)}</div>`, 'bosta' + sel);
      for (const sb of (s.subagents || []).filter((x) => x.active).slice(0, 4)) {
        seenSubs.add(sb.id);
        let m = subs.get(sb.id);
        if (!m) { m = new SubPerson(sb, a); m.room = r; m.pos.set(a.pos.x + 0.3, 0, r.aisleZ + 0.3); subs.set(sb.id, m); }
        m.room = r;
        m.setLabel(`<div class="nm sub">${esc((sb.description || sb.type).slice(0, 32))}</div>`, 'alt');
      }
    }
  }
  for (const [id, a] of agents) if (!seen.has(id)) { a.dispose(); agents.delete(id); }
  for (const [id, m] of subs) if (!seenSubs.has(id)) { m.dispose(); subs.delete(id); }
}

// ------------------------------------------------------------------ seçim / bakış
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([world], true);
  for (const h of hits) {
    let o = h.object; while (o && !o.userData.sessionId) o = o.parent;
    if (o) return { id: o.userData.sessionId, agent: agents.get(o.userData.sessionId) || null };
  }
  return null;
}
function setHover(h) {
  const id = h ? h.id : null;
  if ((hovered && hovered.id) === id) { if (h && h.agent) h.agent.lookAtYou = Math.max(h.agent.lookAtYou, 0.6); return; }
  hovered = h;
  renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
  if (h && h.agent) {
    h.agent.lookAtYou = 2.5;
    if (h.agent.mode === 'stand' && h.agent.s.state !== 'bekliyor') h.agent.gesture('emote-yes');
  }
}
let flyTo = null;
function focus(id) {
  const a = agents.get(id), d = desks.get(id);
  const p = a ? a.pos : d ? new THREE.Vector3(d.x, 0, d.z) : null; if (!p) return;
  const wp = p.clone().multiplyScalar(W);
  flyTo = { target: new THREE.Vector3(wp.x, 0.9, wp.z), pos: new THREE.Vector3(wp.x + 1.6, 3.0, wp.z + 4.2), t: 0 };
  if (a) a.lookAtYou = 3;
}
function overview(instant) {
  if (!roomsData.length) return;
  const xs = roomsData.flatMap((r) => [r.x0, r.x0 + r.w]), zs = roomsData.flatMap((r) => [r.z0, r.z0 + r.d]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.25) * W;
  const target = new THREE.Vector3(0, 0, 0.5 * W), pos = new THREE.Vector3(size * 0.08, size * 0.55 + 4, size * 0.68 + 5);
  if (instant) { controls.target.copy(target); camera.position.copy(pos); controls.update(); }
  else flyTo = { target, pos, t: 0 };
}

// ------------------------------------------------------------------ döngü
let lastT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!active || document.hidden) return;
  if (now - lastT < 32) return; // ~30 kare/sn yeter, makineyi yormasın
  lastT = now;
  try { frame(); } catch (e) { console.error('3B kare hatası', e); }
}
function frame(fixedDt) {
  const dt = fixedDt || Math.min(0.05, clock.getDelta());
  if (fixedDt) clock.elapsedTime += fixedDt;
  const t = clock.elapsedTime;
  if (flyTo) {
    flyTo.t += dt / 1.1; const k = 1 - Math.pow(1 - Math.min(1, flyTo.t), 3);
    controls.target.lerp(flyTo.target, k * 0.22); camera.position.lerp(flyTo.pos, k * 0.22);
    if (flyTo.t >= 1) flyTo = null;
  }
  controls.update();
  for (const a of agents.values()) a.update(dt, t);
  for (const m of subs.values()) m.update(dt, t);
  if (pointerIn && Math.floor(t * 10) % 2 === 0) { const h = pick(); setHover(h); cb.onHover && cb.onHover(h ? h.id : null, pointer.cx, pointer.cy); }
  labelRenderer.domElement.classList.toggle('far', camera.position.distanceTo(controls.target) > 30);
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function setActive(v) { active = v; if (v) { clock.getDelta(); resize(); } if (labelRenderer) labelRenderer.domElement.style.display = v ? '' : 'none'; }
function themeChanged() { if (!scene) return; applyTheme(); lastLayoutKey = ''; }

// hata ayıklama: panel arka plandayken kareleri elle ilerlet (tarayıcı arka planda animasyonu yavaşlatır)
window.__o3 = {
  THREE, agents, desks, T, get roomGroup() { return roomGroup; }, get camera() { return camera; }, get controls() { return controls; },
  step: (n = 30, dt = 1 / 30) => { if (!clock) return 'hazır değil'; for (let i = 0; i < n; i++) frame(dt); },
  info: () => ({ active, agents: agents.size, subs: subs.size, rooms: roomsData.length, assets: assetsReady, chars: chars.length }),
};
window.Office3D = { mount, update, setActive, focus, overview: () => overview(false), themeChanged };
window.dispatchEvent(new Event('office3d-ready'));
