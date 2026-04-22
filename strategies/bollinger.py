from __future__ import annotations

from .base import BaseStrategy, build_line_overlay, build_signal, rolling_mean, rolling_std


class BollingerStrategy(BaseStrategy):
    type = "bollinger"
    name = "布林带突破"
    version = 1
    scope = "single_fund"
    description = "使用布林带上轨和下轨观察净值突破与回归。"
    param_schema = [
        {"key": "window", "label": "窗口", "type": "int", "default": 20, "min": 5, "description": "均线与标准差窗口。"},
        {"key": "std_multiplier", "label": "标准差倍数", "type": "float", "default": 2.0, "min": 0.5, "description": "上轨/下轨距离中轨的倍数。"},
    ]
    defaults = {"window": 20, "std_multiplier": 2.0}

    @classmethod
    def run(cls, history, params):
        params = cls.normalize_params(params)
        window = max(int(params.get("window") or 20), 5)
        std_multiplier = float(params.get("std_multiplier") or 2.0)
        closes = [item.get("unit_nav") for item in history]
        dates = [item.get("date") for item in history]
        middle = rolling_mean(closes, window)
        std_values = rolling_std(closes, window)

        upper = []
        lower = []
        for idx in range(len(history)):
            mid = middle[idx]
            std = std_values[idx]
            if mid is None or std is None:
                upper.append(None)
                lower.append(None)
                continue
            upper.append(mid + std_multiplier * std)
            lower.append(mid - std_multiplier * std)

        overlays = [
            build_line_overlay(f"{cls.name} · 中轨", "#22d3ee", [{"date": dates[i], "value": middle[i]} for i in range(len(dates))]),
            build_line_overlay(f"{cls.name} · 上轨", "#f87171", [{"date": dates[i], "value": upper[i]} for i in range(len(dates))], "dashed"),
            build_line_overlay(f"{cls.name} · 下轨", "#34d399", [{"date": dates[i], "value": lower[i]} for i in range(len(dates))], "dashed"),
        ]

        signals = []
        for idx in range(1, len(history)):
            prev_price = closes[idx - 1]
            curr_price = closes[idx]
            prev_upper = upper[idx - 1]
            curr_upper = upper[idx]
            prev_lower = lower[idx - 1]
            curr_lower = lower[idx]
            if None in (prev_price, curr_price, prev_upper, curr_upper, prev_lower, curr_lower):
                continue
            if prev_price <= prev_lower and curr_price > curr_lower:
                signals.append(build_signal(
                    dates[idx],
                    curr_price,
                    "buy",
                    "回到下轨上方",
                    "净值脱离超跌区域，可作为观察性买点",
                    cls.type,
                    cls.name,
                ))
            elif prev_price >= prev_upper and curr_price < curr_upper:
                signals.append(build_signal(
                    dates[idx],
                    curr_price,
                    "sell",
                    "跌回上轨下方",
                    "净值脱离过热区域，可作为观察性卖点",
                    cls.type,
                    cls.name,
                ))

        return {
            "overlays": overlays,
            "signals": signals,
            "meta": {
                "signal_count": len(signals),
                "summary": f"最近共识别 {len(signals)} 个布林带信号",
            },
        }
