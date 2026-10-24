/* 「疯狂翻倍」节令牌校准
 *
 * 两件事：
 *   A. 在真实出牌前提（best-of-56，按分数挑）下，测 5 张新令牌的触发率与倍率贡献。
 *   B. 跑多随机种子整局，看通关数分布 —— 给 TIER_TARGET 重新校准提供依据。
 *
 * 用法： node _tools/sim_jokers.js [次数] [局数]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------------- 最小 DOM 桩（与 test_game.js 同款） ----------------
function makeEl(tag) {
  return {
    tagName: tag, style: {}, children: [], _html: '', textContent: '',
    disabled: false, scrollTop: 0, scrollHeight: 0, onclick: null,
    value: '3', className: '', id: '',
    set innerHTML(v) { this._html = v; this.children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); return c; },
    insertAdjacentHTML(p, h) { this._html += h; },
    addEventListener() {}, querySelector() { return null; },
    getBoundingClientRect() { return { width: 0, height: 0 }; }
  };
}
const els = {};
global.window = global;
global.document = {
  body: makeEl('body'),
  getElementById(id) { return els[id] || (els[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {}
};
const timers = [];
global.setTimeout = function (fn) { timers.push(fn); return timers.length; };
global.addEventListener = function () { };
global.navigator = { userAgent: 'node' };
global.localStorage = {
  _m: {},
  getItem(k) { return k in this._m ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};
for (const f of ['assets/data.js', 'assets/engine.js', 'assets/fx.js',
  'assets/toy.js', 'assets/ach.js', 'assets/rogue.js', 'assets/game.js']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
const E = window.Engine, RG = window.Rogue, D = window.DECKS.mode2;

function drain(max) {
  let n = 0; max = max || 20000;
  while (timers.length && n++ < max) { const f = timers.shift(); f(); }
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ============================ A. 令牌触发率 ============================
const N = Number(process.argv[2] || 20000);

/** 无令牌时的基础分：底分 = 数字和 + Σ时值，倍率 = 1 + Σ运值 */
function baseScore(played) {
  const pool = E.buildPool(played, 2);
  const hands = E.detectHands(pool);
  let ds = 0; for (const d of pool.digits) if (!d.wild) ds += d.v;
  let chips = ds, mult = 1;
  for (const h of hands) { chips += E.SCORE_TABLE[h].time; mult += E.SCORE_TABLE[h].mult; }
  return { pool, hands, chips, mult, score: chips * mult };
}
/** 复刻 rogue.js 里的计分上下文，好让本脚本直接调用节令牌的真定义 */
function makeCtx(played, pool, hands) {
  let ds = 0; for (const d of pool.digits) if (!d.wild) ds += d.v;
  let chips = ds, mult = 1;
  for (const h of hands) { chips += E.SCORE_TABLE[h].time; mult += E.SCORE_TABLE[h].mult; }
  const ctx = {
    played: played, held: [], pool: pool, hands: hands,
    blind: { score: 0, target: 1, playsUsed: 0 },
    run: { jokers: [], blindsCleared: 0, playsTotal: 0 },
    neg: {},
    baseChips: chips, chips: chips, mult: mult, xmult: 1, log: [], _once: {},
    addChips: function (v) { if (v) ctx.chips += v; },
    addMult: function (v) { if (v) ctx.mult += v; },
    xMult: function (v) { ctx.xmult *= v; }
  };
  return ctx;
}

const NEW_IDS = ['chonglou', 'jishu', 'zhoutian', 'bayin', 'wending'];
const jokerById = {};
for (const j of RG.jokers) jokerById[j.id] = j;

