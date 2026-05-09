from __future__ import annotations

import json
from urllib import error, request


class OpenAICompatibleLLM:
    """OpenAI 兼容 Chat Completions 接口适配器。

    约定：
    - base_url 默认为 https://api.openai.com/v1
    - 使用 /chat/completions
    """

    REQUEST_TIMEOUT = 60

    def __init__(self, config: dict):
        self.api_key = str(config.get("api_key") or "").strip()
        self.model = str(config.get("model") or "").strip()
        self.base_url = str(config.get("base_url") or "").strip()

        if not self.base_url:
            self.base_url = "https://api.openai.com/v1"
        self.base_url = self.base_url.rstrip("/")

    def chat(self, system_prompt: str, user_message: str) -> str:
        if not self.api_key:
            raise RuntimeError("缺少 API Key")

        model = self.model or "gpt-4o-mini"
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": str(system_prompt or "")},
                {"role": "user", "content": str(user_message or "")},
            ],
            "temperature": 0.2,
        }

        data = json.dumps(body).encode("utf-8")
        req = request.Request(url, data=data, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as resp:
                status = getattr(resp, "status", resp.getcode())
                raw = resp.read().decode("utf-8", errors="replace")
                if status != 200:
                    raise RuntimeError(f"LLM 接口请求失败，HTTP {status}: {raw[:500]}")
                payload = json.loads(raw)
        except error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            raise RuntimeError(f"LLM 接口请求失败，HTTP {exc.code}: {err_body}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"LLM 接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("LLM 接口请求超时") from exc

        try:
            return str(payload["choices"][0]["message"]["content"] or "")
        except Exception as exc:
            raise RuntimeError("LLM 返回结构异常") from exc

