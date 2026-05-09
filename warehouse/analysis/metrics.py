"""量化指标计算 — 纯函数，无 I/O，纯 Python 手写"""

import math
from datetime import datetime, timedelta


# =====================
# 收益能力
# =====================

def compute_return_metrics(history: list[dict], fund_inception_date: str | None = None) -> dict:
    if not history:
        return {"period_returns": {}, "annualized_return": None}

    sorted_hist = sorted(history, key=lambda x: x.get("date", ""))
    if not sorted_hist:
        return {"period_returns": {}, "annualized_return": None}

    latest_date = sorted_hist[-1]["date"]
    earliest_date = sorted_hist[0]["date"]
    latest_nav = sorted_hist[-1].get("unit_nav")
    earliest_nav = sorted_hist[0].get("unit_nav")

    if latest_nav is None or earliest_nav is None:
        return {"period_returns": {}, "annualized_return": None}

    nav_by_date = {row["date"]: row.get("unit_nav") for row in sorted_hist if row.get("unit_nav") is not None}

    periods = {
        "1m": 30,
        "3m": 90,
        "6m": 180,
        "1y": 365,
        "2y": 730,
        "3y": 1095,
    }

    period_returns = {}
    today = datetime.strptime(latest_date, "%Y-%m-%d")

    for label, days in periods.items():
        target_date = today - timedelta(days=days)
        target_str = target_date.strftime("%Y-%m-%d")
        if target_str < earliest_date:
            continue
        start_nav = _find_nearest_nav(nav_by_date, target_str, sorted_hist)
        if start_nav and start_nav > 0:
            period_returns[label] = round((latest_nav - start_nav) / start_nav * 100, 2)

    # 成立以来收益
    if earliest_nav and earliest_nav > 0:
        period_returns["since_inception"] = round((latest_nav - earliest_nav) / earliest_nav * 100, 2)

    # 年化收益率
    total_days = (today - datetime.strptime(earliest_date, "%Y-%m-%d")).days
    annualized_return = None
    if total_days > 0 and earliest_nav and earliest_nav > 0:
        total_return = latest_nav / earliest_nav
        annualized_return = round((total_return ** (365 / total_days) - 1) * 100, 2)

    return {
        "period_returns": period_returns,
        "annualized_return": annualized_return,
        "total_days": total_days,
    }


# =====================
# 风险水平
# =====================

def compute_risk_metrics(history: list[dict]) -> dict:
    if not history or len(history) < 2:
        return {"max_drawdown": None, "annualized_volatility": None, "sharpe_ratio": None}

    sorted_hist = sorted(history, key=lambda x: x.get("date", ""))
    navs = [row.get("unit_nav") for row in sorted_hist if row.get("unit_nav") is not None]

    if len(navs) < 2:
        return {"max_drawdown": None, "annualized_volatility": None, "sharpe_ratio": None}

    # 最大回撤
    max_drawdown = _compute_max_drawdown(navs)

    # 日收益率序列
    daily_returns = []
    for i in range(1, len(navs)):
        if navs[i - 1] > 0:
            daily_returns.append((navs[i] - navs[i - 1]) / navs[i - 1])

    if not daily_returns:
        return {"max_drawdown": max_drawdown, "annualized_volatility": None, "sharpe_ratio": None}

    # 年化波动率
    volatility = _std(daily_returns) * math.sqrt(252)
    annualized_volatility = round(volatility * 100, 2)

    # 夏普比率 (rf = 2%)
    mean_daily = sum(daily_returns) / len(daily_returns)
    annualized_return = mean_daily * 252
    sharpe_ratio = None
    if volatility > 0:
        sharpe_ratio = round((annualized_return - 0.02) / volatility, 2)

    return {
        "max_drawdown": max_drawdown,
        "annualized_volatility": annualized_volatility,
        "sharpe_ratio": sharpe_ratio,
    }


# =====================
# 持仓分析
# =====================

