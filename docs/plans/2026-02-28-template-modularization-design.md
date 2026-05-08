# 模板模块化拆分设计

## 背景

`templates/index.html` 单文件 385 行，包含 4 个 Tab 内容区 + 2 个模态框 + Tab 切换逻辑，随着功能增加维护困难。

## 目标

以 Tab 为模块划分，每个文件职责单一，便于独立维护。

## 方案

采用 Jinja2 `{% include %}` 拆分，不引入前端框架，最小改动。

## 文件结构

```
templates/
├── index.html              # 主布局骨架
└── partials/
    ├── tab-investment.html     # 投资计划 Tab（内含模态框引入）
    ├── tab-fund-select.html    # 基金市场 Tab
    ├── tab-annualized.html     # 年化计算器 Tab
    ├── tab-compound.html       # 复利计算器 Tab
    ├── modal-investment.html   # 投资记录模态框
    └── modal-market.html       # 市场管理模态框
```

## 引入关系

```
index.html
├── {% include 'partials/tab-investment.html' %}
│   ├── {% include 'partials/modal-investment.html' %}
│   └── {% include 'partials/modal-market.html' %}
├── {% include 'partials/tab-fund-select.html' %}
├── {% include 'partials/tab-annualized.html' %}
└── {% include 'partials/tab-compound.html' %}
```

## 各文件职责

| 文件 | 内容 |
|------|------|
| `index.html` | `<head>`, 导航栏, Tab include, JS 引入, Tab 切换逻辑 |
| `tab-investment.html` | 投资计划卡片 + 2 个模态框 include |
| `tab-fund-select.html` | 基金市场卡片（待实现占位） |
| `tab-annualized.html` | 年化计算器卡片 + 子 Tab |
| `tab-compound.html` | 复利计算器卡片 |
| `modal-investment.html` | 添加/编辑投资记录 dialog |
| `modal-market.html` | 管理市场 dialog |

## 设计原则

1. **模态框按需引入**：模态框在使用它的 Tab 内部 include，不在主文件统一引入
2. **不追求复用**：各模态框为特定功能设计，不强求通用化
3. **保持现有结构**：`<head>`、导航栏、JS 引入保留在 `index.html`，不做模板继承

## 实施步骤

1. 创建 `templates/partials/` 目录
2. 提取 `modal-investment.html`（行 243-314）
3. 提取 `modal-market.html`（行 316-338）
4. 提取 `tab-investment.html`（行 43-122），末尾添加模态框 include
5. 提取 `tab-fund-select.html`（行 124-131）
6. 提取 `tab-annualized.html`（行 133-198）
7. 提取 `tab-compound.html`（行 200-237）
8. 修改 `index.html`，用 include 替换原内容
9. 手动验证所有 Tab 和模态框功能正常
