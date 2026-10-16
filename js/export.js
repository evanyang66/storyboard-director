'use strict';
/* ============================================================
   export.js — 导出俯视图 PNG / 镜头图 PNG / 镜头视频
   ------------------------------------------------------------
   保存位置（顶栏「导出位置」里选，三档）：
     · remember（默认）—— 选过一次文件夹就记住（句柄存 IndexedDB），
       以后每次导出直接写进去，不再弹窗。**还没选过文件夹时不会突然弹窗**，
       照旧走浏览器下载，避免「我就想导个图，怎么冒出来一个对话框」。
     · ask      —— 每次都弹「另存为」，自己挑位置、改名字。
     · download —— 老行为，直接下到浏览器的下载目录。
   任何档位下，按住 Shift 点导出 = 这一次强制走「另存为」。

   为什么位置必须在**点击那一刻**定下来（resolveTarget 的由来）：
   视频是**录完**才拿到 blob 的，而 rec.onstop 里已经没有用户手势了，
   showSaveFilePicker 在那个时机会被浏览器直接拒掉（SecurityError）。
   所以先把目标拿到手，再开始录制。
   ============================================================ */

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  /* 释放得太早会掐断大文件（几十 MB 的视频）的下载，给足时间再回收 */
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
}
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function safeName() {
  return (App.state.name || '分镜').replace(/[\\/:*?"<>|]/g, '_');
}
function msgOf(e) { return (e && e.message) ? e.message : String(e); }

const PNG_TYPES = [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }];

/* ============================================================
   保存位置管理
   ============================================================ */
const EXPORT_CFG_KEY = 'sb.export.loc';

const ExportLoc = {
  mode: 'remember',        /* remember | ask | download */
  handle: null,            /* FileSystemDirectoryHandle */
  name: '',
  dup: 'suffix',           /* suffix（同名自动加序号）| overwrite */
  supported: false,        /* 浏览器有没有 File System Access API */
};

function hasDirAPI() { return typeof window.showDirectoryPicker === 'function'; }
function hasSaveAPI() { return typeof window.showSaveFilePicker === 'function'; }

/* ---- IndexedDB：只用来存目录句柄（句柄是对象，塞不进 localStorage） ---- */
function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('这个浏览器没有 IndexedDB')); return; }
    const rq = indexedDB.open('storyboard-export', 1);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('打开 IndexedDB 失败'));
  });
}
function idbTx(mode, fn) {
  return idbOpen().then(db => new Promise((res, rej) => {
    let tx;
    try { tx = db.transaction('kv', mode); } catch (e) { db.close(); rej(e); return; }
    const st = tx.objectStore('kv');
    let out;
    try { out = fn(st); } catch (e) { db.close(); rej(e); return; }
    tx.oncomplete = () => { db.close(); res(out ? out.result : true); };
    tx.onerror = () => { db.close(); rej(tx.error); };
    tx.onabort = () => { db.close(); rej(tx.error || new Error('事务被中断')); };
  }));
}
function idbPut(key, val) { return idbTx('readwrite', st => st.put(val, key)); }
function idbGet(key) { return idbTx('readonly', st => st.get(key)); }
function idbDel(key) { return idbTx('readwrite', st => st.delete(key)); }

/* ---- 配置（档位 / 同名策略）走 localStorage，句柄走 IndexedDB ---- */
function saveExportCfg() {
  try {
    localStorage.setItem(EXPORT_CFG_KEY, JSON.stringify({ mode: ExportLoc.mode, dup: ExportLoc.dup }));
  } catch (e) { /* file:// 下可能被禁，无所谓，下次退回默认档 */ }
}
function loadExportCfg() {
  ExportLoc.supported = hasDirAPI() || hasSaveAPI();
  try {
    const s = JSON.parse(localStorage.getItem(EXPORT_CFG_KEY) || 'null');
    if (s && s.mode) ExportLoc.mode = s.mode;
    if (s && s.dup) ExportLoc.dup = s.dup;
  } catch (e) { }
}
/* 句柄是异步恢复的：恢复完只填状态，**不主动要权限** ——
   要权限必须有用户手势，留给真正导出那一次（见 ensureDirPerm）。 */
function restoreExportDir() {
  loadExportCfg();
  if (!hasDirAPI()) return Promise.resolve(false);
  return idbGet('dir').then(h => {
    if (h && h.kind === 'directory') { ExportLoc.handle = h; ExportLoc.name = h.name || '(已记住)'; return true; }
    return false;
  }).catch(() => false);
}

