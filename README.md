# 一个亿小目标

个人基金理财工具，采用 **Flask 后端渲染 + 原生前端模块** 的方式实现，数据默认持久化到服务端 `data/` 目录下的 CSV 文件。

当前项目已经不只是计算器，核心能力包括：

- 我的持仓管理
- 基金榜（全部 / 自选 / 分组）
- 策略列表 + 独立策略详情页
- 基于基金历史净值的策略分析
- AI 选基（基于 LLM 的一键基金分析，带进度展示）
- AI 选基（提示词生成“筛选方案草案”，边界不明确时弹框补全并重新生成）
- 数据源管理与缓存（基金列表 + 历史净值）
- 年化 / 复利计算器

---

## 功能概览

### 1. 我的持仓

- 持仓增删改查（`fund_code` 为主键）
- CSV 导入 / 导出
- 仓位占比与汇总
- 图表分析：按板块 / 风险等级 / 持有计划
- 市场管理
- 从基金榜一键带入“添加持仓”弹框

### 2. 基金榜

- 懒加载基金列表（`/api/funds`，服务端分页：`pageNum/pageSize`）
- 搜索（`q`）、类型筛选（`fund_type_code`）、分页
- “全部” / “自选”双视图
- 自选分组管理
- 基金列表一键分享：生成 1080×1920 图片（背景高斯模糊 + 底部二维码），支持预览与下载 PNG
- 基金详情弹层（四块：基金详情/阶段涨幅/基金规模/基金持仓）
- 支持把基金加入持仓或加入自选

### 3. 策略

当前策略模块已重构为：

- 首页 `策略` Tab：只展示策略列表与“新建策略”入口
- 独立详情页：
  - `/strategies/new`
  - `/strategies/<strategy_id>`

详情页支持：

- 选择基金
- 选择期间快捷项：半年 / 1年 / 2年 / 3年 / 全部
- 日期选择器
- 加载历史净值并渲染开收实体图
- 选择一个或多个内置策略
- 调整策略参数
- 运行策略分析
- 模拟买卖（回测）：基于买卖点信号生成交易明细，计算收益率
- 未平仓处理：期末按最新净值估值，并在明细中追加“期末估值（未平仓）”行
- 交易明细增强：新增“持仓市值”列，便于直观看到持仓变化
- 基准对比：期初买入持有到期末（Buy & Hold）收益率与超额收益
- 一键导出：交易信号 CSV、交易明细 CSV、诊断 JSON（用于排查）、回测报告 PNG
- 保存 / 删除策略

当前图表体验已支持：

- 开收实体图（基于净值数据推导 open / close）
- 策略叠加线（如双均线、RSI、布林带等）
- 买卖点标记
- 鼠标滚轮缩放、拖拽平移、重置缩放

当前内置策略模块位于 `strategies/`：

- 双均线趋势 `trend_sma`
- RSI 超买超卖 `rsi`
- 布林带突破 `bollinger`
- 定投节奏 `dca`

### 4. 计算器

- 年化收益率计算器
- 复利计算器

### 5. 设置

- 数据源新增 / 编辑 / 删除 / 启停 / 测试
- 缓存过期天数设置
- 基金列表缓存状态查看与手动刷新
- AI 模型配置：
  - 选择提供商（Claude / DeepSeek / OpenAI）
  - 动态拉取模型列表并下拉选择
  - 测试连接与保存配置

---

## 最近实现变更

- 数据源兜底：激活数据源失败时自动回退到 Default 数据源重试并返回
- 数据源切换：激活/停用数据源后强制清理本地缓存（基金列表/历史净值/实时估值），避免读到旧数据
- 基金列表接口 `/api/funds` 已改为服务端分页：返回 `pageNum/pageSize/total/items`，并支持 `q`、`fund_type_code`
- 新增基金类型接口：`GET /api/funds/types`
- （已移除）东方财富手机接口数据源（`eastmoney_mob`）：不再作为可选数据源；基金榜能力由 Default 数据源内置“基金排名”提供
- 基金详情弹层 UI 已重构为 4 个 Tab：
  - 阶段涨幅：对比图表 + 同类排名表（去掉“差异”列）
  - 基金规模：按日期柱状图（Y 轴展示单位“万/亿”）
  - 基金持仓：十大持仓股（横向柱状图，百分比直接画在 bar 上，无 tooltip）+ 资产配置/行业分布（饼图）
