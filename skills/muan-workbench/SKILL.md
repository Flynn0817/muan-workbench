---
name: muan-workbench
description: 木案·个人工作台（单文件 PWA，双端：电脑本地服务 + 手机云托管）的维护手册与验证流程。当用户要求修改/审查/部署「木案」「个人工作台」「muan」应用，或处理该项目的手机端/电脑端适配、AI 对话通道、Supabase 云同步、PWA 图标、底部导航、发布上线时使用。含双端架构地图、CRLF 安全编辑、data-action 白名单审计、手机/桌面视口回归与 CloudStudio 部署五步验证法，以及数据与隐私安全红线。
agent_created: true
---

# 木案 · 个人工作台维护手册（双端版）

## 0. 项目档案

- 仓库结构（本 skill 随仓库发布）：`app/` = 工作台本体源（index.html / server.js / sw.js / manifest.webmanifest / 图标），`skills/muan-workbench/` = 本 skill，`references` 在 skill 内。新用户 `git clone` 后，<repo>/app 即完整可运行本体。维护/开发的目标目录 = `<repo>/app`（日常会话中由调用方给出实际克隆位置，文档一律用 `<repo>` 占位，**发布到 GitHub 前不得写入个人真实路径**）。
- `index.html`：**单文件应用**（CSS+HTML+内联 JS，约 530KB），**CRLF 换行**。同一份代码同时服务电脑端与手机端，靠 `USE_API` 等运行期分支区分。
- `server.js`：**电脑端本地代理**（默认端口 8765）：静态页 + `/api/state` 读写本机磁盘库 `data/muan.db.json` + AI 代理（**AI Key 只在服务端**，前端永不接触）。CORS `*`，同一局域网手机可直连 `http://<局域网IP>:8765`。
- `app/` 同时充当**手机端发布目录**（manifest/sw/图标同目录）。改完源码需发布时，直接把 `app/` 推到静态托管即可（保持 index.html、sw.js、manifest.webmanifest、图标同层）。
- `sw.js`：PWA 离线壳。**每次改动本文件或 index.html 都必须把 `SW_VER`（形如 'muan-v14'）加 1**，否则手机缓存不更新。
- 图标：`icon-192/512/maskable-512.png` 真实 logo（米色底+墨绿木桌）为 PWA 桌面图标源；网页顶栏 logo 用 icon-light（米色底）data URI 内嵌，不依赖文件。
- 部署（手机端）：`app/` 已含全部静态资产（index/sw/manifest/icons），整目录即发布内容；CloudStudio 等静态托管发布 `directory=<repo>/app` → 得 `https://<id>.app.workbuddy.link`。发布管理：设置 - 数据管理 - 我发布的应用。

## 1. 双端拓扑与数据链路

```
电脑端：浏览器 → server.js(:8765) → 本机磁盘 data/muan.db.json
手机端：PWA(静态托管) → localStorage 或 Supabase(REST)
同步中枢：Supabase 数据库一行 muan_state —— 本机数据为主，云端只做端间搬运
```

- 启动时 `USE_API`（协议为 http/https 且走本机服务）→ 用 server.js；纯静态托管 → 手机端分支。
- 电脑端持久化：`save()` → `POST /api/state`（整体覆盖写）；加载 `GET /api/state` + `mergeDeep(DEFAULT_STATE(), remote)` 迁移。
- 手机端：`localStorage` 键 `muan.state`（或云 session 存在时以云为准）。
- **关键防坑**：服务端无数据时**绝不回退浏览器旧 localStorage 并写回**，否则旧缓存会把"清零"后的经验/木币/签到还原（代码内已显式处理，勿改回）。

## 2. Supabase 云同步机制（两端同步的实现）

- 表：`muan_state(id, data jsonb, rev bigint, updated_at, user_id, device)` —— **每个账号一行**（`user_id=eq.<uid>` 查询），RLS 保证只能读写自己那行。
- 鉴权：Supabase Auth（邮箱+密码 → session），纯前端 REST，`/auth/v1` 与 `/rest/v1` 请求 **Service Worker 一律直通不拦截**（见 sw.js fetch 规则）。
- 并发：**rev 乐观锁**。推送带 `rev=eq.<n>` 条件写，影响 0 行即冲突。**自动推送冲突不静默覆盖**：跳过并节流提示；只有手动「立即同步」才弹二选一（本机为准/云端为准）。
- 合并：`cloudMerge` 顶层模块 **last-write-wins**（同模块两端都改则取推送方/较新方），仍有冲突才走人工二选一。
- 关键本地存储键：`muan.cloudSession`（会话）、`muan.cloudRev`、`muan.deviceId`（设备名：'手机/电脑 '+随机串）、`muan.autoSync`。
- **手机端 AI 通道（v3）**：不走 Edge Function，用 **Supabase 数据库 RPC + pg_net**：`/rest/v1/rpc/muan_ai_ask`（payload）发起 → `muan_ai_poll`（rid）轮询结果。**LLM 密钥存数据库 Secret**，前端不填 Key。依赖 `supabase-setup-v3.sql`（建表 + RPC + 启用 pg_net）；报"未执行 v3 脚本"时提示用户到 Supabase SQL Editor 执行。
- 电脑端 AI：走本地 `server.js` 代理（Key 在服务端）。手机端在「对话」页不能也不应填 Key。

