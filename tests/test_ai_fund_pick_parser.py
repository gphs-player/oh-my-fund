import unittest

from warehouse.ai_fund_pick.parser import (
    FundPickParseError,
    _extract_first_json_object,
    _strip_code_fence,
    _validate_and_normalize_draft,
)


class TestFundPickParserUtils(unittest.TestCase):
    def test_strip_code_fence_json(self):
        raw = "```json\n{\"a\":1}\n```"
        self.assertEqual(_strip_code_fence(raw), "{\"a\":1}")

    def test_extract_first_json_object_with_prefix_suffix(self):
        raw = "前缀... {\"a\": 1, \"b\": {\"c\": 2}} ...后缀"
        self.assertEqual(_extract_first_json_object(raw), "{\"a\": 1, \"b\": {\"c\": 2}}")

    def test_extract_first_json_object_ignores_braces_in_string(self):
        raw = "{\"a\": \"xx { yy\", \"b\": 1} trailing"
        self.assertEqual(_extract_first_json_object(raw), "{\"a\": \"xx { yy\", \"b\": 1}")

    def test_extract_first_json_object_no_brace(self):
        with self.assertRaises(FundPickParseError):
            _extract_first_json_object("hello")


class TestFundPickDraftValidate(unittest.TestCase):
    def test_validate_requires_object(self):
        with self.assertRaises(FundPickParseError):
            _validate_and_normalize_draft(["not", "object"])

    def test_validate_intents_must_have_required_fields(self):
        draft = {
            "universe": {"mode": "all", "hints": []},
            "intents": [
                {"intent_type": "soft_preference", "metric_name": "回撤", "op": "minimize", "evidence": "回撤小"},
                {"intent_type": "soft_preference", "metric_name": "收益", "op": "maximize"},  # no evidence
            ],
        }
        out = _validate_and_normalize_draft(draft)
        self.assertEqual(len(out["intents"]), 1)
        self.assertTrue(any("缺少必要字段" in w for w in out["warnings"]))


if __name__ == "__main__":
    unittest.main()

