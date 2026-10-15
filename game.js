// ===== بازی ضرب‌پُرک — آموزش ضرب با Three.js =====
// از book global THREE (نسخه UMD — روی file:// هم کار می‌کند)
const THREE = window.THREE;

/* ---------- ابزار ---------- */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFa = n => String(n).replace(/\d/g, d => FA_DIGITS[+d]);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// ease-out back برای پرش پروانه‌ای بامزه
const easeOutBack = t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInBack  = t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; };

/* ---------- تنظیمات سطح ---------- */
const LEVELS = {
  easy: { time: 10, spawnDur: 0.55, riseH: 1.15, label: 'آسان' },
  hard: { time: 5,  spawnDur: 0.35, riseH: 1.35, label: 'سخت' },
};

/* ---------- وضعیت بازی ---------- */
const G = {
  state: 'menu', // menu | playing | over
  level: 'easy',
  score: 0,
  best: { easy: +(localStorage.getItem('zarb-best-easy') || 0), hard: +(localStorage.getItem('zarb-best-hard') || 0) },
  question: null, // {a, b, answer}
  popTimeout: null,
  muted: false,
};

/* ---------- صحنه Three.js ---------- */
const canvas = document.getElementById('c3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// رنگ‌های واضح کارتونی — بدون tone mapping که رنگ رو desaturate می‌کنه
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xede4c4);
// fog رو حذف کردیم — روی موبایل که دوربین عقب‌تره باعث مات شدن صحنه می‌شد
scene.fog = null;

const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 7.6, 16.5);
camera.lookAt(0, 1.8, 0);

// نور
scene.add(new THREE.HemisphereLight(0xffffff, 0xcbb98a, 0.9));
const sun = new THREE.DirectionalLight(0xfff4d6, 1.35);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;  sun.shadow.camera.bottom = -12;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.35);
fill.position.set(-8, 6, -6);
scene.add(fill);

/* ---------- متریال کمکی ---------- */
const mat = (color, extra = {}) => new THREE.MeshToonMaterial({ color, ...extra });
const OUTLINE = 0x2b2d42;

function addOutline(mesh, scale = 1.045) {
  const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide }));
  outline.scale.setScalar(scale);
  mesh.add(outline);
}

/* ---------- دستگاه بازی (مثل مرجع) ---------- */
const machine = new THREE.Group();
scene.add(machine);

// بدنه سبز نعنایی
const body = new THREE.Mesh(new THREE.BoxGeometry(9.2, 2.6, 7.4), mat(0x5cc8a0));
body.position.y = 1.1;
body.castShadow = body.receiveShadow = true;
machine.add(body);
addOutline(body, 1.04);

// صفحه بالایی کرم
const topDeck = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 7.8), mat(0xf0ddb0));
topDeck.position.y = 2.6;
topDeck.castShadow = true;
topDeck.receiveShadow = false; // سایه گنبدها روی میز از blob shadow میاد
machine.add(topDeck);
addOutline(topDeck, 1.05);

// چرخ‌های زیر دستگاه
for (const [x, z] of [[-4.0, -3.0], [4.0, -3.0], [-4.0, 3.0], [4.0, 3.0]]) {
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 24), mat(0x2b2d42));
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(x, 0.35, z);
  machine.add(wheel);
}

// صورت خندان روی بدنه (مثل مرجع)
const faceY = 0.9, faceZ = 3.72;
for (const x of [-1.7, 1.7]) {
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 20), new THREE.MeshBasicMaterial({ color: OUTLINE }));
  eye.scale.set(1, 1.25, 0.6);
  eye.position.set(x, faceY + 0.4, faceZ);
  machine.add(eye);
}
const smile = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 12, 24, Math.PI), new THREE.MeshBasicMaterial({ color: OUTLINE }));
smile.rotation.set(0, Math.PI, Math.PI);
smile.position.set(0, faceY + 0.15, faceZ);
machine.add(smile);



