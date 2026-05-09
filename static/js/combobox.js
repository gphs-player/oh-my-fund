// 自定义下拉（combobox）控件：可搜索、键盘导航、点击外部关闭
const Combobox = {
    instances: new WeakMap(),

    attach: function(root) {
        if (!root || this.instances.has(root)) return this.instances.get(root);
        const input = root.querySelector('.combobox-input');
        const menu = root.querySelector('.combobox-menu');
        const clearBtn = root.querySelector('.combobox-clear');
        const caretBtn = root.querySelector('.combobox-caret');

        const state = { options: [], activeIndex: -1, onChange: null };

        const open = () => {
            if (state.options.length === 0 && !input.value) return;
            root.setAttribute('data-open', '');
            input.setAttribute('aria-expanded', 'true');
            render();
        };

        const close = () => {
            root.removeAttribute('data-open');
            input.setAttribute('aria-expanded', 'false');
            state.activeIndex = -1;
        };

        const toggle = () => {
            if (root.hasAttribute('data-open')) close();
            else open();
        };

        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

        const filter = () => {
            const q = input.value.trim().toLowerCase();
            if (!q) return state.options.slice();
            return state.options.filter(v => v.toLowerCase().includes(q));
        };

        const highlight = (text, query) => {
            if (!query) return escapeHtml(text);
            const i = text.toLowerCase().indexOf(query.toLowerCase());
            if (i < 0) return escapeHtml(text);
            return escapeHtml(text.slice(0, i)) +
                '<mark>' + escapeHtml(text.slice(i, i + query.length)) + '</mark>' +
                escapeHtml(text.slice(i + query.length));
        };

        const render = () => {
            const list = filter();
            const q = input.value.trim();
            const selected = input.value.trim();
            menu.innerHTML = list.map((v, i) => {
                const attrs = [];
                if (i === state.activeIndex) attrs.push('data-active');
                if (v === selected) attrs.push('data-selected');
                return `<li class="combobox-option" role="option" data-idx="${i}" ${attrs.join(' ')}>${highlight(v, q)}</li>`;
            }).join('');

            if (clearBtn) {
                if (input.value) clearBtn.removeAttribute('hidden');
                else clearBtn.setAttribute('hidden', '');
            }

            const active = menu.querySelector('.combobox-option[data-active]');
            if (active) active.scrollIntoView({ block: 'nearest' });
        };

        const selectAt = (idx) => {
            const list = filter();
            if (idx < 0 || idx >= list.length) return;
            input.value = list[idx];
            close();
            if (state.onChange) state.onChange(input.value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        input.addEventListener('focus', () => open());
        input.addEventListener('input', () => {
            state.activeIndex = -1;
            open();
            render();
        });
        input.addEventListener('keydown', (e) => {
            const list = filter();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!root.hasAttribute('data-open')) open();
                state.activeIndex = Math.min(state.activeIndex + 1, list.length - 1);
                render();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.activeIndex = Math.max(state.activeIndex - 1, 0);
                render();
            } else if (e.key === 'Enter') {
                if (root.hasAttribute('data-open') && state.activeIndex >= 0) {
                    e.preventDefault();
                    selectAt(state.activeIndex);
                }
            } else if (e.key === 'Escape') {
                if (root.hasAttribute('data-open')) { e.preventDefault(); close(); }
            } else if (e.key === 'Tab') {
                close();
            }
        });

        menu.addEventListener('mousedown', (e) => {
            const li = e.target.closest('.combobox-option');
            if (!li) return;
            e.preventDefault();
            selectAt(parseInt(li.dataset.idx, 10));
        });

        if (caretBtn) caretBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.focus();
            toggle();
        });

        if (clearBtn) clearBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = '';
            state.activeIndex = -1;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.focus();
            render();
        });

        document.addEventListener('mousedown', (e) => {
            if (!root.contains(e.target)) close();
        });

        const api = {
            setOptions: (opts) => { state.options = Array.from(opts || []); render(); },
            getOptions: () => state.options.slice(),
            setValue: (v) => {
                input.value = v || '';
                render();
                if (state.onChange) state.onChange(input.value);
            },
            getValue: () => input.value,
            onChange: (fn) => { state.onChange = fn; },
            open, close,
        };

        this.instances.set(root, api);
        render();
        return api;
    },

    get: function(root) {
        return this.instances.get(root);
    }
};

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('[data-combobox]').forEach(el => Combobox.attach(el));
});
