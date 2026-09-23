/*
 * 木案工作台 · 本地数据服务
 * --------------------------------------------------------------
 * 作用：把工作台的数据从「浏览器 localStorage」迁移到「本机磁盘上的真实数据库文件」，
 *       这样即使清掉浏览器缓存、换浏览器、重装浏览器，数据也不会丢。
 *  - 数据文件：data/muan.db.json（每次保存原子写入，并自动轮转备份到 data/backups/）
 *  - 访问地址：http://localhost:<端口>/  （默认 8765，被占用会自动顺延）
 *  - 仅用 Node 内置模块，无需联网、无需安装任何依赖。
 *
 * 启动：node server.js   （桌面快捷方式「木案」会自动启动并打开浏览器）
 * 关闭：直接关掉启动它的那个黑色窗口即可；数据已落盘，绝对安全。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'muan.db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const BACKUP_KEEP = 30;            // 最多保留的备份份数
const DEFAULT_PORT = 8765;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function rotateBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, 'muan-' + ts + '.json');
    fs.copyFileSync(DB_FILE, dest);
    // 只保留最近 BACKUP_KEEP 份
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('muan-') && f.endsWith('.json'))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(BACKUP_KEEP).forEach(x => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)); } catch (e) {}
    });
  } catch (e) {}
}

/* ============ 存储统计与安全清理（设置 → 存储与清理） ============
 * 设计原则：只清「可再生 / 冗余 / 无引用」三类，绝不碰主数据 muan.db.json：
 *   ① cache：期刊抓取缓存 journals.cache.json（删后自动重建）
 *   ② logs：muan.log / server.log（运行日志，自动重建）
 *   ③ backups：data/backups 自动备份（保留最近 N 份，默认 3，防误删到无法回退）
 *   ④ orphan：data/media 中未被任何记录引用的附件（依据 muan.db.json 全文匹配文件名，
 *      保守判定——只要在存档里出现过就保留）
 */
function fileSize(p) { try { return fs.statSync(p).size; } catch (e) { return 0; } }
function storeStats() {
  let bkFiles = [];
  try {
    bkFiles = fs.readdirSync(BACKUP_DIR)
      .filter(f => /\.json$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch (e) {}
  const bkBytes = bkFiles.reduce((a, x) => a + fileSize(path.join(BACKUP_DIR, x.f)), 0);
  let dbText = ''; try { dbText = fs.readFileSync(DB_FILE, 'utf8'); } catch (e) {}
  let mediaAll = []; try { mediaAll = fs.readdirSync(MEDIA_DIR); } catch (e) {}
  const orphan = mediaAll.filter(f => dbText.indexOf(f) < 0);
  const orphanBytes = orphan.reduce((a, f) => a + fileSize(path.join(MEDIA_DIR, f)), 0);
  return {
    backups: { count: bkFiles.length, bytes: bkBytes },
    orphanMedia: { count: orphan.length, bytes: orphanBytes, total: mediaAll.length },
    cacheBytes: fileSize(JOURNAL_CACHE),
    logBytes: fileSize(path.join(ROOT, 'muan.log')) + fileSize(path.join(ROOT, 'server.log'))
  };
}
function storeClean(targets, keep) {
  const freed = { bytes: 0, cache: 0, logs: 0, backups: 0, orphan: 0 };
  const un = (p) => { try { const sz = fileSize(p); if (sz > 0) { fs.unlinkSync(p); freed.bytes += sz; return 1; } } catch (e) {} return 0; };
  if (targets.indexOf('cache') >= 0 && fs.existsSync(JOURNAL_CACHE)) freed.cache += un(JOURNAL_CACHE);
  if (targets.indexOf('logs') >= 0) { freed.logs += un(path.join(ROOT, 'muan.log')); freed.logs += un(path.join(ROOT, 'server.log')); }
  if (targets.indexOf('backups') >= 0) {
    const k = Math.max(1, Math.min(10, keep || 3));
    let arr = [];
    try {
      arr = fs.readdirSync(BACKUP_DIR)
        .filter(f => /\.json$/.test(f))
        .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    } catch (e) {}
    arr.slice(k).forEach(x => { freed.backups += un(path.join(BACKUP_DIR, x.f)); });
  }
  if (targets.indexOf('orphan') >= 0) {
    let dbText = ''; try { dbText = fs.readFileSync(DB_FILE, 'utf8'); } catch (e) {}
    let mf = []; try { mf = fs.readdirSync(MEDIA_DIR); } catch (e) {}
    mf.forEach(f => { if (dbText.indexOf(f) < 0) { freed.orphan += un(path.join(MEDIA_DIR, f)); } });
  }
  return freed;
}

function writeDB(obj) {
  rotateBackup();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, DB_FILE); // 原子替换，避免写到一半损坏
}

function sendJSON(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  }, extraHeaders || {}));
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // 防目录穿越
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底：未知路径回退到首页
      fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Cache-Control'] = 'no-store'; // 升级后刷新即生效
    else headers['Cache-Control'] = 'public, max-age=3600';
    res.writeHead(200, headers);
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 60 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      buf += c;
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

