#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取股票列表并导出个股主力资金历史 CSV。"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

from curl_cffi import requests as curl_requests

BASE_URL = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
STOCK_LIST_URL = "https://api.mairuiapi.com/hslt/list/F4C14006-040B-4F21-AF2F-7C272A1A6BC8"
DEFAULT_TIMEOUT = 15
DEFAULT_OUTPUT_DIR = Path("tools") / "output"
MAIN_FLOW_OUTPUT_DIR = DEFAULT_OUTPUT_DIR / "main_flow"
STOCK_LIST_CACHE_DIR = Path("data") / "cache" / "stock_list"
MARKET_PREFIX_MAP = {
    "sh": "1",
    "sz": "0",
    "bj": "0",
}
STOCK_LIST_CACHE_FIELDS = [
    "stock_code",
    "stock_name",
    "market",
    "full_code",
    "jys",
]
CSV_FIELDS = [
    "日期",
    "收盘价",
    "涨跌幅",
    "主力净流入-净额",
    "主力净流入-净占比",
    "超大单净流入-净额",
    "超大单净流入-净占比",
    "大单净流入-净额",
    "大单净流入-净占比",
    "中单净流入-净额",
    "中单净流入-净占比",
    "小单净流入-净额",
    "小单净流入-净占比",
]
REQUEST_HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://data.eastmoney.com/zjlx/detail.html",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/147.0.0.0 Safari/537.36"
    ),
}
STOCK_LIST_HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "User-Agent": REQUEST_HEADERS["User-Agent"],
}


def _format_log_prefix(level: str) -> str:
    return f"[{time.strftime('%H:%M:%S')}] [{level}]"


def log_info(message: str) -> None:
    print(f"{_format_log_prefix('INFO')} {message}")


def log_error(message: str) -> None:
    print(f"{_format_log_prefix('ERROR')} {message}", file=sys.stderr)


def normalize_market(market: str) -> str:
    value = str(market or "").strip().lower()
    if value not in MARKET_PREFIX_MAP:
        raise ValueError("不支持的交易所代码，仅支持 sh/sz/bj（大小写均可）")
    return value


def validate_stock(stock: str) -> str:
    value = str(stock or "").strip()
    if not re.fullmatch(r"\d{6}", value):
        raise ValueError("股票代码格式错误，应为 6 位数字")
    return value


def build_secid(stock: str, market: str) -> str:
    stock_code = validate_stock(stock)
    normalized_market = normalize_market(market)
    return f"{MARKET_PREFIX_MAP[normalized_market]}.{stock_code}"


def build_request_params(stock: str, market: str) -> dict[str, str]:
    return {
        "lmt": "0",
        "klt": "101",
        "secid": build_secid(stock, market),
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
        "ut": "b2884a393a59ad64002292a3e90d46a5",
        "_": str(int(time.time() * 1000)),
    }


def fetch_fund_flow_rows(stock: str, market: str, timeout: int = DEFAULT_TIMEOUT) -> list[str]:
    params = build_request_params(stock, market)
    try:
        response = curl_requests.get(
            BASE_URL,
            params=params,
            headers=REQUEST_HEADERS,
            timeout=timeout,
            impersonate="chrome",
        )
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"请求东方财富接口失败：{exc}") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    klines = data.get("klines") if isinstance(data, dict) else None
    if not isinstance(klines, list) or not klines:
        raise RuntimeError("接口返回为空或结构异常")
    return [item for item in klines if isinstance(item, str) and item.strip()]


def fetch_stock_list_remote(timeout: int = DEFAULT_TIMEOUT) -> list[dict]:
    try:
        response = curl_requests.get(
            STOCK_LIST_URL,
            headers=STOCK_LIST_HEADERS,
            timeout=timeout,
            impersonate="chrome",
        )
        if response.status_code != 200:
            raise RuntimeError(f"HTTP {response.status_code}")
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"请求股票列表接口失败：{exc}") from exc

    if not isinstance(payload, list) or not payload:
        raise RuntimeError("股票列表接口返回为空或结构异常")
    return payload


def _clean_value(value: str) -> str:
    return str(value).strip()


def parse_stock_list_item(item: dict) -> dict[str, str]:
    if not isinstance(item, dict):
        raise ValueError("股票列表项结构异常")

    full_code = str(item.get("dm") or "").strip()
    stock_name = str(item.get("mc") or "").strip()
    raw_market = str(item.get("jys") or "").strip()
    match = re.fullmatch(r"(?P<code>\d{6})\.(?P<market>[A-Za-z]{2})", full_code)
    if not match:
        raise ValueError(f"股票代码结构异常：{full_code}")
    if not stock_name:
        raise ValueError(f"股票名称为空：{full_code}")

    market = normalize_market(raw_market or match.group("market"))
    return {
        "stock_code": match.group("code"),
        "stock_name": stock_name,
        "market": market,
        "full_code": full_code,
        "jys": raw_market or match.group("market").upper(),
    }


