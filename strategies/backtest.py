from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        num = float(value)
        if num != num:  # NaN
            return None
        return num
    except Exception:
        return None


def _to_bool(value: Any) -> bool:
    return bool(value)


@dataclass
class BacktestConfig:
    initial_cash: float = 10000.0
    fill_model: str = "same_day_nav"  # 固定：信号当日净值成交
    sizing_mode: str = "all_in"  # all_in | fixed_amount | fixed_percent
    fixed_amount: float = 1000.0
    fixed_percent: float = 1.0
    fee_rate: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "BacktestConfig":
        data = data if isinstance(data, dict) else {}
        initial_cash = _to_float(data.get("initial_cash"))
        fee_rate = _to_float(data.get("fee_rate"))
        fixed_amount = _to_float(data.get("fixed_amount"))
        fixed_percent = _to_float(data.get("fixed_percent"))
        sizing_mode = str(data.get("sizing_mode") or "all_in").strip() or "all_in"
        fill_model = str(data.get("fill_model") or "same_day_nav").strip() or "same_day_nav"
        return cls(
            initial_cash=initial_cash if initial_cash is not None and initial_cash > 0 else 10000.0,
            fill_model=fill_model,
            sizing_mode=sizing_mode,
            fixed_amount=fixed_amount if fixed_amount is not None and fixed_amount > 0 else 1000.0,
            fixed_percent=fixed_percent if fixed_percent is not None and 0 < fixed_percent <= 1.0 else 1.0,
            fee_rate=fee_rate if fee_rate is not None and fee_rate >= 0 else 0.0,
        )


