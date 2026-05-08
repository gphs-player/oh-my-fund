# 模板模块化拆分实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `index.html` 按 Tab 模块拆分为独立的 Jinja2 模板片段，便于维护。

**Architecture:** 使用 Jinja2 `{% include %}` 指令，将 4 个 Tab 内容区和 2 个模态框拆分为独立文件，模态框在使用它的 Tab 内部引入。

**Tech Stack:** Flask / Jinja2

**注意:** 本项目无自动化测试，每个 Task 完成后需手动在浏览器验证功能正常。

---

### Task 1: 创建 partials 目录

**Files:**
- Create: `templates/partials/` (目录)

**Step 1: 创建目录**

```bash
mkdir -p templates/partials
```

**Step 2: 验证目录创建成功**

```bash
ls -la templates/
```

Expected: 显示 `partials` 目录

**Step 3: Commit**

```bash
git add templates/partials/.gitkeep 2>/dev/null || touch templates/partials/.gitkeep && git add templates/partials/.gitkeep
git commit -m "chore: 创建 templates/partials 目录"
```

---

### Task 2: 提取投资记录模态框

**Files:**
- Create: `templates/partials/modal-investment.html`
- Source: `templates/index.html:243-314`

**Step 1: 创建模态框文件**

提取 `index.html` 第 243-314 行（`<!-- 添加/编辑模态框 -->` 到 `</dialog>`）到新文件：

```html
<!-- 添加/编辑模态框 -->
<dialog id="investment-modal" class="modal">
    <div class="modal-box bg-base-300/90 backdrop-blur-md">
        <h3 class="font-bold text-lg mb-4" id="modal-title">添加投资记录</h3>
        <form id="investment-form" onsubmit="InvestmentUI.handleSubmit(event)">
            <input type="hidden" id="investment-id">

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">基金名称 *</span></label>
                <input type="text" id="fund-name" class="input input-bordered" required>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">基金代码 * (5-8位数字)</span></label>
                <input type="text" id="fund-code" class="input input-bordered" pattern="\d{5,8}" required>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">板块 *</span></label>
                <input type="text" id="sector" class="input input-bordered" required>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">仓位金额 * (元)</span></label>
                <input type="number" id="position" class="input input-bordered" min="0" step="0.01" required>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">场内外 *</span></label>
                <select id="trade-type" class="select select-bordered" required>
                    <option value="" disabled selected>请选择</option>
                    <option value="场内">场内</option>
                    <option value="场外">场外</option>
                </select>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">市场 *</span></label>
                <select id="market" class="select select-bordered" required>
                    <option value="" disabled selected>请选择市场</option>
                    <!-- 动态填充 -->
                </select>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">风险等级 *</span></label>
                <select id="risk-level" class="select select-bordered">
                    <option value="高">高</option>
                    <option value="中高">中高</option>
                    <option value="中" selected>中</option>
                    <option value="低">低</option>
                </select>
            </div>

            <div class="form-control mb-3">
                <label class="label"><span class="label-text">持有计划 *</span></label>
                <select id="holding-plan" class="select select-bordered">
                    <option value="长期">长期</option>
                    <option value="中期" selected>中期</option>
                    <option value="短期">短期</option>
                </select>
            </div>

            <div class="modal-action">
                <button type="button" class="btn" onclick="document.getElementById('investment-modal').close()">取消</button>
                <button type="submit" class="btn btn-primary">保存</button>
            </div>
        </form>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>关闭</button>
    </form>
</dialog>
```

**Step 2: Commit**

```bash
git add templates/partials/modal-investment.html
git commit -m "refactor: 提取投资记录模态框为独立模板"
```

---

### Task 3: 提取市场管理模态框

**Files:**
- Create: `templates/partials/modal-market.html`
- Source: `templates/index.html:316-338`

**Step 1: 创建模态框文件**

提取 `index.html` 第 316-338 行（`<!-- 管理市场模态框 -->` 到 `</dialog>`）到新文件：

