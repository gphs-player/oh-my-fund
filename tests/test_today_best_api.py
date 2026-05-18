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

    def test_today_best_job_create_and_get_done(self):
        # 让任务同步执行：patch executor.submit 直接调用
        with patch.object(app_module, "_today_best_executor") as ex:
            def submit(fn, *args, **kwargs):
                fn()
                class _F:  # minimal future-like
                    def result(self, *a, **k):
                        return None
                return _F()
            ex.submit.side_effect = submit

            # patch run 函数：直接写入 done 结果，避免真实遍历
            with patch.object(app_module, "_run_today_best_job") as runner:
                def run(job_id: str):
                    app_module._today_best_jobs.update(job_id, {
                        "status": "done",
                        "percent": 100,
                        "progress": {"done": 1, "total": 1, "hit": 1, "failed": 0},
                        "result": {"rows": [{"fund_code": "000001"}], "types": [{"value": "1", "label": "类型"}]},
                    })
                runner.side_effect = run

                resp = self.client.post("/api/today-best/jobs", json={"period_code": "Z", "top_n": 1})
                self.assertEqual(resp.status_code, 200)
                payload = resp.get_json() or {}
                self.assertTrue(payload.get("success"))
                job_id = payload.get("job_id")
                self.assertTrue(job_id)

                resp2 = self.client.get(f"/api/today-best/jobs/{job_id}")
                self.assertEqual(resp2.status_code, 200)
                data = resp2.get_json() or {}
                self.assertTrue(data.get("success"))
                self.assertEqual(data.get("status"), "done")
                self.assertIn("result", data)


if __name__ == "__main__":
    unittest.main()