/* ---------- ۴ موجود گزینه روی میز ---------- */
// z=3.0 — داخل میز (نه از لبه بیرون) و کمی جلوتر از مرکز
const CARD_XY = [
  [-3.2, 3.0], [-1.07, 3.0], [1.07, 3.0], [3.2, 3.0],
];
const tableY = 2.86;
const bumpers = [];

// رنگ‌های اصلی و رنگ‌های تیره‌تر برای سایه گنبد
const BUMPER_COLORS      = [0x9b7dd4, 0x4ec4a0, 0xf07fa0, 0xf5c030];
const BUMPER_DARK_COLORS = [0x7355a8, 0x339e7e, 0xd05578, 0xd49d10];

CARD_XY.forEach(([x, z], i) => {
  // — blob shadow نرم روی میز (canvas gradient دایره‌ای)
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 128;
  const blobCtx = blobCanvas.getContext('2d');
  const blobGrad = blobCtx.createRadialGradient(64, 64, 0, 64, 64, 62);
  blobGrad.addColorStop(0,   'rgba(30,32,48,0.22)');
  blobGrad.addColorStop(0.55,'rgba(30,32,48,0.10)');
  blobGrad.addColorStop(1,   'rgba(30,32,48,0)');
  blobCtx.fillStyle = blobGrad;
  blobCtx.beginPath();
  blobCtx.ellipse(64, 64, 62, 62, 0, 0, Math.PI * 2);
  blobCtx.fill();
  const blobTex = new THREE.CanvasTexture(blobCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.1),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(x, tableY + 0.025, z + 0.08);
  machine.add(shadow);

  // — گروه اصلی موجود
  const g = new THREE.Group();
  g.position.set(x, tableY + 0.05, z);

  // — بدنه اصلی: نیمکره بزرگ‌تر
  const R = 0.92; // رادیوس — بزرگ‌تر از قبل (بود ۰.۶۸)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.58),
    mat(BUMPER_COLORS[i])
  );
  dome.castShadow = false; // سایه واقعی خاموش — از blob shadow استفاده می‌کنیم
  g.add(dome);
  addOutline(dome, 1.06);

  // — نوار تیره‌تر پایین گنبد (حس حجم)
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.99, 36, 12, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.22),
    new THREE.MeshToonMaterial({ color: BUMPER_DARK_COLORS[i], transparent: true, opacity: 0.45 })
  );
  g.add(belly);

  // — هایلایت نوری (لکه روشن بالا-چپ)
  const highlight = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.32, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
  );
  highlight.position.set(-R * 0.28, R * 0.62, R * 0.65);
  g.add(highlight);

  // — چشم‌ها: بزرگ‌تر، بیشتر جلو
  for (const [ex, eyeDir] of [[-0.30, -1], [0.30, 1]]) {
    // سفیدی چشم (اسکلرا)
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    sclera.scale.set(1, 1.2, 0.55);
    sclera.position.set(ex, R * 0.58, R * 0.76);
    g.add(sclera);

    // مردمک
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x1e2030 })
    );
    pupil.scale.set(1, 1.2, 0.5);
    pupil.position.set(ex, R * 0.58, R * 0.82);
    g.add(pupil);

    // برق چشم
    const eyeShine = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    eyeShine.position.set(ex + eyeDir * 0.045, R * 0.64, R * 0.875);
    g.add(eyeShine);
  }

  // — ابروها (کمانی ظریف بالای هر چشم)
  for (const ex of [-0.30, 0.30]) {
    const brow = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.035, 8, 16, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color: 0x1e2030 })
    );
    brow.position.set(ex, R * 0.78, R * 0.62);
    brow.rotation.set(-0.3, 0, ex < 0 ? 0.3 : -0.3);
    g.add(brow);
  }

  // — لبخند کوچک
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.042, 8, 20, Math.PI * 0.65),
    new THREE.MeshBasicMaterial({ color: 0x1e2030 })
  );
  smile.position.set(0, R * 0.28, R * 0.91);
  smile.rotation.set(-0.15, 0, Math.PI);
  g.add(smile);

  // — پلاک عدد: بزرگ‌تر، بالاتر، مستقیم رو به دوربین
  const numCanvas = document.createElement('canvas');
  numCanvas.width = 512;
  numCanvas.height = 256;
  const numTex = new THREE.CanvasTexture(numCanvas);
  const numMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.95),
    new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false })
  );
  // بالاتر از گنبد، کمی کج به طرف دوربین
  numMesh.position.set(0, R * 1.28, R * 0.18);
  numMesh.rotation.x = -0.18;
  g.add(numMesh);

  g.visible = false;
  machine.add(g);

  bumpers.push({ group: g, ai: i, numCanvas, numTex, numMesh, state: 'hidden', t: 0, value: null });
});

