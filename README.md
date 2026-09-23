# 木案 · 个人工作台（开源版）

一个**单文件驱动的个人工作台**：待办 / 时间规划 / 课程 / 运动 / 学习目标 / 科研文献 / 收支 / 时事热点 / AI 对话 / 成就激励。电脑与手机双端共用一份代码，可选用 Supabase 云同步让两端数据互通。

**科研文献精读**：把 PDF 拖进「导入文献」弹窗（可批量），自动抽取正文并让 AI 生成**题录 + 六维解读**（摘要 / 核心发现 / 研究方法 / 理论视角 / 研究不足 / 未来研究方向），支持内嵌阅读、阅读状态跟踪、APA 7 引用格式一键复制；文献库与 AI 对话页共用同一条对话。

仓库结构：

```
muan-workbench/
├── app/                      工作台本体（可直接运行，也可整体作为手机端静态站点发布）
│   ├── index.html            单文件应用（CSS/HTML/JS 全内联）
│   ├── server.js             电脑端本地服务（端口 8765）
│   ├── vendor/pdfjs/         PDF 正文抽取（浏览器端，离线可用）
│   ├── data/                 4 张预置背景图（运行时会自动建 media/ 存附件）
│   ├── sw.js / manifest.webmanifest / icon-*.png / *.svg   PWA 资产
├── start-muan.bat            Windows 一键启动
├── start-muan.sh             macOS / Linux 一键启动
├── skills/muan-workbench/    AI 维护 skill（含用户指南 §8、抓取指南 §9、文献精读 §10）
│   └── references/           Supabase 建表 SQL
└── LICENSE
```

---

# 📖 安装手册（详细版）

## 第一部分 · 电脑端安装（Windows / macOS / Linux）

> 电脑端体验：本地服务 + 浏览器使用。数据保存在本机 `app/data/muan.db.json`，不出机器。

### 第 1 步：获取代码
- **方式 A（推荐）**：`git clone https://github.com/<你的账号>/muan-workbench.git`
- **方式 B**：GitHub 仓库页 → 绿色 `Code` → `Download ZIP` → 解压到任意目录。

### 第 2 步：安装 Node.js（只需一次）
- Windows：打开 https://nodejs.org → 下载 **LTS** 版 `.msi` → 双击安装，一路下一步。
- macOS：装好 Homebrew 后执行 `brew install node`（或官网 `.pkg`）。
- Linux：`sudo apt install nodejs npm` 等发行版方式。
- 验证：新开终端执行 `node -v`，能打印 `v18` 或更高即成功。

### 第 3 步：一键启动
- **Windows**：双击 `start-muan.bat`。
  - 会弹出一个黑色控制台窗口（**别关它，关它 = 停止工作台**），2 秒后自动打开浏览器。
  - 控制台会打印真实地址 `MUAN_LISTENING=端口号`；若 8765 被占用会自动 +1 递增。
- **macOS / Linux**：在仓库目录执行
  ```bash
  chmod +x start-muan.sh
  ./start-muan.sh
  ```

### 第 4 步：确认装好了
浏览器地址栏显示 `http://localhost:8765/`，出现「木案 · 个人工作台」，可以新建待办/记账即成功。

### （可选）第 5 步：把电脑端也"安装"成桌面应用
电脑端本质是网页，可像手机一样装成独立窗口应用（仍需本机服务在跑，先执行第 3 步）：
- **Chrome / Edge**：打开工作台页面 → 地址栏右侧出现「安装」图标（⊕/显示器图标），或点菜单 ⋮ →「**安装 木案 · 个人工作台**」→ 安装。
- 之后从桌面/开始菜单图标打开即为无地址栏窗口；配合 `start-muan.bat` 开机即用。

---

## 第二部分 · 手机端安装（PWA）

> 手机端需要先把 `app/` 发布到一个 **HTTPS 静态托管**。`app/` 目录内已包含离线壳所需的全部文件（index / sw / manifest / 图标），整个目录即发布内容，无需构建。

### 第 1 步：发布 app/ 到静态托管（任选其一）
- **CloudStudio**：把整个 `app/` 目录作为静态站点发布 → 得到 `https://<id>.app.workbuddy.link`。
- **Netlify**：`npm i -g netlify-cli` 后 `netlify deploy --prod --dir app`；或把 app/ 拖入 https://app.netlify.com/drop
- **GitHub Pages**：仓库开启 Pages，发布分支根目录下的 `app/`；或手动把 app/ 内容推到 `gh-pages` 分支。

