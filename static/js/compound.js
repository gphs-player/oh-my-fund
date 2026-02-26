const CompoundCalculator = {
    items: [],
    chart: null,

    // 初始化
    init: function() {
        this.addItem(); // 默认添加一个投资项
    },

    // 添加投资项
    addItem: function() {
        const id = Date.now();
        this.items.push({ id });
        this.renderItems();
    },

    // 删除投资项
    removeItem: function(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.renderItems();
    },

    // 渲染投资项表单
    renderItems: function() {
        const container = document.getElementById('investment-items');
        container.innerHTML = this.items.map((item, index) => `
            <div class="card bg-base-200/50 p-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-bold">投资项 ${index + 1}</span>
                    ${this.items.length > 1 ? `<button class="btn btn-xs btn-ghost text-error" onclick="CompoundCalculator.removeItem(${item.id})">删除</button>` : ''}
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div class="form-control">
                        <label class="label label-text-alt">名称</label>
                        <input type="text" class="input input-sm input-bordered" data-id="${item.id}" data-field="name" placeholder="投资项名称" required>
                    </div>
                    <div class="form-control">
                        <label class="label label-text-alt">初始金额</label>
                        <input type="number" class="input input-sm input-bordered" data-id="${item.id}" data-field="initial" min="0" step="0.01" required>
                    </div>
                    <div class="form-control">
                        <label class="label label-text-alt">预计年化（%）</label>
                        <input type="number" class="input input-sm input-bordered" data-id="${item.id}" data-field="rate" step="0.01" required>
                    </div>
                    <div class="form-control">
                        <label class="label label-text-alt">年末追加金额</label>
                        <input type="number" class="input input-sm input-bordered" data-id="${item.id}" data-field="addition" min="0" step="0.01" value="0">
                    </div>
                </div>
            </div>
        `).join('');
    },

    // 获取投资项数据
    getItemsData: function() {
        return this.items.map(item => {
            const inputs = document.querySelectorAll(`[data-id="${item.id}"]`);
            const data = { id: item.id };
            inputs.forEach(input => {
                data[input.dataset.field] = input.value;
            });
            return data;
        });
    },

    // 计算复利
    calculate: function() {
        const years = parseInt(document.getElementById('compound-years').value);
        const itemsData = this.getItemsData();

        // 验证数据
        for (let item of itemsData) {
            if (!item.name || !item.initial || !item.rate) {
                showToast('请填写完整的投资项信息', 'error');
                return;
            }
        }

        // 计算每个投资项每年的资产
        const results = itemsData.map(item => {
            const name = item.name;
            const initial = parseFloat(item.initial);
            const rate = parseFloat(item.rate) / 100;
            const addition = parseFloat(item.addition) || 0;

            const yearlyAssets = [initial * (1 + rate)]; // 第1年

            for (let year = 2; year <= years; year++) {
                const lastYearAsset = yearlyAssets[year - 2];
                const currentYearAsset = (lastYearAsset + addition) * (1 + rate);
                yearlyAssets.push(currentYearAsset);
            }

            return { name, yearlyAssets };
        });

        this.renderChart(results, years);
        this.renderTable(results, years);

        document.getElementById('compound-result').classList.remove('hidden');
    },

    // 渲染折线图
    renderChart: function(results, years) {
        if (this.chart) {
            this.chart.destroy();
        }

        const labels = Array.from({ length: years }, (_, i) => `第${i + 1}年`);
        const datasets = results.map((result, index) => ({
            label: result.name,
            data: result.yearlyAssets,
            borderColor: this.getColor(index),
            backgroundColor: this.getColor(index, 0.1),
            tension: 0.4,
            fill: false
        }));

        const ctx = document.getElementById('compound-chart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#fff' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ¥${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                }
            }
        });
    },

    // 渲染数据表格
    renderTable: function(results, years) {
        const table = document.getElementById('compound-table');

        let html = '<thead><tr><th>年份</th>';
        results.forEach(result => {
            html += `<th>${result.name}</th>`;
        });
        html += '</tr></thead><tbody>';

        for (let year = 0; year < years; year++) {
            html += `<tr><td>第${year + 1}年</td>`;
            results.forEach(result => {
                html += `<td>¥${result.yearlyAssets[year].toFixed(2)}</td>`;
            });
            html += '</tr>';
        }

        html += '</tbody>';
        table.innerHTML = html;
    },

    // 获取颜色
    getColor: function(index, alpha = 1) {
        const colors = [
            `rgba(96, 165, 250, ${alpha})`,
            `rgba(167, 139, 250, ${alpha})`,
            `rgba(34, 211, 238, ${alpha})`,
            `rgba(248, 113, 113, ${alpha})`,
            `rgba(52, 211, 153, ${alpha})`,
            `rgba(251, 191, 36, ${alpha})`
        ];
        return colors[index % colors.length];
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    CompoundCalculator.init();
});
