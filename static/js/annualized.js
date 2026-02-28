const AnnualizedCalculator = {
    // 方式一：根据持有周期和总收益率计算
    calculateMethod1: function(event) {
        event.preventDefault();

        const years = parseFloat(document.getElementById('years1').value);
        const totalReturn = parseFloat(document.getElementById('total-return1').value) / 100;

        // 公式：年化收益率 = (1 + 总收益率) ^ (1 / 持有年数) - 1
        const annualReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
        const annualReturnPercent = (annualReturn * 100).toFixed(2);

        document.getElementById('result1-value').textContent = annualReturnPercent + '%';
        document.getElementById('result1').classList.remove('hidden');
    },

    // 方式二：根据期初期末净值计算
    calculateMethod2: function(event) {
        event.preventDefault();

        const initialNav = parseFloat(document.getElementById('initial-nav').value);
        const years = parseFloat(document.getElementById('years2').value);
        const finalNav = parseFloat(document.getElementById('final-nav').value);

        if (initialNav <= 0) {
            showToast('期初净值必须大于0', 'error');
            return;
        }

        // 计算总收益率
        const totalReturn = (finalNav - initialNav) / initialNav;
        const totalReturnPercent = (totalReturn * 100).toFixed(2);

        // 计算年化收益率
        const annualReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
        const annualReturnPercent = (annualReturn * 100).toFixed(2);

        document.getElementById('result2-total').textContent = totalReturnPercent + '%';
        document.getElementById('result2-annual').textContent = annualReturnPercent + '%';
        document.getElementById('result2').classList.remove('hidden');
    }
};
