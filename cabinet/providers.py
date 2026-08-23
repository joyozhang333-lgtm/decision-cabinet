"""LLM Provider 抽象层。

默认 DeepSeek（标准 HTTP，OpenAI 兼容 `/chat/completions`）；可切换 Claude
（官方 anthropic SDK）或其他 OpenAI-compatible 服务。

设计要点：
- `transport` 可注入 → 单元测试零网络。
- `complete()` 未配置时抛 ProviderConfigurationError，由上层做 fallback。
- `complete(stream_handler=...)` 支持流式；不支持流式的实现会退化为「整段输出后回调一次」。
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

JsonTransport = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]
StreamTransport = Callable[[str, dict[str, str], dict[str, Any], float], Iterator[str]]

DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro"
DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"


# --- 错误 ---------------------------------------------------------------

class ProviderError(RuntimeError):
    """外部 AI provider 调用失败基类。"""


class ProviderConfigurationError(ProviderError):
    """provider 未配置（缺 key / 缺依赖）。"""


class ProviderRequestError(ProviderError):
    """请求失败。"""


class ProviderResponseError(ProviderError):
    """响应无法解析。"""


# --- 统一返回 -----------------------------------------------------------

@dataclass(frozen=True)
class ProviderAnswer:
    content: str
    provider: str
    model: str | None
    raw_usage: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class LLMProvider(Protocol):
    name: str

    @property
    def configured(self) -> bool: ...

    @property
    def model(self) -> str | None: ...

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int = 2000,
        stream_handler: Callable[[str], None] | None = None,
    ) -> ProviderAnswer: ...


# --- DeepSeek（默认）----------------------------------------------------

@dataclass(frozen=True)
class DeepSeekConfig:
    api_key: str | None
    base_url: str = DEFAULT_DEEPSEEK_BASE_URL
    model: str = DEFAULT_DEEPSEEK_MODEL
    timeout_seconds: float = 90.0
    temperature: float = 0.5
    max_tokens: int = 2200

    @classmethod
    def from_env(cls) -> "DeepSeekConfig":
        env = _env_with_dotenv()
        return cls(
            api_key=_clean_secret(env.get("DEEPSEEK_API_KEY")),
            base_url=(env.get("DEEPSEEK_BASE_URL") or DEFAULT_DEEPSEEK_BASE_URL).rstrip("/"),
            model=env.get("DEEPSEEK_MODEL") or DEFAULT_DEEPSEEK_MODEL,
            timeout_seconds=_env_float(env, "DEEPSEEK_TIMEOUT_SECONDS", 90.0),
            temperature=_env_float(env, "DEEPSEEK_TEMPERATURE", 0.5),
            max_tokens=_env_int(env, "DEEPSEEK_MAX_TOKENS", 2200),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


class DeepSeekProvider:
    name = "deepseek"

    def __init__(
        self,
        config: DeepSeekConfig | None = None,
        transport: JsonTransport | None = None,
        stream_transport: StreamTransport | None = None,
    ) -> None:
        self.config = config or DeepSeekConfig.from_env()
        self._transport = transport or _post_json
        self._stream_transport = stream_transport or _post_sse_lines

    @property
    def configured(self) -> bool:
        return self.config.configured

    @property
    def model(self) -> str | None:
        return self.config.model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int = 2000,
        stream_handler: Callable[[str], None] | None = None,
    ) -> ProviderAnswer:
        if not self.config.configured or not self.config.api_key:
            raise ProviderConfigurationError("DeepSeek API key 未配置。")
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature if temperature is None else temperature,
            "max_tokens": max_tokens or self.config.max_tokens,
            "stream": stream_handler is not None,
        }
        headers = _auth_json_headers(self.config.api_key)
        url = f"{self.config.base_url}/chat/completions"
        if stream_handler is None:
            data = self._transport(url, headers, payload, self.config.timeout_seconds)
            return ProviderAnswer(
                content=_extract_chat_content(data),
                provider=self.name,
                model=self.config.model,
                raw_usage=data.get("usage") if isinstance(data.get("usage"), dict) else None,
            )
        chunks: list[str] = []
        for line in self._stream_transport(url, headers, payload, self.config.timeout_seconds):
            token = _parse_openai_sse_delta(line)
            if token:
                chunks.append(token)
                stream_handler(token)
        content = "".join(chunks).strip()
        if not content:
            raise ProviderResponseError("DeepSeek 流式响应为空。")
        return ProviderAnswer(content=content, provider=self.name, model=self.config.model)


# --- OpenAI 兼容（通义等，预留）-----------------------------------------

@dataclass(frozen=True)
class OpenAICompatConfig:
    api_key: str | None
    base_url: str | None
    model: str | None
    timeout_seconds: float = 90.0
    temperature: float = 0.5

    @classmethod
    def from_env(cls) -> "OpenAICompatConfig":
        env = _env_with_dotenv()
        base = env.get("CABINET_OPENAI_BASE_URL")
        return cls(
            api_key=_clean_secret(env.get("CABINET_OPENAI_API_KEY")),
            base_url=base.rstrip("/") if base else None,
            model=_clean_optional(env.get("CABINET_OPENAI_MODEL")),
            timeout_seconds=_env_float(env, "CABINET_OPENAI_TIMEOUT_SECONDS", 90.0),
            temperature=_env_float(env, "CABINET_OPENAI_TEMPERATURE", 0.5),
        )

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)


class OpenAICompatProvider:
    name = "openai_compat"

    def __init__(
        self,
        config: OpenAICompatConfig | None = None,
        transport: JsonTransport | None = None,
        stream_transport: StreamTransport | None = None,
    ) -> None:
        self.config = config or OpenAICompatConfig.from_env()
        self._transport = transport or _post_json
        self._stream_transport = stream_transport or _post_sse_lines

    @property
    def configured(self) -> bool:
        return self.config.configured

    @property
    def model(self) -> str | None:
        return self.config.model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int = 2000,
        stream_handler: Callable[[str], None] | None = None,
    ) -> ProviderAnswer:
        if not self.config.configured:
            raise ProviderConfigurationError("OpenAI 兼容 provider 未配置（需 base_url/api_key/model）。")
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature if temperature is None else temperature,
            "max_tokens": max_tokens,
            "stream": stream_handler is not None,
        }
        headers = _auth_json_headers(self.config.api_key or "")
        url = f"{self.config.base_url}/chat/completions"
        if stream_handler is None:
            data = self._transport(url, headers, payload, self.config.timeout_seconds)
            return ProviderAnswer(
                content=_extract_chat_content(data),
                provider=self.name,
                model=self.config.model,
                raw_usage=data.get("usage") if isinstance(data.get("usage"), dict) else None,
            )
        chunks: list[str] = []
        for line in self._stream_transport(url, headers, payload, self.config.timeout_seconds):
            token = _parse_openai_sse_delta(line)
            if token:
                chunks.append(token)
                stream_handler(token)
        return ProviderAnswer(content="".join(chunks).strip(), provider=self.name, model=self.config.model)


# --- Claude（可切换）---------------------------------------------------

@dataclass(frozen=True)
class ClaudeConfig:
    api_key: str | None
    model: str = DEFAULT_CLAUDE_MODEL
    timeout_seconds: float = 120.0
    temperature: float | None = None

    @classmethod
    def from_env(cls) -> "ClaudeConfig":
        env = _env_with_dotenv()
        return cls(
            api_key=_clean_secret(env.get("ANTHROPIC_API_KEY")),
            model=env.get("CABINET_CLAUDE_MODEL") or DEFAULT_CLAUDE_MODEL,
            timeout_seconds=_env_float(env, "CABINET_CLAUDE_TIMEOUT_SECONDS", 120.0),
            temperature=_env_optional_float(env, "CABINET_CLAUDE_TEMPERATURE"),
        )

    @property
    def configured(self) -> bool:
        # 需有 key 且能 import anthropic
        return bool(self.api_key) and _anthropic_available()


class ClaudeProvider:
    name = "claude"

    def __init__(self, config: ClaudeConfig | None = None, client: Any | None = None) -> None:
        self.config = config or ClaudeConfig.from_env()
        self._client = client  # 可注入（测试用 fake）

    @property
    def configured(self) -> bool:
        return self.config.configured or self._client is not None

    @property
    def model(self) -> str | None:
        return self.config.model

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not self.config.api_key:
            raise ProviderConfigurationError("ANTHROPIC_API_KEY 未配置。")
        try:
            import anthropic  # 延迟导入，未安装也不影响默认路径
        except ImportError as exc:  # pragma: no cover - 取决于环境
            raise ProviderConfigurationError(
                "未安装 anthropic SDK，请 `pip install '.[claude]'`。"
            ) from exc
        self._client = anthropic.Anthropic(api_key=self.config.api_key)
        return self._client

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int = 2000,
        stream_handler: Callable[[str], None] | None = None,
    ) -> ProviderAnswer:
        client = self._ensure_client()
        system_text = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
        convo = [m for m in messages if m.get("role") != "system"]
        kwargs: dict[str, Any] = {
            "model": self.config.model,
            "max_tokens": max_tokens,
            "messages": convo,
        }
        requested_temperature = self.config.temperature if temperature is None else temperature
        if requested_temperature is not None and _claude_allows_custom_temperature(self.config.model):
            kwargs["temperature"] = requested_temperature
        if system_text:
            kwargs["system"] = system_text
        try:
            if stream_handler is not None:
                chunks: list[str] = []
                with client.messages.stream(**kwargs) as stream:
                    for text in stream.text_stream:
                        chunks.append(text)
                        stream_handler(text)
                content = "".join(chunks).strip()
            else:
                message = client.messages.create(**kwargs)
                content = _extract_anthropic_text(message)
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 - 归一为 provider 错误供上层 fallback
            raise ProviderRequestError(f"Claude 请求失败：{exc}") from exc
        if not content:
            raise ProviderResponseError("Claude 响应未包含文本。")
        return ProviderAnswer(content=content, provider=self.name, model=self.config.model)


# --- 注册表 -------------------------------------------------------------

def default_provider_name() -> str:
    env = _env_with_dotenv()
    return (env.get("CABINET_DEFAULT_PROVIDER") or "deepseek").strip().lower()


def build_provider(name: str) -> LLMProvider:
    if name == "deepseek":
        return DeepSeekProvider()
    if name == "claude":
        return ClaudeProvider()
    if name in {"openai_compat", "openai", "tongyi", "qwen"}:
        return OpenAICompatProvider()
    raise ProviderConfigurationError(f"未知 provider：{name}")


def get_provider(name: str | None = None) -> LLMProvider:
    return build_provider(name or default_provider_name())


def provider_status() -> dict[str, Any]:
    deepseek = DeepSeekConfig.from_env()
    claude = ClaudeConfig.from_env()
    openai_compat = OpenAICompatConfig.from_env()
    return {
        "default": default_provider_name(),
        "providers": {
            "deepseek": {"configured": deepseek.configured, "model": deepseek.model},
            "claude": {
                "configured": claude.configured,
                "model": claude.model,
                "sdk_installed": _anthropic_available(),
            },
            "openai_compat": {
                "configured": openai_compat.configured,
                "model": openai_compat.model,
                "base_url": openai_compat.base_url,
            },
        },
    }


# --- HTTP / 解析 helpers -----------------------------------------

def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
    except HTTPError as exc:
        raise ProviderRequestError(f"Provider 返回 HTTP {exc.code}: {_safe_error_body(exc)}") from exc
    except URLError as exc:
        raise ProviderRequestError(f"Provider 请求失败：{exc.reason}") from exc
    except TimeoutError as exc:
        raise ProviderRequestError("Provider 请求超时。") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderResponseError("Provider 返回非 JSON 响应。") from exc
    if not isinstance(data, dict):
        raise ProviderResponseError("Provider 返回了非预期的 JSON 结构。")
    return data


def _post_sse_lines(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float) -> Iterator[str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sse_headers = {**headers, "Accept": "text/event-stream"}
    request = Request(url, data=body, headers=sse_headers, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            for raw in response:
                yield raw.decode("utf-8").rstrip("\n")
    except HTTPError as exc:
        raise ProviderRequestError(f"Provider 返回 HTTP {exc.code}: {_safe_error_body(exc)}") from exc
    except URLError as exc:
        raise ProviderRequestError(f"Provider 流式请求失败：{exc.reason}") from exc


def _parse_openai_sse_delta(line: str) -> str:
    """从一行 OpenAI 兼容 SSE 提取 delta.content。非数据行返回 ''。"""
    line = line.strip()
    if not line or not line.startswith("data:"):
        return ""
    data = line[len("data:"):].strip()
    if not data or data == "[DONE]":
        return ""
    try:
        obj = json.loads(data)
    except json.JSONDecodeError:
        return ""
    choices = obj.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
    if isinstance(delta, dict) and isinstance(delta.get("content"), str):
        return delta["content"]
    return ""


def _auth_json_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _extract_chat_content(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ProviderResponseError("响应未包含 choices。")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise ProviderResponseError("响应未包含 message。")
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        text = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ).strip()
        if text:
            return text
    raise ProviderResponseError("响应未包含回答内容。")


def _extract_anthropic_text(message: Any) -> str:
    content = getattr(message, "content", None)
    if isinstance(content, list):
        parts = []
        for block in content:
            text = getattr(block, "text", None)
            if text is None and isinstance(block, dict):
                text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts).strip()
    if isinstance(content, str):
        return content.strip()
    return ""


def _anthropic_available() -> bool:
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


# --- env / dotenv helpers ----------------------------------------------

def _env_with_dotenv() -> dict[str, str]:
    env = dict(os.environ)
    for path in _dotenv_candidates():
        if not path.exists():
            continue
        for key, value in _parse_dotenv(path).items():
            env.setdefault(key, value)
    return env


def _dotenv_candidates() -> tuple[Path, ...]:
    package_root = Path(__file__).resolve().parent.parent
    return (Path.cwd() / ".env", package_root / ".env")


def _parse_dotenv(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            parsed[key] = value
    return parsed


def _clean_secret(value: str | None) -> str | None:
    cleaned = _clean_optional(value)
    return cleaned if cleaned else None


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _env_float(env: dict[str, str], key: str, default: float) -> float:
    try:
        return float(env.get(key, default))
    except (TypeError, ValueError):
        return default


def _env_optional_float(env: dict[str, str], key: str) -> float | None:
    raw = env.get(key)
    if raw is None or not raw.strip():
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _claude_allows_custom_temperature(model: str) -> bool:
    """Opus 4.7+ 要求默认 temperature；其他模型仍可显式配置。"""
    normalized = model.lower()
    return not any(marker in normalized for marker in ("claude-opus-4-7", "claude-opus-4-8", "claude-opus-5"))


def _env_int(env: dict[str, str], key: str, default: int) -> int:
    try:
        return int(env.get(key, default))
    except (TypeError, ValueError):
        return default


def _safe_error_body(exc: HTTPError) -> str:
    try:
        return exc.read().decode("utf-8")[:500]
    except Exception:  # noqa: BLE001
        return ""
