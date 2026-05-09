# 缓存管理
import os
import csv
from datetime import datetime, timedelta
from glob import glob

from .paths import CACHE_FUNDS_LIST_DIR, CACHE_FUND_HISTORY_VALUE_DIR


class FundCache:
    """基金列表缓存：内存 + CSV"""

    # 目录已能表达语义，文件名仅保留 YYYY_MM_DD.csv
    CACHE_DIR = CACHE_FUNDS_LIST_DIR
    # 兼容：历史缓存文件可能仅包含 fund_code/fund_name，或不包含新增字段
    CACHE_FIELDS = [
        "fund_code",
        "fund_name",
        "fund_type",
        "percentage",
        "fsrq",
        "gpsj",
        "dwjz",
        "ljjz",
        "sgzt",
    ]

    _memory_cache: list[dict] = None

    def __init__(self):
        # 确保缓存目录存在
        if not os.path.exists(self.CACHE_DIR):
            os.makedirs(self.CACHE_DIR)

    def _get_cache_file(self) -> str | None:
        """查找缓存文件"""
        pattern = os.path.join(self.CACHE_DIR, "*.csv")
        files = glob(pattern)
        if not files:
            return None
        files.sort(key=lambda p: self._parse_cache_date(p))
        return files[-1]

    def _parse_cache_date(self, filepath: str) -> datetime:
        """从文件名解析日期"""
        # 2026_02_28.csv -> 2026-02-28
        filename = os.path.basename(filepath).replace(".csv", "")
        date_str = filename
        return datetime.strptime(date_str, "%Y_%m_%d")

    def _is_expired(self, filepath: str, expire_days: int) -> bool:
        """判断缓存是否过期"""
        cache_date = self._parse_cache_date(filepath)
        return datetime.now() - cache_date > timedelta(days=expire_days)

    def get(self, expire_days: int) -> list[dict] | None:
        """
        获取缓存

        Args:
            expire_days: 过期天数

        Returns:
            缓存数据，不存在或已过期返回 None
        """
        # 1. 先查内存
        if FundCache._memory_cache is not None:
            return FundCache._memory_cache

        # 2. 查 CSV
        cache_file = self._get_cache_file()
        if cache_file is None:
            return None

        # 3. 检查过期
        if self._is_expired(cache_file, expire_days):
            os.remove(cache_file)
            return None

        # 4. 读取 CSV 到内存
        FundCache._memory_cache = self._read_csv(cache_file)
        return FundCache._memory_cache

    def set(self, data: list[dict]):
        """
        写入缓存

        Args:
            data: 基金列表数据
        """
        # 1. 删除旧文件
        for fp in glob(os.path.join(self.CACHE_DIR, "*.csv")):
            try:
                os.remove(fp)
            except Exception:
                pass

        # 2. 写入新文件
        date_str = datetime.now().strftime("%Y_%m_%d")
        filepath = os.path.join(self.CACHE_DIR, f"{date_str}.csv")
        self._write_csv(filepath, data)

        # 3. 更新内存
        FundCache._memory_cache = data

    def clear(self):
        """清空缓存（内存 + CSV）"""
        FundCache._memory_cache = None
        for fp in glob(os.path.join(self.CACHE_DIR, "*.csv")):
            try:
                os.remove(fp)
            except Exception:
                pass

    def get_cache_info(self) -> dict:
        """
        获取缓存状态

        Returns:
            {"exists": bool, "cached_at": str|None, "count": int}
        """
        cache_file = self._get_cache_file()
        if cache_file is None:
            return {"exists": False, "cached_at": None, "count": 0}

        cache_date = self._parse_cache_date(cache_file)
        data = self._read_csv(cache_file)
        return {
            "exists": True,
            "cached_at": cache_date.strftime("%Y-%m-%d"),
            "count": len(data),
        }

    def _read_csv(self, filepath: str) -> list[dict]:
        """读取 CSV 文件"""
        with open(filepath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            data = []
            for row in reader:
                data.append({
                    "fund_code": row.get("fund_code", ""),
                    "fund_name": row.get("fund_name", ""),
                    # 兼容旧缓存文件仅包含 code/name 两列的情况
                    "fund_type": row.get("fund_type", "") or "",
                    # 新增字段：兼容旧缓存缺列的情况
                    "percentage": self._parse_float(row.get("percentage")),
                    "fsrq": row.get("fsrq", "") or "",
                    "gpsj": self._parse_float(row.get("gpsj")),
                    "dwjz": self._parse_float(row.get("dwjz")),
                    "ljjz": self._parse_float(row.get("ljjz")),
                    "sgzt": row.get("sgzt", "") or "",
                })
            return data

    def _write_csv(self, filepath: str, data: list[dict]):
        """写入 CSV 文件"""
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.CACHE_FIELDS)
            writer.writeheader()
            writer.writerows(data)

    @staticmethod
    def _parse_float(value: str | None) -> float | None:
        if value is None:
            return None
        text = str(value).strip()
        if text == "" or text == "--":
            return None
        try:
            return float(text)
        except (TypeError, ValueError):
            return None


