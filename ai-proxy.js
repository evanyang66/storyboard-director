'use strict';
/* ============================================================
   ai-proxy.js — 本地 AI 场景编排代理
   ------------------------------------------------------------
   零依赖（Node 18+，用内置 fetch）。做四件事：

     1. 解决 CORS：工具是 file:// 打开的，页面 Origin 是 null，
        ComfyUI / 大多数云端 API 都不发 CORS 头，浏览器没法直接 fetch。
     2. 两条通道二选一：
          comfyui —— 调 ComfyUI 里的 llama-cpp（本地，免费，要排队）
          api     —— 调任何 OpenAI 兼容的 /chat/completions（云端，快，要 key）
     3. 把 ComfyUI「提交 + 轮询」两段式协议包成一次调用。
     4. 把模型吐出来的文本收拾成能用的 JSON
        （剥  thinking、剥代码围栏、找平衡括号、修尾逗号）。

   API Key 只存在本机的 ai-config.json 里，**不会发到浏览器**
   （前端拿到的永远是打过码的版本）。

   启动：  node ai-proxy.js        （或双击 启动AI.bat）
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---------------- 配置 ---------------- */
const PORT = +(process.env.AI_PROXY_PORT || 8790);
const CONFIG_PATH = process.env.AI_CONFIG || path.join(__dirname, 'ai-config.json');
const POLL_MS = 1200;

const DEFAULT_CONFIG = {
  provider: 'comfyui',                       // 'comfyui' | 'api'
  comfyui: {
    host: 'http://127.0.0.1:8188',
    model: '',                               // 空 = 自动取 models/LLM 里第一个
    timeoutMs: 900000,                       // 15 分钟（含排队 + 加载 5GB）
    maxTokens: 2400,                         // 要给「思考 + JSON」留够，1400 经常不够
    noThink: null,                           // null = 按模型名自动判断（Qwen 系自动开）
  },
  api: {
    baseUrl: '',                             // 到 /v1 为止，例如 https://api.deepseek.com/v1
    apiKey: '',
    model: '',
    temperature: .3,
    maxTokens: 1400,
    timeoutMs: 180000,
    jsonMode: true,                          // 发 response_format:{type:'json_object'}
    stream: true,
  },
};

function deepMerge(base, over) {
  const out = JSON.parse(JSON.stringify(base));
  for (const k in (over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      Object.assign(out[k], v);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}
function loadConfig() {
  let c;
  try {
    c = deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) {
    c = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  /* 环境变量优先（方便脚本/测试，不用改配置文件） */
  if (process.env.AI_PROVIDER) c.provider = process.env.AI_PROVIDER;
  if (process.env.COMFY_HOST) c.comfyui.host = process.env.COMFY_HOST;
  if (process.env.COMFY_MODEL) c.comfyui.model = process.env.COMFY_MODEL;
  if (process.env.LLM_API_BASE) c.api.baseUrl = process.env.LLM_API_BASE;
  if (process.env.LLM_API_KEY) c.api.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_MODEL) c.api.model = process.env.LLM_MODEL;
  return c;
}
function saveConfig(c) {
  /* 只写用户该管的字段，别把默认值全铺进去 */
  const out = {
    provider: c.provider,
    comfyui: {
      host: c.comfyui.host, model: c.comfyui.model || '',
      maxTokens: c.comfyui.maxTokens, noThink: c.comfyui.noThink,
    },
    api: {
      baseUrl: c.api.baseUrl || '', apiKey: c.api.apiKey || '', model: c.api.model || '',
      temperature: c.api.temperature, maxTokens: c.api.maxTokens,
      jsonMode: !!c.api.jsonMode, stream: !!c.api.stream,
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2), 'utf8');
}

/* 给前端看的版本：key 打码，绝不外泄 */
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '••••••';
  return k.slice(0, 4) + '••••••' + k.slice(-4);
}
function publicConfig(c) {
  return {
    provider: c.provider,
    comfyui: {
      host: c.comfyui.host, model: c.comfyui.model || '',
      maxTokens: c.comfyui.maxTokens, noThink: c.comfyui.noThink,
    },
    api: {
      baseUrl: c.api.baseUrl || '',
      apiKeyMasked: maskKey(c.api.apiKey),
      hasKey: !!c.api.apiKey,
      model: c.api.model || '',
      temperature: c.api.temperature,
      maxTokens: c.api.maxTokens,
      jsonMode: !!c.api.jsonMode,
      stream: !!c.api.stream,
    },
    configPath: CONFIG_PATH,
  };
}

/* ---------------- 小工具 ---------------- */
const log = (...a) => console.log('[' + new Date().toTimeString().slice(0, 8) + ']', ...a);
const now = () => Date.now();

function cors(res) {
  /* 页面来自 file://，Origin 是字符串 "null"。用 * 才能放行，
     而且不能带 credentials —— 我们也不需要。 */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function sendJSON(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 4e6) { reject(new Error('请求体过大')); req.destroy(); } });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