/* ============ 时事热点实时聚合（学术前沿 + 公开热榜 + 自定义源） ============
 * 由本机服务代理抓取，规避浏览器 CORS 限制：
 *  - 学术前沿：arXiv 官方 API（稳定、无需鉴权，带镜像备用）
 *  - 微博/抖音/知乎/小红书：每个平台配多个公开聚合源（vvhan / 今日热榜镜像 api-hot.imsyy.top /
 *    tenapi / oioweb / xxapi）依次尝试、失败自动切换，尽力确保能抓到（受平台限制可能波动）
 *  - 自定义源：用户在工作台里自己填的 JSON / RSS 地址，POST 给本服务代理抓取
 * 本模块只抓热榜的「标题 / 热度 / 原文链接」用于陈列展示，不抓取正文、不落库正文。
 * 结果缓存 5 分钟，避免频繁请求；GET /api/hot?refresh=1 可强制绕过缓存。
 */
const HOT_TTL = 5 * 60 * 1000;
let hotCache = null, hotCacheAt = 0;
function httpsGet(url, timeoutMs) {
  return new Promise((resolve) => {
    let done = false; let errMsg = '';
    const finish = (ok, body, ct) => { if (!done) { done = true; resolve({ ok, body: body || '', ct: ct || '', error: errMsg || (ok ? '' : '无响应') }); } };
    let req;
    try {
      req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MuanWorkbench)', 'Accept': 'application/json, application/atom+xml, application/rss+xml, */*' } }, res2 => {
        let buf = '';
        res2.on('data', c => { buf += c; });
        res2.on('end', () => finish(res2.statusCode >= 200 && res2.statusCode < 300, buf, res2.headers['content-type'] || ''));
      });
    } catch (e) { errMsg = '请求异常: ' + e.message; return finish(false, ''); }
    req.on('error', e => { errMsg = '网络错误: ' + (e && e.message || e.code || e); finish(false, ''); });
    req.setTimeout(timeoutMs || 6000, () => { try { req.destroy(); } catch (e) {} errMsg = '超时(' + (timeoutMs || 6000) + 'ms)'; finish(false, ''); });
  });
}
// arXiv：主站 + 国内镜像，任一可用即可
async function fetchArxiv() {
  const q = '(cat:cs.AI OR cat:cs.LG OR cat:cs.CL OR cat:cs.CV OR cat:cs.NE)';
  const base = '?search_query=' + encodeURIComponent(q) + '&sortBy=submittedDate&sortOrder=descending&max_results=12';
  const urls = ['https://export.arxiv.org/api/query' + base, 'https://cn.arxiv.org/api/query' + base];
  for (const url of urls) {
    const r = await httpsGet(url, 8000);
    if (!r.ok) continue;
    const entries = r.body.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const list = entries.slice(0, 12).map(e => {
      const g = (tag) => { const m = e.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
      return { title: g('title'), url: g('id'), meta: g('published').slice(0, 10) };
    }).filter(x => x.title);
    if (list.length) return list;
  }
  return [];
}
// 通用：从多个候选地址依次尝试，兼容不同聚合源返回结构，取第一个可用的列表
function extractArr(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.data)) return j.data;
  if (j && j.data && Array.isArray(j.data.realtime)) return j.data.realtime; // 微博官方接口
  if (j && Array.isArray(j.result)) return j.result;
  if (j && Array.isArray(j.list)) return j.list;
  if (j && j.data && Array.isArray(j.data.list)) return j.data.list;
  return null;
}
const mapHot = it => {
  // 兼容各聚合源的字段差异：直出字段 / 嵌套在 target 里的知乎式结构 / 中文键
  const n = it.target || {};
  const title = it.title || it.word || it.name || it.titleShow || n.title || it.raw_title || it.note_title || '';
  const hot = it.hot != null ? it.hot : (it.num != null ? it.num : (it.hot_value != null ? it.hot_value : (n.excerpt || it.desc || '')));
  const hotStr = hot != null && hot !== '' ? (typeof hot === 'number' && hot >= 10000 ? (hot / 10000).toFixed(1) + '万' : ('' + hot)) : '';
  return { title, url: it.url || it.link || it.mobileUrl || it.mobile_url || n.url || n.url_mobile || '', meta: hotStr ? ('🔥 ' + hotStr) : '' };
};
async function fetchJsonList(urls, timeoutMs) {
  for (const url of urls) {
    const r = await httpsGet(url, timeoutMs || 7000);
    if (!r.ok) continue;
    let j; try { j = JSON.parse(r.body); } catch (e) { continue; }
    const arr = extractArr(j);
    if (arr && arr.length) {
      const mapped = arr.slice(0, 15).map(mapHot).filter(x => x && x.title);
      // 关键：候选源返回的数组必须真能解析出条目才算成功；
      // 若字段对不上/内容为空则继续试下一个源，避免「第一个源格式变了」导致整链永久为空
      if (mapped.length) return mapped;
    }
  }
  return [];
}
// 简易 RSS / Atom 解析（兼容 <item>/<entry>）
function feedPick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
function parseFeed(xml) {
  if (!xml) return [];
  const items = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return items.slice(0, 15).map(it => {
    const title = feedPick(it, 'title');
    let url = feedPick(it, 'link');
    if (!url) { const m = it.match(/<link[^>]*href="([^"]+)"/i); url = m ? m[1] : ''; }
    const date = feedPick(it, 'pubDate') || feedPick(it, 'updated') || feedPick(it, 'published') || '';
    return { title, url, meta: date ? date.slice(0, 10) : '' };
  }).filter(x => x.title);
}
// 自定义源：JSON 或 RSS
async function fetchCustomSource(src) {
  const r = await httpsGet(src.url, 9000);
  if (!r.ok) return [];
  if (src.type === 'rss') return parseFeed(r.body);
  let j; try { j = JSON.parse(r.body); } catch (e) { return []; }
  const arr = extractArr(j);
  return arr ? arr.slice(0, 15).map(mapHot).filter(x => x && x.title) : [];
}
async function fetchHot() {
  // 每个平台配置多个候选聚合源，依次尝试、失败自动切换，取第一个可用的；
  // 覆盖 学术前沿 + 微博/抖音/知乎/小红书 五个固定平台（用户侧保持精简）
  const tasks = [
    ['学术前沿', fetchArxiv()],
    ['微博热搜', fetchJsonList([
      'https://api.vvhan.com/api/hotlist/wbHot',
      'https://api-hot.imsyy.top/weibo/',
      'https://60s.viki.moe/v2/weibo',
      'https://weibo.com/ajax/side/hotSearch',
      'https://tenapi.cn/v2/weibohot',
      'https://api.oioweb.cn/api/common/HotList?type=weibo',
      'https://v2.xxapi.cn/api/weibohot'
    ])],
    ['抖音热点', fetchJsonList([
      'https://api.vvhan.com/api/hotlist/douyinHot',
      'https://api-hot.imsyy.top/douyin/',
      'https://60s.viki.moe/v2/douyin',
      'https://tenapi.cn/v2/douyinhot',
      'https://api.oioweb.cn/api/common/HotList?type=douyin',
      'https://v2.xxapi.cn/api/douyinhot'
    ])],
    ['知乎热榜', fetchJsonList([
      'https://api-hot.imsyy.top/zhihu/',
      'https://60s.viki.moe/v2/zhihu',
      'https://tenapi.cn/v2/zhihuhot',
      'https://api.vvhan.com/api/hotlist/zhihuHot',
      'https://papi.v-box.cn/api/app/open-api/zhi-hu-hot',
      'https://api.freejk.com/shuju/hotlist/zhihu',
      'https://api.oioweb.cn/api/common/HotList?type=zhihu',
      'https://v2.xxapi.cn/api/zhihuhot'
    ])],
    ['小红书', fetchJsonList([
      'https://60s.viki.moe/v2/rednote',
      'https://api-hot.imsyy.top/xiaohongshu/',
      'https://api.vvhan.com/api/hotlist/xhsHot',
      'https://tenapi.cn/v2/xiaohongshu',
      'https://api.oioweb.cn/api/common/HotList?type=xiaohongshu',
      'https://v2.xxapi.cn/api/xiaohongshu'
    ])]
  ];
  const res = await Promise.allSettled(tasks.map(t => t[1]));
  const categories = {};
  tasks.forEach((t, i) => { categories[t[0]] = res[i].status === 'fulfilled' ? res[i].value : []; });
  return { updated: Date.now(), categories };
}
async function serveHot(res, force) {
  if (!force && hotCache && Date.now() - hotCacheAt < HOT_TTL) { sendJSON(res, 200, hotCache); return; }
  try {
    const data = await fetchHot();
    hotCache = data; hotCacheAt = Date.now();
    sendJSON(res, 200, data);
  } catch (e) {
    sendJSON(res, 200, { updated: Date.now(), categories: {}, error: String(e && e.message || e) });
  }
}
// 自定义源抓取：浏览器把用户配置的 sources POST 过来，本服务代理抓取并合并
async function serveCustomHot(res, sources) {
  const cats = {};
  const list = (sources && Array.isArray(sources)) ? sources : [];
  await Promise.all(list.map(async s => {
    const name = s.cat || s.name || '自定义';
    try { cats[name] = await fetchCustomSource(s); }
    catch (e) { cats[name] = []; }
  }));
  sendJSON(res, 200, { updated: Date.now(), categories: cats });
}

/* ===== 期刊雷达：多数据源解析（OpenAlex 主 + Crossref 备，均免费无密钥） ===== */
const JOURNAL_CACHE = path.join(DATA_DIR, 'journals.cache.json');
function readJournalCache() {
  try { const j = JSON.parse(fs.readFileSync(JOURNAL_CACHE, 'utf8')); return { articles: j.articles || [], updated: j.updated || 0 }; }
  catch (e) { return { articles: [], updated: 0 }; }
}
function writeJournalCache(articles) {
  try { fs.writeFileSync(JOURNAL_CACHE, JSON.stringify({ articles, updated: Date.now() })); } catch (e) {}
}
function mapOpenAlex(a) {
  let abstract = '';
  if (a.abstract_inverted_index) {
    const pairs = Object.entries(a.abstract_inverted_index).map(([k, v]) => [+k, v]).sort((x, y) => x[0] - y[0]);
    abstract = pairs.map(p => p[1]).join(' ').slice(0, 400);
  }
  const loc = a.primary_location && a.primary_location.source;
  // 开放获取全文链接：优先 best_oa_location 的 PDF / 落地页，其次 open_access.oa_url
  const oaLoc = a.best_oa_location || {};
  const oaUrl = oaLoc.pdf_url || oaLoc.landing_page_url || (a.open_access && a.open_access.oa_url) || '';
  const oaStatus = (a.open_access && a.open_access.oa_status) || (oaUrl ? 'green' : 'closed');
  return {
    id: a.id,
    title: a.title,
    authors: (a.authorships || []).map(x => x.author && x.author.display_name).filter(Boolean).join(', '),
    journal: (loc && loc.display_name) || '',
    issn: (loc && (loc.issn || (Array.isArray(loc.issn) ? loc.issn[0] : ''))) || '',
    year: a.publication_year,
    abstract: abstract,
    url: a.doi ? ('https://doi.org/' + a.doi) : '',
    oaUrl: oaUrl,
    oaStatus: oaStatus,
    via: 'openalex'
  };
}
function mapCrossref(item) {
  const title = Array.isArray(item.title) ? item.title[0] : (item.title || '');
  const authors = (item.author || []).map(x => ((x.given || '') + ' ' + (x.family || '')).trim() || (x.name || '')).filter(Boolean).join(', ');
  const container = (item['container-title'] && item['container-title'][0]) || '';
  const dp = (item['published-print'] || item['published-online'] || item.created || {});
  const parts = (dp && dp['date-parts'] && dp['date-parts'][0]) || null;
  const year = parts ? parts[0] : null;
  const abstract = (item.abstract || '').replace(/<[^>]+>/g, ' ');
  const url = item.URL || (item.DOI ? ('https://doi.org/' + item.DOI) : '');
  return {
    id: item.DOI ? ('https://doi.org/' + item.DOI) : (item.URL || ''),
    title: title,
    authors: authors,
    journal: container,
    issn: '',
    year: year,
    abstract: abstract.slice(0, 400),
    url: url,
    via: 'crossref'
  };
}
function oaFromDateSuffix(years){ if(!years||years<=0) return ''; const y=new Date().getFullYear()-Math.floor(years); return ',from_publication_date:'+y+'-01-01'; }
async function openAlexByIssn(issn, years) {
  try {
    const f = 'primary_location.source.issn:' + encodeURIComponent(issn) + oaFromDateSuffix(years);
    const url = 'https://api.openalex.org/works?filter=' + f + '&sort=publication_date:desc&per_page=5';
    const r = await httpsGet(url, 10000);
    if (!r.ok) return { articles: [], error: 'OpenAlex ' + (r.error || 'fail') };
    const j = JSON.parse(r.body);
    const arts = (j.results || []).map(mapOpenAlex);
    return { articles: arts, error: arts.length ? '' : 'OpenAlex 无结果' };
  } catch (e) { return { articles: [], error: 'OpenAlex ' + e.message }; }
}
async function openAlexByName(name, years) {
  try {
    const s = await httpsGet('https://api.openalex.org/sources?search=' + encodeURIComponent(name) + '&per_page=1', 10000);
    if (!s.ok) return { articles: [], error: 'OpenAlex ' + (s.error || 'fail') };
    const sj = JSON.parse(s.body);
    const src = (sj.results || [])[0];
    if (!src || !src.id) return { articles: [], error: 'OpenAlex 未找到该刊' };
    const f = 'primary_location.source.id:' + encodeURIComponent(src.id) + oaFromDateSuffix(years);
    const url = 'https://api.openalex.org/works?filter=' + f + '&sort=publication_date:desc&per_page=5';
    const r = await httpsGet(url, 10000);
    if (!r.ok) return { articles: [], error: 'OpenAlex ' + (r.error || 'fail') };
    const j = JSON.parse(r.body);
    const arts = (j.results || []).map(mapOpenAlex);
    return { articles: arts, error: arts.length ? '' : 'OpenAlex 无结果' };
  } catch (e) { return { articles: [], error: 'OpenAlex ' + e.message }; }
}
async function crossrefByIssn(issn) {
  try {
    const url = 'https://api.crossref.org/journals/' + encodeURIComponent(issn) + '/works?sort=published&order=desc&rows=5';
    const r = await httpsGet(url, 9000);
    if (!r.ok) return { articles: [], error: 'Crossref ' + (r.error || 'fail') };
    const j = JSON.parse(r.body);
    const items = (j.message && j.message.items) || [];
    const arts = items.map(mapCrossref);
    return { articles: arts, error: arts.length ? '' : 'Crossref 无结果' };
  } catch (e) { return { articles: [], error: 'Crossref ' + e.message }; }
}
// 解析顺序：OpenAlex(ISSN) → OpenAlex(刊名，覆盖中文刊) → Crossref(ISSN 备用)
async function resolveJournal(issn, name, years) {
  const errors = [];
  if (issn) {
    const oa = await openAlexByIssn(issn, years);
    if (oa.articles.length) return { articles: oa.articles, via: 'openalex', error: '' };
    if (oa.error) errors.push('OpenAlex(ISSN) ' + oa.error);
  }
  if (name) {
    const oa2 = await openAlexByName(name, years);
    if (oa2.articles.length) return { articles: oa2.articles, via: 'openalex', error: '' };
    if (oa2.error) errors.push('OpenAlex(刊名) ' + oa2.error);
  }
  if (issn) {
    const cr = await crossrefByIssn(issn);
    if (cr.articles.length) return { articles: cr.articles, via: 'crossref', error: '' };
    if (cr.error) errors.push('Crossref ' + cr.error);
  }
  return { articles: [], via: '', error: errors.join(' / ') };
}

/* ===== AI 对话代理（用户自备 OpenAI 兼容 Key，仅存本机，不进前端） ===== */
const AI_CFG = path.join(DATA_DIR, 'ai-config.json');
function readAICfg() { try { return JSON.parse(fs.readFileSync(AI_CFG, 'utf8')); } catch (e) { return null; } }
function writeAICfg(o) { try { fs.writeFileSync(AI_CFG, JSON.stringify(o, null, 2)); return true; } catch (e) { return false; } }
/* 规范化 API Base URL：补协议、去尾斜杠、剥离误粘的完整接口路径、拒绝网页控制台地址 */
function normBaseURL(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/i, '');
  if (/\/(api_keys|keys|account|overview|playground|console|usage|billing)(\/|$)/i.test(u)) return '';
  try { const p = new URL(u); if (!p.hostname) return ''; } catch (e) { return ''; }
  return u;
}
async function aiChatProxy(req, res) {
  const cfg = readAICfg();
  if (!cfg || !cfg.apiKey || !cfg.baseURL) {
    sendJSON(res, 400, { ok: false, error: '未配置模型：请在工作台「对话」页点右上角「模型」，填入 API Key 与接口地址（示例：https://api.deepseek.com）' });
    return;
  }
  if (normBaseURL(cfg.baseURL) === '') {
    sendJSON(res, 400, { ok: false, error: '接口地址填错了：当前存的是网页控制台地址（platform.deepseek.com/api_keys），不是 API 地址。请点「模型」把接口地址改成 https://api.deepseek.com（其它服务商填其 Base URL，如 https://api.xxx.com/v1）后重试' });
    return;
  }
  let body; try { body = JSON.parse(await readBody(req)); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
  const messages = body.messages; const tools = body.tools;
  if (!Array.isArray(messages)) { sendJSON(res, 400, { ok: false, error: 'messages required' }); return; }
  const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const payload = { model: cfg.model || 'deepseek-chat', messages: messages, stream: false };
  if (Array.isArray(tools) && tools.length) payload.tools = tools;
  if (body.temperature != null) payload.temperature = body.temperature;
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 120000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    clearTimeout(timer);
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (e) { sendJSON(res, 502, { ok: false, error: '模型返回非 JSON：' + txt.slice(0, 300) }); return; }
    if (!r.ok) { sendJSON(res, r.status, { ok: false, error: ((j && j.error && (j.error.message || JSON.stringify(j.error))) || ('HTTP ' + r.status)) }); return; }
    sendJSON(res, 200, j);
  } catch (e) { clearTimeout(timer); sendJSON(res, 502, { ok: false, error: '调用模型失败：' + (e && e.message || e) }); }
}

async function handleRequest(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/api/state' && req.method === 'GET') {
      const db = readDB();
      sendJSON(res, 200, db || {});
      return;
    }
    if (p === '/api/state' && req.method === 'POST') {
      const raw = await readBody(req);
      let obj;
      try { obj = JSON.parse(raw); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      if (!obj || typeof obj !== 'object') { sendJSON(res, 400, { ok: false, error: 'invalid' }); return; }
      writeDB(obj);
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (p === '/api/health') { sendJSON(res, 200, { ok: true }); return; }
    if (p === '/api/store' && req.method === 'GET') { sendJSON(res, 200, { ok: true, ...storeStats(), paths: { root: ROOT, data: DATA_DIR, db: DB_FILE, backups: BACKUP_DIR, media: MEDIA_DIR, cache: JOURNAL_CACHE, log: path.join(ROOT, 'muan.log') } }); return; }
    if (p === '/api/store' && req.method === 'POST') {
      let obj; try { obj = JSON.parse(await readBody(req)); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      const t = Array.isArray(obj && obj.targets) ? obj.targets : [];
      const allowed = ['cache', 'logs', 'backups', 'orphan'];
      if (!t.length || t.some(x => allowed.indexOf(x) < 0)) { sendJSON(res, 400, { ok: false, error: 'targets 需为 cache/logs/backups/orphan 的非空子集' }); return; }
      sendJSON(res, 200, { ok: true, ...storeClean(t, obj.keep) });
      return;
    }
    if (p === '/api/hot' && req.method === 'POST') {
      const raw = await readBody(req);
      let obj; try { obj = JSON.parse(raw); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      await serveCustomHot(res, obj && obj.sources);
      return;
    }
    if (p === '/api/hot' && req.method === 'GET') { await serveHot(res, u.searchParams.get('refresh') === '1'); return; }
    /* 期刊雷达：代理 OpenAlex（免费无密钥，无需 API Key） */
    if (p === '/api/journals') {
      const u2 = new URL(req.url, 'http://localhost');
      const action = u2.searchParams.get('action') || 'latest';
      try {
        if (action === 'latest') {
          // items 格式： issn~~刊名 | issn~~刊名 …（同时传 issn 与刊名，做两级解析）
          const items = (u2.searchParams.get('items') || '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 12);
          if (!items.length) { sendJSON(res, 200, { articles: [] }); return; }
          const years = parseInt(u2.searchParams.get('years') || '0', 10) || 0;
          const all = [];
          const errors = [];
          for (const it of items) {
            const parts = it.split('~~');
            const issn = (parts[0] || '').trim();
            const name = (parts[1] || '').trim();
            if (!issn && !name) continue;
            const r = await resolveJournal(issn, name, years);
            if (!r.articles.length && r.error) errors.push((name || issn) + '：' + r.error);
            r.articles.forEach(a => {
              all.push({
                id: a.id, title: a.title, authors: a.authors, journal: a.journal,
                issn: issn || a.issn, year: a.year, abstract: a.abstract, url: a.url,
                oaUrl: a.oaUrl || '', oaStatus: a.oaStatus || 'closed',
                via: a.via, fetchedAt: new Date().toISOString()
              });
            });
          }
          // 成功则写磁盘缓存；若本次全部失败则回退到上次缓存，保证雷达不整页空（网络临时抽风也不影响查看）
          let cached = false;
          if (all.length) {
            writeJournalCache(all);
          } else if (errors.length) {
            const c = readJournalCache();
            if (c.articles.length) { all.push(...c.articles); cached = true; console.log('[期刊雷达] 实时抓取失败，回退到缓存 ' + c.articles.length + ' 篇'); }
          }
          const errSummary = errors.length ? ('部分期刊未能抓取：' + errors.slice(0, 8).join('； ')) : '';
          if (errSummary) console.error('[期刊雷达] ' + errSummary);
          else console.log('[期刊雷达] 本次更新 ' + all.length + ' 篇（来源 OpenAlex/Crossref）');
          sendJSON(res, 200, { articles: all.slice(0, 120), updated: Date.now(), error: errSummary, cached: cached });
          return;
        }
        if (action === 'search') {
          const q = (u2.searchParams.get('q') || '').trim();
          if (!q) { sendJSON(res, 200, { results: [] }); return; }
          let results = [];
          const oaUrl = 'https://api.openalex.org/works?search=' + encodeURIComponent(q) + '&sort=citation_count:desc&per_page=15';
          const oa = await httpsGet(oaUrl, 10000);
          if (oa.ok) {
            try {
              const j = JSON.parse(oa.body);
              results = (j.results || []).map(a => ({
                id: a.id,
                title: a.title,
                authors: (a.authorships || []).map(x => x.author && x.author.display_name).filter(Boolean).join(', '),
                journal: (a.primary_location && a.primary_location.source && a.primary_location.source.display_name) || '',
                year: a.publication_year,
                cited: a.cited_by_count,
                url: a.doi ? ('https://doi.org/' + a.doi) : '',
                via: 'openalex'
              }));
            } catch (e) {}
          }
          if (!results.length) {
            const crUrl = 'https://api.crossref.org/works?query=' + encodeURIComponent(q) + '&sort=relevance&rows=15';
            const cr = await httpsGet(crUrl, 9000);
            if (cr.ok) {
              try {
                const j = JSON.parse(cr.body);
                const items = (j.message && j.message.items) || [];
                results = items.map(mapCrossref).map(a => ({
                  id: a.id, title: a.title, authors: a.authors, journal: a.journal,
                  year: a.year, cited: null, url: a.url, via: 'crossref'
                }));
              } catch (e) {}
            }
          }
          sendJSON(res, 200, { results });
          return;
        }
        sendJSON(res, 200, { error: 'unknown action' });
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: String(e && e.message || e) });
      }
      return;
    }
    /* 打开本机目录：只放行白名单内的目录，不接受任意路径 */
    if (p === '/api/open-folder' && req.method === 'POST') {
      let o; try { o = JSON.parse(await readBody(req)); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      const MAP = { media: MEDIA_DIR, data: DATA_DIR, backups: BACKUP_DIR };
      const dir = MAP[String((o && o.which) || 'media')];
      if (!dir) { sendJSON(res, 400, { ok: false, error: '只允许 media / data / backups' }); return; }
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      const plat = process.platform;
      const cmd = plat === 'win32' ? ('explorer "' + dir + '"')
        : plat === 'darwin' ? ('open "' + dir + '"')
        : ('xdg-open "' + dir + '"');
      try { exec(cmd); sendJSON(res, 200, { ok: true, path: dir }); }
      catch (e) { sendJSON(res, 500, { ok: false, error: String(e && e.message || e) }); }
      return;
    }
    if (p === '/api/media' && req.method === 'POST') {
      const raw = await readBody(req);
      let obj; try { obj = JSON.parse(raw); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      if (!obj || !obj.data) { sendJSON(res, 400, { ok: false, error: 'no data' }); return; }
      const ext = (obj.name && path.extname(obj.name)) || (obj.type && obj.type.split('/')[1] ? '.' + obj.type.split('/')[1] : '');
      const safeName = (obj.name || 'file').replace(/[^\w.\-]+/g, '_');
      const fname = Date.now().toString(36) + '_' + safeName;
      fs.writeFile(path.join(MEDIA_DIR, fname), Buffer.from(obj.data, 'base64'), err => {
        if (err) { sendJSON(res, 500, { ok: false, error: String(err) }); return; }
        sendJSON(res, 200, { ok: true, path: 'data/media/' + fname });
      });
      return;
    }
    /* ===== AI 对话代理：用户自备 OpenAI 兼容 Key，仅存本机，不进前端 ===== */
    if (p === '/api/ai/config' && req.method === 'POST') {
      let o; try { o = JSON.parse(await readBody(req)); } catch (e) { sendJSON(res, 400, { ok: false, error: 'bad json' }); return; }
      const baseURL = normBaseURL(o.baseURL);
      const apiKey = String(o.apiKey || '').trim();
      const model = String(o.model || '').trim() || 'deepseek-chat';
      if (!baseURL) {
        sendJSON(res, 400, { ok: false, error: '接口地址不对：请填 API 的 Base URL（如 https://api.deepseek.com，或中转服务如 https://api.xxx.com/v1），不要填网页控制台地址（如 …/api_keys）。若误填了完整接口可自动去掉多余部分后重试' });
        return;
      }
      if (!apiKey) { sendJSON(res, 400, { ok: false, error: 'API Key 不能为空' }); return; }
      if (!writeAICfg({ baseURL, apiKey, model })) { sendJSON(res, 500, { ok: false, error: '写入配置失败' }); return; }
      sendJSON(res, 200, { ok: true });
      return;
    }
    if (p === '/api/ai/status') {
      const c = readAICfg();
      sendJSON(res, 200, { configured: !!(c && c.apiKey && c.baseURL), model: (c && c.model) || '' });
      return;
    }
    if (p === '/api/ai/chat' && req.method === 'POST') { await aiChatProxy(req, res); return; }
    if (req.method === 'GET') { serveStatic(req, res, p); return; }
    res.writeHead(405); res.end('Method Not Allowed');
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: String(e && e.message || e) });
  }
}

function tryListen(port, tries) {
  const srv = http.createServer(handleRequest);
  srv.listen(port, () => {
    const url = 'http://localhost:' + port + '/';
    const ipUrl = 'http://127.0.0.1:' + port + '/';
    console.log('========================================');
    console.log('木案工作台已启动 → ' + url);
    console.log('（若 localhost 打不开，改用 ' + ipUrl + '）');
    console.log('MUAN_LISTENING=' + port);
    console.log('数据保存在：' + DB_FILE);
    console.log('========================================');
    // 把真实端口写到文件，便于排查（即使看不清控制台也能知道端口）
    try { fs.writeFileSync(path.join(DATA_DIR, 'server.port'), String(port)); } catch (e) {}
    // 自动打开浏览器（Electron 模式下由 MUAN_NO_OPEN 控制，避免重复开窗）
    if (!process.env.MUAN_NO_OPEN) {
      try { exec('cmd /c start "" "' + url + '"'); } catch (e) {}
    }
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) {
      console.log('端口 ' + port + ' 被占用，尝试 ' + (port + 1) + '…');
      try { srv.close(); } catch (x) {}
      tryListen(port + 1, tries - 1);
    } else {
      console.error('启动失败：', e.message);
      process.exit(1);
    }
  });
}

tryListen(DEFAULT_PORT, 20);
