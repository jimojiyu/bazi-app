'use strict';
/**
 * 生时校正（定时辰）：用已知重大事件，对每个候选时辰做确定性打分。
 * 原理：时辰是唯一未知量，不同时辰会改变时柱、旺衰、喜忌；
 *       把「已发生的事件」与「该时辰下的流年/大运/喜忌」对照，能解释更多事件的时辰得分更高。
 */

const { analyzeChart, hourGanFromDay, yearGanzhi, DZ, TG, CANG, shishen } = require('./bazi');

const LIUHE = [['子', '丑'], ['寅', '亥'], ['卯', '戌'], ['辰', '酉'], ['巳', '申'], ['午', '未']];
const LIUCHONG = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
const LIUHAI = [['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌']];
const SANXING = [['寅', '巳', '申'], ['丑', '戌', '未'], ['子', '卯']];

// 事件类型 → {极性, 相关十神}
const EVENT_TYPES = {
  '婚姻/恋爱': { polarity: 'good', gods: { 女: ['正官', '七杀'], 男: ['正财', '偏财'] } },
  '感情不顺/分手': { polarity: 'bad', gods: { 女: ['正官', '七杀'], 男: ['正财', '偏财'] } },
  '生育/添丁': { polarity: 'good', gods: { 女: ['食神', '伤官'], 男: ['正官', '七杀'] } },
  '工作/升职': { polarity: 'good', gods: { 女: ['正官', '七杀'], 男: ['正官', '七杀'] } },
  '学业/考试': { polarity: 'good', gods: { 女: ['正印', '偏印'], 男: ['正印', '偏印'] } },
  '财运/置业': { polarity: 'good', gods: { 女: ['正财', '偏财'], 男: ['正财', '偏财'] } },
  '搬迁/远行': { polarity: 'good', gods: {} },
  '破财/负债': { polarity: 'bad', gods: { 女: ['劫财', '比肩'], 男: ['劫财', '比肩'] } },
  '疾病/受伤': { polarity: 'bad', gods: { 女: ['七杀', '伤官'], 男: ['七杀', '伤官'] } },
  '亲人离世': { polarity: 'bad', gods: { 女: ['偏财', '正印'], 男: ['偏财', '正印'] } },
  '官非/纠纷': { polarity: 'bad', gods: { 女: ['七杀', '伤官'], 男: ['七杀', '伤官'] } },
};
const EVENT_NAMES = Object.keys(EVENT_TYPES);

function relOf(a, b) {
  if (!a || !b) return null;
  const hit = (arr) => arr.some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  if (a === b) return '同支';
  if (hit(LIUHE)) return '合';
  if (hit(LIUCHONG)) return '冲';
  if (hit(LIUHAI)) return '害';
  if (SANXING.some((g) => g.includes(a) && g.includes(b))) return '刑';
  return null;
}

function wxOf(ganOrZhi) {
  const WX = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
    子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
  return WX[ganOrZhi] || '';
}

/** 从引擎的喜忌描述里抽出喜神、忌神五行 */
function xiJi(engine) {
  const xi = [], ji = [];
  for (const g of (engine.yongshen.xi || [])) { const m = String(g).match(/[木火土金水]/g) || []; xi.push(...m); }
  for (const g of (engine.yongshen.ji || [])) { const m = String(g).match(/[木火土金水]/g) || []; ji.push(...m); }
  return { xi: Array.from(new Set(xi)), ji: Array.from(new Set(ji)) };
}

/**
 * @param {object} input {year,month,day 三柱, birthYear, gender, candidates:[时辰地支], events:[{year,type,note}]}
 */