```html
<!-- 管理市场模态框 -->
<dialog id="market-modal" class="modal">
    <div class="modal-box bg-base-300/90 backdrop-blur-md">
        <h3 class="font-bold text-lg mb-4">管理市场</h3>
        
        <div id="market-list" class="mb-4">
            <!-- 动态生成 -->
        </div>
        
        <div class="flex gap-2 mb-4">
            <input type="text" id="new-market" class="input input-bordered flex-1" placeholder="输入新市场名称">
            <button type="button" class="btn btn-primary" onclick="MarketManager.add()">添加</button>
        </div>
        
        <div class="modal-action">
            <button type="button" class="btn" onclick="document.getElementById('market-modal').close()">取消</button>
            <button type="button" class="btn btn-primary" onclick="MarketManager.save()">保存</button>
        </div>
    </div>
    <form method="dialog" class="modal-backdrop">
        <button>关闭</button>
    </form>
</dialog>
```

**Step 2: Commit**

```bash
git add templates/partials/modal-market.html
git commit -m "refactor: 提取市场管理模态框为独立模板"
```

---

### Task 4: 提取投资计划 Tab

**Files:**
- Create: `templates/partials/tab-investment.html`
- Source: `templates/index.html:43-122`

**Step 1: 创建 Tab 文件**

提取 `index.html` 第 43-122 行（`<div id="investment-tab">` 到对应的 `</div>`），并在末尾添加模态框 include：

```html
<div id="investment-tab" class="tab-content" style="display: block;">
    <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
        <div class="card-body">
            <div class="flex justify-between items-center mb-4">
                <h2 class="card-title gradient-text">投资计划</h2>
                <div class="flex gap-2">
                    <button class="btn btn-primary btn-sm" onclick="InvestmentUI.showAddModal()">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                        </svg>
                        添加
                    </button>
                    <label class="btn btn-secondary btn-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                        </svg>
                        导入CSV
                        <input type="file" accept=".csv" class="hidden" id="csv-import" onchange="InvestmentUI.handleImport(event)">
                    </label>
                    <button class="btn btn-accent btn-sm" onclick="InvestmentManager.exportCSV()">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                        导出CSV
                    </button>
                    <button class="btn btn-warning btn-sm text-white" onclick="MarketManager.showModal()">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
                        </svg>
                        管理市场
                    </button>
                </div>
            </div>
            <!-- 表格 -->
            <div class="overflow-x-auto">
                <table class="table table-zebra w-full">
                    <thead>
                        <tr>
                            <th>基金名称</th>
                            <th>基金代码</th>
                            <th>板块</th>
                            <th class="cursor-pointer" onclick="InvestmentUI.toggleSort('position')">
                                仓位金额 <span id="sort-icon-position">↓</span>
                            </th>
                            <th>仓位占比</th>
                            <th>场内外</th>
                            <th>市场</th>
                            <th class="cursor-pointer" onclick="InvestmentUI.toggleSort('risk_level')">
                                风险等级 <span id="sort-icon-risk"></span>
                            </th>
                            <th class="cursor-pointer" onclick="InvestmentUI.toggleSort('holding_plan')">
                                持有计划 <span id="sort-icon-plan"></span>
                            </th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody id="investment-table-body">
                        <!-- 动态生成 -->
                    </tbody>
                    <tfoot id="investment-table-footer">
                        <!-- 汇总行 -->
                    </tfoot>
                </table>
            </div>

            <!-- 图表区域 -->
            <div class="mt-8">
                <h3 class="text-xl font-bold mb-4">数据可视化</h3>
                <div class="flex gap-2 mb-4">
                    <button class="btn btn-sm btn-outline" style="color: #f5f5dc;" onclick="InvestmentUI.renderChart('sector')">按板块</button>
                    <button class="btn btn-sm btn-outline" style="color: #f5f5dc;" onclick="InvestmentUI.renderChart('risk_level')">按风险等级</button>
                    <button class="btn btn-sm btn-outline" style="color: #f5f5dc;" onclick="InvestmentUI.renderChart('holding_plan')">按持有计划</button>
                </div>
                <div class="flex justify-center" style="max-width: 500px; max-height: 500px; margin: 0 auto;">
                    <canvas id="investment-chart"></canvas>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- 投资计划相关模态框 -->
{% include 'partials/modal-investment.html' %}
{% include 'partials/modal-market.html' %}
```

