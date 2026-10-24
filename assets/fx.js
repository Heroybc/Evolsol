/* 《衍时纪 · 朔望》—— 音效与特效层
 * 音效：Web Audio 实时合成，零音频文件，离线 / file:// / Toy 均可用
 * 特效：DOM 粒子与动画，事件驱动（只在事件发生处触发，不随重渲染重复播放）
 * 挂载到 window.FX；所有接口在缺少 DOM / AudioContext 的环境下静默降级
 */
(function () {
  'use strict';

  // ============================== 状态 ==============================
  let ctx = null, master = null;
  let muted = false;
  try { muted = localStorage.getItem('sw_mute') === '1'; } catch (e) { }

  function ac() {
    if (muted) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { } }
    return ctx;
  }
  // 首次交互时解锁音频（浏览器自动播放策略）
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', function unlock() {
      if (!muted) ac();
      document.removeEventListener('pointerdown', unlock);
    }, { once: true });
  }

  // ============================== 合成器 ==============================
  function tone(o) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (o.t || 0);
    const dur = o.d || 0.15;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f), t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slide), t0 + dur);
    const v = o.v || 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noise(o) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (o.t || 0);
    const dur = o.d || 0.1;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.setValueAtTime(o.fq || 2000, t0);
    flt.Q.value = o.q || 0.9;
    if (o.slideFq) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideFq), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.v || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0);
  }

  // ============================== 音效谱 ==============================
  const PENTA = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093];
  const SFX = {
    click: () => tone({ f: 660, d: 0.05, type: 'triangle', v: 0.12 }),
    deal: () => { noise({ d: 0.09, v: 0.22, fq: 2600, q: 0.7 }); tone({ f: 330, d: 0.05, type: 'triangle', v: 0.06, t: 0.02 }); },
    coin: () => { tone({ f: 1568, d: 0.07, type: 'triangle', v: 0.2 }); tone({ f: 2093, d: 0.1, type: 'triangle', v: 0.16, t: 0.05 }); },
    raise: () => { tone({ f: 1047, d: 0.06, type: 'square', v: 0.1 }); tone({ f: 1568, d: 0.07, type: 'triangle', v: 0.18, t: 0.04 }); tone({ f: 2093, d: 0.1, type: 'triangle', v: 0.18, t: 0.09 }); },
    allin: () => { for (let i = 0; i < 5; i++) tone({ f: 1319 + i * 220, d: 0.06, type: 'square', v: 0.09, t: i * 0.05 }); tone({ f: 110, d: 0.2, type: 'sine', v: 0.25, t: 0.02 }); },
    fold: () => tone({ f: 150, d: 0.18, type: 'sine', v: 0.22, slide: 70 }),
    life: () => { tone({ f: 68, d: 0.14, type: 'sine', v: 0.4 }); tone({ f: 68, d: 0.2, type: 'sine', v: 0.42, t: 0.24 }); },
    cheat: () => tone({ f: 880, d: 0.14, type: 'sine', v: 0.13, slide: 1976 }),
    accuse: () => { tone({ f: 1976, d: 0.08, type: 'square', v: 0.13 }); tone({ f: 1976, d: 0.1, type: 'square', v: 0.13, t: 0.12 }); tone({ f: 2637, d: 0.16, type: 'triangle', v: 0.14, t: 0.22 }); },
    accuseFail: () => tone({ f: 420, d: 0.3, type: 'sawtooth', v: 0.1, slide: 140 }),
    showdown: () => { noise({ d: 0.45, v: 0.13, fq: 700, slideFq: 4200, q: 1.2 }); tone({ f: 392, d: 0.3, type: 'sine', v: 0.1, slide: 784 }); },
    combo: i => {
      const f = PENTA[Math.min(i, PENTA.length - 1)];
      tone({ f: f, d: 0.13, type: 'triangle', v: 0.2 });
      tone({ f: f * 2, d: 0.09, type: 'sine', v: 0.07 });
    },
    tick: () => tone({ f: 2350, d: 0.03, type: 'square', v: 0.05 }),
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ f: f, d: 0.16, type: 'triangle', v: 0.2, t: i * 0.09 })); tone({ f: 1319, d: 0.34, type: 'triangle', v: 0.2, t: 0.38 }); tone({ f: 659, d: 0.34, type: 'sine', v: 0.1, t: 0.38 }); },
    lose: () => { [392, 330, 262].forEach((f, i) => tone({ f: f, d: 0.22, type: 'sine', v: 0.16, t: i * 0.15 })); },
    bust: () => { tone({ f: 220, d: 0.42, type: 'sawtooth', v: 0.18, slide: 52 }); noise({ d: 0.3, v: 0.14, fq: 280, t: 0.04 }); },
    phase: () => { tone({ f: 262, d: 1.3, type: 'sine', v: 0.28, attack: 0.01 }); tone({ f: 524, d: 1.1, type: 'sine', v: 0.13 }); tone({ f: 786, d: 0.9, type: 'sine', v: 0.07 }); },
    achieve: () => { [880, 1109, 1319, 1760].forEach((f, i) => tone({ f: f, d: 0.12, type: 'sine', v: 0.15, t: i * 0.07 })); },
    pot: () => tone({ f: 1175, d: 0.06, type: 'triangle', v: 0.12 })
  };

  function play(name, arg) {
    if (muted) return;
    const fn = SFX[name];
    if (!fn) return;
    try { fn(arg); } catch (e) { }
  }

  // ============================== 特效 ==============================
  function layer() {
    let l = document.getElementById('fx-layer');
    if (!l) {
      l = document.createElement('div');
      l.id = 'fx-layer';
      if (document.body && document.body.appendChild) document.body.appendChild(l);
    }
    return l;
  }
  function addCls(el, c) {
    if (el && ('className' in el)) el.className += (el.className ? ' ' : '') + c;
  }

  /** 在锚点元素处飘出文字（+N 金币、爆、圆满…） */
  function floatTextAt(anchor, text, cls) {
    if (!anchor || !anchor.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'fx-float ' + (cls || 'gold');
    el.textContent = text;
    el.style.left = (r.left + r.width / 2 - 20) + 'px';
    el.style.top = (r.top - 6) + 'px';
    layer().appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
  }

  /** 全屏金雨（胜利） */
  function confetti(n) {
    const l = layer();
    const colors = ['#e9cd82', '#c9a23f', '#fff3d0', '#d9b95f', '#a8842c'];
    const count = n || 70;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'fx-conf';
      const s = 4 + Math.random() * 7;
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.width = s + 'px';
      p.style.height = (s * (Math.random() < 0.4 ? 2.2 : 1)) + 'px';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.1 + Math.random() * 1.3) + 's';
      p.style.animationDelay = (Math.random() * 0.35) + 's';
      if (Math.random() < 0.3) p.style.borderRadius = '50%';
      l.appendChild(p);
      (function (pp) { setTimeout(() => { if (pp.parentNode) pp.parentNode.removeChild(pp); }, 3000); })(p);
    }
  }

  /** 全屏闪光：gold（胜利 / 满月）/ red（爆点） */
  function flash(kind) {
    const el = document.createElement('div');
    el.className = 'fx-flash ' + kind;
    layer().appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 800);
  }

  /** 抖动（爆点、喝破失败） */
  function shake(el) {
    if (!el) return;
    addCls(el, 'fx-shake');
    setTimeout(() => { if (el.className) el.className = el.className.replace(' fx-shake', ''); }, 500);
  }

  /** 容器内元素逐个弹入（发牌、combo、摊牌卡片） */
  function stagger(root, sel, opt) {
    if (!root || !root.querySelectorAll) return;
    const els = root.querySelectorAll(sel);
    if (!els || !els.length) return;
    opt = opt || {};
    const step = opt.step || 70, base = opt.base || 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      el.style.animationDelay = (base + i * step) + 'ms';
      addCls(el, opt.cls || 'fx-pop');
      if (opt.sound) {
        (function (idx) { setTimeout(() => play(opt.sound, idx), base + idx * step); })(i);
      }
    }
  }

  /** 数字滚动（得分、点数），带 tick 音；opt.fmt 可传格式化函数（如加千分位） */
  function countUp(el, to, opt) {
    if (!el) return;
    opt = opt || {};
    const from = opt.from || 0, dur = opt.dur || 650;
    const fmt = opt.fmt || function (v) { return String(v); };
    const raf = window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    let lastTick = 0, frames = 0;
    function frame(now) {
      now = now || Date.now();
      // 兜底路径（无 rAF 的环境）下防止帧循环不收敛
      if (++frames > 200) { el.textContent = fmt(to); return; }
      const t = Math.min(1, (now - t0) / dur);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      el.textContent = fmt(v);
      if (opt.sound !== false && now - lastTick > 75 && t < 1) { lastTick = now; play('tick'); }
      if (t < 1) raf(frame);
    }
    raf(frame);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('sw_mute', m ? '1' : '0'); } catch (e) { }
    if (m && ctx) { try { ctx.suspend(); } catch (e) { } }
    else if (!m && ctx) { try { ctx.resume(); } catch (e) { } }
  }

  window.FX = {
    play: play,
    floatTextAt: floatTextAt,
    confetti: confetti,
    flash: flash,
    shake: shake,
    stagger: stagger,
    countUp: countUp,
    setMuted: setMuted,
    isMuted: function () { return muted; }
  };
})();
