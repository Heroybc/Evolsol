/* 稀有牌型校准（第二轮）：把阈值标定到「真正稀有」的位置。
 *
 * 关键前提：8 张手牌有 C(8,5)=56 种出法，玩家永远挑最赚的那条。
 * 所以要算的不是「随机 5 张」的达成率，而是 **best-of-56** 的分布。
 * best-of-56 会把达成率抬得很夸张 —— 这就是为什么「6」在本引擎里根本不稀有。
 *
 * 用法： node _tools/sim_rare2.js [次数]
 */
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'assets', 'data.js'));
require(path.join(__dirname, '..', 'assets', 'engine.js'));
const E = window.Engine, D = window.DECKS.mode2;
const N = Number(process.argv[2] || 20000);
const MAXV = 12;

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function runFrom(set, W, s) {
  let len = 0, used = 0;
  for (let v = s; v <= MAXV; v++) {
    if (set.has(v)) len++; else if (used < W) { used++; len++; } else break;
  }
  return len;
}
function longestRun(set, W) { let b = 0; for (let s = 0; s <= MAXV; s++) { const l = runFrom(set, W, s); if (l > b) b = l; } return b; }

/** 一手牌的稀有度指标（含万能位） */
function profile(pool) {
  const real = pool.digits.filter(d => !d.wild);
  const W = pool.wilds;
  const vals = real.map(d => d.v);
  const m = new Map();
  for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
  let mx = 0; for (const v of m.values()) if (v > mx) mx = v;
  const bySeason = {}, cnt = {};
  for (const d of real) {
    (bySeason[d.season] = bySeason[d.season] || []).push(d.v);
    cnt[d.season] = (cnt[d.season] || 0) + 1;
  }
  let sRun = 0, sMax = 0;
  for (const k in bySeason) {
    const l = longestRun(new Set(bySeason[k]), W);
    if (l > sRun) sRun = l;
    if (cnt[k] > sMax) sMax = cnt[k];
  }
  return {
    same: mx + W,               // 同数
    run: longestRun(new Set(vals), W),  // 连顺
    flush: sMax + W,            // 同季数字个数（同花）
    sf: sRun,                   // 同季最长连（同花顺）
    distinct: m.size,           // 覆盖了多少个不同的数字
    n: pool.digits.length
  };
}
// 稀有度排序：同花顺 > 同数 > 连顺 > 同花 > 覆盖度
const sc = x => ((x.sf * 100 + x.same) * 100 + x.run) * 100 + x.flush;

function measure(label) {
  const best = [];
  let sumN = 0, sumDistinct = 0;
  for (let t = 0; t < N; t++) {
    const deck = shuffle(D), hand = deck.slice(0, 8);
    let bp = null, all = [];
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
      for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
        const p = profile(E.buildPool([hand[a], hand[b], hand[c], hand[d2], hand[e]], 2));
        all.push(p);
        if (!bp || sc(p) > sc(bp)) bp = p;
      }
    // 也记录「随便一组」的均值，用来对比 best-of-56 抬了多少
    sumN += bp.n; sumDistinct += bp.distinct;
    best.push({ p: bp, all: all });
  }
  console.log('\n=== ' + label + '（best-of-56，' + (N / 1000) + 'k 次）===');
  console.log('  数字池平均 ' + (sumN / N).toFixed(2) + ' 个数字，覆盖 ' + (sumDistinct / N).toFixed(2) + ' 个不同值（共 13 个）');
  const rate = (name, f) => {
    let h = 0; for (const it of best) if (f(it.p)) h++;
    return { name: name, r: h / N * 100 };
  };
  const rows = [];
  for (let k = 5; k <= 13; k++) rows.push(rate('同数 ≥ ' + k, p => p.same >= k));
  for (let k = 6; k <= 13; k++) rows.push(rate('连顺 ≥ ' + k, p => p.run >= k));
  for (let k = 6; k <= 13; k++) rows.push(rate('同花 ≥ ' + k, p => p.flush >= k));
  for (let k = 6; k <= 10; k++) rows.push(rate('同花顺 ≥ ' + k, p => p.sf >= k));
  rows.push(rate('同数≥7 且 连顺≥8', p => p.same >= 7 && p.run >= 8));
  rows.push(rate('同数≥7 且 同花顺≥7', p => p.same >= 7 && p.sf >= 7));
  rows.push(rate('连顺≥9 且 同花顺≥7', p => p.run >= 9 && p.sf >= 7));
  rows.push(rate('同数≥8 且 连顺≥8 且 同花顺≥6', p => p.same >= 8 && p.run >= 8 && p.sf >= 6));
  for (const r of rows) {
    const bar = '#'.repeat(Math.max(0, Math.round(r.r / 2)));
    console.log('  ' + r.name.padEnd(26, ' ') + r.r.toFixed(3).padStart(8) + '%  ' + bar);
  }
}
measure('衍时纪 · 一手 5 张');
