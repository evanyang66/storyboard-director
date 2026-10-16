'use strict';
/* ============================================================
   ai.js — 本地 AI 场景编排
   ------------------------------------------------------------
   用户说一句中文 → 本地模型翻成「操作列表」→ 校验 → 改 App.state。

   为什么不让模型直接吐工具的存档 JSON：
   存档里的坐标是背景像素，还夹着 keys / clips 这些深层结构。
   8B 模型算不准像素，也背不住那么深的结构。所以中间加一层「意图 DSL」：
   模型只说「谁、做什么、在哪个方位、第几秒」，方位用 center / north / west
   这类词，由这里换算成像素。模型要输出的东西越少，出错率越低。

   模型怎么连：走 ai-proxy.js。file:// 页面的 Origin 是 null，
   而 ComfyUI 完全不发 CORS 头，浏览器直连必被挡，所以必须过代理。
   ============================================================ */

/* ---------------- 配置 ---------------- */
const AI_ENDPOINT = 'http://127.0.0.1:8790';
const AI_POLL_MS = 900;
const AI_MAX_WAIT = 16 * 60 * 1000;

/* ---------------- 方位词 → 世界坐标 ----------------
   归一化到画布比例。世界坐标 = 背景图像素坐标，所以最后乘 bgW/bgH。
   north 是「远处」（画面上方，y 小），south 是「近处」（画面下方，y 大）——
   跟俯视图一致，也跟人物朝向约定一致（angle 0 朝 north）。 */
const AI_ANCHORS = {
  center: [.50, .50],
  north: [.50, .15], ne: [.83, .17], east: [.86, .50], se: [.83, .83],
  south: [.50, .85], sw: [.17, .83], west: [.14, .50], nw: [.17, .17],
  fnorth: [.50, .05], feast: [.95, .50], fsouth: [.50, .95], fwest: [.05, .50],
};
const AI_ANCHOR_ALIAS = {
  '中心': 'center', '中央': 'center', '画面中心': 'center', '中间': 'center', '正中': 'center', '原地': 'center',
  '远处': 'north', '上': 'north', '上方': 'north', '后': 'north', '后方': 'north', '远': 'north', '背景': 'north', '景深处': 'north',
  '近处': 'south', '下': 'south', '下方': 'south', '前': 'south', '前方': 'south', '近': 'south', '前景': 'south',
  '左': 'west', '左边': 'west', '左侧': 'west', '画面左': 'west',
  '右': 'east', '右边': 'east', '右侧': 'east', '画面右': 'east',
  '左上': 'nw', '左后': 'nw', '右上': 'ne', '右后': 'ne',
  '左下': 'sw', '左前': 'sw', '右下': 'se', '右前': 'se',
  '最左': 'fwest', '最右': 'feast', '最上': 'fnorth', '最下': 'fsouth', '最远处': 'fnorth',
};

/* 角度约定：dirVec(a) = (sin a, -cos a)，所以 0=north、90=east、180=south、270=west */
const AI_DIRS = { north: 0, ne: 45, east: 90, se: 135, south: 180, sw: 225, west: 270, nw: 315 };
const AI_DIR_ALIAS = {
  '北': 'north', '远': 'north', '上': 'north', '后方': 'north', '背向': 'north', '背对': 'north',
  '背对观众': 'north', '背对镜头': 'north', '朝里': 'north', '朝远处': 'north',
  '东': 'east', '右': 'east', '右侧': 'east', '朝右': 'east',
  '南': 'south', '近': 'south', '下': 'south', '前方': 'south', '面向': 'south', '正对': 'south',
  '面向观众': 'south', '面向镜头': 'south', '朝外': 'south', '朝近处': 'south',
  '西': 'west', '左': 'west', '左侧': 'west', '朝左': 'west',
  '东北': 'ne', '东南': 'se', '西南': 'sw', '西北': 'nw',
};

/* camMove（在已有运镜上叠加位移）用的方向表。
   在 AI_DIRS 基础上多了上下 —— 对机位来说，「往上」几乎总是指抬高镜头，
   不是「往远处」，所以这里把 上/下 覆盖成 up/down（AI_DIR_ALIAS 里它们是 north/south）。
   注意：角色走位（shift）仍然用 AI_DIRS，上下对角色没有意义。 */
const AI_CAM_DIRS = Object.assign({ up: 1, down: 1 }, AI_DIRS);
const AI_CAM_DIR_ALIAS = Object.assign({}, AI_DIR_ALIAS, {
  '上': 'up', '上方': 'up', '往上': 'up', '抬高': 'up', '升高': 'up', '升': 'up', '上升': 'up', '高': 'up',
  '下': 'down', '下方': 'down', '往下': 'down', '降低': 'down', '压低': 'down', '降': 'down', '下降': 'down', '低': 'down',
});

/* 支持的操作名（白名单：模型冒出别的就丢掉并报告） */
const AI_OPS = {
  addChar: 1, addCam: 1, del: 1, shift: 1, moveTo: 1, moveStyle: 1,
  act: 1, face: 1, shot: 1, camMove: 1, set: 1, clear: 1,
};

/* 「整场替换」的运行时上下文（只在 aiApply 里翻）。
   为什么需要它：替换模式会**先清空再应用**，于是 ops 里任何引用旧名字的操作
   （act who=da、shot 需要机位…）都会找不到对象，报「场景里啥都没有」。
   可这些名字是模型从**用户指令**里抄来的 —— 用户的意思就是「按我说的重搭一场」，
   所以这时候该把名字建出来，而不是判死。AI_AUTO 记下自动建了哪些，写进日志。 */
let AI_REPLACE_CTX = false;
let AI_AUTO = [];

/* 写入方式（面板上的三选一） */
const AI_MODES = {
  inplace: '就地修改',
  append: '接在后面',
  replace: '整场替换',
};

/* ---------------- 时间线：末尾在哪 / 整体搬到末尾 ----------------
   「接在后面」模式的核心难点：模型只会「从 0 秒开始写一条新片段」，
   它算不准时间线末尾在哪。所以不让它算 —— 它照常从 0 写，由这里
   把整批操作的时间字段整体加一个基准 T。

   为什么必须在「应用之前」加，不能事后平移新片段：
   shot 会用 at 去切掉它之后的关键帧（cam.keys.filter(k => k.t <= t0)）。
   如果拿 at=0 去切，会把已有的运镜全删了。先 rebase 成 at=T，
   切割点就落在正确的位置。 */
function aiTimelineEnd() {
  let T = 0;
  for (const o of App.state.objects) {
    for (const c of (o.clips || [])) T = Math.max(T, (+c.start || 0) + (+c.dur || 0));
    for (const k of (o.keys || [])) T = Math.max(T, +k.t || 0);
  }
  return +T.toFixed(2);
}
/* 只搬「时间字段」。at 在 addChar/addCam 里是方位词（字符串），
   在 moveTo/act/shot/camMove 里是秒数（数字）—— 用类型区分，天然不会误伤。 */
function aiRebaseOps(ops, T) {
  if (!T) return ops;
  return ops.map(o => {
    const c = Object.assign({}, o);
    for (const f of ['at', 't', 'start', 'from']) {
      if (typeof c[f] === 'number') c[f] = +((+c[f]) + T).toFixed(2);
    }
    return c;
  });
}

/* ---------------- 小工具 ---------------- */
function aiNorm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

function aiAnchorKey(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  if (AI_ANCHORS[t]) return t;
  return AI_ANCHOR_ALIAS[t] || null;
}
function aiAnchorWorld(at) {
  const k = aiAnchorKey(at);
  if (!k) return null;
  const a = AI_ANCHORS[k];
  return { x: a[0] * App.state.bgW, y: a[1] * App.state.bgH };
}
function aiDirKey(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  if (AI_DIRS[t] != null) return t;
  return AI_DIR_ALIAS[t] || null;
}

/* 按名字找对象。容忍空格/大小写，也容忍「角色A」写成「A」。 */
function aiFindObj(name) {
  if (name == null) return null;
  const s = String(name).trim();
  if (!s) return null;
  const os = App.state.objects;
  let o = os.find(x => x.id === s) || os.find(x => x.name === s);
  if (o) return o;
  const n = aiNorm(s);
  o = os.find(x => aiNorm(x.name) === n);
  if (o) return o;
  /* 模糊：唯一匹配才认，避免「角色1」误配「角色10」 */
  const hits = os.filter(x => {
    const m = aiNorm(x.name);
    return m.includes(n) || n.includes(m);
  });
  return hits.length === 1 ? hits[0] : null;
}

/* 在替换模式下按名字补一个对象出来。位置只能用默认锚点（center / south），
   所以一定要在日志里说清楚 —— 用户得知道这个角色是刚被建出来的、位置还没摆。 */
