'use strict';
/**
 * 各模块：面相 / 手相 / 住宅风水 / 占卜 / 紫微斗数
 * 视觉识别（中转站）负责从图里抽事实，分析（DeepSeek 官方）负责解读。
 */

// ---------- 八卦 / 六十四卦（梅花起卦用） ----------
const XIANTIAN = { 1: '乾', 2: '兑', 3: '离', 4: '震', 5: '巽', 6: '坎', 7: '艮', 8: '坤' };
const TRIGRAM_WX = { 乾: '金', 兑: '金', 离: '火', 震: '木', 巽: '木', 坎: '水', 艮: '土', 坤: '土' };
// 三爻：[下, 中, 上]，1=阳 0=阴
const TRIGRAM_LINES = {
  乾: [1, 1, 1], 兑: [1, 1, 0], 离: [1, 0, 1], 震: [1, 0, 0],
  巽: [0, 1, 1], 坎: [0, 1, 0], 艮: [0, 0, 1], 坤: [0, 0, 0],
};
// GUA64[上卦][下卦] = 卦名
const GUA64 = {
  乾: { 乾: '乾', 兑: '履', 离: '同人', 震: '无妄', 巽: '姤', 坎: '讼', 艮: '遁', 坤: '否' },
  兑: { 乾: '夬', 兑: '兑', 离: '革', 震: '随', 巽: '大过', 坎: '困', 艮: '咸', 坤: '萃' },
  离: { 乾: '大有', 兑: '睽', 离: '离', 震: '噬嗑', 巽: '鼎', 坎: '未济', 艮: '旅', 坤: '晋' },
  震: { 乾: '大壮', 兑: '归妹', 离: '丰', 震: '震', 巽: '恒', 坎: '解', 艮: '小过', 坤: '豫' },
  巽: { 乾: '小畜', 兑: '中孚', 离: '家人', 震: '益', 巽: '巽', 坎: '涣', 艮: '渐', 坤: '观' },
  坎: { 乾: '需', 兑: '节', 离: '既济', 震: '屯', 巽: '井', 坎: '坎', 艮: '蹇', 坤: '比' },
  艮: { 乾: '大畜', 兑: '损', 离: '贲', 震: '颐', 巽: '蛊', 坎: '蒙', 艮: '艮', 坤: '剥' },
  坤: { 乾: '泰', 兑: '临', 离: '明夷', 震: '复', 巽: '升', 坎: '师', 艮: '谦', 坤: '坤' },
};

function trigramFromLines(l) {
  for (const name of Object.keys(TRIGRAM_LINES)) {
    const t = TRIGRAM_LINES[name];
    if (t[0] === l[0] && t[1] === l[1] && t[2] === l[2]) return name;
  }
  return '';
}

/** 梅花易数时间起卦（确定可复现） */
function meihua(question, date) {
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate(), h = date.getHours();
  const shichen = Math.floor(((h + 1) % 24) / 2); // 0=子
  const zhiNum = (((y - 4) % 12) + 12) % 12 + 1;  // 年支序数 子=1
  const base = zhiNum + mo + d;
  const upNum = (base % 8) || 8;
  const sum = base + (shichen + 1);
  const lowNum = (sum % 8) || 8;
  const dong = (sum % 6) || 6;

  const up = XIANTIAN[upNum], low = XIANTIAN[lowNum];
  const lines = [].concat(TRIGRAM_LINES[low], TRIGRAM_LINES[up]); // 1..6 自下而上

  // 互卦：二三四爻为下互，三四五爻为上互
  const huLow = trigramFromLines([lines[1], lines[2], lines[3]]);
  const huUp = trigramFromLines([lines[2], lines[3], lines[4]]);

  // 变卦：动爻变
  const changed = lines.slice();
  changed[dong - 1] = changed[dong - 1] ? 0 : 1;
  const bLow = trigramFromLines([changed[0], changed[1], changed[2]]);
  const bUp = trigramFromLines([changed[3], changed[4], changed[5]]);

  const ti = dong <= 3 ? up : low;   // 动爻所在卦为用，另一为体
  const yong = dong <= 3 ? low : up;
  const tiWx = TRIGRAM_WX[ti], yongWx = TRIGRAM_WX[yong];
  const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
  const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };
  let relation;
  if (tiWx === yongWx) relation = '体用比和（吉）';
  else if (SHENG[yongWx] === tiWx) relation = '用生体（吉，得助力）';
  else if (SHENG[tiWx] === yongWx) relation = '体生用（泄气，费力）';
  else if (KE[tiWx] === yongWx) relation = '体克用（吉，但需费力争取）';
  else relation = '用克体（凶，受阻）';

  return {
    qiguaTime: date.toISOString(),
    shichen: ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'][shichen] + '时',
    up, low, dong,
    ben: { name: GUA64[up][low], up, low },
    hu: { name: huUp && huLow ? GUA64[huUp][huLow] : '', up: huUp, low: huLow },
    bian: { name: bUp && bLow ? GUA64[bUp][bLow] : '', up: bUp, low: bLow },
    ti, yong, tiWx, yongWx, relation,
    question: question || '',
  };
}

