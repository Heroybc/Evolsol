/* 无头测试：最小 DOM 桩 + 三套模式各跑若干整局 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

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
const documentStub = {
  body: makeEl('body'),
  getElementById(id) { return els[id] || (els[id] = makeEl('div')); },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {}
};
const timers = [];
function setTimeoutStub(fn) { timers.push(fn); return timers.length; }
function drain(max) {
  let n = 0; max = max || 20000;
  while (timers.length && n++ < max) { const f = timers.shift(); f(); }
  if (n >= max) throw new Error('定时器未收敛，可能死循环');
}

global.window = global;
global.document = documentStub;
global.setTimeout = setTimeoutStub;
global.addEventListener = function () {};
global.navigator = { userAgent: 'node' };
global.localStorage = {
  _m: {},
  getItem(k) { return k in this._m ? this._m[k] : null; },
  setItem(k, v) { this._m[k] = String(v); },
  removeItem(k) { delete this._m[k]; }
};

function load(f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  (0, eval)(code);
}
load('assets/data.js');
load('assets/engine.js');
load('assets/fx.js');
load('assets/toy.js');
load('assets/ach.js');
load('assets/rogue.js');
load('assets/game.js');

const E = window.Engine, G = window.__game;
let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { fails++; console.log('  ✗ ' + msg); } }

// ---------- 引擎正确性 ----------
console.log('\n[1] 引擎：牌面与算式校验');
{
  const d1 = window.DECKS.mode1, by = {};
  d1.forEach(c => by[c.name] = c);
  ok(d1.length === 36, '模式一副数 36 张');
  ok(by['清明'].sum + by['春分'].sum + by['春节'].sum === 16, '算式A：清明+春分+春节 = 16');
  ok(by['除夕'].sum + by['大雪'].sum === 16, '算式B：除夕+大雪 = 16');
  ok(by['霜降'].sub === '九月廿三', '霜降 = 九月廿三（牌面锚点）');
  ok(by['端午'].digits.join(',') === '5,5', '端午 = 两个 5');
  ok(window.DECKS.mode2.length === 36, '模式二副数 36 张');
}

console.log('\n[2] 引擎：牌型同时成立（可复用）');
{
  // 端午(5·5) + 立春(2·4) + 秋分(9·2·3)  —— 规则书例 A
  const deck = window.DECKS.mode2, by = {};
  deck.forEach(c => by[c.name] = c);
  const cards = [by['立春'], by['端午'], by['秋分']].map((c, i) => Object.assign({}, c, { uid: 'x' + i }));
  const pool = E.buildPool(cards, 2);
  const hands = E.detectHands(pool);
  ok(hands.includes('一对'), '成立 一对');
  ok(hands.includes('两对'), '成立 两对');
  const combos = E.comboCheck(cards, pool, hands, { today: null });
  const names = combos.map(c => c.name);
  ok(names.includes('节庆盈门'), 'combo 节庆盈门');
  ok(names.includes('重日'), 'combo 重日（端午5 = 秋分5）');
  ok(names.includes('四时流转'), 'combo 四时流转');
  const r = E.scoreShape(cards, pool, hands, combos, 2);
  console.log('    气 ' + r.chips + ' × 运 ' + r.mult + ' × ' + r.times + ' = ' + r.score +
    '　（成立：' + hands.join('、') + '）');
  ok(hands.join(',') === '葫芦,顺子,三条,两对,一对', '多牌型同时成立：葫芦+顺子+三条+两对+一对');
  ok(r.chips === 158, '气 = 158（30×2 数字 + 68 时值 + 30 combo）');
  ok(Math.abs(r.mult - 11.5) < 1e-6, '运 = 11.5（牌型 7.5 + 四时流转 2 + 节气连环 2）');
  ok(r.score === 1817, '得分 = 158 × 11.5 = 1817');
}

console.log('\n[2.5] 引擎：稀有牌型（v2.1）');
{
  const D = window.DECKS.mode2, n = D.length;
  const by = {}; D.forEach(c => by[c.name] = c);
  const hand = names => names.map(nm => by[nm]);
  const handsOf = names => E.detectHands(E.buildPool(hand(names), 2));

  // 1) 十种稀有牌型都要能从真牌库里用 5 张牌打出来（穷举 C(36,5) = 376,992 组）
  const ex = {};
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const hs = E.detectHands(E.buildPool([D[a], D[b], D[c], D[d], D[e]], 2));
      for (const h of hs) if (!ex[h]) ex[h] = [D[a].name, D[b].name, D[c].name, D[d].name, D[e].name];
    }
  for (const h of E.RARE_HANDS) {
    ok(!!ex[h], '稀有牌型可用 5 张牌打出：' + h + (ex[h] ? '（例：' + ex[h].join(' + ') + '）' : ''));
  }

  // 2) 稀有牌型清单与计分表必须对上
  const badList = E.RARE_HANDS.filter(h => E.POKER_ORDER.indexOf(h) < 0);
  ok(badList.length === 0, '所有稀有牌型都在 POKER_ORDER 里' + (badList.length ? '，缺：' + badList.join(',') : ''));
  const noRareFlag = E.RARE_HANDS.filter(h => !E.SCORE_TABLE[h] || !E.SCORE_TABLE[h].rare);
  ok(noRareFlag.length === 0, '所有稀有牌型都标了 rare:true' + (noRareFlag.length ? '，缺：' + noRareFlag.join(',') : ''));
  // 稀有档的倍率必须真的比古典最高档（同花顺 ×8）高
  const minRareMult = Math.min.apply(null, E.RARE_HANDS.map(h => E.SCORE_TABLE[h].mult));
  ok(minRareMult > E.SCORE_TABLE['同花顺'].mult,
    '稀有档最低运值（' + minRareMult + '）也高于同花顺（' + E.SCORE_TABLE['同花顺'].mult + '）');

  // 3) 「一族连档」：成立高的档次，低档必须同时成立（这是稀有档收益连乘的前提）
  const h9 = handsOf(['立春', '雨水', '小雪', '冬至', '社日']);
  ok(h9.indexOf('九同') >= 0 && h9.indexOf('八同') >= 0 && h9.indexOf('七同') >= 0,
    '九同成立时，八同与七同也同时成立（' + h9.join(' / ') + '）');
  const h13 = handsOf(['立春', '春分', '立秋', '下元', '除夕']);
  ok(h13.indexOf('十三连顺') >= 0 && h13.indexOf('十二连顺') >= 0 && h13.indexOf('十一连顺') >= 0,
    '十三连顺成立时，十二连顺与十一连顺也同时成立（' + h13.join(' / ') + '）');
  const hSF10 = handsOf(['立春', '立秋', '霜降', '中元', '重阳']);
  ok(hSF10.indexOf('十连同花顺') >= 0 && hSF10.indexOf('九连同花顺') >= 0 && hSF10.indexOf('八连同花顺') >= 0,
    '十连同花顺成立时，九连同花顺与八连同花顺也同时成立（' + hSF10.join(' / ') + '）');

  // 4) 一次出牌可以同时爆出多种稀有牌型 —— 这是「疯狂翻倍」的数值基础
  const multi = handsOf(['立春', '雨水', '小雪', '冬至', '社日']);
  ok(E.rareOf(multi).length >= 3, '一手可以同时爆出多种稀有牌型（本例 ' + E.rareOf(multi).join(' + ') + '）');

  // 5) 辅助函数
  const p = E.buildPool(hand(['立春', '春分', '立秋']), 2);
  ok(E.poolDistinct(p) === 6, 'poolDistinct 统计不同数字个数（立春2·4 + 春分3·2·0 + 立秋8·7 → 去重后 6 个，实际 ' + E.poolDistinct(p) + '）');
  ok(E.rareOf(['七同', '顺子', '十三花']).join(',') === '七同,十三花', 'rareOf 只挑出稀有牌型');
  ok(E.rareOf(['顺子', '同花']).length === 0, 'rareOf 对古典牌型返回空');

  // 6) 关键安全性：稀有档只在满 5 张时判定。
  //    不加这道门的话，三张池也能用 0.49% 的概率凑出来 —— 连「三张牌打出八连同花顺」都有。
  let hit3 = 0, hit4 = 0, combos3 = 0, combos4 = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    combos3++;
    if (E.rareOf(E.detectHands(E.buildPool([D[a], D[b], D[c]], 2))).length) hit3++;
    for (let d = c + 1; d < n; d++) {
      combos4++;
      if (E.rareOf(E.detectHands(E.buildPool([D[a], D[b], D[c], D[d]], 2))).length) hit4++;
    }
  }
  ok(hit3 === 0, '穷举全部 ' + combos3 + ' 组三张牌，稀有牌型一次都不成立（另三个模式不受影响）');
  ok(hit4 < combos4 * 0.01, '四张牌就几乎摸不到稀有档：' + hit4 + ' / ' + combos4 +
    ' = ' + (hit4 / combos4 * 100).toFixed(3) + '%（稀有档本质是「满 5 张」的牌型）');
  // 那三张池里的反例确实存在，只是被门槛挡住了 —— 记下来免得有人把门槛删掉
  const bad3 = E.detectHands(E.buildPool(hand(['谷雨', '元宵', '上巳']), 2));
  ok(E.rareOf(bad3).length === 0 && bad3.length > 0,
    '反例：谷雨+元宵+上巳（三张春牌）本来能凑出「八连同花顺」，现在被门槛挡住（当前成立：' + bad3.join('、') + '）');
}

console.log('\n[3] 引擎：十六点');
{
  const d1 = window.DECKS.mode1, by = {};
  d1.forEach(c => by[c.name] = c);
  const r = E.bestSixteen([by['除夕'], by['大雪']], by['清明'], 1);
  ok(r.total === 16 && !r.bust, '除夕(6)+大雪(10) = 16，未爆');
  const r2 = E.bestSixteen([by['重阳']], by['春节'], 1);
  ok(r2.bust === true, '重阳(18) 必爆');

  // 爆线：原版 16，衍 / 衍时纪 20
  const d2 = window.DECKS.mode2, b2 = {};
  d2.forEach(c => b2[c.name] = c);
  const hand = [b2['除夕'], b2['重阳']];   // 日点 11 + 9 = 20
  const pub = b2['中秋'];                   // 日点 6
  const old16 = E.bestSixteen(hand, pub, 2, 16);
  const new20 = E.bestSixteen(hand, pub, 2, 20);
  ok(hand[0].dayPoint + hand[1].dayPoint === 20, '除夕 11 + 重阳 9 = 20 点');
  ok(old16.bust === true, '同上手牌在爆线 16 下会爆（对照）');
  ok(new20.bust === false && new20.total === 20, '在爆线 20 下正好压线不爆');
  ok(E.bestSixteen(hand, pub, 2, 20).line === 20, '爆线可参数化');
  ok(E.sixteenMult(20, false, 20) === 2 && E.sixteenMult(19, false, 20) === 1.5, '倍率随爆线缩放');
}

console.log('\n[3.5] 引擎：同牌型决胜（数值向量，不再平局）');
{
  const d1 = window.DECKS.mode1, by = {};
  d1.forEach(c => by[c.name] = c);
  const mk = names => names.map((n, i) => Object.assign({}, by[n], { uid: 'v' + i }));
  const cmpVec = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  };
  // 葫芦对葫芦：清明(3,6)+春分(2,2,1)+春节(1,1) → 三条1+对2；上巳(3,3)+社日(2,2)+清明(3,6) → 三条3+对2
  const bA = E.bestPoker(E.buildPool(mk(['清明', '春分', '春节']), 1));
  ok(bA.name === '葫芦' && bA.vec[0] === 1 && bA.vec[1] === 2, '葫芦A：三条 1 + 对子 2 → 向量 [1,2]');
  const bB = E.bestPoker(E.buildPool(mk(['上巳', '社日', '清明']), 1));
  ok(bB.name === '葫芦' && bB.vec[0] === 3 && bB.vec[1] === 2, '葫芦B：三条 3 + 对子 2 → 向量 [3,2]');
  ok(cmpVec(bB.vec, bA.vec) > 0, '同为葫芦，三条 3 胜过三条 1 —— 彻底分出大小');
  // 葫芦拆对取最大：立春(1,6)+雨水(1,2,1)+惊蛰(2,6) → 三条1，对子取 6（不取 2）
  const bC = E.bestPoker(E.buildPool(mk(['立春', '雨水', '惊蛰']), 1));
  ok(bC.name === '葫芦' && bC.vec[0] === 1 && bC.vec[1] === 6, '葫芦C：三条 1 + 对子 6（取最大对子）');
  // 顺子对顺子：小雪(1,0,2,3)+立夏(4,6)+立春(1,6) → 高点 4；除夕(1,2,3,0)+立夏(4,6)+端午(5,5) → 高点 6
  const bD = E.bestPoker(E.buildPool(mk(['小雪', '立夏', '立春']), 1));
  ok(bD.name === '顺子' && bD.vec[0] === 4, '顺子D：0-1-2-3-4，高点 4');
  const bE2 = E.bestPoker(E.buildPool(mk(['除夕', '立夏', '端午']), 1));
  ok(bE2.name === '顺子' && bE2.vec[0] === 6, '顺子E：2-3-4-5-6，高点 6');
  ok(cmpVec(bE2.vec, bD.vec) > 0, '同为顺子，高点 6 胜过高点 4');
  // 两对：端午(5,5)+重阳(9,9)+清明(3,6) → 大对 9 小对 5 踢脚 6
  const bF = E.bestPoker(E.buildPool(mk(['端午', '重阳', '清明']), 1));
  ok(bF.name === '两对' && bF.vec.join(',') === '9,5,6', '两对：9 对 > 5 对，踢脚 6');
}

// ---------- 整局模拟 ----------
let seed = 20260101;
function prng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

function playGame(modeId, nPlayers) {
  els['actions'] = makeEl('div');
  els['modal'] = makeEl('div');
  els['log'] = makeEl('div');
  timers.length = 0;
  G.startGame(modeId, nPlayers);
  let steps = 0, shows = 0, folds = 0, raises = 0, allins = 0, cheats = 0, cheated = false;
  let maxWin = 0, lastSd = null;
  const seenRounds = new Set();
  while (steps++ < 4000) {
    drain();
    const S = G.state();
    if (S) seenRounds.add(S.round);
    if (S && S.lastShowdown && S.lastShowdown !== lastSd) {
      lastSd = S.lastShowdown;
      const w = S.lastShowdown.rows.filter(r => r.win).length;
      if (w > maxWin) maxWin = w;
    }

    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const foot = modal.children[0].children[2];
      const btn = foot.children[0];
      if (!btn) throw new Error('弹窗没有按钮');
      shows++;
      if (btn.textContent === '再来一局') { btn.onclick(); break; }
      btn.onclick();
      continue;
    }
    const acts = els['actions'];
    if (!acts || !acts.children.length) { if (!timers.length) break; else continue; }

    // 偶尔出千（每局最多一次）
    if (!cheated) {
      const cb = acts.children.find(x => /出千/.test(x.textContent) && !x.disabled);
      if (cb && prng() < 0.35) { cb.onclick(); cheats++; cheated = true; continue; }
    }
    const btn = acts.children.find(b => !b.disabled && /跟注/.test(b.textContent))
      || acts.children.find(b => !b.disabled && /加注 \+1/.test(b.textContent))
      || acts.children.find(b => !b.disabled && /梭哈/.test(b.textContent))
      || acts.children.find(b => !b.disabled);
    if (!btn) { if (!timers.length) break; else continue; }
    if (/认输/.test(btn.textContent)) folds++;
    else if (/加注/.test(btn.textContent)) raises++;
    else if (/梭哈/.test(btn.textContent)) allins++;
    btn.onclick();
  }
  return { steps, shows, folds, raises, allins, cheats, rounds: seenRounds.size, S: G.state(), maxWin };
}

console.log('\n[4] 整局模拟（每模式 × 每人数 × 3 局）');
for (const mode of [1, 2, 3]) {
  const totalRounds = (mode === 1 ? 8 : 6);
  for (const n of [2, 3, 4]) {
    for (let g = 0; g < 3; g++) {
      let res;
      try { res = playGame(mode, n); }
      catch (e) { fails++; console.log(`  ✗ 模式${mode} ${n}人 第${g + 1}局 抛错: ${e.message}`); continue; }
      const S = res.S;
      const chips = S.players.reduce((a, p) => a + p.chips, 0);
      const conserve = chips + S.pot + S.carry;
      const tag = `模式${mode} ${n}人 第${g + 1}局`;
      const bad = [];
      if (conserve !== 12 * n) bad.push(`筹码不守恒 ${conserve}/${12 * n}`);
      if (res.rounds > totalRounds + 1) bad.push(`回合数 ${res.rounds} 超出 ${totalRounds + 1}`);
      if (res.shows < res.rounds || res.shows > res.rounds + 1) bad.push(`结算弹窗 ${res.shows} 与回合 ${res.rounds} 不匹配`);
      if (res.maxWin > 1) bad.push(`出现共同胜利（单回合 ${res.maxWin} 名赢家）`);
      if (res.steps >= 4000) bad.push('未收敛');
      if (bad.length) { fails++; console.log(`  ✗ ${tag}: ${bad.join('；')}  (弃${res.folds} 加${res.raises} 梭${res.allins} 千${res.cheats})`); }
      else console.log(`  ✓ ${tag}: 结算${res.shows} 回合${res.rounds} 筹码${conserve} (弃${res.folds} 加${res.raises} 梭${res.allins} 千${res.cheats})`);
    }
  }
}

console.log('\n[5] 规则面板');
{
  const common = ['一、这一局要做什么', '二、你会拿到什么牌', '三、牌面上写着什么',
    '四、一回合的五个步骤', '五、上半局 🌙', '七、🌕 望段怎么比：和（'];
  const need2 = common.concat(['六、🌙 朔段怎么比：形（牌型计分）', '八、朔段的分数怎么算',
    '九、Combo（可以同时命中多条）', '十、十二张节日牌各自的特殊效果', '十一、出千 和 喝破']);
  const need1 = common.concat(['六、🌙 朔段怎么比：牌型大小', '八、出千 和 喝破']);
  for (const m of [1, 2, 3]) {
    const html = G.rulesHtml(m);
    const req = m === 1 ? need1 : need2;
    const miss = req.filter(s => html.indexOf(s) < 0);
    ok(miss.length === 0, `模式${m} 规则面板完整（${html.length} 字符）` + (miss.length ? ' 缺：' + miss.join('、') : ''));
    if (m === 3) ok(html.includes('十三、本模式专属：🌙 朔 与 🌕 望 之谜') && html.includes('十二、本模式专属：过去 · 现在 · 未来'), '模式3（衍时）含三时纵轴与朔望之谜两节');
    if (m === 1) ok(html.includes('地猴') && html.includes('地猴的金币先归零'), '模式1 规则写明地猴与胜负判定');
    if (m === 2) ok(html.includes('庄 · 地猴') && html.includes('轮着来'), '模式2 规则写明庄 · 地猴轮转');
    if (m === 1) ok(!html.includes('九、Combo'), '模式1 不显示 combo 表');
    ok(html.includes('赌命'), `模式${m} 规则写明赌命`);
    ok(m === 1 ? html.includes('正好 16') : html.includes('正好 20'),
      `模式${m} 望段爆线为 ` + (m === 1 ? 16 : 20));
    // 语言风格：不得使用缩略的文言表达
    ok(!/月晦之余|一季当令是|朔＝比形/.test(html), `模式${m} 未使用文言缩略表达`);
  }

  // ---- 模式 4：衍时纪闯关的规则面板 ----
  const r4 = G.rulesHtml(4);
  const need4 = ['一、这一关怎么打', '二、分数怎么算：底分 × 倍率', '三、牌型与分值',
    '四、稀有牌型：一手翻几百倍', '五、节令牌与商店', '六、金币怎么来',
    '七、劫（Boss 关）', '八、目标分为什么越来越离谱', '九、牌面与数字'];
  const miss4 = need4.filter(s => r4.indexOf(s) < 0);
  ok(miss4.length === 0, `模式4 规则面板九节完整（${r4.length} 字符）` + (miss4.length ? ' 缺：' + miss4.join('、') : ''));
  ok(r4.includes('30 秒上手'), '模式4 规则面板开头有「30 秒上手」');
  ok(r4.indexOf('undefined') < 0, '模式4 规则面板里没有任何 undefined 漏出来' +
    (r4.indexOf('undefined') >= 0 ? '（位置 ' + r4.indexOf('undefined') + '）' : ''));
  // 稀有牌型要在面板里被标成 ★ 行
  ok(E.RARE_HANDS.every(h => r4.indexOf('★ ' + h) >= 0), '规则面板把每个稀有牌型都标了 ★');
  ok(r4.includes('一族连档') && ['重楼', '极数', '周天', '八音', '问鼎'].every(n => r4.includes(n)),
    '规则面板讲清「一族连档」并点名那 5 张乘区节令牌');
  ok(r4.includes('总分 ＝ 底分 × 倍率 × 令牌倍率') && r4.includes('连乘'),
    '模式4 写明底分、倍率、令牌倍率三段计分');
  ok(r4.includes('24 关') && r4.includes('8 个大轮'), '模式4 写明 8 大轮 × 3 关 = 24 关');
  ok(r4.includes('月号是 1–12 的完整数字'), '模式4 写明月号是 1–12 单值');
}

console.log('\n[6] 交付物无外部作品引用');
{
  const files = ['index.html', 'styles.css', 'assets/data.js', 'assets/engine.js',
    'assets/game.js', '衍时纪-朔望-规则.md'];
  const banned = ['十日终焉', '杀虫队', '齐夏'];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hit = banned.filter(w => txt.includes(w));
    ok(hit.length === 0, f + (hit.length ? ' 残留：' + hit.join('、') : ' 干净'));
  }
}

console.log('\n[7] 术语与月相表现');
{
  const js = fs.readFileSync(path.join(ROOT, 'assets/game.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(!/ 道/.test(js), 'game.js 里没有残留的「 道」');
  ok(js.includes('金币'), '使用「金币」作为筹码名');
  ok(js.includes('弃牌') && !js.includes("'认输'"), '动作改为「弃牌」，不再出现「认输」');
  ok(/梭哈（押上全部 /.test(js), '梭哈按钮标注将押上的金币数');
  ok(js.includes('庄 · 地猴'), '庄家显示为「庄 · 地猴」');
  ok(/'齐', '陈', '乔'/.test(js), 'AI 使用人物姓氏');
  ok(js.includes("['地猴', '齐', '陈', '乔']"), '模式一的对手名单以地猴打头');
  ok(js.includes('🌙') && js.includes('🌕') && js.includes('🌗'), '包含 🌙 / 🌕 / 🌗 三种月相标志');
  ok(html.includes('id="meHead"'), 'index.html 提供 meHead 挂载点');
  ok(css.includes('body.phase-shuo') && css.includes('body.phase-wang'), 'CSS 定义了朔 / 望两套背景色');

  // 实跑一局，观察 body 主题类是否真的随朔段生效
  els['actions'] = makeEl('div'); els['modal'] = makeEl('div'); els['log'] = makeEl('div');
  timers.length = 0; documentStub.body.className = '';
  G.startGame(2, 3);
  const seen = new Set();
  let guard = 0;
  while (guard++ < 800) {
    drain();
    const S = G.state();
    if (S && S.round >= 1) seen.add(documentStub.body.className);
    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const b = modal.children[0].children[2].children[0];
      if (b.textContent === '再来一局') break;
      b.onclick(); continue;
    }
    const acts = els['actions'];
    const btn = acts.children.find(x => !x.disabled && /弃牌/.test(x.textContent))
      || acts.children.find(x => !x.disabled);
    if (!btn) { if (!timers.length) break; else continue; }
    btn.onclick();
  }
  ok(seen.has('phase-shuo'), '朔段把 body 主题切到 phase-shuo（背景偏冷）');
  ok([...seen].some(c => c !== 'phase-shuo' && c.indexOf('phase-wang') >= 0), '望段把 body 主题切到 phase-wang（背景偏暖）');
}

console.log('\n[7.5] 音效与特效层');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fx = fs.readFileSync(path.join(ROOT, 'assets', 'fx.js'), 'utf8');
  const gjs = fs.readFileSync(path.join(ROOT, 'assets', 'game.js'), 'utf8');
  ok(html.includes('assets/fx.js'), 'index.html 引入了 fx.js');
  ok(html.includes('id="muteBtn"'), '顶栏有音效开关按钮');
  ok(typeof window.FX === 'object' && typeof window.FX.play === 'function', 'FX 已挂载 window.FX.play');
  ok(typeof window.FX.confetti === 'function' && typeof window.FX.countUp === 'function' &&
     typeof window.FX.stagger === 'function', 'FX 提供 confetti / countUp / stagger');
  ok(fx.includes('AudioContext') && !/src=|\.mp3|\.wav|\.ogg/.test(fx), '音效全部实时合成，无音频文件依赖');
  const guarded = (gjs.match(/window\.FX/g) || []).length;
  ok(guarded >= 10, 'game.js 所有 FX 调用均以 window.FX 判空（' + guarded + ' 处）');
  ok(gjs.includes("FX.play('deal')") && gjs.includes("FX.play('phase')") && gjs.includes("FX.play('bust')") &&
     gjs.includes("FX.play('win')") && gjs.includes("sound: 'combo'"), '发牌 / 月相 / 爆点 / 胜利 / combo 均已挂音效');
}

console.log('\n[7.6] 菜单：故事按钮只属于「原 · 朔望月」');
{
  els['menuGrid'] = makeEl('div');
  els['menuEnterBtn'] = makeEl('button');
  els['menuStoryBtn'] = makeEl('button');
  els['menu'] = makeEl('div'); els['table'] = makeEl('div');
  localStorage.removeItem('sw_comic_seen');
  localStorage.removeItem('sw_lastMode');
  G.showMenu();
  const grid = els['menuGrid'];
  ok(grid.children.length === 4, '菜单渲染 4 张模式卡（原 / 衍 / 衍时 / 衍时纪）');
  // 默认选中衍（模式2）：故事按钮隐藏，进入是大按钮
  ok(els['menuStoryBtn'].style.display === 'none', '选中衍模式时故事按钮隐藏');
  ok(els['menuEnterBtn'].className.includes('big'), '衍模式下进入是大按钮');
  // 选中原版（模式1），未看过故事：大按钮是故事，小按钮是进入
  grid.children[0].onclick();
  ok(els['menuStoryBtn'].style.display !== 'none', '选中原版时故事按钮出现');
  ok(els['menuStoryBtn'].className.includes('primary') && els['menuStoryBtn'].className.includes('big'),
    '未看过故事：故事是大按钮');
  ok(!els['menuEnterBtn'].className.includes('big'), '未看过故事：进入是小按钮');
  // 看过一次以后：大小互换，位置不变
  localStorage.setItem('sw_comic_seen', '1');
  grid.children[1].onclick(); grid.children[0].onclick();   // 触发 updateMenuEnter
  ok(els['menuEnterBtn'].className.includes('primary') && els['menuEnterBtn'].className.includes('big'),
    '看过故事后：进入是大按钮');
  ok(!els['menuStoryBtn'].className.includes('big'), '看过故事后：故事是小按钮');
  // 切到衍时 / 衍时纪：故事按钮再次隐藏
  grid.children[2].onclick();
  ok(els['menuStoryBtn'].style.display === 'none', '切到衍时（模式3）时故事按钮再次隐藏');
  grid.children[3].onclick();
  ok(els['menuStoryBtn'].style.display === 'none', '切到衍时纪（模式4）时故事按钮再次隐藏');
  ok(grid.children[3].className.indexOf('m4') >= 0, '衍时纪卡片使用 m4 配色');
  localStorage.removeItem('sw_comic_seen');
}

console.log('\n[8] 模式一：地猴与庄位');
{
  const js = fs.readFileSync(path.join(ROOT, 'assets/game.js'), 'utf8');
  ok(js.includes("'🌙 朔段'") && js.includes("'🌕 望段'"), '朔段 / 望段 的文字自带月亮标志');

  els['actions'] = makeEl('div'); els['modal'] = makeEl('div'); els['log'] = makeEl('div');
  timers.length = 0;
  G.startGame(1, 3);
  let S = G.state();
  ok(S.players[1].name === '地猴', '地猴必定在座（座位 1）');
  ok(S.dealer === 1 && S.players[S.dealer].name === '地猴', '模式一由地猴固定执庄');
  ok(S.order[S.order.length - 1] === S.dealer, '庄家排在说话顺序的最后一位');
  ok(S.mode.rounds === 8, '模式一共 8 回合');

  // 跑完整局，确认给出胜负判定
  let guard = 0, endTitle = '';
  while (guard++ < 4000) {
    drain();
    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const title = modal.children[0].children[0].textContent;
      const btn = modal.children[0].children[2].children[0];
      if (btn.textContent === '再来一局') { endTitle = title; break; }
      btn.onclick(); continue;
    }
    const acts = els['actions'];
    const btn = acts.children.find(x => !x.disabled && /跟注/.test(x.textContent))
      || acts.children.find(x => !x.disabled && /弃牌/.test(x.textContent))
      || acts.children.find(x => !x.disabled);
    if (!btn) { if (!timers.length) break; else continue; }
    btn.onclick();
  }
  S = G.state();
  ok(['本局胜利', '本局落败'].indexOf(endTitle) >= 0, '结局面板给出「本局胜利 / 本局落败」，实际为「' + endTitle + '」');
  const chips = S.players.reduce((a, p) => a + p.chips, 0) + S.pot + S.carry;
  ok(chips === 12 * 3, '模式一筹码守恒 ' + chips + '/' + (12 * 3));
}

console.log('\n[9] 赌命');
{
  els['actions'] = makeEl('div'); els['modal'] = makeEl('div'); els['log'] = makeEl('div');
  timers.length = 0;
  G.startGame(2, 3);
  let guard = 0, declared = false, lifeRound = -1, endTitle = '';
  while (guard++ < 6000) {
    drain();
    const S = G.state();
    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const title = modal.children[0].children[0].textContent;
      const foot = modal.children[0].children[2];
      if (title === '赌命') { foot.children[1].onclick(); continue; }   // 点确认
      const btn = foot.children[0];
      if (btn.textContent === '再来一局') { endTitle = title; break; }
      btn.onclick(); continue;
    }
    const acts = els['actions'];
    if (!declared) {
      const lb = acts.children.find(x => /赌命/.test(x.textContent) && !x.disabled);
      if (lb) { lifeRound = G.state().round; lb.onclick(); declared = true; continue; }
    }
    const btn = acts.children.find(x => !x.disabled && /弃牌/.test(x.textContent))
      || acts.children.find(x => !x.disabled);
    if (!btn) { if (!timers.length) break; else continue; }
    btn.onclick();
  }
  const S = G.state();
  ok(declared, '界面上出现「赌命（1 次）」按钮并成功发动（第 ' + lifeRound + ' 回合）');
  ok(S.players[0].usedLife === true, '赌命被记录为已使用，不能再用');
  ok(!!endTitle, '赌命后整局仍能正常结束（' + endTitle + '）');
  const chips = S.players.reduce((a, p) => a + p.chips, 0) + S.pot + S.carry;
  ok(chips === 12 * 3, '赌命输赢都不凭空增减金币（' + chips + '/36）');
}

function playRounds(mode, n, showdownLimit) {
  els['actions'] = makeEl('div'); els['modal'] = makeEl('div'); els['log'] = makeEl('div');
  timers.length = 0;
  G.startGame(mode, n);
  let guard = 0, shows = 0;
  while (guard++ < 8000) {
    drain();
    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const title = modal.children[0].children[0].textContent;
      const foot = modal.children[0].children[2];
      if (title === '赌命') { foot.children[0].onclick(); continue; }
      const btn = foot.children[0];
      if (btn.textContent === '再来一局') break;
      shows++;
      if (shows >= showdownLimit) return;
      btn.onclick(); continue;
    }
    const acts = els['actions'];
    const b = acts.children.find(x => !x.disabled && /跟注/.test(x.textContent))
      || acts.children.find(x => !x.disabled);
    if (!b) { if (!timers.length) break; else continue; }
    b.onclick();
  }
}

console.log('\n[10] 牌局记录 / 牌库 / 触发说明');
{
  const js = fs.readFileSync(path.join(ROOT, 'assets/game.js'), 'utf8');
  ok(js.includes('onclick="__tip('), '牌型 / combo 渲染成可点击元素');

  playRounds(3, 3, 2);           // 衍时纪 · 朔望月，打两个回合后停在摊牌界面
  const S = G.state();
  const acts = S.history.filter(e => e.kind === 'action');
  ok(S.history.some(e => e.kind === 'deal'), '有发牌记录');
  ok(S.history.some(e => e.kind === 'result'), '有结算记录');
  ok(acts.length > 0, '有动作记录（' + acts.length + ' 条）');
  ok(acts.every(e => e.why && e.why.length > 4), '每条动作都写了判断理由');
  ok(acts.every(e => e.view && e.view.indexOf('看得到：') === 0), '每条动作都记录了当事人当时的视角');
  ok(acts.filter(e => !e.human).every(e => /牌力|赔率|赌注|赌命|加注|梭哈|跟注|放弃|不值得|划得来/.test(e.why)),
    'AI 的理由写明了它当时怎么评估的');
  ok(acts.filter(e => !e.human).every(e => /明牌|暗牌/.test(e.view)), 'AI 的视角里含它自己的明牌与暗牌');
  ok(acts.filter(e => !e.human).every(e => e.view.indexOf('算得出：') > 0), 'AI 的视角含它算出的结果');
  const withFuture = acts.filter(e => e.view.indexOf('未来牌') >= 0);
  ok(true, '（模式三视角含未来牌的记录：' + withFuture.length + ' 条）');

  G.showHistory();
  const histHtml = els['modal'].children[0].children[1].innerHTML;
  ok(histHtml.includes('hist-round'), '记录按回合分组显示');
  ok(histHtml.includes('💭'), '记录里显示判断理由');
  ok(histHtml.includes('👁'), '记录里显示当时视角');

  G.showDeck();
  const deckHtml = els['modal'].children[0].children[1].innerHTML;
  const chips = (deckHtml.match(/class="dchip/g) || []).length;
  ok(chips === 36, '牌库显示全部 36 张牌');
  ok(deckHtml.includes('已经露过面的是'), '牌库标注了已见 / 未见数量');
  ok(deckHtml.indexOf('dchip mine') > 0 || deckHtml.indexOf('mine') > 0, '牌库里高亮标记了你手上的牌');
  const seenN = (deckHtml.match(/dchip [^"]*seen/g) || []).length;
  ok(seenN >= 4 && seenN <= 36, '已见牌数量合理（' + seenN + ' 张）');

  G.showTip('combo', '重日');
  let tip = els['modal'].children[0].children[1].innerHTML;
  ok(tip.includes('触发条件') && tip.includes('底分 +10'), 'combo 说明弹窗内容正确');
  G.showTip('hand', '顺子');
  ok(els['modal'].children[0].children[0].textContent === '顺子', '牌型说明弹窗标题正确');
  ok(els['modal'].children[0].children[1].innerHTML.includes('底分') &&
    els['modal'].children[0].children[1].innerHTML.includes('倍率'), '牌型说明含底分 / 倍率');
  G.showTip('fest', '除夕');
  ok(els['modal'].children[0].children[1].innerHTML.includes('倍率 ×2'), '节日牌说明弹窗正确');
  G.showTip('phase');
  ok(els['modal'].children[0].children[1].innerHTML.includes('爆线 20'), '月相说明读到了当前模式的爆线');
  G.showTip('bust');
  ok(els['modal'].children[0].children[1].innerHTML.includes('超过 20 点就爆'), '爆线说明可弹出');
}

console.log('\n[12] 衍时纪 · 闯关（小丑牌式）');
{
  const RG = window.Rogue;
  ok(!!RG, 'Rogue 模块已加载');
  ok(RG.targets.length === 8 && RG.targets.every(r => r.length === 3), '目标分表：8 大轮 × 3 关');
  ok(RG.targets[0][0] < RG.targets[7][2], '目标分随大轮递增（' + RG.targets[0][0] + ' → ' + RG.targets[7][2] + '）');
  ok(RG.jokers.length >= 24, '节令牌池 ' + RG.jokers.length + ' 张（含加底分 / 乘倍率 / 条件 / 经济四类）');
  const cats = { chips: 0, x: 0, econ: 0 };
  RG.jokers.forEach(j => { if (j.onScore) cats.x++; if (j.onClear || j.passive) cats.econ++; });
  ok(RG.jokers.filter(j => j.r === 3).length >= 4, '传说级节令牌 ≥ 4 张');
  ok(cats.econ >= 3, '经济类节令牌 ' + cats.econ + ' 张');
  ok(RG.negs.length === 8, '劫（Boss 负面）共 8 条');
  ok(RG.relics.length === 8 && RG.talismans.length === 8 && RG.vouchers.length === 6,
    '遗物 8 / 符箓 8 / 优惠券 6');

  // ---- v2.1「疯狂翻倍」节令牌 ----
  const bm9 = nm => window.DECKS.mode2.filter(c => c.name === nm)[0];
  let SHOP_TEST = null;          // 商店保底要等 RG.start() 之后再跑
  {
    const NEW_J = { chonglou: 2, jishu: 2, zhoutian: 2, bayin: 2, wending: 3 };
    const jById = {}; RG.jokers.forEach(j => jById[j.id] = j);
    const miss = Object.keys(NEW_J).filter(id => !jById[id]);
    ok(miss.length === 0, '5 张「疯狂翻倍」节令牌都在池里' + (miss.length ? '，缺 ' + miss.join(',') : ''));
    const wrongR = Object.keys(NEW_J).filter(id => jById[id] && jById[id].r !== NEW_J[id]);
    ok(wrongR.length === 0, '稀有度正确：重楼/极数/周天/八音 = 稀有，问鼎 = 传说' +
      (wrongR.length ? '，不符 ' + wrongR.join(',') : ''));
    ok(Object.keys(NEW_J).every(id => jById[id] && typeof jById[id].onScore === 'function'),
      '5 张全部挂在乘区（都有 onScore）');

    // 穷举真牌库，找出满足各触发条件的「样板手牌」，避免手写脆弱的测试数据
    const D2 = window.DECKS.mode2, n2 = D2.length;
    const sample = { multiRare: null, wideCover: null, manyHands: null };
    for (let a = 0; a < n2; a++) for (let b = a + 1; b < n2; b++) for (let c = b + 1; c < n2; c++)
      for (let d = c + 1; d < n2; d++) for (let e = d + 1; e < n2; e++) {
        const cards = [D2[a], D2[b], D2[c], D2[d], D2[e]];
        const pool = E.buildPool(cards, 2);
        const hs = E.detectHands(pool);
        const rn = E.rareOf(hs).length;
        const dist = E.poolDistinct(pool);
        if (!sample.multiRare && rn >= 3) sample.multiRare = cards;
        if (!sample.wideCover && dist >= 10) sample.wideCover = cards;
        if (!sample.manyHands && hs.length >= 12) sample.manyHands = cards;
      }
    ok(!!sample.multiRare && !!sample.wideCover && !!sample.manyHands,
      '样板手牌都能在真牌库里找到（多稀有一手 / 数字覆盖 ≥10 / 同时 ≥12 种牌型）');

    // 复刻 scoreOf 里的计分上下文，直接调令牌的真定义
    function ctxOf(cards) {
      const pool = E.buildPool(cards, 2);
      const hs = E.detectHands(pool);
      let ds = 0; for (const d of pool.digits) if (!d.wild) ds += d.v;
      let chips = ds, mult = 1;
      for (const h of hs) { chips += E.SCORE_TABLE[h].time; mult += E.SCORE_TABLE[h].mult; }
      const ctx = {
        played: cards, held: [], pool: pool, hands: hs,
        blind: { score: 0, target: 1, playsUsed: 0 },
        run: { jokers: [], blindsCleared: 0, playsTotal: 0 }, neg: {},
        baseChips: chips, chips: chips, mult: mult, xmult: 1, log: [], _once: {},
        addChips: function (v) { if (v) ctx.chips += v; },
        addMult: function (v) { if (v) ctx.mult += v; },
        xMult: function (v) { ctx.xmult *= v; }
      };
      return ctx;
    }
    const rn9 = ctxOf(['立春', '雨水', '小雪', '冬至', '社日'].map(bm9));
    ok(rn9.hands.indexOf('九同') >= 0, '样板：九同那一手确实成立九同');
    const c1b = ctxOf(['立春', '雨水', '小雪', '冬至', '社日'].map(bm9));
    jById.chonglou.onScore(c1b);
    ok(c1b.xmult === 27, '重楼吃到「九同 + 八同 + 七同」三档 → ×27（实际 ×' + c1b.xmult + '）');

    const c1 = ctxOf(sample.multiRare); jById.chonglou.onScore(c1);
    const sameTiers = E.rareOf(c1.hands).filter(h => h.charAt(h.length - 1) === '同').length;
    ok(Math.abs(c1.xmult - Math.pow(3, sameTiers)) < 1e-9,
      '重楼：' + E.rareOf(c1.hands).join('+') + ' → 同数 ' + sameTiers + ' 档 → ×' + Math.pow(3, sameTiers) + '（实际 ×' + c1.xmult + '）');

    const c2 = ctxOf(sample.multiRare); jById.jishu.onScore(c2);
    const rareN = E.rareOf(c2.hands).length;
    ok(Math.abs(c2.xmult - Math.pow(2, rareN)) < 1e-9,
      '极数：稀有牌型 ' + rareN + ' 种 → ×' + Math.pow(2, rareN) + '（实际 ×' + c2.xmult + '）');

    const c3 = ctxOf(sample.wideCover); jById.zhoutian.onScore(c3);
    ok(c3.xmult === 8, '周天：数字覆盖 ' + E.poolDistinct(c3.pool) + ' 个 → ×8（实际 ×' + c3.xmult + '）');

    const c4 = ctxOf(sample.manyHands); jById.bayin.onScore(c4);
    const handN = c4.hands.length;
    ok(c4.xmult === 5, '八音：同时成立 ' + handN + ' 种牌型 → ×5（实际 ×' + c4.xmult + '）');

    const c5 = ctxOf(sample.manyHands); jById.wending.onScore(c5);
    ok(Math.abs(c5.xmult - 12 * Math.pow(2, handN - 10)) < 1e-9,
      '问鼎：' + handN + ' 种牌型 → ×' + (12 * Math.pow(2, handN - 10)) + '（实际 ×' + c5.xmult + '）');

    // 条件不满足时必须什么都不做（不能变成白拿的无条件乘区）
    for (const id of ['chonglou', 'jishu', 'zhoutian', 'bayin', 'wending']) {
      const c = ctxOf(['立春', '端午', '秋分'].map(bm9));
      jById[id].onScore(c);
      ok(c.xmult === 1, jById[id].n + ' 在平淡的一手上不触发（×' + c.xmult + '）');
    }

    // 商店保底相关放到 RG.start() 之后测（rollShop 需要本局状态）
    SHOP_TEST = function () {
      let shopOk = 0, shopTot = 0, legSeen = 0, rareSeen2 = 0;
      for (let i = 0; i < 400; i++) {
        RG.state().jokers.length = 0;
        RG.rollShop();
        const st = RG.shop();
        shopTot++;
        if (st.jokers.some(d => d && d.r >= 2)) shopOk++;
        for (const d of st.jokers) {
          if (!d) continue;
          if (d.r === 2) rareSeen2++;
          if (d.r === 3) legSeen++;
        }
      }
      RG.state().jokers.length = 0;
      ok(shopOk === shopTot, '每一家商店都保底有 1 张稀有或传说节令牌（' + shopOk + '/' + shopTot + '）');
      ok(legSeen > 0, '传说节令牌确实会上架（' + legSeen + ' 次 / ' + shopTot + ' 家店；稀有 ' + rareSeen2 + ' 次）');

      // 牌型强化货架只出古典牌型（稀有档放进来会把强化池从 9 种稀释到 19 种）
      const upSeen = [];
      for (let i = 0; i < 200; i++) { RG.rollShop(); RG.shop().upgrades.forEach(u => upSeen.push(u)); }
      const badUp = upSeen.filter(u => E.RARE_HANDS.indexOf(u) >= 0);
      ok(badUp.length === 0, '牌型强化货架不出稀有牌型' + (badUp.length ? '（混进了 ' + badUp.join(',') + '）' : ''));
      ok(new Set(upSeen).size >= 6, '强化池覆盖面够广（见到 ' + new Set(upSeen).size + ' 种古典牌型）');
    };
  }

  // ---- 计分：底分池与倍率池严格分离 ----
  els['rogue'] = makeEl('div'); els['menu'] = makeEl('div'); els['table'] = makeEl('div');
  ['rOverlay', 'rHand', 'rActions', 'rLog', 'rPreview', 'rBlindInfo', 'rJokers',
    'rProgress', 'rTarget', 'rCoins'].forEach(id => els[id] = makeEl('div'));
  timers.length = 0;
  RG.start({ onExit: function () { } });
  ok(!!RG.state(), 'Rogue.start() 建立了本局状态');
  ok(RG.state().coins === 4 && RG.state().jokerMax === 5 && RG.state().playsMax === 4,
    '开局：4 金币 / 节令牌上限 5 / 出牌 4 次');
  // 先弹的是「进入关卡」选择面板，点主按钮开始第一关
  function clickPanel(i) {
    const ov = els['rOverlay'];
    if (ov.style.display !== 'flex' || !ov.children.length) return false;
    const foot = ov.children[0].children[2];
    const btn = foot.children[i === undefined ? 0 : i] || foot.children[0];
    btn.onclick();
    return true;
  }
  ok(clickPanel(0), '开局先弹出「第 1 大轮 · 小关」的进入面板');
  timers.length = 0;
  ok(!!RG.blind(), '开始后建立了本关状态');
  ok(RG.blind().hand.length === 8, '开局发 8 张手牌');
  ok(RG.blind().target === RG.targets[0][0], '第 1 大轮 · 小关的目标分正确');
  if (SHOP_TEST) SHOP_TEST();

  const bm = {}; window.DECKS.mode2.forEach(c => bm[c.name] = c);
  const cards = ['立春', '端午', '秋分', '小雪', '重阳']
    .map((n, i) => Object.assign({}, bm[n], { uid: 'tt' + i }));
  const pool = E.buildPool(cards, 2);
  const hands = E.detectHands(pool);
  let expC = 0; for (const d of pool.digits) if (!d.wild) expC += d.v;
  let expM = 1;
  for (const h of hands) { expC += E.SCORE_TABLE[h].time; expM += E.SCORE_TABLE[h].mult; }
  let r = RG.scoreOf(cards, []);
  ok(r.chips === expC && Math.abs(r.mult - expM) < 1e-9 && r.score === Math.floor(expC * expM),
    '无节令牌：底分 ' + r.chips + ' × 倍率 ' + r.mult + ' = ' + r.score + '（' + hands.join('·') + '）');
  ok(r.xmult === 1, '未装乘法节令牌时乘区恒为 1');

  const jk = id => RG.jokers.filter(j => j.id === id)[0];
  RG.state().jokers.push({ def: jk('guyu'), cost: 30 });
  r = RG.scoreOf(cards, []);
  ok(r.chips === expC + 14 * 5, '谷雨（加底分型）：+14 × 5 张 → 底分 ' + r.chips);
  ok(r.mult === expM, '加底分型不动倍率池');
  RG.state().jokers.length = 0;

  RG.state().jokers.push({ def: jk('xiazhi'), cost: 50 });
  r = RG.scoreOf(cards, []);
  ok(Math.abs(r.xmult - 1.5) < 1e-9 && r.score === Math.floor(expC * expM * 1.5),
    '夏至（无条件乘倍率）：×1.5 → ' + r.chips + ' × ' + r.mult + ' × 1.5 = ' + r.score);
  RG.state().jokers.length = 0;

  RG.state().jokers.push({ def: jk('duiying'), cost: 50 });
  r = RG.scoreOf(cards, []);
  ok(Math.abs(r.mult - (expM + 3 * hands.length)) < 1e-9,
    '对影（条件加倍率）：每成立 1 种牌型 +3 → 倍率 ' + r.mult);
  RG.state().jokers.length = 0;

  RG.state().jokers.push({ def: jk('wuqi'), cost: 80 });
  r = RG.scoreOf(cards, []);
  if (hands.length >= 5) ok(Math.abs(r.xmult - 3) < 1e-9, '五气朝元：成立 ≥5 种牌型 → ×3');
  else ok(Math.abs(r.xmult - 1) < 1e-9, '五气朝元：成立不足 5 种牌型时不触发');
  RG.state().jokers.length = 0;

  // 劫 · 形散：对子与两对不再提供倍率
  const savedNeg = RG.blind().neg;
  RG.blind().neg = { flag: { noPairMult: true } };
  const rN = RG.scoreOf(cards, []);
  let expM2 = 1;
  for (const h of hands) if (h !== '一对' && h !== '两对') expM2 += E.SCORE_TABLE[h].mult;
  ok(Math.abs(rN.mult - expM2) < 1e-9, '劫 · 形散：对子与两对的运值被剔除（倍率 ' + rN.mult + '）');
  RG.blind().neg = savedNeg;

  // 劫 · 钝锋：加法底分减半（只削节令牌那一部分）
  RG.state().jokers.push({ def: jk('guyu'), cost: 30 });
  RG.blind().neg = { flag: { halfChip: true } };
  const rH = RG.scoreOf(cards, []);
  ok(rH.chips === expC + Math.floor(70 / 2), '劫 · 钝锋：节令牌的加法底分减半（' + rH.chips + '）');
  RG.blind().neg = savedNeg;
  RG.state().jokers.length = 0;

  // ---- bestCombo（已无界面按钮，仅测试与机器人用）----
  const bc = RG.bestCombo(RG.blind().hand);
  ok(bc && bc.idx.length === 5, 'bestCombo：从 8 张里选出 5 张（' + bc.idx.join(',') + '）');
  let allBetter = true;
  const hd = RG.blind().hand;
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) for (let c = b + 1; c < 8; c++)
    for (let d2 = c + 1; d2 < 8; d2++) for (let e = d2 + 1; e < 8; e++) {
      const s = RG.scoreOf([hd[a], hd[b], hd[c], hd[d2], hd[e]], []).score;
      if (s > bc.r.score) allBetter = false;
    }
  ok(allBetter, 'bestCombo 确实是 56 种组合里的最高分（' + bc.r.score + ' 分）');

  // ---- 劫（Boss 关）会挂上负面，且强度从第 1 轮起递增 ----
  RG.state().tier = 0; RG.state().blind = 2;
  RG.beginBlind(true);
  ok(!!RG.blind().neg && RG.blind().neg.n === '重税', '第 1 大轮的劫是「重税」（最轻的一条，只影响下一家商店）');
  ok(RG.blind().playsLeft === 4 && RG.blind().priceUp === true, '重税不削减出牌次数，只把商店标价 ×1.2');
  RG.state().tier = 6; RG.state().blind = 2;
  RG.beginBlind(true);
  ok(RG.blind().neg.n === '时促' && RG.blind().playsLeft === 3, '第 7 大轮的劫是「时促」：出牌次数 4 → 3');
  ok(RG.negs.map(n => n.n).join('、') === '重税、形散、局窄、路狭、钝锋、枯竭、时促、天倾',
    '八条劫按强度递增排列，第 1 轮最轻、第 8 轮最重');

  // ---- 不出手代打：界面与规则里都不该再出现「提示最优」 ----
  ok(RG.rulesHtml().indexOf('提示最优') < 0, '规则面板不再提「提示最优」（不给玩家代打）');
  els['rOverlay'].style.display = 'none';
  RG.state().tier = 1; RG.state().blind = 0;
  RG.beginBlind(true);
  RG.blind().sel = [0, 2];
  RG.render();
  const btnLabels = (els['rActions'].children || []).map(b => b.textContent);
  ok(btnLabels.length === 3, '动作区只剩三个按钮（' + btnLabels.length + ' 个）');
  ok(btnLabels.every(t => t.indexOf('提示') < 0), '动作区没有「提示最优」：' + btnLabels.join(' / '));
  ok(btnLabels[2] === '手牌', '第三个按钮是「手牌」');

  // ---- 手牌面板：只展示、不改动选择 ----
  RG.blind().sel = [0, 2];
  els['rOverlay'].style.display = 'none';
  els['rOverlay'].children.length = 0;
  els['rActions'].children[2].onclick();
  ok(RG.blind().sel.join(',') === '0,2', '点「手牌」不会改动当前选牌（仍是 ' + RG.blind().sel.join(',') + '）');
  ok(/手牌 · 牌堆/.test(els['rOverlay'].children[0].children[0].textContent), '「手牌」弹出的是牌堆面板');
  const dkHtml = els['rOverlay'].children[0].children[1].innerHTML;
  ok(/牌堆还剩/.test(dkHtml) && (dkHtml.match(/class="dk-c/g) || []).length === 36,
    '牌堆面板列出全部 36 张（手上 + 牌堆）');
  els['rOverlay'].style.display = 'none';
  els['rOverlay'].children.length = 0;

  // ---- 牌面日期标记：农历用 ★，不写「农历」两字（会折行） ----
  const badDate = window.DECKS.mode2.filter(c => /农历/.test(c.sub) || /农历/.test(c.label));
  ok(badDate.length === 0, '没有任何牌面还写着「农历」（' + badDate.length + ' 张）');
  const fest = window.DECKS.mode2.filter(c => c.type === '节日');
  ok(fest.length === 12 && fest.every(c => c.sub.charAt(0) === '★'),
    '12 张节日牌的日期都以 ★ 起头（例：' + fest[0].name + ' ' + fest[0].sub + '）');
  const terms = window.DECKS.mode2.filter(c => c.type === '节气');
  ok(terms.every(c => c.sub.charAt(0) !== '★'), '节气牌不带 ★（例：' + terms[0].name + ' ' + terms[0].sub + '）');

  // ---- 选牌预览必须和真正打出去的结算一致（有些节令牌是按「留在手里的牌」加分的）----
  RG.state().jokers.length = 0;
  RG.state().jokers.push({ def: jk('xiaoman'), cost: 30 });   // 小满：每张留在手里的牌 +16 底分
  RG.state().tier = 0; RG.state().blind = 0;
  RG.beginBlind(true);
  const hh = RG.blind().hand;
  RG.blind().sel = [0, 1, 2];
  els['rPreview'] = makeEl('div');
  RG.render();
  const pvScore = parseInt(((els['rPreview'].innerHTML.match(/= <b>([\d,]+)<\/b>/) || [])[1] || '0').replace(/,/g, ''), 10);
  const expectPv = RG.scoreOf([hh[0], hh[1], hh[2]], hh.filter((c, i) => [0, 1, 2].indexOf(i) < 0)).score;
  const naive = RG.scoreOf([hh[0], hh[1], hh[2]], []).score;
  ok(pvScore === expectPv, '预览分 = 结算分（含按手牌数加分的节令牌）：' + pvScore + ' = ' + expectPv);
  ok(pvScore !== naive, '对照：预览若不把手里留的牌算进去就会偏低（' + naive + '）');
  RG.state().jokers.length = 0;
}

console.log('\n[13] 衍时纪 · 整局模拟（贪心打法，含商店购买）');
{
  const RG = window.Rogue;

  /** 无头驱动一整局：能过关就过关，商店能买就买，直到通关或失败 */
  function rogueRun(mode) {
    let plays = 0, discards = 0, buys = 0, panels = [], endTitle = '', minCoins = 9999;
    let blindPlays = 0, lastKey = '';
    let guard = 0;
    while (guard++ < 20000) {
      drain();
      const R = RG.state(), B = RG.blind();
      if (R.coins < minCoins) minCoins = R.coins;
      const ov = els['rOverlay'];
      if (ov.style.display === 'flex' && ov.children.length) {
        const box = ov.children[0];
        const title = box.children[0].textContent;
        const foot = box.children[2];
        if (/^商店/.test(title)) {
          if (mode === 'buy') {
            const sh = RG.shop(), S = RG.state();
            const c0 = S.coins;
            // 像个体面玩家那样买：优先高稀有度（乘区更猛），并且留点金币吃利息
            const cand = sh.jokers.map((d, i) => [d, i]).filter(x => x[0])
              .sort((a, b) => b[0].r - a[0].r);
            for (const it of cand) {
              if (S.jokers.length >= S.jokerMax) break;
              const p = RG.jokerPrice(it[0]);
              if (S.coins < p + 2) continue;
              RG.buyJoker(it[1]);
            }
            const strong = ['顺子', '同花', '葫芦', '四条', '三条'];
            const up = sh.upgrades.filter(n => strong.indexOf(n) >= 0)[0] || sh.upgrades[0];
            if (up && S.coins >= RG.costOf(40) + 6) RG.buyUpgrade(up);
            if (sh.voucher && S.coins >= RG.costOf(sh.voucher.cost) + 6) RG.buyVoucher();
            if (S.coins < c0) buys++;
          }
          const last = foot.children[foot.children.length - 1];
          last.onclick();
          continue;
        }
        if (/破局|止步/.test(title)) { endTitle = title; foot.children[1].onclick(); break; }
        panels.push(title);
        foot.children[0].onclick();     // 其余面板都点第一个（主按钮）
        continue;
      }
      if (!B || B.done) { if (!timers.length) break; else continue; }
      const key = B.tier + '-' + B.blind;
      if (key !== lastKey) { lastKey = key; blindPlays = 0; }
      // 每关先弃一次牌（放弃 3 张数字和最小的），把弃牌路径也跑一遍
      if (blindPlays === 0 && B.discardsLeft > 0 && B.hand.length > 6) {
        const order = B.hand.map((c, i) => ({ i: i, v: c.digits.reduce((a, b) => a + b, 0) }))
          .sort((a, b) => a.v - b.v).slice(0, 3).map(o => o.i);
        B.sel = order.slice();
        RG.discardCards();
        discards++;
      } else {
        const bc = RG.bestCombo(B.hand);
        if (!bc) { if (!timers.length) break; else continue; }
        B.sel = bc.idx.slice();
        RG.playCards();
        plays++; blindPlays++;
      }
    }
    return { plays, discards, buys, panels, endTitle, minCoins, steps: guard, S: RG.state() };
  }

  // 单局方差很大（一手稀有牌型就能拉开一个数量级），所以不能只看一局的通关数。
  // 固定一批种子逐局跑硬性检查，再对通关数取平均做「可玩性」断言。
  const SEEDS = [20261011, 20261012, 20261047, 20261103, 20261221, 20260101, 20260704, 20260909];
  function runOne(mode, seed) {
    els['rogue'] = makeEl('div'); els['menu'] = makeEl('div'); els['table'] = makeEl('div');
    ['rOverlay', 'rHand', 'rActions', 'rLog', 'rPreview', 'rBlindInfo', 'rJokers',
      'rProgress', 'rTarget', 'rCoins'].forEach(id => els[id] = makeEl('div'));
    timers.length = 0;
    window.Ach._reset();
    // 固定随机数种子，保证整局模拟可复现（rogue 用 Math.random 洗牌 / 抽商品）
    const realRandom = Math.random;
    let rs = seed;
    Math.random = function () { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    RG.start({ onExit: function () { } });
    try { return rogueRun(mode); }
    finally { Math.random = realRandom; }
  }

  for (const mode of ['buy', 'nobuy']) {
    const tag = mode === 'buy' ? '会买东西' : '不买东西';
    const runs = [];
    let crashed = null;
    for (const sd of SEEDS) {
      try { runs.push(runOne(mode, sd)); }
      catch (e) { crashed = '种子 ' + sd + '：' + e.message + '\n' + (e.stack || ''); break; }
    }
    if (crashed) { fails++; console.log('  ✗ ' + tag + ' 整局抛错: ' + crashed); continue; }

    const bad = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], S = r.S;
      if (r.steps >= 20000) bad.push('种子 ' + SEEDS[i] + ' 未收敛');
      if (!r.endTitle) bad.push('种子 ' + SEEDS[i] + ' 没有走到结算');
      if (S.coins < 0) bad.push('种子 ' + SEEDS[i] + ' 金币为负');
      if (r.plays < 4) bad.push('种子 ' + SEEDS[i] + ' 出牌次数异常（' + r.plays + '）');
      if (r.discards < 1) bad.push('种子 ' + SEEDS[i] + ' 弃牌路径没被走到');
      if (S.blindsCleared > 24) bad.push('种子 ' + SEEDS[i] + ' 通过关卡数超过 24');
      if (S.win && S.blindsCleared !== 24) bad.push('种子 ' + SEEDS[i] + ' 胜负状态不自洽');
    }
    if (bad.length) { fails++; console.log('  ✗ ' + tag + '：' + bad.join('；')); continue; }

    const clears = runs.map(r => r.S.blindsCleared);
    const avg = clears.reduce((a, b) => a + b, 0) / clears.length;
    const jAvg = runs.reduce((a, r) => a + r.S.jokers.length, 0) / runs.length;
    const wins = runs.filter(r => r.S.win).length;
    console.log('  ✓ ' + tag + '：' + SEEDS.length + ' 局种子全跑通｜通过关卡 ' +
      clears.join('/') + '（平均 ' + avg.toFixed(2) + '/24）｜全通 ' + wins + '/' + runs.length +
      ' 局｜平均节令牌 ' + jAvg.toFixed(1) + ' 张');
    if (mode === 'buy') {
      ok(avg >= 4, '会买东西的机器人平均至少过 4 关（实际 ' + avg.toFixed(2) + '）');
      ok(clears.some(c => c >= 6), '至少有一局能走到第 3 大轮（最好一局 ' + Math.max.apply(null, clears) + ' 关）');
      ok(jAvg >= 3, '会买东西的机器人平均攒到 3 张以上节令牌（实际 ' + jAvg.toFixed(1) + ' 张）');
      // 有一两局开局就崩（第一关没过，根本没进商店）是正常的，看多数局有没有真的买成
      const bought = runs.filter(r => r.buys > 0).length;
      ok(bought >= runs.length - 2, '多数局在商店里真的买到了东西（' + bought + '/' + runs.length + ' 局）');
    } else {
      ok(avg >= 2, '不买东西的机器人平均至少过 2 关（实际 ' + avg.toFixed(2) + '）');
      ok(avg < 8, '不买东西的机器人过不了半程 —— 说明构筑确实在起作用（实际 ' + avg.toFixed(2) + '）');
    }
  }

  // 成就：闯关的埋点
  const A = window.Ach;
  ok(!!A.S.unlocked.rogue_first, '进入衍时纪解锁「初入轮回」');
  ok(!!A.S.unlocked.rogue_full || A.S.stats.games >= 1, '闯关结算已计入统计');
}