**Step 2: Commit**

```bash
git add templates/partials/tab-investment.html
git commit -m "refactor: 提取投资计划 Tab 为独立模板"
```

---

### Task 5: 提取基金市场 Tab

**Files:**
- Create: `templates/partials/tab-fund-select.html`
- Source: `templates/index.html:124-131`

**Step 1: 创建 Tab 文件**

```html
<div id="fund-select-tab" class="tab-content hidden">
    <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
        <div class="card-body">
            <h2 class="card-title gradient-text">基金市场</h2>
            <!-- 内容待实现 -->
        </div>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add templates/partials/tab-fund-select.html
git commit -m "refactor: 提取基金市场 Tab 为独立模板"
```

---

### Task 6: 提取年化计算器 Tab

**Files:**
- Create: `templates/partials/tab-annualized.html`
- Source: `templates/index.html:133-198`

**Step 1: 创建 Tab 文件**

```html
<div id="annualized-tab" class="tab-content hidden">
    <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
        <div class="card-body">
            <h2 class="card-title gradient-text">年化收益率计算器</h2>

            <!-- 子Tab -->
            <div role="tablist" class="tabs tabs-bordered mb-4">
                <a role="tab" class="tab tab-active" data-subtab="method1">方式一：持有周期+总收益率</a>
                <a role="tab" class="tab" data-subtab="method2">方式二：期初期末净值</a>
            </div>

            <!-- 方式一 -->
            <div id="method1-content" class="subtab-content" style="display: block;">
                <form onsubmit="AnnualizedCalculator.calculateMethod1(event)" class="space-y-4">
                    <div class="form-control">
                        <label class="label"><span class="label-text">持有周期（年）</span></label>
                        <input type="number" id="years1" class="input input-bordered" min="0.01" step="0.01" required>
                    </div>

                    <div class="form-control">
                        <label class="label"><span class="label-text">总收益率（%）</span></label>
                        <input type="number" id="total-return1" class="input input-bordered" step="0.01" required>
                    </div>

                    <button type="submit" class="btn btn-sm text-white w-1/6 border-none" style="background: linear-gradient(135deg, #818cf8, #6366f1);">计算</button>

                    <div id="result1" class="alert alert-success hidden mt-4">
                        <div class="text-white">
                            <span class="font-bold">年化收益率：</span>
                            <span id="result1-value" class="text-2xl font-bold text-emerald-300"></span>
                        </div>
                    </div>
                </form>
            </div>

            <!-- 方式二 -->
            <div id="method2-content" class="subtab-content hidden">
                <form onsubmit="AnnualizedCalculator.calculateMethod2(event)" class="space-y-4">
                    <div class="form-control">
                        <label class="label"><span class="label-text">期初净值</span></label>
                        <input type="number" id="initial-nav" class="input input-bordered" step="0.0001" min="0" required>
                    </div>

                    <div class="form-control">
                        <label class="label"><span class="label-text">持有周期（年）</span></label>
                        <input type="number" id="years2" class="input input-bordered" min="0.01" step="0.01" required>
                    </div>

                    <div class="form-control">
                        <label class="label"><span class="label-text">期末净值</span></label>
                        <input type="number" id="final-nav" class="input input-bordered" step="0.0001" min="0" required>
                    </div>

                    <button type="submit" class="btn btn-sm text-white w-1/6 border-none" style="background: linear-gradient(135deg, #818cf8, #6366f1);">计算</button>

                    <div id="result2" class="alert alert-success hidden mt-4">
                        <div class="text-white">
                            <div><span class="font-bold">总收益率：</span><span id="result2-total" class="text-emerald-300"></span></div>
                            <div><span class="font-bold">年化收益率：</span><span id="result2-annual" class="text-2xl font-bold text-emerald-300"></span></div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add templates/partials/tab-annualized.html
git commit -m "refactor: 提取年化计算器 Tab 为独立模板"
```

