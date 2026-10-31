'use strict';
/**
 * 命理分析工具 —— 零依赖 Node 后端（网页版，非微信小程序）
 * 启动：node server.js  然后浏览器打开 http://127.0.0.1:8756
 *
 * 模块：八字 / 紫微斗数 / 面相 / 手相 / 住宅风水 / 占卜 + 对话追问
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { analyzeChart, DZ, monthGanFromYear, hourGanFromDay, isValidGanzhi } = require('./lib/bazi');
const { extractChartFromImage, analyzeWithLLM, visionExtract, chatCompletion } = require('./lib/llm');
const { SYSTEM_PROMPT, buildUserPrompt } = require('./lib/prompt');
const { rankHours } = require('./lib/rectify');
const M = require('./lib/modules');

function lanUrls(port) {
  const out = [];
  const n = os.networkInterfaces();
  for (const name of Object.keys(n)) {
    for (const a of n[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + port);
    }
  }
  return out;
}

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  // config.json 含密钥（本地用）；云端只提供 config.example.json，密钥全部走环境变量
  const cfgFile = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : path.join(ROOT, 'config.example.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.port = Number(process.env.PORT || cfg.port || 8756);
  // 环境变量优先（云端部署用环境变量注入，不把密钥写进镜像）
  if (process.env.VISION_BASE_URL) cfg.vision.baseURL = process.env.VISION_BASE_URL;
  if (process.env.VISION_MODEL) cfg.vision.model = process.env.VISION_MODEL;
  if (process.env.VISION_API_KEY) cfg.vision.apiKey = process.env.VISION_API_KEY;
  if (process.env.ANALYSIS_BASE_URL) cfg.analysis.baseURL = process.env.ANALYSIS_BASE_URL;
  if (process.env.ANALYSIS_MODEL) cfg.analysis.model = process.env.ANALYSIS_MODEL;
  if (process.env.ANALYSIS_API_KEY) cfg.analysis.apiKey = process.env.ANALYSIS_API_KEY;
  if (process.env.ANALYSIS_MAX_TOKENS) cfg.analysis.maxTokens = Number(process.env.ANALYSIS_MAX_TOKENS);
  if (process.env.ACCESS_TOKEN !== undefined) cfg.accessToken = process.env.ACCESS_TOKEN;
  return cfg;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > (limitBytes || 25 * 1024 * 1024)) { reject(new Error('上传内容过大（>25MB），请压缩图片后再试')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/** 由公历时间推时辰地支，用于校验时柱是否与出生时间自洽 */
function expectedHourZhi(birthStr) {
  const m = String(birthStr || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})[:：](\d{2})/);
  if (!m) return null;
  const h = Number(m[4]);
  return DZ[Math.floor(((h + 1) % 24) / 2)];
}

function parseMeta(body, chartInfo) {
  return {
    gender: String(chartInfo.gender || '').includes('男') || chartInfo.gender === '乾造' ? '男' : '女',
    name: chartInfo.name || body.name || '',
    birth: chartInfo.birth_solar || chartInfo.birth || body.birth || '',
    startAge: chartInfo.startAge != null ? Number(chartInfo.startAge) : (body.startAge != null ? Number(body.startAge) : null),
    birthYear: chartInfo.birth_solar
      ? parseInt(String(chartInfo.birth_solar).replace(/\D+/, '-').slice(0, 4), 10)
      : (body.birthYear || null),
  };
}

// ---------------- 异步任务 ----------------
// 免费云平台的 HTTP 请求有超时限制（常见 ~100s），而深度分析要 2-4 分钟。
// 因此提交任务立刻返回 jobId，前端轮询 /api/job/:id 取结果。
const jobs = new Map();
const JOB_TTL = 20 * 60 * 1000;

function newJob(label, compute) {
  const id = crypto.randomUUID();
  jobs.set(id, { status: 'running', label, createdAt: Date.now() });
  compute().then((result) => {
    jobs.set(id, { status: 'done', result, createdAt: Date.now() });
  }).catch((e) => {
    console.error('[job ' + label + '] 失败:', e.message);
    jobs.set(id, { status: 'error', error: e.message || String(e), createdAt: Date.now() });
  });
  for (const [k, v] of jobs) if (Date.now() - v.createdAt > JOB_TTL) jobs.delete(k);
  return id;
}

