# 缓存管理
import os
import csv
from datetime import datetime, timedelta
from glob import glob


class FundCache:
    """基金列表缓存：内存 + CSV"""

    CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    CACHE_PREFIX = "funds_list_cache_"

    _memory_cache: list[dict] = None

    def __init__(self):
        # 确保缓存目录存在
        if not os.path.exists(self.CACHE_DIR):
            os.makedirs(self.CACHE_DIR)

    def _get_cache_file(self) -> str | None:
        """查找缓存文件"""
        pattern = os.path.join(self.CACHE_DIR, f"{self.CACHE_PREFIX}*.csv")
        files = glob(pattern)
        return files[0] if files else None

    def _parse_cache_date(self, filepath: str) -> datetime:
        """从文件名解析日期"""
        # funds_list_cache_2026_02_28.csv -> 2026-02-28
        filename = os.path.basename(filepath)
        date_str = filename.replace(self.CACHE_PREFIX, "").replace(".csv", "")
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
        old_file = self._get_cache_file()
        if old_file:
            os.remove(old_file)

        # 2. 写入新文件
        date_str = datetime.now().strftime("%Y_%m_%d")
        filepath = os.path.join(self.CACHE_DIR, f"{self.CACHE_PREFIX}{date_str}.csv")
        self._write_csv(filepath, data)

        # 3. 更新内存
        FundCache._memory_cache = data

    def clear(self):
        """清空缓存（内存 + CSV）"""
        FundCache._memory_cache = None
        cache_file = self._get_cache_file()
        if cache_file:
            os.remove(cache_file)

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
            return list(reader)

    def _write_csv(self, filepath: str, data: list[dict]):
        """写入 CSV 文件"""
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["fund_code", "fund_name"])
            writer.writeheader()
            writer.writerows(data)
