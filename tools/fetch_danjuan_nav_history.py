#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通过蛋卷基金接口拉取基金历史净值并保存为 CSV。

接口示例：
  https://danjuanfunds.com/djapi/fund/nav/history/013840?page=1&size=20

用法示例：
  1) 近2年（默认）：
     python3 tools/fetch_danjuan_nav_history.py --fund_code 013840

  2) 近6个月：
     python3 tools/fetch_danjuan_nav_history.py --fund_code 013840 --duration 6m

  3) 指定区间：
     python3 tools/fetch_danjuan_nav_history.py --fund_code 013840 --start 2024-01-01 --end 2024-12-31
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from urllib import error, request


DEFAULT_BASE_URL = "https://danjuanfunds.com/djapi/fund/nav/history"

# 参考项目内 default adapter 的 headers（见 warehouse/adapters/default.py）
DANJUAN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Referer": "https://danjuanfunds.com/",
    "Accept": "application/json,text/plain,*/*",
}


@dataclass(frozen=True)
class DateRange:
    start: date
    end: date


def _parse_ymd(s: str) -> date:
    s = (s or "").strip()
    return datetime.strptime(s, "%Y-%m-%d").date()


def _today_local() -> date:
    return datetime.now().date()


def _duration_to_timedelta(duration: str) -> timedelta:
    """
    支持格式：
      - 7d / 30d
      - 6m（按 30 天/月近似）
      - 2y（按 365 天/年近似）
    说明：这里用“天数近似”即可满足“近X”的筛选需求；若你需要严格按自然月/年回溯，可再升级实现。
    """
    raw = (duration or "").strip().lower()
    m = re.fullmatch(r"(\d+)\s*([dmy])", raw)
    if not m:
        raise ValueError("duration 格式错误，需形如 7d/6m/2y")
    n = int(m.group(1))
    unit = m.group(2)
    if n <= 0:
        raise ValueError("duration 数值需 > 0")
    if unit == "d":
        return timedelta(days=n)
    if unit == "m":
        return timedelta(days=30 * n)
    if unit == "y":
        return timedelta(days=365 * n)
    raise ValueError("duration 单位仅支持 d/m/y")


def _resolve_date_range(args) -> DateRange:
    end = _today_local() if not args.end else _parse_ymd(args.end)

    # start/end 模式优先（若给了 start）
    if args.start:
        start = _parse_ymd(args.start)
        if start > end:
            raise ValueError("start 不能晚于 end")
        return DateRange(start=start, end=end)

    # duration 模式（默认 2y）
    duration = args.duration or "2y"
    delta = _duration_to_timedelta(duration)
    start = end - delta
    return DateRange(start=start, end=end)


def _to_float(v) -> float | None:
    if v is None:
        return None
    s = str(v).replace("%", "").strip()
    if not s or s == "--":
        return None
    try:
        return float(s)
    except Exception:
        return None