### 安全红线（本项目特殊要求）
- `index.html` 顶部 `DEFAULT_CLOUD` 里硬编码了**用户自己的 Supabase URL / publishable key**（anon 可公开但属用户环境）：skill/文档/对话里一律不写真实值；**若开源/分享，必须将两值清成 ''**（源码注释已标注"开源发布前必须清空"）。service_role/secret 任何情况下不外发。
- 用户录入的业务数据、昵称、身份、AI 密钥：封装 skill、示例、报告时一律用占位符，不出现真实内容。
- 代码内若带具体部署者的 Supabase 项目域名/凭据，仅存在于其本地克隆中；**公开文档与示例一律占位，严禁随仓库发布真实值**（仓库内 app/index.html 的 DEFAULT_CLOUD 必须为空值 + 指引注释）。

## 3. 前端架构地图

- **视图**：`VIEWS`（约 2820 行）注册 16 视图 `{label,ico,render}`：overview/time/sport/course/study/research/inspiration/reading/finance/rewards/news/review/ai/me/apps/settings（settings 保留无导航入口，render 被 me 复用）。导航 key 走 `data-view`。
- **导航**：`renderNav()` 按 `NAV_GROUPS` 渲染 `nav-item` + 尾部附加 apps 节点。
  - 手机底栏（≤768px）：CSS 白名单放行 `overview/ai/apps/me`，`order`：apps=2、me=3 → 概览|对话|更多|我的；四等分、选中圆角 16px（勿写 border-radius:0）。
  - 电脑侧栏：显示全部分组（apps 节点被 `@media(min-width:769px){#nav .nav-item[data-view="apps"]{display:none}}` 隐藏——**桌面无「更多」**，功能全部直列；概览页的 `#detail .ov-profile-strip`（个人档案条）同样桌面隐藏、手机保留。
- **图标库** `ICONS`：24 viewBox、stroke 线稿；`ico(name)` 生成。新增保持同风格。
- **事件**：`data-action` → 全局委托 `handleAction`，先进**点击白名单**（约 32 exact + 34 startsWith 前缀族）。**新增动作必须同步加白名单前缀**。输入类（set_lead/set_sit/bg_file 等）由全局 change 委托保存，modal 内同样生效。
- **弹窗**：`openModal(title,bodyHtml)`（#modalBox）。**弹窗是静态快照**：内部若有切换类动作（如背景模式），需调用 `refreshSettingsModal()`（按 h2 标题匹配 6 个设置弹窗重建 body；存储弹窗重建后自动 storeRefresh）——见 bg-mode/bg-soft/bg-rm 接入示例。
- **renderView 特判**：overview 启 hero ticker（`window._heroTimer` 防重）；settings||me 触发 storeRefresh（无 #storeBody 时 guard return）。
- **手机端服务探测**：`detectLocalServer` 必须校验 `/api/health` 返回**真实 JSON**才算本机在线——静态托管 SPA 会把不存在路径回退成首页 HTML(200)，只查 `r.ok` 会误判（历史教训）。
- **Toast 配色防坑**：通用 `.toast{...}` 若带 `!important` 会覆盖 `.toast.gold/.toast.warn` 背景 → 用 `.toast:not(.gold):not(.warn)` 收敛作用域，专属类补 `!important` + `font-weight:600`（历史翻车）。

## 4. CRLF 安全编辑（第一优先级）

index.html 为 CRLF。批量改动用 Python，铁律：

```python
raw = io.open(p,'rb').read().decode('utf-8').replace('\r\n','\n')
# ... str.replace 前先 assert raw.count(old)==1（锚点唯一，写清 tag）...
io.open(p,'wb').write(raw.replace('\n','\r\n').encode('utf-8'))
```

锚点取行内唯一片段；不在 CRLF 文件用 sed 做多行替换。

## 5. 五步验证法（每次发版走全套）

1. **语法**：取最后一个 `<script>` 段 `node --check`。
2. **覆盖审计**：提取全部 `data-action="([\w-]+)"` 字面量 vs 白名单 exact/前缀差集为空；`data-view=` ⊆ `VIEWS` keys。
3. **版本**：确认 `app/` 内 index.html / sw.js / manifest / 图标同层一致；`SW_VER` +1。
4. **部署**：CloudStudio deploy（directory=<repo>/app）。
5. **双端回归**：
   - 手机视口 390×844：底栏四 tab → 各视图真实点击（apps 页 .app-row / 我的 .set-row）断言 `#detail` 无「该页面渲染出错」、modal 开关正常；几何用 getBoundingClientRect 断言。
   - 桌面视口 1280×800：无横向溢出、侧栏无 apps、概览无 ov-profile-strip。
   - `navigate()` 等函数不在 agent-browser eval 全局作用域，须走真实 DOM 点击路径（底栏 tab / apps row / set-row）。

