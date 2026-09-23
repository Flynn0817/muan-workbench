#!/usr/bin/env node
/* 把工作区源码同步进开源仓库 C:\Users\25081\.workbuddy\muan-workbench\
   用法：node sync-repo.js
   做四件事：① 拷 app/index.html 并脱敏 DEFAULT_CLOUD ② 拷 server.js / sw.js / vendor
             ③ 拷 site/ 到仓库（若存在） ④ 泄露扫描（只报真实敏感值，不误判文档里的警示语）
   退出码非 0 表示扫描到疑似泄露，此时**不要** git commit。 */
const fs = require('fs'), path = require('path');
const SRC = 'C:/Users/25081/WorkBuddy/2026-08-01-22-38-19';
const REPO = 'C:/Users/25081/.workbuddy/muan-workbench';

/* ---------- 1. app/index.html：脱敏 ---------- */
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const before = (html.match(/const DEFAULT_CLOUD=\{[^}]*\}/) || ['(未找到)'])[0];
if (before.indexOf("url:''") >= 0) console.log('app/index.html 的 DEFAULT_CLOUD 已是空值');
html = html.replace(/const DEFAULT_CLOUD=\{[^}]*\};/, "const DEFAULT_CLOUD={url:'',key:''};");
fs.mkdirSync(path.join(REPO, 'app'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'app', 'index.html'), html, 'utf8');
console.log('app/index.html 已同步');
if (before.indexOf('http') >= 0) console.log('  已脱敏: ' + before.slice(0, 70) + "  →  {url:'',key:''}");

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
const PATS = [
  ['真实 Supabase URL', /qqfoenivdbkynqmhwrvc/],
  ['真实 Supabase Key', /sb_publishable_[A-Za-z0-9]{10,}/],
  ['真实 JWT（三段式）', /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  /* 单独的 service_role 是警示文案，属误报；真正的风险是「名字旁边跟着长凭据」，
     所以要么是 `service_role: "xxx"` 配置写法，要么是同行的 32 位以上令牌。
     大小写不敏感——环境变量常写成 SERVICE_ROLE。 */
  ['service_role 密钥', /(?:service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{10,}|service_role[^\n]{0,40}[A-Za-z0-9_-]{32,})/i],
  ['用户名 向富林', /向富林/],
  ['昵称 河粉', /河粉/],
  ['本机绝对路径', /C:\\+Users\\+25081/],
  /* 邮箱：末段必须是 2 位以上字母的顶级域（否则 xlsx@0.18.5 这类 CDN 版本号会误报），
     并排除 example.com / yourdomain 这类占位（第三个元素是「允许的例外」） */
  ['真实邮箱', /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,24}\b/, /example\.|\.test\b|\.invalid\b|yourdomain|you@|test@/]
];
const hits = [];
let scanned = 0;
function scanText(txt, label) {
  PATS.forEach(function (x) {
    /* 保留原正则的 flags（如 i），只补 g——否则大小写不敏感的规则会失效 */
    const re = new RegExp(x[1].source, x[1].flags.replace('g', '') + 'g');
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