function aiAutoMake(name, kind) {
  const nm = String(name).trim();
  if (kind === 'cam') {
    const w = aiAnchorWorld('south') || { x: App.state.bgW / 2, y: App.state.bgH * .9 };
    const k = createCam(w.x, w.y, cams().length + 1);
    k.name = aiFindObj(nm) ? nm + '2' : nm;
    App.state.objects.push(k);
    App.state.activeCam = k.id;
    AI_AUTO.push(k.name + '(机位)');
    return k;
  }
  const w = aiAnchorWorld('center') || { x: App.state.bgW / 2, y: App.state.bgH / 2 };
  const c = createChar(w.x, w.y, chars().length + 1);
  c.name = aiFindObj(nm) ? nm + '2' : nm;
  App.state.objects.push(c);
  App.lastCharId = c.id;
  AI_AUTO.push(c.name + '(角色)');
  return c;
}

/* 找不到就抛一个「能照着改」的错 —— 列出场景里到底有哪些对象。
   光说「找不到男主」，用户不知道下一步该干嘛。 */
function aiNeedObj(name, kind) {
  const o = aiFindObj(name);
  if (o) return o;
  /* 替换模式下名字找不到是**常态**：场景刚被清空，摘要也没列旧对象，
     模型只能是从用户指令里抄的名字。用户的意思就是「按我说的重搭」，
     所以建出来（并在日志里标注是自动建的），而不是把整条操作判死。 */
  if (AI_REPLACE_CTX && name != null && String(name).trim()) {
    return aiAutoMake(name, kind === 'cam' ? 'cam' : 'char');
  }
  const all = App.state.objects.map(x => x.name + '(' + (x.type === 'char' ? '角色' : '机位') + ')').join('、');
  throw new Error('场景里没有「' + name + '」。现有对象：' + (all || '（一个都没有）') +
    '。要新建请用 addChar / addCam。');
}

/* shot / camMove 需要一个机位。没有时同样是「替换模式就补一台」。 */
function aiNeedCam() {
  const cam = activeCamObj() || cams()[0];
  if (cam) return cam;
  if (AI_REPLACE_CTX) return aiAutoMake('机位1', 'cam');
  throw new Error('场景里还没有机位（先用 addCam 加一台）');
}

/* 位置的人话描述，给模型看当前布局 */
function aiPosDesc(x, y) {
  const st = App.state, pm = st.pxPerMeter;
  const dx = (x - st.bgW / 2) / pm, dy = (y - st.bgH / 2) / pm;
  const h = Math.abs(dx) < .4 ? '居中' : (dx > 0 ? '偏右' + dx.toFixed(1) + 'm' : '偏左' + (-dx).toFixed(1) + 'm');
  const v = Math.abs(dy) < .4 ? '中段' : (dy > 0 ? '偏近' + dy.toFixed(1) + 'm' : '偏远' + (-dy).toFixed(1) + 'm');
  return h + '·' + v;
}
function aiAngleName(a) {
  const names = ['north(远/背对观众)', 'ne(右上)', 'east(右)', 'se(右下)',
    'south(近/面向观众)', 'sw(左下)', 'west(左)', 'nw(左上)'];
  const d = ((a * RAD) % 360 + 360) % 360;
  return names[Math.round(d / 45) % 8];
}

/* ---------------- 当前场景摘要（喂给模型） ---------------- */
function aiSceneSummary(mode) {
  const st = App.state, pm = st.pxPerMeter;
  const L = [];
  L.push(`画布 ${st.bgW}×${st.bgH}px，${pm}px/米（约 ${(st.bgW / pm).toFixed(1)}m 宽 × ${(st.bgH / pm).toFixed(1)}m 深）`);
  L.push(`背景=${st.bg ? '用户导入的图' : '示例背景'}，总时长 ${st.duration}s，时间指针 ${App.time.toFixed(2)}s`);
  L.push(`分镜名：${st.name}`);

  /* 整场替换时，干脆不把旧对象列给模型。
     列了它就会纠结「要不要先 del 掉」「用户说的角色是不是原来那个」——
     实测模型会在这上面绕很久，思考把 token 耗光，JSON 反而吐不出来。
     反正应用前会清空，对它来说这就是个空场景。 */
  if (mode === 'replace') {
    L.push('（这是「整场替换」：应用前会把现有内容全部清空。');
    L.push(' 所以上面没列旧的角色和机位 —— 对你是空的，需要什么就直接建什么，时间从 0 秒排。）');
    return L.join('\n');
  }

  /* 追加模式千万不能告诉模型「已排到 6.6s」——
     它会把 6.6 当成自己的起点，而应用时我们还会再加一次 T，
     结果新内容被推到 13.2s，中间空一大段。这里只给「从 0 开始编号」的指令。 */
  if (mode === 'append') {
    L.push('（下面这些是已有内容，**你不用管它们排在第几秒**。');
    L.push(' 你要加的新内容，时间一律从 0 秒开始编号，系统会自动把它接到末尾。）');
  } else {
    L.push(`时间线上已排到的位置：${aiTimelineEnd()}s（再往后加东西就从这里接）`);
  }

  const cs = chars();
  L.push(`角色 ${cs.length} 个：`);
  if (!cs.length) L.push('  （无）');
  cs.forEach((c, i) => {
    const clips = (c.clips || []).slice().sort((a, b) => a.start - b.start).map(cl => {
      if (cl.kind === 'action') return `${cl.action}@${cl.start}~${(cl.start + cl.dur).toFixed(1)}s${cl.loop ? '(循环)' : ''}`;
      if (cl.kind === 'move') return `走位@${cl.start}~${(cl.start + cl.dur).toFixed(1)}s`;
      if (cl.kind === 'turn') return `转身@${cl.start}s`;
      return cl.kind + '@' + cl.start;
    });
    L.push(`  ${i + 1}. ${c.name}  位置=${aiPosDesc(c.x, c.y)}  朝向=${aiAngleName(c.angle)}`);
    L.push(`     已有片段：${clips.length ? clips.join('; ') : '（无）'}`);
  });

  const ks = cams();
  L.push(`机位 ${ks.length} 台：`);
  if (!ks.length) L.push('  （无）');
  ks.forEach((k, i) => {
    const tg = k.follow && k.follow.targetId ? getObj(k.follow.targetId) : null;
    L.push(`  ${i + 1}. ${k.name}${k.id === st.activeCam ? '（当前镜头）' : ''}  位置=${aiPosDesc(k.x, k.y)}  高${k.height}m fov${k.fov}°  朝向=${aiAngleName(k.angle)}  关键帧${(k.keys || []).length}个${tg ? '  跟随:' + tg.name : ''}`);
    /* 把「这台机位做过哪些运镜」说清楚 —— 用户说「这个镜头在后拉的同时往上」时，
       模型得先知道「这个镜头」做的是拉远，才能决定在哪个时间段叠加上升。 */
    const ms = (k.moves || []).slice().sort((a, b) => a.t - b.t).map(mv => {
      const tpl = CAM_TEMPLATES.find(x => x.id === mv.tpl);
      return `${mv.tpl}=${tpl ? tpl.label : '?'}@${mv.t}~${(mv.t + mv.dur).toFixed(1)}s`;
    });
    if (ms.length) L.push(`     已做运镜：${ms.join('; ')}`);
  });

  const sel = getSelObj();
  L.push(`当前选中：${sel ? sel.name : '（无）'}`);
  return L.join('\n');
}

/* ---------------- 可用素材清单（从代码里现算，不会过期） ---------------- */
function aiActionList() {
  const by = {};
  for (const id of ACTION_IDS) {
    const a = ACTIONS[id];
    const c = a.cat || '其他';
    (by[c] = by[c] || []).push(`${id}=${a.label}(${a.dur}s${a.loop ? ',循环' : ''})`);
  }
  return ACTION_CATS.filter(c => by[c]).map(c => `  ${c}: ${by[c].join(', ')}`).join('\n');
}
function aiCamList() {
  const by = {};
  for (const t of CAM_TEMPLATES) {
    const c = t.cat || '其他';
    (by[c] = by[c] || []).push(`${t.id}=${t.label}(${t.dur}s)`);
  }
  return CAM_CATS.filter(c => by[c]).map(c => `  ${c}: ${by[c].join(', ')}`).join('\n');
}
function aiMoveList() {
  return '  ' + MOVE_TEMPLATES.map(t => `${t.id}=${t.label}`).join(', ');
}

