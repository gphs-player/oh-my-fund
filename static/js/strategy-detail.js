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
    analysisChart: null,
    fundSuggestionLimit: 12,
    isHistoryLoading: false,
    isAnalysisLoading: false,
    dateRange: { preset: '6m', start_date: '', end_date: '', full_history: false },

    init: async function() {
        this.initFromBootstrap();
        this.bindEvents();
        this.applyDateRange(this.dateRange, true);
        this.renderStack();
        this.renderSignals();
        this.renderSummary();
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
            showToast('初始化策略详情失败: ' + (e.message || e), 'error');
        }
    },

    bindEvents: function() {
        const saveBtn = document.getElementById('strategy-detail-save-btn');
        const deleteBtn = document.getElementById('strategy-detail-delete-btn');
        const runBtn = document.getElementById('strategy-detail-run-btn');
        const loadHistoryBtn = document.getElementById('strategy-detail-load-history-btn');
        const addBtn = document.getElementById('strategy-detail-add-btn');
        const fundInput = document.getElementById('strategy-detail-fund-keyword');
        const startInput = document.getElementById('strategy-detail-start-date');
        const endInput = document.getElementById('strategy-detail-end-date');

        if (saveBtn) saveBtn.addEventListener('click', () => void this.handleSave());
        if (deleteBtn) deleteBtn.addEventListener('click', () => void this.handleDelete());
        if (runBtn) runBtn.addEventListener('click', () => void this.runAnalysis());
        if (loadHistoryBtn) loadHistoryBtn.addEventListener('click', () => void this.loadHistoryOnly());
        if (addBtn) addBtn.addEventListener('click', () => this.handleAddStrategy());

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
            showToast('请选择内置策略', 'warning');
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
            container.innerHTML = '<div class="text-sm text-slate-300">暂无策略，请先添加。</div>';
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
            showToast('请输入策略名称', 'warning');
            return null;
        }
        if (!this.stack.length) {
            showToast('请至少添加一个策略', 'warning');
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
            showToast('策略已保存', 'success');
        } catch (e) {
            showToast('保存失败: ' + (e.message || e), 'error');
        }
    },

    handleDelete: async function() {
        if (!this.currentStrategyId) {
            showToast('当前还没有已保存的策略', 'warning');
            return;
        }
        if (!window.confirm('确定要删除当前策略吗？删除后不可恢复。')) return;
        try {
            const res = await fetch(`/api/strategies/${encodeURIComponent(this.currentStrategyId)}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${res.status}`);
            window.location.href = '/#strategy';
        } catch (e) {
            showToast('删除失败: ' + (e.message || e), 'error');
        }
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
                chartLoadingText.textContent = this.isAnalysisLoading ? '正在运行策略分析...' : '正在加载净值走势...';
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
        this.renderSignals();
        this.renderSummary();
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
            this.renderSummary();
            showToast(`已加载 ${this.analysisHistory.length} 条净值数据`, 'success');
        } catch (e) {
            showToast('加载净值失败: ' + (e.message || e), 'error');
        } finally {
            this.isHistoryLoading = false;
            this.renderSummary();
            this.renderSignals();
            this.renderActionStates();
        }
    },

    runAnalysis: async function() {
        const fund = this.ensureSelectedFund();
        if (!fund || !Validator.fundCode(fund.fund_code)) {
            showToast('请先选择基金', 'warning');
            return;
        }
        if (!this.stack.length || this.stack.filter(item => item.enabled).length === 0) {
            showToast('请至少启用一个策略', 'warning');
            return;
        }
        if (this.isHistoryLoading || this.isAnalysisLoading) return;
        this.isAnalysisLoading = true;
        this.analysisSignals = [];
        this.renderSignals();
        this.renderSummary();
        this.renderActionStates();
        try {
            const res = await fetch('/api/strategy-analysis/run', {
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
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
            this.analysisHistory = Array.isArray(data.history) ? data.history : [];
            this.analysisResults = Array.isArray(data.results) ? data.results : [];
            this.analysisSignals = Array.isArray(data.signals) ? data.signals : [];
            this.renderStack();
            this.renderChart();
            this.renderSignals();
            this.renderSummary(data.summary || {});
            showToast('策略分析完成', 'success');
        } catch (e) {
            showToast('策略分析失败: ' + (e.message || e), 'error');
        } finally {
            this.isAnalysisLoading = false;
            this.renderSummary();
            this.renderSignals();
            this.renderActionStates();
        }
    },

    renderSummary: function(summary) {
        const summaryEl = document.getElementById('strategy-detail-summary');
        const countEl = document.getElementById('strategy-detail-signal-count');
        if (!summaryEl || !countEl) return;
        if (this.isAnalysisLoading) {
            summaryEl.textContent = '正在运行策略并生成信号...';
            countEl.textContent = '生成中';
            return;
        }
        if (this.isHistoryLoading) {
            summaryEl.textContent = '正在加载基金历史净值...';
            return;
        }
        if (!this.analysisHistory.length) {
            summaryEl.textContent = '请选择基金并运行分析';
            countEl.textContent = '0 个';
            return;
        }
        const strategyCount = summary && summary.strategy_count !== undefined ? summary.strategy_count : this.analysisResults.length;
        const signalCount = summary && summary.signal_count !== undefined ? summary.signal_count : this.analysisSignals.length;
        summaryEl.textContent = `净值点数 ${this.analysisHistory.length} · 启用策略 ${strategyCount} 个`;
        countEl.textContent = `${signalCount} 个`;
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
            const badgeClass = signal.action === 'buy' ? 'badge-success' : (signal.action === 'sell' ? 'badge-error' : 'badge-info');
            const actionText = signal.action === 'buy' ? '买入' : (signal.action === 'sell' ? '卖出' : '观察');
            const valueText = signal.value !== null && signal.value !== undefined ? Number(signal.value).toFixed(4) : '-';
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
                        <span>策略：${signal.strategy_name || '-'}</span>
                        <span class="text-cyan-200">触发净值：${valueText}</span>
                    </div>
                    <div class="text-sm leading-6 text-slate-100">${signal.reason || '-'}</div>
                </div>
            `;
        }).join('');
    },

    getNavDatasetStyle: function() {
        return {
            label: '基金净值',
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.18)',
            borderWidth: 4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 14,
            tension: 0.22,
            fill: true,
            yAxisID: 'y',
            order: 1,
        };
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
        return {
            label: overlay.label || result.strategy_name,
            data: aligned,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: isSecondary ? 2 : 2.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10,
            tension: 0.18,
            borderDash: overlay.line_style === 'dashed' ? [10, 6] : [],
            borderCapStyle: 'round',
            borderJoinStyle: 'round',
            yAxisID: isSecondary ? 'y1' : 'y',
            order: 2,
        };
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
        const navStyle = this.getNavDatasetStyle();
        const datasets = [{
            label: navStyle.label,
            data: this.analysisHistory.map(item => item.unit_nav),
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
            if (buySignals.length) datasets.push(this.buildSignalDataset(labels, buySignals, `${result.strategy_name} · 买点`, '#22c55e', 'triangle', '买点'));
            if (sellSignals.length) datasets.push(this.buildSignalDataset(labels, sellSignals, `${result.strategy_name} · 卖点`, '#ef4444', 'rectRot', '卖点'));
        });
        this.analysisChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: '#e2e8f0',
                            boxWidth: 22,
                            boxHeight: 12,
                            padding: 16,
                            font: { size: 13 },
                            usePointStyle: true,
                        }
                    },
                    tooltip: {
                        titleFont: { size: 13 },
                        bodyFont: { size: 13 },
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                if (context.raw === null || context.raw === undefined) return null;
                                const signalType = context.dataset.signalType;
                                if (signalType) return `${signalType} · ${context.dataset.label}: ${Number(context.raw).toFixed(4)}`;
                                return `${context.dataset.label}: ${Number(context.raw).toFixed(4)}`;
                            }
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

    buildSignalDataset: function(labels, signals, label, color, pointStyle, signalType) {
        const values = labels.map(() => null);
        const signalMap = {};
        signals.forEach(item => { if (item && item.date) signalMap[item.date] = item.value; });
        labels.forEach((date, index) => {
            if (Object.prototype.hasOwnProperty.call(signalMap, date)) values[index] = signalMap[date];
        });
        return {
            label,
            data: values,
            borderColor: color,
            backgroundColor: color,
            pointBorderColor: '#f8fafc',
            pointBorderWidth: 2,
            showLine: false,
            pointRadius: 9,
            pointHoverRadius: 11,
            pointHitRadius: 16,
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
