# 持仓数据持久化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现持仓数据的服务端持久化存储，使用 fund_code 作为主键，数据存储在 CSV 文件中。

**Architecture:** 后端新增 investments.csv 读写函数和 4 个 API 路由（GET/POST/PUT/DELETE），前端 InvestmentManager 改为异步 API 调用，使用 fund_code 替代 id 作为唯一标识。

**Tech Stack:** Flask, CSV, JavaScript fetch API

---

## Task 1: 后端 - 添加持仓数据读写函数

**Files:**
- Modify: `app.py`

**Step 1: 添加文件路径常量和 ensure 函数**

在 `app.py` 的 `SETTINGS_FILE` 定义之后添加：

```python
INVESTMENTS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'investments.csv')


def ensure_investments_file():
    """确保持仓文件存在"""
    data_dir = os.path.dirname(INVESTMENTS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(INVESTMENTS_FILE):
        with open(INVESTMENTS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['fund_code', 'fund_name', 'sector', 'position', 'trade_type', 'market', 'risk_level', 'holding_plan'])
```

**Step 2: 添加 read_investments 函数**

```python
def read_investments():
    """读取所有持仓"""
    ensure_investments_file()
    investments = []
    with open(INVESTMENTS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            investments.append({
                'fund_code': row['fund_code'],
                'fund_name': row['fund_name'],
                'sector': row['sector'],
                'position': float(row['position']) if row['position'] else 0,
                'trade_type': row['trade_type'],
                'market': row['market'],
                'risk_level': row['risk_level'],
                'holding_plan': row['holding_plan']
            })
    return investments
```

**Step 3: 添加 write_investments 函数**

```python
def write_investments(investments):
    """写入所有持仓"""
    ensure_investments_file()
    with open(INVESTMENTS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['fund_code', 'fund_name', 'sector', 'position', 'trade_type', 'market', 'risk_level', 'holding_plan'])
        for inv in investments:
            writer.writerow([
                inv['fund_code'],
                inv['fund_name'],
                inv['sector'],
                inv['position'],
                inv['trade_type'],
                inv['market'],
                inv['risk_level'],
                inv['holding_plan']
            ])
```

**Step 4: 验证**

运行: `python3 -c "from app import read_investments, write_investments; print('OK')"`
预期: 输出 `OK`

**Step 5: 提交**

```bash
git add app.py
git commit -m "feat: 添加持仓数据读写函数"
```

---

## Task 2: 后端 - 添加持仓 API 路由

**Files:**
- Modify: `app.py`

**Step 1: 添加 GET /api/investments**

```python
@app.route('/api/investments', methods=['GET'])
def list_investments():
    """获取所有持仓"""
    investments = read_investments()
    return jsonify(investments)
```

**Step 2: 添加 POST /api/investments**

```python
@app.route('/api/investments', methods=['POST'])
def add_investment():
    """添加持仓"""
    data = request.get_json()
    fund_code = data.get('fund_code')
    
    if not fund_code:
        return jsonify({'success': False, 'error': '基金代码不能为空'}), 400
    
    investments = read_investments()
    
    # 检查是否已存在
    for inv in investments:
        if inv['fund_code'] == fund_code:
            return jsonify({'success': False, 'error': '该基金已存在'}), 400
    
    investments.append({
        'fund_code': fund_code,
        'fund_name': data.get('fund_name', ''),
        'sector': data.get('sector', ''),
        'position': float(data.get('position', 0)),
        'trade_type': data.get('trade_type', ''),
        'market': data.get('market', ''),
        'risk_level': data.get('risk_level', '中'),
        'holding_plan': data.get('holding_plan', '中期')
    })
    
    write_investments(investments)
    return jsonify({'success': True})
```

**Step 3: 添加 PUT /api/investments/<fund_code>**

```python
@app.route('/api/investments/<fund_code>', methods=['PUT'])
def update_investment(fund_code):
    """更新持仓"""
    data = request.get_json()
    investments = read_investments()
    
    for i, inv in enumerate(investments):
        if inv['fund_code'] == fund_code:
            investments[i] = {
                'fund_code': fund_code,
                'fund_name': data.get('fund_name', inv['fund_name']),
                'sector': data.get('sector', inv['sector']),
                'position': float(data.get('position', inv['position'])),
                'trade_type': data.get('trade_type', inv['trade_type']),
                'market': data.get('market', inv['market']),
                'risk_level': data.get('risk_level', inv['risk_level']),
                'holding_plan': data.get('holding_plan', inv['holding_plan'])
            }
            write_investments(investments)
            return jsonify({'success': True})
    
    return jsonify({'success': False, 'error': '持仓不存在'}), 404
```