/* ---------------- Prompt ---------------- */
/* 写入方式不同，模型该怎么写时间也不一样。这段要跟着模式变。 */
function aiModeBrief(mode) {
  if (mode === 'append') {
    return `【这次是「接在后面」】
用户这次要加的内容，要**接在已有时间线的末尾**，不要覆盖现有内容。
你写的时候一律**从 0 秒开始编号**（0 就代表这段新内容的开头），
不要自己去算现有内容排到几秒了 —— 系统会自动把整段搬到后面。
所以 at / dur 都按「这段新内容自己的时间轴」来填。`;
  }
  if (mode === 'replace') {
    return `【这次是「整场替换」】
这次要**重新搭一整场**：现有的角色、机位、片段在应用前会被全部清掉。
所以场景摘要里如果还有东西，那是「马上要被删掉的旧内容」，**不要引用它们**，
也不要写 del / clear（系统已经清过了）。用户需要什么，就直接重新建什么。
时间从 0 秒开始排。

**这一点最容易出错**：这批 ops 里，凡是要被操作的角色 / 机位，都必须**先自己建出来**。
ops 数组的顺序要「先建后用」：
  1) 先 addChar / addCam 把这场需要的角色和机位都建出来
  2) 再写 act / moveTo / moveStyle / face / shot / camMove 去操作它们
用户指令里点名的角色（哪怕场景里原来有同名的），也要先 addChar 建一个同名的。
只引用、不建的，系统只能按默认位置（画面正中 / 近处）补一个出来 ——
位置就不是你说了算了，用户还得手动挪。`;
  }
  return `【这次是「就地修改」】
在现有场景上直接改。at 里填的秒数就是时间线上的真实时间。`;
}

function aiSystemPrompt(mode) {
  mode = AI_MODES[mode] ? mode : 'inplace';
  return `你是「分镜调度台」的编排助手。用户用中文说想怎么改分镜，你把它翻译成一个 JSON 操作列表。

${aiModeBrief(mode)}

【角色名怎么认】很重要，认错了整条操作就废了：
- 用户说的名字如果场景里**没有**，但场景里**只有一个角色**，就认为他在说那个角色。
- 用户说的名字场景里没有、且明显是在要求新增（说了「加 / 来一个 / 新增 / 再要一个」），才用 addChar。
- 拿不准就用场景里已有的名字，不要凭空造一个新角色。
- face / dir 要表达「看着某人」时，**直接填那个人的名字**（比填方位词准）。

【硬性要求】
- 只输出一个 JSON 对象，形如 {"ops":[ ... ]}。
- 不要输出任何解释、前言、后记，不要用 markdown 代码块包裹。
- 不要输出思考过程，不要出现  thinking 标签。
- 字段名只能用下面规定的小写英文名，不要自己发明字段。
- 只做用户要求的事，不要顺手改别的东西。用户没提到的时间和对象不要动。

【方位词】at / to / dir 三个字段都从这里选：
  center 画面正中 | north 远处(画面上方) | south 近处(画面下方) | west 左侧 | east 右侧
  nw 左上 | ne 右上 | sw 左下 | se 右下
  （north = 远处、背对观众；south = 近处、面向观众）

【shot 还是 camMove】这条最容易搞错：
- 判断依据是「**这台机位有没有旧运镜可叠**」：看场景摘要里那台机位的「关键帧 N 个」。
  如果 N=0，或者它下面没有「已做运镜」那一行，说明它还没做过运镜 ——
  用户这次要的就是**新的一段** → 用 **shot**（挑一个最贴近的运镜模板，效果比硬平移好）。
- 只有这台机位**已经有运镜了**，用户又在说「再 / 又 / 同时 / 一边…一边 /
  在…的基础上 / 这个镜头」，才是要**叠加** → 用 **camMove**。
- 原因：shot 会**删掉**它开始时间点之后的旧关键帧（等于重做那段运镜）；
  camMove 是在旧关键帧上做偏移，两者能叠在一起。该用 camMove 时用了 shot，
  用户前面调好的运镜就没了。
- 用户说「这个镜头」时，去看场景摘要里每台机位的「已做运镜」，
  挑那台（或当前镜头）填进 who；拿不准就省略 who，默认作用于当前镜头。
- camMove **不要写 at**（也别写 dur）。省略它，系统会自动把这段位移对齐到最近一段运镜上。
  写 at:0 会把叠加挪到时间线开头 —— 用户要的「在后拉的同时往上」就变成
  「先升高、再后拉」，完全不是那个意思。只有用户**明确报出秒数**（如「从第 5 秒开始」）才写。

【操作清单】
1  {"op":"addChar","name":"男主","at":"west","face":"east"}
     加角色。at 省略=center；face 省略=north。
2  {"op":"addCam","at":"south","height":1.6,"fov":45,"target":"男主"}
     加摄像机。target 填角色名 = 跟随该角色（省略则不跟随）。
3  {"op":"del","who":"女主"}
     删除角色或机位。
4  {"op":"shift","who":"女主","dir":"west","meters":2}
     整体平移（走位路径一起移）。这是「把某人往某方向挪几米」用的。
5  {"op":"moveTo","who":"男主","to":"center","dur":2.5,"at":0,"face":"south"}
     从当前位置走一条直线到目标方位。at 省略 = 当前时间；face 省略 = 沿路径朝向。
6  {"op":"moveStyle","who":"男主","style":"arc","at":0,"dur":3}
     按走位模板生成走位（相对角色当前朝向）。
7  {"op":"act","who":"男主","action":"combo","at":2.5,"dur":1.6,"loop":true}
     插入动作。dur / loop 省略就用该动作的默认值。
     转身（左转 / 右转 / 面向镜头）也用 act，id 见动作清单里的「转身」组 ——
     它们改的是**朝向**不是姿态，角度按角色当前朝向算。
8  {"op":"face","who":"男主","dir":"south"}
     转身。dir 也可以填另一个角色的名字，表示看向他。
9  {"op":"shot","template":"dollyZoom","at":0,"target":"男主"}
     给当前镜头**新加**一段运镜（时长由模板决定，不用填 dur）。
10 {"op":"camMove","who":"机位1","dir":"up","meters":2}
     在**已有运镜上叠加**一段位移：让机位在一段时间里线性移动 meters 米，之后保持。
     dir 用 up/down（改机位高度）或方位词（改水平位置）。
     **at / dur 默认都不要写** —— 省略 at 就自动叠在「这台机位最近一段运镜」上
     （起止秒数都跟那段对齐），省略 dur 就跟那段一样长。只有用户明确报了秒数才写。
11 {"op":"set","duration":12}
     改总时长。也可以 {"op":"set","name":"巷战"} 或 {"op":"set","bg":"plaza"}。
12 {"op":"clear","what":"clips","who":"男主"}
     what = all | chars | cams | clips | keys。clips/keys 建议带上 who。

【可用动作 id（act 用）】
${aiActionList()}

【可用运镜 id（shot 用）】
${aiCamList()}
  注意：follow / overShoulder 是「跟随」类 —— 机位位置每帧由目标角色算出来，不用关键帧。
  其余运镜都是**关键帧**驱动的自主运动。两者互斥：往正在跟随的机位上套自主运镜
  会**关掉跟随**（日志里会说明），所以别同时要「跟随」和「绕圈」。
  shot 的 target 是「主体」：绕圈类（orbit / spiralIn / arcRise）拿它当圆心，
  跟随类（follow / overShoulder）拿它当跟随目标。target 必须填**角色名**。

【可用走位模板 id（moveStyle 用）】
${aiMoveList()}

【示例】
用户：男主从左边走到中间，然后打一套连续拳
输出：{"ops":[{"op":"moveTo","who":"男主","to":"center","dur":2.5,"at":0},{"op":"act","who":"男主","action":"combo","at":2.5}]}

用户：加一个女主站在右边，深情看着男主
输出：{"ops":[{"op":"addChar","name":"女主","at":"east","face":"男主"}]}

用户：把女主往左挪 2 米
输出：{"ops":[{"op":"shift","who":"女主","dir":"west","meters":2}]}

用户：结尾加一个环绕男主转一圈的运镜
输出：{"ops":[{"op":"shot","template":"orbit","at":5,"target":"男主"}]}

用户：镜头一边后拉一边往上抬 2 米
输出：{"ops":[{"op":"shot","template":"dollyOut","at":0},{"op":"camMove","dir":"up","meters":2}]}

用户：让这个镜头在后拉的同时往上升一点
输出：{"ops":[{"op":"camMove","dir":"up","meters":1.5}]}

用户：时长改成 12 秒，名字叫巷战
输出：{"ops":[{"op":"set","duration":12},{"op":"set","name":"巷战"}]}

用户：男主蹲下，然后高踢腿
输出：{"ops":[{"op":"act","who":"男主","action":"crouch","at":0},{"op":"act","who":"男主","action":"highKick","at":0.8}]}`;
}

function aiUserPrompt(instruction, mode) {
  return `【当前场景】
${aiSceneSummary(mode)}

【用户要求】
${instruction}

只输出 JSON。`;
}

