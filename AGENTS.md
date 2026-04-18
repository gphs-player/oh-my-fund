# AI Agent 开发指南

## 项目概述

"一个亿小目标" - 个人基金理财计算器，Flask 后端 + 纯前端业务逻辑。

## 工程现状（以代码为准）

- 持久化已迁移为服务端 CSV（`data/` 下文件），不再依赖浏览器 `localStorage`
- 新增基金数据仓库层（`warehouse/`）：数据源切换 + 基金列表缓存（内存 + CSV）
- 新增「多维选基」模块：从 `/api/funds` 加载基金列表，支持搜索/筛选/分页，可一键带入“添加持仓”弹框，并支持基金详情弹层（走 `/api/funds/<fund_code>/overview`）
- 设置页支持数据源管理与缓存刷新（基金列表缓存文件名：`funds_list_cache_YYYY_MM_DD.csv`）
- 顶部导航中的「年化计算器」与「复利计算器」已合并为「计算器」主 Tab，内容区再区分两个入口
- 数据源抽象层新增基金基本信息能力：所有数据源适配器必须实现 `get_fund_overview(fund_code)`

## 构建和运行

```bash
pip install -r requirements.txt  # 安装依赖 (仅 Flask==3.0.0)
python3 app.py                   # 启动开发服务器 (端口 5001)
open http://localhost:5001       # 访问
```

**注意**: 本项目无自动化测试，所有验证需手动在浏览器中进行。

## 项目结构

```
fund-calculator/
├── app.py                 # Flask 入口 + API 接口 (端口 5001)
├── data/
│   ├── markets.csv        # 市场列表 (服务端存储)
│   ├── investments.csv    # 持仓数据 (服务端存储，fund_code 为主键)
│   ├── datasources.csv    # 数据源配置
│   └── settings.csv       # 全局设置
│   └── funds_list_cache_*.csv  # 基金列表缓存（自动生成）
├── warehouse/             # 数据仓库层
│   ├── __init__.py
│   ├── cache.py           # FundCache 缓存管理
│   ├── repository.py      # FundRepository 统一入口
│   └── adapters/          # 数据源适配器
│       ├── base.py        # BaseDataSource 基类
│       ├── eastmoney_overview.py # 东方财富基金基本概况提取逻辑
│       ├── factory.py     # 工厂方法 + 注册表
│       ├── default.py     # 默认数据源（东方财富基金列表 + 基本概况）
│       ├── lixinger.py    # 理杏仁适配器
│       └── tushare.py     # Tushare 适配器
├── tools/
│   └── extract_fund_overview.py  # 东方财富基金基本概况提取脚本
├── templates/
│   ├── index.html         # 主页面模板 (Jinja2)
│   └── partials/          # 可复用模板片段
├── static/
│   ├── css/style.css      # 自定义样式 (毛玻璃、霓虹效果)
│   ├── images/            # 图标、背景、Logo
│   └── js/
│       ├── utils.js       # 工具函数 (CSV、验证、Toast)
│       ├── investment.js  # 我的持仓 + 市场管理
│       ├── fund-select.js # 多维选基
│       ├── annualized.js  # 年化计算器
│       ├── compound.js    # 复利计算器
│       └── settings.js    # 设置页管理
└── docs/plans/            # 设计文档
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Flask 3.0.0 (页面渲染 + 市场列表 API) |
| 前端 | Tailwind CSS (CDN) + DaisyUI 4.6.0 |
| 图表 | Chart.js 4.4.1 |
| 存储 | 服务端 CSV (市场、持仓、数据源、设置) |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/markets` | 获取市场列表 |
| POST | `/api/markets` | 保存市场列表 (JSON 数组，全量覆盖) |
| GET | `/api/investments` | 获取所有持仓 |
| POST | `/api/investments` | 添加持仓 (fund_code 重复则报错) |
| PUT | `/api/investments/<fund_code>` | 更新持仓 |
| DELETE | `/api/investments/<fund_code>` | 删除持仓 |
| GET | `/api/datasources/types` | 获取支持的数据源类型 |
| GET | `/api/datasources` | 获取数据源列表 |
| POST | `/api/datasources` | 添加数据源 |
| GET | `/api/datasources/<id>` | 获取单个数据源详情（含配置） |
| PUT | `/api/datasources/<id>` | 更新数据源 |
| DELETE | `/api/datasources/<id>` | 删除数据源 |
| POST | `/api/datasources/<id>/activate` | 激活数据源（自动停用其他） |
| POST | `/api/datasources/<id>/deactivate` | 停用数据源 |
| POST | `/api/datasources/<id>/test` | 测试数据源连接 |
| GET | `/api/settings` | 获取全局设置 |
| PUT | `/api/settings` | 更新全局设置 |
| GET | `/api/cache/info` | 获取缓存状态 |
| POST | `/api/cache/refresh` | 手动刷新缓存 |
| GET | `/api/funds` | 获取基金列表（走缓存逻辑） |
| GET | `/api/funds/<fund_code>/overview` | 获取单只基金基本信息（原始键值表） |

---

## 代码规范

### JavaScript 模块模式 (强制)

所有 JS 模块必须使用对象字面量模式：

