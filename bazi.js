'use strict';
/**
 * 确定性八字引擎：干支→十神、藏干、五行统计、刑冲合害、旺衰、格局、喜用、大运、流年。
 * 所有结论均由代码按传统规则推算，不交给模型臆测，模型只负责组织语言与推断叙述。
 */

const TG = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DZ = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const TG_WX = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const DZ_WX = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };

// 藏干：本气、中气、余气
const CANG = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '戊', '庚'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};

const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }; // 我生
const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };   // 我克

const NAYIN = ['海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水'];

const LIUHE = [['子', '丑'], ['寅', '亥'], ['卯', '戌'], ['辰', '酉'], ['巳', '申'], ['午', '未']];
const SANHE = [['申', '子', '辰', '水'], ['亥', '卯', '未', '木'], ['寅', '午', '戌', '火'], ['巳', '酉', '丑', '金']];
const LIUCHONG = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
const LIUHAI = [['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌']];
const SANXING = [['寅', '巳', '申', '无恩之刑'], ['丑', '戌', '未', '恃势之刑'], ['子', '卯', '无礼之刑']];
const ZIXING = ['辰', '午', '酉', '亥'];

// 十二长生：长生起点表（阳干顺行、阴干逆行）
const CS_START = { 甲: 11, 乙: 6, 丙: 2, 丁: 9, 戊: 2, 己: 9, 庚: 5, 辛: 0, 壬: 8, 癸: 3 };
const CS_STAGES = ['长生', '沐浴', '冠带', '临官', '帝旺', '衰', '病', '死', '墓', '绝', '胎', '养'];

function stageIndex(gan, zhi) {
  const start = CS_START[gan];
  const dir = isYang(gan) ? 1 : -1;
  const z = DZ.indexOf(zhi);
  return ((z - start) * dir % 12 + 12) % 12;
}
function changsheng(gan, zhi) { return CS_STAGES[stageIndex(gan, zhi)]; }
function zhiAtStage(gan, stage) {
  const start = CS_START[gan];
  const dir = isYang(gan) ? 1 : -1;
  return DZ[((start + CS_STAGES.indexOf(stage) * dir) % 12 + 12) % 12];
}

const PILLAR_NAMES = ['year', 'month', 'day', 'hour'];
const PILLAR_CN = { year: '年柱', month: '月柱', day: '日柱', hour: '时柱' };

function isYang(ch) {
  const i = TG.indexOf(ch);
  if (i >= 0) return i % 2 === 0;
  const j = DZ.indexOf(ch);
  return j % 2 === 0;
}

function shishen(dayGan, otherGan) {
  const dw = TG_WX[dayGan];
  const ow = TG_WX[otherGan];
  const same = isYang(dayGan) === isYang(otherGan);
  if (ow === dw) return same ? '比肩' : '劫财';
  if (SHENG[dw] === ow) return same ? '食神' : '伤官';
  if (SHENG[ow] === dw) return same ? '偏印' : '正印';
  if (KE[dw] === ow) return same ? '偏财' : '正财';
  if (KE[ow] === dw) return same ? '七杀' : '正官';
  return '未知';
}

function jiaziIndex(gan, zhi) {
  const g = TG.indexOf(gan), z = DZ.indexOf(zhi);
  for (let k = 0; k < 60; k++) if (k % 10 === g && k % 12 === z) return k;
  return -1;
}

function nayin(gan, zhi) {
  const k = jiaziIndex(gan, zhi);
  if (k < 0) return '';
  return NAYIN[Math.floor(k / 2)];
}

// 该柱所在旬的空亡（两个地支）
function xunkong(gan, zhi) {
  const g = TG.indexOf(gan), z = DZ.indexOf(zhi);
  const x = ((z - g) % 12 + 12) % 12;
  return [DZ[(x + 10) % 12], DZ[(x + 11) % 12]];
}

function yearGanzhi(year) {
  const g = ((year - 4) % 10 + 10) % 10;
  const z = ((year - 4) % 12 + 12) % 12;
  return TG[g] + DZ[z];
}

/**
 * @param {object} chart {year,month,day,hour} 四柱干支，如 {year:'乙亥',...}
 * @param {object} meta  {gender:'女'|'男', birth:'1995-03-14 20:46', startAge:number|null, name}
 */
