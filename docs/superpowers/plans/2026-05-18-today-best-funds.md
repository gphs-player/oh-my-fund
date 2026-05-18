# 今日牛基（基金榜第三视图）Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在基金榜页新增与「全部/自选」同级的「今日牛基」视图：按所选周期的同类排名 TopN 实时计算，可筛选周期/TopN/类型(多选)/最小涨幅，并支持“清空后刷新”。

**Architecture:** 前端负责状态机 + 分批拉取 + 本地筛选排序；后端新增“全量基金 code 列表”与“overview 批量接口”以避免 N 次单基金请求压垮服务，并保持口径仍来自现有 overview(j5 解析)。

**Tech Stack:** Flask + 现有 FundRepository/DefaultDataSource；原生 JS 模块模式；CSV 既有缓存机制不变。

---

## 0. 预备：工作区与清理（避免污染）

> 注意：当前仓库存在无关脏改动（例如 `templates/index.html`、`templates/strategy_detail.html`、`static/vendor/`）。开始实现本计划前务必隔离。

- [ ] **Step 0.1：保存/丢弃无关改动**
  
Run（任选其一）：
```bash
git stash push -u -m "wip: unrelated changes before today-best"
```
或：
```bash
git restore templates/index.html templates/strategy_detail.html
rm -rf static/vendor
```

- [ ] **Step 0.2：创建特性分支**
```bash
git checkout -b feat/today-best-funds
```

---

## 1. 后端：新增 API（性能关键）

### Task 1.1：新增 `GET /api/funds/all-codes`

**Files:**
- Modify: `app.py`

**Steps:**
- [ ] **Step 1.1.1：写最小接口实现**
  - 新增 route：`/api/funds/all-codes`
  - 实现：调用 `fund_repository.get_fund_list()`，返回：
    - `success: true`
    - `items: [{fund_code, fund_name}]`
  - 错误：`{success:false,message}` + 500

- [ ] **Step 1.1.2：手动冒烟验证**
Run：
```bash
python3 app.py
```
浏览器访问：
```
http://localhost:5001/api/funds/all-codes
```
Expected：JSON 中 `success=true` 且 `items` 为数组。

- [ ] **Step 1.1.3：提交**
```bash
git add app.py
git commit -m "feat(api): add /api/funds/all-codes"
```

---

### Task 1.2：新增 `POST /api/funds/overview-batch`

**Files:**
- Modify: `app.py`

**Request/Response:**
- Request：`{"fund_codes":["000001","000002"]}`
- Response：
  - `success: true`
  - `items_by_code: { "000001": [ ...items ] }`
  - `errors: { "000002": "message" }`

**Steps:**
- [ ] **Step 1.2.1：写接口与并发聚合**
  - route：`/api/funds/overview-batch`
  - 校验：
    - `fund_codes` 必须为数组
    - 单次最多 100（超出返回 400）
  - 并发：`ThreadPoolExecutor(max_workers=12)`（可调）
  - 每个 code 调用：`fund_repository.get_fund_overview(code)`
  - 单个失败：写入 `errors[code]`，不中断其他

- [ ] **Step 1.2.2：手动冒烟验证（小批量）**
用浏览器控制台或 curl（示例）：
```bash
curl -s -X POST http://localhost:5001/api/funds/overview-batch \
  -H 'Content-Type: application/json' \
  -d '{"fund_codes":["000001","000011"]}'
```
Expected：返回包含 `items_by_code` 和 `errors` 字段（不要求全部成功）。

- [ ] **Step 1.2.3：提交**
```bash
git add app.py
git commit -m "feat(api): add /api/funds/overview-batch"
```

---

## 2. 测试（最小契约测试，避免回归）

> 项目现状以手测为主，但这两个接口是基础设施，建议补最小 pytest。测试应避免真实外部网络请求（用 monkeypatch 替换 `fund_repository.get_fund_overview`）。

### Task 2.1：新增测试文件

**Files:**
- Create: `tests/test_today_best_api.py`

**Steps:**
- [ ] **Step 2.1.1：写测试（可用 monkeypatch）**
  - Case A：`/api/funds/all-codes` 返回结构存在 `success/items`
  - Case B：`/api/funds/overview-batch`：
    - 空数组 => success true 且空映射
    - 超过上限 => 400
    - 正常 => `items_by_code/errors` 字段存在（通过 monkeypatch 返回固定 items）

- [ ] **Step 2.1.2：运行测试**
Run：
```bash
pytest -q
```
Expected：PASS

- [ ] **Step 2.1.3：提交**
```bash
git add tests/test_today_best_api.py
git commit -m "test(api): contract tests for today-best endpoints"
```

---

## 3. 前端：新增「今日牛基」第三视图 + UI

### Task 3.1：模板增加入口与筛选区容器

**Files:**
- Modify: `templates/partials/tab-fund-select.html`

