# 木案 · 个人工作台（开源版）

一个**单文件驱动的个人工作台**：待办 / 时间规划 / 课程 / 运动 / 学习目标 / 科研文献 / 收支 / 热点 / AI 对话 / 成就激励，电脑与手机双端共用一份代码，可选 Supabase 云同步两端互通。

仓库结构：

```
muan-workbench/
├── app/                     # 工作台本体（可直接运行 & 直接作为手机端静态站点发布）
│   ├── index.html           # 单文件应用（CSS+HTML+JS 全内联，CRLF）
│   ├── server.js            # 电脑端本地服务（端口 8765，AI 代理 + 磁盘数据）
│   ├── sw.js                # 离线壳（改 index/sw 后请把 SW_VER 版本号 +1）
│   ├── manifest.webmanifest # PWA 清单
│   └── icon-*.png / icon-*.svg / apple-touch-icon.png
├── skills/muan-workbench/   # AI 维护 skill（含终端用户自部署指南）
│   └── references/          # Supabase 建表 SQL（云同步 / 手机 AI 通道）
└── LICENSE
```

## 1:1 安装 · 电脑端

```bash
git clone <本仓库>
cd muan-workbench/app
node server.js        # 需要 Node.js ≥ 18
```

浏览器打开 `http://localhost:8765`。数据自动存本机 `app/data/muan.db.json`。AI 对话首次使用：对话页右上角「模型」填你自己的 API Key 与 Base URL（示例 `https://api.deepseek.com`），密钥只存本机，不随页面/云端走。

> 同一 WiFi 下，手机浏览器访问 `http://<电脑局域网IP>:8765` 也可临时使用；长期跨网请走云同步 + PWA（见下）。

## 1:1 安装 · 手机端（PWA）

1. 把 `app/` 目录整体发布到任意 HTTPS 静态托管（CloudStudio / Netlify / GitHub Pages 等）——`app/` 已含全部离线所需资源。
2. 手机浏览器打开线上地址：
   - 安卓：浏览器菜单 →「安装应用」；
   - iPhone：Safari 分享 →「添加到主屏幕」。
3. 从桌面图标进入即全屏独立 App；断网也能打开已缓存页面。

> 发布前建议把 `app/index.html` 顶部 `DEFAULT_CLOUD` 填成**你自己的** Supabase 项目 URL 与 anon Key（见下节），可省去每台设备手填。

## 双端同步（可选，推荐）

1. 到 supabase.com 注册并新建项目；
2. 打开该项目 → **SQL Editor**，依次执行 `skills/muan-workbench/references/` 中的脚本：
   - `supabase-setup.sql` —— 建同步表 `muan_state` + RLS（必须）；
   - `supabase-setup-v3.sql` —— 手机端 AI 通道（可选）：先到 Database → Extensions 启用 `pg_net`，并把脚本头部 DeepSeek API Key 占位符换成你自己的；
3. 每台设备在应用内「我的 → 数据与同步」→ 粘贴 **Project URL** 与 **Publishable(anon) Key** → 保存 → 测试连接 → 注册/登录**同一账号** → 保持自动同步开。
4. 冲突策略：两端同时改同一模块时自动推送不覆盖、只提示；手动「立即同步」可二选一（本机为准/云端为准）；历史版本在「🕘 云端备份」回退。

## 抓取能力边界

- **无需后端即用**：微博/抖音/知乎热点（直连公开聚合源）、OpenAlex / Crossref 学术检索。
- **需电脑端跑 `node server.js`**：学术前沿与小红书热点、文献雷达“期刊最新文章”。
- 排查顺序见 `skills/muan-workbench/SKILL.md` 第 9 节。

## 给 AI 助手安装本 skill

把 `skills/muan-workbench/` 放入 agent 的用户级技能目录（如 `~/.workbuddy/skills/`），之后说「帮我维护/部署木案工作台」即可按手册执行（架构地图、CRLF 安全编辑、五步验证、隐私红线都在其中）。

## 隐私与安全

- 本仓库**不含任何作者私有配置**：`DEFAULT_CLOUD` 为空值并附填写指引；不含真实 API Key、用户数据或个人路径。
- 你的数据只存在：本机 `app/data/`（电脑）＋你自己的 Supabase 账号（如启用）。
- 供图/抓取仅做标题与链接跳转展示，数据归各平台所有。
- 请勿把 `service_role` 密钥填入任何前端配置。

## License

MIT —— 见 `LICENSE`。
