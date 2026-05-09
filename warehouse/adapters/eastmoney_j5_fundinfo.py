"""
东方财富 j5 基金详情（QT）接口解析。

目的：为前端“基金详情弹层”提供 JJXQ / JDZF / JJGM / JJCC 四个 section 的 items。
注意：本模块不作为“数据源”注册，仅供 DefaultDataSource.get_fund_overview 调用。
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib import error, request


J5_URL_TEMPLATE = "http://j5.dfcfw.com/sc/tfs/qt/v2.0.1/{fund_code}.json"
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

SECTION_NAME_MAP = {
    "JJXQ": "基金详情",
    "JDZF": "阶段涨幅",
    "JJGM": "基金规模",
    "JJCC": "基金持仓",
    "JJJL": "基金经理",
}

# JJXQ 字段名尽量转中文（不全量覆盖，未知字段保持原样）
JJXQ_LABEL_MAP = {
    "FCODE": "基金代码",
    "SHORTNAME": "基金简称",
    "ESTABDATE": "成立日期",
    "JJGS": "基金规模",
    "FEGMRQ": "规模日期",
    "DWJZ": "单位净值",
    "LJJZ": "累计净值",
    "ENDNAV": "最新净值",
    "SGZT": "申购状态",
    "SHZT": "赎回状态",
    "RATE": "费率",
    "RISKLEVEL": "风险等级",
    "STDDEV1": "标准差(近1年)",
    "STDDEV2": "标准差(近2年)",
    "SHARP1": "夏普(近1年)",
    "SHARP2": "夏普(近2年)",
    "MAXRETRA1": "最大回撤(近1年)",
}


def fetch_fundinfo_items(fund_code: str, timeout: int = REQUEST_TIMEOUT) -> list[dict[str, Any]]:
    code = str(fund_code or "").strip()
    if not re.fullmatch(r"\d{5,8}", code):
        raise ValueError("基金代码格式错误（需 5-8 位数字）")

    url = J5_URL_TEMPLATE.format(fund_code=code)
    req = request.Request(url, headers=REQUEST_HEADERS)
    try:
        with request.urlopen(req, timeout=int(timeout or REQUEST_TIMEOUT)) as resp:
            status_code = getattr(resp, "status", resp.getcode())
            if status_code != 200:
                raise RuntimeError(f"j5 基金详情接口请求失败，HTTP {status_code}")
            text = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        raise RuntimeError(f"j5 基金详情接口请求失败，HTTP {exc.code}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"j5 基金详情接口请求失败: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("j5 基金详情接口请求超时") from exc

    if not text or not text.strip():
        raise RuntimeError("j5 基金详情接口返回空内容")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("j5 基金详情接口解析失败: JSON 无效") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("j5 基金详情接口解析失败: 顶层数据不是对象")

    items: list[dict[str, Any]] = []
    # j5 返回为顶层分段：JJXQ/JDZF/JJGM/JJCC/...（每段内再含 Datas/ErrCode/...）
    items.extend(_build_jjxq_items(payload.get("JJXQ")))
    items.extend(_build_jdzf_items(payload.get("JDZF")))
    items.extend(_build_raw_section_item("JJGM", payload.get("JJGM")))

    jjcc_datas = _extract_section_datas(payload.get("JJCC"))
    jjccnew_datas = _extract_section_datas(payload.get("JJCCNEW"), data_key="data")
    picked = _pick_jjcc_datas(jjcc_datas, jjccnew_datas)
    items.extend(_build_raw_section_item_from_datas("JJCC", picked))

    # 基金经理：优先 JJJL，其次 JJJLNEW（统一包装成 {"Datas": <list>} 供前端解析）
    jjjl_node = payload.get("JJJL")
    jjjl_datas = _extract_section_datas(jjjl_node)
    if not isinstance(jjjl_datas, list) or len(jjjl_datas) == 0:
        jjjl_node = payload.get("JJJLNEW")
        jjjl_datas = _extract_section_datas(jjjl_node)
    if isinstance(jjjl_datas, list) and jjjl_datas:
        items.extend(_build_raw_section_item_from_datas("JJJL", jjjl_datas))
    return items


def _mk_item(section: str, key: str, label: str, value: Any) -> dict[str, Any]:
    return {
        "section": section,
        "section_name": SECTION_NAME_MAP.get(section, section),
        "key": key,
        "label": label,
        "value": "--" if value is None or str(value).strip() == "" else str(value),
    }


def _build_jjxq_items(jjxq: Any) -> list[dict[str, Any]]:
    if not jjxq:
        return []
    if isinstance(jjxq, dict) and isinstance(jjxq.get("Datas"), dict):
        data = jjxq.get("Datas") or {}
    else:
        return []

    out: list[dict[str, Any]] = []
    # 保持一定可读顺序：优先常见字段，再追加剩余字段
    preferred_keys = list(JJXQ_LABEL_MAP.keys())
    seen: set[str] = set()
    for k in preferred_keys:
        if k in data:
            seen.add(k)
            out.append(_mk_item("JJXQ", k, JJXQ_LABEL_MAP.get(k, k), data.get(k)))
    for k in sorted(data.keys()):
        if k in seen:
            continue
        out.append(_mk_item("JJXQ", k, JJXQ_LABEL_MAP.get(k, k), data.get(k)))
    return out


def _build_jdzf_items(jdzf: Any) -> list[dict[str, Any]]:
    """
    目标：生成 key 形如 `Z.syl` / `Z.rank` 的 items，以兼容前端 buildJdzfModel()
    """
    if not jdzf:
        return []
    if isinstance(jdzf, dict) and isinstance(jdzf.get("Datas"), (list, dict)):
        data = jdzf.get("Datas")
    else:
        return []

    # 允许多种结构：
    # - dict: {"Z": {"syl":..,"rank":..}, ...}
    # - list: [{"period":"Z","syl":..}, ...]
    out: list[dict[str, Any]] = []

    def emit(period: str, field: str, value: Any):
        p = str(period or "").strip().upper()
        f = str(field or "").strip().lower()
        if not p or f not in {"syl", "avg", "hs300", "rank", "sc", "diff"}:
            return
        out.append(_mk_item("JDZF", f"{p}.{f}", f"{p}.{f}", value))

    if isinstance(data, dict):
        for period, row in data.items():
            if not isinstance(row, dict):
                continue
            for f in ["syl", "avg", "hs300", "rank", "sc", "diff"]:
                if f in row:
                    emit(str(period), f, row.get(f))
    elif isinstance(data, list):
        for row in data:
            if not isinstance(row, dict):
                continue
            period = (
                row.get("title")
                or row.get("TITLE")
                or row.get("period")
                or row.get("PERIOD")
                or row.get("code")
                or row.get("CODE")
            )
            if not period:
                continue
            for f in ["syl", "avg", "hs300", "rank", "sc", "diff"]:
                if f in row:
                    emit(str(period), f, row.get(f))
    else:
        return []

    return out


def _build_raw_section_item(section: str, raw_payload: Any) -> list[dict[str, Any]]:
    """
    前端 JJGM/JJCC 目前依赖 raw JSON 字符串解析后再画图。
    因此这里只要保证 value 是 JSON 字符串即可（尽量保持原始结构）。
    """
    if raw_payload is None:
        return []
    # j5 每段结构通常为 {"Datas": ..., "ErrCode": ..., ...}
    # 前端 JJGM/JJCC 目前固定读取 payload.Datas...，因此这里强制只透传 Datas 并包一层 {"Datas": ...}
    datas = None
    if isinstance(raw_payload, dict):
        datas = raw_payload.get("Datas")
    wrapped = {"Datas": datas}
    try:
        text = json.dumps(wrapped, ensure_ascii=False)
    except Exception:
        return []
    return [_mk_item(section, "raw", "raw", text)]


def _extract_section_datas(node: Any, data_key: str = "Datas"):
    if not isinstance(node, dict):
        return None
    return node.get(data_key)


def _has_meaningful_jjcc(datas: Any) -> bool:
    if not isinstance(datas, dict):
        return False
    inv = datas.get("InverstPosition") or {}
    stocks = inv.get("fundStocks")
    has_stocks = isinstance(stocks, list) and len(stocks) > 0

    asset = datas.get("AssetAllocation")
    has_asset = isinstance(asset, dict) and len(asset.keys()) > 0

    sector = datas.get("SectorAllocation")
    has_sector = isinstance(sector, dict) and len(sector.keys()) > 0

    return bool(has_stocks or has_asset or has_sector)


def _pick_jjcc_datas(jjcc_datas: Any, jjccnew_datas: Any):
    # 优先 JJCC；但如果 JJCC 没有任何可视化所需数据，则回退到 JJCCNEW
    if _has_meaningful_jjcc(jjcc_datas):
        return jjcc_datas
    if _has_meaningful_jjcc(jjccnew_datas):
        return jjccnew_datas
    return jjcc_datas or jjccnew_datas


def _build_raw_section_item_from_datas(section: str, datas: Any) -> list[dict[str, Any]]:
    if datas is None:
        return []
    # 统一 raw 格式：顶层必须有 Datas，供前端按 payload.Datas 读取
    wrapped = {"Datas": datas}
    try:
        text = json.dumps(wrapped, ensure_ascii=False)
    except Exception:
        return []
    return [_mk_item(section, "raw", "raw", text)]
