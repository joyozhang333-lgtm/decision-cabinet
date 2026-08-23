from __future__ import annotations

import os

# 测试期间模块级 app 用内存库，避免写出 cabinet.db
os.environ.setdefault("CABINET_DB_PATH", ":memory:")

from cabinet.providers import ProviderAnswer  # noqa: E402

FACTSHEET_TEXT = """## 已知事实
- 已有一个成熟区域市场和稳定现金流
## 关键假设
- 假设新市场的需求足以覆盖履约与获客成本
## 待查证的未知
- 新市场的复购率尚不清楚
## 证据缺口
- 缺少小规模履约与留存数据
"""

SYNTHESIS_TEXT = """## 实事求是·事实与依据
事实与假设如上，关键未知是转化率。
## 多元思维模型·各视角思辨
芒格主张先反过来想怎么会失败；德鲁克问顾客是谁。
## 对道的体会·古圣观照
老子说知止不殆，莫为增长而强为。
## 回到决策者·善心愿心与直觉
你进入新市场，是为了真实用户价值，还是证明扩张速度？
## 最恰当的决策与下一步
建议先在一个城市做可逆试点，记录履约成本、留存与复购，再决定是否扩张。
异见：增长顾问认为窗口期可能很短，试点需要设定时限。
"""


class FakeProvider:
    """根据 prompt 内容返回不同 canned 文本，覆盖 实事求是步/发散/收敛/单聊。"""

    name = "fake"

    def __init__(self, configured: bool = True, model: str = "fake-model") -> None:
        self._configured = configured
        self._model = model
        self.calls: list[list[dict[str, str]]] = []

    @property
    def configured(self) -> bool:
        return self._configured

    @property
    def model(self) -> str | None:
        return self._model

    def complete(self, messages, *, temperature=None, max_tokens=2000, stream_handler=None):
        self.calls.append(messages)
        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        if "分到四类" in user:
            text = FACTSHEET_TEXT
        elif "综合裁决" in user:
            text = SYNTHESIS_TEXT
        else:
            text = "我建议先小步验证，避免一次押太大。你真正想通过新市场为谁创造什么价值？"
        if stream_handler is not None:
            stream_handler(text)
        return ProviderAnswer(content=text, provider=self.name, model=self._model)
