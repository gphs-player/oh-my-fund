import unittest
from unittest.mock import patch


import app as app_module


class TestTodayBestApis(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()

    def test_all_codes_contract(self):
        with patch.object(app_module.fund_repository, "get_fund_list") as mocked:
            mocked.return_value = [
                {"fund_code": "000001", "fund_name": "测试基金A"},
                {"fund_code": "000002", "fund_name": "测试基金B"},
            ]
            resp = self.client.get("/api/funds/all-codes")
            self.assertEqual(resp.status_code, 200)
            payload = resp.get_json() or {}
            self.assertTrue(payload.get("success"))
            items = payload.get("items")
            self.assertIsInstance(items, list)
            self.assertEqual(items[0]["fund_code"], "000001")

    def test_overview_batch_empty(self):
        resp = self.client.post("/api/funds/overview-batch", json={"fund_codes": []})
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json() or {}
        self.assertTrue(payload.get("success"))
        self.assertEqual(payload.get("items_by_code"), {})
        self.assertEqual(payload.get("errors"), {})

    def test_overview_batch_limit(self):
        codes = [str(100000 + i) for i in range(101)]
        resp = self.client.post("/api/funds/overview-batch", json={"fund_codes": codes})
        self.assertEqual(resp.status_code, 400)

    def test_overview_batch_contract_items_and_errors(self):
        def fake_overview(code: str):
            if code == "bad":
                raise RuntimeError("boom")
            return [{"section": "JJXQ", "key": "FCODE", "value": code}]

        with patch.object(app_module.fund_repository, "get_fund_overview") as mocked:
            mocked.side_effect = fake_overview
            resp = self.client.post("/api/funds/overview-batch", json={"fund_codes": ["000001", "bad"]})
            self.assertEqual(resp.status_code, 200)
            payload = resp.get_json() or {}
            self.assertTrue(payload.get("success"))
            self.assertIn("items_by_code", payload)
            self.assertIn("errors", payload)
            self.assertIn("000001", payload["items_by_code"])
            self.assertIn("bad", payload["errors"])


if __name__ == "__main__":
    unittest.main()