async function ensureDirPerm(h) {
  if (!h) return false;
  if (typeof h.queryPermission !== 'function') return true;   /* 老实现没有权限 API，交给写入去报错 */
  const o = { mode: 'readwrite' };
  try {
    if (await h.queryPermission(o) === 'granted') return true;
    return await h.requestPermission(o) === 'granted';
  } catch (e) { return false; }
}

/* 选一个导出文件夹并记住。返回 'ok' / 'cancel' / 'fail' */
async function chooseExportDir() {
  if (!hasDirAPI()) return 'fail';
  try {
    const h = await window.showDirectoryPicker({ id: 'sb-export', mode: 'readwrite', startIn: 'documents' });
    ExportLoc.handle = h;
    ExportLoc.name = h.name || '(已选择)';
    ExportLoc.mode = 'remember';
    saveExportCfg();
    idbPut('dir', h).catch(() => { /* 存不下就只记本次会话，不影响导出 */ });
    return 'ok';
  } catch (e) {
    return (e && e.name === 'AbortError') ? 'cancel' : 'fail';
  }
}
function forgetExportDir() {
  ExportLoc.handle = null;
  ExportLoc.name = '';
  idbDel('dir').catch(() => { });
}

/* ---- 目标（写入器） ---- */
/* 浏览器下载：老行为，也是所有失败路径的兜底。
   注意这里必须是**裸调用** downloadBlob —— 探针会替换 window.downloadBlob 来拦截导出。 */
function downloadTarget(name) {
  return {
    label: '浏览器下载目录',
    save: async blob => { downloadBlob(blob, name); },
  };
}
/* 同名不覆盖：自动加 (2)(3)…。导出文件夹是「长期」的，
   同一个名字覆盖掉上一次的成片会很伤，所以默认让开。 */
async function uniqueName(dir, name) {
  if (ExportLoc.dup === 'overwrite') return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i <= 60; i++) {
    const cand = i === 1 ? name : base + '(' + i + ')' + ext;
    try { await dir.getFileHandle(cand); }        /* 能拿到 = 已存在，换下一个 */
    catch (e) { return cand; }                    /* 拿不到 = 不冲突 */
  }
  return base + '(' + Date.now() + ')' + ext;
}
function dirTarget(name) {
  const dir = ExportLoc.handle;
  return {
    label: dir.name || '(已记住的文件夹)',
    save: async blob => {
      const final = await uniqueName(dir, name);
      const fh = await dir.getFileHandle(final, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      toast('已存到 ' + (dir.name || '导出文件夹') + '/' + final);
    },
  };
}
/* 弹「另存为」。取消 → null（这次导出作罢）；
   没有手势 / 不支持 / 被策略拦 → 退回浏览器下载，别让导出凭空失败。 */
async function pickFileTarget(name, types) {
  if (!hasSaveAPI()) return downloadTarget(name);
  try {
    const fh = await window.showSaveFilePicker({ suggestedName: name, types: types || undefined });
    return {
      label: fh.name || '另存为',
      save: async blob => {
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        toast('已保存 ' + fh.name);
      },
    };
  } catch (e) {
    if (e && e.name === 'AbortError') { toast('已取消导出'); return null; }
    return downloadTarget(name);
  }
}

/* 决定这次写到哪。
   同步能定的（下载 / 记住的文件夹）就直接返回目标对象 ——
   老探针 p5 是同步调 exportCamPNG() 再同步收 downloadBlob 的，
   这条同步路径不能变成 Promise。只有真要弹窗时才返回 Promise。 */
function resolveTarget(name, types, forcePicker) {
  if (forcePicker) return pickFileTarget(name, types);
  if (ExportLoc.mode === 'download') return downloadTarget(name);
  if (ExportLoc.mode === 'remember' && ExportLoc.handle) {
    return ensureDirPerm(ExportLoc.handle).then(ok => {
      if (ok) return dirTarget(name);
      /* 授权掉了（清了站点数据 / 换了机器）：提示一次，退回另存为 */
      toast('导出文件夹需要重新授权，请再选一次');
      return pickFileTarget(name, types);
    });
  }
  if (ExportLoc.mode === 'ask') return pickFileTarget(name, types);
  /* remember 但还没选过文件夹 → 照旧浏览器下载，不打扰 */
  return downloadTarget(name);
}

/* 「先定位置、再产出」的统一外壳。
   run(target) 里做渲染和落盘；target 为 null 表示用户取消。 */
function withTarget(name, types, forcePicker, run) {
  let t;
  try { t = resolveTarget(name, types, forcePicker); }
  catch (e) { t = downloadTarget(name); }
  if (t && typeof t.then === 'function') {
    t.then(x => { if (x) run(x); }).catch(e => toast('导出失败：' + msgOf(e)));
  } else if (t) {
    run(t);
  }
}
function putBlob(t, blob, okMsg) {
  if (!blob) { toast('导出失败：画布没有产出图像'); return; }
  t.save(blob).then(() => toast(okMsg)).catch(e => toast('保存失败：' + msgOf(e)));
}

/* ---------------- 俯视图 PNG ---------------- */
function exportTopPNG(opt) {
  const st = App.state;
  const name = safeName() + '-俯视图-' + stamp() + '.png';
  const W0 = st.bgW, H0 = st.bgH;
  withTarget(name, PNG_TYPES, opt && opt.forcePicker, t => {
    const maxSide = 2400;
    const k = Math.min(1, maxSide / Math.max(W0, H0));
    const W = Math.round(W0 * k), H = Math.round(H0 * k);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    renderTopdown(ctx, W, H, { cx: W0 / 2, cy: H0 / 2, zoom: W / W0 }, 1, { grid: true });
    cv.toBlob(b => putBlob(t, b, '已导出俯视图'), 'image/png');
  });
}

/* ---------------- 镜头图 PNG ---------------- */
function exportCamPNG(optRes, opt) {
  const cam = activeCamObj();
  if (!cam) { toast('请先添加并选中一台摄像机'); return; }
  const [W, H] = optRes || App.previewRes;
  const t0 = App.time;
  const name = safeName() + '-' + cam.name + '-T' + fmt(t0, 1) + 's.png';
  withTarget(name, PNG_TYPES, opt && opt.forcePicker, t => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    renderShot(cv.getContext('2d'), W, H, evalCam(cam, t0), t0,
      { mode: App.mode, ortho: App.mode === '2d', guides: false, hud: true });
    cv.toBlob(b => putBlob(t, b, '已导出镜头图'), 'image/png');
  });
}