## 6. 移动端体验约定（用户高频调整项）

- 顶栏品牌 `.tb-brand`：无药丸框（去背景/边框/圆角/padding），logo=米色底 icon-light data URI，img `object-fit:contain` 28px。
- AI 输入行：附件/语音方形 36×36，**发送圆形 40×40**（视觉与方 36 等大、主钮突出）；外壳 compact padding、统一 gap。
- 概览个人档案条（手机显示/桌面隐藏）：昵称 + 生日**斜体小字**（未填不渲染）+ 座右铭，**无编辑按钮**（编辑在「我的」）。
- 「更多」页顶部一行 📲 安装提示（含安卓/iPhone 方法），下接分组功能条目 .app-row。
- 概览个人资料编辑统一走「我的」页（me hero ✏ 或 个人资料栏 → profileForm 弹窗）。

## 7. 用户协作习惯

- 改完必给线上地址 + 提示「手机刷新/关标签重开」；管理发布 = 设置 - 数据管理 - 我发布的应用。
- 反感堆砌功能；功能默认顺序可写死，但展示集必须来自实际数据（自由输入字段不硬编码白名单）。
- 改动前先整段读受影响 CSS/JS；锚点脚本一次性多替换、逐个打 OK 日志。

## 8. 终端用户指南（从零自部署一套「电脑 + 手机 + 双端同步」）

> 用途：用户安装了本 skill、但还没有可用实例时，agent 按此节逐步引导；或把本文件发给用户照做。references/ 内含建表 SQL（均无用户敏感信息，可随 skill 一起发布）。

### 8.0 安装本 skill（给 agent 使用者）
把整个 `muan-workbench/` 目录放入 `~/.workbuddy/skills/`（用户级）或项目 `.workbuddy/skills/`。之后在对话中说「帮我配置木案工作台 / 双端同步怎么弄」，agent 会加载本手册并照 §8 引导。

### 8.1 电脑端安装（Windows / macOS / Linux）—— 详细分步
给用户逐步照做；出现任何一步失败先按 §9/FAQ 排查：
1. **拿代码**：`git clone <仓库>` 或 GitHub `Code → Download ZIP` 解压。
2. **装 Node.js（一次性）**：Windows 到 nodejs.org 下载 LTS .msi 安装；macOS `brew install node`；Linux 用系统包管理器。验证：终端 `node -v` 输出 v18+。
3. **一键启动**：
   - Windows：双击仓库根 `start-muan.bat`（黑窗口**不能关**；2 秒后自动开浏览器；控制台打印 `MUAN_LISTENING=端口`，8765 被占会自动递增）。
   - macOS/Linux：`chmod +x start-muan.sh && ./start-muan.sh`。
4. **验证**：浏览器打开 `http://localhost:8765/`，见「木案 · 个人工作台」并能新增数据即成功（数据存 `app/data/muan.db.json`）。
5. **（可选）电脑端也装成桌面应用**：Chrome/Edge 打开 localhost 页面 → 地址栏「安装」图标或菜单 ⋮ →「安装 木案」→ 桌面/开始菜单出图标，无地址栏窗口（仍需先启动服务）。
6. 局域网应急：同 WiFi 手机访问 `http://<电脑局域网IP>:8765`（临时；正式请走 §8.3 云同步 + §8.2 PWA）。

#### 8.1.1 预置背景图（4 张，开箱即用）
工作台内置 4 张主题背景图（用于「我的 → 外观设置 → 主题氛围」），已随仓库一起发布在 `app/data/`：
- `data/forest-hero.jpg`（默认 · 林间晨光）
- `data/bg-blue.png`（蓝调）
- `data/bg-ochre.png`（赭石）
- `data/bg-violet.png`（紫调）

**首次 clone 后若发现背景图缺失**，原因多为 `.gitignore`/`.zip` 过滤了 `app/data/` 下的图片；处理方法：
1. 确认这 4 个文件存在于 `app/data/`（不是被 `.gitignore` 排除或被 zip 漏打包）。
2. 若确实缺，从仓库重新拉取（`git pull`）或解压完整 zip；不要把它们移到别处，否则 `data/<file>` 的相对路径会失效。
3. `server.js` 把 `app/data/` 作为静态目录暴露，前端 CSS 直接以 `data/forest-hero.jpg` 等相对路径引用，**别改成绝对路径或外链**。

用户在「我的 → 外观设置」上传的自定义背景存 `app/data/muan.db.json`（base64 内嵌字段），与上面 4 张预置图互不干扰。