/* ---------- تابلوی بالای دستگاه ---------- */
const boardWrap = new THREE.Group();
boardWrap.position.set(0, 5.55, -2.15);
machine.add(boardWrap);

const board = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.4, 0.4), mat(0xf5c842));
board.castShadow = true;
boardWrap.add(board);
addOutline(board, 1.05);

// قاب بنفش بالای تابلو
const frame = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.55, 0.5), mat(0xa07cc8));
frame.position.y = 1.45;
boardWrap.add(frame);
addOutline(frame, 1.06);

// چراغ‌های ریز روی قاب
for (let i = 0; i < 9; i++) {
  const x = -3.7 + i * 0.925;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  bulb.position.set(x, 1.45, 0.35);
  boardWrap.add(bulb);
}

// پایه‌های تابلو
for (const x of [-3.6, 3.6]) {
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 12), mat(0x2b2d42));
  leg.position.set(x, -1.7, 0);
  boardWrap.add(leg);
}

// متن ضرب روی تابلو (CanvasTexture)
const qCanvas = document.createElement('canvas');
qCanvas.width = 1024; qCanvas.height = 320;
const qTex = new THREE.CanvasTexture(qCanvas);
const qPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(7.8, 2.2),
  new THREE.MeshBasicMaterial({ map: qTex, transparent: true })
);
qPlane.position.set(0, -0.05, 0.22);
boardWrap.add(qPlane);

function drawQuestion(text = '؟ × ؟', color = '#1e2030') {
  const ctx = qCanvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 320);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 210px Vazirmatn, system-ui, sans-serif';

  // سایه پشت متن
  ctx.shadowColor = 'rgba(30,32,48,0.22)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 8;

  // outline سفید ضخیم (خوانایی روی تابلوی زرد)
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, 512, 172);

  // متن اصلی
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 172);

  qTex.needsUpdate = true;
}

function drawBumperNum(bumper, text) {
  const W = 512, H = 256;
  const ctx = bumper.numCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // سایه کارت
  ctx.shadowColor = 'rgba(30,32,48,0.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 7;

  // پس‌زمینه کارت گرد
  ctx.fillStyle = '#fffdf5';
  ctx.beginPath();
  ctx.roundRect(20, 20, W - 40, H - 40, 52);
  ctx.fill();

  // حاشیه تیره
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#1e2030';
  ctx.beginPath();
  ctx.roundRect(20, 20, W - 40, H - 40, 52);
  ctx.stroke();

  // خط برق بالا (هایلایت)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(36, 30, W * 0.45, H * 0.28, 24);
  ctx.stroke();

  // عدد
  ctx.fillStyle = '#1e2030';
  ctx.font = 'bold 148px Vazirmatn, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 8);

  bumper.numTex.needsUpdate = true;
}

/* ---------- زمین و محیط ---------- */
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), mat(0xefdca8));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
scene.add(ground);

// ابرهای ساده پس‌زمینه
for (let i = 0; i < 5; i++) {
  const cloud = new THREE.Group();
  const cm = new THREE.MeshToonMaterial({ color: 0xffffff });
  for (let j = 0; j < 3; j++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 12, 12), cm);
    puff.position.set(j * 0.7 - 0.7, Math.random() * 0.2, Math.random() * 0.2);
    cloud.add(puff);
  }
  const ang = (i / 5) * Math.PI * 2;
  const r = 15 + Math.random() * 4;
  cloud.position.set(Math.cos(ang) * r, 7 + Math.random() * 3, Math.sin(ang) * r);
  scene.add(cloud);
}

