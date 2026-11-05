/* 《衍时纪 · 朔望月》—— 战报：记录、逐步复盘、导出
 *
 * 设计取自同系列两个项目的经验：
 *   · Duelyst：记录导出 JSON；Toy 在 iframe 里下载可能被拦，所以必须留「复制」兜底。
 *   · BBZ：不重跑引擎，而是把「当时看到什么、做了什么、结算成什么」存成快照，
 *          复盘时一页一页翻。
 *
 * 本作的随机数没有做种子化（洗牌 / 商店 / AI 都用 Math.random），
 * 因此不做「种子 + 动作序列」的真实回放，只做**自包含的分析型战报**：
 * 每一步都带当时的牌、算式、牌型、金币与判断依据，换设备也看得懂。
 *
 * 记录体积不大：一局闯关约 80–150 步，JSON 约 30–80 KB。
 * 最近 6 局存在 localStorage；写满时只保留最新一局，绝不因为存档失败影响对局。
 *
 * 挂到 window.Replay。所有 DOM 操作都判空，无头测试环境下静默降级。
 */
(function () {
  'use strict';

  const APP = 'evolsol';
  const VER = 1;
  const KEY = 'evolsol.reports.v1';
  const KEY_LAST = 'evolsol.report.last';
  const MAX_RUNS = 6;
  const MAX_CHARS = 360000;      // 单份记录落盘上限，超长只当前会话可看

  const $ = id => { try { return document.getElementById(id); } catch (e) { return null; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nfmt = n => {
    if (n == null || n === '') return '—';
    if (typeof n !== 'number') return String(n);
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  const fmtMult = v => String(Math.round((Number(v) || 0) * 100) / 100);
  const pad2 = n => ('0' + n).slice(-2);

  let cur = null;                // 正在录的这一局
  let view = null;               // { list:true } 或 { run, i, exportOpen, expFmt }
  let overlay = null;            // 复盘浮层（独立于 #modal / #rOverlay）
  let memory = [];               // localStorage 不可用时的内存兜底

  // ============================== 存储 ==============================
  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Object.prototype.toString.call(arr) === '[object Array]') {
          return arr.filter(r => r && r.app === APP);
        }
      }
    } catch (e) { }
    return memory.slice();
  }

  function writeAll(arr) {
    memory = arr.slice();
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  function save(run) {
    const text = JSON.stringify(run);
    run.saved = text.length <= MAX_CHARS;
    if (!run.saved) {
      memory = [run].concat(memory).slice(0, MAX_RUNS);
      return run;
    }
    let arr = readAll().filter(r => r && r.id !== run.id);
    arr.unshift(run);
    arr = arr.slice(0, MAX_RUNS);
    if (!writeAll(arr)) writeAll([run]);      // 配额满：宁可丢老记录，不丢这一局
    try { localStorage.setItem(KEY_LAST, JSON.stringify(run)); } catch (e) { }
    return run;
  }

  function last() {
    const arr = readAll();
    if (arr.length) return arr[0];
    try {
      const raw = localStorage.getItem(KEY_LAST);
      if (raw) {
        const run = JSON.parse(raw);
        if (run && run.app === APP) return run;
      }
    } catch (e) { }
    return null;
  }

  function list() { return readAll(); }

  // ============================== 记录 ==============================
  function stampId(modeId) {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '-' + (modeId || 0);
  }

  function begin(meta) {
    meta = meta || {};
    cur = {
      app: APP, v: VER,
      id: stampId(meta.modeId),
      createdAt: new Date().toISOString(),
      endedAt: null,
      kind: meta.kind === 'rogue' ? 'rogue' : 'multi',
      modeId: meta.modeId || 0,
      modeName: meta.modeName || '衍时纪 · 朔望月',
      meta: {
        players: meta.players || [],
        rule: meta.rule || '',
        desc: meta.desc || ''
      },
      steps: [],
      result: null
    };
    return cur;
  }

  function active() { return cur; }

  /** 记一步。字段全部可选，渲染时按存在的字段拼装。
   *  g 分组 / k 类型 / t 标题 / who 当事人 / tag 列表角标 / cards 牌 / hands 牌型
   *  formula 算式 / lines 关键数字 / table 明细表 / best 最优对比
   *  body 说明 / why 当时的判断 / view 当时看得到什么 / note 备注
   *  score / target 供自动汇总用
   */
  function step(o) {
    if (!cur || !o) return;
    if (cur.steps.length >= 800) return;     // 一局不可能走到这里，兜底防失控
    o.i = cur.steps.length + 1;
    cur.steps.push(o);
  }

  function finish(result) {
    if (!cur) return null;
    const run = cur;
    cur = null;
    run.endedAt = new Date().toISOString();
    run.result = result || {};
    if (run.kind === 'rogue' && !run.result.table) run.result.table = blindTable(run);
    if (run.steps.length) save(run);
    return run;
  }

  /** 闯关的自动汇总：按「开始这一关」切段，累计每关得分 */
  function blindTable(run) {
    const segs = [];
    for (const s of (run.steps || [])) {
      if (s.k === 'blind') segs.push({ g: s.g || '关卡', target: s.target || 0, score: 0, cleared: false, skipped: false });
      else if (s.k === 'skip' && segs.length) segs[segs.length - 1].skipped = true;
      else if (s.k === 'play' && segs.length) segs[segs.length - 1].score += (s.score || 0);
      else if (s.k === 'clear' && segs.length) {
        const seg = segs[segs.length - 1];
        seg.cleared = true;
        if (s.score) seg.score = s.score;
      }
    }
    if (!segs.length) return null;
    return {
      head: ['关卡', '目标分', '本关得分', '结果'],
      rows: segs.map(seg => [
        seg.g, nfmt(seg.target), nfmt(seg.score),
        seg.skipped ? '跳过' : (seg.cleared ? '通过' : '未通过')
      ])
    };
  }

  // ============================== 渲染小件 ==============================
  function fmtTime(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function duration(run) {
    const a = new Date(run.createdAt).getTime(), b = new Date(run.endedAt || Date.now()).getTime();
    if (!a || !b || b < a) return '';
    const min = Math.max(1, Math.round((b - a) / 60000));
    return min + ' 分钟';
  }

  function seasonCls(s) {
    return { '春': 's-spring', '夏': 's-summer', '秋': 's-autumn', '冬': 's-winter' }[s] || '';
  }

  function outcomeOf(run) {
    const o = run && run.result && run.result.outcome;
    if (o === 'win') return { t: '胜', c: 'win' };
    if (o === 'lose') return { t: '负', c: 'lose' };
    if (o === 'fail') return { t: '止步', c: 'fail' };
    return { t: '终局', c: 'done' };
  }

  function outcomeBadge(run) {
    const o = outcomeOf(run);
    return '<span class="rp-ob ' + o.c + '">' + o.t + '</span>';
  }

  const KIND = {
    deal: '发牌', action: '行动', result: '结算', blind: '关卡', play: '出牌',
    discard: '弃牌', shop: '商店', clear: '过关', relic: '遗物', skip: '跳过', note: '备注'
  };
  const kindLabel = k => KIND[k] || '记录';

  function cardsHtml(cards) {
    if (!cards || !cards.length) return '';
    return '<div class="rp-cards">' + cards.map(c =>
      '<span class="rp-card ' + seasonCls(c.s) + '"><b>' + esc(c.n) + '</b><i>' + esc(c.d || '') + '</i></span>'
    ).join('') + '</div>';
  }

  function linesHtml(lines) {
    if (!lines || !lines.length) return '';
    return '<div class="rp-lines">' + lines.map(x =>
      '<div class="rp-line"><span class="rp-lk">' + esc(x.label) + '</span>' +
      '<span class="rp-lv' + (x.tone ? ' tone-' + x.tone : '') + '">' + esc(x.value) + '</span></div>'
    ).join('') + '</div>';
  }

  function tableHtml(t) {
    if (!t || !t.head || !t.rows || !t.rows.length) return '';
    const cls = (t.head[0] === '#' ? ' rp-table-num' : '') +
      (t.head[0] === '来源' ? ' rp-table-src' : '');
    return '<div class="rp-tw"><table class="rp-table' + cls + '"><thead><tr>' +
      t.head.map(h => '<th>' + esc(h) + '</th>').join('') +
      '</tr></thead><tbody>' +
      t.rows.map(row => '<tr>' + row.map((cell, i) =>
        '<td' + (i === 0 ? ' class="rp-td-name"' : '') + '>' + esc(cell) + '</td>'
      ).join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  function secHtml(label, text, cls) {
    if (!text) return '';
    return '<div class="rp-sec ' + (cls || '') + '"><div class="rp-lab">' + esc(label) + '</div>' +
      '<p>' + esc(text) + '</p></div>';
  }

  function stepHtml(s) {
    let h = '<div class="rp-kicker">' + esc(s.g || '') + ' · ' + kindLabel(s.k) + '</div>';
    h += '<h3 class="rp-h3">' + (s.who ? '<b>' + esc(s.who) + '</b> · ' : '') + esc(s.t || '') + '</h3>';
    h += cardsHtml(s.cards);
    if (s.formula) h += '<div class="rp-formula">' + esc(s.formula) + '</div>';
    h += linesHtml(s.lines);
    if (s.best) {
      h += '<div class="rp-best' + (s.best.delta > 0 ? ' miss' : ' ok') + '">' +
        '<b>' + (s.best.delta > 0 ? '本手本可以更高' : '本手已是最优解') + '</b>' +
        '<span>' + esc(s.best.text) + '</span></div>';
    }
    h += tableHtml(s.table);
    h += secHtml('说明', s.body);
    h += secHtml('当时怎么想', s.why, 'why');
    h += secHtml('当时看得到', s.view, 'view');
    if (s.note) h += '<div class="rp-note">' + esc(s.note) + '</div>';
    return h;
  }

  function summaryHtml(run) {
    const r = run.result || {};
    const steps = run.steps || [];
    let h = '<div class="rp-kicker">总览</div>';
    h += '<h3 class="rp-h3">' + esc(r.headline || run.modeName) + '</h3>';
    h += '<div class="rp-sums">' +
      '<div class="rp-sum"><span>模式</span><b>' + esc(run.modeName) + '</b></div>' +
      '<div class="rp-sum"><span>时间</span><b>' + esc(fmtTime(run.createdAt)) + '</b></div>' +
      '<div class="rp-sum"><span>时长</span><b>' + esc(duration(run) || '—') + '</b></div>' +
      '<div class="rp-sum"><span>记录</span><b>' + steps.length + ' 步</b></div>' +
      (r.score != null ? '<div class="rp-sum"><span>' + esc(r.scoreLabel || '成绩') +
        '</span><b class="gold">' + nfmt(r.score) + '</b></div>' : '') +
      '</div>';
    if (r.lines && r.lines.length) {
      h += '<ul class="rp-rul">' + r.lines.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    }
    h += tableHtml(r.table);
    if (r.note) h += '<div class="rp-note">' + esc(r.note) + '</div>';
    if (run.meta && run.meta.desc) h += '<p class="rp-tip">' + esc(run.meta.desc) + '</p>';
    h += '<p class="rp-tip">用 ← → 翻页，Home / End 跳到首尾。每一页都是当时算出来的快照，不重跑引擎。</p>';
    return h;
  }

  function listHtml(run, idx) {
    const steps = run.steps || [];
    let h = '<button class="rp-item rp-item-sum' + (idx === 0 ? ' on' : '') + '" data-act="step" data-i="0">' +
      '<span class="rp-no">·</span><span class="rp-it">总览</span></button>';
    let lastG = '';
    for (let k = 0; k < steps.length; k++) {
      const s = steps[k];
      if (s.g && s.g !== lastG) {
        lastG = s.g;
        h += '<div class="rp-group">' + esc(lastG) + '</div>';
      }
      h += '<button class="rp-item' + (idx === k + 1 ? ' on' : '') + '" data-act="step" data-i="' + (k + 1) + '">' +
        '<span class="rp-no">' + (k + 1) + '</span>' +
        '<span class="rp-it">' + esc(s.t || kindLabel(s.k)) + '</span>' +
        (s.tag ? '<span class="rp-tagv">' + esc(s.tag) + '</span>' : '') +
        '</button>';
    }
    return h;
  }

  // ============================== 浮层 ==============================
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = $('rpOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'rpOverlay';
      overlay.className = 'rp-overlay';
      if (document.body && document.body.appendChild) document.body.appendChild(overlay);
    }
    overlay.onclick = onOverlayClick;
    return overlay;
  }

  function onOverlayClick(e) {
    let el = e && e.target;
    while (el && el !== overlay) {
      if (el.getAttribute) {
        const act = el.getAttribute('data-act');
        if (act) { handleAct(act, el, e); return; }
      }
      el = el.parentNode;
    }
  }

  function handleAct(act, el, e) {
    const run = view && view.run;
    if (act === 'close') return close();
    if (act === 'prev') return goTo((view ? view.i : 0) - 1);
    if (act === 'next') return goTo((view ? view.i : 0) + 1);
    if (act === 'first') return goTo(0);
    if (act === 'last') return goTo(run ? (run.steps || []).length : 0);
    if (act === 'step') return goTo(parseInt(el.getAttribute('data-i'), 10) || 0);
    if (act === 'export') { if (view && view.run) { view.exportOpen = true; view.expFmt = view.expFmt || 'json'; render(); } return; }
    if (act === 'exp-close') { if (view) { view.exportOpen = false; render(); } return; }
    if (act === 'fmt') { if (view) { view.expFmt = el.getAttribute('data-fmt') || 'json'; render(); } return; }
    if (act === 'dl') { doDownload(el.getAttribute('data-kind') || 'json'); return; }
    if (act === 'copy') { doCopy(el.getAttribute('data-kind') || 'json'); return; }
    if (act === 'open') {
      const id = el.getAttribute('data-id');
      const hit = readAll().filter(r => r.id === id)[0];
      if (hit) open(hit);
      return;
    }
    if (act === 'back') { openList(); return; }
    if (e && e.preventDefault) e.preventDefault();
  }

  function goTo(i) {
    if (!view || view.list || !view.run) return;
    const n = (view.run.steps || []).length;
    view.i = Math.max(0, Math.min(n, i));
    view.exportOpen = false;
    render();
  }

  function close() {
    if (overlay) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
    view = null;
  }

  function open(run) {
    if (typeof run === 'string') run = readAll().filter(r => r.id === run)[0];
    if (!run) run = last();
    if (!run) { openList(); return; }
    if (!run.steps) run.steps = [];
    view = { run: run, i: 0, exportOpen: false, expFmt: 'json' };
    render();
  }

  function openLast() { open(last()); }

  function openList() {
    view = { list: true, i: 0, exportOpen: false };
    render();
  }

  function render() {
    if (!view) return;
    const ov = ensureOverlay();
    ov.style.display = 'flex';

    if (view.list) {
      const arr = readAll();
      let body;
      if (!arr.length) {
        body = '<div class="rp-empty">还没有战报。打完一局（或走完一次闯关）后，结算面板会出现「战报 · 复盘」；' +
          '之后也可以从菜单的「战报」回到这里查看。</div>';
      } else {
        body = '<div class="rp-runs">' + arr.map(run => {
          const r = run.result || {};
          return '<button class="rp-run" data-act="open" data-id="' + esc(run.id) + '">' +
            '<span class="rp-run-top"><b>' + esc(run.modeName) + '</b>' + outcomeBadge(run) + '</span>' +
            '<span class="rp-run-main">' + esc(r.headline || '（没有结算摘要）') + '</span>' +
            '<span class="rp-run-sub">' + esc(fmtTime(run.createdAt)) + ' · ' +
            ((run.steps || []).length) + ' 步' +
            (r.score != null ? ' · ' + esc(r.scoreLabel || '成绩') + ' ' + nfmt(r.score) : '') +
            '</span></button>';
        }).join('') + '</div>';
      }
      ov.innerHTML = '<div class="rp-shell rp-shell-list">' +
        '<header class="rp-head"><div class="rp-title"><span class="rp-moon">🌙</span> 战报 · 最近记录</div>' +
        '<button class="rp-x" data-act="close" title="关闭">✕</button></header>' +
        '<div class="rp-body-list">' + body + '</div>' +
        '<footer class="rp-foot"><div class="rp-acts">' +
        '<button class="btn tiny ghost" data-act="close">关闭</button></div></footer></div>';
      return;
    }

    const run = view.run;
    const n = (run.steps || []).length;
    const i = Math.max(0, Math.min(n, view.i || 0));
    view.i = i;

    let exp = '';
    if (view.exportOpen) {
      const fmt = view.expFmt || 'json';
      const text = fmt === 'md' ? toMarkdown(run) : toJson(run);
      exp = '<div class="rp-exp"><div class="rp-exp-box">' +
        '<div class="rp-exp-head"><b>导出战报</b>' +
        '<span>' + esc(fileName(run, fmt)) + ' · ' + Math.max(1, Math.round(text.length / 1024)) + ' KB</span>' +
        '<button class="rp-x" data-act="exp-close" title="关闭">✕</button></div>' +
        '<div class="rp-exp-tabs">' +
        '<button class="rp-tab' + (fmt === 'json' ? ' on' : '') + '" data-act="fmt" data-fmt="json">JSON · 完整记录</button>' +
        '<button class="rp-tab' + (fmt === 'md' ? ' on' : '') + '" data-act="fmt" data-fmt="md">Markdown · 人读版</button>' +
        '</div>' +
        '<textarea id="rpExportText" class="rp-text" readonly spellcheck="false"></textarea>' +
        '<div class="rp-exp-foot">' +
        '<button class="btn tiny primary" data-act="dl" data-kind="' + fmt + '">下载 .' + fmt + '</button>' +
        '<button class="btn tiny" data-act="copy" data-kind="' + fmt + '">复制全文</button>' +
        '<span id="rpExpMsg" class="rp-exp-msg">Toy 内若下载被拦，可直接全选下面的文本复制。</span>' +
        '</div></div></div>';
    }

    ov.innerHTML = '<div class="rp-shell">' +
      '<header class="rp-head">' +
      '<div class="rp-title"><span class="rp-moon">🌙</span> 战报 · ' + esc(run.modeName) + '</div>' +
      '<div class="rp-headmeta">' + outcomeBadge(run) +
      '<span class="rp-time">' + esc(fmtTime(run.createdAt)) + '</span>' +
      '<span class="rp-time">' + esc(duration(run)) + '</span></div>' +
      '<button class="rp-x" data-act="close" title="关闭">✕</button>' +
      '</header>' +
      '<div class="rp-body">' +
      '<aside class="rp-list">' + listHtml(run, i) + '</aside>' +
      '<section class="rp-detail" id="rpDetail">' +
      (i === 0 ? summaryHtml(run) : stepHtml((run.steps || [])[i - 1])) +
      '</section></div>' +
      '<footer class="rp-foot"><div class="rp-nav">' +
      '<button class="rp-nb" data-act="first"' + (i === 0 ? ' disabled' : '') + ' title="总览">⏮</button>' +
      '<button class="rp-nb" data-act="prev"' + (i === 0 ? ' disabled' : '') + '>◀ 上一步</button>' +
      '<span class="rp-pos">' + (i === 0 ? '总览' : '第 ' + i + ' / ' + n + ' 步') + '</span>' +
      '<button class="rp-nb" data-act="next"' + (i >= n ? ' disabled' : '') + '>下一步 ▶</button>' +
      '<button class="rp-nb" data-act="last"' + (i >= n ? ' disabled' : '') + ' title="最后一步">⏭</button>' +
      '</div><div class="rp-acts">' +
      '<button class="btn tiny primary" data-act="export">导出战报</button>' +
      '<button class="btn tiny ghost" data-act="close">关闭</button>' +
      '</div></footer>' + exp + '</div>';

    if (view.exportOpen) {
      const ta = $('rpExportText');
      if (ta) ta.value = (view.expFmt === 'md' ? toMarkdown(run) : toJson(run));
    }
    const d = $('rpDetail');
    if (d) d.scrollTop = 0;
  }

  // ============================== 导出 ==============================
  const SHORT_MODE = { 1: '原-朔望月', 2: '衍时-朔望月', 3: '衍时纪' };

  function fileName(run, fmt) {
    const d = new Date(run.createdAt || Date.now());
    const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes());
    return '衍时纪-战报-' + (SHORT_MODE[run.modeId] || '对局') + '-' + stamp + '.' + fmt;
  }

  function toJson(run) {
    return JSON.stringify(run, null, 2);
  }

  function mdCell(v) {
    return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function toMarkdown(run) {
    const r = run.result || {};
    const L = [];
    L.push('# 衍时纪 · 朔望月 · 战报');
    L.push('');
    L.push('- **模式**：' + run.modeName);
    L.push('- **时间**：' + fmtTime(run.createdAt) + (duration(run) ? '（' + duration(run) + '）' : ''));
    L.push('- **结果**：' + (r.headline || '—'));
    if (r.score != null) L.push('- **' + (r.scoreLabel || '成绩') + '**：' + nfmt(r.score));
    L.push('- **步数**：' + (run.steps || []).length);
    L.push('');
    if (r.lines && r.lines.length) {
      L.push('## 总览');
      L.push('');
      for (const x of r.lines) L.push('- ' + x);
      L.push('');
    }
    if (r.table) {
      L.push('| ' + r.table.head.map(mdCell).join(' | ') + ' |');
      L.push('|' + r.table.head.map(() => ' --- ').join('|') + '|');
      for (const row of r.table.rows) L.push('| ' + row.map(mdCell).join(' | ') + ' |');
      L.push('');
    }
    if (r.note) { L.push('> ' + r.note); L.push(''); }
    L.push('---');
    L.push('');

    let lastG = '';
    for (const s of (run.steps || [])) {
      if (s.g && s.g !== lastG) {
        lastG = s.g;
        L.push('## ' + lastG);
        L.push('');
      }
      L.push('### ' + s.i + '. ' + (s.who ? s.who + ' · ' : '') + (s.t || kindLabel(s.k)));
      L.push('');
      if (s.cards && s.cards.length) L.push('- 牌：' + s.cards.map(c => c.n + '（' + (c.d || '') + '）').join('、'));
      if (s.hands && s.hands.length) L.push('- 牌型：' + s.hands.join(' · '));
      if (s.formula) L.push('- 算式：' + s.formula);
      if (s.lines) for (const x of s.lines) L.push('- ' + x.label + '：' + x.value);
      if (s.best) L.push('- 最优对比：' + s.best.text);
      if (s.body) L.push('- 说明：' + s.body);
      if (s.why) L.push('- 当时怎么想：' + s.why);
      if (s.view) L.push('- 当时看得到：' + s.view);
      if (s.note) L.push('- 备注：' + s.note);
      if (s.table && s.table.head) {
        L.push('');
        L.push('| ' + s.table.head.map(mdCell).join(' | ') + ' |');
        L.push('|' + s.table.head.map(() => ' --- ').join('|') + '|');
        for (const row of s.table.rows) L.push('| ' + row.map(mdCell).join(' | ') + ' |');
      }
      L.push('');
    }
    L.push('---');
    L.push('');
    L.push('*由《衍时纪 · 朔望月》本地战报生成。每一步都是当时的快照，不重跑引擎。*');
    return L.join('\n');
  }

  function download(name, text, mime) {
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      if (document.body && document.body.appendChild) document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
          if (a.parentNode && a.parentNode.removeChild) a.parentNode.removeChild(a);
        } catch (e) { }
      }, 1200);
      return true;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { }
    try {
      const ta = $('rpExportText');
      if (ta && ta.select) {
        ta.select();
        return document.execCommand('copy');
      }
    } catch (e) { }
    return false;
  }

  function expMsg(t) {
    const el = $('rpExpMsg');
    if (el) el.textContent = t;
  }

  function doDownload(kind) {
    if (!view || !view.run) return;
    const text = kind === 'md' ? toMarkdown(view.run) : toJson(view.run);
    const name = fileName(view.run, kind);
    const ok = download(name, text, kind === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8');
    expMsg(ok ? '已生成下载：' + name + '（若浏览器没反应，请直接复制文本）'
      : '下载被当前容器拦截，请直接全选下面的文本复制。');
  }

  function doCopy(kind) {
    if (!view || !view.run) return;
    const text = kind === 'md' ? toMarkdown(view.run) : toJson(view.run);
    expMsg(copyText(text) ? '已复制到剪贴板。' : '复制被拦截，请点进文本框后全选复制。');
  }

  // ============================== 键盘 ==============================
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', function (e) {
      if (!view || view.list) return;
      if (view.exportOpen && e.key !== 'Escape') return;
      if (e.key === 'ArrowLeft') { goTo(view.i - 1); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'ArrowRight') { goTo(view.i + 1); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'Home') { goTo(0); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'End') { goTo((view.run && view.run.steps || []).length); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === 'Escape') { close(); }
    });
  }

  // ============================== 对外 ==============================
  window.Replay = {
    begin: begin,
    step: step,
    finish: finish,
    active: active,
    last: last,
    list: list,
    open: open,
    openLast: openLast,
    openList: openList,
    toJson: toJson,
    toMarkdown: toMarkdown,
    fileName: fileName,
    download: download,
    close: close,
    _go: goTo,
    _state: function () { return { cur: cur, view: view }; }
  };
})();
