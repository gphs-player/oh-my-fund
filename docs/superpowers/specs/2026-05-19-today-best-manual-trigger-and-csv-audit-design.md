# 今日牛基：改为手动触发 + 每次生成全量审计 CSV（设计稿）

日期：2026-05-19  
范围：基金榜 Tab 的「今日牛基」视图（today-best）

## 背景与目标

当前「今日牛基」在切换到该视图时会自动触发一次计算任务（异步 + 轮询）。本次改造目标：

1. **删除自动触发**：进入「今日牛基」视图时不再自动开始计算；用户需要在手动确认筛选条件后点击「刷新」才开始筛选/计算。
2. **生成筛选缓存 CSV（审计文件）**：每次点击「刷新」触发的计算，都要把**全量基金**写入一份新的缓存 CSV，包含：
   - 基金名称、基金代码
   - 阶段涨幅、阶段排名（以及同类总数 sc，如可得）
   - 是否符合筛选条件
   - 不符合筛选条件的原因（可多原因）

> 说明：此 CSV 用作“本次筛选的审计与排查”，不要求作为前端渲染的数据源。

## 非目标

- 不做同条件复用缓存（用户明确要求：每次点击都重复生成）。
- 不引入定时预计算或离线任务调度。
- 不改变基金榜「全部/自选」现有接口与分页逻辑。

## 现状简述（以代码为准）

- 前端：`static/js/fund-select.js`
  - `FundSelector.switchScope('today-best')` 进入 today-best 时，会在 `applyFilters()` 分支中“自动触发一次计算”（调用 `startTodayBest({ clear: true })`）。
  - `refreshTodayBest()` 会清空并手动触发 `startTodayBest({ clear: true })`。
  - `startTodayBest()`：调用 `POST /api/today-best/jobs` 创建任务，并轮询 `GET /api/today-best/jobs/<job_id>` 更新进度与结果。
- 后端：`app.py`
  - `POST /api/today-best/jobs`：创建异步任务（ThreadPoolExecutor）。
  - `_run_today_best_job(job_id)`：遍历基金列表，调用 `fund_repository.get_fund_overview(code)` 并解析 JDZF/JJXQ 字段，进行过滤与排序，最终返回 TopN rows + types。

## 交互设计

### 进入「今日牛基」视图

- **不自动开始计算**。
- 仅展示：
  - 今日牛基专用筛选区（周期 / TopN / 类型多选 / 最小涨幅）
  - 进度区显示「未开始计算，请点击刷新」
  - 结果表保持空态

### 用户点击「刷新」

- 创建计算任务 -> 前端开始轮询进度
- 任务完成后：
  - 渲染结果表（TopN rows）
  - 提示“计算完成：命中 X，失败 Y”
  - **后端生成一份新的全量审计 CSV**（见下文）

### 用户点击「停止」

- 取消轮询 + 调用取消接口（尽力而为）
- 不要求停止已发出的并发请求立刻终止

## 后端：全量审计 CSV 设计

### 输出目录

新增目录（若不存在则创建）：

- `data/cache/today_best/`

### 文件命名（每次点击唯一）

每次「刷新」都会生成一份新文件：

- `data/cache/today_best/YYYYMMDD_HHMMSS_<job_id>.csv`

示例：

- `data/cache/today_best/20260519_184233_8f1c....csv`

### CSV 字段（列）

建议列（UTF-8，逗号分隔）：

- `fund_code`：基金代码
- `fund_name`：基金名称
- `period_code`：周期（如 Z/Y/3Y...）
- `return_pct`：阶段涨幅（float，可为空）
- `rank`：阶段排名（int，可为空）
- `sc`：同类总数（int，可为空）
- `fund_type_value`：基金类型值（可为空）
- `fund_type_name`：基金类型名称（可为空）
- `is_match`：是否符合筛选条件（0/1）
- `unmatch_reasons`：不符合原因（字符串；多原因用 `|` 拼接；符合条件则为空）

### 不符合原因（枚举）

允许多原因同时存在，建议原因 key（中文即可）：

- `抓取基金详情失败`
- `缺少同类排名或总数`（rank/sc 任一缺失）
- `类型不匹配`
- `涨幅缺失`
- `涨幅不足(<min_return>)`

### 生成时机与一致性

- 生成时机：`_run_today_best_job` 遍历完成后（即掌握全量基金的“解析结果 + 是否匹配 + 原因”），一次性写入 CSV。
- 一致性：CSV 记录以“任务本次执行”的网络抓取结果为准；不依赖历史文件。

### 内存与性能注意

- 若基金数量较大，CSV 写入应采用**流式写入**（逐行写），避免一次性拼装超大字符串。
- 进度更新保持当前粗粒度策略（每 20 条或结束更新一次）以减少锁竞争。

## 前端：删除自动触发点

### 修改点

文件：`static/js/fund-select.js`

- 在 `applyFilters()` 中，当 `selectedScope === 'today-best'` 时，删除/移除：
  - `void this.startTodayBest({ clear: true });`

保留：

- 用户点击按钮触发：`FundSelector.refreshTodayBest()`（显式重算）
- `renderTodayBestFilters()` / `renderTodayBestProgress()` 的展示逻辑

## API 合约

保持不变：

- `POST /api/today-best/jobs`
- `GET /api/today-best/jobs/<job_id>`
- `POST /api/today-best/jobs/<job_id>/cancel`

增强点（实现细节，不改变返回字段也可）：

- 后端在 done 时生成 CSV 文件；如需后续扩展，可在 job `result` 内增加 `csv_path`（当前不强制）。

## 验收清单

- [ ] 切换到「今日牛基」视图不会自动开始计算
- [ ] 用户点击「刷新」才开始计算并展示进度
- [ ] 每次点击「刷新」都会生成一份新的 CSV 文件（文件名包含时间戳与 job_id）
- [ ] CSV 包含**全量基金**，并包含：基金名称/代码/阶段涨幅/阶段排名/是否匹配/不匹配原因
- [ ] TopN 结果与筛选条件一致
- [ ] 「停止」后前端轮询停止，后端任务状态变为 canceled（尽力而为）

