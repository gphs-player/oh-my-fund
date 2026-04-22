from __future__ import annotations

from datetime import datetime

from .base import BaseStrategy, build_signal


class DcaStrategy(BaseStrategy):
    type = "dca"
    name = "定投节奏"
    version = 1
    scope = "single_fund"
    description = "按固定节奏生成买入点，用于模拟基金定投。"
    param_schema = [
        {"key": "period", "label": "定投周期", "type": "enum", "default": "monthly", "description": "定投触发频率。", "options": [
            {"value": "weekly", "label": "每周"},
            {"value": "biweekly", "label": "双周"},
            {"value": "monthly", "label": "每月"},
        ]},
        {"key": "amount", "label": "每次金额", "type": "float", "default": 1000, "min": 0, "description": "仅用于说明，不参与收益计算。"},
    ]
    defaults = {"period": "monthly", "amount": 1000}

    @classmethod
    def run(cls, history, params):
        params = cls.normalize_params(params)
        period = str(params.get("period") or "monthly")
        amount = float(params.get("amount") or 1000)
        last_key = None
        signals = []

        for item in history:
            date_str = item.get("date") or ""
            nav = item.get("unit_nav")
            if not date_str or nav is None:
                continue
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            if period == "weekly":
                key = f"{dt.isocalendar().year}-{dt.isocalendar().week}"
            elif period == "biweekly":
                week_no = ((dt.isocalendar().week - 1) // 2) + 1
                key = f"{dt.isocalendar().year}-{week_no}"
            else:
                key = f"{dt.year}-{dt.month}"

            if key == last_key:
                continue
            last_key = key
            signals.append(build_signal(
                date_str,
                nav,
                "buy",
                "定投买入",
                f"按 {period} 节奏投入 {amount:.2f} 元",
                cls.type,
                cls.name,
            ))

        return {
            "overlays": [],
            "signals": signals,
            "meta": {
                "signal_count": len(signals),
                "summary": f"最近共生成 {len(signals)} 个定投买点",
            },
        }