/* ---------------- 镜头视频 ---------------- */
function pickMime() {
  if (!window.MediaRecorder) return null;
  const list = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of list) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { }
  }
  return null;
}

function exportVideo(optRes, opt) {
  const cam = activeCamObj();
  if (!cam) { toast('请先添加并选中一台摄像机'); return; }
  const mime = pickMime();
  if (!mime) { toast('当前浏览器不支持录制，请用 Chrome / Edge'); return; }

  const ext = mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm';
  const name = safeName() + '-' + cam.name + '-' + stamp() + ext;
  const types = [{
    description: ext === '.mp4' ? 'MP4 视频' : 'WebM 视频',
    accept: ext === '.mp4' ? { 'video/mp4': ['.mp4'] } : { 'video/webm': ['.webm'] },
  }];
  withTarget(name, types, opt && opt.forcePicker, t => runVideo(cam, mime, ext, optRes, t));
}

function runVideo(cam, mime, ext, optRes, t) {
  const [W, H] = optRes || App.previewRes;
  const fps = clamp(App.state.fps, 10, 60);
  const dur = App.state.duration;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const wasPlaying = App.playing;
  App.playing = false;
  App.recording = true;

  const ui = showProgress('正在导出视频',
    '准备中… 分辨率 ' + W + '×' + H + ' · ' + fps + 'fps · ' + fmt(dur, 1) + 's · 保存到 ' + t.label);
  const stream = cv.captureStream(fps);
  let rec;
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W >= 1600 ? 12000000 : 8000000 });
  } catch (e) {
    ui.close(); App.recording = false; App.playing = wasPlaying;
    toast('录制器初始化失败：' + e.message);
    return;
  }
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

  const restore = () => {
    App.recording = false;
    App.playing = false;
    App.time = 0;
    refreshAll();
  };

  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    ui.set(1, '录制完成，正在写入文件…');
    t.save(blob).then(() => {
      ui.close();
      restore();
      toast('视频已导出（' + ext.slice(1) + '）');
    }).catch(e => {
      ui.close();
      restore();
      toast('保存失败：' + msgOf(e));
    });
  };

  const t0 = performance.now();
  rec.start();
  function frame() {
    if (!App.recording) return;
    const elapsed = (performance.now() - t0) / 1000;
    const time = Math.min(elapsed, dur);
    App.time = time;
    renderShot(ctx, W, H, evalCam(cam, time), time, { mode: App.mode, ortho: App.mode === '2d', guides: false, hud: true });
    if (App.playerOpen) renderPlayer(); else renderPreview();
    ui.set(time / dur, '录制中 ' + fmt(time, 2) + ' / ' + fmt(dur, 2) + ' s');
    if (elapsed < dur) requestAnimationFrame(frame);
    else setTimeout(() => { try { rec.stop(); } catch (e) { restore(); } }, 260);
  }
  requestAnimationFrame(frame);
}

/* 启动时恢复配置与记住的文件夹（异步，不阻塞启动） */
restoreExportDir();
