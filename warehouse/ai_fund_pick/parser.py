"""AI 选基：第 1 步（LLM 解析筛选提示词）。

职责：
- 调用 LLM，将用户提示词解析为 draft JSON（严格可解析）
- 对模型输出做 JSON 清洗与轻量结构校验（不做 capabilities 判断）
"""

from __future__ import annotations

import json
from typing import Any

from warehouse.llm import create_llm

from .prompt import OP_ENUM, SYSTEM_PROMPT, build_user_message


class FundPickParseError(ValueError):
    pass


def _strip_code_fence(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        # 允许 ```json / ``` 包裹
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
        raise FundPickParseError("模型输出不包含 JSON 对象（缺少 '{'）")

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

    raise FundPickParseError("模型输出包含 '{' 但无法匹配到完整 JSON 对象（可能括号不闭合）")


def _validate_and_normalize_draft(draft: Any) -> dict:
    if not isinstance(draft, dict):
        raise FundPickParseError("模型输出 JSON 顶层必须为对象")

    universe = draft.get("universe")
    if not isinstance(universe, dict):
        universe = {"mode": "all", "hints": []}
    else:
        mode = str(universe.get("mode") or "all").strip() or "all"
        hints = universe.get("hints")
        if not isinstance(hints, list):
            hints = []
        universe = {"mode": mode, "hints": hints}

    intents = draft.get("intents")
    if not isinstance(intents, list):
        intents = []

    warnings: list[str] = []
    if isinstance(draft.get("warnings"), list):
        warnings = [str(x) for x in draft.get("warnings") if str(x).strip()]

    notes = str(draft.get("notes") or "").strip()

    # 轻量校验 intents
    normalized_intents = []
    for idx, it in enumerate(intents):
        if not isinstance(it, dict):
            warnings.append(f"第 {idx+1} 条 intent 不是对象，已忽略")
            continue

        intent_type = str(it.get("intent_type") or "").strip()
        metric_name = str(it.get("metric_name") or "").strip()
        op = str(it.get("op") or "").strip()
        evidence = str(it.get("evidence") or "").strip()

        if not intent_type or not metric_name or not op or not evidence:
            warnings.append(f"第 {idx+1} 条 intent 缺少必要字段（intent_type/metric_name/op/evidence），已忽略")
            continue

        allowed_ops = []
        if intent_type in OP_ENUM:
            allowed_ops = OP_ENUM[intent_type]
        # include/exclude 目前不在 OP_ENUM，允许通过但给 warning
        if allowed_ops and op not in allowed_ops:
            warnings.append(f"第 {idx+1} 条 intent 的 op 不在允许集合内：{op}")

        missing = it.get("missing")
        if not isinstance(missing, list):
            missing = []

        normalized_intents.append(
            {
                "intent_type": intent_type,
                "metric_name": metric_name,
                "op": op,
                "value": it.get("value", None),
                "unit": it.get("unit", None),
                "window": it.get("window", None),
                "priority": it.get("priority", "medium") or "medium",
                "evidence": evidence,
                "missing": missing,
            }
        )

    return {
        "universe": universe,
        "intents": normalized_intents,
        "notes": notes,
        "warnings": warnings,
    }


def parse_fund_pick_prompt(prompt: str, llm_config: dict) -> dict:
    """调用 LLM 解析筛选提示词，返回 draft dict（保证可 JSON 序列化）。"""
    prompt = str(prompt or "").strip()
    if not prompt:
        raise FundPickParseError("提示词不能为空")

    provider = str(llm_config.get("provider") or "").strip()
    api_key = str(llm_config.get("api_key") or "").strip()
    model = str(llm_config.get("model") or "").strip()
    base_url = str(llm_config.get("base_url") or "").strip()

    if not provider or not api_key:
        raise FundPickParseError("LLM 配置缺失（provider/api_key）")

    llm = create_llm(
        provider,
        {
            "api_key": api_key,
            "model": model,
            "base_url": base_url,
        },
    )

    raw = llm.chat(
        system_prompt=SYSTEM_PROMPT,
        user_message=build_user_message(prompt),
    )
    raw = (raw or "").strip()
    if not raw:
        raise FundPickParseError("模型未返回内容")

    candidate = _strip_code_fence(raw)
    try:
        data = json.loads(candidate)
    except Exception:
        try:
            blob = _extract_first_json_object(candidate)
            data = json.loads(blob)
        except Exception as exc:
            raise FundPickParseError(f"模型输出格式错误，无法解析为 JSON：{exc}") from exc

    return _validate_and_normalize_draft(data)

