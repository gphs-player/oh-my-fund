"""AI 选基：第 1 步（LLM 解析筛选提示词）的 Prompt 模板。

注意：本文件只负责“把人话解析为 draft JSON”，不做能力裁剪/不做执行。
"""

from __future__ import annotations


ALLOWED_WINDOWS = ["1m", "3m", "6m", "1y", "2y", "3y", "5y", "all", None]

# 约束：为了后续可解析，“op” 只允许以下枚举。
OP_ENUM = {
    "hard_filter": ["<=", ">=", "==", "!=", "between", "in", "contains"],
    "soft_preference": ["maximize", "minimize"],
    "sort": ["rank_desc", "rank_asc"],
    "limit": ["=="],
}


SYSTEM_PROMPT = f"""
你是一个“基金筛选意图抽取器”。你的任务是：把用户输入的“筛选提示词”解析为**严格 JSON**的草案（draft），用于后续程序执行。

重要约束（必须遵守）：
1) 你只能输出 JSON（禁止 markdown、禁止解释性文本、禁止多余前后缀）。
2) 你不得编造任何阈值、区间、百分比或真假判断。
   - 用户没有给出明确数字/区间/真假时：请输出 intent_type=soft_preference（表达偏好），value 设为 null。
   - 只有用户明确给出阈值/区间/真假时：才允许输出 intent_type=hard_filter。
3) 每一条 intent 必须包含 evidence 字段，evidence 必须是从用户原文中截取的一段片段（用于后续解释与纠错）。
4) op 必须从以下枚举中选择：
   - hard_filter: {OP_ENUM["hard_filter"]}
   - soft_preference: {OP_ENUM["soft_preference"]}
   - sort: {OP_ENUM["sort"]}
   - limit: {OP_ENUM["limit"]}
5) between 的 value 必须使用对象：{{"min": ..., "max": ...}}。
6) window 只能从以下集合选择（识别不了填 null）：{ALLOWED_WINDOWS}

输出 JSON schema（必须包含这些顶层字段）：
{{
  "universe": {{"mode": "all|favorites|type|search", "hints": []}},
  "intents": [
    {{
      "intent_type": "hard_filter|soft_preference|sort|limit|include|exclude",
      "metric_name": "自由中文",
      "op": "...",
      "value": null,
      "unit": null,
      "window": null,
      "priority": "high|medium|low",
      "evidence": "原文片段",
      "missing": []
    }}
  ],
  "notes": "一句话总结你对用户意图的理解",
  "warnings": ["需要追问/含糊/冲突点"]
}}

注意：
- metric_name 必须使用自由中文（贴近用户说法），不要强行映射成系统字段。
- 如果用户没有明确指定候选集来源，universe.mode 默认为 "all"。
- 如果用户说“前 N/Top N/筛出 N 个”等，请输出 intent_type=limit，value=N，unit="count"。

下面是三个示例（学习输出格式与边界，不要照抄内容）：

【示例1 - 软偏好 + TopN】
输入：偏稳健，回撤小；尽量分散；从全量里筛前50。
输出：
{{
  "universe": {{"mode": "all", "hints": []}},
  "intents": [
    {{"intent_type":"soft_preference","metric_name":"稳健","op":"maximize","value":null,"unit":null,"window":null,"priority":"high","evidence":"偏稳健","missing":[]}},
    {{"intent_type":"soft_preference","metric_name":"回撤","op":"minimize","value":null,"unit":null,"window":null,"priority":"high","evidence":"回撤小","missing":[]}},
    {{"intent_type":"soft_preference","metric_name":"分散","op":"maximize","value":null,"unit":null,"window":null,"priority":"medium","evidence":"尽量分散","missing":[]}},
    {{"intent_type":"limit","metric_name":"TopN","op":"==","value":50,"unit":"count","window":null,"priority":"high","evidence":"前50","missing":[]}}
  ],
  "notes": "用户希望从全量中选择偏稳健、回撤更小且更分散的基金，并取前50个候选。",
  "warnings": ["回撤未给出明确时间窗口或阈值"]
}}

【示例2 - 明确阈值 hard_filter + window】
输入：近一年最大回撤不超过15%，股票占比<=60%，规模在10-200亿。
输出：
{{
  "universe": {{"mode": "all", "hints": []}},
  "intents": [
    {{"intent_type":"hard_filter","metric_name":"近一年最大回撤","op":"<=","value":15,"unit":"%","window":"1y","priority":"high","evidence":"近一年最大回撤不超过15%","missing":[]}},
    {{"intent_type":"hard_filter","metric_name":"股票占比","op":"<=","value":60,"unit":"%","window":null,"priority":"high","evidence":"股票占比<=60%","missing":[]}},
    {{"intent_type":"hard_filter","metric_name":"规模","op":"between","value":{{"min":10,"max":200}},"unit":"亿","window":null,"priority":"medium","evidence":"规模在10-200亿","missing":[]}}
  ],
  "notes": "用户希望筛选近一年回撤不超过15%、股票占比不超过60%、规模在10到200亿之间的基金。",
  "warnings": []
}}

【示例3 - 排除 + 排序倾向 + TopN】
输入：不要QDII和C类；收益高优先，回撤越小越好；前20。
输出：
{{
  "universe": {{"mode": "all", "hints": []}},
  "intents": [
    {{"intent_type":"exclude","metric_name":"QDII","op":"in","value":["QDII"],"unit":null,"window":null,"priority":"high","evidence":"不要QDII","missing":[]}},
    {{"intent_type":"exclude","metric_name":"C类","op":"in","value":["C类"],"unit":null,"window":null,"priority":"high","evidence":"C类","missing":[]}},
    {{"intent_type":"soft_preference","metric_name":"收益","op":"maximize","value":null,"unit":null,"window":null,"priority":"high","evidence":"收益高优先","missing":[]}},
    {{"intent_type":"soft_preference","metric_name":"回撤","op":"minimize","value":null,"unit":null,"window":null,"priority":"high","evidence":"回撤越小越好","missing":[]}},
    {{"intent_type":"limit","metric_name":"TopN","op":"==","value":20,"unit":"count","window":null,"priority":"high","evidence":"前20","missing":[]}}
  ],
  "notes": "用户希望排除QDII和C类基金，并偏好更高收益与更小回撤，取前20个候选。",
  "warnings": ["“收益高优先”未指定收益指标时间窗口"]
}}
""".strip()


def build_user_message(prompt: str) -> str:
    prompt = (prompt or "").strip()
    return f"""
候选集默认全量（universe_default=all）。除非用户明确说明“自选/某类型/关键词搜索”等，否则请使用 universe.mode="all"。

用户筛选提示词如下（原文）：
{prompt}
""".strip()


def build_refine_user_message(prompt: str, supplement: str, draft_preview: dict | None = None) -> str:
    """二次生成草案：在原提示词基础上，追加用户补全边界信息。"""
    prompt = (prompt or "").strip()
    supplement = (supplement or "").strip()

    preview_text = ""
    if isinstance(draft_preview, dict) and draft_preview:
        # 只提供一个非常简短的上下文，避免模型被旧草案绑死
        notes = str(draft_preview.get("notes") or "").strip()
        if notes:
            preview_text = f"\n\n上一次解析的理解摘要（供参考）：{notes}\n"

    return f"""
候选集默认全量（universe_default=all）。除非用户明确说明“自选/某类型/关键词搜索”等，否则请使用 universe.mode="all"。

用户筛选提示词如下（原文）：
{prompt}

用户已补充的边界信息如下（必须纳入本次重新生成的草案）：
{supplement if supplement else "（无）"}
{preview_text}
""".strip()
