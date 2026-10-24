/* 《衍时纪 · 朔望月》—— 成就系统
 *
 * B站 Toy 没有独立的成就接口，所以成就建在「云存储」之上：
 *   · 游玩过程中只在内存里记录
 *   · 关键节点（解锁成就、一局结束、页面隐藏）才落盘
 *   · 落盘优先走 ToyBridge（Toy 云存储），失败则退回 localStorage，再失败就只留内存
 * 这样在 file:// 双击打开时成就照样能用，只是不跨设备。
 */
(function () {
  'use strict';

  const KEY = 'ysj_ach_v1';
  const TB = window.ToyBridge;

  const LIST = [
    { id: 'first_round', name: '一元复始', tint: '春', desc: '赢下你的第一个回合。' },
    { id: 'first_game', name: '开天辟地', tint: '春', desc: '完整打完第一局。' },
    { id: 'shunzi', name: '节气连环', tint: '春', desc: '在朔段成立一次顺子（本牌库 5.4% 的事）。' },
    { id: 'five_hands', name: '五气朝元', tint: '秋', desc: '一手牌同时成立 5 种以上牌型。' },
    { id: 'straight_flush', name: '同花顺', tint: '秋', desc: '打出同花顺 —— 本牌库 0.09% 的奇迹。' },
    { id: 'perfect', name: '圆满', tint: '秋', desc: '望段正好压在爆线上。' },
    { id: 'bust', name: '月满则亏', tint: '冬', desc: '望段爆点，被月亮反噬。' },
    { id: 'moonless', name: '月晦无光', tint: '冬', desc: '见证一次全员爆点、奖池流局。' },
    { id: 'life_use', name: '背水一战', tint: '夏', desc: '第一次赌命。' },
    { id: 'life_win', name: '赌命成功', tint: '夏', desc: '赌命之下赢下回合，从所有人手里夺走金币。' },
    { id: 'beat_monkey', name: '赢下地猴', tint: '夏', desc: '在「原 · 朔望月」里击败地猴。' },
    { id: 'catch_cheat', name: '火眼金睛', tint: '夏', desc: '喝破一次出千，而且抓对了。' },
    { id: 'cheat_win', name: '十赌九诈', tint: '夏', desc: '出千之后还赢下了这个回合。' },
    { id: 'comeback', name: '逆天改命', tint: '秋', desc: '手上只剩 ≤3 枚金币时，赢下 ≥15 枚的大奖池。' },
    { id: 'four_seasons', name: '四时流转', tint: '春', desc: '一手三张牌分属三个不同的季。' },
    { id: 'rich', name: '家财万贯', tint: '秋', desc: '一局结束时手上金币 ≥30。' },
    { id: 'both_phases', name: '朔望同辉', tint: '冬', desc: '同一局里，朔段和望段都赢过。' },
    { id: 'all_modes', name: '四时贯通', tint: '冬', desc: '四套模式各至少玩过一局。' },
    { id: 'rogue_first', name: '初入轮回', tint: '冬', desc: '第一次踏进「衍时纪」的闯关长廊。' },
    { id: 'rogue_half', name: '半程', tint: '秋', desc: '在衍时纪里抵达第 5 大轮。' },
    { id: 'rogue_break', name: '破局', tint: '春', desc: '走完衍时纪的全部 8 大轮 24 关。' },
    { id: 'rogue_big', name: '十万之击', tint: '夏', desc: '在衍时纪里单次打牌得分 ≥ 100,000。' },
    { id: 'rogue_full', name: '满堂', tint: '秋', desc: '在衍时纪里同时带满 5 张节令牌。' }
  ];
  const BY_ID = {};
  LIST.forEach(a => BY_ID[a.id] = a);

  const S = {
    unlocked: {},                 // id → 时间戳
    stats: {
      games: 0, roundsWon: 0, bestCoins: 0, bestScore: 0, modes: {},
      lifeWins: 0, cheats: 0, busts: 0
    }
  };
  let loaded = false;
  let dirty = false;
  const session = { shuoWin: false, wangWin: false };   // 每局重置

  function hasLS() { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch (e) { return false; } }

  function loadLocal() {
    if (!hasLS()) return;
    try {
      const t = localStorage.getItem(KEY);
      if (!t) return;
      const o = JSON.parse(t);
      if (o && o.unlocked) merge(o);
    } catch (e) { }
  }
  function saveLocal() {
    if (!hasLS()) return;
    try { localStorage.setItem(KEY, JSON.stringify({ unlocked: S.unlocked, stats: S.stats })); } catch (e) { }
  }
  function merge(o) {
    if (o.unlocked) for (const k in o.unlocked) if (!S.unlocked[k]) S.unlocked[k] = o.unlocked[k];
    if (o.stats) {
      S.stats.games = Math.max(S.stats.games, o.stats.games || 0);
      S.stats.roundsWon = Math.max(S.stats.roundsWon, o.stats.roundsWon || 0);
      S.stats.bestCoins = Math.max(S.stats.bestCoins, o.stats.bestCoins || 0);
      S.stats.bestScore = Math.max(S.stats.bestScore, o.stats.bestScore || 0);
      S.stats.lifeWins = Math.max(S.stats.lifeWins, o.stats.lifeWins || 0);
      S.stats.cheats = Math.max(S.stats.cheats, o.stats.cheats || 0);
      S.stats.busts = Math.max(S.stats.busts, o.stats.busts || 0);
      if (o.stats.modes) for (const m in o.stats.modes) S.stats.modes[m] = Math.max(S.stats.modes[m] || 0, o.stats.modes[m]);
    }
  }

  /** 启动时拉一次云端存档（官方 §7：读结果本地缓存，不轮询） */
  async function init() {
    loadLocal();
    loaded = true;
    if (TB && TB.CAP.cloud) {
      const kv = await TB.load([KEY]);
      if (kv && kv[KEY]) {
        try { merge(JSON.parse(kv[KEY])); } catch (e) { }
        saveLocal();
      }
    }
    return S;
  }

  /** 关键节点才落盘 */
  function persist() {
    saveLocal();
    if (TB) TB.queue(KEY, JSON.stringify({ unlocked: S.unlocked, stats: S.stats }));
    dirty = true;
  }
  async function flush() {
    if (!dirty) return { ok: true, skipped: true };
    saveLocal();
    if (TB) { const r = await TB.flush(); dirty = false; return r; }
    dirty = false;
    return { ok: false, reason: 'no-bridge' };
  }

  function unlockedCount() { return Object.keys(S.unlocked).length; }

  function unlock(id) {
    if (!BY_ID[id] || S.unlocked[id]) return false;
    S.unlocked[id] = Date.now();
    persist();
    toast(BY_ID[id]);
    return true;
  }

  /** 成就解锁的小提示条 */
  function toast(ach) {
    try {
      if (window.FX) window.FX.play('achieve');
      let box = document.getElementById('achToast');
      if (!box) {
        box = document.createElement('div');
        box.id = 'achToast';
        box.className = 'ach-toast-box';
        document.body.appendChild(box);
      }
      const el = document.createElement('div');
      el.className = 'ach-toast t-' + (ach.tint || '春');
      el.innerHTML = '<span class="at-mark">成就</span><b>' + ach.name + '</b><span class="at-d">' + ach.desc + '</span>';
      box.appendChild(el);
      setTimeout(function () { try { box.removeChild(el); } catch (e) { } }, 4200);
    } catch (e) { }
  }

  /* ---------------- 事件入口：game.js 在关键点调用 ---------------- */
  function fire(evt) {
    if (!evt || !evt.type) return;
    const st = S.stats;
    switch (evt.type) {
      case 'gameStart':
        session.shuoWin = false; session.wangWin = false;
        st.modes[evt.mode] = (st.modes[evt.mode] || 0) + 1;
        if (Object.keys(st.modes).length >= 4) unlock('all_modes');
        break;

      /* ---------------- 衍时纪（闯关） ---------------- */
      case 'rogueStart':
        session.shuoWin = false; session.wangWin = false;
        st.modes[4] = (st.modes[4] || 0) + 1;
        unlock('rogue_first');
        if (Object.keys(st.modes).length >= 4) unlock('all_modes');
        break;

      case 'rogueBlind':
        if (evt.tier >= 4) unlock('rogue_half');
        break;

      case 'roguePlay':
        if (evt.score >= 100000) unlock('rogue_big');
        break;

      case 'rogueShop':
        if (evt.jokers >= 5) unlock('rogue_full');
        if (evt.coins > (st.bestCoins || 0)) st.bestCoins = evt.coins;
        break;

      case 'rogueEnd':
        st.games++;
        unlock('first_game');
        if (evt.win) unlock('rogue_break');
        if (evt.coins > st.bestCoins) st.bestCoins = evt.coins;
        if (evt.coins >= 30) unlock('rich');
        persist();
        if (TB && TB.CAP.rank) { try { TB.submitScore(evt.coins, { mode: 4, tier: evt.tier, score: evt.score }); } catch (e) { } }
        break;

      case 'shape':
        if (evt.hands && evt.hands.indexOf('顺子') >= 0) unlock('shunzi');
        if (evt.hands && evt.hands.indexOf('同花顺') >= 0) unlock('straight_flush');
        if (evt.hands && evt.hands.length >= 5) unlock('five_hands');
        if (evt.seasons >= 3) unlock('four_seasons');
        if (evt.score > (st.bestScore || 0)) st.bestScore = evt.score;
        break;

      case 'number':
        if (evt.bust) { st.busts++; unlock('bust'); }
        else if (evt.total === evt.line) unlock('perfect');
        break;

      case 'moonless':
        unlock('moonless');
        break;

      case 'lifeUse':
        unlock('life_use');
        break;

      case 'lifeWin':
        st.lifeWins++; unlock('life_win'); unlock('life_use');
        break;

      case 'accuse':
        if (evt.ok) unlock('catch_cheat');
        break;

      case 'cheatWin':
        st.cheats++; unlock('cheat_win');
        break;

      case 'roundWin':
        st.roundsWon++;
        if (st.roundsWon >= 1) unlock('first_round');
        if (evt.phase === '朔') session.shuoWin = true;
        if (evt.phase === '望') session.wangWin = true;
        if (session.shuoWin && session.wangWin) unlock('both_phases');
        if (evt.chipsBefore <= 3 && evt.pot >= 15) unlock('comeback');
        break;

      case 'gameEnd':
        st.games++;
        unlock('first_game');
        if (evt.coins > st.bestCoins) st.bestCoins = evt.coins;
        if (evt.coins >= 30) unlock('rich');
        if (evt.mode === 1 && evt.outcome === 'win') unlock('beat_monkey');
        persist();
        break;
    }
  }

  /* ---------------- 面板 ---------------- */
  function panelHtml() {
    const n = unlockedCount(), total = LIST.length;
    let h = '<div class="ach-wrap">';
    h += '<p class="ach-head">已解锁 <b>' + n + '</b> / ' + total + '　·　' +
      '历史战绩：玩过 <b>' + (S.stats.games || 0) + '</b> 局，赢下 <b>' + (S.stats.roundsWon || 0) +
      '</b> 个回合，单局最高金币 <b>' + (S.stats.bestCoins || 0) + '</b>，最高单回合得分 <b>' +
      (S.stats.bestScore || 0) + '</b></p>';
    h += '<div class="ach-grid">';
    for (const a of LIST) {
      const on = !!S.unlocked[a.id];
      h += '<div class="ach-item t-' + a.tint + (on ? ' on' : '') + '">' +
        '<div class="ai-n">' + (on ? '★ ' : '☆ ') + a.name + '</div>' +
        '<div class="ai-d">' + a.desc + '</div>' +
        (on ? '<div class="ai-t">' + new Date(S.unlocked[a.id]).toLocaleDateString() + ' 解锁</div>' : '') +
        '</div>';
    }
    h += '</div>';
    h += cloudStatusHtml();
    h += '</div>';
    return h;
  }

  function cloudStatusHtml() {
    if (!TB) return '';
    const c = TB.CAP;
    let h = '<div class="cloud-box"><div class="cb-t">云能力自检</div>';
    h += '<div class="cb-row">' + (c.present ? '✅ 检测到 Toy 容器' : '⬜ 不在 Toy 容器内（成绩与成就只存本机）') + '</div>';
    h += '<div class="cb-row">' + (c.cloud ? '✅ 云存储可用（成就可跨设备）' : '⬜ 云存储不可用') + '</div>';
    h += '<div class="cb-row">' + (c.rank ? '✅ 排行榜可用' : '⬜ 排行榜不可用') + '</div>';
    if (c.present) h += '<div class="cb-row dim">已探测到的方法：' + (c.methods.length ? c.methods.join('、') : '（无）') + '</div>';
    if (c.log.length) {
      h += '<div class="cb-log">' + c.log.slice(0, 8).map(l =>
        '<div class="cbl ' + l.cls + '">' + l.t + '　' + l.s + '</div>').join('') + '</div>';
    }
    h += '<div class="cb-row dim">若上面显示为不可用但你确定已在 Toy 里跑，说明 SDK 签名与 assets/toy.js 的 ADAPTER 不一致 —— 那里是唯一需要改的地方。</div>';
    h += '</div>';
    return h;
  }

  window.Ach = {
    LIST: LIST, S: S,
    init: init, fire: fire, flush: flush, persist: persist,
    unlock: unlock, panelHtml: panelHtml, cloudStatusHtml: cloudStatusHtml,
    count: unlockedCount,
    _reset: function () { S.unlocked = {}; for (const k in S.stats) S.stats[k] = (typeof S.stats[k] === 'object' ? {} : 0); }
  };
})();
