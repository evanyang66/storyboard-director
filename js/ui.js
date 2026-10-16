'use strict';
/* ============================================================
   ui.js — 面板 / 画布交互 / 时间轴 / 属性联动
   ============================================================ */

function $(s) { return document.querySelector(s); }
let _toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('on'), 1900);
}
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }
function showProgress(title, text) {
  openModal(title, '<p id="pv-text">' + text + '</p><div class="progress"><i id="pv-bar"></i></div>');
  return {
    set: function (p, txt) {
      const b = $('#pv-bar'); if (b) b.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
      const t = $('#pv-text'); if (t && txt) t.textContent = txt;
    },
    close: function () { closeModal(); },
  };
}

/* ---------------- 小控件 ---------------- */
function frow(label, node) {
  const r = el('div', 'frow');
  r.appendChild(el('label', null, label));
  r.appendChild(node);
  return r;
}
function numInput(val, step, onchange, dec) {
  const i = el('input');
  i.type = 'number';
  i.step = step || 1;
  i.value = dec == null ? val : (+val).toFixed(dec);
  i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) onchange(v); };
  return i;
}
function textInput(val, oninput) {
  const i = el('input');
  i.type = 'text';
  i.value = val == null ? '' : val;
  i.oninput = () => oninput(i.value);
  return i;
}
function colorInput(val, oninput) {
  const i = el('input');
  i.type = 'color';
  i.value = val;
  i.oninput = () => oninput(i.value);
  return i;
}
function checkInput(val, onchange, text) {
  const wrap = el('label', 'mini');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!val;
  i.onchange = () => onchange(i.checked);
  wrap.appendChild(i);
  if (text) wrap.appendChild(el('span', null, text));
  return wrap;
}
function decOf(step) { return step >= 1 ? 0 : (step >= .1 ? 1 : 2); }
/* 滑块 + **可编辑数字框**。
   为什么右边那个框必须能敲：朝向 -37.5°、俯仰 12° 这种值用滑块很难瞄，
   而且滑块一像素就跳好几度 —— 要精确对齐的时候只能靠键盘。
   fmtFn 仍然只用于 tooltip；框里的显示精度由 step 推（dec 可覆盖）。 */