### 8.2 手机端安装（PWA）—— 详细分步
前置：把仓库 `app/` 目录**整体**发布到任意 HTTPS 静态托管（CloudStudio / Netlify Drop / GitHub Pages 均可；app/ 已含离线壳全部文件，无需构建）。
1. **iPhone / iPad（必须用 Safari）**：打开线上地址 → 底部「分享」（方框+↑）→「添加到主屏幕」→ 确认「木案」→ 右上「添加」。完成后桌面图标即全屏 App。
2. **Android**：Chrome 右上 ⋮ →「安装应用」/「添加到主屏幕」；Edge 右上 ⋯ →「添加到手机 → 安装应用」；地址栏若出现 ⊕/「安装」图标可直点。完成后桌面图标全屏运行。
3. **验证**：桌面图标名「木案」、打开无地址栏、断网可开已缓存页、顶栏为米色药丸+墨绿木桌图标。
4. 提示文案：网页内「更多」页顶部有安装方法一行；iPhone 装完从桌面进入即独立 App。

### 8.3 双端同步（Supabase）—— 每台设备都要做的四步
1. **建项目**：supabase.com 免费注册 → 新建项目。
2. **执行 SQL**（一次即可）：Supabase 控制台 → SQL Editor → 依次执行 `references/` 里的脚本：
   - `supabase-setup.sql` —— 建 `muan_state` 同步表 + RLS（**必须**）
   - `supabase-setup-v3.sql` —— 手机端 AI 通道（可选）：先到 Database → Extensions 启用 `pg_net`，再执行；执行前把脚本头部 DeepSeek API Key 占位符换成你自己的
   - `supabase-setup-v2.sql` 为历史版本，**无需执行**
3. **填凭据**：应用内「我的 → 数据与同步」→ 展开「☁️ 自建后端配置」→ 粘贴 **Project URL** 与 **Publishable(anon) Key** → 保存 → 测试连接。
   - 获取位置：Supabase 项目 → 顶部 Connect / Project Settings → API。anon 可公开给前端；**service_role 绝不填、不外发**。
4. **登录同账号**：注册（邮箱+密码）→ 电脑与手机登录**同一个账号** → 保持「自动同步」开启。之后任意一端改动约 3 秒自动推送合并。

**冲突与回退**：两端同时改了同一模块 → 自动推送不静默覆盖（只提示）；手动「立即同步」时可选「本机为准 / 云端为准」；历史版本可在「🕘 云端备份」中回退。

### 8.4 常见报错速查
- 手机「对话」提示未执行 v3 / 需先配置 → 执行 `supabase-setup-v3.sql` 并填入 DeepSeek Key；且需已登录云账号。
- 云同步收不到确认邮件 / 登录被拒 → 打开注册确认链接；或到 Supabase Authentication 关闭 Email 确认后重试。
- 手机 AI 报网络错误 → 确认打开的是 **HTTPS 线上地址**（本地 `http://局域网IP` 时 AI 会走错分支）。
- 忘凭据从哪来 → 「数据与同步」卡内的说明与「复制建表 SQL」按钮即可复现。
## 9. 数据抓取链路与恢复指南（时事热点 / 学术文献）

用户安装后可用的抓取能力按「跑在哪一端」分三层——排查与引导都先看这一节。

### 9.1 手机端（静态托管，无 server）也能直连的源
- **时事热点 · 微博 / 抖音 / 知乎**：前端 `HOT_DIRECT` 直连公开聚合源 `https://60s.viki.moe/v2/{weibo,douyin,zhihu}`；代码逻辑：先试本机 `/api/hot`，连不上自动回落直连，因此**无需任何后端即可工作**。
- **学术文献 · OpenAlex / Crossref**：浏览器直连 `https://api.openalex.org/works|sources...`、`https://api.crossref.org/journals/<issn>/works...`（CORS 开放）。用于文献库检索/期刊检索/知识补充，手机可用。

### 9.2 依赖电脑端 server.js 的源（装机后“没抓到”先查这条）
- **时事热点 · 学术前沿、小红书**：仅 `node server.js` 的 `/api/hot` 提供（多平台多源抓取 + 5 分钟缓存；GET `/api/hot?refresh=1` 强刷、POST `/api/hot` 指定 sources）。UI 空态文案已明示“学术前沿/小红书需本机电脑端”。
- **文献雷达 · 期刊最新文章**：前端请求写死 `http://localhost:8765/api/journals?action=latest...`，**只有本机浏览器**能拉（手机/远程不可用，属现状边界非 bug）。

