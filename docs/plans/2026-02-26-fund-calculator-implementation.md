# 基金理财系统实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个基于Flask的个人基金理财系统，前端使用DaisyUI实现毛玻璃科技风格界面

**Architecture:** Flask提供单页面服务，所有业务逻辑在前端JavaScript实现，数据通过CSV文件导入导出管理，使用localStorage持久化

**Tech Stack:** Flask, Jinja2, Tailwind CSS, DaisyUI, Chart.js, Vanilla JavaScript

---

## Task 1: 项目基础搭建

**Files:**
- Create: `app.py`
- Create: `requirements.txt`
- Create: `static/css/style.css`
- Create: `static/js/utils.js`
- Create: `templates/index.html`

**Step 1: 创建requirements.txt**

```bash
echo "Flask==3.0.0" > requirements.txt
```

**Step 2: 创建Flask应用入口**

创建 `app.py`:

```python
from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

**Step 3: 创建目录结构**

```bash
mkdir -p static/css static/js static/images templates
cp assets/background.jpg static/images/
cp assets/favicon.svg static/images/
```

**Step 4: 测试Flask应用**

```bash
pip install -r requirements.txt
python app.py
```

预期：服务启动在 http://localhost:5000（此时会报错因为index.html不存在，这是正常的）

**Step 5: 提交**

```bash
git add app.py requirements.txt
git commit -m "feat: add Flask application entry point"
```

---

## Task 2: 创建基础HTML结构

**Files:**
- Create: `templates/index.html`

**Step 1: 创建基础HTML模板**

创建 `templates/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>基金理财计算器</title>
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
        <div class="container mx-auto px-4 py-8">
            
            <!-- 标题 -->
            <h1 class="text-4xl font-bold text-center mb-8 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400">
                基金理财计算器
            </h1>
            
            <!-- Tab导航 -->
            <div role="tablist" class="tabs tabs-boxed bg-base-300/50 backdrop-blur-sm mb-6">
                <a role="tab" class="tab tab-active" data-tab="investment">投资计划</a>
                <a role="tab" class="tab" data-tab="annualized">年化计算器</a>
                <a role="tab" class="tab" data-tab="compound">复利计算器</a>
            </div>
            
            <!-- Tab内容 -->
            <div id="investment-tab" class="tab-content">
                <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
                    <div class="card-body">
                        <h2 class="card-title">投资计划</h2>
                        <p>投资计划模块内容</p>
                    </div>
                </div>
            </div>
            
            <div id="annualized-tab" class="tab-content hidden">
                <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
                    <div class="card-body">
                        <h2 class="card-title">年化计算器</h2>
                        <p>年化计算器内容</p>
                    </div>
                </div>
            </div>
            
            <div id="compound-tab" class="tab-content hidden">
                <div class="card bg-base-300/50 backdrop-blur-sm shadow-xl">
                    <div class="card-body">
                        <h2 class="card-title">复利计算器</h2>
                        <p>复利计算器内容</p>
                    </div>
                </div>
            </div>
            
        </div>
    </div>
    
    <!-- JavaScript -->
    <script src="{{ url_for('static', filename='js/utils.js') }}"></script>
    <script src="{{ url_for('static', filename='js/investment.js') }}"></script>
    <script src="{{ url_for('static', filename='js/annualized.js') }}"></script>
    <script src="{{ url_for('static', filename='js/compound.js') }}"></script>
    
    <script>
        // Tab切换逻辑
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                // 移除所有active状态
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab-active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                
                // 添加当前active状态
                this.classList.add('tab-active');
                const tabName = this.dataset.tab;
                document.getElementById(`${tabName}-tab`).classList.remove('hidden');
            });
        });
    </script>
</body>
</html>
```

**Step 2: 测试页面加载**

```bash
python app.py
```

访问 http://localhost:5000，预期看到带毛玻璃效果的页面和三个Tab

**Step 3: 提交**

```bash
git add templates/index.html
git commit -m "feat: add basic HTML structure with tabs"
```

---

## Task 3: 添加自定义样式

**Files:**
- Create: `static/css/style.css`

**Step 1: 创建自定义CSS**

创建 `static/css/style.css`:

```css
/* 全局动画 */
* {
    transition: all 0.3s ease;
}

