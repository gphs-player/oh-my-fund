// 设置管理模块
const SettingsManager = {
    datasourceTypes: [],  // 支持的数据源类型
    datasources: [],      // 已配置的数据源
    editingId: null,      // 正在编辑的数据源 ID

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
        
        select.innerHTML = '<option value="" disabled selected>请选择类型</option>';
        this.datasourceTypes.forEach(type => {
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
            const statusBadge = ds.is_active 
                ? '<span class="badge badge-success">✅ 激活</span>'
                : '<span class="badge badge-ghost">⚪ 停用</span>';
            
            return `
                <tr>
                    <td>${ds.name}</td>
                    <td>${typeLabel}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="flex gap-1">
                            <button class="btn btn-xs btn-outline" onclick="SettingsManager.testDatasource(${ds.id})" title="测试连接">
                                测试
                            </button>
                            ${ds.is_active 
                                ? `<button class="btn btn-xs btn-warning" onclick="SettingsManager.deactivate(${ds.id})" title="停用">停用</button>`
                                : `<button class="btn btn-xs btn-success" onclick="SettingsManager.activate(${ds.id})" title="激活">激活</button>`
                            }
                            <button class="btn btn-xs btn-ghost" onclick="SettingsManager.showEditModal(${ds.id})" title="编辑">编辑</button>
                            <button class="btn btn-xs btn-ghost text-error" onclick="SettingsManager.deleteDatasource(${ds.id})" title="删除">删除</button>
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
                    statusEl.className = 'text-sm text-gray-400';
                }
            }
        } catch (error) {
            console.error('加载缓存状态失败:', error);
        }
    },

    // 显示添加模态框
    showAddModal: function() {
        this.editingId = null;
        document.getElementById('datasource-modal-title').textContent = '添加数据源';
        document.getElementById('datasource-form').reset();
        document.getElementById('datasource-id').value = '';
        document.getElementById('datasource-config-fields').innerHTML = '';
        document.getElementById('datasource-modal').showModal();
    },

    // 显示编辑模态框
    showEditModal: function(id) {
        const ds = this.datasources.find(d => d.id === id);
        if (!ds) return;

        this.editingId = id;
        document.getElementById('datasource-modal-title').textContent = '编辑数据源';
        document.getElementById('datasource-id').value = id;
        document.getElementById('datasource-name').value = ds.name;
        document.getElementById('datasource-type').value = ds.type;
        
        // 渲染配置字段（编辑时不显示已保存的敏感信息）
        this.renderConfigFields();
        
        document.getElementById('datasource-modal').showModal();
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

        container.innerHTML = typeInfo.config_schema.map(field => `
            <div class="form-control mb-3">
                <label class="label">
                    <span class="label-text">${field.label}</span>
                </label>
                <input 
                    type="${field.type}" 
                    id="config-${field.field}" 
                    class="input input-bordered" 
                    placeholder="${field.label}"
                    ${field.required ? 'required' : ''}
                >
            </div>
        `).join('');
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
                document.getElementById('datasource-modal').close();
                await this.loadDatasources();
            } else {
                showToast(result.error || '操作失败', 'error');
            }
        } catch (error) {
            showToast('操作失败: ' + error.message, 'error');
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
            } else {
                showToast(result.error || '停用失败', 'error');
            }
        } catch (error) {
            showToast('停用失败: ' + error.message, 'error');
        }
    },

    // 删除数据源
    deleteDatasource: async function(id) {
        if (!confirm('确定要删除这个数据源吗？')) return;

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