---

### Task 7: 提取复利计算器 Tab

**Files:**
- Create: `templates/partials/tab-compound.html`
- Source: `templates/index.html:200-237`

**Step 1: 创建 Tab 文件**

```html
<div id="compound-tab" class="tab-content hidden">
    <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
        <div class="card-body">
            <h2 class="card-title gradient-text">复利计算器</h2>

            <div class="form-control mb-4">
                <label class="label"><span class="label-text">计算年限</span></label>
                <input type="number" id="compound-years" class="input input-bordered" value="20" min="1" max="50">
            </div>

            <div class="divider">投资项列表</div>

            <div id="investment-items" class="space-y-4">
                <!-- 动态生成投资项 -->
            </div>

            <div class="flex gap-4 mt-4">
                <button class="btn btn-sm text-white w-1/6 border-none" style="background: linear-gradient(135deg, #a78bfa, #8b5cf6);" onclick="CompoundCalculator.addItem()">
                    + 添加投资项
                </button>
                <button class="btn btn-sm text-white w-1/6 border-none" style="background: linear-gradient(135deg, #818cf8, #6366f1);" onclick="CompoundCalculator.calculate()">
                    计算复利
                </button>
            </div>

            <!-- 结果展示 -->
            <div id="compound-result" class="mt-6 hidden">
                <div class="divider">计算结果</div>
                <canvas id="compound-chart"></canvas>
                <div class="mt-4">
                    <table class="table table-sm w-full" id="compound-table">
                        <!-- 动态生成 -->
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add templates/partials/tab-compound.html
git commit -m "refactor: 提取复利计算器 Tab 为独立模板"
```

---

### Task 8: 重构 index.html 使用 include

**Files:**
- Modify: `templates/index.html`

**Step 1: 替换 Tab 内容区和模态框为 include 指令**

将 `index.html` 中的 Tab 内容区（行 43-237）和模态框（行 242-338）替换为：

```html
            <!-- Tab内容 -->
            {% include 'partials/tab-investment.html' %}
            {% include 'partials/tab-fund-select.html' %}
            {% include 'partials/tab-annualized.html' %}
            {% include 'partials/tab-compound.html' %}
```

删除原来的模态框部分（因为已在 tab-investment.html 中 include）。

**Step 2: 完整的新 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>一个亿小目标</title>
    <link rel="icon" type="image/svg+xml" href="{{ url_for('static', filename='images/favicon.svg') }}">

    <!-- Tailwind CSS + DaisyUI -->
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4.6.0/dist/full.min.css" rel="stylesheet" type="text/css" />
    <script src="https://cdn.tailwindcss.com"></script>

    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js"></script>

    <!-- 自定义样式 -->
    <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
