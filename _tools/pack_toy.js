/* 按 B站 Toy 官方《内容自检清单》打包并预检 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const RUNTIME = ['index.html', 'styles.css', 'assets'];
const FORBIDDEN = ['.git', 'node_modules', '__MACOSX', '.DS_Store', 'toy.yaml', 'package.json'];

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copy(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dst, f));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });
for (const r of RUNTIME) copy(path.join(ROOT, r), path.join(DIST, r));

const errors = [], warns = [], info = [];

// --- 检查 1：入口 index.html 位置 ---
const rootIndex = fs.existsSync(path.join(DIST, 'index.html'));
if (!rootIndex) errors.push('包根目录没有 index.html —— 平台会找不到入口');
else info.push('包根目录有 index.html ✓');

// --- 检查 2：禁用文件 ---
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const allFiles = walk(DIST, []);
for (const bad of FORBIDDEN) {
  const hit = allFiles.filter(f => f.split(path.sep).includes(bad) || path.basename(f) === bad);
  if (hit.length) errors.push('包里出现禁用文件 ' + bad + '（' + hit.length + ' 个）');
}

// --- 检查 3：HTML / CSS 里的绝对路径 ---
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(DIST, 'styles.css'), 'utf8');
const refs = [];
let m;
const refRe = /(?:src|href)\s*=\s*"([^"]+)"/g;
while ((m = refRe.exec(html))) refs.push(m[1]);
const cssUrlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
while ((m = cssUrlRe.exec(css))) refs.push(m[1]);

for (const r of refs) {
  if (/^(https?:)?\/\//.test(r)) { errors.push('引用了远程资源：' + r + '（平台可能拦截）'); continue; }
  if (r.startsWith('/')) { errors.push('用了根绝对路径：' + r + ' —— 在 /toy/<slug>/ 下会 404 白屏'); continue; }
  if (r.startsWith('data:')) continue;
  const clean = r.split('?')[0].split('#')[0];
  if (!fs.existsSync(path.join(DIST, clean))) errors.push('引用的文件在包里不存在：' + r);
  else info.push('资源引用正常：' + r);
}
if (/#\/[A-Za-z]/.test(html)) info.push('（检测到 hash 路由写法，平台已支持）');

// --- 检查 4：绝对 URL 跳转 / 外部请求 ---
const jsFiles = allFiles.filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const rel = path.relative(DIST, f);
  if (/https?:\/\//.test(t)) warns.push(rel + ' 里出现 http(s):// 字样');
  if (/\blocation\.href\b/.test(t)) warns.push(rel + ' 里用了 location.href，改用相对路径更安全');
  if (/\bfetch\s*\(|XMLHttpRequest/.test(t)) warns.push(rel + ' 里发起网络请求，Toy 下需谨慎');
  if (/\blocalStorage\b|\bsessionStorage\b/.test(t)) warns.push(rel + ' 里用了本地存储，Toy 沙箱内可能不可用');
  if (/^\s*(import|export)\s/m.test(t)) errors.push(rel + ' 用了 ES 模块语法，file:// 与部分容器会加载失败');
}

// --- 检查 5：文档体积 ---
const htmlBytes = Buffer.byteLength(html, 'utf8');
let total = 0;
for (const f of allFiles) total += fs.statSync(f).size;
info.push('index.html 文档体积 ' + (htmlBytes / 1024).toFixed(1) + ' KB');
info.push('整包体积 ' + (total / 1024).toFixed(1) + ' KB（' + allFiles.length + ' 个文件）');
if (htmlBytes > 1024 * 1024) warns.push('index.html 超过 1MB，每次打开都要完整下载，建议把内联数据外置');

// --- 检查 6：contenthash（官方说是建议，不阻断） ---
const assets = allFiles.filter(f => /\.(js|css)$/.test(f) && !/\.min\./.test(f));
if (assets.length >= 2 && assets.every(f => !/[-.][A-Za-z0-9_]{6,}\.(js|css)$/.test(f))) {
  warns.push('JS/CSS 文件名不带内容指纹：更新后用户需重新下载全部资源（约 ' +
    (total / 1024).toFixed(0) + ' KB，实际影响很小）');
}

console.log('=== B站 Toy 打包预检 ===\n');
for (const i of info) console.log('  · ' + i);
console.log('');
for (const w of warns) console.log('  ⚠ WARN  ' + w);
for (const e of errors) console.log('  ✗ ERROR ' + e);
console.log('\n文件清单：');
for (const f of allFiles.map(f => path.relative(DIST, f)).sort()) {
  console.log('  ' + f + '  (' + (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(1) + ' KB)');
}
console.log('\n' + (errors.length ? '✗ ' + errors.length + ' 个 ERROR，需先修' :
  '✓ 无 ERROR' + (warns.length ? '，' + warns.length + ' 个 WARN（不阻断发布）' : '，也无 WARN')));
process.exit(errors.length ? 1 : 0);
