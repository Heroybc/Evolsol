/* 《衍时纪 · 朔望》—— 衍时纪（小丑牌式闯关）
 *
 * 单人 Roguelike：8 个大轮 × 3 关（小关 / 大关 / 劫），
 * 用「底分 × 倍率」撞开目标分，每过一关进商店，用金币买本局永久的构筑。
 *
 * 计分沿用本作的灵魂机制：**一手牌可以同时成立多种牌型**，
 * 成立的每一种牌型的「时值」进底分池、「运值」进倍率池。
 *   底分池：数字之和 + Σ时值 + Σ节令牌加底分        （全部相加）
 *   倍率池：(1 + Σ运值 + Σ节令牌加倍率) × Π节令牌乘倍率   （加法在一块、乘法在一块）
 *   总分 = floor(底分 × 倍率)
 *
 * 挂载到 window.Rogue；所有 FX 调用都判空，无 DOM 环境下静默降级。
 */
(function () {
  'use strict';
  const E = window.Engine;
  const DECKS = window.DECKS;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rnd = n => Math.floor(Math.random() * n);
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fx(name, arg) { if (window.FX) { try { window.FX.play(name, arg); } catch (e) { } } }
  function maxCount(pool) {
    const m = {};
    for (const d of pool.digits) if (!d.wild) m[d.v] = (m[d.v] || 0) + 1;
    let x = 0; for (const k in m) if (m[k] > x) x = m[k];
    return x;
  }
  function ach(evt) { if (window.Ach) { try { window.Ach.fire(evt); } catch (e) { } } }

  // ============================== 数值表 ==============================
  // 目标分曲线：每大轮整体 ×2.6，轮内 小关 → 大关 → 劫 再依次抬高（×1 / ×1.45 / ×1.75）。
  //
  // 整条曲线 = v2.0 曲线的 ×2.3。这个系数不是拍的，是 _tools/sim_jokers.js 扫出来的
  // （80 局 / 点，贪心机器人；模拟器不播种，所以每个点自带 ±0.3 关的抖动）：
  //     目标分 ×1.00（= v2.0 原表）　→ 平均通过 17.3 / 24 关（14/80 局走完）
  //     目标分 ×2.30（= 当前表）  　→  7.4 / 24 关（ 2/80 局走完）　← 取这一档
  //     目标分 ×4.00              　→  2.6 / 24 关（ 0/80 局走完）
  //   ⚠ 这三个点必须在**同一代商店**下横着比。早期那版扫出过「×1.00 → 13.6 / ×1.15 → 7.1」，
  //     那是「每个货架只保 1 个稀有位」之前的商品池；加了保底位（见 rollShop 的 MINR）之后
  //     机器人被喂强，低倍率端整体上移（×1.00 从 13.6 抬到 17.3），旧数不能混进这张表。
  //
  // 为什么是 ×2.3 而不是跟着稀有牌型一起涨 ×3.7：
  //   稀有牌型把**地基**抬高了 —— 空构筑、4 次出牌的中位分从 19,600 涨到约 7.3 万
  //   （真实口径是 best-of-56，见 sim_jokers.js §C），但同一批稀有牌型也喂强了节令牌
  //   （重楼 / 极数 / 周天 / 八音 / 问鼎，五张全挂平均每手约 ×20 倍率）。
  //   如果曲线按地基的涨幅走，等于把节令牌那份红利在起跑线上白送，
  //   前几关会变成一路平推，「构筑」这件事就没有意义了。
  //   最终定在 ×2.3：第 1 轮小关 23,000，而空构筑的 p10 就有 30,587 ——
  //   前期依然保留「稀有牌型一炸就过关」的爽感，真正的墙留在第 3-4 轮之后，交给构筑去解决。
  //
  // 校准用的机器人有两种买法，档位就取「不会玩的那种」，好让技术水平有地方体现：
  //   · 见便宜就买（贪心，优先高稀有度但金币一够就花）→ 平均约 7.4 / 24 关
  //   · 攒钱只买稀有 / 传说                        → 平均约 11.8 / 24 关
  // 第二种打法的构筑里塞的正是 v2.1 这批新令牌（重楼 / 极数 / 周天 / 八音 / 问鼎），
  // 也就是「看懂稀有牌型 → 攒钱买对应引擎」这条路是真的更强，而不是数值上等价。
  const TIER_TARGET = [
    [23000, 33000, 40000],
    [60000, 86000, 105000],
    [156000, 227000, 274000],
    [405000, 587000, 708000],
    [1051000, 1530000, 1840000],
    [2737000, 3968000, 4784000],
    [7107000, 10304000, 12443000],
    [18469000, 26772000, 32315000]
  ];
  const TIER_COIN = [32, 45, 60, 78, 100, 126, 158, 195];
  const BLIND_NAME = ['小关', '大关', '劫'];
  const BLIND_SUB = ['标准目标分', '目标分更高', 'Boss 关：附加一条限制'];
  const UP_MAX = 3;                       // 每种牌型最多强化 3 级
  const UP_TIME = 12, UP_MULT = 0.6;      // 每级加成

  // cost / sell 是买入与卖出价（会被优惠券的 priceMul 与劫·重税放大）；稀有度权重在 rollRarity 里按大轮动态算
  const RARITY = [
    { n: '普通', cost: 30, sell: 15 },
    { n: '罕见', cost: 50, sell: 25 },
    { n: '稀有', cost: 80, sell: 40 },
    { n: '传说', cost: 120, sell: 60 }
  ];

  /* ---------------- 节令牌（常驻被动，对标 Joker） ---------------- */
  const JOKERS = [
    // ── 普通：加法底分 / 经济 ──
    { id: 'guyu', n: '谷雨', s: '润物', r: 0, text: '每张打出的牌 +14 底分',
      onScore: c => c.addChips(14 * c.played.length, '谷雨') },
    { id: 'jingzhe', n: '惊蛰', s: '初动', r: 0, text: '每张打出的节气牌 +18 底分',
      onScore: c => c.addChips(18 * c.played.filter(x => x.type === '节气').length, '惊蛰') },
    { id: 'xiaoman', n: '小满', s: '未盈', r: 0, text: '每张留在手里的牌 +16 底分',
      onScore: c => c.addChips(16 * c.held.length, '小满') },
    { id: 'bailu', n: '白露', s: '凝霜', r: 0, text: '打出的牌每多 1 种季（花色），底分 +25',
      onScore: c => c.addChips(25 * new Set(c.played.map(x => x.season)).size, '白露') },
    { id: 'zishi', n: '子时', s: '交子', r: 0, text: '打出的牌含数字 0 → +90 底分',
      onScore: c => { if (c.played.some(x => x.digits.indexOf(0) >= 0)) c.addChips(90, '子时'); } },
    { id: 'dengshi', n: '元宵', s: '灯市', r: 0, text: '每通过一关额外 +12 金币',
      onClear: r => { r._bonus = (r._bonus || 0) + 12; } },
    { id: 'suanshou', n: '算筹', s: '聚财', r: 0, passive: { interestCap: 5 }, text: '利息上限 +5' },

    // ── 罕见：条件乘法 / 经济 ──
    { id: 'xiazhi', n: '夏至', s: '阳极', r: 1, text: '每次出牌，倍率 ×1.5',
      onScore: c => c.xMult(1.5, '夏至') },
    { id: 'tongqi', n: '同气', s: '连枝', r: 1, text: '打出的牌全属同一季 → 倍率 ×2',
      onScore: c => { if (new Set(c.played.map(x => x.season)).size === 1) c.xMult(2, '同气'); } },
    { id: 'duiying', n: '对影', s: '成双', r: 1, text: '每成立 1 种牌型 +3 倍率',
      onScore: c => c.addMult(3 * c.hands.length, '对影') },
    { id: 'xuguan', n: '序贯', s: '连珠', r: 1, text: '同时成立 ≥3 种牌型 → 倍率 ×2',
      onScore: c => { if (c.hands.length >= 3) c.xMult(2, '序贯'); } },
    { id: 'duanwu', n: '端午', s: '辟邪', r: 1, text: '每打出 1 张节日牌，倍率 ×1.6（可连乘）',
      onScore: c => { const n = c.played.filter(x => x.type === '节日').length; if (n) c.xMult(Math.pow(1.6, n), '端午'); } },
    { id: 'chongshu', n: '重数', s: '叠影', r: 1, text: '打出的数字里，某个数字出现 ≥3 次 → 倍率 ×2',
      onScore: c => { if (maxCount(c.pool) >= 3) c.xMult(2, '重数'); } },
    { id: 'shuowang', n: '朔望', s: '盈虚', r: 1, text: '本关第 4 次出牌起，倍率 ×2.5',
      onScore: c => { if (c.blind.playsUsed >= 4) c.xMult(2.5, '朔望'); } },
    { id: 'shiji', n: '市集', s: '丰穰', r: 1, text: '每通过一关额外 +20 金币',
      onClear: r => { r._bonus = (r._bonus || 0) + 20; } },

    // ── 稀有：成型流派 ──
    { id: 'sishi', n: '四时', s: '流转', r: 2, text: '打出的牌含 3 种季 → 倍率 ×3',
      onScore: c => { if (new Set(c.played.map(x => x.season)).size >= 3) c.xMult(3, '四时'); } },
    { id: 'wuqi', n: '五气', s: '朝元', r: 2, text: '同时成立 ≥5 种牌型 → 倍率 ×3',
      onScore: c => { if (c.hands.length >= 5) c.xMult(3, '五气'); } },
    { id: 'lianhuan', n: '连环', s: '节气', r: 2, text: '成立顺子 → 倍率 ×4',
      onScore: c => { if (c.hands.indexOf('顺子') >= 0) c.xMult(4, '连环'); } },
    { id: 'yise', n: '一色', s: '同花', r: 2, text: '成立同花 → 倍率 ×4',
      onScore: c => { if (c.hands.indexOf('同花') >= 0) c.xMult(4, '一色'); } },
    { id: 'diecui', n: '叠翠', s: '葫芦', r: 2, text: '成立葫芦 / 四条 / 同花顺 → 倍率 ×3.5',
      onScore: c => { if (c.hands.some(h => ['葫芦', '四条', '同花顺'].indexOf(h) >= 0)) c.xMult(3.5, '叠翠'); } },
    { id: 'yingyue', n: '盈月', s: '将满', r: 2, text: '本关分数过半后，再出牌倍率 ×2.5',
      onScore: c => { if (c.blind.score >= c.blind.target / 2) c.xMult(2.5, '盈月'); } },

    // ── v2.1 稀有：稀有牌型专属引擎（全套都在乘区，专门吃「疯狂翻倍」）──
    // 这几张的设计前提：稀有牌型会「一族连档」同时成立（九同成立时八同、七同也成立），
    // 所以只要按档位连乘，一手就能翻出三位数的倍率。触发率见 assets/engine.js 顶部的实测表。
    { id: 'chonglou', n: '重楼', s: '叠嶂', r: 2, text: '七同 ×3、八同 ×9、九同 ×27（同族一起成立时连乘）',
      onScore: c => { const n = E.rareOf(c.hands).filter(h => h.charAt(h.length - 1) === '同').length; if (n) c.xMult(Math.pow(3, n), '重楼'); } },
    { id: 'jishu', n: '极数', s: '穷极', r: 2, text: '每成立 1 种稀有牌型，倍率 ×2（可连乘）',
      onScore: c => { const n = E.rareOf(c.hands).length; if (n) c.xMult(Math.pow(2, n), '极数'); } },
    { id: 'zhoutian', n: '周天', s: '周流', r: 2, text: '打出的数字覆盖 ≥10 种 → 倍率 ×8',
      onScore: c => { if (E.poolDistinct(c.pool) >= 10) c.xMult(8, '周天'); } },
    { id: 'bayin', n: '八音', s: '克谐', r: 2, text: '同时成立 ≥10 种牌型 → 倍率 ×5',
      onScore: c => { if (c.hands.length >= 10) c.xMult(5, '八音'); } },

    // ── 传说：自带代价的引擎 ──
    { id: 'taiyi', n: '太一', s: '衍时', r: 3, text: '本局每出过 1 次牌，倍率 +0.25（累积）',
      onScore: c => c.addMult(0.25 * c.run.playsTotal, '太一') },
    { id: 'lunhui', n: '轮回', s: '不息', r: 3, text: '每过 1 关，倍率 ×1.15（可连乘累积）',
      onScore: c => c.xMult(Math.pow(1.15, c.run.blindsCleared), '轮回') },
    { id: 'qiongqi', n: '穷奇', s: '暴食', r: 3, flag: { playsMinus: 1 }, text: '倍率 ×2.5；代价：每关少 1 次出牌',
      onScore: c => c.xMult(2.5, '穷奇') },
    { id: 'tianji', n: '天机', s: '机变', r: 3, text: '每多带 1 张其他节令牌，倍率 +1.3',
      onScore: c => c.addMult(1.3 * Math.max(0, c.run.jokers.length - 1), '天机') },
    // v2.1 传说 · 吃「多牌型同时成立」这条本作灵魂机制的彩票：
    // 单次达成率（实测）≥10 种 31.5% / ≥11 种 11.9% / ≥12 种 3.6% / ≥13 种 0.85%。
    // 所以做成阶梯连乘，平时是「每三次一手」，一旦牌型堆到 13 种就是 ×48。
    { id: 'wending', n: '问鼎', s: '逐鹿', r: 3, text: '同时成立 ≥10 种牌型 → 倍率 ×12；每多 1 种再 ×2（连乘）',
      onScore: c => { const n = c.hands.length; if (n >= 10) c.xMult(12 * Math.pow(2, n - 10), '问鼎'); } }
  ];

  /* ---------------- 符箓（一次性道具） ---------------- */
  const TALISMANS = [
    { id: 'huanri', n: '换日', s: '洗牌', cost: 12, text: '手牌全部弃掉，重新摸等量',
      use: () => { const n = B.hand.length; B.hand = []; B.sel = []; fill(n); } },
    { id: 'chouqian', n: '抽签', s: '补手', cost: 10, text: '把手牌补到上限',
      use: () => { fill(B.handMax - B.hand.length); } },
    { id: 'shiqian', n: '时迁', s: '借时', cost: 18, text: '本关出牌次数 +1',
      use: () => { B.playsLeft++; } },
    { id: 'xirang', n: '息壤', s: '缓行', cost: 14, text: '本关弃牌次数 +2',
      use: () => { B.discardsLeft += 2; } },
    { id: 'dianjin', n: '点金', s: '生财', cost: 10, text: '立刻 +10 金币',
      use: () => { R.coins += 10; } },
    { id: 'cuili', n: '淬砺', s: '锋锐', cost: 16, text: '本关所有底分 +120',
      use: () => { B.chipBuff += 120; } },
    { id: 'beizhi', n: '倍之', s: '叠运', cost: 20, text: '本关倍率 ×1.5',
      use: () => { B.multBuff *= 1.5; } },
    { id: 'zeji', n: '择吉', s: '趋避', cost: 22, text: '本关目标分降低 25%',
      use: () => { B.target = Math.round(B.target * 0.75); } }
  ];

  /* ---------------- 优惠券（本局永久升级，每种限一次） ---------------- */
  const VOUCHERS = [
    { id: 'jieling', n: '节令', cost: 60, text: '节令牌携带上限 +1', apply: r => { r.jokerMax++; } },
    { id: 'yuyu', n: '余裕', cost: 55, text: '每关出牌次数 +1', apply: r => { r.playsMax++; } },
    { id: 'satuo', n: '洒脱', cost: 45, text: '每关弃牌次数 +1', apply: r => { r.discardsMax++; } },
    { id: 'fengnian', n: '丰年', cost: 40, text: '利息上限 +5', apply: r => { r.interestCap += 5; } },
    { id: 'chonglai', n: '重来', cost: 35, text: '商店刷新费用降为 2 金币', apply: r => { r.rerollCost = 2; } },
    { id: 'xianji', n: '先机', cost: 50, text: '手牌上限 +1', apply: r => { r.handMax++; } }
  ];

  /* ---------------- 劫（Boss 负面，第 n 大轮的劫固定用第 n 条） ----------------
   * 顺序即强度梯度：从「只影响下一家商店」一直到「全局倍率 ×0.7」。
   * 第 1 轮的劫刻意选了最轻的一条 —— 新手刚上手时不该被负面规则卡死。
   */
  const NEGS = [
    { n: '重税', text: '下一家商店涨价 20%', apply: b => { b.priceUp = true; } },
    { n: '形散', text: '对子与两对不再提供倍率', flag: { noPairMult: true } },
    { n: '局窄', text: '本关手牌上限 -2', apply: b => { b.handMax -= 2; } },
    { n: '路狭', text: '弃牌次数 -1', apply: b => { b.discardsLeft = Math.max(0, b.discardsLeft - 1); } },
    { n: '钝锋', text: '所有加法底分（来自节令牌与遗物）减半', flag: { halfChip: true } },
    { n: '枯竭', text: '弃牌不再补牌', flag: { noRedraw: true } },
    { n: '时促', text: '出牌次数 -1', apply: b => { b.playsLeft = Math.max(1, b.playsLeft - 1); } },
    { n: '天倾', text: '全局倍率 ×0.7', flag: { x07: true } }
  ];

  /* ---------------- 遗物（打完劫之后三选一，最多 4 件） ---------------- */
  const RELICS = [
    { id: 'guibiao', n: '圭表', text: '每关开局多 1 次弃牌', apply: r => { r.discardsMax++; } },
    { id: 'tonghu', n: '铜壶', text: '每通过一关额外 +8 金币', onClear: r => { r._bonus = (r._bonus || 0) + 8; } },
    { id: 'yuheng', n: '玉衡', text: '每张打出的牌 +5 底分', onScore: c => c.addChips(5 * c.played.length, '玉衡') },
    { id: 'jinfan', n: '金乌', text: '每次出牌固定 +0.6 倍率', onScore: c => c.addMult(0.6, '金乌') },
    { id: 'yuejing', n: '月精', text: '手牌上限 +1', apply: r => { r.handMax++; } },
    { id: 'xuangui', n: '玄圭', text: '商店所有商品 9 折', apply: r => { r.priceMul = Math.round(r.priceMul * 90) / 100; } },
    { id: 'suanchou', n: '算筹', text: '利息上限 +3', apply: r => { r.interestCap += 3; } },
    { id: 'putuan', n: '蒲团', text: '每关出牌次数 +1', apply: r => { r.playsMax++; } }
  ];

  // ============================== 状态 ==============================
  let R = null;          // 本局
  let B = null;          // 本关
  let cb = {};           // 回调
  let SHOP = null;       // 当前商店（跨关保留货架）
  let panelKind = null;  // 当前浮层类型
  let freshFrom = -1;    // 本次待渲染的「新摸到的牌」起始下标（-1 = 无）
  let liftAt = -1;       // 刚被选中的那张（渲染时弹一下）

  function jokerById(id) { for (const j of JOKERS) if (j.id === id) return j; return null; }
  function relicById(id) { for (const r of RELICS) if (r.id === id) return r; return null; }
  function voucherById(id) { for (const v of VOUCHERS) if (v.id === id) return v; return null; }

  function passiveSum(key) {
    let s = 0;
    for (const j of R.jokers) if (j.def.passive && j.def.passive[key]) s += j.def.passive[key];
    return s;
  }
  function flagOf(key) {
    let v = 0;
    for (const j of R.jokers) if (j.def.flag && j.def.flag[key]) v += j.def.flag[key];
    return v;
  }
  function interestCap() { return R.interestCap + passiveSum('interestCap'); }
  function priceUpNow() { return R.priceUpNext ? 1.2 : 1; }
  function jokerCost(def) { return Math.max(1, Math.round(RARITY[def.r].cost * R.priceMul * priceUpNow())); }
  function scaleCost(base) { return Math.max(1, Math.round(base * R.priceMul * priceUpNow())); }
  function curTarget() { return (B ? B.target : TIER_TARGET[R.tier][R.blind]); }

  // ============================== 计分 ==============================
  function handTime(name) { return E.SCORE_TABLE[name].time + UP_TIME * (R.up[name] || 0); }
  function handMult(name) { return E.SCORE_TABLE[name].mult + UP_MULT * (R.up[name] || 0); }

  /** 打出 played（1–5 张），held 是留在手里的牌 */
  function scoreOf(played, held) {
    const pool = E.buildPool(played, 2);
    const hands = E.detectHands(pool);
    let digitSum = 0;
    for (const d of pool.digits) if (!d.wild) digitSum += d.v;

    const neg = (B && B.neg && B.neg.flag) ? B.neg.flag : {};
    let baseChips = digitSum;
    let baseMult = 1;
    const log = [{ k: 'chip', label: '数字之和', v: digitSum }];
    for (const h of hands) {
      const t = handTime(h), m = handMult(h);
      baseChips += t;
      log.push({ k: 'chip', label: h, v: t });
      if (!(neg.noPairMult && (h === '一对' || h === '两对'))) {
        baseMult += m;
        log.push({ k: 'mult', label: h, v: m });
      }
    }
    if (hands.length === 0) log.push({ k: 'note', label: '没有成立任何牌型', v: '' });

    const ctx = {
      played: played, held: held, pool: pool, hands: hands,
      blind: B, run: R, neg: neg,
      baseChips: baseChips, chips: baseChips, mult: baseMult, xmult: 1,
      log: log, _once: {},
      addChips: (v, label) => { if (!v) return; ctx.chips += v; log.push({ k: 'chip', label: label, v: v }); },
      addMult: (v, label) => { if (!v) return; ctx.mult += v; log.push({ k: 'mult', label: label, v: v }); },
      xMult: (v, label) => { ctx.xmult *= v; log.push({ k: 'x', label: label, v: v }); }
    };

    for (const j of R.jokers) if (j.def.onScore) j.def.onScore(ctx);
    for (const rel of R.relics) if (rel.onScore) rel.onScore(ctx);

    if (neg.halfChip) {
      const extra = ctx.chips - ctx.baseChips;
      ctx.chips = ctx.baseChips + Math.floor(extra / 2);
      log.push({ k: 'note', label: '劫 · 钝锋：加法底分减半', v: '' });
    }
    if (neg.x07) { ctx.xmult *= 0.7; log.push({ k: 'x', label: '劫 · 天倾', v: 0.7 }); }

    ctx.chips += B.chipBuff;
    if (B.chipBuff) log.push({ k: 'chip', label: '符箓', v: B.chipBuff });
    if (B.multBuff !== 1) { ctx.xmult *= B.multBuff; log.push({ k: 'x', label: '符箓 · 倍之', v: B.multBuff }); }

    const score = Math.floor(ctx.chips * ctx.mult * ctx.xmult);
    return { chips: ctx.chips, mult: ctx.mult, xmult: ctx.xmult, score: score, hands: hands, log: log };
  }

  /** 穷举出「分数最高的那一组 5 张」。
   *  界面上已经不再提供「提示最优」按钮 —— 找最好的一手是这个模式的核心乐趣。
   *  这里保留实现，供无头测试逐组校验 scoreOf 的正确性、以及测试机器人选牌用。 */
  function bestCombo(hand) {
    const n = hand.length;
    if (!n) return null;
    let best = null;
    const k = Math.min(5, n);
    const pick = (start, acc) => {
      if (acc.length === k) {
        const r = scoreOf(acc.map(i => hand[i]), []);
        if (!best || r.score > best.r.score) best = { idx: acc.slice(), r: r };
        return;
      }
      for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop(); }
    };
    pick(0, []);
    return best;
  }

  // ============================== 本关 ==============================
  function buildDeck() {
    return shuffle(DECKS.mode2.map((c, i) => Object.assign({}, c, { uid: 'r-' + c.name + '-' + i })));
  }
  function fill(n) {
    const at = B.hand.length;
    while (n-- > 0 && B.hand.length < B.handMax) {
      if (B.ptr >= B.deck.length) { B.ptr = 0; B.deck = buildDeck(); }
      B.hand.push(B.deck[B.ptr++]);
    }
    if (B.hand.length > at) freshFrom = at;   // 记下新摸到的牌，渲染时做发牌动画
  }

  function beginBlind(keep) {
    const neg = R.blind === 2 ? NEGS[R.tier] : null;
    B = {
      tier: R.tier, blind: R.blind,
      target: TIER_TARGET[R.tier][R.blind],
      deck: buildDeck(), ptr: 0, hand: [], sel: [],
      handMax: R.handMax, playsLeft: R.playsMax, discardsLeft: R.discardsMax,
      score: 0, playsUsed: 0, chipBuff: 0, multBuff: 1, priceUp: false,
      locked: false,
      neg: neg, log: []
    };
    if (neg && neg.apply) neg.apply(B);
    B.playsLeft = Math.max(1, B.playsLeft - flagOf('playsMinus'));
    if (B.handMax < 5) B.handMax = 5;
    fill(B.handMax);
    if (!keep) {
      fx('deal');
      if (neg) fx('phase');
    }
    render();
    if (!keep) renderLog(neg
      ? '本关是 <b>Boss 关（劫）</b>，附加限制：<b>' + esc(neg.text) + '</b>。目标 ' + nfmt(B.target) + ' 分。'
      : '目标 ' + nfmt(B.target) + ' 分：在 ' + B.playsLeft + ' 次出牌内打够就过关。');
  }

  function nfmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /** 出牌 / 弃牌的动作：把选中的牌甩出去，并在手牌区中央炸一圈金环。
   *  返回 true 表示「动画已接管时序」，调用方应把补牌与重绘延后到 settle 里；
   *  在拿不到真实尺寸的环境（无头测试桩）下返回 false，调用方走原来的同步路径。 */
  function throwOut(els, box, kind) {
    if (!els.length || !box) return false;
    let ok = false;
    try { const r = els[0].getBoundingClientRect(); ok = !!(r && r.width > 0 && r.height > 0); }
    catch (e) { ok = false; }
    if (!ok) return false;
    const cls = kind === 'down' ? ' out-down' : ' out';
    for (let i = 0; i < els.length; i++) {
      els[i].className += cls;
      els[i].style.animationDelay = (i * 36) + 'ms';
    }
    if (kind !== 'down' && box.appendChild) {
      const burst = document.createElement('div');
      burst.className = 'r-burst';
      box.appendChild(burst);
      setTimeout(function () {
        if (burst.parentNode && burst.parentNode.removeChild) burst.parentNode.removeChild(burst);
      }, 760);
    }
    if (window.FX) { try { FX.shake(box); } catch (e) { } }
    return true;
  }

  /** 按选中下标取出手牌区的牌元素（动画要在手牌被重建之前抓） */
  function pickCardEls(sel) {
    const box = $('rHand'), out = [];
    if (!box || !box.children) return out;
    for (const i of sel) if (box.children[i]) out.push(box.children[i]);
    return out;
  }

  function playCards() {
    if (!B || B.done || B.locked) return;
    const sel = B.sel.slice().sort((a, b) => a - b);
    if (!sel.length || sel.length > 5) { renderLog('请选 1–5 张牌再打出。'); return; }
    const played = sel.map(i => B.hand[i]);
    const held = B.hand.filter((c, i) => sel.indexOf(i) < 0);
    B.playsUsed++;
    R.playsTotal++;

    const res = scoreOf(played, held);
    B.score += res.score;
    if (res.score > R.bestPlay) R.bestPlay = res.score;
    R.totalScore += res.score;

    // 先抓元素、起动画，再改状态
    const cardEls = pickCardEls(sel);
    const anim = throwOut(cardEls, $('rHand'), 'out');

    // 状态同步更新 —— 即使动画还没结束，连点也不会重复出牌
    B.hand = held;
    B.sel = [];
    B.playsLeft--;

    const handsTxt = res.hands.length ? res.hands.join(' · ') : '散牌';
    fx('showdown');
    if (res.hands.length >= 4) fx('combo', res.hands.length);
    if (window.FX && cardEls.length) {
      try { FX.floatTextAt(cardEls[0], '+' + nfmt(res.score), 'gold'); } catch (e) { }
    }
    renderResult(res, handsTxt);
    ach({ type: 'roguePlay', score: res.score, hands: res.hands });

    const settle = function () {
      B.locked = false;
      render();
      fx('coin');
      if (B.score >= B.target) setTimeout(clearBlind, 620);
      else if (B.playsLeft <= 0) setTimeout(fail, 700);
      else { fill(B.handMax - B.hand.length); render(); }
    };
    if (anim) { B.locked = true; setTimeout(settle, 430); }
    else settle();
  }

  function discardCards() {
    if (!B || B.done || B.locked) return;
    const sel = B.sel.slice().sort((a, b) => a - b);
    if (!sel.length || sel.length > 5) { renderLog('请选 1–5 张牌再弃掉。'); return; }
    if (B.discardsLeft <= 0) return;
    B.discardsLeft--;
    const cardEls = pickCardEls(sel);
    const anim = throwOut(cardEls, $('rHand'), 'down');
    B.hand = B.hand.filter((c, i) => sel.indexOf(i) < 0);
    B.sel = [];
    fx('fold');
    const noRedraw = !!(B.neg && B.neg.flag && B.neg.flag.noRedraw);
    const settle = function () {
      B.locked = false;
      if (!noRedraw) fill(B.handMax - B.hand.length);
      render();
      renderLog('弃掉 ' + sel.length + ' 张牌' + (noRedraw ? '（劫 · 枯竭：不再补牌）' : '，重新摸牌。'));
    };
    if (anim) { B.locked = true; setTimeout(settle, 360); }
    else settle();
  }

  function toggleSel(i) {
    if (!B || B.done || B.locked) return;
    const at = B.sel.indexOf(i);
    if (at >= 0) B.sel.splice(at, 1);
    else if (B.sel.length < 5) { B.sel.push(i); fx('click'); liftAt = i; }
    else { renderLog('一次最多打 5 张。'); return; }
    render();
  }

  function clearBlind() {
    if (!B || B.done) return;
    B.done = true;
    const overflow = Math.max(0, B.score - B.target);
    const base = TIER_COIN[R.tier];
    const bonus = R._bonus || 0;
    const interest = Math.min(interestCap(), Math.floor(R.coins / 5));
    const over = Math.min(8, Math.floor(overflow / Math.max(1, B.target) * 2.5));
    const total = base + bonus + interest + over;
    R.coins += total;
    R.blindsCleared++;
    R.priceUpNext = !!B.priceUp;      // 劫 · 重税 只影响紧接的这一家商店
    for (const j of R.jokers) if (j.def.onClear) j.def.onClear(R);
    for (const rel of R.relics) if (rel.onClear) rel.onClear(R);
    R._bonus = 0;
    fx('win'); if (window.FX) { try { FX.confetti(50); FX.flash('gold'); } catch (e) { } }
    ach({ type: 'rogueBlind', tier: R.tier, blind: R.blind, score: B.score, coins: R.coins });

    const isLast = (R.tier === TIER_TARGET.length - 1 && R.blind === 2);
    if (isLast) { endRun(true); return; }
    if (R.blind === 2) { relicChoice(); return; }   // 破劫之后先选遗物，tier 在 afterRelic 里推进
    R.blind++;
    panel('第 ' + (R.tier + 1) + ' 大轮 · ' + BLIND_NAME[R.blind - 1] + ' 通过',
      '<div class="r-res">' +
      '<p>本关得分 <b>' + nfmt(B.score) + '</b> / 目标 ' + nfmt(B.target) + '</p>' +
      '<ul class="rul">' +
      '<li>通关金币 <b>+' + base + '</b></li>' +
      (bonus ? '<li>节令牌与遗物 <b>+' + bonus + '</b></li>' : '') +
      '<li>利息（每 5 金币 +1，上限 ' + interestCap() + '）<b>+' + interest + '</b></li>' +
      '<li>超额奖励 <b>+' + over + '</b></li>' +
      '</ul><p class="r-big">共得 <b>' + total + '</b> 金币　·　现有 <b>' + R.coins + '</b></p></div>',
      [{ t: '进入商店', cls: 'primary', fn: openShop }]);
  }

  function fail() {
    B.done = true;
    fx('lose'); fx('bust');
    endRun(false);
  }

  function endRun(win) {
    R.over = true; R.win = !!win;
    fx(win ? 'win' : 'lose');
    if (window.FX) { try { FX.confetti(win ? 140 : 0); FX.flash(win ? 'gold' : 'red'); } catch (e) { } }
    ach({ type: 'rogueEnd', tier: R.tier, blind: R.blind, coins: R.coins, win: !!win, score: R.totalScore });
    const tier = win ? TIER_TARGET.length : R.tier + 1;
    panel(win ? '破局 · 走完了整个衍时纪' : '止步 · 第 ' + tier + ' 大轮',
      '<div class="r-res">' +
      '<p>' + (win ? '八轮二十四关，你全部通关了。' : '没打到目标分，这一局到此为止。') + '</p>' +
      '<ul class="rul">' +
      '<li>抵达 <b>第 ' + tier + ' 大轮 · ' + BLIND_NAME[R.blind] + '</b></li>' +
      '<li>累计得分 <b>' + nfmt(R.totalScore) + '</b>，单次最高 <b>' + nfmt(R.bestPlay) + '</b></li>' +
      '<li>剩余金币 <b>' + R.coins + '</b>，节令牌 <b>' + R.jokers.length + '</b> 张</li>' +
      '<li>通过关卡 <b>' + R.blindsCleared + '</b> / 24</li>' +
      '</ul><p class="tiny">最终成绩按剩余金币计入排行榜（和另外三个模式同一个榜）。</p></div>',
      [{ t: '再来一局', cls: 'primary', fn: function () { closePanel(); start(cb); } },
       { t: '返回菜单', cls: 'ghost', fn: function () { closePanel(); if (cb.onExit) cb.onExit(); } }]);
  }

  // ============================== 商店 ==============================
  // 稀有度权重随大轮推进向高稀有度倾斜。
  // v2.1 把「稀有」的底子抬了一截（15% / 5% 起步，到第 8 轮 32% / 12%）——
  // 因为稀有牌型把稀有节令牌做成了真正的构筑核心，如果它们只能靠 12%×1/3 的运气撞见，
  // 那这 10 张牌在实战里等于不存在（同一台机器人 60 局只摸到 4 次；加了货位保底后是 14 次）。
  function rollRarity() {
    const t = R.tier;
    const w = [Math.max(12, 52 - t * 5), 28 + t * 1.5, 15 + t * 2.5, 5 + t * 1];
    const sum = w[0] + w[1] + w[2] + w[3];
    let x = Math.random() * sum;
    for (let i = 0; i < 4; i++) { x -= w[i]; if (x <= 0) return i; }
    return 0;
  }
  function rollJoker(minR) {
    for (let g = 0; g < 60; g++) {
      const r = Math.max(minR || 0, rollRarity());
      const pool = JOKERS.filter(j => j.r === r && !R.jokers.some(o => o.def.id === j.id));
      if (pool.length) return pool[rnd(pool.length)];
    }
    const any = JOKERS.filter(j => !R.jokers.some(o => o.def.id === j.id));
    return any.length ? any[rnd(any.length)] : null;
  }
  function rollShop() {
    const stock = { jokers: [], talismans: [], voucher: null, upgrades: [] };
    // 三个货位的保底稀有度：普通 / 罕见+ / 稀有+
    // 也就是**每一家商店都保证有一张稀有或传说**。这是「疯狂翻倍」能被玩到的前提 ——
    // 玩家得先看得见，才谈得上围绕它构筑。价格仍然是 80 / 120，所以前期只能看着眼馋，
    // 中期攒够金币才能拿下，正好是一个有牵引力的目标位。
    const MINR = [0, 1, 2];
    for (let i = 0; i < 3; i++) { const j = rollJoker(MINR[i]); if (j) stock.jokers.push(j); }
    const ts = TALISMANS.slice();
    for (let i = 0; i < 2 && ts.length; i++) stock.talismans.push(ts.splice(rnd(ts.length), 1)[0]);
    const vs = VOUCHERS.filter(v => R.vouchers.indexOf(v.id) < 0);
    if (vs.length) stock.voucher = vs[rnd(vs.length)];
    // 牌型强化只卖古典牌型：稀有牌型本来就自带很高的时值 / 运值，
    // 再强化一级（+12 / +0.6）几乎没有意义；更要紧的是如果把稀有档也放进来，
    // 强化池会从 9 种膨胀到 19 种，玩家想走「只堆顺子」这种单点路线会变得很难刷到。
    const types = upgradableTypes();
    for (let i = 0; i < 2 && types.length; i++) stock.upgrades.push(types.splice(rnd(types.length), 1)[0]);
    SHOP = stock;
  }

  function openShop() {
    if (!SHOP) rollShop();
    panelKind = 'shop';
    renderShop();
  }

  function upCost(name) { return scaleCost(40 + 25 * (R.up[name] || 0)); }

  /** 还能被强化的牌型：只含古典牌型，且没满级、没摆在当前货架上 */
  function upgradableTypes(alsoExclude) {
    return E.POKER_ORDER.filter(function (h) {
      if (E.RARE_HANDS.indexOf(h) >= 0) return false;
      if ((R.up[h] || 0) >= UP_MAX) return false;
      if (alsoExclude && alsoExclude.indexOf(h) >= 0) return false;
      return true;
    });
  }

  function buyJoker(i) {
    const def = SHOP.jokers[i];
    if (!def) return;
    if (R.jokers.length >= R.jokerMax) { renderLog('节令牌已经带满（上限 ' + R.jokerMax + ' 张），先卖掉一张。'); return; }
    const cost = jokerCost(def);
    if (R.coins < cost) { renderLog('金币不够（需要 ' + cost + '）。'); return; }
    R.coins -= cost;
    R.jokers.push({ def: def, cost: cost });
    SHOP.jokers[i] = null;
    fx('coin');
    ach({ type: 'rogueShop', jokers: R.jokers.length, coins: R.coins });
    renderShop(); render();
  }
  function sellJoker(i) {
    const j = R.jokers[i];
    if (!j) return;
    R.coins += RARITY[j.def.r].sell;
    R.jokers.splice(i, 1);
    fx('fold');
    renderShop(); render();
  }
  function buyTalisman(i) {
    const t = SHOP.talismans[i];
    if (!t) return;
    const cost = scaleCost(t.cost);
    if (R.coins < cost) { renderLog('金币不够（需要 ' + cost + '）。'); return; }
    if (!B) return;
    R.coins -= cost;
    SHOP.talismans[i] = null;
    t.use();
    fx('coin');
    renderLog('用掉符箓「' + t.n + ' · ' + t.s + '」。');
    renderShop(); render();
  }
  function buyVoucher() {
    const v = SHOP.voucher;
    if (!v) return;
    const cost = scaleCost(v.cost);
    if (R.coins < cost) { renderLog('金币不够（需要 ' + cost + '）。'); return; }
    R.coins -= cost;
    R.vouchers.push(v.id);
    v.apply(R);
    SHOP.voucher = null;
    fx('achieve');
    renderLog('买下优惠券「' + v.n + '」：' + v.text);
    renderShop(); render();
  }
  function buyUpgrade(name) {
    const lv = R.up[name] || 0;
    if (lv >= UP_MAX) return;
    const cost = upCost(name);
    if (R.coins < cost) { renderLog('金币不够（需要 ' + cost + '）。'); return; }
    R.coins -= cost;
    R.up[name] = lv + 1;
    SHOP.upgrades = SHOP.upgrades.filter(x => x !== name);
    const types = upgradableTypes(SHOP.upgrades);
    if (types.length) SHOP.upgrades.push(types[rnd(types.length)]);
    fx('achieve');
    renderShop(); render();
  }
  function rerollShop() {
    if (R.coins < R.rerollCost) { renderLog('刷新需要 ' + R.rerollCost + ' 金币。'); return; }
    R.coins -= R.rerollCost;
    fx('deal');
    rollShop();
    renderShop(); render();
  }
  function leaveShop() {
    SHOP = null;
    R.priceUpNext = false;
    closePanel();
    nextBlindSelect();
  }

  // ============================== 关卡推进 ==============================
  function nextBlindSelect() {
    const t = R.tier, b = R.blind;
    panel('第 ' + (t + 1) + ' 大轮 · ' + BLIND_NAME[b],
      '<div class="r-res">' +
      '<p class="r-target-line">目标分 <b>' + nfmt(TIER_TARGET[t][b]) + '</b>　·　' + BLIND_SUB[b] + '</p>' +
      (b === 2 ? '<p class="r-neg">劫 · <b>' + NEGS[t].n + '</b>：' + NEGS[t].text + '</p>'
        : '<p class="tiny">通过后发 ' + TIER_COIN[t] + ' 金币，可以进商店购物。</p>') +
      '</div>',
      [{ t: '开始这一关', cls: 'primary', fn: function () { closePanel(); beginBlind(false); } },
       b !== 2 ? { t: '跳过（不要金币，换 1 个符箓）', cls: 'ghost', fn: skipBlind } : null].filter(Boolean));
  }

  function skipBlind() {
    if (R.blind === 2) return;
    const t = TALISMANS[rnd(TALISMANS.length)];
    // 跳过的奖励：直接拿到一个符箓的效果（当作立刻用掉）
    closePanel();
    R.blind++;
    beginBlind(false);
    panel('跳过 ' + BLIND_NAME[R.blind - 1],
      '<p>你绕过了这一关，没有金币入账，但从时间缝里摸到一张符箓：<b>' + t.n + ' · ' + t.s + '</b> —— ' + t.text + '</p>',
      [{ t: '用掉它', cls: 'primary', fn: function () { t.use(); closePanel(); render(); } },
       { t: '收着（换成 8 金币）', cls: 'ghost', fn: function () { R.coins += 8; closePanel(); render(); } }]);
  }

  function relicChoice() {
    const pool = RELICS.filter(r => !R.relics.some(o => o.id === r.id));
    if (!pool.length || R.relics.length >= 4) { afterRelic(); return; }
    const three = [];
    for (let i = 0; i < 3 && pool.length; i++) three.push(pool.splice(rnd(pool.length), 1)[0]);
    const btns = three.map(r => ({
      t: r.n + '：' + r.text, cls: 'primary',
      fn: function () { R.relics.push(r); if (r.apply) r.apply(R); fx('achieve'); closePanel(); afterRelic(); }
    }));
    btns.push({ t: '都不要', cls: 'ghost', fn: function () { closePanel(); afterRelic(); } });
    panel('劫已破 · 收一件遗物', '<p class="tiny">遗物是全局被动，最多同时带 4 件。</p>', btns);
  }
  function afterRelic() {
    panel('第 ' + (R.tier + 1) + ' 大轮走完',
      '<div class="r-res"><p>整轮的三关都过了。进入下一轮之前，先到商店把金币花一花。</p>' +
      '<p class="tiny">下一轮的目标分会整体抬高，记得用金币升级节令牌。</p></div>',
      [{ t: '进入商店', cls: 'primary', fn: function () { R.tier++; R.blind = 0; openShop(); } }]);
  }

  // ============================== 渲染 ==============================
  function showRogue() {
    if ($('menu')) $('menu').style.display = 'none';
    if ($('table')) $('table').style.display = 'none';
    if ($('rogue')) $('rogue').style.display = 'block';
    document.body.className = (document.body.className || '').replace(/phase-\w+/g, '').replace(/\s+/g, ' ').trim();
  }

  function cardEl(card, opts) {
    opts = opts || {};
    const d = document.createElement('div');
    d.className = 'card ' + seasonCls(card.season) + (card.type === '节日' ? ' festival' : '') +
      (opts.sel ? ' sel' : '') + (opts.small ? ' small' : '');
    d.innerHTML =
      '<div class="c-head">' + esc(card.name) + '</div>' +
      '<div class="c-order">' + (card.order ? esc(card.season) + card.order : '彩') + '</div>' +
      '<div class="c-date">' + esc(card.sub) + '</div>' +
      '<div class="c-digits">' + card.digits.join('·') + '</div>' +
      '<div class="c-point">日点 ' + card.dayPoint + '</div>';
    return d;
  }
  function seasonCls(s) { return { '春': 's-spring', '夏': 's-summer', '秋': 's-autumn', '冬': 's-winter' }[s] || ''; }

  function renderHud() {
    const p = $('rProgress'), t = $('rTarget'), c = $('rCoins');
    if (p) p.textContent = '第 ' + (R.tier + 1) + ' 大轮 / ' + TIER_TARGET.length + '　·　' + (B ? BLIND_NAME[B.blind] : '');
    if (t) t.innerHTML = B ? ('得分 ' + nfmt(B.score) + ' / 目标 ' + nfmt(B.target)) : '';
    if (c) c.innerHTML = '🪙 ' + R.coins;
  }

  function renderJokers() {
    const box = $('rJokers');
    if (!box) return;
    box.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'r-jk-title';
    title.textContent = '节令牌 ' + R.jokers.length + ' / ' + R.jokerMax;
    box.appendChild(title);
    const row = document.createElement('div');
    row.className = 'r-jk-row';
    for (let i = 0; i < R.jokerMax; i++) {
      const j = R.jokers[i];
      const el = document.createElement('div');
      if (!j) { el.className = 'joker empty'; el.textContent = '空'; }
      else {
        el.className = 'joker r' + j.def.r;
        el.innerHTML = '<div class="jk-n">' + esc(j.def.n) + '</div>' +
          '<div class="jk-s">' + esc(j.def.s) + '</div>' +
          '<div class="jk-t">' + esc(j.def.text) + '</div>';
        el.title = j.def.n + ' · ' + j.def.s + '　' + j.def.text;
      }
      el.onclick = function () { if (j) sellJoker(i); };
      row.appendChild(el);
    }
    box.appendChild(row);
    if (R.relics.length) {
      const rl = document.createElement('div');
      rl.className = 'r-relics';
      rl.innerHTML = '遗物：' + R.relics.map(r => '<span class="relic">' + esc(r.n) + '</span>').join('');
      box.appendChild(rl);
    }
  }

  function renderCardRow() {
    const box = $('rHand');
    const from = freshFrom, lift = liftAt;
    freshFrom = -1; liftAt = -1;
    if (!box) return;
    box.innerHTML = '';
    for (let i = 0; i < B.hand.length; i++) {
      const el = cardEl(B.hand[i], { sel: B.sel.indexOf(i) >= 0 });
      // 新摸到的牌逐张落下；刚点中的那张抬一下
      if (from >= 0 && i >= from) {
        el.className += ' fx-pop';
        el.style.animationDelay = ((i - from) * 55) + 'ms';
      } else if (i === lift) {
        el.className += ' fx-lift';
      }
      el.onclick = (function (idx) { return function () { toggleSel(idx); }; })(i);
      box.appendChild(el);
    }
  }

  function renderActions() {
    const box = $('rActions');
    if (!box || !B) return;
    box.innerHTML = '';
    const mk = function (label, fn, cls, dis) {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || '');
      b.textContent = label;
      b.disabled = !!dis;
      b.onclick = fn;
      box.appendChild(b);
      return b;
    };
    mk('打 出（' + B.playsLeft + '）', playCards, 'primary', B.playsLeft <= 0 || B.sel.length === 0 || B.done);
    mk('弃 牌（' + B.discardsLeft + '）', discardCards, '', B.discardsLeft <= 0 || B.sel.length === 0 || B.done);
    mk('手牌', showCards, 'ghost', B.done);
  }

  /** 「手牌」：看手上有什么、牌堆还剩什么（不改动任何选择） */
  function showCards() {
    if (!B) return;
    const rest = B.deck.slice(B.ptr);
    const html = '<div class="r-deck">' +
      '<p class="tiny">手上 <b>' + B.hand.length + '</b> 张　·　牌堆剩余 <b>' + rest.length +
      '</b> 张　·　本关已翻出 <b>' + B.ptr + '</b> 张</p>' +
      '<div class="sh-t">手上的牌</div><div class="dk-row">' + B.hand.map(dkChip).join('') + '</div>' +
      '<div class="sh-t">牌堆还剩（按抽牌顺序）</div>' +
      (rest.length ? '<div class="dk-row">' + rest.map(dkChip).join('') + '</div>' : '<p class="tiny">牌堆已空，下次抽牌会重新洗过。</p>') +
      '</div>';
    panel('手牌 · 牌堆', html, [{ t: '知道了', cls: 'primary', fn: closePanel }]);
  }
  function dkChip(c) {
    return '<span class="dk-c ' + seasonCls(c.season) + (c.type === '节日' ? ' festival' : '') +
      '" title="' + esc(c.name + '　' + c.sub + '　数字 ' + c.digits.join('·')) + '">' +
      esc(c.name) + '<i>' + c.digits.join('·') + '</i></span>';
  }

  function renderPreview() {
    const box = $('rPreview');
    if (!box) return;
    if (!B) { box.innerHTML = ''; return; }
    if (!B.sel.length) {
      box.innerHTML = '<span class="dim">点选 1–5 张手牌，这里会预览得分；能凑出的牌型会一起算分。</span>';
      return;
    }
    // 预览要把「留在手里」的牌一起算进去 —— 有些节令牌（如小满）是按手牌数加分的，
    // 否则选牌时看到的数字会和真正打出去的结算不一样。
    const selIdx = B.sel.slice().sort((a, b) => a - b);
    const sel = selIdx.map(i => B.hand[i]);
    const held = B.hand.filter((c, i) => selIdx.indexOf(i) < 0);
    const r = scoreOf(sel, held);
    const handsTxt = r.hands.length ? r.hands.join(' · ') : '散牌';
    box.innerHTML = '<span class="rp-hands">' + esc(handsTxt) + '</span>' +
      '<span class="rp-calc">底分 ' + nfmt(r.chips) + ' × 倍率 ' + fmtMult(r.mult) +
      (r.xmult !== 1 ? ' × 令牌倍率 ' + fmtMult(r.xmult) : '') + ' = <b>' + nfmt(r.score) + '</b></span>';
  }
  function fmtMult(v) { return (Math.round(v * 100) / 100).toString(); }

  function renderResult(res, handsTxt) {
    const box = $('rLog');
    if (!box || !res) return;
    let h = '<div class="r-res-line">' + esc(handsTxt) + '</div>';
    h += '<div class="r-res-calc">底分 <b>' + nfmt(res.chips) + '</b> × 倍率 <b>' + fmtMult(res.mult) + '</b>';
    if (res.xmult !== 1) h += ' × 令牌倍率 <b>' + fmtMult(res.xmult) + '</b>';
    h += ' = <span class="r-gain">' + nfmt(res.score) + '</span></div>';
    h += '<div class="r-res-tags">' + res.log.filter(x => x.k === 'x' || (x.k === 'mult' && x.label !== '') || x.k === 'chip')
      .slice(1, 14).map(x => '<span class="rtag ' + x.k + '">' + esc(x.label) +
        (x.k === 'chip' ? ' 底分' : x.k === 'mult' ? ' 倍率' : '') +
        (x.v !== '' ? ' ' + (x.k === 'x' ? '×' : '+') + fmtMult(x.v) : '') + '</span>').join('') + '</div>';
    box.innerHTML = h;
    animResult(box, res);
  }

  /** 结算面板的动作：牌型名弹入、标签依次弹出、总分滚动 */
  function animResult(box, res) {
    if (!window.FX || !box.querySelector) return;
    try {
      const line = box.querySelector('.r-res-line');
      if (line) line.className += ' fx-pop';
      const tags = box.querySelectorAll ? box.querySelectorAll('.rtag') : null;
      if (tags) {
        for (let i = 0; i < tags.length; i++) {
          tags[i].style.animationDelay = (110 + i * 45) + 'ms';
          tags[i].className += ' fx-pop';
        }
      }
      const g = box.querySelector('.r-gain');
      if (g) {
        g.className += ' fx-gain';
        if (res.score > 999) FX.countUp(g, res.score, { dur: 520, from: Math.round(res.score * 0.3), fmt: nfmt });
      }
    } catch (e) { }
  }
  function renderLog(html) {
    const box = $('rLog');
    if (box) box.innerHTML = '<div class="r-note">' + html + '</div>';
  }

  function render() {
    if (!R) return;
    renderHud(); renderJokers(); if (B) renderCardRow(); renderActions(); renderPreview();
    if ($('rBlindInfo') && B) {
      $('rBlindInfo').innerHTML =
        '<span class="rbi-t">目标 ' + nfmt(B.target) + '</span>' +
        '<span class="rbi-s">得分 ' + nfmt(B.score) + '</span>' +
        (B.neg ? '<span class="rbi-neg">劫 · ' + esc(B.neg.n) + '：' + esc(B.neg.text) + '</span>' : '') +
        '<span class="rbi-s">牌堆 ' + (B.deck.length - B.ptr) + '</span>';
    }
  }

  // ============================== 商店渲染 ==============================
  function renderShop() {
    const costTxt = (c) => {
      const p = scaleCost(c);
      return '<span class="sh-cost' + (R.coins < p ? ' poor' : '') + '">' + p + ' 🪙</span>';
    };
    let h = '<div class="r-shop"><div class="sh-head"><span class="sh-coins">🪙 ' + R.coins + '</span>' +
      '<span class="tiny">节令牌 ' + R.jokers.length + '/' + R.jokerMax +
      '　·　每关出牌 ' + R.playsMax + ' 次　·　弃牌 ' + R.discardsMax + ' 次　·　手牌 ' + R.handMax + ' 张</span></div>';

    h += '<div class="sh-sec"><div class="sh-t">节令牌</div><div class="sh-grid">';
    SHOP.jokers.forEach(function (def, i) {
      if (!def) { h += '<div class="sh-item gone">已售出</div>'; return; }
      h += '<div class="sh-item j r' + def.r + '" data-j="' + i + '">' +
        '<div class="si-n">' + esc(def.n) + ' · ' + esc(def.s) + '<span class="si-r">' + RARITY[def.r].n + '</span></div>' +
        '<div class="si-t">' + esc(def.text) + '</div>' + costTxt(RARITY[def.r].cost) + '</div>';
    });
    h += '</div></div>';

    h += '<div class="sh-sec"><div class="sh-t">符箓（一次性）</div><div class="sh-grid">';
    SHOP.talismans.forEach(function (t, i) {
      if (!t) { h += '<div class="sh-item gone">已用掉</div>'; return; }
      h += '<div class="sh-item" data-t="' + i + '"><div class="si-n">' + esc(t.n) + ' · ' + esc(t.s) + '</div>' +
        '<div class="si-t">' + esc(t.text) + '</div>' + costTxt(t.cost) + '</div>';
    });
    h += '</div></div>';

    h += '<div class="sh-sec"><div class="sh-t">牌型强化（永久）</div><div class="sh-grid">';
    if (!SHOP.upgrades.length) h += '<div class="sh-item gone">这一类都强化满了</div>';
    SHOP.upgrades.forEach(function (name) {
      const lv = R.up[name] || 0;
      h += '<div class="sh-item" data-u="' + name + '">' +
        '<div class="si-n">' + esc(name) + ' 谱 <span class="si-r">Lv.' + lv + ' → ' + (lv + 1) + '</span></div>' +
        '<div class="si-t">这个牌型：底分 +' + UP_TIME + '，倍率 +' + UP_MULT + '</div>' +
        costTxt(40 + 25 * lv) + '</div>';
    });
    h += '</div></div>';

    h += '<div class="sh-sec"><div class="sh-t">优惠券（永久）</div><div class="sh-grid">';
    if (!SHOP.voucher) h += '<div class="sh-item gone">这一轮的券卖完了</div>';
    else {
      const v = SHOP.voucher;
      h += '<div class="sh-item" data-v="1"><div class="si-n">' + esc(v.n) + '</div>' +
        '<div class="si-t">' + esc(v.text) + '</div>' + costTxt(v.cost) + '</div>';
    }
    h += '</div></div>';

    h += '<div class="sh-sec"><div class="sh-t">手上的节令牌（点一下卖掉）</div><div class="sh-grid">';
    if (!R.jokers.length) h += '<div class="sh-item gone">还没有节令牌</div>';
    R.jokers.forEach(function (j, i) {
      h += '<div class="sh-item j r' + j.def.r + '" data-s="' + i + '">' +
        '<div class="si-n">' + esc(j.def.n) + ' · ' + esc(j.def.s) + '</div>' +
        '<div class="si-t">' + esc(j.def.text) + '</div>' +
        '<span class="sh-cost sell">卖出 +' + RARITY[j.def.r].sell + '</span></div>';
    });
    h += '</div></div></div>';

    panel('商店 · 第 ' + (R.tier + 1) + ' 大轮', h,
      [{ t: '刷新（' + R.rerollCost + ' 🪙）', cls: '', fn: rerollShop },
       { t: '下一关', cls: 'primary', fn: leaveShop }]);
    panelKind = 'shop';
  }

  // ============================== 浮层 ==============================
  function panel(title, bodyHtml, btns) {
    const m = $('rOverlay');
    if (!m) return;
    m.style.display = 'flex';
    m.innerHTML = '';
    const box = document.createElement('div'); box.className = 'mbox';
    const h = document.createElement('h2'); h.textContent = title;
    const body = document.createElement('div'); body.className = 'mbody'; body.innerHTML = bodyHtml;
    const foot = document.createElement('div'); foot.className = 'mfoot';
    (btns || []).forEach(function (b) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || 'primary');
      el.textContent = b.t;
      el.onclick = b.fn;
      foot.appendChild(el);
    });
    box.appendChild(h); box.appendChild(body); box.appendChild(foot);
    m.appendChild(box);
    bindShopGrid(body);
  }

  /** 商店里那些用 innerHTML 生成的商品格子，在这里逐个绑上点击 */
  function bindShopGrid(body) {
    if (!body || !body.querySelectorAll) return;
    const hook = function (attr, fn) {
      const els = body.querySelectorAll('[data-' + attr + ']');
      for (let i = 0; i < els.length; i++) {
        (function (el) {
          el.onclick = function () {
            const raw = el.getAttribute('data-' + attr);
            fn(/^\d+$/.test(raw) ? parseInt(raw, 10) : raw);
          };
        })(els[i]);
      }
    };
    hook('j', buyJoker);
    hook('t', buyTalisman);
    hook('s', sellJoker);
    hook('u', buyUpgrade);
    hook('v', buyVoucher);
  }

  function closePanel() {
    const m = $('rOverlay');
    if (m) { m.style.display = 'none'; m.innerHTML = ''; }
    panelKind = null;
  }

  // ============================== 规则面板 ==============================
  function rulesHtml() {
    const h = [];
    h.push('<div class="rules">');
    h.push('<div class="rules-quick"><b>30 秒上手</b>' +
      '<ol class="rol">' +
      '<li>点选 <b>1–5 张手牌</b>，按「打出」。得分 ＝ <b>底分 × 倍率 × 令牌倍率</b>。</li>' +
      '<li>每关只有 <b>4 次出牌</b>，打到<b>目标分</b>就过关，打不到就结束。</li>' +
      '<li>过关拿金币，进商店买<b>节令牌</b>，让后面的每一手更值钱。</li>' +
      '</ol></div>');

    h.push('<h3>一、这一关怎么打</h3>' +
      '<p>没有对手，只有你、目标分和有限的出牌次数。' +
      '全程 <b>8 个大轮 × 3 关 ＝ 24 关</b>，每轮依次是 小关 → 大关 → <b>劫</b>（Boss 关，多一条限制）。' +
      '每过一关发金币并进<b>商店</b>；一局结束时，买到的所有东西清零重来。</p>' +
      '<ul class="rul">' +
      '<li><b>出牌</b>：选 1–5 张打出去，立刻得分，并补进新牌。</li>' +
      '<li><b>弃牌</b>：选 1–5 张扔掉换新的，不得分，纯粹换手牌。</li>' +
      '<li><b>手牌</b>：查看手上和牌堆里的牌，不会改变你当前的选择。</li>' +
      '</ul>' +
      '<p class="tiny">选牌时下方会实时预览这一手的得分，先比一比再决定打哪几张。</p>');

    h.push('<h3>二、分数怎么算：底分 × 倍率 × 令牌倍率</h3>' +
      '<p>一手牌<b>能同时成立好几种牌型</b>，成立的全部一起算分，不是只挑最大的一种。</p>' +
      '<ul class="rul">' +
      '<li><b>底分</b> ＝ 打出的数字之和 ＋ 各牌型的底分 ＋ 令牌加的底分（全是加法）</li>' +
      '<li><b>倍率</b> ＝ 1 ＋ 各牌型的倍率 ＋ 令牌加的倍率（先把这些倍率相加）</li>' +
      '<li><b>令牌倍率</b> ＝ 令牌写的「×N」逐个<b>连乘</b>；没有触发时就是 ×1</li>' +
      '<li><b>总分 ＝ 底分 × 倍率 × 令牌倍率</b></li>' +
      '</ul>' +
      '<p class="tiny">想拿高分主要靠叠倍率：底分只是地板，倍率与令牌倍率才决定这手牌能翻多大。</p>');

    const rows = E.POKER_ORDER.map(function (n) {
      const t = E.SCORE_TABLE[n];
      return [n, t.time, t.mult, t.p, t.rare ? '稀有' : ''];
    });
    h.push('<h3>三、牌型与分值</h3>' +
      '<p>牌型给出两样东西：<b>底分</b>（加进去）和<b>倍率</b>（乘上去）。' +
      '带 ★ 的是<b>稀有牌型</b>，只有<b>打满 5 张</b>才判定；其余牌型任意张数都能成立。</p>' +
      '<table class="rtab"><thead><tr><th>牌型</th><th>底分</th><th>倍率</th><th>出现率</th></tr></thead><tbody>' +
      rows.map(r => '<tr' + (r[4] ? ' class="rare"' : '') + '><td>' + (r[4] ? '★ ' : '') + r[0] +
        '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('') +
      '</tbody></table>' +
      '<p class="tiny">出现率只是「这副牌里有多难得」的参考。注意它和普通扑克不一样：' +
      '这里顺子比四条更难得，所以分值也更高。</p>');

    h.push('<h3>四、稀有牌型：一手翻几百倍</h3>' +
      '<p>打满 5 张时，牌面会摊出十几个数字，而数字只有 0–12 这 13 种，重复非常多。' +
      '所以下面这些「看起来很夸张」的牌型，其实是可以主动去凑的：</p>' +
      '<ul class="rul">' +
      '<li><b>九同 / 八同 / 七同</b>：同一个数字出现 ≥9 / 8 / 7 次</li>' +
      '<li><b>十三 / 十二 / 十一连顺</b>：数字能连成对应长度的一串</li>' +
      '<li><b>十连 / 九连 / 八连同花顺</b>：同一季里连出对应长度的一串</li>' +
      '<li><b>十三花</b>：13 个数字同属一季</li>' +
      '</ul>' +
      '<p><b>关键：稀有牌型会「一族连档」。</b>成立九同，八同、七同也一起成立，倍率叠着算。' +
      '比如 <b>九同 ＋ 八同 ＋ 七同 ＝ 倍率 +86</b>，还没算其他牌型和令牌。</p>' +
      '<p class="tiny">想把它翻成天文数字，就配专门吃稀有牌型的令牌：' +
      '重楼（同数档连乘）、极数（每种稀有 ×2）、周天（数字覆盖 ×8）、八音 / 问鼎（牌型越多越好）。</p>');

    h.push('<h3>五、节令牌与商店</h3>' +
      '<p><b>节令牌是常驻被动</b>：买到后排在上方，每次出牌都会触发。' +
      '最多带 <b>5 张</b>（优惠券可加到 8 张），想换新的先卖旧的，卖出价是买价的一半。</p>' +
      '<table class="rtab"><thead><tr><th>稀有度</th><th>售价</th><th>卖出</th><th>特点</th></tr></thead><tbody>' +
      RARITY.map((r, i) => '<tr><td>' + r.n + '</td><td>' + r.cost + ' 🪙</td><td>' + r.sell + ' 🪙</td><td>' +
        ['加底分、给金币', '条件倍率', '成型流派的核心', '很强，但常带代价'][i] +
        '</td></tr>').join('') + '</tbody></table>' +
      '<p><b>每家商店的第三格必出稀有或传说。</b>前期买不起很正常，' +
      '攒钱拿下一张核心令牌，通常比见便宜就买更划算。</p>' +
      '<ul class="rul">' +
      '<li><b>符箓</b>：一次性，买了立刻生效，比如加一次出牌、本关倍率 ×1.5。</li>' +
      '<li><b>牌型强化</b>：本局永久提高某个牌型的底分与倍率，最多 3 级。只卖普通牌型，适合专心堆一种。</li>' +
      '<li><b>优惠券</b>：本局永久改规则，比如令牌上限 +1、出牌次数 +1。</li>' +
      '<li><b>遗物</b>：每打赢一个劫，三选一，最多带 4 件，都是小幅加强。</li>' +
      '</ul>');

    h.push('<h3>六、金币怎么来</h3>' +
      '<ul class="rul">' +
      '<li><b>通关金币</b>：第 1 大轮 32，之后每轮递增（45 / 60 / 78 / 100 / 126 / 158 / 195）。</li>' +
      '<li><b>利息</b>：结算时手上每 5 金币多给 1 金币，上限 5（丰年券、算筹能提高上限）。</li>' +
      '<li><b>超额奖励</b>：得分超出目标越多，最多再拿 8 金币。</li>' +
      '<li>元宵 · 灯市、市集 · 丰穰、铜壶 等令牌与遗物也会额外发金币。</li>' +
      '</ul>');

    h.push('<h3>七、劫（Boss 关）</h3>' +
      '<p>每轮第 3 关是劫，固定附加一条限制。它不直接扣你的分，而是逼你这一关换打法：</p>' +
      '<table class="rtab"><thead><tr><th>大轮</th><th>劫</th><th>限制</th></tr></thead><tbody>' +
      NEGS.map((n, i) => '<tr><td>第 ' + (i + 1) + ' 轮</td><td>' + n.n + '</td><td>' + n.text + '</td></tr>').join('') +
      '</tbody></table>');

    h.push('<h3>八、目标分为什么越来越离谱</h3>' +
      '<p>目标分每大轮整体抬高约 <b>2.6 倍</b>，轮内三关也一关比一关高。' +
      '只靠底分是追不上的，必须一边打一边把倍率滚起来。</p>' +
      '<table class="rtab"><thead><tr><th>大轮</th><th>小关</th><th>大关</th><th>劫</th></tr></thead><tbody>' +
      TIER_TARGET.map((row, i) => '<tr><td>第 ' + (i + 1) + ' 轮</td><td>' + nfmt(row[0]) + '</td><td>' +
        nfmt(row[1]) + '</td><td>' + nfmt(row[2]) + '</td></tr>').join('') + '</tbody></table>');

    h.push('<h3>九、牌面与数字</h3>' +
      '<p>整副牌 36 张：二十四节气 ＋ 十二节日，春 / 夏 / 秋 / 冬 就是花色。' +
      '<b>月号是 1–12 的完整数字</b>（10 就是 10，不拆成 1 和 0），日号逐位拆开，' +
      '所以一张牌给出 2–4 个数字，范围是 <b>0–12</b>。</p>' +
      '<p><b>节日牌</b>额外送 1 个万能数字，可以当成 0–12 里的任意一个，一手最多算 2 个。' +
      '<b>顺子</b>是 0–12 里的任意 5 连，8-9-10-11-12 也算。</p>');

    h.push('</div>');
    return h.join('');
  }

  // ============================== 入口 ==============================
  function start(opts) {
    cb = opts || {};
    R = {
      coins: 4, tier: 0, blind: 0,
      jokers: [], relics: [], vouchers: [], up: {},
      jokerMax: 5, playsMax: 4, discardsMax: 3, handMax: 8,
      interestCap: 5, rerollCost: 5, priceMul: 1, priceUpNext: false,
      blindsCleared: 0, playsTotal: 0, totalScore: 0, bestPlay: 0,
      _bonus: 0, over: false, win: false
    };
    for (const k in E.SCORE_TABLE) R.up[k] = 0;
    SHOP = null;
    ach({ type: 'rogueStart' });
    showRogue();
    closePanel();
    nextBlindSelect();
    render();
  }

  function bindTop() {
    if ($('rRulesBtn')) $('rRulesBtn').onclick = function () {
      panel('衍时纪 · 玩法规则', rulesHtml(), [{ t: '知道了', cls: 'primary', fn: closePanel }]);
    };
    if ($('rQuitBtn')) $('rQuitBtn').onclick = function () { closePanel(); if (cb.onExit) cb.onExit(); };
    if ($('rAchBtn')) $('rAchBtn').onclick = function () {
      if (window.Ach) panel('我的成就', Ach.panelHtml(), [{ t: '关闭', cls: 'primary', fn: closePanel }]);
    };
    if ($('rRankBtn')) $('rRankBtn').onclick = function () {
      if (window.__game && window.__game.showRank) window.__game.showRank();
    };
    if ($('rMuteBtn') && window.FX) {
      const mb = $('rMuteBtn');
      mb.textContent = FX.isMuted() ? '🔇' : '🔊';
      mb.onclick = function () {
        FX.setMuted(!FX.isMuted());
        mb.textContent = FX.isMuted() ? '🔇' : '🔊';
        if (!FX.isMuted()) FX.play('click');
      };
    }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', bindTop);
  }

  window.Rogue = {
    start: start,
    state: function () { return R; },
    blind: function () { return B; },
    shop: function () { return SHOP; },
    rulesHtml: rulesHtml,
    scoreOf: scoreOf,
    bestCombo: bestCombo,
    playCards: playCards,
    discardCards: discardCards,
    toggleSel: toggleSel,
    buyJoker: buyJoker,
    buyTalisman: buyTalisman,
    buyUpgrade: buyUpgrade,
    buyVoucher: buyVoucher,
    sellJoker: sellJoker,
    rerollShop: rerollShop,
    leaveShop: leaveShop,
    jokerPrice: jokerCost,
    costOf: scaleCost,
    openShop: openShop,
    beginBlind: beginBlind,
    rollShop: rollShop,
    render: render,
    renderResult: renderResult,
    closePanel: closePanel,
    targets: TIER_TARGET,
    jokers: JOKERS,
    negs: NEGS,
    relics: RELICS,
    talismans: TALISMANS,
    vouchers: VOUCHERS
  };
})();