// ---------------- 八字 ----------------
async function computeAnalyze(body) {
  const t0 = Date.now();
  const cfg = loadConfig();
  const timings = {};

  let chartInfo;
  if (body.chart && body.chart.year) {
    chartInfo = Object.assign({}, body.chart);
    if (body.gender) chartInfo.gender = body.gender;
    if (body.birth) chartInfo.birth_solar = body.birth;
  } else if (body.image && /^data:image\//.test(body.image)) {
    const t = Date.now();
    chartInfo = await extractChartFromImage(cfg.vision, body.image);
    timings.visionMs = Date.now() - t;
  } else {
    throw new Error('请上传排盘截图，或直接提供四柱');
  }

  const chart = {
    year: String(chartInfo.year || '').trim(),
    month: String(chartInfo.month || '').trim(),
    day: String(chartInfo.day || '').trim(),
    hour: String(chartInfo.hour || '').trim(),
  };
  const CN = { year: '年柱', month: '月柱', day: '日柱', hour: '时柱' };
  const fixes = [];

  // 1) 干支合法性：六十甲子里不存在「乙卯」这类组合，能直接抓出 OCR 错字
  for (const k of ['year', 'month', 'day', 'hour']) {
    const s = chart[k] || '';
    if (s.length < 2 || !isValidGanzhi(s[0], s[1])) {
      throw new Error(`${CN[k]}识别为「${s}」，但这不是合法的六十甲子组合（很可能把「己」看成了「乙」）。请核对截图后重试，或展开「手动填四柱」直接填写。`);
    }
  }
  // 2) 月干由年干+月支唯一决定（五虎遁），时干由日干+时支唯一决定（五鼠遁），据此自动纠错
  const expMonthGan = monthGanFromYear(chart.year[0], chart.month[1]);
  if (expMonthGan && chart.month[0] !== expMonthGan) {
    fixes.push(`月柱识别为「${chart.month}」，按五虎遁（${chart.year[0]}年${chart.month[1]}月）应为「${expMonthGan}${chart.month[1]}」，已自动修正。`);
    chart.month = expMonthGan + chart.month[1];
  }
  const expHourGan = hourGanFromDay(chart.day[0], chart.hour[1]);
  if (expHourGan && chart.hour[0] !== expHourGan) {
    fixes.push(`时柱识别为「${chart.hour}」，按五鼠遁（${chart.day[0]}日${chart.hour[1]}时）应为「${expHourGan}${chart.hour[1]}」，已自动修正。`);
    chart.hour = expHourGan + chart.hour[1];
  }

  const meta = parseMeta(body, chartInfo);
  const engine = analyzeChart(chart, meta);

  // 3) 时柱与出生时间自洽性校验
  const warnings = fixes;
  const exp = expectedHourZhi(meta.birth);
  if (exp && chart.hour && chart.hour[1] !== exp) {
    warnings.push(`时柱「${chart.hour}」与出生时间「${meta.birth}」推算出的「${exp}时」不一致，可能是识别误差或出生时间本身有出入，请核对。`);
  }

  const t1 = Date.now();
  const focus = Array.isArray(body.focus) ? body.focus : [];
  const { parsed, usage } = await analyzeWithLLM(cfg.analysis, SYSTEM_PROMPT, buildUserPrompt(engine, { focus, detail: true }));
  timings.analysisMs = Date.now() - t1;
  timings.totalMs = Date.now() - t0;

  return {
    ok: true, module: 'bazi', chart, chartRaw: chartInfo, engine, warnings,
    analysis: parsed, usage, timings, analyzedAt: new Date().toISOString(),
  };
}

// ---------------- 其它模块 ----------------
function modulePipeline(mod) {
  switch (mod) {
    case 'face':
      return { vision: M.FACE_VISION, system: M.FACE_SYSTEM, user: (x, p) => M.buildFaceUser(x, p.extra) };
    case 'palm':
      return { vision: M.PALM_VISION, system: M.PALM_SYSTEM, user: (x, p) => M.buildPalmUser(x, p.extra) };
    case 'fengshui':
      return { vision: M.FENGSHUI_VISION, system: M.FENGSHUI_SYSTEM, user: (x, p) => M.buildFengshuiUser(x, p) };
    case 'ziwei':
      return { vision: M.ZIWEI_VISION, system: M.ZIWEI_SYSTEM, user: (x, p) => M.buildZiweiUser(x, p.extra) };
    default:
      return null;
  }
}