async function comfyJSON(host, p, opt) {
  const r = await fetch(host + p, opt);
  if (!r.ok) throw new Error('ComfyUI ' + p + ' → HTTP ' + r.status);
  return r.json();
}

/* ============================================================
   通道 A：ComfyUI 里的 llama-cpp
   ============================================================ */

let comfyModelCache = null;
async function pickComfyModel(cfg) {
  if (cfg.comfyui.model) return cfg.comfyui.model;
  if (comfyModelCache) return comfyModelCache;
  const info = await comfyJSON(cfg.comfyui.host, '/object_info/llama_cpp_model_loader');
  const list = (info.llama_cpp_model_loader.input.required.model[0] || []);
  if (!list.length) throw new Error('ComfyUI 的 models/LLM 目录里没有 .gguf 模型');
  comfyModelCache = list[0];
  return comfyModelCache;
}

/* Qwen3 这类「思考模型」会先把推理写一大段再给答案。提示词一复杂，
   思考就能把 token 预算吃光，结果 JSON 一个字都吐不出来 —— 实测踩过。
   Qwen3 的官方约定：提示里带 /no_think 就跳过思考。
   实测同一句话：5.1s / 377 字 → 1.5s / 37 字，而且不再截断。
   非 Qwen 模型不加（对它们这只是串没意义的文字）。 */
function applyNoThink(user, model, flag) {
  const on = (flag == null || flag === '') ? /qwen/i.test(String(model || '')) : !!flag;
  return on ? (String(user || '') + '\n/no_think') : user;
}

/* 4 个节点：
     1 llama_cpp_model_loader   加载 gguf
     2 llama_cpp_parameters     采样参数
     3 llama_cpp_instruct_adv   真正推理
     4 PreviewAny               把文本引到 history 里

   第 4 步是必须的：instruct 节点返回的 STRING 没带 ui 字段，
   ComfyUI 不会把它放进 /history 的 outputs。PreviewAny（KJNodes）
   是 output_node，会把输入以 text 形式暴露出来，我们才读得到。
   实测：不加这一步，history.outputs 是空的。 */