### 第 2 步：iPhone / iPad（Safari）
1. 用 **Safari** 打开线上地址（不要用微信内浏览器）；
2. 点底部 **「分享」按钮**（方框 + 向上箭头）；
3. 向下滑找到 **「添加到主屏幕」**；
4. 名字确认「木案」→ 点右上角 **「添加」**。
完成后桌面出现图标，从图标进入即**全屏独立 App**（无浏览器地址栏）。

### 第 3 步：Android（Chrome / Edge / 其它）
- **Chrome**：打开线上地址 → 右上角 **⋮** → 选 **「安装应用」**（或菜单里「添加到主屏幕」）→ 确认。
- **Edge**：右上角 **⋯** → **「添加到手机」→「安装应用」**。
- 若地址栏旁出现 ⊕/「安装」小图标，点它更快。
完成后桌面出现图标；从图标进入即全屏模式，**断网也能打开已缓存页面**。

### 第 4 步：确认装好了
桌面图标名称「木案」，打开后无地址栏、可正常使用；顶部品牌为米色圆角小药丸 + 墨绿木桌图标即为最新版。

---

## 第三部分 · 双端同步（可选，推荐）

电脑、手机各装好后，用同一 Supabase 账号即可让两边数据互通：

1. 注册：supabase.com → New project（免费额度足够个人使用）。
2. 执行建表 SQL（只做一次）：
   Supabase 控制台 → **SQL Editor** → New query → 打开本仓库
   `skills/muan-workbench/references/supabase-setup.sql`，全选复制粘贴 → Run → Success。
3. （可选，手机 AI 对话要用）执行 `supabase-setup-v3.sql`：
   先到 **Database → Extensions** 搜索并启用 `pg_net`；再把脚本头部 `'在这里填sk-开头的DeepSeekKey'` 换成你自己的 DeepSeek API Key → Run。
4. 各设备填凭据：打开工作台 → **我的 → 数据与同步** → 展开「☁️ 自建后端配置」→ 粘贴 **Project URL** 与 **Publishable(anon) Key** → 保存 → 测试连接。
   - 获取位置：Supabase 项目 → Connect / Project Settings → API。
   - anon 可公开；**service_role 绝不填**。
5. 注册/登录：先点「注册新账号」（邮箱+密码），再在电脑和手机上登录**同一个账号**；保持「自动同步」开启。之后任一端的改动约 3 秒自动同步到另一端。
6. 冲突怎么办：两端同时改了同一模块时自动推送不覆盖、只提示；手动「立即同步」可二选一（本机为准/云端为准）；历史版本在「🕘 云端备份」里回退。

---

## 常见问题（FAQ）

- **双击 start-muan.bat 提示找不到 Node**：按第一部分第 2 步装 Node.js 后重开 bat。
- **打不开 localhost**：看控制台窗口里 `MUAN_LISTENING=xxxx`，用那个端口访问 `http://localhost:xxxx/`。
- **手机 AI 对话报"未执行 v3 脚本"**：执行 `supabase-setup-v3.sql` 并填好 DeepSeek Key，且先登录云账号。
- **热点抓不到（学术前沿/小红书/文献雷达空）**：需电脑端 `start-muan.bat` 正在运行；微博/抖音/知乎在手机端也能直连。排查顺序见 skill 第 9 节。
- **换了浏览器/设备数据没了**：数据在各设备本地（电脑 app/data、手机 localStorage），跨设备请开启第三部分云同步。

## 抓取能力边界（一句话）

微博/抖音/知乎热点与 OpenAlex/Crossref 学术检索无需后端即可用；学术前沿、小红书热点与文献雷达"期刊最新"需电脑端服务在线。详见 `skills/muan-workbench/SKILL.md` 第 9 节。

## 给 AI 助手安装本 skill

把 `skills/muan-workbench/` 放入 agent 技能目录（如 `~/.workbuddy/skills/`），之后对 agent 说「帮我维护/部署木案工作台」即可获得架构地图、安全编辑法、双端回归与隐私红线指引。

## 隐私与安全

本仓库不含任何作者私有配置：`app/index.html` 的 `DEFAULT_CLOUD` 为空值并附填写指引；无真实 API Key、用户数据或个人路径。你的数据只存在于本机 `app/data/` 与（如启用）你自己的 Supabase 账号。请勿在任何前端配置里填写 `service_role`。

## License

MIT —— 见 `LICENSE`。
