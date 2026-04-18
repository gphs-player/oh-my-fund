const FundSelector = {
    allFunds: [],
    filteredFunds: [],
    availableTypes: [],
    currentPage: 1,
    pageSize: 20,
    isLoaded: false,
    isLoading: false,
    searchKeyword: '',
    selectedFundType: '',
    debounceTimer: null,
    debounceDelay: 300,
    detailFundCode: '',
    detailLoading: false,
    detailData: null,
    detailError: '',

    init: function() {
        this.bindEvents();
        this.render();
    },

    bindEvents: function() {
        const fundTab = document.querySelector('[data-tab="fund-select"]');
        if (fundTab) {
            fundTab.addEventListener('click', () => {
                this.loadIfNeeded();
            });
        }

        const keywordInput = document.getElementById('fund-search-keyword');
        const typeSelect = document.getElementById('fund-search-type');
        const pageSizeSelect = document.getElementById('fund-page-size');

        if (keywordInput) {
            keywordInput.addEventListener('input', () => {
                this.searchKeyword = keywordInput.value.trim();
                this.renderKeywordClearButton();
                this.scheduleFilter();
            });
        }

        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                this.selectedFundType = typeSelect.value;
                this.applyFilters();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', () => {
                this.pageSize = parseInt(pageSizeSelect.value, 10) || 20;
                this.currentPage = 1;
                this.render();
            });
        }
    },

    loadIfNeeded: async function() {
        if (this.isLoaded || this.isLoading) return;

        this.isLoading = true;
        this.render();

        try {
            const response = await fetch('/api/funds');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.allFunds = Array.isArray(data) ? data : [];
            this.filteredFunds = [...this.allFunds];
            this.availableTypes = this.extractAvailableTypes();
            this.renderTypeOptions();
            this.currentPage = 1;
            this.isLoaded = true;
        } catch (error) {
            showToast('加载基金列表失败: ' + error.message, 'error');
            this.allFunds = [];
            this.filteredFunds = [];
            this.availableTypes = [];
            this.renderTypeOptions();
            this.isLoaded = true;
        } finally {
            this.isLoading = false;
            this.render();
        }
    },

    extractAvailableTypes: function() {
        return Array.from(new Set(
            this.allFunds
                .map(item => (item.fund_type || '').trim())
                .filter(type => type !== '')
        )).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    },

    renderTypeOptions: function() {
        const typeSelect = document.getElementById('fund-search-type');
        if (!typeSelect) return;

        typeSelect.innerHTML = '<option value="">全部类型</option>';
        this.availableTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeSelect.appendChild(option);
        });
        typeSelect.value = this.selectedFundType;
    },

    scheduleFilter: function() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.applyFilters();
        }, this.debounceDelay);
    },

    applyFilters: function() {
        const keyword = this.searchKeyword.toLowerCase();
        const selectedType = this.selectedFundType;

        this.filteredFunds = this.allFunds.filter(item => {
            const fundCode = (item.fund_code || '').toLowerCase();
            const fundName = (item.fund_name || '').toLowerCase();
            const keywordMatched = keyword === '' ||
                fundCode.includes(keyword) ||
                fundName.includes(keyword);
            const typeMatched = selectedType === '' || (item.fund_type || '') === selectedType;

            return keywordMatched && typeMatched;
        });

        this.currentPage = 1;
        this.render();
    },

    clearKeyword: function() {
        this.searchKeyword = '';
        const keywordInput = document.getElementById('fund-search-keyword');
        if (keywordInput) {
            keywordInput.value = '';
            keywordInput.focus();
        }
        this.renderKeywordClearButton();
        this.applyFilters();
    },

    getCurrentPageData: function() {
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return this.filteredFunds.slice(start, end);
    },

    getTotalPages: function() {
        if (this.filteredFunds.length === 0) return 0;
        return Math.ceil(this.filteredFunds.length / this.pageSize);
    },

    getVisiblePages: function(totalPages) {
        if (totalPages <= 7) {
            return Array.from({ length: totalPages }, (_, index) => index + 1);
        }

        const pages = new Set([1, totalPages]);
        for (let page = this.currentPage - 1; page <= this.currentPage + 1; page++) {
            if (page > 1 && page < totalPages) {
                pages.add(page);
            }
        }

        return Array.from(pages).sort((a, b) => a - b);
    },

    changePage: function(page) {
        const totalPages = this.getTotalPages();
        if (page < 1 || page > totalPages) return;
        this.currentPage = page;
        this.render();
    },

    render: function() {
        this.renderKeywordClearButton();
        this.renderContent();
        this.renderPagination();
    },

    renderKeywordClearButton: function() {
        const clearButton = document.getElementById('fund-search-clear');
        if (!clearButton) return;

        if (this.searchKeyword) {
            clearButton.classList.remove('hidden');
        } else {
            clearButton.classList.add('hidden');
        }
    },

    renderSummary: function() {
        const summaryEl = document.getElementById('fund-select-summary');
        if (!summaryEl) return;

        if (!this.isLoaded && !this.isLoading) {
            summaryEl.textContent = '切换到当前页后自动加载基金数据';
            return;
        }

        if (this.isLoading) {
            summaryEl.textContent = '正在加载基金列表...';
            return;
        }

        summaryEl.textContent = `总计 ${this.filteredFunds.length} 条`;
    },

    renderContent: function() {
        const loadingEl = document.getElementById('fund-select-loading');
        const emptyEl = document.getElementById('fund-select-empty');
        const tableWrapper = document.getElementById('fund-select-table-wrapper');
        const emptyTitle = document.getElementById('fund-empty-title');
        const emptyDesc = document.getElementById('fund-empty-desc');
        const tbody = document.getElementById('fund-select-table-body');

        if (!loadingEl || !emptyEl || !tableWrapper || !emptyTitle || !emptyDesc || !tbody) {
            return;
        }

        loadingEl.classList.add('hidden');
        emptyEl.classList.add('hidden');
        tableWrapper.classList.add('hidden');

        if (this.isLoading) {
            loadingEl.classList.remove('hidden');
            this.renderSummary();
            return;
        }

        if (this.allFunds.length === 0) {
            emptyTitle.textContent = '暂无基金数据';
            emptyDesc.textContent = '请先在设置页激活可用的数据源，并刷新基金缓存。';
            emptyEl.classList.remove('hidden');
            tbody.innerHTML = '';
            this.renderSummary();
            return;
        }

        if (this.filteredFunds.length === 0) {
            emptyTitle.textContent = '没有找到匹配基金';
            emptyDesc.textContent = '请调整关键字或基金类型后重试。';
            emptyEl.classList.remove('hidden');
            tbody.innerHTML = '';
            this.renderSummary();
            return;
        }

        const currentPageData = this.getCurrentPageData();
        const startIndex = (this.currentPage - 1) * this.pageSize;
        tbody.innerHTML = currentPageData.map((item, index) => `
            <tr>
                <td>${startIndex + index + 1}</td>
                <td>${item.fund_code || '-'}</td>
                <td>${item.fund_name || '-'}</td>
                <td>${item.fund_type || '-'}</td>
                <td>
                    <div class="flex items-center gap-2">
                        <div class="tooltip" data-tip="添加持仓">
                            <button type="button" class="btn btn-outline btn-xs" onclick="FundSelector.addToInvestment('${item.fund_code || ''}')" title="添加持仓">
                                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                        <div class="tooltip" data-tip="详情">
                            <button type="button" class="btn btn-outline btn-xs" onclick="FundSelector.showDetail('${item.fund_code || ''}')" title="详情">
                                详情
                            </button>
                        </div>
                        <div class="tooltip" data-tip="分析">
                            <button type="button" class="btn btn-outline btn-xs" onclick="FundSelector.analyzeFund('${item.fund_code || ''}')" title="分析">
                                <img src="/static/images/analysis.svg" alt="分析" class="h-4 w-4" aria-hidden="true">
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `).join('');

        tableWrapper.classList.remove('hidden');
        this.renderSummary();
    },

    renderPagination: function() {
        const paginationEl = document.getElementById('fund-select-pagination');
        const paginationButtonsEl = document.getElementById('fund-select-pagination-buttons');
        if (!paginationEl || !paginationButtonsEl) return;

        if (this.isLoading || this.filteredFunds.length === 0) {
            paginationEl.classList.add('hidden');
            paginationButtonsEl.innerHTML = '';
            return;
        }

        paginationEl.classList.remove('hidden');

        const totalPages = this.getTotalPages();
        if (totalPages <= 1) {
            paginationButtonsEl.innerHTML = '';
            return;
        }

        const visiblePages = this.getVisiblePages(totalPages);
        let pagesHtml = '';
        let previousPage = 0;

        visiblePages.forEach(page => {
            if (previousPage && page - previousPage > 1) {
                pagesHtml += '<span class="px-2 text-slate-400">...</span>';
            }

            pagesHtml += `
                <button type="button"
                    class="btn btn-sm ${page === this.currentPage ? 'btn-primary' : 'btn-outline'}"
                    onclick="FundSelector.changePage(${page})">
                    ${page}
                </button>
            `;
            previousPage = page;
        });

        paginationButtonsEl.innerHTML = `
            <button type="button"
                class="btn btn-sm btn-outline"
                ${this.currentPage === 1 ? 'disabled' : ''}
                onclick="FundSelector.changePage(${this.currentPage - 1})">
                上一页
            </button>
            ${pagesHtml}
            <button type="button"
                class="btn btn-sm btn-outline"
                ${this.currentPage === totalPages ? 'disabled' : ''}
                onclick="FundSelector.changePage(${this.currentPage + 1})">
                下一页
            </button>
        `;
    },

    showDetail: async function(fundCode) {
        const fund = this.allFunds.find(item => item.fund_code === fundCode);
        if (!fundCode || !fund) {
            showToast('基金信息不存在', 'error');
            return;
        }

        this.detailFundCode = fundCode;
        this.detailLoading = true;
        this.detailData = null;
        this.detailError = '';
        this.renderDetailModal(fund);

        const modal = document.getElementById('fund-detail-modal');
        if (modal) {
            modal.showModal();
        }

        try {
            const response = await fetch(`/api/funds/${encodeURIComponent(fundCode)}/overview`);
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || `HTTP ${response.status}`);
            }

            if (!result.data || Object.keys(result.data).length === 0) {
                throw new Error('暂无基金详情数据');
            }

            this.detailData = result.data;
        } catch (error) {
            this.detailError = error.message;
            showToast('加载基金详情失败: ' + error.message, 'error');
        } finally {
            this.detailLoading = false;
            this.renderDetailModal(fund);
        }
    },

    renderDetailModal: function(fund) {
        const titleEl = document.getElementById('fund-detail-title');
        const loadingEl = document.getElementById('fund-detail-loading');
        const errorEl = document.getElementById('fund-detail-error');
        const errorTextEl = document.getElementById('fund-detail-error-text');
        const contentEl = document.getElementById('fund-detail-content');
        const tableBody = document.getElementById('fund-detail-table-body');

        if (!titleEl || !loadingEl || !errorEl || !errorTextEl || !contentEl || !tableBody) {
            return;
        }

        titleEl.textContent = fund && fund.fund_name ? fund.fund_name : '基金详情';

        loadingEl.classList.add('hidden');
        errorEl.classList.add('hidden');
        contentEl.classList.add('hidden');

        if (this.detailLoading) {
            loadingEl.classList.remove('hidden');
            tableBody.innerHTML = '';
            return;
        }

        if (this.detailError) {
            errorTextEl.textContent = this.detailError;
            errorEl.classList.remove('hidden');
            tableBody.innerHTML = '';
            return;
        }

        if (!this.detailData || Object.keys(this.detailData).length === 0) {
            errorTextEl.textContent = '暂无基金详情数据';
            errorEl.classList.remove('hidden');
            tableBody.innerHTML = '';
            return;
        }

        const entries = Object.entries(this.detailData);
        let rowsHtml = '';

        for (let index = 0; index < entries.length; index += 2) {
            const left = entries[index];
            const right = entries[index + 1];

            rowsHtml += `
                <tr>
                    <th class="w-32 text-xs text-slate-300 align-top">${left[0]}</th>
                    <td class="text-sm text-slate-100 break-words whitespace-normal">${left[1] || '-'}</td>
                    <th class="w-32 text-xs text-slate-300 align-top">${right ? right[0] : ''}</th>
                    <td class="text-sm text-slate-100 break-words whitespace-normal">${right ? (right[1] || '-') : ''}</td>
                </tr>
            `;
        }

        tableBody.innerHTML = rowsHtml;
        contentEl.classList.remove('hidden');
    },

    addToInvestment: function(fundCode) {
        const fund = this.allFunds.find(item => item.fund_code === fundCode);
        if (!fund) {
            showToast('基金信息不存在', 'error');
            return;
        }

        if (typeof window.switchMainTab === 'function') {
            window.switchMainTab('investment');
        }

        InvestmentUI.showAddModal({
            fund_code: fund.fund_code || '',
            fund_name: fund.fund_name || ''
        });
    },

    analyzeFund: function(fundCode) {
        void fundCode;
    }
};

document.addEventListener('DOMContentLoaded', function() {
    FundSelector.init();
});