def _safe_get(d: Any, *keys: str, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


def _fetch_page(base_url: str, fund_code: str, page: int, size: int, timeout: int, retries: int) -> dict:
    url = f"{str(base_url).rstrip('/')}/{fund_code}?page={int(page)}&size={int(size)}"
    req = request.Request(url, headers=DANJUAN_HEADERS)
    last_err = None
    for attempt in range(max(1, int(retries))):
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                status = getattr(resp, "status", resp.getcode())
                if status != 200:
                    raise RuntimeError(f"HTTP {status}")
                text = resp.read().decode("utf-8", errors="replace")
            return json.loads(text)
        except (error.HTTPError, error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as e:
            last_err = e
            # 简单退避
            if attempt < retries - 1:
                time.sleep(0.5 * (2 ** attempt))
            continue
    raise RuntimeError(f"请求失败：{url}，错误：{last_err}")


def _extract_items(body: dict) -> list[dict]:
    items = _safe_get(body, "data", "items", default=[])
    if isinstance(items, list):
        return [x for x in items if isinstance(x, dict)]
    return []


def _build_default_out_path(fund_code: str, dr: DateRange, duration: str | None) -> str:
    # 优先用 duration（例如 2y/6m），否则用 start_end
    tag = ""
    if duration:
        tag = str(duration).strip().lower()
    else:
        tag = f"{dr.start.strftime('%Y%m%d')}_{dr.end.strftime('%Y%m%d')}"
    filename = f"danjuan_nav_{tag}.csv"
    return os.path.join("data", "cache", "fund_history_value", fund_code, filename)


def _write_csv(path: str, fund_code: str, rows: list[dict]):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fields = ["fund_code", "date", "value", "percentage"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="拉取蛋卷基金历史净值并保存 CSV")
    parser.add_argument("--fund_code", required=True, help="基金代码（5-8位数字）")

    # 时长/区间（互斥：start 模式 vs duration 模式）
    parser.add_argument("--duration", default="2y", help="相对时长：例如 7d/30d/6m/2y（默认 2y）")
    parser.add_argument("--start", default="", help="开始日期 YYYY-MM-DD（填写则进入区间模式）")
    parser.add_argument("--end", default="", help="结束日期 YYYY-MM-DD（区间模式可选，默认今天）")

    parser.add_argument("--size", type=int, default=200, help="每页条数（默认200）")
    parser.add_argument("--timeout", type=int, default=10, help="请求超时秒数（默认10）")
    parser.add_argument("--retries", type=int, default=3, help="失败重试次数（默认3）")
    parser.add_argument("--out", default="", help="输出 CSV 路径（默认写到 data/cache/fund_history_value/<code>/）")
    parser.add_argument("--base_url", default=DEFAULT_BASE_URL, help="接口 base_url（一般不需要改）")

    args = parser.parse_args(argv)

    fund_code = str(args.fund_code or "").strip()
    if not re.fullmatch(r"\d{5,8}", fund_code):
        print("错误：fund_code 格式错误（需 5-8 位数字）", file=sys.stderr)
        return 2

    # 互斥校验：start 模式下不允许用户再依赖 duration（但允许传了也忽略）
    if args.start and args.duration:
        # 不报错，避免用户脚本调用时被打断；仅提示
        pass

    base_url = str(args.base_url or DEFAULT_BASE_URL).rstrip("/")

    try:
        dr = _resolve_date_range(args)
    except Exception as e:
        print(f"错误：日期参数不合法：{e}", file=sys.stderr)
        return 2

    duration_tag = None if args.start else (str(args.duration or "2y").strip().lower() or "2y")
    out_path = str(args.out or "").strip() or _build_default_out_path(fund_code, dr, duration_tag)

    size = int(args.size or 200)
    size = max(1, min(500, size))
    timeout = max(1, int(args.timeout or 10))
    retries = max(1, int(args.retries or 3))

    # 分页抓取：从新到旧拉，直到覆盖 start
    page = 1
    seen_by_date: dict[str, dict] = {}
    oldest_seen: date | None = None

    while True:
        body = _fetch_page(base_url, fund_code, page=page, size=size, timeout=timeout, retries=retries)
        items = _extract_items(body)
        if not items:
            break

        # 首次输出一下字段，便于接口变更快速定位（只打印一次）
        if page == 1:
            try:
                keys = sorted(list(items[0].keys()))
                print(f"接口首条记录字段：{keys}")
            except Exception:
                pass

        for it in items:
            ds = str(it.get("date") or "").strip()
            if not ds:
                continue
            try:
                d = _parse_ymd(ds)
            except Exception:
                continue

            if d < dr.start or d > dr.end:
                # 不在区间内：仍然更新 oldest_seen，用于停止判断
                pass
            else:
                seen_by_date[ds] = {
                    "fund_code": fund_code,
                    "date": ds,
                    "value": "" if _to_float(it.get("value")) is None else _to_float(it.get("value")),
                    "percentage": "" if _to_float(it.get("percentage")) is None else _to_float(it.get("percentage")),
                }

            if oldest_seen is None or d < oldest_seen:
                oldest_seen = d

        # 如果已经看到了早于 start 的日期，则可以停止（再多取一页意义不大）
        if oldest_seen is not None and oldest_seen <= dr.start:
            break

        page += 1
        if page > 2000:
            # 防止接口异常导致死循环
            break

    rows = list(seen_by_date.values())
    rows.sort(key=lambda r: str(r.get("date") or ""))

    if not rows:
        print(
            f"未获取到任何落在区间内的数据：fund_code={fund_code}, "
            f"range=[{dr.start.isoformat()} ~ {dr.end.isoformat()}]。"
            "可能原因：基金代码错误/接口结构变化/被限流。",
            file=sys.stderr,
        )
        return 1

    _write_csv(out_path, fund_code, rows)
    print(f"已写入 CSV：{out_path}（{len(rows)} 条，范围 {dr.start.isoformat()} ~ {dr.end.isoformat()}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