// ---------- 面相 ----------
const FACE_SYSTEM = `你是一位传统相术研究者，熟悉《神相全编》《麻衣相法》《柳庄相法》的相理。
你会先收到一张由视觉模型提取的面部特征清单，请据此分析。
【规则】1) 只能基于给定的特征分析，不得虚构看不见的信息；2) 不谈医疗诊断；3) 语言平实，用"倾向/较可能"；4) 结尾给免责声明（相术属传统文化，仅供娱乐参考，不作为任何决策依据）。
【输出】只输出 JSON，不要 markdown：
{"features_summary":"特征复述","overall":"总体格局（面型与三停比例）","sanjing":"三停分析（上/中/下停主早中晚年）","wuguan":"五官分析（眉眼耳鼻口）","shi_er_gong":"十二宫要点（印堂/眉/眼/鼻/颧/口/下巴等）","qise":"气色与神态","fortune":"运势倾向：青年/中年/晚年三段","suggestions":"给本人的建议","disclaimer":"免责声明"}`;

const FACE_VISION = `请阅读这张人脸/面相照片，客观提取特征，只输出 JSON，不要解释：
{"face_shape":"脸型（如国字脸/瓜子脸/圆脸/长脸）","sanjing":"三停比例观察（上停额部、中停眉眼鼻、下停口下巴）","wuguan":"五官形态客观描述（眉、眼、耳、鼻、口）","qise":"气色、神态、肤色倾向","marks":"明显特征（痣、疤痕、纹路、左右不对称）","age_range":"大致年龄段","gender":"男/女"}
若照片不是清晰人脸，输出 {"error":"not_a_face"}。`;

// ---------- 手相 ----------
const PALM_SYSTEM = `你是一位传统手相研究者，熟悉掌形、三大主线与辅线的相法。
你会先收到一张由视觉模型提取的掌纹特征清单，请据此分析。
【规则】1) 只能基于给定特征；2) 不谈医疗诊断、不预测寿命；3) 语言平实；4) 结尾给免责声明。
【输出】只输出 JSON，不要 markdown：
{"features_summary":"特征复述","palm_shape":"掌形与手型判断","shenmingxian":"生命线（体质与精力）","zhihuixian":"智慧线（思维与学业）","ganqingxian":"感情线（情感与人际）","fuye":"事业线/成功线及其他辅线","overall":"总体格局","fortune":"运势倾向","suggestions":"建议","disclaimer":"免责声明"}`;

const PALM_VISION = `请阅读这张手掌照片，客观提取掌纹特征，只输出 JSON，不要解释：
{"hand":"左手/右手/不确定","palm_shape":"掌形（金木水火土五形掌倾向，或方圆长宽）","shenmingxian":"生命线走向、长短、深浅、是否分叉/断裂","zhihuixian":"智慧线走向、直或弯、起点是否与生命线相连","ganqingxian":"感情线走向、高低、分叉","other_lines":"事业线、成功线、婚姻线等可见情况","colors":"掌色、掌丘饱满程度","marks":"明显特征（痣、纹路异常）","age_range":"大致年龄段"}
若照片不是手掌，输出 {"error":"not_a_palm"}。`;

// ---------- 住宅风水 ----------
const FENGSHUI_SYSTEM = `你是一位传统堪舆研究者，熟悉形势派（龙穴砂水向）与理气派（八宅、三合、玄空飞星）。
用户会给住宅平面图/照片 + 方位说明。请按以下顺序分析：
1) 先看形：户型是否方正、缺角、穿堂、门冲、厨卫位置；
2) 再看理：以用户给的朝向推算八宅/玄空要点（信息不足时明确说明假设）；
3) 给出具体、可执行的调理建议（摆件、颜色、床位朝向、屏风等），不要玄乎。
【规则】不谈医疗诊断、不做投资承诺；语言平实；结尾给免责声明。
【输出】只输出 JSON，不要 markdown：
{"layout":"户型格局客观描述","quejiao":"缺角与形煞判断","men":"大门与入户动线","keting":"客厅","woshi":"卧室与床位","chufang":"厨房","weishengjian":"卫生间","caiwei":"财位/文昌位判断","overall":"总体吉凶倾向","issues":[{"problem":"问题","reason":"原理","fix":"化解办法"}],"suggestions":"综合调理建议","disclaimer":"免责声明"}`;