/* ---------- چکش سه‌بعدی (دنبال ماوس) ---------- */
const hammer = new THREE.Group();
{
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.2, 12), mat(0xe8b06a));
  handle.position.y = -1.1;
  hammer.add(handle);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 18), mat(0xff7461));
  head.rotation.z = Math.PI / 2;
  hammer.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 14), mat(0xffd0a8));
  cap.rotation.z = Math.PI / 2;
  cap.position.y = 0;
  hammer.add(cap);
}
hammer.visible = false;
scene.add(hammer);

let hammerSwing = 0; // 0..1 انیمیشن ضربه
let pointerNdc = new THREE.Vector2(0, 0.2);

const RAY_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.9); // صفحه z=2.9 برای موقعیت چکش
const raycaster = new THREE.Raycaster();

/* ============================================================
   منطق بازی
   ============================================================ */
const ui = {
  hud: document.getElementById('hud'),
  score: document.getElementById('score-value'),
  best: document.getElementById('best-value'),
  muteBtn: document.getElementById('mute-btn'),
  timerWrap: document.getElementById('timer-bar-wrap'),
  timerBar: document.getElementById('timer-bar'),
  start: document.getElementById('start-screen'),
  gameover: document.getElementById('gameover-screen'),
  goTitle: document.getElementById('go-title'),
  goEmoji: document.getElementById('go-emoji'),
  goReason: document.getElementById('go-reason'),
  goScore: document.getElementById('go-score'),
  goBest: document.getElementById('go-best'),
  againBtn: document.getElementById('again-btn'),
  menuBtn: document.getElementById('menu-btn'),
  flash: document.getElementById('flash-msg'),
  startHint: document.getElementById('start-best-hint'),
};

/* ---------- صدا (WebAudio) ---------- */
let AC = null;
function audio() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
function tone(freq, dur, type = 'sine', vol = 0.2, when = 0) {
  if (G.muted) return;
  const ac = audio();
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ac.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + when); o.stop(ac.currentTime + when + dur + 0.05);
}
function thump() {
  if (G.muted) return;
  const ac = audio();
  const dur = 0.12;
  const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = ac.createBufferSource(); src.buffer = buf;
  const g = ac.createGain(); g.gain.value = 0.25;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}
const sndHit   = () => { tone(1200, 0.08, 'square', 0.08); thump(); };
const sndRight = () => { tone(660, .12, 'sine', .2); tone(880, .12, 'sine', .2, .1); tone(1320, .18, 'sine', .22, .2); };
const sndWrong = () => { tone(220, .25, 'sawtooth', .18); tone(160, .35, 'sawtooth', .18, .12); };
const sndStart = () => { tone(440, .1, 'sine', .18); tone(554, .1, 'sine', .18, .1); tone(659, .15, 'sine', .2, .2); };

/* ---------- تولید سوال ---------- */
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry(Date.now());
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));

function pickUnique(arr, n, excludeSet) {
  const out = [];
  while (out.length < n) {
    const v = arr[randInt(0, arr.length - 1)];
    if (!out.includes(v) && !excludeSet.has(v)) { out.push(v); excludeSet.add(v); }
  }
  return out;
}

function newQuestion() {
  let a, b;
  do {
    a = randInt(0, 12);
    b = randInt(0, 12);
    // در سطح آسان بیشتر سوال‌های کوچک، در سخت همه‌ی محدوده
    if (G.level === 'easy' && rand() < 0.5) { a = randInt(0, 6); b = randInt(0, 6); }
  } while (G.question && a === G.question.a && b === G.question.b);

  const answer = a * b;
  const distractSet = new Set([answer]);
  // اول جواب‌های نزدیک و متداول (جواب‌های اشتباه هوشمند)
  const cands = [
    a * (b + 1), a * Math.max(0, b - 1), (a + 1) * b, Math.max(0, a - 1) * b,
    answer + 10, Math.max(0, answer - 10), answer + 1, Math.max(0, answer - 1),
    answer + 2, Math.max(0, answer - 2), answer + (a || 1), Math.max(0, answer - (b || 1)),
    a + b, Math.abs(a - b) * (a + b || 1),
  ];
  for (const v of cands) {
    if (distractSet.size >= 4) break;
    if (v >= 0 && v !== answer && v <= 144) distractSet.add(v);
  }
  // اگر کم بود، جواب رندوم در محدوده [max(0,ans-12), ans+12]
  while (distractSet.size < 4) {
    const v = Math.max(0, answer + randInt(-12, 12));
    if (v !== answer && !distractSet.has(v)) distractSet.add(v);
  }
  const distractors = pickUnique([...distractSet].filter(v => v !== answer), 3, new Set());
  const options = [answer, ...distractors];
  // شافل
  for (let i = options.length - 1; i > 0; i--) { const j = randInt(0, i); [options[i], options[j]] = [options[j], options[i]]; }
  return { a, b, answer, options };
}