def map_kline_to_row(kline_str: str) -> dict[str, str]:
    parts = [segment.strip() for segment in str(kline_str).split(",")]
    if len(parts) < 15:
        raise ValueError(f"单条资金流数据字段数不足：{kline_str}")
    return {
        "日期": _clean_value(parts[0]),
        "收盘价": _clean_value(parts[11]),
        "涨跌幅": _clean_value(parts[12]),
        "主力净流入-净额": _clean_value(parts[1]),
        "主力净流入-净占比": _clean_value(parts[6]),
        "超大单净流入-净额": _clean_value(parts[5]),
        "超大单净流入-净占比": _clean_value(parts[10]),
        "大单净流入-净额": _clean_value(parts[4]),
        "大单净流入-净占比": _clean_value(parts[9]),
        "中单净流入-净额": _clean_value(parts[3]),
        "中单净流入-净占比": _clean_value(parts[8]),
        "小单净流入-净额": _clean_value(parts[2]),
        "小单净流入-净占比": _clean_value(parts[7]),
    }


def build_default_output_path(stock: str, market: str) -> Path:
    normalized_market = normalize_market(market)
    stock_code = validate_stock(stock)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = f"stock_fund_flow_{normalized_market}_{stock_code}_{timestamp}.csv"
    return DEFAULT_OUTPUT_DIR / filename


def build_stock_list_cache_path(date_str: str = "") -> Path:
    tag = str(date_str or "").strip() or time.strftime("%Y_%m_%d")
    return STOCK_LIST_CACHE_DIR / f"{tag}.csv"


def sanitize_filename_component(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or "未命名"


def build_batch_output_path(stock_name: str, stock_code: str) -> Path:
    safe_name = sanitize_filename_component(stock_name)
    safe_code = validate_stock(stock_code)
    return MAIN_FLOW_OUTPUT_DIR / f"{safe_name}_{safe_code}.csv"


def ensure_parent_dir(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(f"输出目录创建失败：{exc}") from exc


def write_csv(rows: list[dict[str, str]], out_path: str | Path) -> Path:
    path = Path(out_path)
    ensure_parent_dir(path)
    try:
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key, "") for key in CSV_FIELDS})
    except OSError as exc:
        raise RuntimeError(f"写入 CSV 失败：{exc}") from exc
    return path


def read_stock_list_cache(path: Path) -> list[dict[str, str]]:
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            return [
                {
                    "stock_code": str(row.get("stock_code") or "").strip(),
                    "stock_name": str(row.get("stock_name") or "").strip(),
                    "market": str(row.get("market") or "").strip(),
                    "full_code": str(row.get("full_code") or "").strip(),
                    "jys": str(row.get("jys") or "").strip(),
                }
                for row in reader
                if str(row.get("stock_code") or "").strip()
            ]
    except OSError as exc:
        raise RuntimeError(f"读取股票列表缓存失败：{exc}") from exc


def write_stock_list_cache(items: list[dict[str, str]], path: Path) -> Path:
    ensure_parent_dir(path)
    try:
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=STOCK_LIST_CACHE_FIELDS)
            writer.writeheader()
            for item in items:
                writer.writerow({key: item.get(key, "") for key in STOCK_LIST_CACHE_FIELDS})
    except OSError as exc:
        raise RuntimeError(f"写入股票列表缓存失败：{exc}") from exc
    return path


def get_stock_list(timeout: int = DEFAULT_TIMEOUT) -> tuple[list[dict[str, str]], str]:
    cache_path = build_stock_list_cache_path()
    log_info(f"检查股票列表缓存：{cache_path}")
    if cache_path.exists():
        cached_items = read_stock_list_cache(cache_path)
        if cached_items:
            log_info(f"命中股票列表缓存，共 {len(cached_items)} 条")
            return cached_items, "cache"

    log_info("未命中缓存，开始请求远程股票列表接口")
    payload = fetch_stock_list_remote(timeout=timeout)
    log_info(f"远程股票列表请求成功，共 {len(payload)} 条原始记录")
    items = [parse_stock_list_item(item) for item in payload]
    write_stock_list_cache(items, cache_path)
    log_info(f"已写入股票列表缓存：{cache_path}")
    return items, "remote"


