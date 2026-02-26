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
                return Validator.required(row.fund_name || row['基金名称']) &&
                       Validator.fundCode(row.fund_code || row['基金代码']) &&
                       Validator.position(row.position || row['仓位']);
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
        const dataWithPercentage = this.calculatePositionPercentage();
        const tbody = document.getElementById('investment-table-body');
        const tfoot = document.getElementById('investment-table-footer');

        if (!tbody || !tfoot) return;

        // 渲染表格行
        tbody.innerHTML = dataWithPercentage.map(item => `
            <tr>
                <td>${item.fund_name}</td>
                <td>${item.fund_code}</td>
                <td>${item.sector}</td>
                <td>${parseFloat(item.position).toFixed(2)}</td>
                <td>${item.positionPercentage}%</td>
                <td><span class="badge badge-${this.getRiskBadgeColor(item.risk_level)}">${item.risk_level}</span></td>
                <td><span class="badge badge-outline">${item.holding_plan}</span></td>
                <td>${item.tags}</td>
                <td>
                    <button class="btn btn-xs btn-ghost" onclick="InvestmentUI.showEditModal(${item.id})">编辑</button>
                    <button class="btn btn-xs btn-ghost text-error" onclick="InvestmentManager.confirmDelete(${item.id})">删除</button>
                </td>
            </tr>
        `).join('');

        // 渲染汇总行
        const totalPosition = this.data.reduce((sum, item) => sum + parseFloat(item.position || 0), 0);
        tfoot.innerHTML = `
            <tr class="font-bold">
                <td colspan="3">合计</td>
                <td>${totalPosition.toFixed(2)}</td>
                <td>100.00%</td>
                <td colspan="4"></td>
            </tr>
        `;

        // 默认渲染板块饼图
        if (this.data.length > 0 && !InvestmentUI.currentChart) {
            InvestmentUI.renderChart('sector');
        }
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

    // 确认删除
    confirmDelete: function(id) {
        if (confirm('确定要删除这条记录吗？')) {
            this.delete(id);
        }
    }
};

// UI交互逻辑
const InvestmentUI = {
    sortOrder: 'asc',
    currentChart: null,

    // 显示添加模态框
    showAddModal: function() {
        document.getElementById('modal-title').textContent = '添加投资记录';
        document.getElementById('investment-form').reset();
        document.getElementById('investment-id').value = '';
        document.getElementById('investment-modal').showModal();
    },

    // 显示编辑模态框
    showEditModal: function(id) {
        const investment = InvestmentManager.data.find(item => item.id === id);
        if (!investment) return;

        document.getElementById('modal-title').textContent = '编辑投资记录';
        document.getElementById('investment-id').value = investment.id;
        document.getElementById('fund-name').value = investment.fund_name;
        document.getElementById('fund-code').value = investment.fund_code;
        document.getElementById('sector').value = investment.sector;
        document.getElementById('position').value = investment.position;
        document.getElementById('risk-level').value = investment.risk_level;
        document.getElementById('holding-plan').value = investment.holding_plan;
        document.getElementById('tags').value = investment.tags;
        document.getElementById('investment-modal').showModal();
    },

    // 处理表单提交
    handleSubmit: function(event) {
        event.preventDefault();

        const id = document.getElementById('investment-id').value;
        const investment = {
            fund_name: document.getElementById('fund-name').value,
            fund_code: document.getElementById('fund-code').value,
            sector: document.getElementById('sector').value,
            position: parseFloat(document.getElementById('position').value),
            risk_level: document.getElementById('risk-level').value,
            holding_plan: document.getElementById('holding-plan').value,
            tags: document.getElementById('tags').value
        };

        if (id) {
            InvestmentManager.update(parseInt(id), investment);
        } else {
            InvestmentManager.add(investment);
        }

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
    toggleSort: function() {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        document.getElementById('sort-icon').textContent = this.sortOrder === 'asc' ? '↑' : '↓';
        InvestmentManager.sort('position', this.sortOrder);
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    InvestmentManager.init();
});