### 9.3 「抓取失效」排查清单（按序）
1. 电脑端打开页面→热点页：三个标签（微博/抖音/知乎）是否有数据？→ 有＝server 或直连正常；无＝网络到 `60s.viki.moe` 不通或源失效（换网络/过会儿重试）。
2. 学术前沿/小红书空：确认 `node server.js` 在跑、浏览器开的是 `localhost:8765`（不是 file://）；server 日志看抓取错误。
3. 文献雷达空：同样先确认 server 在跑；再在设置页「存储与清理」看路径（/api/store 返回 logs）；必要时看 `muan.log`。
4. 手机端：只用微博/抖音/知乎 + 学术库检索；学术前沿/小红书/雷达请在电脑端用——这是设计边界，不当作故障。

### 9.4 若未来要让手机端全量抓取（可选方向，默认不做）
把 `/api/hot`、`/api/journals` 移植为 Supabase 数据库函数（参照 v3 AI 通道的 RPC + pg_net 模式）或独立代理服务；同时把 1998 行写死的 `localhost:8765` 改为相对/可配置基址。**注意用户偏好克制**：热点平台保持原 5 个（学术前沿/微博/抖音/知乎/小红书），只做可靠性增强，不扩平台。

## 10. 科研进程 · 文献精读（2026-09-23 增，对齐飞书多维表格）

来源：用户希望把飞书「新闻传播学科研文献阅读与管理系统」的字段/视图/功能复刻进科研进程。
复刻范围 = **字段与视图结构 + 功能与规则**（不导入数据行）。

### 10.1 数据结构（`state.research.papers[]` 新增）
| 字段 | 说明 |
|---|---|
| `abstract` / `findings` / `method` / `theory` / `gap` / `future` | **六维**，对应飞书的 6 个「AI 生成」列 |
| `theoryTags` | 数组，理论视角标签（与 `tags` 分类标签是**两套独立体系**） |
| `srcName` | 原始文件名（手机端导入不落文件时，靠它说明来历） |
| `aiMeta` | `{at, chars, pages, truncated}` —— 上次解读的时间与依据，界面会显示 |

所有渲染点必须 `||''` 兜底。**记录编号、创建人字段按用户意愿未做**（本地单人应用无意义）。

### 10.2 视图（`LIT_VIEWS`，对齐飞书 5 个预设视图）
全部文献 / 理论视角（`theoryTags` 非空 **或** `theory` 有实质内容）/ 媒介研究（`tags` 含「媒介研究」）/ 在读（`status==='在读'`）/ 引用格式库。
与「状态」筛选并成**两行 chip**（两个概念，别混成一行）。chip 生成统一走 `litViewChipsHtml()`——
**引用格式库视图也必须渲染视图条**，否则用户进去出不来（踩过）。

### 10.3 引用格式
`apaCite(p)` 按 APA 7 拼「作者 (年份). 标题. 来源.」，自动、不手填。
**占位语必须清洗**：模型爱回「原文未涉及」，六维里保留它是有用信息，但题录字段
（title/author/venue）不清掉就会拼出「原文未涉及 (2022). 标题. …」这种垃圾引文。
判定走 `litPlaceholder()`；`normalizeLitObj()` 里统一处理。`theoryTags` 解析要**先 trim 再剥引号**。

### 10.4 PDF 正文抽取（浏览器端，不是服务端）
`vendor/pdfjs/`（pdfjs-dist 4.0.379 legacy，360KB + 1.08MB）。
**必须走浏览器端**：手机端是静态托管、没有 server.js，只有浏览器端双端通用。
- 新增静态资源类型要同步补 `server.js` 的 MIME 表，否则 dynamic `import('*.mjs')` 被当 octet-stream 拒绝
- 抽不到正文 / 扫描版 PDF → **明确报错并引导「粘贴正文」**，绝不让模型凭标题猜
- Node 端跑 pdf.js 需要 DOMMatrix/Path2D 垫片，别拿它当验证手段，直接用浏览器验

### 10.5 AI 解读可靠性（四道闸，缺一不可）
`litAnalyzeCore(text, base)`：
1. **低温** `temperature: 0.2`（`aiCall(messages, noTools, opts)` 第三参，server.js 透传）
2. **JSON 解析失败自动重试一次**，并附「只输出 JSON」的提醒
3. **归一化 + 校验**：`normalizeLitObj()` 规范字段；**有效维度 < 4 项判为失败，不落库**
4. **依据可追溯**：写 `aiMeta{at, chars, pages, truncated}`，界面显示「上次解读 … · 依据正文 N 字」
一次调用同时产出**题录 + 六维**（省一半调用量）；题录只补空、不覆盖用户手填。

### 10.6 批量导入（拖放弹窗）
入口两处：AI 对话页输入行 📚 + 空态 chip；文献库标题「导入 PDF」。
`litImportModal()` 弹窗含**虚线拖放区**（示意拖入位置）+ 选择文件（multiple）+ 逐条状态列表 +
「同时做 AI 六维解读」开关。流程：上传到 `data/media/` → pdf.js 抽正文 → 一次 AI 调用 → 落库。
- 拖放区要 `addEventListener` 绑 `dragenter/dragover/dragleave/drop`（不是 data-action，拖拽不走点击委托）
- 手机端没有 `/api/media`：**能解读但不落文件**，`file=''` + 记 `srcName`，界面标「无原件」并提前告知