const FENGSHUI_VISION = `请阅读这张住宅平面图/房屋照片，客观提取信息，只输出 JSON，不要解释：
{"type":"平面图/实景照片","layout":"户型形状（方正/L形/缺角位置）","rooms":"可见房间与相对位置（入户门、客厅、卧室、厨房、卫生间）","door_alignment":"门窗相对关系（如门对门、大门直通阳台）","toilet_pos":"卫生间位置","kitchen_pos":"厨房位置","notes":"其他可见信息"}
若图不是住宅平面图或房屋照片，输出 {"error":"not_a_house"}。`;

// ---------- 紫微斗数 ----------
const ZIWEI_SYSTEM = `你是一位紫微斗数研究者，熟悉十四主星、十二宫、四化、大限与小限。
你会先收到一张由视觉模型从紫微排盘截图（文墨天机/问真等）提取的命盘事实清单，请严格据此分析，**不得自行改星、改宫、改四化**。
【规则】1) 只基于给定命盘；2) 说清是哪个宫、哪颗星、哪一化造成的；3) 语言平实；4) 结尾给免责声明。
【输出】只输出 JSON，不要 markdown：
{"pan_summary":"命盘要点复述（命宫、五行局、命主身主）","minggong":"命宫主星与性格","shengong":"身宫落宫与后天倾向","shi_er_gong":[{"gong":"宫名","text":"该宫要点"}],"sihua":"四化落宫解读","geju":"格局判断（如杀破狼、机月同梁等）","daxian":"大限走势（当前及以后2-3步）","fortune":"综合运势","advice":"建议","disclaimer":"免责声明"}`;

const ZIWEI_VISION = `阅读紫微斗数命盘截图，直接输出 JSON（不要写思考过程、不要 markdown）：
{"gender":"阴女/阳女/阴男/阳男","birth_solar":"公历时间","lunar":"农历时间","wuxingju":"五行局如金四局","mingzhu":"命主","shenzhu":"身主","minggong":{"zhi":"地支","gan":"天干","stars":"命宫主星，用、分隔"},"shengong":"身宫落在哪个宫","sihua":{"lu":"","quan":"","ke":"","ji":""},"gongs":[{"name":"命宫","zhi":"辰","gan":"庚","stars":"太阳、擎羊","daxian":"4~13"}]}
要求：gongs 必须含命宫、兄弟、夫妻、子女、财帛、疾厄、迁移、交友、官禄、田宅、福德、父母十二个；stars 只写主要星曜并用、分隔；看不清的字段留空字符串。非紫微命盘输出 {"error":"not_ziwei"}。`;

// ---------- 占卜 ----------
const DIV_SYSTEM = `你是一位梅花易数占卜研究者。
用户的问题与起卦结果（本卦、互卦、变卦、体用、动爻）会由程序算出并给你，请严格据此断卦，**不得自行改卦**。
【规则】1) 断卦要落到具体：体用生克、卦象取象（乾为天/领导/刚健，坤为地/包容/母亲，震为动/长男，巽为风/长女，坎为险/水，离为火/中女/文书，艮为止/少男/山，兑为悦/少女/口）；2) 给应期提示；3) 结尾给免责声明。
【输出】只输出 JSON，不要 markdown：
{"gua":"本卦名与卦象（上下卦）","tixiang":"体用分析（体用五行生克、吉凶）","hugua":"互卦看过程","biangua":"变卦看结果","duan":"综合断语（针对用户所问之事）","yingqi":"应期提示","advice":"建议","disclaimer":"免责声明"}`;

