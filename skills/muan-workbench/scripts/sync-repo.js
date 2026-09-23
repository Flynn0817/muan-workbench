#!/usr/bin/env node
/* 把工作区源码同步进开源仓库（仓库路径见同目录的 sync-repo.local.json）
   用法：node sync-repo.js
   做四件事：① 拷 app/index.html 并脱敏 DEFAULT_CLOUD ② 拷 server.js / sw.js / manifest / vendor
             ③ 泄露扫描（只报真实敏感值，不误判文档里的警示语）④ 自检 app/data 预置图
   退出码非 0 表示扫描到疑似泄露，此时**不要** git commit。

   个人化的敏感值（真实项目 ref、姓名、本机路径）与绝对路径都不写在本文件里——
   本文件会公开发布，硬编码这些值等于「扫描器自己泄露」。
   它们放在同目录的 sync-repo.local.json（已 gitignore）。
*/
const fs = require('fs'), path = require('path');

/* 路径与个人化规则都放在同目录的 sync-repo.local.json（已 gitignore）。
   本文件会公开发布，因此**不写任何本机路径、项目 ref、姓名**。
   也可用环境变量覆盖：MUAN_SRC / MUAN_REPO。 */
const CFGFILE = path.join(__dirname, 'sync-repo.local.json');
let CFG = { src: '', repo: '', rules: [] };
if (fs.existsSync(CFGFILE)) {
  try { CFG = Object.assign(CFG, JSON.parse(fs.readFileSync(CFGFILE, 'utf8'))); }
  catch (e) { console.log('!! sync-repo.local.json 解析失败：' + e.message); process.exit(2); }
}
const SRC = process.env.MUAN_SRC || CFG.src;
const REPO = process.env.MUAN_REPO || CFG.repo;
if (!SRC || !REPO) {
  console.log('缺少路径配置：请创建 sync-repo.local.json（{"src":"…","repo":"…"}）或用 MUAN_SRC / MUAN_REPO 环境变量指定');
  process.exit(2);
}

/* ---------- 1. app/index.html：脱敏 ---------- */
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const before = (html.match(/const DEFAULT_CLOUD=\{[^}]*\}/) || ['(未找到)'])[0];
if (before.indexOf("url:''") >= 0) console.log('app/index.html 的 DEFAULT_CLOUD 已是空值');
html = html.replace(/const DEFAULT_CLOUD=\{[^}]*\};/, "const DEFAULT_CLOUD={url:'',key:''};");
fs.mkdirSync(path.join(REPO, 'app'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'app', 'index.html'), html, 'utf8');
console.log('app/index.html 已同步');
if (before.indexOf('http') >= 0) console.log('  已脱敏 → ' + "{url:'',key:''}");

/* ---------- 2. server.js / sw.js / manifest / vendor ---------- */
['server.js', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  try {
    fs.copyFileSync(path.join(SRC, f), path.join(REPO, 'app', f));
    console.log('app/' + f + ' 已同步');
  } catch (e) { console.log('跳过 app/' + f + '（源不存在）'); }
});
fs.mkdirSync(path.join(REPO, 'app', 'vendor', 'pdfjs'), { recursive: true });
['pdf.min.mjs', 'pdf.worker.min.mjs'].forEach(function (f) {
  fs.copyFileSync(path.join(SRC, 'vendor', 'pdfjs', f), path.join(REPO, 'app', 'vendor', 'pdfjs', f));
});
console.log('app/vendor/pdfjs 已同步');

/* ---------- 3. 泄露扫描 ---------- */
/* 通用规则：不依赖任何个人标识，放之四海皆准 */
const GENERIC = [
  ['Supabase 公钥', /sb_publishable_[A-Za-z0-9]{10,}/],
  ['Supabase 服务密钥', /sb_secret_[A-Za-z0-9]{10,}/],
  ['真实 JWT（三段式）', /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  /* service_role 单独出现是警示文案（误报）；真正的风险是名字旁边跟着长凭据 */
  ['service_role 密钥', /(?:service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{10,}|service_role[^\n]{0,40}[A-Za-z0-9_-]{32,})/i],
  /* 邮箱：末段必须是字母顶级域（否则 xlsx@0.18.5 会误报），并排除 example.com 等占位 */
  ['真实邮箱', /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,24}\b/, /example\.|\.test\b|\.invalid\b|yourdomain|you@|test@/],
  ['疑似私钥/长令牌赋值', /(?:api[_-]?key|secret|token|passwd|password)['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{32,}['"]/i]
];
/* 个人化规则从同一份本地配置读（不进仓库，避免扫描器自己泄露） */
const LOCAL = (CFG.rules || []).map(function (x) {
  return [x.name, new RegExp(x.pattern, x.flags || ''), x.allow ? new RegExp(x.allow) : null];
});
console.log(LOCAL.length
  ? ('已载入本机专属规则 ' + LOCAL.length + ' 条')
  : '提示：本地配置里没有个人化规则，跳过本机专属检查（项目 ref / 姓名 / 本机路径）');
const PATS = GENERIC.concat(LOCAL);

/* 扫描器自身不参与扫描（它按定义包含所有这些模式） */
const SELF = path.resolve(__filename);
const hits = [];
let scanned = 0;
function scanText(txt, label) {
  PATS.forEach(function (x) {
    /* 保留原正则的 flags（如 i），只补 g */
    const re = new RegExp(x[1].source, (x[1].flags || '').replace('g', '') + 'g');
    let m, bad = false;
    while ((m = re.exec(txt))) {
      if (x[2] && x[2].test(m[0])) continue;   /* 占位符，跳过 */
      bad = true;
    }
    if (bad) hits.push(x[0] + '  →  ' + label);
  });
}
function walk(d) {
  fs.readdirSync(d).forEach(function (f) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== '.git' && f !== 'node_modules') walk(p); return; }
    /* 跳过扫描器自身与它的规则文件：它们按定义包含所有这些模式，不是泄露 */
    if (path.resolve(p) === SELF || /^(sync-repo.js|leak-patterns.local.json)$/.test(f)) return;
    if (!/\.(html|js|json|md|txt|sh|bat|mjs|css)$/.test(f)) return;
    scanned++;
    scanText(fs.readFileSync(p, 'utf8'), path.relative(REPO, p));
  });
}
walk(path.join(REPO, 'app'));
walk(path.join(REPO, 'skills'));
['README.md', 'LICENSE', '.gitignore'].forEach(function (f) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) return;
  scanned++;
  scanText(fs.readFileSync(p, 'utf8'), f);
});
console.log('\n扫描文件 ' + scanned + ' 个');
if (hits.length) { console.log('!! 疑似泄露 ' + hits.length + ' 处：'); hits.forEach(function (h) { console.log('   ' + h); }); }
else console.log('敏感命中 0 处 ✓');

/* ---------- 4. 预置资源自检 ---------- */
const dataDir = path.join(REPO, 'app', 'data');
if (fs.existsSync(dataDir)) console.log('app/data 预置图: ' + fs.readdirSync(dataDir).join(', '));
else console.log('!! app/data 不存在（预置背景图会缺失）');

process.exit(hits.length ? 1 : 0);
