// 持仓数据管理
const InvestmentManager = {
    data: [],

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
        // 风险等级和持有计划的排序优先级
        const riskOrder = { '高': 4, '中高': 3, '中': 2, '低': 1 };
        const planOrder = { '长期': 3, '中期': 2, '短期': 1 };
        
        this.data.sort((a, b) => {
            let aVal, bVal;
            if (field === 'risk_level') {
                aVal = riskOrder[a[field]] || 0;
                bVal = riskOrder[b[field]] || 0;
            } else if (field === 'holding_plan') {
                aVal = planOrder[a[field]] || 0;
                bVal = planOrder[b[field]] || 0;
            } else {
                aVal = parseFloat(a[field]) || 0;
                bVal = parseFloat(b[field]) || 0;
            }
            return order === 'asc' ? aVal - bVal : bVal - aVal;
        });
        this.render();
    },

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

    // CSV导出
    exportCSV: function() {
        const headers = ['fund_name', 'fund_code', 'sector', 'position', 'trade_type', 'market', 'risk_level', 'holding_plan'];
        const filename = generateTimestampFilename('investments');
        downloadCSV(this.data, headers, filename);
        showToast('导出成功', 'success');
    },

    // 渲染表格
    render: function() {
        const dataWithPercentage = this.calculatePositionPercentage();
        const tbody = document.getElementById('investment-table-body');
        const tfoot = document.getElementById('investment-table-footer');

        if (!tbody || !tfoot) return;

        // 渲染表格行
        tbody.innerHTML = dataWithPercentage.map(item => `
            <tr>
                <td>${item.fund_name}</td>
                <td>${item.fund_code}</td>
                <td>${item.sector || '-'}</td>
                <td>${parseFloat(item.position).toFixed(2)}</td>
                <td>${item.positionPercentage}%</td>
                <td><span class="badge badge-${this.getTradeTypeBadgeColor(item.trade_type)}">${item.trade_type || '-'}</span></td>
                <td>${item.market || '-'}</td>
                <td><span class="badge badge-${this.getRiskBadgeColor(item.risk_level)}">${item.risk_level}</span></td>
                <td><span class="badge badge-outline badge-${this.getHoldingPlanBadgeColor(item.holding_plan)}" style="border-radius: 5px;">${item.holding_plan}</span></td>
                <td>
                    <button class="btn btn-xs btn-ghost" onclick="InvestmentUI.showEditModal('${item.fund_code}')" title="编辑">
                        <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                            <path d="M853.333333 501.333333c-17.066667 0-32 14.933333-32 32v320c0 6.4-4.266667 10.666667-10.666666 10.666667H170.666667c-6.4 0-10.666667-4.266667-10.666667-10.666667V213.333333c0-6.4 4.266667-10.666667 10.666667-10.666666h320c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H170.666667c-40.533333 0-74.666667 34.133333-74.666667 74.666666v640c0 40.533333 34.133333 74.666667 74.666667 74.666667h640c40.533333 0 74.666667-34.133333 74.666666-74.666667V533.333333c0-17.066667-14.933333-32-32-32z" fill="#00FFF0"/>
                            <path d="M405.333333 484.266667l-32 125.866666c-2.133333 10.666667 0 23.466667 8.533334 29.866667 6.4 6.4 14.933333 8.533333 23.466666 8.533333h8.533334l125.866666-32c6.4-2.133333 10.666667-4.266667 14.933334-8.533333l300.8-300.8c38.4-38.4 38.4-102.4 0-140.8-38.4-38.4-102.4-38.4-140.8 0L413.866667 469.333333c-4.266667 4.266667-6.4 8.533333-8.533334 14.933334z m59.733334 23.466666L761.6 213.333333c12.8-12.8 36.266667-12.8 49.066667 0 12.8 12.8 12.8 36.266667 0 49.066667L516.266667 558.933333l-66.133334 17.066667 14.933334-68.266667z" fill="#00FFF0"/>
                        </svg>
                    </button>
                    <button class="btn btn-xs btn-ghost" onclick="InvestmentManager.confirmDelete('${item.fund_code}')" title="删除">
                        <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                            <path d="M874.666667 241.066667h-202.666667V170.666667c0-40.533333-34.133333-74.666667-74.666667-74.666667h-170.666666c-40.533333 0-74.666667 34.133333-74.666667 74.666667v70.4H149.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h53.333334V853.333333c0 40.533333 34.133333 74.666667 74.666666 74.666667h469.333334c40.533333 0 74.666667-34.133333 74.666666-74.666667V305.066667H874.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM416 170.666667c0-6.4 4.266667-10.666667 10.666667-10.666667h170.666666c6.4 0 10.666667 4.266667 10.666667 10.666667v70.4h-192V170.666667z m341.333333 682.666666c0 6.4-4.266667 10.666667-10.666666 10.666667H277.333333c-6.4 0-10.666667-4.266667-10.666666-10.666667V309.333333h490.666666V853.333333z" fill="#f87171"/>
                            <path d="M426.666667 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32zM597.333333 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32z" fill="#f87171"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');

        // 渲染汇总行
        const totalPosition = this.data.reduce((sum, item) => sum + parseFloat(item.position || 0), 0);
        tfoot.innerHTML = `
            <tr class="font-bold" style="height: 56px; font-size: 1.125rem; color: #818cf8;">
                <td colspan="3">合计</td>
                <td>${totalPosition.toFixed(2)}</td>
                <td>100.00%</td>
                <td colspan="5"></td>
            </tr>
        `;

        // 默认渲染板块饼图
        if (this.data.length > 0 && !InvestmentUI.currentChart) {
            InvestmentUI.renderChart('sector');
        }
    },

    // 获取场内外徽章颜色
    getTradeTypeBadgeColor: function(tradeType) {
        const colors = {
            '场内': 'info',
            '场外': 'warning'
        };
        return colors[tradeType] || 'ghost';
    },

    // 获取风险等级徽章颜色
    getRiskBadgeColor: function(risk) {
        const colors = {
            '高': 'error',
            '中高': 'warning',
            '中': 'info',
            '低': 'success'
        };
        return colors[risk] || 'info';
    },

    // 获取持有计划徽章颜色
    getHoldingPlanBadgeColor: function(plan) {
        const colors = {
            '长期': 'success',
            '中期': 'info',
            '短期': 'warning'
        };
        return colors[plan] || 'ghost';
    },

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
};

// UI交互逻辑
const InvestmentUI = {
    sortState: {
        position: 'desc',
        risk_level: null,
        holding_plan: null
    },
    currentChart: null,
    _fundSuggestBound: false,
    _fundSuggestTimer: null,
    _fundSuggestAbort: null,
    // 显示添加模态框
    showAddModal: function(prefill = {}) {
        document.getElementById('modal-title').textContent = '添加持仓';
        document.getElementById('investment-form').reset();
        document.getElementById('investment-id').value = '';
        document.getElementById('fund-code').disabled = false;  // 添加时启用基金代码
        document.getElementById('fund-name').value = prefill.fund_name || '';
        document.getElementById('fund-code').value = prefill.fund_code || '';
        document.getElementById('investment-modal').showModal();
        this.bindFundSuggest();

        const focusField = document.getElementById(prefill.fund_code || prefill.fund_name ? 'sector' : 'fund-name');
        if (focusField) {
            setTimeout(() => focusField.focus(), 0);
        }
    },

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
        this.bindFundSuggest();
    },

    bindFundSuggest: function() {
        if (this._fundSuggestBound) return;
        this._fundSuggestBound = true;

        const nameInput = document.getElementById('fund-name');
        const codeInput = document.getElementById('fund-code');
        const nameSuggest = document.getElementById('investment-fund-name-suggest');
        const codeSuggest = document.getElementById('investment-fund-code-suggest');
        if (!nameInput || !codeInput || !nameSuggest || !codeSuggest) return;

        const hideAll = () => {
            nameSuggest.classList.add('hidden');
            codeSuggest.classList.add('hidden');
            nameSuggest.innerHTML = '';
            codeSuggest.innerHTML = '';
        };

        const escapeHtml = (s) => String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const render = (items, target) => {
            const el = target === 'name' ? nameSuggest : codeSuggest;
            if (!items.length) {
                el.classList.add('hidden');
                el.innerHTML = '';
                return;
            }
            el.innerHTML = items.map(it => {
                const code = String(it.fund_code || '');
                const name = String(it.fund_name || '');
                return `
                <li>
                  <button type="button" class="w-full text-left px-3 py-2 hover:bg-white/10 transition-colors"
                    data-fund-code="${escapeHtml(code)}" data-fund-name="${escapeHtml(name)}">
                    <div class="text-sm text-slate-100">${escapeHtml(code)} <span class="text-slate-300">${escapeHtml(name)}</span></div>
                  </button>
                </li>`;
            }).join('');
            el.classList.remove('hidden');
        };

        const onPick = (e) => {
            const btn = e.target.closest('[data-fund-code][data-fund-name]');
            if (!btn) return;
            e.preventDefault();
            this._selectFundSuggest(btn.getAttribute('data-fund-code') || '', btn.getAttribute('data-fund-name') || '');
        };
        nameSuggest.addEventListener('mousedown', onPick);
        codeSuggest.addEventListener('mousedown', onPick);

        const search = (q, target) => {
            const keyword = String(q || '').trim();
            if (!keyword) {
                hideAll();
                return;
            }
            if (this._fundSuggestTimer) clearTimeout(this._fundSuggestTimer);
            this._fundSuggestTimer = setTimeout(async () => {
                try {
                    if (this._fundSuggestAbort) this._fundSuggestAbort.abort();
                    this._fundSuggestAbort = new AbortController();
                    const res = await fetch(`/api/funds/search?q=${encodeURIComponent(keyword)}&limit=10`, {
                        signal: this._fundSuggestAbort.signal,
                    });
                    const data = await res.json();
                    if (!data.success) return;
                    const items = Array.isArray(data.items) ? data.items : [];
                    render(items, target);
                } catch (e) {
                    // ignore
                }
            }, 300);
        };

        nameInput.addEventListener('input', () => search(nameInput.value, 'name'));
        codeInput.addEventListener('input', () => search(codeInput.value, 'code'));

        nameInput.addEventListener('blur', () => setTimeout(hideAll, 150));
        codeInput.addEventListener('blur', () => setTimeout(hideAll, 150));
    },

    _selectFundSuggest: function(code, name) {
        const nameInput = document.getElementById('fund-name');
        const codeInput = document.getElementById('fund-code');
        if (nameInput) nameInput.value = name;
        if (codeInput) codeInput.value = code;

        const nameSuggest = document.getElementById('investment-fund-name-suggest');
        const codeSuggest = document.getElementById('investment-fund-code-suggest');
        if (nameSuggest) { nameSuggest.classList.add('hidden'); nameSuggest.innerHTML = ''; }
        if (codeSuggest) { codeSuggest.classList.add('hidden'); codeSuggest.innerHTML = ''; }
    },

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

    // 处理CSV导入
    handleImport: function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            InvestmentManager.importCSV(e.target.result);
        };
        reader.readAsText(file);

        // 重置input以便可以重复导入同一文件
        event.target.value = '';
    },

    // 切换排序
    toggleSort: function(field) {
        // 重置其他字段的排序状态
        Object.keys(this.sortState).forEach(key => {
            if (key !== field) this.sortState[key] = null;
        });
        
        // 切换当前字段的排序状态
        if (this.sortState[field] === null) {
            this.sortState[field] = 'desc';
        } else {
            this.sortState[field] = this.sortState[field] === 'desc' ? 'asc' : 'desc';
        }
        
        // 更新图标
        document.getElementById('sort-icon-position').textContent = this.sortState.position === 'desc' ? '↓' : (this.sortState.position === 'asc' ? '↑' : '');
        document.getElementById('sort-icon-risk').textContent = this.sortState.risk_level === 'desc' ? '↓' : (this.sortState.risk_level === 'asc' ? '↑' : '');
        document.getElementById('sort-icon-plan').textContent = this.sortState.holding_plan === 'desc' ? '↓' : (this.sortState.holding_plan === 'asc' ? '↑' : '');
        
        InvestmentManager.sort(field, this.sortState[field]);
    },

    // 渲染图表
    renderChart: function(dimension) {
        const data = InvestmentManager.data;
        if (data.length === 0) {
            showToast('暂无数据', 'warning');
            return;
        }

        // 按维度分组统计
        const groups = {};
        data.forEach(item => {
            const key = item[dimension];
            if (!groups[key]) {
                groups[key] = 0;
            }
            groups[key] += parseFloat(item.position);
        });

        const labels = Object.keys(groups);
        const values = Object.values(groups);

        // 销毁旧图表
        if (this.currentChart) {
            this.currentChart.destroy();
        }

        // 创建新图表
        const ctx = document.getElementById('investment-chart').getContext('2d');
        this.currentChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: [
                        'rgba(96, 165, 250, 0.8)',
                        'rgba(167, 139, 250, 0.8)',
                        'rgba(34, 211, 238, 0.8)',
                        'rgba(248, 113, 113, 0.8)',
                        'rgba(52, 211, 153, 0.8)',
                        'rgba(251, 191, 36, 0.8)'
                    ],
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#fff',
                            font: {
                                size: 14
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(2);
                                return `${label}: ${value.toFixed(2)} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });
    }
};