function buildComfyWorkflow(system, user, opt) {
  opt = opt || {};
  return {
    '1': {
      class_type: 'llama_cpp_model_loader',
      inputs: {
        model: opt.model, mmproj: 'None', chat_handler: 'None',
        n_ctx: opt.nCtx || 8192, vram_limit: -1,
        image_min_tokens: 0, image_max_tokens: 0,
        auto_offload: true, offload_threshold: 2,
      },
    },
    '2': {
      class_type: 'llama_cpp_parameters',
      inputs: {
        max_tokens: opt.maxTokens || 2400,
        top_k: 30, top_p: .9, min_p: .05, typical_p: 1,
        temperature: opt.temperature == null ? .3 : opt.temperature,
        repeat_penalty: 1.05, frequency_penalty: 0,
        presence_penalty: 0, mirostat_mode: 0, mirostat_eta: .1, mirostat_tau: 5,
        state_uid: -1,
      },
    },
    '3': {
      class_type: 'llama_cpp_instruct_adv',
      inputs: {
        llama_model: ['1', 0],
        /* "Empty - Nothing" 不带 * 号，custom_prompt 会被直接当用户消息用 */
        preset_prompt: 'Empty - Nothing',
        custom_prompt: user,
        system_prompt: system,
        inference_mode: 'one by one', max_frames: 24, max_size: 256,
        seed: opt.seed == null ? 0 : opt.seed,
        force_offload: false, save_states: false,
        parameters: ['2', 0],
      },
    },
    '4': { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
  };
}

async function runJobComfyUI(job, body, cfg) {
  const host = cfg.comfyui.host;
  job.status = 'running'; job.phase = '提交中';
  const model = await pickComfyModel(cfg);
  const user = applyNoThink(body.user, body.model || model, cfg.comfyui.noThink);
  const wf = buildComfyWorkflow(body.system || '', user, {
    model: body.model || model,
    maxTokens: body.maxTokens || cfg.comfyui.maxTokens,
    temperature: body.temperature, seed: body.seed, nCtx: body.nCtx,
  });
  job.noThink = user !== body.user;

  const r = await fetch(host + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: 'storyboard-ai' }),
  });
  const j = await r.json();
  if (!r.ok || j.error) {
    const detail = j.error ? JSON.stringify(j.error).slice(0, 400) : ('HTTP ' + r.status);
    throw new Error('ComfyUI 拒绝了这个工作流：' + detail +
      (j.node_errors && Object.keys(j.node_errors).length ? ' 节点错误:' + JSON.stringify(j.node_errors).slice(0, 300) : ''));
  }
  job.promptId = j.prompt_id;
  job.model = model;
  log('已提交', job.promptId.slice(0, 8), '模型=' + model);

  const t0 = now();
  while (now() - t0 < cfg.comfyui.timeoutMs) {
    if (job.status === 'cancelled') return;
    await new Promise(r2 => setTimeout(r2, POLL_MS));
    if (job.status === 'cancelled') return;

    const h = await comfyJSON(host, '/history/' + job.promptId);
    const e = h[job.promptId];
    if (e && e.status && (e.status.completed || e.status.status_str === 'error')) {
      if (e.status.status_str === 'error' || e.status.completed === false) {
        throw new Error('ComfyUI 执行出错：' + JSON.stringify(e.status.messages || e.status).slice(0, 400));
      }
      const out = e.outputs && e.outputs['4'];
      const text = out && out.text && out.text.length ? out.text.join('\n') : '';
      if (!text) throw new Error('跑完了但没拿到文本（PreviewAny 节点没输出）');
      job.text = text;
      return;
    }
    /* 还没结束 —— 看它在排队还是已经在跑 */
    try {
      const q = await comfyJSON(host, '/queue');
      const runIdx = q.queue_running.findIndex(it => it[1] === job.promptId);
      const pendIdx = q.queue_pending.findIndex(it => it[1] === job.promptId);
      if (runIdx >= 0) { job.phase = '生成中'; job.queuePos = 0; }
      else if (pendIdx >= 0) {
        job.phase = '排队中'; job.queuePos = pendIdx + 1;
        job.busyWith = q.queue_running.length ? 'ComfyUI 正在跑别的任务' : '';
      } else { job.phase = '等待中'; }
    } catch (e2) { /* /queue 失败不影响主流程 */ }
    job.elapsed = now() - job.t0;
  }
  throw new Error('超时（' + Math.round(cfg.comfyui.timeoutMs / 1000) + 's）。ComfyUI 可能正忙，或模型加载太慢。');
}

/* ============================================================
   通道 B：OpenAI 兼容的 /chat/completions
   ============================================================ */

function apiError(status, txt, baseUrl) {
  let msg = '';
  try {
    const j = JSON.parse(txt);
    msg = (j.error && (j.error.message || j.error.code)) || j.message || '';
  } catch (e) { msg = String(txt || '').slice(0, 300); }
  const tail = msg ? '　→ ' + msg : '';
  switch (status) {
    case 401: return 'API Key 不对或被拒（401）。检查设置里的 Key。' + tail;
    case 402: return '余额不足（402）。' + tail;
    case 403: return '没有访问权限（403）。可能是这个 Key 没开通该模型。' + tail;
    case 404: return '地址或模型名不对（404）。Base URL 应该填到 /v1 为止（现在填的是 ' + baseUrl +
      '），模型名要和该服务商文档一致。' + tail;
    case 429: return '被限流了（429）。等一会儿再试，或换个模型。' + tail;
    case 400: return '请求被拒（400）。' + tail;
    default:
      if (status >= 500) return '服务端错误（' + status + '），通常是对方临时故障，稍后重试。' + tail;
      return 'API 返回 HTTP ' + status + '。' + tail;
  }
}