/* ---------------- 调代理 ---------------- */
/* 当前走哪条通道。代理是唯一权威（配置文件在它那边），
   这里只是个缓存，每次开面板都会用 /health 同步回来。 */
let AI_PROVIDER = 'comfyui';

async function aiHealth() {
  const r = await fetch(AI_ENDPOINT + '/health', { cache: 'no-store' });
  if (!r.ok) throw new Error('代理返回 HTTP ' + r.status);
  const h = await r.json();
  if (h.provider) AI_PROVIDER = h.provider;
  return h;
}

/* ---------------- 配置（通道 / API） ----------------
   代理是唯一持有真实 API Key 的地方，浏览器这边拿到的永远是打码版。
   保存时：Key 输入框如果还是打码值，就当「没改」传空串，代理会保留原值。 */
async function aiGetConfig() {
  const r = await fetch(AI_ENDPOINT + '/config', { cache: 'no-store' });
  if (!r.ok) throw new Error('代理返回 HTTP ' + r.status);
  return r.json();
}
async function aiSaveConfig(patch) {
  const r = await fetch(AI_ENDPOINT + '/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || ('保存失败 HTTP ' + r.status));
  if (j.config && j.config.provider) AI_PROVIDER = j.config.provider;
  return j.config;
}
/* 试连。注意：连不上时代理也返回 200，要看 body.ok */
async function aiTestConn(provider) {
  const r = await fetch(AI_ENDPOINT + '/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('测试失败 HTTP ' + r.status));
  return j;
}

async function aiRun(instruction, onPhase, opts) {
  opts = opts || {};
  let r;
  try {
    r = await fetch(AI_ENDPOINT + '/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: aiSystemPrompt(opts.mode),
        user: aiUserPrompt(instruction, opts.mode),
        provider: opts.provider || AI_PROVIDER,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    });
  } catch (e) {
    throw new Error('连不上 AI 代理（' + AI_ENDPOINT + '）。请先双击运行「启动AI.bat」。');
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || ('代理返回 HTTP ' + r.status));
  }
  const { jobId } = await r.json();
  const t0 = Date.now();
  while (Date.now() - t0 < AI_MAX_WAIT) {
    await new Promise(res => setTimeout(res, AI_POLL_MS));
    const jr = await fetch(AI_ENDPOINT + '/job/' + jobId, { cache: 'no-store' });
    if (!jr.ok) throw new Error('作业丢了（代理可能被重启了）');
    const j = await jr.json();
    if (onPhase) onPhase(j);
    if (j.status === 'done') return j;
    if (j.status === 'error') throw new Error(j.error || '模型执行失败');
    if (j.status === 'cancelled') throw new Error('已取消');
  }
  throw new Error('等太久了（超过 ' + (AI_MAX_WAIT / 60000) + ' 分钟）');
}

/* ---------------- 校验 + 应用 ---------------- */
function aiValidate(json) {
  const warns = [];
  if (json == null) return { ops: [], warns: ['模型没有输出 JSON'] };
  /* 模型/代理可能给出几种形状，这里都认：
     裸数组 / {ops:[...]} / {operations:[...]} / 单个 {op:...} */
  let list;
  if (Array.isArray(json)) list = json;
  else if (typeof json === 'object') list = json.ops || json.operations || (json.op ? [json] : null);
  if (!Array.isArray(list)) return { ops: [], warns: ['JSON 里没有 ops 数组'] };
  const ops = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') { warns.push('跳过非对象项：' + JSON.stringify(raw).slice(0, 60)); continue; }
    const op = String(raw.op || '').trim();
    if (!AI_OPS[op]) { warns.push('不认识的操作「' + op + '」，已跳过'); continue; }
    ops.push(raw);
  }
  return { ops, warns };
}

/* camMove 用的方向词解析。和 aiDirKey 分开，因为多了 up/down。 */
function aiCamDirKey(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  if (AI_CAM_DIRS[t] != null) return t;
  return AI_CAM_DIR_ALIAS[t] || null;
}

/* 把机位沿某方向「叠加」一段位移：在 [t0, t0+dur] 内线性增加，之后保持。
   关键点是**对已有键做偏移**，不是重建键 —— 所以能和已有的运镜叠在一起。
   这就是「先让镜头后拉，再让它在后拉的同时往上」的底层实现：
   后拉写下了两个键，这里只把这两个键的高度按斜坡抬高，横移部分原样不动。 */
function aiCamOffset(cam, dir, meters, t0, dur) {
  const isV = (dir === 'up' || dir === 'down');
  const amt = meters * (dir === 'down' ? -1 : 1);
  const label = isV ? (amt > 0 ? '抬高' : '压低') : '平移';

  /* 跟随机位的高度由 follow.height 决定，键里的 height 会被 evalCam 覆盖。
     这种情况改键是白改，只能直接改 follow.height（代价：做不出渐变）。 */
  if (isV && cam.follow && cam.follow.targetId) {
    const base = cam.follow.height == null ? cam.height : cam.follow.height;
    cam.follow.height = +(base + amt).toFixed(3);
    return label + ' ' + Math.abs(amt).toFixed(1) + 'm（跟随机位，改的是跟随高度，没法渐变）';
  }

  /* 水平方向同理：跟随机位的 x / y 每帧由目标算出来，改键也是白改 ——
     以前这里默默写下一批永远不会生效的键，日志还写着「平移 2m」，属于说谎。
     现在改成：先把「当前跟随到哪儿」烘成一个关键帧，再关掉跟随，然后照常偏移。
     代价是这台机位不再跟人了，所以日志里必须说清楚（用户能自己再套回 follow）。 */
  let baked = '';
  if (!isV && cam.follow && cam.follow.targetId) {
    const tg = getObj(cam.follow.targetId);
    const at0 = evalCam(cam, t0);            /* 必须在关掉 follow 之前取 */
    cam.follow = null;
    if (!cam.keys) cam.keys = [];
    if (!cam.keys.some(k => Math.abs(k.t - t0) <= .02)) cam.keys.push(mkKey(t0, at0));
    baked = '（原来是跟随机位，已改为关键帧控制' + (tg ? '，不再跟随' + tg.name : '') + '）';
  }

  /* 两端状态必须在偏移「之前」取，否则会把自己算进去 */
  const s0 = evalCam(cam, t0), s1 = evalCam(cam, t0 + dur);
  if (!cam.keys) cam.keys = [];
  const keys = cam.keys;
  const hasAt = t => keys.some(k => Math.abs(k.t - t) <= .02);

  const ramp = t => {
    if (t <= t0 + 1e-6) return 0;
    if (t >= t0 + dur - 1e-6) return amt;
    return amt * (t - t0) / dur;
  };
  /* 注意单位：height 是米，键里的 x/y 是像素。水平方向必须乘 pxPerMeter ——
     漏乘的话「往左移 2 米」只会挪 2 个像素，肉眼几乎看不出来。 */
  const pm = App.state.pxPerMeter;
  const v = isV ? null : dirVec(AI_DIRS[dir] * DEG);
  const shift = (k, d) => {
    if (isV) k.height = +(k.height + d).toFixed(3);
    else {
      const dx = v.x * d * pm, dy = v.y * d * pm;
      k.x = +(k.x + dx).toFixed(2);
      k.y = +(k.y + dy).toFixed(2);
      /* 整段平移 = 圆心跟着一起平移。只搬键、不搬圆心的话，
         弧插值会拿旧圆心去算 —— 键都挪了，画面却会歪掉甚至反向。 */
      if (k.arc) { k.arc.cx = +(k.arc.cx + dx).toFixed(2); k.arc.cy = +(k.arc.cy + dy).toFixed(2); }
    }
  };

  for (const k of keys) { const d = ramp(k.t); if (d) shift(k, d); }

  /* 窗口两端得有键，否则斜坡落不到实处 ——
     比如已有键只在 0s 和 2s，窗口是 0~3s，那 3s 处的抬升量就没人承载。 */
  if (!hasAt(t0)) keys.push(mkKey(t0, s0));
  if (!hasAt(t0 + dur)) {
    const k = mkKey(t0 + dur, s1);
    shift(k, amt);                      /* 端点 = 原状态 + 全额偏移 */
    keys.push(k);
  }
  keys.sort((a, b) => a.t - b.t);
  return label + ' ' + Math.abs(amt).toFixed(1) + 'm' + baked;
}

/* 给对象设置朝向：优先认「另一个角色的名字」= 看向他，其次认方位词 */
function aiFaceAngle(obj, dir, fallback) {
  if (dir == null || dir === '') return fallback;
  const other = aiFindObj(dir);
  if (other && other.id !== obj.id) return angOf(other.x - obj.x, other.y - obj.y);
  const k = aiDirKey(dir);
  if (k) return AI_DIRS[k] * DEG;
  return fallback;
}
/* 插一段转身，让朝向变化是「转过去」而不是瞬移。
   注意 AI 给的 face 是**绝对方位**，没指定绕哪边，所以扫角取最短弧（angDelta）。
   这和界面按钮不一样：左转 / 右转是相对角度，方向由动作定死，见 insertActionClip。 */
