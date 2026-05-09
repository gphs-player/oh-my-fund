import json
from typing import ClassVar
from urllib import error, request


class BaseLLM:
    """LLM 基类"""

    provider_type: ClassVar[str] = ""
    provider_label: ClassVar[str] = ""
    default_model: ClassVar[str] = ""
    default_base_url: ClassVar[str] = ""

    REQUEST_TIMEOUT: ClassVar[int] = 60

    def __init__(self, config: dict):
        self.config = config
        self.api_key = str(config.get("api_key") or "").strip()
        self.model = str(config.get("model") or "").strip()
        self.base_url = str(config.get("base_url") or "").strip()

    def chat(self, system_prompt: str, user_message: str) -> str:
        raise NotImplementedError("子类必须实现 chat 方法")

    def list_models(self) -> list[str]:
        """从提供商拉取可用模型 id 列表（需子类实现）"""
        raise NotImplementedError("子类必须实现 list_models 方法")

    def _http_get_json(self, url: str, headers: dict) -> dict:
        req = request.Request(url, headers=headers, method="GET")
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"LLM 接口请求失败，HTTP {status_code}")
                return json.loads(response.read().decode("utf-8"))
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

    def _http_post_json(self, url: str, headers: dict, body: dict) -> dict:
        data = json.dumps(body).encode("utf-8")
        req = request.Request(url, data=data, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"LLM 接口请求失败，HTTP {status_code}")
                return json.loads(response.read().decode("utf-8"))
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
