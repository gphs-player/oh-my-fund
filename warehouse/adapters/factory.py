# 数据源工厂
from typing import Type
from .base import BaseDataSource


# 数据源类注册表（导入时自动填充）
DATASOURCE_CLASSES: dict[str, Type[BaseDataSource]] = {}


def register_datasource(cls: Type[BaseDataSource]) -> Type[BaseDataSource]:
    """注册数据源类的装饰器"""
    DATASOURCE_CLASSES[cls.source_type] = cls
    return cls


def create_datasource(source_type: str, config: dict) -> BaseDataSource:
    """
    根据类型创建数据源实例

    Args:
        source_type: 数据源类型标识
        config: 认证配置字典

    Returns:
        数据源实例

    Raises:
        ValueError: 未知的数据源类型
    """
    cls = DATASOURCE_CLASSES.get(source_type)
    if cls is None:
        raise ValueError(f"未知的数据源类型: {source_type}")
    return cls(config)


def get_available_types() -> list[dict]:
    """
    获取所有支持的数据源类型（供前端渲染）

    Returns:
        [{"type": "...", "label": "...", "config_schema": [...]}, ...]
    """
    return [
        {
            "type": cls.source_type,
            "label": cls.source_label,
            "config_schema": cls.config_schema,
        }
        for cls in DATASOURCE_CLASSES.values()
    ]


# 导入具体实现以触发注册
from . import default  # noqa: F401, E402
from . import eastmoney_mob  # noqa: F401, E402
from . import lixinger  # noqa: F401, E402
from . import tushare  # noqa: F401, E402