function measureJokers() {
  const stat = {
    plays: 0,
    rare1: 0, rare2: 0, rare3: 0, rare4: 0,          // 稀有牌型个数
    same1: 0, same2: 0, same3: 0,                    // 同数档数（七同/八同/九同）
    dist10: 0, dist11: 0, dist12: 0,                 // 数字覆盖
    h10: 0, h11: 0, h12: 0, h13: 0,                  // 同时成立牌型数
    sumRare: 0, sumSame: 0, sumHands: 0,
    // 对数累加：2 万手连乘会直接溢出成 Infinity
    logOf: {}, hitOf: {},
    best: { score: 0, hands: 0, desc: '' }
  };
  for (const id of NEW_IDS) { stat.logOf[id] = 0; stat.hitOf[id] = 0; }

  for (let t = 0; t < N; t++) {
    const hand = shuffle(D).slice(0, 8);
    let best = null, bestSel = null;
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
      for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
        const sel = [hand[a], hand[b], hand[c], hand[d2], hand[e]];
        const r = baseScore(sel);
        if (!best || r.score > best.score) { best = r; bestSel = sel; }
      }
    const rares = E.rareOf(best.hands);
    const sames = rares.filter(h => h.charAt(h.length - 1) === '同').length;
    const dist = E.poolDistinct(best.pool);
    const nh = best.hands.length;

    stat.plays++;
    stat.sumRare += rares.length; stat.sumSame += sames; stat.sumHands += nh;
    if (rares.length >= 1) stat.rare1++;
    if (rares.length >= 2) stat.rare2++;
    if (rares.length >= 3) stat.rare3++;
    if (rares.length >= 4) stat.rare4++;
    if (sames >= 1) stat.same1++;
    if (sames >= 2) stat.same2++;
    if (sames >= 3) stat.same3++;
    if (dist >= 10) stat.dist10++;
    if (dist >= 11) stat.dist11++;
    if (dist >= 12) stat.dist12++;
    if (nh >= 10) stat.h10++;
    if (nh >= 11) stat.h11++;
    if (nh >= 12) stat.h12++;
    if (nh >= 13) stat.h13++;
    if (best.score > stat.best.score) stat.best = { score: best.score, hands: nh, desc: best.hands.join('+') };

    // 逐张令牌的乘法因子 —— 直接调游戏里的真定义，脚本不会跟实现走样
    for (const id of NEW_IDS) {
      const def = jokerById[id];
      if (!def || !def.onScore) continue;
      const ctx = makeCtx(bestSel, best.pool, best.hands);
      def.onScore(ctx);
      if (ctx.xmult !== 1) {
        stat.logOf[id] += Math.log(ctx.xmult);
        stat.hitOf[id]++;
      }
    }
  }

  const pc = (x) => (x / stat.plays * 100).toFixed(1).padStart(5) + '%';
  const gm = (lg) => '×' + Math.exp(lg / stat.plays).toFixed(2);   // 几何平均
  console.log('\n=== A. 「疯狂翻倍」节令牌触发率（best-of-56，' + (N / 1000) + 'k 手）===');
  console.log('  平均同时成立牌型数 ' + (stat.sumHands / stat.plays).toFixed(2) +
    '　平均稀有牌型 ' + (stat.sumRare / stat.plays).toFixed(3) +
    '　平均同数档 ' + (stat.sumSame / stat.plays).toFixed(3));
  console.log('  数字池覆盖：≥10 ' + pc(stat.dist10) + '  ≥11 ' + pc(stat.dist11) + '  ≥12 ' + pc(stat.dist12));
  console.log('  同时成立牌型：≥10 ' + pc(stat.h10) + '  ≥11 ' + pc(stat.h11) +
    '  ≥12 ' + pc(stat.h12) + '  ≥13 ' + pc(stat.h13));
  console.log('  稀有牌型个数：≥1 ' + pc(stat.rare1) + '  ≥2 ' + pc(stat.rare2) +
    '  ≥3 ' + pc(stat.rare3) + '  ≥4 ' + pc(stat.rare4));
  console.log('  同数档数：　　≥1 ' + pc(stat.same1) + '  ≥2 ' + pc(stat.same2) + '  ≥3 ' + pc(stat.same3));
  console.log('  ────────────────────────────────────────────────');
  let lgAll = 0;
  for (const id of NEW_IDS) {
    const def = jokerById[id];
    console.log('  ' + (def.n + ' · ' + def.s).padEnd(12, ' ') +
      '触发 ' + pc(stat.hitOf[id]) + '　平均每手 ' + gm(stat.logOf[id]) +
      '　' + def.text);
    lgAll += stat.logOf[id];
  }
  console.log('  五张全挂上 → 平均每手 ' + gm(lgAll) + ' 倍率（无令牌基准 ×1.00）');
  console.log('  最猛一手（无令牌）：' + Math.round(stat.best.score) + '　' + stat.best.hands + ' 种：' + stat.best.desc);
}