function aiInsertTurn(o, toAngle, t) {
  if (toAngle == null) return;
  const start = +clamp(t, 0, App.state.duration).toFixed(2);
  const from = evalChar(o, Math.max(0, start - .01)).angle;
  /* to 保持模型给的那个绝对方位（可能是 270° 这种 >180° 的值），
     sweep 单独记「该往哪边扫」—— 两者解耦，界面显示和插值各取所需。 */
  o.clips.push({
    id: uid('cp'), kind: 'turn', start, dur: .6,
    from, to: toAngle, sweep: angDelta(from, toAngle), ease: 'inout',
  });
}

function aiApplyOne(o) {
  const st = App.state;
  switch (o.op) {

    case 'addChar': {
      const w = aiAnchorWorld(o.at) || { x: st.bgW / 2, y: st.bgH / 2 };
      if (o.at != null && !aiAnchorWorld(o.at)) throw new Error('方位词不认识：' + o.at);
      const n = chars().length + 1;
      const c = createChar(w.x, w.y, n);
      let name = o.name ? String(o.name).trim() : ('角色' + n);
      if (aiFindObj(name)) name = name + '2';      // 别重名，否则后面 who 会指错人
      c.name = name;
      c.angle = aiFaceAngle(c, o.face, 0);
      st.objects.push(c);
      App.lastCharId = c.id;
      return `加角色「${c.name}」在 ${aiPosDesc(c.x, c.y)}，朝向 ${aiAngleName(c.angle)}`;
    }

    case 'addCam': {
      const w = aiAnchorWorld(o.at) || { x: st.bgW / 2, y: st.bgH * .9 };
      const n = cams().length + 1;
      const k = createCam(w.x, w.y, n);
      let name = o.name ? String(o.name).trim() : ('机位' + n);
      if (aiFindObj(name)) name = name + '2';
      k.name = name;
      if (o.height != null) k.height = clamp(+o.height, .2, 30);
      if (o.fov != null) k.fov = clamp(+o.fov, 12, 110);
      if (o.pitch != null) k.pitch = clamp(+o.pitch, -60, 85) * DEG;
      const tg = o.target ? aiFindObj(o.target) : null;
      /* 没给朝向时，让机位看向目标角色，否则看向画面中心 */
      const aim = tg || { x: st.bgW / 2, y: st.bgH / 2 };
      k.angle = aiFaceAngle(k, o.dir, angOf(aim.x - k.x, aim.y - k.y));
      if (tg) k.follow = { targetId: tg.id, dist: 4, side: 0, height: k.height };
      st.objects.push(k);
      if (!st.activeCam) st.activeCam = k.id;
      return `加机位「${k.name}」在 ${aiPosDesc(k.x, k.y)}，高${k.height}m fov${k.fov}°${tg ? '，跟随' + tg.name : ''}`;
    }

    case 'del': {
      const o2 = aiFindObj(o.who);
      /* 替换模式下场景已经清空了，「del 一个本来就没有的东西」不算错 ——
         用户的意思已经达成了。这里不要去 aiNeedObj：那会先把对象建出来再删掉。 */
      if (!o2 && AI_REPLACE_CTX) return `「${o.who}」在替换后的场景里本来就没有，无需删除`;
      if (!o2) aiNeedObj(o.who, 'char');          // 借它抛出「能照着改」的错
      st.objects = st.objects.filter(x => x.id !== o2.id);
      if (st.activeCam === o2.id) st.activeCam = (cams()[0] || {}).id || null;
      if (App.sel && App.sel.id === o2.id) App.sel = null;
      return `删掉了「${o2.name}」`;
    }

    case 'shift': {
      const o2 = aiNeedObj(o.who, 'char');
      const k = aiDirKey(o.dir);
      if (!k) throw new Error('方位词不认识：' + o.dir);
      const m = (o.meters == null ? 1 : +o.meters) * st.pxPerMeter;
      const v = dirVec(AI_DIRS[k] * DEG);
      const dx = v.x * m, dy = v.y * m;
      o2.x += dx; o2.y += dy;
      /* 走位路径必须一起移。只挪 o.x/o.y 的话，一播放就被路径拉回去。 */
      for (const c of (o2.clips || [])) {
        if (c.kind === 'move' && c.path) for (const p of c.path) { p.x += dx; p.y += dy; }
      }
      return `把「${o2.name}」往 ${k} 挪了 ${(m / st.pxPerMeter).toFixed(1)}m`;
    }

    case 'moveTo': {
      const o2 = aiNeedObj(o.who, 'char');
      const w = aiAnchorWorld(o.to);
      if (!w) throw new Error('方位词不认识：' + o.to);
      const t = o.at == null ? App.time : +o.at;
      const dur = o.dur == null ? 2.5 : +o.dur;
      insertMoveClip(o2, [{ x: o2.x, y: o2.y }, { x: w.x, y: w.y }], t, dur);
      if (o.face != null) {
        o2.faceMove = false;
        aiInsertTurn(o2, aiFaceAngle(o2, o.face, null), t);
      }
      return `「${o2.name}」从 ${t.toFixed(1)}s 起走 ${dur}s 到 ${aiPosDesc(w.x, w.y)}`;
    }

    case 'moveStyle': {
      const o2 = aiNeedObj(o.who, 'char');
      const tpl = MOVE_TEMPLATES.find(x => x.id === String(o.style));
      if (!tpl) throw new Error('没有这个走位模板：' + o.style + '（可用：' + MOVE_TEMPLATES.map(x => x.id).join(',') + '）');
      const t = o.at == null ? App.time : +o.at;
      const dur = o.dur == null ? tpl.dur : +o.dur;
      /* 走模板统一走 moveSpec —— 环绕类的 make() 会额外返回圆心，
         带上它求值时才走圆弧而不是折线（界面按钮走的是同一条路）。 */
      const sp = moveSpec(tpl, o2, st.pxPerMeter);
      insertMoveClip(o2, sp.path, t, dur, null, sp.arc);
      return `「${o2.name}」走位模板 ${tpl.label}${sp.arc ? '（圆弧）' : ''}`;
    }

    case 'act': {
      const o2 = aiNeedObj(o.who, 'char');
      const t = o.at == null ? App.time : +o.at;
      const c = insertActionClip(o2, String(o.action), t, { dur: o.dur, loop: o.loop });
      /* 转身类动作产出的是 turn 片段（没有 action / loop 字段），文案要分开 ——
         照抄 c.action 会拿到 undefined。 */
      const lab = actionLabel(String(o.action));
      if (c.kind === 'turn') {
        return `「${o2.name}」在 ${c.start}s 转身 ${lab}（${c.dur}s，转到 ${aiAngleName(c.to)}）`;
      }
      return `「${o2.name}」在 ${c.start}s 插动作 ${lab}（${c.dur}s${c.loop ? ' 循环' : ''}）`;
    }

    case 'face': {
      const o2 = aiNeedObj(o.who, 'char');
      const t = o.at == null ? App.time : +o.at;
      const a = aiFaceAngle(o2, o.dir, null);
      if (a == null) throw new Error('朝向不认识：' + o.dir);
      o2.faceMove = false;
      aiInsertTurn(o2, a, t);
      return `「${o2.name}」在 ${t.toFixed(1)}s 转向 ${aiAngleName(a)}`;
    }

    case 'shot': {
      const cam = aiNeedCam();
      const t = o.at == null ? App.time : +o.at;
      /* target 必须是**角色**。实测模型在「场上只有机位、没有角色」的时候，
         会把这台机位自己的名字填进 target —— 于是 orbit 以镜头自己为圆心，
         半径退化成 0.8m 的小圈（直径 80px），画面上几乎看不出在动。
         这种「指错人」按「没给 target」处理：退回镜头正前方，照样能绕起来。 */
      const tg = o.target ? aiFindObj(o.target) : null;
      const tgc = tg && tg.type === 'char' ? tg : null;
      const s2 = tgc ? evalChar(tgc, t) : null;
      const r = insertCamTemplate(cam, String(o.template), t, {
        target: s2 ? { x: s2.x, y: s2.y } : null,
        targetId: tgc ? tgc.id : null,
      });
      return `给「${cam.name}」在 ${t.toFixed(1)}s 加运镜 ${r.tpl.label}` +
        (r.followOff ? '（原来是跟随机位，已关闭跟随、改用关键帧）' : '') +
        (r.cut && r.cut.length ? '；注意它覆盖了「' + r.cut.join('」「') + '」在 ' + t.toFixed(1) + 's 之后的部分' : '');
    }

    case 'camMove': {
      /* 在已有运镜上叠加一段位移。和 shot 的区别很重要：
         shot 是「生成一段新运镜」，会切掉 t0 之后的旧关键帧；
         camMove 是「在旧关键帧上做偏移」，两者能叠在一起。
         用户说「在这个镜头后拉的同时往上」时，模型应该输出 camMove 而不是 shot。 */
      const cam = o.who ? aiNeedObj(o.who, 'cam') : aiNeedCam();
      if (cam.type !== 'cam') throw new Error('「' + cam.name + '」不是机位，camMove 只能作用于机位');
      const dk = aiCamDirKey(o.dir);
      if (!dk) throw new Error('方向不认识：' + o.dir + '（可用 up/down/north/south/east/west/ne/nw/se/sw）');
      const meters = o.meters == null ? 1 : +o.meters;
      if (!isFinite(meters) || meters === 0) throw new Error('meters 要是非 0 的数字，收到：' + o.meters);

      /* at 省略 = 叠到「这台机位最近一段运镜」上（起止秒数都跟那段对齐）。
         为什么不让模型自己写 at：实测它会照抄示例里的 at:0，于是叠加跑到时间线
         开头去了 —— 用户要的「在后拉的同时往上」变成「先升高、再后拉」。
         和「接在后面」同一个教训：能让代码算的就别让模型算。 */
      const last = (cam.moves || []).slice().sort((a, b) => a.t - b.t).pop();
      const t0 = o.at == null ? (last ? +last.t : App.time) : +o.at;
      const dur = o.dur == null
        ? (last ? Math.max(.05, +last.dur || 1.5) : 1.5)
        : Math.max(.05, +o.dur);

      const what = aiCamOffset(cam, dk, meters, t0, dur);
      let tail = '';
      if (o.at == null && last) {
        const tpl = CAM_TEMPLATES.find(x => x.id === last.tpl);
        tail = `（叠在最近一段运镜${tpl ? '「' + tpl.label + '」' : ''}上）`;
      } else {
        /* 显式给了 at，但和这台机位已有的运镜没有任何重叠 —— 那就不是「叠加」了。
           不拦（有时用户确实想要一段独立的位移），但要说出来，别让人以为叠上了。 */
        const hit = (cam.moves || []).some(m =>
          m.t < t0 + dur - .05 && m.t + (+m.dur || 0) > t0 + .05);
        if ((cam.moves || []).length && !hit) tail = '（注意：这段没和已有运镜重叠）';
      }
      return `「${cam.name}」在 ${t0.toFixed(1)}~${(t0 + dur).toFixed(1)}s ${what}${tail}`;
    }

    case 'set': {
      const done = [];
      if (o.duration != null) { st.duration = clamp(+o.duration, 1, 120); done.push('时长→' + st.duration + 's'); }
      if (o.name != null) { st.name = String(o.name); done.push('名字→' + st.name); }
      if (o.pxPerMeter != null) { st.pxPerMeter = clamp(+o.pxPerMeter, 5, 500); done.push('比例→' + st.pxPerMeter + 'px/m'); }
      if (o.bg != null) {
        const kind = String(o.bg) === 'plaza' ? 'plaza' : 'street';
        /* 必须走 setBackground：它会顺带设 bgW/bgH 并重建 3D 贴图。
           只改 st.bg 的话画面不会变。这个是异步的（要等图片解码），
           所以回调里再刷新一次。 */
        setBackground(makeSampleBg(kind), () => { fitView(); refreshAll(); });
        App._sampleKind = kind;
        done.push('背景→' + (kind === 'plaza' ? '广场' : '街道'));
      }
      if (!done.length) throw new Error('set 里没有可改的字段（duration/name/bg/pxPerMeter）');
      return done.join('，');
    }

    case 'clear': {
      const what = String(o.what || 'clips');
      if (what === 'all') {
        st.objects = []; st.activeCam = null; App.sel = null;
        return '清空了整个场景';
      }
      if (what === 'chars') {
        st.objects = st.objects.filter(x => x.type !== 'char');
        if (App.sel && App.sel.kind === 'char') App.sel = null;
        return '删掉了所有角色';
      }
      if (what === 'cams') {
        st.objects = st.objects.filter(x => x.type !== 'cam');
        st.activeCam = (cams()[0] || {}).id || null;
        if (App.sel && App.sel.kind === 'cam') App.sel = null;
        return '删掉了所有机位';
      }
      const targets = o.who ? [aiNeedObj(o.who, 'char')] : st.objects.slice();
      let n = 0;
      for (const obj of targets) {
        if (what === 'keys') {
          n += (obj.keys || []).length; obj.keys = []; obj.follow = null;
          obj.moves = [];      /* 关键帧没了，运镜记录也不成立了 */
        } else {
          n += (obj.clips || []).length; obj.clips = [];
        }
      }
      return `清空了 ${what}（${n} 段）`;
    }
  }
  throw new Error('未实现的操作：' + o.op);
}

