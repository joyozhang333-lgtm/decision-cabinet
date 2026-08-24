# 决策内阁 · Decision Cabinet

[中文](README.md) · [English](README_EN.md)

[![CI](https://github.com/joyozhang333-lgtm/decision-cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/joyozhang333-lgtm/decision-cabinet/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/joyozhang333-lgtm/decision-cabinet/actions/workflows/pages.yml/badge.svg)](https://github.com/joyozhang333-lgtm/decision-cabinet/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-7c5c3e.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-5a6b54.svg)](pyproject.toml)

一个开源 AI 决策支持系统，也是一间可以持续对话的私人董事会。

它不替你预测命运或承诺收益，而是帮你从一个局部问题出发，逐步看清：

- 事实、假设、未知与证据缺口；
- 每个选择带来的所得、直接代价和机会成本；
- 二阶效应、不可逆承诺与停止条件；
- 相反力量如何消长、优势如何积累反作用；
- 局面在基准、上行、下行情景中如何演化；
- 最终什么只能由你自己决定。

> 核心原则：如实照见，实事求是。先看事实，再看选择与代价，最后看局势如何变化。

[在线 Demo](https://joyozhang333-lgtm.github.io/decision-cabinet/demo/) · [中文产品介绍](https://joyozhang333-lgtm.github.io/decision-cabinet/) · [English Overview](https://joyozhang333-lgtm.github.io/decision-cabinet/en/) · [快速开始](#快速开始) · [知识库治理](docs/KNOWLEDGE-GOVERNANCE.md) · [参与贡献](CONTRIBUTING.md)

![Decision Cabinet social preview](docs/social-preview.png)

## 立即体验

打开 [GitHub Pages 在线 Demo](https://joyozhang333-lgtm.github.io/decision-cabinet/demo/)，无需注册、无需 API Key。Demo 在浏览器内运行，内置 28 位方法视角顾问和 23 张可追溯知识卡；你可以完成厘清问题、决策地图、多轮圆桌、插话、收束、记录决策与复盘。

Demo 使用内置演示回应，不调用外部大模型。决策档案和日志只保存在当前浏览器的 localStorage。要接入 DeepSeek、Claude 或 OpenAI-compatible 模型，请按下方步骤运行完整开源版。

## 它适合什么决策

### 商业与经营

产品、定价、增长、现金流、资本配置、品牌、组织和团队。系统会把愿景拉回顾客价值、单位经济、承载力、风险与可逆试验。

### 金融与股票投资

基本面、三张表、估值区间、资产配置、仓位、流动性、周期和投资论点复盘。股票场景会强制要求：

- 标注数据时点与原始披露来源；
- 区分事实、公司指引、市场预期与个人推断；
- 写明估值假设、反证、仓位上限、退出条件；
- 把单个标的放回整个资产负债和资金期限中判断。

系统默认不接实时行情，也不会假装拥有实时数据。A 股应回到交易所或巨潮资讯，美股应回到 SEC EDGAR 等原始披露核验。

### 人生重要转折

职业、城市、关系、长期方向与责任冲突。它不会用一套价值观替你拍板，而会帮你看清：你在选择怎样的生活，又愿意承担什么代价。

## 一次完整讨论

```text
一个真实问题
  ↓
厘清处境：事实 / 数字 / 目标 / 恐惧 / 约束
  ↓
决策地图：选择 / 所得 / 代价 / 二阶效应 / 可逆性
  ↓
局势演化：基准 / 上行 / 下行 / 领先信号 / 应对
  ↓
相关知识检索：方法 + 边界 + 来源
  ↓
多轮私董会：允许用户插话、追问、挑战和修正
  ↓
主持人收束：保留异见，把决定权交回用户
  ↓
决策日志：记录理由、预期、停止条件并定期复盘
```

## 知识库

当前内置 23 张可追溯知识卡，覆盖五个域：

| 领域 | 内容示例 |
| --- | --- |
| 决策科学 | 决策质量、选择与代价、情景演化、阴阳循环 |
| 商业经营 | 顾客价值、单位经济、资本配置 |
| 金融投资 | 三张表、原始披露、估值、安全边际、组合风险、市场周期 |
| 管理学 | 有效性、激励与治理、小步试验、风险管理 |
| 传统与世界智慧 | 《易经》《道德经》《论语》《孙子兵法》、缘起中道、王阳明、《先知》 |

每张卡都是 `cabinet/resources/knowledge/` 下的独立 Markdown 文件，包含：适用问题、操作方法、边界、来源与标签。现代著作只做方法摘要，不复制受版权保护的全文；经典原文与现代解释分开。第三方姓名、短引文和摘要不纳入 MIT 再许可，详见 [Third-party content notice](THIRD_PARTY_CONTENT.md)。

## 顾问圆桌

顾问分为实事求是、商业战略、金融投资、管理增长、心理照见和古圣智慧等视角。人物型顾问是“方法与文本的交互界面”，不是对真实人物的授权代理或意见复刻。系统要求：

- 经典引用只能来自已校对白名单；
- 现代人物观点优先表述为方法摘要，不伪造逐字原话；
- 有价值的分歧必须保留，不能强行形成共识；
- 最终决定权始终属于用户。

## 快速开始

要求：Python 3.11+、Node.js 20.19+ 或 22.12+。

```bash
git clone https://github.com/joyozhang333-lgtm/decision-cabinet.git
cd decision-cabinet

python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

cp .env.example .env
chmod 600 .env
# 在 .env 填入 DEEPSEEK_API_KEY；也可配置 Claude 或 OpenAI-compatible API

uvicorn cabinet.web_api:app --reload
```

另开一个终端：

```bash
cd web
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。未配置模型时，知识库与离线决策骨架仍可运行；圆桌发言会明确显示为本地占位，不会伪装成模型结论。

### CLI

```bash
python scripts/run_council.py "公司是否应该现在进入一个新市场？"
python scripts/run_chat.py
```

## 模型与隐私

默认 provider 是 DeepSeek `deepseek-v4-pro`，也支持 Claude 和 OpenAI-compatible API：

```dotenv
CABINET_DEFAULT_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-pro

ANTHROPIC_API_KEY=
CABINET_CLAUDE_MODEL=claude-opus-4-8

CABINET_OPENAI_BASE_URL=
CABINET_OPENAI_API_KEY=
CABINET_OPENAI_MODEL=
```

本地数据默认存入 SQLite，`.env`、`*.db`、虚拟环境和前端构建产物都被 Git 忽略。请在提交前自行检查：

- 不要把 API key、真实交易记录、身份证明或私人对话提交到仓库；
- 使用外部模型时，本轮问题、回答、地图和对话会发送给对应 provider；
- 「决策档案」与最近已决/复盘记录默认不发送。只有用户在本轮勾选后，才会把使命、价值观、受影响者、业务/资产/责任主线、约束、标题、选择、理由和复盘结果发送给所选 provider；
- 对外 API 默认关闭，只有设置 `CABINET_EXTERNAL_API_KEY` 后才启用（仍兼容旧名 `CABINET_API_KEY`）；
- 私有 UI API 默认仅允许本机访问。若通过反向代理或局域网开放，必须设置 `CABINET_UI_API_KEY`；远程页面会显示密钥输入框，密钥仅保存在该浏览器的 localStorage。

## API

启动后访问 `http://127.0.0.1:8000/docs` 查看 OpenAPI 文档。主要接口：

| Endpoint | 用途 |
| --- | --- |
| `POST /api/decision/map` | 生成选择、代价与局势演化地图 |
| `GET /api/knowledge` | 浏览或搜索可追溯知识卡 |
| `POST /api/council/clarify` | 生成议事前厘清问题 |
| `POST /api/council/round` | 多轮圆桌，SSE 流式返回 |
| `POST /api/council/close` | 主持人收束并创建决策草稿 |
| `POST /api/advisors/{id}/chat` | 与单个顾问持续对话 |
| `GET /api/decisions` | 决策日志与复盘 |

## 架构

```text
React / TypeScript
      ↓
FastAPI ── 决策地图 ── 本地知识检索（Markdown）
   │           │
   │           └── 选择 / 代价 / 二阶效应 / 演化路径
   ├── 多轮圆桌编排 ── LLM Provider 抽象
   ├── 顾问与经典白名单（Markdown）
   └── SQLite：档案 / 会话 / 决策 / 复盘
```

更多细节见 [架构说明](docs/ARCHITECTURE.md) 与 [产品定义](docs/PRODUCT.md)。

## 开发与验证

```bash
pytest -q
cd web && npm ci && npm run build
```

复现无需后端的 GitHub Pages Demo：

```bash
python scripts/export_demo_data.py --output web/public/demo-data.json
cd web && npm run build:demo
```

CI 会对 Python 3.11/3.12 运行测试，并构建完整前端和静态 Demo。提交 PR 前请按 [CONTRIBUTING.md](CONTRIBUTING.md) 完成知识来源、隐私、金融边界、产品逻辑与回归检查。

## 重要声明

本项目仅用于教育、思考与决策支持，不构成投资建议、证券推荐、法律意见、医疗建议或税务建议，也不保证任何结果。AI 可能出错、遗漏或使用过时信息。重大决策请核验原始资料，并在需要时咨询持牌专业人士。

## License

[MIT](LICENSE) © Decision Cabinet contributors

完整英文介绍见 [README_EN.md](README_EN.md)。