def export_single_stock_history(
    stock_code: str,
    market: str,
    stock_name: str = "",
    timeout: int = DEFAULT_TIMEOUT,
    out_path: str | Path | None = None,
) -> Path:
    normalized_market = normalize_market(market)
    valid_stock_code = validate_stock(stock_code)
    if stock_name:
        log_info(f"开始抓取主力资金：{stock_name}({valid_stock_code})")
    else:
        log_info(f"开始抓取主力资金：{valid_stock_code}.{normalized_market}")
    klines = fetch_fund_flow_rows(valid_stock_code, normalized_market, timeout=timeout)
    log_info(f"主力资金数据抓取完成：{valid_stock_code}，共 {len(klines)} 条")
    rows = [map_kline_to_row(item) for item in klines]
    rows.sort(key=lambda item: item.get("日期", ""))

    if out_path is not None:
        output_path = Path(out_path).expanduser()
    elif stock_name:
        output_path = build_batch_output_path(stock_name, valid_stock_code)
    else:
        output_path = build_default_output_path(valid_stock_code, normalized_market)
    write_csv(rows, output_path)
    log_info(f"CSV 写入完成：{output_path}")
    return output_path


def export_batch(stock_items: list[dict[str, str]], timeout: int = DEFAULT_TIMEOUT, limit: int | None = None) -> dict:
    selected_items = list(stock_items[:limit] if limit else stock_items)
    successes: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    log_info(f"开始批量导出，共 {len(selected_items)} 只股票")

    for index, item in enumerate(selected_items, start=1):
        stock_code = item["stock_code"]
        market = item["market"]
        stock_name = item["stock_name"]
        log_info(f"[{index}/{len(selected_items)}] 正在处理 {stock_name}({stock_code})")
        try:
            saved_path = export_single_stock_history(
                stock_code=stock_code,
                market=market,
                stock_name=stock_name,
                timeout=timeout,
            )
            log_info(f"[{index}/{len(selected_items)}] 导出成功：{saved_path}")
            successes.append({
                "stock_code": stock_code,
                "stock_name": stock_name,
                "path": str(saved_path),
            })
        except Exception as exc:
            log_error(f"[{index}/{len(selected_items)}] 导出失败：{stock_name}({stock_code}) - {exc}")
            failures.append({
                "stock_code": stock_code,
                "stock_name": stock_name,
                "error": str(exc),
            })

    return {
        "total": len(selected_items),
        "success": len(successes),
        "failed": len(failures),
        "successes": successes,
        "failures": failures,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="导出股票主力资金历史 CSV")
    parser.add_argument("--stock", default="", help="股票代码，如 600584")
    parser.add_argument("--market", default="", help="交易所代码：sh/sz/bj，支持大小写")
    parser.add_argument("--out", default="", help="单股票模式输出 CSV 文件路径")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="请求超时秒数，默认 15")
    parser.add_argument("--limit", type=int, default=0, help="批量模式仅处理前 N 只股票")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        timeout = max(1, int(args.timeout or DEFAULT_TIMEOUT))
        limit = int(args.limit or 0)
        if limit < 0:
            raise ValueError("limit 不能小于 0")

        has_stock = bool(str(args.stock or "").strip())
        has_market = bool(str(args.market or "").strip())

        if has_stock or has_market:
            if not (has_stock and has_market):
                raise ValueError("单股票模式下必须同时传入 --stock 和 --market")

            log_info(f"运行模式：单股票，timeout={timeout}")
            stock_code = validate_stock(args.stock)
            normalized_market = normalize_market(args.market)
            output_path = Path(args.out).expanduser() if str(args.out or "").strip() else None
            saved_path = export_single_stock_history(
                stock_code=stock_code,
                market=normalized_market,
                timeout=timeout,
                out_path=output_path,
            )
            print(f"已写入 CSV：{saved_path}")
            return 0

        if limit == 0:
            limit = None

        log_info(f"运行模式：批量，timeout={timeout}，limit={limit or '全部'}")
        stock_items, source = get_stock_list(timeout=timeout)
        summary = export_batch(stock_items, timeout=timeout, limit=limit)

        print(f"股票列表来源：{source}")
        print(f"处理数量：{summary['total']}")
        print(f"成功数量：{summary['success']}")
        print(f"失败数量：{summary['failed']}")
        for failure in summary["failures"][:20]:
            print(
                f"失败：{failure['stock_name']}({failure['stock_code']}) - {failure['error']}",
                file=sys.stderr,
            )
        return 0 if summary["success"] > 0 else 1
    except (ValueError, RuntimeError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
