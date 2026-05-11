// AI 区域：子 TAB（AI 选基 / AI 分析）
const AiPickSubTabs = {
    _active: 'pick', // pick|analysis

    init: function() {
        this.bind();
        this.switchTo('pick'); // 默认：AI 选基
    },

    bind: function() {
        document.querySelectorAll('[data-ai-subtab]').forEach(tab => {
            tab.addEventListener('click', () => {
                const name = String(tab.dataset.aiSubtab || '').trim();
                if (!name) return;
                this.switchTo(name);
            });
        });

        // 切到主 Tab 时：刷新当前子TAB配置
        document.querySelectorAll('[data-tab="ai-pick"]').forEach(t => {
            t.addEventListener('click', () => this.refreshActiveConfig());
        });
    },

    refreshActiveConfig: function() {
        if (this._active === 'analysis') {
            if (AiFundAnalysis && AiFundAnalysis.checkConfig) AiFundAnalysis.checkConfig();
        } else {
            if (AiFundPick && AiFundPick.checkConfig) AiFundPick.checkConfig();
        }
    },

    switchTo: function(name) {
        const next = (name === 'analysis') ? 'analysis' : 'pick';
        this._active = next;

        // tabs active
        document.querySelectorAll('[data-ai-subtab]').forEach(t => t.classList.remove('tab-active'));
        const btn = document.querySelector(`[data-ai-subtab="${next}"]`);
        if (btn) btn.classList.add('tab-active');

        // panels
        const pickPanel = document.getElementById('ai-pick-subtab-pick');
        const analysisPanel = document.getElementById('ai-pick-subtab-analysis');
        if (pickPanel) {
            if (next === 'pick') {
                pickPanel.classList.remove('hidden');
                pickPanel.style.display = 'block';
            } else {
                pickPanel.classList.add('hidden');
                pickPanel.style.display = 'none';
            }
        }
        if (analysisPanel) {
            if (next === 'analysis') {
                analysisPanel.classList.remove('hidden');
                analysisPanel.style.display = 'block';
            } else {
                analysisPanel.classList.add('hidden');
                analysisPanel.style.display = 'none';
            }
        }

        this.refreshActiveConfig();
    }
};

