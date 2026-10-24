/* 一次性校验：核对规则文档 §17.4.1 里「基础倍率池约 17.5 / 稀有档约 5 倍」这句话。
 * 口径与 sim_jokers.js §A 完全一致：8 张手牌取 best-of-56，按分数挑。
 * 用法： node _tools/_chk_pool.js [次数]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
function makeEl(tag) {
  return {
    tagName: tag, style: {}, children: [], _html: '', textContent: '',
    disabled: false, scrollTop: 0, scrollHeight: 0, onclick: null, value: '3', className: '', id: '',
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
global.setTimeout = function () { return 0; };
global.addEventListener = function () { };
global.navigator = { userAgent: 'node' };
global.localStorage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
for (const f of ['assets/data.js', 'assets/engine.js', 'assets/fx.js', 'assets/toy.js', 'assets/ach.js', 'assets/rogue.js', 'assets/game.js']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
const E = window.Engine, D = window.DECKS.mode2;
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const N = Number(process.argv[2] || 20000);
let cs = 0, rs = 0, all = 0, n = 0, nRare = 0, nAny = 0;
for (let t = 0; t < N; t++) {
  const hand = shuffle(D).slice(0, 8);
  let best = null;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
    for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
      const pool = E.buildPool([hand[a], hand[b], hand[c], hand[d2], hand[e]], 2);
      const hands = E.detectHands(pool);
      let ds = 0; for (const d of pool.digits) if (!d.wild) ds += d.v;
      let chips = ds, mult = 1;
      for (const h of hands) { chips += E.SCORE_TABLE[h].time; mult += E.SCORE_TABLE[h].mult; }
      const sc = chips * mult;
      if (!best || sc > best.sc) best = { sc: sc, hands: hands, mult: mult };
    }
  let cm = 0, rm = 0;
  for (const h of best.hands) {
    if (E.RARE_HANDS.indexOf(h) >= 0) rm += E.SCORE_TABLE[h].mult; else cm += E.SCORE_TABLE[h].mult;
  }
  cs += cm; rs += rm; all += best.mult; n++;
  if (rm > 0) nRare++;
}
console.log('样本 ' + n + ' 手（best-of-56，按分数挑）');
console.log('  古典运值之和 平均 ' + (cs / n).toFixed(2));
console.log('  稀有运值之和 平均 ' + (rs / n).toFixed(2));
console.log('  整条倍率池   平均 ' + (all / n).toFixed(2) + '（= 1 + 古典 + 稀有）');
console.log('  稀有占比     ' + (100 * rs / (cs + rs)).toFixed(1) + '%　（有稀有牌型的手占 ' + (100 * nRare / n).toFixed(1) + '%）');
console.log('  稀有 / 古典  = ' + (rs / cs).toFixed(2) + ' 倍');

// ---- 「为什么没有 六同 / 六连顺 / 六连同花顺 / 六张同花」这句话的实测底数 ----
// 这里必须自己实现判定：engine 只导出了稀有档（>=7 同 / >=11 连）的谓词，没有导出 6 档的。
function maxSame(p) {
  const m = {};
  for (const d of p.digits) if (!d.wild) m[d.v] = (m[d.v] || 0) + 1;
  let x = 0; for (const k in m) if (m[k] > x) x = m[k];
  return x + p.wilds;
}
function hasRun(p, n) {
  const s = new Set(); for (const d of p.digits) if (!d.wild) s.add(d.v);
  for (let st = 0; st + n - 1 <= 12; st++) {
    let need = 0; for (let i = 0; i < n; i++) if (!s.has(st + i)) need++;
    if (need <= p.wilds) return true;
  }
  return false;
}
function maxFlush(p) {
  const m = {};
  for (const d of p.digits) if (!d.wild) m[d.season] = (m[d.season] || 0) + 1;
  let x = 0; for (const k in m) if (m[k] > x) x = m[k];
  return x + p.wilds;
}
function hasSFRun(p, n) {
  for (const season of ['春', '夏', '秋', '冬']) {
    const s = new Set();
    for (const d of p.digits) if (!d.wild && d.season === season) s.add(d.v);
    for (let st = 0; st + n - 1 <= 12; st++) {
      let need = 0; for (let i = 0; i < n; i++) if (!s.has(st + i)) need++;
      if (need <= p.wilds) return true;
    }
  }
  return false;
}
const TESTS = [
  ['六同', p => maxSame(p) >= 6],
  ['六连顺', p => hasRun(p, 6)],
  ['六连同花顺', p => hasSFRun(p, 6)],
  ['六张同花', p => maxFlush(p) >= 6],
  ['七同', p => maxSame(p) >= 7]
];
const raw = {}, sel = {};
for (const [nm] of TESTS) { raw[nm] = 0; sel[nm] = 0; }
for (let t = 0; t < N; t++) {
  const hand = shuffle(D).slice(0, 8);
  const p5 = E.buildPool(hand.slice(0, 5), 2);
  for (const [nm, f] of TESTS) if (f(p5)) raw[nm]++;
  // best-of-56：按分数挑出玩家真会打的那一手，再判一次
  let bp = null, bs = -1;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
    for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
      const pool = E.buildPool([hand[a], hand[b], hand[c], hand[d2], hand[e]], 2);
      const hands = E.detectHands(pool);
      let ds = 0; for (const d of pool.digits) if (!d.wild) ds += d.v;
      let chips = ds, mult = 1;
      for (const h of hands) { chips += E.SCORE_TABLE[h].time; mult += E.SCORE_TABLE[h].mult; }
      if (chips * mult > bs) { bs = chips * mult; bp = pool; }
    }
  for (const [nm, f] of TESTS) if (f(bp)) sel[nm]++;
}
console.log('  6 档候选：5 张随机出牌 / best-of-56 两种口径的成立率');
for (const [nm] of TESTS) {
  console.log('    ' + nm + '\t' + (100 * raw[nm] / N).toFixed(1) + '%\t/ ' + (100 * sel[nm] / N).toFixed(1) + '%');
}

// 文档 §17.4.1 说「5 张牌会摊出约 14.6 个数字」——顺手核一下（含万能位）
let dg = 0, dgRaw = 0, h3 = 0;
for (let t = 0; t < N; t++) {
  const h5 = shuffle(D).slice(0, 5);
  const p = E.buildPool(h5, 2);
  dg += p.digits.length;
  dgRaw += h5.reduce((s, c) => s + (c.digits ? c.digits.length : 0), 0);
  const hh = shuffle(D).slice(0, 3);
  h3 += E.detectHands(E.buildPool(hh, 2)).length;
}
console.log('  5 张池数字个数 平均 ' + (dg / N).toFixed(2) + '（不含万能位 ' + (dgRaw / N).toFixed(2) + '）');
console.log('  3 张池同时成立牌型 平均 ' + (h3 / N).toFixed(2));