function apiHeaders(a) {
  return {
    'Content-Type': 'application/json',
    ...(a.apiKey ? { Authorization: 'Bearer ' + a.apiKey } : {}),
  };
}

/* 流式读 SSE，边读边把增量交给 onDelta（界面能显示「已生成 N 字」） */
async function callAPIStream(a, payload, onDelta) {
  const url = a.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), a.timeoutMs);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', headers: apiHeaders(a),
      body: JSON.stringify(Object.assign({}, payload, { stream: true })),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('请求超时（' + Math.round(a.timeoutMs / 1000) + 's）。');
    throw new Error('连不上 ' + a.baseUrl + '：' + e.message + '　（检查 Base URL、网络、系统代理）');
  }
  if (!r.ok) {
    clearTimeout(timer);
    const txt = await r.text().catch(() => '');
    const err = new Error(apiError(r.status, txt, a.baseUrl));
    err.status = r.status; err.body = txt;
    throw err;
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '', reasoning = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line || line[0] === ':') continue;
        if (line.indexOf('data:') !== 0) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch (e) { continue; }
        const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message);
        if (!d) continue;
        /* 推理模型（DeepSeek-R1 等）把思考放在 reasoning_content —— 丢掉，别混进 JSON */
        if (d.reasoning_content) reasoning += d.reasoning_content;
        if (d.content) { out += d.content; if (onDelta) onDelta(out, reasoning); }
      }
    }
  } finally { clearTimeout(timer); }
  return { text: out, reasoning };
}

/* 非流式兜底（有些自建/中转端点对 SSE 支持不好） */
async function callAPIOnce(a, payload) {
  const url = a.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), a.timeoutMs);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', headers: apiHeaders(a),
      body: JSON.stringify(Object.assign({}, payload, { stream: false })),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('请求超时（' + Math.round(a.timeoutMs / 1000) + 's）。');
    throw new Error('连不上 ' + a.baseUrl + '：' + e.message);
  }
  clearTimeout(timer);
  const txt = await r.text();
  if (!r.ok) {
    const err = new Error(apiError(r.status, txt, a.baseUrl));
    err.status = r.status; err.body = txt;
    throw err;
  }
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('返回的不是 JSON：' + txt.slice(0, 200)); }
  const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
  const text = m.content || (j.choices && j.choices[0] && j.choices[0].text) || '';
  return { text: String(text), reasoning: m.reasoning_content || '' };
}

async function runJobAPI(job, body, cfg) {
  const a = cfg.api;
  if (!a.baseUrl) throw new Error('还没配置 API 地址。点「AI 编排」里的「设置」，填 Base URL / API Key / 模型名。');
  if (!a.model) throw new Error('还没填模型名。点「AI 编排」→「设置」补上。');

  job.status = 'running'; job.phase = '请求中'; job.model = a.model;

  const messages = [];
  if (body.system) messages.push({ role: 'system', content: body.system });
  messages.push({ role: 'user', content: body.user });

  const payload = {
    model: body.model || a.model,
    messages,
    temperature: body.temperature == null ? a.temperature : body.temperature,
    max_tokens: body.maxTokens || a.maxTokens,
  };
  /* json_object 能大幅提高结构化输出的成功率，但不是所有端点都支持 —— 失败会自动去掉重试 */
  if (a.jsonMode) payload.response_format = { type: 'json_object' };

  log('调用 API', a.baseUrl, '模型=' + payload.model, a.stream ? '(流式)' : '(一次性)');

  const onDelta = (out, reasoning) => {
    job.text = out;
    job.phase = '生成中';
    job.outChars = out.length;
  };

  try {
    const res = a.stream ? await callAPIStream(a, payload, onDelta) : await callAPIOnce(a, payload);
    job.text = res.text; job.reasoning = res.reasoning;
  } catch (e) {
    /* 400 且**明确点名** response_format 不支持 → 去掉再试一次。
       注意这里只能匹配字段名本身：早先的版本顺手写了 unsupported|not support，
       结果把「streaming not supported」也吃进来了，走错分支、白试一次。
       宁可漏判（用户看到原始报错）也不要误判。 */
    const looksLikeFmt = e.status === 400 && payload.response_format &&
      /response_format|json_object|json\s*mode/i.test(String(e.body || e.message));
    /* 流式没走通 → 退回非流式。两种情况都算：
         · 一个字节都没流出来就炸了（网络层，status 是 undefined）
         · 端点直接 400 说它不支持 stream（实测有这种中转/自建端点）
       已经吐过字的不算 —— 那说明流式是好的，别重复请求。 */
    const looksLikeStream = a.stream && job.outChars === undefined && !looksLikeFmt &&
      (e.status === undefined ||
        /stream|sse|event-stream/i.test(String(e.body || e.message)));

    if (looksLikeFmt) {
      log('该端点不支持 response_format，去掉重试');
      const p2 = Object.assign({}, payload); delete p2.response_format;
      const res = a.stream ? await callAPIStream(a, p2, onDelta) : await callAPIOnce(a, p2);
      job.text = res.text; job.reasoning = res.reasoning;
    } else if (looksLikeStream) {
      log('流式没成功（' + e.message + '），退回非流式重试');
      try {
        const res = await callAPIOnce(a, payload);
        job.text = res.text; job.reasoning = res.reasoning;
      } catch (e2) {
        /* 非流式也不认 response_format 的话，再让一步 */
        if (e2.status === 400 && payload.response_format) {
          log('该端点也不认 response_format，去掉重试');
          const p2 = Object.assign({}, payload); delete p2.response_format;
          const res = await callAPIOnce(a, p2);
          job.text = res.text; job.reasoning = res.reasoning;
        } else throw e2;
      }
    } else throw e;
  }

  if (!job.text || !job.text.trim()) {
    throw new Error('API 返回了空内容。模型名可能不对，或该模型不支持对话接口。');
  }
}

