'use strict';
/* ============================================================
   core.js — 数据模型 / 数学 / 求值 / 撤销 / 存档
   ============================================================ */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function uid(p) { return (p || 'o') + Math.random().toString(36).slice(2, 9); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
/* 角度差归一成 (-π, π]：即「从 a 转到 b，走最短弧该扫多少」。
   lerpAngle 用它；转身片段还要用它把「扫角」算出来存下来（见 evalChar）。 */
function angDelta(a, b) {
  return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
function lerpAngle(a, b, t) {
  return a + angDelta(a, b) * t;
}
function ease(u, type) {
  u = clamp(u, 0, 1);
  switch (type) {
    case 'in': return u * u;
    case 'out': return 1 - (1 - u) * (1 - u);
    case 'inout': return u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    case 'hold': return 0;
    default: return u;
  }
}
function fmt(n, d) {
  d = d === undefined ? 2 : d;
  if (!isFinite(n)) n = 0;
  return n.toFixed(d);
}
function dirVec(a) { return { x: Math.sin(a), y: -Math.cos(a) }; }
function angOf(dx, dy) { return Math.atan2(dx, -dy); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------- 全局运行态 ---------------- */
const App = {
  state: null,
  view: { cx: 960, cy: 540, zoom: .45 },
  vw: 800, vh: 600, dpr: 1,
  tool: 'select',
  sel: null,
  pending: null,
  time: 0,
  playing: false,
  loop: true,
  showGuides: true,
  previewRes: [1280, 720],
  bgImage: null,
  tex: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  /* 新增：渲染模式与视图 */
  mode: '3d',                       // '3d' 立体人物 | '2d' 平面剪影
  stageView: 'top',                 // 'top' 俯视编辑 | '3d' 3D 观察
  view3d: { yaw: -35 * Math.PI / 180, elev: 24 * Math.PI / 180, dist: 0, tx: 0, ty: 0 },
  playerOpen: false,
  playerGuides: false,
  playerGaze: false,                // 预演里是否叠加角色视线扇形（编辑标记，导出不带）
  playerZoom: 0,                    // 预演窗口的显示缩放；0 = 还没算过，打开时按「适应窗口」定
  playerRes: [1280, 720],
  /* 放大观察（双击右下镜头预览打开）：比面板预览按更高分辨率重渲染，
     所以「放大」是真的多出细节，不是把小图拉大。 */
  loupeOpen: false,
  loupeZoom: 0,                     // 0 = 还没算过，打开时按「适应窗口」定
  loupeGuides: true,
  tlH: 0,                           // 时间轴高度 px；0 = 用样式表默认值
  chipFold: {},                     // 左侧模板面板的分组折叠状态（仅本次会话）
};

const CHAR_COLORS = ['#e5484d', '#2b6cf6', '#12a150', '#e8890c', '#7c5cff', '#0aa3b5', '#d4537e', '#5f6b7a'];

/* ---------------- 项目 ---------------- */
function defaultProject() {
  return {
    version: 1,
    name: '未命名分镜',
    duration: 8,
    fps: 30,
    pxPerMeter: 50,
    bg: null,
    bgW: 1920,
    bgH: 1080,
    showGrid: true,
    objects: [],
    activeCam: null,
  };
}

function createChar(x, y, i) {
  const n = Math.max(1, Math.round(i || 1));
  return {
    id: uid('c'), type: 'char', name: '角色' + n,
    color: CHAR_COLORS[(n - 1) % CHAR_COLORS.length],
    x: x, y: y, angle: 0,
    height: 1.75, width: .55,
    faceMove: true, showLabel: true,
    clips: [],
  };
}

function createCam(x, y, i) {
  const n = Math.max(1, Math.round(i || 1));
  return {
    id: uid('k'), type: 'cam', name: '机位' + n, color: '#7c5cff',
    x: x, y: y, angle: 0, pitch: 12 * DEG, height: 1.6, fov: 45,
    keys: [], follow: null,
  };
}

function getObj(id) { return App.state.objects.find(o => o.id === id); }
function getSelObj() { return App.sel ? getObj(App.sel.id) : null; }
function activeCamObj() {
  return App.state.objects.find(o => o.id === App.state.activeCam && o.type === 'cam') || null;
}
function chars() { return App.state.objects.filter(o => o.type === 'char'); }
function cams() { return App.state.objects.filter(o => o.type === 'cam'); }

/* ---------------- 路径 ---------------- */
/* ---- 圆弧插值 ----
   关键帧/路径点之间原来是**直线插值**，于是「环绕一圈」走的是**内接多边形**：
   8 个键 = 八边形，段中点到圆心只有 0.924R —— 路线肉眼是折的，
   镜头离主体的距离还会来回抖 7.6%，画面里主体大小跟着脉动。
   修法：给关键帧（或走位片段）挂一个圆心 `arc: {cx, cy}`，
   同一圆心上的相邻两点之间改走**极坐标**（角度 + 半径各自插值），多边形就变成真圆弧。

   半径允许两端不同 —— 这样螺旋环绕（边绕边靠近）、弧形上升都能覆盖。
   圆心也允许两端不同（arcPoint 里按 e 线性插值）—— 这样 camMove 平移中的
   圆仍是圆，只是圆心在移动；否则「移完之后圈散架」。
   注意「走短弧」的归一：这要求**每一段的圆心角都小于 180°**，
   否则会被当成反向的短弧。模板都是十几到几十度一段，安全；
   探针里有一条专门守这个前提。 */
function sameArc(a, b) {
  /* 判据就是「两端都挂着圆心」，不再要求圆心坐标相等。
     为什么容差必须去掉：camMove 是**斜坡叠加**（每个键按自己所在时刻挪不同的量），
     一圈 8 个键平移过去，每个键的 arc 也就各挪了不同的量 —— 圆心之间差出
     十几像素是常态。原来卡 .5px 的话，段段都判「不是同一个圆」，
     弧插值整段失效、静默退回直线，用户看到的就是「移完之后圈散架了」。
     那圆心不同怎么办？见 arcPoint：圆心本身也按 e 线性插值 ——
     **平移中的圆仍是圆，只是圆心在移动**，半径照旧恒定。 */
  return !!(a && b && a.arc && b.arc);
}
/* arc 传了就用它当共同圆心（走位模板：整条路径一个圆心）；
   不传则各用各的（运镜关键帧：每个键带自己的圆心，允许圆心在段内平移）。 */
function arcPoint(a, b, e, arc) {
  const ca = arc || a.arc, cb = arc || b.arc;
  const ra = Math.hypot(a.x - ca.cx, a.y - ca.cy);
  const rb = Math.hypot(b.x - cb.cx, b.y - cb.cy);
  if (ra < 1e-6 || rb < 1e-6) return null;          /* 端点落在圆心上 → 退化，交给直线 */
  const ta = Math.atan2(a.y - ca.cy, a.x - ca.cx);
  const tb = Math.atan2(b.y - cb.cy, b.x - cb.cx);
  const d = ((tb - ta + Math.PI) % TAU + TAU) % TAU - Math.PI;   /* 归一成 (-π, π] */
  const t = ta + d * e;
  const r = lerp(ra, rb, e);
  const cx = lerp(ca.cx, cb.cx, e), cy = lerp(ca.cy, cb.cy, e);
  return { x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r };
}

function pathCum(path) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    cum.push(total);
  }
  return { cum: cum, total: total };
}
function pathPoint(path, u, arc) {
  if (!path || !path.length) return { x: 0, y: 0 };
  if (path.length === 1) return { x: path[0].x, y: path[0].y };
  const c = pathCum(path);
  if (c.total <= 1e-6) return { x: path[0].x, y: path[0].y };
  const d = clamp(u, 0, 1) * c.total;
  let i = 1;
  while (i < c.cum.length - 1 && c.cum[i] < d) i++;
  const a = path[i - 1], b = path[i];
  const seg = c.cum[i] - c.cum[i - 1] || 1;
  const k = (d - c.cum[i - 1]) / seg;
  /* 整条路径落在一段圆弧上（走位模板「环绕一圈」）→ 段内走弧，不走弦。
     点本身照旧存在 path 里（画线、导出、编辑都要用），只是**求值时**按圆算。 */
  if (arc) { const p = arcPoint(a, b, k, arc); if (p) return p; }
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
}
function pathTangent(path, u, arc) {
  if (!path || path.length < 2) return 0;
  /* 圆弧上：用**相邻两点**求切线，而不是拿弦的方向当切线。
     12 段的圆里弦和切线差半个圆心角（15°）—— 照抄弦方向会让角色的朝向
     一边走一边来回摆 15°。数值差分既准确又不用管顺逆时针的符号。 */
  if (arc) {
    const u0 = clamp(u, 0, 1), u1 = clamp(u0 + .004, 0, 1);
    let p0 = pathPoint(path, u0, arc), p1 = pathPoint(path, u1, arc);
    if (dist(p0, p1) < 1e-6) { p1 = p0; p0 = pathPoint(path, clamp(u0 - .004, 0, 1), arc); }
    if (dist(p0, p1) > 1e-6) return angOf(p1.x - p0.x, p1.y - p0.y);
  }
  const c = pathCum(path);
  const d = clamp(u, 0, 1) * c.total;
  let i = 1;
  while (i < c.cum.length - 1 && c.cum[i] < d) i++;
  const a = path[i - 1], b = path[i];
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return 0;
  return angOf(b.x - a.x, b.y - a.y);
}

/* ---------------- 求值 ---------------- */
/* 画图用的密集折线（有 arc 时按弧采样，没有就原样返回）。
   为什么必须这么画：「环绕一圈」的**实际运动**是圆（见 arcPoint），
   但路径点连出来是内接十二边形 —— 图和动作对不上，用户会以为工具在骗他。
   可编辑的点仍用原 path（方块要落在能拖的位置上），只有描边用这条密线。 */
function pathPolyline(path, arc, n) {
  if (!arc || !path || path.length < 2) return path;
  n = n || 96;
  const out = [];
  for (let i = 0; i <= n; i++) out.push(pathPoint(path, i / n, arc));
  return out;
}
/* 机位关键帧轨迹的密集折线：相邻两键都带 arc 的段按弧采样，其余段走直线。
   这是给「看路线」用的 —— 用户反馈「环绕的路线不是圈，而是多边形」时，
   画布上**根本没有一条线**能让他确认镜头到底走的是什么，
   只能盯着预览画面里主体大小的脉动去猜。 */
function camTrail(cam, n) {
  const ks = (cam.keys || []).slice().sort((a, b) => a.t - b.t);
  if (ks.length < 2) return [];
  n = n || 24;
  const out = [];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    out.push({ x: a.x, y: a.y });
    const isArc = sameArc(a, b);
    const steps = isArc ? n : 1;
    for (let s = 1; s < steps; s++) {
      const e = s / steps;
      const p = isArc ? arcPoint(a, b, e) : null;
      out.push(p || { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) });
    }
  }
  const last = ks[ks.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

function clipsOf(o, kind) {
  return (o.clips || []).filter(k => k.kind === kind).sort((a, b) => a.start - b.start);
}

function evalChar(ch, t) {
  let x = ch.x, y = ch.y, ang = ch.angle, speed = 0;
  const moves = clipsOf(ch, 'move');
  let mv = null;
  for (const m of moves) if (t >= m.start) mv = m;
  if (mv && mv.path && mv.path.length > 1) {
    const u = clamp((t - mv.start) / Math.max(.001, mv.dur), 0, 1);
    const e = ease(u, mv.ease);
    const p = pathPoint(mv.path, e, mv.arc);
    x = p.x; y = p.y;
    if (ch.faceMove) ang = pathTangent(mv.path, e, mv.arc);
    speed = pathCum(mv.path).total / Math.max(.001, mv.dur);
  }
  const turns = clipsOf(ch, 'turn');
  let tk = null;
  for (const k of turns) if (t >= k.start) tk = k;
  if (tk) {
    const u = clamp((t - tk.start) / Math.max(.001, tk.dur), 0, 1);
    /* 转身片段一律按**存下来的有向扫角** sweep 插值，不再走 lerpAngle。
       为什么：lerpAngle 取的是最短弧，而 ±180° 正好是它的歧义点 ——
       angDelta 把 +π 和 -π 都归成 -π（((π+π) mod 2π) 折成了 0），
       于是「右转 180°」和「左转 180°」双双扫向同一侧：
       两个按钮转出来一模一样，终点虽然都对（±180° 本就是同一个方向），
       但**绕过去的那半圈**反了，用户看到的就是「左转右转都往一边转」。
       方向本来是动作自己定死的（turn: ±90/±180），不该让插值函数再猜一次。
       老工程里没有 sweep 字段，回退到 lerpAngle（那时候也只能这样）。 */
    const e = ease(u, tk.ease);
    ang = tk.sweep != null ? tk.from + tk.sweep * e : lerpAngle(tk.from, tk.to, e);
  }

  let action = null, phase = 0;
  const acts = clipsOf(ch, 'action');
  let cur = null;
  for (const a of acts) if (t >= a.start) cur = a;
  if (cur) {
    const u = (t - cur.start) / Math.max(.001, cur.dur);
    if (cur.loop) { action = cur.action; phase = u - Math.floor(u); }
    else if (u <= 1) { action = cur.action; phase = u; }
    else if (cur.hold) { action = cur.action; phase = 1; }
  }
  return { x: x, y: y, angle: ang, action: action, phase: phase, speed: speed, clip: cur };
}

function camKeyFrom(cam, t) {
  return {
    id: uid('kk'), t: t, x: cam.x, y: cam.y, angle: cam.angle,
    pitch: cam.pitch, height: cam.height, fov: cam.fov, ease: 'inout',
  };
}
function evalCam(cam, t) {
  const keys = (cam.keys || []).slice().sort((a, b) => a.t - b.t);
  let r = { x: cam.x, y: cam.y, angle: cam.angle, pitch: cam.pitch, height: cam.height, fov: cam.fov };
  if (keys.length) {
    if (t <= keys[0].t) {
      const k = keys[0];
      r = { x: k.x, y: k.y, angle: k.angle, pitch: k.pitch, height: k.height, fov: k.fov };
    } else if (t >= keys[keys.length - 1].t) {
      const k = keys[keys.length - 1];
      r = { x: k.x, y: k.y, angle: k.angle, pitch: k.pitch, height: k.height, fov: k.fov };
    } else {
      let i = 0;
      while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
      const a = keys[i], b = keys[i + 1];
      const u = (t - a.t) / Math.max(.001, b.t - a.t);
      const e = ease(u, b.ease || 'inout');
      /* 相邻两键挂在同一个圆心上（环绕 / 螺旋 / 弧形上升）→ 段内走弧，不走弦。
         不然「环绕一圈」就是内接多边形，镜头离主体忽远忽近。 */
      const ap = sameArc(a, b) ? arcPoint(a, b, e) : null;
      r = {
        x: ap ? ap.x : lerp(a.x, b.x, e), y: ap ? ap.y : lerp(a.y, b.y, e),
        angle: lerpAngle(a.angle, b.angle, e), pitch: lerp(a.pitch, b.pitch, e),
        height: lerp(a.height, b.height, e), fov: lerp(a.fov, b.fov, e),
      };
    }
  }
  if (cam.follow && cam.follow.targetId) {
    const tg = getObj(cam.follow.targetId);
    if (tg && tg.type === 'char') {
      const pm = App.state.pxPerMeter;
      const s = evalChar(tg, t);
      const d = cam.follow.dist == null ? 4 : cam.follow.dist;
      const sd = cam.follow.side || 0;
      const f = dirVec(s.angle), rt = { x: -f.y, y: f.x };
      r.x = s.x - f.x * d * pm + rt.x * sd * pm;
      r.y = s.y - f.y * d * pm + rt.y * sd * pm;
      r.angle = angOf(s.x - r.x, s.y - r.y);
      r.height = cam.follow.height == null ? cam.height : cam.follow.height;
    }
  }
  r.name = cam.name;
  return r;
}

/* 相机编辑：有关键帧时自动打关键帧 */
function applyCamEdit(cam, patch) {
  if (!cam.keys || !cam.keys.length) {
    Object.assign(cam, patch);
    return;
  }
  const t = App.time;
  let k = cam.keys.find(kk => Math.abs(kk.t - t) < .02);
  if (!k) {
    k = camKeyFrom(cam, t);
    k.x = evalCam(cam, t).x; k.y = evalCam(cam, t).y;
    cam.keys.push(k);
    cam.keys.sort((a, b) => a.t - b.t);
  }
  Object.assign(k, patch);
  /* 手动改了某一帧的位置 = 它不再落在原来那个圆上了，弧的信息必须摘掉。
     不摘的话弧插值会无视用户刚拖到的位置 —— 又是一个「拖了没反应」的静默失效。
     代价是相邻两段退回直线（路径上多一个拐点），这是应有的结果：
     用户亲手改过这一帧，它就不再是完美圆弧的一部分了。 */
  if (patch && (patch.x != null || patch.y != null)) delete k.arc;
  if (t < .02) Object.assign(cam, patch);
}

/* ---------------- 撤销 / 存档 ---------------- */
function snapshot() {
  const s = deepCopy(App.state);
  s.bg = s.bg ? '#BG#' : null;
  return JSON.stringify(s);
}
function pushUndo() {
  App.undoStack.push(snapshot());
  if (App.undoStack.length > 60) App.undoStack.shift();
  App.redoStack.length = 0;
}
function restoreSnap(str) {
  const keepBg = App.state ? App.state.bg : null;
  const s = JSON.parse(str);
  if (s.bg === '#BG#') s.bg = keepBg;
  App.state = s;
  if (App.sel && !getObj(App.sel.id)) App.sel = null;
  App.time = clamp(App.time, 0, App.state.duration);
}
function doUndo() {
  if (!App.undoStack.length) { toast('没有可撤销的操作了'); return; }
  App.redoStack.push(snapshot());
  restoreSnap(App.undoStack.pop());
  if (typeof refreshAll === 'function') refreshAll();
}
function doRedo() {
  if (!App.redoStack.length) { toast('没有可重做的操作'); return; }
  App.undoStack.push(snapshot());
  restoreSnap(App.redoStack.pop());
  if (typeof refreshAll === 'function') refreshAll();
}

function serialize() { return JSON.stringify(App.state); }
function deserialize(str) {
  const s = JSON.parse(str);
  if (!s || !s.objects) throw new Error('不是有效的分镜文件');
  const base = defaultProject();
  const st = Object.assign(base, s);
  st.objects.forEach(o => {
    if (o.type === 'cam') { o.keys = o.keys || []; o.keys.forEach(k => { if (!k.id) k.id = uid('kk'); }); }
    if (o.type === 'char') { o.clips = o.clips || []; o.clips.forEach(c => { if (!c.id) c.id = uid('cp'); }); }
  });
  return st;
}
