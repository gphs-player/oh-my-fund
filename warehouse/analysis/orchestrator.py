"""AI 分析编排器 — 主流程"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

from .cache import AnalysisCache
from .metrics import compute_return_metrics, compute_risk_metrics, compute_holdings_metrics
from .prompt import SYSTEM_PROMPT, build_analysis_summary

_analysis_cache = AnalysisCache()


def run_fund_analysis(fund_code: str, repository, settings: dict, progress_cb=None) -> dict:
    code = str(fund_code or "").strip()
    _progress(progress_cb, "validate", "校验输入与配置", 5, "正在校验输入与配置...")
    if not re.fullmatch(r"\d{5,8}", code):
        raise ValueError("基金代码格式错误（需 5-8 位数字）")

    # 1. 查缓存
    _progress(progress_cb, "cache", "检查缓存", 10, "正在检查缓存...")
    cached = _analysis_cache.get(code)
    if cached:
        _progress(progress_cb, "done", "完成", 100, "命中缓存，已完成")
        return cached

    # 2. 读取配置
    llm_provider = str(settings.get("llm_provider") or "").strip()
    llm_api_key = str(settings.get("llm_api_key") or "").strip()
    llm_model = str(settings.get("llm_model") or "").strip()
    llm_base_url = str(settings.get("llm_base_url") or "").strip()

    if not llm_provider or not llm_api_key:
        raise ValueError("请先在设置中配置 AI 模型（provider 和 API Key）")

    holding_periods = 8
    try:
        holding_periods = int(settings.get("ai_holding_periods") or 8)
    except (TypeError, ValueError):
        pass

    # 3. 并发拉取基础数据
    _progress(progress_cb, "fetch_base", "拉取基础数据", 30, "正在拉取历史净值/持仓日期/基金概况...")
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_history = executor.submit(repository.get_fund_history, code)
        future_dates = executor.submit(repository.get_fund_holding_dates, code)
        future_overview = executor.submit(repository.get_fund_overview, code)

        history = future_history.result()
        holding_dates = future_dates.result()
        overview_raw = future_overview.result()

    # 4. 拉取持仓明细（根据配置期数）
    _progress(progress_cb, "fetch_holdings", "拉取持仓明细", 45, "正在拉取基金持仓明细...")
    dates_to_fetch = holding_dates[:holding_periods] if holding_dates else []
    holdings_list = []
    if dates_to_fetch:
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(repository.get_fund_holdings, code, d): d
                for d in dates_to_fetch
            }
            for future in futures:
                try:
                    result = future.result()
                    if result:
                        holdings_list.append(result)
                except Exception:
                    pass
        holdings_list.sort(key=lambda x: x.get("report_date", ""))

    # 5. 计算量化指标
    _progress(progress_cb, "compute", "计算量化指标", 55, "正在计算收益/风险/持仓指标...")
    overview_info = _extract_overview_info(overview_raw)
    return_metrics = compute_return_metrics(history)
    risk_metrics = compute_risk_metrics(history)
    holdings_metrics = compute_holdings_metrics(holdings_list, history, holding_dates)

    # 6. 组装摘要
    _progress(progress_cb, "summary", "组装分析摘要", 65, "正在组装分析摘要...")
    summary = build_analysis_summary(return_metrics, risk_metrics, holdings_metrics, overview_info)

    # 7. 调用 LLM
    _progress(progress_cb, "llm", "调用模型分析", 85, "正在调用模型进行分析...")
    from warehouse.llm import create_llm
    llm = create_llm(llm_provider, {
        "api_key": llm_api_key,
        "model": llm_model,
        "base_url": llm_base_url,
    })

    raw_response = llm.chat(SYSTEM_PROMPT, summary)

    # 8. 解析 LLM 返回
    _progress(progress_cb, "parse", "解析分析结果", 95, "正在解析模型返回结果...")
    result = _parse_llm_response(raw_response)

    # 9. 写缓存
    _analysis_cache.set(code, result)
    _progress(progress_cb, "done", "完成", 100, "分析完成")

    return result


def _extract_overview_info(overview_raw) -> str | None:
    if not overview_raw:
        return None
    if isinstance(overview_raw, list):
        items = []
        for item in overview_raw[:10]:
            label = item.get("label", "")
            value = item.get("value", "")
            if label and value and value != "--":
                items.append(f"{label}:{value}")
        return ", ".join(items) if items else None
    if isinstance(overview_raw, dict):
        items = []
        for k, v in list(overview_raw.items())[:10]:
            if v and str(v).strip() and str(v).strip() != "--":
                items.append(f"{k}:{v}")
        return ", ".join(items) if items else None
    return None


def _parse_llm_response(raw: str) -> dict:
    text = raw.strip()
    # 去除 markdown code fence
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 尝试从文本中提取 JSON
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError:
                raise RuntimeError(f"LLM 返回格式解析失败: {text[:200]}")
        else:
            raise RuntimeError(f"LLM 返回格式解析失败: {text[:200]}")

    score = data.get("score")
    if score is None:
        raise RuntimeError("LLM 返回缺少 score 字段")
    try:
        score = int(float(score))
    except (TypeError, ValueError):
        raise RuntimeError(f"LLM 返回 score 无效: {score}")

    score = max(0, min(100, score))

    return {
        "score": score,
        "reason": str(data.get("reason", "")),
        "factors": data.get("factors", []),
    }


def clear_analysis_cache(fund_code: str):
    _analysis_cache.clear(fund_code)


def _progress(progress_cb, key: str, label: str, percent: int, message: str):
    if not progress_cb:
        return
    try:
        progress_cb(key=key, label=label, percent=int(percent), message=message)
    except Exception:
        # 进度回调异常不应影响主流程
        pass
