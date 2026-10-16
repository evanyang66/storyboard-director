'use strict';
/* ============================================================
   render.js — 俯视图渲染 + 透视镜头渲染
   ============================================================ */

/* ---------------- 背景贴图 ---------------- */
function setBackground(url, cb) {
  if (!url) {
    App.state.bg = null; App.bgImage = null; App.tex = null;
    if (cb) cb();
    return;
  }
  const img = new Image();
  img.onload = () => {
    App.bgImage = img;
    App.state.bg = url;
    App.state.bgW = img.naturalWidth;
    App.state.bgH = img.naturalHeight;
    buildTex();
    if (cb) cb();
  };
  img.onerror = () => { toast('图片加载失败'); if (cb) cb(); };
  img.src = url;
}
function buildTex() {
  const img = App.bgImage;
  if (!img) { App.tex = null; return; }
  const maxW = 1400;
  const w = Math.min(maxW, img.naturalWidth);
  const h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  App.tex = { w: w, h: h, data: g.getImageData(0, 0, w, h).data };
}

/* ---------------- 坐标换算 ---------------- */
function toScreenP(x, y, view, W, H) {
  return { x: W / 2 + (x - view.cx) * view.zoom, y: H / 2 + (y - view.cy) * view.zoom };
}
function screenToWorld(sx, sy, view, W, H) {
  return { x: view.cx + (sx - W / 2) / view.zoom, y: view.cy + (sy - H / 2) / view.zoom };
}
function label(ctx, text, x, y, color, size, align, weight) {
  ctx.font = (weight || 500) + ' ' + (size || 12) + 'px "Microsoft YaHei",sans-serif';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/* ---------------- 俯视图 ---------------- */
function renderTopdown(ctx, W, H, view, dpr, opts) {
  opts = opts || {};
  const st = App.state, z = view.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#dbe1ea';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - view.cx * z), dpr * (H / 2 - view.cy * z));
  if (App.bgImage) ctx.drawImage(App.bgImage, 0, 0, st.bgW, st.bgH);
  else { ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, 0, st.bgW, st.bgH); }
  if (st.showGrid && opts.grid !== false) {
    const pm = st.pxPerMeter;
    ctx.lineWidth = 1 / z;
    for (let x = 0; x <= st.bgW; x += pm) {
      ctx.strokeStyle = (Math.round(x / pm) % 5 === 0) ? 'rgba(80,100,130,.20)' : 'rgba(80,100,130,.08)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, st.bgH); ctx.stroke();
    }
    for (let y = 0; y <= st.bgH; y += pm) {
      ctx.strokeStyle = (Math.round(y / pm) % 5 === 0) ? 'rgba(80,100,130,.20)' : 'rgba(80,100,130,.08)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(st.bgW, y); ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(60,80,110,.30)';
  ctx.lineWidth = 2 / z;
  ctx.strokeRect(0, 0, st.bgW, st.bgH);
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const P = (x, y) => toScreenP(x, y, view, W, H);
  const aspect = App.previewRes[0] / App.previewRes[1];
  const pm = st.pxPerMeter;

  /* 镜头地面视野框 */
  for (const o of st.objects) {
    if (o.type !== 'cam') continue;
    const cs = evalCam(o, App.time);
    const fp = camFootprint(cs, aspect, pm * 45);
    ctx.beginPath();
    fp.forEach((p, i) => { const q = P(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
    const isAct = o.id === st.activeCam;
    ctx.fillStyle = isAct ? 'rgba(124,92,255,.16)' : 'rgba(124,92,255,.07)';
    ctx.fill();
    ctx.strokeStyle = isAct ? 'rgba(124,92,255,.75)' : 'rgba(124,92,255,.35)';
    ctx.lineWidth = isAct ? 1.5 : 1;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* 走位线 */
  for (const o of st.objects) {
    if (o.type !== 'char') continue;
    const sel = App.sel && App.sel.id === o.id;
    for (const c of clipsOf(o, 'move')) {
      if (!c.path || c.path.length < 2) continue;
      const on = App.sel && App.sel.clipId === c.id;
      /* 有 arc 的走位（环绕一圈）按弧采样再描边 —— 直接连路径点画出来是十二边形，
         和实际运动（圆）对不上。可编辑的方块仍落在原 path 点上。 */
      const pl = pathPolyline(c.path, c.arc);
      ctx.beginPath();
      pl.forEach((p, i) => { const q = P(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.strokeStyle = on ? '#2b6cf6' : (sel ? 'rgba(43,108,246,.65)' : 'rgba(70,95,130,.35)');
      ctx.lineWidth = on ? 2.5 : 1.6;
      ctx.setLineDash(on ? [] : [7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const e = pl[pl.length - 1], prev = pl[pl.length - 2];
      const qe = P(e.x, e.y), qp = P(prev.x, prev.y);
      arrowHead(ctx, qp, qe, on ? '#2b6cf6' : 'rgba(70,95,130,.5)', on ? 9 : 7);
      if (on) {
        c.path.forEach((p, i) => {
          const q = P(p.x, p.y);
          ctx.beginPath();
          ctx.rect(q.x - 4, q.y - 4, 8, 8);
          ctx.fillStyle = i === 0 ? '#12a150' : '#2b6cf6';
          ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        });
      }
      const t0 = P(c.path[0].x, c.path[0].y);
      label(ctx, fmt(c.start, 1) + 's', t0.x, t0.y - 16, '#4a5568', 10.5);
    }
  }

  /* 正在画的线 */
  if (App.pending && App.pending.pts.length) {
    const pts = App.pending.pts.slice();
    if (App.pending.hover) pts.push(App.pending.hover);
    ctx.beginPath();
    pts.forEach((p, i) => { const q = P(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.strokeStyle = '#2b6cf6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    App.pending.pts.forEach((p, i) => {
      const q = P(p.x, p.y);
      ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, TAU);
      ctx.fillStyle = i === 0 ? '#12a150' : '#2b6cf6'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });
    const last = P(App.pending.pts[App.pending.pts.length - 1].x, App.pending.pts[App.pending.pts.length - 1].y);
    label(ctx, '回车 / 双击 结束　右键撤销一点', last.x, last.y + 22, '#2b6cf6', 11);
  }

  /* 角色当前时刻的移动小球 */
  for (const o of st.objects) {
    if (o.type !== 'char') continue;
    const s = evalChar(o, App.time);
    const q = P(s.x, s.y);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3.5, 0, TAU);
    ctx.fillStyle = o.color; ctx.fill();
  }

  /* 当前机位的运镜轨迹：让用户能**直接看出**「环绕走的是不是圆」。
     只画选中的那台，免得每台机位都甩一条线出来。 */
  for (const o of st.objects) {
    if (o.type !== 'cam' || o.id !== st.activeCam) continue;
    const tr = camTrail(o);
    if (tr.length < 2) continue;
    ctx.beginPath();
    tr.forEach((p, i) => { const q = P(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.strokeStyle = 'rgba(124,92,255,.5)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    /* 关键帧本身用小方块标出来（弧插值的采样点不标，免得糊成一片） */
    for (const k of (o.keys || [])) {
      const q = P(k.x, k.y);
      ctx.beginPath(); ctx.rect(q.x - 3, q.y - 3, 6, 6);
      ctx.fillStyle = '#7c5cff'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  /* 摄像机 */
  for (const o of st.objects) {
    if (o.type !== 'cam') continue;
    const cs = evalCam(o, App.time);
    const q = P(cs.x, cs.y);
    const act = o.id === st.activeCam;
    const f = dirVec(cs.angle);
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(cs.angle);
    ctx.beginPath();
    ctx.moveTo(-7, -5); ctx.lineTo(7, -5); ctx.lineTo(7, 5); ctx.lineTo(-7, 5);
    ctx.closePath();
    ctx.fillStyle = act ? '#7c5cff' : '#b7a8ff';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(20, 0);
    ctx.strokeStyle = act ? '#7c5cff' : 'rgba(124,92,255,.6)';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    label(ctx, o.name + (act ? ' ●' : ''), q.x, q.y - 14, act ? '#5233c9' : '#7b86a0', 11.5);
    label(ctx, 'H' + fmt(cs.height, 1) + 'm ' + fmt(cs.fov, 0) + '° ' + fmt(cs.pitch * RAD, 0) + '°',
      q.x, q.y + 16, '#8b93a6', 10);
  }

  /* 角色：视线扇形先统一铺一层（在角色**下面**，不然会把小人盖住），再画角色本身 */
  for (const o of st.objects) {
    if (o.type !== 'char') continue;
    drawGazeTop(ctx, o, view, W, H);
  }
  for (const o of st.objects) {
    if (o.type !== 'char') continue;
    drawCharTop(ctx, o, view, W, H);
  }
}

function arrowHead(ctx, from, to, color, size) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.save();
  ctx.translate(to.x, to.y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * .55);
  ctx.lineTo(-size, size * .55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/* ---------------- 视线扇形 ----------------
   为什么要有它：缩小时角色只有十几像素，圆和箭头糊成一团、五官更是看不清，
   而「一片地面区域」在同样的缩放下反而最显眼 —— 一眼就知道他在看哪儿。
   所以朝向这件事做了三层：扇形（远看）+ 箭头（中景）+ 五官（放大看）。 */
const GAZE_M = 4;              /* 扇形半径（米） */
const GAZE_HALF = 32 * DEG;    /* 半张角 */
function gazeSector(s, pm, meters, half) {
  const R = (meters || GAZE_M) * pm, h = (half == null ? GAZE_HALF : half * DEG), N = 18;
  const out = [{ x: s.x, y: s.y }];
  for (let i = 0; i <= N; i++) {
    const a = s.angle - h + (i / N) * h * 2;
    out.push({ x: s.x + Math.sin(a) * R, y: s.y - Math.cos(a) * R });
  }
  return out;
}
/* 俯视图：直接按世界坐标画（世界坐标 = 背景像素坐标） */
function drawGazeTop(ctx, ch, view, W, H) {
  const s = evalChar(ch, App.time);
  const poly = gazeSector(s, App.state.pxPerMeter);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const q = toScreenP(poly[i].x, poly[i].y, view, W, H);
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fillStyle = ch.color + '1f';
  ctx.fill();
  ctx.strokeStyle = ch.color + '52';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}
/* 透视镜头：扇形是地面上的图形，所以投到 z=0 上 */
function drawGaze3D(ctx, B, ch, s, f) {
  const poly = gazeSector(s, B.pm);
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const q = projPt(B, poly[i].x, poly[i].y, 0);
    if (!q) { ctx.restore(); return; }
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.globalAlpha = 1 - clamp((f - B.pm * 16) / (B.pm * 140), 0, .6) * .8;
  ctx.fillStyle = ch.color + '1f';
  ctx.fill();
  ctx.strokeStyle = ch.color + '52';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.restore();
}

/* 角色在俯视图里的屏幕半径，以及旋转手柄离中心的距离。
   为什么抽出来：这两处以前在 render.js 和 ui.js 里各写了一份，
   半径的基数还一个 max(10)、一个 max(12) —— 手柄的**命中位置**和
   **画出来的位置**本来就可能差 2px。现在箭头又要伸到 2.10r，
   手柄必须跟着外移，共用一份才不会再对不上。 */
function charRadius(ch, zoom, pm) { return Math.max(10, ch.width * pm * zoom / 2); }
function rotHandleDist(r) { return r * 2.10 + 16; }   /* 必须落在朝向箭头之外 */

function drawCharTop(ctx, ch, view, W, H) {
  const s = evalChar(ch, App.time);
  const q = toScreenP(s.x, s.y, view, W, H);
  const pm = App.state.pxPerMeter, z = view.zoom;
  const r = charRadius(ch, z, pm);
  const selected = App.sel && App.sel.id === ch.id;

  ctx.beginPath();
  ctx.ellipse(q.x + 2, q.y + 3, r * 1.05, r * .95, 0, 0, TAU);
  ctx.fillStyle = 'rgba(30,40,60,.16)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, TAU);
  ctx.fillStyle = ch.color + '3d';
  ctx.fill();
  ctx.strokeStyle = ch.color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  /* ---- 朝向：让人一眼分出「正脸 / 后背」 ----
     原来只有一个 1.95r 的实心三角，底边（±.72r）压在圆里、又和圆的描边**同色** ——
     缩小后整体糊成「带个凸起的圆」，正反看不出来。改成三段叠加：
       ① 圆上的白色「鼻尖」弧：给圆本身一个正面标记，光看轮廓就知道哪边是脸；
       ② 箭头整体**离开**圆（箭杆从圆边起，不再压在圆里）；
       ③ 箭头先描一圈白底再画本色 —— 深色角色在浅背景上才分得清。 */
  const fx = Math.sin(s.angle), fy = -Math.cos(s.angle);
  const px = -fy, py = fx;

  /* ① 鼻尖：正前方 ±34° 的亮弧（canvas 的 0° 在 +x，所以朝向角要减 90°） */
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, s.angle - Math.PI / 2 - .6, s.angle - Math.PI / 2 + .6);
  ctx.strokeStyle = 'rgba(255,255,255,.95)';
  ctx.lineWidth = Math.max(1.8, r * .24);
  ctx.lineCap = 'round';
  ctx.stroke();

  /* ②③ 箭头：同一路径描两遍（白底 + 本色） */
  const tip = r * 2.10;
  const ax = q.x + fx * r * .98, ay = q.y + fy * r * .98;        /* 箭杆起点＝圆边 */
  const bx = q.x + fx * r * 1.40, by = q.y + fy * r * 1.40;      /* 箭杆末端 */
  const b1x = q.x + fx * r * 1.26 + px * r * .68, b1y = q.y + fy * r * 1.26 + py * r * .68;
  const b2x = q.x + fx * r * 1.26 - px * r * .68, b2y = q.y + fy * r * 1.26 - py * r * .68;
  const arrow = (w, col) => {
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b1x, b1y); ctx.lineTo(q.x + fx * tip, q.y + fy * tip); ctx.lineTo(b2x, b2y);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = w * .5; ctx.lineJoin = 'round';
    ctx.stroke();
  };
  arrow(Math.max(5, r * .80), 'rgba(255,255,255,.95)');
  arrow(Math.max(2.2, r * .38), ch.color);

  /* 文字要让开箭头（最远到 2.10r），否则朝北时名字正好压在箭头上 */
  if (ch.showLabel) {
    label(ctx, ch.name, q.x, q.y - tip - 8, '#2c3648', 12);
  }
  if (s.action) label(ctx, actionLabel(s.action), q.x, q.y + tip + 8, ch.color, 10.5);

  if (selected) {
    ctx.beginPath();
    ctx.arc(q.x, q.y, r + 7, 0, TAU);
    ctx.strokeStyle = '#2b6cf6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const hd = rotHandleDist(r);
    const hx = q.x + fx * hd, hy = q.y + fy * hd;
    ctx.beginPath();
    ctx.moveTo(q.x + fx * r * 1.05, q.y + fy * r * 1.05);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = 'rgba(43,108,246,.45)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, TAU);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#2b6cf6'; ctx.lineWidth = 2; ctx.stroke();
  }
}

/* ---------------- 镜头地面视野框 ---------------- */
function camFootprint(cs, aspect, maxDist) {
  const pm = App.state.pxPerMeter;
  const cz = cs.height * pm;
  const cp = Math.cos(cs.pitch), sp = Math.sin(cs.pitch);
  const tv = Math.tan(cs.fov * DEG / 2), th = tv * aspect;
  const ca = Math.cos(cs.angle), sa = Math.sin(cs.angle);
  const right = { x: ca, y: sa };
  const fwd = { x: sa * cp, y: -ca * cp, z: -sp };
  const up = { x: sa * sp, y: -ca * sp, z: cp };
  const out = [];
  for (const ndc of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
    const ld = ndc[0] * th, ud = ndc[1] * tv;
    const dx = right.x * ld + fwd.x + up.x * ud;
    const dy = right.y * ld + fwd.y + up.y * ud;
    const dz = fwd.z + up.z * ud;
    let t = dz < -1e-6 ? -cz / dz : maxDist;
    t = Math.min(t, maxDist);
    out.push({ x: cs.x + dx * t, y: cs.y + dy * t });
  }
  return out;
}

/* ---------------- 透视镜头：相机基向量 ---------------- */
const _gbuf = {};
function groundBuf(hw, hh) {
  const k = hw + 'x' + hh;
  let b = _gbuf[k];
  if (!b) {
    const cv = document.createElement('canvas');
    cv.width = hw; cv.height = hh;
    const cx = cv.getContext('2d');
    b = { cv: cv, cx: cx, img: cx.createImageData(hw, hh) };
    const ks = Object.keys(_gbuf);
    if (ks.length > 3) delete _gbuf[ks[0]];
    _gbuf[k] = b;
  }
  return b;
}

function makeBasis(cs, W, H) {
  const pm = App.state.pxPerMeter;
  const cam = { x: cs.x, y: cs.y, z: cs.height * pm };
  const fpx = (H / 2) / Math.tan(clamp(cs.fov, 8, 120) * DEG / 2);
  const cp = Math.cos(cs.pitch), sp = Math.sin(cs.pitch);
  const ca = Math.cos(cs.angle), sa = Math.sin(cs.angle);
  return {
    cam: cam, fpx: fpx, W: W, H: H, pm: pm,
    right: { x: ca, y: sa },
    fwd: { x: sa * cp, y: -ca * cp, z: -sp },
    up: { x: sa * sp, y: -ca * sp, z: cp },
    horizonY: H / 2 - fpx * Math.tan(cs.pitch),
  };
}

function projPt(B, x, y, z) {
  const dx = x - B.cam.x, dy = y - B.cam.y, dz = z - B.cam.z;
  const f = dx * B.fwd.x + dy * B.fwd.y + dz * B.fwd.z;
  if (f <= .02) return null;
  const l = dx * B.right.x + dy * B.right.y;
  const u = dx * B.up.x + dy * B.up.y + dz * B.up.z;
  return { x: B.W / 2 + B.fpx * l / f, y: B.H / 2 - B.fpx * u / f, f: f };
}

/* 屏幕点 -> 地面交点（3D 视图里用来拾取/拖动） */
function rayToGround(B, sx, sy) {
  const ld = (sx - B.W / 2) / B.fpx;
  const ud = (B.H / 2 - sy) / B.fpx;
  const dx = B.right.x * ld + B.fwd.x + B.up.x * ud;
  const dy = B.right.y * ld + B.fwd.y + B.up.y * ud;
  const dz = B.fwd.z + B.up.z * ud;
  if (dz > -1e-6) return null;
  const t = -B.cam.z / dz;
  if (!(t > 0) || t > 1e8) return null;
  return { x: B.cam.x + dx * t, y: B.cam.y + dy * t };
}

/* ---------------- 场景渲染（3D 透视 / 2D 正交平面 两种模式） ---------------- */
function renderShot(ctx, W, H, cs, t, opts) {
  opts = opts || {};
  /* 2D 平面视角：整幅画面走正交投影（没有消失点、没有透视地面） */
  if (opts.ortho) { renderShotOrtho(ctx, W, H, cs, t, opts); return; }
  const B = makeBasis(cs, W, H);
  const mode = opts.mode || App.mode || '3d';

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#9dbedd');
  sky.addColorStop(.5, '#cfe0f0');
  sky.addColorStop(1, '#eaf1f8');
  const dp = opts.dpr || 1;
  ctx.setTransform(dp, 0, 0, dp, 0, 0);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  drawGroundTex(ctx, W, H, B);

  /* 角色：远 → 近 */
  const list = [];
  for (const ch of chars()) {
    const s = evalChar(ch, t);
    const f = (s.x - B.cam.x) * B.fwd.x + (s.y - B.cam.y) * B.fwd.y + (0 - B.cam.z) * B.fwd.z;
    if (f > .25) list.push({ ch: ch, s: s, f: f });
  }
  list.sort((a, b) => b.f - a.f);
  /* 视线扇形：地面标记，画在角色下面。
     只在预演窗口勾了「视线」时出现 —— 导出（PNG / 视频）一律传 gaze=false，
     成片里不会混进编辑标记。 */
  if (opts.gaze) for (const o of list) drawGaze3D(ctx, B, o.ch, o.s, o.f);
  for (const o of list) {
    const fog = clamp((o.f - B.pm * 16) / (B.pm * 140), 0, .6);
    const alpha = 1 - fog * .8;
    if (mode === '2d') drawCharCam(ctx, B, o.ch, o.s, o.f, alpha);
    else drawChar3D(ctx, B, o.ch, o.s, W, H, alpha);
  }

  if (opts.overlay) opts.overlay(ctx, B, t);
  /* 辅助线由调用方决定：镜头预览传 App.showGuides，预演传 App.playerGuides，导出传 false。
     不要在这里再 && App.showGuides，否则预演自己的开关会被预览的开关连带关掉。 */
  if (opts.guides) drawCamGuides(ctx, W, H, B);
  if (opts.hud !== false) drawCamHUD(ctx, W, H, cs, t);
}

/* 兼容旧调用 */
function renderCamera(ctx, W, H, cs, t, opts) { renderShot(ctx, W, H, cs, t, opts); }

/* 2D 模式：平面剪影（永远正对镜头） */
function drawCharCam(ctx, B, ch, s, f, alpha) {
  const pm = B.pm;
  const foot = projPt(B, s.x, s.y, 0);
  const head = projPt(B, s.x, s.y, ch.height * pm);
  if (!foot || !head) return;
  let hpx = foot.y - head.y;
  if (hpx < 3 || foot.y < -B.H || foot.y > B.H * 2) return;
  hpx = Math.min(hpx, B.H * 2.5);

  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  const shR = Math.max(2, B.fpx * (ch.width * pm * .55) / f);
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, shR, Math.max(1.2, shR * .3), 0, 0, TAU);
  ctx.fillStyle = 'rgba(25,35,55,.24)';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(foot.x, foot.y, shR * 1.15, Math.max(1.4, shR * .34), 0, 0, TAU);
  ctx.strokeStyle = ch.color;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = (alpha == null ? 1 : alpha) * .55;
  ctx.stroke();
  ctx.globalAlpha = alpha == null ? 1 : alpha;

  const face = dirVec(s.angle);
  const l = face.x * B.right.x + face.y * B.right.y;
  const dir = l >= 0 ? 1 : -1;
  drawFigure(ctx, foot.x, foot.y, hpx, dir, actionPose(s.action, s.phase), ch.color, { lw: .062 });
  ctx.restore();

  if (ch.showLabel && hpx > 26) {
    ctx.save();
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * .9;
    label(ctx, ch.name, foot.x, head.y - 12, '#2c3648', Math.max(10, Math.min(15, hpx * .16)));
    ctx.restore();
  }
}

function drawGroundTex(ctx, W, H, B) {
  const st = App.state, tex = App.tex;
  const hw = Math.max(2, Math.floor(W / 2)), hh = Math.max(2, Math.floor(H / 2));
  const buf = groundBuf(hw, hh);
  const img = buf.img, d = img.data;
  const pm = B.pm;
  const cam = B.cam, right = B.right, fwd = B.fwd, up = B.up, fpx = B.fpx;
  const maxT = pm * 260;
  const fogStart = pm * 18, fogRange = pm * 150;
  const FR = 226, FG = 236, FB = 246;

  for (let y = 0; y < hh; y++) {
    const sy = y * 2 + 1;
    const ud = (H / 2 - sy) / fpx;
    const dz = fwd.z + up.z * ud;
    const row = y * hw * 4;
    if (dz >= -1e-7) {
      for (let x = 0; x < hw; x++) d[row + x * 4 + 3] = 0;
      continue;
    }
    const tt = -cam.z / dz;
    const stepX = tt * right.x * 2 / fpx;
    const stepY = tt * right.y * 2 / fpx;
    let wx = cam.x + tt * (fwd.x + up.x * ud) + stepX * (1 - W / 2) / 2;
    let wy = cam.y + tt * (fwd.y + up.y * ud) + stepY * (1 - W / 2) / 2;
    const fog = clamp((tt - fogStart) / fogRange, 0, .72);
    const inv = 1 - fog;
    const sky = tt > maxT;
    for (let x = 0; x < hw; x++) {
      const o = row + x * 4;
      if (sky) { d[o + 3] = 0; }
      else if (tex) {
        const px = wx / st.bgW * tex.w, py = wy / st.bgH * tex.h;
        if (px < 0 || py < 0 || px >= tex.w - 1 || py >= tex.h - 1) {
          d[o] = FR * .96; d[o + 1] = FG * .97; d[o + 2] = FB; d[o + 3] = 255;
        } else {
          const i = ((py | 0) * tex.w + (px | 0)) * 4;
          d[o] = (tex.data[i] * inv + FR * fog) | 0;
          d[o + 1] = (tex.data[i + 1] * inv + FG * fog) | 0;
          d[o + 2] = (tex.data[i + 2] * inv + FB * fog) | 0;
          d[o + 3] = 255;
        }
      } else {
        d[o] = 226; d[o + 1] = 233; d[o + 2] = 240; d[o + 3] = 255;
      }
      wx += stepX; wy += stepY;
    }
  }
  buf.cx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buf.cv, 0, 0, W, H);
  ctx.restore();
}

/* ============================================================
   2D 平面视角（正交投影 / 立面侧视图）
   没有消失点、没有透视地面：横向位置线性映射到屏幕 x，世界高度线性映射到屏幕 y。
   人物的远近不再改变大小，只用轻微雾化做深度提示。
   ============================================================ */
function orthoBasis(cs, W, H) {
  const pm = App.state.pxPerMeter;
  const fpx = (H / 2) / Math.tan(clamp(cs.fov, 8, 120) * DEG / 2);
  let s = fpx / (pm * 8);                 // 以 8m 参考距离定标，和透视视角的取景量级接近
  const personPx = 1.75 * pm * s;         // 1.75m 人物在画面上的高度
  if (personPx < H * .08) s *= (H * .08) / personPx;
  else if (personPx > H * .70) s *= (H * .70) / personPx;
  return {
    ortho: true, W: W, H: H, pm: pm, s: s,
    groundY: H * .70,                     // 地面线（立面图的基准线）
    horizonY: -1e4,                       // 正交视角没有地平线，别让辅助线重复画一条
    right: { x: Math.cos(cs.angle), y: Math.sin(cs.angle) },
    fwd: { x: Math.sin(cs.angle), y: -Math.cos(cs.angle) },
    cam: { x: cs.x, y: cs.y },
    camH: cs.height * pm * s,
  };
}

function drawFigureOrtho(ctx, O, ch, s, x, alpha) {
  const hpx = ch.height * O.pm * O.s;
  const face = dirVec(s.angle);
  const l = face.x * O.right.x + face.y * O.right.y;
  const dir = l >= 0 ? 1 : -1;
  ctx.save();
  ctx.globalAlpha = alpha;
  const shR = Math.max(3, ch.width * O.pm * O.s * .6);
  ctx.beginPath();
  ctx.ellipse(x, O.groundY, shR, Math.max(1.5, shR * .26), 0, 0, TAU);
  ctx.fillStyle = 'rgba(25,35,55,.22)';
  ctx.fill();
  drawFigure(ctx, x, O.groundY, hpx, dir, actionPose(s.action, s.phase), ch.color, { lw: .062 });
  ctx.restore();
  if (ch.showLabel) {
    ctx.save();
    ctx.globalAlpha = alpha * .95;
    label(ctx, ch.name, x, O.groundY - hpx - 12, '#2c3648', Math.max(10, Math.min(15, hpx * .16)));
    ctx.restore();
  }
}

function renderShotOrtho(ctx, W, H, cs, t, opts) {
  const O = orthoBasis(cs, W, H);
  const dp = opts.dpr || 1;
  ctx.setTransform(dp, 0, 0, dp, 0, 0);

  /* 天空：平面色，不做透视渐变 */
  const sky = ctx.createLinearGradient(0, 0, 0, O.groundY);
  sky.addColorStop(0, '#c9d9e8');
  sky.addColorStop(1, '#eef3f8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, O.groundY);

  /* 地面：一条实线 + 下方的平涂带 */
  ctx.fillStyle = '#e2e7ee';
  ctx.fillRect(0, O.groundY, W, H - O.groundY);

  /* 1m 高度参考线（立面图最直观的尺度参照） */
  ctx.save();
  ctx.font = Math.max(10, W * .009) + 'px "Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  for (let m = 1; m <= 8; m++) {
    const y = O.groundY - m * O.pm * O.s;
    if (y < 10) break;
    ctx.strokeStyle = 'rgba(90,115,150,.15)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke();
    ctx.fillStyle = 'rgba(90,115,150,.52)';
    ctx.fillText(m + 'm', 6, y - 3);
  }
  ctx.strokeStyle = 'rgba(70,95,130,.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, O.groundY + .5); ctx.lineTo(W, O.groundY + .5); ctx.stroke();
  ctx.restore();

  /* 相机视高参考线 */
  const eyeY = O.groundY - O.camH;
  if (eyeY > 10 && eyeY < H - 8) {
    ctx.save();
    ctx.strokeStyle = 'rgba(124,92,255,.42)';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(0, eyeY + .5); ctx.lineTo(W, eyeY + .5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = Math.max(10, W * .009) + 'px "Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(124,92,255,.78)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('视高 ' + fmt(cs.height, 2) + 'm', W - 6, eyeY - 3);
    ctx.restore();
  }

  /* 人物：按纵深从远到近 */
  const list = [];
  for (const ch of chars()) {
    const s = evalChar(ch, t);
    list.push({
      ch: ch, s: s,
      lat: (s.x - O.cam.x) * O.right.x + (s.y - O.cam.y) * O.right.y,
      dep: (s.x - O.cam.x) * O.fwd.x + (s.y - O.cam.y) * O.fwd.y,
    });
  }
  list.sort((a, b) => b.dep - a.dep);
  for (const o of list) {
    const x = W / 2 + o.lat * O.s;
    const hpx = o.ch.height * O.pm * O.s;
    if (x < -hpx || x > W + hpx) continue;
    /* dep 已经是**世界像素**了（上面就是拿世界坐标点乘出来的），
       不要再乘一次 O.pm —— 那等于把 4m 当成 200m 算，雾化瞬间顶到上限 0.5，
       于是 2D 平面里只要离镜头超过 1.7m 的人物都画成 50% 透明、整体发白。
       （3D 那条路的同款公式用的是 o.f，也是世界像素，就没有这个错。） */
    const fog = clamp((Math.abs(o.dep) - O.pm * 16) / (O.pm * 140), 0, .5);
    drawFigureOrtho(ctx, O, o.ch, o.s, x, 1 - fog);
  }

  if (opts.overlay) opts.overlay(ctx, O, t);
  if (opts.guides) drawCamGuides(ctx, W, H, O);
  if (opts.hud !== false) drawCamHUD(ctx, W, H, cs, t, true);
}

function drawCamGuides(ctx, W, H, B) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.42)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(W * i / 3, 0); ctx.lineTo(W * i / 3, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * i / 3); ctx.lineTo(W, H * i / 3); ctx.stroke();
  }
  ctx.setLineDash([]);
  const hy = B ? B.horizonY : H / 2;
  if (hy > -50 && hy < H + 50) {
    ctx.strokeStyle = 'rgba(124,92,255,.55)';
    ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(W, hy); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.strokeRect(W * .05, H * .05, W * .9, H * .9);
  ctx.restore();
}

function drawCamHUD(ctx, W, H, cs, t, ortho) {
  ctx.save();
  const pad = Math.max(8, W * .012);
  ctx.font = '600 ' + Math.max(11, W * .014) + 'px "Microsoft YaHei",sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(20,28,42,.62)';
  ctx.fillText('T ' + fmt(t, 2) + 's', pad, H - pad);
  ctx.textAlign = 'right';
  /* 正交视角没有视场角，报视高更有意义 */
  ctx.fillText(ortho
    ? cs.name + '　2D 平面视角　视高 ' + fmt(cs.height, 2) + 'm'
    : cs.name + '　FOV ' + fmt(cs.fov, 0) + '°　H ' + fmt(cs.height, 2) + 'm', W - pad, H - pad);
  ctx.restore();
}