def _build_overrides_map(overrides: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    items = overrides if isinstance(overrides, list) else []
    result: dict[str, dict[str, Any]] = {}
    for raw in items:
        if not isinstance(raw, dict):
            continue
        uid = str(raw.get("signal_uid") or "").strip()
        if not uid:
            continue
        result[uid] = raw
    return result


def run_backtest(
    history: list[dict[str, Any]],
    signals: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
    overrides: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    回测引擎（单基金）：根据买卖信号模拟交易。

    规则（确定性）：
    - 成交价：优先使用 history 同日 unit_nav；缺失则使用 signal.price_ref；再缺失跳过。
    - 同日多信号：先卖后买。
    - 默认不计手续费与滑点（fee_rate 可选）。
    """
    cfg = BacktestConfig.from_dict(config)
    if not history:
        return {"error": "暂无净值数据"}, []

    history_sorted = [x for x in history if isinstance(x, dict) and x.get("date")]
    history_sorted.sort(key=lambda x: str(x.get("date") or ""))
    history_by_date: dict[str, float] = {}
    for item in history_sorted:
        nav = _to_float(item.get("unit_nav"))
        if nav is None:
            continue
        history_by_date[str(item.get("date"))] = nav

    if not history_by_date:
        return {"error": "无法获取净值数据"}, []

    last_date = str(history_sorted[-1].get("date") or "")
    last_price = history_by_date.get(last_date)
    if last_price is None:
        return {"error": "无法获取期末净值"}, []

    # 合并信号并按日期分组
    sigs = [s for s in (signals or []) if isinstance(s, dict) and s.get("date") and s.get("action")]
    sigs.sort(key=lambda x: (str(x.get("date") or ""), str(x.get("strategy_name") or ""), str(x.get("title") or "")))
    signals_by_date: dict[str, list[dict[str, Any]]] = {}
    for s in sigs:
        date_key = str(s.get("date") or "")
        signals_by_date.setdefault(date_key, []).append(s)

    ov_map = _build_overrides_map(overrides)

    cash = float(cfg.initial_cash)
    shares = 0.0
    cost_basis = 0.0
    avg_price: float | None = None
    last_buy_price: float | None = None
    last_buy_date: str = ""
    trades: list[dict[str, Any]] = []
    skipped = 0
    buy_count = 0
    sell_count = 0

    def get_price_for_date(date_key: str, day_signals: list[dict[str, Any]]) -> float | None:
        p = history_by_date.get(date_key)
        if p is not None:
            return p
        for s in day_signals:
            ref = _to_float(s.get("price_ref"))
            if ref is not None:
                return ref
            ref2 = _to_float(s.get("value"))
            if ref2 is not None:
                return ref2
        return None

    def build_signal_note(day_signals: list[dict[str, Any]]) -> str:
        uniq: list[str] = []
        for s in day_signals:
            name = str(s.get("strategy_name") or "").strip()
            title = str(s.get("title") or "").strip()
            token = "：".join([x for x in [name, title] if x])
            if token and token not in uniq:
                uniq.append(token)
        return "；".join(uniq[:6])

    def resolve_sizing(day_signals: list[dict[str, Any]]) -> dict[str, Any]:
        # 若当日多个信号有 overrides，以第一个有效 override 为准（简单确定性规则）
        for s in day_signals:
            uid = str(s.get("signal_uid") or "").strip()
            if not uid:
                continue
            ov = ov_map.get(uid)
            if not ov:
                continue
            if _to_bool(ov.get("disabled")):
                continue
            sizing_mode = str(ov.get("sizing_mode") or "").strip()
            amount = _to_float(ov.get("amount"))
            percent = _to_float(ov.get("percent"))
            return {"sizing_mode": sizing_mode or cfg.sizing_mode, "amount": amount, "percent": percent}
        return {"sizing_mode": cfg.sizing_mode, "amount": None, "percent": None}

    def is_day_disabled(day_signals: list[dict[str, Any]]) -> bool:
        # 若该日所有信号都被 disabled，则跳过；否则认为至少有一个有效信号
        any_override = False
        any_enabled = False
        for s in day_signals:
            uid = str(s.get("signal_uid") or "").strip()
            if not uid:
                continue
            ov = ov_map.get(uid)
            if ov is None:
                continue
            any_override = True
            if not _to_bool(ov.get("disabled")):
                any_enabled = True
        return any_override and (not any_enabled)

    # 遍历交易日（以 history 为主）
    for item in history_sorted:
        date_key = str(item.get("date") or "")
        day_signals = signals_by_date.get(date_key) or []
        if not day_signals:
            continue
        if is_day_disabled(day_signals):
            continue

        price = get_price_for_date(date_key, day_signals)
        if price is None or price <= 0:
            skipped += 1
            continue

        # 同日多信号：先卖后买
        actions = [str(s.get("action") or "").strip().lower() for s in day_signals]
        has_sell = any(a == "sell" for a in actions)
        has_buy = any(a == "buy" for a in actions)
        note = build_signal_note(day_signals)

        sizing = resolve_sizing(day_signals)
        sizing_mode = str(sizing.get("sizing_mode") or cfg.sizing_mode).strip() or "all_in"
        amount_override = sizing.get("amount")
        percent_override = sizing.get("percent")

        fee_rate = max(float(cfg.fee_rate), 0.0)

        if has_sell and shares > 0:
            # 卖出：默认全卖；若 fixed_percent 或 override percent，则按持仓百分比卖
            sell_shares = shares
            if sizing_mode == "fixed_percent":
                pct = percent_override if isinstance(percent_override, (int, float)) and 0 < float(percent_override) <= 1 else cfg.fixed_percent
                sell_shares = shares * float(pct)
            if sell_shares > 0:
                gross = sell_shares * price
                fee = gross * fee_rate
                cash += (gross - fee)
                shares -= sell_shares
                if shares <= 1e-12:
                    shares = 0.0
                    cost_basis = 0.0
                    avg_price = None
                sell_count += 1
                trades.append({
                    "date": date_key,
                    "action": "卖出",
                    "price": price,
                    "shares_delta": -sell_shares,
                    "cash_after": cash,
                    "shares_after": shares,
                    "note": note,
                })

        if has_buy:
            # 买入：all_in / fixed_amount / fixed_percent
            buy_cash = 0.0
            if sizing_mode == "fixed_amount":
                amt = amount_override if isinstance(amount_override, (int, float)) and float(amount_override) > 0 else cfg.fixed_amount
                buy_cash = min(cash, float(amt))
            elif sizing_mode == "fixed_percent":
                pct = percent_override if isinstance(percent_override, (int, float)) and 0 < float(percent_override) <= 1 else cfg.fixed_percent
                buy_cash = cash * float(pct)
            else:
                buy_cash = cash

            if buy_cash > 0 and cash > 0:
                fee = buy_cash * fee_rate
                net_cash = max(buy_cash - fee, 0.0)
                buy_shares = net_cash / price if price > 0 else 0.0
                if buy_shares > 0:
                    cash -= buy_cash
                    shares += buy_shares
                    cost_basis += net_cash
                    avg_price = (cost_basis / shares) if shares > 0 else None
                    last_buy_price = price
                    last_buy_date = date_key
                    buy_count += 1
                    trades.append({
                        "date": date_key,
                        "action": "买入",
                        "price": price,
                        "shares_delta": buy_shares,
                        "cash_after": cash,
                        "shares_after": shares,
                        "note": note,
                    })

    final_equity = cash + shares * last_price
    total_return = (final_equity / cfg.initial_cash - 1.0) if cfg.initial_cash > 0 else None

    # Buy & Hold 基准：首日全仓买入持有
    first_date = str(history_sorted[0].get("date") or "")
    first_price = history_by_date.get(first_date)
    buyhold_return = None
    buyhold_final_equity = None
    if first_price is not None and first_price > 0:
        buyhold_shares = cfg.initial_cash / first_price
        buyhold_final_equity = buyhold_shares * last_price
        buyhold_return = buyhold_final_equity / cfg.initial_cash - 1.0

    holding = shares > 0
    unrealized_return = None
    unrealized_pnl = None
    if holding and avg_price and avg_price > 0:
        unrealized_return = last_price / avg_price - 1.0
        unrealized_pnl = shares * (last_price - avg_price)

    result = {
        "initial_cash": cfg.initial_cash,
        "final_equity": final_equity,
        "total_return": total_return,
        "trade_count": len(trades),
        "buy_count": buy_count,
        "sell_count": sell_count,
        "skipped_count": skipped,
        "holding": holding,
        "avg_price": avg_price,
        "entry_price": (trades[0]["price"] if trades else None),
        "entry_date": (trades[0]["date"] if trades else ""),
        "last_buy_price": last_buy_price,
        "last_buy_date": last_buy_date,
        "last_price": last_price,
        "last_date": last_date,
        "unrealized_return": unrealized_return,
        "unrealized_pnl": unrealized_pnl,
        "buyhold_first_price": first_price,
        "buyhold_first_date": first_date,
        "buyhold_return": buyhold_return,
        "buyhold_final_equity": buyhold_final_equity,
        "config": {
            "fill_model": cfg.fill_model,
            "sizing_mode": cfg.sizing_mode,
            "fixed_amount": cfg.fixed_amount,
            "fixed_percent": cfg.fixed_percent,
            "fee_rate": cfg.fee_rate,
        },
    }
    return result, trades

