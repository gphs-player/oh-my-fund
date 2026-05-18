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
    total: 0,
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
    detailItems: null,
    detailError: '',
    assigningFundCode: '',
    sharePosterDataUrl: '',
    sharePosterBlob: null,
    sharePosterFilename: '',
    sharePosterRendering: false,
    _html2canvasLoadingPromise: null,
    _blurredBgCache: null,

    // 今日牛基（today-best）
    todayBestPeriodCode: 'Z',
    todayBestTopN: 1,
    todayBestMinReturn: null,
    todayBestSelectedTypes: new Set(), // 为空表示“不限制类型”（等价全部类型）
    todayBestAllTypes: [], // [{value,label}]
    todayBestRows: [],
    todayBestRunning: false,
    todayBestAbortController: null,
    todayBestProgress: { done: 0, total: 0, hit: 0, failed: 0 },
    todayBestJobId: '',
    todayBestPollTimer: null,

    init: function() {
        this.bindEvents();
        this.render();

        // 兼容主 Tab 使用 hash 路由：刷新在 #fund-select 时应自动加载数据
        // （否则用户未触发点击事件，会一直看到“暂无基金数据”的占位文案）
        if (window.location.hash === '#fund-select') {
            void this.loadIfNeeded();
        }
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

        // 详情弹框：窗口尺寸变化时动态调整高度
        window.addEventListener('resize', () => {
            this.adjustDetailModalHeight();
        });

        // 今日牛基筛选：仅更新状态，实际重算由“刷新”触发
        const periodSelect = document.getElementById('today-best-period');
        const topnInput = document.getElementById('today-best-topn');
        const minReturnInput = document.getElementById('today-best-min-return');

        if (periodSelect) {
            periodSelect.addEventListener('change', () => {
                this.todayBestPeriodCode = String(periodSelect.value || 'Z').trim() || 'Z';
            });
        }
        if (topnInput) {
            topnInput.addEventListener('change', () => {
                const n = parseInt(String(topnInput.value || '1'), 10);
                this.todayBestTopN = Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 1;
                topnInput.value = String(this.todayBestTopN);
            });
        }
        if (minReturnInput) {
            minReturnInput.addEventListener('change', () => {
                const raw = String(minReturnInput.value || '').trim();
                if (!raw) {
                    this.todayBestMinReturn = null;
                    return;
                }
                const v = Number(raw);
                this.todayBestMinReturn = Number.isFinite(v) ? v : null;
            });
        }
    },

    openSharePoster: async function() {
        if (this.sharePosterRendering) return;

        if (!this.isLoaded || this.isLoading) {
            showToast('请先等待基金列表加载完成', 'warning');
            return;
        }

        const items = this.getCurrentPageData();
        if (!Array.isArray(items) || items.length === 0) {
            showToast('当前页没有可分享的数据', 'warning');
            return;
        }

        const modal = document.getElementById('fund-share-modal');
        const img = document.getElementById('fund-share-preview-img');
        if (!modal || !img) return;

        try {
            this.sharePosterRendering = true;
            showToast('正在生成分享图片...', 'info');
            await this.ensureHtml2canvasLoaded();

            const { dataUrl, blob, filename } = await this.renderSharePoster(items);
            this.sharePosterDataUrl = dataUrl || '';
            this.sharePosterBlob = blob || null;
            this.sharePosterFilename = filename || 'fund_list.png';

            img.src = this.sharePosterDataUrl;

            // 系统分享按钮：不支持则隐藏
            const shareBtn = document.getElementById('fund-share-system-btn');
            if (shareBtn) {
                const canShare = this.canSystemShareFiles();
                shareBtn.classList.toggle('hidden', !canShare);
            }

            modal.showModal();
        } catch (e) {
            showToast('生成失败：' + (e && e.message ? e.message : ''), 'error');
        } finally {
            this.sharePosterRendering = false;
        }
    },

    closeSharePoster: function() {
        const modal = document.getElementById('fund-share-modal');
        if (modal) modal.close();
    },

    downloadSharePoster: function() {
        if (!this.sharePosterBlob) {
            showToast('请先生成分享图片', 'warning');
            return;
        }

        const filename = this.sharePosterFilename || 'fund_list.png';
        const url = URL.createObjectURL(this.sharePosterBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    shareSharePoster: async function() {
        if (!this.sharePosterBlob) {
            showToast('请先生成分享图片', 'warning');
            return;
        }

        if (!this.canSystemShareFiles()) {
            showToast('当前环境不支持系统分享', 'warning');
            return;
        }

        try {
            const filename = this.sharePosterFilename || 'fund_list.png';
            const file = new File([this.sharePosterBlob], filename, { type: 'image/png' });
            await navigator.share({
                files: [file],
                title: '基金列表',
                text: ''
            });
        } catch (e) {
            // 用户取消也会抛异常：按提示处理
            showToast('分享已取消或失败', 'warning');
        }
    },

    canSystemShareFiles: function() {
        try {
            if (!navigator || typeof navigator.share !== 'function') return false;
            if (typeof navigator.canShare !== 'function') return false;
            // 以最小 File 测试
            const file = new File([new Blob(['x'], { type: 'text/plain' })], 't.txt', { type: 'text/plain' });
            return navigator.canShare({ files: [file] });
        } catch (e) {
            return false;
        }
    },

    ensureHtml2canvasLoaded: function() {
        if (typeof window.html2canvas === 'function') return Promise.resolve();
        if (this._html2canvasLoadingPromise) return this._html2canvasLoadingPromise;

        this._html2canvasLoadingPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            script.async = true;
            script.onload = () => {
                if (typeof window.html2canvas === 'function') resolve();
                else reject(new Error('截图依赖加载失败'));
            };
            script.onerror = () => reject(new Error('截图依赖加载失败'));
            document.head.appendChild(script);
        });

        return this._html2canvasLoadingPromise;
    },

    renderSharePoster: async function(items) {
        // 使用隔离 iframe 渲染海报，避免页面全局样式（oklch）影响 html2canvas
        const iframe = this.ensureSharePosterIframe();
        if (!iframe) throw new Error('海报渲染容器创建失败');

        const bgDataUrl = await this.getBlurredShareBgDataUrl(10, 1080, 1920);
        const html = this.buildSharePosterHtml(items, bgDataUrl);
        await this.writeSharePosterIframe(iframe, html);

        const doc = iframe.contentDocument;
        if (!doc) throw new Error('海报渲染容器创建失败');

        const root = doc.getElementById('fund-share-poster-root');
        if (!root) throw new Error('海报渲染容器创建失败');

        await this.waitSharePosterAssetsReady(doc);

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const filename = `fund_list_${yyyy}${mm}${dd}_${hh}${mi}${ss}.png`;

        // html2canvas 会通过 element.ownerDocument.defaultView 获取 window
        const canvas = await window.html2canvas(root, {
            backgroundColor: null,
            scale: 1,
            width: 1080,
            height: 1920,
            useCORS: true
        });

        const dataUrl = canvas.toDataURL('image/png');
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
        return { dataUrl, blob, filename };
    },

    getBlurredShareBgDataUrl: async function(blurPx, width, height) {
        const blur = Number(blurPx) || 0;
        const w = Number(width) || 1080;
        const h = Number(height) || 1920;
        const cache = this._blurredBgCache;
        if (cache && cache.blur === blur && cache.w === w && cache.h === h && cache.dataUrl) {
            return cache.dataUrl;
        }

        const dataUrl = await this.buildBlurredBackgroundDataUrl('/static/images/share_bg.png', blur, w, h);
        this._blurredBgCache = { blur, w, h, dataUrl };
        return dataUrl;
    },

    buildBlurredBackgroundDataUrl: async function(srcUrl, blurPx, width, height) {
        const blur = Math.max(0, Number(blurPx) || 0);
        const w = Number(width) || 1080;
        const h = Number(height) || 1920;

        const img = new Image();
        // 同源静态资源；设置 crossOrigin 以兼容未来可能的 CDN/代理场景
        img.crossOrigin = 'anonymous';
        img.src = srcUrl;

        if (typeof img.decode === 'function') {
            try {
                await img.decode();
            } catch (_) {
                await new Promise((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('背景图加载失败'));
                });
            }
        } else {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('背景图加载失败'));
            });
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('背景渲染失败');

        // cover 裁剪：保证填满 w*h
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) throw new Error('背景图尺寸无效');

        const scale = Math.max(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;

        // 为避免 blur 边缘露出清晰边界，先略微 overscan 再绘制
        const overscan = Math.max(8, Math.ceil(blur * 2));
        const ow = w + overscan * 2;
        const oh = h + overscan * 2;
        const oscale = Math.max(ow / iw, oh / ih);
        const odw = iw * oscale;
        const odh = ih * oscale;
        const odx = (ow - odw) / 2 - overscan;
        const ody = (oh - odh) / 2 - overscan;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        if (blur > 0) ctx.filter = `blur(${blur}px)`;
        // 先用 overscan 版本铺底
        ctx.drawImage(img, odx, ody, odw, odh);
        // 再用正常 cover 叠一次（同样 blur），让主体更均匀
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.filter = 'none';

        return canvas.toDataURL('image/png');
    },

    ensureSharePosterIframe: function() {
        let iframe = document.getElementById('fund-share-poster-iframe');
        if (iframe) return iframe;

        iframe = document.createElement('iframe');
        iframe.id = 'fund-share-poster-iframe';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = [
            'position:fixed',
            'left:-100000px',
            'top:0',
            'width:1080px',
            'height:1920px',
            'border:0',
            'overflow:hidden',
            'z-index:-1',
        ].join(';');
        document.body.appendChild(iframe);
        return iframe;
    },

    writeSharePosterIframe: function(iframe, html) {
        return new Promise((resolve, reject) => {
            try {
                const onLoad = () => {
                    iframe.removeEventListener('load', onLoad);
                    resolve();
                };
                iframe.addEventListener('load', onLoad);
                iframe.srcdoc = html;
                // 某些环境不会触发 load（极少数），加一个兜底延迟
                setTimeout(() => {
                    try {
                        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                            iframe.removeEventListener('load', onLoad);
                            resolve();
                        }
                    } catch (_) {}
                }, 80);
            } catch (e) {
                reject(e);
            }
        });
    },

    waitSharePosterAssetsReady: async function(doc) {
        // 等图片资源加载完成，避免截图空白（背景/二维码）
        const imgs = Array.from(doc.querySelectorAll('img[data-role="poster-bg"], img[data-role="poster-qr"]'));
        if (!imgs.length) return;

        const waitOne = async (img) => {
            if (!img) return;
            if (img.complete && img.naturalWidth > 0) return;
            // decode 优先（dataURL 也支持）
            if (typeof img.decode === 'function') {
                try {
                    await img.decode();
                    return;
                } catch (_) {}
            }
            await new Promise(resolve => {
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                // 兜底：最多等 800ms
                setTimeout(done, 800);
            });
        };

        for (const img of imgs) {
            // 顺序等待即可，张数很少
            await waitOne(img);
        }
    },

    buildSharePosterHtml: function(items, bgDataUrl) {
        const safeItems = Array.isArray(items) ? items : [];
        const bgSrc = bgDataUrl ? String(bgDataUrl) : '/static/images/share_bg.png';
        const qrSrc = '/static/images/qr.png';

        const rowsHtml = safeItems.map((item, index) => {
            const fundCode = item && item.fund_code ? String(item.fund_code) : '-';
            const rawName = item && item.fund_name ? String(item.fund_name) : '-';
            // 基金名称：最多 15 个汉字；超出则按“前9…后6”展示
            const fundName = rawName.length > 15 ? (rawName.slice(0, 9) + '…' + rawName.slice(-6)) : rawName;

            const raw = item ? item.percentage : null;
            const value = (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) ? null : Number(raw);
            let pctText = '-';
            let pctClass = 'color: rgba(226,232,240,0.90);';
            if (value === null) {
                pctText = '-';
                pctClass = 'color: rgba(148,163,184,0.90);';
            } else {
                pctText = `${value.toFixed(2)}%`;
                if (value > 0) pctClass = 'color: rgba(248,113,113,0.95); font-weight: 700;';
                else if (value < 0) pctClass = 'color: rgba(52,211,153,0.95); font-weight: 700;';
                else pctClass = 'color: rgba(226,232,240,0.90); font-weight: 700;';
            }

            // 只保留“表格对齐感”，不显示任何行底色块
            const rowBg = 'background: transparent;';
            return `
                <tr style="${rowBg}">
                    <td style="padding: 14px 18px; width: 150px; font-size: 28px; letter-spacing: 0.5px; color: rgba(241,245,249,0.95); font-weight: 700;">${fundCode}</td>
                    <td style="padding: 14px 18px; font-size: 30px; color: rgba(241,245,249,0.95); font-weight: 700;">${fundName}</td>
                    <td style="padding: 14px 18px; width: 160px; text-align: right; font-size: 30px; ${pctClass}">${pctText}</td>
                </tr>
            `;
        }).join('');

        // 注意：这里不要引入任何全局 CSS（daisyui/tailwind），避免 okLCH 被 html2canvas 解析到
        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, initial-scale=1.0" />
    <title>fund-share</title>
</head>
<body style="margin:0; padding:0; background:#000;">
    <div id="fund-share-poster-root" style="position: relative; width:1080px; height:1920px; overflow:hidden;">
        <img data-role="poster-bg" src="${bgSrc}" style="position:absolute; inset:-60px; width:1200px; height:2040px; object-fit:cover; transform: scale(1.06); transform-origin:center;" crossorigin="anonymous" />
        <div style="position:absolute; inset:0; background: rgba(0,0,0,0.34);"></div>

        <!-- 表格区域：为底部二维码留出空间 -->
        <div style="position:absolute; left:72px; right:72px; top:96px; bottom:300px;">
            <div style="position:absolute; inset:0; padding: 28px;">
                <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 底部个人宣传二维码 -->
        <div style="position:absolute; left:0; right:0; bottom:72px; display:flex; align-items:center; justify-content:center;">
            <img data-role="poster-qr" src="${qrSrc}" style="width:220px; height:220px; object-fit:cover; border-radius: 18px;" crossorigin="anonymous" />
        </div>
    </div>
</body>
</html>
        `.trim();
    },

    loadIfNeeded: async function() {
        if (this.isLoaded || this.isLoading) return;

        this.isLoading = true;
        this.render();

        try {
            await this.loadFundTypes();
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

    onDatasourceChanged: async function() {
        // 数据源切换后：前端强制丢弃已加载的数据，确保重新请求基金类型与基金列表
        this.isLoaded = false;
        this.isLoading = false;
        this.allFunds = [];
        this.filteredFunds = [];
        this.total = 0;
        this.availableTypes = [];
        this.selectedFundType = '0';
        this.currentPage = 1;
        this.searchKeyword = '';

        // 如果当前就在基金榜 Tab，立即触发重载；否则等待用户下次点击 Tab 再加载
        const fundTab = document.querySelector('[data-tab="fund-select"]');
        const isActive = fundTab && fundTab.classList.contains('tab-active');
        if (isActive) {
            await this.loadIfNeeded();
        } else {
            this.render();
        }
    },

    loadFundTypes: async function() {
        const res = await fetch('/api/funds/types');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const items = payload && Array.isArray(payload.items) ? payload.items : [];
        this.availableTypes = items;
        // 默认选中“全部”
        if (!this.selectedFundType) {
            this.selectedFundType = '0';
        }
        this.renderTypeOptions();
    },

    reloadData: async function() {
        const fundUrl = this.buildFundsApiUrl(1);
        const [fundResponse, favoriteResponse, groupResponse, membershipResponse] = await Promise.all([
            fetch(fundUrl),
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

        this.applyFundPageResponse(fundData);
        this.favoriteFunds = Array.isArray(favoriteData) ? favoriteData : [];
        this.favoriteFundCodes = new Set(this.favoriteFunds.map(item => item.fund_code));
        this.favoriteGroups = Array.isArray(groupData) ? groupData : [];
        this.favoriteMemberships = Array.isArray(membershipData) ? membershipData : [];
        // types 下拉由 /api/funds/types 提供，这里不再覆盖
        this.ensureSelectedFavoriteGroup();
    },

    buildFundsApiUrl: function(pageNum) {
        const params = new URLSearchParams();
        params.set('pageNum', String(pageNum || 1));
        params.set('pageSize', String(this.pageSize || 20));
        if (this.searchKeyword) params.set('q', this.searchKeyword);
        params.set('fund_type_code', this.selectedFundType || '0');
        return `/api/funds?${params.toString()}`;
    },

    applyFundPageResponse: function(payload) {
        const pageNum = payload && typeof payload.pageNum === 'number' ? payload.pageNum : 1;
        const pageSize = payload && typeof payload.pageSize === 'number' ? payload.pageSize : (this.pageSize || 20);
        const total = payload && typeof payload.total === 'number' ? payload.total : 0;
        const items = payload && Array.isArray(payload.items) ? payload.items : [];

        this.currentPage = pageNum;
        this.pageSize = pageSize;
        this.total = total;
        this.allFunds = items;
        this.filteredFunds = items;
    },

    renderTypeOptions: function() {
        const typeSelect = document.getElementById('fund-search-type');
        if (!typeSelect) return;

        // 类型来源统一由 /api/funds/types 提供，这里不再做“从基金列表去重”的逻辑
        const items = Array.isArray(this.availableTypes) ? this.availableTypes : [];
        if (items.length === 0) {
            typeSelect.innerHTML = '<option value="0">全部</option>';
            typeSelect.value = '0';
            return;
        }

        typeSelect.innerHTML = '';
        items.forEach(item => {
            const option = document.createElement('option');
            if (typeof item === 'string') {
                option.value = item;
                option.textContent = item;
            } else {
                option.value = String(item.fund_type_code || '');
                option.textContent = String(item.fund_type_name || '');
            }
            typeSelect.appendChild(option);
        });

        // 默认选中“全部(0)”
        if (!this.selectedFundType) {
            this.selectedFundType = '0';
        }
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
        if (this.selectedScope === 'today-best') {
            // 今日牛基：进入即自动计算一次；调整条件后由“刷新”显式触发重算
            if (!this.todayBestRunning) {
                void this.startTodayBest({ clear: true });
            }
            this.render();
            return;
        }
        if (this.selectedScope === 'favorite') {
            // 自选视图按 favorites.csv 本地过滤/分页（不再依赖基金全量列表）
            this.filteredFunds = this.getFavoriteRowsBySelectedGroup();
            this.total = this.filteredFunds.length;
            this.currentPage = 1;
            this.render();
            return;
        }

        // 全部视图：后端筛选+分页
        this.currentPage = 1;
        this.fetchFundPage(1);
    },

    getFavoriteRowsBySelectedGroup: function() {
        const groupId = this.selectedFavoriteGroupId;
        const fundCodes = new Set(
            this.favoriteMemberships
                .filter(item => item.group_id === groupId)
                .map(item => item.fund_code)
        );

        const rows = this.favoriteFunds.filter(item => fundCodes.has(item.fund_code));
        // 自选行不再从全量基金表补齐 fund_type/percentage
        return rows.map(item => ({
            fund_code: item.fund_code,
            fund_name: item.fund_name,
            fund_type: '',
            percentage: null
        }));
    },

    switchScope: function(scope) {
        if (scope !== 'all' && scope !== 'favorite' && scope !== 'today-best') return;
        if (this.selectedScope === 'today-best' && scope !== 'today-best') {
            this.stopTodayBest();
        }
        this.selectedScope = scope;
        this.applyFilters();
    },

    // ===== 今日牛基（today-best）=====
    setTodayBestTopN: function(n) {
        const topnInput = document.getElementById('today-best-topn');
        const v = parseInt(String(n || ''), 10);
        this.todayBestTopN = Number.isFinite(v) ? Math.max(1, Math.min(200, v)) : 1;
        if (topnInput) topnInput.value = String(this.todayBestTopN);
    },

    todayBestSelectAllTypes: function() {
        // 为空表示“不限制”
        this.todayBestSelectedTypes = new Set();
        this.renderTodayBestTypeOptions();
    },

    todayBestClearTypes: function() {
        // 清空筛选：等价“不限制”
        this.todayBestSelectedTypes = new Set();
        this.renderTodayBestTypeOptions();
    },

    toggleTodayBestType: function(value) {
        const v = String(value || '').trim();
        if (!v) return;
        const all = Array.isArray(this.todayBestAllTypes) ? this.todayBestAllTypes : [];
        const allValues = all.map(x => x.value);
        if (allValues.length === 0) return;

        const selected = (this.todayBestSelectedTypes instanceof Set) ? this.todayBestSelectedTypes : new Set();
        const isAllSelected = selected.size === 0;

        if (isAllSelected) {
            // 从“全选”状态切到“部分选择”：先把所有值填入，再做 toggle
            this.todayBestSelectedTypes = new Set(allValues);
        }

        const s = this.todayBestSelectedTypes;
        if (s.has(v)) s.delete(v);
        else s.add(v);

        // 如果最终选中数量等于全量，回到“不限制”（用空 set 表达）
        if (s.size === allValues.length) {
            this.todayBestSelectedTypes = new Set();
        }
        this.renderTodayBestTypeOptions();
    },

    refreshTodayBest: function() {
        // 清空之后再刷新
        this.stopTodayBest();
        void this.startTodayBest({ clear: true });
    },

    stopTodayBest: function() {
        // 取消轮询
        if (this.todayBestPollTimer) {
            try { clearInterval(this.todayBestPollTimer); } catch (e) { /* ignore */ }
        }
        this.todayBestPollTimer = null;

        // 取消后端任务（尽力而为）
        const jobId = String(this.todayBestJobId || '').trim();
        if (jobId) {
            fetch(`/api/today-best/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(() => {});
        }

        this.todayBestAbortController = null;
        this.todayBestJobId = '';
        this.todayBestRunning = false;
        this.renderTodayBestProgress();
    },

    startTodayBest: async function(options) {
        const opts = options || {};
        if (this.todayBestRunning) return;

        if (opts.clear) {
            this.todayBestRows = [];
            this.todayBestProgress = { done: 0, total: 0, hit: 0, failed: 0 };
            this.todayBestAllTypes = [];
            this.todayBestJobId = '';
            this.render();
        }

        // 创建后端任务
        const periodCode = String(this.todayBestPeriodCode || 'Z').trim() || 'Z';
        const topN = Math.max(1, Math.min(200, parseInt(String(this.todayBestTopN || 1), 10) || 1));
        const minReturn = (this.todayBestMinReturn === null || this.todayBestMinReturn === undefined) ? null : Number(this.todayBestMinReturn);
        const selectedTypes = (this.todayBestSelectedTypes instanceof Set) ? this.todayBestSelectedTypes : new Set();
        const selectedTypesArr = Array.from(selectedTypes);

        try {
            this.todayBestRunning = true;
            this.renderTodayBestProgress();
            this.render();

            const res = await fetch('/api/today-best/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    period_code: periodCode,
                    top_n: topN,
                    min_return: (minReturn === null || minReturn === undefined || Number.isNaN(minReturn)) ? null : minReturn,
                    selected_types: selectedTypesArr
                })
            });
            const payload = await res.json();
            if (!res.ok || !payload || !payload.success) {
                throw new Error(payload && payload.message ? payload.message : `HTTP ${res.status}`);
            }
            const jobId = String(payload.job_id || '').trim();
            if (!jobId) throw new Error('任务创建失败：job_id 为空');
            this.todayBestJobId = jobId;

            // 轮询进度
            if (this.todayBestPollTimer) {
                try { clearInterval(this.todayBestPollTimer); } catch (e) {}
            }
            const pollOnce = async () => {
                const id = String(this.todayBestJobId || '').trim();
                if (!id) return;
                try {
                    const r = await fetch(`/api/today-best/jobs/${encodeURIComponent(id)}`);
                    const data = await r.json();
                    if (!r.ok || !data || !data.success) {
                        throw new Error(data && data.message ? data.message : `HTTP ${r.status}`);
                    }
                    const status = String(data.status || '').trim();
                    const prog = data.progress || {};
                    this.todayBestProgress = {
                        done: Number(prog.done || 0) || 0,
                        total: Number(prog.total || 0) || 0,
                        hit: Number(prog.hit || 0) || 0,
                        failed: Number(prog.failed || 0) || 0,
                    };
                    this.todayBestRunning = status === 'running' || status === 'pending';
                    this.renderTodayBestProgress();

                    if (status === 'done') {
                        const result = data.result || {};
                        this.todayBestRows = Array.isArray(result.rows) ? result.rows : [];
                        this.todayBestAllTypes = Array.isArray(result.types) ? result.types : [];
                        this.todayBestSelectedTypes = new Set(); // done 后默认“不限制”，用户可重新勾选并刷新
                        this.todayBestRunning = false;
                        this.render();
                        showToast(`计算完成：命中${this.todayBestRows.length}，失败${this.todayBestProgress.failed}`, 'success');
                        if (this.todayBestPollTimer) {
                            try { clearInterval(this.todayBestPollTimer); } catch (e) {}
                            this.todayBestPollTimer = null;
                        }
                    } else if (status === 'error') {
                        const msg = (data.error && data.error.message) ? data.error.message : '任务失败';
                        this.todayBestRunning = false;
                        this.render();
                        showToast('今日牛基计算失败: ' + msg, 'error');
                        if (this.todayBestPollTimer) {
                            try { clearInterval(this.todayBestPollTimer); } catch (e) {}
                            this.todayBestPollTimer = null;
                        }
                    } else if (status === 'canceled') {
                        this.todayBestRunning = false;
                        this.render();
                        if (this.todayBestPollTimer) {
                            try { clearInterval(this.todayBestPollTimer); } catch (e) {}
                            this.todayBestPollTimer = null;
                        }
                    }
                } catch (e) {
                    // 轮询失败：不频繁 toast，留在进度区即可
                } finally {
                    this.renderTodayBestProgress();
                }
            };

            // 先立即 poll 一次，再定时
            await pollOnce();
            this.todayBestPollTimer = setInterval(() => { void pollOnce(); }, 1200);
        } catch (e) {
            this.todayBestRunning = false;
            showToast('今日牛基任务启动失败: ' + (e && e.message ? e.message : String(e)), 'error');
            this.renderTodayBestProgress();
            this.render();
        }
    },

    parseOverviewItemsToTodayBestRow: function(fundCode, fundName, items, periodCode) {
        const code = String(fundCode || '').trim();
        if (!code) return null;
        const name = String(fundName || '').trim();
        const p = String(periodCode || 'Z').trim().toUpperCase() || 'Z';

        let rank = null;
        let sc = null;
        let syl = null;
        let fundTypeValue = '';
        let fundTypeName = '';

        const toInt = (v) => {
            if (v === null || v === undefined) return null;
            const s = String(v).trim();
            if (!s || s === '--') return null;
            const n = parseInt(s, 10);
            return Number.isFinite(n) ? n : null;
        };
        const toNum = (v) => {
            if (v === null || v === undefined) return null;
            const s = String(v).replace('%', '').trim();
            if (!s || s === '--') return null;
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        };

        (items || []).forEach(it => {
            if (!it) return;
            const section = String(it.section || '').trim();
            const key = String(it.key || '').trim();
            const value = it.value;

            if (section === 'JDZF') {
                if (key === `${p}.rank`) rank = toInt(value);
                else if (key === `${p}.sc`) sc = toInt(value);
                else if (key === `${p}.syl`) syl = toNum(value);
                return;
            }
            if (section === 'JJXQ') {
                // 类型字段以实际返回为准：优先 FUNDTYPE
                if (key === 'FUNDTYPE' || key === 'FUNDTYPECODE') {
                    fundTypeValue = String(value || '').trim();
                    fundTypeName = fundTypeValue;
                }
            }
        });

        // 缺 rank/sc：直接排除
        if (rank === null || sc === null) return null;

        return {
            fund_code: code,
            fund_name: name,
            fund_type_value: fundTypeValue,
            fund_type_name: fundTypeName,
            returnPct: syl,
            rank,
            sc
        };
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
        // 全部视图：this.filteredFunds 已经是后端分页后的当页数据
        if (this.selectedScope !== 'favorite') {
            return this.filteredFunds;
        }
        // 自选视图：本地分页
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return this.filteredFunds.slice(start, end);
    },

    getTotalPages: function() {
        if (!this.total || this.total <= 0) return 0;
        return Math.ceil(this.total / this.pageSize);
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
        if (this.selectedScope === 'favorite') {
            this.render();
        } else {
            this.fetchFundPage(page);
        }
    },

    render: function() {
        this.renderScopeButtons();
        this.renderDiscoveryFilters();
        this.renderTodayBestFilters();
        this.renderFavoriteToolbar();
        this.renderKeywordClearButton();
        this.renderContent();
        this.renderPagination();
    },

    renderScopeButtons: function() {
        const allButton = document.getElementById('fund-scope-all');
        const favoriteButton = document.getElementById('fund-scope-favorite');
        const todayBestButton = document.getElementById('fund-scope-today-best');
        if (!allButton || !favoriteButton || !todayBestButton) return;

        const isAll = this.selectedScope === 'all';
        const isFav = this.selectedScope === 'favorite';
        const isToday = this.selectedScope === 'today-best';
        allButton.className = `btn btn-sm ${isAll ? 'btn-primary' : 'btn-outline'}`;
        favoriteButton.className = `btn btn-sm ${isFav ? 'btn-primary' : 'btn-outline'}`;
        todayBestButton.className = `btn btn-sm ${isToday ? 'btn-primary' : 'btn-outline'}`;
    },

    renderDiscoveryFilters: function() {
        const discoveryFilters = document.getElementById('fund-discovery-filters');
        if (!discoveryFilters) return;
        discoveryFilters.classList.toggle('hidden', this.selectedScope !== 'all');
    },

    renderTodayBestFilters: function() {
        const wrap = document.getElementById('today-best-filters');
        if (!wrap) return;
        const isOn = this.selectedScope === 'today-best';
        wrap.classList.toggle('hidden', !isOn);
        if (!isOn) return;

        const periodSelect = document.getElementById('today-best-period');
        const topnInput = document.getElementById('today-best-topn');
        const minReturnInput = document.getElementById('today-best-min-return');
        if (periodSelect) periodSelect.value = this.todayBestPeriodCode || 'Z';
        if (topnInput) topnInput.value = String(this.todayBestTopN || 1);
        if (minReturnInput) minReturnInput.value = (this.todayBestMinReturn === null || this.todayBestMinReturn === undefined) ? '' : String(this.todayBestMinReturn);

        this.renderTodayBestTypeOptions();
        this.renderTodayBestProgress();
    },

    renderTodayBestProgress: function() {
        const el = document.getElementById('today-best-progress');
        if (!el) return;
        const p = this.todayBestProgress || { done: 0, total: 0, hit: 0, failed: 0 };
        if (this.todayBestRunning) {
            el.textContent = `正在计算：已处理 ${p.done}/${p.total}，命中 ${p.hit}，失败 ${p.failed}`;
        } else if (p.total > 0) {
            el.textContent = `计算完成：已处理 ${p.done}/${p.total}，命中 ${p.hit}，失败 ${p.failed}`;
        } else {
            el.textContent = '未开始计算';
        }
    },

    renderTodayBestTypeOptions: function() {
        const listEl = document.getElementById('today-best-type-list');
        const labelEl = document.getElementById('today-best-type-label');
        if (!listEl || !labelEl) return;

        const all = Array.isArray(this.todayBestAllTypes) ? this.todayBestAllTypes : [];
        if (all.length === 0) {
            listEl.innerHTML = '<div class="text-sm text-slate-400">类型列表将在计算过程中自动补全</div>';
            labelEl.textContent = '全部类型';
            return;
        }

        const selected = this.todayBestSelectedTypes instanceof Set ? this.todayBestSelectedTypes : new Set();
        const isAllSelected = selected.size === 0;
        const selectedCount = isAllSelected ? all.length : Array.from(selected).filter(v => all.some(x => x.value === v)).length;
        labelEl.textContent = isAllSelected ? '全部类型' : `已选 ${selectedCount} 项`;

        listEl.innerHTML = all.map(t => {
            const checked = isAllSelected || selected.has(t.value);
            const encodedValue = encodeURIComponent(String(t.value || ''));
            return `
                <label class="label cursor-pointer justify-start gap-2 py-1">
                    <input type="checkbox" class="checkbox checkbox-sm" ${checked ? 'checked' : ''} onchange="FundSelector.toggleTodayBestType(decodeURIComponent('${encodedValue}'))">
                    <span class="label-text text-sm">${t.label || t.value}</span>
                </label>
            `;
        }).join('');
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

        if (this.selectedScope === 'today-best') {
            const n = Array.isArray(this.todayBestRows) ? this.todayBestRows.length : 0;
            summaryEl.textContent = `今日牛基命中 ${n} 条`;
            return;
        }

        if (this.selectedScope === 'favorite') {
            const group = this.favoriteGroups.find(item => item.group_id === this.selectedFavoriteGroupId);
            summaryEl.textContent = `${group ? group.group_name : '当前分组'} 共 ${this.total} 条`;
            return;
        }

        summaryEl.textContent = `全部共 ${this.total} 条`;
    },

    renderContent: function() {
        const loadingEl = document.getElementById('fund-select-loading');
        const emptyEl = document.getElementById('fund-select-empty');
        const tableWrapper = document.getElementById('fund-select-table-wrapper');
        const todayBestTableWrapper = document.getElementById('today-best-table-wrapper');
        const emptyTitle = document.getElementById('fund-empty-title');
        const emptyDesc = document.getElementById('fund-empty-desc');
        const tbody = document.getElementById('fund-select-table-body');
        const todayBestTbody = document.getElementById('today-best-table-body');

        if (!loadingEl || !emptyEl || !tableWrapper || !todayBestTableWrapper || !emptyTitle || !emptyDesc || !tbody || !todayBestTbody) return;

        loadingEl.classList.add('hidden');
        emptyEl.classList.add('hidden');
        tableWrapper.classList.add('hidden');
        todayBestTableWrapper.classList.add('hidden');

        // 今日牛基：独立渲染（不走分页/后端列表）
        if (this.selectedScope === 'today-best') {
            const rows = Array.isArray(this.todayBestRows) ? this.todayBestRows : [];
            if (this.todayBestRunning && rows.length === 0) {
                emptyTitle.textContent = '正在计算...';
                emptyDesc.textContent = '已在后台遍历基金详情，请稍候。';
                emptyEl.classList.remove('hidden');
                todayBestTbody.innerHTML = '';
                this.renderSummary();
                return;
            }

            if (!this.todayBestRunning && rows.length === 0) {
                emptyTitle.textContent = '暂无命中结果';
                emptyDesc.textContent = '请调整筛选条件后点击“刷新”。';
                emptyEl.classList.remove('hidden');
                todayBestTbody.innerHTML = '';
                this.renderSummary();
                return;
            }

            todayBestTbody.innerHTML = rows.map((r, idx) => {
                const syl = (r && typeof r.returnPct === 'number' && Number.isFinite(r.returnPct))
                    ? ((r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2) + '%')
                    : '-';
                const sylStyle = (r && typeof r.returnPct === 'number' && Number.isFinite(r.returnPct))
                    ? (r.returnPct > 0 ? 'color:#ef4444;' : r.returnPct < 0 ? 'color:#22c55e;' : '')
                    : '';
                const rankText = (r && r.rank && r.sc) ? `${r.rank}/${r.sc}` : (r && r.rankText ? r.rankText : '-');
                return `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>${r.fund_code || '-'}</td>
                        <td>${r.fund_name || '-'}</td>
                        <td>${r.fund_type_name || '-'}</td>
                        <td><span style="${sylStyle}">${syl}</span></td>
                        <td>${rankText}</td>
                        <td>
                            <div class="flex items-center gap-2 whitespace-nowrap w-full">
                                <div class="tooltip" data-tip="${this.isFavorite(r.fund_code) ? '取消自选' : '加入自选'}">
                                    <button type="button" class="btn btn-xs favorite-btn ${this.isFavorite(r.fund_code) ? 'is-active' : ''}" onclick="FundSelector.toggleFavorite('${r.fund_code || ''}')" title="${this.isFavorite(r.fund_code) ? '取消自选' : '加入自选'}">
                                        <span class="favorite-btn-icon ${this.isFavorite(r.fund_code) ? 'is-active' : ''}">${this.isFavorite(r.fund_code) ? '★' : '☆'}</span>
                                    </button>
                                </div>
                                <div class="tooltip" data-tip="详情">
                                    <button type="button" class="btn btn-outline btn-xs fund-action-detail" onclick="FundSelector.showDetail('${r.fund_code || ''}')" title="详情">详情</button>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            todayBestTableWrapper.classList.remove('hidden');
            this.renderSummary();
            return;
        }

        if (this.isLoading) {
            loadingEl.classList.remove('hidden');
            this.renderSummary();
            return;
        }

        if (this.selectedScope !== 'favorite' && this.total === 0) {
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
        const startIndex = this.selectedScope === 'favorite' ? (this.currentPage - 1) * this.pageSize : (this.currentPage - 1) * this.pageSize;
        tbody.innerHTML = currentPageData.map((item, index) => `
            <tr>
                <td>${startIndex + index + 1}</td>
                <td>${item.fund_code || '-'}</td>
                <td>${item.fund_name || '-'}</td>
                <td>${item.fund_type_name || '-'}</td>
                <td>${this.renderPercentageCell(item)}</td>
                <td>
                    <div class="flex items-center gap-2 whitespace-nowrap w-full">
                        <div class="tooltip" data-tip="${this.isFavorite(item.fund_code) ? '取消自选' : '加入自选'}">
                            <button type="button" class="btn btn-xs favorite-btn ${this.isFavorite(item.fund_code) ? 'is-active' : ''}" onclick="FundSelector.toggleFavorite('${item.fund_code || ''}')" title="${this.isFavorite(item.fund_code) ? '取消自选' : '加入自选'}">
                                <span class="favorite-btn-icon ${this.isFavorite(item.fund_code) ? 'is-active' : ''}">${this.isFavorite(item.fund_code) ? '★' : '☆'}</span>
                            </button>
                        </div>
                        ${(this.selectedScope === 'favorite' && this.isFavorite(item.fund_code)) ? `
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

    fetchFundPage: async function(pageNum) {
        this.isLoading = true;
        this.render();
        try {
            const url = this.buildFundsApiUrl(pageNum);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = await res.json();
            this.applyFundPageResponse(payload);
            this.renderTypeOptions();
        } catch (error) {
            showToast('加载基金列表失败: ' + (error.message || ''), 'error');
            this.allFunds = [];
            this.filteredFunds = [];
            this.total = 0;
        } finally {
            this.isLoading = false;
            this.render();
        }
    },

    renderPercentageCell: function(item) {
        const raw = item ? item.percentage : null;
        const value = (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) ? null : Number(raw);
        if (value === null) {
            return `<span class="text-slate-400">-</span>`;
        }

        const text = `${value.toFixed(2)}%`;
        if (value > 0) {
            // 红涨
            return `<span class="font-medium text-red-400">${text}</span>`;
        }
        if (value < 0) {
            // 绿跌
            return `<span class="font-medium text-green-400">${text}</span>`;
        }
        return `<span class="font-medium text-slate-200">${text}</span>`;
    },

    renderPagination: function() {
        const paginationEl = document.getElementById('fund-select-pagination');
        const paginationButtonsEl = document.getElementById('fund-select-pagination-buttons');
        if (!paginationEl || !paginationButtonsEl) return;

        if (this.selectedScope === 'today-best') {
            paginationEl.classList.add('hidden');
            paginationButtonsEl.innerHTML = '';
            return;
        }

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
        this.detailItems = null;
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
            if (!result.items || !Array.isArray(result.items) || result.items.length === 0) {
                throw new Error('暂无基金详情数据');
            }
            this.detailItems = result.items;
        } catch (error) {
            this.detailError = error.message;
            showToast('加载基金详情失败: ' + error.message, 'error');
        } finally {
            this.detailLoading = false;
            this.renderDetailModal(fund);
        }
    },

    switchDetailTab: function(tabKey) {
        const tabs = document.querySelectorAll('[data-detail-tab]');
        tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.detailTab === tabKey));

        const panels = ['JJXQ', 'JDZF', 'JJGM', 'JJCC', 'JJJL'];
        panels.forEach(key => {
            const el = document.getElementById(`fund-detail-panel-${key}`);
            if (!el) return;
            const isTarget = key === tabKey;
            el.classList.toggle('hidden', !isTarget);
            el.style.display = isTarget ? 'block' : 'none';
        });

        // Chart.js 在容器 display:none 时初始化可能拿不到宽度，切到 JDZF 时主动 resize/update
        if (tabKey === 'JDZF') {
            setTimeout(() => {
                if (this._jdzfChart) {
                    try {
                        this._jdzfChart.resize();
                        this._jdzfChart.update();
                    } catch (e) { /* ignore */ }
                } else if (this._lastJdzfModel) {
                    const canvasEl = document.getElementById('fund-detail-jdzf-chart');
                    const rankBody = document.getElementById('fund-detail-jdzf-rank-body');
                    this.renderJdzfChart(this._lastJdzfModel, canvasEl);
                    this.renderJdzfRankTable(this._lastJdzfModel, rankBody);
                }
            }, 0);
        }

        if (tabKey === 'JJGM') {
            setTimeout(() => {
                if (this._jjgmChart) {
                    try {
                        this._jjgmChart.resize();
                        this._jjgmChart.update();
                    } catch (e) { /* ignore */ }
                } else if (this._lastJjgmModel) {
                    const canvasEl = document.getElementById('fund-detail-jjgm-chart');
                    this.renderJjgmScaleChart(this._lastJjgmModel, canvasEl);
                }
            }, 0);
        }

        if (tabKey === 'JJCC') {
            setTimeout(() => {
                if (this._jjccStockChart || this._jjccAssetChart || this._jjccSectorChart) {
                    try {
                        if (this._jjccStockChart) { this._jjccStockChart.resize(); this._jjccStockChart.update(); }
                        if (this._jjccAssetChart) { this._jjccAssetChart.resize(); this._jjccAssetChart.update(); }
                        if (this._jjccSectorChart) { this._jjccSectorChart.resize(); this._jjccSectorChart.update(); }
                    } catch (e) { /* ignore */ }
                } else if (this._lastJjccPieModels) {
                    this.renderJjccPies(this._lastJjccPieModels);
                }
            }, 0);
        }

        // 切换 Tab 后根据当前内容动态调整弹框高度（并在需要时开启内部滚动）
        setTimeout(() => {
            this.adjustDetailModalHeight(tabKey);
        }, 30);
    },

    adjustDetailModalHeight: function(tabKey) {
        const modal = document.getElementById('fund-detail-modal');
        if (!modal || !modal.open) return;
        const modalBox = modal.querySelector('.fund-detail-modal-box');
        const content = document.getElementById('fund-detail-content');
        if (!modalBox || !content || content.classList.contains('hidden')) return;

        const header = modalBox.querySelector('.flex.items-start.justify-between') || modalBox.querySelector('.flex.items-start');
        const tabs = modalBox.querySelector('#fund-detail-content > .tabs');

        const pickActivePanel = () => {
            if (tabKey) {
                const el = document.getElementById(`fund-detail-panel-${tabKey}`);
                if (el && !el.classList.contains('hidden') && el.style.display !== 'none') return el;
            }
            const keys = ['JJXQ', 'JDZF', 'JJGM', 'JJCC'];
            for (let i = 0; i < keys.length; i++) {
                const el = document.getElementById(`fund-detail-panel-${keys[i]}`);
                if (!el) continue;
                if (!el.classList.contains('hidden') && el.style.display !== 'none') return el;
            }
            return null;
        };

        const activePanel = pickActivePanel();
        if (!activePanel) return;

        // 先移除滚动限制以便准确测量真实内容高度
        content.classList.remove('fund-detail-content-scroll');
        content.style.maxHeight = '';
        content.style.flex = '';

        const styleBox = window.getComputedStyle(modalBox);
        const padTop = parseFloat(styleBox.paddingTop || '0') || 0;
        const padBottom = parseFloat(styleBox.paddingBottom || '0') || 0;

        const headerH = header ? header.offsetHeight : 0;
        const headerMb = header ? (parseFloat(window.getComputedStyle(header).marginBottom || '0') || 0) : 0;
        const tabsH = tabs ? tabs.offsetHeight : 0;
        const tabsMb = tabs ? (parseFloat(window.getComputedStyle(tabs).marginBottom || '0') || 0) : 0;

        const panelH = activePanel.scrollHeight;
        // 额外预留一些空间，避免边缘溢出（滚动条、边框、阴影等）
        const extra = 16;

        const target = padTop + padBottom + headerH + headerMb + tabsH + tabsMb + panelH + extra;
        const maxH = Math.floor(window.innerHeight * 0.96);
        const finalH = Math.min(target, maxH);

        modalBox.style.height = `${finalH}px`;

        // 超过屏幕上限时：让内容区滚动（Tab sticky 保留）
        if (target > maxH) {
            const contentMax = Math.max(120, finalH - (padTop + padBottom + headerH + headerMb) - extra);
            content.classList.add('fund-detail-content-scroll');
            content.style.flex = '1';
            content.style.maxHeight = `${contentMax}px`;
        } else {
            // 内容不多：恢复自适应高度
            content.classList.remove('fund-detail-content-scroll');
            content.style.maxHeight = '';
            content.style.flex = '';
        }
    },

    renderDetailModal: function(fund) {
        const titleEl = document.getElementById('fund-detail-title');
        const loadingEl = document.getElementById('fund-detail-loading');
        const errorEl = document.getElementById('fund-detail-error');
        const errorTextEl = document.getElementById('fund-detail-error-text');
        const contentEl = document.getElementById('fund-detail-content');
        const jjxqBody = document.getElementById('fund-detail-jjxq-body');
        const jdzfRankBody = document.getElementById('fund-detail-jdzf-rank-body');
        const jdzfChartCanvas = document.getElementById('fund-detail-jdzf-chart');
        const jjgmChartCanvas = document.getElementById('fund-detail-jjgm-chart');
        const jjccStockCanvas = document.getElementById('fund-detail-jjcc-stock-chart');
        const jjccAssetCanvas = document.getElementById('fund-detail-jjcc-asset-chart');
        const jjccSectorCanvas = document.getElementById('fund-detail-jjcc-sector-chart');
        const jjgmPre = document.getElementById('fund-detail-jjgm-pre');
        const jjccPre = document.getElementById('fund-detail-jjcc-pre');
        if (!titleEl || !loadingEl || !errorEl || !errorTextEl || !contentEl || !jjxqBody || !jdzfRankBody || !jdzfChartCanvas || !jjgmChartCanvas || !jjccStockCanvas || !jjccAssetCanvas || !jjccSectorCanvas || !jjgmPre || !jjccPre) return;

        titleEl.textContent = fund && fund.fund_name ? fund.fund_name : '基金详情';
        loadingEl.classList.add('hidden');
        errorEl.classList.add('hidden');
        contentEl.classList.add('hidden');

        if (this.detailLoading) {
            loadingEl.classList.remove('hidden');
            jjxqBody.innerHTML = '';
            jdzfRankBody.innerHTML = '';
            jjgmPre.textContent = '';
            jjccPre.textContent = '';
            this.destroyJdzfChart();
            this.destroyJjgmChart();
            this.destroyJjccCharts();
            return;
        }
        if (this.detailError) {
            errorTextEl.textContent = this.detailError;
            errorEl.classList.remove('hidden');
            jjxqBody.innerHTML = '';
            jdzfRankBody.innerHTML = '';
            jjgmPre.textContent = '';
            jjccPre.textContent = '';
            this.destroyJdzfChart();
            this.destroyJjgmChart();
            this.destroyJjccCharts();
            return;
        }
        if (!this.detailItems || !Array.isArray(this.detailItems) || this.detailItems.length === 0) {
            errorTextEl.textContent = '暂无基金详情数据';
            errorEl.classList.remove('hidden');
            jjxqBody.innerHTML = '';
            jdzfRankBody.innerHTML = '';
            jjgmPre.textContent = '';
            jjccPre.textContent = '';
            this.destroyJdzfChart();
            this.destroyJjgmChart();
            this.destroyJjccCharts();
            return;
        }

        // 绑定 tab 点击（只绑定一次）
        if (!this._detailTabsBound) {
            this._detailTabsBound = true;
            document.querySelectorAll('[data-detail-tab]').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.switchDetailTab(tab.dataset.detailTab);
                });
            });
        }

        const groups = { JJXQ: [], JDZF: [], JJGM: [], JJCC: [], JJJL: [] };
        this.detailItems.forEach(item => {
            const section = (item && item.section) ? String(item.section) : 'JJXQ';
            if (!groups[section]) groups[section] = [];
            groups[section].push(item);
        });

        // JJXQ：一行展示 2 个 KV（4 列）
        const jjxq = groups.JJXQ || [];
        let jjxqHtml = '';
        for (let i = 0; i < jjxq.length; i += 2) {
            const left = jjxq[i] || {};
            const right = jjxq[i + 1] || null;
            const leftLabel = left.label || left.key || '';
            const leftValue = (left.value !== undefined && left.value !== null && String(left.value).trim() !== '') ? left.value : '-';
            const rightLabel = right ? (right.label || right.key || '') : '';
            const rightValue = right ? (((right.value !== undefined && right.value !== null && String(right.value).trim() !== '') ? right.value : '-')) : '';
            jjxqHtml += `
                <tr>
                    <th class="w-36 text-xs text-slate-300 align-top">${leftLabel}</th>
                    <td class="text-sm text-slate-100 break-words whitespace-normal">${leftValue}</td>
                    <th class="w-36 text-xs text-slate-300 align-top">${rightLabel}</th>
                    <td class="text-sm text-slate-100 break-words whitespace-normal">${rightValue}</td>
                </tr>
            `;
        }
        jjxqBody.innerHTML = jjxqHtml;

        // JDZF：折线图 + 排名表
        const model = this.buildJdzfModel(groups.JDZF || []);
        this._lastJdzfModel = model;
        this.renderJdzfChart(model, jdzfChartCanvas);
        this.renderJdzfRankTable(model, jdzfRankBody);

        const jjgmRaw = (groups.JJGM || []).find(x => x && x.key === 'raw');
        const jjccRaw = (groups.JJCC || []).find(x => x && x.key === 'raw');
        const jjjlRaw = (groups.JJJL || []).find(x => x && x.key === 'raw');
        jjgmPre.textContent = jjgmRaw ? (jjgmRaw.value || '') : '';
        jjccPre.textContent = jjccRaw ? (jjccRaw.value || '') : '';

        // JJGM：基金规模（按日期柱状图）
        const jjgmModel = this.buildJjgmScaleModel(jjgmRaw ? (jjgmRaw.value || '') : '');
        this._lastJjgmModel = jjgmModel;
        this.renderJjgmScaleChart(jjgmModel, jjgmChartCanvas);

        // JJCC：基金持仓（3 个饼图：股票/资产/行业）
        const jjccPieModels = this.buildJjccPieModels(jjccRaw ? (jjccRaw.value || '') : '');
        this._lastJjccPieModels = jjccPieModels;
        this.renderJjccPies(jjccPieModels, { stock: jjccStockCanvas, asset: jjccAssetCanvas, sector: jjccSectorCanvas });

        // JJJL：基金经理（表格）
        const jjjlBody = document.getElementById('fund-detail-jjjl-body');
        const jjjlModel = this.buildJjjlModel(jjjlRaw ? (jjjlRaw.value || '') : '');
        this.renderJjjlTable(jjjlModel, jjjlBody);

        // 默认展示 JJXQ
        this.switchDetailTab('JJXQ');
        contentEl.classList.remove('hidden');
        // 初次渲染后调整一次高度
        setTimeout(() => {
            this.adjustDetailModalHeight('JJXQ');
        }, 0);
    },

    destroyJdzfChart: function() {
        if (this._jdzfChart) {
            try { this._jdzfChart.destroy(); } catch (e) { /* ignore */ }
            this._jdzfChart = null;
        }
    },

    destroyJjgmChart: function() {
        if (this._jjgmChart) {
            try { this._jjgmChart.destroy(); } catch (e) { /* ignore */ }
            this._jjgmChart = null;
        }
    },

    destroyJjccCharts: function() {
        if (this._jjccStockChart) { try { this._jjccStockChart.destroy(); } catch (e) {} this._jjccStockChart = null; }
        if (this._jjccAssetChart) { try { this._jjccAssetChart.destroy(); } catch (e) {} this._jjccAssetChart = null; }
        if (this._jjccSectorChart) { try { this._jjccSectorChart.destroy(); } catch (e) {} this._jjccSectorChart = null; }
    },

    buildJjgmScaleModel: function(jjgmRawText) {
        if (!jjgmRawText || jjgmRawText === '--') return null;
        let payload = null;
        try { payload = JSON.parse(jjgmRawText); } catch (e) { return null; }
        const datas = payload && payload.Datas;
        if (!Array.isArray(datas) || datas.length === 0) return null;

        const labels = [];
        const valuesYuan = [];
        datas.forEach(row => {
            if (!row || typeof row !== 'object') return;
            const date = String(row.FSRQ || '').trim();
            const raw = row.NETNAV;
            const num = Number(String(raw === undefined ? '' : raw).trim());
            if (!date || !Number.isFinite(num)) return;
            labels.push(date);
            valuesYuan.push(num);
        });
        if (labels.length === 0) return null;

        const maxYuan = Math.max(...valuesYuan);
        const unit = maxYuan >= 100000000 ? '亿' : '万';
        const divisor = unit === '亿' ? 100000000 : 10000;
        const values = valuesYuan.map(v => v / divisor);
        const maxInUnit = Math.max(...values);
        // 让坐标轴贴合实际值：从 0 开始，最大值留 20% 头部空间
        const suggestedMax = Math.max(0, Math.ceil(maxInUnit * 1.2 * 100) / 100);

        return { labels, values, unit, suggestedMax };
    },

    renderJjgmScaleChart: function(model, canvas) {
        this.destroyJjgmChart();
        if (!model || !canvas || !window.Chart) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const unit = model.unit || '';
        const fmtTick = (v) => {
            if (v === null || v === undefined) return '';
            const n = Number(v);
            if (!Number.isFinite(n)) return '';
            return unit === '亿' ? n.toFixed(2) : String(Math.round(n));
        };

        this._jjgmChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: model.labels,
                datasets: [{
                    label: `基金规模（${unit}）`,
                    data: model.values,
                    backgroundColor: 'rgba(34,211,238,0.55)',
                    borderColor: 'rgba(34,211,238,0.75)',
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        ticks: { color: '#cbd5e1', autoSkip: true, maxRotation: 0 },
                        grid: { color: 'rgba(255,255,255,0.06)' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: `单位：${unit}`,
                            color: '#cbd5e1',
                            font: { size: 12, weight: '600' },
                            padding: { bottom: 6 }
                        },
                        beginAtZero: true,
                        min: 0,
                        suggestedMax: model.suggestedMax,
                        ticks: { color: '#cbd5e1', callback: (value) => fmtTick(value) },
                        grid: { color: 'rgba(255,255,255,0.06)' }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const v = context.parsed && context.parsed.y;
                                const n = Number(v);
                                if (!Number.isFinite(n)) return '规模：-';
                                // tooltip：<1 亿用“万”不显示小数；>=1 亿用“亿”保留 2 位
                                const show = unit === '亿' ? n.toFixed(2) : String(Math.round(n));
                                return `规模：${show}${unit}`;
                            }
                        }
                    }
                }
            }
        });
    },

    buildJjccPieModels: function(jjccRawText) {
        // 数据来源：JJCC raw JSON -> Datas
        if (!jjccRawText || jjccRawText === '--') {
            return { stock: null, asset: null, sector: null };
        }
        let payload = null;
        try { payload = JSON.parse(jjccRawText); } catch (e) { return { stock: null, asset: null, sector: null }; }
        const datas = payload && payload.Datas;
        if (!datas || typeof datas !== 'object') return { stock: null, asset: null, sector: null };

        // 1) 股票持仓：InverstPosition.fundStocks -> GPJC/JZBL
        const fundStocks = datas.InverstPosition && datas.InverstPosition.fundStocks;
        const stockItems = Array.isArray(fundStocks) ? fundStocks : [];
        const stockPairs = [];
        stockItems.forEach(it => {
            const name = String(it.GPJC || '').trim();
            const pct = Number(String(it.JZBL || '').trim());
            if (!name || !Number.isFinite(pct)) return;
            stockPairs.push({ name, pct });
        });
        // 十大持仓股：按比例从高到低
        stockPairs.sort((a, b) => b.pct - a.pct);
        const top = stockPairs.slice(0, 10);
        const stockLabels = top.map(x => x.name);
        const stockValues = top.map(x => x.pct);

        // 2) 资产配置：AssetAllocation 第一个日期的第一条 -> GP/ZQ/HB/QT
        const assetAlloc = datas.AssetAllocation;
        let assetRow = null;
        if (assetAlloc && typeof assetAlloc === 'object') {
            // 默认取“第一个字段”的明细，不做排序
            const keys = Object.keys(assetAlloc);
            if (keys.length) {
                const first = assetAlloc[keys[0]];
                if (Array.isArray(first) && first.length && typeof first[0] === 'object') {
                    assetRow = first[0];
                }
            }
        }
        const assetMap = {
            'GP': '股票',
            'ZQ': '债券',
            'HB': '现金',
            'QT': '其他',
        };
        const assetLabels = [];
        const assetValues = [];
        if (assetRow) {
            Object.keys(assetMap).forEach(k => {
                const raw = assetRow[k];
                const s = String(raw === undefined ? '' : raw).trim();
                if (!s || s === '--') return;
                const n = Number(s);
                if (!Number.isFinite(n)) return;
                assetLabels.push(assetMap[k]);
                assetValues.push(n);
            });
        }

        // 3) 行业分布：SectorAllocation 第一个日期 -> list(HYMC/ZJZBL)
        const sectorAlloc = datas.SectorAllocation;
        let sectorList = [];
        if (sectorAlloc && typeof sectorAlloc === 'object') {
            // 默认取“第一个字段”的明细，不做排序
            const keys = Object.keys(sectorAlloc);
            if (keys.length) {
                const first = sectorAlloc[keys[0]];
                sectorList = Array.isArray(first) ? first : [];
            }
        }
        const sectorLabels = [];
        const sectorValues = [];
        sectorList.forEach(it => {
            const name = String(it.HYMC || '').trim();
            const pct = Number(String(it.ZJZBL || '').trim());
            if (!name || !Number.isFinite(pct)) return;
            sectorLabels.push(name);
            sectorValues.push(pct);
        });

        return {
            stock: { labels: stockLabels, values: stockValues },
            asset: { labels: assetLabels, values: assetValues },
            sector: { labels: sectorLabels, values: sectorValues },
        };
    },

    buildJjjlModel: function(rawText) {
        if (!rawText || rawText === '--') return [];
        let payload = null;
        try { payload = JSON.parse(rawText); } catch (e) { return []; }
        const rows = payload && payload.Datas;
        const list = Array.isArray(rows) ? rows : [];
        const normalizeText = (v) => {
            const s = String(v === undefined || v === null ? '' : v).trim();
            return (!s || s === '--') ? '' : s;
        };
        const normalizeNum = (v) => {
            const s = normalizeText(v);
            if (!s) return null;
            const n = Number(String(s).replace('%', '').trim());
            return Number.isFinite(n) ? n : null;
        };

        return list.map(it => {
            const mgrName = normalizeText(it.MGRNAME || it.mgr_name || it.manager_name || '');
            const start = normalizeText(it.FEMPDATE || it.fempdate || it.start_date || '');
            const end = normalizeText(it.LEMPDATE || it.lempdate || it.end_date || '');
            const days = normalizeNum(it.DAYS || it.days);
            const growth = normalizeNum(it.PENAVGROWTH || it.penavgrowth || it.growth);
            return { mgrName, startDate: start, endDate: end, days, growth };
        });
    },

    renderJjjlTable: function(model, tbodyEl) {
        if (!tbodyEl) return;
        const rows = Array.isArray(model) ? model.filter(x => x && (x.mgrName || x.startDate || x.endDate)) : [];
        if (!rows.length) {
            tbodyEl.innerHTML = '<tr><td colspan="5" class="text-slate-400">暂无基金经理数据</td></tr>';
            return;
        }
        const fmtDays = (n) => (typeof n === 'number' && Number.isFinite(n)) ? String(Math.round(n)) : '-';
        const fmtPct = (n) => (typeof n === 'number' && Number.isFinite(n)) ? `${n.toFixed(2)}%` : '-';
        const fmtEnd = (s) => s ? s : '至今';
        tbodyEl.innerHTML = rows.map(r => `
            <tr>
                <td class="text-slate-100">${r.mgrName || '-'}</td>
                <td class="text-slate-200">${r.startDate || '-'}</td>
                <td class="text-slate-200">${fmtEnd(r.endDate)}</td>
                <td class="text-right text-slate-200">${fmtDays(r.days)}</td>
                <td class="text-right text-slate-200">${fmtPct(r.growth)}</td>
            </tr>
        `).join('');
    },

    renderJjccPies: function(models, canvasMap) {
        this.destroyJjccCharts();
        if (!models || !window.Chart) return;
        const stockCanvas = canvasMap && canvasMap.stock ? canvasMap.stock : document.getElementById('fund-detail-jjcc-stock-chart');
        const assetCanvas = canvasMap && canvasMap.asset ? canvasMap.asset : document.getElementById('fund-detail-jjcc-asset-chart');
        const sectorCanvas = canvasMap && canvasMap.sector ? canvasMap.sector : document.getElementById('fund-detail-jjcc-sector-chart');

        const mkPie = (canvas, title, labels, values, colors) => {
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            return new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data: values, backgroundColor: colors, borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1 }]
                },
                options: {
                    responsive: true,
                    // 强制保持 1:1，避免在 flex 容器下出现“椭圆饼图”
                    maintainAspectRatio: true,
                    aspectRatio: 1,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#e2e8f0', boxWidth: 10 } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const v = context.parsed;
                                    if (v === null || v === undefined) return `${context.label}: -`;
                                    return `${context.label}: ${Number(v).toFixed(2)}%`;
                                }
                            }
                        }
                    },
                    cutout: '55%',
                }
            });
        };

        const mkStockBar = (canvas, labels, values) => {
            if (!canvas) return null;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            const valueLabelPlugin = {
                id: 'barValueLabels',
                afterDatasetsDraw(chart) {
                    const ctx = chart.ctx;
                    const meta = chart.getDatasetMeta(0);
                    const data = (chart.data && chart.data.datasets && chart.data.datasets[0] && chart.data.datasets[0].data) || [];
                    if (!meta || !meta.data || !data) return;

                    ctx.save();
                    ctx.font = '12px sans-serif';
                    ctx.fillStyle = '#e2e8f0';
                    ctx.textBaseline = 'middle';

                    meta.data.forEach((bar, i) => {
                        const v = Number(data[i]);
                        if (!Number.isFinite(v)) return;
                        const text = `${v.toFixed(2)}%`;
                        const props = bar.getProps(['x', 'y', 'base'], true);
                        const x = props.x;
                        const y = props.y;
                        const base = props.base;
                        const barLen = Math.abs(x - base);
                        const pad = 6;

                        // 优先画在条形内部右侧；空间不够则画到条形外侧
                        const textW = ctx.measureText(text).width;
                        let drawX = x - pad;
                        let align = 'right';
                        if (barLen < textW + pad * 2) {
                            drawX = x + pad;
                            align = 'left';
                        }
                        ctx.textAlign = align;
                        ctx.fillText(text, drawX, y);
                    });
                    ctx.restore();
                }
            };
            return new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: '占比(%)',
                        data: values,
                        backgroundColor: 'rgba(34,211,238,0.55)',
                        borderColor: 'rgba(34,211,238,0.75)',
                        borderWidth: 1,
                        borderRadius: 6,
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'nearest',
                        axis: 'y',
                        intersect: true,
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            min: 0,
                            ticks: {
                                color: '#cbd5e1',
                                callback: function(value) {
                                    const n = Number(value);
                                    if (!Number.isFinite(n)) return '';
                                    return `${n}%`;
                                }
                            },
                            grid: { color: 'rgba(255,255,255,0.06)' }
                        },
                        y: {
                            ticks: { color: '#cbd5e1' },
                            grid: { display: false }
                        }
                    }
                },
                plugins: [valueLabelPlugin]
            });
        };

        const palette = [
            'rgba(34,211,238,0.65)',
            'rgba(251,191,36,0.65)',
            'rgba(248,113,113,0.65)',
            'rgba(34,197,94,0.65)',
            'rgba(148,163,184,0.65)',
            'rgba(167,139,250,0.65)',
            'rgba(244,114,182,0.65)',
            'rgba(96,165,250,0.65)',
            'rgba(45,212,191,0.65)',
            'rgba(250,204,21,0.65)',
        ];
        const pickColors = (n) => Array.from({length:n}, (_,i)=>palette[i%palette.length]);

        const s = models.stock || { labels: [], values: [] };
        const a = models.asset || { labels: [], values: [] };
        const h = models.sector || { labels: [], values: [] };

        // 十大持仓股：横向柱状图（从高到低）
        this._jjccStockChart = mkStockBar(stockCanvas, s.labels, s.values);
        this._jjccAssetChart = mkPie(assetCanvas, '资产配置', a.labels, a.values, pickColors(a.labels.length));
        this._jjccSectorChart = mkPie(sectorCanvas, '行业分布', h.labels, h.values, pickColors(h.labels.length));
    },

    buildJdzfModel: function(items) {
        const periodOrder = ['Z', 'Y', '3Y', '6Y', '1N', '2N', '3N', '5N', 'JN', 'LN'];
        const periodNameMap = {
            'Z': '近1周',
            'Y': '近1月',
            '3Y': '近3月',
            '6Y': '近6月',
            '1N': '近1年',
            '2N': '近2年',
            '3N': '近3年',
            '5N': '近5年',
            'JN': '今年来',
            'LN': '成立来'
        };

        const byPeriod = {};
        (items || []).forEach(it => {
            const key = String(it.key || '');
            const m = key.match(/^([A-Z0-9]+)\.(syl|avg|hs300|rank|sc|diff)$/);
            if (!m) return;
            const p = m[1];
            const f = m[2];
            if (!byPeriod[p]) byPeriod[p] = {};
            byPeriod[p][f] = it.value;
        });

        const labels = [];
        const fund = [];
        const avg = [];
        const hs300 = [];
        const rankRows = [];

        const toNum = (v) => {
            if (v === null || v === undefined) return null;
            const s = String(v).replace('%', '').trim();
            if (!s || s === '--') return null;
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        };

        periodOrder.forEach(code => {
            const name = periodNameMap[code] || code;
            const row = byPeriod[code] || {};
            labels.push(name);
            fund.push(toNum(row.syl));
            avg.push(toNum(row.avg));
            hs300.push(toNum(row.hs300));

            const rank = (row.rank && String(row.rank).trim()) ? String(row.rank).trim() : '';
            const sc = (row.sc && String(row.sc).trim()) ? String(row.sc).trim() : '';
            const diff = (row.diff && String(row.diff).trim()) ? String(row.diff).trim() : '';
            rankRows.push({
                code,
                name,
                rankText: (rank && sc) ? `${rank}/${sc}` : (rank || ''),
                diffText: diff || ''
            });
        });

        return { labels, fund, avg, hs300, rankRows };
    },

    renderJdzfChart: function(model, canvasEl) {
        this.destroyJdzfChart();
        if (!canvasEl || !model) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx || !window.Chart) return;

        // 计算合理的 Y 轴范围，避免全为 null 或范围过小导致看不出变化
        const allValues = []
            .concat(model.fund || [])
            .concat(model.avg || [])
            .concat(model.hs300 || [])
            .filter(v => typeof v === 'number' && Number.isFinite(v));
        const minV = allValues.length ? Math.min(...allValues) : 0;
        const maxV = allValues.length ? Math.max(...allValues) : 1;
        const pad = allValues.length ? Math.max(1, (maxV - minV) * 0.15) : 1;

        this._jdzfChart = new Chart(ctx, {
            // 阶段涨幅更适合对比：分组柱状图
            type: 'bar',
            data: {
                labels: model.labels,
                datasets: [
                    {
                        label: '基金',
                        data: model.fund,
                        backgroundColor: (ctx2) => {
                            const v = ctx2.raw;
                            if (typeof v !== 'number' || !Number.isFinite(v)) return 'rgba(148,163,184,0.25)';
                            return v >= 0 ? 'rgba(248,113,113,0.75)' : 'rgba(34,197,94,0.75)';
                        },
                        borderColor: (ctx2) => {
                            const v = ctx2.raw;
                            if (typeof v !== 'number' || !Number.isFinite(v)) return 'rgba(148,163,184,0.35)';
                            return v >= 0 ? 'rgba(248,113,113,0.95)' : 'rgba(34,197,94,0.95)';
                        },
                        borderWidth: 1,
                    },
                    {
                        label: '同类平均',
                        data: model.avg,
                        backgroundColor: 'rgba(148,163,184,0.35)',
                        borderColor: 'rgba(148,163,184,0.7)',
                        borderWidth: 1,
                    },
                    {
                        label: '沪深300',
                        data: model.hs300,
                        backgroundColor: 'rgba(251,191,36,0.35)',
                        borderColor: 'rgba(251,191,36,0.7)',
                        borderWidth: 1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: '#e2e8f0' } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const v = context.parsed.y;
                                if (v === null || v === undefined) return `${context.dataset.label}: -`;
                                return `${context.dataset.label}: ${v.toFixed(2)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#cbd5e1' }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: {
                        suggestedMin: minV - pad,
                        suggestedMax: maxV + pad,
                        ticks: {
                            color: '#cbd5e1',
                            callback: function(value) { return `${value}%`; }
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' }
                    }
                },
                // 柱子更紧凑一些
                datasets: {
                    bar: {
                        categoryPercentage: 0.7,
                        barPercentage: 0.9,
                    }
                }
            }
        });
    },

    renderJdzfRankTable: function(model, tbodyEl) {
        if (!tbodyEl) return;
        const rows = (model && model.rankRows) ? model.rankRows : [];
        const fundValues = (model && model.fund) ? model.fund : [];
        tbodyEl.innerHTML = rows.map((r, i) => {
            const val = fundValues[i];
            let changeText = '-';
            let colorStyle = '';
            if (val !== null && val !== undefined) {
                changeText = (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
                colorStyle = val > 0 ? 'color:#ef4444;' : val < 0 ? 'color:#22c55e;' : '';
            }
            return `<tr>
                <td>${r.name}</td>
                <td class="text-center"><span class="inline-block text-right" style="min-width:5rem;${colorStyle}">${changeText}</span></td>
                <td>${r.rankText || '-'}</td>
            </tr>`;
        }).join('');
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
