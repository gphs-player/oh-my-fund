from __future__ import annotations

from typing import Any

from .bollinger import BollingerStrategy
from .dca import DcaStrategy
from .rsi import RsiStrategy
from .trend_sma import TrendSmaStrategy


class StrategyRegistry:
    def __init__(self):
        self._strategies = {
            strategy.type: strategy
            for strategy in [TrendSmaStrategy, RsiStrategy, BollingerStrategy, DcaStrategy]
        }

    def list_definitions(self) -> list[dict[str, Any]]:
        return [strategy.get_definition() for strategy in self._strategies.values()]

    def get(self, strategy_type: str):
        return self._strategies.get(strategy_type)

    def normalize_params(self, strategy_type: str, params: dict[str, Any] | None) -> dict[str, Any]:
        strategy = self.get(strategy_type)
        if strategy is None:
            return params if isinstance(params, dict) else {}
        return strategy.normalize_params(params)

    def validate_stack(self, stack: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized_stack = []
        for raw_item in stack or []:
            strategy_type = str((raw_item or {}).get("strategy_type") or "").strip()
            strategy = self.get(strategy_type)
            if strategy is None:
                raise ValueError(f"不支持的策略类型: {strategy_type or '空'}")
            normalized_stack.append({
                "client_uid": str((raw_item or {}).get("client_uid") or (raw_item or {}).get("uid") or "").strip(),
                "strategy_type": strategy_type,
                "enabled": bool((raw_item or {}).get("enabled", True)),
                "display_enabled": bool((raw_item or {}).get("display_enabled", True)),
                "params": strategy.normalize_params((raw_item or {}).get("params")),
            })
        return normalized_stack

    def run_stack(self, history: list[dict[str, Any]], stack: list[dict[str, Any]]) -> list[dict[str, Any]]:
        results = []
        for item in stack or []:
            strategy_type = item.get("strategy_type", "")
            strategy = self.get(strategy_type)
            if strategy is None:
                continue
            params = strategy.normalize_params(item.get("params"))
            output = strategy.run(history, params)
            results.append({
                "client_uid": item.get("client_uid", ""),
                "strategy_type": strategy.type,
                "strategy_name": strategy.name,
                "enabled": bool(item.get("enabled", True)),
                "display_enabled": bool(item.get("display_enabled", True)),
                "params": params,
                "overlays": output.get("overlays") or [],
                "signals": output.get("signals") or [],
                "meta": output.get("meta") or {},
            })
        return results


registry = StrategyRegistry()
