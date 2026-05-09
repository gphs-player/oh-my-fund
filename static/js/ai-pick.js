// AI 选基（第 1 步：解析提示词为 draft）
const AiFundPick = {
    _busy: false,

    init: async function () {
        this.bind();
        await this.checkConfig();
    },

    bind: function () {
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');
        const resetBtn = document.getElementById('ai-fund-pick-reset-btn');

        if (genBtn) {
            genBtn.addEventListener('click', async () => {
                await this.generateDraft();
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.reset();
            });
        }

        // 当切换到 AI 选基 Tab 时刷新配置状态
        document.querySelectorAll('[data-tab="ai-pick"]').forEach(t => {
            t.addEventListener('click', () => {
                this.checkConfig();
            });
        });
    },

    async checkConfig() {
        const statusEl = document.getElementById('ai-fund-pick-config-status');
        if (!statusEl) return;
        try {
            const resp = await fetch('/api/settings');
            const settings = await resp.json();
            const provider = settings && settings.llm_provider;
            const apiKey = settings && settings.llm_api_key;
            if (!provider || !apiKey) {
                statusEl.innerHTML = '<span class="text-warning">⚠ 请先在「设置」页配置 AI 模型</span>';
                return;
            }
            statusEl.innerHTML = '<span class="text-success">● AI 模型已配置</span>';
        } catch (e) {
            statusEl.innerHTML = '<span class="text-error">配置加载失败</span>';
        }
    },

    reset: function () {
        const promptEl = document.getElementById('ai-fund-pick-prompt');
        if (promptEl) promptEl.value = '';

        const planEl = document.getElementById('ai-fund-pick-plan-json');
        if (planEl) planEl.textContent = '（尚未生成）';

        const errEl = document.getElementById('ai-fund-pick-error');
        if (errEl) errEl.classList.add('hidden');
    },

    async generateDraft() {
        if (this._busy) return;
        const promptEl = document.getElementById('ai-fund-pick-prompt');
        const planEl = document.getElementById('ai-fund-pick-plan-json');
        const errEl = document.getElementById('ai-fund-pick-error');
        const errTextEl = document.getElementById('ai-fund-pick-error-text');
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');

        const prompt = String((promptEl && promptEl.value) || '').trim();
        if (!prompt) {
            if (errTextEl) errTextEl.textContent = '请输入筛选提示词';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        this._busy = true;
        if (errEl) errEl.classList.add('hidden');
        if (genBtn) genBtn.disabled = true;
        if (planEl) planEl.textContent = '生成中...';

        try {
            const resp = await fetch('/api/ai-fund-pick/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            const data = await resp.json();
            if (!data || !data.success) {
                const msg = (data && (data.message || data.error)) || '生成失败';
                if (errTextEl) errTextEl.textContent = String(msg);
                if (errEl) errEl.classList.remove('hidden');
                if (planEl) planEl.textContent = '（生成失败）';
                return;
            }
            const draft = data.draft || {};
            if (planEl) planEl.textContent = JSON.stringify(draft, null, 2);
        } catch (e) {
            if (errTextEl) errTextEl.textContent = '网络错误或服务异常';
            if (errEl) errEl.classList.remove('hidden');
            if (planEl) planEl.textContent = '（生成失败）';
        } finally {
            this._busy = false;
            if (genBtn) genBtn.disabled = false;
        }
    },
};

document.addEventListener('DOMContentLoaded', function () {
    AiFundPick.init();
});