### 10.7 阅读与管理
- 内嵌 PDF 阅读器 `litRead()`：pdf.js 渲 canvas + 翻页 / 缩放 / 新标签兜底
- 展开区有**阅读状态快捷切换**（待读/在读/精读中/已读/已引用），标「已读」自动补进度 100%
- 删除走已有 `delColl`，但提示语要说明**附件不会一起删**，之后可在设置里用「无引用附件」清理

### 10.8 全局 AI 与科研 AI 互通
**同一条对话**：科研面板不再有独立 `resAiMsgs` / `RES_AI_SYSTEM` / `buildResContext`。
- 共用 `chatMessages` + `aiSessId` + `AI_TOOLS` + `buildAiContext()`
- `buildAiContext()` 里并入 `litContextBlock()`（文献库明细 + 研究问题 / 里程碑 / 在途稿件）
- **`aiRender()` 末尾必须调 `resAiRender()`**：原来 `#aiMsgs` 不存在就 `return`，
  导致在科研页发消息时面板不刷新
- 科研面板发送走 `resAiSend()`（复用 `aiRun()`），不另写一套

### 10.9 设置里的文献存储
「我的 → 存储与清理」新增「📚 科研文献附件」一行：文献数 / 有原件数 + 「打开附件目录」。
`server.js` 新增 `POST /api/open-folder {which}`，**只放行 media / data / backups 三个目录**
（白名单在服务端再校验一次，实测 `../../Windows` 被拒），Windows 走 `explorer`、macOS `open`、Linux `xdg-open`。

### 10.10 本次踩坑（务必记住）
1. **`data-action` 点击白名单是硬编码前缀匹配**。本次新增动作必须同时补前缀
   （已加 `lit-` `res-ai` `imp-` `pdf-`），否则点击**静默失效、零报错**。
2. **同名注释会坑正则**：CSS 里有一条 `/* ===== 文献精读（对齐飞书…`，JS 里也有一条。
   用正则整段替换时锚点必须带够区分度（JS 那条含「的字段与视图」），否则会从 CSS 一路吞到 JS。
3. **`aiCfgOk` 只在访问过「对话」页后才赋值** → 非 AI 页要用模型前先 `await ensureAiCfg()`。
4. 验证手段：白名单覆盖**不要手敲前缀列表**（必漏），要从源码抽出那串条件表达式
   `new vm.Script('(a)=>('+expr+')').runInNewContext({})` 编译成判定函数再逐条验。

### 10.11 布局与多选（2026-09-23 二版）
用户反馈「内嵌 AI 面板把列表挤窄、长回答没地方看」「文献要能多选管理」，据此调整：

- **AI 改弹窗式**：科研页只留一条细入口 `resAiBarHtml()`（状态点 + 打开对话 + 导入文献），
  点「打开对话」才 `resAiModal()` 开弹窗。弹窗容器仍是 `#resAiBox`，所以 `aiRender()` 里的
  `resAiRender()` 不用改；另加 `resAiBarRender()` 让入口条反映「正在回答…」。
  `aiStartNew()` 不关弹窗（`res-ai-new`）；`res-ai-goto` 必须 **先 `closeModal()` 再 `navigate('ai')`**，否则弹窗盖在新页面上。
- **筛选可收起**：视图/状态两行 chip 默认折叠，只留一行摘要「全部文献 · 全部状态 · 命中 N 篇 展开▾」，
  省下两行竖向空间给列表。状态存在 `litFilterOpen`。
- **多选批量管理**：`litSelOn` / `litSel`（id 数组）/ `litVisibleIds`（当前筛选结果，供「全选本页」）。
  进入多选后行首出勾选框、整行点击即勾选、**隐藏单条删除键**（防误删）、自动收起已展开项。
  工具条 `litSelBarHtml()` 批量动作：全选本页 / 清空 / 改状态 / 加标签 / 复制引文 / 删除。
  改状态与加标签走小弹窗（避免在 change 监听里加分支）；删除走 `askConfirm`。
  **`askConfirm(title, msgHtml, onYes)` 只有 3 个参数** —— 多传一个按钮文案会把回调顶掉，删除静默失效（踩过）。
- **阅读排版**：详情里「操作按钮」提到六维之前（看完就能操作），六维单独包在 `.lit-read` 里
  （字号 13.5、行高 1.85、桌面两栏），元信息（状态/标签/笔记/引文/原件）收进 `.lit-metabox`。
  列表摘要用 `-webkit-line-clamp:2` 截两行。
  **别用 `max-width:46ch` 限制中文行宽** —— `ch` 按数字 0 的宽度算，中文下 46ch 只有约 23 字/行，太窄；栏宽本身（约 480px ≈ 35 字）就合适。
