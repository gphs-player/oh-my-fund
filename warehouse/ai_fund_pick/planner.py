"""AI 选基：Step2（draft -> 可执行 plan）。

职责：
- 调用 LLM，将 draft JSON 编译为 plan JSON（严格可解析）
- 对模型输出做 JSON 清洗与结构校验（确保可执行 plan 的最小结构正确）
"""

from __future__ import annotations

import json
from typing import Any

from warehouse.llm import create_llm

from .plan_prompt import SYSTEM_PROMPT, build_user_message


class FundPickPlanError(ValueError):
    pass


def _strip_code_fence(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    return s


def _extract_first_json_object(text: str) -> str:
    """从任意文本中提取第一个 JSON object 子串（{...}）。"""
    s = (text or "")
    start = s.find("{")
    if start < 0:
        raise FundPickPlanError("模型输出不包含 JSON 对象（缺少 '{'）")

    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = False
            continue

        if ch == '"':
            in_str = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start : i + 1]

    raise FundPickPlanError("模型输出包含 '{' 但无法匹配到完整 JSON 对象（可能括号不闭合）")


def _validate_and_normalize_plan(plan: Any, capabilities: dict) -> dict:
    if not isinstance(plan, dict):
        raise FundPickPlanError("模型输出 JSON 顶层必须为对象")

    plan_version = str(plan.get("plan_version") or "v1").strip() or "v1"

    # universe
    universe = plan.get("universe")
    if not isinstance(universe, dict):
        universe = {"mode": "all", "hints": [], "scan_limit": None}
    else:
        mode = str(universe.get("mode") or "all").strip() or "all"
        hints = universe.get("hints")
        if not isinstance(hints, list):
            hints = []
        scan_limit = universe.get("scan_limit", None)
        universe = {"mode": mode, "hints": hints, "scan_limit": scan_limit}

    # steps
    raw_steps = plan.get("steps")
    if not isinstance(raw_steps, list):
        raw_steps = []

    supported_step_types = set(capabilities.get("supported_step_types") or [])
    supported_windows = set(capabilities.get("supported_windows") or [])
    supported_ops = capabilities.get("supported_ops") or {}
    metric_catalog = capabilities.get("metric_catalog") or {}

    normalized_steps: list[dict] = []
    for i, st in enumerate(raw_steps):
        if not isinstance(st, dict):
            continue
        step_type = str(st.get("step_type") or "").strip()
        if not step_type:
            continue
        if supported_step_types and step_type not in supported_step_types:
            # 允许通过，但标记为 unknown，避免前端/执行器直接崩
            raise FundPickPlanError(f"第 {i+1} 条 step_type 不受支持：{step_type}")

        intent_index = st.get("intent_index", -1)
        try:
            intent_index = int(intent_index)
        except Exception:
            intent_index = -1

        metric_key = st.get("metric_key", None)
        metric_key = None if metric_key is None else str(metric_key).strip() or None
        if metric_key and metric_catalog and metric_key not in metric_catalog:
            raise FundPickPlanError(f"第 {i+1} 条 metric_key 不在能力清单中：{metric_key}")

        window = st.get("window", None)
        if window is not None:
            window = str(window).strip() or None
        if supported_windows and window not in supported_windows:
            raise FundPickPlanError(f"第 {i+1} 条 window 不受支持：{window}")

        op = st.get("op", None)
        op = None if op is None else str(op).strip() or None
        # op 校验按 step_type 粗略映射（filter/score/sort/limit）
        op_bucket = None
        if step_type == "filter":
            op_bucket = "hard_filter"
        elif step_type == "score":
            op_bucket = "soft_preference"
        elif step_type == "sort":
            op_bucket = "sort"
        elif step_type == "limit":
            op_bucket = "limit"
        if op_bucket and op:
            allowed = supported_ops.get(op_bucket) or []
            if allowed and op not in allowed:
                raise FundPickPlanError(f"第 {i+1} 条 op 不受支持：{op}")

        priority = str(st.get("priority") or "medium").strip() or "medium"
        if priority not in {"high", "medium", "low"}:
            priority = "medium"

        source = st.get("source")
        if not isinstance(source, dict):
            source = {"requires": []}
        requires = source.get("requires")
        if not isinstance(requires, list):
            requires = []
        source = {"requires": requires}

        explain = st.get("explain")
        if not isinstance(explain, dict):
            explain = {"metric_name": "", "evidence": ""}
        explain_metric_name = str(explain.get("metric_name") or "").strip()
        explain_evidence = str(explain.get("evidence") or "").strip()
        explain = {"metric_name": explain_metric_name, "evidence": explain_evidence}

        normalized_steps.append(
            {
                "step_type": step_type,
                "intent_index": intent_index,
                "metric_key": metric_key,
                "window": window,
                "op": op,
                "value": st.get("value", None),
                "unit": st.get("unit", None),
                "priority": priority,
                "source": source,
                "explain": explain,
            }
        )

    # need_clarify / unsupported_intents
    need_clarify = plan.get("need_clarify")
    if not isinstance(need_clarify, list):
        need_clarify = []
    unsupported_intents = plan.get("unsupported_intents")
    if not isinstance(unsupported_intents, list):
        unsupported_intents = []

    notes = str(plan.get("notes") or "").strip()

    return {
        "plan_version": plan_version,
        "universe": universe,
        "steps": normalized_steps,
        "need_clarify": need_clarify,
        "unsupported_intents": unsupported_intents,
        "notes": notes,
    }


def build_fund_pick_plan(draft: dict, capabilities: dict, llm_config: dict) -> dict:
    """调用 LLM 编译 draft -> plan，返回 plan dict（保证可 JSON 序列化）。"""
    if not isinstance(draft, dict) or not draft:
        raise FundPickPlanError("draft 无效或为空")
    if not isinstance(capabilities, dict) or not capabilities:
        raise FundPickPlanError("capabilities 缺失或为空")

    provider = str(llm_config.get("provider") or "").strip()
    api_key = str(llm_config.get("api_key") or "").strip()
    model = str(llm_config.get("model") or "").strip()
    base_url = str(llm_config.get("base_url") or "").strip()
    if not provider or not api_key:
        raise FundPickPlanError("LLM 配置缺失（provider/api_key）")

    llm = create_llm(provider, {
        "api_key": api_key,
        "model": model,
        "base_url": base_url,
    })

    user_message = build_user_message(capabilities, draft)
    raw = llm.chat(SYSTEM_PROMPT, user_message)
    if not raw or not str(raw).strip():
        raise FundPickPlanError("模型未返回内容")

    text = _strip_code_fence(str(raw))
    json_text = _extract_first_json_object(text)
    try:
        obj = json.loads(json_text)
    except Exception as exc:
        raise FundPickPlanError(f"模型输出格式错误，无法解析为 JSON：{exc}") from exc

    return _validate_and_normalize_plan(obj, capabilities)

