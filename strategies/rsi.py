from __future__ import annotations

from .base import BaseStrategy, build_line_overlay, build_signal, compute_rsi


class RsiStrategy(BaseStrategy):
    type = "rsi"
    name = "RSI 超买超卖"
    version = 1
    scope = "single_fund"
    description = "用 RSI 判断超买超卖区间，生成反转参考买卖点。"
    param_schema = [
        {"key": "window", "label": "RSI 周期", "type": "int", "default": 14, "min": 2, "description": "RSI 计算窗口。"},
        {"key": "oversold", "label": "超卖阈值", "type": "float", "default": 30, "min": 1, "max": 50, "description": "低于该值视为超卖。"},
        {"key": "overbought", "label": "超买阈值", "type": "float", "default": 70, "min": 50, "max": 99, "description": "高于该值视为超买。"},
    ]
    defaults = {"window": 14, "oversold": 30, "overbought": 70}

    @classmethod
    def run(cls, history, params):
        params = cls.normalize_params(params)
        window = max(int(params.get("window") or 14), 2)
        oversold = float(params.get("oversold") or 30)
        overbought = float(params.get("overbought") or 70)
        closes = [item.get("unit_nav") for item in history]
        dates = [item.get("date") for item in history]
        rsi_values = compute_rsi(closes, window)

        overlays = [
            build_line_overlay(
                f"{cls.name} · RSI{window}",
                "#a78bfa",
                [{"date": dates[i], "value": rsi_values[i]} for i in range(len(dates))],
                y_axis="secondary",
            ),
            build_line_overlay(
                f"{cls.name} · 超卖线({oversold})",
                "#34d399",
                [{"date": date, "value": oversold} for date in dates],
                "dashed",
                y_axis="secondary",
            ),
            build_line_overlay(
                f"{cls.name} · 超买线({overbought})",
                "#f87171",
                [{"date": date, "value": overbought} for date in dates],
                "dashed",
                y_axis="secondary",
            ),
        ]

        signals = []
        for idx in range(1, len(history)):
            prev_value = rsi_values[idx - 1]
            curr_value = rsi_values[idx]
            price = closes[idx]
            if None in (prev_value, curr_value, price):
                continue
            if prev_value <= oversold and curr_value > oversold:
                signals.append(build_signal(
                    dates[idx],
                    price,
                    "buy",
                    "RSI 脱离超卖",
                    f"RSI 从 {prev_value:.2f} 回到阈值 {oversold} 上方",
                    cls.type,
                    cls.name,
                ))
            elif prev_value >= overbought and curr_value < overbought:
                signals.append(build_signal(
                    dates[idx],
                    price,
                    "sell",
                    "RSI 脱离超买",
                    f"RSI 从 {prev_value:.2f} 回落至阈值 {overbought} 下方",
                    cls.type,
                    cls.name,
                ))

        return {
            "overlays": overlays,
            "signals": signals,
            "meta": {
                "signal_count": len(signals),
                "summary": f"最近共识别 {len(signals)} 个 RSI 信号",
            },
        }