async function computeModule(body) {
  const t0 = Date.now();
  const cfg = loadConfig();
  const mod = body.module;
  const timings = {};
  const params = body.params || {};

  // 占卜：不需要图，程序起卦
  if (mod === 'divination') {
    const gua = params.gua && params.gua.ben ? params.gua : M.meihua(body.text || params.question || '', new Date());
    const t = Date.now();
    const { parsed } = await analyzeWithLLM(cfg.analysis, M.DIV_SYSTEM, M.buildDivUser(gua, body.text || params.question));
    timings.analysisMs = Date.now() - t;
    timings.totalMs = Date.now() - t0;
    return { ok: true, module: 'divination', gua, analysis: parsed, timings, analyzedAt: new Date().toISOString() };
  }

  const pipe = modulePipeline(mod);
  if (!pipe) throw new Error('未知模块：' + mod);

  let extracted = null;
  if (body.image && /^data:image\//.test(body.image)) {
    const t = Date.now();
    const r = await visionExtract(cfg.vision, pipe.vision, body.image, 8000);
    extracted = r.parsed;
    timings.visionMs = Date.now() - t;
  } else if (mod !== 'fengshui') {
    throw new Error('该模块需要上传图片');
  }

  // 紫微：把 stars 统一成数组，容忍模型返回字符串
  if (mod === 'ziwei' && extracted) {
    const toArr = (v) => (Array.isArray(v) ? v : String(v || '').split(/[、,，\s]+/).filter(Boolean));
    if (extracted.gongs) extracted.gongs = extracted.gongs.map((g) => Object.assign({}, g, { stars: toArr(g.stars) }));
    if (extracted.minggong) extracted.minggong = Object.assign({}, extracted.minggong, { stars: toArr(extracted.minggong.stars) });
  }

  const t = Date.now();
  const { parsed } = await analyzeWithLLM(cfg.analysis, pipe.system, pipe.user(extracted, params));
  timings.analysisMs = Date.now() - t;
  timings.totalMs = Date.now() - t0;

  return {
    ok: true, module: mod, extracted, analysis: parsed, timings, analyzedAt: new Date().toISOString(),
  };
}

// ---------------- 生时校正 ----------------
async function computeRectify(body) {
  const t0 = Date.now();
  const cfg = loadConfig();
  const input = {
    year: String(body.year || '').trim(),
    month: String(body.month || '').trim(),
    day: String(body.day || '').trim(),
    birthYear: Number(body.birthYear) || null,
    gender: body.gender === '男' ? '男' : '女',
    candidates: Array.isArray(body.candidates) ? body.candidates : [],
    events: Array.isArray(body.events) ? body.events : [],
  };
  for (const k of ['year', 'month', 'day']) {
    if (!isValidGanzhi(input[k][0], input[k][1])) {
      throw new Error('三柱格式不正确：' + k + '=' + input[k]);
    }
  }
  if (!input.events.length) {
    throw new Error('请至少填写一条已知重大事件（年份 + 类型）');
  }

  const ranked = rankHours(input);
  const timings = { scoringMs: Date.now() - t0 };

  let conclusion = null;
  try {
    const t = Date.now();
    const userPrompt = M.buildRectifyUser(input, ranked);
    const { parsed } = await analyzeWithLLM(cfg.analysis, M.RECTIFY_SYSTEM, userPrompt);
    conclusion = parsed;
    timings.analysisMs = Date.now() - t;
  } catch (e) {
    console.error('[rectify] LLM 失败:', e.message);
    conclusion = { error: e.message };
  }
  timings.totalMs = Date.now() - t0;

  return {
    ok: true, module: 'rectify', input,
    ranking: ranked.ranking, eventTypes: ranked.eventTypes,
    conclusion, timings, analyzedAt: new Date().toISOString(),
  };
}

// ---------------- 对话追问 ----------------
const CHAT_SYSTEM = `你是同一位命理/相术/风水研究者，正在与当事人在线对话答疑。
用户会给你一段「本次分析的结论摘要」作为背景。规则：
1) 只基于摘要里的事实回答，不得改动干支、星曜、卦象、数据；
2) 回答要具体、可执行，控制在 300 字以内，除非用户要求展开；
3) 不确定就说"信息不足"，不要编造；
4) 涉及健康只作倾向性提醒，建议就医；涉及投资不承诺收益；
5) 不用 markdown 标题，用短段落或分号列举。`;