/* ============================================================
   从一堆文字里抠出 JSON
   ============================================================ */

/* Qwen3 / DeepSeek-R1 这类思考模型会把推理写在  thinking 里。全剥掉。 */
function stripThink(s) {
  let t = String(s || '');
  t = t.replace(/<think[\s\S]*?<\/think>/gi, '');
  t = t.replace(/<thinking[\s\S]*?<\/thinking>/gi, '');
  /* 没闭合的（被 max_tokens 截断）也要处理 */
  t = t.replace(/<think[\s\S]*$/i, '');
  t = t.replace(/<thinking[\s\S]*$/i, '');
  return t.trim();
}
/* 去掉 ```json ... ``` 围栏 */
function stripFence(s) {
  const m = String(s || '').match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : String(s || '').trim();
}
/* 从任意位置扫出第一个平衡的 {...}，跳过字符串里的括号和转义 */
function balancedSlice(s) {
  const t = String(s || '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;   // 截断了，没闭合
}
/* 常见的手写 JSON 毛病 */
function repair(s) {
  let t = String(s || '');
  t = t.replace(/\/\/[^\n\r]*/g, '');                 // // 注释
  t = t.replace(/\/\*[\s\S]*?\*\//g, '');             // /* */ 注释
  t = t.replace(/[\u201c\u201d]/g, '"');              // 弯引号
  t = t.replace(/[\u2018\u2019]/g, "'");
  t = t.replace(/,\s*([}\]])/g, '$1');                // 尾逗号
  return t;
}
function extractJSON(raw) {
  const cleaned = stripFence(stripThink(raw));
  for (const a of [cleaned, repair(cleaned)]) {
    if (!a) continue;
    try { return { json: normalizeRoot(JSON.parse(a)), text: raw, error: null }; } catch (e) { }
    const slice = balancedSlice(a);
    if (slice) {
      for (const cand of [slice, repair(slice)]) {
        try { return { json: normalizeRoot(JSON.parse(cand)), text: raw, error: null }; } catch (e) { }
      }
    }
  }
  return {
    json: null, text: raw,
    error: '模型没有输出可解析的 JSON（已尝试剥离思考块、代码围栏、修尾逗号）',
  };
}
/* 模型有时直接吐一个数组，有时吐 {"ops":...}。统一成 {ops:[...]} */
function normalizeRoot(o) {
  if (Array.isArray(o)) return { ops: o };
  if (o && typeof o === 'object') {
    if (Array.isArray(o.ops)) return o;
    if (Array.isArray(o.operations)) return { ops: o.operations };
    if (o.op) return { ops: [o] };
  }
  return o;
}

