import unittest

from warehouse.ai_fund_pick.missing import build_missing_items


class TestFundPickMissingItems(unittest.TestCase):
    def test_soft_preference_return_requires_window(self):
        draft = {
            "universe": {"mode": "all", "hints": []},
            "intents": [
                {
                    "intent_type": "soft_preference",
                    "metric_name": "涨幅",
                    "op": "maximize",
                    "value": None,
                    "unit": None,
                    "window": None,
                    "priority": "high",
                    "evidence": "涨幅越高越好",
                    "missing": [],
                }
            ],
            "notes": "",
            "warnings": [
                "用户未指定涨幅的时间窗口（近1月/3月/6月/1年等），需要追问",
            ],
        }
        items = build_missing_items(draft)
        self.assertTrue(any(it.get("field") == "window" for it in items))

    def test_sort_return_requires_window(self):
        draft = {
            "universe": {"mode": "all", "hints": []},
            "intents": [
                {
                    "intent_type": "sort",
                    "metric_name": "涨跌幅",
                    "op": "rank_desc",
                    "value": None,
                    "unit": None,
                    "window": None,
                    "priority": "high",
                    "evidence": "涨跌幅高优先",
                    "missing": [],
                }
            ],
            "notes": "",
            "warnings": [],
        }
        items = build_missing_items(draft)
        self.assertTrue(any(it.get("field") == "window" for it in items))


if __name__ == "__main__":
    unittest.main()