// ---------- 组合 prompt ----------
function buildFaceUser(extracted, extra) {
  return `【视觉提取的面部特征】\n${JSON.stringify(extracted, null, 1)}\n\n【用户补充】${extra || '无'}\n\n请据此输出面相分析 JSON。`;
}
function buildPalmUser(extracted, extra) {
  return `【视觉提取的掌纹特征】\n${JSON.stringify(extracted, null, 1)}\n\n【用户补充】${extra || '无'}\n\n请据此输出手相分析 JSON。`;
}
function buildFengshuiUser(extracted, params) {
  const p = params || {};
  return `【房屋信息】朝向：${p.orientation || '未说明'}；楼层：${p.floor || '未说明'}；入住时间：${p.moveIn || '未说明'}；屋主生年：${p.birthYear || '未说明'}；户型：${p.layout || '未说明'}
【视觉提取】\n${extracted ? JSON.stringify(extracted, null, 1) : '（未提供图片，仅按文字描述分析）'}
【用户补充问题】${p.extra || '无'}

请据此输出住宅风水分析 JSON（信息不足处明确说明假设）。`;
}
function buildZiweiUser(extracted, extra) {
  return `【紫微命盘事实清单（程序来自截图识别，必须照此分析）】\n${JSON.stringify(extracted, null, 1)}\n\n【用户补充】${extra || '无'}\n\n请据此输出紫微斗数分析 JSON。`;
}
function buildDivUser(gua, question) {
  return `【所问之事】${question || '（未具体说明，按当下运势断）'}
【起卦时间】${gua.qiguaTime}（${gua.shichen}）
【本卦】${gua.ben.name}（上卦 ${gua.ben.up} / 下卦 ${gua.ben.low}）动爻：第 ${gua.dong} 爻
【互卦】${gua.hu.name || '—'}（上 ${gua.hu.up || '—'} / 下 ${gua.hu.low || '—'}）
【变卦】${gua.bian.name || '—'}（上 ${gua.bian.up || '—'} / 下 ${gua.bian.low || '—'}）
【体用】体卦 ${gua.ti}（${gua.tiWx}），用卦 ${gua.yong}（${gua.yongWx}），${gua.relation}

请据此输出占卜断卦 JSON。`;
}

const { EVENT_NAMES } = require('./rectify');

// ---------- 生时校正 ----------
const RECTIFY_SYSTEM = `你是擅长「生时校正（定时辰）」的紫微/子平命理师。
用户已确定年柱、月柱、日柱，只差时辰。程序已对每个候选时辰按已知事件做了确定性打分：时辰本身无法直接"算出"，只能比较"哪个时辰能解释更多已发生的事"。
【规则】
1) 必须以给定打分为主要依据，不得无视明显的高分时辰，也不得把低分时辰说成最优；
2) 分数接近时要坦白说明难以分辨，并指出还缺什么信息；
3) 要具体点出该时辰下哪些事件吻合、哪些解释不了；
4) 语言平实，用"较可能/倾向于"；结尾提醒：若日后发现明显不符，需重新校正；
5) 结尾给免责声明：命理属传统文化推演，不构成决策依据。
【输出】只输出 JSON，不要 markdown：
{"best":"地支如 戌","best_hour":"如 甲戌","confidence":"较高/中等/较低","reason":"200-300字，说明为何此项最高、与其他候选差在哪","event_match":[{"event":"事件描述","fit":"吻合/部分吻合/不吻合","why":"命理依据"}],"daily_check":"给 2-3 个可自查的生活细节（如兄弟姐妹数、头胎性别、某类疾病或性格倾向），帮助用户进一步确认","caveat":"不确定性与补充建议","disclaimer":"免责声明"}`;

function buildRectifyUser(input, ranked) {
  const rows = ranked.ranking.slice(0, 6).map((r, i) => {
    const ds = r.details.slice(0, 6).map((d) => `      - ${d.year} ${d.type}${d.note ? '（' + d.note + '）' : ''}：${d.score > 0 ? '+' : ''}${d.score} ${d.why}`).join('\n');
    return `  ${i + 1}. ${r.zhi}时（${r.hour}）得分 ${r.score}，命中 ${r.hits}/${ranked.events.length} 件事｜格局 ${r.geju}｜${r.strength}\n${ds}`;
  }).join('\n');
  const evs = input.events.map((e) => `  - ${e.year} 年 ${e.type}${e.note ? '（' + e.note + '）' : ''}`).join('\n');
  return `【已确定】年柱 ${input.year}｜月柱 ${input.month}｜日柱 ${input.day}｜出生公历年 ${input.birthYear || '未填'}｜${input.gender === '男' ? '乾造（男）' : '坤造（女）'}
【已知重大事件】
${evs}

【候选时辰与确定性打分（程序计算，按分数降序）】
${rows}

请据此判断最可能的时辰，并输出 JSON。`;
}

module.exports = {
  meihua, GUA64, XIANTIAN, TRIGRAM_WX, TRIGRAM_LINES,
  FACE_SYSTEM, FACE_VISION, PALM_SYSTEM, PALM_VISION,
  FENGSHUI_SYSTEM, FENGSHUI_VISION, ZIWEI_SYSTEM, ZIWEI_VISION, DIV_SYSTEM,
  buildFaceUser, buildPalmUser, buildFengshuiUser, buildZiweiUser, buildDivUser,
  RECTIFY_SYSTEM, buildRectifyUser, EVENT_NAMES,
};