/* ---------------- 作业表 ---------------- */
const jobs = new Map();
let chain = Promise.resolve();     // 串行化：一次只让一个作业出去

function newJob() {
  const id = 'j' + Math.random().toString(36).slice(2, 10);
  const j = { id, status: 'queued', phase: '准备中', t0: now(), text: '', json: null, error: null, promptId: null };
  jobs.set(id, j);
  for (const [k, v] of jobs) if (now() - v.t0 > 3600e3) jobs.delete(k);
  return j;
}

/* 还在排队就撤掉。绝不调 /interrupt —— 那会把用户正在跑的视频任务一起干掉。 */
async function cancelJob(job, cfg) {
  if (!job.promptId || job.status !== 'queued') return false;
  try {
    await fetch(cfg.comfyui.host + '/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [job.promptId] }),
    });
    job.status = 'cancelled'; job.phase = '已取消';
    log('已从队列撤回', job.promptId.slice(0, 8));
    return true;
  } catch (e) { return false; }
}

async function runJob(job, body) {
  const cfg = loadConfig();
  const provider = body.provider || cfg.provider;
  job.provider = provider;

  if (provider === 'api') await runJobAPI(job, body, cfg);
  else await runJobComfyUI(job, body, cfg);

  const ex = extractJSON(job.text);
  job.json = ex.json;
  job.parseError = ex.error;
  job.status = 'done'; job.phase = '完成';
  job.ms = now() - job.t0;
  log('完成', (job.ms / 1000).toFixed(1) + 's', ex.json ? '✓JSON' : '✗JSON');
}

