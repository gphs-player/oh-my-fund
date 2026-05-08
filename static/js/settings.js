// 设置管理模块
const SettingsManager = {
    datasourceTypes: [],  // 支持的数据源类型
    datasources: [],      // 已配置的数据源
    editingId: null,      // 正在编辑的数据源 ID
    editingType: null,    // 正在编辑的数据源类型

    // 初始化
    init: async function() {
        await this.loadDatasourceTypes();
        await this.loadDatasources();
        await this.loadSettings();
        await this.loadCacheInfo();
    },

    // 加载支持的数据源类型
    loadDatasourceTypes: async function() {
        try {
            const response = await fetch('/api/datasources/types');
            this.datasourceTypes = await response.json();
            this.renderTypeOptions();
        } catch (error) {
            showToast('加载数据源类型失败', 'error');
        }
    },

    // 渲染类型下拉选项
    renderTypeOptions: function() {
        const select = document.getElementById('datasource-type');
        if (!select) return;

        const isEditingDefault = this.editingType === 'Default';
        select.innerHTML = '<option value="" disabled selected>请选择类型</option>';
        this.datasourceTypes
            .filter(type => type.type !== 'Default' || isEditingDefault)
            .forEach(type => {
            const option = document.createElement('option');
            option.value = type.type;
            option.textContent = type.label;
            select.appendChild(option);
        });
    },

    // 加载已配置的数据源
    loadDatasources: async function() {
        try {
            const response = await fetch('/api/datasources');
            this.datasources = await response.json();
            this.renderDatasourceList();
        } catch (error) {
            showToast('加载数据源列表失败', 'error');
        }
    },

    // 渲染数据源列表
    renderDatasourceList: function() {
        const tbody = document.getElementById('datasource-list');
        if (!tbody) return;

        if (this.datasources.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center text-gray-500">暂无数据源，请添加</td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.datasources.map(ds => {
            const typeInfo = this.datasourceTypes.find(t => t.type === ds.type);
            const typeLabel = typeInfo ? typeInfo.label : ds.type;
            const deleteButton = ds.is_builtin ? '' : `
                            <div class="tooltip" data-tip="删除">
                                <button class="btn btn-xs btn-ghost" onclick="SettingsManager.showDeleteConfirm(${ds.id})">
                                    <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M874.666667 241.066667h-202.666667V170.666667c0-40.533333-34.133333-74.666667-74.666667-74.666667h-170.666666c-40.533333 0-74.666667 34.133333-74.666667 74.666667v70.4H149.333333c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h53.333334V853.333333c0 40.533333 34.133333 74.666667 74.666666 74.666667h469.333334c40.533333 0 74.666667-34.133333 74.666666-74.666667V305.066667H874.666667c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM416 170.666667c0-6.4 4.266667-10.666667 10.666667-10.666667h170.666666c6.4 0 10.666667 4.266667 10.666667 10.666667v70.4h-192V170.666667z m341.333333 682.666666c0 6.4-4.266667 10.666667-10.666666 10.666667H277.333333c-6.4 0-10.666667-4.266667-10.666666-10.666667V309.333333h490.666666V853.333333z" fill="#f87171"/>
                                        <path d="M426.666667 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32zM597.333333 736c17.066667 0 32-14.933333 32-32V490.666667c0-17.066667-14.933333-32-32-32s-32 14.933333-32 32v213.333333c0 17.066667 14.933333 32 32 32z" fill="#f87171"/>
                                    </svg>
                                </button>
                            </div>
            `;
            
            return `
                <tr>
                    <td>${ds.name}</td>
                    <td>${typeLabel}</td>
                    <td>
                        <input type="checkbox" class="toggle toggle-success toggle-sm" 
                            ${ds.is_active ? 'checked' : ''} 
                            onchange="SettingsManager.toggleActive(${ds.id}, this.checked)">
                    </td>
                    <td>
                        <div class="flex gap-1">
                            <div class="tooltip" data-tip="测试数据源">
                                <button class="btn btn-xs btn-ghost" onclick="SettingsManager.testDatasource(${ds.id})">
                                    <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z" fill="#a78bfa"/>
                                        <path d="M464 336a48 48 0 1 0 96 0 48 48 0 1 0-96 0zm72 112h-48c-4.4 0-8 3.6-8 8v272c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V456c0-4.4-3.6-8-8-8z" fill="#a78bfa"/>
                                        <path d="M713.1 438.9l-45.3 45.3c-3.1 3.1-3.1 8.2 0 11.3l90.5 90.5c3.1 3.1 8.2 3.1 11.3 0l45.3-45.3c3.1-3.1 3.1-8.2 0-11.3l-90.5-90.5c-3.1-3.1-8.2-3.1-11.3 0z" fill="#a78bfa"/>
                                    </svg>
                                </button>
                            </div>
                            <div class="tooltip" data-tip="编辑">
                                <button class="btn btn-xs btn-ghost" onclick="SettingsManager.showEditModal(${ds.id})">
                                    <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M853.333333 501.333333c-17.066667 0-32 14.933333-32 32v320c0 6.4-4.266667 10.666667-10.666666 10.666667H170.666667c-6.4 0-10.666667-4.266667-10.666667-10.666667V213.333333c0-6.4 4.266667-10.666667 10.666667-10.666666h320c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32H170.666667c-40.533333 0-74.666667 34.133333-74.666667 74.666666v640c0 40.533333 34.133333 74.666667 74.666667 74.666667h640c40.533333 0 74.666667-34.133333 74.666666-74.666667V533.333333c0-17.066667-14.933333-32-32-32z" fill="#00FFF0"/>
                                        <path d="M405.333333 484.266667l-32 125.866666c-2.133333 10.666667 0 23.466667 8.533334 29.866667 6.4 6.4 14.933333 8.533333 23.466666 8.533333h8.533334l125.866666-32c6.4-2.133333 10.666667-4.266667 14.933334-8.533333l300.8-300.8c38.4-38.4 38.4-102.4 0-140.8-38.4-38.4-102.4-38.4-140.8 0L413.866667 469.333333c-4.266667 4.266667-6.4 8.533333-8.533334 14.933334z m59.733334 23.466666L761.6 213.333333c12.8-12.8 36.266667-12.8 49.066667 0 12.8 12.8 12.8 36.266667 0 49.066667L516.266667 558.933333l-66.133334 17.066667 14.933334-68.266667z" fill="#00FFF0"/>
                                    </svg>
                                </button>
                            </div>
                            ${deleteButton}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // 加载全局设置
    loadSettings: async function() {
        try {
            const response = await fetch('/api/settings');
            const settings = await response.json();
            const expireInput = document.getElementById('cache-expire-days');
            if (expireInput && settings.cache_expire_days) {
                expireInput.value = settings.cache_expire_days;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    },

    // 加载缓存状态
    loadCacheInfo: async function() {
        try {
            const response = await fetch('/api/cache/info');
            const info = await response.json();
            const statusEl = document.getElementById('cache-status');
            if (statusEl) {
                if (info.exists) {
                    statusEl.textContent = `${info.cached_at} 更新，共 ${info.count} 条`;
                    statusEl.className = 'text-sm text-success';
                } else {
                    statusEl.textContent = '无缓存';
                    statusEl.className = 'text-sm text-white';
                }
            }
        } catch (error) {
            console.error('加载缓存状态失败:', error);
        }
    },

    // 显示添加模态框
    showAddModal: function() {
        this.editingId = null;
        this.editingType = null;
        this.editingConfig = null;
        document.getElementById('datasource-modal-title').textContent = '添加数据源';
        document.getElementById('datasource-form').reset();
        document.getElementById('datasource-id').value = '';
        document.getElementById('datasource-type').disabled = false;
        this.renderTypeOptions();
        document.getElementById('datasource-config-fields').innerHTML = '';
        document.getElementById('datasource-modal').showModal();
    },

    // 显示编辑模态框
    showEditModal: async function(id) {
        // 获取完整的数据源信息（包含 config）
        try {
            const response = await fetch(`/api/datasources/${id}`);
            if (!response.ok) {
                showToast('获取数据源信息失败', 'error');
                return;
            }
            const ds = await response.json();
            
            this.editingId = id;
            this.editingType = ds.type;
            this.editingConfig = ds.config || {};  // 保存配置供 renderConfigFields 使用
            
            document.getElementById('datasource-modal-title').textContent = '编辑数据源';
            document.getElementById('datasource-id').value = id;
            document.getElementById('datasource-name').value = ds.name;
            this.renderTypeOptions();
            document.getElementById('datasource-type').value = ds.type;
            document.getElementById('datasource-type').disabled = true;
            
            // 渲染配置字段（内部会自动填充已保存的值）
            this.renderConfigFields();
            
            document.getElementById('datasource-modal').showModal();
        } catch (error) {
            showToast('获取数据源信息失败: ' + error.message, 'error');
        }
    },

    // 根据类型渲染配置字段
    renderConfigFields: function() {
        const typeSelect = document.getElementById('datasource-type');
        const container = document.getElementById('datasource-config-fields');
        const selectedType = typeSelect.value;
        
        if (!selectedType) {
            container.innerHTML = '';
            return;
        }

        const typeInfo = this.datasourceTypes.find(t => t.type === selectedType);
        if (!typeInfo || !typeInfo.config_schema) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = typeInfo.config_schema.map(field => {
            const isPassword = field.type === 'password';
            return `
            <div class="form-control mb-3">
                <label class="label">
                    <span class="label-text">${field.label}</span>
                </label>
                <div class="${isPassword ? 'relative' : ''}">
                    <input 
                        type="${field.type}" 
                        id="config-${field.field}" 
                        class="input input-bordered w-full ${isPassword ? 'pr-10' : ''}" 
                        placeholder="${field.label}"
                        ${field.required ? 'required' : ''}
                    >
                    ${isPassword ? `
                    <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:opacity-70" onclick="SettingsManager.togglePasswordVisibility('config-${field.field}', this)">
                        <svg class="h-5 w-5" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                            <path d="M512 256c-174.4 0-333.8 96-416 256 82.2 160 241.6 256 416 256s333.8-96 416-256c-82.2-160-241.6-256-416-256zm0 426.7c-94.1 0-170.7-76.6-170.7-170.7s76.6-170.7 170.7-170.7 170.7 76.6 170.7 170.7-76.6 170.7-170.7 170.7zm0-277.4c-58.9 0-106.7 47.8-106.7 106.7s47.8 106.7 106.7 106.7 106.7-47.8 106.7-106.7-47.8-106.7-106.7-106.7z" fill="#9ca3af"/>
                        </svg>
                    </button>
                    ` : ''}
                </div>
            </div>
        `}).join('');

        // 编辑时填充已保存的配置值
        if (this.editingId && this.editingConfig) {
            typeInfo.config_schema.forEach(field => {
                const input = document.getElementById(`config-${field.field}`);
                if (input && this.editingConfig[field.field] !== undefined) {
                    input.value = this.editingConfig[field.field];
                }
            });
        }
    },

    // 切换密码可见性
    togglePasswordVisibility: function(inputId, button) {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        
        // 更新图标
        const svg = button.querySelector('svg');
        if (isPassword) {
            // 显示“隐藏”图标（带斜线的眼睛）
            svg.innerHTML = `
                <path d="M512 256c-174.4 0-333.8 96-416 256 82.2 160 241.6 256 416 256s333.8-96 416-256c-82.2-160-241.6-256-416-256zm0 426.7c-94.1 0-170.7-76.6-170.7-170.7s76.6-170.7 170.7-170.7 170.7 76.6 170.7 170.7-76.6 170.7-170.7 170.7zm0-277.4c-58.9 0-106.7 47.8-106.7 106.7s47.8 106.7 106.7 106.7 106.7-47.8 106.7-106.7-47.8-106.7-106.7-106.7z" fill="#9ca3af"/>
                <path d="M142.5 142.5l739 739" stroke="#9ca3af" stroke-width="64" stroke-linecap="round"/>
            `;
        } else {
            // 显示“查看”图标（普通眼睛）
            svg.innerHTML = `
                <path d="M512 256c-174.4 0-333.8 96-416 256 82.2 160 241.6 256 416 256s333.8-96 416-256c-82.2-160-241.6-256-416-256zm0 426.7c-94.1 0-170.7-76.6-170.7-170.7s76.6-170.7 170.7-170.7 170.7 76.6 170.7 170.7-76.6 170.7-170.7 170.7zm0-277.4c-58.9 0-106.7 47.8-106.7 106.7s47.8 106.7 106.7 106.7 106.7-47.8 106.7-106.7-47.8-106.7-106.7-106.7z" fill="#9ca3af"/>
            `;
        }
    },

    // 处理表单提交
    handleSubmit: async function(event) {
        event.preventDefault();

        const id = document.getElementById('datasource-id').value;
        const name = document.getElementById('datasource-name').value;
        const type = document.getElementById('datasource-type').value;
        
        // 收集配置字段
        const typeInfo = this.datasourceTypes.find(t => t.type === type);
        const config = {};
        if (typeInfo && typeInfo.config_schema) {
            typeInfo.config_schema.forEach(field => {
                const input = document.getElementById(`config-${field.field}`);
                if (input && input.value) {
                    config[field.field] = input.value;
                }
            });
        }

        try {
            let response;
            if (id) {
                // 编辑
                response = await fetch(`/api/datasources/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, config })
                });
            } else {
                // 添加
                response = await fetch('/api/datasources', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, type, config })
                });
            }

            const result = await response.json();
            if (result.success) {
                showToast(id ? '更新成功' : '添加成功', 'success');
                document.getElementById('datasource-type').disabled = false;
                document.getElementById('datasource-modal').close();
                await this.loadDatasources();
            } else {
                showToast(result.error || '操作失败', 'error');
            }
        } catch (error) {
            showToast('操作失败: ' + error.message, 'error');
        }
    },

    // 切换数据源激活状态
    toggleActive: async function(id, checked) {
        if (checked) {
            await this.activate(id);
        } else {
            await this.deactivate(id);
        }
    },

    // 激活数据源
    activate: async function(id) {
        try {
            const response = await fetch(`/api/datasources/${id}/activate`, { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                showToast('激活成功', 'success');
                await this.loadDatasources();
                // 通知基金市场模块：数据源已切换，需要重新拉取类型与列表
                if (window.FundSelector && typeof window.FundSelector.onDatasourceChanged === 'function') {
                    await window.FundSelector.onDatasourceChanged();
                }
            } else {
                showToast(result.error || '激活失败', 'error');
            }
        } catch (error) {
            showToast('激活失败: ' + error.message, 'error');
        }
    },

    // 停用数据源
    deactivate: async function(id) {
        try {
            const response = await fetch(`/api/datasources/${id}/deactivate`, { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                showToast('已停用', 'success');
                await this.loadDatasources();
                // 通知基金市场模块：数据源已切换，需要重新拉取类型与列表
                if (window.FundSelector && typeof window.FundSelector.onDatasourceChanged === 'function') {
                    await window.FundSelector.onDatasourceChanged();
                }
            } else {
                showToast(result.error || '停用失败', 'error');
            }
        } catch (error) {
            showToast('停用失败: ' + error.message, 'error');
        }
    },

    // 显示删除确认模态框
    showDeleteConfirm: function(id) {
        const ds = this.datasources.find(d => d.id === id);
        if (ds && ds.is_builtin) {
            showToast('默认数据源不允许删除', 'warning');
            return;
        }
        const name = ds ? ds.name : '该数据源';
        
        document.getElementById('delete-confirm-message').textContent = `确定要删除数据源「${name}」吗？`;
        
        const confirmBtn = document.getElementById('delete-confirm-btn');
        confirmBtn.onclick = () => {
            document.getElementById('delete-confirm-modal').close();
            this.deleteDatasource(id);
        };
        
        document.getElementById('delete-confirm-modal').showModal();
    },

    // 删除数据源
    deleteDatasource: async function(id) {
        try {
            const response = await fetch(`/api/datasources/${id}`, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                showToast('删除成功', 'success');
                await this.loadDatasources();
            } else {
                showToast(result.error || '删除失败', 'error');
            }
        } catch (error) {
            showToast('删除失败: ' + error.message, 'error');
        }
    },

    // 测试数据源连接
    testDatasource: async function(id) {
        showToast('正在测试连接...', 'info');
        
        try {
            const response = await fetch(`/api/datasources/${id}/test`, { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                showToast(`连接成功，获取到 ${result.count} 条基金数据`, 'success');
            } else {
                showToast(`连接失败: ${result.message}`, 'error');
            }
        } catch (error) {
            showToast('测试失败: ' + error.message, 'error');
        }
    },

    // 保存缓存失效时间
    saveExpireDays: async function() {
        const input = document.getElementById('cache-expire-days');
        const days = parseInt(input.value);
        
        if (isNaN(days) || days < 1 || days > 365) {
            showToast('请输入有效的天数 (1-365)', 'warning');
            return;
        }

        try {
            const response = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cache_expire_days: days.toString() })
            });
            const result = await response.json();
            if (result.success) {
                showToast('保存成功', 'success');
            } else {
                showToast('保存失败', 'error');
            }
        } catch (error) {
            showToast('保存失败: ' + error.message, 'error');
        }
    },

    // 刷新缓存
    refreshCache: async function() {
        showToast('正在刷新缓存...', 'info');
        
        try {
            const response = await fetch('/api/cache/refresh', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
                showToast(`刷新成功，共 ${result.count} 条数据`, 'success');
                await this.loadCacheInfo();
            } else {
                showToast(`刷新失败: ${result.message}`, 'error');
            }
        } catch (error) {
            showToast('刷新失败: ' + error.message, 'error');
        }
    }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    SettingsManager.init();
});
