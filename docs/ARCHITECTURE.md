# 架构说明

## 组件

```text
web/ React + TypeScript
  ├── CouncilView：厘清 → 决策地图 → 多轮圆桌 → 拍板
  ├── KnowledgeView：知识检索、边界、来源
  ├── ChatView：单顾问连续讨论
  ├── DecisionsView：决策日志与复盘
  └── OrgMemoryView：长期目标、关系人、约束与讨论偏好

cabinet/ FastAPI + Python
  ├── decision_map.py：结构化决策地图与离线 fallback
  ├── knowledge.py：Markdown 加载、检索与 prompt 摘要
  ├── council.py：厘清、事实清单、多轮讨论、收束
  ├── advisors.py：顾问配置与经典白名单
  ├── providers.py：DeepSeek / Claude / OpenAI-compatible
  ├── store.py：SQLite 持久化
  └── web_api.py：HTTP / SSE / OpenAPI

cabinet/resources/knowledge/：方法卡
cabinet/resources/advisors/：顾问视角
cabinet/resources/canon/：可引用经典与方法白名单
```

## 数据流

1. API 读取用户的决策档案与最近决策。
2. `knowledge.search_knowledge` 根据问题做本地领域和关键词检索。
3. `decision_map.build_decision_map` 生成结构化 JSON；解析失败或无模型时返回明确的离线骨架。
4. 地图与相关知识作为 grounding 进入每一轮顾问提示，而不是只在 UI 展示。
5. 每位顾问看到历史发言与用户插话，按顺序形成真实交锋。
6. 主持人收束并创建决策草稿；用户自己填写最终选择与理由。
7. 决策写入 SQLite，后续复盘进入新的上下文。

## 设计选择

### 本地检索优先

默认不引入向量数据库，降低安装和隐私成本。当前检索使用领域提示、标签和中英文 token 评分。未来可增加可选 embedding adapter，但接口应保持兼容。

### Markdown 即知识

知识卡、顾问和经典都可在 Git diff 中审查，来源与边界不会藏在不可见数据库里。

### 离线不冒充智能

无 API key 或 provider 失败时，系统返回可用骨架与明确占位。它会告诉用户需要补什么，不会伪造一场“真实圆桌”。

### 金融数据不默认抓取

当前版本只提供证据框架和原始来源入口，不提供实时行情。未来接入外部数据时必须包含数据时间戳、来源、缓存状态、口径与失败降级，并将外部内容隔离为不可信输入。

## 扩展点

- `LLMProvider`：增加新的模型 provider。
- `cabinet/resources/knowledge/`：增加领域与知识卡。
- `cabinet/resources/advisors/`：增加非人物型专业顾问。
- `cabinet/resources/canon/`：增加经过校对的引用白名单。
- `CabinetStore`：未来可实现 PostgreSQL 或加密存储。
- 检索 adapter：未来可选 BM25、embedding 或混合检索。
