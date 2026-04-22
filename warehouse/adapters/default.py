# 默认数据源适配器
import ast
import html
import re
from urllib import error, request

from .base import BaseDataSource
from .eastmoney_overview import fetch_fund_overview
from .factory import register_datasource


@register_datasource
class DefaultDataSource(BaseDataSource):
    """默认数据源，固定接入东方财富基金列表接口"""

    source_type = "Default"
    source_label = "Default"
    config_schema = []

    EASTMONEY_FUND_LIST_URL = "https://fund.eastmoney.com/js/fundcode_search.js"
    EASTMONEY_FUND_HISTORY_URL = "https://fundf10.eastmoney.com/F10DataApi.aspx"
    REQUEST_TIMEOUT = 15
    REQUEST_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Referer": "https://fund.eastmoney.com/",
    }

    def get_fund_list(self) -> list[dict]:
        response_text = self._fetch_fund_list_response()
        return self._parse_fund_list_response(response_text)

    def get_fund_overview(self, fund_code: str) -> dict[str, str]:
        return fetch_fund_overview(fund_code)

    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        rows: list[dict] = []
        page = 1
        total_pages = 1
        while page <= total_pages:
            text = self._fetch_fund_history_response(code, page, start_date, end_date)
            page_rows, total_pages = self._parse_fund_history_response(text)
            rows.extend(page_rows)
            page += 1
            if not page_rows:
                break

        dedup: dict[str, dict] = {}
        for row in rows:
            dedup[row["date"]] = row
        ordered = sorted(dedup.values(), key=lambda item: item["date"])
        return ordered

    def _fetch_fund_list_response(self) -> str:
        req = request.Request(self.EASTMONEY_FUND_LIST_URL, headers=self.REQUEST_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"东方财富基金列表接口请求失败，HTTP {status_code}")
                return response.read().decode("utf-8-sig")
        except error.HTTPError as exc:
            raise RuntimeError(f"东方财富基金列表接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"东方财富基金列表接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("东方财富基金列表接口请求超时") from exc

    def _fetch_fund_history_response(self, fund_code: str, page: int, start_date: str | None, end_date: str | None) -> str:
        params = [
            f"type=lsjz",
            f"code={fund_code}",
            f"page={page}",
            "per=49",
        ]
        if start_date:
            params.append(f"sdate={start_date}")
        if end_date:
            params.append(f"edate={end_date}")
        url = f"{self.EASTMONEY_FUND_HISTORY_URL}?{'&'.join(params)}"
        req = request.Request(url, headers=self.REQUEST_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"东方财富基金历史净值接口请求失败，HTTP {status_code}")
                return response.read().decode("utf-8", errors="ignore")
        except error.HTTPError as exc:
            raise RuntimeError(f"东方财富基金历史净值接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"东方财富基金历史净值接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("东方财富基金历史净值接口请求超时") from exc

    def _parse_fund_list_response(self, response_text: str) -> list[dict]:
        if not response_text or not response_text.strip():
            raise RuntimeError("东方财富基金列表接口返回空内容")

        match = re.search(r"var\s+r\s*=\s*(\[.*\]);?\s*$", response_text, re.S)
        if match is None:
            raise RuntimeError("东方财富基金列表接口解析失败: 未找到基金列表数组")

        try:
            rows = ast.literal_eval(match.group(1))
        except (SyntaxError, ValueError) as exc:
            raise RuntimeError("东方财富基金列表接口解析失败: 数组内容无效") from exc

        if not isinstance(rows, list):
            raise RuntimeError("东方财富基金列表接口解析失败: 顶层数据不是数组")

        funds = []
        for index, row in enumerate(rows):
            if not isinstance(row, list) or len(row) != 5:
                raise RuntimeError(f"东方财富基金列表接口解析失败: 第 {index + 1} 条记录格式异常")
            fund_code = str(row[0]).strip()
            fund_name = str(row[2]).strip()
            raw_fund_type = str(row[3]).strip()
            if not fund_code or not fund_name:
                raise RuntimeError(f"东方财富基金列表接口解析失败: 第 {index + 1} 条记录缺少代码或名称")
            funds.append({
                "fund_code": fund_code,
                "fund_name": fund_name,
                "fund_type": self._parse_fund_type(raw_fund_type),
            })
        return funds

    def _parse_fund_history_response(self, text: str) -> tuple[list[dict], int]:
        if not text or not text.strip():
            raise RuntimeError("东方财富基金历史净值接口返回空内容")

        pages_match = re.search(r"pages:(\d+)", text)
        total_pages = int(pages_match.group(1)) if pages_match else 1

        content_match = re.search(r'content:"(.*)",records:', text, re.S)
        if content_match is None:
            raise RuntimeError("东方财富基金历史净值接口解析失败: 未找到内容块")
        content = content_match.group(1)
        html_text = html.unescape(content.replace(r'\/', '/').replace(r'\"', '"').replace(r'\r', '').replace(r'\n', ''))

        rows = []
        for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", html_text, re.S | re.I):
            cells = [self._clean_html_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S | re.I)]
            if len(cells) < 4:
                continue
            date = cells[0]
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                continue
            unit_nav = self._parse_float(cells[1])
            cumulative_nav = self._parse_float(cells[2])
            daily_return = self._parse_percent(cells[3])
            rows.append({
                "date": date,
                "unit_nav": unit_nav,
                "cumulative_nav": cumulative_nav,
                "daily_return": daily_return,
            })
        return rows, total_pages

    @staticmethod
    def _parse_fund_type(raw_fund_type: str) -> str:
        if not raw_fund_type:
            return ""
        return raw_fund_type.split("-", 1)[0].strip()

    @staticmethod
    def _clean_html_text(value: str) -> str:
        text = re.sub(r"<[^>]+>", "", value or "")
        text = html.unescape(text)
        text = text.replace("\xa0", " ")
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def _parse_float(value: str) -> float | None:
        try:
            return float(str(value).replace(",", ""))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _parse_percent(value: str) -> float | None:
        if value is None:
            return None
        text = str(value).replace("%", "").strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
