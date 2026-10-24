/* 《衍时纪 · 朔望》—— 规则引擎
 * 纯逻辑，无 DOM 依赖。挂载到 window.Engine
 */
(function () {
  'use strict';

  // 5 连顺子的全部可能段。
  // v2.0 起：月号是 1–12 的单个数字，所以数字池的范围是 0–12，
  // 顺子段也随之扩展到 0-4 …… 8-12 共 9 段（8-9-10-11-12 即「月份连成一段」）。
  const RUNS = [];
  for (let s = 0; s <= 8; s++) RUNS.push([s, s + 1, s + 2, s + 3, s + 4]);

  /* v2.1 稀有牌型 —— 阈值不是拍的，是 _tools/sim_rare2.js 按真实出牌前提实测出来的。
   * 关键在于「玩家会在 8 张手牌里挑分最高的那一手」（best-of-56），
   * 所以达成率要按 **挑完之后** 的分布算，而不是随机 5 张。实测（5k 次）：
   *
   *   七同 31.7%   八同 11.6%   九同 2.4%
   *   十一连顺 21.2%  十二连顺 7.5%  十三连顺 0.84%
   *   八连同花顺 18.8%  九连同花顺 7.3%  十连同花顺 2.7%
   *   十三花 9.8%
   *
   * 三条梯子都是连号（7→8→9 / 11→12→13 / 8→9→10），各档落在 30% / 10% / 2% 左右。
   *
   * 为什么没有「五同 / 六同 / 六连顺 / 六连同花顺」：
   * 牌型判定在**数字池**上，5 张牌会摊出约 13.8 个数字（其中约 1.4 个是节日牌给的万能位），
   * 而数字只有 0–12 共 13 个可能值，其中还大量同值重复（立夏 5·5、端午 5·5、上巳 3·3…）。
   * 于是「6」这一档在真实出牌口径（best-of-56，与 SCORE_TABLE 的 p 列同一个口径）下实测：
   * 六张同花 98.3% / 六连顺 84.3% / 六连同花顺 50.6% / 六同 44.8%，
   * 对照七同 34.6%、八同 12%、九同 2.4% —— 6 档基本是「每手都白拿的常数」，
   * 既没有稀有感，也会把分数曲线压平。所以稀有档从真正稀有的位置起步，最小档取「七同」。
   * 复现：node _tools/_chk_pool.js
   */
  function runsOf(n) {
    const out = [];
    for (let s = 0; s + n - 1 <= 12; s++) {
      const r = [];
      for (let i = 0; i < n; i++) r.push(s + i);
      out.push(r);
    }
    return out;
  }
  const RUN11 = runsOf(11), RUN12 = runsOf(12), RUN13 = runsOf(13);
  const SFRUN8 = runsOf(8), SFRUN9 = runsOf(9), SFRUN10 = runsOf(10);

  // 稀有牌型清单（由强到弱）。节令牌与界面都靠它识别「这一手爆了什么」。
  const RARE_HANDS = ['十连同花顺', '九连同花顺', '八连同花顺', '九同', '八同', '七同',
    '十三连顺', '十二连顺', '十一连顺', '十三花'];

  // 模式一：古典牌型等级（德州顺序）。稀有牌型排在前面，但模式一一次只打 3 张牌，
  // 而稀有档被门限挡在「满 5 张」之外（见 detectHands），所以对它等于不存在（已验证）。
  const POKER_ORDER = [
    '十连同花顺', '九连同花顺', '八连同花顺',
    '九同', '八同', '七同',
    '十三连顺', '十二连顺', '十一连顺', '十三花',
    '同花顺', '四条', '葫芦', '同花', '顺子', '三条', '两对', '一对', '散牌'
  ];
  // 模式二/三：按本牌库真实概率校准后的时值 / 运值
  // p = 三张牌池（朔段 / 衍 / 衍时）下的实测「同时成立率」，由 _tools/sim_hands.js 统计。
  // 注意：本作是「多牌型同时成立」，所以这些比例指的是"这一手有没有成立该牌型"，
  //       不是德州扑克里"最终被判定为该牌型"的比例，因此数字看起来偏高是正常的。
  // rare 档的 p 则来自 _tools/sim_rare2.js（5 张出牌、best-of-56 的实测达成率）。
  //
  // 稀有档的值刻意给得很高：因为**同一族会叠加** —— 成立「九同」时，
  // 「八同」与「七同」也同时成立，一族合计 55+22+9 = 86 运值，
  // 比全部古典档加起来的总量（20.5）还多。这就是「疯狂翻倍」的来源。
  //
  // 注意别把「一族上限」当成平均收益。同一个口径（best-of-56，_tools/_chk_pool.js）下实测：
  //   古典档一族平均贡献运值 19.7，稀有档 29.5 —— 稀有档约是古典档的 1.5 倍，
  //   而 68.6% 的手能摸到至少一种稀有牌型。
  const SCORE_TABLE = {
    // ---- v2.1 稀有牌型 · 传说 ----
    '十连同花顺': { time: 260, mult: 90, p: '2.7%', rare: true },
    '十三连顺':  { time: 200, mult: 60, p: '0.8%', rare: true },
    '九同':      { time: 175, mult: 55, p: '2.4%', rare: true },
    // ---- v2.1 稀有牌型 · 史诗 ----
    '九连同花顺': { time: 180, mult: 55, p: '7.3%', rare: true },
    '八同':      { time: 95,  mult: 22, p: '12%',  rare: true },
    '十二连顺':   { time: 120, mult: 28, p: '7.5%', rare: true },
    '十三花':    { time: 160, mult: 42, p: '9.8%', rare: true },
    // ---- v2.1 稀有牌型 · 稀有 ----
    '八连同花顺': { time: 125, mult: 32, p: '19%',  rare: true },
    '七同':      { time: 55,  mult: 9,  p: '32%',  rare: true },
    '十一连顺':   { time: 60,  mult: 10, p: '21%',  rare: true },
    // ---- 古典牌型 ----
    '同花顺': { time: 60, mult: 8, p: '18%'   },
    '顺子':   { time: 30, mult: 4, p: '41%'   },
    '四条':   { time: 25, mult: 3, p: '47%'   },
    '同花':   { time: 20, mult: 2, p: '65%'   },
    '葫芦':   { time: 15, mult: 1.5, p: '65%' },
    '三条':   { time: 10, mult: 1, p: '81%'   },
    '两对':   { time: 8,  mult: 0.5, p: '84%' },
    '一对':   { time: 5,  mult: 0.5, p: '97%' },
    '散牌':   { time: 0,  mult: 0, p: '1.4%'  }
  };

  // ---------- 工具 ----------
  function countMap(arr) {
    const m = new Map();
    for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
    return m;
  }
  function maxCount(m) { let x = 0; for (const v of m.values()) if (v > x) x = v; return x; }
  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

  /* 把若干张牌摊成数字池
   * mode 2/3：每张节日牌额外提供 1 个「万能数字」，一手最多计入 2 个
   *          万能数字可以当作 0–12 中的任意一个数字
   * mode 1  ：无万能牌（传统玩法）
   */
  function buildPool(cards, mode) {
    const digits = [];
    let wilds = 0;
    cards.forEach((c, ci) => {
      if (!c) return;
      (c.digits || []).forEach(v => digits.push({ v: v, season: c.season, ci: ci, wild: false }));
      if (mode !== 1 && c.type === '节日' && wilds < 2) {
        wilds++;
        digits.push({ v: null, season: c.season, ci: ci, wild: true });
      }
    });
    return { digits: digits, wilds: wilds, cards: cards.filter(Boolean) };
  }

  function realVals(pool) {
    const out = [];
    for (const d of pool.digits) if (!d.wild) out.push(d);
    return out;
  }

  // ---------- 牌型判定（含万能数字） ----------
  function canPair(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    if (pool.digits.length < 2) return false;
    return maxCount(countMap(vals)) + W >= 2;
  }
  function canTwoPair(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    const m = countMap(vals);
    const pairs = [...m.values()].filter(v => v >= 2).length;
    const distinct = [...m.keys()].length;
    if (pairs >= 2) return true;
    if (pairs === 1 && W >= 1 && distinct >= 2) return true;
    if (pairs === 0 && W >= 2 && distinct >= 2) return true;
    return false;
  }
  function canThree(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    return maxCount(countMap(vals)) + W >= 3;
  }
  function canFour(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    return maxCount(countMap(vals)) + W >= 4;
  }
  function canFullHouse(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    const m = countMap(vals);
    const keys = [...m.keys()];
    for (const a of keys) for (const b of keys) {
      if (a === b) continue;
      for (let wa = 0; wa <= W; wa++) {
        const wb = W - wa;
        if (m.get(a) + wa >= 3 && m.get(b) + wb >= 2) return true;
      }
    }
    return false;
  }
  function canStraight(pool) {
    const W = pool.wilds, vals = realVals(pool).map(d => d.v);
    const m = countMap(vals);
    for (const run of RUNS) {
      let need = 0;
      for (const v of run) if (!m.has(v)) need++;
      if (need <= W) return true;
    }
    return false;
  }
  function canFlush(pool) {
    const W = pool.wilds;
    const byS = countMap(realVals(pool).map(d => d.season));
    for (const c of byS.values()) if (c + W >= 5) return true;
    return false;
  }
  function canStraightFlush(pool) {
    const W = pool.wilds;
    const real = realVals(pool);
    for (const season of ['春', '夏', '秋', '冬']) {
      const s = new Set(real.filter(d => d.season === season).map(d => d.v));
      for (const run of RUNS) {
        let need = 0;
        for (const v of run) if (!s.has(v)) need++;
        if (need <= W) return true;
      }
    }
    return false;
  }

  // ---------- v2.1 稀有牌型 ----------
  /** 同一个数字出现 k 次（万能位可以补任意数字） */
  function canSame(pool, k) {
    const vals = realVals(pool).map(d => d.v);
    return maxCount(countMap(vals)) + pool.wilds >= k;
  }
  /** 数字池里存在能给出一条 len 连的段（缺口用万能位补） */
  function hasRunN(pool, runs) {
    const W = pool.wilds;
    const m = countMap(realVals(pool).map(d => d.v));
    for (const run of runs) {
      let need = 0;
      for (const v of run) if (!m.has(v)) need++;
      if (need <= W) return true;
    }
    return false;
  }
  /** 同季数字达到 k 个 */
  function hasFlushN(pool, k) {
    const W = pool.wilds;
    const byS = countMap(realVals(pool).map(d => d.season));
    for (const c of byS.values()) if (c + W >= k) return true;
    return false;
  }
  /** 同一季里能连出 len 连 */
  function hasStraightFlushN(pool, runs) {
    const W = pool.wilds, real = realVals(pool);
    for (const season of ['春', '夏', '秋', '冬']) {
      const s = new Set(real.filter(d => d.season === season).map(d => d.v));
      for (const run of runs) {
        let need = 0;
        for (const v of run) if (!s.has(v)) need++;
        if (need <= W) return true;
      }
    }
    return false;
  }
  /** 这一手成立了哪些稀有牌型 —— 给节令牌与界面用 */
  function rareOf(hands) {
    return hands.filter(h => RARE_HANDS.indexOf(h) >= 0);
  }
  /** 数字池覆盖了多少个不同的数字（0–12，最多 13 个） */
  function poolDistinct(pool) {
    const s = new Set();
    for (const d of pool.digits) if (!d.wild) s.add(d.v);
    return s.size;
  }

  /** 返回本回合所有「同时成立」的牌型 */
  function detectHands(pool) {
    const out = [];
    if (pool.digits.length < 5) return out;
    // ---- v2.1 稀有牌型：只在**满 5 张**出牌时判定 ----
    // 稀有档是按「5 张牌摊出约 13.8 个数字」定义出来的，
    // 如果不加这道门，三张牌池（朔段 / 衍 / 衍时三个模式）也能用 0.49% 的概率凑出来 ——
    // 比如「谷雨 + 元宵 + 上巳」三张春牌，靠 2 个万能位就能成立「八连同花顺」，
    // 语义上完全是荒谬的。低张数出牌一律不给稀有档，另三个模式的数值因此原地不动。
    if (pool.cards.length >= 5) {
      if (hasStraightFlushN(pool, SFRUN10)) out.push('十连同花顺');
      if (hasStraightFlushN(pool, SFRUN9)) out.push('九连同花顺');
      if (hasStraightFlushN(pool, SFRUN8)) out.push('八连同花顺');
      if (canSame(pool, 9)) out.push('九同');
      if (canSame(pool, 8)) out.push('八同');
      if (canSame(pool, 7)) out.push('七同');
      if (hasRunN(pool, RUN13)) out.push('十三连顺');
      if (hasRunN(pool, RUN12)) out.push('十二连顺');
      if (hasRunN(pool, RUN11)) out.push('十一连顺');
      if (hasFlushN(pool, 13)) out.push('十三花');
    }
    // ---- 古典牌型 ----
    if (canStraightFlush(pool)) out.push('同花顺');
    if (canFour(pool)) out.push('四条');
    if (canFullHouse(pool)) out.push('葫芦');
    if (canFlush(pool)) out.push('同花');
    if (canStraight(pool)) out.push('顺子');
    if (canThree(pool)) out.push('三条');
    if (canTwoPair(pool)) out.push('两对');
    if (canPair(pool)) out.push('一对');
    return out;
  }

  /** 模式一用：取最高牌型 + 决胜用数字和 */
  function bestPoker(pool) {
    const hands = detectHands(pool);
    let best = '散牌', bi = POKER_ORDER.length - 1;
    for (const h of hands) {
      const i = POKER_ORDER.indexOf(h);
      if (i >= 0 && i < bi) { bi = i; best = h; }
    }
    const vals = realVals(pool).map(d => d.v).sort((a, b) => b - a);
    return { name: best, rank: POKER_ORDER.length - 1 - bi, tiebreak: sum(vals.slice(0, 5)),
             vec: pokerVector(pool, best) };
  }

  /** 同牌型决胜：最高牌型的「数值向量」，逐位比大小（越大越强）。
   *  葫芦先比三条再比对子；两对先比大对再比小对再比踢脚；顺子比高点；同花/散牌比前五数字。 */
  function pokerVector(pool, bestName) {
    const real = realVals(pool).map(d => d.v);
    const m = countMap(real);
    const valsDesc = real.slice().sort((a, b) => b - a);
    const bestRunHigh = set => {
      let hi = -1;
      for (const run of RUNS) if (run.every(v => set.has(v))) hi = Math.max(hi, run[4]);
      return hi;
    };
    const take = n => [...m.entries()].filter(e => e[1] >= n).map(e => e[0]).sort((a, b) => b - a);
    switch (bestName) {
      case '同花顺':
        for (const s of ['春', '夏', '秋', '冬']) {
          const set = new Set(realVals(pool).filter(d => d.season === s).map(d => d.v));
          const hi = bestRunHigh(set);
          if (hi >= 0) return [hi];
        }
        return valsDesc.slice(0, 5);
      case '四条': {
        const q = take(4)[0];
        return [q, valsDesc.find(v => v !== q)];
      }
      case '葫芦': {
        const t3 = take(3)[0];
        const pairs = take(2).filter(v => v !== t3);
        const rest = [...m.keys()].filter(v => v !== t3);
        return [t3, pairs.length ? pairs[0] : Math.max.apply(null, rest)];
      }
      case '同花':
        for (const s of ['春', '夏', '秋', '冬']) {
          const vs = realVals(pool).filter(d => d.season === s).map(d => d.v).sort((a, b) => b - a);
          if (vs.length >= 5) return vs.slice(0, 5);
        }
        return valsDesc.slice(0, 5);
      case '顺子':
        return [bestRunHigh(new Set(real))];
      case '三条': {
        const t = take(3)[0];
        return [t].concat(valsDesc.filter(v => v !== t).slice(0, 2));
      }
      case '两对': {
        const ps = take(2).slice(0, 2);
        const k = valsDesc.find(v => v !== ps[0] && v !== ps[1]);
        return ps.concat([k]);
      }
      case '一对': {
        const p = take(2)[0];
        return [p].concat(valsDesc.filter(v => v !== p).slice(0, 3));
      }
      default:
        return valsDesc.slice(0, 5);
    }
  }

  // ---------- 十六点 ----------
  /** 模式一：牌面「数位和」，公共牌可选 */
  function sixteenMode1(handCards, publicCard, usePublic) {
    let t = 0;
    for (const c of handCards) t += c.sum;
    if (usePublic && publicCard) t += publicCard.sum;
    return t;
  }
  /** 模式二/三：牌面「日点」，公共牌可选 */
  function sixteenMode2(handCards, publicCard, usePublic) {
    let t = 0;
    for (const c of handCards) t += c.dayPoint;
    if (usePublic && publicCard) t += publicCard.dayPoint;
    return t;
  }
  /** 望回合：返回最佳选择（取 ≤ 爆线 的最大值；两种方案都超线则爆） */
  function bestSixteen(handCards, publicCard, mode, line) {
    const L = line || 16;
    const f = mode === 1 ? sixteenMode1 : sixteenMode2;
    const a = f(handCards, publicCard, false);
    const b = f(handCards, publicCard, true);
    const ok = [a, b].filter(x => x <= L);
    const total = ok.length ? Math.max(...ok) : Math.min(a, b);
    return { total: total, bust: total > L, line: L,
             withPublic: ok.length ? Math.max(...ok) === b : false, noPublic: a };
  }
  function sixteenMult(total, bust, line) {
    const L = line || 16;
    if (bust) return 0.5;
    if (total === L) return 2;
    if (total === L - 1) return 1.5;
    if (total >= L - 3) return 1.2;
    if (total >= L - 5) return 1;
    return 0.8;
  }

  // ---------- Combo（模式二/三） ----------
  function comboCheck(cards, pool, hands, opts) {
    // cards: 本回合参与 combo 的牌（现在 + 过去）；opts.today: 今日牌名
    const res = [];
    const add = (name, desc, eff) => res.push({ name, desc, ...eff });
    const names = cards.map(c => c.name);
    const months = cards.map(c => c.m);
    const dayPoints = cards.map(c => c.dayPoint);
    const has = n => names.includes(n);

    // 1 月令成章：3 个连续月（10/11/12 视为连续）
    {
      const set = [...new Set(months)].sort((a, b) => a - b);
      let best = 0, cur = 1;
      for (let i = 1; i < set.length; i++) { cur = (set[i] === set[i - 1] + 1) ? cur + 1 : 1; best = Math.max(best, cur); }
      best = Math.max(best, set.length ? 1 : 0);
      if (best >= 3) add('月令成章', `${best} 个连续月份`, { mult: 2 });
    }
    // 2 朔望相对：有 日号1 与 日号15
    if (cards.some(c => c.d === 1) && cards.some(c => c.d === 15))
      add('朔望相对', '同时握有初一与十五', { mult: 3 });
    // 3 重日：日点成对
    {
      const m = countMap(dayPoints); let pairs = 0;
      for (const v of m.values()) pairs += Math.floor(v / 2);
      if (pairs > 0) add('重日', `${pairs} 对同点`, { chips: 10 * pairs });
    }
    // 4 同月
    {
      const m = countMap(months); let pairs = 0;
      for (const v of m.values()) pairs += Math.floor(v / 2);
      if (pairs > 0) add('同月', `${pairs} 对同月`, { mult: 1 * pairs });
    }
    // 5 二分二至
    {
      const n = ['春分', '秋分', '夏至', '冬至'].filter(has).length;
      if (n >= 2) add('二分二至', `${n} 个分至`, { times: 1.5 });
    }
    // 6 四立同辉
    {
      const n = ['立春', '立夏', '立秋', '立冬'].filter(has).length;
      if (n >= 2) add('四立同辉', `${n} 立齐聚`, { mult: n >= 3 ? 6 : 3 });
    }
    // 7 天地交泰
    if ((has('春分') || has('秋分')) && (has('夏至') || has('冬至')))
      add('天地交泰', '分至交汇', { times: 2 });
    // 8 岁首岁末
    if ((has('立春') && has('大寒')) || (has('春节') && has('除夕')))
      add('岁首岁末', '一元复始', { times: 2 });
    // 9 节气连环
    if (hands.includes('顺子')) add('节气连环', '五数连珠', { mult: 2 });
    // 10 四时流转 / 11 一季当令
    {
      const seasons = new Set(cards.map(c => c.season));
      if (seasons.size >= 3) add('四时流转', `${seasons.size} 季同堂`, { mult: 2 });
      if (cards.length && seasons.size === 1) add('一季当令', '同气连枝', { mult: 2 });
    }
    // 12 序贯（仅模式二/三，且无节日牌）
    {
      if (cards.every(c => c.order > 0)) {
        const o = cards.map(c => c.order).sort((a, b) => a - b);
        let ok = o.length >= 2;
        for (let i = 1; i < o.length; i++) if (o[i] !== o[i - 1] + 1) ok = false;
        if (ok) add('序贯', '三候相续', { plusMult: 1.5 });
      }
    }
    // 13 节庆盈门
    {
      const n = cards.filter(c => c.type === '节日').length;
      if (n > 0) add('节庆盈门', `${n} 张节庆牌`, { chips: 20 * n });
    }
    // 14 重数
    {
      const m = countMap(realVals(pool).map(d => d.v));
      let mx = 0; for (const v of m.values()) mx = Math.max(mx, v);
      if (mx >= 3) add('重数', `同一数字出现 ${mx} 次`, { chips: 15 });
    }
    // 16 今日之节
    if (opts && opts.today && names.includes(opts.today))
      add('今日之节', `正逢${opts.today}`, { times: 2 });

    return res;
  }

  // ---------- 规则面板用：combo 一览 ----------
  const COMBO_LIST = [
    { name: '月令成章', cond: '数字池的月号里有 3 个连续月份（十/冬/腊视为连续）', eff: '倍率 +2' },
    { name: '朔望相对', cond: '同时握有「初一」与「十五」的牌', eff: '倍率 +3' },
    { name: '重日', cond: '两张牌的日点相同', eff: '每对 底分 +10' },
    { name: '同月', cond: '两张牌的月号相同', eff: '每对 倍率 +1' },
    { name: '二分二至', cond: '含春分 / 秋分 / 夏至 / 冬至 中 ≥2 张', eff: '倍率 ×1.5' },
    { name: '四立同辉', cond: '含立春 / 立夏 / 立秋 / 立冬 2 张（3 张更强）', eff: '倍率 +3（3 张 +6）' },
    { name: '天地交泰', cond: '同时含「分」与「至」各 ≥1 张', eff: '倍率 ×2' },
    { name: '岁首岁末', cond: '同时含立春与大寒，或春节与除夕', eff: '倍率 ×2' },
    { name: '节气连环', cond: '本回合成立了顺子', eff: '倍率额外 +2' },
    { name: '四时流转', cond: '三张牌分属 3 个不同季', eff: '倍率 +2' },
    { name: '一季当令', cond: '三张牌同季', eff: '倍率 +2' },
    { name: '序贯', cond: '三张牌的序连成一段（如 春1-夏2-秋3）', eff: '倍率 +1.5' },
    { name: '节庆盈门', cond: '数字池含节日牌', eff: '每张 底分 +20' },
    { name: '重数', cond: '池中某个数字出现 ≥3 次', eff: '底分 +15' },
    { name: '月晦', cond: '望回合爆点', eff: '倍率 ×0.5' },
    { name: '今日之节', cond: '含「今天真实日期」所在节气或节日的牌', eff: '倍率 ×2' }
  ];

  // ---------- 节日牌效果 ----------
  // 注意：所有筹码变动都必须是「玩家之间转移」或「进入下回合池」，
  //       不能凭空生成或销毁，否则整局筹码不守恒。
  const FESTIVAL_EFFECT = {
    '春节': { text: '万象更新：倍率 +3', apply: r => { r.addMult += 3; } },
    '元宵': { text: '花灯照夜：倍率 ×1.5', apply: r => { r.times *= 1.5; } },
    '社日': { text: '祈年：若有两张同季，倍率 +4', apply: r => { if (r.sameSeason >= 2) r.addMult += 4; } },
    '上巳': { text: '曲水流觞：数字之和再算一次（底分 +数字和×2）', apply: r => { r.chips += r.digitSum * 2; } },
    '端午': { text: '辟邪：本回合若落败，自赢家手中取回 1 道', apply: r => { r.takeFromWinner = 1; } },
    '七夕': { text: '鹊桥：另一张节日牌效果再触发一次', apply: r => { r.repeat = true; } },
    '中元': { text: '施孤：从道最多者手中取 1 道', apply: r => { r.rob = true; } },
    '中秋': { text: '月满：若含十五之牌，倍率 +5', apply: r => { if (r.has15) r.addMult += 5; } },
    '重阳': { text: '登高：若成立两对以上，倍率 +4', apply: r => { if (r.twoPairUp) r.addMult += 4; } },
    '下元': { text: '解厄：若成立三条以上，底分 +25', apply: r => { if (r.threeUp) r.chips += 25; } },
    '腊八': { text: '腊祭：底分 +30', apply: r => { r.chips += 30; } },
    '除夕': { text: '除旧：倍率 ×2，但须把 1 道放进下一回合的池子', apply: r => { r.times *= 2; r.toCarry = 1; } }
  };

  // ---------- 朔回合结算 ----------
  function scoreShape(cards, pool, hands, combos, mode) {
    const digitSum = sum(realVals(pool).map(d => d.v));
    let chips = digitSum * 2;
    let addMult = 0, times = 1;
    for (const h of hands) { const t = SCORE_TABLE[h]; chips += t.time; addMult += t.mult; }

    const ctx = {
      chips: chips, addMult: addMult, times: times, digitSum: digitSum,
      sameSeason: Math.max(0, ...Object.values(countMap(cards.map(c => c.season)))),
      has15: cards.some(c => c.d === 15),
      twoPairUp: hands.includes('两对') || hands.includes('葫芦') || hands.includes('四条'),
      threeUp: hands.includes('三条') || hands.includes('葫芦') || hands.includes('四条') || hands.includes('同花顺'),
      toCarry: 0, takeFromWinner: 0, rob: false, repeat: false
    };

    // 节日牌效果
    const fests = cards.filter(c => c.type === '节日' && FESTIVAL_EFFECT[c.name]);
    for (const f of fests) FESTIVAL_EFFECT[f.name].apply(ctx);
    if (ctx.repeat && fests.length >= 2) {
      for (const f of fests) FESTIVAL_EFFECT[f.name].apply(ctx);
    }

    let baseChips = ctx.chips, baseMult = ctx.addMult, baseTimes = ctx.times;
    const detail = [];
    for (const h of hands) detail.push({ name: h, time: SCORE_TABLE[h].time, mult: SCORE_TABLE[h].mult, kind: 'hand' });
    for (const c of combos) {
      if (c.chips) baseChips += c.chips;
      if (c.mult) baseMult += c.mult;
      if (c.plusMult) baseMult += c.plusMult;
      if (c.times) baseTimes *= c.times;
      detail.push({ name: c.name, desc: c.desc, chips: c.chips || 0, mult: c.mult || c.plusMult || 0, times: c.times || 0, kind: 'combo' });
    }
    for (const f of fests) detail.push({ name: f.name, desc: FESTIVAL_EFFECT[f.name].text, kind: 'fest' });

    return {
      chips: Math.round(baseChips), mult: +baseMult.toFixed(2), times: +baseTimes.toFixed(2),
      score: Math.round(baseChips * baseMult * baseTimes), detail: detail,
      toCarry: ctx.toCarry, takeFromWinner: ctx.takeFromWinner, rob: ctx.rob
    };
  }

  window.Engine = {
    RUNS, POKER_ORDER, SCORE_TABLE, FESTIVAL_EFFECT, COMBO_LIST,
    RARE_HANDS, rareOf, poolDistinct,
    buildPool, detectHands, bestPoker, pokerVector, bestSixteen, sixteenMult, comboCheck, scoreShape,
    sum, countMap,
    /** 今日之节：返回 2026-02-xx 当天对应的牌名（无则 null） */
    todayCardName: function (deck) {
      const d = new Date();
      if (d.getFullYear() !== 2026) return null;
      const mm = d.getMonth() + 1, dd = d.getDate();
      const hit = deck.find(c => c.m === mm && (c.d === dd) && c.type === '节气');
      const hit2 = deck.find(c => c.type === '节日' && c.m === mm && c.d === dd);
      const t = hit2 || hit;
      return t ? t.name : null;
    }
  };
})();
