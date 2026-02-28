# 数据仓库层
# 提供统一的数据访问接口，支持多数据源切换和本地缓存

from .repository import FundRepository

__all__ = ["FundRepository"]