function rangeRow(label, val, min, max, step, oninput, fmtFn, dec) {
  const r = el('div', 'frow');
  r.appendChild(el('label', null, label));
  const rg = el('input');
  rg.type = 'range'; rg.min = min; rg.max = max; rg.step = step; rg.value = val;
  const d = dec == null ? decOf(step) : dec;
  /* 显示格式化：优先按步长的精度显示，但**值比步长更细时多给几位**。
     输入框允许敲出滑块到不了的精度（滑块 step=1，敲 37.5 也该留得住），
     直接用 toFixed(d) 会把它显示成 38 —— 看起来就像「敲了没反应」。 */
  const show = v => {
    const t = (+v).toFixed(d);
    return (+t === +v) ? t : String(+v.toFixed(3));
  };
  let cur = clamp(val, min, max);
  const nb = el('input', 'numin');
  nb.type = 'number'; nb.min = min; nb.max = max; nb.step = step;
  nb.value = show(cur);
  nb.title = (fmtFn ? fmtFn(cur) : String(cur)) + ' —— 可以直接输入数值';
  rg.oninput = () => {
    cur = parseFloat(rg.value);
    nb.value = show(cur);
    oninput(cur);
  };
  nb.oninput = () => {
    const nv = parseFloat(nb.value);
    if (isNaN(nv)) return;                     /* 只敲了「-」或清空时别当成 0 */
    cur = clamp(nv, min, max);
    rg.value = cur;
    oninput(cur);
  };
  /* 失焦时把框里的文本规范成**实际生效的值**（填 999 会被夹到上限，
     就别留着 999 骗人）。这里读 cur 而不是滑块的值 ——
     滑块会把 37.5 吸附成 38，照它显示又变成「敲了没反应」。 */
  nb.onblur = () => { nb.value = show(cur); };
  r.appendChild(rg); r.appendChild(nb);
  return r;
}
function selectInput(val, opts, onchange) {
  const s = el('select');
  let grp = null;
  for (const o of opts) {
    /* 传 { group: '打斗' } 就开一个 optgroup，后面的 option 归进去 */
    if (o.group) { grp = el('optgroup'); grp.label = o.group; s.appendChild(grp); continue; }
    const op = el('option', null, o.label);
    op.value = o.value;
    if (o.value === val) op.selected = true;
    (grp || s).appendChild(op);
  }
  s.onchange = () => onchange(s.value);
  return s;
}
/* 按 cat 把一组条目拼成带 optgroup 的选项列表 */
function groupOptions(items, catOf, labelOf, valOf) {
  const out = [];
  for (const cat of catOf) {
    const list = items.filter(it => (it.cat || '其他') === cat);
    if (!list.length) continue;
    out.push({ group: cat });
    for (const it of list) out.push({ value: valOf(it), label: labelOf(it) });
  }
  return out;
}
function pgroup(title) {
  const g = el('div', 'pgroup');
  if (title) g.appendChild(el('div', 'ph', title));
  return g;
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- 视图 ---------------- */
function fitView() {
  const st = App.state, W = App.vw, H = App.vh;
  if (!st.bgW || !st.bgH) return;
  App.view.zoom = Math.min(W / st.bgW, H / st.bgH) * .92;
  App.view.cx = st.bgW / 2;
  App.view.cy = st.bgH / 2;
  fitView3D();
}
function setMode(m) {
  App.mode = m;
  document.querySelectorAll('#seg-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  draw();
  updateHud();
  renderView();
  toast(m === '3d' ? '镜头画面：3D 透视（透视地面 + 立体人物）'
    : '镜头画面：2D 平面（正交侧视 + 平面剪影，无透视）');
}
function setStageView(v) {
  App.stageView = v;
  document.querySelectorAll('#seg-view button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === '3d') {
    if (!App.view3d.dist) fitView3D();
    App.view3d.dist = App.view3d.dist || Math.max(App.state.bgW, App.state.bgH) * .85;
  }
  const lg = $('#stage-legend');
  if (lg) lg.style.display = v === '3d' ? 'none' : 'flex';
  draw();
  updateHud();
  toast(v === '3d' ? '3D 观察：拖动旋转 · 滚轮推拉 · Shift/中键平移' : '回到俯视编辑');
}
function resizeCanvases() {
  const wrap = $('#stage-wrap'), cv = $('#stage');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(20, wrap.clientWidth), h = Math.max(20, wrap.clientHeight);
  App.vw = w; App.vh = h; App.dpr = dpr;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const pw = App.previewRes[0], ph = App.previewRes[1], pv = $('#preview');
  if (pv.width !== pw || pv.height !== ph) { pv.width = pw; pv.height = ph; }
}
function draw() {
  if (!App.state) return;
  if (App.stageView === '3d') { renderStage3D(); return; }
  renderTopdown($('#stage').getContext('2d'), App.vw, App.vh, App.view, App.dpr, { grid: true });
}
function renderPreview() {
  if (!App.state) return;
  const pv = $('#preview');
  const W = App.previewRes[0], H = App.previewRes[1];
  if (pv.width !== W || pv.height !== H) { pv.width = W; pv.height = H; }
  const ctx = pv.getContext('2d');
  const cam = activeCamObj();
  $('#cam-name').textContent = cam ? cam.name : '无';
  if (!cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#12161d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#5b6472';
    ctx.font = '600 ' + Math.round(H * .07) + 'px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('还没有摄像机', W / 2, H / 2 - H * .04);
    ctx.font = Math.round(H * .045) + 'px "Microsoft YaHei",sans-serif';
    ctx.fillText('用「放摄像机」工具在图上点一下', W / 2, H / 2 + H * .07);
    return;
  }
  renderShot(ctx, W, H, evalCam(cam, App.time), App.time,
    { mode: App.mode, ortho: App.mode === '2d', guides: App.showGuides, hud: true });
}
/* 右下预览 / 预演窗口 / 放大观察，同一时刻只有一个是「正在看的画面」。
   统一从这里出，免得每处都写一遍 if-else 而漏掉其中一个。 */
function renderView() {
  if (App.loupeOpen) { renderLoupe(); return; }
  if (App.playerOpen) renderPlayer(); else renderPreview();
}
function updateTimeUI() {
  $('#tl-cur').textContent = fmt(App.time, 2);
  $('#tl-dur').textContent = fmt(App.state.duration, 2);
}
function setTime(t) {
  App.time = clamp(t, 0, App.state.duration);
  updateTimeUI(); updatePlayhead(); draw(); renderView();
}
function setPlaying(v) {
  App.playing = !!v;
  $('#btn-play').textContent = App.playing ? '❚❚ 暂停' : '▶ 播放';
}
function modeLabel() {
  return App.mode === '3d' ? '镜头画面 3D 透视' : '镜头画面 2D 平面';
}
let _hudWorld = null;
function updateHud(sx, sy, w) {
  const h = $('#stage-hud');
  if (!h) return;
  const pm = App.state.pxPerMeter;
  if (w) _hudWorld = w;
  if (App.stageView === '3d') {
    const toolName = { select: '选择', char: '放角色', cam: '放机位', path: '画走位线', erase: '擦除' }[App.tool];
    h.textContent = '3D 观察（恒为立体场景）　' + modeLabel() +
      (App.tool === 'select' ? '' : '　工具：' + (toolName || App.tool) + '（拖动仍是转视角，轻点才生效）') +
      '　拖动旋转 · 滚轮推拉 · Shift/中键平移';
    return;
  }
  let s = modeLabel();
  if (_hudWorld) {
    s = '坐标 ' + fmt(_hudWorld.x / pm, 2) + ', ' + fmt(_hudWorld.y / pm, 2) + ' m　缩放 ' +
      Math.round(App.view.zoom * 100) + '%　' + s;
  }
  h.textContent = s;
}

/* ---------------- 工具 ---------------- */
function setTool(t) {
  App.tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const cv = $('#stage');
  cv.style.cursor = t === 'select' ? 'default' : (t === 'erase' ? 'not-allowed' : 'crosshair');
  const tips = {
    select: '拖动对象移动；拖走位线上的方块改路径；拖圆环外的小球改朝向；滚轮缩放。',
    char: '在图上点击放置一个角色。',
    cam: '在图上点击放置一台摄像机。',
    path: '先选中角色或摄像机，再在图上依次点击画线，回车 / 双击结束，右键退一点。',
    erase: '点击对象即可删除。',
  };
  $('#tool-tip').textContent = tips[t] || '';
  if (t !== 'path') cancelPending();
  draw();
}
function cancelPending() { if (App.pending) { App.pending = null; draw(); } }

/* ---------------- 选中 ---------------- */
function selectObj(o, extra) {
  App.sel = Object.assign({ kind: o.type, id: o.id }, extra || {});
  if (o.type === 'char') App.lastCharId = o.id;
  if (o.type === 'cam') App.state.activeCam = o.id;
  refreshAll();
}
function selectClip(o, c) {
  App.sel = { kind: o.type, id: o.id, clipId: c.id };
  setTime(c.start);
  refreshAll();
}
function selectKey(o, k) {
  App.sel = { kind: 'cam', id: o.id, keyId: k.id };
  setTime(k.t);
  refreshAll();
}

/* ---------------- 图层 ---------------- */
function renderLayers() {
  const ul = $('#layers');
  ul.innerHTML = '';
  const st = App.state;
  if (!st.objects.length) {
    ul.appendChild(el('div', 'empty', '还没有对象，用左侧工具或顶栏 ＋ 添加。'));
    return;
  }
  for (const o of st.objects) {
    const li = el('li', App.sel && App.sel.id === o.id ? 'on' : '');
    const sw = el('span', 'sw'); sw.style.background = o.color;
    li.appendChild(sw);
    li.appendChild(el('span', 'nm', o.name));
    li.appendChild(el('span', 'tag', o.type === 'char' ? '角色' : '机位'));
    if (o.type === 'cam' && o.id === st.activeCam) li.appendChild(el('span', 'tag', '当前'));
    const del = el('span', 'del', '✕');
    del.onclick = e => {
      e.stopPropagation();
      pushUndo();
      st.objects = st.objects.filter(x => x.id !== o.id);
      if (st.activeCam === o.id) st.activeCam = (cams()[0] || {}).id || null;
      if (App.sel && App.sel.id === o.id) App.sel = null;
      refreshAll();
    };
    li.appendChild(del);
    li.onclick = () => selectObj(o);
    ul.appendChild(li);
  }
}

/* ---------------- 属性面板 ---------------- */
function renderProps() {
  const box = $('#props');
  if (!box) return;
  box.innerHTML = '';
  const o = getSelObj();
  if (!o) { propsProject(box); return; }
  if (o.type === 'char') propsChar(box, o); else propsCam(box, o);

  if (o.type === 'char' && App.sel.clipId) {
    const c = o.clips.find(c => c.id === App.sel.clipId);
    if (c) propsClip(box, o, c);
  }
  if (o.type === 'cam' && App.sel.keyId) {
    const k = o.keys.find(k => k.id === App.sel.keyId);
    if (k) propsKey(box, o, k);
  }

  const g = pgroup();
  const btns = el('div', 'pbtns');
  const bd = el('button', 'btn', '删除' + (o.type === 'char' ? '角色' : '摄像机'));
  bd.onclick = () => {
    pushUndo();
    App.state.objects = App.state.objects.filter(x => x.id !== o.id);
    if (App.state.activeCam === o.id) App.state.activeCam = (cams()[0] || {}).id || null;
    App.sel = null;
    refreshAll();
  };
  const bsel = el('button', 'btn ghost', '取消选中');
  bsel.onclick = () => { App.sel = null; refreshAll(); };
  btns.appendChild(bsel); btns.appendChild(bd);
  g.appendChild(btns);
  box.appendChild(g);
}

function propsProject(box) {
  const st = App.state;
  const g = pgroup('分镜设置');
  g.appendChild(frow('名称', textInput(st.name, v => { st.name = v; })));
  g.appendChild(frow('时长 s', numInput(st.duration, .5, v => {
    st.duration = clamp(v, 1, 300); App.time = clamp(App.time, 0, st.duration); refreshAll();
  }, 1)));
  g.appendChild(frow('帧率', numInput(st.fps, 1, v => { st.fps = clamp(Math.round(v), 10, 60); })));
  g.appendChild(frow('比例尺', numInput(st.pxPerMeter, 1, v => { st.pxPerMeter = clamp(v, 5, 400); draw(); renderPreview(); }, 0)));
  const gm = el('div', 'frow');
  gm.appendChild(el('label', null, '网格'));
  gm.appendChild(checkInput(st.showGrid, v => { st.showGrid = v; draw(); }, '显示 1m 网格'));
  g.appendChild(gm);
  box.appendChild(g);

  const g2 = pgroup('提示');
  g2.appendChild(el('div', 'tip',
    '① 导入背景图 → ② 放角色 → ③ 画走位线 → ④ 加动作 → ⑤ 放摄像机调运镜 → ⑥ 导出。<br>' +
    '选中对象后，左侧模板面板会自动作用于它。<br>' +
    '快捷键：1~5 切工具，空格播放，回车结束画线，Delete 删除，Ctrl+Z 撤销。'));
  box.appendChild(g2);
}

function propsChar(box, o) {
  const pm = App.state.pxPerMeter;
  const g = pgroup('角色');
  g.appendChild(frow('名称', textInput(o.name, v => { o.name = v; renderLayers(); draw(); })));
  g.appendChild(frow('颜色', colorInput(o.color, v => { o.color = v; renderLayers(); draw(); renderPreview(); })));
  g.appendChild(frow('位置 X m', numInput(o.x / pm, .1, v => { o.x = v * pm; draw(); renderPreview(); }, 2)));
  g.appendChild(frow('位置 Y m', numInput(o.y / pm, .1, v => { o.y = v * pm; draw(); renderPreview(); }, 2)));
  g.appendChild(rangeRow('朝向 °', Math.round(o.angle * RAD), -180, 180, 1,
    v => { o.angle = v * DEG; draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(frow('身高 m', numInput(o.height, .05, v => { o.height = clamp(v, .6, 3); renderPreview(); }, 2)));
  g.appendChild(frow('体宽 m', numInput(o.width, .05, v => { o.width = clamp(v, .2, 2); draw(); renderPreview(); }, 2)));
  const fm = el('div', 'frow');
  fm.appendChild(el('label', null, '选项'));
  fm.appendChild(checkInput(o.faceMove, v => { o.faceMove = v; draw(); renderPreview(); }, '朝向跟随走位'));
  g.appendChild(fm);
  const lm = el('div', 'frow');
  lm.appendChild(el('label', null, ''));
  lm.appendChild(checkInput(o.showLabel, v => { o.showLabel = v; draw(); renderPreview(); }, '显示名字'));
  g.appendChild(lm);
  if (o.clips.some(c => c.kind === 'move')) {
    g.appendChild(el('div', 'tip', '该角色已有走位：拖动它会整体平移走位线。'));
  }
  box.appendChild(g);

  const g2 = pgroup('片段（' + o.clips.length + '）');
  const list = el('div', 'klist');
  const sorted = o.clips.slice().sort((a, b) => a.start - b.start);
  for (const c of sorted) {
    const on = App.sel.clipId === c.id;
    const it = el('div', 'kitem' + (on ? ' on' : ''));
    const kindName = c.kind === 'move' ? '走位' : (c.kind === 'action' ? actionLabel(c.action) : '转身');
    it.appendChild(el('b', null, fmt(c.start, 1) + 's'));
    it.appendChild(el('span', null, kindName + ' · ' + fmt(c.dur, 1) + 's'));
    const x = el('span', 'x', '✕');
    x.onclick = e => {
      e.stopPropagation();
      pushUndo();
      o.clips = o.clips.filter(k => k.id !== c.id);
      if (App.sel.clipId === c.id) App.sel.clipId = null;
      refreshAll();
    };
    it.appendChild(x);
    it.onclick = () => selectClip(o, c);
    list.appendChild(it);
  }
  if (!sorted.length) list.appendChild(el('div', 'tip', '还没有片段。用左侧模板加动作，或用「画走位线」工具画一条。'));
  g2.appendChild(list);
  box.appendChild(g2);
}

function propsClip(box, o, c) {
  const g = pgroup(c.kind === 'move' ? '走位片段' : (c.kind === 'action' ? '动作片段' : '转身片段'));
  if (c.kind === 'action') {
    g.appendChild(frow('动作', selectInput(c.action,
      groupOptions(ACTION_IDS.map(id => ({ id: id, cat: ACTIONS[id].cat, label: ACTIONS[id].label })),
        ACTION_CATS, it => it.label, it => it.id),
      v => { c.action = v; renderTimeline(); draw(); renderPreview(); })));
  }
  g.appendChild(frow('开始 s', numInput(c.start, .1, v => { c.start = Math.max(0, v); renderTimeline(); updatePlayhead(); draw(); renderPreview(); }, 2)));
  g.appendChild(frow('时长 s', numInput(c.dur, .1, v => { c.dur = Math.max(.1, v); renderTimeline(); draw(); renderPreview(); }, 2)));
  if (c.kind === 'move') {
    g.appendChild(frow('缓动', selectInput(c.ease, [
      { value: 'linear', label: '匀速' }, { value: 'in', label: '慢起' },
      { value: 'out', label: '急停' }, { value: 'inout', label: '缓入缓出' }],
      v => { c.ease = v; draw(); renderPreview(); })));
    g.appendChild(el('div', 'tip', '路径点 ' + (c.path ? c.path.length : 0) + ' 个。拖动图上的蓝色方块可改路径；右键路径点可删除。'));
  }
  if (c.kind === 'turn') {
    g.appendChild(rangeRow('起始 °', Math.round(c.from * RAD), -180, 180, 1, v => { c.from = v * DEG; draw(); renderPreview(); }, v => Math.round(v) + '°'));
    g.appendChild(rangeRow('结束 °', Math.round(c.to * RAD), -180, 180, 1, v => { c.to = v * DEG; draw(); renderPreview(); }, v => Math.round(v) + '°'));
    g.appendChild(frow('缓动', selectInput(c.ease, [
      { value: 'linear', label: '匀速' }, { value: 'in', label: '慢起' },
      { value: 'out', label: '急停' }, { value: 'inout', label: '缓入缓出' }],
      v => { c.ease = v; draw(); renderPreview(); })));
  }
  if (c.kind === 'action') {
    const r = el('div', 'frow');
    r.appendChild(el('label', null, '选项'));
    r.appendChild(checkInput(c.hold, v => { c.hold = v; draw(); renderPreview(); }, '保持终态（倒地后不起）'));
    g.appendChild(r);
    const r2 = el('div', 'frow');
    r2.appendChild(el('label', null, ''));
    r2.appendChild(checkInput(c.loop, v => { c.loop = v; draw(); renderPreview(); }, '循环播放'));
    g.appendChild(r2);
  }
  const btns = el('div', 'pbtns');
  const b1 = el('button', 'btn ghost', '定位到开始');
  b1.onclick = () => setTime(c.start);
  const b2 = el('button', 'btn', '删除片段');
  b2.onclick = () => {
    pushUndo();
    o.clips = o.clips.filter(k => k.id !== c.id);
    App.sel.clipId = null;
    refreshAll();
  };
  btns.appendChild(b1); btns.appendChild(b2);
  g.appendChild(btns);
  box.appendChild(g);
}

function propsCam(box, o) {
  const pm = App.state.pxPerMeter;
  const g = pgroup('摄像机');
  g.appendChild(frow('名称', textInput(o.name, v => { o.name = v; renderLayers(); renderPreview(); })));
  g.appendChild(frow('位置 X m', numInput(o.x / pm, .1, v => { applyCamEdit(o, { x: v * pm }); draw(); renderPreview(); }, 2)));
  g.appendChild(frow('位置 Y m', numInput(o.y / pm, .1, v => { applyCamEdit(o, { y: v * pm }); draw(); renderPreview(); }, 2)));
  g.appendChild(rangeRow('朝向 °', Math.round(o.angle * RAD), -180, 180, 1,
    v => { applyCamEdit(o, { angle: v * DEG }); draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(rangeRow('俯仰 °', Math.round(o.pitch * RAD), -30, 70, 1,
    v => { applyCamEdit(o, { pitch: v * DEG }); draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(rangeRow('高度 m', o.height, .3, 12, .05,
    v => { applyCamEdit(o, { height: v }); draw(); renderPreview(); }, v => fmt(v, 2)));
  g.appendChild(rangeRow('视场角 °', o.fov, 15, 110, 1,
    v => { applyCamEdit(o, { fov: v }); draw(); renderPreview(); }, v => Math.round(v) + '°'));
  if (o.keys.length) g.appendChild(el('div', 'tip', '该机位已有 ' + o.keys.length + ' 个关键帧：在舞台上拖动会自动在当前时间打关键帧。'));
  box.appendChild(g);

  const g2 = pgroup('跟随');
  const opts = [{ value: '', label: '不跟随' }].concat(chars().map(c => ({ value: c.id, label: c.name })));
  const cur = o.follow && o.follow.targetId ? o.follow.targetId : '';
  g2.appendChild(frow('目标', selectInput(cur, opts, v => {
    pushUndo();
    o.follow = v ? { targetId: v, dist: 4, height: 1.8, side: 0 } : null;
    refreshAll();
  })));
  if (o.follow) {
    g2.appendChild(rangeRow('距离 m', o.follow.dist, 1, 12, .1, v => { o.follow.dist = v; draw(); renderPreview(); }, v => fmt(v, 1)));
    g2.appendChild(rangeRow('横向 m', o.follow.side, -3, 3, .1, v => { o.follow.side = v; draw(); renderPreview(); }, v => fmt(v, 1)));
    g2.appendChild(rangeRow('高度 m', o.follow.height, .5, 8, .05, v => { o.follow.height = v; draw(); renderPreview(); }, v => fmt(v, 2)));
  }
  box.appendChild(g2);

  const g3 = pgroup('关键帧（' + o.keys.length + '）');
  const list = el('div', 'klist');
  const ks = o.keys.slice().sort((a, b) => a.t - b.t);
  for (const k of ks) {
    const on = App.sel.keyId === k.id;
    const it = el('div', 'kitem' + (on ? ' on' : ''));
    it.appendChild(el('b', null, fmt(k.t, 2) + 's'));
    /* 标出「这一帧挂在圆弧上」—— 手改 X/Y 会退出圆弧（见下面两行），
       不标的话用户会以为改完还能保持整圆，结果路径上莫名多一个拐点。 */
    it.appendChild(el('span', null,
      (k.arc ? '弧·' : '') + 'X' + fmt(k.x / pm, 1) + ' Y' + fmt(k.y / pm, 1) +
      ' ∠' + fmt(k.angle * RAD, 0) + '° H' + fmt(k.height, 1) + ' F' + fmt(k.fov, 0)));
    if (k.arc) it.title = '这一帧在圆弧上（相邻两段按弧求值）。手改 X/Y 会退出圆弧、退化成直线段。';
    const x = el('span', 'x', '✕');
    x.onclick = e => {
      e.stopPropagation();
      pushUndo();
      o.keys = o.keys.filter(kk => kk.id !== k.id);
      if (App.sel.keyId === k.id) App.sel.keyId = null;
      refreshAll();
    };
    it.appendChild(x);
    it.onclick = () => selectKey(o, k);
    list.appendChild(it);
  }
  if (!ks.length) list.appendChild(el('div', 'tip', '还没有关键帧。用左侧「运镜模板」一键生成，或点下面的按钮打一个。'));
  g3.appendChild(list);
  const btns = el('div', 'pbtns');
  const b1 = el('button', 'btn', '在当前时间打关键帧');
  b1.onclick = () => {
    pushUndo();
    const t = App.time;
    const s = evalCam(o, t);
    o.keys = o.keys.filter(k => Math.abs(k.t - t) > .02);
    const k = mkKey(t, s);
    o.keys.push(k);
    o.keys.sort((a, b) => a.t - b.t);
    App.sel = { kind: 'cam', id: o.id, keyId: k.id };
    refreshAll();
    toast('已打关键帧 @ ' + fmt(t, 2) + 's');
  };
  const b2 = el('button', 'btn ghost', '清空关键帧');
  /* 运镜记录也要一起清 —— 关键帧没了，「这台机位做过 dollyOut」就不成立了，
     留着会让 AI 对着空气叠加运镜。 */
  b2.onclick = () => { pushUndo(); o.keys = []; o.moves = []; App.sel.keyId = null; refreshAll(); };
  btns.appendChild(b1); btns.appendChild(b2);
  g3.appendChild(btns);
  box.appendChild(g3);

  const g4 = pgroup('输出');
  const btns2 = el('div', 'pbtns');
  const b3 = el('button', 'btn ghost', '设为当前机位');
  b3.onclick = () => { App.state.activeCam = o.id; refreshAll(); toast('当前机位：' + o.name); };
  btns2.appendChild(b3);
  g4.appendChild(btns2);
  box.appendChild(g4);
}

function propsKey(box, o, k) {
  const pm = App.state.pxPerMeter;
  const g = pgroup('关键帧');
  g.appendChild(frow('时间 s', numInput(k.t, .1, v => {
    k.t = Math.max(0, v);
    o.keys.sort((a, b) => a.t - b.t);
    renderTimeline(); updatePlayhead(); draw(); renderPreview();
  }, 2)));
  /* 手填坐标和拖动同理：这一帧不再落在原来那个圆上了，弧的信息要摘掉，
     否则弧插值会无视用户填进去的值（「填了没反应」）。 */
  g.appendChild(frow('X m', numInput(k.x / pm, .1, v => { k.x = v * pm; delete k.arc; draw(); renderPreview(); }, 2)));
  g.appendChild(frow('Y m', numInput(k.y / pm, .1, v => { k.y = v * pm; delete k.arc; draw(); renderPreview(); }, 2)));
  g.appendChild(rangeRow('朝向 °', Math.round(k.angle * RAD), -180, 180, 1, v => { k.angle = v * DEG; draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(rangeRow('俯仰 °', Math.round(k.pitch * RAD), -30, 70, 1, v => { k.pitch = v * DEG; draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(rangeRow('高度 m', k.height, .3, 12, .05, v => { k.height = v; draw(); renderPreview(); }, v => fmt(v, 2)));
  g.appendChild(rangeRow('视场角 °', k.fov, 15, 110, 1, v => { k.fov = v; draw(); renderPreview(); }, v => Math.round(v) + '°'));
  g.appendChild(frow('缓动', selectInput(k.ease, [
    { value: 'linear', label: '匀速' }, { value: 'in', label: '慢起' },
    { value: 'out', label: '急停' }, { value: 'inout', label: '缓入缓出' }],
    v => { k.ease = v; draw(); renderPreview(); })));
  const btns = el('div', 'pbtns');
  const b1 = el('button', 'btn ghost', '跳到该帧');
  b1.onclick = () => setTime(k.t);
  const b2 = el('button', 'btn', '删除关键帧');
  b2.onclick = () => {
    pushUndo();
    o.keys = o.keys.filter(kk => kk.id !== k.id);
    App.sel.keyId = null;
    refreshAll();
  };
  btns.appendChild(b1); btns.appendChild(b2);
  g.appendChild(btns);
  box.appendChild(g);
}

/* ---------------- 时间轴 ---------------- */
function renderTimeline() {
  const st = App.state;
  const rows = $('#tl-rows');
  if (!rows) return;
  rows.innerHTML = '';
  const dur = st.duration;
  $('#tl-dur').textContent = fmt(dur, 2);
  /* renderTimeline 遍历的是所有对象，取消选中（App.sel = null）后也会被调到这里，
     所以不能直接读 App.sel.clipId / App.sel.keyId —— 那会在点空白处取消选中时抛 TypeError，
     把 refreshAll() 后面的刷新全部中断。 */
  const selClip = App.sel ? App.sel.clipId : null;
  const selKey = App.sel ? App.sel.keyId : null;

  const ruler = el('div', 'tl-row ruler');
  ruler.appendChild(el('div', 'tl-name', '时间轴'));
  const rt = el('div', 'tl-track');
  const step = dur <= 6 ? .5 : dur <= 15 ? 1 : dur <= 30 ? 2 : 5;
  for (let t = 0; t <= dur + 1e-6; t += step) {
    const d = el('div', 'tick');
    d.style.left = (t / dur * 100) + '%';
    d.innerHTML = '<span>' + fmt(t, step < 1 ? 1 : 0) + '</span>';
    rt.appendChild(d);
  }
  ruler.appendChild(rt);
  rows.appendChild(ruler);

  for (const o of st.objects) {
    const row = el('div', 'tl-row');
    const nm = el('div', 'tl-name');
    const sw = el('span', 'sw'); sw.style.background = o.color;
    nm.appendChild(sw);
    nm.appendChild(el('span', null, o.name));
    row.appendChild(nm);

    const track = el('div', 'tl-track');
    track.dataset.id = o.id;

    if (o.type === 'char') {
      const hasAct = o.clips.some(c => c.kind !== 'move');
      const hasMove = o.clips.some(c => c.kind === 'move');
      if (hasAct && hasMove) row.style.height = '56px';
      for (const c of o.clips) {
        const lane = c.kind === 'move' ? 0 : 1;
        const bar = el('div', 'clip ' + c.kind + (selClip === c.id ? ' on' : ''));
        bar.style.left = clamp(c.start / dur * 100, 0, 100) + '%';
        bar.style.width = clamp(c.dur / dur * 100, .6, 100) + '%';
        if (hasAct && hasMove) bar.style.top = (5 + lane * 27) + 'px';
        const kindName = c.kind === 'move' ? '走位' : (c.kind === 'action' ? actionLabel(c.action) : '转身');
        bar.textContent = kindName;
        bar.appendChild(el('div', 'h'));
        bindBarDrag(bar, o, c, track);
        track.appendChild(bar);
      }
    } else {
      for (const k of o.keys) {
        const mk = el('div', 'kmark' + (selKey === k.id ? ' on' : ''));
        mk.style.left = clamp(k.t / dur * 100, 0, 100) + '%';
        mk.title = fmt(k.t, 2) + 's';
        mk.onpointerdown = ev => {
          ev.stopPropagation();
          const r = track.getBoundingClientRect();
          const x0 = ev.clientX, t0 = k.t;
          let moved = false;
          const mv = e2 => {
            const dt = (e2.clientX - x0) / r.width * dur;
            if (Math.abs(dt) > .02) moved = true;
            k.t = clamp(+(t0 + dt).toFixed(3), 0, dur);
            o.keys.sort((a, b) => a.t - b.t);
            mk.style.left = clamp(k.t / dur * 100, 0, 100) + '%';
            draw(); renderPreview(); updatePlayhead();
          };
          const up = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            if (!moved) selectKey(o, k); else { App.sel = { kind: 'cam', id: o.id, keyId: k.id }; refreshAll(); }
          };
          pushUndo();
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
        };
        track.appendChild(mk);
      }
    }
    row.appendChild(track);
    rows.appendChild(row);
  }
  updatePlayhead();
}

function bindBarDrag(bar, o, c, track) {
  bar.onpointerdown = ev => {
    ev.stopPropagation();
    const r = track.getBoundingClientRect();
    const x0 = ev.clientX;
    const s0 = c.start, d0 = c.dur;
    const edge = ev.offsetX > bar.clientWidth - 7;
    let moved = false;
    const mv = e2 => {
      const dt = (e2.clientX - x0) / r.width * App.state.duration;
      if (Math.abs(dt) > .02) moved = true;
      if (edge) {
        c.dur = Math.max(.1, +(d0 + dt).toFixed(2));
        bar.style.width = clamp(c.dur / App.state.duration * 100, .6, 100) + '%';
      } else {
        c.start = clamp(+(s0 + dt).toFixed(2), 0, Math.max(0, App.state.duration - c.dur));
        bar.style.left = clamp(c.start / App.state.duration * 100, 0, 100) + '%';
      }
      draw(); renderPreview();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (!moved) { selectClip(o, c); return; }
      App.sel = { kind: o.type, id: o.id, clipId: c.id };
      refreshAll();
    };
    pushUndo();
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  /* 提示里一直写着「双击色条定位」，但从来没实现过 —— 补上：
     双击一段片段 = 时间跳到它的开始，方便对着某段动作调机位。 */
  bar.ondblclick = ev => { ev.stopPropagation(); setTime(c.start); };
}

function updatePlayhead() {
  const body = $('#tl-body'), ph = $('#tl-playhead');
  if (!body || !ph) return;
  const track = $('#tl-rows .tl-track');
  if (!track || !App.state.duration) { ph.style.display = 'none'; return; }
  ph.style.display = 'block';
  const rb = body.getBoundingClientRect(), rt = track.getBoundingClientRect();
  ph.style.left = ((rt.left - rb.left) + (App.time / App.state.duration) * rt.width) + 'px';
}

/* ---------------- 画布交互 ---------------- */
function evPos(e) {
  const r = $('#stage').getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}
function hitTest(sx, sy) {
  const z = App.view.zoom, pm = App.state.pxPerMeter, objs = App.state.objects;
  /* 俯视图里角色画在摄像机之上，所以拾取也先找角色，避免重叠时点到被压在下面的机位 */
  for (let pass = 0; pass < 2; pass++) {
    const wantChar = pass === 0;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if ((o.type === 'char') !== wantChar) continue;
      const s = o.type === 'char' ? evalChar(o, App.time) : evalCam(o, App.time);
      const q = toScreenP(s.x, s.y, App.view, App.vw, App.vh);
      const r = o.type === 'char' ? Math.max(12, o.width * pm * z / 2) : 12;
      if (Math.hypot(sx - q.x, sy - q.y) <= r + 3) return { id: o.id };
    }
  }
  return null;
}
function hitHandle(sx, sy) {
  const o = getSelObj();
  if (!o) return null;
  if (o.type === 'char') {
    const s = evalChar(o, App.time);
    const q = toScreenP(s.x, s.y, App.view, App.vw, App.vh);
    /* 半径和手柄距离跟 drawCharTop 共用同一份算法 —— 以前这里写 max(12)、
       渲染那边写 max(10)，命中位置和画出来的位置本来就可能差 2px。 */
    const r = charRadius(o, App.view.zoom, App.state.pxPerMeter);
    const f = dirVec(s.angle);
    const hd = rotHandleDist(r);
    if (Math.hypot(sx - (q.x + f.x * hd), sy - (q.y + f.y * hd)) <= 11) return { mode: 'rot', id: o.id };
    for (const c of clipsOf(o, 'move')) {
      if (!c.path) continue;
      for (let i = 0; i < c.path.length; i++) {
        const p = toScreenP(c.path[i].x, c.path[i].y, App.view, App.vw, App.vh);
        if (Math.hypot(sx - p.x, sy - p.y) <= 8) return { mode: 'pt', id: o.id, clipId: c.id, idx: i };
      }
    }
  } else {
    const s = evalCam(o, App.time);
    const q = toScreenP(s.x, s.y, App.view, App.vw, App.vh);
    const f = dirVec(s.angle);
    if (Math.hypot(sx - (q.x + f.x * 34), sy - (q.y + f.y * 34)) <= 10) return { mode: 'camrot', id: o.id };
    const fp = camFootprint(s, App.previewRes[0] / App.previewRes[1], App.state.pxPerMeter * 45);
    for (const p of fp) {
      const q2 = toScreenP(p.x, p.y, App.view, App.vw, App.vh);
      if (Math.hypot(sx - q2.x, sy - q2.y) <= 10) return { mode: 'camfov', id: o.id };
    }
  }
  return null;
}

function onDown(e) {
  const cv = $('#stage');
  const p = evPos(e);
  try { cv.setPointerCapture(e.pointerId); } catch (err) { }
  if (App.stageView === '3d') { onDown3D(e, p); return; }
  const w = screenToWorld(p.sx, p.sy, App.view, App.vw, App.vh);

  if (e.button === 1) {
    App.drag = { mode: 'pan', sx: p.sx, sy: p.sy, cx: App.view.cx, cy: App.view.cy };
    return;
  }
  if (e.button !== 0) return;

  if (App.tool === 'char') {
    pushUndo();
    const c = createChar(w.x, w.y, chars().length + 1);
    App.state.objects.push(c);
    selectObj(c);
    setTool('select');
    toast('已放置 ' + c.name);
    return;
  }
  if (App.tool === 'cam') {
    pushUndo();
    const c = createCam(w.x, w.y, cams().length + 1);
    App.state.objects.push(c);
    App.state.activeCam = c.id;
    selectObj(c);
    setTool('select');
    toast('已放置 ' + c.name);
    return;
  }
  if (App.tool === 'erase') {
    const h = hitTest(p.sx, p.sy);
    if (h) {
      pushUndo();
      App.state.objects = App.state.objects.filter(x => x.id !== h.id);
      if (App.state.activeCam === h.id) App.state.activeCam = (cams()[0] || {}).id || null;
      if (App.sel && App.sel.id === h.id) App.sel = null;
      refreshAll();
    }
    return;
  }
  if (App.tool === 'path') {
    const o = getSelObj();
    if (!o) { toast('先选中一个角色或摄像机'); return; }
    if (!App.pending) {
      const s = o.type === 'char' ? evalChar(o, App.time) : evalCam(o, App.time);
      App.pending = { objId: o.id, pts: [{ x: s.x, y: s.y }], hover: null };
    } else {
      App.pending.pts.push({ x: w.x, y: w.y });
    }
    draw();
    return;
  }

  const h = hitHandle(p.sx, p.sy);
  if (h) { App.drag = h; return; }
  const t = hitTest(p.sx, p.sy);
  if (t) {
    const o = getObj(t.id);
    /* 先快照：selectObj 会顺手改 activeCam，快照晚了撤销就还原不回去 */
    pushUndo();
    if (!(App.sel && App.sel.id === o.id)) selectObj(o);
    App.drag = {
      mode: 'obj', id: o.id, ox: w.x, oy: w.y,
      start: { x: o.x, y: o.y },
      paths: o.type === 'char' ? clipsOf(o, 'move').map(c => ({ clip: c, pts: c.path.map(q => ({ x: q.x, y: q.y })) })) : null,
      keys: o.type === 'cam' ? o.keys.map(k => ({ id: k.id, x: k.x, y: k.y })) : null,
    };
    return;
  }
  App.sel = null;
  refreshAll();
}

/* ---------------- 3D 观察视图里的操作 ---------------- */

/* 在 3D 视图里执行一次"工具点击"（只在指针没拖动时才触发）。
   把工具动作从 pointerdown 挪到 pointerup，是为了让"拖动"永远等于转视角：
   否则选了角色 / 机位 / 走位线 / 擦除工具后，拖动会被工具抢走，看起来像 3D 转不了视角。 */
function run3DTool(tool, sx, sy) {
  const B = makeBasis(view3dCamera(), App.vw, App.vh);
  const g = rayToGround(B, sx, sy);

  if (tool === 'char') {
    if (!g) { toast('点在地面上才能放角色'); return; }
    pushUndo();
    const c = createChar(g.x, g.y, chars().length + 1);
    App.state.objects.push(c);
    selectObj(c); setTool('select');
    toast('已放置 ' + c.name);
    return;
  }
  if (tool === 'cam') {
    if (!g) { toast('点在地面上才能放摄像机'); return; }
    pushUndo();
    const c = createCam(g.x, g.y, cams().length + 1);
    App.state.objects.push(c);
    App.state.activeCam = c.id;
    selectObj(c); setTool('select');
    toast('已放置 ' + c.name);
    return;
  }
  if (tool === 'erase') {
    const h = hitTest3D(sx, sy, B);
    if (h) {
      pushUndo();
      App.state.objects = App.state.objects.filter(x => x.id !== h.id);
      if (App.state.activeCam === h.id) App.state.activeCam = (cams()[0] || {}).id || null;
      if (App.sel && App.sel.id === h.id) App.sel = null;
      refreshAll();
    }
    return;
  }
  if (tool === 'path') {
    const o = getSelObj();
    if (!o) { toast('先选中一个角色或摄像机'); return; }
    if (!g) { toast('点在地面上才能打点'); return; }
    if (!App.pending) {
      const s = o.type === 'char' ? evalChar(o, App.time) : evalCam(o, App.time);
      App.pending = { objId: o.id, pts: [{ x: s.x, y: s.y }], hover: null };
    } else {
      App.pending.pts.push({ x: g.x, y: g.y });
    }
    draw();
    return;
  }
}

function onDown3D(e, p) {
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    App.drag = { mode: 'orbitpan', sx: p.sx, sy: p.sy, tx: App.view3d.tx, ty: App.view3d.ty };
    return;
  }
  if (e.button !== 0) return;

  /* 非「选择」工具：先挂起，抬起时再判断是"点击"还是"拖动"。
     拖动 → 升级成转视角（见 onMove）；点击 → 执行工具动作（见 onUp）。 */
  if (App.tool !== 'select') {
    App.drag = {
      mode: 'toolclick', tool: App.tool, sx: p.sx, sy: p.sy, moved: false,
      yaw: App.view3d.yaw, elev: App.view3d.elev,
    };
    return;
  }

  const B = makeBasis(view3dCamera(), App.vw, App.vh);
  const g = rayToGround(B, p.sx, p.sy);
  const h = hitTest3D(p.sx, p.sy, B);
  if (h && g) {
    const o = getObj(h.id);
    pushUndo();
    if (!(App.sel && App.sel.id === o.id)) selectObj(o);
    App.drag = {
      mode: 'obj', in3d: true, id: o.id, ox: g.x, oy: g.y,
      start: { x: o.x, y: o.y },
      paths: o.type === 'char' ? clipsOf(o, 'move').map(c => ({ clip: c, pts: c.path.map(q => ({ x: q.x, y: q.y })) })) : null,
    };
    return;
  }
  App.drag = { mode: 'orbit', sx: p.sx, sy: p.sy, yaw: App.view3d.yaw, elev: App.view3d.elev };
  if (App.sel) { App.sel = null; refreshAll(); }
}


function onMove(e) {
  const p = evPos(e);
  const in3d = App.stageView === '3d';
  let B3 = null, w = null;
  if (in3d) { B3 = makeBasis(view3dCamera(), App.vw, App.vh); w = rayToGround(B3, p.sx, p.sy); }
  else w = screenToWorld(p.sx, p.sy, App.view, App.vw, App.vh);
  if (w) updateHud(p.sx, p.sy, w);

  if (App.pending && w) {
    App.pending.hover = { x: w.x, y: w.y };
    draw();
    if (!App.drag) return;
  }
  const d = App.drag;
  if (!d) return;

  /* 挂起的"工具点击"：拖过 4px 就升级成转视角。
     升级时把起点重设到当前位置，避免升级瞬间视角跳一下。 */
  if (d.mode === 'toolclick') {
    if (Math.hypot(p.sx - d.sx, p.sy - d.sy) <= 4) return;
    d.mode = 'orbit';
    d.moved = true;
    d.sx = p.sx; d.sy = p.sy;
    d.yaw = App.view3d.yaw; d.elev = App.view3d.elev;
  }

  if (d.mode === 'pan') {
    App.view.cx = d.cx - (p.sx - d.sx) / App.view.zoom;
    App.view.cy = d.cy - (p.sy - d.sy) / App.view.zoom;
    draw();
    return;
  }
  if (d.mode === 'orbit') {
    App.view3d.yaw = d.yaw - (p.sx - d.sx) * .008;
    App.view3d.elev = clamp(d.elev + (p.sy - d.sy) * .006, -3 * DEG, 88 * DEG);
    draw();
    return;
  }
  if (d.mode === 'orbitpan') {
    const v = App.view3d, k = v.dist * .0016;
    const rx = Math.cos(v.yaw), ry = Math.sin(v.yaw);
    const fx = Math.sin(v.yaw), fy = -Math.cos(v.yaw);
    const dx = p.sx - d.sx, dy = p.sy - d.sy;
    v.tx = d.tx - rx * dx * k + fx * dy * k;
    v.ty = d.ty - ry * dx * k + fy * dy * k;
    draw();
    return;
  }

  const o = getObj(d.id);
  if (!o) return;
  if (d.mode === 'obj') {
    if (!w) return;
    const dx = w.x - d.ox, dy = w.y - d.oy;
    if (o.type === 'char') {
      o.x = d.start.x + dx; o.y = d.start.y + dy;
      if (d.paths) for (const pp of d.paths) for (let i = 0; i < pp.pts.length; i++) {
        pp.clip.path[i].x = pp.pts[i].x + dx;
        pp.clip.path[i].y = pp.pts[i].y + dy;
      }
    } else {
      applyCamEdit(o, { x: d.start.x + dx, y: d.start.y + dy });
    }
  } else if (d.mode === 'pt') {
    if (!w) return;
    const c = o.clips.find(c => c.id === d.clipId);
    if (c && c.path[d.idx]) { c.path[d.idx].x = w.x; c.path[d.idx].y = w.y; }
  } else if (d.mode === 'rot') {
    if (!w) return;
    const s = evalChar(o, App.time);
    const a = angOf(w.x - s.x, w.y - s.y);
    /* 只改「当前时刻已经开始生效」的转身片段；否则改的是未来的片段，画面不会有任何反应。
       扫角要跟着一起改：evalChar 现在按 sweep 插值，只改 to 不改 sweep 的话
       拖了等于没拖（sweep 还是上一次的值）。拖拽是连续的，取最短弧即可。 */
    const started = clipsOf(o, 'turn').filter(c => App.time >= c.start);
    if (started.length) {
      const c = started[started.length - 1];
      c.sweep = angDelta(c.from, a);
      c.to = c.from + c.sweep;
    } else o.angle = a;
  } else if (d.mode === 'camrot') {
    if (!w) return;
    const s = evalCam(o, App.time);
    applyCamEdit(o, { angle: angOf(w.x - s.x, w.y - s.y) });
  } else if (d.mode === 'camfov') {
    if (!w) return;
    const s = evalCam(o, App.time);
    const f = dirVec(s.angle);
    const rt = { x: -f.y, y: f.x };
    const vx = w.x - s.x, vy = w.y - s.y;
    const l = vx * rt.x + vy * rt.y;
    const fw = vx * f.x + vy * f.y;
    if (fw > 1) {
      const halfH = Math.atan2(Math.abs(l), fw);
      const aspect = App.previewRes[0] / App.previewRes[1];
      const fov = 2 * Math.atan(Math.tan(clamp(halfH, .05, 1.45)) / aspect) * RAD;
      applyCamEdit(o, { fov: clamp(fov, 15, 110) });
    }
  }
  draw();
  if (!in3d) renderPreview();
}

function onUp() {
  const d = App.drag;
  App.drag = null;
  /* 挂起的工具点击：只有全程没拖动才算"点击"，这时才真正执行工具动作 */
  if (d && d.mode === 'toolclick') run3DTool(d.tool, d.sx, d.sy);
}

function onWheel(e) {
  e.preventDefault();
  if (App.stageView === '3d') {
    const st = App.state;
    const k = e.deltaY < 0 ? 1 / 1.12 : 1.12;
    App.view3d.dist = clamp(App.view3d.dist * k, st.pxPerMeter * 1.5, Math.max(st.bgW, st.bgH) * 8);
    draw();
    return;
  }
  const p = evPos(e);
  const before = screenToWorld(p.sx, p.sy, App.view, App.vw, App.vh);
  const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  App.view.zoom = clamp(App.view.zoom * k, .04, 8);
  const after = screenToWorld(p.sx, p.sy, App.view, App.vw, App.vh);
  App.view.cx += before.x - after.x;
  App.view.cy += before.y - after.y;
  draw();
}

function finishPath() {
  const p = App.pending;
  if (!p) return;
  const o = getObj(p.objId);
  if (!o || p.pts.length < 2) { cancelPending(); return; }
  pushUndo();
  if (o.type === 'char') {
    const clip = {
      id: uid('cp'), kind: 'move', start: +App.time.toFixed(2), dur: 2.5, ease: 'inout',
      path: p.pts.map(q => ({ x: q.x, y: q.y })),
    };
    o.clips.push(clip);
    App.sel = { kind: 'char', id: o.id, clipId: clip.id };
    toast('已生成走位片段（2.5s）');
  } else {
    const dur = 3;
    const c = pathCum(p.pts);
    const keys = [];
    for (let i = 0; i < p.pts.length; i++) {
      const u = c.total > 0 ? c.cum[i] / c.total : 0;
      keys.push({
        id: uid('kk'), t: +(App.time + dur * u).toFixed(3),
        x: p.pts[i].x, y: p.pts[i].y, angle: pathTangent(p.pts, u),
        pitch: o.pitch, height: o.height, fov: o.fov, ease: 'inout',
      });
    }
    o.keys = o.keys.filter(k => k.t < App.time - .001).concat(keys).sort((a, b) => a.t - b.t);
    App.sel = { kind: 'cam', id: o.id };
    toast('已生成 ' + keys.length + ' 个运镜关键帧（3s）');
  }
  App.pending = null;
  refreshAll();
  /* 线画完了就回到「选择」。否则工具一直停在「走位线」，之后在 3D 观察视图里
     拖动会被当成"打点"，视角完全转不动。 */
  setTool('select');
}

function onDbl(e) {
  if (App.pending) { finishPath(); return; }
}
/* 右键：画线时退掉上一个点；否则取消选中。只在这里处理，避免和 pointerdown 重复触发。 */
function onCtx(e) {
  e.preventDefault();
  if (App.pending && App.pending.pts.length > 1) { App.pending.pts.pop(); draw(); return; }
  if (App.pending) { cancelPending(); return; }
  if (App.sel) { App.sel = null; refreshAll(); }
}

function bindStage() {
  const cv = $('#stage');
  cv.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('contextmenu', onCtx);

  const body = $('#tl-body');
  body.addEventListener('pointerdown', e => {
    if (e.target.closest('.clip') || e.target.closest('.kmark')) return;
    const track = e.target.closest('.tl-track');
    if (!track) return;
    const r = track.getBoundingClientRect();
    const apply = ev => setTime(clamp((ev.clientX - r.left) / r.width, 0, 1) * App.state.duration);
    apply(e);
    const mv = ev => apply(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
}

function bindKeys() {
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
      return;
    }
    switch (e.key) {
      case '1': setTool('select'); break;
      case '2': setTool('char'); break;
      case '3': setTool('cam'); break;
      case '4': setTool('path'); break;
      case '5': setTool('erase'); break;
      case ' ': e.preventDefault(); setPlaying(!App.playing); break;
      case 'Enter': if (App.pending) finishPath(); break;
      case 'Escape':
        if (App.loupeOpen) { closeLoupe(); break; }
        if (App.playerOpen) { closePlayer(); break; }
        if (App.pending) cancelPending(); else { App.sel = null; refreshAll(); }
        break;
      case 'Delete':
      case 'Backspace': {
        const o = getSelObj();
        if (!o) return;
        pushUndo();
        if (App.sel.clipId) {
          o.clips = o.clips.filter(c => c.id !== App.sel.clipId);
          App.sel.clipId = null;
        } else if (App.sel.keyId) {
          o.keys = o.keys.filter(k => k.id !== App.sel.keyId);
          App.sel.keyId = null;
        } else {
          App.state.objects = App.state.objects.filter(x => x.id !== o.id);
          if (App.state.activeCam === o.id) App.state.activeCam = (cams()[0] || {}).id || null;
          App.sel = null;
        }
        refreshAll();
        break;
      }
    }
  });
}

/* ---------------- 模板面板 ----------------
   动作 38 条、运镜 22 条，平铺出来太长，所以按 cat 分组、
   组标题可点收起。折叠状态只存在本次会话里（App.chipFold）。 */
function isFolded(cat) { return !!App.chipFold[cat]; }
function pushGroup(host, cat, items, makeBtn) {
  if (!items.length) return;
  const open = !isFolded(cat);
  const head = el('div', 'chipcat');
  head.appendChild(el('i', 'car', open ? '▾' : '▸'));
  head.appendChild(el('span', null, cat));
  head.appendChild(el('em', 'cnum', String(items.length)));
  head.title = (open ? '收起' : '展开') + '「' + cat + '」';
  head.onclick = () => { App.chipFold[cat] = open; buildChips(); };
  host.appendChild(head);
  if (!open) return;
  for (const it of items) host.appendChild(makeBtn(it));
}

function buildChips() {
  const ac = $('#action-chips');
  ac.innerHTML = '';
  for (const cat of ACTION_CATS) {
    const ids = ACTION_IDS.filter(id => (ACTIONS[id].cat || '其他') === cat);
    pushGroup(ac, cat, ids, id => {
      const a = ACTIONS[id];
      const isTurn = a.turn != null || a.turnTo != null;
      const b = el('button', 'chip' + (a.hold ? ' act' : ''), a.label);
      b.title = isTurn
        ? '转身 · 角度按角色当前朝向算 · ' + fmt(a.dur, 1) + 's'
        : (a.loop ? '循环 · ' : '') + (a.hold ? '保持终态 · ' : '') + fmt(a.dur, 1) + 's';
      b.onclick = () => applyAction(id);
      return b;
    });
  }
  const mc = $('#move-chips');
  mc.innerHTML = '';
  for (const t of MOVE_TEMPLATES) {
    const b = el('button', 'chip', t.label);
    b.title = '默认 ' + t.dur + 's';
    b.onclick = () => applyMoveTemplate(t);
    mc.appendChild(b);
  }
  const cc = $('#cam-chips');
  cc.innerHTML = '';
  for (const cat of CAM_CATS) {
    const list = CAM_TEMPLATES.filter(t => (t.cat || '其他') === cat);
    pushGroup(cc, cat, list, t => {
      const b = el('button', 'chip', t.label);
      if (t.tip) b.title = t.tip;
      b.onclick = () => applyCamTemplate(t);
      return b;
    });
  }
}

/* ---------------- 插入片段（界面与 AI 共用） ----------------
   这三个函数是「唯一实现」：界面按钮和 AI 编排都走它们，
   免得两套逻辑慢慢分叉。它们只改对象本身，不碰 App.sel、不刷新 ——
   由调用方决定选中什么、什么时候刷新。 */

/* 在角色 o 的 t 时刻插一段动作。t 处已有动作片段就覆盖它（与界面行为一致）。 */
function insertActionClip(o, actionId, t, over) {
  const a = ACTIONS[actionId];
  if (!a) {
    /* 和运镜那边同理：模型偶尔会把运镜 / 走位模板的 id 填进 action。 */
    let hint = '';
    if (CAM_TEMPLATES.some(x => x.id === actionId)) hint = '「' + actionId + '」是运镜，不是动作。';
    else if (MOVE_TEMPLATES.some(x => x.id === actionId)) hint = '「' + actionId + '」是走位模板，不是动作。';
    throw new Error('没有这个动作：' + actionId + '。' + hint +
      '可用动作：' + ACTION_IDS.join('、'));
  }
  over = over || {};
  const start = +clamp(t, 0, App.state.duration).toFixed(2);

  /* 「转身」类：不改姿态，改的是朝向 —— 生成 turn 片段，
     和拖拽旋转、AI 的 face 走同一条路（同一个 kind，渲染/时间轴都不用改）。
     相对角度（turn: ±90/±180）按**当前朝向**算，所以连点两次会真的转两次；
     from 取 start 之前一点点，免得把同一时刻的旧 turn 片段算进去。 */
  const ts = typeof turnSpec === 'function' ? turnSpec(actionId) : null;
  if (ts) {
    const from = evalChar(o, Math.max(0, start - .01)).angle;
    /* 扫角显式存下来：相对角度（左转 / 右转）方向由动作定死，不许再归一化；
       绝对角度（面向 / 背对镜头）本来就没指定方向，走最短弧。
       不存的话 ±180° 会撞上 angDelta 的歧义点，左右两个按钮转成一样。
       to 则保持动作原本写的值（绝对目标就存绝对角）——
       免得「面向镜头」从 180° 变成 -180°，虽然方向相同，但界面和存档里看着像换了目标。 */
    const sweep = ts.abs != null ? angDelta(from, ts.abs) : ts.rel;
    const to = ts.abs != null ? ts.abs : from + sweep;
    const data = { kind: 'turn', start, dur: over.dur != null ? +over.dur : ts.dur, from, to, sweep, ease: 'inout' };
    const existT = o.clips.find(c => c.kind === 'turn' && Math.abs(c.start - start) < .05);
    if (existT) { Object.assign(existT, data); return existT; }
    const ct = Object.assign({ id: uid('cp') }, data);
    o.clips.push(ct);
    return ct;
  }

  const data = {
    kind: 'action', start,
    dur: over.dur != null ? +over.dur : a.dur,
    action: actionId,
    loop: over.loop != null ? !!over.loop : !!a.loop,
    hold: !!a.hold,
  };
  const exist = o.clips.find(c => c.kind === 'action' && Math.abs(c.start - start) < .05);
  if (exist) { Object.assign(exist, data); return exist; }
  const c = Object.assign({ id: uid('cp') }, data);
  o.clips.push(c);
  return c;
}

/* 在角色 o 的 t 时刻插一条走位。path 是 [{x,y}] 世界像素坐标。 */
function insertMoveClip(o, path, t, dur, ease, arc) {
  const clip = {
    id: uid('cp'), kind: 'move',
    start: +clamp(t, 0, App.state.duration).toFixed(2),
    dur: +dur || 2.5, ease: ease || 'inout',
    path: (path || []).map(p => ({ x: p.x, y: p.y })),
  };
  /* 环绕类的走位，路径点连出来是内接多边形 —— 把圆心一起带上，
     求值时就按圆弧算（见 core.js 的 arcPoint）。显式写 null 而不是省略字段，
     这样存档里一眼能看出「这条走位不是弧」。 */
  clip.arc = arc ? { cx: +arc.cx, cy: +arc.cy } : null;
  o.clips.push(clip);
  return clip;
}

/* 给摄像机套一个运镜模板。t0 之后的关键帧会被清掉（与界面行为一致）。 */
function insertCamTemplate(cam, templateId, t0, ctx) {
  const t = CAM_TEMPLATES.find(x => x.id === templateId);
  if (!t) {
    /* 报错得能照着改。实测模型会把**别的表**里的 id 当成运镜用 ——
       最典型的是 arc：它在走位模板里（弧线绕行），运镜里没有。
       只说「没有这个运镜」，用户不知道该填什么，也看不出错在哪。 */
    let hint = '';
    if (MOVE_TEMPLATES.some(x => x.id === templateId)) hint = '「' + templateId + '」是走位模板，不是运镜。';
    else if (ACTIONS[templateId]) hint = '「' + templateId + '」是动作，不是运镜。';
    throw new Error('没有这个运镜：' + templateId + '。' + hint +
      '可用运镜：' + CAM_TEMPLATES.map(x => x.id).join('、'));
  }
  ctx = ctx || {};
  const s = evalCam(cam, t0);
  const res = t.make(cam, s, t0, t.dur || 2, {
    pm: App.state.pxPerMeter, target: ctx.target || null, targetId: ctx.targetId || null,
  });
  /* 只保留 t0 之前的关键帧 —— 注意是严格小于。
     用 <= 的话，t0 上原有的键会被留下，紧接着下面又插一个 t0 的新键，
     同一时刻就出现两个键：画面上两个重叠的标记，evalCam 也只会用到后一个。
     新键的状态是从 evalCam(cam, t0) 取的（在过滤之前算好），所以信息不会丢。 */
  cam.keys = cam.keys.filter(k => k.t < t0 - .001);
  if (res.keys && res.keys.length) {
    /* 模板自己给了 t0 的关键帧，就用它的。有些运镜的起点状态和「当前」不同：
       摇臂下降要先升到 6.5m 再降，推轨变焦要先把镜头对准主体。
       以前这里无条件塞一个 mkKey(t0, s)，会把这些起手覆盖掉。 */
    const startKey = res.keys.find(k => Math.abs(k.t - t0) <= .02);
    cam.keys.push(startKey || mkKey(t0, s));
    cam.keys = cam.keys.concat(res.keys.filter(k => Math.abs(k.t - t0) > .02));
    cam.keys.sort((a, b) => a.t - b.t);
  }
  /* 「跟随」和「关键帧」是互斥的两种控制方式，必须二选一。
     为什么：evalCam 里 follow 一开着，就会**整个覆盖**键里算出来的 x / y / angle。
     于是往一台跟随某角色的机位上插任何自主运镜（orbit / dollyIn / panR / 螺旋…），
     键全都在、画面却纹丝不动 —— 日志还写着 ✓ 环绕一圈。
     用户反馈的「模型好像不理解什么是摄像头以圆形移动」就是这个：
     模型其实**选对了** orbit，是这里把运镜整个吃掉了（p10_follow.js 有对照组坐实）。
     规则：模板要么是跟随类（设上 follow），要么是自主运镜（把 follow 让出来）。 */
  const hadFollow = !!(cam.follow && cam.follow.targetId);
  let followOff = false;
  if (t.follow) cam.follow = res.follow || null;
  else if (hadFollow) { cam.follow = null; followOff = true; }

  /* 记一笔「这台机位做过什么运镜」。AI 编排要靠它才知道用户说的
     「这个镜头」指的是哪一段、做的是什么 —— 光看关键帧数猜不出来。
     界面上也用得到（机位属性面板里可以列出来）。 */
  if (!cam.moves) cam.moves = [];
  /* 时间上「压住」了前一次运镜时要说一声：
     上面那句 filter(k => k.t < t0 - .001) 会把 t0 之后的键全切掉 ——
     前一次运镜的窗口要是还没走完，它的后半段（甚至全部）就没了。
     实测用户贴一段分镜描述时，模型一口气写了 3 条 shot 挤在 0.8~1.3s，
     结果只有最后一条完整生效，日志里却三条都是 ✓ —— 很容易误判成「都加上了」。
     这是**正常**行为（后一条本来就该覆盖），所以只提示、不拦。 */
  const t0n = +t0;
  const cut = cam.moves
    .filter(mv => mv.t + mv.dur > t0n + .02)
    .map(mv => {
      const p = CAM_TEMPLATES.find(x => x.id === mv.tpl);
      return (p ? p.label : mv.tpl) + '(' + mv.t + '~' + (mv.t + mv.dur).toFixed(1) + 's)';
    });
  cam.moves.push({ tpl: t.id, t: +(t0n).toFixed(2), dur: +(t.dur || 2).toFixed(2) });
  /* 返回值带上「这次有没有把跟随关掉」「压掉了哪一段」，调用方要写进日志 / toast ——
     默默把跟随关掉、或者默默吃掉半段运镜而用户不知道，都是误导。 */
  return { tpl: t, followOff: followOff, cut: cut };
}

function applyAction(id) {
  const o = getSelObj();
  if (!o || o.type !== 'char') { toast('先选中一个角色'); return; }
  pushUndo();
  const c = insertActionClip(o, id, App.time);
  App.sel = { kind: 'char', id: o.id, clipId: c.id };
  refreshAll();
  toast((c.kind === 'turn' ? '已插入转身：' : '已插入动作：') + ACTIONS[id].label);
}

function applyMoveTemplate(t) {
  const o = getSelObj();
  if (!o || o.type !== 'char') { toast('先选中一个角色'); return; }
  pushUndo();
  const sp = moveSpec(t, o, App.state.pxPerMeter);
  const clip = insertMoveClip(o, sp.path, App.time, t.dur, null, sp.arc);
  App.sel = { kind: 'char', id: o.id, clipId: clip.id };
  refreshAll();
  toast('已生成走位：' + t.label + (sp.arc ? '（圆弧）' : ''));
}

function applyCamTemplate(t) {
  const o = getSelObj();
  if (!o || o.type !== 'cam') { toast('先选中一台摄像机'); return; }
  /* App.lastCharId 理论上只指向角色，但对象可能已被删掉 ——
     取不到就当作「没选主体」，让运镜退回镜头正前方，别拿一台机位当主体。 */
  const tg0 = App.lastCharId ? getObj(App.lastCharId) : null;
  const tg = tg0 && tg0.type === 'char' ? tg0 : null;
  if (t.follow && !tg) { toast('先选中一个角色，再套跟随类运镜'); return; }
  pushUndo();
  const s2 = tg ? evalChar(tg, App.time) : null;
  const r = insertCamTemplate(o, t.id, App.time, {
    target: s2 ? { x: s2.x, y: s2.y } : null,
    targetId: tg ? tg.id : null,
  });
  App.sel = { kind: 'cam', id: o.id };
  refreshAll();
  toast('已应用运镜：' + t.label +
    (r.followOff ? '（原来是跟随机位，已关闭跟随、改用关键帧）' : '') +
    (r.cut && r.cut.length ? '；覆盖了「' + r.cut.join('」「') + '」的后半段' : ''));
}

/* ---------------- 存档 ---------------- */
function saveProject() {
  const blob = new Blob([serialize()], { type: 'application/json' });
  downloadBlob(blob, safeName() + '-' + stamp() + '.json');
  toast('项目已保存');
}
function loadProject(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const st = deserialize(r.result);
      App.state = st;
      App.sel = null;
      App.time = 0;
      setBackground(st.bg, () => {
        App.state.bgW = st.bgW; App.state.bgH = st.bgH;
        fitView();
        refreshAll();
        toast('项目已打开');
      });
    } catch (e) {
      toast('打开失败：' + e.message);
    }
  };
  r.readAsText(file);
}

/* ---------------- 3D 观察视图 ---------------- */
function fitView3D() {
  const st = App.state;
  App.view3d.tx = st.bgW / 2;
  App.view3d.ty = st.bgH / 2;
  App.view3d.dist = Math.max(st.bgW, st.bgH) * .85;
  App.view3d.elev = 24 * DEG;
  App.view3d.yaw = -35 * DEG;
}
function view3dCamera() {
  const pm = App.state.pxPerMeter, v = App.view3d;
  const elev = clamp(v.elev, -3 * DEG, 88 * DEG);
  const d = v.dist > 0 ? v.dist : Math.max(App.state.bgW, App.state.bgH) * .85;
  const ce = Math.cos(elev), se = Math.sin(elev);
  const L = ce * d;
  /* 相机前向为 (sin yaw, -cos yaw)，故眼睛位于 target - L·前向 */
  const ex = v.tx - Math.sin(v.yaw) * L;
  const ey = v.ty + Math.cos(v.yaw) * L;
  const ez = Math.max(pm * .4, se * d);
  return { x: ex, y: ey, height: ez / pm, angle: v.yaw, pitch: elev, fov: 42, name: '3D 观察' };
}
function renderStage3D() {
  const cv = $('#stage');
  const ctx = cv.getContext('2d');
  const W = App.vw, H = App.vh, dpr = App.dpr;
  const cs = view3dCamera();
  renderShot(ctx, W, H, cs, App.time, {
    /* 3D 观察是编辑器的立体巡检视角，与"画面"无关：恒走透视 + 立体人物。
       否则切到 2D 平面时，场景里的平面剪影被侧着看会变成贴地薄片，像坏了一样。 */
    mode: '3d', ortho: false, guides: false, hud: false, dpr: dpr,
    overlay: drawStage3DOverlay,
  });
}
function drawStage3DOverlay(ctx, B, t) {
  const pm = App.state.pxPerMeter;
  const poly = (pts, z) => {
    let ok = true;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const q = projPt(B, pts[i].x, pts[i].y, z || 0);
      if (!q) { ok = false; break; }
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    }
    return ok;
  };
  /* 视线扇形：地面标记，铺在最底层（后面还有走位线、机位轨迹、机位本体） */
  for (const o of App.state.objects) {
    if (o.type !== 'char') continue;
    const s = evalChar(o, t);
    if (!poly(gazeSector(s, pm), 0)) continue;
    ctx.closePath();
    ctx.fillStyle = o.color + '1f';
    ctx.fill();
    ctx.strokeStyle = o.color + '52';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
  }
  /* 走位线 */
  for (const o of App.state.objects) {
    if (o.type !== 'char') continue;
    for (const c of clipsOf(o, 'move')) {
      if (!c.path || c.path.length < 2) continue;
      const on = App.sel && App.sel.clipId === c.id;
      /* 有 arc 的走位按弧采样（不然画出来是十二边形、和实际运动对不上） */
      if (!poly(pathPolyline(c.path, c.arc))) continue;
      ctx.strokeStyle = on ? '#2b6cf6' : (App.sel && App.sel.id === o.id ? 'rgba(43,108,246,.6)' : 'rgba(70,95,130,.42)');
      ctx.lineWidth = on ? 2.5 : 1.6;
      ctx.setLineDash(on ? [] : [7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (on) for (const pt of c.path) {
        const q = projPt(B, pt.x, pt.y, 0);
        if (!q) continue;
        ctx.beginPath(); ctx.rect(q.x - 4, q.y - 4, 8, 8);
        ctx.fillStyle = '#2b6cf6'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }
  /* 摄像机 */
  for (const o of App.state.objects) {
    if (o.type !== 'cam') continue;
    /* 运镜轨迹（只画当前机位）：让用户能直接看出「环绕是不是圆」 */
    if (o.id === App.state.activeCam) {
      const tr = camTrail(o);
      if (tr.length >= 2 && poly(tr)) {
        ctx.strokeStyle = 'rgba(124,92,255,.5)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([7, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const cs = evalCam(o, t);
    const fp = camFootprint(cs, App.previewRes[0] / App.previewRes[1], pm * 45);
    if (poly(fp)) {
      ctx.closePath();
      ctx.fillStyle = 'rgba(124,92,255,.14)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(124,92,255,.62)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    const base = projPt(B, cs.x, cs.y, 0);
    const top = projPt(B, cs.x, cs.y, cs.height * pm);
    if (base && top) {
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 1.6; ctx.stroke();
      const f = dirVec(cs.angle);
      const e = projPt(B, cs.x + f.x * 2 * pm, cs.y + f.y * 2 * pm, cs.height * pm);
      if (e) { ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(e.x, e.y); ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(base.x, base.y, 4, 0, TAU); ctx.fillStyle = 'rgba(124,92,255,.45)'; ctx.fill();
      ctx.beginPath(); ctx.arc(top.x, top.y, 6, 0, TAU);
      ctx.fillStyle = o.id === App.state.activeCam ? '#7c5cff' : '#b7a8ff';
      ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, o.name + (o.id === App.state.activeCam ? ' ●' : ''), top.x, top.y - 15,
        o.id === App.state.activeCam ? '#5233c9' : '#7b86a0', 11.5);
    }
  }
  /* 选中对象的地面环 */
  const so = getSelObj();
  if (so && so.type === 'char') {
    const s = evalChar(so, App.time);
    groundDisc(ctx, B, s.x, s.y, so.width * pm * .95, null, '#2b6cf6', 2);
  } else if (so && so.type === 'cam') {
    const s = evalCam(so, App.time);
    groundDisc(ctx, B, s.x, s.y, .6 * pm, null, '#7c5cff', 2);
  }
}
function hitTest3D(sx, sy, B) {
  for (let i = App.state.objects.length - 1; i >= 0; i--) {
    const o = App.state.objects[i];
    const s = o.type === 'char' ? evalChar(o, App.time) : evalCam(o, App.time);
    const foot = projPt(B, s.x, s.y, 0);
    const head = projPt(B, s.x, s.y, o.height * B.pm);
    if (!foot) continue;
    let r = 14;
    if (head) r = Math.max(12, (foot.y - head.y) * .42);
    if (Math.hypot(sx - foot.x, sy - foot.y) <= r + 4) return { id: o.id };
  }
  return null;
}

/* ---------------- 镜头预演播放器 ---------------- */
/* ---------------- 缩放 + 平移（预演窗口 / 放大观察共用） ----------------
   缩放：只改**显示尺寸**，画布本身的分辨率不动 ——
   所以「存当前帧」「录制并导出」出来的还是设定的那个分辨率。
   为什么需要它：朝向细节（鼻尖、两眼、脚尖）在整幅 720p 画面里只有几个像素，
   不放大根本看不见 —— 「朝向看不出来」有一半其实是尺寸问题。
   预演窗口和放大观察要的是同一套行为（同一个「适应」算法、同一个锚点规则），
   所以抽成一个控制器，只是各自记自己的倍数（App.playerZoom / App.loupeZoom，
   0 表示还没算过）。 */
function makeZoomPan(cvSel, stageSel, getZ, setZ, valSel) {
  const cvOf = () => $(cvSel), stOf = () => $(stageSel);
  function fitZ() {
    const cv = cvOf(), st = stOf();
    if (!cv || !st) return 1;
    const w = Math.max(40, st.clientWidth - 16), h = Math.max(40, st.clientHeight - 16);
    return clamp(Math.min(w / cv.width, h / cv.height), .1, 3);
  }
  function paint(z) { const v = $(valSel); if (v) v.textContent = Math.round(z * 100) + '%'; }
  function apply(doFit) {
    const cv = cvOf(), st = stOf();
    if (!cv) return;
    if (doFit || !getZ()) setZ(fitZ());
    const z = getZ();
    cv.style.width = Math.round(cv.width * z) + 'px';
    cv.style.height = Math.round(cv.height * z) + 'px';
    if (st) {
      st.scrollLeft = (cv.width * z - st.clientWidth) / 2;
      st.scrollTop = (cv.height * z - st.clientHeight) / 2;
    }
    paint(z);
  }
  function zoomTo(z) {
    const cv = cvOf(), st = stOf();
    if (!cv || !st) return;
    z = clamp(z, .1, 6);
    const old = getZ() || 1;
    /* 以视口中心为锚点缩放：先记下当前中心落在画布的哪个相对位置，
       改完尺寸再把滚动条挪回去 —— 否则一放大就跳到左上角，
       而用户想看的正是刚才画面中心那个人。 */
    const ax = (st.scrollLeft + st.clientWidth / 2) / Math.max(1, cv.width * old);
    const ay = (st.scrollTop + st.clientHeight / 2) / Math.max(1, cv.height * old);
    setZ(z);
    cv.style.width = Math.round(cv.width * z) + 'px';
    cv.style.height = Math.round(cv.height * z) + 'px';
    st.scrollLeft = ax * cv.width * z - st.clientWidth / 2;
    st.scrollTop = ay * cv.height * z - st.clientHeight / 2;
    paint(z);
  }
  /* 缩放到 z，并把画布上的点 (ax, ay) 摆到视口正中。
     用途：1:1 时把「主体」放到画面中间，而不是放到整幅图的几何中心。 */
  function centerOn(z, ax, ay) {
    const cv = cvOf(), st = stOf();
    if (!cv || !st) return;
    z = clamp(z, .1, 6);
    setZ(z);
    cv.style.width = Math.round(cv.width * z) + 'px';
    cv.style.height = Math.round(cv.height * z) + 'px';
    st.scrollLeft = ax * z - st.clientWidth / 2;
    st.scrollTop = ay * z - st.clientHeight / 2;
    paint(z);
  }
  /* 以**指针位置**为锚点缩放：想看哪个人，把指针放他身上再滚。
     以视口中心为锚点的话，画面边上的人一放大就出画了 ——
     而「放大看朝向」看的十有八九就是画面边上那个人。
     画布坐标 = (屏幕坐标 − 画布左边缘) / 缩放倍数（显示尺寸 = 画布尺寸 × z）。 */
  function zoomAtPointer(z, clientX, clientY) {
    const cv = cvOf(), st = stOf();
    if (!cv || !st) return;
    const z0 = getZ() || 1;
    const cr = cv.getBoundingClientRect();
    zoomAt(z, (clientX - cr.left) / z0, (clientY - cr.top) / z0);
  }
  /* 把画布上的点 (ax, ay) 钉在原地缩放。
     为什么要先归零滚动量一次：画布比容器小时 margin:auto 把它居中，
     放大到超出容器后这个居中偏移就没了 —— 不实测一下，
     缩放点会整体漂掉半个容器宽。 */
  function zoomAt(z, ax, ay) {
    const cv = cvOf(), st = stOf();
    if (!cv || !st) return;
    z = clamp(z, .1, 6);
    const z0 = getZ() || 1;
    const r0 = cv.getBoundingClientRect(), s0 = st.getBoundingClientRect();
    const px = (r0.left - s0.left) + ax * z0;
    const py = (r0.top - s0.top) + ay * z0;
    setZ(z);
    cv.style.width = Math.round(cv.width * z) + 'px';
    cv.style.height = Math.round(cv.height * z) + 'px';
    st.scrollLeft = 0; st.scrollTop = 0;
    const r1 = cv.getBoundingClientRect(), s1 = st.getBoundingClientRect();
    st.scrollLeft = (r1.left - s1.left) + ax * z - px;
    st.scrollTop = (r1.top - s1.top) + ay * z - py;
    paint(z);
  }
  /* 滚轮缩放：指针停在画布上才拦（不然会连容器一起滚）；
     拖动平移：左键按住拖，配合放大后看画面角落。 */
  function bind() {
    const st = stOf();
    if (!st) return;
    st.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAtPointer((getZ() || 1) * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    }, { passive: false });
    let drag = null;
    st.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, sl: st.scrollLeft, st: st.scrollTop };
      st.classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      st.scrollLeft = drag.sl - (e.clientX - drag.x);
      st.scrollTop = drag.st - (e.clientY - drag.y);
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = null; st.classList.remove('dragging'); } });
  }
  return { fitZ: fitZ, apply: apply, zoomTo: zoomTo, zoomAt: zoomAt, centerOn: centerOn, bind: bind };
}

function playerStage() { return document.querySelector('.player-stage'); }
const playerZP = makeZoomPan('#pl-canvas', '.player-stage',
  () => App.playerZoom, z => { App.playerZoom = z; }, '#pl-zoom-val');
function fitPlayerZoom() { return playerZP.fitZ(); }
function applyPlayerZoom(fit) { playerZP.apply(fit); }
function setPlayerZoom(z) { playerZP.zoomTo(z); }

/* ---------------- 放大观察（双击右下角镜头预览） ----------------
   为什么不直接复用预演窗口：预演是「看整条片子」的地方（播放 / 拖时间 / 录制），
   是个会盖住时间轴的大模态；而双击预览是「就地看清这一帧」，
   要的是快进快出。所以这里不放录制，只有放大和平移，Esc / 双击画面就退。
   分辨率也比面板预览高一档 —— 面板 1280×720 缩到 270px 宽显示，
   直接 1:1 看等于把细节糊掉了；这里按 ≥1920 宽重渲染，放大才是真多出细节。 */
function loupeRes() {
  const w = App.previewRes[0], h = App.previewRes[1];
  const k = clamp(1920 / w, 1, 3);
  return [Math.round(w * k), Math.round(h * k)];
}
const loupeZP = makeZoomPan('#lp-canvas', '.loupe-stage',
  () => App.loupeZoom, z => { App.loupeZoom = z; }, '#lp-zoom-val');
/* 「放大看细节」看的多半是画面里的主体：优先取机位跟随的目标，
   没有跟随就取离机位最近的那个角色。 */
function subjectChar(cam) {
  if (cam && cam.follow && cam.follow.targetId) {
    const t = getObj(cam.follow.targetId);
    if (t && t.type === 'char') return t;
  }
  const list = chars();
  if (!list.length) return null;
  const cs = evalCam(cam, App.time);
  let best = list[0], bd = Infinity;
  for (const c of list) {
    const s = evalChar(c, App.time);
    const d = Math.hypot(s.x - cs.x, s.y - cs.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
/* 缩放到 z，并把主体摆到画面正中。
   为什么不能只是「居中放大」：1:1 时画布是 1920×1080，而容器只有 ~1100px 宽，
   按图像几何中心放大，站在画面边上的人直接跑出视野 ——
   用户还得先拖着找半天，跟「放大看清这个人」正好相反。
   主体在镜头背后（projPt 返回 null）时才退回普通居中放大。 */
function loupeFocus(z) {
  const cv = $('#lp-canvas'), st = document.querySelector('.loupe-stage');
  const cam = activeCamObj();
  if (!cv || !st || !cam) { loupeZP.zoomTo(z); return; }
  const ch = subjectChar(cam);
  let p = null;
  if (ch) {
    const s = evalChar(ch, App.time);
    /* 瞄身高 82% 的位置（胸口上下）—— 瞄脚底的话，放大后人会贴在画面下沿 */
    p = projPt(makeBasis(evalCam(cam, App.time), cv.width, cv.height),
      s.x, s.y, ch.height * App.state.pxPerMeter * .82);
  }
  if (p) loupeZP.centerOn(z, p.x, p.y); else loupeZP.zoomTo(z);
}
function openLoupe() {
  if (!activeCamObj()) { toast('还没有摄像机：先用「放摄像机」在图上点一下'); return; }
  App.loupeOpen = true;
  const cv = $('#lp-canvas');
  const r = loupeRes();
  cv.width = r[0]; cv.height = r[1];
  $('#lp-res').value = App.previewRes[0] + 'x' + App.previewRes[1];
  $('#lp-guides').checked = App.loupeGuides;
  $('#loupe').classList.remove('hidden');
  App.loupeZoom = 0;                 /* 每次打开都按当前窗口重新算「适应」 */
  loupeZP.apply(true);
  renderLoupe();
}
function closeLoupe() {
  App.loupeOpen = false;
  const el0 = $('#loupe');
  if (el0) el0.classList.add('hidden');
}
function renderLoupe() {
  if (!App.loupeOpen) return;
  const cv = $('#lp-canvas');
  const cam = activeCamObj();
  if (!cv || !cam) return;
  renderShot(cv.getContext('2d'), cv.width, cv.height, evalCam(cam, App.time), App.time,
    { mode: App.mode, ortho: App.mode === '2d', guides: App.loupeGuides, hud: true });
  $('#lp-cam').textContent = cam.name;
  $('#lp-cur').textContent = fmt(App.time, 2);
  $('#lp-dur').textContent = fmt(App.state.duration, 2);
}
function bindLoupe() {
  const wrap = $('#preview-wrap');
  if (wrap) wrap.addEventListener('dblclick', openLoupe);
  $('#lp-close').onclick = closeLoupe;
  $('#loupe').onclick = e => { if (e.target.id === 'loupe') closeLoupe(); };
  $('#lp-guides').onchange = e => { App.loupeGuides = e.target.checked; renderLoupe(); };
  $('#lp-zoom-in').onclick = () => loupeZP.zoomTo((App.loupeZoom || 1) * 1.25);
  $('#lp-zoom-out').onclick = () => loupeZP.zoomTo((App.loupeZoom || 1) / 1.25);
  $('#lp-zoom-fit').onclick = () => loupeZP.apply(true);
  $('#lp-zoom-1').onclick = () => loupeFocus(1);
  /* 双击画面：在「适应」和 1:1 之间来回 —— 看得清细节和看得见全貌，
     是看这一帧时最常用的两个档。 */
  const st = document.querySelector('.loupe-stage');
  if (st) st.addEventListener('dblclick', () => {
    const atOne = Math.abs((App.loupeZoom || 1) - 1) < .01;
    if (atOne) loupeZP.apply(true); else loupeFocus(1);
  });
  $('#lp-snap').onclick = () => exportCamPNG(loupeRes(), null);
  $('#lp-player').onclick = () => { closeLoupe(); openPlayer(); };
  $('#lp-res').onchange = e => {
    const p = e.target.value.split('x');
    App.previewRes = [parseInt(p[0], 10), parseInt(p[1], 10)];
    const sel = $('#sel-res');
    if (sel) sel.value = e.target.value;
    resizeCanvases();
    const cv = $('#lp-canvas');
    const r = loupeRes();
    cv.width = r[0]; cv.height = r[1];
    App.loupeZoom = 0; loupeZP.apply(true);   /* 换了分辨率，「适应」要重算 */
    renderLoupe();
  };
  loupeZP.bind();
}
function openPlayer() {
  const cam = activeCamObj();
  if (!cam) { toast('请先添加并选中一台摄像机'); return; }
  App.playerOpen = true;
  $('#player').classList.remove('hidden');
  $('#pl-cam').textContent = cam.name;
  $('#pl-loop').checked = App.loop;
  $('#pl-gaze').checked = App.playerGaze;
  const sel = $('#pl-res');
  sel.value = App.playerRes[0] + 'x' + App.playerRes[1];
  const cv = $('#pl-canvas');
  cv.width = App.playerRes[0]; cv.height = App.playerRes[1];
  App.playerZoom = 0;              /* 每次打开都按当前窗口重新算「适应」 */
  applyPlayerZoom(true);
  renderPlayer();
}
function closePlayer() {
  App.playerOpen = false;
  $('#player').classList.add('hidden');
}
function renderPlayer() {
  if (!App.playerOpen) return;
  const cv = $('#pl-canvas');
  const W = cv.width, H = cv.height;
  const ctx = cv.getContext('2d');
  const cam = activeCamObj();
  if (!cam) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#12161d'; ctx.fillRect(0, 0, W, H);
    return;
  }
  renderShot(ctx, W, H, evalCam(cam, App.time), App.time,
    { mode: App.mode, ortho: App.mode === '2d', guides: App.playerGuides, gaze: App.playerGaze, hud: true });
  $('#pl-cam').textContent = cam.name;
  $('#pl-cur').textContent = fmt(App.time, 2);
  $('#pl-dur').textContent = fmt(App.state.duration, 2);
  $('#pl-scrub').value = Math.round(App.time / App.state.duration * 1000);
  $('#pl-play').textContent = App.playing ? '❚❚ 暂停' : '▶ 播放';
}
function bindPlayer() {
  $('#pl-close').onclick = closePlayer;
  $('#player').onclick = e => { if (e.target.id === 'player') closePlayer(); };
  $('#btn-player').onclick = openPlayer;
  $('#pl-play').onclick = () => { setPlaying(!App.playing); renderPlayer(); };
  $('#pl-stop').onclick = () => { setPlaying(false); setTime(0); renderPlayer(); };
  $('#pl-scrub').oninput = e => {
    setPlaying(false);
    setTime(parseFloat(e.target.value) / 1000 * App.state.duration);
    renderPlayer();
  };
  $('#pl-loop').onchange = e => { App.loop = e.target.checked; $('#chk-loop').checked = e.target.checked; };
  $('#pl-guides').onchange = e => { App.playerGuides = e.target.checked; renderPlayer(); };
  $('#pl-gaze').onchange = e => { App.playerGaze = e.target.checked; renderPlayer(); };

  /* ---- 缩放与平移（行为见 makeZoomPan） ---- */
  $('#pl-zoom-in').onclick = () => setPlayerZoom((App.playerZoom || 1) * 1.25);
  $('#pl-zoom-out').onclick = () => setPlayerZoom((App.playerZoom || 1) / 1.25);
  $('#pl-zoom-fit').onclick = () => applyPlayerZoom(true);
  playerZP.bind();

  $('#pl-res').onchange = e => {
    const p = e.target.value.split('x');
    App.playerRes = [parseInt(p[0], 10), parseInt(p[1], 10)];
    const cv = $('#pl-canvas');
    cv.width = App.playerRes[0]; cv.height = App.playerRes[1];
    App.playerZoom = 0; applyPlayerZoom(true);   /* 换了分辨率，「适应」要重算 */
    renderPlayer();
  };
  $('#pl-snap').onclick = () => exportCamPNG(App.playerRes.slice());
  $('#pl-rec').onclick = () => exportVideo(App.playerRes.slice());
}

/* ---------------- 主循环 ---------------- */
let _last = performance.now(), _lastPrev = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(.1, (now - _last) / 1000);
  _last = now;
  if (App.recording) return;
  if (App.playing) {
    App.time += dt;
    if (App.time >= App.state.duration) {
      if (App.loop) App.time = 0;
      else { App.time = App.state.duration; setPlaying(false); }
    }
    updateTimeUI();
    updatePlayhead();
  }
  draw();
  if (now - _lastPrev > 33) {
    _lastPrev = now;
    renderView();
  }
}

/* ---------------- 导出位置设置 ----------------
   三档：记住文件夹（默认）/ 每次都问 / 浏览器下载。
   默认档在**还没选过文件夹**时不弹窗、照旧走下载 —— 否则第一次导出
   突然冒出个「选择文件夹」对话框，比每次都问还烦。 */
function openExportSettings() {
  const dirAPI = hasDirAPI(), saveAPI = hasSaveAPI();
  const cur = ExportLoc.handle ? (ExportLoc.name || '已记住的文件夹') : '（还没选，导出进浏览器下载目录）';
  const opt = (val, title, desc, dis) =>
    '<label class="exset-opt' + (ExportLoc.mode === val ? ' on' : '') + (dis ? ' dis' : '') + '">' +
    '<input type="radio" name="exmode" value="' + val + '"' + (ExportLoc.mode === val ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
    '<span><span class="t">' + title + '</span><span class="d">' + desc + '</span></span></label>';
  const html = '<div class="exset">' +
    '<p class="ai-hint">导出的图 / 视频默认存到哪里。<b>选一次文件夹之后，以后导出直接写进去、不再弹窗</b>；' +
    '想临时换个地方，按住 <code>Shift</code> 点导出按钮就行。</p>' +
    opt('remember', '记住这个文件夹（推荐）',
      dirAPI ? '选一次目录，之后所有导出静默写入。同名文件自动加 (2)(3)，不会覆盖上一次的成片。'
        : '这个浏览器不支持选文件夹（换成 Chrome / Edge 才有），下面两档仍可用。', !dirAPI) +
    opt('ask', '每次导出都问我', '每次都弹「另存为」，自己挑位置、改文件名。', !saveAPI) +
    opt('download', '直接下到浏览器下载目录', '老行为：不弹窗，进浏览器的默认下载位置。') +
    '<div class="exset-dir"><span>当前文件夹：</span><code>' + escHtml(cur) + '</code><span class="spacer"></span>' +
    '<button class="btn tiny" id="ex-pick"' + (dirAPI ? '' : ' disabled') + '>选择文件夹…</button>' +
    '<button class="btn tiny ghost" id="ex-clear"' + (ExportLoc.handle ? '' : ' disabled') + '>清除</button></div>' +
    '<div class="row wrap">' +
    '<label class="ai-chk"><input type="radio" name="exdup" value="suffix"' + (ExportLoc.dup === 'suffix' ? ' checked' : '') + '> 同名时自动加序号</label>' +
    '<label class="ai-chk"><input type="radio" name="exdup" value="overwrite"' + (ExportLoc.dup === 'overwrite' ? ' checked' : '') + '> 同名时直接覆盖</label>' +
    '</div>' +
    '<p class="ai-hint">换过浏览器、或清过站点数据之后，文件夹的访问许可会失效 —— ' +
    '那时导出会请你重新授权一次，不会静默写失败。</p>' +
    '</div>';
  openModal('导出位置', html);

  document.querySelectorAll('input[name=exmode]').forEach(r => r.onchange = () => {
    if (!r.checked) return;
    ExportLoc.mode = r.value; saveExportCfg(); openExportSettings();
  });
  document.querySelectorAll('input[name=exdup]').forEach(r => r.onchange = () => {
    if (!r.checked) return;
    ExportLoc.dup = r.value; saveExportCfg();
  });
  const pick = $('#ex-pick');
  if (pick) pick.onclick = async () => {
    const r = await chooseExportDir();
    if (r === 'ok') { toast('导出文件夹：' + ExportLoc.name); openExportSettings(); }
    else if (r === 'fail') toast('这个浏览器不能选文件夹，换 Chrome / Edge');
  };
  const clr = $('#ex-clear');
  if (clr) clr.onclick = () => { forgetExportDir(); saveExportCfg(); openExportSettings(); toast('已清除记住的文件夹'); };
}

/* ---------------- 时间轴高度 ----------------
   时间轴贴着窗口底部，所以往上拖 = 变高；高度记在 localStorage 里，
   下次打开还是你调过的高度。 */
function setTlHeight(v) {
  const tl = $('#timeline');
  if (!tl) return;
  const min = 118, max = Math.max(min, Math.round(window.innerHeight * .7));
  const h = clamp(Math.round(v), min, max);
  App.tlH = h;
  tl.style.height = h + 'px';
  try { localStorage.setItem('sb.tlH', String(h)); } catch (e) { }
  draw();
  updatePlayhead();
}
function bindTlResize() {
  const bar = $('#tl-resize'), tl = $('#timeline');
  if (!bar || !tl) return;
  try {
    const h = parseFloat(localStorage.getItem('sb.tlH'));
    if (h) setTlHeight(h);
  } catch (e) { }
  bar.addEventListener('pointerdown', e => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = tl.getBoundingClientRect().height;
    bar.classList.add('on');
    const mv = ev => setTlHeight(h0 - (ev.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      bar.classList.remove('on');
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => setTlHeight(App.tlH <= 122 ? 260 : 118));
}

/* ---------------- 初始化 ---------------- */
function refreshAll() {
  if (!App.state) return;
  $('#inp-dur').value = App.state.duration;
  $('#inp-fps').value = App.state.fps;
  renderLayers();
  renderProps();
  renderTimeline();
  updateTimeUI();
  updatePlayhead();
  draw();
  updateHud();
  renderView();
}

function initUI() {
  $('#btn-bg').onclick = () => $('#file-bg').click();
  $('#file-bg').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      pushUndo();
      setBackground(r.result, () => { fitView(); refreshAll(); toast('背景已导入 ' + App.state.bgW + '×' + App.state.bgH); });
    };
    r.readAsDataURL(f);
    e.target.value = '';
  };
  $('#btn-sample').onclick = () => {
    pushUndo();
    const kind = App.state.bg && App.state.bg.indexOf('data:') === 0 && App._sampleKind === 'street' ? 'plaza' : 'street';
    App._sampleKind = kind;
    setBackground(makeSampleBg(kind), () => { fitView(); refreshAll(); toast('已生成示例背景（' + (kind === 'street' ? '街道' : '广场') + '）'); });
  };
  $('#btn-demo').onclick = () => {
    pushUndo();
    setBackground(makeSampleBg('street'), () => {
      App._sampleKind = 'street';
      buildDemoScene();
      fitView();
      setTime(0);
      refreshAll();
      toast('已生成示例场景，按空格播放');
    });
  };
  $('#btn-add-char').onclick = () => setTool('char');
  $('#btn-add-cam').onclick = () => setTool('cam');
  $('#btn-ai').onclick = () => openAIPanel();
  $('#btn-save').onclick = saveProject;
  $('#btn-load').onclick = () => $('#file-proj').click();
  $('#file-proj').onchange = e => { const f = e.target.files[0]; if (f) loadProject(f); e.target.value = ''; };
  $('#btn-undo').onclick = doUndo;
  /* 三个导出按钮：Shift + 点击 = 这一次走「另存为」（临时换位置，不改设置）。 */
  $('#btn-export-set').onclick = openExportSettings;
  $('#btn-png-top').onclick = e => exportTopPNG({ forcePicker: e.shiftKey });
  $('#btn-png-cam').onclick = e => exportCamPNG(null, { forcePicker: e.shiftKey });
  $('#btn-video').onclick = e => exportVideo(null, { forcePicker: e.shiftKey });
  $('#btn-play').onclick = () => setPlaying(!App.playing);
  $('#btn-stop').onclick = () => { setPlaying(false); setTime(0); };
  $('#chk-loop').onchange = e => { App.loop = e.target.checked; };
  $('#chk-guides').onchange = e => { App.showGuides = e.target.checked; renderPreview(); };
  $('#sel-res').onchange = e => {
    const p = e.target.value.split('x');
    App.previewRes = [parseInt(p[0], 10), parseInt(p[1], 10)];
    resizeCanvases(); draw(); renderPreview();
  };
  $('#inp-dur').oninput = e => {
    const v = parseFloat(e.target.value);
    if (isNaN(v)) return;
    App.state.duration = clamp(v, 1, 300);
    App.time = clamp(App.time, 0, App.state.duration);
    renderTimeline(); updateTimeUI(); updatePlayhead(); renderPreview();
  };
  $('#inp-fps').oninput = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) App.state.fps = clamp(v, 10, 60);
  };
  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  $('#btn-help').onclick = () => openModal('使用说明', HELP_HTML);

  document.querySelectorAll('.tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('#seg-mode button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll('#seg-view button').forEach(b => b.onclick = () => setStageView(b.dataset.view));
  bindPlayer();
  bindLoupe();
  bindTlResize();

  buildChips();
  bindStage();
  bindKeys();
  setTool('select');
  window.addEventListener('resize', () => { resizeCanvases(); draw(); });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { resizeCanvases(); draw(); }).observe($('#stage-wrap'));
  }
  resizeCanvases();
}

const HELP_HTML = `
<h4>三步上手</h4>
<ul>
<li><b>① 铺地面</b>：顶栏「导入背景图」放一张俯视图（小区、仓库、广场的平面图都行），或点「示例背景」自动生成一张。</li>
<li><b>② 摆人</b>：点「＋ 角色」或按 <code>2</code>，在图上点一下就放下一个角色块；拖圆环外的小球可以改朝向。</li>
<li><b>③ 编排</b>：选中角色 → 左侧「动作模板」加动作、用「画走位线」工具在图上点几个点画路径（回车结束）；选中摄像机 → 左侧「运镜模板」一键生成运镜。</li>
</ul>
<h4>3D / 2D 与两种视图</h4>
<ul>
<li><b>人物：3D 立体 / 2D 平面</b>（顶栏切换）。3D 是带体积的立体人物，镜头怎么转都对；2D 是永远正对镜头的平面剪影，像分镜草图。</li>
<li><b>舞台：俯视编辑 / 3D 观察</b>（舞台左上角切换）。俯视用来编排走位；3D 观察用来看立体效果——<b>拖动旋转、滚轮推拉、Shift 或中键拖动平移</b>，在 3D 里也能直接选中和拖动角色。</li>
<li>3D 观察里摄像机画成"地面标记 + 一根高度线 + 头顶的球"，一眼看出机位架多高。</li>
</ul>
<h4>画走位线</h4>
<ul>
<li>先选中角色或摄像机，再按 <code>4</code> 切到「画走位线」，在图上依次点击，<code>回车</code> 或双击结束。</li>
<li>右键可以退掉上一个点。角色会沿这条线按弧长匀速移动，默认 2.5s，可在属性面板改。</li>
<li>给摄像机画线会生成一串关键帧，镜头会沿路径走。</li>
</ul>
<h4>动作</h4>
<ul>
<li>动作是「片段」，插入在当前播放头位置；同一个时间点重复插入会替换。</li>
<li>带「保持终态」的动作（倒地、蹲下）播放完会停在末帧，不会自己站起来。</li>
<li>走路/奔跑/欢呼是循环动作，会一直循环到下一个动作片段开始。</li>
</ul>
<h4>运镜</h4>
<ul>
<li>套模板会截断「当前时间之后」的关键帧再追加，所以按时间顺序一段段叠就行。</li>
<li>俯视图上紫色的虚线四边形就是这台摄像机的地面视野范围，拖它的角点可以改视场角。</li>
<li>「跟随角色」会让摄像机自动跟在角色身后并看向目标。</li>
</ul>
<h4>预览镜头视频</h4>
<ul>
<li>顶栏点 <b>「预览镜头视频」</b> 打开大窗口预演：可播放/暂停、拖进度条、循环，还能在里面直接「录制并导出」或「存当前帧」。</li>
<li>预演窗口和主时间轴共用同一个播放头，所以你在哪里停下，导出的就是那一段。</li>
<li>预演窗口的分辨率可以单独设，建议先 960×540 试一遍再出 1080p。</li>
</ul>
<h4>导出</h4>
<ul>
<li><b>导出俯视图</b>：整张调度图（背景 + 角色 + 走位线 + 视野框）PNG。</li>
<li><b>导出镜头图</b>：当前时刻的镜头画面 PNG，按当前 3D/2D 模式渲染。</li>
<li><b>导出视频</b>：把整条时间轴按当前机位录成视频（优先 MP4，不支持则 WebM），录制时请不要切走标签页。</li>
</ul>
<h4>导出保存到哪里</h4>
<ul>
<li>顶栏 <b>「导出位置」</b>：选一次文件夹并记住之后，<b>以后每次导出直接写进去，不再弹窗</b>；也能切成「每次都问」或「直接下到浏览器下载目录」。</li>
<li>还没选过文件夹时，导出照旧进浏览器的下载目录 —— 不会突然弹一个对话框出来。</li>
<li>任何档位下，<b>按住 <code>Shift</code> 点导出按钮</b> = 这一次走「另存为」，临时换个位置、改个名字，不改动设置。</li>
<li>记住的文件夹里若已有同名文件，默认自动加 <code>(2)(3)</code>，不会覆盖上一次的成片（可在「导出位置」里改成直接覆盖）。</li>
<li>换浏览器或清过站点数据后，文件夹许可会失效，导出时会请你重新授权一次。</li>
</ul>
<h4>看清细节</h4>
<ul>
<li><b>双击右下角的镜头预览</b> → 打开「放大观察」：按更高分辨率重渲染（不是把小图拉大），<b>滚轮以指针为锚点缩放</b>（想看谁就把指针放谁身上），拖动平移，<code>Esc</code> 退出，也能在里面「存当前帧」。</li>
<li>点「<b>1:1</b>」或双击画面 = 缩到原始像素并把<b>主体摆到画面正中</b> —— 直接居中放大到 1920 宽的话，站在画面边上的人会跑出视野。再双击一次回到「适应」。</li>
<li>属性面板里 <b>朝向 / 俯仰 / 高度 / 视场角 / 跟随距离</b> 的滑块右边都有输入框，可以直接敲数值，不用拿滑块去瞄。</li>
<li>时间轴太矮老是点不中？拖它<b>最上面那条横线</b>改高度（双击那条线折叠 / 展开），高度会被记住。片段色条和关键帧方块也都加大了。</li>
</ul>
<h4>快捷键</h4>
<ul>
<li><code>1</code>~<code>5</code> 切换工具　<code>空格</code> 播放/暂停　<code>回车</code> 结束画线</li>
<li><code>Delete</code> 删除选中　<code>Ctrl+Z</code> 撤销　<code>Ctrl+S</code> 保存项目　<code>Esc</code> 关闭预演/取消</li>
<li>滚轮缩放，中键拖动平移。</li>
</ul>
`;