// 市场管理
const MarketManager = {
    markets: [],

    // 加载市场列表
    load: async function() {
        try {
            const response = await fetch('/api/markets');
            this.markets = await response.json();
            this.updateSelectOptions();
        } catch (error) {
            showToast('加载市场列表失败', 'error');
        }
    },

    // 更新下拉框选项
    updateSelectOptions: function() {
        const select = document.getElementById('market');
        if (!select) return;
        
        // 保留第一个空选项
        const currentValue = select.value;
        select.innerHTML = '<option value="" disabled selected>请选择市场</option>';
        
        this.markets.forEach(market => {
            const option = document.createElement('option');
            option.value = market;
            option.textContent = market;
            select.appendChild(option);
        });
        
        // 恢复选中值
        if (currentValue) select.value = currentValue;
    },

    // 显示管理模态框
    showModal: function() {
        this.renderList();
        document.getElementById('market-modal').showModal();
    },

    // 渲染市场列表
    renderList: function() {
        const container = document.getElementById('market-list');
        if (!container) return;
        
        container.innerHTML = this.markets.map((market, index) => `
            <div class="flex items-center justify-between p-2 rounded mb-2" style="background: rgba(251, 191, 36, 0.15); border: 1px solid rgba(251, 191, 36, 0.3);">
                <span>${market}</span>
                <button class="btn btn-xs btn-ghost text-error" onclick="MarketManager.remove(${index})">
                    <svg class="h-4 w-4" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                        <path d="M874.666667 241.066667h-202.666667V170.666667c0-40.533333-34.133333-74.666667-74.666667-74.666667h-170.666666c-40.533333 0-74.666667 34.133333-74.666667 74.666667v70.4H149.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h53.333334V853.333333c0 40.533333 34.133333 74.666667 74.666666 74.666667h469.333334c40.533333 0 74.666667-34.133333 74.666666-74.666667V305.066667H874.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM416 170.666667c0-6.4 4.266667-10.666667 10.666667-10.666667h170.666666c6.4 0 10.666667 4.266667 10.666667 10.666667v70.4h-192V170.666667z m341.333333 682.666666c0 6.4-4.266667 10.666667-10.666666 10.666667H277.333333c-6.4 0-10.666667-4.266667-10.666666-10.666667V309.333333h490.666666V853.333333z" fill="#f87171"/>
                    </svg>
                </button>
            </div>
        `).join('');
    },

    // 添加市场
    add: function() {
        const input = document.getElementById('new-market');
        const name = input.value.trim();
        
        if (!name) {
            showToast('请输入市场名称', 'warning');
            return;
        }
        
        if (this.markets.includes(name)) {
            showToast('该市场已存在', 'warning');
            return;
        }
        
        this.markets.push(name);
        input.value = '';
        this.renderList();
    },

    // 删除市场
    remove: function(index) {
        this.markets.splice(index, 1);
        this.renderList();
    },

    // 保存市场列表
    save: async function() {
        try {
            const response = await fetch('/api/markets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.markets)
            });
            
            if (response.ok) {
                showToast('保存成功', 'success');
                this.updateSelectOptions();
                document.getElementById('market-modal').close();
            } else {
                showToast('保存失败', 'error');
            }
        } catch (error) {
            showToast('保存失败: ' + error.message, 'error');
        }
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async function() {
    await MarketManager.load();
    await InvestmentManager.init();
});
