# 基金数据仓库 - 统一入口
import json
import csv
import os
from .cache import FundCache
from .adapters.factory import create_datasource
from .adapters.base import BaseDataSource


class FundRepository:
    """基金数据仓库 - 统一入口，外层调用无感知底层数据源"""

    DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    DATASOURCES_FILE = os.path.join(DATA_DIR, "datasources.csv")
    SETTINGS_FILE = os.path.join(DATA_DIR, "settings.csv")

    def __init__(self):
        self._ensure_data_dir()
        self.cache = FundCache()
        self.datasource = self._load_active_datasource()

    def _ensure_data_dir(self):
        """确保数据目录存在"""
        if not os.path.exists(self.DATA_DIR):
            os.makedirs(self.DATA_DIR)

    def _load_active_datasource(self) -> BaseDataSource | None:
        """加载激活的数据源"""
        if not os.path.exists(self.DATASOURCES_FILE):
            return None

        with open(self.DATASOURCES_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["is_active"] == "true":
                    config = json.loads(row["config"])
                    return create_datasource(row["type"], config)
        return None

    def _get_expire_days(self) -> int:
        """获取缓存过期天数"""
        if not os.path.exists(self.SETTINGS_FILE):
            return 7  # 默认 7 天

        with open(self.SETTINGS_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["key"] == "cache_expire_days":
                    return int(row["value"])
        return 7

    def get_fund_list(self) -> list[dict]:
        """
        获取基金列表

        流程:
        1. 查缓存（内存 → CSV）
        2. 缓存无/过期 → 调远程数据源
        3. 写入缓存

        Returns:
            [{"fund_code": "xxx", "fund_name": "xxx"}, ...]
        """
        expire_days = self._get_expire_days()

        # 1. 查缓存
        data = self.cache.get(expire_days)
        if data is not None:
            return data

        # 2. 无缓存或已过期 → 调远程
        if self.datasource is None:
            return []

        data = self.datasource.get_fund_list()

        # 3. 写入缓存
        self.cache.set(data)
        return data

    def refresh(self) -> list[dict]:
        """
        强制刷新缓存

        Returns:
            最新基金列表
        """
        self.cache.clear()

        if self.datasource is None:
            return []

        data = self.datasource.get_fund_list()
        self.cache.set(data)
        return data

    def get_fund_overview(self, fund_code: str) -> dict[str, str]:
        """
        获取单只基金基本信息

        Args:
            fund_code: 基金代码

        Returns:
            原始键值表
        """
        if self.datasource is None:
            raise RuntimeError("当前没有激活的数据源")

        return self.datasource.get_fund_overview(fund_code)

    def get_cache_info(self) -> dict:
        """
        获取缓存状态

        Returns:
            {"exists": bool, "cached_at": str|None, "count": int}
        """
        return self.cache.get_cache_info()

    def reload_datasource(self):
        """重新加载数据源（配置变更后调用）"""
        self.datasource = self._load_active_datasource()
