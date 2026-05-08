const StrategyListPage = {
    compositeStrategies: [],
    singleStrategyTypes: [],
    _loaded: false,
    _loading: false,

    init: function() {
        this.bindEvents();
        this.initLazyLoad();
        this.renderCompositeList();
        this.renderSingleStrategyLibrary();
        if (window.location.hash === '#strategy') {
            void this.loadIfNeeded();
        }
    },

    bindEvents: function() {
        const newBtn = document.getElementById('strategy-new-btn');
        if (newBtn) {
            newBtn.addEventListener('click', function() {
                window.location.href = '/strategies/new';
            });
        }
    },

    initLazyLoad: function() {
        const tab = document.querySelector('[data-tab="strategy"]');
        if (!tab) return;
        tab.addEventListener('click', () => {
            void this.loadIfNeeded();
        });
    },

    loadIfNeeded: async function() {
        if (this._loaded || this._loading) return;
        this._loading = true;
        try {
            await Promise.all([this.loadCompositeStrategies(), this.loadSingleStrategyTypes()]);
            this._loaded = true;
        } catch (e) {
            showToast('加载策略中心失败: ' + (e.message || e), 'error');
        } finally {
            this._loading = false;
        }
    },

    loadCompositeStrategies: async function() {
        const res = await fetch('/api/strategies');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.compositeStrategies = Array.isArray(data) ? data : [];
        this.renderCompositeList();
    },

    loadSingleStrategyTypes: async function() {
        const res = await fetch('/api/strategy-types');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.singleStrategyTypes = Array.isArray(data) ? data : [];
        this.renderSingleStrategyLibrary();
    },

    renderCompositeList: function() {
        const listEl = document.getElementById('strategy-list');
        const summaryEl = document.getElementById('strategy-list-summary');
        if (!listEl || !summaryEl) return;

        summaryEl.textContent = `${this.compositeStrategies.length} 条`;
        if (!this.compositeStrategies.length) {
            listEl.innerHTML = `
                <div class="rounded-2xl border border-white/10 bg-black/15 p-6 text-sm text-slate-300">
                    暂无组合策略，点击右上角“新建组合策略”开始创建。
                </div>
            `;
            return;
        }

        listEl.innerHTML = this.compositeStrategies.map(item => {
            const updatedAt = item.updated_at ? item.updated_at.replace('T', ' ').slice(0, 16) : '未更新';
            const fundText = item.fund_code ? `${item.fund_code}${item.fund_name ? ' · ' + item.fund_name : ''}` : '未绑定基金';
            return `
                <button type="button" class="card neon-border text-left hover:bg-white/5 transition" onclick="StrategyListPage.openDetail('${item.strategy_id}')">
                    <div class="card-body p-4 min-h-0">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <h4 class="font-bold text-base">${item.name || '未命名组合策略'}</h4>
                                    <span class="badge badge-outline badge-sm">组合策略</span>
                                </div>
                                <p class="text-xs text-slate-300 mt-1">包含 ${item.strategy_count || 0} 个单一策略</p>
                                <p class="text-xs text-slate-400 mt-2">${fundText}</p>
                            </div>
                            <span class="badge badge-outline">详情</span>
                        </div>
                        <div class="text-xs text-slate-400 mt-3">更新时间：${updatedAt}</div>
                    </div>
                </button>
            `;
        }).join('');
    },

    renderSingleStrategyLibrary: function() {
        const listEl = document.getElementById('single-strategy-list');
        const summaryEl = document.getElementById('single-strategy-summary');
        if (!listEl || !summaryEl) return;

        summaryEl.textContent = `${this.singleStrategyTypes.length} 个`;
        if (!this.singleStrategyTypes.length) {
            listEl.innerHTML = '<div class="rounded-2xl border border-white/10 bg-black/15 p-6 text-sm text-slate-300">暂无单一策略定义。</div>';
            return;
        }

        listEl.innerHTML = this.singleStrategyTypes.map(item => {
            const summary = Array.isArray(item.param_schema) ? `参数${item.param_schema.length}项` : '参数待配置';
            return `
                <div class="rounded-2xl border border-white/10 bg-black/15 p-4 hover:bg-white/5 transition">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <div class="flex flex-wrap items-center">
                                <h4 class="font-bold text-base">${item.name || item.type || '未命名单一策略'}</h4>
                            </div>
                            <p class="text-xs text-slate-300 mt-1">${item.description || '系统内置的策略模块，可组合使用。'}</p>
                        </div>
                        <span class="badge badge-outline whitespace-nowrap shrink-0">${summary}</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    openDetail: function(strategyId) {
        if (!strategyId) return;
        window.location.href = `/strategies/${encodeURIComponent(strategyId)}`;
    },
};

document.addEventListener('DOMContentLoaded', function() {
    StrategyListPage.init();
});