/* 应用整批操作。单条失败不影响其他条 —— 模型偶尔会写错一个 id，
   没必要把整次编排都废掉。返回逐条结果，界面照实展示。

   opts.mode 决定这批操作落在时间线的哪里：
     inplace —— 就地改（默认）
     append  —— 模型是从 0 写的，这里把整批的时间字段搬到时间线末尾
     replace —— 先清空整场，再从 0 开始搭
   返回的数组上挂了个 note（给界面显示一句「这批落在哪」）。 */
function aiApply(ops, opts) {
  opts = opts || {};
  const mode = AI_MODES[opts.mode] ? opts.mode : 'inplace';
  pushUndo();

  let note = '', bakSnap = null;
  if (mode === 'replace') {
    /* 清空是不可逆的，所以先留一份完整快照。
       如果最后一条都没落地，就整体还回去 —— 不能让用户「旧场景没了、新场景也没搭起来」。 */
    bakSnap = snapshot();
    App.state.objects = [];
    App.state.activeCam = null;
    App.sel = null;
    note = '整场替换：原有角色/机位/片段已清空';
  } else if (mode === 'append') {
    const T = aiTimelineEnd();
    if (T > 0) {
      ops = aiRebaseOps(ops, T);
      note = '接在已有内容之后（' + T + 's 起）';
    }
  }

  const log = [];
  /* 打开替换上下文：这之后 ops 里引用不到的名字会被「按用户说的建出来」，
     并在每条日志前面标注「（替换模式下自动新建了 X）」，免得用户以为是原来就有的。 */
  AI_REPLACE_CTX = (mode === 'replace');
  AI_AUTO = [];
  try {
    for (const o of ops) {
      const n0 = AI_AUTO.length;
      try {
        const msg = aiApplyOne(o);
        const made = AI_AUTO.slice(n0);
        log.push({
          op: o.op, ok: true, auto: made,
          msg: (made.length ? '（替换模式下自动新建了 ' + made.join('、') + '）' : '') + msg,
        });
      } catch (e) { log.push({ op: o.op, ok: false, msg: e.message }); }
    }
  } finally {
    AI_REPLACE_CTX = false;
  }

  if (mode === 'replace' && !log.some(x => x.ok)) {
    restoreSnap(bakSnap);
    note = ops.length
      ? '整场替换没成功：没有一条改动能落地，已恢复原场景'
      : '整场替换：模型没给出任何操作，原场景未改动';
    log.push({ op: '（回滚）', ok: false, msg: '没有产生任何有效改动，替换前的场景已完整保留' });
  }

  log.note = note;
  log.mode = mode;
  refreshAll();
  return log;
}

/* ---------------- 面板 UI ---------------- */
const AI_EXAMPLES = [
  '男主从左边走到中间，然后打一套连续拳',
  '加一个女主站在右边，深情看着男主',
  '把女主往左挪 2 米',
  '镜头一边后拉一边往上抬 2 米',
  '让这个镜头在后拉的同时往上升一点',
  '结尾加一个环绕男主转一圈的运镜',
  '男主高踢腿，然后被击倒',
];