- 列表里「已精读」与「六维 6/6」**只留一个**（重复说同一件事很吵）：满 6 维显示「已精读」标签，部分完成才显示「六维 N/6」。
- 分类标签与理论视角标签**合成一行**显示，不要因为有了理论标签就隐藏分类标签（那是「媒介研究」视图的依据）。

### 10.12 全文读取：分段全读（不再截断）
**问题（用户实测反馈）**：4 篇真实文献里有 1 篇标了 truncated、1 篇只抽出 2013 字。
用「逐页字数」诊断后定位到**两个不同原因**，别混为一谈：

| 现象 | 真实原因 | 处置 |
|---|---|---|
| 22808 字却标 truncated | **旧版 `LIT_TEXT_MAX=20000` 硬截断**，长文尾部（往往是结论/局限）根本没送模型 | 改成**分段全读** |
| 3 页只抽出 2013 字 | 第 1、3 页**没有文字层**（扫描/图片页）——PDF 物理限制 | **精确报出缺哪几页** + 提供合并粘贴 |

- `LIT_CHUNK=14000` 字/段、`LIT_CHUNK_MAX=8` 段。一段读完就单次调用；多段则**每段单独解读**（提示词明确说「这只是第 N/M 段，不要据标题推测全文」），再用 `litMerge()` 归并：去重、按重要性排序、冲突取更具体的一条。
- `litSingle()` 抽出「单次调用 + JSON 校验 + 失败重试一次」，`litAnalyzeCore` / `litMerge` 共用。
- 分段时逐段进度写进界面（`litAnote`）：「正在读第 2/3 段…」「正在把 3 段结论合并…」。
- `aiMeta` 改为 `{at, chars, pages, chunks, emptyPages}`，**去掉 truncated**。详情里显示「分 N 段全读」。

### 10.13 扫描页：检测 + 精确告知 + 合并粘贴
- `pdfExtract(src, onProgress)` 现在**逐页**统计 `pageChars`，一页少于 `LIT_PAGE_MIN=120` 字即判为「没有文字层」，收进 `emptyPages`。
- 只有**总字数**够不够的判断是不够的：必须把「哪几页缺」暴露出来，否则用户以为读完了。
  详情里常驻黄条：`⚠️ 第 1、3 页没有文字层（扫描/图片页），这几页的内容没参与分析`。
- 补救路径：`litLastExtract` 缓存最近一次抽取的正文；「粘贴正文」弹窗据此给出
  **「与 PDF 已抽到的正文合并」**勾选项，并把提示改成「把第 1、3 页贴进来」。合并后清掉 emptyPages 告警。
- 批量导入同样逐页统计、同样报 `⚠️ 第 N 页无文字层`，并把 `chunks/emptyPages` 写进新记录。

### 10.14 对照阅读
**需求**：用户要「论文对照来看」。六维内容都是长文本，**表格列宽会被压扁**，所以不采用表格：
以**维度为锚点**，同一维度下多篇并排。

- 入口：多选（2–4 篇）→ 工具条「对照」。`litCompare` 存 id 数组；`renderResearchLiterature` 开头
  `if(litCompare.length>=2)return renderLitCompare();`，即**复用文献库这块位置**而不是新开标签页（不增标签、天然全高、有返回键）。
- 布局：顶部参与文献卡片 → 6 个维度小节（每个小节内 N 篇并排）+ 引用格式小节；
  桌面 `.cmp-grid.n2/n3/n4` 多栏，窄屏单列纵向堆叠。每格标注 `#序号 首作者 年份`。
- 未分析的格子显示「未分析」，顶部提示有几篇没做完。
- 「让 AI 对比这几篇」：把各篇六维拼成提问发给**共用的**科研 AI 弹窗（`resAiModal()` 后 `resAiSend()`），
  要求交叉对比理论取向/方法差异/研究不足拼出的选题/综述组织方式。**提问里写明「我标了未分析的就明确说缺数据、不要猜」**——实测模型确实会照做。
- `renderLitCompare` 里若有效文献不足 2 篇要**先 `litCompare=[]` 再回退**到列表，否则会无限递归。

### 10.15 本轮踩坑
1. **同名注释坑正则（第三次）**：`index.html` 里 CSS 与 JS 各有一条 `/* ===== 科研进程内嵌 AI 面板 =====`。
   用 `indexOf` 定位区间必须先确认命中的是哪一条（JS 那条后面直接换行，CSS 那条后面跟 ` */`）。