/* 页面加载动画 */
body {
    animation: fadeIn 0.5s ease-in;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

/* 毛玻璃增强 */
.backdrop-blur-sm {
    backdrop-filter: blur(8px);
}

.backdrop-blur-md {
    backdrop-filter: blur(16px);
}

/* 霓虹边框效果 */
.neon-border {
    border: 2px solid transparent;
    background: linear-gradient(#1a1a2e, #1a1a2e) padding-box,
                linear-gradient(45deg, #60a5fa, #a78bfa, #22d3ee) border-box;
    border-radius: 0.5rem;
}

/* 按钮悬停效果 */
.btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(96, 165, 250, 0.3);
}

/* 表格行悬停 */
.table tbody tr:hover {
    background-color: rgba(96, 165, 250, 0.1);
    transform: scale(1.01);
}

/* Tab切换动画 */
.tab-content {
    animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* 渐变文字 */
.gradient-text {
    background: linear-gradient(45deg, #60a5fa, #a78bfa, #22d3ee);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
}

/* 卡片悬停效果 */
.card:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 40px rgba(96, 165, 250, 0.2);
}

/* 输入框聚焦效果 */
.input:focus, .select:focus, .textarea:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
}

/* 滚动条样式 */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
}

::-webkit-scrollbar-thumb {
    background: linear-gradient(45deg, #60a5fa, #a78bfa);
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(45deg, #a78bfa, #22d3ee);
}
```

**Step 2: 测试样式效果**

刷新页面，检查毛玻璃效果、动画、悬停效果是否正常

**Step 3: 提交**

```bash
git add static/css/style.css
git commit -m "feat: add custom styles with glassmorphism and animations"
```

---

## Task 4: 实现工具函数（CSV处理）

**Files:**
- Create: `static/js/utils.js`

**Step 1: 创建工具函数**

创建 `static/js/utils.js`:

```javascript
// CSV解析函数
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }
    
    return data;
}

// CSV生成函数
function generateCSV(data, headers) {
    if (data.length === 0) return '';
    
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => {
        return headers.map(header => {
            const value = row[header] || '';
            // 如果值包含逗号，用引号包裹
            return value.toString().includes(',') ? `"${value}"` : value;
        }).join(',');
    });
    
    return [csvHeaders, ...csvRows].join('\n');
}