/* ---------- ریست/شروع/پایان ---------- */
function hideAllBumpers() {
  bumpers.forEach(b => { b.state = 'hidden'; b.group.visible = false; });
}

function resetBumpers() {
  hideAllBumpers();
  clearTimeout(G.popTimeout);
}

function showGameStates() {
  ui.hud.classList.remove('hidden');
  ui.timerWrap.classList.remove('hidden');
  ui.start.classList.add('hidden');
  ui.gameover.classList.add('hidden');
}

function updateBestUi() {
  ui.best.textContent = toFa(G.best[G.level]);
}

function startGame(level) {
  G.level = level;
  G.score = 0;
  G.state = 'playing';
  ui.score.textContent = toFa(0);
  updateBestUi();
  showGameStates();
  sndStart();
  hammer.visible = true;
  nextQuestion();
}

function endGame(reason) {
  G.state = 'over';
  clearTimeout(G.popTimeout);
  resetBumpers();
  hammer.visible = false;
  sndWrong();
  const isRecord = G.score > G.best[G.level] && G.score > 0;
  if (G.score > G.best[G.level]) {
    G.best[G.level] = G.score;
    localStorage.setItem('zarb-best-' + G.level, G.score);
  }
  updateBestUi();
  ui.goTitle.textContent = isRecord ? 'رکورد جدید!' : 'باختی!';
  if (ui.goEmoji) ui.goEmoji.textContent = isRecord ? '🏆' : (G.score > 5 ? '😅' : '😞');
  ui.goReason.textContent = reason;
  ui.goScore.textContent = toFa(G.score);
  ui.goBest.textContent = toFa(G.best[G.level]);
  // کلاس رکورد روی کارت — انیمیشن طلایی
  if (isRecord) ui.gameover.querySelector('.menu-card').classList.add('is-record');
  else ui.gameover.querySelector('.menu-card').classList.remove('is-record');
  ui.timerWrap.classList.add('hidden');
  ui.gameover.classList.remove('hidden');
}

function flashMsg(text, good) {
  const el = ui.flash;
  el.textContent = text;
  el.className = 'hidden ' + (good ? 'good' : 'bad');
  void el.offsetWidth; // force reflow تا انیمیشن از نو شروع شود
  el.classList.remove('hidden');
}

/* ---------- چرخه سوال ---------- */
let timerRAF = null;
let qDeadline = 0;

function nextQuestion() {
  const q = newQuestion();
  G.question = q;
  drawQuestion(`${toFa(q.a)} × ${toFa(q.b)}`);

  // انتخاب ۴ کارت متفاوت روی میز
  q.options.forEach((val, k) => {
    const b = bumpers[k];
    b.value = val;
    drawBumperNum(b, toFa(val));
    b.state = 'rising';
    b.t = 0;
    b.group.visible = true;
    b.group.scale.setScalar(0.001);
  });

  // تایمر
  const L = LEVELS[G.level];
  qDeadline = performance.now() + L.time * 1000;
  ui.timerBar.classList.remove('hurry');
  cancelAnimationFrame(timerRAF);
  tickTimer();

  // پایان زمان = باخت
  G.popTimeout = setTimeout(() => {
    if (G.state === 'playing') endGame('زمان تمام شد! ⏰ جواب «' + toFa(q.answer) + '» بود');
  }, L.time * 1000);
}

