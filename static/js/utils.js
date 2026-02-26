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

// 显示提示消息
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} fixed top-4 right-4 w-auto z-50 shadow-lg`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}