- 基金详情弹层新增 Tab：基金经理（JJJL）
- 策略详情页走势图已从普通净值折线升级为**开收实体图**
- 图表支持**滚轮缩放、拖拽平移、重置缩放**
- 买卖点已做 Y 轴偏移，尽量避免压住实体图与均线交叉位置
- 策略分析与回测已合并为统一接口：`POST /api/strategy-run`（一次返回分析结果 + 回测结果）
- 回测引擎已下沉到后端（`strategies/backtest.py`），前端只负责渲染
- 策略详情页支持导出：交易信号 CSV / 交易明细 CSV / 诊断 JSON / 回测报告 PNG（前端用 html2canvas 截图导出）
- 涨跌/收益/买卖信号配色语义更新：红色表示赚/涨/买入，绿色表示亏/跌/卖出
- 历史净值改为：
  - 数据源层始终抓取**全量历史**
  - 服务端按基金做**当日缓存**
  - 时间区间由服务端本地过滤
- 历史净值缓存与基金列表缓存分离：
  - 基金列表缓存按 `cache_expire_days`
  - 历史净值缓存仅当天有效
- 基金榜新增“分享”功能：将当前页基金列表渲染为 1080×1920 海报图片（iframe 隔离避免 oklch，背景高斯模糊在 Canvas 内烘焙），并在底部附加二维码用于个人宣传
- 设置页 AI 模型“模型名称”下拉框改为自定义 combobox，支持动态拉取模型列表并可搜索选择
- 新增基金关键字搜索接口：`GET /api/funds/search?q=...&limit=...`
  - 数据源来自东方财富 `fundcode_search.js`
  - 缓存有效期截至“最近一个 15:00”（15:00 前到今日 15:00；15:00 后到次日 15:00）
- AI 选基交互优化：
  - 从自选点选仅回填基金代码，不自动触发分析
  - 分析流程改为异步任务 + 轮询进度，前端展示步骤进度条
  - AI 选基输入框支持关键字联想（防抖），添加持仓弹框支持名称/代码联想（防抖）
- AI 选基（提示词选基）：
  - 新增接口：`POST /api/ai-fund-pick/parse` 生成筛选草案（draft JSON）
  - 边界不明确时：弹框列出缺失项（支持用户输入 + 建议），点击“重新生成草案”会再次调用 LLM 生成新的草案
  - 最多允许 3 轮补全；仍缺失则提示用户改写提示词
  - 当存在排序或偏好但未指定 TopN 时，会强制弹框确认 TopN（返回数量）

---

## 技术栈

- 后端：Flask 3.0.0
- 前端：Tailwind CSS（CDN）+ DaisyUI 4.6.0
- 图表：Chart.js 4.4.1
- 存储：服务端 CSV

---

## 运行方式

```bash
pip install -r requirements.txt
python3 app.py
```

启动后访问：

- 首页：`http://localhost:5001`
- 新建策略详情页：`http://localhost:5001/strategies/new`

说明：

- 本项目当前无自动化测试，改动后主要依赖手工验证
- 如果本机没有 `python` 命令，请使用 `python3`

---

## 数据与持久化

所有数据默认写入项目目录下的 `data/`，并按“业务数据 / 缓存”分目录管理：

### 业务数据（会持久化，建议备份）：`data/store/`

