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
        console.log('Rendering investment table...', this.data);
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    InvestmentManager.init();
});
