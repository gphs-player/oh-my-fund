const FundSelector = {
    allFunds: [],
    filteredFunds: [],
    favoriteFunds: [],
    favoriteFundCodes: new Set(),
    favoriteGroups: [],
    favoriteMemberships: [],
    availableTypes: [],
    currentPage: 1,
    pageSize: 20,
    isLoaded: false,
    isLoading: false,
    searchKeyword: '',
    selectedFundType: '',
    selectedScope: 'all',
    selectedFavoriteGroupId: 'default',
    debounceTimer: null,
    debounceDelay: 300,
    detailFundCode: '',
    detailLoading: false,
    detailData: null,
    detailError: '',
    assigningFundCode: '',

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
            await this.reloadData();
            this.isLoaded = true;
            this.applyFilters();
        } catch (error) {
            showToast('加载基金列表失败: ' + error.message, 'error');
            this.allFunds = [];
            this.filteredFunds = [];
            this.favoriteFunds = [];
            this.favoriteFundCodes = new Set();
            this.favoriteGroups = [];
            this.favoriteMemberships = [];
            this.availableTypes = [];
            this.isLoaded = true;
        } finally {
            this.isLoading = false;
            this.render();
        }
    },

    reloadData: async function() {
        const [fundResponse, favoriteResponse, groupResponse, membershipResponse] = await Promise.all([
            fetch('/api/funds'),
            fetch('/api/favorites'),
            fetch('/api/favorite-groups'),
            fetch('/api/favorite-group-memberships')
        ]);

        if (!fundResponse.ok) throw new Error(`HTTP ${fundResponse.status}`);
        if (!favoriteResponse.ok) throw new Error(`HTTP ${favoriteResponse.status}`);
        if (!groupResponse.ok) throw new Error(`HTTP ${groupResponse.status}`);
        if (!membershipResponse.ok) throw new Error(`HTTP ${membershipResponse.status}`);

        const [fundData, favoriteData, groupData, membershipData] = await Promise.all([
            fundResponse.json(),
            favoriteResponse.json(),
            groupResponse.json(),
            membershipResponse.json()
        ]);

        this.allFunds = Array.isArray(fundData) ? fundData : [];
        this.favoriteFunds = Array.isArray(favoriteData) ? favoriteData : [];
        this.favoriteFundCodes = new Set(this.favoriteFunds.map(item => item.fund_code));
        this.favoriteGroups = Array.isArray(groupData) ? groupData : [];
        this.favoriteMemberships = Array.isArray(membershipData) ? membershipData : [];
        this.availableTypes = this.extractAvailableTypes();
        this.renderTypeOptions();
        this.ensureSelectedFavoriteGroup();
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

    ensureSelectedFavoriteGroup: function() {
        const groupIds = new Set(this.favoriteGroups.map(item => item.group_id));
        if (!groupIds.has(this.selectedFavoriteGroupId)) {
            this.selectedFavoriteGroupId = groupIds.has('default') ? 'default' : (this.favoriteGroups[0]?.group_id || '');
        }
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
        if (this.selectedScope === 'favorite') {
            this.filteredFunds = this.getFundsBySelectedGroup();
        } else {
            const keyword = this.searchKeyword.toLowerCase();
            const selectedType = this.selectedFundType;

            this.filteredFunds = this.allFunds.filter(item => {
                const fundCode = (item.fund_code || '').toLowerCase();
                const fundName = (item.fund_name || '').toLowerCase();
                const keywordMatched = keyword === '' || fundCode.includes(keyword) || fundName.includes(keyword);
                const typeMatched = selectedType === '' || (item.fund_type || '') === selectedType;
                return keywordMatched && typeMatched;
            });
        }

        this.currentPage = 1;
        this.render();
    },

    getFundsBySelectedGroup: function() {
        const groupId = this.selectedFavoriteGroupId;
        const fundCodes = new Set(
            this.favoriteMemberships
                .filter(item => item.group_id === groupId)
                .map(item => item.fund_code)
        );

        return this.allFunds.filter(item => fundCodes.has(item.fund_code));
    },

    switchScope: function(scope) {
        if (scope !== 'all' && scope !== 'favorite') return;
        this.selectedScope = scope;
        this.applyFilters();
    },

    selectFavoriteGroup: function(groupId) {
        this.selectedFavoriteGroupId = groupId;
        this.applyFilters();
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
        this.renderScopeButtons();
        this.renderDiscoveryFilters();
        this.renderFavoriteToolbar();
        this.renderKeywordClearButton();
        this.renderContent();
        this.renderPagination();
    },

    renderScopeButtons: function() {
        const allButton = document.getElementById('fund-scope-all');
        const favoriteButton = document.getElementById('fund-scope-favorite');
        if (!allButton || !favoriteButton) return;

        const isAll = this.selectedScope === 'all';
        allButton.className = `btn btn-sm ${isAll ? 'btn-primary' : 'btn-outline'}`;
        favoriteButton.className = `btn btn-sm ${!isAll ? 'btn-primary' : 'btn-outline'}`;
    },

    renderDiscoveryFilters: function() {
        const discoveryFilters = document.getElementById('fund-discovery-filters');
        if (!discoveryFilters) return;
        discoveryFilters.classList.toggle('hidden', this.selectedScope !== 'all');
    },

    renderFavoriteToolbar: function() {
        const toolbar = document.getElementById('favorite-group-toolbar');
        const tabs = document.getElementById('favorite-group-tabs');
        if (!toolbar || !tabs) return;

        const isFavorite = this.selectedScope === 'favorite';
        toolbar.classList.toggle('hidden', !isFavorite);

        if (!isFavorite) {
            tabs.innerHTML = '';
            return;
        }

        this.ensureSelectedFavoriteGroup();
        tabs.innerHTML = this.favoriteGroups.map(group => `
            <button type="button"
                class="tab ${group.group_id === this.selectedFavoriteGroupId ? 'tab-active' : ''}"
                onclick="FundSelector.selectFavoriteGroup('${group.group_id}')">
                ${group.group_name}
            </button>
        `).join('');
    },

    renderKeywordClearButton: function() {
        const clearButton = document.getElementById('fund-search-clear');
        if (!clearButton) return;

        if (this.searchKeyword && this.selectedScope === 'all') {
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

        if (this.selectedScope === 'favorite') {
            const group = this.favoriteGroups.find(item => item.group_id === this.selectedFavoriteGroupId);
            summaryEl.textContent = `${group ? group.group_name : '当前分组'} 共 ${this.filteredFunds.length} 条`;
            return;
        }

        summaryEl.textContent = `全部共 ${this.filteredFunds.length} 条`;
    },

    renderContent: function() {
        const loadingEl = document.getElementById('fund-select-loading');
        const emptyEl = document.getElementById('fund-select-empty');
        const tableWrapper = document.getElementById('fund-select-table-wrapper');
        const emptyTitle = document.getElementById('fund-empty-title');
        const emptyDesc = document.getElementById('fund-empty-desc');
        const tbody = document.getElementById('fund-select-table-body');

        if (!loadingEl || !emptyEl || !tableWrapper || !emptyTitle || !emptyDesc || !tbody) return;

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
            if (this.selectedScope === 'favorite') {
                emptyTitle.textContent = '当前分组暂无基金';
                emptyDesc.textContent = '你可以通过“分组管理”新增分组，或在基金行内把自选基金加入当前分组。';
            } else {
                emptyTitle.textContent = '没有找到匹配基金';
                emptyDesc.textContent = '请调整关键字或基金类型后重试。';
            }
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
                    <div class="flex items-center gap-2 whitespace-nowrap w-full">
                        <div class="tooltip" data-tip="${this.isFavorite(item.fund_code) ? '取消自选' : '加入自选'}">
                            <button type="button" class="btn btn-xs favorite-btn ${this.isFavorite(item.fund_code) ? 'is-active' : ''}" onclick="FundSelector.toggleFavorite('${item.fund_code || ''}')" title="${this.isFavorite(item.fund_code) ? '取消自选' : '加入自选'}">
                                <span class="favorite-btn-icon ${this.isFavorite(item.fund_code) ? 'is-active' : ''}">${this.isFavorite(item.fund_code) ? '★' : '☆'}</span>
                            </button>
                        </div>
                        ${this.isFavorite(item.fund_code) ? `
                        <div class="tooltip" data-tip="分组">
                            <button type="button" class="btn btn-outline btn-xs fund-action-group" onclick="FundSelector.showAssignGroupModal('${item.fund_code || ''}')" title="分组">分组</button>
                        </div>
                        ` : ''}
                        <div class="tooltip" data-tip="添加持仓">
                            <button type="button" class="btn btn-outline btn-xs fund-action-add" onclick="FundSelector.addToInvestment('${item.fund_code || ''}')" title="添加持仓">
                                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                        <div class="tooltip" data-tip="详情">
                            <button type="button" class="btn btn-outline btn-xs fund-action-detail" onclick="FundSelector.showDetail('${item.fund_code || ''}')" title="详情">详情</button>
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
            <button type="button" class="btn btn-sm btn-outline" ${this.currentPage === 1 ? 'disabled' : ''} onclick="FundSelector.changePage(${this.currentPage - 1})">上一页</button>
            ${pagesHtml}
            <button type="button" class="btn btn-sm btn-outline" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="FundSelector.changePage(${this.currentPage + 1})">下一页</button>
        `;
    },

    showGroupManageModal: function() {
        this.renderGroupManageList();
        document.getElementById('favorite-group-name-input').value = '';
        document.getElementById('favorite-group-manage-modal').showModal();
    },

    renderGroupManageList: function() {
        const container = document.getElementById('favorite-group-manage-list');
        if (!container) return;

        container.innerHTML = this.favoriteGroups.map(group => `
            <div class="flex items-center gap-2">
                <input type="text" id="favorite-group-edit-${group.group_id}" class="input input-bordered flex-1" value="${group.group_name}" ${group.is_system ? 'disabled' : ''}>
                ${group.is_system ? '<span class="text-sm text-slate-400 px-2">系统</span>' : `
                    <button type="button" class="btn btn-outline btn-sm" onclick="FundSelector.renameGroup('${group.group_id}')">重命名</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="FundSelector.deleteGroup('${group.group_id}')">删除</button>
                `}
            </div>
        `).join('');
    },

    createGroup: async function() {
        const input = document.getElementById('favorite-group-name-input');
        const groupName = input ? input.value.trim() : '';
        if (!groupName) {
            showToast('请输入分组名称', 'warning');
            return;
        }

        try {
            const response = await fetch('/api/favorite-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_name: groupName, created_at: new Date().toISOString() })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '新建分组失败');
            }
            await this.reloadData();
            this.render();
            this.renderGroupManageList();
            input.value = '';
            showToast('分组已创建', 'success');
        } catch (error) {
            showToast(error.message || '新建分组失败', 'error');
        }
    },

    renameGroup: async function(groupId) {
        const input = document.getElementById(`favorite-group-edit-${groupId}`);
        const groupName = input ? input.value.trim() : '';
        if (!groupName) {
            showToast('请输入分组名称', 'warning');
            return;
        }

        try {
            const response = await fetch(`/api/favorite-groups/${encodeURIComponent(groupId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_name: groupName })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '重命名失败');
            }
            await this.reloadData();
            this.render();
            this.renderGroupManageList();
            showToast('分组已重命名', 'success');
        } catch (error) {
            showToast(error.message || '重命名失败', 'error');
        }
    },

    deleteGroup: async function(groupId) {
        try {
            const response = await fetch(`/api/favorite-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '删除分组失败');
            }
            await this.reloadData();
            this.render();
            this.renderGroupManageList();
            showToast('分组已删除', 'success');
        } catch (error) {
            showToast(error.message || '删除分组失败', 'error');
        }
    },

    showAssignGroupModal: function(fundCode) {
        const fund = this.allFunds.find(item => item.fund_code === fundCode);
        if (!fund) {
            showToast('基金信息不存在', 'error');
            return;
        }

        this.assigningFundCode = fundCode;
        const title = document.getElementById('favorite-assign-group-fund-name');
        const container = document.getElementById('favorite-assign-group-list');
        if (title) title.textContent = `${fund.fund_name}（${fundCode}）`;
        if (container) {
            const currentGroupIds = new Set(this.favoriteMemberships.filter(item => item.fund_code === fundCode).map(item => item.group_id));
            container.innerHTML = this.favoriteGroups.map(group => `
                <label class="label cursor-pointer justify-start gap-3 rounded-xl border border-cyan-400/10 bg-white/5 px-4 py-3">
                    <input type="checkbox" class="checkbox checkbox-sm" value="${group.group_id}" ${currentGroupIds.has(group.group_id) ? 'checked' : ''}>
                    <span class="label-text">${group.group_name}${group.is_system ? '（系统）' : ''}</span>
                </label>
            `).join('');
        }
        document.getElementById('favorite-assign-group-modal').showModal();
    },

    saveAssignedGroups: async function() {
        const container = document.getElementById('favorite-assign-group-list');
        if (!container || !this.assigningFundCode) return;

        const groupIds = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(item => item.value);

        try {
            const response = await fetch(`/api/favorites/${encodeURIComponent(this.assigningFundCode)}/groups`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_ids: groupIds })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '保存分组失败');
            }
            await this.reloadData();
            this.applyFilters();
            document.getElementById('favorite-assign-group-modal').close();
            showToast('分组已更新', 'success');
        } catch (error) {
            showToast(error.message || '保存分组失败', 'error');
        }
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
        if (modal) modal.showModal();

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
        if (!titleEl || !loadingEl || !errorEl || !errorTextEl || !contentEl || !tableBody) return;

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
        InvestmentUI.showAddModal({ fund_code: fund.fund_code || '', fund_name: fund.fund_name || '' });
    },

    isFavorite: function(fundCode) {
        return this.favoriteFundCodes.has(fundCode);
    },

    toggleFavorite: async function(fundCode) {
        if (!fundCode) return;

        if (this.isFavorite(fundCode)) {
            await this.removeFavorite(fundCode);
            return;
        }

        const fund = this.allFunds.find(item => item.fund_code === fundCode);
        if (!fund) {
            showToast('基金信息不存在', 'error');
            return;
        }
        await this.addFavorite(fund);
    },

    addFavorite: async function(fund) {
        const createdAt = new Date().toISOString();
        try {
            const response = await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fund_code: fund.fund_code || '',
                    fund_name: fund.fund_name || '',
                    created_at: createdAt
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '加入自选失败');
            }
            await this.reloadData();
            this.applyFilters();
            showToast('已加入自选', 'success');
        } catch (error) {
            showToast(error.message || '加入自选失败', 'error');
        }
    },

    removeFavorite: async function(fundCode) {
        try {
            const response = await fetch(`/api/favorites/${encodeURIComponent(fundCode)}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '取消自选失败');
            }
            await this.reloadData();
            this.applyFilters();
            showToast('已取消自选', 'success');
        } catch (error) {
            showToast(error.message || '取消自选失败', 'error');
        }
    },

    analyzeFund: function(fundCode) {
        void fundCode;
    }
};

document.addEventListener('DOMContentLoaded', function() {
    FundSelector.init();
});