/* ---------------- 健康检查 ---------------- */
async function health() {
  const cfg = loadConfig();
  const out = {
    ok: true, provider: cfg.provider, comfy: false, model: null,
    queue: null, error: null, ready: false, config: publicConfig(cfg),
  };
  if (cfg.provider === 'api') {
    out.model = cfg.api.model || null;
    out.baseUrl = cfg.api.baseUrl || null;
    out.ready = !!(cfg.api.baseUrl && cfg.api.model && cfg.api.apiKey);
    if (!out.ready) out.error = 'API 还没配全（Base URL / API Key / 模型名）';
    return out;
  }
  try {
    const st = await comfyJSON(cfg.comfyui.host, '/system_stats');
    out.comfy = true;
    out.version = st.system && st.system.comfyui_version;
    out.model = await pickComfyModel(cfg);
    out.noThink = (cfg.comfyui.noThink == null || cfg.comfyui.noThink === '')
      ? /qwen/i.test(out.model) : !!cfg.comfyui.noThink;
    out.maxTokens = cfg.comfyui.maxTokens;
    const q = await comfyJSON(cfg.comfyui.host, '/queue');
    out.queue = { running: q.queue_running.length, pending: q.queue_pending.length };
    out.busy = out.queue.running > 0;
    out.ready = true;
  } catch (e) { out.error = e.message; out.ready = false; }
  return out;
}

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  try {
    if (p === '/health') return sendJSON(res, 200, await health());

    if (p === '/config' && req.method === 'GET') {
      return sendJSON(res, 200, publicConfig(loadConfig()));
    }

    if (p === '/config' && req.method === 'POST') {
      const patch = JSON.parse(await readBody(req) || '{}');
      const cur = loadConfig();
      if (patch.api) {
        if (patch.api.apiKeyClear) {
          /* 用户明确要清掉 Key —— 显式写空，别被下面的「保留」逻辑吃掉 */
          patch.api.apiKey = '';
          delete patch.api.apiKeyClear;
        } else if (typeof patch.api.apiKey === 'string' &&
          (patch.api.apiKey === '' || patch.api.apiKey.indexOf('••') >= 0)) {
          /* 空串或打码值 = 用户没动 Key，保留原来的 */
          delete patch.api.apiKey;
        }
      }
      const next = deepMerge(cur, patch);
      if (next.provider !== 'api' && next.provider !== 'comfyui') next.provider = 'comfyui';
      saveConfig(next);
      log('配置已保存（通道=' + next.provider + '）');
      return sendJSON(res, 200, { ok: true, config: publicConfig(next) });
    }

    /* 试连：发一句极短的话，看能不能通。
       body 里可以带 provider —— 前端切了下拉但还没保存时，要能测「选中的那条」。
       （早先漏了这一步，/test 只认配置文件里的通道，前端只能靠「先保存再测」绕过去。） */
    if (p === '/test' && req.method === 'POST') {
      const t0 = now();
      const body = JSON.parse(await readBody(req) || '{}');
      const job = newJob();
      try {
        await runJob(job, {
          provider: body.provider,
          system: '你是测试助手，只回复用户要求的内容。',
          user: '只回复两个字：可用',
          maxTokens: 48, temperature: 0,
        });
        return sendJSON(res, 200, {
          ok: true, ms: now() - t0, provider: job.provider, model: job.model,
          text: String(job.text || '').trim().slice(0, 200),
        });
      } catch (e) {
        return sendJSON(res, 200, { ok: false, ms: now() - t0, provider: job.provider, error: e.message });
      }
    }

    if (p === '/llm' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}');
      if (!body.user) return sendJSON(res, 400, { error: '缺少 user（要发给模型的用户消息）' });
      const job = newJob();
      chain = chain.then(() => runJob(job, body)).catch(e => {
        if (job.status !== 'cancelled') {
          job.status = 'error'; job.error = e.message; job.phase = '失败';
          log('失败', e.message);
        }
      });
      return sendJSON(res, 202, { jobId: job.id });
    }

    if (p.startsWith('/job/')) {
      const job = jobs.get(p.slice(5));
      if (!job) return sendJSON(res, 404, { error: '没有这个作业' });
      return sendJSON(res, 200, {
        id: job.id, status: job.status, phase: job.phase,
        provider: job.provider, model: job.model,
        elapsed: job.elapsed == null ? now() - job.t0 : job.elapsed,
        queuePos: job.queuePos, busyWith: job.busyWith, outChars: job.outChars,
        noThink: job.noThink,
        text: (job.status === 'done' || job.status === 'running') ? job.text : undefined,
        json: job.status === 'done' ? job.json : undefined,
        parseError: job.status === 'done' ? job.parseError : undefined,
        ms: job.ms, error: job.error,
      });
    }

    if (p.startsWith('/cancel/') && req.method === 'POST') {
      const job = jobs.get(p.slice(8));
      if (!job) return sendJSON(res, 404, { error: '没有这个作业' });
      const ok = await cancelJob(job, loadConfig());
      return sendJSON(res, 200, { ok, status: job.status });
    }

    if (p === '/' || p === '/ping') return sendJSON(res, 200, { ok: true, name: 'storyboard ai-proxy', port: PORT });

    sendJSON(res, 404, { error: '没有这个路由' });
  } catch (e) {
    log('路由出错', e.message);
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const cfg = loadConfig();
  console.log('');
  console.log('  分镜调度台 · AI 代理已启动');
  console.log('  ├ 监听      http://127.0.0.1:' + PORT);
  console.log('  └ 当前通道  ' + (cfg.provider === 'api' ? '云端 API' : '本地 ComfyUI'));
  console.log('');
  if (cfg.provider === 'api') {
    console.log('    Base URL  ' + (cfg.api.baseUrl || '（未配置）'));
    console.log('    模型      ' + (cfg.api.model || '（未配置）'));
    console.log('    API Key   ' + (maskKey(cfg.api.apiKey) || '（未配置）'));
    if (!cfg.api.baseUrl || !cfg.api.model) console.log('    ⚠ 还没配全 —— 打开工具 →「AI 编排」→「设置」填一下');
  } else {
    try {
      const m = await pickComfyModel(cfg);
      const q = await comfyJSON(cfg.comfyui.host, '/queue');
      console.log('    ComfyUI   ' + cfg.comfyui.host);
      console.log('    模型      ' + m);
      console.log('    队列      ' + q.queue_running.length + ' 运行中 / ' + q.queue_pending.length + ' 排队');
      if (q.queue_running.length) console.log('    ⚠ ComfyUI 正忙，AI 请求会排在后面');
    } catch (e) {
      console.log('    ✗ 连不上 ComfyUI：' + e.message);
      console.log('      请先启动 ComfyUI；或改用云端 API（工具里「AI 编排」→「设置」）。');
    }
  }
  console.log('');
  console.log('  配置文件  ' + CONFIG_PATH);
  console.log('  保持这个窗口开着，然后打开分镜调度台 → 点「AI 编排」。');
  console.log('');
});
