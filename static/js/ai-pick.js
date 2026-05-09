// AI 选基（第 1 步：解析提示词为 draft，并在边界不明确时弹框补全后重新生成）
const AiFundPick = {
    _busy: false,
    _lastPrompt: '',
    _lastDraftPreview: null,
    _lastMissingItems: null,
    _round: 0,
    _missingSignature: '',
    _prevMissingSignature: '',

    init: async function() {
        this.bind();
        await this.checkConfig();
    },

    bind: function() {
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');
        const resetBtn = document.getElementById('ai-fund-pick-reset-btn');
        const cancelBtn = document.getElementById('ai-fund-pick-clarify-cancel-btn');
        const regenBtn = document.getElementById('ai-fund-pick-clarify-regenerate-btn');

        if (genBtn) genBtn.addEventListener('click', () => this.generateDraft());
        if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeClarifyModal());
        if (regenBtn) regenBtn.addEventListener('click', () => this.refineDraft());

        // 切到 AI 选基 tab 时刷新配置
        document.querySelectorAll('[data-tab="ai-pick"]').forEach(t => {
            t.addEventListener('click', () => this.checkConfig());
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

    reset: function() {
        const promptEl = document.getElementById('ai-fund-pick-prompt');
        if (promptEl) promptEl.value = '';

        const planEl = document.getElementById('ai-fund-pick-plan-json');
        if (planEl) planEl.textContent = '（尚未生成）';

        const errEl = document.getElementById('ai-fund-pick-error');
        if (errEl) errEl.classList.add('hidden');

        this._busy = false;
        this._lastPrompt = '';
        this._lastDraftPreview = null;
        this._lastMissingItems = null;
        this._round = 0;
        this._missingSignature = '';
        this._prevMissingSignature = '';
        this.closeClarifyModal();
    },

    _showError: function(msg) {
        const errEl = document.getElementById('ai-fund-pick-error');
        const errTextEl = document.getElementById('ai-fund-pick-error-text');
        if (errTextEl) errTextEl.textContent = String(msg || '生成失败');
        if (errEl) errEl.classList.remove('hidden');
    },

    _hideError: function() {
        const errEl = document.getElementById('ai-fund-pick-error');
        if (errEl) errEl.classList.add('hidden');
    },

    async generateDraft() {
        if (this._busy) return;
        const promptEl = document.getElementById('ai-fund-pick-prompt');
        const planEl = document.getElementById('ai-fund-pick-plan-json');
        const genBtn = document.getElementById('ai-fund-pick-generate-btn');
        const prompt = String((promptEl && promptEl.value) || '').trim();

        if (!prompt) {
            this._showError('请输入筛选提示词');
            return;
        }

        this._busy = true;
        this._hideError();
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
                this._showError((data && (data.message || data.error)) || '生成失败');
                if (planEl) planEl.textContent = '（生成失败）';
                return;
            }

            this._lastPrompt = prompt;
            this._round = Number(data.round || 0);

            if (data.need_clarify) {
                this._lastDraftPreview = data.draft_preview || {};
                this._lastMissingItems = Array.isArray(data.missing_items) ? data.missing_items : [];
                this._missingSignature = String(data.missing_signature || '');
                this._prevMissingSignature = ''; // 首轮没有 prev

                if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
                this.openClarifyModal();
                return;
            }

            const draft = data.draft || {};
            this._lastDraftPreview = draft;
            this._lastMissingItems = null;
            if (planEl) planEl.textContent = JSON.stringify(draft, null, 2);
        } catch (e) {
            this._showError('网络错误或服务异常');
            if (planEl) planEl.textContent = '（生成失败）';
        } finally {
            this._busy = false;
            if (genBtn) genBtn.disabled = false;
        }
    },

    openClarifyModal: function() {
        const dlg = document.getElementById('ai-fund-pick-clarify-modal');
        const listEl = document.getElementById('ai-fund-pick-missing-list');
        const roundEl = document.getElementById('ai-fund-pick-clarify-round');
        const regenBtn = document.getElementById('ai-fund-pick-clarify-regenerate-btn');
        if (!dlg || !listEl || !regenBtn) return;

        const items = Array.isArray(this._lastMissingItems) ? this._lastMissingItems : [];
        listEl.innerHTML = '';

        if (roundEl) {
            const r = Number(this._round || 0);
            roundEl.textContent = `第 ${Math.max(1, r + 1)}/3 轮补全`;
        }

        items.forEach(item => {
            const itemId = String(item.item_id || '');
            const metric = String(item.metric_name || '');
            const field = String(item.field || '');
            const evidence = String(item.evidence || '');
            const problem = String(item.problem || '');
            const suggestion = String(item.suggestion || '');
            const options = Array.isArray(item.options) ? item.options : [];

            const wrap = document.createElement('div');
            wrap.className = 'rounded-xl border border-white/10 bg-black/10 p-3 space-y-2';
            wrap.dataset.itemId = itemId;
            wrap.dataset.required = item.required ? '1' : '0';

            const title = document.createElement('div');
            title.className = 'text-sm text-slate-100 font-semibold';
            title.textContent = `${metric}（${field}）`;
            wrap.appendChild(title);

            const ev = document.createElement('div');
            ev.className = 'text-xs text-slate-300';
            ev.textContent = evidence ? `证据：${evidence}` : '';
            wrap.appendChild(ev);

            const prob = document.createElement('div');
            prob.className = 'text-xs text-warning';
            prob.textContent = problem ? `问题：${problem}` : '';
            wrap.appendChild(prob);

            const sug = document.createElement('div');
            sug.className = 'text-xs text-slate-400';
            sug.textContent = suggestion ? `建议：${suggestion}` : '';
            wrap.appendChild(sug);

            // 输入控件：必须允许用户输入
            const inputRow = document.createElement('div');
            inputRow.className = 'flex flex-wrap items-center gap-2 mt-2';

            if (options.length) {
                const select = document.createElement('select');
                select.className = 'select select-bordered select-sm';
                select.innerHTML = '<option value=\"\">（选择建议）</option>' + options.map(o => {
                    const v = String(o.value || '');
                    const l = String(o.label || v);
                    return `<option value=\"${this._escapeAttr(v)}\">${l}</option>`;
                }).join('');
                select.addEventListener('change', () => {
                    if (textInput) textInput.value = select.value || '';
                    this._syncRegenerateEnabled();
                });
                inputRow.appendChild(select);
            }

            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'input input-bordered input-sm flex-1 min-w-[220px]';
            if (field === 'window') {
                textInput.placeholder = '请输入时间窗口（如 1y/3y/all 或 近1年/成立以来）';
            } else if (field === 'limit') {
                textInput.placeholder = '请输入数量（如 20/50/100）';
            } else {
                textInput.placeholder = '请输入具体值（如 30 或 10-200）';
            }
            textInput.dataset.itemId = itemId;
            textInput.addEventListener('input', () => this._syncRegenerateEnabled());
            inputRow.appendChild(textInput);

            // TopN：提供快捷按钮，但仍允许手输
            if (field === 'limit') {
                const quick = document.createElement('div');
                quick.className = 'flex flex-wrap gap-2';
                ['20', '50', '100'].forEach(v => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'btn btn-xs btn-outline';
                    b.textContent = v;
                    b.addEventListener('click', () => {
                        textInput.value = v;
                        this._syncRegenerateEnabled();
                    });
                    quick.appendChild(b);
                });
                wrap.appendChild(quick);
            }

            wrap.appendChild(inputRow);
            listEl.appendChild(wrap);
        });

        this._syncRegenerateEnabled();
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.setAttribute('open', '');
    },

    closeClarifyModal: function() {
        const dlg = document.getElementById('ai-fund-pick-clarify-modal');
        if (!dlg) return;
        try { dlg.close(); } catch (e) { /* ignore */ }
    },

    _escapeAttr: function(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    _collectUserFills: function() {
        const listEl = document.getElementById('ai-fund-pick-missing-list');
        if (!listEl) return [];
        const fills = [];
        listEl.querySelectorAll('input[data-item-id]').forEach(inp => {
            const itemId = String(inp.dataset.itemId || '');
            const val = String(inp.value || '').trim();
            if (!itemId) return;
            fills.push({ item_id: itemId, value: val });
        });
        return fills;
    },

    _syncRegenerateEnabled: function() {
        const regenBtn = document.getElementById('ai-fund-pick-clarify-regenerate-btn');
        const listEl = document.getElementById('ai-fund-pick-missing-list');
        if (!regenBtn || !listEl) return;

        let ok = true;
        listEl.querySelectorAll('[data-item-id]').forEach(row => {
            const required = row.dataset.required === '1';
            if (!required) return;
            const input = row.querySelector('input[data-item-id]');
            const val = String((input && input.value) || '').trim();
            if (!val) ok = false;
        });

        // TopN 校验：如存在 limit 缺失项，则必须为正整数
        listEl.querySelectorAll('[data-item-id]').forEach(row => {
            const input = row.querySelector('input[data-item-id]');
            if (!input) return;
            const itemId = String(input.dataset.itemId || '');
            const items = Array.isArray(this._lastMissingItems) ? this._lastMissingItems : [];
            const mi = items.find(x => String(x.item_id || '') === itemId);
            if (!mi) return;
            if (String(mi.field || '') !== 'limit') return;
            const raw = String(input.value || '').trim();
            if (!raw) return;
            const n = parseInt(raw, 10);
            if (!Number.isFinite(n) || String(n) !== raw || n <= 0) ok = false;
        });
        regenBtn.disabled = !ok;
    },

    async refineDraft() {
        if (this._busy) return;
        const planEl = document.getElementById('ai-fund-pick-plan-json');
        const regenBtn = document.getElementById('ai-fund-pick-clarify-regenerate-btn');

        const fills = this._collectUserFills();
        if (regenBtn && regenBtn.disabled) return;

        this._busy = true;
        this._hideError();
        if (regenBtn) regenBtn.disabled = true;
        if (planEl) planEl.textContent = '重新生成中...';

        try {
            const resp = await fetch('/api/ai-fund-pick/parse/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: this._lastPrompt,
                    round: this._round,
                    draft_preview: this._lastDraftPreview || {},
                    missing_items: this._lastMissingItems || [],
                    user_fills: fills,
                    prev_missing_signature: this._missingSignature || '',
                }),
            });
            const data = await resp.json();
            if (!data || !data.success) {
                this._showError((data && (data.message || data.error)) || '重新生成失败');
                if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
                return;
            }

            this._round = Number(data.round || (this._round + 1));

            if (data.need_clarify) {
                // 进入下一轮
                this._prevMissingSignature = this._missingSignature;
                this._missingSignature = String(data.missing_signature || '');
                this._lastDraftPreview = data.draft_preview || {};
                this._lastMissingItems = Array.isArray(data.missing_items) ? data.missing_items : [];
                if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
                this.openClarifyModal();
                return;
            }

            // 完成
            const draft = data.draft || {};
            this._lastDraftPreview = draft;
            this._lastMissingItems = null;
            this.closeClarifyModal();
            if (planEl) planEl.textContent = JSON.stringify(draft, null, 2);
        } catch (e) {
            this._showError('网络错误或服务异常');
            if (planEl) planEl.textContent = JSON.stringify(this._lastDraftPreview || {}, null, 2);
        } finally {
            this._busy = false;
            if (regenBtn) this._syncRegenerateEnabled();
        }
    },
};

document.addEventListener('DOMContentLoaded', function() {
    AiFundPick.init();
});
