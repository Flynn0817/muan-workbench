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

### 8.1 电脑端：跑起本地服务
1. 安装 Node.js（≥18）。
2. 克隆仓库后在 `<repo>/app` 执行 `node server.js`（默认端口 8765）。
3. 浏览器打开 `http://localhost:8765` —— 数据自动存入本机 `data/muan.db.json`。
4. 局域网应急：同一 WiFi 下手机访问 `http://<电脑局域网IP>:8765`（临时用，正式请走云同步）。

### 8.2 手机端：安装 PWA
1. 需要一个 HTTPS 线上地址（把仓库 `app/` 目录整体发布到 CloudStudio/任意静态托管）。
2. 手机浏览器打开线上地址 → 「更多」页顶部一行安装提示：
   - 安卓：浏览器菜单 →「安装应用」
   - iPhone：Safari 分享 →「添加到主屏幕」
3. 从桌面图标进入即全屏独立 App；Service Worker 保证离线也能打开已缓存页面。

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


