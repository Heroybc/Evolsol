/* 《衍时纪 · 朔望》—— 游戏主体
 * 三种模式：
 *   1 原版朔望月   —— 中文数字牌面、前 3 回合比牌型、第 4 回合起比十六点
 *   2 朔望月 · 衍时 —— 2026 历法 + 季/序/数字/日点 + 16 条 combo
 *   3 朔望 · 衍时纪 —— 加过去/现在/未来三时纵轴；朔望规则扣置，庄家可改判（公开机制）
 */
(function () {
  'use strict';
  const E = window.Engine;
  const DECKS = window.DECKS;

  const MODES = {
    1: {
      id: 1, name: '原 · 朔望月', sub: '中文日期 · 单挑地猴 · 爆线 16',
      desc: '和地猴单挑：谁的筹码先输光谁输。前 3 回合比牌型，之后比谁的点数更接近 16，超过 16 直接出局。牌面是中文日期，没有万能牌。',
      rounds: 8, switchAt: 4, deck: 'mode1', bustLine: 16,
      meta: '8 回合 · 第 4 回合换规则 · 2–5 人'
    },
    2: {
      id: 2, name: '衍 · 朔望月', sub: '阿拉伯数字 · 多人博弈 · 爆线 20',
      desc: '在多人赌桌上赢金币：前 3 回合比牌型，后 3 回合比谁的点数更接近 20，超过 20 出局。牌面是 2026 年真实节气，同一批数字能同时凑出多种牌型，全部一起计分。',
      rounds: 6, switchAt: 4, deck: 'mode2', bustLine: 20,
      meta: '6 回合 · 第 4 回合换规则 · 2–5 人'
    },
    3: {
      id: 3, name: '衍时 · 朔望月', sub: '过去 · 现在 · 未来 · 爆线 20',
      desc: '玩法同「衍」，多一条时间轴：下一回合的公共牌提前亮给你看，前两回合的公共牌还能帮你凑 combo。朔、望两套规则扣在桌上，庄家可以偷偷改判一次。',
      rounds: 6, switchAt: 4, deck: 'mode2', bustLine: 20,
      meta: '6 回合 · 三时纵轴 · 2–5 人'
    },
    4: {
      id: 4, name: '衍时纪', sub: '单人闯关 · 构筑倍率 · 8 大轮',
      desc: '一个人打 24 关：每关只有 4 次出牌，把分数打到目标分就过。过关拿金币进商店，买节令牌把「底分 × 倍率」滚成天文数字。稀有牌型能一手翻出几百倍。',
      rounds: 0, switchAt: 0, deck: 'mode2', bustLine: 0, rogue: true,
      meta: '8 大轮 × 3 关 · 单人闯关 · 局内构筑'
    }
  };

  let S = null;
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rnd = n => Math.floor(Math.random() * n);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function ruleName(r) { return r === 'shape' ? '形 · 比牌型' : '和 · 比十六点'; }

  // ============================== 开局 ==============================
  function startGame(modeId, numPlayers) {
    const M = MODES[modeId];
    const deck = DECKS[M.deck].map((c, i) => Object.assign({}, c, { uid: M.deck + '-' + i }));
    // 模式一牌库没有「序」字段：按牌库顺序补齐（节气 = 季内 1-6，节日 = 0），供「比序」决胜使用
    if (modeId === 1) {
      const cnt = {};
      for (const c of deck) {
        if (c.type === '节气') { cnt[c.season] = (cnt[c.season] || 0) + 1; c.order = cnt[c.season]; }
        else c.order = 0;
      }
    }
    // 模式一：地猴必定在座，且永远是你的对手
    const names = modeId === 1 ? ['地猴', '齐', '陈', '乔'] : ['齐', '陈', '乔', '韩', '宋'];
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
      const human = i === 0;
      players.push({
        idx: i, name: human ? '你' : names[i - 1], human: human,
        chips: 12, roundBet: 0, folded: false, out: false, acted: false,
        open: null, hole: null, usedCheat: false, accuseUsed: false,
        lifeBet: false, usedLife: false,
        lastAction: '', penalty: 1
      });
    }
    const monkeyIdx = modeId === 1 ? 1 : -1;     // 地猴固定坐在 1 号位
    let dealerBase;
    if (modeId === 1) dealerBase = 1;            // 原版：地猴永远是庄
    else if (modeId === 3) dealerBase = rnd(numPlayers);   // 衍时：整局固定一位执庄
    else dealerBase = rnd(numPlayers);           // 衍时：庄位逐回合轮转
    S = {
      mode: M, modeId: modeId, deckAll: deck, deck: [],
      players: players, round: 0, pot: 0, carry: 0,
      currentBet: 0, turn: 0, active: [], order: [],
      community: { past: [], present: null, future: null },
      phaseLabel: '', phaseRule: '', phaseHidden: false,
      known: { shuo: null, wang: null },
      mystery: null, dealer: dealerBase, dealerBase: dealerBase,
      monkeyIdx: monkeyIdx, swapsLeft: 0, log: [], lastShowdown: null,
      history: [], today: E.todayCardName(deck), locked: true
    };
    if (modeId === 1) {
      log('开桌：' + M.name + '，' + numPlayers + ' 人，每人 12 金币。');
      log('地猴在座，由它坐庄（庄家每回合最后说话）。', 'warn');
      log('你的目标只有一个：把地猴赢下来。它出局你立刻获胜，你出局立刻落败。', 'warn');
    } else if (modeId === 2) {
      log('开桌：' + M.name + '，' + numPlayers + ' 人，每人 12 金币。');
      log('「庄 · 地猴」的庄位逐回合轮转，人人都有机会执庄（庄家每回合最后说话）。');
      log('本回合执庄：' + players[S.dealer].name + '。');
    } else {
      const flip = Math.random() < 0.5;
      S.mystery = { shuo: flip ? 'shape' : 'number', wang: flip ? 'number' : 'shape' };
      S.swapsLeft = 2;
      log('开桌：' + M.name + '，' + numPlayers + ' 人，每人 12 金币。');
      log('本轮由「庄 · 地猴」坐庄，执庄者是 ' + players[S.dealer].name + '。');
      log('🌙 朔、🌕 望两套规则已经扣置在桌上，谁都不知道哪一个对应哪一套。', 'warn');
      log('「庄 · 地猴」可以改判一次，把朔和望对调 —— 这件事写在明面上，但他改没改，只有他自己知道。', 'warn');
    }
    S.bestRoundScore = 0;
    roLastScore = null; roLastComboKey = ''; roLastBest = null;
    S.achSnapshot = window.Ach ? Object.assign({}, window.Ach.S.unlocked) : {};
    if (window.Ach) window.Ach.fire({ type: 'gameStart', mode: modeId });
    showTable();
    nextRound();
  }

  function log(t, cls) {
    S.log.push({ t: t, cls: cls || '' });
    if (S.log.length > 80) S.log.shift();
  }

  // ============================== 回合 ==============================
  function nextRound() {
    S.round++;
    if (S.round > S.mode.rounds) return endGame();

    if (S.modeId === 3 && S.community.present) {
      S.community.past.unshift(S.community.present);
      if (S.community.past.length > 2) S.community.past.pop();
    }

    S.deck = shuffle(S.deckAll);
    let p = 0;
    for (const pl of S.players) {
      if (pl.out) { pl.open = pl.hole = null; continue; }
      pl.open = S.deck[p++]; pl.hole = S.deck[p++];
      pl.roundBet = 0; pl.folded = false; pl.acted = false;
      pl.lastAction = ''; pl.accuseUsed = false; pl.lifeBet = false;
    }
    if (S.modeId === 3) {
      S.community.present = S.community.future || S.deck[p++];
      S.community.future = S.deck[p++];
    } else {
      S.community.present = S.deck[p++];
    }

    const isShuo = S.round < S.mode.switchAt;
    S.phaseLabel = isShuo ? '朔' : '望';
    if (S.modeId === 3) {
      const k = isShuo ? 'shuo' : 'wang';
      S.phaseRule = S.known[k] || S.mystery[k];
      S.phaseHidden = S.known[k] === null;
    } else {
      S.phaseRule = isShuo ? 'shape' : 'number';
      S.phaseHidden = false;
    }
    S.aiGuess = S.phaseRule;

    // 门票
    let ticket = 0;
    for (const pl of S.players) {
      if (pl.out) continue;
      const pay = Math.min(1, pl.chips);
      pl.chips -= pay; pl.roundBet += pay; ticket += pay;
    }
    S.pot += ticket;
    if (S.carry) { S.pot += S.carry; log('上一回合流局留下的 ' + S.carry + ' 金币滚进本回合的奖池。', 'hi'); S.carry = 0; }

    // 庄位：原版固定为地猴，衍时逐回合轮转，衍时纪整局固定
    if (S.modeId === 2) {
      let d = S.dealerBase, guard = 0;
      while (S.players[(S.dealerBase + S.round - 1 + guard) % S.players.length].out && guard++ < S.players.length) { }
      d = (S.dealerBase + S.round - 1 + guard) % S.players.length;
      S.dealer = d;
    }

    S.currentBet = 1;
    S.active = S.players.filter(x => !x.out);

    // 说话顺序：明牌点数最大者先说，绕一圈，庄家最后收尾
    const val = c => S.modeId === 1 ? c.sum : c.dayPoint;
    let first = 0, bv = -1;
    for (const pl of S.active) { const v = val(pl.open); if (v > bv) { bv = v; first = pl.idx; } }
    const ring = [];
    for (let i = 0; i < S.players.length; i++) ring.push((first + i) % S.players.length);
    S.order = ring.filter(i => !S.players[i].out && i !== S.dealer)
                 .concat(ring.filter(i => !S.players[i].out && i === S.dealer));
    S.turn = S.order[0];

    log('第 ' + S.round + ' 回合 · ' + moonIcon() + ' ' + S.phaseLabel + '段｜奖池 ' + S.pot +
      ' 金币｜' + S.players[first].name + ' 先说话，庄家最后收尾。');
    if (S.phaseHidden) log('本段规则还扣着：' + S.phaseLabel + '段到底比牌型还是比十六点，摊牌时才揭晓。', 'warn');
    if (S.modeId === 2) log('本回合执庄：' + S.players[S.dealer].name + '。');
    record({
      kind: 'deal',
      text: '第 ' + S.round + ' 回合 · ' + moonIcon() + ' ' + S.phaseLabel + '段 开始发行',
      detail: '公共牌是「' + S.community.present.name + '（' + S.community.present.sub + '）」。' +
        '每人交 1 枚金币门票，奖池来到 ' + S.pot + ' 枚。' +
        (S.order && S.order.length ? '说话顺序：' + S.order.map(i => S.players[i].name).join(' → ') + '（庄家 ' +
          S.players[S.dealer].name + ' 压轴）。' : '') +
        (S.phaseHidden ? ' ⚠ 本段规则尚未揭晓。' : '')
    });
    S.locked = true;
    renderAll();
    // 发牌 / 月相变换的音效与特效（只在回合切换这一刻触发）
    if (window.FX) {
      FX.play('deal');
      FX.stagger($('myCards'), '.card', { cls: 'fx-deal', step: 120 });
      FX.stagger($('opponents'), '.card', { cls: 'fx-deal', step: 55 });
      FX.stagger($('timeline'), '.card', { cls: 'fx-deal', step: 80 });
      if (S.round === S.mode.switchAt) {
        FX.play('phase');
        FX.flash('gold');
      }
    }
    setTimeout(step, 420);
  }

  // ============================== 下注 ==============================
  function step() {
    const alive = S.players.filter(x => !x.out && !x.folded);
    if (alive.length <= 1) return showdown();
    // 已经全下（chips 归零）或已赌命的玩家不再阻塞下注轮
    const settled = alive.every(x => x.lifeBet || x.chips <= 0 || (x.roundBet >= S.currentBet && x.acted));
    if (settled) return showdown();

    const pl = S.players[S.turn];
    if (pl.out || pl.folded || pl.chips <= 0 || pl.lifeBet) { advance(); return setTimeout(step, 50); }

    S.locked = false;
    renderAll();
    if (pl.human) {
      renderActions();
    } else {
      S.locked = true;
      renderActions();
      setTimeout(() => aiAct(pl), 560 + rnd(520));
    }
  }

  function advance() {
    if (!S.order || !S.order.length) { S.turn = (S.turn + 1) % S.players.length; return; }
    const i = S.order.indexOf(S.turn);
    for (let k = 1; k <= S.order.length; k++) {
      const t = S.order[(i + k) % S.order.length];
      if (!S.players[t].out) { S.turn = t; return; }
    }
  }

  function humanFold() { act(S.players[0], 'fold', 0, '你选择弃牌，这一回合不跟了。'); }
  function humanCall() { act(S.players[0], 'call', 0, '你选择跟注。'); }
  function humanRaise(n) { act(S.players[0], 'raise', n, '你选择加注施压。'); }
  function humanAllin() { act(S.players[0], 'allin', 0, '你把全部金币一次押上。'); }
  function humanSwap() {
    if (!S.swapsLeft || !S.phaseHidden) return;
    const t = S.mystery.shuo; S.mystery.shuo = S.mystery.wang; S.mystery.wang = t;
    S.mystery.swapped = true; S.swapsLeft--;
    S.phaseRule = S.phaseLabel === '朔' ? S.mystery.shuo : S.mystery.wang;
    S.aiGuess = S.phaseRule;
    log('你改判了朔望。没有人看见。', 'warn');
    renderAll(); renderActions();
  }

  function act(pl, kind, amount, why) {
    if (S.locked && pl.human) return;
    if (pl.folded || pl.out) return;
    S.locked = true;
    const needBefore = Math.max(0, S.currentBet - pl.roundBet);
    let potGain = 0;

    if (kind === 'fold') {
      pl.folded = true; pl.acted = true; pl.lastAction = '弃牌';
      log(pl.name + ' 弃牌。');
    } else if (kind === 'call') {
      const need = Math.min(S.currentBet - pl.roundBet, pl.chips);
      pl.chips -= need; pl.roundBet += need; S.pot += need; potGain = need;
      pl.acted = true; pl.lastAction = need > 0 ? '跟注 ' + need : '跟注';
      log(pl.name + (need > 0 ? ' 跟注 ' + need + ' 金币。' : ' 跟注。'));
    } else if (kind === 'raise') {
      const cap = (S.modeId === 3 && pl.idx === S.dealer) ? 1 : 2;
      const target = S.currentBet + Math.min(amount, cap);
      const need = Math.min(target - pl.roundBet, pl.chips);
      pl.chips -= need; pl.roundBet += need; S.pot += need; potGain = need;
      S.currentBet = Math.max(S.currentBet, pl.roundBet);
      pl.acted = true; pl.lastAction = '加注到 ' + S.currentBet;
      for (const o of S.active) if (o !== pl && !o.folded && o.roundBet < S.currentBet) o.acted = false;
      log(pl.name + ' 加注到 ' + S.currentBet + ' 金币。', 'hi');
    } else if (kind === 'allin') {
      const need = pl.chips;
      pl.chips = 0; pl.roundBet += need; S.pot += need; potGain = need;
      S.currentBet = Math.max(S.currentBet, pl.roundBet);
      pl.acted = true; pl.lastAction = '梭哈 ' + pl.roundBet + ' 金币';
      for (const o of S.active) if (o !== pl && !o.folded && o.roundBet < S.currentBet) o.acted = false;
      log(pl.name + ' 梭哈，把 ' + pl.roundBet + ' 金币全押上！', 'warn');
    } else if (kind === 'life') {
      pl.lifeBet = true; pl.usedLife = true; pl.acted = true;
      pl.lastAction = '赌命';
      log(pl.name + ' 赌命！本回合不再投币，赢则夺人金币，输则当场出局。', 'warn');
      if (pl.idx === 0 && window.Ach) window.Ach.fire({ type: 'lifeUse' });
    }
    record({
      kind: 'action',
      who: pl.name, idx: pl.idx, human: !!pl.human,
      action: actionLabel(kind, amount, pl, needBefore),
      why: why || '',
      view: viewText(pl)
    });
    renderAll();
    // 下注音效与奖池飘字（renderAll 之后锚点才是新的）
    if (window.FX) {
      const snd = { call: 'coin', raise: 'raise', allin: 'allin', fold: 'fold', life: 'life' }[kind];
      if (snd) FX.play(snd);
      if (potGain > 0) FX.floatTextAt($('potChip'), '+' + potGain, 'gold');
    }
    advance();
    setTimeout(step, 300);
  }

  // ============================== AI ==============================
  function aiStrength(pl) {
    const rule = (S.modeId === 3 && S.phaseHidden && pl.idx !== S.dealer && S.dealer !== 0)
      ? S.aiGuess : S.phaseRule;
    if (rule === 'shape') {
      const cards = [pl.open, pl.hole, S.community.present].filter(Boolean);
      const pool = E.buildPool(cards, S.modeId);
      const hands = E.detectHands(pool);
      const combos = combosFor(pl, cards, pool, hands);
      if (S.modeId === 1) {
        const b = E.bestPoker(pool);
        return Math.max(0.05, Math.min(1, b.rank / 8 * 0.9 + Math.random() * 0.15));
      }
      const r = E.scoreShape(cards, pool, hands, combos, S.modeId);
      return Math.max(0.05, Math.min(1, r.score / 900));
    }
    const r = E.bestSixteen([pl.open, pl.hole].filter(Boolean), S.community.present, S.modeId, S.mode.bustLine);
    if (r.bust) return 0.05;
    if (r.total === S.mode.bustLine) return 1;
    if (r.total === S.mode.bustLine - 1) return 0.9;
    if (r.total >= S.mode.bustLine - 3) return 0.72;
    if (r.total >= S.mode.bustLine - 5) return 0.6;
    return 0.35;
  }

  function aiAct(pl) {
    const raw = aiStrength(pl);
    const st = raw * (0.85 + Math.random() * 0.3);
    const need = S.currentBet - pl.roundBet;
    const potOdds = need / Math.max(1, S.pot + need);
    const pct = Math.round(raw * 100) + '%';
    let kind = 'call', amount = 0, why = '';

    if (st < 0.3 && need > 0) {
      kind = 'fold';
      why = '算下来牌力只有 ' + pct + '，还要再掏 ' + need + ' 枚金币去跟，不值得。';
    } else if (st < 0.45 && need > potOdds * 3) {
      kind = 'fold';
      why = '要跟 ' + need + ' 枚，而奖池才 ' + S.pot + ' 枚，赔率太差，放弃。';
    } else if (!pl.usedLife && S.round >= 2 && st > 0.88 && (pl.chips <= 4 || Math.random() < 0.10)) {
      kind = 'life';
      why = '牌力 ' + pct + '，手上只剩 ' + pl.chips + ' 枚，与其慢慢被磨死，不如赌命搏一把。';
    } else if (st > 0.82 && Math.random() < 0.55 && pl.chips > need + 1) {
      kind = 'raise';
      amount = 1 + (Math.random() < 0.35 ? 1 : 0);
      why = '牌力 ' + pct + '，主动加注施压，顺便把奖池做大。';
    } else if (st > 0.96 && Math.random() < 0.08 && pl.chips > 0) {
      kind = 'allin';
      why = '牌力 ' + pct + '，几乎是最好的一手，直接梭哈。';
    } else {
      kind = 'call';
      why = '牌力 ' + pct + '，跟注 ' + need + ' 枚' +
        (need > 0 ? '（奖池 ' + S.pot + ' 枚，赔率划得来）' : '（不用再掏钱）') + '，先看下去。';
    }
    act(pl, kind, amount, why);
  }

  // ============================== 结算 ==============================
  function combosFor(pl, cards, pool, hands) {
    if (S.modeId === 1) return [];
    const extra = S.modeId === 3 ? S.community.past : [];
    return E.comboCheck(cards.concat(extra).filter(Boolean), pool, hands, { today: S.today });
  }

  // ---- 决胜链：牌型/分数 → 数值 → 牌序（小者优先，节日牌视为 7）→ 明牌点数 → 座位 ----
  function seqKey(pl) {
    const os = [pl.open, pl.hole].filter(Boolean)
      .map(c => (c.order && c.order > 0) ? c.order : 7);
    return os.length ? -Math.min.apply(null, os) : -7;
  }
  function openPoint(pl) {
    if (!pl.open) return 0;
    return S.modeId === 1 ? pl.open.sum : pl.open.dayPoint;
  }
  function cmpTie(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function playerResult(pl) {
    const own = [pl.open, pl.hole].filter(Boolean);
    if (S.phaseRule === 'shape') {
      const all = own.concat([S.community.present]).filter(Boolean);
      const pool = E.buildPool(all, S.modeId);
      const hands = E.detectHands(pool);
      const combos = combosFor(pl, all, pool, hands);
      if (S.modeId === 1) {
        const b = E.bestPoker(pool);
        return { kind: 'shape', cards: all, pool: pool, hands: hands, poker: b,
                 power: b.rank * 1000 + b.tiebreak, powerText: b.name,
                 tie: [b.rank].concat(b.vec, [seqKey(pl), openPoint(pl), -pl.idx]) };
      }
      const r = E.scoreShape(all, pool, hands, combos, S.modeId);
      const dsum = E.sum(pool.digits.filter(d => !d.wild).map(d => d.v));
      return { kind: 'shape', cards: all, pool: pool, hands: hands, combos: combos,
               score: r, power: r.score, powerText: r.score + ' 分',
               tie: [r.score, dsum, seqKey(pl), openPoint(pl), -pl.idx] };
    }
    const r = E.bestSixteen(own, S.community.present, S.modeId, S.mode.bustLine);
    return { kind: 'number', cards: own, sixteen: r,
             power: r.bust ? -1 : r.total, powerText: r.bust ? (r.total + ' 爆') : (r.total + ' 点'),
             tie: [r.bust ? -1 : r.total, r.noPublic, seqKey(pl), openPoint(pl), -pl.idx] };
  }

  function showdown() {
    if (window.FX) FX.play('showdown');
    const alive = S.players.filter(x => !x.out && !x.folded);
    if (alive.length === 1) {
      alive[0].chips += S.pot;
      log(alive[0].name + ' 无人应战，收下 ' + S.pot + ' 金币。', 'hi');
      S.pot = 0;
      return finishRound([{ pl: alive[0], r: playerResult(alive[0]), win: true }]);
    }
    const rows = alive.map(pl => ({ pl: pl, r: playerResult(pl), win: false }));
    const valid = rows.filter(x => x.r.power >= 0);
    if (valid.length === 0) {
      log('全员爆点，月晦 —— 池子滚入下一回合。', 'warn');
      if (window.Ach) window.Ach.fire({ type: 'moonless' });
      S.carry = S.pot; S.pot = 0;
      return finishRound(rows);
    }
    const meRow0 = rows.filter(x => x.pl.idx === 0)[0];
    const meChipsBefore = S.players[0].chips;
    // 决胜：按 tie 向量逐级比（牌型/分数 → 数值 → 牌序 → 明牌 → 座位），必定只有一名赢家
    valid.sort((x, y) => cmpTie(y.r.tie, x.r.tie));
    const winners = [valid[0]];
    const TIE_LEVELS = S.phaseRule === 'shape'
      ? (S.modeId === 1 ? ['牌型', '数值', '牌序', '明牌点数', '座位'] : ['总分', '数字和', '牌序', '明牌点数', '座位'])
      : ['点数', '自有牌点数', '牌序', '明牌点数', '座位'];
    let decidedBy = '';
    if (valid.length > 1) {
      const a = valid[0].r.tie, b = valid[1].r.tie;
      for (let i = 1; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) {
          if ((a[0] || 0) === (b[0] || 0)) decidedBy = TIE_LEVELS[i] || '';
          break;
        }
      }
    }
    winners[0].note = decidedBy ? '同为' + TIE_LEVELS[0] + '，比' + decidedBy + ' 分出高低' : '';
    const share = Math.floor(S.pot / winners.length);
    for (const w of winners) w.pl.chips += share;
    const rem = S.pot - share * winners.length;
    if (rem > 0) winners[0].pl.chips += rem;
    log(winners[0].pl.name + ' 以 ' + winners[0].r.powerText + ' 赢下 ' + S.pot + ' 金币。' +
      (decidedBy ? '（同为' + TIE_LEVELS[0] + '，比' + decidedBy + ' 分出高低）' : ''), 'hi');
    const potWas = S.pot; S.pot = 0;
    for (const w of winners) w.win = true;

    // ---- 成就埋点：只统计你自己这一局的表现 ----
    if (window.Ach && meRow0) {
      const A = window.Ach;
      if (meRow0.r.kind === 'shape') {
        const cards = meRow0.r.cards || [];
        const sc = meRow0.r.score ? meRow0.r.score.score : 0;
        A.fire({ type: 'shape', hands: meRow0.r.hands || [], score: sc,
                 seasons: new Set(cards.map(c => c.season)).size });
        if (sc > (S.bestRoundScore || 0)) S.bestRoundScore = sc;
      } else {
        const six = meRow0.r.sixteen;
        A.fire({ type: 'number', total: six.total, line: S.mode.bustLine, bust: six.bust });
      }
      if (winners.some(w => w.pl.idx === 0)) {
        A.fire({ type: 'roundWin', phase: S.phaseLabel, pot: potWas, chipsBefore: meChipsBefore });
        if (S.players[0].usedCheat) A.fire({ type: 'cheatWin' });
      }
    }
    record({
      kind: 'result',
      text: '第 ' + S.round + ' 回合结算 · ' + (S.phaseLabel === '朔' ? '🌙 朔段' : '🌕 望段') +
        '比' + (S.phaseRule === 'shape' ? '牌型' : '点数') + '：' +
        winners.map(w => w.pl.name).join('、') + ' 赢下 ' + potWas + ' 枚金币',
      detail: rows.map(x => x.pl.name + ' ' + x.r.powerText + (x.win ? '（胜）' : '')).join('　|　') +
        '　·　获奖者当时的判断依据见上方各条记录'
    });

    // 节日牌附加效果（全部为筹码转移或进入下回合池，不凭空增减）
    for (const x of rows) {
      const r = x.r.score; if (!r) continue;
      if (r.toCarry) { const pay = Math.min(r.toCarry, x.pl.chips); x.pl.chips -= pay; S.carry += pay; }
      if (r.takeFromWinner && !x.win && winners.length) {
        const from = winners[0].pl;
        if (from.chips > 0) { from.chips -= 1; x.pl.chips += 1; log(x.pl.name + ' 端午辟邪，自 ' + from.name + ' 取回 1 金币。'); }
      }
      if (r.rob) {
        const others = rows.filter(y => y !== x && y.pl.chips > 0).sort((a, b) => b.pl.chips - a.pl.chips);
        if (others[0]) { others[0].pl.chips -= 1; x.pl.chips += 1; log(x.pl.name + ' 中元施孤，自 ' + others[0].pl.name + ' 取 1 金币。'); }
      }
    }
    // 赌命结算：赢了夺金币；输了把金币全交给赢家并当场出局（不凭空销毁筹码）
    const lifeRows = rows.filter(x => x.pl.lifeBet);
    for (const x of lifeRows) {
      if (!x.win) continue;
      let got = 0;
      for (const y of rows) {
        if (y === x) continue;
        const take = Math.min(3, y.pl.chips);
        y.pl.chips -= take; got += take;
      }
      x.pl.chips += got;
      log('💀 ' + x.pl.name + ' 赌命成功，从其他人手里夺走 ' + got + ' 枚金币！', 'hi');
      if (x.pl.idx === 0 && window.Ach) window.Ach.fire({ type: 'lifeWin' });
    }
    for (const x of lifeRows) {
      if (x.win) continue;
      const lost = x.pl.chips;
      x.pl.chips = 0;
      if (winners.length && lost > 0) {
        const each = Math.floor(lost / winners.length);
        for (const w of winners) w.pl.chips += each;
        const rem = lost - each * winners.length;
        if (rem > 0) winners[0].pl.chips += rem;
      } else if (lost > 0) {
        S.carry += lost;
      }
      log('💀 ' + x.pl.name + ' 赌命失败，' + lost + ' 枚金币尽归赢家，当场出局。', 'warn');
    }
    for (const x of rows) if (x.pl.usedCheat) x.pl.cheated = true;
    // 胜负特效：赢则金雨，爆则红闪震屏
    if (window.FX) {
      const meWon = winners.some(w => w.pl.idx === 0);
      const meBust = meRow0 && meRow0.r.kind === 'number' && meRow0.r.sixteen && meRow0.r.sixteen.bust;
      if (meWon) { FX.play('win'); FX.confetti(); FX.flash('gold'); }
      else if (meBust) { FX.play('bust'); FX.flash('red'); FX.shake($('me')); }
    }
    finishRound(rows);
  }

  function finishRound(rows) {
    S.lastShowdown = { rows: rows, phase: S.phaseLabel, rule: S.phaseRule, hidden: S.phaseHidden };
    if (S.modeId === 3 && S.phaseHidden) {
      const k = S.round < S.mode.switchAt ? 'shuo' : 'wang';
      S.known[k] = S.mystery[k];
      log('揭晓：' + (k === 'shuo' ? '🌙 朔段' : '🌕 望段') + ' 实际比的是「' + ruleName(S.mystery[k]) + '」。', 'warn');
    }
    for (const pl of S.players) {
      if (pl.chips <= 0 && !pl.out) { pl.out = true; log(pl.name + ' 金币用尽，退出本局。', 'warn'); }
    }
    S.locked = true;
    renderAll();

    // 模式一：以地猴为胜负判定目标
    if (S.modeId === 1) {
      const me = S.players[0], monkey = S.players[S.monkeyIdx];
      if (monkey && monkey.out) { S.outcome = 'win'; return renderShowdownModal(); }
      if (me.out) { S.outcome = 'lose'; return renderShowdownModal(); }
    }
    renderShowdownModal();
  }

  function continueRound() {
    closeModal();
    const me = S.players[0];
    if (S.modeId === 1 && S.outcome) return endGame();
    if (me.out) { log('你的金币已用尽，本局到此为止。', 'warn'); return endGame(); }
    const alive = S.players.filter(x => !x.out);
    if (alive.length <= 1) return endGame();
    nextRound();
  }

  function endGame() {
    const rank = S.players.slice().sort((a, b) => b.chips - a.chips);
    const me = S.players[0];
    const rankHtml = rank.map((p, i) =>
      '<div class="rank-row"><span class="rk">' + (i + 1) + '</span>' + esc(p.name) +
      (S.modeId === 1 && p.idx === S.monkeyIdx ? '<span class="zhuang">地猴</span>' : '') +
      '<b>' + p.chips + ' 金币</b></div>').join('');

    // 成就结算（含本局新解锁）
    let newly = [];
    if (window.Ach) {
      Ach.fire({ type: 'gameEnd', mode: S.modeId, coins: me.chips, outcome: S.outcome || null });
      newly = Object.keys(Ach.S.unlocked).filter(k => !(S.achSnapshot || {})[k]);
    }
    const achHtml = newly.length
      ? '<div class="ach-new"><div class="an-t">🏆 本局解锁 ' + newly.length + ' 个成就</div>' +
        '<div class="an-list">' + newly.map(k => {
          const a = window.Ach ? Ach.LIST.filter(x => x.id === k)[0] : null;
          return a ? '<span class="an-i t-' + a.tint + '">★ ' + a.name + '</span>' : '';
        }).join('') + '</div></div>'
      : '';
    const scoreHtml = '<div class="score-box">本局成绩 <b>' + me.chips + ' 金币</b>' +
      (S.bestRoundScore ? '　·　最高单回合得分 <b>' + S.bestRoundScore + '</b>' : '') +
      '<div class="sb-note" id="submitNote">正在同步成绩…</div></div>';

    const btns = [
      { t: '再来一局', fn: function () { closeModal(); showMenu(); }, cls: 'primary' },
      { t: '看排行榜', fn: showRank, cls: 'ghost' },
      { t: '看成就', fn: showAch, cls: 'ghost' }
    ];

    if (S.modeId === 1) {
      const monkey = S.players[S.monkeyIdx];
      const win = S.outcome ? S.outcome === 'win' : me.chips > monkey.chips;
      const head = win
        ? '<p class="verdict win">🌕 你赢下了地猴。</p>'
        : '<p class="verdict lose">🌙 你没能赢下地猴。</p>';
      const detail = '<p class="tiny">你 ' + me.chips + ' 金币　·　地猴 ' + monkey.chips + ' 金币</p>';
      modal(win ? '本局胜利' : '本局落败', head + detail + scoreHtml + achHtml + rankHtml, btns);
      if (window.FX) {
        if (win) { FX.play('win'); FX.confetti(110); FX.flash('gold'); }
        else FX.play('lose');
      }
    } else {
      modal('本局终了', scoreHtml + achHtml + rankHtml, btns);
      if (window.FX) {
        const top = rank[0];
        if (top && top.idx === 0) { FX.play('win'); FX.confetti(110); FX.flash('gold'); }
        else FX.play('lose');
      }
    }
    syncAndSubmit(me.chips);
  }

  /* ---------------- 成绩同步与排行榜 ---------------- */
  function byId(id) { try { return document.getElementById(id); } catch (e) { return null; } }

  function syncAndSubmit(score) {
    const note = byId('submitNote');
    const setNote = function (t) { if (note) { try { note.textContent = t; } catch (e) { } } };
    (async function () {
      try { if (window.Ach) await Ach.flush(); } catch (e) { }
      const TB = window.ToyBridge;
      if (!TB) return setNote('（本地模式：成绩已存在本机）');
      if (!TB.CAP.checked) TB.detect();
      if (!TB.CAP.rank) {
        return setNote(TB.CAP.present
          ? '⚠ 排行榜不可用 —— 打开「排行」面板看云能力自检'
          : '不在 B站 Toy 里，成绩只存在本机');
      }
      const r = await TB.submitScore(score, { mode: S.modeId, best: S.bestRoundScore || 0 });
      setNote(r.ok ? '✅ 成绩已提交到排行榜' : '⚠ 提交失败，可在「排行」面板重试');
    })();
  }

  function rankBodyHtml(listState) {
    const TB = window.ToyBridge;
    const st = (window.Ach && Ach.S.stats) || {};
    let h = '<div class="rank-wrap">';
    h += '<div class="rank-mine"><div class="rm-t">我的最好成绩（本地记录）</div>' +
      '<div class="rm-row">单局最高金币 <b>' + (st.bestCoins || 0) + '</b></div>' +
      '<div class="rm-row">最高单回合得分 <b>' + (st.bestScore || 0) + '</b></div>' +
      '<div class="rm-row">玩过 <b>' + (st.games || 0) + '</b> 局　·　赢下 <b>' + (st.roundsWon || 0) +
      '</b> 个回合　·　成就 <b>' + (window.Ach ? Ach.count() : 0) + '/' +
      (window.Ach ? Ach.LIST.length : 0) + '</b></div></div>';

    if (listState && listState.loading) {
      h += '<div class="rank-list"><div class="rl-empty">正在读取线上榜单…</div></div>';
    } else if (listState && listState.ok && listState.list.length) {
      h += '<div class="rank-list"><div class="rl-t">线上榜单（单局最终金币）</div>';
      listState.list.slice(0, 20).forEach(function (it, i) {
        const nm = it.nickname || it.name || it.uname || it.nick || ('玩家' + (i + 1));
        const sc = it.score !== undefined ? it.score : (it.value !== undefined ? it.value : it.scoreValue);
        h += '<div class="rl-row"><span class="rl-i">' + (i + 1) + '</span><span class="rl-n">' +
          esc(nm) + '</span><span class="rl-s">' + esc(String(sc)) + '</span></div>';
      });
      h += '</div>';
    } else if (listState && listState.ok) {
      h += '<div class="rank-list"><div class="rl-empty">榜单还没有数据 —— 你就是第一个。</div></div>';
    } else if (listState && listState.reason) {
      h += '<div class="rank-list"><div class="rl-empty">' + esc(listState.reason) + '</div></div>';
    }
    h += (window.Ach ? Ach.cloudStatusHtml() : '');
    h += '</div>';
    return h;
  }

  function showRank() {
    modal('排行榜', '<div id="rankBody">' + rankBodyHtml() + '</div>', [
      { t: '刷新榜单', fn: function () { loadRank(); }, cls: 'ghost' },
      { t: '关闭', fn: closeModal, cls: 'primary' }
    ]);
    loadRank();
  }

  async function loadRank() {
    const box = byId('rankBody');
    const put = function (s) { if (box) { try { box.innerHTML = rankBodyHtml(s); } catch (e) { } } };
    const TB = window.ToyBridge;
    if (!TB) return put({ ok: false, reason: '未加载 Toy 适配层。' });
    if (!TB.CAP.checked) TB.detect();
    if (!TB.CAP.rank) {
      return put({
        ok: false,
        reason: TB.CAP.present
          ? '检测到 Toy 容器，但排行榜方法不可用（看下方自检日志）。'
          : '不在 B站 Toy 容器内 —— 线上排行榜要发布之后才能看到。'
      });
    }
    put({ loading: true });
    const r = await TB.getRankList(20);
    if (r.ok) put({ ok: true, list: r.list || [] });
    else put({ ok: false, reason: '榜单读取失败：' + ((r.error && (r.error.message || r.error.type)) || '未知原因') });
  }

  function showAch() {
    if (!window.Ach) return modal('成就', '<p class="tiny">成就系统未加载。</p>', [{ t: '关闭', fn: closeModal, cls: 'primary' }]);
    modal('成就', Ach.panelHtml(), [{ t: '关闭', fn: closeModal, cls: 'primary' }]);
  }

  // ============================== 出千 / 喝破 ==============================
  function humanCheat() {
    const me = S.players[0];
    if (me.usedCheat || S.locked) return;
    me.usedCheat = true;
    const top = S.deck.pop();
    if (top) me.hole = top;
    log('你不动声色地换了一张暗牌……', 'warn');
    if (window.FX) FX.play('cheat');
    renderAll();
    renderActions();
  }
  function accuse(targetIdx) {
    const me = S.players[0], t = S.players[targetIdx];
    if (me.accuseUsed || !t || t.out || t.folded) return;
    me.accuseUsed = true;
    if (t.usedCheat) {
      const take = Math.min(3, t.chips);
      t.chips -= take; me.chips += take; t.penalty = 0.5;
      log('你喝破 ' + t.name + ' 出千 —— 属实！对方赔你 ' + take + ' 金币，本回合倍率减半。', 'hi');
      if (window.FX) { FX.play('accuse'); FX.flash('gold'); }
      if (window.Ach) window.Ach.fire({ type: 'accuse', ok: true });
    } else {
      const pay = Math.min(1, me.chips);
      me.chips -= pay; t.chips += pay;
      log('你喝破 ' + t.name + ' —— 冤枉了，赔对方 ' + pay + ' 金币。', 'warn');
      if (window.FX) { FX.play('accuseFail'); FX.shake($('me')); }
      if (window.Ach) window.Ach.fire({ type: 'accuse', ok: false });
    }
    renderAll();
  }

  // ============================== 渲染 ==============================
  function seasonClass(s) {
    return { '春': 's-spring', '夏': 's-summer', '秋': 's-autumn', '冬': 's-winter' }[s] || '';
  }

  function cardEl(card, opts) {
    opts = opts || {};
    const d = document.createElement('div');
    if (!card) { d.className = 'card empty'; d.innerHTML = '<span>—</span>'; return d; }
    d.className = 'card ' + seasonClass(card.season) + (card.type === '节日' ? ' festival' : '') + (opts.small ? ' small' : '');
    const ptLabel = S.modeId === 1 ? '合计' : '日点';
    const ptVal = S.modeId === 1 ? card.sum : card.dayPoint;
    d.innerHTML =
      '<div class="c-head">' + esc(card.name) + '</div>' +
      '<div class="c-order">' + (card.order ? esc(card.season) + card.order : '彩') + '</div>' +
      '<div class="c-date">' + esc(card.sub) + '</div>' +
      '<div class="c-digits">' + card.digits.join('·') + '</div>' +
      '<div class="c-point">' + ptLabel + ' ' + ptVal + '</div>';
    if (opts.badge) {
      const b = document.createElement('div'); b.className = 'c-badge'; b.textContent = opts.badge; d.appendChild(b);
    }
    return d;
  }

  function cardBack(cls) {
    const d = document.createElement('div');
    d.className = 'card back' + (cls ? ' ' + cls : '');
    d.innerHTML = '<div class="back-inner"><span>衍</span></div>';
    return d;
  }

  // ---- 开场漫画（复现那场传说中的牌局；看完可从「故事」按钮回看） ----
  const COMIC = [
    { img: 'assets/comic/p1.jpg', cap: '壹 · 立局' },
    { img: 'assets/comic/p2.jpg', cap: '贰 · 比形' },
    { img: 'assets/comic/p3.jpg', cap: '叁 · 满月' },
    { img: 'assets/comic/p4.jpg', cap: '肆 · 绝杀' }
  ];
  function comicSeen() {
    try { return localStorage.getItem('sw_comic_seen') === '1'; } catch (e) { return true; }
  }
  function markComicSeen() {
    try { localStorage.setItem('sw_comic_seen', '1'); } catch (e) { }
  }
  function showComic(onDone) {
    let i = 0;
    function done() { markComicSeen(); updateMenuEnter(); closeModal(); if (onDone) onDone(); }
    function page() {
      const last = i === COMIC.length - 1;
      const btns = [{ t: '跳过', cls: 'ghost', fn: done }];
      if (i > 0) btns.push({ t: '上一页', fn: function () { i--; page(); } });
      btns.push({
        t: last ? '看完，入局' : '下一页', cls: 'primary',
        fn: function () { if (last) done(); else { i++; page(); } }
      });
      modal('朔望月 · 缘起',
        '<div class="comic"><img class="comic-img" src="' + COMIC[i].img + '" alt="开场漫画 · ' + COMIC[i].cap + '">' +
        '<div class="comic-nav">' + COMIC[i].cap + '　·　' + (i + 1) + ' / ' + COMIC.length + '</div></div>',
        btns);
    }
    page();
  }

  // ---- 菜单：三种玩法单选，共用一个「进入」 ----
  let selectedMode = 2;
  try { selectedMode = parseInt(localStorage.getItem('sw_lastMode'), 10) || 2; } catch (e) { }

  // 故事只属于「原 · 朔望月」：衍的两个模式没有故事按钮。
  // 选中原版时，未看过 → 大按钮是故事、小按钮是进入；看过一次后大小互换（位置不变）。
  function updateMenuEnter() {
    const enter = $('menuEnterBtn'), story = $('menuStoryBtn');
    if (!enter || !story) return;
    if (selectedMode !== 1) {
      story.style.display = 'none';
      enter.className = 'btn primary big';
      return;
    }
    story.style.display = '';
    if (comicSeen()) {
      enter.className = 'btn primary big';
      story.className = 'btn';
    } else {
      enter.className = 'btn';
      story.className = 'btn primary big';
    }
  }

  function showMenu() {
    $('menu').style.display = 'flex';
    $('table').style.display = 'none';
    if ($('rogue')) $('rogue').style.display = 'none';
    const grid = $('menuGrid');
    grid.innerHTML = '';
    Object.keys(MODES).forEach(function (k) {
      const m = MODES[k];
      const el = document.createElement('div');
      el.className = 'mode-card m' + m.id + (m.id === selectedMode ? ' sel' : '');
      const h = document.createElement('h3'); h.textContent = m.name;
      const sub = document.createElement('div'); sub.className = 'mode-sub'; sub.textContent = m.sub;
      const p = document.createElement('p'); p.textContent = m.desc;
      const meta = document.createElement('div'); meta.className = 'mode-meta';
      meta.textContent = m.meta || (m.rounds + ' 回合 · 第 ' + m.switchAt + ' 回合换规则');
      el.appendChild(h); el.appendChild(sub); el.appendChild(p); el.appendChild(meta);
      el.onclick = function () {
        selectedMode = m.id;
        try { localStorage.setItem('sw_lastMode', String(m.id)); } catch (e) { }
        const cards = grid.children;
        for (let i = 0; i < cards.length; i++) cards[i].className = cards[i].className.replace(' sel', '');
        el.className += ' sel';
        updateMenuEnter();
      };
      grid.appendChild(el);
    });
    updateMenuEnter();
  }

  function enterGame() {
    // 衍时纪：走独立的闯关流程
    if (selectedMode === 4) {
      if (window.Rogue) {
        $('menu').style.display = 'none';
        if ($('table')) $('table').style.display = 'none';
        Rogue.start({ onExit: showMenu });
      }
      return;
    }
    const go = function () {
      startGame(selectedMode, parseInt($('playerCount').value, 10) || 3);
    };
    if (selectedMode === 1 && !comicSeen()) showComic(go); else go();
  }

  function showTable() {
    $('menu').style.display = 'none';
    $('table').style.display = 'block';
    $('modeName').textContent = S.mode.name;
    // 故事只属于「原 · 朔望月」，衍的两个模式顶栏也不显示
    if ($('storyBtn')) $('storyBtn').style.display = S.modeId === 1 ? '' : 'none';
  }

  // ---- 月相：整段状态由背景色 + 月亮标志表达 ----
  function moonIcon() {
    if (S.modeId === 3 && S.phaseHidden) return '🌗';
    return S.phaseLabel === '朔' ? '🌙' : '🌕';
  }
  function moonName() {
    if (S.phaseLabel === '朔') return '朔 · 新月（上半局，比牌型）';
    return '望 · 满月（下半局，比十六点）';
  }
  function phaseText() {
    const seg = S.phaseLabel === '朔' ? '🌙 朔段' : '🌕 望段';
    if (S.modeId === 3 && S.phaseHidden) return seg + ' · 规则未揭晓';
    return seg + ' · ' + (S.phaseRule === 'shape' ? '比牌型' : '比十六点');
  }
  function dealerChip() {
    if (S.dealer == null) return '';
    const nm = S.players[S.dealer].name;
    const who = (S.modeId === 1 || nm === '地猴') ? '地猴执庄' : nm + ' 执庄';
    return '<span class="chip m3 linkable" title="点击看说明" onclick="__tip(\'zhuang\')">庄 · 地猴（' +
      esc(who) + '）</span>';
  }
  function applyTheme() {
    const cls = S.phaseLabel === '望' ? 'phase-wang' : 'phase-shuo';
    const hidden = (S.modeId === 3 && S.phaseHidden) ? ' phase-hidden' : '';
    document.body.className = cls + hidden;
  }

  function renderAll() {
    if (!S) return;
    const me = S.players[0];
    applyTheme();
    $('hud').innerHTML =
      '<span class="moonmark" title="' + moonName() + '">' + moonIcon() + '</span>' +
      '<span class="chip">第 <b>' + S.round + '</b>/' + S.mode.rounds + ' 回合</span>' +
      '<span class="chip phase p-' + (S.phaseLabel === '朔' ? 'shuo' : 'wang') +
        ' linkable" title="点击看说明" onclick="__tip(\'phase\')">' + phaseText() + '</span>' +
      '<span class="chip linkable" title="点击看说明" onclick="__tip(\'bust\')">爆线 <b>' + S.mode.bustLine + '</b></span>' +
      '<span class="chip" id="potChip">奖池 <b>' + S.pot + '</b> 金币</span>' +
      '<span class="chip" id="meChip">你有 <b>' + me.chips + '</b> 金币</span>' +
      '<span class="chip">当前注 <b>' + S.currentBet + '</b> 金币</span>' +
      dealerChip();
    $('ruleChip').textContent = ruleChipText();

    // 三时纵轴
    const tl = $('timeline'); tl.innerHTML = '';
    if (S.modeId === 3) {
      tl.appendChild(tlCol('过去', S.community.past, 'past'));
      tl.appendChild(tlCol('现在', [S.community.present].filter(Boolean), 'now'));
      tl.appendChild(tlCol('未来', [S.community.future].filter(Boolean), 'future'));
    } else {
      tl.appendChild(tlCol('公共牌', [S.community.present].filter(Boolean), 'now'));
    }

    // 对手
    const ops = $('opponents'); ops.innerHTML = '';
    for (const pl of S.players.slice(1)) {
      const el = document.createElement('div');
      el.className = 'opp' +
        (S.players[S.turn] === pl && !pl.folded && !pl.out ? ' current' : '') +
        (pl.folded ? ' folded' : '') + (pl.out ? ' out' : '');
      el.innerHTML = '<div class="opp-top"><span class="nm">' + esc(pl.name) +
        (S.modeId === 3 && pl.idx === S.dealer ? '<span class="zhuang">庄</span>' : '') +
        '</span><span class="ch">' + pl.chips + ' 金币</span></div>';
      const row = document.createElement('div'); row.className = 'card-row';
      if (pl.out) row.innerHTML = '<div class="outs">已出局</div>';
      else if (pl.folded) row.innerHTML = '<div class="outs">已弃牌</div>';
      else { row.appendChild(cardEl(pl.open, { small: true })); row.appendChild(cardBack('small')); }
      el.appendChild(row);
      el.insertAdjacentHTML('beforeend', '<div class="opp-act">' + esc(pl.lastAction || '—') + '</div>');
      if (!pl.out && !pl.folded && pl.idx !== 0) {
        const b = document.createElement('button');
        b.className = 'btn tiny'; b.textContent = '喝破';
        b.disabled = me.accuseUsed;
        b.onclick = function () { accuse(pl.idx); };
        el.appendChild(b);
      }
      ops.appendChild(el);
    }

    // 我的手牌
    const myRow = $('myCards'); myRow.innerHTML = '';
    if (me.open) myRow.appendChild(cardEl(me.open, { badge: '明' }));
    if (me.hole) myRow.appendChild(cardEl(me.hole, { badge: '暗' }));
    $('meHead').innerHTML = '你的手牌' +
      (S.modeId === 3 && S.dealer === 0 ? '<span class="zhuang">庄</span>' : '');

    renderReadout();

    $('log').innerHTML = S.log.slice(-14).map(l => '<div class="li ' + l.cls + '">' + esc(l.t) + '</div>').join('');
    $('log').scrollTop = $('log').scrollHeight;
  }

  function tlCol(label, cards, cls) {
    const d = document.createElement('div');
    d.className = 'tl-col ' + cls;
    d.innerHTML = '<div class="tl-label">' + label + '</div>';
    const row = document.createElement('div'); row.className = 'tl-row';
    (cards && cards.length ? cards : [null]).forEach(c => row.appendChild(cardEl(c, { small: true })));
    d.appendChild(row);
    return d;
  }

  function ruleChipText() {
    if (S.modeId === 1) {
      const me = S.players[0], mk = S.players[S.monkeyIdx];
      return '目标：赢下地猴（你 ' + me.chips + ' 金币 ／ 地猴 ' + mk.chips + ' 金币）　·　' +
        phaseText() + '　·　🌙 前 3 回合比牌型，🌕 第 4 回合起比十六点';
    }
    if (S.modeId === 2) {
      return phaseText() + '　·　🌙 前 3 回合比牌型，🌕 后 3 回合比十六点　·　本回合执庄：' +
        S.players[S.dealer].name + '（庄家最后说话）';
    }
    const t = [];
    t.push('🌙 朔位规则：' + (S.known.shuo ? ruleName(S.known.shuo) : '尚未揭晓'));
    t.push('🌕 望位规则：' + (S.known.wang ? ruleName(S.known.wang) : '尚未揭晓'));
    if (S.dealer === 0) t.push('你替「庄 · 地猴」执庄：' + (S.swapsLeft ? '还可以改判 ' + S.swapsLeft + ' 次' : '已无改判'));
    else t.push('「庄 · 地猴」由 ' + S.players[S.dealer].name + ' 执庄，他随时可能改判');
    return t.join('　·　');
  }

  let roLastScore = null, roLastComboKey = '', roLastBest = null;

  function renderReadout() {
    const me = S.players[0], box = $('readout');
    if (!me.open || me.out) { box.innerHTML = ''; return; }
    const own = [me.open, me.hole].filter(Boolean);
    const hidden = S.modeId === 3 && S.phaseHidden;
    const html = [];
    let curScore = null, curComboList = [];
    const linkHand = hh => '<span class="linkable" title="点击看说明" onclick="__tip(\'hand\',\'' + hh + '\')">' + hh + '</span>';
    const linkFest = fn => '<span class="linkable fest" title="点击看说明" onclick="__tip(\'fest\',\'' + fn + '\')">' + fn + '</span>';

    if (hidden) {
      html.push('<div class="ro-line"><span class="ro-k">扣置中</span>' +
        '本段规则未揭晓 —— 下面两套算法都可能生效，你不知道是哪一套。</div>');
    }
    const showShape = hidden || S.phaseRule === 'shape';
    const showNumber = hidden || S.phaseRule === 'number';

    if (showShape) {
      const all = own.concat([S.community.present]).filter(Boolean);
      const pool = E.buildPool(all, S.modeId);
      const hands = E.detectHands(pool);
      const combos = combosFor(me, all, pool, hands);
      html.push('<div class="ro-line"><span class="ro-k">' + (hidden ? '？若为形' : '数字池') + '</span>' +
        pool.digits.map(d => d.wild ? '<i class="wild">万能</i>' : d.v).join(' ') + '</div>');
      if (S.modeId === 1) {
        const b = E.bestPoker(pool);
        html.push('<div class="ro-line"><span class="ro-k">牌型</span>' +
          (hands.length ? hands.map(linkHand).join('　') : '散牌') + '　<b>' + b.name + '</b></div>');
      } else {
        const r = E.scoreShape(all, pool, hands, combos, S.modeId);
        curScore = r.score; curComboList = combos;
        html.push('<div class="ro-line"><span class="ro-k">成立牌型</span>' +
          (hands.length ? hands.map(linkHand).join('　') : '散牌') + '</div>');
        html.push('<div class="ro-line"><span class="ro-k">底分 × 倍率</span><b>' +
          r.chips + '</b> × <b>' + r.mult + '</b>' + (r.times !== 1 ? ' × <b>' + r.times + '</b>' : '') +
          ' = <b class="big" id="roScore">' + r.score + '</b></div>');
        const fests = all.filter(c => c.type === '节日' && E.FESTIVAL_EFFECT[c.name]);
        if (fests.length) html.push('<div class="ro-line"><span class="ro-k">节日牌</span>' +
          fests.map(c => linkFest(c.name)).join('　') + '</div>');
      }
      if (combos.length) {
        html.push('<div class="ro-combos">' + combos.map(c =>
          '<span class="cb linkable" title="点击看说明" onclick="__tip(\'combo\',\'' + c.name + '\')">' +
          esc(c.name) + (c.chips ? ' 底分 +' + c.chips : '') +
          (c.mult ? ' 倍率 +' + c.mult : '') + (c.times ? ' 倍率 ×' + c.times : '') + '</span>').join('') + '</div>');
      }
    }
    if (showNumber) {
      const noPub = S.modeId === 1 ? (me.open.sum + me.hole.sum) : (me.open.dayPoint + me.hole.dayPoint);
      const pubv = S.modeId === 1 ? S.community.present.sum : S.community.present.dayPoint;
      const L = S.mode.bustLine;
      const r = E.bestSixteen(own, S.community.present, S.modeId, L);
      html.push('<div class="ro-line"><span class="ro-k">' + (hidden ? '？若为和' : '明+暗') + '</span><b>' + noPub + '</b> 点' +
        '　加公共牌(' + pubv + ') 则 <b class="' + ((noPub + pubv) > L ? 'bad' : 'good') + '">' + (noPub + pubv) + '</b> 点</div>');
      html.push('<div class="ro-line"><span class="ro-k">最佳取值</span><b class="big ' + (r.bust ? 'bad' : 'good') + '" id="roBest">' +
        r.total + '</b> 点　爆线 ' + L + (r.bust ? '　→ 爆，本回合出局' : (r.total === L ? '　→ 圆满封顶！' : '')) + '</div>');
    }
    box.innerHTML = html.join('');

    // 读数区特效：得分变化时滚动、combo 变化时逐个弹出递升音、最佳取值变化时脉冲
    if (window.FX) {
      const sc = box.querySelector ? box.querySelector('#roScore') : null;
      if (sc && curScore !== null) {
        if (roLastScore !== null && roLastScore !== curScore) FX.countUp(sc, curScore, { from: roLastScore });
        roLastScore = curScore;
      }
      const key = curComboList.map(c => c.name).join(',');
      if (key && key !== roLastComboKey) FX.stagger(box, '.ro-combos .cb', { step: 95, sound: 'combo' });
      roLastComboKey = key;
      const nb = box.querySelector ? box.querySelector('#roBest') : null;
      if (nb) {
        if (roLastBest !== null && roLastBest !== nb.textContent) nb.className += ' fx-glowpulse';
        roLastBest = nb.textContent;
      }
    }
  }

  function humanLife() {
    const me = S.players[0];
    if (me.usedLife || S.locked) return;
    modal('赌命', '<p class="verdict lose">把这一回合的胜负，押上性命。</p>' +
      '<ul class="rul">' +
      '<li>本回合你<b>不需要再投任何金币</b>，直接跟到底。</li>' +
      '<li><b>赢下本回合</b>：除了奖池，还从其他每位玩家手里各夺 <b>3 枚金币</b>。</li>' +
      '<li><b>输掉本回合</b>：你的金币立刻清零，<b>当场出局</b>。</li>' +
      '<li>一整局只能用一次，用了就收不回来。</li>' +
      '</ul>',
      [{ t: '取消', fn: closeModal, cls: 'ghost' },
       { t: '赌命', fn: function () { closeModal(); act(S.players[0], 'life', 0, '你把这一回合的胜负押上了命。'); }, cls: 'life' }]);
  }

  function renderActions() {
    const box = $('actions'), me = S.players[0];
    box.innerHTML = '';
    if (S.locked || me.out || me.folded || S.players[S.turn] !== me) return;
    const need = Math.max(0, S.currentBet - me.roundBet);
    const mk = function (label, fn, cls, dis) {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls || ''); b.textContent = label;
      b.disabled = !!dis; b.onclick = fn; box.appendChild(b);
    };
    mk('弃牌', humanFold, 'ghost');
    mk('跟注 ' + need + ' 金币', humanCall, 'primary', need > me.chips);
    mk('加注 +1', function () { humanRaise(1); }, '', me.chips <= need);
    mk('加注 +2', function () { humanRaise(2); }, '', me.chips <= need || (S.modeId === 3 && me.idx === S.dealer));
    mk('梭哈（押上全部 ' + me.chips + ' 金币）', humanAllin, 'danger', me.chips <= 0);
    if (!me.usedCheat) mk('出千（1 次）', humanCheat, 'warn');
    if (!me.usedLife) mk('赌命（1 次）', humanLife, 'life');
    if (S.modeId === 3 && S.dealer === 0 && S.swapsLeft > 0 && S.phaseHidden)
      mk('改判朔望', humanSwap, 'warn');
  }

  function renderShowdownModal() {
    const d = S.lastShowdown; if (!d) return;
    let html = '<div class="sd-title">' + (d.phase === '朔' ? '🌙 朔段' : '🌕 望段') + ' · ' +
      ruleName(d.rule) + (d.hidden ? '（本回合扣置，现已揭晓）' : '') + ' 结算</div><div class="sd-grid">';
    for (const row of d.rows) {
      const pl = row.pl, r = row.r;
      html += '<div class="sd-card' + (row.win ? ' win' : '') + '">';
      html += '<div class="sd-name">' + esc(pl.name) + (row.win ? ' <span class="crown">胜</span>' : '') + '</div>';
      if (row.win && row.note) html += '<div class="sd-line tiny">⚖ ' + esc(row.note) + '</div>';
      html += '<div class="sd-cards">' + (r.cards || []).map(c =>
        '<span class="mini ' + seasonClass(c.season) + '">' + esc(c.name) + '</span>').join('') + '</div>';
      if (r.kind === 'shape') {
        const lh = hh => '<span class="linkable" title="点击看说明" onclick="__tip(\'hand\',\'' + hh + '\')">' + hh + '</span>';
        if (S.modeId === 1) {
          html += '<div class="sd-line">牌型 <b>' + r.poker.name + '</b></div>';
          html += '<div class="sd-line tiny">成立：' + (r.hands.map(lh).join('　') || '散牌') + '</div>';
        } else {
          html += '<div class="sd-line tiny">成立：' + (r.hands.map(lh).join('　') || '散牌') + '</div>';
          html += '<div class="sd-line">底分 ' + r.score.chips + ' × 倍率 ' + r.score.mult +
            (r.score.times !== 1 ? ' × ' + r.score.times : '') + ' = <b class="sd-score">' + r.score.score + '</b></div>';
          if (r.combos && r.combos.length)
            html += '<div class="sd-line tiny">' + r.combos.map(c =>
              '<span class="linkable" title="点击看说明" onclick="__tip(\'combo\',\'' + c.name + '\')">' +
              esc(c.name) + '</span>').join('　') + '</div>';
        }
      } else {
        const s = r.sixteen;
        html += '<div class="sd-line">' +
          r.cards.map(c => esc(c.sub) + '(' + (S.modeId === 1 ? c.sum : c.dayPoint) + ')').join(' + ') +
          (s.withPublic ? ' + 公共' : '') + ' = <b class="' + (s.bust ? 'bad' : 'good') + '">' + s.total + '</b> 点' +
          (s.bust ? '　爆' : '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    modal('摊牌', html + '<p class="tiny" style="text-align:center;margin-top:16px">' +
      '点牌型名或 combo 名可以看说明；想复盘每个人当时怎么想的，按下面的「回看牌局记录」。</p>', [
      { t: (S.modeId === 1 && S.outcome) ? '看最终结果' : '下一回合', fn: continueRound, cls: 'primary' },
      { t: '回看牌局记录', fn: showHistory, cls: 'ghost' },
      { t: '查看牌库', fn: showDeck, cls: 'ghost' }
    ]);
    // 摊牌特效：卡片逐个弹出、赢家金光、得分滚动、牌型/combo 递升音（小丑牌式）
    if (window.FX) {
      const m = $('modal');
      FX.stagger(m, '.sd-card', { step: 100 });
      const winEl = m.querySelector ? m.querySelector('.sd-card.win') : null;
      if (winEl) winEl.className += ' fx-glowpulse';
      const sc = m.querySelector ? m.querySelector('.sd-card.win .sd-score') : null;
      if (sc) FX.countUp(sc, parseInt(sc.textContent, 10) || 0);
      const wrow = d.rows.filter(r => r.win)[0];
      if (wrow) {
        const hits = (wrow.r.hands || []).length + (wrow.r.combos || []).length;
        for (let i = 0; i < hits; i++) {
          (function (idx) { setTimeout(() => FX.play('combo', idx), 320 + idx * 110); })(i);
        }
      }
    }
  }

  // ============================== 规则面板 ==============================
  function rulesHtml(modeId) {
    // 衍时纪（闯关）的规则由 Rogue 自己生成
    if (modeId === 4) return (window.Rogue && Rogue.rulesHtml) ? Rogue.rulesHtml() : '<div class="rules"><h3>衍时纪</h3><p>闯关模块未加载。</p></div>';
    const classic = modeId === 1;
    const L = MODES[modeId].bustLine;
    const h = [];
    const table = (head, rows) =>
      '<table class="rtab"><thead><tr>' + head.map(x => '<th>' + x + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';

    h.push('<div class="rules">');

    /* ---------- 快速上手 ---------- */
    h.push('<div class="rules-quick"><b>一分钟上手</b>' +
      '<ol class="rol">' +
      '<li>每回合你拿 <b>1 张明牌 ＋ 1 张暗牌</b>，桌上还有 1 张公共牌，三张一起算。</li>' +
      '<li>先交 1 金币门票，再轮流下注；摊牌后<b>赢家拿走整个奖池</b>。</li>' +
      '<li>前 3 回合比<b>牌型</b>（🌙 朔段），后 ' + (classic ? '5' : '3') +
      ' 回合比<b>点数</b>（🌕 望段），超过 ' + L + ' 点就爆掉出局。</li>' +
      '<li>' + (classic
        ? '和地猴单挑：它先输光你赢，你先输光你输。'
        : '整局打完后，手上金币最多的人获胜。') + '</li>' +
      '</ol></div>');

    /* ---------- 目标 ---------- */
    if (classic) {
      h.push('<h3>一、这一局要做什么</h3>' +
        '<p>这是<b>单挑局</b>。桌子对面永远坐着<b>地猴</b> —— 它是「庄 · 地猴」的执庄人，' +
        '所以每一回合都由它最后说话。你和它各带 <b>12 枚金币</b>开始，其他座位只是陪打，不影响胜负。</p>' +
        '<p><b>怎么算赢、怎么算输：</b></p>' +
        '<ul class="rul">' +
        '<li><b>地猴的金币先归零 → 你立刻获胜。</b></li>' +
        '<li><b>你的金币先归零 → 你立刻落败。</b></li>' +
        '<li>两边都没出局、打满 8 回合 → <b>金币多的一方获胜。</b></li>' +
        '</ul>' +
        '<p>界面顶部一直显示你和地猴各自的金币，方便你盯着差距打。</p>');
    } else {
      h.push('<h3>一、这一局要做什么</h3>' +
        '<p>所有人从 <b>12 枚金币</b>开始。整局打完后，<b>手上金币最多的人获胜</b>。' +
        '金币变成 0 的人中途出局，本局余下的回合只能旁观。</p>' +
        (modeId === 2
          ? '<p><b>关于「庄 · 地猴」：</b>每一回合有一位玩家执庄，<b>轮着来，你也会轮到</b>。' +
            '执庄的人在说话顺序上排在最后一位，这是位置上的好处（下注时可以看着别人先动），但不会额外给分。</p>'
          : '<p><b>关于「庄 · 地猴」：</b>整局由一位玩家执庄，<b>可能是你也可能是对手</b>。' +
            '执庄的人在说话顺序上排最后一位，并且掌握「朔望之谜」的答案，详见第十三节。</p>'));
    }

    /* ---------- 牌 ---------- */
    h.push('<h3>二、你会拿到什么牌</h3>' +
      '<p>每一回合开始，你会拿到两张牌：</p>' +
      '<ul class="rul">' +
      '<li><b>明牌</b>：摊开放在你面前，所有人（包括对手）都看得见。</li>' +
      '<li><b>暗牌</b>：扣着放，只有你自己看得见。</li>' +
      '</ul>' +
      '<p>同时，桌子正中会翻开一张<b>公共牌</b>，这张牌不归任何人，全场共用。' +
      '所以结算时，你手上一共有三张牌可以拿来算：<b>明牌 ＋ 暗牌 ＋ 公共牌</b>。</p>');

    /* ---------- 牌面读法 ---------- */
    if (classic) {
      h.push('<h3>三、牌面上写着什么</h3>' +
        '<p>每张牌写着一个中文日期，例如「九月廿三」「五月初五」。' +
        '<b>把这个日期的每一位拆成一个单独的数字，这些数字就是这张牌的全部点数。</b></p>' +
        '<ul class="rul">' +
        '<li>九月廿三 → 数字是 <b>9、2、3</b>，三个数字加起来是 <b>14</b></li>' +
        '<li>五月初五 → 数字是 <b>5、5</b>，两个数字加起来是 <b>10</b></li>' +
        '<li>正月初一 → 数字是 <b>1、1</b>，加起来是 <b>2</b></li>' +
        '</ul>' +
        '<p>牌面右下角直接印好了这个「加起来」的结果，不用你自己算。</p>');
    } else {
      h.push('<h3>三、牌面上写着什么</h3>' +
        '<p>每张牌上有四样信息，用途各不相同：</p>' +
        '<ul class="rul">' +
        '<li><b>季</b>（春 / 夏 / 秋 / 冬）：相当于扑克牌的花色。同一个季的牌有相同的颜色。</li>' +
        '<li><b>序</b>（1 到 6）：这个节气在这一季里排第几。立春是春天的第 1 个，写作<b>春1</b>；谷雨写作春6。</li>' +
        '<li><b>数字</b>（2 到 4 个）：把月号和日号每一位拆开得到的单个数码，<b>朔段比牌型时用它们</b>。</li>' +
        '<li><b>日点</b>（1 到 11）：日号各位相加的结果，<b>望段比十六点时用它</b>。</li>' +
        '</ul>' +
        '<p><b>节日牌</b>（春节、端午、中秋这类）没有「序」，它是彩牌：' +
        '除了牌面上的数字正常使用，它还会额外送你 <b>1 个万能数字</b>，这个万能数字可以当成 1 到 9 里的任意一个数来用。' +
        '一手牌型里最多只算 2 个万能数字。</p>');
    }

    /* ---------- 流程 ---------- */
    h.push('<h3>四、一回合的五个步骤</h3>' +
      '<ol class="rol">' +
      '<li><b>发牌</b>：每人拿 1 张暗牌和 1 张明牌，桌心翻出 1 张公共牌。</li>' +
      '<li><b>决定谁先说话</b>：谁的明牌点数最大，谁就先说话，然后按座位顺时针轮流。' +
      '<b>庄 · 地猴不参加这个排序，他永远排在最后一个说话</b> —— 下注时可以先看别人怎么动，这是坐庄的位置优势。</li>' +
      '<li><b>交门票</b>：每个人先往奖池里放 1 枚金币。这一步是强制的。</li>' +
      '<li><b>下注</b>：轮到你的时候，从下面五个动作里选一个 —— ' +
      '<b>弃牌</b>（这一回合不玩了，已经放进奖池的金币拿不回来）、' +
      '<b>跟注</b>（补到和别人一样多）、' +
      '<b>加注</b>（比别人多放 1 到 2 枚，全场需要重新跟一轮）、' +
      '<b>梭哈</b>（把所有金币一次押上，按钮上会写明具体押多少）、' +
      '<b>赌命</b>（见下方说明，风险极大）。</li>' +
      '<li><b>摊牌结算</b>：所有人都不再加注、也不弃牌之后，一起亮牌，赢家拿走整个奖池，然后进入下一回合。' +
      '<b>每一回合都必定只有一名赢家</b> —— 出现并列时按下面的「决胜链」一路比下去，直到分出高低为止。</li>' +
      '</ol>' +
      '<p><b>决胜链：牌型相同也要分出胜负</b>，按下面的顺序一路比下去，谁先分出大小谁赢：</p>' +
      table(['段落', '并列时依次比较'], [
        ['🌙 朔段', '牌型 → 牌型数值（葫芦先比三条再比对子；两对比大对再比小对；顺子比高点；同花、散牌比最大的数字）' +
          ' → 牌序（序小者胜，节日牌没有序、视为 7 排最后） → 明牌点数 → 座位先后'],
        ['🌕 望段', '点数 → 自有牌点数（不靠公共牌的那个更大） → 牌序 → 明牌点数 → 座位先后']
      ]) +
      '<p class="tiny">也就是说，同样的葫芦也有大小之分，<b>不存在「共同胜利」</b>。</p>' +
      '<p><b>关于「赌命」</b>（一整局只能用一次）：</p>' +
      '<ul class="rul">' +
      '<li>宣布赌命之后，你这一回合<b>不需要再投任何金币</b>，相当于免费跟到底。</li>' +
      '<li><b>如果赢下本回合</b>：除了拿走奖池，还能从其他每一位玩家手里各夺 <b>3 枚金币</b>。</li>' +
      '<li><b>如果输掉本回合</b>：你的金币<b>立刻清零，当场出局</b>，本局就结束了。</li>' +
      '<li>所以它适合两种情况：你手上金币已经不多、反正撑不了几轮；或者你对自己的牌极有把握，想一把吃掉全场。</li>' +
      '</ul>' +
      '<p>如果这一回合没有任何人拿到有效的成绩，奖池会<b>原封不动留到下一回合</b>，并且下一回合的奖池翻倍。' +
      '这个情况叫<b>「月晦」</b>。</p>');

    /* ---------- 朔望 ---------- */
    h.push('<h3>五、上半局 🌙「朔」和下半局 🌕「望」</h3>' +
      '<p>一整局分成两段，两段的比法完全不同：</p>' +
      '<ul class="rul">' +
      '<li><b>🌙 朔段</b>：月亮是<b>新月</b>。这是前半局，比「形」 —— 比谁的牌型更强。</li>' +
      '<li><b>🌕 望段</b>：月亮是<b>满月</b>。这是后半局，比「和」 —— 比谁的数字更接近 ' + L + '。</li>' +
      '</ul>' +
      '<p>界面的<b>背景颜色</b>和左上角的<b>月亮标志</b>会随着这两段变化，你不用记回合数，看一眼颜色就知道现在比什么。' +
      (classic
        ? '本模式共 8 回合：第 1 到 3 回合是朔段，第 4 回合开始一直到第 8 回合都是望段。'
        : '本模式共 6 回合：第 1 到 3 回合是朔段，第 4 到 6 回合是望段。') +
      '</p>');

    /* ---------- 形 ---------- */
    if (classic) {
      h.push('<h3>六、🌙 朔段怎么比：牌型大小</h3>' +
        '<p>把你三张牌上的数字全部摊开来，从中挑出 5 个数字组成一副牌型（像扑克牌那样），' +
        '牌型最大的人赢。同一个数字可以用在不同的牌型里，但同一个牌型内部不能重复使用同一个数字。</p>' +
        table(['由强到弱', '说明'], [
          ['同花顺', '5 个数字来自同一季，而且连成一串'],
          ['四条', '同一个数字出现了 4 次'],
          ['葫芦', '3 个一样的数字，加 2 个一样的数字'],
          ['同花', '5 个数字全部来自同一季'],
          ['顺子', '5 个数字连成一串'],
          ['三条', '同一个数字出现了 3 次'],
          ['两对', '有两组各 2 个一样的数字'],
          ['一对', '有一组 2 个一样的数字'],
          ['散牌', '以上都不成立']
        ]) +
        '<p>牌型相同时，比这 5 个数字加起来的大小。</p>');
    } else {
      const rows = Object.keys(E.SCORE_TABLE)
        .map(k => E.SCORE_TABLE[k].time ? [k, E.SCORE_TABLE[k].p, E.SCORE_TABLE[k].time, E.SCORE_TABLE[k].mult] : null)
        .filter(Boolean);
      h.push('<h3>六、🌙 朔段怎么比：形（牌型计分）</h3>' +
        '<p>这里有两点和普通扑克牌不一样，请特别注意：</p>' +
        '<ul class="rul">' +
        '<li><b>不是只挑一种牌型，而是能成立几种就算几种。</b>同一批数字可以同时被读成顺子、对子、三条……' +
        '所有成立的牌型全部加起来计分，一手常常能凑出好几种。</li>' +
        '<li><b>牌型的分值按这副牌里的真实出现率排。</b>在这 36 张牌里，顺子比四条更难得，' +
        '所以顺子的分反而比四条高，请不要照搬德州扑克的顺序。</li>' +
        '</ul>' +
        table(['牌型', '出现率', '底分', '倍率'], rows));
    }

    /* ---------- 和 ---------- */
    h.push('<h3>七、🌕 望段怎么比：和（' + L + ' 点）</h3>' +
      '<p>望段不再比牌型，只做一件事：<b>把数字加起来，尽量接近 ' + L + '</b>。' +
      '规则是「不超过 ' + L + ' 的前提下越大越好」，<b>正好等于 ' + L + ' 是最大的</b>，' +
      '<b>超过 ' + L + ' 就爆掉，本回合直接出局</b>。' +
      (classic
        ? '这个数字来自「十五的月亮十六圆」。'
        : L + ' 这个上限正好卡在「要不要把公共牌算进来」的临界点上：很多时候算也不是、不算也不是。') +
      '</p>' +
      '<p><b>哪些牌必须算、哪些牌可以不算：</b></p>' +
      '<ul class="rul">' +
      '<li><b>明牌和暗牌必须算进去</b>，不能丢掉。</li>' +
      '<li><b>公共牌可以算，也可以不算。</b>这是望段最关键的取舍：' +
      '加上去可能正好凑到 ' + L + '，也可能一下子超过 ' + L + ' 把自己爆掉。</li>' +
      '</ul>' +
      '<p>你手上' + (classic ? '的数字是牌面那个「合计」数' : '的数字是牌面那个「日点」数') + '。两套方案都算一遍，取不超过 ' + L + ' 的最大值。</p>' +
      table(['你算出来的结果', '这一回合的表现'], [
        ['正好 ' + L, '最高，而且倍率再 ×2'],
        ['正好 ' + (L - 1), '倍率 ×1.5'],
        [(L - 3) + ' 或 ' + (L - 2), '倍率 ×1.2'],
        [(L - 5) + ' 到 ' + (L - 4), '倍率 ×1.0'],
        [(L - 6) + ' 或更低', '倍率 ×0.8'],
        ['超过 ' + L, '<b>爆掉</b>，本回合出局']
      ]));

    /* ---------- 计分 ---------- */
    if (!classic) {
      h.push('<h3>八、朔段的分数怎么算</h3>' +
        '<p class="formula">' +
        '<b>最终得分 ＝ 底分 × 倍率</b><br><br>' +
        '<b>底分</b>＝ 数字之和 × 2 ＋ 所有成立牌型的底分 ＋ combo 给的底分<br>' +
        '<b>倍率</b>＝ 所有成立牌型的倍率 ＋ combo 给的倍率，最后再乘上 combo 的「×N」' +
        '</p>' +
        '<p>底分是加数，倍率是乘数。真正拉开差距的是倍率 —— 把它叠上去，分数会成倍地涨。</p>');
    }

    /* ---------- combo ---------- */
    if (!classic) {
      h.push('<h3>九、Combo（可以同时命中多条）</h3>' +
        '<p>除了牌型，你的牌还会触发下面这些组合。同一条 combo 只看条件是否满足，满足就生效，' +
        '而且一张牌可以同时为多条 combo 提供条件。</p>' +
        table(['名字', '触发条件', '效果'], E.COMBO_LIST.map(c => [c.name, c.cond, c.eff])));
      h.push('<h3>十、十二张节日牌各自的特殊效果</h3>' +
        '<p>节日牌在你手上时，除了当万能数字用，还会额外触发下面这一条效果。' +
        '<b>七夕</b>是里面最强的：它能让另一张节日牌的效果<b>再触发一遍</b>。</p>' +
        table(['节日', '效果'], Object.keys(E.FESTIVAL_EFFECT).map(k => [k, E.FESTIVAL_EFFECT[k].text])));
    }

    /* ---------- 出千 ---------- */
    h.push('<h3>' + (classic ? '八' : '十一') + '、出千 和 喝破</h3>' +
      '<p>这套牌局的规矩只有一条：<b>出千只要不被当场抓住，就完全合法。</b></p>' +
      '<ul class="rul">' +
      '<li><b>出千</b>：每一局你只有一次机会。摊牌之前，按下「出千」按钮，' +
      '你的暗牌会悄悄换成牌堆顶上的一张。对手看不到你换了什么。</li>' +
      '<li><b>喝破</b>：每一回合你只能公开指认一次。在对手的面板上按「喝破」，指认他出千。' +
      '<br>——如果指认对了：对方这一回合的倍率减半，并且当场赔给你 <b>3 枚金币</b>。' +
      '<br>——如果指认错了：你赔给对方 <b>1 枚金币</b>。</li>' +
      '<li><b>诈赌</b>：就算你没出千，也可以故意大摇大摆，骗对手浪费掉他这一回合唯一的喝破机会。</li>' +
      '</ul>' +
      '<p>别人到底有没有出千，只在结算之后才会公开。所以每一次喝破都是纯粹的判断和心理战，没有百分之百的把握。</p>');

    /* ---------- 模式三 ---------- */
    if (modeId === 3) {
      h.push('<h3>十二、本模式专属：过去 · 现在 · 未来</h3>' +
        '<p>桌子中上方有三格，表示时间的三条轴：</p>' +
        '<ul class="rul">' +
        '<li><b>未来</b>：下一回合的公共牌，<b>提前公开给你看</b>。你可以据此提前规划下一回合怎么打。</li>' +
        '<li><b>现在</b>：本回合正在使用的那张公共牌。</li>' +
        '<li><b>过去</b>：前两个回合用过的公共牌，会留在桌上。它们<b>不参与组牌型</b>，' +
        '但<b>会参与 combo 的判定</b> —— 也就是说，过去打过的牌能帮你凑出「重日」「月令成章」「二分二至」这类组合。</li>' +
        '</ul>');
      h.push('<h3>十三、本模式专属：🌙 朔 与 🌕 望 之谜</h3>' +
        '<p>开局的时候，<b>「比牌型」和「比十六点」这两套规则会被扣在桌上</b>，' +
        '分别放在「朔」位和「望」位上。<b>没有任何人知道哪一个位置对应哪一套规则。</b></p>' +
        '<ul class="rul">' +
        '<li>每一段的<b>第一回合是盲局</b>：你在完全不知道这一段到底比什么的情况下，就要先下注。' +
        '要等到摊牌，答案才会揭晓。</li>' +
        '<li><b>「庄 · 地猴」可以看到扣着的答案，并且可以改判一次</b> —— 也就是把朔位和望位的规则对调。</li>' +
        '<li>「庄 · 地猴可以改判」这件事<b>写在明面上，全场都知道</b>；但他到底改没改，只有他自己知道。' +
        '所以就算第一段揭晓了答案，第二段依然可能是反过来的。</li>' +
        '<li>执庄的人因此握有信息优势，代价是<b>他这一局的加注上限只有 1 枚金币</b>。</li>' +
        '<li>如果执庄的人是你，界面上会多出一个「改判朔望」按钮，用完不留任何痕迹。' +
        '左上角的月亮会显示成 🌗，提醒你这一段还没揭晓。</li>' +
        '</ul>');
    }

    /* ---------- 结束 ---------- */
    if (classic) {
      h.push('<h3>九、出局与胜负</h3>' +
        '<p>金币归零的人中途出局，本局余下的回合不再参与。</p>' +
        '<p>本模式共 8 回合：🌙 朔段是第 1 到 3 回合，🌕 望段是第 4 到 8 回合。' +
        '<b>胜负只看你和地猴谁的金币多</b> —— 地猴先出局你立刻获胜，你先出局立刻落败。</p>');
    } else {
      h.push('<h3>' + (modeId === 3 ? '十四' : '十二') + '、出局与胜负</h3>' +
        '<p>金币归零的人中途出局，本局余下的回合不再参与。</p>' +
        '<p>一整局打完后，金币最多的人获胜。本模式共 6 回合（🌙 朔段 3 回合 ＋ 🌕 望段 3 回合）。</p>');
    }

    h.push('</div>');
    return h.join('');
  }
  function showRules(modeId) {
    modal('玩法规则', rulesHtml(modeId || (S ? S.modeId : 2)),
      [{ t: '知道了', fn: closeModal, cls: 'primary' }]);
  }

  // ============================== 记录 / 牌库 / 说明 ==============================
  function record(e) {
    if (!S) return;
    e.round = S.round; e.phase = S.phaseLabel;
    S.history.push(e);
    if (S.history.length > 500) S.history.shift();
  }

  function valOf(c) { return S.modeId === 1 ? c.sum : c.dayPoint; }
  function valName() { return S.modeId === 1 ? '合计' : '日点'; }

  function actionLabel(kind, amount, pl, need) {
    if (kind === 'fold') return '弃牌';
    if (kind === 'call') return need > 0 ? '跟注 ' + need + ' 枚' : '跟注（已平）';
    if (kind === 'raise') return '加注到 ' + S.currentBet + ' 枚';
    if (kind === 'allin') return '梭哈 ' + pl.roundBet + ' 枚';
    if (kind === 'life') return '赌命';
    return kind;
  }

  /** 描述这位玩家在此刻「能看到、算出」的全部信息 —— 回看时用来复盘他的判断依据 */
  function viewText(pl) {
    const L = S.mode.bustLine;
    const pub = S.community.present;
    const own = [pl.open, pl.hole].filter(Boolean);
    const bits = [];
    if (pl.open) bits.push('明牌 ' + pl.open.name + '（' + valName() + ' ' + valOf(pl.open) + '）');
    if (pl.hole) bits.push('暗牌 ' + pl.hole.name + '（' + valName() + ' ' + valOf(pl.hole) + '）');
    if (pub) bits.push('公共牌 ' + pub.name + '（' + valName() + ' ' + valOf(pub) + '）');
    if (S.modeId === 3 && S.community.future)
      bits.push('未来牌 ' + S.community.future.name + '（' + valName() + ' ' + valOf(S.community.future) + '，下回合才用）');
    const parts = ['看得到：' + bits.join('，')];

    if (S.phaseRule === 'shape') {
      const all = own.concat([pub]).filter(Boolean);
      const pool = E.buildPool(all, S.modeId);
      const hands = E.detectHands(pool);
      const combos = combosFor(pl, all, pool, hands);
      const dig = '算得出：数字池 ' + pool.digits.map(d => d.wild ? '万能' : d.v).join(' ') + '，';
      if (S.modeId === 1) {
        parts.push(dig + '最高牌型「' + E.bestPoker(pool).name + '」');
      } else {
        const r = E.scoreShape(all, pool, hands, combos, S.modeId);
        parts.push(dig + '成立 ' + (hands.join('、') || '散牌') + '，估分 ' + r.score +
          (combos.length ? '（combo：' + combos.map(c => c.name).join('、') + '）' : ''));
      }
    } else {
      const noPub = own.reduce((a, c) => a + valOf(c), 0);
      const withPub = noPub + (pub ? valOf(pub) : 0);
      const r = E.bestSixteen(own, pub, S.modeId, L);
      parts.push('算得出：自有牌 ' + noPub + ' 点，加公共牌 ' + withPub + ' 点（爆线 ' + L + '），最佳取值 ' +
        r.total + ' 点' + (r.bust ? ' → 已经爆了' : ''));
    }
    if (S.modeId === 3 && S.phaseHidden) parts.push('⚠ 本段规则还没揭晓，只能两套都估一遍');
    return parts.join('　·　');
  }

  const HAND_TIP = {
    '同花顺': '5 个数字来自同一季，而且连成一串。本副牌里最稀有的一手。',
    '四条': '同一个数字出现了 4 次。',
    '葫芦': '一组 3 个一样的数字，加一组 2 个一样的数字。',
    '同花': '5 个数字全部来自同一季（同一种花色）。',
    '顺子': '5 个数字连成一串。注意：在这 36 张牌里顺子比四条稀有得多，所以分值反而更高。',
    '三条': '同一个数字出现了 3 次。',
    '两对': '有两组各 2 个一样的数字。',
    '一对': '有一组 2 个一样的数字。',
    '散牌': '以上都不成立。'
  };

  function showTip(kind, key) {
    let title = key, body = '';
    if (kind === 'combo') {
      const c = E.COMBO_LIST.filter(x => x.name === key)[0];
      if (c) body = '<p><b>触发条件</b><br>' + esc(c.cond) + '</p><p><b>效果</b><br>' + esc(c.eff) + '</p>' +
        '<p class="tiny">只要条件满足就自动生效，而且可以和别的 combo 同时命中 —— 一张牌能同时为多条 combo 提供条件。</p>';
    } else if (kind === 'hand') {
      body = '<p>' + esc(HAND_TIP[key] || '') + '</p>';
      if (S.modeId !== 1) {
        const t = E.SCORE_TABLE[key];
        if (t && t.time) body += '<p><b>底分</b> +' + t.time + '　<b>倍率</b> +' + t.mult +
          '　<b>出现率</b> ' + t.p + '</p>' +
          '<p class="tiny">底分加进去、倍率乘上去。能同时成立几种牌型，就全部累加。</p>';
      }
    } else if (kind === 'fest') {
      const f = E.FESTIVAL_EFFECT[key];
      if (f) body = '<p><b>节日牌效果</b><br>' + esc(f.text) + '</p>' +
        '<p class="tiny">节日牌同时也是万能数字，可以在组牌型时补上任意一个数字（一手最多算 2 个万能数字）。</p>';
    } else if (kind === 'phase') {
      body = '<p><b>🌙 朔段</b>是前半局，比「形」—— 比谁的牌型组合更强。</p>' +
        '<p><b>🌕 望段</b>是后半局，比「和」—— 比谁的数字更接近爆线 ' + S.mode.bustLine + ' 点。</p>' +
        '<p class="tiny">界面的背景色和左上角的月亮会跟着变。</p>';
    } else if (kind === 'zhuang') {
      body = '<p>「<b>庄 · 地猴</b>」是庄位的名字，不是固定 NPC。执庄的人<b>说话顺序排在最后</b>，' +
        '可以先看别人怎么下注再决定。</p>' +
        (S.modeId === 3 ? '<p>在衍时 · 朔望月里，执庄的人还掌握朔望之谜的答案，并且可以改判一次。</p>' : '');
    } else if (kind === 'bust') {
      body = '<p>望段里，数字<b>超过 ' + S.mode.bustLine + ' 点就爆</b>，本回合直接出局；' +
        '<b>正好 ' + S.mode.bustLine + ' 点</b>是最大的。</p>' +
        '<p>明牌和暗牌必须算进去，公共牌可以算也可以不算，这是望段最关键的取舍。</p>';
    }
    modal(title, '<div class="tipbox">' + body + '</div>', [{ t: '知道了', fn: closeModal, cls: 'primary' }]);
  }
  window.__tip = function (kind, key) { try { showTip(kind, key); } catch (e) { } };

  /** 牌库查看器：36 张牌里，哪些已经露过面、哪些还没出现 */
  function showDeck() {
    const seen = {}, mine = {};
    const mark = (c, isMine) => { if (!c) return; seen[c.uid] = 1; if (isMine) mine[c.uid] = 1; };
    mark(S.community.present);
    mark(S.community.future);
    S.community.past.forEach(c => mark(c));
    for (const pl of S.players) {
      if (pl.out && !pl.open) continue;
      if (pl.open) mark(pl.open, pl.idx === 0);
      if (pl.hole && pl.idx === 0) mark(pl.hole, true);
    }
    const all = S.deckAll;
    let seenN = 0;
    let grid = '<div class="deckgrid">';
    for (const c of all) {
      if (seen[c.uid]) seenN++;
      grid += '<div class="dchip ' + seasonClass(c.season) + (c.type === '节日' ? ' fest' : '') +
        (seen[c.uid] ? ' seen' : '') + (mine[c.uid] ? ' mine' : '') +
        '" title="' + esc(c.name + '　' + c.sub) + '">' +
        '<span class="dc-n">' + esc(c.name) + '</span>' +
        '<span class="dc-d">' + c.digits.join('·') + '</span>' +
        '<span class="dc-p">' + (S.modeId === 1 ? c.sum : c.dayPoint) + '</span></div>';
    }
    grid += '</div>';
    modal('牌库（36 张）',
      '<p class="decknote">已经露过面的是 <b>' + seenN + '</b> 张（金色高亮＝你手上的牌），还没出现的是 <b>' +
      (36 - seenN) + '</b> 张。<br>' +
      '<span class="tiny">注意：对手扣着的暗牌你看不见，所以它算在「还没出现」里 —— 这一栏本来就是给你算牌用的。</span></p>' +
      grid,
      [{ t: '关闭', fn: closeModal, cls: 'primary' }]);
  }

  function showHistory() {
    const h = S.history || [];
    if (!h.length) return modal('牌局记录', '<p class="tiny">这一局还没有任何记录。</p>',
      [{ t: '关闭', fn: closeModal, cls: 'primary' }]);
    let html = '<div class="hist"><p class="tiny">每条记录都写明了<b>当事人当时看得到什么</b>，以及<b>他为什么这么打</b>。</p>';
    let cur = 0;
    for (const e of h) {
      if (e.round !== cur) {
        cur = e.round;
        html += '<div class="hist-round">第 ' + cur + ' 回合 · ' + (e.phase === '朔' ? '🌙 朔段' : '🌕 望段') + '</div>';
      }
      if (e.kind === 'deal') {
        html += '<div class="hist-item deal"><div class="hi-t">📜 ' + esc(e.text) + '</div>' +
          '<div class="hi-d">' + esc(e.detail) + '</div></div>';
      } else if (e.kind === 'action') {
        html += '<div class="hist-item' + (e.human ? ' me' : '') + '">' +
          '<div class="hi-t"><b>' + esc(e.who) + '</b>　' + esc(e.action) + '</div>' +
          (e.why ? '<div class="hi-w">💭 ' + esc(e.why) + '</div>' : '') +
          '<div class="hi-v">👁 ' + esc(e.view) + '</div></div>';
      } else if (e.kind === 'result') {
        html += '<div class="hist-item res"><div class="hi-t">🏁 ' + esc(e.text) + '</div>' +
          '<div class="hi-d">' + esc(e.detail) + '</div></div>';
      }
    }
    html += '</div>';
    modal('牌局记录', html, [{ t: '关闭', fn: closeModal, cls: 'primary' }]);
  }

  // ============================== 弹窗 ==============================
  function modal(title, bodyHtml, btns) {
    const m = $('modal');
    m.style.display = 'flex';
    m.innerHTML = '';
    const box = document.createElement('div'); box.className = 'mbox';
    const h = document.createElement('h2'); h.textContent = title;
    const body = document.createElement('div'); body.className = 'mbody'; body.innerHTML = bodyHtml;
    const foot = document.createElement('div'); foot.className = 'mfoot';
    (btns || []).forEach(function (b) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || 'primary'); el.textContent = b.t; el.onclick = b.fn;
      foot.appendChild(el);
    });
    box.appendChild(h); box.appendChild(body); box.appendChild(foot);
    m.appendChild(box);
  }
  function closeModal() { const m = $('modal'); m.style.display = 'none'; m.innerHTML = ''; }

  // ============================== 启动 ==============================
  window.addEventListener('DOMContentLoaded', function () {
    showMenu();
    if (window.Ach) Ach.init();
    $('quitBtn').onclick = function () { closeModal(); showMenu(); };
    $('rulesBtn').onclick = function () { showRules(); };
    $('histBtn').onclick = function () { showHistory(); };
    $('deckBtn').onclick = function () { showDeck(); };
    $('achBtn').onclick = function () { showAch(); };
    $('rankBtn').onclick = function () { showRank(); };
    $('menuRulesBtn').onclick = function () { showRules(selectedMode); };
    if ($('menuAchBtn')) $('menuAchBtn').onclick = function () { showAch(); };
    if ($('menuEnterBtn')) $('menuEnterBtn').onclick = enterGame;
    if ($('menuStoryBtn')) $('menuStoryBtn').onclick = function () { showComic(null); };
    if ($('storyBtn')) $('storyBtn').onclick = function () { showComic(null); };
    if ($('muteBtn') && window.FX) {
      const mb = $('muteBtn');
      mb.textContent = FX.isMuted() ? '🔇' : '🔊';
      mb.onclick = function () {
        FX.setMuted(!FX.isMuted());
        mb.textContent = FX.isMuted() ? '🔇' : '🔊';
        if (!FX.isMuted()) FX.play('click');
      };
    }
  });

  // 供无头测试使用
  window.__game = {
    startGame: startGame,
    state: function () { return S; },
    act: act,
    step: step,
    modal: modal,
    rulesHtml: rulesHtml,
    showHistory: showHistory,
    showDeck: showDeck,
    showTip: showTip,
    showRank: showRank,
    showAch: showAch,
    showMenu: showMenu,
    showComic: showComic,
    enterGame: enterGame,
    MODES: MODES,
    selectMode: function (id) { selectedMode = id; return selectedMode; },
    viewText: viewText
  };
})();
