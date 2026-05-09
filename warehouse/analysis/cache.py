"""AI 分析结果缓存 — 内存 + CSV。

缓存过期策略：以“缓存生成时间之后的下一个 15:00”为截止时间（过期即视为无效）。

落盘规则（不依赖解析文件内容即可判断是否过期）：
- data/cache/ai_analysis/<fund_code>/<YYYYMMDD_1500>.csv
  其中 YYYYMMDD_1500 表示该缓存的截止时间为当日 15:00。
"""

import csv
import json
import os
from datetime import datetime, timedelta
from glob import glob

from ..paths import CACHE_AI_ANALYSIS_DIR


class AnalysisCache:
    DATA_DIR = CACHE_AI_ANALYSIS_DIR
    FIELDS = ["fund_code", "score", "reason", "factors_json", "cached_at"]

    # 内存缓存结构：在 CSV 行字段基础上附加 _deadline: datetime
    _memory_cache: dict[str, dict] = {}

    def get(self, fund_code: str) -> dict | None:
        code = str(fund_code).strip()
        now = datetime.now()

        cached = self._memory_cache.get(code)
        if cached:
            deadline = cached.get("_deadline")
            if isinstance(deadline, datetime) and now < deadline:
                return self._to_result(cached)
            self._memory_cache.pop(code, None)

        path, deadline = self._get_latest_cache_file(code)
        if not path or not deadline:
            return None

        # 仅通过文件名判断是否过期
        if now >= deadline:
            try:
                os.remove(path)
            except Exception:
                pass
            return None

        try:
            with open(path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # 单行缓存
                    row["_deadline"] = deadline
                    self._memory_cache[code] = row
                    return self._to_result(row)
        except Exception:
            return None

        return None

    def set(self, fund_code: str, result: dict):
        code = str(fund_code).strip()
        now_dt = datetime.now()
        deadline = self._next_1500(now_dt)
        deadline_tag = self._deadline_tag(deadline)
        now = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        row = {
            "fund_code": code,
            "score": str(result.get("score", "")),
            "reason": str(result.get("reason", "")),
            "factors_json": json.dumps(result.get("factors", []), ensure_ascii=False),
            "cached_at": now,
            "_deadline": deadline,
        }

        # 同一只基金仅保留一份最新缓存
        code_dir = os.path.join(self.DATA_DIR, code)
        os.makedirs(code_dir, exist_ok=True)
        for fp in glob(os.path.join(code_dir, "*.csv")):
            try:
                os.remove(fp)
            except Exception:
                pass

        path = os.path.join(code_dir, f"{deadline_tag}.csv")
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=self.FIELDS)
            writer.writeheader()
            writer.writerow({k: row.get(k, "") for k in self.FIELDS})

        self._memory_cache[code] = row

    def clear(self, fund_code: str):
        code = str(fund_code).strip()
        self._memory_cache.pop(code, None)
        code_dir = os.path.join(self.DATA_DIR, code)
        if not os.path.isdir(code_dir):
            return
        for fp in glob(os.path.join(code_dir, "*.csv")):
            try:
                os.remove(fp)
            except Exception:
                pass
        try:
            if not os.listdir(code_dir):
                os.rmdir(code_dir)
        except Exception:
            pass

    def cleanup_expired(self) -> int:
        """清理所有过期 AI 分析缓存（仅解析文件名判断过期，不读取文件内容）。"""
        now = datetime.now()
        removed = 0
        for fp in glob(os.path.join(self.DATA_DIR, "*", "*.csv")):
            deadline = self._deadline_from_filename(fp)
            if not deadline:
                continue
            if now >= deadline:
                try:
                    os.remove(fp)
                    removed += 1
                except Exception:
                    pass
        return removed

    def _get_latest_cache_file(self, fund_code: str) -> tuple[str | None, datetime | None]:
        code_dir = os.path.join(self.DATA_DIR, str(fund_code))
        if not os.path.isdir(code_dir):
            return None, None

        best_path = None
        best_deadline = None
        for fp in glob(os.path.join(code_dir, "*.csv")):
            deadline = self._deadline_from_filename(fp)
            if not deadline:
                continue
            if best_deadline is None or deadline > best_deadline:
                best_deadline = deadline
                best_path = fp

        return best_path, best_deadline

    @staticmethod
    def _deadline_from_filename(filepath: str) -> datetime | None:
        # 文件名：YYYYMMDD_1500.csv
        name = os.path.basename(filepath).replace(".csv", "")
        try:
            date_part, time_part = name.split("_", 1)
        except ValueError:
            return None
        if time_part != "1500":
            return None
        try:
            d = datetime.strptime(date_part, "%Y%m%d")
        except ValueError:
            return None
        return d.replace(hour=15, minute=0, second=0, microsecond=0)

    @staticmethod
    def _deadline_tag(deadline: datetime) -> str:
        return deadline.strftime("%Y%m%d") + "_1500"

    @staticmethod
    def _next_1500(now: datetime) -> datetime:
        today_1500 = now.replace(hour=15, minute=0, second=0, microsecond=0)
        if now < today_1500:
            return today_1500
        return today_1500 + timedelta(days=1)

    @staticmethod
    def _to_result(row: dict) -> dict:
        score = row.get("score", "")
        try:
            score = int(float(score))
        except (TypeError, ValueError):
            score = None

        factors = []
        factors_json = row.get("factors_json", "")
        if factors_json:
            try:
                factors = json.loads(factors_json)
            except (json.JSONDecodeError, TypeError):
                pass

        return {
            "score": score,
            "reason": row.get("reason", ""),
            "factors": factors,
        }