function tickTimer() {
  if (G.state !== 'playing') return;
  const L = LEVELS[G.level];
  const remain = clamp((qDeadline - performance.now()) / (L.time * 1000), 0, 1);
  ui.timerBar.style.width = (remain * 100) + '%';
  if (remain < 0.3) ui.timerBar.classList.add('hurry');
  timerRAF = requestAnimationFrame(tickTimer);
}

function answerPicked(bumper) {
  if (G.state !== 'playing' || !G.question || bumper.state !== 'up') return;
  const correct = bumper.value === G.question.answer;
  sndHit();
  hammerSwing = 1;
  if (correct) {
    G.score++;
    ui.score.textContent = toFa(G.score);
    // انیمیشن پاپ روی عدد امتیاز
    ui.score.classList.remove('pop');
    void ui.score.offsetWidth;
    ui.score.classList.add('pop');
    sndRight();
    flashMsg('آفرین! درست بود ✅', true);
    // پایین رفتن پروانه‌ها و سوال بعد
    bumpers.forEach(b => { if (b.state === 'up') b.state = 'falling'; b.t = 0; });
    clearTimeout(G.popTimeout);
    cancelAnimationFrame(timerRAF);
    G.popTimeout = setTimeout(() => { if (G.state === 'playing') nextQuestion(); }, 550);
  } else {
    endGame(`جواب ${toFa(bumper.value)} اشتباه بود؛ درستش «${toFa(G.question.answer)}» بود 🙈`);
  }
}

/* ---------- تبدیل کلیک به پروانه ---------- */
function pickBumper(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const targets = bumpers.filter(b => b.state === 'up').map(b => b.group);
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;
  let obj = hits[0].object;
  let g = obj;
  while (g && !bumpers.some(b => b.group === g)) g = g.parent;
  return bumpers.find(b => b.group === g) || null;
}

canvas.addEventListener('pointerdown', e => {
  audio();
  if (G.state !== 'playing') return;
  const b = pickBumper(e.clientX, e.clientY);
  if (b) answerPicked(b);
});

addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
});

/* ---------- دکمه‌های UI ---------- */
document.querySelectorAll('.level-btn').forEach(btn => {
  btn.addEventListener('click', () => { audio(); startGame(btn.dataset.level); });
});
ui.againBtn.addEventListener('click', () => { audio(); startGame(G.level); });
ui.menuBtn.addEventListener('click', () => {
  G.state = 'menu';
  hideAllBumpers();
  hammer.visible = false;
  drawQuestion('؟ × ؟');
  ui.gameover.classList.add('hidden');
  ui.timerWrap.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.start.classList.remove('hidden');
  updateHint();
});
ui.muteBtn.addEventListener('click', () => {
  G.muted = !G.muted;
  ui.muteBtn.textContent = G.muted ? '🔇' : '🔊';
});

function updateHint() {
  const b = G.best[G.level === 'hard' ? 'hard' : 'easy'];
  ui.startHint.textContent = b > 0 ? `رکورد شما در سطح ${LEVELS[G.level].label}: ${toFa(b)}` : 'رکوردت رو بشکن!';
}

