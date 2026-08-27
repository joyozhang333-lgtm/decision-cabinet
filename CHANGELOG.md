# Changelog

## 0.4.0 — 2026-08-27

- 私董会改为固定四轮议事：事实定界、聚焦争议、压力测试与条件式收束，不再把多位顾问的独立回答拼成讨论。
- 每轮新增公开议程、顾问回应对象与立场、各方观点、小结论、共识、非共识、给用户的问题和下一轮焦点。
- 用户可以在轮次之间回答委员会、补充事实、指定争议或选择旁听；没有新增信息时，下一轮仍从既有分歧继续推进。
- 新增同一顾问历史发言的反重复检查：先带新颖性约束重试，仍重复则本轮明确弃权。
- 重做私董会界面：四轮进度、按轮对话、回应链和议事纪要并列呈现；新增智能体接入中心。
- 新增默认只读、无状态的 MCP server，以及 Codex、Claude Code、DeepSeek Harness、Hugging Face Tiny Agents 和 ML Claw/OpenClaw 的 plugin 或配置入口。
- 明确接入成熟度与边界：DeepSeek Harness 仍属 developer preview；Tiny Agents 与 ML Claw/OpenClaw 分开接入；WorkBuddy 与 CodeBuddy 不同，且远程 Connector 仍需 HTTPS 与鉴权，GitHub Pages Demo 不是远程后端。
- 在线 Demo 改为标签页级 `sessionStorage`，清理旧版 origin-wide Demo 键并提供一键清除，避免 GitHub Pages 同源项目读取长期留存的演示输入。
- 加固本地私有 API：同时校验 loopback 或显式配置的 Host、精确 Origin 与远程访问密钥，阻断 DNS rebinding；顾问资源 ID 也只允许读取打包白名单。
- 统一顾问发言、逐轮纪要、请求与模型上下文预算；新增 16 位顾问连续四轮极限回归，保证一轮成功输出可以继续进入后续轮次和最终收束。
- 新增前端状态机、Demo 隐私、MCP stdio/HTTP 握手与恶意路径/来源回归测试；CI 会运行 Python、Vitest、完整前端与静态 Demo 构建。
- 更新中英文 README、产品页、产品定义、架构说明和接入指南，并保留原有隐私、金融风险与最终决定权声明。

## 0.3.0 — 2026-08-25

- 新增无需密钥的浏览器在线 Demo，覆盖决策澄清、事实表、决策地图、多轮私董会、决策日志、知识库与组织记忆。
- Demo 内置 28 位顾问和 23 张可追溯知识卡；个人输入仅保存在当前浏览器，不上传服务器。
- 股票与投资演示明确标注数据时点、原始来源、仓位纪律、反证与停止条件，不提供实时行情或买卖建议。
- 新增完整英文 README 与英文 GitHub Pages 产品介绍，并用独立 URL、canonical 和 hreflang 建立双语 SEO。
- 新增 Demo 页面 Open Graph、Twitter Card、`SoftwareApplication` 结构化数据与 sitemap 收录。
- GitHub Pages 工作流自动导出公开数据、构建 Demo 并与中英文产品页一起发布。

## 0.2.0 — 2026-08-23

- 新增“决策地图”：选择、所得、直接代价、机会成本、风险、二阶效应与可逆性。
- 新增基准/上行/下行演化路径、触发条件、领先信号与停止条件。
- 新增 23 张可追溯知识卡，覆盖决策科学、商业、金融、管理和传统智慧。
- 新增金融投资强制边界：数据时点、原始披露、估值假设、组合风险与反证。
- 新增投资研究顾问与宏观经济顾问。
- 新增知识地图 UI、搜索、领域筛选与来源链接。
- 默认档案与示例改为中性匿名内容。
- 新增 CI、GitHub Pages、SEO 落地页、贡献指南、安全策略与引用信息。

## 0.1.0

- 多顾问圆桌、单聊、决策日志、组织记忆、SQLite 和 LLM provider 抽象。