**Steps:**
- [ ] **Step 3.1.1：新增视图切换按钮**
  - 在 `分享` 按钮后新增：
    - id：`fund-scope-today-best`
    - onclick：`FundSelector.switchScope('today-best')`

- [ ] **Step 3.1.2：新增「今日牛基筛选区」DOM（默认 hidden）**
  - 周期 select（默认 `Z`）
  - TopN number input（默认 1）+ 快捷按钮
  - 类型多选 dropdown（checkbox 列表容器 + “全选/清空”可选）
  - 最小涨幅 input（可空）
  - 刷新按钮：`FundSelector.refreshTodayBest()`（点击会清空并重算）
  -（可选）停止按钮：`FundSelector.stopTodayBest()`
  - 进度条/提示区：展示 `已处理/总数/命中/失败`

- [ ] **Step 3.1.3：提交**
```bash
git add templates/partials/tab-fund-select.html
git commit -m "feat(ui): add today-best scope entry and filter container"
```

---

### Task 3.2：FundSelector 状态机扩展（模块模式）

**Files:**
- Modify: `static/js/fund-select.js`

**Steps:**
- [ ] **Step 3.2.1：扩展 scope**
  - `switchScope()` 支持 `'today-best'`
  - `renderScopeButtons()` 给 today-best 按钮正确 active 样式

- [ ] **Step 3.2.2：新增 today-best 状态字段**
  - `todayBestPeriodCode = 'Z'`
  - `todayBestTopN = 1`
  - `todayBestSelectedTypes = new Set()`（空表示不限制）
  - `todayBestMinReturn = null`
  - `todayBestRunning / todayBestAbortController`
  - `todayBestProgress {done,total,hit,failed}`
  - `todayBestRows = []`

- [ ] **Step 3.2.3：新增渲染分支**
  - today-best 时隐藏原 discovery filters（keyword/type）
  - today-best 时显示新筛选区与进度区

- [ ] **Step 3.2.4：提交**
```bash
git add static/js/fund-select.js
git commit -m "feat(fund): add today-best scope state and rendering"
```

---

### Task 3.3：今日牛基计算流程（分批 + 可取消 + 清空刷新）

**Files:**
- Modify: `static/js/fund-select.js`

**核心函数（建议新增）：**
- `startTodayBest({ clear: true })`
- `refreshTodayBest()`（= stop + clear + start）
- `stopTodayBest()`
- `parseOverviewItemsToTodayBestRow(items, periodCode)`（纯函数，便于单测/自测）

**Steps:**
- [ ] **Step 3.3.1：实现刷新/停止入口**
  - 刷新：清空 `todayBestRows`、重置 progress、重算
  - 停止：abort 当前批请求并停止后续循环
  - 切走 scope 时自动 stop

- [ ] **Step 3.3.2：实现分批拉取与进度更新**
  - 拉 `/api/funds/all-codes`
  - batchSize 默认 80
  - 每批 POST `/api/funds/overview-batch`
  - 每批处理后更新：done/failed/hit

- [ ] **Step 3.3.3：字段抽取与过滤（与 spec 对齐）**
  - 从 `section==='JDZF'` 里按 key `${period}.rank/sc/syl` 取值
  - 缺 rank/sc => 排除
  - `minReturn` 启用时：syl 解析失败 => 排除
  - 类型：从 `section==='JJXQ'` 中按实际 key 取；不命中多选集合 => 排除

- [ ] **Step 3.3.4：排序与截断**
  - rank 升序；syl 降序；fund_code 升序
  - 截断 topN

- [ ] **Step 3.3.5：进入 today-best 自动执行一次**
  - 切到 scope 时若非 running，则 `startTodayBest({clear:true})`

- [ ] **Step 3.3.6：提交**
```bash
git add static/js/fund-select.js
git commit -m "feat(fund): implement today-best calculation with refresh/abort"
```

---

## 4. 手动验收（浏览器）

Run：
```bash
pip install -r requirements.txt
python3 app.py
open http://localhost:5001
```

Checklist：
- [ ] 「分享」后出现「今日牛基」，点击切换正确
- [ ] 默认（近1周 Top1）进入即开始计算，进度可见
- [ ] 刷新：会清空表格与进度并重新计算
- [ ] 周期切换 + 刷新：结果变化，且按 rank 升序
- [ ] TopN 改大：数量正确且不包含缺 rank/sc
- [ ] 类型多选：过滤生效
- [ ] 最小涨幅：过滤生效（syl 解析失败也会被排除）
- [ ] 点击行可打开基金详情弹层
- [ ] 切走 scope 后不再继续后台拉取（已停止）

---

## 5. Assumptions / Defaults
- 默认周期：`Z`（近1周）
- TopN 默认：1，上限：200
- `/api/funds/overview-batch` 单次上限：100；前端 batchSize 默认 80
- 类型字段从 JJXQ items 中读取：实现前先用任意基金 overview 确认具体 key（例如 `FUNDTYPE`）

