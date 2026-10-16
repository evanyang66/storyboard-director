'use strict';
/* ============================================================
   actions.js — 火柴人姿态库 + 骨架绘制
   姿态角度单位：度。0° = 竖直向下；正值 = 朝角色面朝方向摆动。
   角度含义：hip / knee / sh / el 都是「相对竖直向下的绝对角」，
   躯干 torso：0 = 直立，正值 = 前倾。
   rootY：整体升降（正=向上）；rootX：整体横向偏移；rootRot：整体绕脚点旋转（正=向前倒）
   ============================================================ */

function basePose(o) {
  return Object.assign({
    hipL: 3, kneeL: 0, hipR: -3, kneeR: 0,
    shL: 6, elL: 14, shR: -6, elR: -14,
    torso: 2, rootY: 0, rootX: 0, rootRot: 0,
  }, o || {});
}

/* ---------------- 姿态工具 ----------------
   骨架各段长度：大腿 .25 / 小腿 .23 / 上臂 .18 / 前臂 .17，
   髋高 .48、躯干 .38、头心 .105。
   下面几个小函数把「想让脚踩在地上」从手感换算成 rootY ——
   腿一弯，髋就得跟着降，否则脚会浮起来或陷进地面。 */
function legDrop(hip, knee) { return .25 * Math.cos(hip * DEG) + .23 * Math.cos(knee * DEG); }
/* 让「最沉的那条腿」正好踩地。用 max 而不是平均值：平均会让深的那条腿陷进地面，
   浅的那条稍微浮一点反而看不出来。落地类动作一律用它。 */
function groundY(hipL, kneeL, hipR, kneeR) {
  return Math.max(legDrop(hipL, kneeL), legDrop(hipR, kneeR)) - .48;
}
/* 格斗站架：左脚在前、右脚在后。两条腿的下探量调成相等，双脚才都踩实 */
const STANCE = { hipL: 16, kneeL: -18, hipR: -14, kneeR: -20 };
const STANCE_Y = groundY(STANCE.hipL, STANCE.kneeL, STANCE.hipR, STANCE.kneeR);
/* 出拳：e=0 收拳护颌，e=1 直拳打满（肩肘都到 92°，手臂水平前伸） */
function punchArm(e) { return { sh: lerp(12, 92, e), el: lerp(168, 92, e) }; }
/* 手举到脸侧（打电话 / 掩面 / 托腮）。这个单平面骨架里，肘必须落在肩前方
   才能让手折回脸侧 —— 这是唯一成立的解，不是随手取的数。 */
const FACE_ARM = { sh: 95, el: -130 };

/* ============================================================
   动作库
   cat 决定左侧面板里的分组；dur 单位秒；loop 循环；hold 播完停在终态。
   ============================================================ */