// ==================== C. 关内输出基准（校准目标分用） ====================
/** 在指定大轮/关，用指定构筑，量 4 次出牌的合计分（每个样本换一叠新手牌） */
function blindOutput(tier, blindIdx, loadout, samples) {
  els['rogue'] = makeEl('div'); els['menu'] = makeEl('div'); els['table'] = makeEl('div');
  ['rOverlay', 'rHand', 'rActions', 'rLog', 'rPreview', 'rBlindInfo', 'rJokers',
    'rProgress', 'rTarget', 'rCoins'].forEach(id => els[id] = makeEl('div'));
  timers.length = 0;
  window.Ach._reset();
  RG.start({ onExit: function () { } });
  const R = RG.state();
  R.tier = tier; R.blind = blindIdx;
  R.blindsCleared = tier * 3 + blindIdx;
  for (const id of loadout) {
    const def = RG.jokers.filter(j => j.id === id)[0];
    if (def) R.jokers.push({ def: def, cost: 0 });
  }
  RG.beginBlind(false);
  const B = RG.blind();
  const out = [];
  for (let s = 0; s < samples; s++) {
    const deck = shuffle(D);
    let total = 0;
    for (let p = 0; p < B.playsLeft; p++) {
      const hand = deck.slice(p * 8, p * 8 + 8);
      let best = 0;
      for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
        for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
          const r = RG.scoreOf([hand[a], hand[b], hand[c], hand[d2], hand[e]], []);
          if (r.score > best) best = r.score;
        }
      total += best;
    }
    out.push(total);
  }
  out.sort((a, b) => a - b);
  return {
    avg: out.reduce((a, b) => a + b, 0) / out.length,
    med: out[Math.floor(out.length / 2)],
    lo: out[0], hi: out[out.length - 1]
  };
}

function reportCalibration() {
  console.log('\n=== C. 4 次出牌的合计输出（每档 ' + 600 + ' 个样本）===');
  const NONE = [];
  const NEW = ['chonglou', 'jishu', 'zhoutian', 'bayin', 'wending'];
  const show = (label, tier, blindIdx, loadout) => {
    const r = blindOutput(tier, blindIdx, loadout, 600);
    const tgt = RG.targets[tier][blindIdx];
    console.log('  ' + label.padEnd(34, ' ') + '中位 ' + String(Math.round(r.med)).padStart(12) +
      '　目标 ' + String(tgt).padStart(12) + '　余量 ×' + (r.med / tgt).toFixed(2));
  };
  for (let t = 0; t < 8; t++) show('第 ' + (t + 1) + ' 轮 小关 · 空构筑', t, 0, NONE);
  console.log('  ─────────────────────────────────────────────');
  for (let t = 0; t < 8; t++) show('第 ' + (t + 1) + ' 轮 小关 · 挂满新 5 张', t, 0, NEW);
}


// ============================ D. 通关分布 ============================
if (!process.env.SKIP_MEASURE) { measureJokers(); reportCalibration(); }

