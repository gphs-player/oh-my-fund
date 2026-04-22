# 一个亿小目标

个人基金理财工具，采用 **Flask 后端渲染 + 原生前端模块** 的方式实现，数据默认持久化到服务端 `data/` 目录下的 CSV 文件。

当前项目已经不只是计算器，核心能力包括：

- 我的持仓管理
- 多维选基（全部 / 自选 / 分组）
- 策略列表 + 独立策略详情页
- 基于基金历史净值的策略分析
- 数据源管理与基金列表缓存
- 年化 / 复利计算器

---

## 功能概览

### 1. 我的持仓

- 持仓增删改查（`fund_code` 为主键）
- CSV 导入 / 导出
- 仓位占比与汇总
- 图表分析：按板块 / 风险等级 / 持有计划
- 市场管理
- 从多维选基一键带入“添加持仓”弹框

### 2. 多维选基

- 懒加载基金列表（`/api/funds`）
- 搜索、类型筛选、分页
- “全部” / “自选”双视图
- 自选分组管理
- 基金详情弹层（基金基本概况）
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
- 加载历史净值并渲染走势图
- 选择一个或多个内置策略
- 调整策略参数
- 运行策略分析
- 保存 / 删除策略

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

所有数据默认写入项目目录下的 `data/`：

- `markets.csv`：市场列表
- `investments.csv`：持仓数据
- `favorites.csv`：自选基金主表
- `favorite_groups.csv`：自选分组定义
- `favorite_group_memberships.csv`：自选基金分组关系
- `datasources.csv`：数据源配置
- `settings.csv`：全局设置
- `strategies.csv`：策略记录（支持单策略或多策略组合）
- `funds_list_cache_YYYY_MM_DD.csv`：基金列表缓存

---

## 数据源与仓库层

基金相关数据统一通过 `warehouse/` 提供：

- `FundRepository.get_fund_list()`：基金列表
- `FundRepository.get_fund_overview(fund_code)`：基金基本概况
- `FundRepository.get_fund_history(fund_code, start_date, end_date)`：基金历史净值
- `FundRepository.get_fund_gz(fund_code)`：实时估值 / 涨跌幅

默认数据源当前已实现：

- 东方财富基金列表
- 东方财富基金基本概况
- 东方财富基金历史净值
- 东方财富实时估值

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
- `GET /api/funds/<fund_code>/overview`
- `GET /api/funds/<fund_code>/history`
- `GET /api/funds/<fund_code>/gz`
- `GET /api/funds/gz`

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
  - `POST /api/strategy-analysis/run`

---

## 目录结构

```text
fund-calculator/
├── app.py
├── data/
├── strategies/                  # 内置策略模块
│   ├── base.py
│   ├── registry.py
│   ├── trend_sma.py
│   ├── rsi.py
│   ├── bollinger.py
│   └── dca.py
├── warehouse/
│   ├── repository.py
│   ├── cache.py
│   └── adapters/
├── templates/
│   ├── index.html               # 首页
│   ├── strategy_detail.html     # 策略详情页
│   └── partials/
├── static/
│   ├── css/style.css
│   └── js/
│       ├── utils.js
│       ├── investment.js
│       ├── fund-select.js
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
- 单策略和多策略组合都能运行分析

### 多维选基

- 全部 / 自选视图切换正常
- 自选分组新增 / 重命名 / 删除正常
- 基金详情弹层正常

---

## 备注

- 当前文档以代码实现为准
- `QUICKSTART.md` 等旧文档可能仍有早期描述，若冲突请以本 README 和实际代码为准