const ACTIONS = {

  /* ---------------- 基础 ---------------- */
  idle: {
    label: '站立待机', dur: 2, loop: true, hold: false, cat: '基础',
    pose: p => {
      const w = TAU * p, s = Math.sin(w);
      return basePose({
        hipL: 3 + 2 * s, hipR: -3 - 2 * s,
        shL: 7 + 4 * s, elL: 14 + 4 * s, shR: -7 - 4 * s, elR: -14 - 4 * s,
        torso: 2 + 1.2 * s, rootY: .006 * Math.sin(w * 2),
      });
    },
  },
  walk: {
    label: '走路', dur: 2, loop: true, hold: false, cat: '基础',
    pose: p => {
      const w = TAU * p;
      const hipL = 24 * Math.sin(w), hipR = 24 * Math.sin(w + Math.PI);
      return basePose({
        hipL: hipL, kneeL: hipL - 14 - 28 * Math.max(0, Math.sin(w - .9)),
        hipR: hipR, kneeR: hipR - 14 - 28 * Math.max(0, Math.sin(w + Math.PI - .9)),
        shL: -22 * Math.sin(w), elL: -22 * Math.sin(w) + 26,
        shR: -22 * Math.sin(w + Math.PI), elR: -22 * Math.sin(w + Math.PI) + 26,
        torso: 5, rootY: .014 * Math.abs(Math.sin(w)) - .007,
      });
    },
  },
  run: {
    label: '奔跑', dur: 1.2, loop: true, hold: false, cat: '基础',
    pose: p => {
      const w = TAU * p;
      const hipL = 44 * Math.sin(w), hipR = 44 * Math.sin(w + Math.PI);
      return basePose({
        hipL: hipL, kneeL: hipL - 26 - 48 * Math.max(0, Math.sin(w - 1.1)),
        hipR: hipR, kneeR: hipR - 26 - 48 * Math.max(0, Math.sin(w + Math.PI - 1.1)),
        shL: -46 * Math.sin(w), elL: -46 * Math.sin(w) + 62,
        shR: -46 * Math.sin(w + Math.PI), elR: -46 * Math.sin(w + Math.PI) + 62,
        torso: 15, rootY: .05 * Math.abs(Math.sin(w)) - .01,
      });
    },
  },
  sprint: {
    label: '冲刺', dur: .9, loop: true, hold: false, cat: '基础',
    pose: p => {
      const w = TAU * p;
      const hipL = 58 * Math.sin(w), hipR = 58 * Math.sin(w + Math.PI);
      return basePose({
        hipL: hipL, kneeL: hipL - 32 - 62 * Math.max(0, Math.sin(w - 1.15)),
        hipR: hipR, kneeR: hipR - 32 - 62 * Math.max(0, Math.sin(w + Math.PI - 1.15)),
        shL: -62 * Math.sin(w), elL: -62 * Math.sin(w) + 84,
        shR: -62 * Math.sin(w + Math.PI), elR: -62 * Math.sin(w + Math.PI) + 84,
        torso: 26, rootY: .06 * Math.abs(Math.sin(w)) - .012,
      });
    },
  },
  jump: {
    label: '跳跃', dur: .8, loop: false, hold: false, cat: '基础',
    pose: p => {
      let rootY, hip, knee;
      if (p < .22) {
        const k = p / .22;
        rootY = -.11 * k; hip = 42 * k; knee = -64 * k;
      } else if (p < .8) {
        const k = (p - .22) / .58;
        rootY = .52 * Math.sin(Math.PI * k) - .11;
        hip = 42 - 24 * k; knee = -64 - 22 * Math.sin(Math.PI * k);
      } else {
        const k = (p - .8) / .2;
        rootY = -.11 * (1 - k); hip = 42 * (1 - k); knee = -64 * (1 - k);
      }
      return basePose({
        rootY: rootY, hipL: hip, kneeL: knee, hipR: hip, kneeR: knee,
        shL: 62, elL: 86, shR: 58, elR: 82, torso: 5,
      });
    },
  },
  crouch: {
    label: '蹲下', dur: .6, loop: false, hold: true, cat: '基础',
    pose: p => {
      const e = ease(p, 'inout');
      const hipL = 64 * e + 3, kneeL = -72 * e, hipR = 64 * e - 3, kneeR = -72 * e;
      return basePose({
        rootY: groundY(hipL, kneeL, hipR, kneeR), torso: 26 * e,
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        shL: 26 * e + 6, elL: 54 * e + 14, shR: 20 * e - 6, elR: 48 * e - 14,
      });
    },
  },
  sit: {
    label: '坐下', dur: .8, loop: false, hold: true, cat: '基础',
    pose: p => {
      const e = ease(p, 'inout');
      const hipL = 88 * e + 3, kneeL = -86 * e, hipR = 88 * e - 3, kneeR = -86 * e;
      return basePose({
        rootY: groundY(hipL, kneeL, hipR, kneeR), torso: 6 * e + 2,
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        shL: 6 + 24 * e, elL: 14 + 40 * e, shR: -6 + 20 * e, elR: -14 + 36 * e,
      });
    },
  },

  /* ---------------- 转身 ----------------
     这几条**不是姿态动作**，而是「改朝向」：插进去的是 turn 片段
     （和拖拽旋转、AI 的 face 操作走同一条路），所以它们没有 pose 函数。
     角度约定：0° = 背对观众（画面远处），顺时针为正。
     于是 +90° = 转向画面右（east），180° = 面向观众（south），-90° = 转向画面左（west）。
     「左转 / 右转」按角色自己的左右手算，正好等于「朝画面左 / 右转」。 */
  turnL90: { label: '左转 90°', dur: .6, cat: '转身', turn: -90 },
  turnR90: { label: '右转 90°', dur: .6, cat: '转身', turn: 90 },
  turnL180: { label: '左转 180°', dur: .9, cat: '转身', turn: -180 },
  turnR180: { label: '右转 180°', dur: .9, cat: '转身', turn: 180 },
  turnFront: { label: '转身面向镜头', dur: .8, cat: '转身', turnTo: 180 * DEG },
  turnBack: { label: '转身背对镜头', dur: .8, cat: '转身', turnTo: 0 },

  /* ---------------- 打斗 ---------------- */
  punch: {
    label: '出拳', dur: .5, loop: false, hold: false, cat: '打斗',
    pose: p => {
      let shR, elR, torso, rootX;
      if (p < .25) {
        const k = p / .25;
        shR = -30 * k; elR = -30 * k - 92 * k; torso = -5 * k; rootX = -.04 * k;
      } else if (p < .5) {
        const e = ease((p - .25) / .25, 'out');
        shR = lerp(-30, 94, e); elR = lerp(-122, 94, e); torso = lerp(-5, 13, e); rootX = lerp(-.04, .05, e);
      } else {
        const e = ease((p - .5) / .5, 'inout');
        shR = lerp(94, 0, e); elR = lerp(94, -12, e); torso = lerp(13, 2, e); rootX = lerp(.05, 0, e);
      }
      return basePose({
        shR: shR, elR: elR, shL: -34, elL: -4, torso: torso, rootX: rootX,
        hipL: 10, kneeL: -12, hipR: -14, kneeR: -8,
      });
    },
  },
  combo: {
    label: '连续出拳', dur: 1.6, loop: true, hold: false, cat: '打斗',
    pose: p => {
      /* 四记：右-左-右-左。窗口首尾相接略微重叠，读起来才像连续输出而不是四下单练 */
      const win = (a, b) => {
        if (p <= a || p >= b) return 0;
        const u = (p - a) / (b - a);
        return u < .38 ? ease(u / .38, 'out') : 1 - ease((u - .38) / .62, 'inout');
      };
      const eR = Math.max(win(0, .27), win(.50, .77));
      const eL = Math.max(win(.25, .52), win(.75, 1));
      const aR = punchArm(eR), aL = punchArm(eL);
      return basePose({
        shR: aR.sh, elR: aR.el, shL: aL.sh, elL: aL.el,
        hipL: STANCE.hipL, kneeL: STANCE.kneeL, hipR: STANCE.hipR, kneeR: STANCE.kneeR,
        torso: 8 + 10 * Math.max(eR, eL),
        rootX: .055 * (eR + eL),                       // 出拳时重心前压
        rootY: STANCE_Y + .012 * Math.sin(TAU * p * 2),
      });
    },
  },
  uppercut: {
    label: '上勾拳', dur: .7, loop: false, hold: false, cat: '打斗',
    pose: p => {
      let sh, el, torso, rootX, dip, lift;
      if (p < .26) {                                   // ① 沉身、拳收低
        const k = ease(p / .26, 'out');
        sh = lerp(-6, -20, k); el = lerp(-14, 80, k);
        torso = lerp(2, 14, k); rootX = lerp(0, -.05, k);
        dip = k; lift = 0;
      } else if (p < .5) {                             // ② 由下往上爆
        const k = ease((p - .26) / .24, 'out');
        sh = lerp(-20, 98, k); el = lerp(80, 176, k);
        torso = lerp(14, -10, k); rootX = lerp(-.05, .08, k);
        dip = 1 - k; lift = k;
      } else {                                         // ③ 收势
        const k = ease((p - .5) / .5, 'inout');
        sh = lerp(98, -6, k); el = lerp(176, -14, k);
        torso = lerp(-10, 2, k); rootX = lerp(.08, 0, k);
        dip = 0; lift = 1 - k;
      }
      /* 沉身要靠屈膝，不能整体下沉 —— 整体下沉会把脚一起拽到地面以下。
         左右腿弯度取 19 : 30，是为了让两条腿的下探量配平，双脚都还踩在地上。 */
      const hipL = STANCE.hipL + 19 * dip, kneeL = STANCE.kneeL - 19 * dip;
      const hipR = STANCE.hipR + 30 * dip, kneeR = STANCE.kneeR - 30 * dip;
      return basePose({
        shR: sh, elR: el,
        shL: lerp(10, -30, lift), elL: lerp(166, 128, lift),
        torso: torso, rootX: rootX,
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        rootY: groundY(hipL, kneeL, hipR, kneeR) + .025 * lift,   // 顶出去时脚跟离地一点
      });
    },
  },
  elbow: {
    label: '肘击', dur: .5, loop: false, hold: false, cat: '打斗',
    pose: p => {
      /* 折叠前臂：肘角永远比肩角小 160°，肘尖朝前、手收回肩侧 */
      let sh, torso, rootX;
      if (p < .28) {
        const k = ease(p / .28, 'out');
        sh = lerp(-6, 20, k); torso = lerp(2, -4, k); rootX = lerp(0, -.035, k);
      } else if (p < .5) {
        const k = ease((p - .28) / .22, 'out');
        sh = lerp(20, 88, k); torso = lerp(-4, 17, k); rootX = lerp(-.035, .06, k);
      } else {
        const k = ease((p - .5) / .5, 'inout');
        sh = lerp(88, -6, k); torso = lerp(17, 2, k); rootX = lerp(.06, 0, k);
      }
      return basePose({
        shR: sh, elR: sh - 160,
        shL: lerp(10, -24, clamp(p / .5, 0, 1)), elL: lerp(166, 130, clamp(p / .5, 0, 1)),
        torso: torso, rootX: rootX, rootY: STANCE_Y,
        hipL: STANCE.hipL, kneeL: STANCE.kneeL, hipR: STANCE.hipR, kneeR: STANCE.kneeR,
      });
    },
  },
  kick: {
    label: '踢腿', dur: .7, loop: false, hold: false, cat: '打斗',
    pose: p => {
      let hipR, kneeR, torso, rootY, rootX;
      if (p < .3) {
        const k = p / .3;
        hipR = -26 * k; kneeR = hipR - 48 * k; torso = -7 * k; rootY = -.02 * k; rootX = -.03 * k;
      } else if (p < .58) {
        const e = ease((p - .3) / .28, 'out');
        hipR = lerp(-26, 90, e); kneeR = lerp(-72, -4, e);
        torso = lerp(-7, 15, e); rootY = lerp(-.02, .03, e); rootX = lerp(-.03, .02, e);
      } else {
        const e = ease((p - .58) / .42, 'inout');
        hipR = lerp(90, 0, e); kneeR = lerp(-4, -4, e);
        torso = lerp(15, 2, e); rootY = lerp(.03, 0, e); rootX = lerp(.02, 0, e);
      }
      return basePose({
        hipR: hipR, kneeR: kneeR, hipL: 2, kneeL: -8, torso: torso, rootY: rootY, rootX: rootX,
        shL: -42, elL: -14, shR: 32, elR: 78,
      });
    },
  },
  highKick: {
    label: '高踢腿', dur: .8, loop: false, hold: false, cat: '打斗',
    pose: p => {
      /* 支撑腿（左）负责踩地，踢腿（右）先提膝折叠、再弹成一条直线踹出去 */
      let hipR, kneeR, hipL, kneeL, torso, rootX;
      if (p < .28) {                                   // ① 提膝蓄力
        const k = ease(p / .28, 'out');
        hipR = lerp(-6, 74, k); kneeR = lerp(-12, -70, k);
        hipL = lerp(0, 14, k); kneeL = lerp(0, -26, k);
        torso = lerp(2, -9, k); rootX = lerp(0, -.03, k);
      } else if (p < .58) {                            // ② 高位踹出
        const k = ease((p - .28) / .30, 'out');
        hipR = lerp(74, 126, k); kneeR = lerp(-70, 120, k);
        hipL = lerp(14, 6, k); kneeL = lerp(-26, -8, k);
        torso = lerp(-9, -27, k); rootX = lerp(-.03, .05, k);
      } else if (p < .8) {                             // ③ 收腿
        const k = ease((p - .58) / .22, 'inout');
        hipR = lerp(126, 62, k); kneeR = lerp(120, -54, k);
        hipL = lerp(6, 10, k); kneeL = lerp(-8, -20, k);
        torso = lerp(-27, -8, k); rootX = lerp(.05, .01, k);
      } else {                                         // ④ 落地站定
        const k = ease((p - .8) / .2, 'inout');
        hipR = lerp(62, 0, k); kneeR = lerp(-54, -8, k);
        hipL = lerp(10, 0, k); kneeL = lerp(-20, -4, k);
        torso = lerp(-8, 2, k); rootX = lerp(.01, 0, k);
      }
      const ext = clamp((hipR - 20) / 90, 0, 1);       // 腿抬得越高，手臂张得越开
      return basePose({
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        torso: torso, rootX: rootX,
        rootY: legDrop(hipL, kneeL) - .48,             // 只按支撑腿算，脚才踩得住地
        shL: lerp(10, -62, ext), elL: lerp(20, -18, ext),
        shR: lerp(-10, 58, ext), elR: lerp(-18, 96, ext),
      });
    },
  },
  roundhouse: {
    label: '回旋踢', dur: .9, loop: false, hold: false, cat: '打斗',
    pose: p => {
      let hipR, kneeR, hipL, kneeL, torso, rootRot, rootX;
      if (p < .3) {                                    // ① 提膝内收、身体反拧
        const k = ease(p / .3, 'out');
        hipR = lerp(0, 72, k); kneeR = lerp(-10, -78, k);
        hipL = lerp(0, 12, k); kneeL = lerp(0, -20, k);
        torso = lerp(2, 10, k); rootRot = lerp(0, -13, k); rootX = lerp(0, -.05, k);
      } else if (p < .6) {                             // ② 横扫出去
        const k = ease((p - .3) / .3, 'out');
        hipR = lerp(72, 118, k); kneeR = lerp(-78, 112, k);
        hipL = lerp(12, 2, k); kneeL = lerp(-20, -6, k);
        torso = lerp(10, -14, k); rootRot = lerp(-13, 10, k); rootX = lerp(-.05, .08, k);
      } else {                                         // ③ 收腿回正
        const k = ease((p - .6) / .4, 'inout');
        hipR = lerp(118, 0, k); kneeR = lerp(112, -8, k);
        hipL = lerp(2, 0, k); kneeL = lerp(-6, 0, k);
        torso = lerp(-14, 2, k); rootRot = lerp(10, 0, k); rootX = lerp(.08, 0, k);
      }
      const ext = clamp((hipR - 20) / 95, 0, 1);
      return basePose({
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        torso: torso, rootRot: rootRot, rootX: rootX,
        rootY: legDrop(hipL, kneeL) - .48,
        shL: lerp(10, -70, ext), elL: lerp(20, -30, ext),
        shR: lerp(-10, 74, ext), elR: lerp(-18, 108, ext),
      });
    },
  },
  kneeStrike: {
    label: '膝撞', dur: .6, loop: false, hold: false, cat: '打斗',
    pose: p => {
      /* 双手往前下压（按对手的头），同时右膝顶上去 */
      let hipR, kneeR, hipL, kneeL, torso, rootX;
      if (p < .35) {
        const k = ease(p / .35, 'out');
        hipR = lerp(0, 104, k); kneeR = lerp(-10, -30, k);
        hipL = lerp(0, 8, k); kneeL = lerp(0, -12, k);
        torso = lerp(2, 24, k); rootX = lerp(0, .03, k);
      } else if (p < .55) {
        const k = ease((p - .35) / .2, 'out');
        hipR = lerp(104, 118, k); kneeR = lerp(-30, -24, k);
        /* 支撑腿这一段不动，但也必须赋值：漏掉就是 NaN，渲染时 createLinearGradient 会直接抛异常 */
        hipL = 8; kneeL = -12;
        torso = lerp(24, 30, k); rootX = lerp(.03, .09, k);
      } else {
        const k = ease((p - .55) / .45, 'inout');
        hipR = lerp(118, 0, k); kneeR = lerp(-24, -10, k);
        hipL = lerp(8, 0, k); kneeL = lerp(-12, 0, k);
        torso = lerp(30, 2, k); rootX = lerp(.09, 0, k);
      }
      const ext = clamp(hipR / 110, 0, 1);
      return basePose({
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        torso: torso, rootX: rootX,
        rootY: legDrop(hipL, kneeL) - .48,
        shL: lerp(6, 70, ext), elL: lerp(14, 118, ext),
        shR: lerp(-6, 64, ext), elR: lerp(-14, 112, ext),
      });
    },
  },
  guard: {
    label: '格挡', dur: .5, loop: false, hold: true, cat: '打斗',
    pose: p => {
      const e = ease(p, 'out');
      return basePose({
        shL: lerp(6, 116, e), elL: lerp(14, 58, e), shR: lerp(-6, 108, e), elR: lerp(-14, 50, e),
        torso: lerp(2, 12, e), rootY: -.04 * e,
        hipL: 14 * e + 3, kneeL: -20 * e, hipR: -14 * e - 3, kneeR: -20 * e,
      });
    },
  },
  dodge: {
    label: '闪避', dur: .6, loop: false, hold: false, cat: '打斗',
    pose: p => {
      const k = Math.sin(Math.PI * p);
      return basePose({
        rootX: -.22 * k, rootY: -.06 * k, torso: 8 + 16 * k,
        hipL: 10 + 30 * k, kneeL: -14 - 34 * k, hipR: -8 + 16 * k, kneeR: -10 - 26 * k,
        shL: 20 + 40 * k, elL: 46 + 30 * k, shR: -18 - 22 * k, elR: -20 - 30 * k,
      });
    },
  },
  weave: {
    label: '摇闪（下潜）', dur: .9, loop: false, hold: false, cat: '打斗',
    pose: p => {
      const k = Math.sin(Math.PI * p);                 // 下潜量
      const k2 = Math.sin(Math.PI * clamp(p * 1.35, 0, 1));  // 侧移略滞后一点
      /* 膝盖的弯度是按「两条腿下探量相等」反解出来的，下潜到底时双脚仍都踩地 */
      const hipL = 16 + 26 * k, kneeL = -18 - 31.5 * k;
      const hipR = -14 + 20 * k, kneeR = -20 - 48 * k;
      return basePose({
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        rootY: groundY(hipL, kneeL, hipR, kneeR),
        rootX: -.22 * k2,
        torso: 8 + 20 * k,
        shL: 12 + 60 * k, elL: 166 - 40 * k,            // 双拳护头
        shR: 10 + 56 * k, elR: 166 - 44 * k,
      });
    },
  },
  tackle: {
    label: '冲撞扑抱', dur: .9, loop: false, hold: true, cat: '打斗',
    pose: p => {
      /* 前腿（左）压下去、后腿（右）蹬出去，两条腿下探量取齐，髋才不会歪 */
      const e = ease(p, 'out');
      const hipL = lerp(0, 42, e), kneeL = lerp(0, -34, e);
      const hipR = lerp(0, -40, e), kneeR = lerp(0, -38, e);
      return basePose({
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        torso: lerp(2, 34, e), rootX: lerp(0, .1, e),
        rootY: groundY(hipL, kneeL, hipR, kneeR),
        shL: lerp(6, 78, e), elL: lerp(14, 72, e),
        shR: lerp(-6, 74, e), elR: lerp(-14, 68, e),
      });
    },
  },
  hit: {
    label: '受击', dur: .5, loop: false, hold: false, cat: '打斗',
    pose: p => {
      const k = Math.sin(Math.PI * p);
      return basePose({
        torso: 2 - 22 * k, rootX: -.09 * k, rootY: -.02 * k,
        shL: 6 + 46 * k, elL: 14 + 62 * k, shR: -6 - 30 * k, elR: -14 - 44 * k,
        hipL: 3 - 10 * k, hipR: -3 + 6 * k, kneeL: -14 * k,
      });
    },
  },
  fall: {
    label: '前倒（扑）', dur: 1, loop: false, hold: true, cat: '打斗',
    pose: p => {
      const e = ease(p, 'in');
      return basePose({
        rootRot: 88 * e, rootY: -.06 * Math.sin(Math.PI * p),
        hipL: 6, hipR: -6, kneeL: -6, kneeR: -6,
        shL: 74, elL: 84, shR: 62, elR: 72, torso: -8,
      });
    },
  },
  knockdown: {
    label: '后倒（被击倒）', dur: 1.1, loop: false, hold: true, cat: '打斗',
    pose: p => {
      const e = ease(p, 'in');
      return basePose({
        rootRot: -88 * e, rootY: -.05 * Math.sin(Math.PI * p), rootX: -.12 * Math.sin(Math.PI * p),
        hipL: -12, hipR: 10, kneeL: -30, kneeR: -34,
        shL: -60, elL: -96, shR: -50, elR: -88, torso: -12,
      });
    },
  },
  slash: {
    label: '挥砍', dur: .6, loop: false, hold: false, cat: '打斗',
    pose: p => {
      const e = ease(p, 'inout');
      const sh = lerp(-112, 68, e);
      return basePose({
        shR: sh, elR: sh + 12, shL: -22, elL: 6,
        torso: lerp(-8, 15, e), hipR: -10, kneeR: -10, hipL: 8,
        rootRot: 0,
      });
    },
  },

  /* ---------------- 剧情 / 表演 ---------------- */
  point: {
    label: '瞄准 / 指', dur: .6, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      return basePose({
        shR: lerp(-6, 92, e), elR: lerp(-14, 92, e), shL: 4, elL: 16,
        torso: lerp(2, 5, e), hipL: 6, hipR: -10,
      });
    },
  },
  gaze: {
    label: '深情凝望', dur: 1.2, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'inout');
      const s = Math.sin(TAU * p * .5);               // 一次很轻的呼吸起伏
      return basePose({
        torso: lerp(2, 7, e) + .8 * s, rootX: lerp(0, .035, e),
        rootY: lerp(0, -.012, e) + .006 * s,
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
        shL: lerp(6, 30, e), elL: lerp(14, 66, e),
        shR: lerp(-6, 22, e), elR: lerp(-14, 58, e),
      });
    },
  },
  hug: {
    label: '拥抱', dur: 1, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'inout');
      return basePose({
        torso: lerp(2, 14, e), rootX: lerp(0, .05, e), rootY: lerp(0, -.02, e),
        hipL: 6, kneeL: -6, hipR: -6, kneeR: -6,
        shL: lerp(6, 84, e), elL: lerp(14, 128, e),
        shR: lerp(-6, 80, e), elR: lerp(-14, 124, e),
      });
    },
  },
  reach: {
    label: '伸手（牵手 / 挽留）', dur: .8, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      const hipL = lerp(3, 16, e), kneeL = lerp(0, -12, e);
      const hipR = lerp(-3, -14, e), kneeR = lerp(0, -6, e);
      return basePose({
        torso: lerp(2, 12, e), rootX: lerp(0, .05, e),
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        rootY: groundY(hipL, kneeL, hipR, kneeR),
        shR: lerp(-6, 88, e), elR: lerp(-14, 86, e),   // 前手递出去
        shL: lerp(6, -30, e), elL: lerp(14, -6, e),    // 后手自然甩在身后
      });
    },
  },
  wave: {
    label: '挥手', dur: 1.2, loop: true, hold: false, cat: '剧情',
    pose: p => {
      const w = TAU * p;
      return basePose({
        shR: 158 + 14 * Math.sin(w), elR: 150 + 30 * Math.sin(w + .8),
        shL: 8, elL: 18, torso: 3 + 2 * Math.sin(w),
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
        rootY: .008 * Math.sin(w * 2),
      });
    },
  },
  armsCrossed: {
    label: '抱臂', dur: .6, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      /* 单平面骨架画不出真正的"交叉"，但上臂垂下 + 前臂横在胸前，
         侧看就是标准的抱臂剪影 */
      return basePose({
        shL: lerp(6, 34, e), elL: lerp(14, 104, e),
        shR: lerp(-6, 26, e), elR: lerp(-14, 96, e),
        torso: lerp(2, 4, e),
        hipL: 4, kneeL: -3, hipR: -4, kneeR: -3,
      });
    },
  },
  phone: {
    label: '打电话', dur: .6, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      return basePose({
        shR: lerp(-6, FACE_ARM.sh, e), elR: lerp(-14, FACE_ARM.el, e),
        shL: lerp(6, 16, e), elL: lerp(14, 30, e),
        torso: lerp(2, 4, e),
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
      });
    },
  },
  cry: {
    label: '掩面哭泣', dur: 1.6, loop: true, hold: false, cat: '剧情',
    pose: p => {
      const w = TAU * p, s = Math.sin(w);
      return basePose({
        shL: 92 + 5 * s, elL: -128 - 6 * s,
        shR: 98 - 5 * s, elR: -132 + 6 * s,
        torso: 13 + 2.5 * Math.sin(w * 3),             // 肩膀一抽一抽
        hipL: 6, kneeL: -6, hipR: -6, kneeR: -6,
        rootY: groundY(6, -6, -6, -6) + .008 * Math.sin(w * 2), rootX: .01 * s,
      });
    },
  },
  think: {
    label: '沉思（托腮）', dur: .8, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      return basePose({
        shR: lerp(-6, 84, e), elR: lerp(-14, -130, e),  // 手托到下巴
        shL: lerp(6, 30, e), elL: lerp(14, 98, e),      // 另一条手臂横在身前托肘
        torso: lerp(2, 8, e), rootY: lerp(0, -.01, e),
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
      });
    },
  },
  kneel: {
    label: '单膝跪地', dur: .8, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'inout');
      /* 右膝落地：髋必须先降下来（-.235），大腿才够得着地面；
         左腿前跨踩实，小腿向后放平贴地 */
      const hipL = lerp(3, 68, e), kneeL = lerp(0, -48, e);
      const hipR = lerp(-3, -11.5, e), kneeR = lerp(0, -90, e);
      return basePose({
        rootY: groundY(hipL, kneeL, hipR, kneeR), torso: lerp(2, 6, e), rootX: lerp(0, -.01, e),
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        shR: lerp(-6, 76, e), elR: lerp(-14, 64, e),    // 递出手（求婚 / 受降）
        shL: lerp(6, 14, e), elL: lerp(14, 30, e),
      });
    },
  },
  bow: {
    label: '鞠躬', dur: .9, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'inout');
      const hipL = lerp(3, -8, e), kneeL = lerp(0, -6, e);
      const hipR = lerp(-3, -6, e), kneeR = lerp(0, -6, e);
      return basePose({
        torso: lerp(2, 62, e), rootX: lerp(0, -.02, e),
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        rootY: groundY(hipL, kneeL, hipR, kneeR),   // 鞠躬只弯腰，不蹲，脚不能跟着沉
        shL: lerp(6, 26, e), elL: lerp(14, 34, e),
        shR: lerp(-6, 22, e), elR: lerp(-14, 30, e),
      });
    },
  },
  clap: {
    label: '鼓掌', dur: .8, loop: true, hold: false, cat: '剧情',
    pose: p => {
      const s = Math.sin(TAU * p);
      return basePose({
        shL: 66 + 10 * s, elL: 104 + 42 * s,
        shR: 66 + 10 * s, elR: 104 + 42 * s,
        torso: 3 + 1.5 * s,
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
        rootY: .006 * s,
      });
    },
  },
  lean: {
    label: '倚靠', dur: .8, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'inout');
      const hipL = lerp(3, 10, e), kneeL = lerp(0, -8, e);
      const hipR = lerp(-3, -18, e), kneeR = lerp(0, -26, e);
      return basePose({
        rootRot: lerp(0, -7, e), rootX: lerp(0, -.06, e),
        torso: lerp(2, -3, e),
        hipL: hipL, kneeL: kneeL, hipR: hipR, kneeR: kneeR,
        rootY: groundY(hipL, kneeL, hipR, kneeR),
        shL: lerp(6, -26, e), elL: lerp(14, -14, e),    // 一只手撑在墙上
        shR: lerp(-6, 40, e), elR: lerp(-14, 66, e),
      });
    },
  },
  toast: {
    label: '举杯', dur: .8, loop: false, hold: true, cat: '剧情',
    pose: p => {
      const e = ease(p, 'out');
      return basePose({
        shR: lerp(-6, 108, e), elR: lerp(-14, 96, e),   // 前手举杯
        shL: lerp(6, 40, e), elL: lerp(14, 92, e),
        torso: lerp(2, -4, e), rootY: lerp(0, .01, e),
        hipL: 5, kneeL: -4, hipR: -5, kneeR: -4,
      });
    },
  },
  celebrate: {
    label: '欢呼', dur: 1.5, loop: true, hold: false, cat: '剧情',
    pose: p => {
      const w = TAU * p;
      return basePose({
        shL: 152 + 16 * Math.sin(w), elL: 168 + 14 * Math.sin(w + 1),
        shR: 148 + 16 * Math.sin(w + .6), elR: 164 + 14 * Math.sin(w + 1.6),
        torso: -4, rootY: .05 * Math.abs(Math.sin(w * 2)), rootX: .02 * Math.sin(w),
        hipL: 8, hipR: -8, kneeL: -8, kneeR: -8,
      });
    },
  },
};

