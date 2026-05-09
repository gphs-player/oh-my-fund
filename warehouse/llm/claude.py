from .base import BaseLLM
from .factory import register_llm


@register_llm
class ClaudeLLM(BaseLLM):
    """Anthropic Claude API"""

    provider_type = "claude"
    provider_label = "Claude (Anthropic)"

    DEFAULT_BASE_URL = "https://api.anthropic.com"
    DEFAULT_MODEL = "claude-sonnet-4-5-20250929"

    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_MODEL

    def list_models(self) -> list[str]:
        if not self.api_key:
            raise ValueError("Claude API Key 未配置")
        base = self.base_url or self.DEFAULT_BASE_URL
        url = f"{base.rstrip('/')}/v1/models"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }
        resp = self._http_get_json(url, headers)
        data = resp.get("data") or []
        return [m["id"] for m in data if m.get("id")]

    def chat(self, system_prompt: str, user_message: str) -> str:
        if not self.api_key:
            raise ValueError("Claude API Key 未配置")

        base = self.base_url or self.DEFAULT_BASE_URL
        url = f"{base.rstrip('/')}/v1/messages"
        model = self.model or self.DEFAULT_MODEL

        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }
        body = {
            "model": model,
            "max_tokens": 2048,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_message}],
        }

        resp = self._http_post_json(url, headers, body)
        content = resp.get("content") or []
        if not content:
            raise RuntimeError("Claude 返回空内容")
        return str(content[0].get("text", ""))
