# 默认数据源适配器
import ast
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
    REQUEST_TIMEOUT = 15
    REQUEST_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }

    def get_fund_list(self) -> list[dict]:
        """获取东方财富基金列表并转换为统一三字段结构"""
        response_text = self._fetch_fund_list_response()
        return self._parse_fund_list_response(response_text)

    def get_fund_overview(self, fund_code: str) -> dict[str, str]:
        """获取东方财富基金基本概况原始键值表。"""
        return fetch_fund_overview(fund_code)

    def _fetch_fund_list_response(self) -> str:
        """请求东方财富基金列表接口"""
        req = request.Request(
            self.EASTMONEY_FUND_LIST_URL,
            headers=self.REQUEST_HEADERS,
        )
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

    def _parse_fund_list_response(self, response_text: str) -> list[dict]:
        """解析 `var r = [...]` 形式的 JS 响应"""
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
                raise RuntimeError(
                    f"东方财富基金列表接口解析失败: 第 {index + 1} 条记录格式异常"
                )

            fund_code = str(row[0]).strip()
            fund_name = str(row[2]).strip()
            raw_fund_type = str(row[3]).strip()

            if not fund_code or not fund_name:
                raise RuntimeError(
                    f"东方财富基金列表接口解析失败: 第 {index + 1} 条记录缺少代码或名称"
                )

            funds.append({
                "fund_code": fund_code,
                "fund_name": fund_name,
                "fund_type": self._parse_fund_type(raw_fund_type),
            })

        return funds

    def _parse_fund_type(self, raw_fund_type: str) -> str:
        """从东方财富原始类型中提取真实基金类型"""
        if not raw_fund_type:
            return ""
        return raw_fund_type.split("-", 1)[0].strip()
