from .base import BaseLLM
from .factory import register_llm


@register_llm
class DeepSeekLLM(BaseLLM):
    """DeepSeek API (OpenAI 兼容格式)"""

    provider_type = "deepseek"
    provider_label = "DeepSeek"

    DEFAULT_BASE_URL = "https://api.deepseek.com"
    DEFAULT_MODEL = "deepseek-chat"

    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_MODEL

    def list_models(self) -> list[str]:
        if not self.api_key:
            raise ValueError("DeepSeek API Key 未配置")
        base = self.base_url or self.DEFAULT_BASE_URL
        url = f"{base.rstrip('/')}/v1/models"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        resp = self._http_get_json(url, headers)
        data = resp.get("data") or []
        return [m["id"] for m in data if m.get("id")]

    def chat(self, system_prompt: str, user_message: str) -> str:
        if not self.api_key:
            raise ValueError("DeepSeek API Key 未配置")

        base = self.base_url or self.DEFAULT_BASE_URL
        url = f"{base.rstrip('/')}/v1/chat/completions"
        model = self.model or self.DEFAULT_MODEL

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": 0.3,
        }

        resp = self._http_post_json(url, headers, body)
        choices = resp.get("choices") or []
        if not choices:
            raise RuntimeError("DeepSeek 返回空内容")
        return str(choices[0].get("message", {}).get("content", ""))
