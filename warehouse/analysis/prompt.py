"""Prompt 工程 — System prompt + 摘要组装"""

SYSTEM_PROMPT = """你是一个专业的基金分析师。根据提供的量化指标数据，对该基金进行综合评估并给出投资评分。

评分规则：
- 评分范围 0-100
- 80-100：强烈建议买入（收益优秀、风险可控、持仓合理）
- 60-79：建议买入（整体表现良好，有小瑕疵）
- 40-59：持有观望（表现中性，需观察）
- 20-39：建议卖出（风险偏高或收益不佳）
- 0-19：强烈建议卖出（严重问题）

分析要求：
1. 综合考虑收益能力、风险水平、持仓分析三个维度
2. 不要只看单一指标，要综合判断
3. 对于成立时间短的基金，适当降低置信度
4. reason 用一句话概括核心判断依据
5. 每个 factor 的 detail 控制在 50 字以内

你必须严格返回以下 JSON 格式，不要包含任何其他文字：
{
  "score": 75,
  "reason": "一句话总结评分理由",
  "factors": [
    {"name": "收益能力", "signal": "positive", "detail": "具体分析"},
    {"name": "风险水平", "signal": "neutral", "detail": "具体分析"},
    {"name": "持仓分析", "signal": "negative", "detail": "具体分析"}
  ]
}

signal 取值：positive（正面）、neutral（中性）、negative（负面）"""


def build_analysis_summary(
    return_metrics: dict,
    risk_metrics: dict,
    holdings_metrics: dict,
    overview_info: dict | None = None,
) -> str:
    parts = []

    # 基金基本信息
    if overview_info:
        parts.append(f"【基金信息】{overview_info}")

    # 收益能力
    parts.append("【收益能力】")
    period_returns = return_metrics.get("period_returns", {})
    if period_returns:
        items = []
        label_map = {
            "1m": "近1月", "3m": "近3月", "6m": "近6月",
            "1y": "近1年", "2y": "近2年", "3y": "近3年",
            "since_inception": "成立以来",
        }
        for key in ["1m", "3m", "6m", "1y", "2y", "3y", "since_inception"]:
            if key in period_returns:
                items.append(f"{label_map[key]}: {period_returns[key]}%")
        parts.append("  收益率: " + ", ".join(items))

    annualized = return_metrics.get("annualized_return")
    if annualized is not None:
        parts.append(f"  年化收益率: {annualized}%")

    total_days = return_metrics.get("total_days")
    if total_days:
        years = round(total_days / 365, 1)
        parts.append(f"  数据跨度: {years}年")

    # 风险水平
    parts.append("【风险水平】")
    md = risk_metrics.get("max_drawdown")
    vol = risk_metrics.get("annualized_volatility")
    sharpe = risk_metrics.get("sharpe_ratio")
    if md is not None:
        parts.append(f"  最大回撤: {md}%")
    if vol is not None:
        parts.append(f"  年化波动率: {vol}%")
    if sharpe is not None:
        parts.append(f"  夏普比率: {sharpe}")

    # 持仓分析
    parts.append("【持仓分析】")
    top5 = holdings_metrics.get("top5_concentration")
    top10 = holdings_metrics.get("top10_concentration")
    turnover = holdings_metrics.get("turnover_ratio")
    if top5 is not None:
        parts.append(f"  前5大重仓占比: {top5}%")
    if top10 is not None:
        parts.append(f"  前10大重仓占比: {top10}%")
    if turnover is not None:
        parts.append(f"  平均调仓换手率: {turnover}%（Jaccard距离，越高换手越频繁）")

    post_returns = holdings_metrics.get("post_rebalance_returns") or []
    if post_returns:
        parts.append("  调仓前后净值表现:")
        for pr in post_returns[-4:]:  # 最近4期
            pre = pr.get("pre_20d_return")
            post = pr.get("post_20d_return")
            pre_str = f"{pre}%" if pre is not None else "N/A"
            post_str = f"{post}%" if post is not None else "N/A"
            parts.append(f"    {pr['report_date']}: 前20日{pre_str} → 后20日{post_str}")

    return "\n".join(parts)