/* ---------- حلقه رندر ---------- */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const L = LEVELS[G.level];
  const riseH = L.riseH;

  // انیمیشن پروانه‌ها
  bumpers.forEach((b, i) => {
    if (b.state === 'rising') {
      b.t += dt / L.spawnDur;
      if (b.t >= 1) { b.t = 1; b.state = 'up'; }
      const k = easeOutBack(clamp(b.t, 0, 1));
      b.group.position.y = tableY + 0.1 + k * riseH;
      b.group.scale.setScalar(clamp(k, 0.001, 1));
    } else if (b.state === 'falling') {
      b.t += dt / 0.35;
      if (b.t >= 1) { b.state = 'hidden'; b.group.visible = false; b.group.scale.setScalar(0.001); }
      else {
        const k = 1 - easeInBack(b.t);
        b.group.position.y = tableY + 0.1 + k * riseH;
        b.group.scale.setScalar(clamp(k, 0.001, 1));
      }
    } else if (b.state === 'up') {
      // بالا و پایین رفتن شناور بامزه
      b.group.position.y = tableY + 0.1 + riseH + Math.sin(t * 3 + b.ai) * 0.05;
    }
  });

  // چکش دنبال ماوس روی صفحه دستگاه
  if (hammer.visible) {
    raycaster.setFromCamera(pointerNdc, camera);
    const p = new THREE.Vector3();
    raycaster.ray.intersectPlane(RAY_PLANE, p);
    if (p) {
      const nx = clamp(p.x, -5.5, 5.5);
      const nz = clamp(p.z, -4.5, 4.5);
      hammer.position.set(nx * 0.9, 0.2 + riseH, nz * 0.9 + 2.6);
    }
    if (hammerSwing > 0) {
      hammerSwing = Math.max(0, hammerSwing - dt * 6);
      hammer.rotation.x = 0.6 - hammerSwing * Math.sin(hammerSwing * Math.PI) * 1.2;
    } else {
      hammer.rotation.x = 0.6 + Math.sin(t * 2) * 0.04;
    }
    hammer.rotation.y = -0.35;
  }

  // نگاه و تنفس ملایم دوربین
  const aspectNow = camera.aspect;
  const isMobile = aspectNow < 1;

  // FOV داینامیک — روی موبایل کمی گشاد‌تر تا همه چیز دیده بشه
  const targetFov = isMobile ? clamp(38 + (1 / aspectNow - 1) * 14, 38, 58) : 34;
  camera.fov = lerp(camera.fov, targetFov, 0.05);
  camera.updateProjectionMatrix();

  if (isMobile) {
    const k = clamp(1 / aspectNow, 1, 2.2);
    camera.position.x = Math.sin(t * 0.35) * 0.2;
    camera.position.y = 9.0 + 3.5 * (k - 1);
    camera.position.z = 21.0 + 9.0 * (k - 1);
  } else {
    camera.position.x = Math.sin(t * 0.35) * 0.35;
    camera.position.y = 8.4;
    camera.position.z = 20.0;
  }
  camera.lookAt(0, 1.8, 0);

  renderer.render(scene, camera);
}

/* ---------- اندازه صفحه ---------- */
function fitCamera() {
  const aspect = camera.aspect;
  const isMobile = aspect < 1;
  if (isMobile) {
    const k = clamp(1 / aspect, 1, 2.2);
    camera.fov = clamp(38 + (k - 1) * 14, 38, 58);
    camera.position.set(0, 9.0 + 3.5 * (k - 1), 21.0 + 9.0 * (k - 1));
  } else {
    camera.fov = 34;
    camera.position.set(0, 8.4, 20.0);
  }
  camera.updateProjectionMatrix();
  camera.lookAt(0, 1.8, 0);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fitCamera();
}
addEventListener('resize', resize);
resize();

// حالت اولیه
drawQuestion('؟ × ؟');
updateHint();
animate();

// هوک دیباگ برای تست خودکار (فقط با ?debug فعال می‌شود)
if (location.search.includes('debug')) {
  window.zarbDebug = {
    start: level => startGame(level),
    state: () => ({ state: G.state, score: G.score, q: G.question, bumperVals: bumpers.map(b => ({ i: b.ai, v: b.value, s: b.state })) }),
    answer: correct => { const b = bumpers.find(x => x.value === (correct ? G.question.answer : -999) && x.state === 'up') || bumpers.find(x => x.state === 'up' && x.value !== G.question.answer); if (b) answerPicked(b); },
    fastTimer: () => { qDeadline = performance.now() + 800; },
    forceUp: () => { bumpers.forEach(b => { if (b.state !== 'hidden') { b.state = 'up'; b.t = 1; b.group.position.y = tableY + 0.1 + LEVELS[G.level].riseH; b.group.scale.setScalar(1); } }); renderer.render(scene, camera); },
    freezeTimer: () => { clearTimeout(G.popTimeout); cancelAnimationFrame(timerRAF); },
    reset: () => { localStorage.clear(); G.best = { easy: 0, hard: 0 }; },
  };
}
