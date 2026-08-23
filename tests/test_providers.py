from __future__ import annotations

import pytest

from cabinet.providers import (
    ClaudeConfig,
    ClaudeProvider,
    DeepSeekConfig,
    DeepSeekProvider,
    ProviderConfigurationError,
    provider_status,
)


def test_deepseek_requires_api_key() -> None:
    provider = DeepSeekProvider(config=DeepSeekConfig(api_key=None))
    assert provider.configured is False
    with pytest.raises(ProviderConfigurationError):
        provider.complete([{"role": "user", "content": "你好"}])


def test_deepseek_non_stream_posts_openai_compatible_payload() -> None:
    captured: dict[str, object] = {}

    def fake_transport(url, headers, payload, timeout):
        captured["url"] = url
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "基于事实回答。"}}], "usage": {"total_tokens": 9}}

    provider = DeepSeekProvider(
        config=DeepSeekConfig(api_key="k", base_url="https://api.deepseek.com", model="deepseek-v4-pro"),
        transport=fake_transport,
    )
    answer = provider.complete([{"role": "user", "content": "q"}])
    assert answer.content == "基于事实回答。"
    assert answer.provider == "deepseek"
    assert answer.model == "deepseek-v4-pro"
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["payload"]["stream"] is False  # type: ignore[index]


def test_deepseek_stream_accumulates_sse_deltas() -> None:
    def fake_stream(url, headers, payload, timeout):
        assert payload["stream"] is True
        yield 'data: {"choices":[{"delta":{"content":"你好"}}]}'
        yield 'data: {"choices":[{"delta":{"content":"世界"}}]}'
        yield "data: [DONE]"

    provider = DeepSeekProvider(config=DeepSeekConfig(api_key="k"), stream_transport=fake_stream)
    collected: list[str] = []
    answer = provider.complete([{"role": "user", "content": "hi"}], stream_handler=collected.append)
    assert answer.content == "你好世界"
    assert "".join(collected) == "你好世界"


def test_claude_provider_with_injected_client_extracts_text_and_system() -> None:
    captured: dict[str, object] = {}

    class FakeBlock:
        type = "text"
        text = "claude 的回答"

    class FakeMessage:
        content = [FakeBlock()]

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeMessage()

    class FakeClient:
        messages = FakeMessages()

    provider = ClaudeProvider(config=ClaudeConfig(api_key="k", model="claude-opus-4-8"), client=FakeClient())
    assert provider.configured is True
    answer = provider.complete(
        [{"role": "system", "content": "你是顾问"}, {"role": "user", "content": "q"}]
    )
    assert answer.content == "claude 的回答"
    assert answer.provider == "claude"
    assert captured["system"] == "你是顾问"  # system 被提到顶层
    assert all(m["role"] != "system" for m in captured["messages"])  # type: ignore[index]
    assert "temperature" not in captured  # Opus 4.8 只接受默认 temperature


def test_claude_older_model_can_receive_explicit_temperature() -> None:
    captured: dict[str, object] = {}

    class FakeBlock:
        type = "text"
        text = "ok"

    class FakeMessage:
        content = [FakeBlock()]

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeMessage()

    class FakeClient:
        messages = FakeMessages()

    provider = ClaudeProvider(
        config=ClaudeConfig(api_key="k", model="claude-3-5-sonnet", temperature=0.4),
        client=FakeClient(),
    )
    provider.complete([{"role": "user", "content": "q"}])
    assert captured["temperature"] == 0.4


def test_claude_stream_with_injected_client() -> None:
    class FakeStream:
        text_stream = ["第一段", "第二段"]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get_final_message(self):
            return None

    class FakeMessages:
        def stream(self, **kwargs):
            return FakeStream()

    class FakeClient:
        messages = FakeMessages()

    provider = ClaudeProvider(config=ClaudeConfig(api_key="k"), client=FakeClient())
    collected: list[str] = []
    answer = provider.complete([{"role": "user", "content": "q"}], stream_handler=collected.append)
    assert answer.content == "第一段第二段"
    assert collected == ["第一段", "第二段"]


def test_provider_status_shape() -> None:
    status = provider_status()
    assert "default" in status
    assert set(status["providers"]) == {"deepseek", "claude", "openai_compat"}