// AI 分析（极简版）：创建 job + 轮询进度 + 展示结果
const AiFundAnalysis = {
    _busy: false,
    _selectedCode: '',
    _jobId: '',
    _pollTimer: null,
    _debounceTimer: null,

    init: async function() {
        this.bind();
        await this.checkConfig();
    },

    bind: function() {
        const qEl = document.getElementById('ai-analysis-q');
        const startBtn = document.getElementById('ai-analysis-start-btn');
        const suggestEl = document.getElementById('ai-analysis-suggest');

        if (qEl) {
            qEl.addEventListener('input', () => {
                const q = String(qEl.value || '').trim();

                // 允许直接输入代码
                if (Validator && Validator.fundCode && Validator.fundCode(q)) {
                    this._setSelectedCode(q);
                    if (suggestEl) suggestEl.classList.add('hidden');
                    return;
                }

                // debounce 搜索
                if (this._debounceTimer) clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(() => this._searchSuggest(q), 400);
            });
        }

        if (startBtn) startBtn.addEventListener('click', () => this.start());
    },

    async checkConfig() {
        const statusEl = document.getElementById('ai-analysis-config-status');
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

    _setSelectedCode: function(code) {
        this._selectedCode = String(code || '').trim();
        const codeEl = document.getElementById('ai-analysis-fund-code');
        if (codeEl) codeEl.textContent = this._selectedCode || '（未选择）';
    },

    async _searchSuggest(q) {
        const suggestEl = document.getElementById('ai-analysis-suggest');
        if (!suggestEl) return;

        const keyword = String(q || '').trim();
        if (!keyword) {
            suggestEl.classList.add('hidden');
            suggestEl.innerHTML = '';
            return;
        }

        try {
            const resp = await fetch(`/api/funds/search?q=${encodeURIComponent(keyword)}&limit=20`);
            const data = await resp.json();
            const items = (data && data.items) || [];
            if (!Array.isArray(items) || !items.length) {
                suggestEl.innerHTML = '<div class="text-xs text-slate-400 p-2">无匹配结果</div>';
                suggestEl.classList.remove('hidden');
                return;
            }

            suggestEl.innerHTML = '';
            items.forEach(it => {
                const code = String(it.fund_code || '').trim();
                const name = String(it.fund_name || '').trim();
                if (!code) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-ghost btn-xs justify-start w-full';
                btn.textContent = `${code} ${name}`;
                btn.addEventListener('click', () => {
                    this._setSelectedCode(code);
                    const qEl = document.getElementById('ai-analysis-q');
                    if (qEl) qEl.value = `${code} ${name}`.trim();
                    suggestEl.classList.add('hidden');
                });
                suggestEl.appendChild(btn);
            });
            suggestEl.classList.remove('hidden');
        } catch (e) {
            suggestEl.innerHTML = '<div class="text-xs text-error p-2">搜索失败</div>';
            suggestEl.classList.remove('hidden');
        }
    },

    _renderProgress: function(job) {
        const barEl = document.getElementById('ai-analysis-progress-bar');
        const percentEl = document.getElementById('ai-analysis-progress-percent');
        const textEl = document.getElementById('ai-analysis-progress-text');

        const percent = Number(job && job.percent || 0);
        const step = (job && job.current_step) || {};
        const label = String(step.label || '').trim();
        const message = String(step.message || '').trim();

        if (barEl) barEl.value = Math.max(0, Math.min(100, percent));
        if (percentEl) percentEl.textContent = `${Math.max(0, Math.min(100, percent))}%`;
        if (textEl) textEl.textContent = [label, message].filter(Boolean).join('：') || '处理中...';
    },

    _renderResult: function(result) {
        const pre = document.getElementById('ai-analysis-result-json');
        if (!pre) return;
        pre.textContent = JSON.stringify(result || {}, null, 2);
    },

    _stopPolling: function() {
        if (this._pollTimer) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
    },

    async start() {
        if (this._busy) return;
        const forceEl = document.getElementById('ai-analysis-force');
        const startBtn = document.getElementById('ai-analysis-start-btn');

        const code = String(this._selectedCode || '').trim();
        if (!Validator.fundCode(code)) {
            showToast('请先选择正确的基金代码（5-8位数字）', 'warning');
            return;
        }

        this._busy = true;
        if (startBtn) startBtn.disabled = true;
        this._stopPolling();

        const pre = document.getElementById('ai-analysis-result-json');
        if (pre) pre.textContent = '已提交任务，等待进度...';
        this._renderProgress({ percent: 0, current_step: { label: '准备开始', message: '' } });

        try {
            const force = !!(forceEl && forceEl.checked);
            const resp = await fetch(`/api/funds/${encodeURIComponent(code)}/ai-analysis/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force }),
            });
            const data = await resp.json();
            if (!data || !data.success || !data.job_id) {
                showToast((data && data.message) || '任务创建失败', 'error');
                return;
            }
            this._jobId = String(data.job_id || '').trim();
            await this._pollOnce();
        } catch (e) {
            showToast('网络错误或服务异常', 'error');
        } finally {
            this._busy = false;
            if (startBtn) startBtn.disabled = false;
        }
    },

    async _pollOnce() {
        const jobId = String(this._jobId || '').trim();
        if (!jobId) return;

        try {
            const resp = await fetch(`/api/ai-analysis/jobs/${encodeURIComponent(jobId)}`);
            const data = await resp.json();
            if (!data || !data.success) {
                this._stopPolling();
                showToast((data && data.message) || '任务查询失败', 'error');
                return;
            }

            this._renderProgress(data);

            const status = String(data.status || '').trim();
            if (status === 'done') {
                this._stopPolling();
                this._renderResult(data.result || {});
                showToast('分析完成', 'success');
                return;
            }
            if (status === 'error') {
                this._stopPolling();
                const msg = (data.error && data.error.message) ? String(data.error.message) : '分析失败';
                showToast(msg, 'error');
                const pre = document.getElementById('ai-analysis-result-json');
                if (pre) pre.textContent = `（失败）${msg}`;
                return;
            }

            // pending / running：继续轮询
            this._pollTimer = setTimeout(() => this._pollOnce(), 800);
        } catch (e) {
            this._stopPolling();
            showToast('网络错误或服务异常', 'error');
        }
    },
};

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
        const regenBtn = document.getElementById('ai-fund-pick-clarify-regenerate-btn');
        if (!dlg || !listEl || !regenBtn) return;

        const items = Array.isArray(this._lastMissingItems) ? this._lastMissingItems : [];
        listEl.innerHTML = '';

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

            // TopN（limit）标题行按需求隐藏，避免“TopN（limit）”占位干扰
            const hideTitle = (metric === 'TopN' && field === 'limit');
            if (!hideTitle) {
                const fieldLabelMap = {
                    window: '时间窗口',
                    value: '阈值/区间',
                    limit: '数量',
                };
                const fieldLabel = fieldLabelMap[field] || '信息';
                const title = document.createElement('div');
                title.className = 'text-sm text-slate-100 font-semibold';
                title.textContent = `请完善「${metric}」的${fieldLabel}`;
                wrap.appendChild(title);
            }

            const prob = document.createElement('div');
            // “问题”提示要更明显
            prob.className = 'text-base font-bold text-warning';
            prob.textContent = problem ? `问题：${problem}` : '';
            wrap.appendChild(prob);

            const sug = document.createElement('div');
            sug.className = 'text-xs text-slate-400';
            sug.textContent = suggestion ? `建议：${suggestion}` : '';
            wrap.appendChild(sug);

            // 输入控件：必须允许用户输入
            const inputRow = document.createElement('div');
            inputRow.className = 'flex flex-col gap-2 mt-2';

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
            textInput.addEventListener('input', () => {
                // 用户手动输入时，取消 radio 选中（避免状态冲突）
                if (radioGroup) {
                    radioGroup.querySelectorAll('input[type="radio"]').forEach(r => {
                        r.checked = false;
                    });
                }
                this._syncRegenerateEnabled();
            });

            // 建议项：统一用 RadioButton（单选），不使用下拉框
            let radioGroup = null;
            if (options.length) {
                radioGroup = document.createElement('div');
                radioGroup.className = 'flex flex-wrap items-center gap-4';
                const groupName = `ai-fund-pick-opt-${itemId}`;

                options.forEach(o => {
                    const v = String(o.value || '').trim();
                    const l = String(o.label || v).trim();
                    if (!v) return;

                    const label = document.createElement('label');
                    label.className = 'label cursor-pointer justify-start gap-2 p-0';

                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = groupName;
                    radio.value = v;
                    radio.className = 'radio radio-sm';
                    radio.addEventListener('change', () => {
                        if (radio.checked) {
                            textInput.value = v;
                            this._syncRegenerateEnabled();
                        }
                    });

                    const text = document.createElement('span');
                    text.className = 'label-text text-xs text-slate-200';
                    text.textContent = l;

                    label.appendChild(radio);
                    label.appendChild(text);
                    radioGroup.appendChild(label);
                });
                inputRow.appendChild(radioGroup);
            }

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
    if (AiPickSubTabs) AiPickSubTabs.init();
    if (AiFundPick) AiFundPick.init();
    if (AiFundAnalysis) AiFundAnalysis.init();
});
