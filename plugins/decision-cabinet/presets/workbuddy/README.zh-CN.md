# 腾讯 WorkBuddy 自定义 Connector 接入

> 状态：这是配置指南，尚未在本机 WorkBuddy 企业环境完成端到端验证。

WorkBuddy 的正式接入面是自定义 **Streamable HTTP MCP Connector**。Decision Cabinet v0.4.0 同时提供默认本地 stdio 和内置 loopback Streamable HTTP；要接入 WorkBuddy，使用者需把 loopback 服务部署在自己控制的可达主机上，再在前面配置 HTTPS 与鉴权反向代理。

GitHub Pages Demo 是静态网站，不能作为 WorkBuddy 的 MCP Server URL。

## 准备远程 MCP 服务

1. 在服务端安装 Decision Cabinet，并确认默认 stdio 命令 `decision-cabinet-mcp` 可以启动。
2. 在同一台服务器上启动内置 loopback Streamable HTTP：

   ```bash
   decision-cabinet-mcp --transport streamable-http --host 127.0.0.1 --port 8765 --path /mcp
   ```

   内置服务只接受 loopback 绑定，并且没有公网鉴权。
3. 用你维护的反向代理将 `http://127.0.0.1:8765/mcp` 发布为 HTTPS endpoint，例如 `https://mcp.example.com/mcp`。转发到上游时把 `Host` 重写为 `127.0.0.1:8765`，并不要转发外部 `Origin`，以保留内置 DNS rebinding 防护。
4. 为反向代理启用 TLS、鉴权、访问日志、速率限制和最小权限网络策略。
5. 在向真实团队开放前，只用不含个人资料的合成问题验证五个只读工具：
   - `decision_cabinet_search_knowledge`
   - `decision_cabinet_offline_map`
   - `decision_cabinet_list_advisors`
   - `decision_cabinet_four_round_protocol`
   - `decision_cabinet_prepare_turn`

本仓库不替使用者部署远程 HTTPS/鉴权反向代理，也不提供公共 WorkBuddy endpoint。

## 在 WorkBuddy 管理后台配置

1. 进入 **Connector 管理**，新建自定义 Connector。
2. 设置英文标识，例如 `decision-cabinet`。WorkBuddy 保存后可能显示带 `enterprise_` 前缀的系统标识。
3. 选择与你的 gateway 一致的鉴权方式：MCP OAuth 2.1、OAuth 2.0 Authorization Code，或 API Key。
4. 在 **MCP Server URL** 中填写你部署的 HTTPS Streamable HTTP 地址。
5. 在凭证表单中填写由你签发的密钥或 OAuth 配置；不要把凭证写进本仓库、前端代码或 GitHub Issue。
6. 如管理后台支持工具权限筛选，只允许业务确实需要的上述只读工具，并设置合理超时。
7. 保存、启用 Connector，再用匿名合成问题做一次连接、工具调用和失败处理测试。

以下值都必须由使用者或企业管理员配置，仓库不会替你生成：

| 配置项 | 应填写的内容 |
| --- | --- |
| MCP Server URL | `<YOUR_HTTPS_STREAMABLE_HTTP_MCP_URL>` |
| 鉴权方式 | `<YOUR_GATEWAY_AUTH_SCHEME>` |
| OAuth / API Key 凭证 | 只在 WorkBuddy 的安全凭证表单中填写 |

## 安全边界

- 不要把 stdio 进程或内置 loopback HTTP 直接暴露到公网；内置服务会拒绝 `0.0.0.0`、局域网 IP 和公网主机名绑定。
- 对外的 `/mcp` 地址必须由使用者自建 HTTPS 与鉴权反向代理。
- 使用最小权限、短期凭证和密钥轮换；避免在日志中记录完整问题、商业机密或个人资料。
- Decision Cabinet 工具不会自动取得实时行情，也不会替用户作出投资、商业或人生决定。
- 外部模型与企业宿主的数据处理政策由使用者自行审查。
- 此配置未在本机 WorkBuddy 企业环境实测；上线前必须在自己的租户中完成安全与连接验收。

## 官方资料

- [腾讯 WorkBuddy 自定义 Connector](https://cloud.tencent.com/document/product/1831/134453)
- [腾讯 WorkBuddy 概览](https://cloud.tencent.com/document/product/1831/134525)
