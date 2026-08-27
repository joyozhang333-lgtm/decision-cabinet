# SEO 与开源传播清单

已完成：

- GitHub 仓库名、描述、homepage 与中英文关键词；
- README 标题层级、使用场景、架构、FAQ 式语义内容；
- GitHub Topics：decision-support、ai、investment、management、scenario-planning 等；
- GitHub Pages 中英文静态产品页与可交互 Demo；
- 中英文 README 和产品页自然覆盖“四轮 AI 私董会、顾问观点交锋、MCP server、Codex plugin、Claude Code、DeepSeek Harness、Hugging Face Tiny Agents、腾讯 WorkBuddy”等真实能力与边界；
- 中英文智能体接入指南均可从 README 到达，并链接对应平台的官方资料；
- 唯一 title、meta description、Open Graph、Twitter Card；
- `SoftwareApplication` JSON-LD；
- 中英文独立 URL、canonical、hreflang、`robots.txt`、`sitemap.xml`；
- 语义化 HTML、可读正文、移动端布局；
- 开源治理文件、CITATION、安全策略与 CI badges。
- GitHub 仓库 description 已更新为中英双语四轮私董会与 MCP 定位；Topics 控制在 20 项，并加入 `ai-agents`、`mcp`、`advisory-board` 与 `multi-agent-systems`。

发布后验证：

1. GitHub Actions 的 Pages workflow 成功；
2. 中文页、英文页和在线 Demo 均返回 200 并能互相到达；
3. canonical、hreflang、robots、sitemap URL 与线上一致；
4. 用 Google Rich Results Test 验证 JSON-LD；
5. 在 Google Search Console 添加 property 并提交 sitemap；
6. 登录 GitHub Settings 后上传仓库内已准备的 `docs/social-preview.png`（1280×640、低于 1 MB）；当前 GraphQL 的 `usesCustomOpenGraphImage` 仍为 `false`；
7. 版本发布时写清面向用户的变化，不堆关键词。
8. 搜索结果与 README 必须明确：Pages Demo 是静态教学演示，不是远程 MCP 后端；DeepSeek Harness 未完成本机 CLI 端到端验证；Tiny Agents 与 ML Claw/OpenClaw 是两个接入面；WorkBuddy 不等于 CodeBuddy。

SEO 不能保证排名。产品价值、清晰文本、真实链接和持续更新比关键词堆砌更重要。
