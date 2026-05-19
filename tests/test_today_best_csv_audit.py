import csv
import os
from pathlib import Path
from unittest.mock import patch

import app as app_module


def _items_jdzf(period="Z", rank="1", sc="100", syl="2.34"):
    return [
        {"section": "JDZF", "key": f"{period}.rank", "value": rank},
        {"section": "JDZF", "key": f"{period}.sc", "value": sc},
        {"section": "JDZF", "key": f"{period}.syl", "value": syl},
        {"section": "JJXQ", "key": "FUNDTYPE", "value": "1"},
        {"section": "JJXQ", "key": "FUNDTYPENAME", "value": "股票型"},
    ]


def test_today_best_generates_full_audit_csv(tmp_path, monkeypatch):
    from warehouse import paths

    monkeypatch.setattr(paths, "CACHE_TODAY_BEST_DIR", str(tmp_path))
    os.makedirs(paths.CACHE_TODAY_BEST_DIR, exist_ok=True)

    job = app_module._today_best_jobs.create(
        {"period_code": "Z", "top_n": 10, "selected_types": [], "min_return": ""},
        ttl_seconds=1800,
    )
    job_id = job["job_id"]

    with patch.object(app_module.fund_repository, "get_fund_list") as mocked_list, patch.object(
        app_module.fund_repository, "get_fund_overview"
    ) as mocked_overview:
        mocked_list.return_value = [
            {"fund_code": "000001", "fund_name": "A"},
            {"fund_code": "000002", "fund_name": "B"},
            {"fund_code": "000003", "fund_name": "C"},
        ]

        def fake_overview(code: str):
            if code == "000001":
                return _items_jdzf()
            if code == "000002":
                raise RuntimeError("boom")
            if code == "000003":
                # 缺 rank/sc，但有涨幅
                return [{"section": "JDZF", "key": "Z.syl", "value": "1.0%"}]
            return []

        mocked_overview.side_effect = fake_overview

        app_module._run_today_best_job(job_id)

    files = list(Path(tmp_path).glob("*.csv"))
    assert len(files) == 1

    with files[0].open("r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    assert len(rows) == 3
    by_code = {r["fund_code"]: r for r in rows}

    assert by_code["000001"]["is_match"] == "1"
    assert by_code["000001"]["unmatch_reasons"] == ""
    assert by_code["000001"]["return_pct"] != ""
    assert by_code["000001"]["rank"] != ""

    assert by_code["000002"]["is_match"] == "0"
    assert "抓取基金详情失败" in by_code["000002"]["unmatch_reasons"]

    assert by_code["000003"]["is_match"] == "0"
    assert "缺少同类排名或总数" in by_code["000003"]["unmatch_reasons"]