function analyzeChart(chart, meta) {
  meta = meta || {};
  const gender = meta.gender === '男' || meta.gender === '乾造' ? '男' : '女';
  const pillars = PILLAR_NAMES.map((k) => {
    const s = String(chart[k] || '').trim();
    const gan = s[0], zhi = s[1];
    return { key: k, cn: PILLAR_CN[k], raw: s, gan, zhi, valid: TG.includes(gan) && DZ.includes(zhi) };
  });
  if (pillars.some((p) => !p.valid)) {
    throw new Error('四柱干支格式不正确：' + pillars.map((p) => p.raw).join(' / '));
  }

  const dayGan = pillars[2].gan;
  const dayWx = TG_WX[dayGan];
  const monthZhi = pillars[1].zhi;

  // 每柱十神 + 藏干十神 + 纳音 + 旬空
  pillars.forEach((p) => {
    p.ganShishen = p.key === 'day' ? '日主' : shishen(dayGan, p.gan);
    p.hidden = CANG[p.zhi].map((g, i) => ({
      gan: g, wx: TG_WX[g], level: i === 0 ? '本气' : i === 1 ? '中气' : '余气',
      shishen: shishen(dayGan, g),
    }));
    p.zhiShishen = p.hidden[0].shishen;
    p.nayin = nayin(p.gan, p.zhi);
    p.xunkong = xunkong(p.gan, p.zhi);
    p.ganWx = TG_WX[p.gan];
    p.zhiWx = DZ_WX[p.zhi];
    p.xingyun = changsheng(dayGan, p.zhi);   // 星运：日主在本柱地支的十二长生
    p.selfSit = changsheng(p.gan, p.zhi);    // 自坐：本柱天干坐本柱地支
  });

  // 五行统计（天干1.0，藏干按 本气1.0/中气0.6/余气0.3 计）
  const wxScore = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  pillars.forEach((p) => {
    wxScore[p.ganWx] += 1;
    p.hidden.forEach((h) => { wxScore[h.wx] += h.level === '本气' ? 1 : h.level === '中气' ? 0.6 : 0.3; });
  });
  const wxTotal = Object.values(wxScore).reduce((a, b) => a + b, 0);
  const wxPercent = {};
  Object.keys(wxScore).forEach((k) => { wxPercent[k] = Math.round((wxScore[k] / wxTotal) * 100); });

  // 地支关系
  const zhis = pillars.map((p) => p.zhi);
  const relations = [];
  for (let i = 0; i < zhis.length; i++) {
    for (let j = i + 1; j < zhis.length; j++) {
      const a = zhis[i], b = zhis[j];
      const hit = (arr) => arr.some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
      if (hit(LIUHE)) relations.push({ type: '六合', detail: a + b, note: '合而牵绊、易有合作或私情' });
      if (hit(LIUCHONG)) relations.push({ type: '六冲', detail: a + b, note: '冲则动，主变动、分离、走动' });
      if (hit(LIUHAI)) relations.push({ type: '六害', detail: a + b, note: '害主暗损、隔阂' });
    }
  }
  SANHE.forEach(([a, b, c, wx]) => {
    if (zhis.includes(a) && zhis.includes(b) && zhis.includes(c)) {
      relations.push({ type: '三合局', detail: a + b + c + '合' + wx + '局', note: '合局力量大，成局则一边倒' });
    }
  });
  SANXING.forEach((g) => {
    const need = g.slice(0, g.length - 1);
    const name = g[g.length - 1];
    if (name === '无礼之刑' && need.length === 2) {
      if (zhis.includes('子') && zhis.includes('卯')) relations.push({ type: '三刑', detail: '子卯', note: '子卯无礼之刑，主口舌是非、失礼、桃花纠葛' });
    } else if (need.length >= 2 && need.every((z) => zhis.includes(z))) {
      relations.push({ type: '三刑', detail: need.join(''), note: name + '，主刑伤、官非、意外或六亲不利' });
    }
  });
  ZIXING.forEach((z) => {
    if (zhis.filter((x) => x === z).length >= 2) relations.push({ type: '自刑', detail: z + z, note: '自刑主内耗、自我纠结' });
  });

  // 旺衰评分（简化传统模型，仅供辅助）
  const shengme = Object.keys(SHENG).find((k) => SHENG[k] === dayWx); // 生我者
  const kewo = Object.keys(KE).find((k) => KE[k] === dayWx);          // 克我者
  let strength = 0;
  const mwx = DZ_WX[monthZhi];
  if (mwx === dayWx) strength += 3;
  else if (mwx === shengme) strength += 2;
  else if (mwx === kewo) strength -= 2;
  else strength -= 1;

  const weightOf = { 比肩: 1, 劫财: 0.8, 正印: 1, 偏印: 0.8, 食神: -0.6, 伤官: -0.8, 正财: -0.7, 偏财: -0.6, 正官: -1, 七杀: -1.2 };
  pillars.forEach((p, idx) => {
    if (idx !== 2) strength += (weightOf[p.ganShishen] || 0) * 0.8;
    p.hidden.forEach((h, i) => {
      const w = i === 0 ? 1 : i === 1 ? 0.6 : 0.3;
      strength += (weightOf[h.shishen] || 0) * w * 0.5;
    });
  });
  strength = Math.round(strength * 100) / 100;

  let strengthLabel;
  if (strength >= 3) strengthLabel = '身旺（偏强）';
  else if (strength >= 0.8) strengthLabel = '身稍旺';
  else if (strength > -0.8) strengthLabel = '中和';
  else if (strength > -3) strengthLabel = '身稍弱';
  else strengthLabel = '身弱';
  const isStrong = strength >= 0.8;

  // 格局（以月令为主，简化）
  const monthHiddenMain = CANG[monthZhi][0];
  const monthMainShishen = shishen(dayGan, monthHiddenMain);
  let geju = monthMainShishen + '格';
  const isYangGan = isYang(dayGan);
  if (monthZhi === zhiAtStage(dayGan, '临官')) geju = '建禄格';
  else if (isYangGan && monthZhi === zhiAtStage(dayGan, '帝旺')) geju = '羊刃格';
  else if (isYangGan && monthZhi === zhiAtStage(dayGan, '长生')) geju = '月劫格';

  // 喜用（简化：身旺喜克泄耗，身弱喜生扶）
  const yongshen = isStrong
    ? { xi: ['官杀（' + kewo + '）', '食伤（' + SHENG[dayWx] + '）', '财（' + KE[dayWx] + '）'], ji: ['印（' + shengme + '）', '比劫（' + dayWx + '）'], desc: '身旺宜克泄耗，喜官杀、食伤、财；忌印比再助身。' }
    : { xi: ['印（' + shengme + '）', '比劫（' + dayWx + '）'], ji: ['官杀（' + kewo + '）', '食伤（' + SHENG[dayWx] + '）', '财（' + KE[dayWx] + '）'], desc: '身弱宜生扶，喜印、比劫；忌财官食伤耗克。' };

  // 大运（按年干阴阳 + 性别定顺逆，从月柱起）
  const yearYang = isYang(pillars[0].gan);
  const forward = (yearYang && gender === '男') || (!yearYang && gender === '女');
  const monthIdx = jiaziIndex(pillars[1].gan, pillars[1].zhi);
  const startAge = Number.isFinite(meta.startAge) && meta.startAge > 0 ? meta.startAge : 8;
  const birthYear = meta.birthYear || (meta.birth ? parseInt(String(meta.birth).slice(0, 4), 10) : null);
  const dayun = [];
  for (let i = 1; i <= 10; i++) {
    const idx = ((monthIdx + (forward ? i : -i)) % 60 + 60) % 60;
    const gan = TG[idx % 10], zhi = DZ[idx % 12];
    const a1 = Math.round((startAge + (i - 1) * 10) * 10) / 10;
    const a2 = Math.round((startAge + i * 10 - 0.1) * 10) / 10;
    dayun.push({
      index: i,
      ganzhi: gan + zhi,
      ganShishen: shishen(dayGan, gan),
      zhiShishen: shishen(dayGan, CANG[zhi][0]),
      startAge: a1,
      endAge: a2,
      years: birthYear ? `${birthYear + Math.floor(a1)}-${birthYear + Math.floor(a2)}` : `${a1}-${a2}岁`,
    });
  }

  // 当前流年 / 当前大运（实时计算，保证“联网更新”每次都是最新）
  const now = new Date();
  const curYear = now.getFullYear();
  const curAge = birthYear ? curYear - birthYear + 1 : null;
  const currentLiunian = { year: curYear, ganzhi: yearGanzhi(curYear), shishen: shishen(dayGan, yearGanzhi(curYear)[0]) };
  const currentDayun = curAge ? dayun.find((d) => curAge >= d.startAge && curAge <= d.endAge) || null : null;

  return {
    gender,
    name: meta.name || '',
    birth: meta.birth || '',
    pillars,
    dayGan, dayWx, monthZhi,
    wxScore, wxPercent, wxTotal,
    relations,
    strength, strengthLabel, isStrong,
    geju,
    yongshen,
    dayun,
    forward,
    startAge,
    current: { liunian: currentLiunian, dayun: currentDayun, age: curAge, nowIso: now.toISOString() },
  };
}

