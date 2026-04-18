#!/usr/bin/env python3
"""提取东方财富基金基本概况表格。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Optional
from warehouse.adapters.eastmoney_overview import (
    FundOverviewError,
    build_overview_url,
    fetch_overview_html,
    parse_overview_table,
)


def extract_fund_overview(*, url: Optional[str] = None, fund_code: Optional[str] = None) -> dict:
    if not url and not fund_code:
        raise FundOverviewError("必须提供 url 或 fund_code")

    source_url = url.strip() if url else build_overview_url(fund_code or "")
    html = fetch_overview_html(source_url)
    data = parse_overview_table(html)

    normalized_code = fund_code.strip() if fund_code else _extract_code_from_url(source_url)
    return {
        "fund_code": normalized_code,
        "source_url": source_url,
        "table_name": "基本概况",
        "data": data,
    }


def _extract_code_from_url(url: str) -> str:
    match = re.search(r'jbgk_(\d{5,8})\.html', url)
    return match.group(1) if match else ''


def main() -> int:
    parser = argparse.ArgumentParser(description="提取东方财富基金基本概况表格")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="东方财富基金基本概况页 URL")
    group.add_argument("--code", help="基金代码（5-8 位数字）")
    parser.add_argument("--pretty", action="store_true", help="格式化输出 JSON")
    args = parser.parse_args()

    try:
        result = extract_fund_overview(url=args.url, fund_code=args.code)
    except FundOverviewError as error:
        print(f"错误: {error}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
