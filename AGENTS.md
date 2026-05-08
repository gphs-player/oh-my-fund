## 关于我

我的名字是牛宝，是一名Android开发工程师。

## 注意

永远用中文回答问题。

--- project-doc ---

# AI Agent 开发指南

## 项目概述

“一个亿小目标” - 个人基金理财工具，采用 Flask 后端渲染 + 原生前端业务逻辑，服务端 CSV 持久化。

## 工程现状（以代码为准）

- 持久化已迁移为服务端 CSV（`data/` 下文件），不再依赖浏览器 `localStorage`
- 已有基金数据仓库层（`warehouse/`）：数据源切换 + 基金列表缓存（内存 + CSV）+ 历史净值缓存（内存 + CSV）
- 数据源兜底：当前激活数据源失败时，会自动用 Default 数据源重试并返回
- 数据源切换：激活/停用数据源后会强制清理本地缓存（基金列表/历史净值/实时估值），避免读到旧数据
- 默认数据源已支持：
  - 基金列表
  - 基金基本概况
  - 基金历史净值
  - 实时估值 / 涨跌幅
- 新增东方财富手机接口数据源（`eastmoney_mob`）已支持：
  - 基金列表（支持 `pageNum/pageSize` 分页、`fund_type_code` 类型过滤）
  - 基金类型列表（固定枚举）
  - 基金详情（四块：基金详情/JJXQ、阶段涨幅/JDZF、基金规模/JJGM、基金持仓/JJCC）
- 基金市场模块已支持：
  - “全部” / “自选”双视图
  - 搜索 / 筛选 / 分页
  - 基金详情弹层
  - 自选分组管理
- 顶部导航中的“年化计算器”和“复利计算器”已合并为“计算器”主 Tab
- 策略模块已重构为：
  - 首页 `策略` Tab：展示策略列表与新建入口
  - 独立详情页：`/strategies/new`、`/strategies/<strategy_id>`
  - 详情页支持基金选择、期间快捷选择、日期选择器、加载净值、内置策略组合、参数调整、运行分析、保存、删除
  - 图表当前为开收实体图，支持策略叠加线、买卖点、滚轮缩放、拖拽平移、重置缩放
  - 策略分析 + 回测已合并为统一接口：`POST /api/strategy-run`（一次返回分析结果 + 回测结果）
  - 回测引擎已下沉到后端（`strategies/backtest.py`），前端只负责渲染
  - 详情页“模拟买卖（回测）”：交易明细、期末估值（未平仓）、持仓市值列、Buy & Hold 基准对比与超额收益；并支持导出（信号 CSV / 交易 CSV / 诊断 JSON / 回测报告 PNG）
- 策略记录当前支持“单策略”与“多策略组合”两种使用方式，底层都保存为 `stack`
- 新增 `strategies/` 目录，每个内置策略为一个独立 Python 文件

## 构建和运行

```bash
pip install -r requirements.txt
python3 app.py
open http://localhost:5001
```

**注意**：本项目当前无自动化测试，所有验证以手动浏览器验证为主。

## 项目结构

