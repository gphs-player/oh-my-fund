"""AI 选基：Step2 用的能力清单（capabilities）。

用途：
- 作为 Step2（draft -> 可执行 plan）大模型的强约束输入，防止生成不可执行的步骤
- 作为后端校验的枚举/白名单来源（windows/ops/metric_key 等）

说明：
- v1 版本先用 Python dict 固化（最小可用），后续可迁移为 JSON 或由脚本生成
- 数据源能力以代码为准；字段语义可参考 docs/datasource-capabilities.md
"""

from __future__ import annotations


CAPABILITIES_V1 = {
    "version": "v1",
    # ---- 全局枚举约束（尽量与 Step1 prompt.py 对齐）----
    "supported_windows": ["1m", "3m", "6m", "1y", "2y", "3y", "5y", "all", None],
    "supported_ops": {
        "hard_filter": ["<=", ">=", "==", "!=", "between", "in", "contains"],
        "soft_preference": ["maximize", "minimize"],
        "sort": ["rank_desc", "rank_asc"],
        "limit": ["=="],
    },
    "supported_step_types": ["compute", "filter", "score", "sort", "limit"],

    # ---- 候选集能力（universe）----
    "universe": {
        "supported_modes": ["all", "favorites", "type", "search"],
        # 执行器尚未实现时，Step2 也需要用这些约束决定 scan_limit/建议降级
        "scan_limit_max": 2000,
        "notes": "v1 建议从全量基金列表或分页基金榜取候选；全量扫描需设置 scan_limit 防止不可控。",
    },

    # ---- 指标目录（metric_catalog）----
    # metric_key：给 Step2/Step3 用的稳定 key；label：人类可读；requires：需要的取数来源
    "metric_catalog": {
        # 候选集/榜单类（轻量）
        "rank_daily_change_pct": {
            "label": "日涨跌幅",
            "requires": ["rank_page"],
            "window_required": False,
            "value_type": "number",
            "unit": "%",
            "notes": "来自 /api/funds（基金排名分页）里的 percentage 字段（如为空则不可用）。",
        },

        # 历史净值类（中/重）
        "return_pct": {
            "label": "区间收益率",
            "requires": ["history"],
            "window_required": True,
            "value_type": "number",
            "unit": "%",
            "notes": "由历史净值计算指定窗口收益率。",
        },
        "max_drawdown_pct": {
            "label": "最大回撤",
            "requires": ["history"],
            "window_required": True,
            "value_type": "number",
            "unit": "%",
            "notes": "由历史净值计算窗口最大回撤。",
        },
        "volatility_annualized_pct": {
            "label": "年化波动率",
            "requires": ["history"],
            "window_required": True,
            "value_type": "number",
            "unit": "%",
            "notes": "由历史净值日收益序列计算年化波动。",
        },

        # 持仓类（需要 holdings）
        "stock_percent": {
            "label": "股票仓位/股票占比",
            "requires": ["holdings_latest"],
            "window_required": False,
            "value_type": "number",
            "unit": "%",
            "notes": "来自 holdings 最新一期 stock_percent（若数据源无该字段则不可用）。",
        },
        "bond_percent": {
            "label": "债券占比",
            "requires": ["holdings_latest"],
            "window_required": False,
            "value_type": "number",
            "unit": "%",
            "notes": "来自 holdings 最新一期 bond_percent。",
        },
        "top10_concentration_pct": {
            "label": "前十持仓集中度",
            "requires": ["holdings_latest"],
            "window_required": False,
            "value_type": "number",
            "unit": "%",
            "notes": "由 holdings 最新一期 stock_list 前10 percent 求和得到。",
        },

        # 概况类（overview）
        "purchase_status": {
            "label": "申购状态",
            "requires": ["overview_or_list"],
            "window_required": False,
            "value_type": "string",
            "unit": None,
            "notes": "优先用基金列表字段 sgzt，其次从 overview 文本解析。",
        },
        "fund_scale_yi": {
            "label": "基金规模",
            "requires": ["overview"],
            "window_required": False,
            "value_type": "number",
            "unit": "亿",
            "notes": "从 overview 文本解析数值（规则需另实现）。",
        },
        "inception_date": {
            "label": "成立日期",
            "requires": ["overview"],
            "window_required": False,
            "value_type": "date",
            "unit": None,
            "notes": "从 overview 文本解析 YYYY-MM-DD。",
        },
    },

    # ---- 中文意图映射辅助（metric_aliases）----
    # Step2 用：把 draft.metric_name（自由中文）归一化到 metric_key
    "metric_aliases": {
        # 榜单
        "日涨跌幅": ["rank_daily_change_pct"],
        "涨跌幅": ["rank_daily_change_pct", "return_pct"],  # 需要 window 时倾向 return_pct
        "涨幅": ["return_pct", "rank_daily_change_pct"],
        "收益": ["return_pct"],
        "收益率": ["return_pct"],

        # 风险
        "回撤": ["max_drawdown_pct"],
        "最大回撤": ["max_drawdown_pct"],
        "波动": ["volatility_annualized_pct"],
        "年化波动": ["volatility_annualized_pct"],

        # 持仓
        "股票仓位": ["stock_percent"],
        "股票占比": ["stock_percent"],
        "债券占比": ["bond_percent"],
        "集中度": ["top10_concentration_pct"],
        "前十集中度": ["top10_concentration_pct"],

        # 概况
        "申购状态": ["purchase_status"],
        "暂停申购": ["purchase_status"],
        "规模": ["fund_scale_yi"],
        "基金规模": ["fund_scale_yi"],
        "成立日期": ["inception_date"],
        "成立时间": ["inception_date"],
    },

    # ---- 取数来源定义（Step2 用来决定 compute 的 requires）----
    "data_sources": {
        "rank_page": {"desc": "基金排名分页（/api/funds）", "cost": "low"},
        "history": {"desc": "历史净值（FundRepository.get_fund_history）", "cost": "high"},
        "overview": {"desc": "基金概况（FundRepository.get_fund_overview）", "cost": "medium"},
        "overview_or_list": {"desc": "基金概况或基金列表字段（如 sgzt）", "cost": "low"},
        "holdings_latest": {"desc": "最新一期持仓（dates -> 最新 report_date -> holdings）", "cost": "high"},
    },

    # ---- 执行约束（Step2 用于判断是否 need_clarify/unsupported/建议缩小范围）----
    "execution_constraints": {
        "max_candidates_default": 500,  # 未指定 limit 时，建议追问 TopN 或给出默认建议（但不要擅自填）
        "max_concurrent_requests": 8,
        "allow_full_scan": True,
        "notes": "Step2 不得擅自填 TopN 或 window；缺失应进入 need_clarify。",
    },
}

