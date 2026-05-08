# 东方财富（手机接口）数据源适配器：基金列表
import json
import time
from urllib import error, parse, request

from .base import BaseDataSource
from .default import DefaultDataSource
from .factory import register_datasource


@register_datasource
class EastMoneyMobDataSource(BaseDataSource):
    """东方财富（手机接口）数据源。

    - 基金列表：走 fundmobapi JSON 接口（支持涨跌幅等字段）
    - 基金概况 / 历史净值：先委托 Default 数据源，保证全链路可用
    """

    source_type = "EastMoneyMob"
    source_label = "东方财富（手机接口）"
    config_schema = []

    BASE_URL = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNetNewList"
    OVERVIEW_URL_TEMPLATE = "http://j5.dfcfw.com/sc/tfs/qt/v2.0.1/{fund_code}.json"
    REQUEST_TIMEOUT = 15
    REQUEST_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Referer": "https://fund.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
    }

    # 默认拉全量（FundType=0），按日涨跌幅倒序
    DEFAULT_FUND_TYPE = 0
    DEFAULT_SORT_COLUMN = "RZDF"
    DEFAULT_SORT = "desc"
    # pageSize 接口允许到 200（app.py 里 /api/funds/gz 也用 200 作为上限）
    # 增大 pageSize 以减少翻页次数，降低首次拉全量列表时的失败概率
    DEFAULT_PAGE_SIZE = 200

    # 防死循环保护：最多翻多少页
    MAX_PAGES = 200

    def __init__(self, config: dict):
        super().__init__(config)
        # 复用 Default 的概况/历史净值实现
        self._delegate_default = DefaultDataSource({})

    def get_fund_list(self, page_num: int | None = None, page_size: int | None = None) -> list[dict]:
        # 分页模式：只取指定页（用于 /api/funds?pageNum/pageSize 与测试连接）
        if page_num is not None or page_size is not None:
            safe_page_num = int(page_num or 1)
            safe_page_size = int(page_size or 10)
            if safe_page_num < 1:
                safe_page_num = 1
            if safe_page_size < 1:
                safe_page_size = 1
            if safe_page_size > 200:
                safe_page_size = 200

            payload = self._fetch_page(page_index=safe_page_num, page_size=safe_page_size)
            page_items, _total = self._parse_page(payload, fallback_total=None)
            return page_items

        all_items: list[dict] = []
        page_index = 1
        total_count: int | None = None

        while True:
            if page_index > self.MAX_PAGES:
                raise RuntimeError(f"东方财富手机基金列表翻页异常：超过最大页数 {self.MAX_PAGES}")

            payload = self._fetch_page(page_index=page_index, page_size=self.DEFAULT_PAGE_SIZE)
            page_items, total_count = self._parse_page(payload, fallback_total=total_count)

            if not page_items:
                break

            all_items.extend(page_items)

            if total_count is not None and len(all_items) >= int(total_count):
                break

            page_index += 1

        return all_items

    def get_fund_list_page(self, page_num: int = 1, page_size: int = 50, fund_type: int = 0) -> tuple[list[dict], int]:
        """获取指定分页数据，并返回 total（TotalCount）。"""
        safe_page_num = int(page_num or 1)
        safe_page_size = int(page_size or 50)
        if safe_page_num < 1:
            safe_page_num = 1
        if safe_page_size < 1:
            safe_page_size = 1
        if safe_page_size > 200:
            safe_page_size = 200

        # FundType 透传（0=全部）
        try:
            safe_fund_type = int(fund_type or 0)
        except (TypeError, ValueError):
            safe_fund_type = 0

        payload = self._fetch_page(page_index=safe_page_num, page_size=safe_page_size, fund_type=safe_fund_type)
        page_items, total_count = self._parse_page(payload, fallback_total=None)
        return page_items, int(total_count or 0)

    def get_fund_overview(self, fund_code: str) -> dict[str, str]:
        """
        获取基金详情（东方财富新接口）。

        当前阶段：按 JJXQ / JDZF / JJGM / JJCC 四块返回 KV items 数组，供前端分区展示。
        """
        code = str(fund_code or "").strip()
        if not code:
            raise ValueError("基金代码不能为空")

        payload = self._fetch_fund_overview_payload(code)
        items: list[dict] = []

        def _kv(section: str, key: str, label: str, value) -> dict:
            text = "--"
            if value is not None:
                s = str(value).strip()
                if s != "":
                    text = s
            section_name_map = {
                "JJXQ": "基金详情",
                "JDZF": "阶段涨幅",
                "JJGM": "基金规模",
                "JJCC": "基金持仓",
            }
            return {
                "section": section,
                "section_name": section_name_map.get(section, section),
                "key": key,
                "label": label,
                "value": text,
            }

        # JJXQ：按指定字段输出
        jjxq = payload.get("JJXQ") if isinstance(payload, dict) else None
        jjxq_datas = jjxq.get("Datas") if isinstance(jjxq, dict) else None
        jjxq_datas = jjxq_datas if isinstance(jjxq_datas, dict) else {}

        jjxq_labels = {
            "FCODE": "基金代码",
            "SHORTNAME": "基金简称",
            "ESTABDATE": "成立日期",
            "JJGS": "基金公司",
            "ENDNAV": "资产规模（元）",
            "FEGMRQ": "规模截止日期",
            "RZDF": "日涨幅（%）",
            "DWJZ": "单位净值",
            "LJJZ": "累计净值",
            "SGZT": "申购状态",
            "SHZT": "卖出/赎回状态",
            "RATE": "实际购买费率",
            "RISKLEVEL": "风险等级",
            "STDDEV1": "近1年波动率",
            "STDDEV2": "近2年波动率",
            "SHARP1": "近1年夏普比率",
            "SHARP2": "近2年夏普比率",
            "MAXRETRA1": "近1年最大回撤",
        }

        for key, label in jjxq_labels.items():
            items.append(_kv("JJXQ", key, label, jjxq_datas.get(key)))

        # JDZF：阶段涨幅
        jdzf = payload.get("JDZF") if isinstance(payload, dict) else None
        jdzf_datas = jdzf.get("Datas") if isinstance(jdzf, dict) else None
        period_name_map = {
            "Z": "近1周",
            "Y": "近1月",
            "3Y": "近3月",
            "6Y": "近6月",
            "1N": "近1年",
            "2N": "近2年",
            "3N": "近3年",
            "5N": "近5年",
            "JN": "今年来",
            "LN": "成立来",
        }
        if isinstance(jdzf_datas, list):
            for row in jdzf_datas:
                if not isinstance(row, dict):
                    continue
                title = str(row.get("title") or "").strip()
                period_name = period_name_map.get(title, title)
                prefix = f"{period_name}-" if period_name else ""
                items.append(_kv("JDZF", f"{title}.syl", f"{prefix}收益率", row.get("syl")))
                items.append(_kv("JDZF", f"{title}.avg", f"{prefix}同类平均", row.get("avg")))
                items.append(_kv("JDZF", f"{title}.hs300", f"{prefix}沪深300", row.get("hs300")))
                items.append(_kv("JDZF", f"{title}.rank", f"{prefix}同类排名", row.get("rank")))
                items.append(_kv("JDZF", f"{title}.sc", f"{prefix}同类总数", row.get("sc")))
                items.append(_kv("JDZF", f"{title}.diff", f"{prefix}差异", row.get("diff")))

        # JJGM / JJCC：先 raw 展示
        for section in ("JJGM", "JJCC"):
            raw_block = payload.get(section) if isinstance(payload, dict) else None
            items.append(_kv(section, "raw", "原始数据", json.dumps(raw_block, ensure_ascii=False, indent=2) if raw_block is not None else "--"))

        return items

    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        # DefaultDataSource 本身返回全量历史；区间过滤由仓库层做
        return self._delegate_default.get_fund_history(fund_code, start_date=start_date, end_date=end_date)

    def _fetch_fund_overview_payload(self, fund_code: str) -> dict:
        url = self.OVERVIEW_URL_TEMPLATE.format(fund_code=fund_code)
        req = request.Request(url, headers=self.REQUEST_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"东方财富基金详情接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"东方财富基金详情接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"东方财富基金详情接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("东方财富基金详情接口请求超时") from exc

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError("东方财富基金详情接口解析失败: JSON 无效") from exc
        return payload if isinstance(payload, dict) else {}

    def _fetch_page(self, page_index: int, page_size: int, fund_type: int | None = None) -> dict:
        if fund_type is None:
            fund_type = self.DEFAULT_FUND_TYPE
        params = {
            "FundType": str(int(fund_type)),
            "SortColumn": self.DEFAULT_SORT_COLUMN,
            "Sort": self.DEFAULT_SORT,
            "pageIndex": str(page_index),
            "pageSize": str(page_size),
            "plat": "Iphone",
            "deviceid": str(time.time_ns()),
            "product": "EFund",
            "version": "6.4.5",
        }
        url = f"{self.BASE_URL}?{parse.urlencode(params)}"
        req = request.Request(url, headers=self.REQUEST_HEADERS)
        try:
            with request.urlopen(req, timeout=self.REQUEST_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"东方财富手机基金列表接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"东方财富手机基金列表接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"东方财富手机基金列表接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("东方财富手机基金列表接口请求超时") from exc

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError("东方财富手机基金列表接口解析失败: JSON 无效") from exc

        return payload if isinstance(payload, dict) else {}

    def _parse_page(self, payload: dict, fallback_total: int | None) -> tuple[list[dict], int | None]:
        success = bool(payload.get("Success"))
        err_code = payload.get("ErrCode")
        error_code = str(payload.get("ErrorCode") or "").strip()

        if not success or (err_code not in (0, "0") and error_code != "0"):
            message = payload.get("ErrMsg") or payload.get("Message") or payload.get("ErrorMessage") or "未知错误"
            raise RuntimeError(f"东方财富手机基金列表接口返回失败: {message}")

        total_count = payload.get("TotalCount")
        try:
            total_count_int = int(total_count) if total_count is not None else None
        except (TypeError, ValueError):
            total_count_int = fallback_total

        datas = payload.get("Datas")
        # 兼容两种结构：
        # 1) Datas = [ [ {...}, {...} ] ]  -> datas[0] 直接就是 list[dict]
        # 2) Datas = [ [ [ {...}, {...} ] ] ] -> datas[0][0] 才是 list[dict]
        page_rows: list[dict] = []
        if isinstance(datas, list) and datas:
            first = datas[0]
            rows_list = None
            if isinstance(first, list) and first:
                # 情况 1：first 就是基金数组（元素是 dict）
                if isinstance(first[0], dict):
                    rows_list = first
                # 情况 2：first[0] 才是基金数组
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
                # 历史字段（后端会统一转换为 fund_type_code/name）
                "fund_type": fund_type,
                # 日涨跌幅：RZDF
                "percentage": self._parse_float(raw.get("RZDF")),
                # 你要求保留的字段（按项目 snake_case）
                "fsrq": str(raw.get("FSRQ") or "").strip(),
                "gpsj": self._parse_float(raw.get("GPSJ")),
                "dwjz": self._parse_float(raw.get("DWJZ")),
                "ljjz": self._parse_float(raw.get("LJJZ")),
                "sgzt": str(raw.get("SGZT") or "").strip(),
            })

        return items, total_count_int

    @staticmethod
    def _parse_float(value) -> float | None:
        if value is None:
            return None
        text = str(value).strip()
        if text == "" or text == "--":
            return None
        try:
            return float(text)
        except (TypeError, ValueError):
            return None
