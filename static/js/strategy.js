const StrategyListPage = {
    strategies: [],
    _loaded: false,
    _loading: false,

    init: function() {
        this.bindEvents();
        this.initLazyLoad();
        this.renderList();
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
            await this.loadStrategies();
            this._loaded = true;
        } catch (e) {
            showToast('加载策略列表失败: ' + (e.message || e), 'error');
        } finally {
            this._loading = false;
        }
    },

    loadStrategies: async function() {
        const res = await fetch('/api/strategies');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.strategies = Array.isArray(data) ? data : [];
        this.renderList();
    },

    renderList: function() {
        const listEl = document.getElementById('strategy-list');
        const summaryEl = document.getElementById('strategy-list-summary');
        if (!listEl || !summaryEl) return;

        summaryEl.textContent = `${this.strategies.length} 条`;
        if (!this.strategies.length) {
            listEl.innerHTML = `
                <div class="lg:col-span-2 rounded-2xl border border-white/10 bg-black/15 p-6 text-sm text-slate-300">
                    暂无策略，点击右上角“新建策略”开始创建。
                </div>
            `;
            return;
        }

        listEl.innerHTML = this.strategies.map(item => {
            const updatedAt = item.updated_at ? item.updated_at.replace('T', ' ').slice(0, 16) : '未更新';
            return `
                <button type="button" class="card neon-border text-left hover:bg-white/5 transition" onclick="StrategyListPage.openDetail('${item.strategy_id}')">
                    <div class="card-body p-4">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <h4 class="font-bold text-base">${item.name || '未命名策略'}</h4>
                                <p class="text-xs text-slate-300 mt-1">${item.strategy_count || 0} 个内置策略</p>
                            </div>
                            <span class="badge badge-outline">详情</span>
                        </div>
                        <div class="text-xs text-slate-400 mt-2">更新时间：${updatedAt}</div>
                    </div>
                </button>
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