```text
fund-calculator/
├── app.py
├── data/
│   ├── markets.csv
│   ├── investments.csv
│   ├── favorites.csv
│   ├── favorite_groups.csv
│   ├── favorite_group_memberships.csv
│   ├── datasources.csv
│   ├── settings.csv
│   ├── strategies.csv
│   ├── funds_list_cache_*.csv
│   └── fund_history_cache_<fund_code>_*.csv
├── strategies/
│   ├── base.py
│   ├── backtest.py
│   ├── registry.py
│   ├── trend_sma.py
│   ├── rsi.py
│   ├── bollinger.py
│   └── dca.py
├── warehouse/
│   ├── cache.py
│   ├── repository.py
│   └── adapters/
│       ├── base.py
│       ├── default.py
│       ├── eastmoney_overview.py
│       ├── eastmoney_mob.py
│       ├── factory.py
│       ├── lixinger.py
│       └── tushare.py
├── templates/
│   ├── index.html
│   ├── strategy_detail.html
│   └── partials/
├── static/
│   ├── css/style.css
│   └── js/
│       ├── utils.js
│       ├── investment.js
│       ├── fund-select.js
│       ├── strategy.js
│       ├── strategy-detail.js
│       ├── annualized.js
│       ├── compound.js
│       └── settings.js
└── tools/
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Flask 3.0.0 |
| 前端 | Tailwind CSS（CDN）+ DaisyUI 4.6.0 |
| 图表 | Chart.js 4.4.1 |
| 存储 | 服务端 CSV |

## API / 页面路由

### 页面路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 首页 |
| GET | `/strategies/new` | 新建策略详情页 |
| GET | `/strategies/<strategy_id>` | 策略详情页 |

### 策略接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/strategy-types` | 获取动态注册的内置策略类型 |
| GET | `/api/strategies` | 获取策略列表 |
| POST | `/api/strategies` | 新建策略 |
| GET | `/api/strategies/<strategy_id>` | 获取单条策略详情 |
| PUT | `/api/strategies/<strategy_id>` | 更新策略 |
| DELETE | `/api/strategies/<strategy_id>` | 删除策略 |
| POST | `/api/strategy-run` | 执行策略分析 + 回测（推荐） |
| POST | `/api/strategy-analysis/run` | 执行策略分析（兼容旧逻辑） |

### 基金接口（策略相关）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/funds` | 获取基金列表 |
| GET | `/api/funds/types` | 获取基金类型列表（用于筛选） |
| GET | `/api/funds/<fund_code>/overview` | 获取基金基本概况 |
| GET | `/api/funds/<fund_code>/history` | 获取历史净值 |
| GET | `/api/funds/<fund_code>/gz` | 获取单只基金实时估值 |
| GET | `/api/funds/gz` | 批量 / 分页获取实时估值 |

## 代码规范

### JavaScript 模块模式（强制）

所有 JS 模块继续使用对象字面量模式：

