# 今日牛基：手动触发 + 每次生成全量审计 CSV Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除「今日牛基」视图的自动触发；每次用户点击“刷新”都会跑一次任务并生成一份新的“全量基金审计 CSV”，包含命中与未命中的原因。

**Architecture:** 保持现有“异步任务 + 轮询”不变；前端仅移除进入视图自动触发逻辑。后端在 `_run_today_best_job` 遍历全量基金时为每只基金生成审计行，任务结束后写入 `data/cache/today_best/` 下以时间戳 + job_id 命名的 CSV 文件。

**Tech Stack:** Flask + 原生 JS（对象字面量模块）+ 服务端 CSV（`warehouse/paths.py` 统一路径）

---

## 文件结构与变更点（锁定）

**Modify:**
- `static/js/fund-select.js`：移除切换到 today-best 时的自动触发计算
- `warehouse/paths.py`：新增 today_best 缓存目录常量并纳入 `ensure_dirs()`
- `app.py`：
  - `_run_today_best_job(job_id)`：在 done 前写入全量审计 CSV
  - （可选）在 `job.result` 里附带 `csv_file`（不强制，若实现可便于排查）

**Add (optional):**
- `tests/test_today_best_csv_audit.py`：新增后端 CSV 审计文件生成的单测（推荐）

---

## Task 1：前端移除自动触发（today-best 进入不再跑任务）

**Files:**
- Modify: `static/js/fund-select.js`（`applyFilters()` 中 `selectedScope === 'today-best'` 分支）

- [ ] **Step 1: 写/补充一个“前端行为”最低限度的回归点（不做自动化也行）**
  - 备注：当前项目前端缺少自动化测试；本任务用“手动验收步骤”作为回归点即可。
  - 手动验收：
    1) 打开首页 -> 进入「基金榜」-> 点击「今日牛基」
    2) 观察进度区：应显示“未开始计算/请点击刷新”，且不会立刻出现 done/total 递增
    3) 点击“刷新”后才开始滚动进度

- [ ] **Step 2: 修改实现**
  - 在 `applyFilters()` 的 today-best 分支中，删除下面的自动触发（以实际代码为准）：
    - `void this.startTodayBest({ clear: true });`
  - 保留 `renderTodayBestFilters()` / `renderTodayBestProgress()` 以及 `render()` 的调用，确保 UI 正常显示。

- [ ] **Step 3: 本地手动验证**
  - Run: `python3 app.py`
  - 打开：`http://localhost:5001`
  - Expected：
    - 切到 today-best 不会自动开始
    - 点击刷新才开始计算并轮询

- [ ] **Step 4: 提交**
```bash
git add static/js/fund-select.js
git commit -m "fix(today-best): remove auto-run on entering scope"
```

---

## Task 2：新增 today_best 缓存目录常量（统一路径）

**Files:**
- Modify: `warehouse/paths.py`

- [ ] **Step 1: 写 failing test（推荐）**
  - 新增测试文件 `tests/test_paths_today_best_dir.py`（若你希望保持测试文件数量少，可并入现有 tests）。
```python
import os
from warehouse import paths


def test_ensure_dirs_creates_today_best_cache_dir(tmp_path, monkeypatch):
    # 将 DATA_DIR 指到临时目录（通过 monkeypatch module-level 常量）
    monkeypatch.setattr(paths, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(paths, "STORE_DIR", os.path.join(str(tmp_path), "store"))
    monkeypatch.setattr(paths, "CACHE_DIR", os.path.join(str(tmp_path), "cache"))
    monkeypatch.setattr(paths, "CACHE_FUNDS_LIST_DIR", os.path.join(paths.CACHE_DIR, "funds_list"))
    monkeypatch.setattr(paths, "CACHE_FUND_HISTORY_VALUE_DIR", os.path.join(paths.CACHE_DIR, "fund_history_value"))
    monkeypatch.setattr(paths, "CACHE_AI_ANALYSIS_DIR", os.path.join(paths.CACHE_DIR, "ai_analysis"))
    monkeypatch.setattr(paths, "BACKUP_DIR", os.path.join(str(tmp_path), "_backup"))

    # 断言新目录常量存在并会被创建
    assert hasattr(paths, "CACHE_TODAY_BEST_DIR")
    paths.ensure_dirs()
    assert os.path.isdir(paths.CACHE_TODAY_BEST_DIR)
```

