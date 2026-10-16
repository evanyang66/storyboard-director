'use strict';
/* ============================================================
   render3d.js — 立体（3D）人物渲染
   把姿态骨架放进真实 3D 空间，投影成带体积的圆柱段
   局部坐标：u = 角色前方，v = 角色右侧，w = 竖直向上（单位=身高归一化）
   ============================================================ */

/* 颜色明暗 */
function shade(hex, k) {
  if (!hex || hex.charAt(0) !== '#' || hex.length < 7) return hex;
  let r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
  r = clamp(Math.round(r * k), 0, 255);
  g = clamp(Math.round(g * k), 0, 255);
  b = clamp(Math.round(b * k), 0, 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* 各部件的体积半径（身高归一化单位） */
const R_TORSO = .088, R_THIGH = .058, R_SHIN = .05, R_UPARM = .046, R_FORE = .04, R_HEAD = .078;

/* 由姿态生成骨架（局部坐标） */
function buildSkeleton3D(s) {
  const p = actionPose(s.action, s.phase);
  const T = (p.torso || 0) * DEG;
  const st = .085, sa = .105;
  const hipW = .48 + (p.rootY || 0);
  const hipU = 0;
  const neckU = hipU + Math.sin(T) * .38, neckW = hipW + Math.cos(T) * .38;
  const headU = hipU + Math.sin(T) * .485, headW = hipW + Math.cos(T) * .485;
  const J = (u, v, w) => ({ u: u, v: v, w: w });

  function leg(hipDeg, kneeDeg, v) {
    const kU = hipU + Math.sin(hipDeg * DEG) * .25, kW = hipW - Math.cos(hipDeg * DEG) * .25;
    const aU = kU + Math.sin(kneeDeg * DEG) * .23, aW = kW - Math.cos(kneeDeg * DEG) * .23;
    return { hip: J(hipU, v, hipW), knee: J(kU, v, kW), ank: J(aU, v, aW) };
  }
  function arm(shDeg, elDeg, v) {
    const eU = neckU + Math.sin(shDeg * DEG) * .18, eW = neckW - Math.cos(shDeg * DEG) * .18;
    const hU = eU + Math.sin(elDeg * DEG) * .17, hW = eW - Math.cos(elDeg * DEG) * .17;
    return { sh: J(neckU, v, neckW), elb: J(eU, v, eW), hand: J(hU, v, hW) };
  }

  const L = leg(p.hipL, p.kneeL, -st), R = leg(p.hipR, p.kneeR, st);
  const AL = arm(p.shL, p.elL, -sa), AR = arm(p.shR, p.elR, sa);
  const hip = J(hipU, 0, hipW), neck = J(neckU, 0, neckW);

  const segs = [];
  const add = (a, b, r) => segs.push({ a: a, b: b, r: r });
  add(L.hip, L.knee, R_THIGH); add(L.knee, L.ank, R_SHIN);
  add(R.hip, R.knee, R_THIGH); add(R.knee, R.ank, R_SHIN);
  add(hip, neck, R_TORSO);
  add(AL.sh, AL.elb, R_UPARM); add(AL.elb, AL.hand, R_FORE);
  add(AR.sh, AR.elb, R_UPARM); add(AR.elb, AR.hand, R_FORE);

  /* ---- 朝向标记 ----
     躯干和四肢都是**圆柱**，绕自身轴转一圈轮廓不变；头是个球。
     所以不加东西的话，正脸、后背、侧面在 3D 里长得一模一样 ——
     这就是「3D 看不出人物朝向」的根因。下面这几件都挂在局部坐标里，
     跟着角色朝向一起转，于是轮廓本身带上了方向：
       ① 肩线：躯干上横着一条，轮廓从「一根柱子」变成「头+肩+身」的 T 形；
       ② 脚尖：脚踝往前伸一小截，贴地、缩小时也看得见；
       ③ 鼻尖：头前面凸一个球，侧面看就是侧脸剪影；
       ④ 两眼：只有正脸朝镜头时才画（见 drawChar3D），背对时自然消失。 */
  add(J(neckU, -sa, neckW - .008), J(neckU, sa, neckW - .008), R_TORSO * .60);
  add(L.ank, J(L.ank.u + .062, L.ank.v, L.ank.w), R_SHIN * .60);
  add(R.ank, J(R.ank.u + .062, R.ank.v, R.ank.w), R_SHIN * .60);

  return {
    segs: segs,
    head: { p: J(headU, 0, headW), r: R_HEAD },
    nose: { a: J(headU + .030, 0, headW - .008), b: J(headU + .112, 0, headW - .012), r: R_HEAD * .40 },
    eyes: [J(headU + .066, -.033, headW + .020), J(headU + .066, .033, headW + .020)],
    pose: p,
  };
}

/* 局部坐标 -> 世界（含前倒旋转、整体位移、身高缩放） */
function makeLocal2World(ch, s, pm) {
  const p = actionPose(s.action, s.phase);
  const rot = (p.rootRot || 0) * DEG;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const rootX = p.rootX || 0;
  const a = s.angle;
  const f = { x: Math.sin(a), y: -Math.cos(a) };
  const rt = { x: Math.cos(a), y: Math.sin(a) };
  const k = ch.height / 1.035 * pm;
  const bx = s.x, by = s.y;
  return function (q) {
    const u = q.u * cr + q.w * sr + rootX;
    const w = -q.u * sr + q.w * cr;
    return { x: bx + (u * f.x + q.v * rt.x) * k, y: by + (u * f.y + q.v * rt.y) * k, z: w * k };
  };
}

/* 圆柱段：投影成四边形，用横向渐变模拟圆柱受光 */
function drawSeg3(ctx, B, A, C, rPx, color) {
  const pa = projPt(B, A.x, A.y, A.z);
  const pb = projPt(B, C.x, C.y, C.z);
  if (!pa || !pb) return;
  const wa = Math.max(.6, rPx * B.fpx / pa.f);
  const wb = Math.max(.6, rPx * B.fpx / pb.f);
  const dx = pb.x - pa.x, dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(pa.x + nx * wa, pa.y + ny * wa);
  ctx.lineTo(pb.x + nx * wb, pb.y + ny * wb);
  ctx.lineTo(pb.x - nx * wb, pb.y - ny * wb);
  ctx.lineTo(pa.x - nx * wa, pa.y - ny * wa);
  ctx.closePath();
  const g = ctx.createLinearGradient(pa.x + nx * wa, pa.y + ny * wa, pa.x - nx * wa, pa.y - ny * wa);
  g.addColorStop(0, shade(color, 1.26));
  g.addColorStop(.42, shade(color, 1.02));
  g.addColorStop(1, shade(color, .66));
  ctx.fillStyle = g;
  ctx.fill();
}

/* 地面上的圆（用于投影/落脚点），投影成正多边形 */
function groundDisc(ctx, B, cx, cy, r, fill, stroke, lw) {
  ctx.beginPath();
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const a = i / N * TAU;
    const q = projPt(B, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
    if (!q) return;
    if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}

/* 画一个立体人物 */
function drawChar3D(ctx, B, ch, s, W, H, alpha) {
  const pm = App.state.pxPerMeter;
  const sk = buildSkeleton3D(s);
  const toW = makeLocal2World(ch, s, pm);
  const foot = toW({ u: 0, v: 0, w: 0 });
  const f = (foot.x - B.cam.x) * B.fwd.x + (foot.y - B.cam.y) * B.fwd.y + (foot.z - B.cam.z) * B.fwd.z;
  if (f <= .25) return;

  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;

  /* 地面投影 */
  const shR = ch.width * pm * .62;
  groundDisc(ctx, B, s.x, s.y, shR, 'rgba(24,34,54,.26)', null, 0);
  groundDisc(ctx, B, s.x, s.y, shR * 1.12, null, ch.color, 1);

  /* 段按深度从远到近 */
  const list = [];
  for (const sg of sk.segs) {
    const A = toW(sg.a), C = toW(sg.b);
    const fa = (A.x - B.cam.x) * B.fwd.x + (A.y - B.cam.y) * B.fwd.y + (A.z - B.cam.z) * B.fwd.z;
    const fb = (C.x - B.cam.x) * B.fwd.x + (C.y - B.cam.y) * B.fwd.y + (C.z - B.cam.z) * B.fwd.z;
    if (fa <= .2 && fb <= .2) continue;
    list.push({ A: A, C: C, r: sg.r * (ch.height / 1.035 * pm), f: (fa + fb) / 2 });
  }
  const hp = toW(sk.head.p);
  const hf = (hp.x - B.cam.x) * B.fwd.x + (hp.y - B.cam.y) * B.fwd.y + (hp.z - B.cam.z) * B.fwd.z;
  list.sort((a, b) => b.f - a.f);
  for (const it of list) drawSeg3(ctx, B, it.A, it.C, it.r, ch.color);

  const k = ch.height / 1.035 * pm;
  const fdir = dirVec(s.angle);

  /* 鼻尖：先比深度再决定画在头**前**还是头**后** ——
     不这么做的话，背对镜头时鼻尖会「穿」到脸前面来，反倒把朝向说反了。 */
  const na = toW(sk.nose.a), nb = toW(sk.nose.b);
  const nf = (na.x - B.cam.x) * B.fwd.x + (na.y - B.cam.y) * B.fwd.y + (na.z - B.cam.z) * B.fwd.z;
  const noseBehind = nf > hf;
  const drawNose = () => { if (nf > .2) drawSeg3(ctx, B, na, nb, sk.nose.r * k, shade(ch.color, 1.16)); };

  if (noseBehind) drawNose();

  if (hf > .2) {
    const p = projPt(B, hp.x, hp.y, hp.z);
    if (p) {
      const rr = Math.max(1.2, sk.head.r * k * B.fpx / hf);
      const g = ctx.createRadialGradient(p.x - rr * .35, p.y - rr * .35, rr * .1, p.x, p.y, rr);
      g.addColorStop(0, shade(ch.color, 1.34));
      g.addColorStop(.6, ch.color);
      g.addColorStop(1, shade(ch.color, .7));
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      if (!noseBehind) drawNose();

      /* 两眼：只在「正脸朝着镜头」时画。
         朝向与镜头前向的点积 < 0 即朝着镜头；拿它的负值当淡入量，
         侧脸（±90°）自然淡出，不用再写一套侧面逻辑。 */
      const cph = Math.hypot(B.fwd.x, B.fwd.y) || 1;
      const eyeA = clamp(-(fdir.x * B.fwd.x + fdir.y * B.fwd.y) / cph * 1.7, 0, 1);
      if (eyeA > .02) {
        ctx.save();
        ctx.globalAlpha *= eyeA;
        const er = Math.max(.8, rr * .27);
        ctx.fillStyle = shade(ch.color, .26);
        for (const e of sk.eyes) {
          const w = toW(e);
          const q = projPt(B, w.x, w.y, w.z);
          if (!q) continue;
          ctx.beginPath();
          ctx.arc(q.x, q.y, er, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
  ctx.restore();
}
