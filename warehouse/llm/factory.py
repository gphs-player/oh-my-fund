from typing import Type

from .base import BaseLLM

LLM_CLASSES: dict[str, Type[BaseLLM]] = {}


def register_llm(cls: Type[BaseLLM]) -> Type[BaseLLM]:
    LLM_CLASSES[cls.provider_type] = cls
    return cls


def create_llm(provider_type: str, config: dict) -> BaseLLM:
    cls = LLM_CLASSES.get(provider_type)
    if cls is None:
        raise ValueError(f"未知的 LLM 类型: {provider_type}，可用: {list(LLM_CLASSES.keys())}")
    return cls(config)


def get_available_llm_types() -> list[dict]:
    return [
        {
            "type": cls.provider_type,
            "label": cls.provider_label,
            "default_model": cls.default_model,
            "default_base_url": cls.default_base_url,
        }
        for cls in LLM_CLASSES.values()
    ]


from . import claude, deepseek, openai_adapter  # noqa: E402, F401
