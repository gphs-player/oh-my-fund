# AI Agent 开发指南

## 项目概述

"一个亿小目标" - 个人基金理财计算器，Flask 后端 + 纯前端业务逻辑。

## 构建和运行

```bash
pip install -r requirements.txt  # 安装依赖 (仅 Flask==3.0.0)
python app.py                    # 启动开发服务器 (端口 5001)
open http://localhost:5001       # 访问
```

**注意**: 本项目无自动化测试，所有验证需手动在浏览器中进行。

## 项目结构

```
fund-calculator/
├── app.py                 # Flask 入口 + API 接口 (端口 5001)
├── data/
│   └── markets.csv        # 市场列表 (服务端存储，CSV 格式)
├── templates/
│   ├── index.html         # 主页面模板 (Jinja2)
│   └── partials/          # 可复用模板片段
├── static/
│   ├── css/style.css      # 自定义样式 (毛玻璃、霓虹效果)
│   └── js/
│       ├── utils.js       # 工具函数 (CSV、验证、Toast)
│       ├── investment.js  # 投资计划 + 市场管理
│       ├── annualized.js  # 年化计算器
│       └── compound.js    # 复利计算器
└── docs/plans/            # 设计文档
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Flask 3.0.0 (页面渲染 + 市场列表 API) |
| 前端 | Tailwind CSS (CDN) + DaisyUI 4.6.0 |
| 图表 | Chart.js 4.4.1 |
| 存储 | 服务端 CSV (市场) + 前端内存 (投资数据) |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/markets` | 获取市场列表 |
| POST | `/api/markets` | 保存市场列表 (JSON 数组，全量覆盖) |

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

### 投资记录字段

```javascript
{
    id: Number,             // 时间戳 ID
    fund_name: String,      // 基金名称 (必填)
    fund_code: String,      // 基金代码 (5-8位数字)
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

- Tab 切换: 主 Tab 用 `data-tab`，子 Tab 用 `data-subtab`
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
| 子 Tab 影响父 Tab | 使用 `[data-subtab]` 选择器 |
| 金额过长 | 使用 `formatMoney()` 转万/亿单位 |
| 市场下拉为空 | 检查 `/api/markets` 接口和 `MarketManager.load()` |

---

## 手动测试清单

修改后验证：

- [ ] Tab 切换正常 (投资计划/多维选基/年化计算器/复利计算器)
- [ ] 投资记录增删改正常
- [ ] CSV 导入导出数据完整
- [ ] 市场管理 (添加/删除/保存) 正常
- [ ] 图表正确渲染
- [ ] 金额计算准确
- [ ] Toast 提示正常
- [ ] 模态框打开/关闭正常
