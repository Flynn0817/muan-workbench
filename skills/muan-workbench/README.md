# muan-workbench

木案 · 个人工作台（单文件 PWA，双端：电脑本地服务 + 手机云托管）的 AI 维护手册与验证流程 —— WorkBuddy/Agent skill。

## 这是什么

一份给 AI 助手（agent）使用的可执行维护手册。当用户说「改一下木案工作台 / 处理 muan 的同步问题 / 部署发布」时，加载本 skill 即可按规范完成修改与验证，避免每次从零摸索：

- **双端架构地图**：电脑端（本地 server.js + 磁盘库）与手机端（静态托管 PWA）如何共用同一份单文件代码
- **Supabase 两端同步机制**：`muan_state` 单行 JSON 中枢、rev 乐观锁、顶层模块 last-write-wins 合并、冲突人工二选一
- **手机端 AI 通道**：数据库 RPC + pg_net 实现，LLM 密钥存数据库 Secret
- **安全编辑铁律**：CRLF 单文件的安全批量改法
- **五步验证法**：语法 → 动作覆盖审计 → 资源同步 → 部署 → 双端视口回归
- **隐私与数据红线**：什么内容不允许写入文档与分享物

## 安装

将本目录放入 agent 的用户级技能目录（Windows 示例）：

```
C:\Users\<你的用户名>\.workbuddy\skills\muan-workbench\
```

或放入项目级技能目录 `.workbuddy/skills/muan-workbench/`。

安装后，直接对 agent 说「帮我配置木案工作台」「双端怎么同步」等，即可获得从零到双端可用的完整引导（见 SKILL.md 第 8 节）。

## 文件结构

```
muan-workbench/
├── SKILL.md                # skill 主体（含终端用户自部署指南 §8）
├── README.md               # 本说明
├── LICENSE                 # MIT 许可证
└── references/             # 用户自建 Supabase 时需执行的 SQL（均无敏感信息）
    ├── supabase-setup.sql    # 云同步建表（muan_state + RLS）—— 必须执行
    ├── supabase-setup-v2.sql # 历史版本 —— 无需执行
    └── supabase-setup-v3.sql # 手机端 AI 通道（需启用 pg_net + 填入自己的 DeepSeek Key）
```

## 快速开始（面向终端用户）

完整分 OS 的**详细安装手册**（电脑端 Windows/macOS/Linux、手机端 iPhone/安卓、一键启动脚本 `start-muan.bat` / `.sh`、可选电脑桌面应用）见仓库顶层 `README.md` 的「📖 安装手册」章节。

> 若本 skill 单独分发（不在 muan-workbench 仓库内），电脑端/手机端的分步安装文字以 `SKILL.md` 第 8 节为准，把 `<repo>` 替换为实际源码目录即可。

1. **电脑端**：`node server.js` → 打开 `http://localhost:8765`
2. **手机端**：把 `site/` 发布到 HTTPS 静态托管 → 手机访问并「添加到主屏幕」
3. **双端同步**：新建 Supabase 项目 → SQL Editor 执行 `references/supabase-setup.sql`（可选再执行 v3 开 AI）→ 各设备在「我的 → 数据与同步」填 Project URL + Publishable Key → 登录同一账号
4. 详细分步与报错速查见 `SKILL.md` 第 8 节。

## 抓取能力（时事热点 / 学术文献）一句话说明

- **无需后端即可用**：微博/抖音/知乎热点（直连聚合源）、OpenAlex/Crossref 学术检索。
- **需要电脑端跑 `node server.js`**：学术前沿与小红书热点、文献雷达的期刊最新文章（后者仅本机 localhost 可用）。
- 排查顺序与未来改造方向见 `SKILL.md` 第 9 节（抓取失效先查“server 是否在跑 / 网络是否可达 / 是否用错端”）。

## 隐私与安全声明

本仓库是**通用维护手册**，不含任何用户私有数据：

- 不含具体用户的 Supabase 项目 URL / 密钥
- 不含业务数据（待办、财务、文献、个人资料等）样例
- 不含个人身份与机器路径（路径一律使用 `<project-root>` 占位符）
- 手册内明确要求：示例一律使用占位符；真实凭据仅存本机；发布/分享前须清空硬编码默认值

## License

MIT © 木案工作台