function rogueRun(mode, offers) {
  let plays = 0, buys = 0, endTitle = '', minCoins = 9999;
  let blindPlays = 0, lastKey = '', guard = 0;
  while (guard++ < 30000) {
    drain();
    const R = RG.state(), B = RG.blind();
    if (R.coins < minCoins) minCoins = R.coins;
    const ov = els['rOverlay'];
    if (ov.style.display === 'flex' && ov.children.length) {
      const box = ov.children[0];
      const title = box.children[0].textContent;
      const foot = box.children[2];
      if (/^商店/.test(title)) {
        const sh0 = RG.shop();
        if (sh0) for (const d of sh0.jokers) if (d) offers[d.r] = (offers[d.r] || 0) + 1;
        if (mode === 'buy' || mode === 'save') {
          const sh = RG.shop(), S = RG.state();
          const c0 = S.coins;
          const cand = sh.jokers.map((d, i) => [d, i]).filter(x => x[0]).sort((a, b) => b[0].r - a[0].r);
          for (const it of cand) {
            if (S.jokers.length >= S.jokerMax) break;
            const p = RG.jokerPrice(it[0]);
            // save 模式：只买稀有/传说，攒钱不买便宜货
            if (mode === 'save' && it[0].r < 2) continue;
            if (S.coins < p + 2) continue;
            RG.buyJoker(it[1]);
          }
          const strong = ['顺子', '同花', '葫芦', '四条', '三条'];
          const up = sh.upgrades.filter(n => strong.indexOf(n) >= 0)[0] || sh.upgrades[0];
          if (mode !== 'save' && up && S.coins >= RG.costOf(40) + 6) RG.buyUpgrade(up);
          if (mode !== 'save' && sh.voucher && S.coins >= RG.costOf(sh.voucher.cost) + 6) RG.buyVoucher();
          if (S.coins < c0) buys++;
        }
        const last = foot.children[foot.children.length - 1];
        last.onclick();
        continue;
      }
      if (/破局|止步/.test(title)) { endTitle = title; foot.children[1].onclick(); break; }
      foot.children[0].onclick();
      continue;
    }
    if (!B || B.done) { if (!timers.length) break; else continue; }
    const key = B.tier + '-' + B.blind;
    if (key !== lastKey) { lastKey = key; blindPlays = 0; }
    if (blindPlays === 0 && B.discardsLeft > 0 && B.hand.length > 6) {
      const order = B.hand.map((c, i) => ({ i: i, v: c.digits.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => a.v - b.v).slice(0, 3).map(o => o.i);
      B.sel = order.slice();
      RG.discardCards();
    } else {
      const bc = RG.bestCombo(B.hand);
      if (!bc) { if (!timers.length) break; else continue; }
      B.sel = bc.idx.slice();
      RG.playCards();
      plays++; blindPlays++;
    }
  }
  // 死在哪一关、差多少
  const fb = RG.blind(), FS = RG.state();
  return {
    plays, buys, endTitle, minCoins, S: FS,
    fail: fb ? { tier: fb.tier, blind: fb.blind, score: fb.score, target: fb.target,
      playsUsed: fb.playsUsed, coins: FS.coins, jokers: FS.jokers.length } : null
  };
}

function runMany(games, mode) {
  const clears = [], scores = [], fails = [];
  const jokerCount = {};
  let wins = 0;
  const offers = {};
  for (let g = 0; g < games; g++) {
    els['rogue'] = makeEl('div'); els['menu'] = makeEl('div'); els['table'] = makeEl('div');
    ['rOverlay', 'rHand', 'rActions', 'rLog', 'rPreview', 'rBlindInfo', 'rJokers',
      'rProgress', 'rTarget', 'rCoins'].forEach(id => els[id] = makeEl('div'));
    timers.length = 0;
    window.Ach._reset();
    let rs = 20261011 + g * 7919;
    const real = Math.random;
    Math.random = function () { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    RG.start({ onExit: function () { } });
    let res;
    try { res = rogueRun(mode, offers); } catch (e) { Math.random = real; console.log('  第 ' + g + ' 局抛错: ' + e.message); continue; }
    Math.random = real;
    clears.push(res.S.blindsCleared);
    scores.push(res.S.totalScore);
    if (res.S.win) wins++;
    if (res.fail) fails.push(res.fail);
    for (const j of res.S.jokers) jokerCount[j.def.id] = (jokerCount[j.def.id] || 0) + 1;
  }
  return { clears, scores, wins, jokerCount, fails, offers };
}

const GAMES = Number(process.argv[3] || 40);
// 目标分整体缩放：用来扫出「机器人通关 ≈ 7/24」的那条曲线
const SCALE = Number(process.env.TIER_SCALE || 1);
if (SCALE !== 1) {
  for (const row of RG.targets) for (let i = 0; i < row.length; i++) row[i] = Math.round(row[i] * SCALE);
}
console.log('\n=== D. 整局模拟（贪心机器人，' + GAMES + ' 局不同随机种子，目标分 ×' + SCALE + '）===');
const allIds = RG.jokers.map(j => j.id);
for (const mode of (process.env.MODES||'buy').split(',')) {
  const r = runMany(GAMES, mode);
  const avg = r.clears.reduce((a, b) => a + b, 0) / r.clears.length;
  const hist = {};
  for (const c of r.clears) hist[c] = (hist[c] || 0) + 1;
  console.log('\n  [' + mode + '] 通关数 平均 ' + avg.toFixed(2) + '/24　通关（走完 24 关）' + r.wins + '/' + r.clears.length +
    ' 局　平均累计得分 ' + Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length));
  const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    console.log('    ' + String(k).padStart(2) + ' 关 ' + '#'.repeat(hist[k]) + ' ' + hist[k] + ' 局');
  }
  // 每一关的阵亡率：死在哪个位置、平均拿到几成目标分
  if (r.fails.length) {
    console.log('  ── 阵亡位置 ──');
    const byPos = {};
    for (const f of r.fails) {
      const k = '第 ' + (f.tier + 1) + ' 轮 · ' + ['小关', '大关', '劫'][f.blind];
      (byPos[k] = byPos[k] || []).push(f);
    }
    const order = Object.keys(byPos).sort((a, b) => byPos[b].length - byPos[a].length);
    for (const k of order) {
      const g2 = byPos[k];
      const ratio = g2.reduce((a, f) => a + f.score / f.target, 0) / g2.length;
      const jk = g2.reduce((a, f) => a + f.jokers, 0) / g2.length;
      const pl = g2.reduce((a, f) => a + f.playsUsed, 0) / g2.length;
      console.log('    ' + k.padEnd(16, ' ') + String(g2.length).padStart(3) + ' 局　' +
        '实际 / 目标 = ' + (ratio * 100).toFixed(0).padStart(4) + '%　用掉出牌 ' + pl.toFixed(1) +
        ' 次　当时手持节令牌 ' + jk.toFixed(1) + ' 张');
    }
  }
  // 每张令牌被机器人买走的次数（看新牌有没有真的进构筑）
  const hot = Object.keys(r.jokerCount).sort((a, b) => r.jokerCount[b] - r.jokerCount[a]);
  console.log('  被买走的节令牌（前 12）：' + hot.slice(0, 12).map(id => id + '×' + r.jokerCount[id]).join('  '));
  const newIds = ['chonglou', 'jishu', 'zhoutian', 'bayin', 'wending'];
  console.log('  新令牌入手次数：' + newIds.map(id => id + '×' + (r.jokerCount[id] || 0)).join('  '));
  console.log('  池内令牌总数 ' + allIds.length + ' 张（新 5 张）');
  const RN=['普通','罕见','稀有','传说'];
  const tot=Object.keys(r.offers).reduce((a,k)=>a+r.offers[k],0);
  console.log('  商店上架次数：' + RN.map((n,i)=>n+' '+r.offers[i]+' ('+(r.offers[i]/tot*100).toFixed(0)+'%)').join('  ') + '　合计 ' + tot);
}