- `data/store/markets.csv`：市场列表
- `data/store/investments.csv`：持仓数据
- `data/store/favorites.csv`：自选基金主表
- `data/store/favorite_groups.csv`：自选分组定义
- `data/store/favorite_group_memberships.csv`：自选基金分组关系
- `data/store/datasources.csv`：数据源配置
- `data/store/settings.csv`：全局设置
- `data/store/strategies.csv`：策略记录（支持单策略或多策略组合）

### 缓存（可删除重建，不建议备份）：`data/cache/`

- `data/cache/funds_list/YYYY_MM_DD.csv`：基金列表缓存
- `data/cache/fund_history_value/<fund_code>/YYYY_MM_DD.csv`：基金历史净值当日缓存
（已移除）基金关键字搜索缓存目录（原 `data/cache/fund_search/`）：搜索接口已改为基于基金列表缓存，不再使用该缓存逻辑。
- `data/cache/ai_analysis/<fund_code>/YYYYMMDD_1500.csv`：AI 分析缓存（文件名体现截止时间点 15:00）

---

## 数据源与仓库层

基金相关数据统一通过 `warehouse/` 提供：

- `FundRepository.get_fund_list()`：基金列表
- `FundRepository.get_fund_overview(fund_code)`：基金基本概况
- `FundRepository.get_fund_history(fund_code, start_date, end_date)`：基金历史净值
- `FundRepository.get_fund_gz(fund_code)`：实时估值 / 涨跌幅

当前缓存策略：

- 基金列表：内存 + CSV，按 `settings.csv` 里的 `cache_expire_days` 失效
- 历史净值：内存 + CSV，**仅当天有效**

当前历史净值链路：

- 数据源层总是拉取基金**全量历史净值**
- `FundRepository` 对全量历史做当日缓存
- 接口层和策略分析传入的 `start_date / end_date` 在服务端本地过滤

默认数据源当前已实现：

- 东方财富基金列表
- 东方财富基金基本概况
- 东方财富基金历史净值
- 东方财富实时估值

说明：

- 已移除“东方财富手机接口（eastmoney_mob）”作为可选数据源；
- 基金榜列表接口改为 Default 数据源内置的“基金排名”能力（按日涨跌幅排序），并沿用东财 FundType 枚举做筛选。

`lixinger` / `tushare` 目前仍是适配器占位，未接入真实历史净值与基金列表能力。

---

## API 概览

### 基础数据

- `GET /api/markets`
- `POST /api/markets`
- `GET /api/investments`
- `POST /api/investments`
- `PUT /api/investments/<fund_code>`
- `DELETE /api/investments/<fund_code>`

### 自选与分组

- `GET /api/favorites`
- `POST /api/favorites`
- `DELETE /api/favorites/<fund_code>`
- `GET /api/favorite-groups`
- `POST /api/favorite-groups`
- `PUT /api/favorite-groups/<group_id>`
- `DELETE /api/favorite-groups/<group_id>`
- `GET /api/favorite-group-memberships`
- `PUT /api/favorites/<fund_code>/groups`

### 数据源 / 设置 / 缓存

