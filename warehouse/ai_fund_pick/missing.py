"""AI 选基：边界缺失项识别（用于弹框补全）。"""

from __future__ import annotations


WINDOW_OPTIONS_DEFAULT = [
    {"value": "1y", "label": "近1年"},
    {"value": "3y", "label": "近3年"},
    {"value": "5y", "label": "近5年"},
    {"value": "all", "label": "成立以来"},
]


def _contains_any(text: str, keywords: list[str]) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    return any(k in s for k in keywords)


def _is_time_window_sensitive(metric_name: str) -> bool:
    return _contains_any(metric_name, ["年化", "收益", "回撤", "最大回撤", "波动", "夏普"])


def build_missing_items(draft: dict) -> list[dict]:
    """从 draft 中提取阻塞缺失项（最小必要原则）。"""
    if not isinstance(draft, dict):
        return []
    intents = draft.get("intents")
    if not isinstance(intents, list):
        return []

    items: list[dict] = []
    idx = 1

    for i, it in enumerate(intents):
        if not isinstance(it, dict):
            continue
        intent_type = str(it.get("intent_type") or "").strip()
        metric_name = str(it.get("metric_name") or "").strip()
        evidence = str(it.get("evidence") or "").strip()
        op = str(it.get("op") or "").strip()
        value = it.get("value", None)
        unit = it.get("unit", None)
        window = it.get("window", None)

        if intent_type == "hard_filter":
            # window missing (only when time-window-sensitive)
            if (window is None or str(window).strip() == "") and _is_time_window_sensitive(metric_name):
                items.append(
                    {
                        "item_id": f"m{idx}",
                        "intent_index": i,
                        "metric_name": metric_name,
                        "field": "window",
                        "evidence": evidence,
                        "problem": "未指定时间窗口",
                        "suggestion": "常见：近1年/近3年/成立以来（也可自定义）",
                        "input_type": "enum_or_text",
                        "options": WINDOW_OPTIONS_DEFAULT,
                        "required": True,
                    }
                )
                idx += 1

            # value missing
            if value is None:
                items.append(
                    {
                        "item_id": f"m{idx}",
                        "intent_index": i,
                        "metric_name": metric_name,
                        "field": "value",
                        "evidence": evidence,
                        "problem": "未指定阈值/区间",
                        "suggestion": "请填写具体数值（例如 30），或补充区间（例如 10-200）",
                        "input_type": "text",
                        "options": [],
                        "required": True,
                    }
                )
                idx += 1

            # between invalid
            if op == "between":
                if not isinstance(value, dict) or value.get("min") is None or value.get("max") is None:
                    # 上面已会被 value missing 覆盖，这里不重复加
                    pass

        if intent_type == "limit":
            if value is None:
                items.append(
                    {
                        "item_id": f"m{idx}",
                        "intent_index": i,
                        "metric_name": metric_name or "TopN",
                        "field": "value",
                        "evidence": evidence,
                        "problem": "未指定数量",
                        "suggestion": "请填写一个整数（例如 50）",
                        "input_type": "text",
                        "options": [],
                        "required": True,
                    }
                )
                idx += 1

    return items


def missing_signature(missing_items: list[dict]) -> str:
    """用于前端/后端检测重复缺失项（防止死循环）。"""
    if not isinstance(missing_items, list):
        return ""
    keys = []
    for it in missing_items:
        if not isinstance(it, dict):
            continue
        keys.append(f"{it.get('metric_name')}::{it.get('field')}::{it.get('intent_index')}")
    keys = sorted(set(keys))
    return "|".join(keys)

