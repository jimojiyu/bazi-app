'use strict';
/** 命理提示词库：八字 + 解题式专项分析。 */

const SYSTEM_PROMPT = `你是一位严谨的传统子平命理研究者，精通《渊海子平》《三命通会》《神峰通考》《子平真诠》《滴天髓》《穷通宝鉴》的断法体系。

【硬性规则】
1. 你拿到的排盘、十神、五行、刑冲合害、旺衰、格局、喜用、大运，全部已由程序按传统规则算好，**你必须以它为准，不得自行改动干支或另立格局**。你的任务是解读与推断，不是重新排盘。
2. **四柱干支、五行百分比、旺衰评分、格局名称必须与「事实清单」逐字一致**。不得改写干支（例如把「己卯」写成「乙卯」），不得重新估算百分比。若你的判断与事实不符，只能在评论里说明，绝不能篡改数字或干支。
3. 分析要落到具体：说清是哪个十神、哪个五行、哪步大运、哪个流年造成的。
4. 「验证」必须基于**已经过去的**大运与流年（早于当前年份），不许拿未来年份冒充验证。每条要能被当事人用回忆核对：给出大致年龄段或年份、领域、具体现象、命理依据。
5. 语言简体中文，平实、少套话；不确定用「倾向于」「较可能」，不要绝对化。
6. 结尾保留免责声明：命理属传统文化推演，不构成任何决策依据。

【详略要求】这是"尽可能详细"模式：
- 格局分析 250-350 字；喜用 120-180 字；
- 性格/事业/财运/婚恋/健康/六亲各 180-260 字，要写清形成机理（哪个十神、哪个宫位、哪步大运）；
- 若用户指定了专项，专项部分每项 300-450 字，要给出可执行的具体建议。

【输出格式】只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{
  "chart_confirm": "四柱、日主、格局、旺衰的一句话确认",
  "geju_analysis": "格局与旺衰分析",
  "yongshen_analysis": "喜用神与忌神说明及依据",
  "verifications": [
    {"period":"如 2012-2021 辛巳大运","age":"如 18-27岁","domain":"领域","event":"具体推断，可核对","basis":"命理依据"}
  ],
  "personality": "性格与心性",
  "career": "事业与学业",
  "wealth": "财运",
  "marriage": "婚恋",
  "health": "健康",
  "family": "六亲缘分",
  "focus_analysis": [{"topic":"用户指定的专项","text":"深入分析"}],
  "dayun_forecast": [{"range":"如 2022-2031 壬午","text":"整体趋势与机会风险"}],
  "recent_years": [{"year":"如 2026 丙午","text":"当年提示"}],
  "advice": "给当事人的 3 条具体建议",
  "disclaimer": "免责声明"
}
verifications 必须正好 3 条。dayun_forecast 覆盖当前及以后 3-4 步大运。recent_years 覆盖当前年份前后共 3 年。若用户未指定专项，focus_analysis 输出空数组 []。`;

function fmtPillars(e) {
  return e.pillars
    .map((p) => {
      const hid = p.hidden.map((h) => `${h.gan}(${h.shishen})`).join('、');
      return `  ${p.cn} ${p.raw}｜天干${p.gan}(${p.ganShishen}) 地支${p.zhi}(${p.zhiShishen})｜藏干 ${hid}｜纳音 ${p.nayin}｜旬空 ${p.xunkong.join('')}｜星运 ${p.xingyun}`;
    })
    .join('\n');
}

/**
 * @param {object} e 引擎结果
 * @param {object} opts {focus?:string[], detail?:boolean}
 */
function buildUserPrompt(e, opts) {
  opts = opts || {};
  const focus = Array.isArray(opts.focus) ? opts.focus.filter(Boolean).slice(0, 6) : [];
  const rel = e.relations.length
    ? e.relations.map((r) => `${r.type} ${r.detail}（${r.note}）`).join('；')
    : '无显著刑冲合害';
  const wx = Object.entries(e.wxPercent).map(([k, v]) => `${k}${v}%`).join(' / ');
  const fx = Object.entries(e.wxScore).map(([k, v]) => `${k}${v}`).join(' / ');
  const dayun = e.dayun
    .map((d) => `  ${d.years} ${d.ganzhi}（${d.ganShishen}/${d.zhiShishen}，${d.startAge}-${d.endAge}岁）`)
    .join('\n');
  const cur = e.current;
  const focusLine = focus.length
    ? `\n【用户指定专项（请逐项深入分析，写入 focus_analysis）】${focus.join('、')}\n`
    : '\n【用户未指定专项】focus_analysis 返回 []\n';

  return `【事实清单（必须逐字照抄，禁止改写或重算）】
- 四柱：${e.pillars.map((p) => p.cn + ' ' + p.raw).join(' ｜ ')}
- 日主：${e.dayGan}（${e.dayWx}）
- 五行占比：${wx}（原始分值：${fx}）
- 地支关系：${rel}
- 旺衰：${e.strengthLabel}（评分 ${e.strength}）
- 格局：${e.geju}
- 喜用：${e.yongshen.desc}
${focusLine}
【分析时间】${cur.nowIso}（当前公历 ${cur.liunian.year} 年，流年 ${cur.liunian.ganzhi}，命主约 ${cur.age ?? '未知'} 岁）
【基本信息】${e.gender === '女' ? '坤造（女）' : '乾造（男）'}${e.name ? '，姓名 ' + e.name : ''}${e.birth ? '，公历 ' + e.birth : ''}

【四柱排盘（程序计算，以此为准）】
${fmtPillars(e)}

【大运（${e.forward ? '顺排' : '逆排'}，约 ${e.startAge} 岁起运）】
${dayun}

【当前大运】${cur.dayun ? cur.dayun.years + ' ' + cur.dayun.ganzhi + '（' + cur.dayun.ganShishen + '/' + cur.dayun.zhiShishen + '）' : '未知'}
【当前流年】${cur.liunian.year} ${cur.liunian.ganzhi}（${cur.liunian.shishen}）

请严格按系统提示的 JSON 结构输出：先给 3 条**已发生**的验证推断，再给详细命理运势${focus.length ? '，并逐项完成 focus_analysis' : ''}。`;
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