class FundHistoryCache:
    """基金历史净值缓存：内存 + CSV，仅当天有效"""

    # 目录已能表达语义：cache/fund_history_value/<fund_code>/YYYY_MM_DD.csv
    CACHE_DIR = CACHE_FUND_HISTORY_VALUE_DIR
    CACHE_FIELDS = ["date", "unit_nav", "cumulative_nav", "daily_return"]

    _memory_cache: dict[str, dict] = {}

    def __init__(self):
        if not os.path.exists(self.CACHE_DIR):
            os.makedirs(self.CACHE_DIR)

    def _build_pattern(self, fund_code: str) -> str:
        return os.path.join(self.CACHE_DIR, str(fund_code), "*.csv")

    def _get_cache_files(self, fund_code: str) -> list[str]:
        return sorted(glob(self._build_pattern(fund_code)))

    def _get_cache_file(self, fund_code: str) -> str | None:
        files = self._get_cache_files(fund_code)
        return files[-1] if files else None

    def _parse_cache_date(self, filepath: str) -> datetime:
        filename = os.path.basename(filepath).replace(".csv", "")
        return datetime.strptime(filename, "%Y_%m_%d")

    def _is_today(self, filepath: str) -> bool:
        cache_date = self._parse_cache_date(filepath).date()
        return cache_date == datetime.now().date()

    def _clear_memory(self, fund_code: str):
        FundHistoryCache._memory_cache.pop(fund_code, None)

    def get(self, fund_code: str) -> list[dict] | None:
        memory_item = FundHistoryCache._memory_cache.get(fund_code)
        if memory_item and memory_item.get("date") == datetime.now().date().isoformat():
            return memory_item.get("data")
        if memory_item:
            self._clear_memory(fund_code)

        cache_file = self._get_cache_file(fund_code)
        if cache_file is None:
            return None

        if not self._is_today(cache_file):
            self.clear(fund_code)
            return None

        data = self._read_csv(cache_file)
        FundHistoryCache._memory_cache[fund_code] = {
            "date": datetime.now().date().isoformat(),
            "data": data,
        }
        return data

    def set(self, fund_code: str, data: list[dict]):
        self.clear(fund_code)
        date_str = datetime.now().strftime("%Y_%m_%d")
        filepath = os.path.join(self.CACHE_DIR, str(fund_code), f"{date_str}.csv")
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        self._write_csv(filepath, data)
        FundHistoryCache._memory_cache[fund_code] = {
            "date": datetime.now().date().isoformat(),
            "data": data,
        }

    def clear(self, fund_code: str):
        self._clear_memory(fund_code)
        for filepath in self._get_cache_files(fund_code):
            if os.path.exists(filepath):
                os.remove(filepath)
        # 尝试移除空目录
        folder = os.path.join(self.CACHE_DIR, str(fund_code))
        try:
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except Exception:
            pass

    def clear_all(self):
        """清空所有基金历史净值缓存（内存 + CSV）。"""
        FundHistoryCache._memory_cache = {}
        pattern = os.path.join(self.CACHE_DIR, "*", "*.csv")
        for filepath in glob(pattern):
            if os.path.exists(filepath):
                os.remove(filepath)

    def _read_csv(self, filepath: str) -> list[dict]:
        with open(filepath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            data = []
            for row in reader:
                data.append({
                    "date": row.get("date", ""),
                    "unit_nav": self._parse_float(row.get("unit_nav")),
                    "cumulative_nav": self._parse_float(row.get("cumulative_nav")),
                    "daily_return": self._parse_float(row.get("daily_return")),
                })
            return data

    def _write_csv(self, filepath: str, data: list[dict]):
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=self.CACHE_FIELDS)
            writer.writeheader()
            for item in data:
                writer.writerow({
                    "date": item.get("date", ""),
                    "unit_nav": item.get("unit_nav"),
                    "cumulative_nav": item.get("cumulative_nav"),
                    "daily_return": item.get("daily_return"),
                })

    @staticmethod
    def _parse_float(value: str | None) -> float | None:
        if value is None or str(value).strip() == "":
            return None
        try:
            return float(str(value))
        except (TypeError, ValueError):
            return None