const ACTION_IDS = Object.keys(ACTIONS);
/* 面板里的分组顺序（新增动作只要填 cat 就会自动归位，忘了填就落到「其他」） */
const ACTION_CATS = ['基础', '转身', '打斗', '剧情', '其他'];

function actionLabel(id) { return (ACTIONS[id] || { label: id || '待机' }).label; }
/* 转身那几条没有 pose（它们改的是朝向，不是姿态）——
   这里显式兜住，别靠 try/catch 去接 TypeError。 */
function actionPose(id, phase) {
  const a = ACTIONS[id] || ACTIONS.idle;
  if (!a.pose) return basePose();
  try { return a.pose(clamp(phase, 0, 1)); } catch (e) { return basePose(); }
}
/* 这条「动作」其实是一次转身？是就返回角度增量或绝对目标，否则 null。 */
function turnSpec(id) {
  const a = ACTIONS[id];
  if (!a) return null;
  if (a.turn != null) return { rel: +a.turn * DEG, dur: a.dur, label: a.label };
  if (a.turnTo != null) return { abs: +a.turnTo, dur: a.dur, label: a.label };
  return null;
}

/* ---------------- 骨架绘制 ----------------
   局部坐标里 y 向下为正（和 canvas 一致），脚底在原点。
   0° = 竖直朝下（腿、手臂下垂用 skStep）；躯干朝上要用 skStepUp。 */
