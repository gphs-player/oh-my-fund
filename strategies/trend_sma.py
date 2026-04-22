from __future__ import annotations

from .base import BaseStrategy, build_line_overlay, build_signal, rolling_mean


class TrendSmaStrategy(BaseStrategy):
    type = "trend_sma"
    name = "双均线趋势"
    version = 1
    scope = "single_fund"
    description = "使用快慢均线交叉识别买卖点，适合观察净值趋势切换。"
    param_schema = [
        {"key": "fast_window", "label": "快线窗口", "type": "int", "default": 10, "min": 2, "description": "短周期均线窗口。"},
        {"key": "slow_window", "label": "慢线窗口", "type": "int", "default": 30, "min": 3, "description": "长周期均线窗口。"},
    ]
    defaults = {"fast_window": 10, "slow_window": 30}

    @classmethod
    def run(cls, history, params):
        params = cls.normalize_params(params)
        fast_window = max(int(params.get("fast_window") or 10), 2)
        slow_window = max(int(params.get("slow_window") or 30), fast_window + 1)
        closes = [item.get("unit_nav") for item in history]
        dates = [item.get("date") for item in history]

        fast_line = rolling_mean(closes, fast_window)
        slow_line = rolling_mean(closes, slow_window)

        overlays = [
            build_line_overlay(
                f"{cls.name} · MA{fast_window}",
                "#60a5fa",
                [{"date": dates[i], "value": fast_line[i]} for i in range(len(dates))],
            ),
            build_line_overlay(
                f"{cls.name} · MA{slow_window}",
                "#fbbf24",
                [{"date": dates[i], "value": slow_line[i]} for i in range(len(dates))],
                "dashed",
            ),
        ]

        signals = []
        for idx in range(1, len(history)):
            prev_fast = fast_line[idx - 1]
            prev_slow = slow_line[idx - 1]
            curr_fast = fast_line[idx]
            curr_slow = slow_line[idx]
            price = closes[idx]
            if None in (prev_fast, prev_slow, curr_fast, curr_slow, price):
                continue
            if prev_fast <= prev_slow and curr_fast > curr_slow:
                signals.append(build_signal(
                    dates[idx],
                    price,
                    "buy",
                    "金叉买入",
                    f"MA{fast_window} 上穿 MA{slow_window}",
                    cls.type,
                    cls.name,
                ))
            elif prev_fast >= prev_slow and curr_fast < curr_slow:
                signals.append(build_signal(
                    dates[idx],
                    price,
                    "sell",
                    "死叉卖出",
                    f"MA{fast_window} 下穿 MA{slow_window}",
                    cls.type,
                    cls.name,
                ))

        return {
            "overlays": overlays,
            "signals": signals,
            "meta": {
                "signal_count": len(signals),
                "summary": f"最近共识别 {len(signals)} 个均线信号",
            },
        }