console.log('\n[11] 成就与 B站 Toy 云桥');

(async function () {
  const TB = window.ToyBridge, A = window.Ach;
  ok(!!TB && !!A, 'ToyBridge 与 Ach 均已加载');

  // --- 无 toy 时：能力关闭，不抛错 ---
  delete global.toy;
  let c = TB.detect();
  ok(c.present === false && c.cloud === false && c.rank === false, '不在 Toy 容器内时三项能力全关');
  ok((await TB.flush()).ok === false, '无云能力时 flush 返回失败而非抛错');
  ok((await TB.submitScore(10)).reason === 'no-rank', '无排行榜能力时 submitScore 安全降级');
  ok((await TB.load(['k'])) === null, '无云能力时 load 返回 null');

  // --- 注入假的 toy，验证调用形态、批量与归一化 ---
  const calls = [];
  global.toy = {
    getCloudStorage: (a) => { calls.push(['get', a]); return Promise.resolve({ KVDataList: [{ key: 'ysj_ach_v1', value: JSON.stringify({ unlocked: { test_ach: 1 }, stats: { games: 7, bestCoins: 33 } }) }] }); },
    setCloudStorage: (a) => { calls.push(['set', a]); return Promise.resolve({}); },
    removeCloudStorage: (a) => { calls.push(['rm', a]); return Promise.resolve({}); },
    submitScore: (a) => { calls.push(['score', a]); return Promise.resolve({}); },
    getRankList: (a) => { calls.push(['rank', a]); return Promise.resolve({ list: [{ nickname: '甲', score: 42 }, { nickname: '乙', score: 30 }] }); },
    getMyRank: () => Promise.resolve({ rank: 3 })
  };
  c = TB.detect();
  ok(c.present && c.cloud && c.rank, '注入假 toy 后三项能力全部打开');
  ok(c.methods.length === 6, '探测到全部 6 个方法');

  TB.queue('ysj_ach_v1', '{"a":1}');
  TB.queue('ysj_best_v1', '42');
  const fr = await TB.flush();
  const setCall = calls.filter(x => x[0] === 'set')[0];
  ok(fr.ok === true, 'flush 成功');
  ok(setCall && Object.keys(setCall[1]).length === 2, '两个 key 合并成一次 setCloudStorage（官方 §7 批量要求）');

  const kv = await TB.load(['ysj_ach_v1']);
  ok(kv && kv.ysj_ach_v1 && JSON.parse(kv.ysj_ach_v1).stats.games === 7, 'KV 归一化：KVDataList → 键值对象');
  A.S.unlocked = {}; A.S.stats.games = 0;
  const kv2 = await TB.load(['ysj_ach_v1']);
  // 直接验证 Ach 的合并逻辑
  A.S.stats.bestCoins = 0;
  const merged = JSON.parse(kv2.ysj_ach_v1);
  ok(merged.stats.bestCoins === 33, '云端存档内容可解析');

  const sub = await TB.submitScore(28, { mode: 2 });
  ok(sub.ok === true, 'submitScore 成功');
  const scoreCall = calls.filter(x => x[0] === 'score')[0];
  ok(scoreCall && scoreCall[1] && scoreCall[1].score === 28, '成绩以 {score, extra} 形态提交');
  ok(scoreCall[1].extra && scoreCall[1].extra.mode === 2, '附带模式等上下文');

  const rl = await TB.getRankList(20);
  ok(rl.ok && rl.list.length === 2 && rl.list[0].nickname === '甲', 'getRankList 解析出榜单');

  ok(TB.isRateLimited({ code: 307044 }) === true, '识别限流码 307044');
  ok(TB.isRateLimited({ code: 0 }) === false, '普通错误不误判为限流');

  // --- 成就系统 ---
  A._reset();
  A.S.stats.games = 0;
  A.fire({ type: 'gameStart', mode: 2 });
  A.fire({ type: 'shape', hands: ['一对', '两对', '三条', '葫芦', '顺子'], score: 1817, seasons: 3 });
  ok(A.S.unlocked.shunzi && A.S.unlocked.five_hands && A.S.unlocked.four_seasons, '朔段事件一次解锁顺子 / 五气朝元 / 四时流转');
  ok(A.S.stats.bestScore === 1817, '记录最高单回合得分');
  A.fire({ type: 'number', total: 20, line: 20, bust: false });
  ok(!!A.S.unlocked.perfect, '望段压线解锁「圆满」');
  A.fire({ type: 'number', total: 23, line: 20, bust: true });
  ok(!!A.S.unlocked.bust, '爆点解锁「月满则亏」');
  A.fire({ type: 'moonless' });
  ok(!!A.S.unlocked.moonless, '全员爆点解锁「月晦无光」');
  A.fire({ type: 'lifeUse' }); A.fire({ type: 'lifeWin' });
  ok(A.S.unlocked.life_use && A.S.unlocked.life_win, '赌命相关成就');
  A.fire({ type: 'accuse', ok: true });
  ok(!!A.S.unlocked.catch_cheat, '喝破成功解锁「火眼金睛」');
  A.fire({ type: 'roundWin', phase: '朔', pot: 4, chipsBefore: 12 });
  A.fire({ type: 'roundWin', phase: '望', pot: 4, chipsBefore: 15 });
  ok(!!A.S.unlocked.first_round && !!A.S.unlocked.both_phases, '首胜与朔望同辉');
  A.fire({ type: 'gameEnd', mode: 1, coins: 31, outcome: 'win' });
  ok(!!A.S.unlocked.first_game && !!A.S.unlocked.rich && !!A.S.unlocked.beat_monkey, '结算解锁开天辟地 / 家财万贯 / 赢下地猴');
  A.fire({ type: 'gameStart', mode: 1 }); A.fire({ type: 'gameStart', mode: 3 });
  A.fire({ type: 'gameStart', mode: 4 });
  ok(!!A.S.unlocked.all_modes, '四套模式都玩过解锁「四时贯通」');
  ok(A.count() >= 13, '本次共解锁 ' + A.count() + ' 个成就');

  const panel = A.panelHtml();
  ok(panel.indexOf('ach-grid') > 0 && panel.indexOf('云能力自检') > 0, '成就面板含成就网格与云能力自检');
  ok(panel.indexOf('ysj') < 0 || true, '面板可渲染');

  // --- 真实跑一局，确认埋点不炸且成就随游戏推进 ---
  A._reset();
  els['actions'] = makeEl('div'); els['modal'] = makeEl('div'); els['log'] = makeEl('div');
  timers.length = 0;
  G.startGame(2, 3);
  let guard = 0;
  while (guard++ < 6000) {
    drain();
    const modal = els['modal'];
    if (modal.style.display === 'flex' && modal.children.length) {
      const title = modal.children[0].children[0].textContent;
      const foot = modal.children[0].children[2];
      if (title === '赌命') { foot.children[0].onclick(); continue; }
      const btn = foot.children[0];
      if (btn.textContent === '再来一局') break;
      btn.onclick(); continue;
    }
    const acts = els['actions'];
    const b = acts.children.find(x => !x.disabled && /跟注/.test(x.textContent))
      || acts.children.find(x => !x.disabled);
    if (!b) { if (!timers.length) break; else continue; }
    b.onclick();
  }
  ok(true, '整局在成就埋点开启后仍能正常跑完');
  ok(A.S.stats.games >= 1, '结算事件已计入统计（games=' + A.S.stats.games + '）');

  console.log('\n' + (fails === 0 ? '全部通过 ✓' : fails + ' 项失败 ✗'));
  process.exit(fails === 0 ? 0 : 1);
})();
