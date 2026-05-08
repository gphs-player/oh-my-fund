const StrategyDetailOpenClosePlugin = {
    id: 'strategyDetailOpenClose',
    afterDatasetsDraw(chart, args, pluginOptions) {
        const options = pluginOptions || {};
        const datasetIndex = options.datasetIndex;
        if (datasetIndex === undefined || datasetIndex === null) return;
        const dataset = chart.data && chart.data.datasets ? chart.data.datasets[datasetIndex] : null;
        if (!dataset || !dataset.data || !dataset.data.length || !dataset.openCloseDataset) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta || !meta.data || !meta.data.length) return;
        const ctx = chart.ctx;
        const yScale = chart.scales && chart.scales[dataset.yAxisID || 'y'];
        if (!yScale) return;
        const neutralColor = options.neutralColor || '#94a3b8';
        const upColor = options.upColor || '#ef4444';
        const downColor = options.downColor || '#22c55e';
        const minBodyHeight = options.minBodyHeight || 2;
        const barWidth = StrategyDetailPage.computeOpenCloseBarWidth(meta.data, options.maxBarWidth || 18, options.widthRatio || 0.58);
        const halfWidth = barWidth / 2;
        ctx.save();
        meta.data.forEach((element, index) => {
            const raw = dataset.data[index];
            if (!raw || raw.open === undefined || raw.close === undefined) return;
            const x = element.x;
            const openY = yScale.getPixelForValue(raw.open);
            const closeY = yScale.getPixelForValue(raw.close);
            const rising = raw.close > raw.open;
            const falling = raw.close < raw.open;
            const color = rising ? upColor : (falling ? downColor : neutralColor);
            const top = Math.min(openY, closeY);
            const height = Math.max(Math.abs(closeY - openY), minBodyHeight);
            const y = Math.abs(closeY - openY) < minBodyHeight ? top - (minBodyHeight - Math.abs(closeY - openY)) / 2 : top;
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.fillRect(x - halfWidth, y, barWidth, height);
            ctx.strokeRect(x - halfWidth, y, barWidth, height);
        });
        ctx.restore();
    }
};

if (window.Chart && !Chart.registry.plugins.get('strategyDetailOpenClose')) {
    Chart.register(StrategyDetailOpenClosePlugin);
}

if (window.Chart && !Chart.registry.plugins.get('zoom')) {
    const zoomPlugin = window.ChartZoom || window.zoomPlugin;
    if (zoomPlugin) Chart.register(zoomPlugin);
}

