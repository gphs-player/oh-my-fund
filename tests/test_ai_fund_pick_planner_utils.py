import unittest

from warehouse.ai_fund_pick.capabilities import CAPABILITIES_V1
from warehouse.ai_fund_pick.planner import (
    FundPickPlanError,
    _extract_first_json_object,
    _strip_code_fence,
    _validate_and_normalize_plan,
)


class TestFundPickPlannerUtils(unittest.TestCase):
    def test_strip_code_fence(self):
        raw = "```json\n{\"a\":1}\n```"
        self.assertEqual(_strip_code_fence(raw), "{\"a\":1}")

    def test_extract_first_json_object(self):
        raw = "xxx {\"a\":1, \"b\":{\"c\":2}} yyy"
        self.assertEqual(_extract_first_json_object(raw), "{\"a\":1, \"b\":{\"c\":2}}")

    def test_extract_first_json_object_no_brace(self):
        with self.assertRaises(FundPickPlanError):
            _extract_first_json_object("hello")


class TestPlanValidate(unittest.TestCase):
    def test_validate_reject_unknown_metric_key(self):
        plan = {
            "plan_version": "v1",
            "universe": {"mode": "all", "hints": [], "scan_limit": None},
            "steps": [
                {
                    "step_type": "compute",
                    "intent_index": 0,
                    "metric_key": "not_exist",
                    "window": None,
                    "op": None,
                    "value": None,
                    "unit": None,
                    "priority": "high",
                    "source": {"requires": []},
                    "explain": {"metric_name": "收益", "evidence": "收益高"},
                }
            ],
            "need_clarify": [],
            "unsupported_intents": [],
            "notes": "",
        }
        with self.assertRaises(FundPickPlanError):
            _validate_and_normalize_plan(plan, CAPABILITIES_V1)


if __name__ == "__main__":
    unittest.main()

