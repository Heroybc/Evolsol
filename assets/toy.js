/* 《衍时纪 · 朔望月》—— B站 Toy SDK 适配层
 *
 * 官方（github.com/bilibili/toy 的 content-checklist §7）公开的能力只有六个方法：
 *   getCloudStorage / setCloudStorage / removeCloudStorage
 *   submitScore / getRankList / getMyRank
 * **没有独立的「成就」接口** —— 成就要建在云存储之上（本作的成就系统见 assets/ach.js）。
 *
 * ⚠ 官方 SDK 文档在 bilibili.com 域名下（有验证码墙），本文件无法读到原始签名。
 *    因此这里做三件事：
 *      1. 运行时 feature-detect，缺哪个方法就关掉哪个能力，绝不抛错打断游戏；
 *      2. 所有调用集中在下面的 ADAPTER 里，签名对不上时**只改 ADAPTER 就够**；
 *      3. 每次调用结果都记进 CAP.log，游戏内「排行 / 成就」面板会把日志显示出来，
 *         所以在预览页点一下就能看出哪个能力真的可用。
 *
 * 调用节奏遵守官方 §7「频率限制与最佳实践」：
 *   · 云存储当存档，不当内存：游玩中只写内存，结算 / 过关 / 页面隐藏才落盘
 *   · 批量代替循环：一次写多个 key
 *   · 读结果本地缓存，不轮询
 *   · 排行榜按事件提交：只在结算提交一次
 *   · 失败退避重试：识别 307044 后指数退避，不立即重试
 */
