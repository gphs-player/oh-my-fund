# 基金数据仓库 - 统一入口
import json
import csv
import os
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from .cache import FundCache, FundHistoryCache
from .adapters.factory import create_datasource
from .adapters.base import BaseDataSource
from .paths import STORE_DIR, ensure_dirs


class FundRepository:
    """基金数据仓库 - 统一入口，外层调用无感知底层数据源"""

    DATASOURCES_FILE = os.path.join(STORE_DIR, "datasources.csv")
    SETTINGS_FILE = os.path.join(STORE_DIR, "settings.csv")

    def __init__(self):
        ensure_dirs()
        self.cache = FundCache()
        self.history_cache = FundHistoryCache()
        # Default 数据源作为兜底（始终可用）
        self.default_datasource = create_datasource("Default", {})
        self.datasource = self._load_active_datasource()
        # 实时估值：仅内存缓存（默认 60 秒）
        self._gz_cache: dict[str, dict] = {}
        self._gz_cache_ttl_seconds: int = 60
        self._gz_max_workers: int = 8

    @staticmethod
    def _get_datasource_type(ds: BaseDataSource | None) -> str:
        if ds is None:
            return ""
        return str(getattr(ds, "source_type", "") or "")

    def _call_with_default_fallback(self, op_name: str, primary_fn, default_fn):
        """
        主数据源失败（抛异常）时，使用 Default 数据源兜底重试。

        约定：
        - 仅当主数据源抛异常才触发兜底（空结果不兜底）
        - 当没有激活数据源时，直接使用 Default
        """
        primary = self.datasource
        if primary is None:
            return default_fn()

        primary_type = self._get_datasource_type(primary)
        if primary_type == "Default":
            return default_fn()

        try:
            return primary_fn()
        except Exception as primary_exc:
            try:
                return default_fn()
            except Exception as default_exc:
                raise RuntimeError(
                    f"{op_name}失败：主数据源({primary_type})异常: {primary_exc}；Default重试异常: {default_exc}"
                ) from default_exc

    def _load_active_datasource(self) -> BaseDataSource | None:
        """加载激活的数据源"""
        if not os.path.exists(self.DATASOURCES_FILE):
            return None

        with open(self.DATASOURCES_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["is_active"] == "true":
                    try:
                        config = json.loads(row["config"])
                    except Exception:
                        config = {}
                    try:
                        return create_datasource(row["type"], config)
                    except Exception:
                        # 兼容旧数据源类型已下线的情况：忽略并继续
                        return None
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
            return self._normalize_fund_list_items(data)

        # 2. 无缓存或已过期 → 调数据源（主失败则 Default 兜底）
        data = self._call_with_default_fallback(
            "获取基金列表",
            primary_fn=lambda: self.datasource.get_fund_list(),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_list(),
        )

        # 3. 写入缓存
        data = self._normalize_fund_list_items(data)
        self.cache.set(data)
        return data

    def refresh(self) -> list[dict]:
        """
        强制刷新缓存

        Returns:
            最新基金列表
        """
        self.cache.clear()

        data = self._call_with_default_fallback(
            "刷新基金列表",
            primary_fn=lambda: self.datasource.get_fund_list(),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_list(),
        )
        data = self._normalize_fund_list_items(data)
        self.cache.set(data)
        return data

    @staticmethod
    def _normalize_fund_list_items(items: list[dict] | None) -> list[dict]:
        """统一基金列表输出字段，避免缓存写入出现多余字段或缺字段。"""
        normalized: list[dict] = []
        for raw in items or []:
            if not isinstance(raw, dict):
                continue
            normalized.append({
                "fund_code": str(raw.get("fund_code") or "").strip(),
                "fund_name": str(raw.get("fund_name") or "").strip(),
                "fund_type": str(raw.get("fund_type") or "").strip(),
                # 新增：日涨跌幅（RZDF 映射）
                "percentage": raw.get("percentage"),
                # 额外字段（mob 数据源映射；Default 下通常为空/None）
                "fsrq": str(raw.get("fsrq") or "").strip(),
                "gpsj": raw.get("gpsj"),
                "dwjz": raw.get("dwjz"),
                "ljjz": raw.get("ljjz"),
                "sgzt": str(raw.get("sgzt") or "").strip(),
            })
        return normalized

    def get_fund_overview(self, fund_code: str):
        """
        获取单只基金基本信息

        Args:
            fund_code: 基金代码

        Returns:
            原始键值表
        """
        return self._call_with_default_fallback(
            "获取基金概况",
            primary_fn=lambda: self.datasource.get_fund_overview(fund_code),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_overview(fund_code),
        )


    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        """获取基金历史净值序列。"""
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        full_history = self.history_cache.get(code)
        if full_history is None:
            full_history = self._call_with_default_fallback(
                "获取基金历史净值",
                primary_fn=lambda: self.datasource.get_fund_history(code),  # type: ignore[union-attr]
                default_fn=lambda: self.default_datasource.get_fund_history(code),
            )
            self.history_cache.set(code, full_history)

        return self._filter_history_by_date(full_history, start_date, end_date)

    @staticmethod
    def _filter_history_by_date(items: list[dict], start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        filtered = []
        for item in items or []:
            item_date = str(item.get("date") or "").strip()
            if not item_date:
                continue
            if start_date and item_date < start_date:
                continue
            if end_date and item_date > end_date:
                continue
            filtered.append(item)
        return filtered

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

    def clear_local_caches(self):
        """清空本地缓存（基金列表缓存 + 历史净值缓存 + 实时估值内存缓存）。"""
        try:
            self.cache.clear()
        except Exception:
            pass
        try:
            self.history_cache.clear_all()
        except Exception:
            pass
        # 实时估值缓存仅内存
        try:
            self._gz_cache = {}
        except Exception:
            pass

    def get_fund_holding_dates(self, fund_code: str) -> list[str]:
        """获取基金持仓公布日期列表（委托 Default 数据源）"""
        return self._call_with_default_fallback(
            "获取持仓日期",
            primary_fn=lambda: self.datasource.get_fund_holding_dates(fund_code),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_holding_dates(fund_code),
        )

    def get_fund_holdings(self, fund_code: str, report_date: str) -> dict:
        """获取基金某日期的持仓明细（委托 Default 数据源）"""
        return self._call_with_default_fallback(
            "获取持仓明细",
            primary_fn=lambda: self.datasource.get_fund_holdings(fund_code, report_date),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_holdings(fund_code, report_date),
        )

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

        data = self._call_with_default_fallback(
            "获取实时估值",
            primary_fn=lambda: self.datasource.get_fund_gz(code),  # type: ignore[union-attr]
            default_fn=lambda: self.default_datasource.get_fund_gz(code),
        )
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
        primary = self.datasource or self.default_datasource
        primary_type = self._get_datasource_type(primary)
        default_type = self._get_datasource_type(self.default_datasource)

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
                future_map = {executor.submit(primary.get_fund_gz, code): code for code in pending}
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
                        # 主数据源失败时，尝试 Default 兜底（若主本身就是 Default，则不重复）
                        if primary_type and default_type and primary_type != default_type:
                            try:
                                data = self.default_datasource.get_fund_gz(code)
                                normalized = {
                                    "fund_code": data.get("fund_code", code),
                                    "percentage": data.get("percentage"),
                                    "gztime": data.get("gztime"),
                                    "gz_time": data.get("gz_time"),
                                }
                                items_by_code[code] = normalized
                                self._gz_cache[code] = {"ts": time.time(), "data": normalized}
                                continue
                            except Exception as default_exc:
                                items_by_code[code] = {
                                    "fund_code": code,
                                    "percentage": None,
                                    "gztime": None,
                                    "gz_time": None,
                                    "error": f"主数据源异常: {exc}；Default重试异常: {default_exc}",
                                }
                        else:
                            items_by_code[code] = {
                                "fund_code": code,
                                "percentage": None,
                                "gztime": None,
                                "gz_time": None,
                                "error": str(exc),
                            }

        # 按输入 codes 顺序输出
        return [items_by_code.get(code, {"fund_code": code, "percentage": None, "gztime": None, "gz_time": None}) for code in codes]