// CSV下载函数
function downloadCSV(data, headers, filename) {
    const csv = generateCSV(data, headers);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 生成带时间戳的文件名
function generateTimestampFilename(prefix) {
    const now = new Date();
    const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return `${prefix}_${timestamp}.csv`;
}

// localStorage操作
const Storage = {
    save: function(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },
    load: function(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    },
    remove: function(key) {
        localStorage.removeItem(key);
    }
};

// 数据验证
const Validator = {
    // 验证基金代码（5-8位数字）
    fundCode: function(code) {
        return /^\d{5,8}$/.test(code);
    },
    // 验证仓位（0-100）
    position: function(pos) {
        const num = parseFloat(pos);
        return !isNaN(num) && num >= 0 && num <= 100;
    },
    // 验证必填字段
    required: function(value) {
        return value !== null && value !== undefined && value.toString().trim() !== '';
    },
    // 验证数字
    number: function(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }
};

// 显示提示消息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} fixed top-4 right-4 w-auto z-50 shadow-lg`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}
```

**Step 2: 提交**

```bash
git add static/js/utils.js
git commit -m "feat: add utility functions for CSV handling and validation"
```

---

## Task 5: 实现投资计划模块 - 数据管理

**Files:**
- Create: `static/js/investment.js`

**Step 1: 创建投资计划JavaScript模块**

创建 `static/js/investment.js`:

```javascript
// 投资计划数据管理
const InvestmentManager = {
    data: [],
    storageKey: 'fund_investments',
    
    // 初始化
    init: function() {
        this.loadFromStorage();
        this.render();
    },
    
    // 从localStorage加载数据
    loadFromStorage: function() {
        const saved = Storage.load(this.storageKey);
        if (saved && Array.isArray(saved)) {
            this.data = saved;
        }
    },
    
    // 保存到localStorage
    saveToStorage: function() {
        Storage.save(this.storageKey, this.data);
    },
    
    // 添加记录
    add: function(investment) {
        const id = Date.now();
        this.data.push({ id, ...investment });
        this.saveToStorage();
        this.render();
        showToast('添加成功', 'success');
    },
    
    // 更新记录
    update: function(id, investment) {
        const index = this.data.findIndex(item => item.id === id);
        if (index !== -1) {
            this.data[index] = { id, ...investment };
            this.saveToStorage();
            this.render();
            showToast('更新成功', 'success');
        }
    },
    
    // 删除记录
    delete: function(id) {
        this.data = this.data.filter(item => item.id !== id);
        this.saveToStorage();
        this.render();
        showToast('删除成功', 'success');
    },
    
    // 计算仓位占比
    calculatePositionPercentage: function() {
        const totalPosition = this.data.reduce((sum, item) => sum + parseFloat(item.position || 0), 0);
        return this.data.map(item => ({
            ...item,
            positionPercentage: totalPosition > 0 ? ((parseFloat(item.position) / totalPosition) * 100).toFixed(2) : '0.00'
        }));
    },
    
    // 排序
    sort: function(field, order = 'asc') {
        this.data.sort((a, b) => {
            const aVal = parseFloat(a[field]) || 0;
            const bVal = parseFloat(b[field]) || 0;
            return order === 'asc' ? aVal - bVal : bVal - aVal;
        });
        this.render();
    },
    
    // CSV导入
    importCSV: function(csvText) {
        try {
            const parsed = parseCSV(csvText);
            // 验证数据格式
            const validData = parsed.filter(row => {
                return Validator.required(row.fund_name) && 
                       Validator.fundCode(row.fund_code) &&
                       Validator.position(row.position);
            });
            
            if (validData.length === 0) {
                showToast('CSV文件格式错误或无有效数据', 'error');
                return;
            }
            
            this.data = validData.map(row => ({
                id: Date.now() + Math.random(),
                fund_name: row.fund_name || row['基金名称'] || '',
                fund_code: row.fund_code || row['基金代码'] || '',
                sector: row.sector || row['板块'] || '',
                position: parseFloat(row.position || row['仓位'] || 0),
                risk_level: row.risk_level || row['风险等级'] || '中',
                holding_plan: row.holding_plan || row['持有计划'] || '中期',
                tags: row.tags || row['标签'] || ''
            }));
            
            this.saveToStorage();
            this.render();
            showToast(`成功导入 ${this.data.length} 条记录`, 'success');
        } catch (error) {
            showToast('CSV解析失败: ' + error.message, 'error');
        }
    },
    
    // CSV导出
    exportCSV: function() {
        const headers = ['fund_name', 'fund_code', 'sector', 'position', 'risk_level', 'holding_plan', 'tags'];
        const filename = generateTimestampFilename('investments');
        downloadCSV(this.data, headers, filename);
        showToast('导出成功', 'success');
    },
    
    // 渲染表格
    render: function() {
        // 将在下一个任务中实现
        console.log('Rendering investment table...', this.data);
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    InvestmentManager.init();
});
```

**Step 2: 提交**

```bash
git add static/js/investment.js
git commit -m "feat: add investment data management logic"
```

---

由于实施计划内容较长，我将分多个部分继续编写。这是第一部分，包含了项目基础搭建和核心数据管理逻辑。

接下来的任务将包括：
- Task 6: 投资计划UI实现（表格、表单）
- Task 7: 投资计划图表可视化
- Task 8: 年化计算器实现
- Task 9: 复利计算器实现
- Task 10: 最终测试和优化

是否需要我继续编写完整的实施计划？

---

## Task 6: 投资计划模块 - UI实现

**Files:**
- Modify: `templates/index.html` (投资计划Tab部分)
- Modify: `static/js/investment.js` (render方法)

**Step 1: 更新投资计划Tab的HTML结构**

修改 `templates/index.html` 中的 `investment-tab` 部分：

```html
<div id="investment-tab" class="tab-content">
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
                            <th class="cursor-pointer" onclick="InvestmentUI.toggleSort()">
                                仓位 <span id="sort-icon">↕</span>
                            </th>
                            <th>仓位占比</th>
                            <th>风险等级</th>
                            <th>持有计划</th>
                            <th>标签</th>
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
                    <button class="btn btn-sm btn-outline" onclick="InvestmentUI.renderChart('sector')">按板块</button>
                    <button class="btn btn-sm btn-outline" onclick="InvestmentUI.renderChart('risk_level')">按风险等级</button>
                    <button class="btn btn-sm btn-outline" onclick="InvestmentUI.renderChart('holding_plan')">按持有计划</button>
                </div>
                <div class="flex justify-center">
                    <canvas id="investment-chart" width="400" height="400"></canvas>
                </div>
            </div>
        </div>
    </div>
</div>

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
                <label class="label"><span class="label-text">仓位 * (0-100)</span></label>
                <input type="number" id="position" class="input input-bordered" min="0" max="100" step="0.01" required>
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
            
            <div class="form-control mb-3">
                <label class="label"><span class="label-text">标签</span></label>
                <input type="text" id="tags" class="input input-bordered" placeholder="多个标签用逗号分隔">
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