```javascript
const ModuleName = {
    init: function() {},
    methodName: function() {}
};

document.addEventListener('DOMContentLoaded', function() {
    ModuleName.init();
});
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 模块对象 | PascalCase | `InvestmentManager`, `StrategyListPage`, `StrategyDetailPage` |
| 方法/变量 | camelCase | `renderChart`, `loadHistoryOnly` |
| HTML ID | kebab-case | `strategy-detail-name`, `strategy-list-summary` |
| 数据字段 | snake_case | `fund_name`, `fund_code`, `holding_plan` |
| Python 函数 | snake_case | `read_strategies`, `resolve_date_range` |
| Python 常量 | UPPER_SNAKE_CASE | `MARKETS_FILE`, `DEFAULT_MARKETS` |

## 策略模块开发约定

### 策略记录结构

策略记录底层统一为：

```json
{
  "strategy_id": "...",
  "name": "...",
  "fund_code": "...",
  "fund_name": "...",
  "date_range": {
    "preset": "6m",
    "start_date": "2026-01-01",
    "end_date": "2026-06-30",
    "full_history": false
  },
  "backtest_config": {
    "initial_cash": 10000,
    "fill_model": "same_day_nav",
    "sizing_mode": "all_in",
    "fixed_amount": 1000,
    "fixed_percent": 1,
    "fee_rate": 0
  },
  "signal_overrides": [],
  "stack": [
    {
      "strategy_type": "trend_sma",
      "enabled": true,
      "display_enabled": true,
      "params": {}
    }
  ]
}
```

### 内置策略模块规范

每个内置策略放在 `strategies/` 下的独立文件中，并通过 `strategies/registry.py` 注册。

策略模块至少要提供：

- 类型标识
- 名称
- 描述
- 参数 schema
- 默认参数
- `run(history, params)`

返回结果需兼容：

- `overlays`
- `signals`
- `meta`

其中 signals 已补充字段（以代码为准）：

- `signal_uid`：信号唯一标识（便于后续覆盖与追踪）
- `price_ref`：用于回测取价的参考值（默认等于 value）

### 历史净值与分析

- 历史净值统一通过 `FundRepository.get_fund_history()` 获取
- 当前默认数据源走东方财富历史净值接口
- 数据源层当前始终抓取基金**全量历史净值**
- `FundRepository` 会对单基金历史净值做**当日缓存**
- `start_date / end_date / full_history` 当前由服务端本地过滤
- “全部”区间通过 `full_history=true` 表达
- 前端详情页负责：
  - 快捷区间与日期选择器联动
  - 加载净值
  - 调用 `/api/strategy-run` 运行分析 + 回测并渲染结果
  - 渲染开收实体图、叠加线与信号列表
  - 展示回测结果：交易明细、期末估值（未平仓）、持仓市值列、Buy & Hold 基准对比与超额收益（回测计算在后端）
  - 导出诊断信息（信号 CSV / 交易 CSV / 诊断 JSON）与回测报告 PNG（前端截图导出）

### 配色语义约定（重要）

- 红色：赚 / 涨 / 买入
- 绿色：亏 / 跌 / 卖出

### 缓存现状

- 基金列表缓存：
  - 内存 + CSV
  - 受 `settings.csv` 中 `cache_expire_days` 控制
- 历史净值缓存：
  - 内存 + CSV
  - 仅当天有效，跨天自动失效
  - 文件模式：`fund_history_cache_<fund_code>_YYYY_MM_DD.csv`

## 常见开发任务

### 修改策略列表页

1. `templates/partials/tab-strategy.html`
2. `static/js/strategy.js`

### 修改策略详情页

1. `templates/strategy_detail.html`
2. `static/js/strategy-detail.js`
3. 如需后端回填或保存字段，修改 `app.py`

### 新增内置策略

1. 在 `strategies/` 下新增一个策略文件
2. 在 `strategies/registry.py` 注册
3. 确认参数 schema、默认值、输出 overlays/signals 结构正确
4. 手动验证详情页可添加并运行该策略

### 修改历史净值加载

1. `warehouse/repository.py`
2. `warehouse/cache.py`
3. `warehouse/adapters/base.py`
4. `warehouse/adapters/default.py`
5. 如涉及详情页交互，再同步修改 `static/js/strategy-detail.js`

## 错误处理模式

```javascript
if (!Validator.fundCode(code)) {
    showToast('错误', 'error');
    return;
}

try {
    const res = await fetch('/api/funds');
} catch (e) {
    showToast('加载失败', 'error');
}
```

## 手动测试清单

修改后重点验证：

- [ ] 首页 Tab 切换正常
- [ ] `/#strategy` 能正确切到策略 Tab
- [ ] 策略列表正常展示
- [ ] 新建策略可进入 `/strategies/new`
- [ ] 点击列表项可进入 `/strategies/<id>`
- [ ] 详情页基金搜索可用
- [ ] 半年 / 1年 / 2年 / 3年 / 全部 与日期选择器联动正常
- [ ] 加载净值正常
- [ ] 开收实体图渲染正常
- [ ] 图表滚轮缩放 / 拖拽平移 / 重置缩放正常
- [ ] 买卖点不会明显压住实体图与均线交叉位置
- [ ] 运行分析正常
- [ ] 回测摘要（总收益率 / 持仓收益率 / 浮动盈亏 / Buy & Hold / 超额）展示正确
- [ ] 交易明细包含“持仓市值”列且数值合理
- [ ] 未平仓时：明细包含“期末估值（未平仓）”行
- [ ] 导出信号 CSV / 交易 CSV / 诊断 JSON 可用
- [ ] 红涨绿跌、红买绿卖配色语义正确
- [ ] 单策略与多策略组合都能保存和回填
- [ ] 已保存策略可删除
- [ ] 基金市场、自选分组、设置、计算器未被破坏

## 备注

- 以代码为准
- 若 README、QUICKSTART、旧计划文档之间有冲突，以当前代码和本文件说明为准