/** 五虎遁：由年干定寅月天干，再推月干。OCR 常把「己」误认成「乙」，此函数用于自校验/纠错。 */
const WUHU_BASE = { 甲: 2, 己: 2, 乙: 4, 庚: 4, 丙: 6, 辛: 6, 丁: 8, 壬: 8, 戊: 0, 癸: 0 };
function monthGanFromYear(yearGan, monthZhi) {
  const base = WUHU_BASE[yearGan];
  if (base === undefined) return '';
  const offset = ((DZ.indexOf(monthZhi) - 2) % 12 + 12) % 12; // 寅=0
  return TG[(base + offset) % 10];
}

/** 五鼠遁：由日干定子时天干，再推时干。 */
const WUSHU_BASE = { 甲: 0, 己: 0, 乙: 2, 庚: 2, 丙: 4, 辛: 4, 丁: 6, 壬: 6, 戊: 8, 癸: 8 };
function hourGanFromDay(dayGan, hourZhi) {
  const base = WUSHU_BASE[dayGan];
  if (base === undefined) return '';
  return TG[(base + DZ.indexOf(hourZhi)) % 10];
}

function isValidGanzhi(gan, zhi) {
  return TG.includes(gan) && DZ.includes(zhi) && jiaziIndex(gan, zhi) >= 0;
}

module.exports = {
  analyzeChart, shishen, yearGanzhi, TG, DZ, CANG,
  monthGanFromYear, hourGanFromDay, isValidGanzhi, jiaziIndex,
};
