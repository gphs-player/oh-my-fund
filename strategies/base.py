from __future__ import annotations

from typing import Any


class BaseStrategy:
    type: str = ""
    name: str = ""
    version: int = 1
    scope: str = "single_fund"
    description: str = ""
    param_schema: list[dict[str, Any]] = []
    defaults: dict[str, Any] = {}

    @classmethod
    def get_definition(cls) -> dict[str, Any]:
        return {
            "type": cls.type,
            "name": cls.name,
            "version": cls.version,
            "scope": cls.scope,
            "description": cls.description,
            "param_schema": cls.param_schema,
            "defaults": cls.defaults,
        }

    @classmethod
    def normalize_params(cls, params: dict[str, Any] | None) -> dict[str, Any]:
        merged = dict(cls.defaults or {})
        if isinstance(params, dict):
            merged.update(params)
        return merged

    @classmethod
    def run(cls, history: list[dict[str, Any]], params: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


def rolling_mean(values: list[float | None], window: int) -> list[float | None]:
    result: list[float | None] = []
    if window <= 0:
        return [None for _ in values]
    running_sum = 0.0
    queue: list[float] = []
    for value in values:
        if value is None:
            queue.clear()
            running_sum = 0.0
            result.append(None)
            continue
        queue.append(value)
        running_sum += value
        if len(queue) > window:
            running_sum -= queue.pop(0)
        if len(queue) == window:
            result.append(running_sum / window)
        else:
            result.append(None)
    return result


def rolling_std(values: list[float | None], window: int) -> list[float | None]:
    result: list[float | None] = []
    if window <= 1:
        return [None for _ in values]
    queue: list[float] = []
    for value in values:
        if value is None:
            queue.clear()
            result.append(None)
            continue
        queue.append(value)
        if len(queue) > window:
            queue.pop(0)
        if len(queue) == window:
            mean = sum(queue) / window
            variance = sum((item - mean) ** 2 for item in queue) / window
            result.append(variance ** 0.5)
        else:
            result.append(None)
    return result


def compute_rsi(values: list[float | None], window: int) -> list[float | None]:
    result: list[float | None] = [None for _ in values]
    if window <= 0 or len(values) < 2:
        return result

    gains: list[float] = []
    losses: list[float] = []
    for idx in range(1, len(values)):
        current = values[idx]
        previous = values[idx - 1]
        if current is None or previous is None:
            gains.clear()
            losses.clear()
            continue
        delta = current - previous
        gains.append(max(delta, 0.0))
        losses.append(abs(min(delta, 0.0)))
        if len(gains) > window:
            gains.pop(0)
            losses.pop(0)
        if len(gains) == window:
            avg_gain = sum(gains) / window
            avg_loss = sum(losses) / window
            if avg_loss == 0:
                result[idx] = 100.0
            else:
                rs = avg_gain / avg_loss
                result[idx] = 100 - (100 / (1 + rs))
    return result


def build_line_overlay(label: str, color: str, series: list[dict[str, Any]], line_style: str = "solid", y_axis: str = "primary") -> dict[str, Any]:
    return {
        "kind": "line",
        "label": label,
        "color": color,
        "line_style": line_style,
        "series": series,
        "y_axis": y_axis,
    }


def build_signal(
    date: str,
    value: float | None,
    action: str,
    title: str,
    reason: str,
    strategy_type: str,
    strategy_name: str,
) -> dict[str, Any]:
    return {
        "date": date,
        "value": value,
        "action": action,
        "title": title,
        "reason": reason,
        "strategy_type": strategy_type,
        "strategy_name": strategy_name,
    }
