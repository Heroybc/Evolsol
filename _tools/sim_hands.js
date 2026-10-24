/* 数值校准：按 v2.0 牌库（月号 1–12 单值）重算牌型达成率与期望得分
 * 用法： node _tools/sim_hands.js
 */
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'assets', 'data.js'));
require(path.join(__dirname, '..', 'assets', 'engine.js'));
const E = window.Engine, D = window.DECKS.mode2;

function sample(deck, k) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, k);
}
const ORDER = ['同花顺', '顺子', '四条', '同花', '葫芦', '三条', '两对', '一对', '散牌'];
const N = Number(process.argv[2] || 200000);

function report(label, k) {
  const cnt = {}; let tot = 0, totSum = 0, chips = 0, mult = 0, score = 0;
  for (let i = 0; i < N; i++) {
    const cards = sample(D, k);
    const pool = E.buildPool(cards, 2);
    const hs = E.detectHands(pool);
    if (!hs.length) cnt['散牌'] = (cnt['散牌'] || 0) + 1;
    for (const h of hs) cnt[h] = (cnt[h] || 0) + 1;
    tot += hs.length;
    const sum = E.sum(pool.digits.filter(d => !d.wild).map(d => d.v));
    totSum += sum;
    let c = sum, m = 1;
    for (const h of hs) { c += E.SCORE_TABLE[h].time; m += E.SCORE_TABLE[h].mult; }
    chips += c; mult += m; score += c * m;
  }
  console.log('\n=== ' + label + '（' + k + ' 张，' + (N / 1000) + 'k 次模拟）===');
  for (const key of ORDER) {
    const v = (cnt[key] || 0) / N * 100;
    console.log('  ' + key.padEnd(4, '　').slice(0, 4) + '  ' + v.toFixed(2).padStart(6) + '%');
  }
  console.log('  平均同时成立牌型数 ' + (tot / N).toFixed(2) + '　平均数字和 ' + (totSum / N).toFixed(2));
  console.log('  期望 底分 ' + (chips / N).toFixed(1) + ' × 倍率 ' + (mult / N).toFixed(2) +
    ' → 单次打牌 ' + Math.round(score / N));
}

report('三张 · 朔段（衍 / 衍时）', 3);
report('五张 · 衍时纪闯关', 5);

// 简化的「一关 4 次出牌 + 3 次弃牌」期望，用于校准目标分
function blindExpectation(jokers) {
  let total = 0, runs = 3000;
  for (let r = 0; r < runs; r++) {
    const deck = sample(D, D.length);
    let hand = deck.slice(0, 8), ptr = 8, hands = 4, best = 0;
    const drawn = deck.slice();
    hand = drawn.slice(0, 8); ptr = 8;
    while (hands-- > 0) {
      // 贪心：试所有 5 张组合，取最高分
      let bestCombo = null, bestScore = -1;
      const idx = hand.map((_, i) => i);
      const comb = [];
      (function pick(start, acc) {
        if (acc.length === 5) {
          const cards = acc.map(i => hand[i]);
          const pool = E.buildPool(cards, 2);
          const hs = E.detectHands(pool);
          const sum = E.sum(pool.digits.filter(d => !d.wild).map(d => d.v));
          let c = sum, m = 1;
          for (const h of hs) { c += E.SCORE_TABLE[h].time; m += E.SCORE_TABLE[h].mult; }
          let s = c * m;
          for (const j of jokers) s = j(s, c, m, cards, hs);
          if (s > bestScore) { bestScore = s; bestCombo = acc.slice(); }
          return;
        }
        for (let i = start; i < idx.length; i++) { acc.push(idx[i]); pick(i + 1, acc); acc.pop(); }
      })(0, []);
      best += bestScore;
      bestCombo.sort((a, b) => b - a).forEach(i => hand.splice(i, 1));
      while (hand.length < 8 && ptr < drawn.length) hand.push(drawn[ptr++]);
      if (hand.length < 5) break;
    }
    total += best;
  }
  return total / runs;
}

console.log('\n=== 一关 4 次出牌的期望总分（贪心打法，无商店成长）===');
for (const jk of [[], [x => x * 1.5], [x => x * 1.5 * 2], [x => x * 3 * 2.5]]) {
  console.log('  ' + (jk.length ? jk.map(() => '×').join('1  ') + '1 倍率链' : '无节令牌') +
    ' → ' + Math.round(blindExpectation(jk)));
}
