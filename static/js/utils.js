// CSV解析函数
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }

    return data;
}

// CSV生成函数
function generateCSV(data, headers) {
    if (data.length === 0) return '';

    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => {
        return headers.map(header => {
            const value = row[header] || '';
            // 如果值包含逗号，用引号包裹
            return value.toString().includes(',') ? `"${value}"` : value;
        }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
}

// CSV下载函数
function downloadCSV(data, headers, filename) {
    const csv = generateCSV(data, headers);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 生成带时间戳的文件名
function generateTimestampFilename(prefix) {
    const now = new Date();
    const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return `${prefix}_${timestamp}.csv`;
}

// localStorage操作
const Storage = {
    save: function(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },
    load: function(key) {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    },
    remove: function(key) {
        localStorage.removeItem(key);
    }
};

// 数据验证
const Validator = {
    // 验证基金代码（5-8位数字）
    fundCode: function(code) {
        return /^\d{5,8}$/.test(code);
    },
    // 验证仓位（0-100）
    position: function(pos) {
        const num = parseFloat(pos);
        return !isNaN(num) && num >= 0 && num <= 100;
    },
    // 验证必填字段
    required: function(value) {
        return value !== null && value !== undefined && value.toString().trim() !== '';
    },
    // 验证数字
    number: function(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }
};

// 显示提示消息 - 全局漂亮提示框
function showToast(message, type = 'info') {
    // 移除已存在的toast
    const existingToast = document.querySelector('.toast-container');
    if (existingToast) {
        existingToast.remove();
    }

    // 图标配置
    const icons = {
        success: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>`,
        error: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>`,
        warning: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>`,
        info: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>`
    };

    // 颜色配置
    const colors = {
        success: { bg: 'rgba(16, 185, 129, 0.95)', border: '#10b981', shadow: 'rgba(16, 185, 129, 0.5)' },
        error: { bg: 'rgba(239, 68, 68, 0.95)', border: '#ef4444', shadow: 'rgba(239, 68, 68, 0.5)' },
        warning: { bg: 'rgba(245, 158, 11, 0.95)', border: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.5)' },
        info: { bg: 'rgba(59, 130, 246, 0.95)', border: '#3b82f6', shadow: 'rgba(59, 130, 246, 0.5)' }
    };

    const color = colors[type] || colors.info;
    const icon = icons[type] || icons.info;

    // 创建toast容器
    const toast = document.createElement('div');
    toast.className = 'toast-container';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 24px;
        background: ${color.bg};
        border: 1px solid ${color.border};
        border-radius: 12px;
        box-shadow: 0 10px 40px ${color.shadow}, 0 0 20px ${color.shadow};
        backdrop-filter: blur(10px);
        color: white;
        font-size: 15px;
        font-weight: 500;
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    `;

    toast.innerHTML = `
        <span style="display: flex; align-items: center;">${icon}</span>
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // 动画显示
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    });

    // 自动隐藏
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(-100px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}
