# 基金数据仓库 - 统一入口
import json
import csv
import os
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
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
        # 实时估值：仅内存缓存（默认 60 秒）
        self._gz_cache: dict[str, dict] = {}
        self._gz_cache_ttl_seconds: int = 60
        self._gz_max_workers: int = 8

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


    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        """获取基金历史净值序列。"""
        if self.datasource is None:
            raise RuntimeError("当前没有激活的数据源")
        return self.datasource.get_fund_history(fund_code, start_date, end_date)

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

    # =====================
    # 实时估值 / 涨跌幅
    # =====================
    def get_fund_gz(self, fund_code: str) -> dict:
        """
        获取单只基金实时估值（带 60 秒内存缓存）。

        Returns:
            {"fund_code": "...", "percentage": float|None, "gztime": str|None}
        """
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        now = time.time()
        cached = self._gz_cache.get(code)
        if cached and (now - float(cached.get("ts", 0))) <= self._gz_cache_ttl_seconds:
            return cached.get("data") or {"fund_code": code, "percentage": None, "gztime": None, "gz_time": None}

        if self.datasource is None:
            raise RuntimeError("当前没有激活的数据源")

        data = self.datasource.get_fund_gz(code)
        normalized = {
            "fund_code": data.get("fund_code", code),
            "percentage": data.get("percentage"),
            "gztime": data.get("gztime"),
            "gz_time": data.get("gz_time"),
        }
        self._gz_cache[code] = {"ts": now, "data": normalized}
        return normalized

    def get_fund_gz_batch(self, fund_codes: list[str]) -> list[dict]:
        """
        批量获取实时估值（部分失败也返回），带 60 秒内存缓存。

        Returns:
            [
              {"fund_code": "...", "percentage": 0.18, "gztime": "..."},
              {"fund_code": "...", "percentage": None, "gztime": None, "error": "..."},
            ]
        """
        if self.datasource is None:
            raise RuntimeError("当前没有激活的数据源")

        codes_in = [str(x or "").strip() for x in (fund_codes or [])]
        # 保持输入顺序 + 去重
        seen: set[str] = set()
        codes: list[str] = []
        for c in codes_in:
            if c and c not in seen:
                seen.add(c)
                codes.append(c)

        now = time.time()
        items_by_code: dict[str, dict] = {}
        pending: list[str] = []

        for code in codes:
            if not re.fullmatch(r"\d{5,8}", code):
                items_by_code[code] = {
                    "fund_code": code,
                    "percentage": None,
                    "gztime": None,
                    "gz_time": None,
                    "error": "基金代码格式错误（需 5-8 位数字）",
                }
                continue

            cached = self._gz_cache.get(code)
            if cached and (now - float(cached.get("ts", 0))) <= self._gz_cache_ttl_seconds:
                items_by_code[code] = cached.get("data") or {"fund_code": code, "percentage": None, "gztime": None, "gz_time": None}
            else:
                pending.append(code)

        if pending:
            with ThreadPoolExecutor(max_workers=self._gz_max_workers) as executor:
                future_map = {executor.submit(self.datasource.get_fund_gz, code): code for code in pending}
                for future in as_completed(future_map):
                    code = future_map[future]
                    try:
                        data = future.result()
                        normalized = {
                            "fund_code": data.get("fund_code", code),
                            "percentage": data.get("percentage"),
                            "gztime": data.get("gztime"),
                            "gz_time": data.get("gz_time"),
                        }
                        items_by_code[code] = normalized
                        self._gz_cache[code] = {"ts": time.time(), "data": normalized}
                    except Exception as exc:
                        items_by_code[code] = {
                            "fund_code": code,
                            "percentage": None,
                            "gztime": None,
                            "gz_time": None,
                            "error": str(exc),
                        }

        # 按输入 codes 顺序输出
        return [items_by_code.get(code, {"fund_code": code, "percentage": None, "gztime": None, "gz_time": None}) for code in codes]
