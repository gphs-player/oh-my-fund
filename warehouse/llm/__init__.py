"""LLM 适配层。

对外导出：
- create_llm: 根据 provider_type 创建对应的 LLM 客户端
- get_available_llm_types: 返回可用 provider 列表（用于设置页下拉）
"""

from .base import BaseLLM
from .factory import create_llm, get_available_llm_types

__all__ = ["BaseLLM", "create_llm", "get_available_llm_types"]
