'use strict';
/* ============================================================
   templates.js — 示例背景生成 / 走位模板 / 运镜模板 / 示例场景
   ============================================================ */

/* ---------------- 示例背景（俯视平面图） ---------------- */
function gridOverlay(g, W, H, pm) {
  g.save();
  g.strokeStyle = 'rgba(90,110,140,.10)';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += pm) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
  for (let y = 0; y <= H; y += pm) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }
  g.strokeStyle = 'rgba(90,110,140,.18)';
  for (let x = 0; x <= W; x += pm * 5) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
  for (let y = 0; y <= H; y += pm * 5) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }
  g.restore();
}
function drawBlock(g, x, y, w, h, label, fill) {
  g.save();
  g.fillStyle = 'rgba(70,90,120,.13)';
  g.fillRect(x + 8, y + 10, w, h);
  g.fillStyle = fill || '#f7f9fc';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#aab5c6'; g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
  if (label) {
    g.fillStyle = '#8b96a8';
    g.font = '600 26px "Microsoft YaHei",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2);
  }
  g.restore();
}
function drawTree(g, x, y, r) {
  g.save();
  g.fillStyle = 'rgba(70,90,120,.13)'; g.beginPath(); g.arc(x + 5, y + 6, r, 0, TAU); g.fill();
  g.fillStyle = '#cfe3c4'; g.strokeStyle = '#8fb87c'; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
  g.restore();
}
function drawRoad(g, x, y, w, h, vertical, dashes) {
  g.save();
  g.fillStyle = '#d3dae4'; g.fillRect(x, y, w, h);
  g.fillStyle = '#e2e7ee';
  if (vertical) { g.fillRect(x - 16, y, 16, h); g.fillRect(x + w, y, 16, h); }
  else { g.fillRect(x, y - 16, w, 16); g.fillRect(x, y + h, w, 16); }
  if (dashes) {
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.setLineDash([26, 22]);
    g.beginPath();
    if (vertical) { g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); }
    else { g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); }
    g.stroke(); g.setLineDash([]);
  }
  g.restore();
}

function makeSampleBg(kind) {
  const W = 1920, H = 1080, pm = 50;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');

  if (kind === 'plaza') {
    g.fillStyle = '#eaeef3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e0e6ee'; g.beginPath(); g.arc(W / 2, H / 2, 430, 0, TAU); g.fill();
    g.strokeStyle = '#c6cfdc'; g.lineWidth = 3;
    for (let r = 430; r > 90; r -= 85) { g.beginPath(); g.arc(W / 2, H / 2, r, 0, TAU); g.stroke(); }
    g.fillStyle = '#cfe0ee'; g.strokeStyle = '#9fbcd4'; g.lineWidth = 3;
    g.beginPath(); g.arc(W / 2, H / 2, 92, 0, TAU); g.fill(); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 46, 0, TAU); g.fillStyle = '#bcd7ea'; g.fill(); g.stroke();
    for (const a of [0, 1, 2, 3, 4, 5]) {
      const th = a * TAU / 6;
      drawTree(g, W / 2 + Math.cos(th) * 250, H / 2 + Math.sin(th) * 250, 24);
    }
    drawBlock(g, 120, 120, 420, 200, '看台');
    drawBlock(g, 1380, 120, 420, 200, '后台');
    drawBlock(g, 120, 780, 380, 190, '器材区');
    drawBlock(g, 1420, 780, 380, 190, '出入口');
    gridOverlay(g, W, H, pm);
    return c.toDataURL('image/png');
  }

  g.fillStyle = '#e9edf2'; g.fillRect(0, 0, W, H);
  drawRoad(g, 0, 430, W, 250, false, true);
  drawRoad(g, 780, 0, 250, H, true, true);
  g.save();
  g.fillStyle = 'rgba(255,255,255,.85)';
  for (let i = 0; i < 7; i++) { g.fillRect(0, 448 + i * 34, 90, 20); g.fillRect(1130, 448 + i * 34, 90, 20); }
  for (let i = 0; i < 7; i++) { g.fillRect(798 + i * 34, 0, 20, 90); g.fillRect(798 + i * 34, 990, 20, 90); }
  g.restore();
  drawBlock(g, 130, 130, 520, 210, '仓库 A');
  drawBlock(g, 1180, 130, 560, 230, '厂房');
  drawBlock(g, 140, 790, 500, 200, '楼宇');
  drawBlock(g, 1200, 800, 540, 190, '停车区');
  drawTree(g, 700, 180, 26); drawTree(g, 700, 860, 26);
  drawTree(g, 1120, 620, 26); drawTree(g, 340, 620, 26);
  g.save();
  g.fillStyle = '#e6d9c4'; g.strokeStyle = '#b9a686'; g.lineWidth = 2;
  g.fillRect(1140, 600, 46, 46); g.strokeRect(1140, 600, 46, 46);
  g.fillRect(1196, 600, 46, 46); g.strokeRect(1196, 600, 46, 46);
  g.restore();
  gridOverlay(g, W, H, pm);
  return c.toDataURL('image/png');
}

