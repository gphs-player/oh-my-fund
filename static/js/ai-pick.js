// AI 选基（第 1 步：解析提示词为 draft）
const AiFundPick = {
    _busy: false,
    _lastPrompt: '',
    _lastDraftPreview: null,
    _lastQuestions: null,
    _answers: {},

    init: async function () {
        this.bind();
        await this.checkConfig();
    },

    bind: function () {
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');
        const resetBtn = document.getElementById('ai-fund-pick-reset-btn');
        const clarifyConfirmBtn = document.getElementById('ai-fund-pick-clarify-confirm-btn');

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
        if (clarifyConfirmBtn) {
            clarifyConfirmBtn.addEventListener('click', async () => {
                await this.confirmClarify();
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

        const clarifyEl = document.getElementById('ai-fund-pick-clarify');
        if (clarifyEl) clarifyEl.classList.add('hidden');

        this._lastPrompt = '';
        this._lastDraftPreview = null;
        this._lastQuestions = null;
        this._answers = {};
    },

    _renderClarifyQuestions: function (questions) {
        const clarifyEl = document.getElementById('ai-fund-pick-clarify');
        const listEl = document.getElementById('ai-fund-pick-clarify-questions');
        const confirmBtn = document.getElementById('ai-fund-pick-clarify-confirm-btn');
        if (!clarifyEl || !listEl || !confirmBtn) return;

        this._answers = {};
        this._lastQuestions = Array.isArray(questions) ? questions : [];

        const hasAny = this._lastQuestions.length > 0;
        clarifyEl.classList.toggle('hidden', !hasAny);
        listEl.innerHTML = '';

        if (!hasAny) {
            confirmBtn.disabled = true;
            return;
        }

        // 对每个 question 渲染：title + options buttons
        this._lastQuestions.forEach(q => {
            const qid = String(q.question_id || '');
            const title = String(q.title || '');
            const opts = Array.isArray(q.options) ? q.options : [];

            const wrap = document.createElement('div');
            wrap.className = 'space-y-2';

            const titleEl = document.createElement('div');
            titleEl.className = 'text-sm text-slate-200';
            titleEl.textContent = title || '请补充信息';
            wrap.appendChild(titleEl);

            const btnRow = document.createElement('div');
            btnRow.className = 'flex flex-wrap gap-2';

            if (opts.length) {
                opts.forEach(opt => {
                    const v = opt.value;
                    const label = String(opt.label || v);
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-xs btn-outline';
                    btn.textContent = label;
                    btn.addEventListener('click', () => {
                        // 单选：记录答案
                        this._answers[qid] = v;
                        // UI 高亮
                        Array.from(btnRow.querySelectorAll('button')).forEach(b => {
                            b.classList.toggle('btn-active', b === btn);
                        });
                        this._syncClarifyConfirmEnabled();
                    });
                    btnRow.appendChild(btn);
                });
            } else {
                const hint = document.createElement('div');
                hint.className = 'text-xs text-slate-400';
                hint.textContent = '该项需要在提示词里提供明确阈值（当前页面暂不支持填写）。';
                btnRow.appendChild(hint);
            }

            wrap.appendChild(btnRow);
            listEl.appendChild(wrap);
        });

        this._syncClarifyConfirmEnabled();
    },

    _syncClarifyConfirmEnabled: function () {
        const confirmBtn = document.getElementById('ai-fund-pick-clarify-confirm-btn');
        if (!confirmBtn) return;
        const qs = Array.isArray(this._lastQuestions) ? this._lastQuestions : [];
        // 只要存在“无 options”的问题，则无法继续（最小实现：要求用户改提示词）
        const hasUnsupported = qs.some(q => !(Array.isArray(q.options) && q.options.length));
        if (hasUnsupported) {
            confirmBtn.disabled = true;
            return;
        }
        const allAnswered = qs.every(q => {
            const qid = String(q.question_id || '');
            return qid && this._answers[qid] !== undefined;
        });
        confirmBtn.disabled = !allAnswered;
    },

    async confirmClarify() {
        if (this._busy) return;
        const errEl = document.getElementById('ai-fund-pick-error');
        const errTextEl = document.getElementById('ai-fund-pick-error-text');
        const planEl = document.getElementById('ai-fund-pick-plan-json');

        if (!this._lastPrompt || !this._lastDraftPreview || !Array.isArray(this._lastQuestions)) {
            return;
        }

        const answers = this._lastQuestions.map(q => {
            const qid = String(q.question_id || '');
            return { question_id: qid, value: this._answers[qid] };
        });

        this._busy = true;
        if (errEl) errEl.classList.add('hidden');
        if (planEl) planEl.textContent = '生成中...';

        try {
            const resp = await fetch('/api/ai-fund-pick/parse/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: this._lastPrompt,
                    draft: this._lastDraftPreview,
                    questions: this._lastQuestions,
                    answers,
                }),
            });
            const data = await resp.json();
            if (!data || !data.success) {
                const msg = (data && (data.message || data.error)) || '生成失败';
                if (errTextEl) errTextEl.textContent = String(msg);
                if (errEl) errEl.classList.remove('hidden');
                if (planEl) planEl.textContent = '（生成失败）';
                return;
            }

            if (data.need_clarify) {
                // 仍需补全（例如 value 缺失）
                this._lastDraftPreview = data.draft_preview || this._lastDraftPreview;
                this._renderClarifyQuestions(data.questions || []);
                if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
                return;
            }

            const draft = data.draft || {};
            // 完成：隐藏 clarify，展示最终 draft
            const clarifyEl = document.getElementById('ai-fund-pick-clarify');
            if (clarifyEl) clarifyEl.classList.add('hidden');
            if (planEl) planEl.textContent = JSON.stringify(draft, null, 2);
        } catch (e) {
            if (errTextEl) errTextEl.textContent = '网络错误或服务异常';
            if (errEl) errEl.classList.remove('hidden');
            if (planEl) planEl.textContent = '（生成失败）';
        } finally {
            this._busy = false;
        }
    },

    async generateDraft() {
        if (this._busy) return;
        const promptEl = document.getElementById('ai-fund-pick-prompt');
        const planEl = document.getElementById('ai-fund-pick-plan-json');
        const errEl = document.getElementById('ai-fund-pick-error');
        const errTextEl = document.getElementById('ai-fund-pick-error-text');
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');
        const clarifyEl = document.getElementById('ai-fund-pick-clarify');

        const prompt = String((promptEl && promptEl.value) || '').trim();
        if (!prompt) {
            if (errTextEl) errTextEl.textContent = '请输入筛选提示词';
            if (errEl) errEl.classList.remove('hidden');
            return;
        }

        this._busy = true;
        if (errEl) errEl.classList.add('hidden');
        if (clarifyEl) clarifyEl.classList.add('hidden');
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
            // 需要补全边界
            if (data.need_clarify) {
                this._lastPrompt = prompt;
                this._lastDraftPreview = data.draft_preview || {};
                this._renderClarifyQuestions(data.questions || []);
                if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
                return;
            }

            const draft = data.draft || {};
            this._lastPrompt = prompt;
            this._lastDraftPreview = draft;
            this._lastQuestions = null;
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