- `GET /api/datasources/types`
- `GET /api/datasources`
- `POST /api/datasources`
- `GET /api/datasources/<id>`
- `PUT /api/datasources/<id>`
- `DELETE /api/datasources/<id>`
- `POST /api/datasources/<id>/activate`
- `POST /api/datasources/<id>/deactivate`
- `POST /api/datasources/<id>/test`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/cache/info`
- `POST /api/cache/refresh`

### 基金数据

- `GET /api/funds`
- `GET /api/funds/types`
- `GET /api/funds/search`（关键字搜索基金，匹配 code/name，数据来源为基金列表接口缓存）
- `GET /api/funds/<fund_code>/overview`
- `GET /api/funds/<fund_code>/history`
- `GET /api/funds/<fund_code>/gz`
- `GET /api/funds/gz`

### AI 选基

- `POST /api/funds/<fund_code>/ai-analysis`（兼容旧逻辑：同步分析）
- `POST /api/funds/<fund_code>/ai-analysis/jobs`（推荐：创建异步任务，返回 job_id）
- `GET /api/ai-analysis/jobs/<job_id>`（查询进度与结果）

### 策略

- 页面路由：
  - `GET /strategies/new`
  - `GET /strategies/<strategy_id>`
- 策略接口：
  - `GET /api/strategy-types`
  - `GET /api/strategies`
  - `POST /api/strategies`
  - `GET /api/strategies/<strategy_id>`
  - `PUT /api/strategies/<strategy_id>`
  - `DELETE /api/strategies/<strategy_id>`
  - `POST /api/strategy-run`（推荐）
  - `POST /api/strategy-analysis/run`（兼容旧逻辑，可能后续移除）

---

## 目录结构

```text
fund-calculator/
├── app.py
├── data/
├── strategies/                  # 内置策略模块
│   ├── base.py
│   ├── backtest.py              # 后端回测引擎（分析接口统一返回回测结果）
│   ├── registry.py
│   ├── trend_sma.py
│   ├── rsi.py
│   ├── bollinger.py
│   └── dca.py
├── warehouse/
│   ├── repository.py
│   ├── cache.py
│   ├── analysis/                # AI 分析编排（量化指标 + LLM）
│   ├── llm/                     # LLM 适配（Claude/DeepSeek/OpenAI）
│   └── adapters/
├── templates/
│   ├── index.html               # 首页
│   ├── strategy_detail.html     # 策略详情页
│   └── partials/
├── static/
│   ├── css/style.css
│   └── js/
│       ├── utils.js
│       ├── combobox.js
│       ├── investment.js
│       ├── fund-select.js
│       ├── ai-pick.js
│       ├── strategy.js          # 首页策略列表逻辑
│       ├── strategy-detail.js   # 策略详情页逻辑
│       ├── annualized.js
│       ├── compound.js
│       └── settings.js
└── tools/
```

---

## 前端约定

所有前端模块继续采用对象字面量模式：

```javascript
const ModuleName = {
    init: function() {
        // ...
    }
};

document.addEventListener('DOMContentLoaded', function() {
    ModuleName.init();
});
```

---

## 手动验证建议

### 首页

- Tab 切换正常
- 持仓、选基、计算器、设置正常工作
- `/#strategy` 能正确落到策略 Tab

### 策略列表

- 首页“策略”Tab 正常加载策略列表
- 点击“新建策略”进入 `/strategies/new`
- 点击某条策略进入 `/strategies/<id>`

### 策略详情页

- 新建页空白状态正常
- 已保存策略可正确回填名称、基金、期间、策略栈
- 快捷期间与日期选择器联动正常
- 加载净值、运行分析、保存、删除正常
- 开收实体图显示正常
- 图表滚轮缩放、拖拽平移、重置缩放正常
- 买卖点不明显压住蜡烛实体和均线交叉点
- 单策略和多策略组合都能运行分析
- 回测模块可生成交易明细与总收益率
- 未平仓时：明细包含“期末估值（未平仓）”行，摘要显示持仓收益率与浮动盈亏
- 交易明细包含“持仓市值”列且数值合理（买入后≈现金，卖出后=0，期末估值≈期末资产）
- Buy & Hold：显示基准收益率、基准期末资产与超额收益
- 导出：交易信号 CSV / 交易明细 CSV / 诊断 JSON 均可下载
- 颜色语义：红=买入/上涨/盈利，绿=卖出/下跌/亏损

### 基金榜

- 全部 / 自选视图切换正常
- 自选分组新增 / 重命名 / 删除正常
- 基金详情弹层正常

### AI 选基

- 输入基金代码：联想下拉可用（防抖）
- 从自选点击：仅回填代码，不自动分析
- 点击“开始分析”后：进度条与步骤推进正常，完成后展示评分与因子卡片

---

## 备注

- 当前文档以代码实现为准
- `QUICKSTART.md` 等旧文档可能仍有早期描述，若冲突请以本 README 和实际代码为准