</head>
<body class="min-h-screen bg-cover bg-center bg-fixed" style="background-image: url('{{ url_for('static', filename='images/background.jpg') }}');">

    <!-- 毛玻璃容器 -->
    <div class="min-h-screen backdrop-blur-md bg-black/30">
        <div class="container mx-auto px-4 pt-8 pb-6" style="max-width: 80%;">

            <!-- 顶部导航栏：左侧Logo+标题，右侧Tab -->
            <div class="flex justify-between items-center mb-10">
                <!-- 左侧：Logo + 标题 -->
                <div class="flex items-center gap-3">
                    <img src="{{ url_for('static', filename='images/logo.svg') }}" alt="Logo" class="w-10 h-10">
                    <h1 class="text-3xl font-bold shimmer-text">一个亿小目标</h1>
                </div>

                <!-- 右侧：Tab导航 -->
                <div role="tablist" class="tabs tabs-bordered bg-transparent">
                    <a role="tab" class="tab tab-active" data-tab="investment">投资计划</a>
                    <a role="tab" class="tab" data-tab="fund-select">基金市场</a>
                    <a role="tab" class="tab" data-tab="annualized">年化计算器</a>
                    <a role="tab" class="tab" data-tab="compound">复利计算器</a>
                </div>
            </div>

            <!-- Tab内容 -->
            {% include 'partials/tab-investment.html' %}
            {% include 'partials/tab-fund-select.html' %}
            {% include 'partials/tab-annualized.html' %}
            {% include 'partials/tab-compound.html' %}

        </div>
    </div>

    <!-- JavaScript -->
    <script src="{{ url_for('static', filename='js/utils.js') }}"></script>
    <script src="{{ url_for('static', filename='js/investment.js') }}"></script>
    <script src="{{ url_for('static', filename='js/annualized.js') }}"></script>
    <script src="{{ url_for('static', filename='js/compound.js') }}"></script>

    <script>
        // Tab切换逻辑 - 只选择有data-tab属性的主Tab
        document.querySelectorAll('[data-tab]').forEach(tab => {
            tab.addEventListener('click', function() {
                // 移除所有active状态
                document.querySelectorAll('[data-tab]').forEach(t => t.classList.remove('tab-active'));
                document.querySelectorAll('.tab-content').forEach(c => {
                    c.classList.add('hidden');
                    c.style.display = 'none';
                });

                // 添加当前active状态
                this.classList.add('tab-active');
                const tabName = this.dataset.tab;
                const targetTab = document.getElementById(`${tabName}-tab`);
                targetTab.classList.remove('hidden');
                targetTab.style.display = 'block';
            });
        });

        // 年化计算器子Tab切换
        document.querySelectorAll('[data-subtab]').forEach(tab => {
            tab.addEventListener('click', function(e) {
                e.stopPropagation(); // 阻止事件冒泡
                document.querySelectorAll('[data-subtab]').forEach(t => t.classList.remove('tab-active'));
                document.querySelectorAll('.subtab-content').forEach(c => {
                    c.classList.add('hidden');
                    c.style.display = 'none';
                });

                this.classList.add('tab-active');
                const subtabName = this.dataset.subtab;
                const targetSubtab = document.getElementById(`${subtabName}-content`);
                targetSubtab.classList.remove('hidden');
                targetSubtab.style.display = 'block';
            });
        });
    </script>
</body>
</html>
```

**Step 3: Commit**

```bash
git add templates/index.html
git commit -m "refactor: 重构 index.html 使用 Jinja2 include"
```

---

### Task 9: 手动验证

**验证清单:**

启动服务器：`python app.py`

访问 http://localhost:5001，依次验证：

1. [ ] Tab 切换正常（投资计划/基金市场/年化计算器/复利计算器）
2. [ ] 投资计划 Tab：
   - [ ] 添加按钮打开模态框
   - [ ] 模态框表单可填写并保存
   - [ ] 编辑、删除功能正常
   - [ ] CSV 导入导出正常
   - [ ] 管理市场模态框正常
   - [ ] 图表渲染正常
3. [ ] 年化计算器 Tab：
   - [ ] 子 Tab 切换正常
   - [ ] 两种计算方式均正常
4. [ ] 复利计算器 Tab：
   - [ ] 添加投资项正常
   - [ ] 计算复利正常
   - [ ] 图表渲染正常

**Step 2: 全部验证通过后，创建总结 commit**

```bash
git add .
git commit -m "refactor: 完成模板模块化拆分" --allow-empty
```

---

## 文件变更汇总

| 操作 | 文件 |
|------|------|
| Create | `templates/partials/modal-investment.html` |
| Create | `templates/partials/modal-market.html` |
| Create | `templates/partials/tab-investment.html` |
| Create | `templates/partials/tab-fund-select.html` |
| Create | `templates/partials/tab-annualized.html` |
| Create | `templates/partials/tab-compound.html` |
| Modify | `templates/index.html` (385 行 → ~90 行) |