/* ---------------- 走位模板（返回路径点数组） ---------------- */
function bezierPath(p0, p1, bow, n) {
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / L) * bow, cy = my + (dx / L) * bow;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * cx + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * cy + t * t * p1.y,
    });
  }
  return pts;
}

const MOVE_TEMPLATES = [
  {
    id: 'line', label: '直线前进', dur: 2.5,
    make: (ch, pm) => {
      const f = dirVec(ch.angle), d = 5 * pm;
      return [{ x: ch.x, y: ch.y }, { x: ch.x + f.x * d, y: ch.y + f.y * d }];
    },
  },
  {
    id: 'back', label: '后退', dur: 2,
    make: (ch, pm) => {
      const f = dirVec(ch.angle), d = 3.5 * pm;
      return [{ x: ch.x, y: ch.y }, { x: ch.x - f.x * d, y: ch.y - f.y * d }];
    },
  },
  {
    id: 'side', label: '横向平移', dur: 2,
    make: (ch, pm) => {
      const f = dirVec(ch.angle), r = { x: -f.y, y: f.x }, d = 3.5 * pm;
      return [{ x: ch.x, y: ch.y }, { x: ch.x + r.x * d, y: ch.y + r.y * d }];
    },
  },
  {
    id: 'zigzag', label: '折线突进', dur: 3,
    make: (ch, pm) => {
      const f = dirVec(ch.angle), r = { x: -f.y, y: f.x };
      const P = (a, b) => ({ x: ch.x + f.x * a * pm + r.x * b * pm, y: ch.y + f.y * a * pm + r.y * b * pm });
      return [P(0, 0), P(2.2, 1.6), P(4.4, -1.4), P(6.5, 1.1)];
    },
  },
  {
    id: 'arc', label: '弧线绕行', dur: 3,
    make: (ch, pm) => {
      const f = dirVec(ch.angle), d = 6 * pm;
      return bezierPath({ x: ch.x, y: ch.y }, { x: ch.x + f.x * d, y: ch.y + f.y * d }, 2.6 * pm, 6);
    },
  },
  {
    id: 'circle', label: '环绕一圈', dur: 4,
    /* 返回 {path, arc}：arc 是圆心，让求值层知道这条折线其实是一段圆弧。
       12 个点的内接十二边形，段中点到圆心少 3.4% —— 半径误差还只是小问题；
       真正明显的是**朝向**：路径朝向原来按弦方向算，而弦和切线差半个圆心角
       （15°），角色会一边走一边来回摆 15°。 */
    make: (ch, pm) => {
      const f = dirVec(ch.angle), R = 3 * pm;
      const cx = ch.x + f.x * R, cy = ch.y + f.y * R;
      const a0 = Math.atan2(ch.y - cy, ch.x - cx);
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = a0 + TAU * (i / 12);
        pts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
      }
      return { path: pts, arc: { cx: cx, cy: cy } };
    },
  },
];

/* 走位模板的 make() 有两种返回形式：
     点数组（直线 / 折线 / 贝塞尔…），或 { path, arc }（环绕类，多带一个圆心）。
   调用方一律先过这里，免得每个调用点都写一遍 Array.isArray 判断。 */
function moveSpec(t, ch, pm) {
  const r = t.make(ch, pm);
  return Array.isArray(r)
    ? { path: r, arc: null }
    : { path: (r && r.path) || [], arc: (r && r.arc) || null };
}

/* ---------------- 运镜模板 ----------------
   make(cam, s, t0, d, o) 里：
     cam   摄像机对象
     s     当前时刻的相机状态（evalCam(o, App.time) 的结果）
     t0    起始时间    d 模板时长
     o     { pm: 像素/米, target: 选中角色的世界坐标|null, targetId }
   返回 { keys: [...] }；跟随类额外返回 { follow: {...} }。
   cat 决定左侧面板分组。 */