function rankHours(input) {
  const { year, month, day, birthYear, gender } = input;
  const candidates = (input.candidates && input.candidates.length) ? input.candidates : DZ.slice();
  const events = (input.events || []).filter((e) => e && e.year && e.type);
  const genderKey = gender === '男' ? '男' : '女';

  const results = candidates.map((zhi) => {
    const hourGan = hourGanFromDay(day[0], zhi);
    const chart = { year, month, day, hour: hourGan + zhi };
    let engine;
    try {
      engine = analyzeChart(chart, { gender: genderKey, birthYear, startAge: 7 });
    } catch (e) {
      return { zhi, hour: hourGan + zhi, score: -999, hits: 0, error: e.message, details: [] };
    }
    const wuxingji = xiJi(engine);
    const mingGongZhi = engine.pillars[3].zhi; // 时支
    let score = 0, hits = 0;
    const details = [];

    for (const ev of events) {
      const Y = Number(ev.year);
      const t = EVENT_TYPES[ev.type] || { polarity: 'good', gods: {} };
      const age = birthYear ? Y - birthYear + 1 : null;
      const dy = age ? engine.dayun.find((d) => age >= d.startAge && age <= d.endAge) : null;
      const ln = yearGanzhi(Y);
      const lnGan = ln[0], lnZhi = ln[1];
      let s = 0;
      const why = [];

      // ① 时支被流年引动（时柱为子女宫/晚年宫，被冲合刑害说明该年有事应）
      const r1 = relOf(zhi, lnZhi);
      if (r1 === '冲') { s += 1.6; why.push('时支与流年' + lnZhi + '相冲'); }
      else if (r1 === '合') { s += 1.3; why.push('时支与流年' + lnZhi + '相合'); }
      else if (r1 === '刑' || r1 === '害') { s += 1.0; why.push('时支与流年' + lnZhi + r1); }
      else if (r1 === '同支') { s += 0.9; why.push('时支与流年同气'); }

      // ② 时支被大运引动
      if (dy) {
        const r2 = relOf(zhi, dy.ganzhi[1]);
        if (r2 === '冲') { s += 1.0; why.push('时支与大运' + dy.ganzhi + '相冲'); }
        else if (r2 === '合') { s += 0.8; why.push('时支与大运相合'); }
        else if (r2 === '刑' || r2 === '害') { s += 0.6; why.push('时支与大运' + r2); }
      }

      // ③ 时干十神与该类事件的关联
      const gods = (t.gods && t.gods[genderKey]) || [];
      if (gods.length) {
        const sg = engine.pillars[3].ganShishen;
        if (gods.includes(sg)) { s += 1.0; why.push('时干' + sg + '与' + ev.type + '相应'); }
        const lnShen = shishen(day[0], lnGan);
        if (gods.includes(lnShen)) { s += 0.8; why.push('流年干' + lnGan + '为' + lnShen + '应事'); }
        if (dy && gods.includes(dy.ganShishen)) { s += 0.6; why.push('大运干为' + dy.ganShishen); }
      }

      // ④ 喜忌契合：好事落在喜神年、坏事落在忌神年，说明该时辰的旺衰喜忌定得对
      const lnWx1 = wxOf(lnGan), lnWx2 = wxOf(lnZhi);
      const goodYear = wuxingji.xi.includes(lnWx1) || wuxingji.xi.includes(lnWx2);
      const badYear = wuxingji.ji.includes(lnWx1) || wuxingji.ji.includes(lnWx2);
      if (t.polarity === 'good' && goodYear) { s += 1.5; why.push('流年走喜神（' + lnWx1 + '/' + lnWx2 + '）'); }
      else if (t.polarity === 'bad' && badYear) { s += 1.5; why.push('流年走忌神（' + lnWx1 + '/' + lnWx2 + '）'); }
      else if (t.polarity === 'good' && badYear) { s -= 0.8; why.push('吉事却落忌神年（不合）'); }
      else if (t.polarity === 'bad' && goodYear) { s -= 0.8; why.push('凶事却落喜神年（不合）'); }

      // ⑤ 日支（夫妻宫）与时支的关系，对婚恋生育类有额外意义
      if (ev.type.indexOf('婚姻') >= 0 || ev.type.indexOf('生育') >= 0 || ev.type.indexOf('感情') >= 0) {
        const r3 = relOf(zhi, engine.pillars[2].zhi);
        if (r3 === '合') { s += 0.7; why.push('时支与日支（夫妻宫）相合'); }
        if (r3 === '冲') { s += 0.5; why.push('时支冲动夫妻宫'); }
      }

      score += s;
      if (s >= 1.5) hits++;   // 只统计「强命中」，避免人人 4/4 失去区分度
      details.push({ year: Y, type: ev.type, note: ev.note || '', score: Math.round(s * 100) / 100, why: why.join('；') });
    }

    return {
      zhi,
      hour: hourGan + zhi,
      hourGan,
      score: Math.round(score * 100) / 100,
      maxScore: Math.round(events.length * 6.9 * 100) / 100,
      hits,
      geju: engine.geju,
      strength: engine.strengthLabel,
      dayGan: engine.dayGan,
      wxPercent: engine.wxPercent,
      details,
    };
  });

  // 归一化 0-100
  const top = Math.max.apply(null, results.map((r) => r.score).concat([0]));
  results.forEach((r) => {
    r.percent = top > 0 ? Math.round((Math.max(0, r.score) / top) * 100) : 0;
  });
  results.sort((a, b) => b.score - a.score);
  results.forEach((r, i) => { r.rank = i + 1; });

  return { ranking: results, events, candidates, eventTypes: EVENT_NAMES };
}

module.exports = { rankHours, EVENT_NAMES, EVENT_TYPES };