def compute_holdings_metrics(holdings_list: list[dict], history: list[dict], holding_dates: list[str]) -> dict:
    """
    holdings_list: 按日期排序的持仓数据列表，每项包含 report_date, stock_list 等
    history: 历史净值列表
    holding_dates: 持仓公布日期列表
    """
    if not holdings_list:
        return {
            "top5_concentration": None,
            "top10_concentration": None,
            "turnover_ratio": None,
            "post_rebalance_returns": [],
        }

    # 最新一期的集中度
    latest = holdings_list[-1] if holdings_list else {}
    stocks = latest.get("stock_list") or []
    sorted_stocks = sorted(stocks, key=lambda x: (x.get("percent") or 0), reverse=True)

    top5 = sum(s.get("percent") or 0 for s in sorted_stocks[:5])
    top10 = sum(s.get("percent") or 0 for s in sorted_stocks[:10])

    # 调仓换手率（相邻两期 top10 的 Jaccard 距离平均值）
    turnover_ratios = []
    for i in range(1, len(holdings_list)):
        prev_stocks = holdings_list[i - 1].get("stock_list") or []
        curr_stocks = holdings_list[i].get("stock_list") or []
        prev_set = set(s.get("code", "") for s in sorted(prev_stocks, key=lambda x: (x.get("percent") or 0), reverse=True)[:10] if s.get("code"))
        curr_set = set(s.get("code", "") for s in sorted(curr_stocks, key=lambda x: (x.get("percent") or 0), reverse=True)[:10] if s.get("code"))
        if prev_set or curr_set:
            union = prev_set | curr_set
            intersection = prev_set & curr_set
            jaccard_dist = 1 - (len(intersection) / len(union)) if union else 0
            turnover_ratios.append(round(jaccard_dist * 100, 1))

    avg_turnover = round(sum(turnover_ratios) / len(turnover_ratios), 1) if turnover_ratios else None

    # 调仓后净值表现
    post_rebalance_returns = _compute_post_rebalance_returns(holdings_list, history)

    return {
        "top5_concentration": round(top5, 2) if top5 else None,
        "top10_concentration": round(top10, 2) if top10 else None,
        "turnover_ratio": avg_turnover,
        "post_rebalance_returns": post_rebalance_returns,
    }


# =====================
# 辅助函数
# =====================

def _find_nearest_nav(nav_by_date: dict, target_date: str, sorted_hist: list[dict]) -> float | None:
    if target_date in nav_by_date:
        return nav_by_date[target_date]
    # 向后找最近的交易日（最多找7天）
    dt = datetime.strptime(target_date, "%Y-%m-%d")
    for offset in range(1, 8):
        check = (dt + timedelta(days=offset)).strftime("%Y-%m-%d")
        if check in nav_by_date:
            return nav_by_date[check]
    return None


def _compute_max_drawdown(navs: list[float]) -> float:
    peak = navs[0]
    max_dd = 0.0
    for nav in navs:
        if nav > peak:
            peak = nav
        dd = (peak - nav) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
    return round(max_dd * 100, 2)


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
    return math.sqrt(variance)


def _compute_post_rebalance_returns(holdings_list: list[dict], history: list[dict]) -> list[dict]:
    if not history or not holdings_list:
        return []

    nav_by_date = {}
    sorted_dates = []
    for row in sorted(history, key=lambda x: x.get("date", "")):
        d = row.get("date", "")
        nav = row.get("unit_nav")
        if d and nav is not None:
            nav_by_date[d] = nav
            sorted_dates.append(d)

    if not sorted_dates:
        return []

    results = []
    for holding in holdings_list:
        report_date = holding.get("report_date", "")
        if not report_date:
            continue

        # 找报告期前后各20个交易日的收益
        idx = _find_date_index(sorted_dates, report_date)
        if idx is None:
            continue

        pre_start = max(0, idx - 20)
        post_end = min(len(sorted_dates) - 1, idx + 20)

        if idx > pre_start and sorted_dates[pre_start] in nav_by_date and sorted_dates[idx] in nav_by_date:
            nav_pre_start = nav_by_date[sorted_dates[pre_start]]
            nav_at_report = nav_by_date[sorted_dates[idx]]
            pre_return = (nav_at_report - nav_pre_start) / nav_pre_start * 100 if nav_pre_start > 0 else None
        else:
            pre_return = None

        if post_end > idx and sorted_dates[idx] in nav_by_date and sorted_dates[post_end] in nav_by_date:
            nav_at_report = nav_by_date[sorted_dates[idx]]
            nav_post_end = nav_by_date[sorted_dates[post_end]]
            post_return = (nav_post_end - nav_at_report) / nav_at_report * 100 if nav_at_report > 0 else None
        else:
            post_return = None

        results.append({
            "report_date": report_date,
            "pre_20d_return": round(pre_return, 2) if pre_return is not None else None,
            "post_20d_return": round(post_return, 2) if post_return is not None else None,
        })

    return results


def _find_date_index(sorted_dates: list[str], target: str) -> int | None:
    # 二分查找最近的日期
    lo, hi = 0, len(sorted_dates) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if sorted_dates[mid] == target:
            return mid
        elif sorted_dates[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    # 返回最近的索引
    if lo < len(sorted_dates):
        return lo
    return hi if hi >= 0 else None