async function handleChat(req, res) {
  const cfg = loadConfig();
  const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || '{}');
  const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const context = String(body.context || '').slice(0, 6000);
  if (!history.length) return sendJson(res, 400, { ok: false, error: '没有对话内容' });

  const msgs = [{ role: 'system', content: CHAT_SYSTEM + '\n\n【本次分析摘要】\n' + context }]
    .concat(history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '').slice(0, 3000) })));

  const { content, usage } = await chatCompletion(cfg.analysis, msgs, 1600, 0.7);
  sendJson(res, 200, { ok: true, reply: (content || '（模型未返回内容）').trim(), usage });
}

// ---------------- 路由 ----------------
async function handleRequest(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-access-token',
      });
      return res.end();
    }
    // 公网穿透时的访问口令（config.accessToken 为空则不启用）
    if (pathname.startsWith('/api/') && pathname !== '/api/health') {
      const cfgT = loadConfig();
      if (cfgT.accessToken) {
        const provided = req.headers['x-access-token'] || u.searchParams.get('t');
        if (provided !== cfgT.accessToken) {
          return sendJson(res, 401, { ok: false, error: '需要访问口令：请用完整网址（含 ?t=口令）打开页面' });
        }
      }
    }
    if (pathname === '/api/health') {
      const cfg = loadConfig();
      return sendJson(res, 200, {
        ok: true,
        visionModel: cfg.vision.model,
        analysisModel: cfg.analysis.model,
        visionKeyConfigured: !!(cfg.vision.apiKey && cfg.vision.apiKey.length > 8),
        analysisKeyConfigured: !!(cfg.analysis.apiKey && cfg.analysis.apiKey.length > 8),
        lanUrls: lanUrls(cfg.port),
        eventTypes: M.EVENT_NAMES,
        now: new Date().toISOString(),
      });
    }
    if (req.method === 'POST' && (pathname === '/api/analyze' || pathname === '/api/module' || pathname === '/api/rectify')) {
      const cfgS = loadConfig();
      const body = JSON.parse((await readBody(req)) || '{}');
      const fns = { '/api/analyze': computeAnalyze, '/api/module': computeModule, '/api/rectify': computeRectify };
      // Serverless 平台（Vercel 等）没有常驻内存，无法跨请求保存任务队列，改同步返回
      if (process.env.SYNC_MODE === '1' || cfgS.syncMode) {
        const result = await fns[pathname](body);
        return sendJson(res, 200, result);
      }
      const jobId = newJob(pathname, () => fns[pathname](body));
      return sendJson(res, 200, { ok: true, jobId, status: 'running' });
    }
    if (req.method === 'GET' && pathname.indexOf('/api/job/') === 0) {
      const id = pathname.slice('/api/job/'.length);
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { ok: false, error: '任务不存在或已过期' });
      return sendJson(res, 200, { ok: true, jobId: id, status: job.status, result: job.result, error: job.error, createdAt: job.createdAt });
    }
    if (req.method === 'POST' && pathname === '/api/chat') return await handleChat(req, res);
    if (req.method === 'GET') return serveStatic(req, res, pathname);
    res.writeHead(405); res.end('Method Not Allowed');
  } catch (e) {
    console.error('[error]', e.message);
    sendJson(res, 500, { ok: false, error: e.message || String(e) });
  }
}

// 本地 / 云主机：自己监听端口；Serverless（Vercel）只导出 handler，由平台调用
if (require.main === module) {
  const cfg = loadConfig();
  const HOST = process.env.HOST || cfg.host || '0.0.0.0';
  http.createServer(handleRequest).listen(cfg.port, HOST, () => {
    console.log('==============================================');
    console.log('  命理分析工具（网页版）已启动');
    console.log('  本机访问：   http://127.0.0.1:' + cfg.port);
    const urls = lanUrls(cfg.port);
    if (urls.length) {
      console.log('  手机访问（同一 Wi-Fi 下）：');
      urls.forEach((u) => console.log('               ' + u));
    } else {
      console.log('  未检测到局域网 IP，手机可能无法访问');
    }
    console.log('  视觉：' + cfg.vision.model + '  分析：' + cfg.analysis.model);
    console.log('  模块：八字/紫微/面相/手相/风水/占卜/生时校正 + 对话');
    console.log('==============================================');
  });
}

module.exports = handleRequest;