(function () {
  'use strict';

  const CAP = {
    present: false, cloud: false, rank: false, checked: false,
    methods: [], log: []
  };

  function raw() {
    try { return (typeof window !== 'undefined' && window.toy) || null; } catch (e) { return null; }
  }
  function has(name) { const t = raw(); return !!(t && typeof t[name] === 'function'); }
  function logLine(s, cls) {
    CAP.log.unshift({ t: new Date().toLocaleTimeString(), s: s, cls: cls || '' });
    if (CAP.log.length > 24) CAP.log.pop();
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ================= 唯一的适配点 =================
   * 每个方法返回「若干种调用形态」，**每种形态本身是一个参数数组**：
   *     (t, a, b) => [ [a, b], [a], [] ]   ← 三种形态：f(a,b) / f(a) / f()
   * 读取类方法会按顺序试，第一个不抛错的胜出（读操作可安全重试）；
   * 写入类只给一种形态，避免重复消耗排行榜额度。
   * 若官方 SDK 的真实签名与此不同，**只需要改这个对象**。 */
  const ADAPTER = {
    getCloudStorage: (t, keys) => [[keys], [{ keyList: keys }]],
    setCloudStorage: (t, obj) => [[obj]],
    removeCloudStorage: (t, keys) => [[keys], [{ keyList: keys }]],
    submitScore: (t, score, extra) => [[{ score: score, extra: extra }], [score, extra], [score]],
    getRankList: (t, limit) => [[{ limit: limit }], [limit]],
    getMyRank: (t) => [[]]
  };

  function detect() {
    const t = raw();
    CAP.present = !!t;
    CAP.methods = t ? ['getCloudStorage', 'setCloudStorage', 'removeCloudStorage',
      'submitScore', 'getRankList', 'getMyRank'].filter(has) : [];
    CAP.cloud = has('getCloudStorage') && has('setCloudStorage');
    CAP.rank = has('submitScore') && has('getRankList');
    CAP.checked = true;
    if (!CAP.present) logLine('不在 Toy 容器内：云能力关闭，本局成绩只存本地');
    else logLine('检测到 toy 对象，可用方法 ' + CAP.methods.length + '/6');
    return CAP;
  }

  function withTimeout(p, ms) {
    return Promise.race([
      Promise.resolve(p),
      new Promise((_, rej) => setTimeout(() => rej(new Error('SDK 调用超时 ' + ms + 'ms')), ms))
    ]);
  }

  /** 依次尝试 ADAPTER 给出的调用形态，第一个不抛错的胜出 */
  async function call(name, args, timeout) {
    const t = raw();
    if (!t || typeof t[name] !== 'function') throw new Error('SDK 没有方法 ' + name);
    const shapes = ADAPTER[name](t, ...args);   // 数组的数组：每种形态是一个参数数组
    let lastErr = null;
    for (let i = 0; i < shapes.length; i++) {
      const argList = shapes[i];
      try {
        const r = await withTimeout(t[name].apply(t, argList), timeout || 8000);
        return r;
      } catch (e) {
        lastErr = e;
        // 限流是「等一等就行」，不是签名错，直接抛给上层退避
        if (isRateLimited(e)) throw e;
        // 参数形态不对才会走到这里，换下一种
      }
    }
    throw lastErr || new Error(name + ' 调用失败');
  }

  function isRateLimited(e) {
    return !!(e && (e.code === 307044 || e.code === '307044' ||
      (e.type === 'http_error' && String(e.message || '').indexOf('频繁') >= 0)));
  }

  /* ---------------- 云存储：内存优先，关键节点落盘 ---------------- */
  const pending = {};

  function queue(key, value) { pending[key] = String(value); }
  function hasPending() { return Object.keys(pending).length > 0; }

  async function flush(force) {
    const keys = Object.keys(pending);
    if (!keys.length) return { ok: true, skipped: true };
    if (!CAP.checked) detect();
    if (!CAP.cloud) {
      logLine('非 Toy 环境：' + keys.length + ' 项改动留在本地', 'dim');
      return { ok: false, reason: 'no-cloud' };
    }
    const payload = {};
    for (const k of keys) payload[k] = pending[k];   // 批量一次写完（官方 §7 第 2 条）
    let attempt = 0;
    while (attempt <= 3) {
      try {
        await call('setCloudStorage', [payload], 8000);
        for (const k of keys) delete pending[k];
        logLine('已同步 ' + keys.length + ' 项到 B站云存储', 'ok');
        return { ok: true, count: keys.length };
      } catch (e) {
        if (isRateLimited(e) && attempt < 3) {
          const wait = 400 * Math.pow(2, attempt) + Math.random() * 300;
          attempt++;
          logLine('触发频率限制，' + Math.round(wait) + 'ms 后重试（第 ' + attempt + ' 次）', 'warn');
          await sleep(wait);
          continue;
        }
        logLine('同步失败：' + (e && (e.message || e.type || e)), 'bad');
        return { ok: false, error: e };
      }
    }
    return { ok: false, reason: 'retry-exhausted' };
  }

  /** 读回云端存档；把各种可能的返回形态统一成 {key: value} */
  function normalizeKV(r, keys) {
    const out = {};
    if (!r) return out;
    const list = r.KVDataList || r.kvDataList || r.list ||
      (Array.isArray(r.data) ? r.data : null);
    if (Array.isArray(list)) {
      for (const it of list) {
        const k = it && (it.key || it.k);
        if (k) out[k] = (it.value !== undefined ? it.value : (it.v !== undefined ? it.v : it));
      }
      return out;
    }
    if (typeof r === 'object') {
      for (const k of keys) if (r[k] !== undefined) out[k] = r[k];
      if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
        for (const k of keys) if (r.data[k] !== undefined) out[k] = r.data[k];
      }
    }
    return out;
  }

  const readCache = {};
  async function load(keys) {
    if (!CAP.checked) detect();
    if (!CAP.cloud) return null;
    try {
      const r = await call('getCloudStorage', [keys], 8000);
      const kv = normalizeKV(r, keys);
      for (const k of keys) if (kv[k] !== undefined) readCache[k] = kv[k];
      logLine('已读取云端存档 ' + Object.keys(kv).length + ' 项', 'ok');
      return kv;
    } catch (e) {
      logLine('读取存档失败：' + (e && (e.message || e.type || e)), 'bad');
      return null;
    }
  }

  /* ---------------- 排行榜：按事件提交，一次 ---------------- */
  async function submitScore(score, extra) {
    if (!CAP.checked) detect();
    if (!CAP.rank) {
      logLine('排行榜能力不可用，成绩只记在本地', 'dim');
      return { ok: false, reason: 'no-rank' };
    }
    try {
      await call('submitScore', [Math.round(score), extra || {}], 8000);
      logLine('已提交成绩 ' + Math.round(score) + ' 到排行榜', 'ok');
      return { ok: true };
    } catch (e) {
      if (isRateLimited(e)) {
        await sleep(800 + Math.random() * 400);
        try {
          await call('submitScore', [Math.round(score), extra || {}], 8000);
          logLine('退避重试后提交成功', 'ok');
          return { ok: true, retried: true };
        } catch (e2) { e = e2; }
      }
      logLine('提交成绩失败：' + (e && (e.message || e.type || e)), 'bad');
      return { ok: false, error: e };
    }
  }

  async function getRankList(limit) {
    if (!CAP.checked) detect();
    if (!CAP.rank) return { ok: false, reason: 'no-rank' };
    try {
      const r = await call('getRankList', [limit || 20], 8000);
      const list = (r && (r.list || r.rankList || r.data || r.ranks)) || (Array.isArray(r) ? r : []);
      return { ok: true, list: Array.isArray(list) ? list : [] , raw: r };
    } catch (e) {
      logLine('读取排行榜失败：' + (e && (e.message || e.type || e)), 'bad');
      return { ok: false, error: e };
    }
  }

  async function getMyRank() {
    if (!CAP.checked) detect();
    if (!has('getMyRank')) return { ok: false, reason: 'no-api' };
    try { return { ok: true, rank: await call('getMyRank', [], 8000) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  // 页面隐藏 / 关闭时补一次落盘（官方 §7 第 1 条点名这个时机）
  try {
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && hasPending()) flush();
    });
    window.addEventListener('pagehide', function () { if (hasPending()) flush(); });
  } catch (e) { }

  window.ToyBridge = {
    CAP: CAP,
    detect: detect,
    queue: queue,
    flush: flush,
    load: load,
    normalizeKV: normalizeKV,
    submitScore: submitScore,
    getRankList: getRankList,
    getMyRank: getMyRank,
    isRateLimited: isRateLimited,
    _adapter: ADAPTER          // 暴露出来方便按真实签名替换
  };
  detect();
})();