function mkKey(t, s, over) {
  return Object.assign({
    id: uid('kk'), t: t, x: s.x, y: s.y, angle: s.angle,
    pitch: s.pitch, height: s.height, fov: s.fov, ease: 'inout',
  }, over || {});
}
function lookAtAngle(from, to) { return angOf(to.x - from.x, to.y - from.y); }
/* 没选角色时，拿「镜头正前方 6m」当临时主体，模板照样能用 */
function tgtOrAhead(s, o, m) {
  const f = dirVec(s.angle), L = (m || 5) * o.pm;
  const ahead = { x: s.x + f.x * L, y: s.y + f.y * L };
  /* 主体不能是「镜头自己」。orbit / spiralIn / arcRise 都是以主体为圆心的，
     圆心一旦贴在镜头上，就退化成绕自己转一个几十像素的小圈 —— 画面上
     几乎看不出在动，用户会以为「这个运镜没生效」。
     实测模型在场上没有角色时，会把机位自己的名字填进 target，
     所以这里兜一道：主体离镜头不到半米，就当没给，退回镜头正前方。 */
  if (!o.target) return ahead;
  if (dist({ x: s.x, y: s.y }, o.target) < .5 * o.pm) return ahead;
  return o.target;
}
/* 推轨变焦的关键：主体在画面里的大小 ∝ 1 / (tan(fov/2) · 距离)。
   要锁住主体大小，就得让 tan(fov/2) 随距离反比变 —— 不能按角度等比缩放，
   小角度近似在这里会差出好几倍（实测 45° 推近一半距离，等比算出 22.5°，
   实际该给 79°，主体反而胀了 3.8 倍）。 */
function fovForDist(fov, d0, d1) {
  const half = Math.tan(clamp(fov, 8, 120) * DEG / 2);
  return clamp(2 * Math.atan(half * (d0 / d1)) * RAD, 12, 110);
}

