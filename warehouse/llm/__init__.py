"""最小化 LLM 适配层（用于本项目的 AI 能力）。

当前仅提供一个“OpenAI 兼容接口”适配器，满足：
- chat(system_prompt, user_message) -> str

说明：
- provider 参数目前不参与分流，仅保留接口形态，便于后续扩展。
"""

from .openai_compatible import OpenAICompatibleLLM


def create_llm(provider_type: str, config: dict) -> OpenAICompatibleLLM:
    return OpenAICompatibleLLM(config)


__all__ = ["create_llm", "OpenAICompatibleLLM"]