- [ ] **Step 2: 运行测试确认失败**
  - Run: `pytest -q`
  - Expected: FAIL（`CACHE_TODAY_BEST_DIR` 不存在）

- [ ] **Step 3: 实现最小改动**
  - 在 `warehouse/paths.py` 新增：
    - `CACHE_TODAY_BEST_DIR = os.path.join(CACHE_DIR, "today_best")`
  - 在 `ensure_dirs()` 增加：
    - `os.makedirs(CACHE_TODAY_BEST_DIR, exist_ok=True)`

- [ ] **Step 4: 重新跑测试**
  - Run: `pytest -q`
  - Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add warehouse/paths.py tests/test_paths_today_best_dir.py
git commit -m "feat(paths): add today_best cache dir"
```

---

## Task 3：后端生成“全量审计 CSV”（每次刷新必生成新文件）

**Files:**
- Modify: `app.py`（`_run_today_best_job`）
- Modify: `warehouse/paths.py`（若 Task2 已完成，这里只负责引用常量）
- Add: `tests/test_today_best_csv_audit.py`（推荐）

### 设计要点（实现约束）
- 每次 job 完成时生成新文件：`YYYYMMDD_HHMMSS_<job_id>.csv`
- 文件写在：`warehouse.paths.CACHE_TODAY_BEST_DIR`
- CSV 必须包含**所有基金代码**（即 `fund_repository.get_fund_list()` 返回中的所有 fund_code）
- 每行包含：
  - `fund_code,fund_name,period_code,return_pct,rank,sc,fund_type_value,fund_type_name,is_match,unmatch_reasons`
- `unmatch_reasons`：
  - 多原因用 `|` 拼接
  - 命中则为空字符串

### 建议实现策略
- 在遍历基金时，为每只基金都产出一条 `audit_row`（无论命中与否）。
- 命中列表（用于最终 TopN）继续使用当前 `candidates`，但需要从审计行中复用解析后的字段避免重复解析。
- 写 CSV 用 `csv.DictWriter` 流式逐行写，避免大内存。

- [ ] **Step 1: 写 failing test（推荐）**
  - 新增 `tests/test_today_best_csv_audit.py`，关键点：
    - patch `app_module.fund_repository.get_fund_list` 返回 3 只基金
    - patch `app_module.fund_repository.get_fund_overview`：
      - A：返回包含 JDZF 的 rank/sc/syl + JJXQ fund type（应命中）
      - B：抛异常（应写入原因：抓取失败）
      - C：返回缺 rank/sc（应写入原因：缺少同类排名或总数）
    - patch `warehouse.paths.CACHE_TODAY_BEST_DIR` 指向 `tmp_path`
    - 调用 `_run_today_best_job(job_id)`（建议直接调用，而不是走 executor）
    - 断言：tmp_path 下生成 1 个 CSV 文件，且 CSV 行数 == 3，并且每行的 `is_match/unmatch_reasons` 符合预期

示例骨架（以实际 import 为准）：
```python
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
    # 将 today_best cache dir 指到临时目录
    from warehouse import paths
    monkeypatch.setattr(paths, "CACHE_TODAY_BEST_DIR", str(tmp_path))
    os.makedirs(paths.CACHE_TODAY_BEST_DIR, exist_ok=True)

    # 创建 job
    job = app_module._today_best_jobs.create({"period_code": "Z", "top_n": 10, "selected_types": [], "min_return": ""}, ttl_seconds=1800)
    job_id = job["job_id"]

    with patch.object(app_module.fund_repository, "get_fund_list") as mocked_list, \
         patch.object(app_module.fund_repository, "get_fund_overview") as mocked_overview:
        mocked_list.return_value = [
            {"fund_code": "000001", "fund_name": "A"},
            {"fund_code": "000002", "fund_name": "B"},
            {"fund_code": "000003", "fund_name": "C"},
        ]

        def fake_overview(code):
            if code == "000001":
                return _items_jdzf()
            if code == "000002":
                raise RuntimeError("boom")
            if code == "000003":
                return [{"section": "JDZF", "key": "Z.syl", "value": "1.0%"}]  # 缺 rank/sc
            return []

        mocked_overview.side_effect = fake_overview

        app_module._run_today_best_job(job_id)

    # 断言生成 CSV
    files = list(Path(tmp_path).glob("*.csv"))
    assert len(files) == 1
    with files[0].open("r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 3
    by_code = {r["fund_code"]: r for r in rows}
    assert by_code["000001"]["is_match"] == "1"
    assert by_code["000001"]["unmatch_reasons"] == ""
    assert by_code["000002"]["is_match"] == "0"
    assert "抓取基金详情失败" in by_code["000002"]["unmatch_reasons"]
    assert by_code["000003"]["is_match"] == "0"
    assert "缺少同类排名或总数" in by_code["000003"]["unmatch_reasons"]
```

- [ ] **Step 2: 跑测试确认失败**
  - Run: `pytest -q`
  - Expected: FAIL（尚未生成 CSV）

- [ ] **Step 3: 实现 CSV 生成**
  - 在 `app.py` 的 `_run_today_best_job` 中：
    1) 引入 `from warehouse.paths import CACHE_TODAY_BEST_DIR`
    2) 在任务开始处确保目录存在：`os.makedirs(CACHE_TODAY_BEST_DIR, exist_ok=True)`
    3) 遍历期间构造 `audit_rows`（建议 list of dict；或直接流式写文件 + 同时维护 candidates）
    4) 遍历完成后写 CSV 文件：
       - 文件名：`datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + job_id + ".csv"`
       - 使用 `csv.DictWriter`，写 header + 每行写入
    5) done 更新时可选将 `csv_file` 写入 result（不强制）：
       - `result: {"rows": rows, "types": types, "csv_file": filename}`

- [ ] **Step 4: 重新跑测试**
  - Run: `pytest -q`
  - Expected: PASS

- [ ] **Step 5: 本地手动验证**
  - Run: `python3 app.py`
  - 打开：`http://localhost:5001` -> 基金榜 -> 今日牛基 -> 点击刷新
  - Expected：
    - `data/cache/today_best/` 下出现新 CSV（每次刷新都会新增一个新文件）

- [ ] **Step 6: 提交**
```bash
git add app.py tests/test_today_best_csv_audit.py
git commit -m "feat(today-best): generate full audit csv per refresh"
```

---

## Task 4：最终回归与清理

**Files:**
- Modify: 视实际改动而定

- [ ] **Step 1: 全量跑测试**
  - Run: `pytest -q`
  - Expected: PASS

- [ ] **Step 2: 按项目手动清单回归（最小集）**
  - 今日牛基：进入不自动跑、刷新才跑、每次刷新生成 CSV
  - 基金榜：全部/自选分页仍正常

- [ ] **Step 3: 确保 `.gitignore`（可选）**
  - 说明：`data/cache/**` 通常不应提交；若仓库已忽略则跳过。若未忽略，补充 `.gitignore`。

- [ ] **Step 4: 最终提交（若有零碎修复）**
```bash
git status --porcelain
# 若有变更再 add/commit
```

---

Plan complete and saved to `docs/superpowers/plans/2026-05-19-today-best-manual-trigger-and-csv-audit.md`. Ready to execute?