const CAM_TEMPLATES = [
  {
    id: 'static', label: '固定镜头', dur: 2, cat: '基础',
    tip: '清除该时间点之后的关键帧，保持不动',
    make: () => ({ keys: [] }),
  },
  {
    id: 'panR', label: '横摇 45°→', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d) => ({ keys: [mkKey(t0, s), mkKey(t0 + d, s, { angle: s.angle + 45 * DEG })] }),
  },
  {
    id: 'panL', label: '横摇 45°←', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d) => ({ keys: [mkKey(t0, s), mkKey(t0 + d, s, { angle: s.angle - 45 * DEG })] }),
  },
  {
    id: 'dollyIn', label: '推进', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d, o) => {
      const f = dirVec(s.angle), L = 3 * o.pm;
      return { keys: [mkKey(t0, s), mkKey(t0 + d, s, { x: s.x + f.x * L, y: s.y + f.y * L })] };
    },
  },
  {
    id: 'dollyOut', label: '拉远', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d, o) => {
      const f = dirVec(s.angle), L = 3 * o.pm;
      return { keys: [mkKey(t0, s), mkKey(t0 + d, s, { x: s.x - f.x * L, y: s.y - f.y * L })] };
    },
  },
  {
    id: 'truck', label: '横移跟拍', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d, o) => {
      const f = dirVec(s.angle), r = { x: -f.y, y: f.x }, L = 3 * o.pm;
      return { keys: [mkKey(t0, s), mkKey(t0 + d, s, { x: s.x + r.x * L, y: s.y + r.y * L })] };
    },
  },
  {
    id: 'tilt', label: '俯仰', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d) => ({ keys: [mkKey(t0, s), mkKey(t0 + d, s, { pitch: 45 * DEG })] }),
  },
  {
    id: 'zoom', label: '变焦推近', dur: 2.5, cat: '基础',
    make: (cam, s, t0, d) => ({ keys: [mkKey(t0, s), mkKey(t0 + d, s, { fov: Math.max(20, s.fov * .45) })] }),
  },
  {
    id: 'snapZoom', label: '急推', dur: .45, cat: '基础',
    tip: '极快的变焦推近，用来强调一个反应',
    make: (cam, s, t0, d) => ({
      keys: [mkKey(t0, s), mkKey(t0 + d, s, { fov: clamp(s.fov * .4, 12, 90), ease: 'out' })],
    }),
  },
  {
    id: 'whip', label: '甩镜', dur: .35, cat: '基础',
    make: (cam, s, t0, d) => ({ keys: [mkKey(t0, s), mkKey(t0 + d, s, { angle: s.angle + 140 * DEG })] }),
  },

  /* -------- 跟随 / 环绕 -------- */
  {
    id: 'follow', label: '跟随角色', dur: 2, follow: true, cat: '跟随环绕',
    tip: '摄像机自动跟在选中角色身后并看向目标',
    make: (cam, s, t0, d, o) => ({
      keys: [],
      follow: o.targetId ? { targetId: o.targetId, dist: 4, height: 1.8, side: 0 } : null,
    }),
  },
  {
    id: 'overShoulder', label: '越肩', dur: 2, follow: true, cat: '跟随环绕',
    tip: '贴到角色肩后（对话戏的经典机位）',
    make: (cam, s, t0, d, o) => ({
      keys: [],
      follow: o.targetId ? { targetId: o.targetId, dist: 2.4, height: 1.75, side: .7 } : null,
    }),
  },
  {
    id: 'orbit', label: '环绕一圈', dur: 4, cat: '跟随环绕',
    tip: '以主体为圆心绕满一整圈（360°）',
    make: (cam, s, t0, d, o) => {
      const tgt = tgtOrAhead(s, o, 4);
      const R = Math.max(.8 * o.pm, dist({ x: s.x, y: s.y }, tgt));
      const a0 = Math.atan2(s.y - tgt.y, s.x - tgt.x);
      /* arc 把圆心告诉求值层：相邻两键之间走**圆弧**而不是弦。
         没有它的话 9 个键连出来是内接八边形 —— 段中点离主体只有 0.924R，
         镜头忽远忽近、主体在画面里大小脉动 7.6%，路线本身也是折的。
         ease 必须是 linear：每段都给 inout 的话，一圈里会**一冲一停八次**。
         注意 arc 要在循环里**每个键各建一个** —— 共用一个对象的话，
         整体平移（camMove）会把同一个圆心累加 N 次。 */
      const N = 8, keys = [];
      for (let i = 0; i <= N; i++) {
        const a = a0 + TAU * (i / N);
        const px = tgt.x + Math.cos(a) * R, py = tgt.y + Math.sin(a) * R;
        keys.push(mkKey(t0 + d * (i / N), s, {
          x: px, y: py, angle: lookAtAngle({ x: px, y: py }, tgt),
          arc: { cx: tgt.x, cy: tgt.y }, ease: 'linear',
        }));
      }
      return { keys: keys };
    },
  },
  {
    id: 'spiralIn', label: '螺旋环绕推进', dur: 4, cat: '跟随环绕',
    tip: '以主体为轴边绕边靠近，压迫感强',
    make: (cam, s, t0, d, o) => {
      const tgt = tgtOrAhead(s, o, 5);
      const R0 = Math.max(2 * o.pm, dist({ x: s.x, y: s.y }, tgt));
      const a0 = Math.atan2(s.y - tgt.y, s.x - tgt.x);
      /* 半径两端不同 —— arcPoint 会自己按 e 插值半径，所以螺旋也是光滑的弧。
         arc 每个键各建一个（共用对象会让整体平移把圆心累加 N 次）。 */
      const N = 12, keys = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const a = a0 + TAU * k;
        const R = R0 * (1 - .55 * k);
        const px = tgt.x + Math.cos(a) * R, py = tgt.y + Math.sin(a) * R;
        keys.push(mkKey(t0 + d * k, s, {
          x: px, y: py, angle: lookAtAngle({ x: px, y: py }, tgt),
          height: Math.max(.9, s.height - .6 * k),
          fov: clamp(s.fov * (1 + .45 * k), 12, 100),
          arc: { cx: tgt.x, cy: tgt.y }, ease: 'linear',
        }));
      }
      return { keys: keys };
    },
  },
  {
    id: 'arcRise', label: '弧形上升', dur: 3.5, cat: '跟随环绕',
    tip: '边绕边升起并后退，常用于收尾拉出全景',
    make: (cam, s, t0, d, o) => {
      const tgt = tgtOrAhead(s, o, 5);
      const R0 = Math.max(2 * o.pm, dist({ x: s.x, y: s.y }, tgt));
      const a0 = Math.atan2(s.y - tgt.y, s.x - tgt.x);
      const N = 6, keys = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const a = a0 + Math.PI * .7 * k;
        const R = R0 * (1 + .55 * k);
        const px = tgt.x + Math.cos(a) * R, py = tgt.y + Math.sin(a) * R;
        keys.push(mkKey(t0 + d * k, s, {
          x: px, y: py, angle: lookAtAngle({ x: px, y: py }, tgt),
          height: s.height + 4.5 * k,
          pitch: lerp(s.pitch, Math.max(s.pitch, 26 * DEG), k),
          fov: clamp(s.fov * (1 - .12 * k), 12, 100),
          arc: { cx: tgt.x, cy: tgt.y }, ease: 'linear',
        }));
      }
      return { keys: keys };
    },
  },

  /* -------- 大片手感 -------- */
  {
    id: 'dollyZoom', label: '希区柯克变焦', dur: 3, cat: '大片',
    tip: '推近的同时放大视角：主体大小不变，背景被抽走（眩晕效果）',
    make: (cam, s, t0, d, o) => {
      const a = o.target ? lookAtAngle({ x: s.x, y: s.y }, o.target) : s.angle;
      const f = dirVec(a);
      const tgt = tgtOrAhead({ x: s.x, y: s.y, angle: a }, o, 6);
      const d0 = Math.max(1.5 * o.pm, dist({ x: s.x, y: s.y }, tgt));
      const move = Math.min(3 * o.pm, d0 * .35);
      const d1 = d0 - move;
      return {
        keys: [
          mkKey(t0, s, { angle: a }),
          mkKey(t0 + d, s, {
            x: s.x + f.x * move, y: s.y + f.y * move, angle: a,
            fov: fovForDist(s.fov, d0, d1),
          }),
        ],
      };
    },
  },
  {
    id: 'dollyZoomRev', label: '希区柯克变焦（反向）', dur: 3, cat: '大片',
    tip: '后退的同时收窄视角：主体大小不变，背景反而被推近',
    make: (cam, s, t0, d, o) => {
      const a = o.target ? lookAtAngle({ x: s.x, y: s.y }, o.target) : s.angle;
      const f = dirVec(a);
      const tgt = tgtOrAhead({ x: s.x, y: s.y, angle: a }, o, 6);
      const d0 = Math.max(1.5 * o.pm, dist({ x: s.x, y: s.y }, tgt));
      const move = Math.min(3 * o.pm, d0 * .5);
      const d1 = d0 + move;
      return {
        keys: [
          mkKey(t0, s, { angle: a }),
          mkKey(t0 + d, s, {
            x: s.x - f.x * move, y: s.y - f.y * move, angle: a,
            fov: fovForDist(s.fov, d0, d1),
          }),
        ],
      };
    },
  },
  {
    id: 'heroLow', label: '低角度仰拍', dur: 2.5, cat: '大片',
    tip: '机位降到膝盖高度、镜头上仰，人物显得高大',
    make: (cam, s, t0, d) => ({
      keys: [
        mkKey(t0, s),
        mkKey(t0 + d, s, { height: .55, pitch: -5 * DEG, fov: clamp(s.fov * .82, 12, 90) }),
      ],
    }),
  },
  {
    id: 'topDown', label: '顶视俯拍', dur: 2.5, cat: '大片',
    tip: '升到高空近乎垂直向下拍，上帝视角',
    make: (cam, s, t0, d, o) => {
      const a = o.target ? lookAtAngle({ x: s.x, y: s.y }, o.target) : s.angle;
      const px = o.target ? lerp(s.x, o.target.x, .6) : s.x;
      const py = o.target ? lerp(s.y, o.target.y, .6) : s.y;
      return {
        keys: [
          mkKey(t0, s),
          mkKey(t0 + d, s, { x: px, y: py, angle: a, height: 14, pitch: 82 * DEG, fov: clamp(s.fov * .9, 12, 90) }),
        ],
      };
    },
  },
  {
    id: 'crane', label: '升降', dur: 3, cat: '大片',
    make: (cam, s, t0, d) => ({
      keys: [mkKey(t0, s), mkKey(t0 + d, s, { height: Math.max(4.5, s.height + 3), pitch: Math.max(s.pitch, 22 * DEG) })],
    }),
  },
  {
    id: 'craneDown', label: '摇臂下降', dur: 3, cat: '大片',
    tip: '从高处缓缓降下，落到与人物平视',
    make: (cam, s, t0, d, o) => {
      const a = o.target ? lookAtAngle({ x: s.x, y: s.y }, o.target) : s.angle;
      return {
        keys: [
          mkKey(t0, s, { angle: a, height: Math.max(6.5, s.height + 5), pitch: Math.max(26 * DEG, s.pitch + 16 * DEG) }),
          mkKey(t0 + d, s, { angle: a, height: Math.max(1.2, s.height), pitch: s.pitch }),
        ],
      };
    },
  },
  {
    id: 'handheld', label: '手持晃动', dur: 3, cat: '大片',
    tip: '轻微无规律抖动，纪实质感（同一段每次生成都一样）',
    make: (cam, s, t0, d, o) => {
      const N = 10, keys = [];
      let seed = 20260925;
      /* 固定种子的伪随机 —— 模板必须可复现，不能用 Math.random */
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5; };
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const amp = Math.sin(Math.PI * k);            // 两头稳、中间晃
        const f = dirVec(s.angle), r = { x: -f.y, y: f.x };
        const j1 = rnd() * .13 * o.pm * amp, j2 = rnd() * .13 * o.pm * amp;
        keys.push(mkKey(t0 + d * k, s, {
          x: s.x + r.x * j1 + f.x * j2, y: s.y + r.y * j1 + f.y * j2,
          angle: s.angle + rnd() * 2.4 * DEG * amp,
          pitch: s.pitch + rnd() * 1.6 * DEG * amp,
          height: Math.max(.3, s.height + rnd() * .06 * amp),
        }));
      }
      return { keys: keys };
    },
  },
];