```javascript
const ModuleName = {
    data: [],
    init: function() { this.render(); },
    methodName: function(params) { /* 实现 */ }
};
document.addEventListener('DOMContentLoaded', function() { ModuleName.init(); });
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 模块对象 | PascalCase | `InvestmentManager`, `MarketManager` |
| 方法/变量 | camelCase | `renderChart`, `totalPosition` |
| HTML ID | kebab-case | `investment-table-body`, `market-modal` |
| CSS 类 | Tailwind/DaisyUI | `btn-primary`, `card-body` |
| 数据字段 | snake_case | `fund_name`, `trade_type`, `holding_plan` |
| Python 函数 | snake_case | `read_markets`, `ensure_markets_file` |
| Python 常量 | UPPER_SNAKE_CASE | `MARKETS_FILE`, `DEFAULT_MARKETS` |

### 持仓记录字段

```javascript
{
    fund_code: String,      // 基金代码 (5-8位数字，主键)
    fund_name: String,      // 基金名称 (必填)
    sector: String,         // 板块
    position: Number,       // 仓位金额 (>=0)
    trade_type: String,     // "场内" | "场外"
    market: String,         // 从 /api/markets 获取
    risk_level: String,     // "高" | "中高" | "中" | "低"
    holding_plan: String    // "长期" | "中期" | "短期"
}
```

### 工具函数 (utils.js)

```javascript
// 验证
Validator.required(value)    // 非空验证
Validator.fundCode(code)     // 5-8位数字
Validator.position(pos)      // 数字且 >= 0
Validator.number(value)      // 有效数字

// Toast 提示
showToast('消息', 'success')  // success | error | warning | info

// CSV 操作
parseCSV(csvText)            // 解析 CSV 文本
generateCSV(data, headers)   // 生成 CSV 字符串
downloadCSV(data, headers, filename)  // 下载 CSV 文件
```

### CSS 样式规范

- 组件: DaisyUI 类 (`btn`, `card`, `input`, `table`)
- 自定义样式: `static/css/style.css`
- 主题色: 蓝 `#60a5fa`, 紫 `#a78bfa`, 青 `#22d3ee`, 黄 `#fbbf24`
- 文字: 主要 `#e2e8f0`，次要 `#cbd5e1`

### HTML 规范

- Tab 切换: 主 Tab 用 `data-tab`，分组子 Tab 用 `data-subtab-group` + `data-subtab-target`
- 首个 Tab 需 `style="display: block;"`
- 模态框: `<dialog>` + `.showModal()` / `.close()`
- 验证: HTML5 原生 (`required`, `pattern`, `min`, `max`)

---

## 常见开发任务

### 添加投资字段

1. `templates/index.html`: 修改 `<thead>` 和模态框表单
2. `static/js/investment.js`: 修改 `render()` 和 `handleSubmit()`
3. 更新 CSV 导入导出的 headers 数组

### 添加新 Tab 模块

1. `templates/index.html`: 添加 Tab 按钮 (`data-tab="xxx"`) 和内容区域 (`id="xxx-tab"`)
2. 创建 `static/js/xxx.js`: 使用对象字面量模式
3. `templates/index.html`: 底部 `<script src="/static/js/xxx.js"></script>`

### 修改图表

- 投资饼图: `InvestmentUI.renderChart()` in `investment.js`
- 复利折线图: `CompoundCalculator.renderChart()` in `compound.js`
- 颜色: 各模块的 `getColor(index, alpha)` 方法

### 基金详情弹层

- 入口: `FundSelector.showDetail(fundCode)` in `fund-select.js`
- 后端接口: `GET /api/funds/<fund_code>/overview`
- 弹层节点: `#fund-detail-modal`
- 当前布局: 顶部标题 + 详情键值表（单行两组字段），加载态为 spinner

---

## 错误处理模式

```javascript
// 验证失败 - 提前返回
if (!Validator.fundCode(code)) { showToast('错误', 'error'); return; }

// try-catch + Toast
try { const data = parseCSV(text); }
catch (e) { showToast('失败: ' + e.message, 'error'); }

// async API 调用
try { const res = await fetch('/api/markets'); }
catch (e) { showToast('加载失败', 'error'); }
```

---

## 已知问题

| 问题 | 解决方案 |
|------|----------|
| Tab 内容不显示 | 检查 `</div>` 闭合是否正确 |
| 子 Tab 影响父 Tab | 使用分组子 Tab：`data-subtab-group` + `data-subtab-target` |
| 金额过长 | 使用 `formatMoney()` 转万/亿单位 |
| 市场下拉为空 | 检查 `/api/markets` 接口和 `MarketManager.load()` |

---

## 手动测试清单

修改后验证：

- [ ] Tab 切换正常 (我的持仓/多维选基/计算器/设置)
- [ ] 计算器二级入口切换正常 (年化计算器/复利计算器)
- [ ] 投资记录增删改正常
- [ ] CSV 导入导出数据完整
- [ ] 市场管理 (添加/删除/保存) 正常
- [ ] 图表正确渲染
- [ ] 金额计算准确
- [ ] Toast 提示正常
- [ ] 模态框打开/关闭正常
- [ ] 多维选基基金详情弹层加载、错误、关闭正常
