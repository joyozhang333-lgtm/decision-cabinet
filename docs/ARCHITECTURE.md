# 架构说明

## 组件

```text
web/ React + TypeScript
  ├── CouncilView：厘清 → 决策地图 → 四轮议事 → 用户参与 → 拍板
  ├── IntegrationsView：MCP 宿主、接入状态与边界
  ├── KnowledgeView：知识检索、边界、来源
  ├── ChatView：单顾问连续讨论
  ├── DecisionsView：决策日志与复盘
  └── OrgMemoryView：长期目标、关系人、约束与讨论偏好

cabinet/ FastAPI + Python
  ├── decision_map.py：结构化决策地图与离线 fallback
  ├── knowledge.py：Markdown 加载、检索与 prompt 摘要
  ├── council.py：厘清、公开议程、回应链、反重复、逐轮纪要与收束
  ├── mcp_server.py：默认只读、无状态的 stdio / loopback Streamable HTTP MCP 工具
  ├── advisors.py：顾问配置与经典白名单
  ├── providers.py：DeepSeek / Claude / OpenAI-compatible
  ├── store.py：SQLite 持久化
  └── web_api.py：HTTP / SSE / OpenAPI

cabinet/resources/knowledge/：方法卡
cabinet/resources/advisors/：顾问视角
cabinet/resources/canon/：可引用经典与方法白名单

plugins/decision-cabinet/：Codex / Claude Code plugin、MCP 配置、skill 与宿主预设

scripts/export_demo_data.py：只导出公开字段，供 GitHub Pages Demo 使用
```

## 数据流

1. API 读取用户的决策档案与最近决策。
2. `knowledge.search_knowledge` 根据问题做本地领域和关键词检索。
3. `decision_map.build_decision_map` 生成结构化 JSON；解析失败或无模型时返回明确的离线骨架。
4. 地图与相关知识作为 grounding 进入每一轮顾问提示，而不是只在 UI 展示。
5. `build_round_agenda` 根据固定轮次职责、上一轮纪要和用户参与方式生成公开议题。
6. `run_round` 轮换开场顾问并按序生成发言。每位顾问都能看到同轮此前发言，并记录 `reply_to`、`stance` 与 `novelty`。
7. 同一顾问的高相似发言会重试一次；仍重复则以 `abstain` 收束，不把复述当进展。
8. `build_round_summary` 在每轮结束后输出各方观点、小结论、共识、非共识、给用户的问题和下一轮焦点。
9. 前端通过 SSE 依次接收 `agenda`、`turn`、`round_summary` 和 `done`。用户以 `answer`、`add`、`focus` 或 `listen` 进入下一轮。
10. 主持人消费完整发言与逐轮纪要后收束并创建决策草稿；用户自己填写最终选择与理由。
11. 决策写入 SQLite，后续复盘进入新的上下文。

服务端对顾问单次发言、纪要字段、累计请求和传给模型的逐字上下文分别设定上限。较早逐字稿超过模型预算时，由结构化纪要保留其共识、非共识与下一轮焦点；最近发言仍按时间顺序进入上下文。这样既避免异常长输出无限放大调用成本，也保证一轮成功返回的 16 位顾问记录能继续进入后续四轮与最终收束。

## 四轮议事状态

```text
RoundRequest
  ├── transcript[]
  ├── summaries[]
  └── participation { mode, content }
          ↓
RoundAgenda
          ↓
DialogueEntry[]  ── reply_to / stance / novelty
          ↓
RoundSummary     ── positions / provisional / consensus / dissents
          ↓
用户参与或进入下一轮，第四轮后由主持人收束
```

固定四轮的目的不是制造流程感，而是防止模型在没有新信息时退化成四次相似回答。上一轮纪要是下一轮议程的显式输入，用户指定的争议或新增事实也会进入议程。

## GitHub Pages 在线 Demo

在线 Demo 复用同一套 React 界面，但不运行 FastAPI，也不连接外部模型。构建时，`scripts/export_demo_data.py` 从仓库资源导出顾问和知识卡的公开字段；`web/src/demoApi.ts` 在浏览器内提供与现有前端兼容的只读目录、决策地图、四轮议事、单聊、决策日志和档案接口。演示数据同样展示回应目标、立场和逐轮纪要，但它是确定性教学回应，不等同于外部模型实时讨论。

用户输入、决策日志和档案只写入当前标签页的 `sessionStorage`，关闭标签页即清除；界面同时提供一键清除，并在加载时删除旧版 Demo 遗留的 origin-wide `localStorage` 键。Demo 不导出顾问内部约束或经典正文，不提供实时金融数据，并在界面中持续标明它使用内置演示回应。GitHub Pages workflow 会把中英文产品页发布到根目录，把静态应用发布到 `/demo/`。

## 设计选择

### 本地检索优先

默认不引入向量数据库，降低安装和隐私成本。当前检索使用领域提示、标签和中英文 token 评分。未来可增加可选 embedding adapter，但接口应保持兼容。

### Markdown 即知识

知识卡、顾问和经典都可在 Git diff 中审查，来源与边界不会藏在不可见数据库里。

### 离线不冒充智能

无 API key 或 provider 失败时，系统返回可用骨架与明确占位。它会告诉用户需要补什么，不会伪造一场“真实圆桌”。

### 先约束议事，再调用模型

四轮职责、议程字段、回应关系和纪要结构由代码定义，不依赖模型临场自觉。模型生成的是每一条发言和纪要文本；轮次边界、顺序、反重复检查与缺省输出由应用控制。

### MCP 默认只读、无状态

`cabinet.mcp_server` 只暴露本地知识检索、离线地图、公开顾问目录、四轮协议与发言 brief。它不写 SQLite，不保存宿主提供的上下文，不抓实时行情，也不授予 Shell 或文件写权限。默认 transport 是 stdio；也可启动带 DNS-rebinding 防护的 loopback Streamable HTTP。内置 HTTP 不含公网鉴权并拒绝非 loopback 绑定，因此腾讯 WorkBuddy 一类远程宿主仍需由使用者在前面部署 HTTPS、鉴权、限流与访问日志反向代理。GitHub Pages 不能代替后端。

### 金融数据不默认抓取

当前版本只提供证据框架和原始来源入口，不提供实时行情。未来接入外部数据时必须包含数据时间戳、来源、缓存状态、口径与失败降级，并将外部内容隔离为不可信输入。

## 扩展点

- `LLMProvider`：增加新的模型 provider。
- MCP host 配置：在不改变核心 server 的前提下增加 Codex、Claude Code、DeepSeek Harness、Tiny Agents 或企业 Connector 预设。
- `cabinet/resources/knowledge/`：增加领域与知识卡。
- `cabinet/resources/advisors/`：增加非人物型专业顾问。
- `cabinet/resources/canon/`：增加经过校对的引用白名单。
- `CabinetStore`：未来可实现 PostgreSQL 或加密存储。
- 检索 adapter：未来可选 BM25、embedding 或混合检索。
