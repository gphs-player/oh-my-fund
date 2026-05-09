# 数据源基类
import json
import re
import time
from typing import ClassVar
from urllib import error, request


class BaseDataSource:
    """数据源基类，配置 + 初始化 + API 调用统一封装"""

    source_type: ClassVar[str] = ""
    source_label: ClassVar[str] = ""
    config_schema: ClassVar[list[dict]] = []

    def __init__(self, config: dict):
        self.config = config

    def test_connection(self) -> dict:
        try:
            result = self.get_fund_list()
            return {"success": True, "message": "连接成功", "count": min(len(result), 5)}
        except Exception as e:
            return {"success": False, "message": str(e), "count": 0}

    def get_fund_list(self) -> list[dict]:
        raise NotImplementedError("子类必须实现 get_fund_list 方法")

    def get_fund_overview(self, fund_code: str):
        raise NotImplementedError("子类必须实现 get_fund_overview 方法")

    def get_fund_history(self, fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:
        raise NotImplementedError("子类必须实现 get_fund_history 方法")

    def get_fund_rank_page(self, page_num: int = 1, page_size: int = 50, fund_type: int = 0) -> tuple[list[dict], int]:
        """
        获取基金排名分页数据。

        约定：
        - page_num/page_size：分页参数
        - fund_type：基金类型筛选（沿用东财 FundType 枚举，0=全部）
        - 返回：(items, total)
        - items 字段建议至少包含：
          - fund_code, fund_name, percentage（默认口径：日涨跌幅）
        """
        raise NotImplementedError("子类必须实现 get_fund_rank_page 方法")

    # =====================
    # 实时估值 / 涨跌幅（通用能力，子类可覆盖）
    # =====================
    FUND_GZ_URL_TEMPLATE: ClassVar[str] = "http://fundgz.1234567.com.cn/js/{fund_code}.js?rt={rt}"
    FUND_GZ_TIMEOUT: ClassVar[int] = 15
    FUND_GZ_HEADERS: ClassVar[dict] = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }

    def get_fund_holding_dates(self, fund_code: str) -> list[str]:
        raise NotImplementedError("子类必须实现 get_fund_holding_dates 方法")

    def get_fund_holdings(self, fund_code: str, report_date: str) -> dict:
        raise NotImplementedError("子类必须实现 get_fund_holdings 方法")

    def get_fund_gz(self, fund_code: str) -> dict:
        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            raise ValueError("基金代码格式错误（需 5-8 位数字）")

        url = self.FUND_GZ_URL_TEMPLATE.format(fund_code=code, rt=int(time.time() * 1000))
        req = request.Request(url, headers=self.FUND_GZ_HEADERS)
        try:
            with request.urlopen(req, timeout=self.FUND_GZ_TIMEOUT) as response:
                status_code = getattr(response, "status", response.getcode())
                if status_code != 200:
                    raise RuntimeError(f"实时估值接口请求失败，HTTP {status_code}")
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            raise RuntimeError(f"实时估值接口请求失败，HTTP {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"实时估值接口请求失败: {exc.reason}") from exc
        except TimeoutError as exc:
            raise RuntimeError("实时估值接口请求超时") from exc

        body = self._parse_fund_gz_jsonp(text)
        gszzl = body.get("gszzl")
        gztime = body.get("gztime")
        gz_time = self._normalize_gz_time(gztime)

        percentage = None
        if gszzl is not None and str(gszzl).strip() != "":
            try:
                percentage = float(gszzl)
            except (TypeError, ValueError):
                percentage = None

        return {
            "fund_code": code,
            "percentage": percentage,
            "gztime": gztime,
            "gz_time": gz_time,
            "raw": body,
        }

    def get_fund_gz_batch(self, fund_codes: list[str]) -> list[dict]:
        result: list[dict] = []
        for code in fund_codes or []:
            try:
                data = self.get_fund_gz(code)
                result.append({
                    "fund_code": data.get("fund_code", str(code)),
                    "percentage": data.get("percentage"),
                    "gztime": data.get("gztime"),
                    "gz_time": data.get("gz_time"),
                })
            except Exception as exc:
                result.append({
                    "fund_code": str(code),
                    "percentage": None,
                    "gztime": None,
                    "gz_time": None,
                    "error": str(exc),
                })
        return result

    @staticmethod
    def _parse_fund_gz_jsonp(text: str) -> dict:
        if not text or not text.strip():
            raise RuntimeError("实时估值接口返回空内容")

        match = re.search(r"jsonpgz\s*\(\s*(\{.*\})\s*\)\s*;?\s*$", text.strip(), re.S)
        if match is None:
            raise RuntimeError("实时估值接口解析失败: 非预期返回格式")

        try:
            body = json.loads(match.group(1))
        except json.JSONDecodeError as exc:
            raise RuntimeError("实时估值接口解析失败: JSON 无效") from exc

        if not isinstance(body, dict):
            raise RuntimeError("实时估值接口解析失败: 顶层数据不是对象")

        return body

    @staticmethod
    def _normalize_gz_time(gztime: str | None) -> str | None:
        if gztime is None:
            return None
        value = str(gztime).strip()
        if not value:
            return None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}", value):
            return value
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}", value):
            return value + ":00"
        return None