2. **补丁脚本要用「正则整段替换 + 命中计数」**，任一项不是恰好 1 次就整体不写入。`[\s\S]*?\n\}` 惰性匹配函数体很好用。
3. **改批量导入时别忘了同步**：`paperFromImport` 的 aiMeta、导入进度文案、`litAnalyzeCore` 的 onStep 回调——一处漏改就会出现「单独分析对、批量导入还是旧行为」。
4. **沙箱脚本要先 `mkdirSync(SB)` 再 `copyFileSync`**，否则父目录不存在，复制会全部被 `try{}catch{}` 静默吞掉（表现为「服务起不来：Cannot find module server.js」）。
5. 沙箱里跑需要模型的测试：临时把 `data/ai-config.json` 复制进沙箱，**收尾必须连同沙箱一起删掉**（里面是用户的 API Key）。同时删掉 `muan-pdfdiag` 这类 PDF 副本目录。

### 10.16 大弹窗、文献序号与排序（2026-09-23 三版）
用户反馈「科研 AI 弹窗设计过小、布局不合理，对话框要完整方便查阅；文献需要序号排序」。

**① 科研 AI 弹窗改成大窗**
- `openModal(title, html, opts)` 新增第三参数；`opts.wide` → `#modalBox` 加 `modal-lg` 类。
  基础 `.modal` 只有 `max-width:520px`，长回答在弹窗里根本展不开。
- `.modal.modal-lg`：桌面 `max-width:860px; height:88vh`；手机 `height:93vh`（原来 88vh 的 bottom sheet 不够）。
  关键是 `display:flex;flex-direction:column;overflow:hidden` —— **把滚动交给内部对话区，弹窗本身不滚**。
- `#resAiBox` / `.res-ai-modal` 逐层 `flex:1;min-height:0`，`.res-ai-log{flex:1;min-height:0}`。
  这样对话区从写死的 `max-height:240px` 变成撑满剩余空间（桌面实测 555px 高）。
  链条上任何一环漏了 `min-height:0`，flex 子项就不会收缩，输入框会被挤出屏幕。
- 头部改成 `.res-ai-hd`：状态点放在副标题行 *内部*（`display:flex;align-items:center`），
  比让点独立成列更容易对齐（独立成列时 `align-items:center` 会让它飘在两行文字中间）。
- 空对话时提示用 `.res-ai-log>.res-ai-hint{margin:auto 0}` 垂直居中。
- **`openModal` 只有 2 个参数，多传的第 3 个会被丢掉**——`askConfirm` 也踩过同样的坑（见 10.11），
  项目里所有看似能接配置的老函数，改之前先 `grep` 它的真实签名。

**② 文献固定序号 + 排序**
- `litNo(id)`：按 `papers` 数组（录入顺序）返回 1-based 序号；`litSortList(list)` 按 `litSort` 排新数组。
- 序号是**固定的**（跟着文献走），不随排序变化——这样「第 5 篇」在任何排序下都指向同一篇，
  写笔记、与人讨论、对照视图里对号都不会错位。脚注里写明了这一点。
- 排序方式 `LIT_SORTS = 录入顺序 / 年份 / 作者 / 状态 / 标题`；年份**重复点击翻转升降**（`litDir`），
  chip 文案动态显示 `年份 ↓` / `年份 ↑`。
- 排序只改展示顺序：`renderResearchLiterature` 里 filter 之后再 `list=litSortList(list)`，
  必须在 `litVisibleIds` 之前（否则「全选本页」和实际列表不一致）。
- 排序持久化到 `muan.litS` / `muan.litD`，与 `muan.litV` / `muan.litF` 同一套路。
- 无年份的文献**统一排最后**（不管升序降序），别让它们霸占开头。
- 序号占位与多选勾选框**同列切换**（非多选显示序号，多选显示 `.lit-pick`），不额外占宽度。
- 引用格式库、对照视图（`.cmp-card` / `litCompareAbbr`）也统一用 `litNo`，
  原来对照里用的是 `#'+(i+1)`（列表位置），换成固定序号后才能与库内其它地方对上。

**③ 顺手修掉的真 bug**
- **刷新 / 重开应用后对话看着像丢了**：记录其实一直在 `localStorage['muan.aiSessions']`，
  但 `aiSessId` 没持久化，重载后 `chatMessages` 为空，对话页一片空白，得去历史列表点开。
  修法：加 `aiSaveSessId()`，在 `persistActive` / `aiOpenSession` 写入，`aiStartNew` / `aiDelSession` 清除，
  启动时按 `muan.aiSessId` 找回对应会话并回填 `chatMessages`。
- **列表标题过长**：手机上一条标题占 4 行，一屏放不下两条。`.lit-card .body>.title` 加两行截断，
  `.lit-card.open .body>.title` 放开；「已精读」标记从标题里移到元信息行，否则会被截断吃掉。

**④ 测试提醒**
- 排序、序号这类仅涉及展示的改动**不需要 AI**，沙箱可以只复制 `muan.db.json` + `media/`，
  **不复制 `ai-config.json`**，收尾压力小得多。
- 端口探测：`server.js` 遇到 8765/8766 被占会自动往上试。**收尾只停自己起的那个端口**
  （否则会误杀用户正在用的应用，见 10.10 的教训）。
