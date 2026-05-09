# 默认数据源适配器
import ast
import html
import json
import re
import time
from urllib import error, parse, request

from .base import BaseDataSource
from .eastmoney_j5_fundinfo import fetch_fundinfo_items
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

    # =====================
    # 基金排名（迁移自 EastMoneyMob 列表能力）
    # =====================
    EASTMONEY_MOB_RANK_URL = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNetNewList"
    MOB_ACCEPT_HEADERS = {
        "User-Agent": REQUEST_HEADERS["User-Agent"],
        "Referer": "https://fund.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
    }
    MOB_SORT_COLUMN = "RZDF"
    MOB_SORT = "desc"

    def get_fund_rank_page(self, page_num: int = 1, page_size: int = 50, fund_type: int = 0) -> tuple[list[dict], int]:
        """
        获取基金排名分页（按日涨跌幅 RZDF 倒序）。

        返回 items/total，items 字段为项目统一 snake_case：
        - fund_code/fund_name/fund_type/percentage/fsrq/gpsj/dwjz/ljjz/sgzt
        """
        safe_page_num = int(page_num or 1)
        safe_page_size = int(page_size or 50)
        if safe_page_num < 1:
            safe_page_num = 1
        if safe_page_size < 1:
            safe_page_size = 1
        if safe_page_size > 200:
            safe_page_size = 200

        try:
            safe_fund_type = int(fund_type or 0)
        except (TypeError, ValueError):
            safe_fund_type = 0

        payload = self._fetch_rank_page(page_index=safe_page_num, page_size=safe_page_size, fund_type=safe_fund_type)
        items, total = self._parse_rank_page(payload)
        return items, int(total or 0)

    def _fetch_rank_page(self, page_index: int, page_size: int, fund_type: int = 0) -> dict:
        params = {
            "FundType": str(int(fund_type)),
            "SortColumn": self.MOB_SORT_COLUMN,
            "Sort": self.MOB_SORT,
            "pageIndex": str(int(page_index)),
            "pageSize": str(int(page_size)),
            "plat": "Iphone",
            "deviceid": str(time.time_ns()),
            "product": "EFund",
            "version": "6.4.5",
        }
        url = f"{self.EASTMONEY_MOB_RANK_URL}?{parse.urlencode(params)}"
        req = request.Request(url, headers=self.MOB_ACCEPT_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"基金排名接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"基金排名接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"基金排名接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("基金排名接口请求超时") from exc

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError("基金排名接口解析失败: JSON 无效") from exc

        return payload if isinstance(payload, dict) else {}

    def _parse_rank_page(self, payload: dict) -> tuple[list[dict], int | None]:
        success = bool(payload.get("Success"))
        err_code = payload.get("ErrCode")
        error_code = str(payload.get("ErrorCode") or "").strip()
        if not success or (err_code not in (0, "0") and error_code != "0"):
            message = payload.get("ErrMsg") or payload.get("Message") or payload.get("ErrorMessage") or "未知错误"
            raise RuntimeError(f"基金排名接口返回失败: {message}")

        total_count = payload.get("TotalCount")
        try:
            total_count_int = int(total_count) if total_count is not None else None
        except (TypeError, ValueError):
            total_count_int = None

        datas = payload.get("Datas")
        page_rows: list[dict] = []
        if isinstance(datas, list) and datas:
            first = datas[0]
            rows_list = None
            if isinstance(first, list) and first:
                if isinstance(first[0], dict):
                    rows_list = first
                elif isinstance(first[0], list):
                    rows_list = first[0]
            if isinstance(rows_list, list):
                for raw in rows_list:
                    if isinstance(raw, dict):
                        page_rows.append(raw)

        items: list[dict] = []
        for raw in page_rows:
            fund_code = str(raw.get("FCODE") or "").strip()
            fund_name = str(raw.get("SHORTNAME") or "").strip()
            if not fund_code or not fund_name:
                continue
            fund_type = str(raw.get("FUNDTYPE") or "").strip()
            items.append({
                "fund_code": fund_code,
                "fund_name": fund_name,
                "fund_type": fund_type,
                "percentage": self._parse_float(raw.get("RZDF")),
                "fsrq": str(raw.get("FSRQ") or "").strip(),
                "gpsj": self._parse_float(raw.get("GPSJ")),
                "dwjz": self._parse_float(raw.get("DWJZ")),
                "ljjz": self._parse_float(raw.get("LJJZ")),
                "sgzt": str(raw.get("SGZT") or "").strip(),
            })

        return items, total_count_int

    def get_fund_overview(self, fund_code: str):
        """
        获取基金详情（概况）。

        仅走历史 j5 JSON 接口并返回 items(list)，以支持 JJXQ/JDZF/JJGM/JJCC 四分区。
        不做 HTML 抓取回退：j5 失败将抛异常，由上层接口返回错误。
        """
        return fetch_fundinfo_items(fund_code)

    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        rows: list[dict] = []
        page = 1
        total_pages = 1
        while page <= total_pages:
            text = self._fetch_fund_history_response(code, page)
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

    def _fetch_fund_history_response(self, fund_code: str, page: int) -> str:
        params = [
            f"type=lsjz",
            f"code={fund_code}",
            f"page={page}",
            "per=49",
        ]
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
    def _parse_float(value) -> float | None:
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

    # =====================
    # 持仓数据（蛋卷基金接口）
    # =====================
    DANJUAN_HOLDING_DATES_URL = "https://danjuanfunds.com/djapi/fundx/base/fund/record/asset/option"
    DANJUAN_HOLDINGS_URL = "https://danjuanfunds.com/djapi/fundx/base/fund/record/asset/percent"
    DANJUAN_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Referer": "https://danjuanfunds.com/",
        "Accept": "application/json,text/plain,*/*",
    }

    def get_fund_holding_dates(self, fund_code: str) -> list[str]:
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        url = f"{self.DANJUAN_HOLDING_DATES_URL}?fund_code={code}"
        req = request.Request(url, headers=self.DANJUAN_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"蛋卷持仓日期接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"蛋卷持仓日期接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"蛋卷持仓日期接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("蛋卷持仓日期接口请求超时") from exc

        body = json.loads(text)
        if body.get("result_code") != 0:
            raise RuntimeError(f"蛋卷持仓日期接口返回错误: {body.get('message', '未知错误')}")

        data = body.get("data") or []
        if isinstance(data, list):
            return [str(d).strip() for d in data if d]
        return []

    def get_fund_holdings(self, fund_code: str, report_date: str) -> list[dict]:
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")
        if not report_date or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_date.strip()):
            raise ValueError("report_date 格式错误（需 YYYY-MM-DD）")

        url = f"{self.DANJUAN_HOLDINGS_URL}?fund_code={code}&report_date={report_date.strip()}"
        req = request.Request(url, headers=self.DANJUAN_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"蛋卷持仓明细接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"蛋卷持仓明细接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"蛋卷持仓明细接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("蛋卷持仓明细接口请求超时") from exc

        body = json.loads(text)
        if body.get("result_code") != 0:
            raise RuntimeError(f"蛋卷持仓明细接口返回错误: {body.get('message', '未知错误')}")

        data = body.get("data") or {}
        result = {
            "report_date": data.get("source", report_date.strip()),
            "stock_percent": data.get("stock_percent"),
            "bond_percent": data.get("bond_percent"),
            "cash_percent": data.get("cash_percent"),
            "other_percent": data.get("other_percent"),
            "stock_list": [],
            "bond_list": [],
        }
        for item in data.get("stock_list") or []:
            result["stock_list"].append({
                "code": str(item.get("code", "") or "").strip(),
                "name": str(item.get("name", "") or "").strip(),
                "percent": item.get("percent"),
            })
        for item in data.get("bond_list") or []:
            result["bond_list"].append({
                "code": str(item.get("code", "") or "").strip(),
                "name": str(item.get("name", "") or "").strip(),
                "percent": item.get("percent"),
            })
        return result