function skStep(pt, deg, len) {
  const a = deg * DEG;
  return { x: pt.x + Math.sin(a) * len, y: pt.y + Math.cos(a) * len };
}
/* 朝上走一步：竖直分量取负。水平分量保持 sin(deg)，
   这样 torso 角的正负含义和 buildSkeleton3D 里一致（正=上身前倾）。 */
function skStepUp(pt, deg, len) {
  const a = deg * DEG;
  return { x: pt.x + Math.sin(a) * len, y: pt.y - Math.cos(a) * len };
}
/* 站立时脚底→头顶的归一化高度（髋 .48 + 躯干 .38 + 头心 .105 + 头半径 .088）。
   用它把 hpx 换算成骨架缩放，保证画出来的人物高度就是 hpx 本身。 */
const BODY_H = .48 + .38 + .105 + .088;
function skSeg(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/**
 * 画一个直立火柴人。
 * @param footX,footY 脚底在屏幕上的位置
 * @param hpx 站立时的屏幕高度（脚→头顶）
 * @param dir +1 面朝屏幕右，-1 面朝屏幕左
 */
function drawFigure(ctx, footX, footY, hpx, dir, pose, color, opts) {
  opts = opts || {};
  const p = pose || basePose();
  /* 继承调用方的不透明度（远景雾化），不能写死回 1，否则远处角色不会随雾变淡 */
  const base = clamp(ctx.globalAlpha, 0, 1);
  const u = hpx / BODY_H;          // 归一化骨架 → 屏幕像素
  ctx.save();
  ctx.translate(footX, footY);
  ctx.rotate((p.rootRot || 0) * DEG);
  ctx.scale(dir * u, u);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = (opts.lw || .062) * BODY_H;   // 抵消 u，使屏幕线宽仍是 lw*hpx

  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  const hip = { x: (p.rootX || 0), y: -.48 - (p.rootY || 0) };
  /* 躯干必须向上长。之前这里误用了朝下的 skStep，导致人物"倒栽"（髋在最高、头贴地） */
  const neck = skStepUp(hip, p.torso || 0, .38);
  const head = skStepUp(neck, p.torso || 0, .105);

  const kneeL = skStep(hip, p.hipL, .25), ankL = skStep(kneeL, p.kneeL, .23);
  const kneeR = skStep(hip, p.hipR, .25), ankR = skStep(kneeR, p.kneeR, .23);
  const elbL = skStep(neck, p.shL, .18), handL = skStep(elbL, p.elL, .17);
  const elbR = skStep(neck, p.shR, .18), handR = skStep(elbR, p.elR, .17);

  ctx.globalAlpha = base * (opts.farAlpha == null ? .72 : opts.farAlpha);
  skSeg(ctx, hip, kneeR); skSeg(ctx, kneeR, ankR);
  skSeg(ctx, neck, elbR); skSeg(ctx, elbR, handR);
  ctx.globalAlpha = base;
  skSeg(ctx, hip, kneeL); skSeg(ctx, kneeL, ankL);
  skSeg(ctx, hip, neck);
  skSeg(ctx, neck, elbL); skSeg(ctx, elbL, handL);

  ctx.beginPath();
  ctx.arc(head.x, head.y, .088, 0, TAU);
  ctx.fill();
  ctx.restore();
}
