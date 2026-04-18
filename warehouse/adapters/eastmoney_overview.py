"""东方财富基金基本概况提取逻辑。"""

from __future__ import annotations

import re
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://fundf10.eastmoney.com/jbgk_{fund_code}.html"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT = 20
OVERVIEW_HINT_KEYS = {"基金全称", "基金简称", "基金代码", "基金类型"}


class FundOverviewError(Exception):
    """基金概况提取异常。"""


def build_overview_url(fund_code: str) -> str:
    """根据基金代码拼接东方财富基本概况页 URL。"""
    normalized_code = fund_code.strip()
    if not re.fullmatch(r"\d{5,8}", normalized_code):
        raise FundOverviewError("基金代码必须为 5-8 位数字")
    return BASE_URL.format(fund_code=normalized_code)


def fetch_overview_html(url: str, timeout: int = REQUEST_TIMEOUT) -> str:
    """请求基本概况页 HTML。"""
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://fund.eastmoney.com/",
        },
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="ignore")
    except HTTPError as error:
        raise FundOverviewError(f"请求失败，HTTP 状态码: {error.code}") from error
    except URLError as error:
        raise FundOverviewError(f"请求失败: {error.reason}") from error


def parse_overview_table(html: str) -> dict[str, str]:
    """解析基本概况表格，返回原始键值表。"""
    table_html = _extract_table_html(html)
    if not table_html:
        raise FundOverviewError("未找到“基本概况”表格")

    data = _table_html_to_dict(table_html)
    if not data:
        raise FundOverviewError("“基本概况”表格为空")

    return data


def fetch_fund_overview(fund_code: str) -> dict[str, str]:
    """直接按基金代码获取东方财富基本概况键值表。"""
    url = build_overview_url(fund_code)
    html = fetch_overview_html(url)
    return parse_overview_table(html)


def _normalize_text(value: str) -> str:
    value = unescape(value or "")
    value = value.replace("\xa0", " ")
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _extract_table_html(html: str) -> str:
    preferred = re.search(
        r'<table[^>]*class=["\'][^"\']*info[^"\']*w790[^"\']*["\'][^>]*>.*?</table>',
        html,
        re.S | re.I,
    )
    if preferred and _looks_like_overview(preferred.group(0)):
        return preferred.group(0)

    for match in re.finditer(r"<table\b[^>]*>.*?</table>", html, re.S | re.I):
        table_html = match.group(0)
        if _looks_like_overview(table_html):
            return table_html

    return ""


def _looks_like_overview(text: str) -> bool:
    normalized = _normalize_text(text)
    hit_count = sum(1 for key in OVERVIEW_HINT_KEYS if key in normalized)
    return hit_count >= 3


def _table_html_to_dict(table_html: str) -> dict[str, str]:
    result: dict[str, str] = {}
    rows = re.findall(r"<tr\b[^>]*>(.*?)</tr>", table_html, re.S | re.I)

    for row_html in rows:
        cells = _extract_cells(row_html)
        index = 0
        while index < len(cells):
            tag, text = cells[index]
            if tag != "th":
                index += 1
                continue

            key = text
            value = ""
            if index + 1 < len(cells) and cells[index + 1][0] == "td":
                value = cells[index + 1][1]
                index += 2
            else:
                index += 1

            if key:
                result[key] = value

    return result


def _extract_cells(row_html: str) -> list[tuple[str, str]]:
    matches = re.findall(
        r"<(th|td)\b[^>]*>(.*?)(?=(?:<(?:th|td)\b)|(?:</(?:th|td)>)|$)",
        row_html,
        re.S | re.I,
    )
    cells: list[tuple[str, str]] = []
    for tag, content in matches:
        text = _normalize_text(content)
        if text:
            cells.append((tag.lower(), text))
    return cells