const StrategyDetailPage = {
    bootstrap: window.STRATEGY_DETAIL_BOOTSTRAP || {},
    strategyTypes: [],
    strategyTypeMap: {},
    allFunds: [],
    currentStrategyId: '',
    stack: [],
    selectedFund: null,
    analysisHistory: [],
    analysisResults: [],
    analysisSignals: [],
    backtest: { initial_cash: 10000 },
    backtestResult: null,
    backtestTrades: [],
    analysisChart: null,
    fundSuggestionLimit: 12,
    isHistoryLoading: false,
    isAnalysisLoading: false,
    dateRange: { preset: '6m', start_date: '', end_date: '', full_history: false },

    init: async function() {
        this.initFromBootstrap();
        this.initBacktest();
        this.bindEvents();
        this.applyDateRange(this.dateRange, true);
        this.renderStack();
        this.renderSignals();
        this.renderBacktest();
        this.renderActionStates();
        this.renderChart();
        await this.loadBaseData();
    },

    initFromBootstrap: function() {
        const strategy = this.bootstrap.strategy || null;
        this.currentStrategyId = this.bootstrap.mode === 'edit' && strategy ? (strategy.strategy_id || '') : '';
        this.stack = Array.isArray(strategy && strategy.stack) ? strategy.stack.map(item => this.makeStackItem(item.strategy_type, item)) : [];
        this.selectedFund = strategy && strategy.fund_code ? {
            fund_code: strategy.fund_code,
            fund_name: strategy.fund_name || '',
        } : null;
        this.dateRange = strategy && strategy.date_range ? strategy.date_range : this.defaultDateRange();
        const savedBacktest = strategy && strategy.backtest_config ? strategy.backtest_config : null;
        if (savedBacktest && typeof savedBacktest === 'object') {
            this.backtest = {
                initial_cash: Number(savedBacktest.initial_cash) || 10000,
                fill_model: savedBacktest.fill_model || 'same_day_nav',
                sizing_mode: savedBacktest.sizing_mode || 'all_in',
                fixed_amount: Number(savedBacktest.fixed_amount) || 1000,
                fixed_percent: Number(savedBacktest.fixed_percent) || 1,
                fee_rate: Number(savedBacktest.fee_rate) || 0,
            };
        }

        const nameInput = document.getElementById('strategy-detail-name');
        if (nameInput && strategy) nameInput.value = strategy.name || '';

        const deleteBtn = document.getElementById('strategy-detail-delete-btn');
        if (deleteBtn && this.currentStrategyId) deleteBtn.classList.remove('hidden');

        if (this.bootstrap.not_found) {
            showToast('该策略不存在或已删除', 'error');
        }
    },

    defaultDateRange: function() {
        const today = new Date();
        const start = new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000);
        return {
            preset: '6m',
            start_date: this.formatDateInput(start),
            end_date: this.formatDateInput(today),
            full_history: false,
        };
    },

    loadBaseData: async function() {
        try {
            await Promise.all([this.loadStrategyTypes(), this.loadFunds()]);
            this.renderStrategyTypeOptions();
            this.renderStack();
            this.renderSelectedFund();
        } catch (e) {
            showToast('初始化组合策略详情失败: ' + (e.message || e), 'error');
        }
    },

    bindEvents: function() {
        const saveBtn = document.getElementById('strategy-detail-save-btn');
        const deleteBtn = document.getElementById('strategy-detail-delete-btn');
        const runBtn = document.getElementById('strategy-detail-run-btn');
        const loadHistoryBtn = document.getElementById('strategy-detail-load-history-btn');
        const addBtn = document.getElementById('strategy-detail-add-btn');
        const resetZoomBtn = document.getElementById('strategy-detail-reset-zoom-btn');
        const fundInput = document.getElementById('strategy-detail-fund-keyword');
        const startInput = document.getElementById('strategy-detail-start-date');
        const endInput = document.getElementById('strategy-detail-end-date');
        const backtestInitialCashInput = document.getElementById('strategy-backtest-initial-cash');
        const exportSignalsBtn = document.getElementById('strategy-export-signals-btn');
        const exportTradesBtn = document.getElementById('strategy-export-trades-btn');
        const exportReportBtn = document.getElementById('strategy-export-report-btn');
        const exportDebugBtn = document.getElementById('strategy-export-debug-btn');

        if (saveBtn) saveBtn.addEventListener('click', () => void this.handleSave());
        if (deleteBtn) deleteBtn.addEventListener('click', () => void this.handleDelete());
        if (runBtn) runBtn.addEventListener('click', () => void this.runAnalysis());
        if (loadHistoryBtn) loadHistoryBtn.addEventListener('click', () => void this.loadHistoryOnly());
        if (addBtn) addBtn.addEventListener('click', () => this.handleAddStrategy());
        if (resetZoomBtn) resetZoomBtn.addEventListener('click', () => this.resetChartZoom());
        if (backtestInitialCashInput) {
            backtestInitialCashInput.addEventListener('change', () => this.onBacktestInputChanged());
            backtestInitialCashInput.addEventListener('input', () => this.onBacktestInputChanged());
        }
        if (exportSignalsBtn) exportSignalsBtn.addEventListener('click', () => this.exportSignalsCsv());
        if (exportTradesBtn) exportTradesBtn.addEventListener('click', () => this.exportTradesCsv());
        if (exportReportBtn) exportReportBtn.addEventListener('click', () => void this.exportReportPng());
        if (exportDebugBtn) exportDebugBtn.addEventListener('click', () => this.exportDebugJson());

        if (fundInput) {
            fundInput.addEventListener('input', () => this.renderFundSuggestions());
            fundInput.addEventListener('focus', () => this.renderFundSuggestions());
            fundInput.addEventListener('blur', () => setTimeout(() => this.hideFundSuggestions(), 150));
        }

        if (startInput) startInput.addEventListener('change', () => this.onDateInputChanged());
        if (endInput) endInput.addEventListener('change', () => this.onDateInputChanged());

        document.querySelectorAll('#strategy-detail-period-presets [data-preset]').forEach(btn => {
            btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset || '6m'));
        });
    },

    loadStrategyTypes: async function() {
        const res = await fetch('/api/strategy-types');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.strategyTypes = Array.isArray(data) ? data : [];
        this.strategyTypeMap = {};
        this.strategyTypes.forEach(item => {
            if (item && item.type) this.strategyTypeMap[item.type] = item;
        });
    },

    loadFunds: async function() {
        const res = await fetch('/api/funds');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.allFunds = Array.isArray(data) ? data : [];
    },

    renderStrategyTypeOptions: function() {
        const select = document.getElementById('strategy-detail-add-type');
        if (!select) return;
        if (!this.strategyTypes.length) {
            select.innerHTML = '<option value="">加载中...</option>';
            return;
        }
        select.innerHTML = this.strategyTypes.map(item => `<option value="${item.type}">${item.name}</option>`).join('');
    },

    formatDateInput: function(dateObj) {
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    applyPreset: function(preset) {
        const today = new Date();
        if (preset === 'all') {
            this.applyDateRange({ preset: 'all', start_date: '', end_date: '', full_history: true }, true);
            return;
        }
        const start = new Date(today.getTime());
        if (preset === '1y') start.setFullYear(start.getFullYear() - 1);
        else if (preset === '2y') start.setFullYear(start.getFullYear() - 2);
        else if (preset === '3y') start.setFullYear(start.getFullYear() - 3);
        else start.setDate(start.getDate() - 180);
        this.applyDateRange({
            preset,
            start_date: this.formatDateInput(start),
            end_date: this.formatDateInput(today),
            full_history: false,
        }, true);
    },

    applyDateRange: function(range, updateLabel = true) {
        const startInput = document.getElementById('strategy-detail-start-date');
        const endInput = document.getElementById('strategy-detail-end-date');
        this.dateRange = {
            preset: range.preset || 'custom',
            start_date: range.full_history ? '' : (range.start_date || ''),
            end_date: range.full_history ? '' : (range.end_date || ''),
            full_history: !!range.full_history || range.preset === 'all',
        };
        if (startInput) startInput.value = this.dateRange.start_date || '';
        if (endInput) endInput.value = this.dateRange.end_date || '';
        document.querySelectorAll('#strategy-detail-period-presets [data-preset]').forEach(btn => {
            btn.classList.toggle('btn-primary', btn.dataset.preset === this.dateRange.preset);
            btn.classList.toggle('btn-outline', btn.dataset.preset !== this.dateRange.preset);
        });
        if (updateLabel) this.renderSelectedRange();
    },

    onDateInputChanged: function() {
        const startInput = document.getElementById('strategy-detail-start-date');
        const endInput = document.getElementById('strategy-detail-end-date');
        this.dateRange = {
            preset: 'custom',
            start_date: startInput ? startInput.value : '',
            end_date: endInput ? endInput.value : '',
            full_history: false,
        };
        document.querySelectorAll('#strategy-detail-period-presets [data-preset]').forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-outline');
        });
        this.renderSelectedRange();
    },

    renderSelectedRange: function() {
        const labelEl = document.getElementById('strategy-detail-selected-range');
        if (!labelEl) return;
        const presetMap = { '6m': '半年', '1y': '1年', '2y': '2年', '3y': '3年', 'all': '全部', 'custom': '自定义' };
        if (this.dateRange.full_history) {
            labelEl.textContent = '全部';
            return;
        }
        labelEl.textContent = presetMap[this.dateRange.preset] || `${this.dateRange.start_date || '-'} ~ ${this.dateRange.end_date || '-'}`;
    },

    renderSelectedFund: function() {
        const input = document.getElementById('strategy-detail-fund-keyword');
        const selectedEl = document.getElementById('strategy-detail-selected-fund');
        const text = this.selectedFund && this.selectedFund.fund_code
            ? `${this.selectedFund.fund_code}${this.selectedFund.fund_name ? ' · ' + this.selectedFund.fund_name : ''}`
            : '未选择';
        if (selectedEl) selectedEl.textContent = text;
        if (input && this.selectedFund && this.selectedFund.fund_code) input.value = text;
    },

    renderFundSuggestions: function() {
        const input = document.getElementById('strategy-detail-fund-keyword');
        const panel = document.getElementById('strategy-detail-fund-suggestions');
        if (!input || !panel) return;
        const keyword = (input.value || '').trim().toLowerCase();
        if (!keyword || !this.allFunds.length) {
            this.hideFundSuggestions();
            return;
        }
        const matched = this.allFunds.filter(item => {
            const code = String(item.fund_code || '').toLowerCase();
            const name = String(item.fund_name || '').toLowerCase();
            return code.includes(keyword) || name.includes(keyword);
        }).slice(0, this.fundSuggestionLimit);
        if (!matched.length) {
            panel.innerHTML = '<div class="px-3 py-2 text-sm text-slate-300">未找到匹配基金</div>';
            panel.classList.remove('hidden');
            return;
        }
        panel.innerHTML = matched.map(item => `
            <button type="button" class="block w-full px-3 py-2 text-left hover:bg-white/5" onclick="StrategyDetailPage.selectFund('${item.fund_code}', '${(item.fund_name || '').replace(/'/g, '\\&#39;')}')">
                <div class="font-bold text-sm">${item.fund_code}</div>
                <div class="text-xs text-slate-300 mt-1 truncate">${item.fund_name || '-'}</div>
            </button>
        `).join('');
        panel.classList.remove('hidden');
    },

    hideFundSuggestions: function() {
        const panel = document.getElementById('strategy-detail-fund-suggestions');
        if (panel) panel.classList.add('hidden');
    },

    selectFund: function(fundCode, fundName) {
        this.selectedFund = { fund_code: fundCode, fund_name: fundName || '' };
        this.hideFundSuggestions();
        this.renderSelectedFund();
    },

    ensureSelectedFund: function() {
        if (this.selectedFund && this.selectedFund.fund_code) return this.selectedFund;
        const input = document.getElementById('strategy-detail-fund-keyword');
        const raw = (input ? input.value : '').trim();
        if (!raw) return null;
        const exact = this.allFunds.find(item => item.fund_code === raw || item.fund_name === raw || `${item.fund_code} · ${item.fund_name}` === raw);
        if (exact) {
            this.selectFund(exact.fund_code, exact.fund_name);
            return this.selectedFund;
        }
        const matchedCode = raw.match(/\d{5,8}/);
        if (matchedCode) {
            const code = matchedCode[0];
            const item = this.allFunds.find(fund => fund.fund_code === code);
            this.selectFund(code, item ? item.fund_name : '');
            return this.selectedFund;
        }
        return null;
    },

    makeStackItem: function(strategyType, override) {
        const typeInfo = this.strategyTypeMap[strategyType] || {};
        const defaults = JSON.parse(JSON.stringify(typeInfo.defaults || {}));
        const params = Object.assign({}, defaults, (override && override.params) || {});
        return {
            uid: (override && (override.client_uid || override.uid)) || `${strategyType}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            strategy_type: strategyType,
            enabled: override && typeof override.enabled === 'boolean' ? override.enabled : true,
            display_enabled: override && typeof override.display_enabled === 'boolean' ? override.display_enabled : true,
            params,
        };
    },

    handleAddStrategy: function() {
        const select = document.getElementById('strategy-detail-add-type');
        const strategyType = select ? select.value : '';
        if (!strategyType) {
            showToast('请选择单一策略', 'warning');
            return;
        }
        this.stack.push(this.makeStackItem(strategyType));
        this.renderStack();
        showToast('已添加策略', 'success');
    },

    removeStackItem: function(uid) {
        this.stack = this.stack.filter(item => item.uid !== uid);
        this.renderStack();
    },

    toggleStackFlag: function(uid, key, checked) {
        const item = this.stack.find(entry => entry.uid === uid);
        if (!item) return;
        item[key] = checked;
        this.renderStack();
    },

    updateStackParam: function(uid, key, value, type) {
        const item = this.stack.find(entry => entry.uid === uid);
        if (!item) return;
        if (type === 'int') item.params[key] = value === '' ? '' : parseInt(value, 10);
        else if (type === 'float') item.params[key] = value === '' ? '' : parseFloat(value);
        else if (type === 'bool') item.params[key] = !!value;
        else item.params[key] = value;
    },

    renderStack: function() {
        const container = document.getElementById('strategy-detail-stack');
        const countEl = document.getElementById('strategy-detail-stack-count');
        if (countEl) countEl.textContent = `${this.stack.length} 个`;
        if (!container) return;
        if (!this.stack.length) {
            container.innerHTML = '<div class="text-sm text-slate-300">暂无单一策略，请先添加。</div>';
            return;
        }
        container.innerHTML = this.stack.map((item, index) => this.renderStackItem(item, index)).join('');
    },

    renderStackItem: function(item, index) {
        const typeInfo = this.strategyTypeMap[item.strategy_type] || {};
        const schema = Array.isArray(typeInfo.param_schema) ? typeInfo.param_schema : [];
        const result = this.analysisResults.find(entry => entry.client_uid === item.uid);
        const summary = result && result.meta && result.meta.summary ? result.meta.summary : '尚未运行';
        return `
            <div class="rounded-2xl border border-white/10 bg-black/15 p-3 strategy-stack-item">
                <div class="flex flex-wrap items-start justify-between gap-3 mb-2">
                    <div class="min-w-[220px] flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="font-bold">${index + 1}. ${typeInfo.name || item.strategy_type}</div>
                            <span class="badge badge-outline badge-sm">${item.strategy_type}</span>
                        </div>
                        <div class="text-xs text-slate-300 mt-1">${typeInfo.description || '独立策略模块'}</div>
                        <div class="text-xs text-cyan-200 mt-1">${summary}</div>
                    </div>
                    <div class="flex flex-wrap items-center gap-3 strategy-stack-switches">
                        <label class="label cursor-pointer gap-2 py-0">
                            <span class="label-text text-xs">启用</span>
                            <input type="checkbox" class="toggle toggle-success toggle-xs" ${item.enabled ? 'checked' : ''} onchange="StrategyDetailPage.toggleStackFlag('${item.uid}', 'enabled', this.checked)">
                        </label>
                        <label class="label cursor-pointer gap-2 py-0">
                            <span class="label-text text-xs">显示</span>
                            <input type="checkbox" class="toggle toggle-info toggle-xs" ${item.display_enabled ? 'checked' : ''} onchange="StrategyDetailPage.toggleStackFlag('${item.uid}', 'display_enabled', this.checked)">
                        </label>
                        <button type="button" class="btn btn-xs btn-ghost text-error" onclick="StrategyDetailPage.removeStackItem('${item.uid}')">删除</button>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    ${schema.map(field => this.renderParamField(item, field)).join('')}
                </div>
            </div>
        `;
    },

    renderParamField: function(item, field) {
        const key = field.key || '';
        const label = field.label || key;
        const type = field.type || 'string';
        const value = item.params && key in item.params ? item.params[key] : field.default;
        const desc = field.description || '';
        if (type === 'bool') {
            return `
                <div class="rounded-xl border border-white/10 bg-slate-950/35 p-2.5 strategy-param-field">
                    <label class="label cursor-pointer justify-start gap-3 py-0">
                        <input type="checkbox" class="checkbox checkbox-sm" ${value ? 'checked' : ''} onchange="StrategyDetailPage.updateStackParam('${item.uid}', '${key}', this.checked, 'bool')">
                        <span class="label-text text-sm">${label}</span>
                    </label>
                    ${desc ? `<div class="text-xs text-slate-300 mt-1">${desc}</div>` : ''}
                </div>
            `;
        }
        if (type === 'enum' && Array.isArray(field.options)) {
            return `
                <div class="rounded-xl border border-white/10 bg-slate-950/35 p-2.5 strategy-param-field">
                    <label class="label py-0.5"><span class="label-text text-xs uppercase tracking-wide">${label}</span></label>
                    <select class="select select-bordered select-sm w-full" onchange="StrategyDetailPage.updateStackParam('${item.uid}', '${key}', this.value, 'enum')">
                        ${field.options.map(option => `<option value="${option.value}" ${String(value) === String(option.value) ? 'selected' : ''}>${option.label || option.value}</option>`).join('')}
                    </select>
                    ${desc ? `<div class="text-xs text-slate-300 mt-1">${desc}</div>` : ''}
                </div>
            `;
        }
        const inputType = type === 'int' || type === 'float' ? 'number' : 'text';
        const step = type === 'float' ? '0.01' : '1';
        const minAttr = field.min !== undefined ? `min="${field.min}"` : '';
        const maxAttr = field.max !== undefined ? `max="${field.max}"` : '';
        return `
            <div class="rounded-xl border border-white/10 bg-slate-950/35 p-2.5 strategy-param-field">
                <label class="label py-0.5"><span class="label-text text-xs uppercase tracking-wide">${label}</span></label>
                <input type="${inputType}" class="input input-bordered input-sm w-full" value="${value === undefined || value === null ? '' : value}" ${inputType === 'number' ? `step="${step}"` : ''} ${minAttr} ${maxAttr} oninput="StrategyDetailPage.updateStackParam('${item.uid}', '${key}', this.value, '${type}')">
                ${desc ? `<div class="text-xs text-slate-300 mt-1">${desc}</div>` : ''}
            </div>
        `;
    },

    getDateRangePayload: function() {
        return {
            preset: this.dateRange.preset,
            start_date: this.dateRange.full_history ? '' : this.dateRange.start_date,
            end_date: this.dateRange.full_history ? '' : this.dateRange.end_date,
            full_history: !!this.dateRange.full_history,
        };
    },

    buildSavePayload: function() {
        const nameInput = document.getElementById('strategy-detail-name');
        const name = nameInput ? (nameInput.value || '').trim() : '';
        if (!name) {
            showToast('请输入组合策略名称', 'warning');
            return null;
        }
        if (!this.stack.length) {
            showToast('请至少添加一个单一策略', 'warning');
            return null;
        }
        const fund = this.ensureSelectedFund();
        return {
            name,
            scope: 'single_fund_analysis',
            fund_code: fund ? fund.fund_code : '',
            fund_name: fund ? fund.fund_name : '',
            date_range: this.getDateRangePayload(),
            stack: this.stack.map(item => ({
                strategy_type: item.strategy_type,
                enabled: !!item.enabled,
                display_enabled: !!item.display_enabled,
                params: item.params || {},
                client_uid: item.uid,
            })),
            backtest_config: {
                initial_cash: this.backtest && this.backtest.initial_cash !== undefined ? this.backtest.initial_cash : 10000,
                fill_model: this.backtest && this.backtest.fill_model ? this.backtest.fill_model : 'same_day_nav',
                sizing_mode: this.backtest && this.backtest.sizing_mode ? this.backtest.sizing_mode : 'all_in',
                fixed_amount: this.backtest && this.backtest.fixed_amount !== undefined ? this.backtest.fixed_amount : 1000,
                fixed_percent: this.backtest && this.backtest.fixed_percent !== undefined ? this.backtest.fixed_percent : 1,
                fee_rate: this.backtest && this.backtest.fee_rate !== undefined ? this.backtest.fee_rate : 0,
            },
        };
    },

    handleSave: async function() {
        const payload = this.buildSavePayload();
        if (!payload) return;
        try {
            let res;
            if (this.currentStrategyId) {
                res = await fetch(`/api/strategies/${encodeURIComponent(this.currentStrategyId)}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                });
            } else {
                res = await fetch('/api/strategies', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                });
            }
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${res.status}`);
            if (!this.currentStrategyId && data.strategy_id) {
                window.location.href = `/strategies/${encodeURIComponent(data.strategy_id)}`;
                return;
            }
            showToast('组合策略已保存', 'success');
        } catch (e) {
            showToast('保存失败: ' + (e.message || e), 'error');
        }
    },

    handleDelete: async function() {
        if (!this.currentStrategyId) {
            showToast('当前还没有已保存的组合策略', 'warning');
            return;
        }

        const doDelete = async () => {
            try {
                const res = await fetch(`/api/strategies/${encodeURIComponent(this.currentStrategyId)}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${res.status}`);
                window.location.href = '/#strategy';
            } catch (e) {
                showToast('删除失败: ' + (e.message || e), 'error');
            }
        };

        const modal = document.getElementById('strategy-delete-modal');
        const msgEl = document.getElementById('strategy-delete-message');
        const confirmBtn = document.getElementById('strategy-delete-confirm-btn');
        if (!modal || !confirmBtn) {
            if (!window.confirm('确定要删除当前组合策略吗？删除后不可恢复。')) return;
            await doDelete();
            return;
        }

        if (msgEl) msgEl.textContent = '确定要删除当前组合策略吗？删除后不可恢复。';
        confirmBtn.onclick = () => {
            modal.close();
            void doDelete();
        };
        modal.showModal();
    },

    renderActionStates: function() {
        const loadBtn = document.getElementById('strategy-detail-load-history-btn');
        const runBtn = document.getElementById('strategy-detail-run-btn');
        const saveBtn = document.getElementById('strategy-detail-save-btn');
        const deleteBtn = document.getElementById('strategy-detail-delete-btn');
        const chartLoading = document.getElementById('strategy-detail-chart-loading');
        const chartLoadingText = document.getElementById('strategy-detail-chart-loading-text');
        const signalsLoading = document.getElementById('strategy-detail-signals-loading');
        const signals = document.getElementById('strategy-detail-signals');
        const anyLoading = this.isHistoryLoading || this.isAnalysisLoading;

        if (loadBtn) {
            loadBtn.disabled = anyLoading;
            loadBtn.classList.toggle('btn-disabled', anyLoading);
            loadBtn.innerHTML = this.isHistoryLoading ? '<span class="loading loading-spinner loading-xs"></span>加载中...' : '加载净值';
        }
        if (runBtn) {
            runBtn.disabled = anyLoading;
            runBtn.classList.toggle('btn-disabled', anyLoading);
            runBtn.innerHTML = this.isAnalysisLoading ? '<span class="loading loading-spinner loading-xs"></span>分析中...' : '运行分析';
        }
        if (saveBtn) saveBtn.disabled = anyLoading;
        if (deleteBtn) deleteBtn.disabled = anyLoading;

        if (chartLoading && chartLoadingText) {
            if (anyLoading) {
                chartLoading.classList.remove('hidden');
                chartLoadingText.textContent = this.isAnalysisLoading ? '正在运行组合策略分析...' : '正在加载净值走势...';
            } else {
                chartLoading.classList.add('hidden');
            }
        }
        if (signalsLoading && signals) {
            if (this.isAnalysisLoading) {
                signalsLoading.classList.remove('hidden');
                signals.classList.add('hidden');
            } else {
                signalsLoading.classList.add('hidden');
                signals.classList.remove('hidden');
            }
        }
    },

    initBacktest: function() {
        const initialCashInput = document.getElementById('strategy-backtest-initial-cash');
        if (initialCashInput) {
            const initial = Number(this.backtest && this.backtest.initial_cash !== undefined ? this.backtest.initial_cash : (initialCashInput.value || '10000'));
            this.backtest.initial_cash = Number.isFinite(initial) && initial > 0 ? initial : 10000;
            initialCashInput.value = String(this.backtest.initial_cash);
        } else {
            this.backtest.initial_cash = 10000;
        }
        this.backtestResult = null;
        this.backtestTrades = [];
    },

    onBacktestInputChanged: function() {
        const input = document.getElementById('strategy-backtest-initial-cash');
        const raw = (input ? input.value : '').trim();
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return;
        this.backtest.initial_cash = value;
        this.backtestResult = null;
        this.backtestTrades = [];
        this.renderBacktest();
    },

    runUnified: async function(showToastOnSuccess, successMessage) {
        const fund = this.ensureSelectedFund();
        if (!fund || !Validator.fundCode(fund.fund_code)) {
            showToast('请先选择基金', 'warning');
            return;
        }
        if (!this.stack.length || this.stack.filter(item => item.enabled).length === 0) {
            showToast('请至少启用一个单一策略', 'warning');
            return;
        }
        if (this.isHistoryLoading || this.isAnalysisLoading) return;
        this.isAnalysisLoading = true;
        this.analysisSignals = [];
        this.backtestResult = null;
        this.backtestTrades = [];
        this.renderSignals();
        this.renderBacktest();
        this.renderActionStates();
        try {
            const res = await fetch('/api/strategy-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fund_code: fund.fund_code,
                    date_range: this.getDateRangePayload(),
                    full_history: !!this.dateRange.full_history,
                    stack: this.stack.map(item => ({
                        strategy_type: item.strategy_type,
                        enabled: !!item.enabled,
                        display_enabled: !!item.display_enabled,
                        params: item.params || {},
                        client_uid: item.uid,
                    })),
                    backtest_config: {
                        initial_cash: this.backtest && this.backtest.initial_cash !== undefined ? this.backtest.initial_cash : 10000,
                        fill_model: 'same_day_nav',
                        sizing_mode: this.backtest && this.backtest.sizing_mode ? this.backtest.sizing_mode : 'all_in',
                        fixed_amount: this.backtest && this.backtest.fixed_amount !== undefined ? this.backtest.fixed_amount : 1000,
                        fixed_percent: this.backtest && this.backtest.fixed_percent !== undefined ? this.backtest.fixed_percent : 1,
                        fee_rate: this.backtest && this.backtest.fee_rate !== undefined ? this.backtest.fee_rate : 0,
                    },
                    signal_overrides: [],
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || data.error || `HTTP ${res.status}`);
            this.analysisHistory = Array.isArray(data.history) ? data.history : [];
            this.analysisResults = Array.isArray(data.analysis_results) ? data.analysis_results : [];
            this.analysisSignals = Array.isArray(data.signals) ? data.signals : [];
            this.backtestResult = data.backtest_result || null;
            this.backtestTrades = Array.isArray(data.backtest_trades) ? data.backtest_trades : [];
            this.renderChart();
            this.renderSignals();
            this.renderBacktest();
            if (showToastOnSuccess) showToast(successMessage || '分析完成', 'success');
        } catch (e) {
            showToast('运行失败: ' + (e.message || e), 'error');
        } finally {
            this.isAnalysisLoading = false;
            this.renderActionStates();
        }
    },

    escapeHtml: function(text) {
        const str = String(text === undefined || text === null ? '' : text);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    formatMoney: function(value, digits = 2) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return num.toFixed(digits);
    },

    formatPercent: function(value, digits = 2) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return (num * 100).toFixed(digits) + '%';
    },

    // A股常见配色：红涨绿跌；红赚绿亏；红买绿卖
    getUpDownTextClass: function(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 'text-slate-300';
        return num >= 0 ? 'text-rose-300' : 'text-emerald-300';
    },

    getTradeActionTextClass: function(action, isValuation) {
        if (isValuation) return 'text-sky-300';
        if (action === '买入') return 'text-rose-300';
        if (action === '卖出') return 'text-emerald-300';
        return 'text-slate-300';
    },

    buildTimestampSuffix: function() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return (
            now.getFullYear() +
            pad(now.getMonth() + 1) +
            pad(now.getDate()) +
            '_' +
            pad(now.getHours()) +
            pad(now.getMinutes()) +
            pad(now.getSeconds())
        );
    },

    downloadJsonObject: function(obj, filename) {
        const jsonText = JSON.stringify(obj, null, 2);
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    downloadDataUrl: function(dataUrl, filename) {
        const link = document.createElement('a');
        link.setAttribute('href', dataUrl);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    exportReportPng: async function() {
        if (!this.analysisHistory.length) {
            showToast('暂无净值数据，请先运行分析', 'warning');
            return;
        }
        if (!this.backtestResult || this.backtestResult.error) {
            showToast('暂无回测结果，请先运行分析', 'warning');
            return;
        }
        if (typeof window.html2canvas !== 'function') {
            showToast('导出失败：缺少截图依赖（html2canvas）', 'error');
            return;
        }

        const fund = this.ensureSelectedFund();
        const nameInput = document.getElementById('strategy-detail-name');
        const strategyName = nameInput ? String((nameInput.value || '').trim()) : '';
        const rangeLabel = this.dateRange && this.dateRange.full_history
            ? '全部'
            : `${this.dateRange.start_date || '-'} ~ ${this.dateRange.end_date || '-'}`;

        const chartCanvas = document.getElementById('strategy-detail-chart');
        const chartDataUrl = chartCanvas && typeof chartCanvas.toDataURL === 'function' ? chartCanvas.toDataURL('image/png') : '';

        const result = this.backtestResult || {};
        const safeNumber = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        const initialCash = safeNumber(result.initial_cash);
        const finalEquity = safeNumber(result.final_equity);
        const totalReturn = safeNumber(result.total_return);
        const tradeCount = safeNumber(result.trade_count);
        const buyCount = safeNumber(result.buy_count);
        const sellCount = safeNumber(result.sell_count);
        const skippedCount = safeNumber(result.skipped_count);
        const holding = !!result.holding;
        const lastPrice = safeNumber(result.last_price);
        const lastDate = result.last_date ? String(result.last_date) : '';
        const avgPrice = safeNumber(result.avg_price);
        const unrealizedReturn = safeNumber(result.unrealized_return);
        const unrealizedPnl = safeNumber(result.unrealized_pnl);
        const buyholdReturn = safeNumber(result.buyhold_return);
        const buyholdFinalEquity = safeNumber(result.buyhold_final_equity);
        const buyholdFirstPrice = safeNumber(result.buyhold_first_price);
        const buyholdFirstDate = result.buyhold_first_date ? String(result.buyhold_first_date) : '';
        const excess = (buyholdReturn !== null && totalReturn !== null) ? (totalReturn - buyholdReturn) : null;

        const buildSummaryLine = (label, value, highlightColor) => {
            const color = highlightColor || 'rgba(226,232,240,0.92)';
            return `
                <div style="margin:4px 0;">
                    <span style="color:rgba(148,163,184,1);">${this.escapeHtml(label)}：</span>
                    <span style="font-weight:700;color:${color};">${this.escapeHtml(value)}</span>
                </div>
            `;
        };

        const summaryParts = [];
        summaryParts.push(buildSummaryLine('初始资金', initialCash === null ? '-' : this.formatMoney(initialCash, 2)));
        summaryParts.push(buildSummaryLine('期末资产', finalEquity === null ? '-' : this.formatMoney(finalEquity, 2), '#67e8f9'));
        summaryParts.push(buildSummaryLine('总收益率', totalReturn === null ? '-' : this.formatPercent(totalReturn, 2), (totalReturn !== null && totalReturn >= 0) ? '#fda4af' : '#6ee7b7'));
        summaryParts.push(buildSummaryLine('交易笔数', tradeCount === null ? '-' : `${tradeCount}（买 ${buyCount === null ? '-' : buyCount} / 卖 ${sellCount === null ? '-' : sellCount}${skippedCount ? `，跳过 ${skippedCount}` : ''}）`));
        if (buyholdReturn !== null && buyholdFinalEquity !== null && buyholdFirstPrice !== null) {
            summaryParts.push(`
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);">
                    <div style="font-weight:700;margin-bottom:6px;">基准（买入持有）</div>
                    ${buildSummaryLine('基准区间', `${this.formatMoney(buyholdFirstPrice, 4)}（${buyholdFirstDate || '-'}） → ${lastPrice === null ? '-' : this.formatMoney(lastPrice, 4)}（${lastDate || '-'}）`)}
                    ${buildSummaryLine('基准收益率', this.formatPercent(buyholdReturn, 2), '#c7d2fe')}
                    ${buildSummaryLine('基准期末资产', this.formatMoney(buyholdFinalEquity, 2), '#c7d2fe')}
                    ${buildSummaryLine('超额', excess === null ? '-' : this.formatPercent(excess, 2), excess !== null && excess >= 0 ? '#fda4af' : '#6ee7b7')}
                </div>
            `);
        }
        if (holding && lastPrice !== null) {
            summaryParts.push(`
                <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);">
                    <div style="font-weight:700;margin-bottom:6px;">未平仓估值</div>
                    ${avgPrice === null ? '' : buildSummaryLine('持仓均价', this.formatMoney(avgPrice, 4))}
                    ${buildSummaryLine('最新净值', this.formatMoney(lastPrice, 4) + (lastDate ? `（${lastDate}）` : ''))}
                    ${unrealizedReturn === null ? '' : buildSummaryLine('持仓收益率', this.formatPercent(unrealizedReturn, 2), unrealizedReturn >= 0 ? '#fda4af' : '#6ee7b7')}
                    ${unrealizedPnl === null ? '' : buildSummaryLine('浮动盈亏', this.formatMoney(unrealizedPnl, 2), unrealizedPnl >= 0 ? '#fda4af' : '#6ee7b7')}
                </div>
            `);
        }
        const backtestSummaryHtml = `<div style="font-size:13px;line-height:1.5;">${summaryParts.join('')}</div>`;

        const trades = this.buildTradesForOutput(this.backtestTrades || [], true);
        const tradeRowsHtml = trades.slice(0, 80).map(t => {
            const priceNum = Number(t && t.price !== undefined && t.price !== null ? t.price : NaN);
            const sharesNum = Number(t && t.shares_after !== undefined && t.shares_after !== null ? t.shares_after : NaN);
            const holdingValue = Number.isFinite(priceNum) && Number.isFinite(sharesNum) ? (priceNum * sharesNum) : null;
            return `
                <tr>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;">${this.escapeHtml(t.date || '')}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;">${this.escapeHtml(t.action || '')}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">${this.formatMoney(t.price, 4)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">${this.formatMoney(t.shares_delta, 4)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">${this.formatMoney(t.cash_after, 2)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">${this.formatMoney(t.shares_after, 4)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">${holdingValue === null ? '-' : this.formatMoney(holdingValue, 2)}</td>
                    <td style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;color:rgba(226,232,240,0.9);">${this.escapeHtml(t.note || '')}</td>
                </tr>
            `;
        }).join('');

        const reportBodyHtml = `
            <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:16px;">
                <div>
                    <div style="font-size:20px;font-weight:800;letter-spacing:0.5px;">策略回测报告</div>
                    <div style="margin-top:6px;font-size:13px;color:rgba(226,232,240,0.85);">
                        <span style="color:rgba(148,163,184,1);">策略：</span>${this.escapeHtml(strategyName || '-')}
                        <span style="margin:0 10px;color:rgba(100,116,139,1);">|</span>
                        <span style="color:rgba(148,163,184,1);">基金：</span>${this.escapeHtml(fund ? (fund.fund_name || fund.fund_code) : '-')}
                        <span style="margin:0 10px;color:rgba(100,116,139,1);">|</span>
                        <span style="color:rgba(148,163,184,1);">区间：</span>${this.escapeHtml(rangeLabel)}
                    </div>
                </div>
                <div style="font-size:12px;color:rgba(226,232,240,0.75);text-align:right;">
                    导出时间：${this.escapeHtml(new Date().toLocaleString())}
                </div>
            </div>

            <div style="border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:12px;margin-bottom:14px;background:rgba(2,6,23,0.45);">
                <div style="font-weight:700;margin-bottom:8px;">图表</div>
                ${chartDataUrl ? `<img src="${chartDataUrl}" style="width:100%;height:auto;border-radius:12px;display:block;" />` : `<div style="color:rgba(226,232,240,0.7);">暂无图表</div>`}
            </div>

            <div style="border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:12px;margin-bottom:14px;background:rgba(2,6,23,0.45);">
                <div style="font-weight:700;margin-bottom:8px;">买卖汇总与收益</div>
                <div>${backtestSummaryHtml || '<div style="color:rgba(226,232,240,0.7);">暂无回测摘要</div>'}</div>
            </div>

            <div style="border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:12px;background:rgba(2,6,23,0.45);">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
                    <div style="font-weight:700;">交易明细（最多展示前 80 行）</div>
                    <div style="font-size:12px;color:rgba(226,232,240,0.75);">总笔数：${trades.length}</div>
                </div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="color:rgba(148,163,184,1);font-size:12px;text-align:left;">
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);">日期</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);">动作</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">净值</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">份额变化</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">现金</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">持仓份额</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);text-align:right;">持仓市值</th>
                            <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);">触发信号</th>
                        </tr>
                    </thead>
                    <tbody style="font-size:12px;">${tradeRowsHtml || ''}</tbody>
                </table>
            </div>
        `;

        // 使用隔离 iframe 渲染报告，彻底避免页面全局样式（oklch）影响 html2canvas
        let iframe = document.getElementById('strategy-export-report-iframe');
        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'strategy-export-report-iframe';
            iframe.style.position = 'fixed';
            iframe.style.left = '0';
            iframe.style.top = '0';
            iframe.style.width = '1080px';
            iframe.style.height = '1px';
            iframe.style.opacity = '0';
            iframe.style.pointerEvents = 'none';
            iframe.style.zIndex = '-1';
            iframe.setAttribute('aria-hidden', 'true');
            document.body.appendChild(iframe);
        }

        const iframeHtml = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; background: #020617; color: #f1f5f9; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
    #report { width: 1080px; padding: 24px; box-sizing: border-box; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <div id="report">${reportBodyHtml}</div>
</body>
</html>`;
        iframe.srcdoc = iframeHtml;

        try {
            await new Promise((resolve) => {
                iframe.onload = () => resolve();
                // 某些浏览器对 srcdoc onload 触发不稳定，兜底一个短延迟
                setTimeout(resolve, 60);
            });
            const doc = iframe.contentDocument;
            const reportEl = doc ? doc.getElementById('report') : null;
            if (!reportEl) throw new Error('导出失败：报告渲染未就绪');
            await new Promise(resolve => requestAnimationFrame(resolve));

            const canvas = await window.html2canvas(reportEl, {
                backgroundColor: '#020617',
                scale: 2,
                useCORS: true,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 1080,
                windowHeight: Math.max(1200, reportEl.scrollHeight || 0),
            });
            const dataUrl = canvas.toDataURL('image/png');
            const filename = `strategy_report_${this.buildTimestampSuffix()}.png`;
            this.downloadDataUrl(dataUrl, filename);
            showToast('已导出报告PNG', 'success');
        } catch (e) {
            try { console.error(e); } catch (_) {}
            showToast('导出失败: ' + (e.message || e), 'error');
        }
    },

    exportSignalsCsv: function() {
        if (!Array.isArray(this.analysisSignals) || !this.analysisSignals.length) {
            showToast('暂无信号，请先运行分析', 'warning');
            return;
        }
        if (typeof downloadCSV !== 'function') {
            showToast('导出失败：缺少下载工具函数', 'error');
            return;
        }
        const normalizeReason = (signal) => {
            const raw = String(signal && signal.reason ? signal.reason : '').trim();
            if (!raw) return '';
            if (raw.includes('MA') && (raw.includes('上穿') || raw.includes('下穿'))) return '';
            return raw;
        };
        const rows = this.analysisSignals.map(item => ({
            date: item && item.date ? String(item.date) : '',
            action: item && item.action ? String(item.action) : '',
            value: item && item.value !== undefined && item.value !== null ? String(item.value) : '',
            title: item && item.title ? String(item.title) : '',
            reason: normalizeReason(item),
            strategy_type: item && item.strategy_type ? String(item.strategy_type) : '',
            strategy_name: item && item.strategy_name ? String(item.strategy_name) : '',
        }));
        const headers = ['date', 'action', 'value', 'title', 'reason', 'strategy_type', 'strategy_name'];
        const filename = `strategy_signals_${this.buildTimestampSuffix()}.csv`;
        downloadCSV(rows, headers, filename);
        showToast('已导出交易信号CSV', 'success');
    },

    exportTradesCsv: function() {
        const baseTrades = Array.isArray(this.backtestTrades) ? this.backtestTrades : [];
        const trades = this.buildTradesForOutput(baseTrades, true);
        if (!trades.length) {
            showToast('暂无交易明细，请先运行回测', 'warning');
            return;
        }
        if (typeof downloadCSV !== 'function') {
            showToast('导出失败：缺少下载工具函数', 'error');
            return;
        }
        const rows = trades.map(item => {
            const priceNum = Number(item && item.price !== undefined && item.price !== null ? item.price : NaN);
            const sharesNum = Number(item && item.shares_after !== undefined && item.shares_after !== null ? item.shares_after : NaN);
            const holdingValue = Number.isFinite(priceNum) && Number.isFinite(sharesNum) ? (priceNum * sharesNum) : '';
            return ({
            date: item && item.date ? String(item.date) : '',
            action: item && item.action ? String(item.action) : '',
            price: item && item.price !== undefined && item.price !== null ? String(item.price) : '',
            shares_delta: item && item.shares_delta !== undefined && item.shares_delta !== null ? String(item.shares_delta) : '',
            cash_after: item && item.cash_after !== undefined && item.cash_after !== null ? String(item.cash_after) : '',
            shares_after: item && item.shares_after !== undefined && item.shares_after !== null ? String(item.shares_after) : '',
            holding_value: holdingValue === '' ? '' : String(holdingValue),
            note: item && item.note ? String(item.note) : '',
        });
        });
        const headers = ['date', 'action', 'price', 'shares_delta', 'cash_after', 'shares_after', 'holding_value', 'note'];
        const filename = `strategy_trades_${this.buildTimestampSuffix()}.csv`;
        downloadCSV(rows, headers, filename);
        showToast('已导出交易明细CSV', 'success');
    },

    exportDebugJson: function() {
        const nameInput = document.getElementById('strategy-detail-name');
        const strategyName = nameInput ? String((nameInput.value || '').trim()) : '';
        const fund = this.ensureSelectedFund();

        const historySorted = Array.isArray(this.analysisHistory)
            ? [...this.analysisHistory].filter(item => item && item.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
            : [];
        const historyLast = historySorted.length ? historySorted[historySorted.length - 1] : null;

        const debugObj = {
            exported_at: new Date().toISOString(),
            page: 'strategy_detail',
            strategy_id: this.currentStrategyId || '',
            strategy_name: strategyName,
            fund: fund ? { fund_code: fund.fund_code || '', fund_name: fund.fund_name || '' } : { fund_code: '', fund_name: '' },
            date_range: this.getDateRangePayload(),
            stack: (this.stack || []).map(item => ({
                strategy_type: item.strategy_type,
                enabled: !!item.enabled,
                display_enabled: !!item.display_enabled,
                params: item.params || {},
                client_uid: item.uid,
            })),
            analysis: {
                history_count: Array.isArray(this.analysisHistory) ? this.analysisHistory.length : 0,
                history_last: historyLast ? {
                    date: historyLast.date || '',
                    unit_nav: historyLast.unit_nav,
                    daily_return: historyLast.daily_return,
                } : null,
                signals_count: Array.isArray(this.analysisSignals) ? this.analysisSignals.length : 0,
                signals: this.analysisSignals || [],
            },
            backtest: {
                params: { initial_cash: this.backtest && this.backtest.initial_cash !== undefined ? this.backtest.initial_cash : null },
                result: this.backtestResult,
                trades_count: Array.isArray(this.backtestTrades) ? this.backtestTrades.length : 0,
                trades: this.backtestTrades || [],
            },
        };

        const filename = `strategy_debug_${this.buildTimestampSuffix()}.json`;
        this.downloadJsonObject(debugObj, filename);
        showToast('已导出诊断JSON', 'success');
    },

    buildTradesForOutput: function(baseTrades, includeValuationRow) {
        const trades = Array.isArray(baseTrades) ? [...baseTrades] : [];
        if (!includeValuationRow) return trades;
        const result = this.backtestResult;
        if (!result || result.error) return trades;
        if (!result.holding) return trades;
        const lastBuyPrice = result.last_buy_price || result.entry_price;
        const lastBuyDate = result.last_buy_date || result.entry_date;
        if (!lastBuyPrice || !result.last_price) return trades;

        const historySorted = Array.isArray(this.analysisHistory)
            ? [...this.analysisHistory].filter(item => item && item.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
            : [];
        const valuationDate = historySorted.length ? String((historySorted[historySorted.length - 1] || {}).date || '') : '';
        const noteParts = [
            `未平仓估值`,
            `最近一次买入 ${this.formatMoney(lastBuyPrice, 4)}（${lastBuyDate || '-'}）`,
            `最新净值 ${this.formatMoney(result.last_price, 4)}`,
            `持仓收益率 ${this.formatPercent(result.unrealized_return, 2)}`,
            `浮动盈亏 ${this.formatMoney(result.unrealized_pnl, 2)}`,
        ];
        const lastShares = Array.isArray(baseTrades) && baseTrades.length ? Number((baseTrades[baseTrades.length - 1] || {}).shares_after) : null;
        trades.push({
            date: valuationDate || (lastBuyDate || ''),
            action: '期末估值（未平仓）',
            price: result.last_price,
            shares_delta: 0,
            cash_after: Number.isFinite(lastShares) ? Number((baseTrades[baseTrades.length - 1] || {}).cash_after) : 0,
            shares_after: Number.isFinite(lastShares) ? lastShares : null,
            note: noteParts.join('；'),
            _is_valuation: true,
        });
        return trades;
    },

    runBacktest: function() {
        const initialCash = Number(this.backtest.initial_cash);
        if (!Number.isFinite(initialCash) || initialCash <= 0) {
            this.backtestResult = { error: '初始资金必须大于 0' };
            this.backtestTrades = [];
            return;
        }
        if (!Array.isArray(this.analysisHistory) || !this.analysisHistory.length) {
            this.backtestResult = { error: '暂无净值数据' };
            this.backtestTrades = [];
            return;
        }

        const historySorted = [...this.analysisHistory]
            .filter(item => item && item.date)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));

        const historyByDate = {};
        historySorted.forEach(item => {
            const nav = this.normalizeNumber(item.unit_nav);
            if (item.date && nav !== null) historyByDate[item.date] = nav;
        });

        const signalsByDate = {};
        (this.analysisSignals || []).forEach(sig => {
            if (!sig || !sig.date) return;
            const dateKey = String(sig.date);
            if (!signalsByDate[dateKey]) signalsByDate[dateKey] = [];
            signalsByDate[dateKey].push(sig);
        });

        let cash = initialCash;
        let shares = 0;
        let costBasis = 0; // 累计买入成本（用于计算持仓均价）
        let avgPrice = null;
        let lastBuyPrice = null;
        let lastBuyDate = '';
        const trades = [];
        let skipped = 0;

        const resolveDcaAmount = () => {
            const dcaItem = (this.stack || []).find(s => s && s.enabled !== false && s.strategy_type === 'dca');
            const amountRaw = dcaItem && dcaItem.params ? Number(dcaItem.params.amount) : NaN;
            return Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 1000;
        };

        const findPriceForDate = (dateKey) => {
            if (historyByDate[dateKey] !== undefined) return historyByDate[dateKey];
            const candidates = signalsByDate[dateKey] || [];
            for (let i = 0; i < candidates.length; i += 1) {
                const v = this.normalizeNumber(candidates[i].value);
                if (v !== null) return v;
            }
            return null;
        };

        const buildSignalNote = (items) => {
            const uniq = [];
            (items || []).forEach(s => {
                const name = (s.strategy_name || '').trim();
                const title = (s.title || '').trim();
                const token = [name, title].filter(Boolean).join('：');
                if (token && !uniq.includes(token)) uniq.push(token);
            });
            return uniq.slice(0, 6).join('；');
        };

        for (let i = 0; i < historySorted.length; i += 1) {
            const dateKey = String(historySorted[i].date || '');
            if (!dateKey) continue;
            const dailySignals = signalsByDate[dateKey] || [];
            if (!dailySignals.length) continue;

            const hasBuy = dailySignals.some(s => s && s.action === 'buy');
            const hasSell = dailySignals.some(s => s && s.action === 'sell');

            // 先处理卖出（同日先卖后买，避免同日反向信号导致状态不一致）
            if (shares > 0 && hasSell) {
                const price = findPriceForDate(dateKey);
                if (price === null || price <= 0) {
                    skipped += 1;
                } else {
                    const soldShares = shares;
                    cash += shares * price;
                    shares = 0;
                    costBasis = 0;
                    avgPrice = null;
                    lastBuyPrice = null;
                    lastBuyDate = '';
                    trades.push({
                        date: dateKey,
                        action: '卖出',
                        price,
                        shares_delta: -soldShares,
                        cash_after: cash,
                        shares_after: shares,
                        note: buildSignalNote(dailySignals.filter(s => s && s.action === 'sell')),
                    });
                }
            }

            // 再处理买入（允许已持仓继续买入：加仓）
            if (cash > 0 && hasBuy) {
                const price = findPriceForDate(dateKey);
                if (price === null || price <= 0) {
                    skipped += 1;
                    continue;
                }

                const buySignals = dailySignals.filter(s => s && s.action === 'buy');
                const hasNonDcaBuy = buySignals.some(s => (s.strategy_type || '') !== 'dca');
                const hasDcaBuy = buySignals.some(s => (s.strategy_type || '') === 'dca');

                let budget = 0;
                // 非 dca：未持仓时默认全仓买入（保持原有语义）；已持仓则不追加（除非未来扩展分批策略）
                if (hasNonDcaBuy && shares <= 0) {
                    budget = cash;
                } else if (hasDcaBuy) {
                    budget = resolveDcaAmount();
                }

                const invest = Math.min(cash, budget);
                if (invest > 0) {
                    const boughtShares = invest / price;
                    shares += boughtShares;
                    cash -= invest;
                    costBasis += invest;
                    avgPrice = shares > 0 ? (costBasis / shares) : null;
                    lastBuyPrice = price;
                    lastBuyDate = dateKey;
                    trades.push({
                        date: dateKey,
                        action: '买入',
                        price,
                        shares_delta: boughtShares,
                        cash_after: cash,
                        shares_after: shares,
                        note: buildSignalNote(buySignals),
                    });
                }
            }
        }

        const lastItem = historySorted[historySorted.length - 1];
        const lastPrice = lastItem ? this.normalizeNumber(lastItem.unit_nav) : null;
        if (lastPrice === null || lastPrice <= 0) {
            this.backtestResult = { error: '无法获取期末净值' };
            this.backtestTrades = trades;
            return;
        }

        // Buy & Hold：期初买入持有到期末（基准对比）
        const firstItem = historySorted.find(item => this.normalizeNumber(item.unit_nav) !== null && this.normalizeNumber(item.unit_nav) > 0) || null;
        const firstPrice = firstItem ? this.normalizeNumber(firstItem.unit_nav) : null;
        const firstDate = firstItem ? String(firstItem.date || '') : '';
        const lastDate = lastItem ? String(lastItem.date || '') : '';
        let buyholdFinalEquity = null;
        let buyholdReturn = null;
        if (firstPrice !== null && firstPrice > 0) {
            const bhShares = initialCash / firstPrice;
            buyholdFinalEquity = bhShares * lastPrice;
            buyholdReturn = buyholdFinalEquity / initialCash - 1;
        }

        const finalEquity = cash + shares * lastPrice;
        const totalReturn = finalEquity / initialCash - 1;
        const buyCount = trades.filter(t => t.action === '买入').length;
        const sellCount = trades.filter(t => t.action === '卖出').length;
        const holding = shares > 0;
        const unrealizedReturn = holding && avgPrice ? (lastPrice / avgPrice - 1) : null;
        const unrealizedPnl = holding && avgPrice ? (shares * (lastPrice - avgPrice)) : null;

        this.backtestTrades = trades;
        this.backtestResult = {
            initial_cash: initialCash,
            final_equity: finalEquity,
            total_return: totalReturn,
            buy_count: buyCount,
            sell_count: sellCount,
            trade_count: trades.length,
            skipped_count: skipped,
            holding,
            last_price: lastPrice,
            last_date: lastDate,
            // 兼容旧字段：entry_* 仍表示“最近一次买入”
            entry_price: lastBuyPrice,
            entry_date: lastBuyDate,
            last_buy_price: lastBuyPrice,
            last_buy_date: lastBuyDate,
            avg_price: avgPrice,
            cost_basis: costBasis,
            unrealized_return: unrealizedReturn,
            unrealized_pnl: unrealizedPnl,
            buyhold_first_date: firstDate,
            buyhold_first_price: firstPrice,
            buyhold_final_equity: buyholdFinalEquity,
            buyhold_return: buyholdReturn,
        };
    },

    renderBacktest: function() {
        const summaryEl = document.getElementById('strategy-backtest-summary');
        const tradesEl = document.getElementById('strategy-backtest-trades');
        const countEl = document.getElementById('strategy-backtest-trade-count');
        const hintEl = document.getElementById('strategy-backtest-hint');
        if (!summaryEl || !tradesEl) return;

        const result = this.backtestResult;
        const baseTrades = Array.isArray(this.backtestTrades) ? this.backtestTrades : [];
        const displayTrades = this.buildTradesForOutput(baseTrades, true);
        const tradeCount = displayTrades.length;
        if (countEl) countEl.textContent = `${tradeCount} 笔`;

        if (!this.analysisHistory.length) {
            summaryEl.textContent = '请先加载净值并运行分析以生成买卖点。';
            tradesEl.innerHTML = '<tr><td colspan="8" class="text-sm text-slate-300">暂无回测记录。</td></tr>';
            if (hintEl) hintEl.textContent = '';
            return;
        }
        if (!this.analysisSignals.length) {
            summaryEl.textContent = '暂无买卖点信号，请先运行分析。';
            tradesEl.innerHTML = '<tr><td colspan="8" class="text-sm text-slate-300">暂无回测记录。</td></tr>';
            if (hintEl) hintEl.textContent = '';
            return;
        }
        if (!result) {
            summaryEl.textContent = '点击“计算回测收益”生成结果。';
            tradesEl.innerHTML = '<tr><td colspan="8" class="text-sm text-slate-300">暂无回测记录。</td></tr>';
            if (hintEl) hintEl.textContent = '';
            return;
        }
        if (result.error) {
            summaryEl.textContent = `回测失败：${result.error}`;
            tradesEl.innerHTML = '<tr><td colspan="8" class="text-sm text-slate-300">暂无回测记录。</td></tr>';
            if (hintEl) hintEl.textContent = '';
            return;
        }

        const holdingHint = result.holding ? '（未平仓：按期末净值估值）' : '';
        const skippedHint = result.skipped_count ? `，跳过 ${result.skipped_count} 次（缺少净值）` : '';
        const buyholdReady = result.buyhold_return !== null && result.buyhold_return !== undefined && result.buyhold_first_price;
        const excess = buyholdReady ? (Number(result.total_return) - Number(result.buyhold_return)) : null;
        const excessClass = this.getUpDownTextClass(excess);
        const buyholdLine = buyholdReady ? `
            <div class="w-full text-xs text-slate-300 mt-1">
                <span class="text-slate-400">买入持有：</span>
                ${this.formatMoney(result.buyhold_first_price, 4)}（${this.escapeHtml(result.buyhold_first_date || '-') }）
                <span class="mx-2 text-slate-600">→</span>
                ${this.formatMoney(result.last_price, 4)}（${this.escapeHtml(result.last_date || '-') }）
                <span class="mx-2 text-slate-600">|</span>
                <span class="text-slate-400">基准收益率：</span><span class="font-bold text-indigo-200">${this.formatPercent(result.buyhold_return, 2)}</span>
                <span class="mx-2 text-slate-600">|</span>
                <span class="text-slate-400">基准期末资产：</span><span class="font-bold text-indigo-200">${this.formatMoney(result.buyhold_final_equity, 2)}</span>
                <span class="mx-2 text-slate-600">|</span>
                <span class="text-slate-400">超额：</span><span class="font-bold ${excessClass}">${excess === null || !Number.isFinite(excess) ? '-' : this.formatPercent(excess, 2)}</span>
            </div>
        ` : '';
        const lastBuyPrice = result.last_buy_price || result.entry_price;
        const lastBuyDate = result.last_buy_date || result.entry_date;
        const holdingExtra = result.holding && lastBuyPrice
            ? `
                <div class="w-full text-xs text-slate-300 mt-1">
                    <span class="text-slate-400">最近一次买入：</span>${this.formatMoney(lastBuyPrice, 4)}（${this.escapeHtml(lastBuyDate || '-') }）
                    ${result.avg_price ? `<span class="mx-2 text-slate-600">|</span><span class="text-slate-400">持仓均价：</span>${this.formatMoney(result.avg_price, 4)}` : ''}
                    <span class="mx-2 text-slate-600">|</span>
                    <span class="text-slate-400">最新净值：</span>${this.formatMoney(result.last_price, 4)}
                    <span class="mx-2 text-slate-600">|</span>
                    <span class="text-slate-400">持仓收益率：</span><span class="font-bold ${this.getUpDownTextClass(result.unrealized_return)}">${this.formatPercent(result.unrealized_return, 2)}</span>
                    <span class="mx-2 text-slate-600">|</span>
                    <span class="text-slate-400">浮动盈亏：</span><span class="font-bold ${this.getUpDownTextClass(result.unrealized_pnl)}">${this.formatMoney(result.unrealized_pnl, 2)}</span>
                </div>
            `
            : '';
        summaryEl.innerHTML = `
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div><span class="text-slate-300">初始资金：</span><span class="font-bold">${this.formatMoney(result.initial_cash, 2)}</span></div>
                <div><span class="text-slate-300">期末资产：</span><span class="font-bold text-cyan-200">${this.formatMoney(result.final_equity, 2)}</span> <span class="text-xs text-slate-300">${holdingHint}</span></div>
                <div><span class="text-slate-300">总收益率：</span><span class="font-bold ${this.getUpDownTextClass(result.total_return)}">${this.formatPercent(result.total_return, 2)}</span></div>
                <div><span class="text-slate-300">交易：</span><span class="font-bold">${result.trade_count}</span> 笔（买 ${result.buy_count} / 卖 ${result.sell_count}）<span class="text-xs text-slate-300">${skippedHint}</span></div>
                ${buyholdLine}
                ${holdingExtra}
            </div>
        `;

        if (!tradeCount) {
            tradesEl.innerHTML = '<tr><td colspan="8" class="text-sm text-slate-300">当前区间没有触发交易。</td></tr>';
        } else {
            tradesEl.innerHTML = displayTrades.map(t => {
                const deltaText = t.shares_delta >= 0 ? ('+' + this.formatMoney(t.shares_delta, 4)) : this.formatMoney(t.shares_delta, 4);
                const note = this.escapeHtml(t.note || '-');
                const isValuation = !!t._is_valuation;
                const actionClass = this.getTradeActionTextClass(t.action, isValuation);
                const priceNum = Number(t && t.price !== undefined && t.price !== null ? t.price : NaN);
                const sharesNum = Number(t && t.shares_after !== undefined && t.shares_after !== null ? t.shares_after : NaN);
                const holdingValue = Number.isFinite(priceNum) && Number.isFinite(sharesNum) ? (priceNum * sharesNum) : null;
                return `
                    <tr class="${isValuation ? 'bg-slate-900/30' : ''}">
                        <td>${this.escapeHtml(t.date)}</td>
                        <td class="${actionClass} font-bold">${this.escapeHtml(t.action)}</td>
                        <td>${this.formatMoney(t.price, 4)}</td>
                        <td>${deltaText}</td>
                        <td>${this.formatMoney(t.cash_after, 2)}</td>
                        <td>${this.formatMoney(t.shares_after, 4)}</td>
                        <td>${holdingValue === null ? '-' : this.formatMoney(holdingValue, 2)}</td>
                        <td class="text-xs text-slate-300">${note}</td>
                    </tr>
                `;
            }).join('');
        }

        if (hintEl) {
            hintEl.textContent = '规则：空仓/全仓；同日多信号合并为一次交易；不计手续费与滑点。';
        }
    },

    loadHistoryOnly: async function() {
        const fund = this.ensureSelectedFund();
        if (!fund || !Validator.fundCode(fund.fund_code)) {
            showToast('请先选择基金', 'warning');
            return;
        }
        if (this.isHistoryLoading || this.isAnalysisLoading) return;
        this.isHistoryLoading = true;
        this.analysisResults = [];
        this.analysisSignals = [];
        this.backtestResult = null;
        this.backtestTrades = [];
        this.renderSignals();
        this.renderBacktest();
        this.renderActionStates();
        try {
            const params = new URLSearchParams();
            if (this.dateRange.full_history) {
                params.set('full_history', 'true');
            } else {
                params.set('start_date', this.dateRange.start_date || '');
                params.set('end_date', this.dateRange.end_date || '');
            }
            const res = await fetch(`/api/funds/${encodeURIComponent(fund.fund_code)}/history?${params.toString()}`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            this.analysisHistory = Array.isArray(data.items) ? data.items : [];
            this.renderChart();
            this.renderSignals();
            this.renderBacktest();
            showToast(`已加载 ${this.analysisHistory.length} 条净值数据`, 'success');
        } catch (e) {
            showToast('加载净值失败: ' + (e.message || e), 'error');
        } finally {
            this.isHistoryLoading = false;
            this.renderSignals();
            this.renderBacktest();
            this.renderActionStates();
        }
    },

    runAnalysis: async function() {
        await this.runUnified(true, '分析与回测已更新');
    },

    renderSignals: function() {
        const container = document.getElementById('strategy-detail-signals');
        if (!container) return;
        if (this.isAnalysisLoading) {
            container.innerHTML = '';
            return;
        }
        if (!this.analysisSignals.length) {
            container.innerHTML = '<div class="text-sm text-slate-300 col-span-full">暂无分析结果。</div>';
            return;
        }
        const sorted = [...this.analysisSignals].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        container.innerHTML = sorted.map(signal => {
            // 红=买入/上涨，绿=卖出/下跌
            const badgeClass = signal.action === 'buy' ? 'badge-error' : (signal.action === 'sell' ? 'badge-success' : 'badge-info');
            const actionText = signal.action === 'buy' ? '买入' : (signal.action === 'sell' ? '卖出' : '观察');
            const valueText = signal.value !== null && signal.value !== undefined ? Number(signal.value).toFixed(4) : '-';
            const rawReason = String(signal.reason || '').trim();
            const reasonText = rawReason && rawReason.includes('MA') && (rawReason.includes('上穿') || rawReason.includes('下穿'))
                ? ''
                : rawReason;
            const strategyText = signal.strategy_name ? String(signal.strategy_name) : '-';
            return `
                <div class="rounded-2xl border border-white/10 bg-black/15 p-3 strategy-signal-card">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div class="font-bold">${signal.title || '信号'}</div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="badge ${badgeClass}">${actionText}</span>
                            <span class="text-xs text-slate-300">${signal.date || '-'}</span>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 mb-2">
                        <span>${this.escapeHtml(strategyText)}</span>
                        <span class="text-slate-600">|</span>
                        <span class="text-cyan-200">净值 ${valueText}</span>
                    </div>
                    ${reasonText ? `<div class="text-sm leading-6 text-slate-100">${this.escapeHtml(reasonText)}</div>` : ''}
                </div>
            `;
        }).join('');
    },

    getOpenCloseDatasetStyle: function() {
        return {
            label: '净值开收',
            borderColor: 'rgba(148, 163, 184, 0.9)',
            backgroundColor: 'rgba(148, 163, 184, 0.2)',
            borderWidth: 0,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 16,
            tension: 0,
            fill: false,
            yAxisID: 'y',
            order: 1,
            hiddenLine: true,
        };
    },

    simplifyLegendLabel: function(label, fallback) {
        const text = String(label || '').trim();
        if (!text) return fallback || '';
        const shortText = text.includes(' · ') ? text.split(' · ').pop().trim() : text;
        return shortText || fallback || text;
    },

    buildOpenCloseSeries: function() {
        return this.analysisHistory.map((item, index) => {
            const currentNav = this.normalizeNumber(item.unit_nav);
            const previous = index > 0 ? this.analysisHistory[index - 1] : null;
            const previousNav = previous ? this.normalizeNumber(previous.unit_nav) : currentNav;
            const open = previousNav !== null ? previousNav : currentNav;
            const close = currentNav;
            return {
                x: item.date,
                y: close,
                open,
                close,
                unit_nav: currentNav,
                daily_return: this.normalizeNumber(item.daily_return),
            };
        }).filter(item => item.y !== null && item.open !== null && item.close !== null);
    },

    normalizeNumber: function(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    },

    formatChartNumber: function(value, digits = 4) {
        const num = this.normalizeNumber(value);
        return num === null ? '-' : num.toFixed(digits);
    },

    getOverlayPalette: function() {
        return ['#a78bfa', '#f59e0b', '#2dd4bf', '#f472b6', '#818cf8', '#fb7185'];
    },

    getOverlayColor: function(index, overlayColor) {
        const navColor = '#38bdf8';
        const palette = this.getOverlayPalette();
        if (overlayColor && overlayColor.toLowerCase() !== navColor.toLowerCase()) return overlayColor;
        return palette[index % palette.length];
    },

    buildOverlayDataset: function(labels, overlay, result, overlayIndex) {
        const aligned = this.alignSeries(labels, overlay.series || []);
        const color = this.getOverlayColor(overlayIndex, overlay.color);
        const isSecondary = overlay.y_axis === 'secondary';
        const baseLabel = overlay.label || result.strategy_name;
        return {
            label: this.simplifyLegendLabel(baseLabel, isSecondary ? '副轴指标' : '均线'),
            fullLabel: baseLabel,
            data: aligned,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: isSecondary ? 1.6 : 2.2,
            pointRadius: 0,
            pointHoverRadius: 2,
            pointHitRadius: 8,
            tension: 0.12,
            borderDash: overlay.line_style === 'dashed' ? [10, 6] : [],
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            hoverBorderWidth: isSecondary ? 2 : 2.4,
            yAxisID: isSecondary ? 'y1' : 'y',
            order: 2,
        };
    },

    computeOpenCloseBarWidth: function(elements, maxWidth = 18, widthRatio = 0.58) {
        if (!elements || !elements.length) return 10;
        if (elements.length === 1) return Math.min(maxWidth, 14);
        let minGap = Infinity;
        for (let i = 1; i < elements.length; i += 1) {
            const gap = Math.abs(elements[i].x - elements[i - 1].x);
            if (gap > 0) minGap = Math.min(minGap, gap);
        }
        if (!Number.isFinite(minGap)) return Math.min(maxWidth, 14);
        return Math.max(4, Math.min(maxWidth, minGap * widthRatio));
    },

    resetChartZoom: function() {
        if (this.analysisChart && typeof this.analysisChart.resetZoom === 'function') {
            this.analysisChart.resetZoom();
        }
    },

    renderChart: function() {
        const canvas = document.getElementById('strategy-detail-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (this.analysisChart) {
            this.analysisChart.destroy();
            this.analysisChart = null;
        }
        if (!this.analysisHistory.length) {
            this.analysisChart = new Chart(ctx, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } }
                }
            });
            return;
        }
        const labels = this.analysisHistory.map(item => item.date);
        const navStyle = this.getOpenCloseDatasetStyle();
        const openCloseSeries = this.buildOpenCloseSeries();
        const datasets = [{
            label: navStyle.label,
            data: openCloseSeries,
            borderColor: navStyle.borderColor,
            backgroundColor: navStyle.backgroundColor,
            borderWidth: navStyle.borderWidth,
            pointRadius: navStyle.pointRadius,
            pointHoverRadius: navStyle.pointHoverRadius,
            pointHitRadius: navStyle.pointHitRadius,
            tension: navStyle.tension,
            fill: navStyle.fill,
            yAxisID: navStyle.yAxisID,
            order: navStyle.order,
            openCloseDataset: true,
            showLine: !navStyle.hiddenLine,
            parsing: { xAxisKey: 'x', yAxisKey: 'y' },
            pointBackgroundColor: 'transparent',
            pointBorderColor: 'transparent',
        }];
        let overlayIndex = 0;
        this.analysisResults.forEach(result => {
            if (!result.display_enabled) return;
            (result.overlays || []).forEach(overlay => {
                if (overlay.kind !== 'line') return;
                datasets.push(this.buildOverlayDataset(labels, overlay, result, overlayIndex));
                overlayIndex += 1;
            });
            const buySignals = (result.signals || []).filter(item => item.action === 'buy');
            const sellSignals = (result.signals || []).filter(item => item.action === 'sell');
            if (buySignals.length) datasets.push(this.buildSignalDataset(labels, buySignals, `${result.strategy_name} · 买点`, '#ef4444', 'triangle', '买点', 'buy'));
            if (sellSignals.length) datasets.push(this.buildSignalDataset(labels, sellSignals, `${result.strategy_name} · 卖点`, '#22c55e', 'rectRot', '卖点', 'sell'));
        });
        this.analysisChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    strategyDetailOpenClose: {
                        datasetIndex: 0,
                        upColor: '#ef4444',
                        downColor: '#22c55e',
                        neutralColor: '#94a3b8',
                        maxBarWidth: 14,
                        widthRatio: 0.46,
                        minBodyHeight: 2,
                    },
                    legend: {
                        labels: {
                            color: '#e2e8f0',
                            boxWidth: 14,
                            boxHeight: 8,
                            padding: 10,
                            font: { size: 11 },
                            usePointStyle: true,
                        }
                    },
                    tooltip: {
                        titleFont: { size: 13 },
                        bodyFont: { size: 13 },
                        padding: 12,
                        callbacks: {
                            title: function(items) {
                                return items && items.length ? (items[0].label || '') : '';
                            },
                            label: context => {
                                const raw = context.raw;
                                if (context.dataset && context.dataset.openCloseDataset) {
                                    const open = this.formatChartNumber(raw && raw.open);
                                    const close = this.formatChartNumber(raw && raw.close);
                                    const openValue = raw ? this.normalizeNumber(raw.open) : null;
                                    const closeValue = raw ? this.normalizeNumber(raw.close) : null;
                                    const changeValue = openValue === null || closeValue === null ? null : (closeValue - openValue);
                                    const changeText = changeValue === null ? '-' : (changeValue >= 0 ? '+' : '') + changeValue.toFixed(4);
                                    const lines = [
                                        `净值开收：${open} → ${close}`,
                                        `变动值：${changeText}`,
                                    ];
                                    const dailyReturn = raw ? this.normalizeNumber(raw.daily_return) : null;
                                    if (dailyReturn !== null) {
                                        const sign = dailyReturn >= 0 ? '+' : '';
                                        lines.push(`日涨跌幅：${sign}${dailyReturn.toFixed(2)}%`);
                                    }
                                    return lines;
                                }
                                if (raw === null || raw === undefined) return null;
                                const signalType = context.dataset.signalType;
                                const tooltipLabel = context.dataset.fullLabel || context.dataset.label;
                                if (signalType) return `${signalType} · ${tooltipLabel}: ${Number(raw).toFixed(4)}`;
                                return `${tooltipLabel}: ${Number(raw).toFixed(4)}`;
                            }
                        }
                    },
                    zoom: {
                        limits: {
                            x: { min: 'original', max: 'original', minRange: 8 },
                            y: { min: 'original', max: 'original' },
                            y1: { min: 'original', max: 'original' },
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                            threshold: 6,
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                speed: 0.08,
                            },
                            pinch: {
                                enabled: true,
                            },
                            drag: {
                                enabled: false,
                            },
                            mode: 'x',
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#cbd5e1', maxTicksLimit: 10, font: { size: 12 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { position: 'left', ticks: { color: '#cbd5e1', font: { size: 12 }, callback: value => Number(value).toFixed(3) }, grid: { color: 'rgba(255,255,255,0.08)' } },
                    y1: { position: 'right', min: 0, max: 100, ticks: { color: '#c4b5fd', font: { size: 12 } }, grid: { drawOnChartArea: false } },
                }
            }
        });
    },

    alignSeries: function(labels, series) {
        const map = {};
        (series || []).forEach(item => { if (item && item.date) map[item.date] = item.value; });
        return labels.map(label => Object.prototype.hasOwnProperty.call(map, label) ? map[label] : null);
    },

    getPrimaryValueRange: function() {
        const values = this.analysisHistory.map(item => this.normalizeNumber(item.unit_nav)).filter(value => value !== null);
        if (!values.length) return { min: 0, max: 1, span: 1 };
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(max - min, max * 0.02, 0.01);
        return { min, max, span };
    },

    buildSignalValueMap: function(signals, direction) {
        const dayRangeByDate = {};
        try {
            const oc = this.buildOpenCloseSeries();
            (oc || []).forEach(item => {
                if (!item || !item.x) return;
                const open = this.normalizeNumber(item.open);
                const close = this.normalizeNumber(item.close);
                if (open === null || close === null) return;
                dayRangeByDate[String(item.x)] = { low: Math.min(open, close), high: Math.max(open, close) };
            });
        } catch (e) {
            // ignore, fallback to signal.value
        }
        const range = this.getPrimaryValueRange();
        const offset = Math.max(range.span * 0.065, 0.012);
        const valueMap = {};
        (signals || []).forEach(item => {
            if (!item || !item.date) return;
            const dateKey = String(item.date);
            const dayRange = dayRangeByDate[dateKey];
            let adjusted = null;
            if (dayRange && Number.isFinite(dayRange.low) && Number.isFinite(dayRange.high)) {
                adjusted = direction === 'buy' ? (dayRange.low - offset) : (dayRange.high + offset);
            } else {
                const signalValue = this.normalizeNumber(item.value);
                if (signalValue === null) return;
                adjusted = direction === 'buy' ? (signalValue - offset) : (signalValue + offset);
            }
            valueMap[item.date] = adjusted;
        });
        return valueMap;
    },

    buildSignalDataset: function(labels, signals, label, color, pointStyle, signalType, direction) {
        const values = labels.map(() => null);
        const signalMap = this.buildSignalValueMap(signals, direction);
        labels.forEach((date, index) => {
            if (Object.prototype.hasOwnProperty.call(signalMap, date)) values[index] = signalMap[date];
        });
        return {
            label: this.simplifyLegendLabel(label, signalType),
            fullLabel: label,
            data: values,
            borderColor: color,
            backgroundColor: color,
            pointBorderColor: 'rgba(255,255,255,0.55)',
            pointBorderWidth: 1.2,
            showLine: false,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointHitRadius: 14,
            pointStyle,
            signalType,
            yAxisID: 'y',
            order: 0,
        };
    },
};

document.addEventListener('DOMContentLoaded', function() {
    StrategyDetailPage.init();
});
