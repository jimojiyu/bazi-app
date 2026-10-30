'use strict';
/** LLM 调用层：视觉识别（中转站，推理模型需大 token 预算）+ 命理分析（DeepSeek 官方）。零依赖。 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function post(url, headers, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...headers },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function pickContent(json) {
  const c = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.text || '')).join('');
  return '';
}
function finishOf(json) {
  return (json && json.choices && json.choices[0] && json.choices[0].finish_reason) || '';
}
function reasoningLen(json) {
  const m = json && json.choices && json.choices[0] && json.choices[0].message;
  return (m && m.reasoning_content && m.reasoning_content.length) || 0;
}

/** 从模型回复里抠出第一个 JSON 对象（容忍 ```json 包裹与前后废话）。 */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  for (const cand of candidates) {
    const s = cand.indexOf('{');
    if (s < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < cand.length; i++) {
      const ch = cand[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(cand.slice(s, i + 1)); } catch (e) { break; }
        }
      }
    }
  }
  return null;
}

/**
 * 视觉识别通用调用。中转站视觉模型是推理模型：思维链可能吃掉全部 token 导致正文为空，
 * 因此按「预算逐次加倍」重试，直到拿到正文。
 */
async function visionCall(config, prompt, imageDataUrl, maxTokens) {
  const budgets = [maxTokens || 8000, 16000, 24000];
  let lastInfo = '';
  for (let i = 0; i < budgets.length; i++) {
    const payload = {
      model: config.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt + (i > 0 ? '\n\n（上一次只输出了思考过程，没有正文。请直接输出 JSON 结果，不要写思考过程。）' : '') },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
      max_tokens: budgets[i],
      temperature: 0,
    };
    const json = await post(config.baseURL, {
      Authorization: 'Bearer ' + config.apiKey,
      'x-opencode-session': 'bazi-app-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    }, payload, 240000);
    const raw = pickContent(json);
    const finish = finishOf(json);
    const rlen = reasoningLen(json);
    if (raw && raw.trim()) {
      const parsed = extractJson(raw);
      if (parsed) return { parsed, raw, budgetUsed: budgets[i] };
      lastInfo = `正文 ${raw.length} 字但 JSON 不完整（finish=${finish}）`;
    } else {
      lastInfo = `正文为空（finish=${finish}，思维链 ${rlen} 字）`;
    }
    console.error('[vision] budget ' + budgets[i] + ' → ' + lastInfo + '，加大预算重试');
  }
  throw new Error('图片识别失败：' + lastInfo + '。请换一张更清晰、裁剪更紧的截图重试。');
}

/** 八字排盘截图 → 四柱与基本信息 */
const CHART_VISION_PROMPT = [
  '你是排盘截图识别器。请阅读这张八字排盘截图，提取信息。',
  '只输出一个 JSON 对象，不要任何解释，不要 markdown 代码块，不要写思考过程。字段：',
  '{',
  ' "gender": "坤造填女，乾造填男",',
  ' "birth_solar": "公历出生时间，如 1995-03-14 20:46，没有就填空字符串",',
  ' "year": "年柱干支两字",',
  ' "month": "月柱干支两字",',
  ' "day": "日柱干支两字",',
  ' "hour": "时柱干支两字",',
  ' "startAge": 起运虚岁数字（截图里有就填，没有填 null）,',
  ' "name": "截图上的姓名，没有填空字符串"',
  '}',
  '注意：干支只取天干和地支两个字，例如“甲辰”；不要把十神、藏干、纳音混进来。',
  '特别注意字形：己（jǐ，弯钩、土色）与乙（yǐ，绿色）极易混淆；戊与戌、巳与己、未与末也要分清。只填你确实看清的字。',
  '若图片不是八字排盘，输出 {"error":"not_a_chart"}。',
].join('\n');

async function extractChartFromImage(config, imageDataUrl) {
  const { parsed } = await visionCall(config, CHART_VISION_PROMPT, imageDataUrl, 4000);
  if (parsed.error) throw new Error('这张图看起来不是八字排盘截图，请换一张。');
  for (const k of ['year', 'month', 'day', 'hour']) {
    if (!parsed[k] || String(parsed[k]).replace(/[^\u4e00-\u9fa5]/g, '').length < 2) {
      throw new Error('视觉识别缺少 ' + k + ' 柱，识别结果：' + JSON.stringify(parsed));
    }
  }
  return parsed;
}

/** 通用视觉抽取（面相/手相/风水/紫微） */
async function visionExtract(config, prompt, imageDataUrl, maxTokens) {
  const { parsed } = await visionCall(config, prompt, imageDataUrl, maxTokens || 8000);
  if (parsed.error) {
    const map = { not_a_chart: '这张图不是八字排盘截图', not_a_face: '这张图里没识别到清晰人脸', not_a_palm: '这张图里没识别到手掌', not_a_house: '这张图不是住宅平面图或房屋照片', not_ziwei: '这张图不是紫微斗数命盘' };
    throw new Error(map[parsed.error] || '图片类型不符：' + parsed.error);
  }
  return { parsed };
}

/** 命理分析：推理模型需大预算，失败自动重试一次 */
async function analyzeWithLLM(config, systemPrompt, userPrompt) {
  const maxTokens = Number(config.maxTokens) >= 4000 ? Number(config.maxTokens) : 16000;
  const baseMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  let lastRaw = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = attempt === 1
      ? baseMessages
      : baseMessages.concat([
          { role: 'assistant', content: '{' },
          { role: 'user', content: '上一条输出被截断或非法。请重新输出完整合法 JSON：每条文字压缩到 80 字以内，务必闭合所有括号，不要输出 JSON 之外的任何内容。' },
        ]);
    const json = await post(config.baseURL, { Authorization: 'Bearer ' + config.apiKey }, {
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: attempt === 1 ? (typeof config.temperature === 'number' ? config.temperature : 0.4) : 0.2,
    }, 300000);
    const raw = pickContent(json);
    lastRaw = raw;
    const parsed = extractJson(raw);
    if (parsed) return { parsed, raw, usage: json.usage || null, attempts: attempt };
    console.error('[analyze] attempt ' + attempt + ' 解析失败 finish=' + finishOf(json) + ' 正文=' + String(raw).length + '字 思维链=' + reasoningLen(json) + '字');
  }
  throw new Error('分析结果两轮均未产出合法 JSON（可能被截断）。未解析正文长度 ' + String(lastRaw).length + '，开头：' + String(lastRaw).slice(0, 200));
}

/** 纯对话（不要求 JSON） */
async function chatCompletion(config, messages, maxTokens, temperature) {
  const json = await post(config.baseURL, { Authorization: 'Bearer ' + config.apiKey }, {
    model: config.model,
    messages,
    max_tokens: maxTokens || 2000,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
  }, 240000);
  return { content: pickContent(json), usage: json.usage || null };
}

module.exports = { extractChartFromImage, analyzeWithLLM, visionExtract, visionCall, chatCompletion, extractJson };