const CAM_CATS = ['基础', '跟随环绕', '大片', '其他'];

/* ---------------- 示例场景 ---------------- */
function buildDemoScene() {
  const st = App.state;
  const pm = st.pxPerMeter;
  st.duration = 8;
  st.objects = [];

  const A = createChar(430, 800, 1);
  A.name = '角色A'; A.color = '#e5484d';
  A.clips.push({
    id: uid('cp'), kind: 'move', start: 0, dur: 3.6, ease: 'inout',
    path: [{ x: 430, y: 800 }, { x: 780, y: 700 }, { x: 1120, y: 520 }],
  });
  A.clips.push({ id: uid('cp'), kind: 'action', start: 0, dur: 2, action: 'walk', loop: true, hold: false });
  A.clips.push({ id: uid('cp'), kind: 'action', start: 2, dur: 1.6, action: 'combo', loop: true, hold: false });
  A.clips.push({ id: uid('cp'), kind: 'action', start: 3.9, dur: .8, action: 'highKick', loop: false, hold: false });
  A.clips.push({ id: uid('cp'), kind: 'action', start: 5.4, dur: 1.5, action: 'celebrate', loop: true, hold: false });

  const B = createChar(1360, 470, 2);
  B.name = '角色B'; B.color = '#2b6cf6';
  B.angle = angOf(-1, 0);
  B.clips.push({ id: uid('cp'), kind: 'action', start: 0, dur: 2, action: 'idle', loop: true, hold: false });
  B.clips.push({ id: uid('cp'), kind: 'action', start: 2.2, dur: .5, action: 'guard', loop: false, hold: true });
  B.clips.push({ id: uid('cp'), kind: 'action', start: 4.3, dur: 1.1, action: 'knockdown', loop: false, hold: true });

  const K = createCam(560, 1010, 1);
  K.name = '机位1'; K.height = 1.7; K.fov = 46; K.pitch = 11 * DEG;
  const look = (pos, tgt, t, over) => mkKey(t, { x: pos.x, y: pos.y, angle: lookAtAngle(pos, tgt), pitch: K.pitch, height: K.height, fov: K.fov }, over);
  K.keys = [
    look({ x: 560, y: 1010 }, { x: 470, y: 790 }, 0, { height: 1.7, fov: 46 }),
    look({ x: 700, y: 950 }, { x: 900, y: 610 }, 3.6, { height: 1.7, fov: 44 }),
    look({ x: 900, y: 880 }, { x: 1180, y: 490 }, 5.2, { height: 1.55, fov: 36 }),
    look({ x: 900, y: 880 }, { x: 1200, y: 480 }, 8, { height: 1.55, fov: 36 }),
  ];

  st.objects.push(A, B, K);
  st.activeCam = K.id;
  App.sel = { kind: 'char', id: A.id };
}