**Step 4: 添加 DELETE /api/investments/<fund_code>**

```python
@app.route('/api/investments/<fund_code>', methods=['DELETE'])
def delete_investment(fund_code):
    """删除持仓"""
    investments = read_investments()
    new_investments = [inv for inv in investments if inv['fund_code'] != fund_code]
    
    if len(new_investments) == len(investments):
        return jsonify({'success': False, 'error': '持仓不存在'}), 404
    
    write_investments(new_investments)
    return jsonify({'success': True})
```

**Step 5: 验证**

运行: `python3 -c "from app import app; print('OK')"`
预期: 输出 `OK`

**Step 6: 提交**

```bash
git add app.py
git commit -m "feat: 添加持仓 CRUD API"
```

---

## Task 3: 前端 - 修改 InvestmentManager 为异步 API 调用

**Files:**
- Modify: `static/js/investment.js`

**Step 1: 修改 init 函数为异步加载**

```javascript
// 初始化
init: async function() {
    await this.load();
},

// 从服务器加载数据
load: async function() {
    try {
        const response = await fetch('/api/investments');
        this.data = await response.json();
        this.render();
    } catch (error) {
        showToast('加载持仓数据失败: ' + error.message, 'error');
    }
},
```

**Step 2: 修改 add 函数为异步**

```javascript
// 添加记录
add: async function(investment) {
    try {
        const response = await fetch('/api/investments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(investment)
        });
        const result = await response.json();
        if (result.success) {
            await this.load();
            showToast('添加成功', 'success');
        } else {
            showToast(result.error || '添加失败', 'error');
        }
    } catch (error) {
        showToast('添加失败: ' + error.message, 'error');
    }
},
```

**Step 3: 修改 update 函数为异步**

