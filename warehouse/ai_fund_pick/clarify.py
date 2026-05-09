"""AI 选基：第 1 步（解析 draft）后的“最小必要交互”边界补全。

职责：
- 根据 draft 判断是否存在阻塞缺失项（blocking missing）
- 生成 questions（供前端交互补全）
- 将 answers 回填进 draft，生成 draft_final

说明：
本模块不做 capabilities 判断/降级；仅做语义边界补全。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


WINDOW_OPTIONS_DEFAULT = [
    {"value": "1y", "label": "近1年"},
    {"value": "3y", "label": "近3年"},
    {"value": "5y", "label": "近5年"},
    {"value": "all", "label": "成立以来"},
]

WINDOW_OPTIONS_DRAWDOWN = [
    {"value": "6m", "label": "近6个月"},
    {"value": "1y", "label": "近1年"},
    {"value": "3y", "label": "近3年"},
    {"value": "all", "label": "成立以来"},
]


def _contains_any(text: str, keywords: list[str]) -> bool:
    s = (text or "").strip()
    if not s:
        return False
    return any(k in s for k in keywords)


def _is_time_window_sensitive(metric_name: str) -> bool:
    # 允许自由中文，做最小关键词匹配即可
    return _contains_any(
        metric_name,
        [
            "年化",
            "收益",
            "回撤",
            "最大回撤",
            "波动",
            "夏普",
            "成立以来",
            "近一年",
            "近1年",
            "近三年",
            "近3年",
        ],
    )


def _pick_window_options(metric_name: str) -> list[dict]:
    if _contains_any(metric_name, ["回撤", "最大回撤"]):
        return WINDOW_OPTIONS_DRAWDOWN
    return WINDOW_OPTIONS_DEFAULT


def _blocking_missing_for_intent(intent: dict) -> list[str]:
    intent_type = str(intent.get("intent_type") or "").strip()
    op = str(intent.get("op") or "").strip()
    metric_name = str(intent.get("metric_name") or "").strip()
    value = intent.get("value", None)
    window = intent.get("window", None)

    missing: list[str] = []

    if intent_type == "hard_filter":
        # 1) hard_filter 缺 value
        if value is None:
            missing.append("value")
        # 2) hard_filter 时间窗口敏感指标缺 window
        if (window is None or str(window).strip() == "") and _is_time_window_sensitive(metric_name):
            missing.append("window")
        # 3) between 缺 min/max
        if op == "between":
            if not isinstance(value, dict) or value.get("min") is None or value.get("max") is None:
                if "value" not in missing:
                    missing.append("value")

    if intent_type == "limit":
        if value is None:
            missing.append("value")

    return missing


def build_questions(draft: dict) -> list[dict]:
    intents = draft.get("intents") if isinstance(draft, dict) else None
    if not isinstance(intents, list):
        return []

    questions: list[dict] = []
    q_idx = 1

    for i, it in enumerate(intents):
        if not isinstance(it, dict):
            continue
        blocking = _blocking_missing_for_intent(it)
        metric_name = str(it.get("metric_name") or "").strip()

        # window 缺失：生成一个 window 选择题
        if "window" in blocking:
            questions.append(
                {
                    "question_id": f"q{q_idx}",
                    "intent_index": i,
                    "field": "window",
                    "title": f"请指定「{metric_name or '该指标'}」的计算区间",
                    "options": _pick_window_options(metric_name),
                }
            )
            q_idx += 1

        # value 缺失：目前先不做自由输入，避免复杂度
        # 这类缺失先作为 blocking 提示，在 UI 上提示“请补充阈值”，但不提供输入控件（后续迭代）
        if "value" in blocking:
            questions.append(
                {
                    "question_id": f"q{q_idx}",
                    "intent_index": i,
                    "field": "value",
                    "title": f"请补充「{metric_name or '该指标'}」的阈值/区间（当前未提供）",
                    "options": [],
                }
            )
            q_idx += 1

    return questions


def apply_answers(draft: dict, questions: list[dict], answers: list[dict]) -> dict:
    """将 answers 回填进 draft，返回 draft_final。

    校验原则（防发散）：
    - answers 的 question_id 必须存在于 questions
    - value 必须在对应 options 内（若 options 为空则拒绝）
    """
    if not isinstance(draft, dict):
        raise ValueError("draft 无效")
    if not isinstance(questions, list):
        questions = []
    if not isinstance(answers, list):
        answers = []

    qmap = {str(q.get("question_id")): q for q in questions if isinstance(q, dict) and q.get("question_id")}
    intents = draft.get("intents")
    if not isinstance(intents, list):
        intents = []
        draft["intents"] = intents

    for ans in answers:
        if not isinstance(ans, dict):
            continue
        qid = str(ans.get("question_id") or "").strip()
        if not qid or qid not in qmap:
            raise ValueError("answers 包含未知 question_id")
        q = qmap[qid]
        idx = q.get("intent_index")
        field = str(q.get("field") or "").strip()
        if not isinstance(idx, int) or idx < 0 or idx >= len(intents):
            raise ValueError("question 指向的 intent_index 无效")

        opt_list = q.get("options") or []
        if not isinstance(opt_list, list) or not opt_list:
            # value 类问题暂不支持填写，保持阻塞
            raise ValueError("该问题暂不支持在页面补全，请修改提示词提供明确阈值")

        val = ans.get("value")
        allowed_values = {o.get("value") for o in opt_list if isinstance(o, dict) and o.get("value") is not None}
        if val not in allowed_values:
            raise ValueError("答案不在可选项范围内")

        intents[idx][field] = val

        # 清理 missing：统一成数组即可（不强依赖内容）
        missing = intents[idx].get("missing")
        if not isinstance(missing, list):
            missing = []
        # 兼容：missing 里可能是中文描述字符串
        intents[idx]["missing"] = [m for m in missing if str(field) not in str(m)]

    return draft