function openAIPanel() {
  openModal('AI 编排 · 一句话改分镜', '');
  const body = $('#modal-body');
  body.innerHTML = '';
  body.classList.add('ai-body');

  /* --- 状态条 --- */
  const status = el('div', 'ai-status');
  status.innerHTML = '<i class="dot"></i><span>正在检查代理…</span>';
  body.appendChild(status);

  /* ============ 设置（默认折叠；没配全会自动展开） ============ */
  const setBox = el('details', 'ai-set');
  setBox.appendChild(el('summary', null, '设置 · 用哪个模型'));
  const setBody = el('div', 'ai-set-body');
  setBox.appendChild(setBody);

  /* 通道选择 */
  const fProv = el('div', 'frow');
  fProv.appendChild(el('label', null, '通道'));
  const selProv = el('select');
  selProv.innerHTML =
    '<option value="comfyui">本地 ComfyUI（免费，要排队）</option>' +
    '<option value="api">云端 API（快，要 Key）</option>';
  fProv.appendChild(selProv);
  setBody.appendChild(fProv);

  /* ---- ComfyUI 组 ---- */
  const mkChk = txt => {
    const l = el('label', 'ai-chk');
    const i = el('input'); i.type = 'checkbox';
    l.appendChild(i); l.appendChild(el('span', null, txt));
    return { l, i };
  };

  const gComfy = el('div', 'ai-grp');
  gComfy.dataset.panel = 'comfyui';
  gComfy.appendChild(el('div', 'ai-grphead', '本地 ComfyUI'));

  const fHost = el('div', 'frow');
  fHost.appendChild(el('label', null, '地址'));
  const inHost = el('input'); inHost.type = 'text'; inHost.placeholder = 'http://127.0.0.1:8188';
  fHost.appendChild(inHost);
  gComfy.appendChild(fHost);

  const fCModel = el('div', 'frow');
  fCModel.appendChild(el('label', null, '模型'));
  const inCModel = el('input'); inCModel.type = 'text';
  inCModel.placeholder = '留空 = 自动用 models/LLM 里第一个';
  fCModel.appendChild(inCModel);
  gComfy.appendChild(fCModel);

  const fCTok = el('div', 'frow');
  fCTok.appendChild(el('label', null, 'max_tokens'));
  const inCTok = el('input'); inCTok.type = 'number';
  inCTok.step = '100'; inCTok.min = '256'; inCTok.style.flex = '0 0 86px';
  fCTok.appendChild(inCTok);
  const lbNT = el('label', null, '关闭思考'); lbNT.style.flex = '0 0 auto';
  fCTok.appendChild(lbNT);
  const selNT = el('select');
  selNT.innerHTML = '<option value="auto">自动（Qwen 系开）</option>' +
    '<option value="on">强制开</option><option value="off">强制关</option>';
  selNT.style.flex = '0 0 130px';
  fCTok.appendChild(selNT);
  gComfy.appendChild(fCTok);
  gComfy.appendChild(el('div', 'ai-hint',
    '思考模型（Qwen3 等）会把预算耗在推理上，常导致 JSON 吐不出来。' +
    '关掉后实测快 3 倍、也不再截断。'));
  setBody.appendChild(gComfy);

  /* ---- API 组 ---- */
  const gApi = el('div', 'ai-grp');
  gApi.dataset.panel = 'api';
  gApi.appendChild(el('div', 'ai-grphead', '云端 API（OpenAI 兼容 /chat/completions）'));

  const fBase = el('div', 'frow');
  fBase.appendChild(el('label', null, 'Base URL'));
  const inBase = el('input'); inBase.type = 'text';
  inBase.placeholder = 'https://api.deepseek.com/v1';
  fBase.appendChild(inBase);
  gApi.appendChild(fBase);

  const fKey = el('div', 'frow');
  fKey.appendChild(el('label', null, 'API Key'));
  const inKey = el('input'); inKey.type = 'password'; inKey.autocomplete = 'off';
  inKey.placeholder = 'sk-...';
  fKey.appendChild(inKey);
  const btnClear = el('button', 'btn ghost', '清除');
  btnClear.style.flex = '0 0 auto';
  fKey.appendChild(btnClear);
  gApi.appendChild(fKey);

  const fModel = el('div', 'frow');
  fModel.appendChild(el('label', null, '模型名'));
  const inModel = el('input'); inModel.type = 'text';
  inModel.placeholder = 'deepseek-chat / gpt-4o-mini / qwen-plus';
  fModel.appendChild(inModel);
  gApi.appendChild(fModel);

  const fNum = el('div', 'frow');
  fNum.appendChild(el('label', null, '温度'));
  const inTemp = el('input'); inTemp.type = 'number';
  inTemp.step = '.1'; inTemp.min = '0'; inTemp.max = '2'; inTemp.style.flex = '0 0 62px';
  fNum.appendChild(inTemp);
  const lbTok = el('label', null, 'max_tokens'); lbTok.style.flex = '0 0 auto';
  fNum.appendChild(lbTok);
  const inTok = el('input'); inTok.type = 'number';
  inTok.step = '100'; inTok.min = '64'; inTok.style.flex = '0 0 86px';
  fNum.appendChild(inTok);
  gApi.appendChild(fNum);

  const fChk = el('div', 'row wrap');
  const cJson = mkChk('JSON 模式（推荐）');
  const cStream = mkChk('流式输出');
  fChk.appendChild(cJson.l); fChk.appendChild(cStream.l);
  gApi.appendChild(fChk);
  setBody.appendChild(gApi);

  /* ---- 设置底部 ---- */
  const setBar = el('div', 'ai-set-bar');
  const btnTest = el('button', 'btn', '测试连接');
  const btnSave = el('button', 'btn primary', '保存');
  const setMsg = el('span', 'ai-set-msg', '');
  setBar.appendChild(btnTest); setBar.appendChild(btnSave); setBar.appendChild(setMsg);
  setBody.appendChild(setBar);
  setBody.appendChild(el('div', 'ai-hint',
    'Key 只写在本机 <code>ai-config.json</code>，不会发到浏览器。' +
    'Key 留空或保持打码值 = 不改动；「测试连接」会先保存再测。'));

  body.appendChild(setBox);

  /* --- 写入方式：这批操作落在时间线的哪里 --- */
  const fMode = el('div', 'frow ai-mode');
  fMode.appendChild(el('label', null, '写入方式'));
  const selMode = el('select');
  selMode.innerHTML =
    '<option value="inplace">就地修改（在现有分镜上改）</option>' +
    '<option value="append">接在后面（不动已有内容）</option>' +
    '<option value="replace">整场替换（清空重搭）</option>';
  fMode.appendChild(selMode);
  const modeHint = el('span', 'ai-modehint', '');
  fMode.appendChild(modeHint);
  body.appendChild(fMode);

  function syncModeHint() {
    const m = selMode.value;
    if (m === 'append') {
      const T = aiTimelineEnd();
      modeHint.textContent = T > 0 ? '新内容从 ' + T + 's 之后开始' : '当前是空的，等于从头搭';
      modeHint.className = 'ai-modehint';
    } else if (m === 'replace') {
      modeHint.textContent = '⚠ 会先清空现有的角色 / 机位 / 片段（若一条都没成功会自动还原）';
      modeHint.className = 'ai-modehint warn';
    } else {
      modeHint.textContent = '';
      modeHint.className = 'ai-modehint';
    }
  }
  selMode.onchange = syncModeHint;
  syncModeHint();

  /* --- 输入 --- */
  const ta = el('textarea', 'ai-input');
  ta.placeholder = '用一句话说你想怎么改，例如：男主从左边走到中间，打一套连续拳';
  ta.rows = 3;
  body.appendChild(ta);

  const chips = el('div', 'ai-examples');
  for (const s of AI_EXAMPLES) {
    const b = el('button', 'ai-ex', s);
    b.onclick = () => { ta.value = s; ta.focus(); };
    chips.appendChild(b);
  }
  body.appendChild(chips);

  /* --- 按钮 --- */
  const bar = el('div', 'ai-bar');
  const run = el('button', 'btn primary', '生成并应用');
  const cancel = el('button', 'btn ghost', '取消');
  cancel.style.display = 'none';
  const phase = el('span', 'ai-phase', '');
  bar.appendChild(run);
  bar.appendChild(cancel);
  bar.appendChild(phase);
  body.appendChild(bar);

  /* --- 结果区 --- */
  const out = el('div', 'ai-out');
  body.appendChild(out);

  let jobId = null, busy = false;

  /* ---------- 设置区的读写 ---------- */
  function showPanel(prov) {
    for (const g of setBody.querySelectorAll('[data-panel]'))
      g.style.display = g.dataset.panel === prov ? '' : 'none';
  }
  /* 把代理返回的配置铺到表单上。Key 永远不铺真实值 —— 只放打码值当占位。 */
  function fillConfig(c) {
    if (!c) return;
    selProv.value = c.provider || 'comfyui';
    showPanel(selProv.value);
    const cu = c.comfyui || {}, a = c.api || {};
    inHost.value = cu.host || '';
    inCModel.value = cu.model || '';
    inCTok.value = cu.maxTokens == null ? 2400 : cu.maxTokens;
    selNT.value = cu.noThink == null || cu.noThink === '' ? 'auto' : (cu.noThink ? 'on' : 'off');
    inBase.value = a.baseUrl || '';
    inModel.value = a.model || '';
    inTemp.value = a.temperature == null ? .3 : a.temperature;
    inTok.value = a.maxTokens == null ? 1400 : a.maxTokens;
    cJson.i.checked = a.jsonMode !== false;
    cStream.i.checked = a.stream !== false;
    inKey.value = '';
    inKey.placeholder = a.hasKey ? (a.apiKeyMasked + '（已保存 · 改就覆盖）') : 'sk-...';
  }
  /* 表单 → 配置补丁。apiKey 传空串 = 代理那边保留原值。 */
  function collect() {
    return {
      provider: selProv.value,
      comfyui: {
        host: inHost.value.trim() || 'http://127.0.0.1:8188',
        model: inCModel.value.trim(),
        maxTokens: Math.max(256, Math.round(+inCTok.value) || 2400),
        noThink: selNT.value === 'auto' ? null : (selNT.value === 'on'),
      },
      api: {
        baseUrl: inBase.value.trim(),
        apiKey: inKey.value.trim(),
        model: inModel.value.trim(),
        temperature: Math.max(0, Math.min(2, +inTemp.value || 0)),
        maxTokens: Math.max(64, Math.round(+inTok.value) || 1400),
        jsonMode: cJson.i.checked,
        stream: cStream.i.checked,
      },
    };
  }

  /* 状态条 + 表单同步。开面板、保存、测试之后都调它。 */
  async function refreshStatus() {
    try {
      const h = await aiHealth();
      fillConfig(h.config);
      if (h.provider === 'api') {
        if (!h.ready) {
          status.className = 'ai-status warn';
          status.innerHTML = '<i class="dot"></i><span>通道 <b>云端 API</b>　还没配全：' +
            (h.error || '') + '<br>在下面「设置」里填 Base URL / API Key / 模型名，再点保存。</span>';
          setBox.open = true;
          return;
        }
        status.className = 'ai-status ok';
        status.innerHTML = '<i class="dot"></i><span>通道 <b>云端 API</b>　模型 <b>' + (h.model || '—') +
          '</b><br>' + (h.baseUrl || '') + '</span>';
        return;
      }
      if (!h.comfy) {
        status.className = 'ai-status bad';
        status.innerHTML = '<i class="dot"></i><span>代理通了，但连不上 ComfyUI（' + (h.error || '') +
          '）。<br>请先启动 ComfyUI；或在「设置」里改用云端 API。</span>';
        return;
      }
      const busyTxt = h.busy
        ? `　⚠ ComfyUI 正在跑别的任务（${h.queue.running} 个），你的请求会排队`
        : '　队列空闲';
      status.className = 'ai-status' + (h.busy ? ' warn' : ' ok');
      status.innerHTML = '<i class="dot"></i><span>通道 <b>本地 ComfyUI</b>　模型 <b>' + h.model +
        '</b>　ComfyUI ' + (h.version || '') + busyTxt +
        (h.noThink ? '　思考已关' : '') + '</span>';
    } catch (e) {
      status.className = 'ai-status bad';
      status.innerHTML = '<i class="dot"></i><span>' + e.message +
        '<br>在工具目录下双击 <b>启动AI.bat</b> 即可。</span>';
      setBox.open = true;
    }
  }

  selProv.onchange = () => showPanel(selProv.value);

  btnSave.onclick = async () => {
    btnSave.disabled = true; setMsg.textContent = '保存中…';
    try {
      const c = await aiSaveConfig(collect());
      AI_PROVIDER = c.provider;
      fillConfig(c);
      setMsg.textContent = '✓ 已保存';
      toast('AI 设置已保存');
      refreshStatus();
    } catch (e) { setMsg.textContent = '✗ ' + e.message; }
    btnSave.disabled = false;
  };

  btnClear.onclick = async () => {
    try {
      await aiSaveConfig({ api: { apiKeyClear: true } });
      setMsg.textContent = '✓ Key 已清除';
      fillConfig(await aiGetConfig());
    } catch (e) { setMsg.textContent = '✗ ' + e.message; }
  };

  btnTest.onclick = async () => {
    const want = selProv.value;
    btnTest.disabled = true; setMsg.textContent = '保存中…';
    try {
      await aiSaveConfig(collect());
    } catch (e) { setMsg.textContent = '✗ ' + e.message; btnTest.disabled = false; return; }
    setMsg.textContent = '测试中…（最多等一会儿）';
    try {
      const r = await aiTestConn(want);
      if (r.ok) {
        setMsg.textContent = '✓ 通了 · ' + (r.provider === 'api' ? '云端 API' : '本地 ComfyUI') +
          ' · ' + (r.model || '') + ' · ' + ((r.ms || 0) / 1000).toFixed(1) + 's · 回声「' +
          String(r.text || '').slice(0, 20) + '」';
        toast('连接正常');
      } else setMsg.textContent = '✗ ' + r.error;
      fillConfig(await aiGetConfig());
      refreshStatus();
    } catch (e) { setMsg.textContent = '✗ ' + e.message; }
    btnTest.disabled = false;
  };

  /* 开面板就查一次 */
  refreshStatus();

  function setBusy(v) {
    busy = v;
    run.disabled = v;
    run.textContent = v ? '生成中…' : '生成并应用';
    cancel.style.display = v ? '' : 'none';
  }

  cancel.onclick = async () => {
    if (!jobId) return;
    try { await fetch(AI_ENDPOINT + '/cancel/' + jobId, { method: 'POST' }); } catch (e) { }
    phase.textContent = '正在取消…';
  };

  run.onclick = async () => {
    const text = ta.value.trim();
    if (!text) { toast('先说一句你想怎么改'); ta.focus(); return; }
    if (busy) return;
    const mode = selMode.value;
    if (mode === 'replace') {
      const n = App.state.objects.length;
      if (n && !confirm('「整场替换」会先清空现有的 ' + n + ' 个对象（角色/机位）和它们的片段。\n继续吗？')) return;
    }
    setBusy(true);
    out.innerHTML = '';
    jobId = null;
    const t0 = Date.now();

    try {
      const job = await aiRun(text, j => {
        jobId = j.id;
        const sec = Math.round((Date.now() - t0) / 1000);
        let s = j.phase || '…';
        if (j.phase === '排队中' && j.queuePos) s = `排队中（前面还有 ${j.queuePos - 1} 个任务）`;
        if (j.busyWith) s += ' · ' + j.busyWith;
        if (j.outChars) s = '生成中 · 已吐 ' + j.outChars + ' 字';
        phase.textContent = s + ' · ' + sec + 's';
      }, { mode });

      phase.textContent = '完成 · ' + ((job.ms || 0) / 1000).toFixed(1) + 's' +
        (job.model ? ' · ' + job.model : '');

      /* 模型原文（折叠起来，方便排查） */
      const rawBox = el('details', 'ai-raw');
      rawBox.appendChild(el('summary', null, '模型原始输出'));
      const pre = el('pre');
      pre.textContent = job.text || '（空）';
      rawBox.appendChild(pre);
      out.appendChild(rawBox);

      if (!job.json) {
        const bad = el('div', 'ai-err');
        bad.textContent = job.parseError || '模型没有输出可解析的 JSON，换个说法再试一次。';
        out.appendChild(bad);
        setBusy(false);
        return;
      }

      const v = aiValidate(job.json);
      if (v.warns.length) {
        const w = el('div', 'ai-warn');
        w.innerHTML = '<b>已跳过 ' + v.warns.length + ' 项：</b><br>' + v.warns.map(x => '· ' + x).join('<br>');
        out.appendChild(w);
      }
      if (!v.ops.length) {
        out.appendChild(el('div', 'ai-err', '模型没有给出任何可执行的操作。'));
        setBusy(false);
        return;
      }

      const log = aiApply(v.ops, { mode });
      const okN = log.filter(x => x.ok).length;
      const list = el('div', 'ai-log');
      list.appendChild(el('div', 'ai-loghead',
        `执行了 ${okN}/${log.length} 项${log.note ? '　· ' + log.note : ''}：`));
      for (const it of log) {
        const r = el('div', 'ai-item' + (it.ok ? '' : ' fail'));
        r.innerHTML = '<b>' + (it.ok ? '✓' : '✗') + '</b> ' + it.op + ' — ' + it.msg;
        list.appendChild(r);
      }
      out.appendChild(list);
      if (okN) {
        out.appendChild(el('div', 'ai-hint', '不满意可以按 Ctrl+Z 撤销，或换个说法重说一次。'));
        toast('AI 已应用 ' + okN + ' 项修改');
      }
      syncModeHint();
    } catch (e) {
      const bad = el('div', 'ai-err');
      bad.textContent = e.message;
      out.appendChild(bad);
      phase.textContent = '失败';
    }
    setBusy(false);
  };

  ta.focus();
  ta.onkeydown = ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); run.onclick(); }
  };
}