```javascript
// 更新记录
update: async function(fundCode, investment) {
    try {
        const response = await fetch(`/api/investments/${fundCode}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(investment)
        });
        const result = await response.json();
        if (result.success) {
            await this.load();
            showToast('更新成功', 'success');
        } else {
            showToast(result.error || '更新失败', 'error');
        }
    } catch (error) {
        showToast('更新失败: ' + error.message, 'error');
    }
},
```

**Step 4: 修改 delete 函数为异步**

```javascript
// 删除记录
delete: async function(fundCode) {
    try {
        const response = await fetch(`/api/investments/${fundCode}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            await this.load();
            showToast('删除成功', 'success');
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
},
```

**Step 5: 修改 confirmDelete 使用 fund_code**

```javascript
// 确认删除
confirmDelete: function(fundCode) {
    const item = this.data.find(d => d.fund_code === fundCode);
    const name = item ? item.fund_name : '该持仓';
    
    document.getElementById('investment-delete-message').textContent = `确定要删除持仓「${name}」吗？`;
    
    const confirmBtn = document.getElementById('investment-delete-btn');
    confirmBtn.onclick = () => {
        document.getElementById('investment-delete-modal').close();
        this.delete(fundCode);
    };
    
    document.getElementById('investment-delete-modal').showModal();
}
```

**Step 6: 修改 CSV 导入函数**

```javascript
// CSV导入
importCSV: async function(csvText) {
    try {
        const parsed = parseCSV(csvText);
        const validData = parsed.filter(row => {
            return Validator.required(row.fund_name || row['基金名称']) &&
                   Validator.fundCode(row.fund_code || row['基金代码']) &&
                   Validator.position(row.position || row['仓位']);
        });

        if (validData.length === 0) {
            showToast('CSV文件格式错误或无有效数据', 'error');
            return;
        }

        let successCount = 0;
        let skipCount = 0;
        
        for (const row of validData) {
            const investment = {
                fund_code: row.fund_code || row['基金代码'] || '',
                fund_name: row.fund_name || row['基金名称'] || '',
                sector: row.sector || row['板块'] || '',
                position: parseFloat(row.position || row['仓位'] || 0),
                trade_type: row.trade_type || row['场内外'] || '',
                market: row.market || row['市场'] || '',
                risk_level: row.risk_level || row['风险等级'] || '中',
                holding_plan: row.holding_plan || row['持有计划'] || '中期'
            };
            
            const response = await fetch('/api/investments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(investment)
            });
            const result = await response.json();
            if (result.success) {
                successCount++;
            } else {
                skipCount++;
            }
        }

        await this.load();
        if (skipCount > 0) {
            showToast(`导入完成: ${successCount} 条成功, ${skipCount} 条跳过（已存在）`, 'info');
        } else {
            showToast(`成功导入 ${successCount} 条记录`, 'success');
        }
    } catch (error) {
        showToast('CSV解析失败: ' + error.message, 'error');
    }
},
```

**Step 7: 提交**

```bash
git add static/js/investment.js
git commit -m "feat: InvestmentManager 改为异步 API 调用"
```

---

## Task 4: 前端 - 修改 UI 使用 fund_code 作为标识

**Files:**
- Modify: `static/js/investment.js`

**Step 1: 修改 render 函数中的按钮 onclick 参数**

将表格渲染中的：
```javascript
onclick="InvestmentUI.showEditModal(${item.id})"
onclick="InvestmentManager.confirmDelete(${item.id})"
```

改为：
```javascript
onclick="InvestmentUI.showEditModal('${item.fund_code}')"
onclick="InvestmentManager.confirmDelete('${item.fund_code}')"
```

**Step 2: 修改 showEditModal 使用 fund_code**

```javascript
// 显示编辑模态框
showEditModal: function(fundCode) {
    const investment = InvestmentManager.data.find(item => item.fund_code === fundCode);
    if (!investment) return;

    document.getElementById('modal-title').textContent = '编辑持仓';
    document.getElementById('investment-id').value = fundCode;
    document.getElementById('fund-name').value = investment.fund_name;
    document.getElementById('fund-code').value = investment.fund_code;
    document.getElementById('fund-code').disabled = true;  // 编辑时禁用基金代码修改
    document.getElementById('sector').value = investment.sector;
    document.getElementById('position').value = investment.position;
    document.getElementById('trade-type').value = investment.trade_type || '';
    document.getElementById('market').value = investment.market || '';
    document.getElementById('risk-level').value = investment.risk_level;
    document.getElementById('holding-plan').value = investment.holding_plan;
    document.getElementById('investment-modal').showModal();
},
```

**Step 3: 修改 showAddModal 确保 fund_code 可编辑**

```javascript
// 显示添加模态框
showAddModal: function() {
    document.getElementById('modal-title').textContent = '添加持仓';
    document.getElementById('investment-form').reset();
    document.getElementById('investment-id').value = '';
    document.getElementById('fund-code').disabled = false;  // 添加时启用基金代码
    document.getElementById('investment-modal').showModal();
},
```

**Step 4: 修改 handleSubmit 使用 fund_code**

```javascript
// 处理表单提交
handleSubmit: async function(event) {
    event.preventDefault();

    const editingFundCode = document.getElementById('investment-id').value;
    const investment = {
        fund_name: document.getElementById('fund-name').value,
        fund_code: document.getElementById('fund-code').value,
        sector: document.getElementById('sector').value,
        position: parseFloat(document.getElementById('position').value),
        trade_type: document.getElementById('trade-type').value,
        market: document.getElementById('market').value,
        risk_level: document.getElementById('risk-level').value,
        holding_plan: document.getElementById('holding-plan').value
    };

    if (editingFundCode) {
        await InvestmentManager.update(editingFundCode, investment);
    } else {
        await InvestmentManager.add(investment);
    }

    document.getElementById('fund-code').disabled = false;
    document.getElementById('investment-modal').close();
},
```

**Step 5: 提交**

```bash
git add static/js/investment.js
git commit -m "feat: UI 使用 fund_code 作为标识"
```

---

## Task 5: 修改 DOMContentLoaded 初始化

**Files:**
- Modify: `static/js/investment.js`

**Step 1: 修改文件末尾的初始化代码**

找到文件末尾的 DOMContentLoaded 事件监听，确保 init 是异步调用：

```javascript
document.addEventListener('DOMContentLoaded', function() {
    InvestmentManager.init();
    MarketManager.load();
});
```

由于 init 现在是 async 函数，调用方式不变，但内部会正确执行异步加载。

**Step 2: 验证并提交**

启动服务器: `python app.py`
访问: `http://localhost:5001`
验证: 
- 添加持仓能保存
- 刷新页面数据不丢失
- 编辑和删除正常
- 重复添加相同基金代码提示错误

```bash
git add static/js/investment.js
git commit -m "feat: 完成持仓数据持久化功能"
```

---

## 验证清单

- [ ] GET /api/investments 返回持仓列表
- [ ] POST /api/investments 添加新持仓
- [ ] POST 重复 fund_code 返回错误
- [ ] PUT /api/investments/<fund_code> 更新持仓
- [ ] DELETE /api/investments/<fund_code> 删除持仓
- [ ] 页面刷新后数据不丢失
- [ ] CSV 导入正常工作
- [ ] CSV 导出正常工作
