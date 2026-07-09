// On touch phones in landscape, render the full desktop layout scaled to fit the
// screen (so it looks the same as desktop). Portrait stays responsive.
(function setupResponsiveViewport() {
    function applyViewport() {
        let meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            (document.head || document.documentElement).appendChild(meta);
        }
        const isTouch = window.matchMedia('(pointer: coarse)').matches;
        const isLandscape = window.matchMedia('(orientation: landscape)').matches;
        if (isTouch && isLandscape) {
            meta.setAttribute('content', 'width=1400');
        } else {
            meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
        }
    }
    applyViewport();
    window.addEventListener('orientationchange', applyViewport);
    window.addEventListener('resize', applyViewport);
})();

// Persistence Logic: Load trades from localStorage
let trades = JSON.parse(localStorage.getItem('tradeJournalData')) || [];

// Ensure all trades have a unique ID for robust editing/deletion
let tradesChanged = false;
trades = trades.map(t => {
    if (!t.id) {
        t.id = Date.now() + Math.random().toString(36).substr(2, 9);
        tradesChanged = true;
    }
    return t;
});
if (tradesChanged) saveTrades();

function saveTrades() {
    localStorage.setItem('tradeJournalData', JSON.stringify(trades));
}

function getJournalBackupPayload() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        trades: JSON.parse(localStorage.getItem('tradeJournalData') || '[]'),
        watchlist: JSON.parse(localStorage.getItem('tradeJournalWatchlist') || 'null'),
        tradingNotes: localStorage.getItem('tradingNotes') || ''
    };
}

function applyJournalBackup(payload) {
    if (!payload || !Array.isArray(payload.trades)) {
        throw new Error('Invalid backup file');
    }

    trades = payload.trades.map(t => {
        if (!t.id) t.id = Date.now() + Math.random().toString(36).substr(2, 9);
        return t;
    });
    saveTrades();

    if (payload.watchlist) {
        localStorage.setItem('tradeJournalWatchlist', JSON.stringify(payload.watchlist));
    }
    if (payload.tradingNotes) {
        localStorage.setItem('tradingNotes', payload.tradingNotes);
    }

    syncStocklistDatalists();
    renderWatchlistPanel();
    populateSymbolFilter();
    refreshAllViews();
}

window.exportJournalData = function exportJournalData() {
    const payload = getJournalBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showAlert('Your trades, watchlist, and notes were saved to a backup file.', 'Export Complete');
};

// --- Git-based data sync (so your phone shows the data you push from your PC) ---
// Location of the committed data file, relative to the HTML pages in /HTML/.
const REMOTE_DATA_URL = '../data/journal-data.json';
const SYNC_MARKER_KEY = 'tradeJournalSyncedAt';
const GITHUB_TOKEN_KEY = 'tradeJournalGithubToken';
const GITHUB_SYNC = {
    owner: 'ItsAWolfee',
    repo: 'Trade-Journal',
    branch: 'main',
    path: 'data/journal-data.json'
};

function getGithubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
}

function setGithubToken(token) {
    if (token) localStorage.setItem(GITHUB_TOKEN_KEY, token.trim());
    else localStorage.removeItem(GITHUB_TOKEN_KEY);
}

window.saveGithubTokenFromSettings = function saveGithubTokenFromSettings() {
    const input = document.getElementById('settingsGithubToken');
    const token = input ? input.value.trim() : '';
    if (!token || token.startsWith('••••')) {
        showAlert('Paste your GitHub token first.', 'Token Needed');
        return;
    }
    setGithubToken(token);
    if (input) input.value = '';
    showAlert('Token saved on this device. You can now use Sync to Phone.', 'Saved');
};

function isGithubPagesSite() {
    return location.protocol === 'https:' && location.hostname.includes('github.io');
}

async function githubApi(path, options = {}) {
    const token = getGithubToken();
    if (!token) throw new Error('NO_TOKEN');
    const res = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `GitHub API error (${res.status})`);
    }
    return res.json();
}

function applyRemoteJournalPayload(payload, stamp, render = true) {
    if (!payload || !Array.isArray(payload.trades)) return false;
    trades = payload.trades.map(t => {
        if (!t.id) t.id = Date.now() + Math.random().toString(36).substr(2, 9);
        return t;
    });
    localStorage.setItem('tradeJournalData', JSON.stringify(trades));
    if (payload.watchlist) localStorage.setItem('tradeJournalWatchlist', JSON.stringify(payload.watchlist));
    if (typeof payload.tradingNotes === 'string') localStorage.setItem('tradingNotes', payload.tradingNotes);
    if (stamp) localStorage.setItem(SYNC_MARKER_KEY, stamp);
    if (render) {
        syncStocklistDatalists();
        renderWatchlistPanel();
        populateSymbolFilter();
        refreshAllViews();
    }
    return true;
}

// Push current browser data to GitHub — one click, no manual export.
window.pushJournalToGithub = async function pushJournalToGithub() {
    if (!getGithubToken()) {
        showAlert('Open Settings and add your GitHub token first (one-time setup).', 'GitHub Token Needed');
        openSettings();
        return;
    }
    try {
        const payload = getJournalBackupPayload();
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
        const filePath = `/repos/${GITHUB_SYNC.owner}/${GITHUB_SYNC.repo}/contents/${GITHUB_SYNC.path}`;
        let sha;
        try {
            const existing = await githubApi(`${filePath}?ref=${GITHUB_SYNC.branch}`);
            sha = existing.sha;
        } catch (e) {
            if (!String(e.message).includes('404')) throw e;
        }
        await githubApi(filePath, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `Sync journal data (${payload.exportedAt})`,
                content,
                branch: GITHUB_SYNC.branch,
                ...(sha ? { sha } : {})
            })
        });
        localStorage.setItem(SYNC_MARKER_KEY, payload.exportedAt);
        showAlert('Data is on GitHub. Open the site on your phone and tap Pull Latest (or refresh).', 'Synced!');
    } catch (err) {
        if (err.message === 'NO_TOKEN') {
            showAlert('Add your GitHub token in Settings first.', 'Token Needed');
            openSettings();
        } else {
            showAlert(err.message || 'Could not push to GitHub.', 'Sync Failed');
        }
    }
};

// Pull the latest data from GitHub into this browser.
window.pullJournalFromGithub = async function pullJournalFromGithub() {
    try {
        const res = await fetch(REMOTE_DATA_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('No sync file found on GitHub yet. Push from your PC first.');
        const payload = await res.json();
        const stamp = payload.exportedAt || '';
        if (!stamp) throw new Error('Sync file is missing a timestamp.');
        if (applyRemoteJournalPayload(payload, stamp)) {
            showAlert('Latest trades loaded from GitHub.', 'Updated!');
        }
    } catch (err) {
        showAlert(err.message || 'Could not pull data.', 'Pull Failed');
    }
};

// Downloads a file named exactly `journal-data.json`. Drop it into the repo's
// `data/` folder (replacing the old one), then commit & push. On the next load,
// your phone (and any device) will pick up the new data automatically.
window.exportSyncFile = function exportSyncFile() {
    const payload = getJournalBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'journal-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showAlert(
        'Saved "journal-data.json". Put this file in your project\'s data folder (replace the old one), then commit & push. Your phone will update on next open.',
        'Ready to Push'
    );
};

// Loads the committed data file and, when appropriate, applies it to this device.
async function syncJournalFromRepo() {
    try {
        const res = await fetch(REMOTE_DATA_URL, { cache: 'no-store' });
        if (!res.ok) return;

        const payload = await res.json();
        if (!payload || !Array.isArray(payload.trades)) return;

        const remoteStamp = payload.exportedAt || '';
        if (!remoteStamp) return;

        const hasLocalTrades = (JSON.parse(localStorage.getItem('tradeJournalData') || '[]')).length > 0;
        const appliedStamp = localStorage.getItem(SYNC_MARKER_KEY) || '';

        const shouldApply = !hasLocalTrades || (appliedStamp && remoteStamp > appliedStamp);
        if (!shouldApply) return;

        applyRemoteJournalPayload(payload, remoteStamp, false);
    } catch (err) {
        console.debug('Journal sync skipped:', err);
    }
}

window.importJournalData = function importJournalData() {
    const input = document.getElementById('journalImportInput');
    if (input) input.click();
};

window.handleJournalImport = async function handleJournalImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const payload = JSON.parse(text);

        const tradeCount = payload.trades?.length || 0;
        const replace = tradeCount > 0
            ? await showConfirm(
                `Import ${tradeCount} trade${tradeCount === 1 ? '' : 's'}? This will replace your current journal data.`,
                'Import Backup'
            )
            : true;

        if (!replace) {
            event.target.value = '';
            return;
        }

        applyJournalBackup(payload);
        showAlert(`Imported ${tradeCount} trade${tradeCount === 1 ? '' : 's'} successfully.`, 'Import Complete');
    } catch (err) {
        console.error(err);
        showAlert('Could not read that file. Make sure it is a Trade Journal backup (.json).', 'Import Failed');
    }

    event.target.value = '';
};

// --- Image Upload Helpers ---
window.handleTradeImageUpload = function (event, areaId, previewId) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const area = document.getElementById(areaId);
        const preview = document.getElementById(previewId);
        const previewImg = document.getElementById(previewId + 'Img');
        const placeholder = area ? area.querySelector('[id$="Placeholder"]') : null;
        if (previewImg) previewImg.src = e.target.result;
        if (preview) preview.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        if (area) area.style.borderColor = 'rgba(0,242,254,0.7)';
    };
    reader.readAsDataURL(file);
};

window.clearTradeImage = function (previewId, inputId, areaId) {
    const preview = document.getElementById(previewId);
    const previewImg = document.getElementById(previewId + 'Img');
    const input = document.getElementById(inputId);
    const area = document.getElementById(areaId);
    const placeholder = area ? area.querySelector('[id$="Placeholder"]') : null;
    if (previewImg) previewImg.src = '';
    if (preview) preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    if (input) input.value = '';
    if (area) area.style.borderColor = 'rgba(0,242,254,0.3)';
};

function resetImageUpload() {
    const previewImg = document.getElementById('imagePreviewImg');
    const preview = document.getElementById('imagePreview');
    const input = document.getElementById('tradeImageInput');
    const area = document.getElementById('imageUploadArea');
    const placeholder = document.getElementById('imageUploadPlaceholder');
    if (previewImg) previewImg.src = '';
    if (preview) preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    if (input) input.value = '';
    if (area) area.style.borderColor = 'rgba(0,242,254,0.3)';
}

function setImagePreview(dataUrl) {
    const previewImg = document.getElementById('imagePreviewImg');
    const preview = document.getElementById('imagePreview');
    const area = document.getElementById('imageUploadArea');
    const placeholder = document.getElementById('imageUploadPlaceholder');
    if (!dataUrl) { resetImageUpload(); return; }
    if (previewImg) previewImg.src = dataUrl;
    if (preview) preview.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (area) area.style.borderColor = 'rgba(0,242,254,0.7)';
}
// --- End Image Upload Helpers ---

// Lightbox to view trade images fullscreen
window.openImageLightbox = function (tradeId) {
    const trade = trades.find(t => t.id === tradeId);
    if (!trade || !trade.imageDataUrl) return;

    let lb = document.getElementById('tradeImageLightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'tradeImageLightbox';
        lb.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.92);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;backdrop-filter:blur(8px);';
        lb.innerHTML = `
            <div style="position:relative;max-width:92vw;max-height:90vh;">
                <img id="lightboxImg" src="" alt="Trade chart" style="max-width:100%;max-height:90vh;border-radius:12px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 0 60px rgba(0,242,254,0.15);">
                <button onclick="document.getElementById('tradeImageLightbox').style.display='none'" style="position:absolute;top:-14px;right:-14px;background:#1a1a1a;border:1px solid var(--border,#333);color:white;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:18px;line-height:30px;padding:0;text-align:center;">×</button>
            </div>
        `;
        lb.addEventListener('click', (e) => { if (e.target === lb) lb.style.display = 'none'; });
        document.body.appendChild(lb);
    }
    document.getElementById('lightboxImg').src = trade.imageDataUrl;
    lb.style.display = 'flex';
};

// Global Calendar State (Dynamic based on real date)
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();

// Thinkorswim options commission: $0.65 per contract per side (open + close)
const TOS_FEE_PER_CONTRACT = 0.65;
const FEE_SETTING_KEY = 'tradeJournalTosFee';
const DEFAULT_CONTRACTS_KEY = 'tradeJournalDefaultContracts';
const COMPACT_TABLE_KEY = 'tradeJournalCompactTable';

function getTosFeeRate() {
    const v = parseFloat(localStorage.getItem(FEE_SETTING_KEY));
    return Number.isFinite(v) && v >= 0 ? v : TOS_FEE_PER_CONTRACT;
}

function getDefaultContracts() {
    const v = parseInt(localStorage.getItem(DEFAULT_CONTRACTS_KEY), 10);
    return Number.isFinite(v) && v >= 1 ? v : 1;
}

function isCompactTable() {
    return localStorage.getItem(COMPACT_TABLE_KEY) === '1';
}

function getTradeContractCount(trade) {
    return Math.max(1, parseInt(trade.contracts, 10) || 1);
}

function getTradeFeeSides(trade) {
    const close = trade.closePremium;
    return close !== undefined && close !== null && String(close).trim() !== '' ? 2 : 1;
}

function getTradeFees(trade) {
    return getTradeContractCount(trade) * getTradeFeeSides(trade) * getTosFeeRate();
}

function getNetProfit(trade) {
    const profit = parseFloat(trade.profit) || 0;
    // Always subtract TOS fees so every trade's P/L is net and consistent.
    return profit - getTradeFees(trade);
}

function getGrossProfit(trade) {
    return parseFloat(trade.profit) || 0;
}

function sumGrossProfit(tradeList) {
    return tradeList.reduce((sum, t) => sum + getGrossProfit(t), 0);
}

function getProfitFeeNote(trade) {
    const fees = getTradeFees(trade);
    return `-${formatMoney(fees)} fees`;
}

function sumNetProfit(tradeList) {
    return tradeList.reduce((sum, t) => sum + getNetProfit(t), 0);
}

function sumFees(tradeList) {
    return tradeList.reduce((sum, t) => sum + getTradeFees(t), 0);
}

function formatMoney(val) {
    return `$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatFeesLabel(tradeList) {
    const total = sumFees(tradeList);
    if (!tradeList.length || total <= 0) return 'TOS fees: $0.00';
    return `${formatMoney(total)} TOS fees`;
}

// Helper to format currency elegantly ($210 vs +2.64K)
function formatProfit(val) {
    const absVal = Math.abs(val);
    const sign = val >= 0 ? '+' : '-';
    if (absVal >= 1000) {
        return `${sign}$${(absVal / 1000).toFixed(2)}K`;
    }
    return `${sign}$${absVal.toLocaleString()}`;
}

// Color for a P/L value: green profit, red loss, white for exactly zero
function profitColor(val) {
    if (val > 0) return 'var(--profit-green)';
    if (val < 0) return 'var(--loss-red)';
    return '#ffffff';
}

// Biggest single-day gain and biggest single-day loss across all history.
// Used to scale calendar/heatmap color intensity relative to your own best/worst.
function getDailyProfitExtremes() {
    const map = {};
    (trades || []).forEach(t => {
        map[t.date] = (map[t.date] || 0) + getNetProfit(t);
    });
    let maxGain = 0, maxLoss = 0;
    Object.values(map).forEach(v => {
        if (v > maxGain) maxGain = v;
        if (v < 0 && Math.abs(v) > maxLoss) maxLoss = Math.abs(v);
    });
    return { maxGain, maxLoss };
}

function getTradeProfitExtremes() {
    let maxGain = 0, maxLoss = 0;
    (trades || []).forEach(t => {
        const v = getNetProfit(t);
        if (v > maxGain) maxGain = v;
        if (v < 0 && Math.abs(v) > maxLoss) maxLoss = Math.abs(v);
    });
    return { maxGain, maxLoss };
}

function getTradeProfitExtremesForList(list) {
    let maxGain = 0, maxLoss = 0;
    (list || []).forEach(t => {
        const v = getNetProfit(t);
        if (v > maxGain) maxGain = v;
        if (v < 0 && Math.abs(v) > maxLoss) maxLoss = Math.abs(v);
    });
    return { maxGain, maxLoss };
}

function getTradeCostBasis(trade) {
    const entry = parseFloat(trade.ask) || parseFloat(trade.entryPrice) || 0;
    return entry * getTradeContractCount(trade) * 100;
}

function getNetROI(trade) {
    const basis = getTradeCostBasis(trade);
    if (basis <= 0) return null;
    return (getNetProfit(trade) / basis) * 100;
}

function formatROI(val) {
    if (val === null || val === undefined || Number.isNaN(val)) return '--';
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}%`;
}

function formatTradeDate(dateStr) {
    if (!dateStr) return '--';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTradeTimeFrame(trade) {
    const start = trade.time ? trade.time.slice(0, 5) : '--';
    let end = '';
    if (trade.endTime) {
        end = trade.endTime.includes('T') ? trade.endTime.split('T')[1].slice(0, 5) : trade.endTime.slice(0, 5);
    }
    return end ? `${start} – ${end}` : start;
}

function renderTradeScaleHtml(netProfit, extremes) {
    const intensity = profitIntensity(netProfit, extremes);
    const minWidth = netProfit === 0 ? 0 : 8;
    const width = Math.max(minWidth, Math.round(intensity * 50));
    if (netProfit > 0) {
        return `<div class="trade-scale"><div class="trade-scale-track"><div class="trade-scale-line"></div><div class="trade-scale-center"></div><div class="trade-scale-bar trade-scale-bar--win" style="width:${width}%"></div></div></div>`;
    }
    if (netProfit < 0) {
        return `<div class="trade-scale"><div class="trade-scale-track"><div class="trade-scale-line"></div><div class="trade-scale-center"></div><div class="trade-scale-bar trade-scale-bar--loss" style="width:${width}%"></div></div></div>`;
    }
    return `<div class="trade-scale"><div class="trade-scale-track"><div class="trade-scale-line"></div><div class="trade-scale-center"></div></div></div>`;
}

// 0..1 intensity for a value relative to the best gain / worst loss.
function profitIntensity(val, ext) {
    if (val > 0) return ext.maxGain > 0 ? Math.min(val / ext.maxGain, 1) : 1;
    if (val < 0) return ext.maxLoss > 0 ? Math.min(Math.abs(val) / ext.maxLoss, 1) : 1;
    return 0;
}

// Scatter point color scaled by how big the win/loss is relative to your extremes.
function profitScatterColor(val, ext) {
    const t = profitIntensity(val, ext);
    const op = 0.25 + t * 0.75; // faint for small, vivid for your biggest
    return val >= 0 ? `rgba(0, 240, 168, ${op})` : `rgba(255, 77, 109, ${op})`;
}

// Scatter point radius scaled 4..12 by magnitude relative to extremes.
function profitPointRadius(val, ext) {
    return 4 + profitIntensity(val, ext) * 8;
}

// Modal Logic
function openModal() {
    editingIndex = -1;
    profitManuallyEdited = false;
    formLoadingTrade = false;
    const tradeModal = document.getElementById('tradeModal');
    if (!tradeModal) {
        // Pages without the trade form send you to the dashboard's, which
        // auto-opens via the #add-modal hash handler.
        window.location.href = 'dashboard.html#add-modal';
        return;
    }
    if (tradeModal) {
        tradeModal.querySelector('h2').textContent = 'Log New Trade';
        tradeModal.querySelector('button[type="submit"]').textContent = 'Log Option Trade';
        const tradeForm = document.getElementById('tradeForm');
        if (tradeForm) tradeForm.reset();

        const contractsInput = document.getElementById('contractsInput');
        if (contractsInput) contractsInput.value = getDefaultContracts();

        // Reset cost display
        const costDisplay = document.getElementById('costDisplay');
        if (costDisplay) costDisplay.textContent = '$0.00';

        resetImageUpload();

        tradeModal.style.display = 'flex';
    }
}

function closeModal() {
    editingIndex = -1;
    profitManuallyEdited = false;
    formLoadingTrade = false;
    const tradeModal = document.getElementById('tradeModal');
    if (tradeModal) tradeModal.style.display = 'none';
}

function initTradeModalBackdropClose() {
    const tradeModal = document.getElementById('tradeModal');
    if (!tradeModal || tradeModal.dataset.backdropBound) return;
    tradeModal.dataset.backdropBound = '1';
    tradeModal.addEventListener('click', (e) => {
        if (e.target === tradeModal) closeModal();
    });
}

// Dashboard Stats Calculation
function formatSignedMoney(val) {
    const sign = val < 0 ? '-' : '';
    return `${sign}${formatMoney(val)}`;
}

// Always shows an explicit + or - sign (e.g. "+$120.00", "-$30.00", "$0.00")
function formatMoneyWithSign(val) {
    if (val > 0) return `+${formatMoney(val)}`;
    if (val < 0) return `-${formatMoney(Math.abs(val))}`;
    return '$0.00';
}

// Semi-circle gauge: wins (green), losses (red), break-even (gray)
function semiArcPath(cx, cy, r, startPct, endPct) {
    const toXY = (pct) => {
        const angle = Math.PI * (1 - pct);
        return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
    };
    const s = toXY(startPct);
    const e = toXY(endPct);
    // Any segment within the semicircle spans at most 180deg, so the SVG
    // large-arc-flag must always be 0 (otherwise SVG draws the long way around).
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// Semi gauge: green (wins) on the left, red (losses) on the right, small gap between
function renderSemiGauge(el, wins, losses, breakeven) {
    if (!el) return;
    const total = wins + losses + breakeven;
    const cx = 44, cy = 42, r = 34, sw = 9;
    const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    const trackArc = `<path d="${track}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (total === 0) {
        el.innerHTML = `<svg viewBox="0 0 88 48">${trackArc}</svg>`;
        return;
    }

    const parts = [
        { count: wins, color: '#00f0a8' },
        { count: breakeven, color: '#6b6b6b' },
        { count: losses, color: '#ff4d6d' }
    ].filter(p => p.count > 0);

    const gap = parts.length > 1 ? 0.05 : 0; // trimmed at internal boundaries
    let start = 0;
    const segments = parts.map((p, i) => {
        const end = start + p.count / total;
        const segStart = start + (i === 0 ? 0 : gap / 2);
        const segEnd = end - (i === parts.length - 1 ? 0 : gap / 2);
        start = end;
        if (segEnd <= segStart) return '';
        return `<path d="${semiArcPath(cx, cy, r, segStart, segEnd)}" fill="none" stroke="${p.color}" stroke-width="${sw}" stroke-linecap="round"/>`;
    });

    el.innerHTML = `<svg viewBox="0 0 88 48">${trackArc}${segments.join('')}</svg>`;
}

// Donut gauge: green = gross profit share, red = gross loss share
function renderDonutGauge(el, grossProfit, grossLoss) {
    if (!el) return;
    const total = grossProfit + grossLoss;
    const r = 20, cx = 26, cy = 26, circ = 2 * Math.PI * r;
    if (total <= 0) {
        el.innerHTML = `<svg viewBox="0 0 52 52"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/></svg>`;
        return;
    }
    // Small gap between the two arcs so the split reads cleanly
    const gap = total > 0 && grossProfit > 0 && grossLoss > 0 ? 2 : 0;
    const gLen = Math.max((grossProfit / total) * circ - gap, 0);
    const rLen = Math.max((grossLoss / total) * circ - gap, 0);
    el.innerHTML = `<svg viewBox="0 0 52 52">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#00f0a8" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${gLen} ${circ}" stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ff4d6d" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${rLen} ${circ}" stroke-dashoffset="${-(grossProfit / total) * circ}" transform="rotate(-90 ${cx} ${cy})"/>
    </svg>`;
}

function updateDashboardStats() {
    const totalFees = sumFees(trades);
    const totalNetPL = sumNetProfit(trades);
    const totalTrades = trades.length;

    const winningTrades = trades.filter(t => getNetProfit(t) > 0);
    const losingTrades = trades.filter(t => getNetProfit(t) < 0);
    const evenTrades = trades.filter(t => getNetProfit(t) === 0);
    const wins = winningTrades.length;
    const losses = losingTrades.length;
    const even = evenTrades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(2) : '0.00';

    const grossProfit = winningTrades.reduce((sum, t) => sum + getNetProfit(t), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + getNetProfit(t), 0));
    const profitFactorNum = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    const profitFactor = grossLoss > 0 ? profitFactorNum.toFixed(2) : (grossProfit > 0 ? 'MAX' : '0.00');

    // Avg win / avg loss
    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const avgRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : (avgWin > 0 ? 'MAX' : '0.00');

    // Update UI elements
    const netPLElem = document.getElementById('totalNetPL');
    const netPlCount = document.getElementById('netPlTradeCount');
    const winRateElem = document.getElementById('winRateDisplay');
    const pfElem = document.getElementById('profitFactorDisplay');
    const feesSub = document.getElementById('totalFeesSub');

    if (netPLElem) {
        netPLElem.textContent = formatSignedMoney(totalNetPL);
        netPLElem.style.color = profitColor(totalNetPL);
    }
    if (netPlCount) netPlCount.textContent = totalTrades;
    if (feesSub) feesSub.textContent = formatFeesLabel(trades);
    if (winRateElem) winRateElem.textContent = `${winRate}%`;

    renderSemiGauge(document.getElementById('tradeWinGauge'), wins, losses, even);
    const tw = document.getElementById('tradeWinsCount');
    const tl = document.getElementById('tradeLossCount');
    const tb = document.getElementById('tradeBeCount');
    if (tw) tw.textContent = wins;
    if (tl) tl.textContent = losses;
    if (tb) tb.textContent = even;

    if (pfElem) {
        pfElem.textContent = profitFactor;
        if (profitFactor === 'MAX' || profitFactorNum > 2) {
            pfElem.style.color = 'var(--profit-green)';
        } else if (profitFactorNum >= 1) {
            pfElem.style.color = '#ffcc00';
        } else {
            pfElem.style.color = 'var(--loss-red)';
        }
    }
    renderDonutGauge(document.getElementById('profitFactorGauge'), grossProfit, grossLoss);

    const avgRatioElem = document.getElementById('avgWinLossRatioDisplay');
    const avgWinElem = document.getElementById('avgWinDisplay');
    const avgLossElem = document.getElementById('avgLossDisplay');
    const avgBarWin = document.getElementById('avgWinLossBarWin');
    const avgBarLoss = document.getElementById('avgWinLossBarLoss');
    if (avgRatioElem) avgRatioElem.textContent = avgRatio;
    if (avgWinElem) avgWinElem.textContent = formatMoney(avgWin);
    if (avgLossElem) avgLossElem.textContent = avgLoss > 0 ? `-${formatMoney(avgLoss)}` : '$0';
    const barTotal = avgWin + avgLoss;
    if (avgBarWin && avgBarLoss) {
        if (barTotal > 0) {
            avgBarWin.style.width = `${(avgWin / barTotal) * 100}%`;
            avgBarLoss.style.width = `${(avgLoss / barTotal) * 100}%`;
        } else {
            avgBarWin.style.width = '50%';
            avgBarLoss.style.width = '50%';
        }
    }
}

// Parse a trade's duration into total minutes
function parseDurationMins(t) {
    let mins = 0;
    if (typeof t.duration === 'string') {
        const hMatch = t.duration.match(/(\d+)h/);
        const mMatch = t.duration.match(/(\d+)m/);
        if (hMatch) mins += parseInt(hMatch[1]) * 60;
        if (mMatch) mins += parseInt(mMatch[1]);
        if (!hMatch && !mMatch) mins = parseInt(t.duration) || 0;
    } else {
        mins = t.duration || 0;
    }
    return mins;
}

// "75" mins -> "1h 15m", "12" -> "12 min"
function formatDurationLabel(mins) {
    if (!mins || mins <= 0) return '0 min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m} min`;
}

// "09:30" -> "9:30 AM"
function formatTimeLabel(timeStr) {
    if (!timeStr) return '—';
    const [hRaw, mRaw] = timeStr.split(':');
    let h = parseInt(hRaw, 10);
    const m = mRaw != null ? mRaw : '00';
    if (isNaN(h)) return timeStr;
    const suffix = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${m} ${suffix}`;
}

function timeToHours(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) + (m || 0) / 60;
}

// Round a value up to a "nice" axis bound (e.g. 137 -> 150, 1240 -> 1500)
function niceAxisBound(val) {
    if (val <= 0) return 100;
    const pow = Math.pow(10, Math.floor(Math.log10(val)));
    const n = val / pow;
    let nice;
    if (n <= 1) nice = 1;
    else if (n <= 2) nice = 2;
    else if (n <= 2.5) nice = 2.5;
    else if (n <= 5) nice = 5;
    else nice = 10;
    return nice * pow;
}

// Shared plugin config: no legend + simple, human-readable tooltip
function buildScatterPlugins(kind) {
    return {
        legend: { display: false },
        tooltip: {
            displayColors: false,
            backgroundColor: '#1a1a1a',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 12,
            titleColor: '#ffffff',
            titleFont: { size: 13, weight: '700' },
            bodyColor: '#c7c7cc',
            bodyFont: { size: 12 },
            callbacks: {
                title: (items) => {
                    const raw = items[0].raw || {};
                    return raw.symbol || 'Trade';
                },
                label: (item) => {
                    const raw = item.raw || {};
                    const lines = [];
                    if (kind === 'time') lines.push(`Entered at ${raw.timeLabel || '—'}`);
                    if (kind === 'duration') lines.push(`Held for ${raw.durLabel || '—'}`);
                    const y = raw.y || 0;
                    if (y > 0) lines.push(`Made ${formatMoney(y)}`);
                    else if (y < 0) lines.push(`Lost ${formatMoney(Math.abs(y))}`);
                    else lines.push('Broke even');
                    return lines;
                }
            }
        }
    };
}

// Chart Initializations
let timePerformanceChart = null;
let durationPerformanceChart = null;

function initCharts() {
    const tradeExtremes = getTradeProfitExtremes();
    const list = trades || [];

    // Auto-scale the profit (y) axis to the biggest win/loss you've had
    const maxProfitAbs = list.reduce((m, t) => Math.max(m, Math.abs(getNetProfit(t))), 0);
    const yBound = niceAxisBound(maxProfitAbs * 1.1) || 100;

    const timeCtx = document.getElementById('timePerformanceChart');
    if (timeCtx) {
        destroyChartInstance(timePerformanceChart);
        timePerformanceChart = new Chart(timeCtx.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'P/L',
                    data: list.map(t => ({
                        x: timeToHours(t.time),
                        y: getNetProfit(t),
                        symbol: t.symbol,
                        timeLabel: formatTimeLabel(t.time)
                    })),
                    backgroundColor: d => d.raw ? profitScatterColor(d.raw.y, tradeExtremes) : 'rgba(0,240,168,0.5)',
                    pointRadius: d => d.raw ? profitPointRadius(d.raw.y, tradeExtremes) : 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // Require the mouse to actually be over a dot (less sensitive)
                interaction: { mode: 'point', intersect: true },
                scales: {
                    x: {
                        title: { display: true, text: 'Time of Day', color: '#8e8e93' },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        min: 9, max: 12,
                        ticks: {
                            stepSize: 1,
                            callback: (v) => formatTimeLabel(`${Math.floor(v)}:00`)
                        }
                    },
                    y: {
                        title: { display: true, text: 'Profit / Loss ($)', color: '#8e8e93' },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        min: -yBound, max: yBound,
                        ticks: { callback: (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString() }
                    }
                },
                plugins: buildScatterPlugins('time')
            }
        });
    }

    const durationCtx = document.getElementById('durationPerformanceChart');
    if (durationCtx) {
        destroyChartInstance(durationPerformanceChart);
        // Auto-scale the duration (x) axis to your longest trade
        const maxDur = list.reduce((m, t) => Math.max(m, parseDurationMins(t)), 0);
        const xBound = niceAxisBound(Math.max(maxDur, 5) * 1.1);

        durationPerformanceChart = new Chart(durationCtx.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'P/L',
                    data: list.map(t => {
                        const mins = parseDurationMins(t);
                        return {
                            x: mins,
                            y: getNetProfit(t),
                            symbol: t.symbol,
                            durLabel: formatDurationLabel(mins)
                        };
                    }),
                    backgroundColor: d => d.raw ? profitScatterColor(d.raw.y, tradeExtremes) : 'rgba(0,240,168,0.5)',
                    pointRadius: d => d.raw ? profitPointRadius(d.raw.y, tradeExtremes) : 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                // Require the mouse to actually be over a dot (less sensitive)
                interaction: { mode: 'point', intersect: true },
                scales: {
                    x: {
                        title: { display: true, text: 'How long held (min)', color: '#8e8e93' },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        min: 0, max: xBound
                    },
                    y: {
                        title: { display: true, text: 'Profit / Loss ($)', color: '#8e8e93' },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        min: -yBound, max: yBound,
                        ticks: { callback: (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString() }
                    }
                },
                plugins: buildScatterPlugins('duration')
            }
        });
    }
}

let scoreRadarChart = null;
let cumulativePnlChart = null;
let dailyPnlChart = null;
let drawdownChart = null;

function getDailyPnLSeries() {
    const map = {};
    (trades || []).forEach(t => {
        if (!t.date) return;
        if (!map[t.date]) map[t.date] = { pnl: 0, symbols: {} };
        const p = getNetProfit(t);
        map[t.date].pnl += p;
        const sym = t.symbol || '—';
        map[t.date].symbols[sym] = (map[t.date].symbols[sym] || 0) + p;
    });
    return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, info]) => ({
            date,
            pnl: info.pnl,
            // Symbols traded that day, biggest mover first
            symbols: Object.entries(info.symbols)
                .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                .map(([symbol, pnl]) => ({ symbol, pnl }))
        }));
}

function formatChartDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${m}/${d}/${y.slice(2)}`;
}

function computeMaxDrawdown(dailySeries) {
    let peak = 0;
    let cum = 0;
    let maxDD = 0;
    dailySeries.forEach(({ pnl }) => {
        cum += pnl;
        if (cum > peak) peak = cum;
        const dd = peak - cum;
        if (dd > maxDD) maxDD = dd;
    });
    return maxDD;
}

function clampScore(val) {
    return Math.max(0, Math.min(100, val));
}

function computeScoreMetrics() {
    const list = trades || [];
    const winningTrades = list.filter(t => getNetProfit(t) > 0);
    const losingTrades = list.filter(t => getNetProfit(t) < 0);
    const wins = winningTrades.length;
    const losses = losingTrades.length;
    const total = list.length;

    const winPct = total > 0 ? (wins / total) * 100 : 0;

    const grossProfit = winningTrades.reduce((s, t) => s + getNetProfit(t), 0);
    const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + getNetProfit(t), 0));
    // Saturating curves so strong values score high but don't instantly pin at 100.
    // (e.g. profit factor 2 -> 50, 3 -> ~60, 5 -> ~71). Perfect 100 is reserved
    // for the rare "no losses at all" case.
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
    const pfScore = grossLoss > 0
        ? clampScore(100 * profitFactor / (profitFactor + 2))
        : (grossProfit > 0 ? 95 : 0);

    const avgWin = wins > 0 ? grossProfit / wins : 0;
    const avgLoss = losses > 0 ? grossLoss / losses : 0;
    const avgRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    const avgWlScore = avgLoss > 0
        ? clampScore(100 * avgRatio / (avgRatio + 1.5))
        : (avgWin > 0 ? 95 : 0);

    const dailySeries = getDailyPnLSeries();
    const netPL = sumNetProfit(list);
    const maxDrawdown = computeMaxDrawdown(dailySeries);
    const recoveryFactor = maxDrawdown > 0 ? netPL / maxDrawdown : 0;
    const recoveryScore = maxDrawdown > 0
        ? (netPL > 0 ? clampScore(100 * recoveryFactor / (recoveryFactor + 4)) : 0)
        : (netPL > 0 ? 95 : 0);

    const ddBaseline = Math.max(maxDrawdown, Math.abs(netPL), 500, 1);
    const maxDdScore = clampScore(100 - (maxDrawdown / ddBaseline) * 100);

    const dayWins = dailySeries.filter(d => d.pnl > 0).length;
    const consistencyScore = dailySeries.length > 0 ? (dayWins / dailySeries.length) * 100 : 0;

    const values = [
        winPct,
        pfScore,
        avgWlScore,
        recoveryScore,
        maxDdScore,
        consistencyScore
    ].map(v => Math.round(v * 10) / 10);

    const overall = values.length
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
        : 0;

    return {
        labels: ['Win %', 'Profit factor', 'Avg win/loss', 'Recovery factor', 'Max drawdown', 'Consistency'],
        descriptions: [
            'How often your trades finish in profit.',
            'Total profit divided by total losses. Above 1 means you make more than you lose.',
            'Your average winning trade compared to your average losing trade.',
            'Net profit divided by your largest drawdown — how well you bounce back.',
            'The biggest drop from a peak. Higher score means smaller drawdowns.',
            'The percentage of your trading days that were profitable.'
        ],
        values,
        overall
    };
}

function destroyChartInstance(chart) {
    if (chart) chart.destroy();
}

function initPerformanceCharts() {
    const metrics = computeScoreMetrics();
    const dailySeries = getDailyPnLSeries();
    const dates = dailySeries.map(d => formatChartDate(d.date));
    const dailyPnls = dailySeries.map(d => d.pnl);

    let running = 0;
    const cumulativePnls = dailyPnls.map(p => { running += p; return running; });

    const overallEl = document.getElementById('overallScoreDisplay');
    const markerEl = document.getElementById('scoreMeterMarker');
    if (overallEl) overallEl.textContent = metrics.overall.toFixed(2);
    if (markerEl) markerEl.style.left = `${metrics.overall}%`;

    const radarCtx = document.getElementById('scoreRadarChart');
    if (radarCtx) {
        destroyChartInstance(scoreRadarChart);
        scoreRadarChart = new Chart(radarCtx.getContext('2d'), {
            type: 'radar',
            data: {
                labels: metrics.labels,
                datasets: [{
                    data: metrics.values,
                    backgroundColor: 'rgba(123, 97, 255, 0.35)',
                    borderColor: 'rgba(123, 97, 255, 0.9)',
                    borderWidth: 2,
                    pointBackgroundColor: '#7b61ff',
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointHitRadius: 12
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // Slightly easier to trigger, but still tied to the nearest point
                interaction: { mode: 'nearest', intersect: false },
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: { display: false, stepSize: 25 },
                        grid: { color: 'rgba(255,255,255,0.08)' },
                        angleLines: { color: 'rgba(255,255,255,0.08)' },
                        pointLabels: { color: '#8e8e93', font: { size: 10 } }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: '#1a1a1a',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#ffffff',
                        titleFont: { size: 13, weight: '700' },
                        bodyColor: '#c7c7cc',
                        bodyFont: { size: 12 },
                        callbacks: {
                            title: (items) => `${metrics.labels[items[0].dataIndex]} — ${items[0].parsed.r}/100`,
                            label: (item) => metrics.descriptions[item.dataIndex] || ''
                        }
                    }
                }
            }
        });
    }

    const cumCtx = document.getElementById('cumulativePnlChart');
    if (cumCtx) {
        destroyChartInstance(cumulativePnlChart);
        const cumCtx2d = cumCtx.getContext('2d');

        // Vertical gradient anchored to the chart: green at the top, fully
        // transparent right at the $0 line (built per-render so it stays aligned)
        const zeroAnchoredGradient = (context) => {
            const chart = context.chart;
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return 'rgba(0, 240, 168, 0)';
            const zeroY = scales.y.getPixelForValue(0);
            const g = ctx.createLinearGradient(0, chartArea.top, 0, zeroY);
            g.addColorStop(0, 'rgba(0, 240, 168, 0.35)');
            g.addColorStop(1, 'rgba(0, 240, 168, 0)');
            return g;
        };

        cumulativePnlChart = new Chart(cumCtx2d, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Cumulative P/L',
                    data: cumulativePnls,
                    dayData: dailySeries,
                    borderColor: '#00f0a8',
                    backgroundColor: zeroAnchoredGradient,
                    fill: 'origin',
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: '#00f0a8',
                    pointBorderColor: '#0b0b0d',
                    pointBorderWidth: 1,
                    pointHoverRadius: 6,
                    pointHitRadius: 20
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#8e8e93', maxTicksLimit: 8, font: { size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#8e8e93',
                            callback: (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString()
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: '#1a1a1a',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#ffffff',
                        titleFont: { size: 13, weight: '700' },
                        bodyColor: '#c7c7cc',
                        bodyFont: { size: 12 },
                        callbacks: {
                            title: (items) => items[0].label,
                            label: (ctx) => {
                                const day = dailySeries[ctx.dataIndex];
                                const lines = [`Total: ${formatSignedMoney(ctx.parsed.y)}`];
                                if (day) lines.push(`Day: ${formatMoneyWithSign(day.pnl)}`);
                                return lines;
                            }
                        }
                    }
                }
            }
        });
    }

    const dailyCtx = document.getElementById('dailyPnlChart');
    if (dailyCtx) {
        destroyChartInstance(dailyPnlChart);
        dailyPnlChart = new Chart(dailyCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: dates,
                datasets: [{
                    label: 'Daily P/L',
                    data: dailyPnls,
                    backgroundColor: dailyPnls.map(v =>
                        v > 0 ? 'rgba(0, 240, 168, 0.85)' : (v < 0 ? 'rgba(255, 77, 109, 0.85)' : 'rgba(255,255,255,0.25)')
                    ),
                    borderRadius: 4,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#8e8e93', maxTicksLimit: 8, font: { size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: {
                            color: '#8e8e93',
                            callback: (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString()
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: '#1a1a1a',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#ffffff',
                        titleFont: { size: 13, weight: '700' },
                        bodyColor: '#c7c7cc',
                        bodyFont: { size: 12 },
                        callbacks: {
                            title: (items) => items[0].label,
                            label: (ctx) => `Day: ${formatMoneyWithSign(ctx.parsed.y)}`
                        }
                    }
                }
            }
        });
    }

    initDrawdownChart();
}

// Drawdown over time (distance below equity peak)
function getDrawdownSeries() {
    const dailySeries = getDailyPnLSeries();
    let peak = 0;
    let cum = 0;
    return dailySeries.map(({ date, pnl }) => {
        cum += pnl;
        if (cum > peak) peak = cum;
        return { date, drawdown: cum - peak };
    });
}

function initDrawdownChart() {
    const ctx = document.getElementById('drawdownChart');
    if (!ctx) return;

    destroyChartInstance(drawdownChart);
    const series = getDrawdownSeries();
    const labels = series.map(d => formatChartDate(d.date));
    const values = series.map(d => d.drawdown);

    drawdownChart = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Drawdown',
                data: values,
                borderColor: '#5b7fb8',
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const { ctx: c, chartArea, scales } = chart;
                    if (!chartArea) return 'rgba(255, 77, 109, 0)';
                    const zeroY = scales.y.getPixelForValue(0);
                    const g = c.createLinearGradient(0, zeroY, 0, chartArea.bottom);
                    g.addColorStop(0, 'rgba(255, 77, 109, 0)');
                    g.addColorStop(1, 'rgba(255, 77, 109, 0.5)');
                    return g;
                },
                fill: 'origin',
                tension: 0.35,
                pointRadius: 3,
                pointBackgroundColor: '#5b7fb8',
                pointBorderColor: '#0b0b0d',
                pointBorderWidth: 1,
                pointHitRadius: 20,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8e8e93', maxTicksLimit: 8, font: { size: 10 } }
                },
                y: {
                    max: 0,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#8e8e93',
                        callback: (v) => (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString()
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    backgroundColor: '#1a1a1a',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        title: (items) => items[0].label,
                        label: (ctx) => `Drawdown: ${formatSignedMoney(ctx.parsed.y)}`
                    }
                }
            }
        }
    });
}

// --- U.S. Stock Market (NYSE/Nasdaq) Holiday Helpers ---
// These days have no trading, so they are hidden from the calendar.
function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// nth weekday of a month (weekday: 0=Sun..6=Sat, n: 1-based)
function nthWeekdayOfMonth(year, month, weekday, n) {
    const firstDow = new Date(year, month, 1).getDay();
    const day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
    return new Date(year, month, day);
}

// last given weekday of a month
function lastWeekdayOfMonth(year, month, weekday) {
    const last = new Date(year, month + 1, 0);
    const day = last.getDate() - ((last.getDay() - weekday + 7) % 7);
    return new Date(year, month, day);
}

// Observed date: Sat holidays -> Friday before, Sun holidays -> Monday after
function observedHoliday(date) {
    const dow = date.getDay();
    if (dow === 6) return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    if (dow === 0) return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return date;
}

// Easter Sunday (Anonymous Gregorian algorithm) -> used for Good Friday
function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

const _holidayCache = {};
function getMarketHolidays(year) {
    if (_holidayCache[year]) return _holidayCache[year];
    const map = new Map();
    const easter = easterSunday(year);
    map.set(fmtDate(observedHoliday(new Date(year, 0, 1))), "New Year's Day");
    map.set(fmtDate(nthWeekdayOfMonth(year, 0, 1, 3)), "MLK Jr. Day");
    map.set(fmtDate(nthWeekdayOfMonth(year, 1, 1, 3)), "Presidents' Day");
    map.set(fmtDate(new Date(year, easter.getMonth(), easter.getDate() - 2)), "Good Friday");
    map.set(fmtDate(lastWeekdayOfMonth(year, 4, 1)), "Memorial Day");
    if (year >= 2022) map.set(fmtDate(observedHoliday(new Date(year, 5, 19))), "Juneteenth");
    map.set(fmtDate(observedHoliday(new Date(year, 6, 4))), "Independence Day");
    map.set(fmtDate(nthWeekdayOfMonth(year, 8, 1, 1)), "Labor Day");
    map.set(fmtDate(nthWeekdayOfMonth(year, 10, 4, 4)), "Thanksgiving");
    map.set(fmtDate(observedHoliday(new Date(year, 11, 25))), "Christmas Day");
    _holidayCache[year] = map;
    return map;
}

function isMarketHoliday(dateStr, year) {
    return getMarketHolidays(year).has(dateStr);
}

function getHolidayName(dateStr, year) {
    return getMarketHolidays(year).get(dateStr) || '';
}

// Weekend check (Sat/Sun)
function isWeekendDate(dateStr) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
}

// True for weekends and market holidays (i.e. days you can't trade)
function isNonTradingDay(dateStr) {
    if (isWeekendDate(dateStr)) return true;
    const year = new Date(dateStr + 'T00:00:00').getFullYear();
    return isMarketHoliday(dateStr, year);
}

// The nearest trading day before the given date (skips weekends & holidays)
function prevTradingDayStr(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    let guard = 0;
    do {
        d.setDate(d.getDate() - 1);
        guard++;
    } while (isNonTradingDay(fmtDate(d)) && guard < 30);
    return fmtDate(d);
}

// Populate Calendar (weekdays only, non-trading days hidden)
function populateCalendar() {
    const calendarGrid = document.querySelector('.calendar-grid');
    if (!calendarGrid) return;

    const today = new Date();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    const monthHeader = document.getElementById('currentMonthYear');
    if (monthHeader) monthHeader.textContent = `${monthNames[currentMonth]} ${currentYear}`;

    // Full reset to avoid DOM confusion
    calendarGrid.innerHTML = '';

    // Enforce a 5 weekday columns + weekly summary layout (overrides any stale CSS cache)
    const weeklyCol = document.body.classList.contains('calendar-page') ? '190px' : '120px';
    calendarGrid.style.gridTemplateColumns = `repeat(5, 1fr) ${weeklyCol}`;
    if (document.body.classList.contains('calendar-page')) {
        calendarGrid.classList.add('calendar-grid--wide-weekly');
    }

    // Day Headers (Mon-Fri trading days only + weekly summary)
    const headers = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'WEEKLY'];
    headers.forEach(h => {
        const div = document.createElement('div');
        div.className = 'day-header';
        if (h === 'WEEKLY') div.style.color = 'var(--accent-primary)';
        div.textContent = h;
        calendarGrid.appendChild(div);
    });

    const dailyExtremes = getDailyProfitExtremes();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    // Monday-based index of the 1st (Mon=0..Sun=6)
    const mondayFirstDay = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;
    const lastPos = (daysInMonth - 1) + mondayFirstDay;
    const totalWeeks = Math.floor(lastPos / 7) + 1;

    const buildEmptyCell = () => {
        const div = document.createElement('div');
        div.className = 'day-cell empty';
        return div;
    };

    let weekLabelNum = 0;
    let monthTotal = 0;
    let monthTradeCount = 0;
    for (let w = 0; w < totalWeeks; w++) {
        const weekCells = [];
        let weekTotal = 0;
        let weekTradeCount = 0;
        let weekHasDay = false;

        // Only Mon-Fri (columns 0-4); Sat/Sun (5-6) are omitted entirely
        for (let col = 0; col < 5; col++) {
            const pos = w * 7 + col;
            const d = pos - mondayFirstDay + 1;

            if (d < 1 || d > daysInMonth) {
                weekCells.push(buildEmptyCell());
                continue;
            }

            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            // Market holidays: show a grayed-out cell with the holiday name.
            // Only cross it out once the day has passed.
            if (isMarketHoliday(dateStr, currentYear)) {
                weekHasDay = true;
                const todayStr = fmtDate(today);
                const isPast = dateStr < todayStr;
                const holidayCell = document.createElement('div');
                holidayCell.className = isPast ? 'day-cell holiday passed' : 'day-cell holiday';
                holidayCell.title = `${getHolidayName(dateStr, currentYear)} - Market Closed`;
                holidayCell.innerHTML = `
                    <span class="day-num">${d}</span>
                    <div class="holiday-name">${getHolidayName(dateStr, currentYear)}</div>
                    <div class="holiday-tag">Market Closed</div>
                `;
                weekCells.push(holidayCell);
                continue;
            }

            weekHasDay = true;
            const cell = document.createElement('div');
            cell.className = 'day-cell';

            const dayTrades = trades.filter(t => t.date === dateStr);
            const dailyProfit = sumNetProfit(dayTrades);
            const tradeCount = dayTrades.length;
            const dailyWins = dayTrades.filter(t => getNetProfit(t) >= 0).length;
            const dailyWinRate = tradeCount > 0 ? (dailyWins / tradeCount * 100).toFixed(1) : 0;

            weekTotal += dailyProfit;
            weekTradeCount += tradeCount;
            monthTradeCount += tradeCount;

            cell.innerHTML = `<span class="day-num">${d}</span>`;
            cell.onclick = () => {
                window.location.href = `day-view.html?date=${dateStr}`;
            };

            if (tradeCount > 0) {
                // Scale color intensity relative to your own best day / worst day
                // (kept subtle so heavy days don't look overwhelming)
                const intensity = profitIntensity(dailyProfit, dailyExtremes);
                const finalOpacity = 0.06 + (intensity * 0.26);

                if (dailyProfit > 0) {
                    cell.style.background = `rgba(0, 240, 168, ${finalOpacity})`;
                    cell.style.border = `1.5px solid rgba(0, 240, 168, ${0.25 + intensity * 0.4})`;
                } else if (dailyProfit < 0) {
                    cell.style.background = `rgba(255, 77, 109, ${finalOpacity})`;
                    cell.style.border = `1.5px solid rgba(255, 77, 109, ${0.25 + intensity * 0.4})`;
                } else {
                    // Break-even day: neutral white
                    cell.style.background = 'rgba(255, 255, 255, 0.06)';
                    cell.style.border = '1.5px solid rgba(255, 255, 255, 0.25)';
                }

                const dayColor = profitColor(dailyProfit);
                const displayLabel = tradeCount === 1 ? dayTrades[0].symbol : `${tradeCount} Trades`;
                cell.innerHTML += `
                    <div class="cell-profit-val" style="text-align: center; margin-bottom: 2px;">${formatProfit(dailyProfit)}</div>
                    <div style="width: 30%; height: 2px; background: ${dayColor}; margin: 6px auto; border-radius: 1px; opacity: 0.8;"></div>
                    <div class="cell-trade-info" style="text-align: center; opacity: 0.9; font-size: 0.7rem; font-weight: 700; color: ${tradeCount === 1 ? dayColor : 'inherit'}">${displayLabel} / ${dailyWinRate}%</div>
                `;
            }

            if (d === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) {
                if (tradeCount === 0) cell.classList.add('today');
            }

            weekCells.push(cell);
        }

        // Skip weeks that fall entirely outside the current month
        if (!weekHasDay) continue;

        weekCells.forEach(c => calendarGrid.appendChild(c));

        monthTotal += weekTotal;
        weekLabelNum++;
        const summaryCell = document.createElement('div');
        summaryCell.className = 'day-cell weekly-summary';
        summaryCell.innerHTML = `
            <div class="week-label">Week ${weekLabelNum}</div>
            <div class="week-profit" style="color: ${profitColor(weekTotal)}">
                ${formatProfit(weekTotal)}
            </div>
            <div class="week-days">${weekTradeCount} ${weekTradeCount === 1 ? 'trade' : 'trades'}</div>
        `;
        calendarGrid.appendChild(summaryCell);
    }

    // Monthly P/L display (calendar header title)
    const monthlyPnl = document.getElementById('monthlyPnlDisplay');
    if (monthlyPnl) {
        monthlyPnl.textContent = formatProfit(monthTotal);
        monthlyPnl.style.color = profitColor(monthTotal);
    }
    const monthlyTrades = document.getElementById('monthlyTradesDisplay');
    if (monthlyTrades) {
        monthlyTrades.textContent = `${monthTradeCount} ${monthTradeCount === 1 ? 'trade' : 'trades'}`;
    }
}

// Capture the calendar card as a PNG and download it
function screenshotCalendar() {
    const card = document.getElementById('calendarCard');
    if (!card) return;
    if (typeof html2canvas !== 'function') {
        showNotification({ title: 'Screenshot unavailable', message: 'The screenshot library could not be loaded. Please check your connection and try again.' });
        return;
    }

    const btn = document.getElementById('calScreenshotBtn');
    if (btn) btn.disabled = true;

    const bgColor = getComputedStyle(document.body).backgroundColor || '#0b0b0d';
    html2canvas(card, { backgroundColor: bgColor, scale: 2, useCORS: true })
        .then(canvas => {
            const link = document.createElement('a');
            const label = (document.getElementById('currentMonthYear')?.textContent || 'calendar')
                .replace(/\s+/g, '-').toLowerCase();
            link.download = `calendar-${label}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        })
        .catch(() => {
            showNotification({ title: 'Screenshot failed', message: 'Something went wrong while capturing the calendar.' });
        })
        .finally(() => {
            if (btn) btn.disabled = false;
        });
}

function getTickerIcon(symbol) {
    // Icons removed
    return "";
}

// ---- Shared sidebar: identical tabs on every page ----
const SIDEBAR_NAV_ITEMS = [
    { href: 'dashboard.html', label: 'Dashboard', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>' },
    { href: 'calendar.html', label: 'Calendar', icon: '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>' },
    { href: 'day-view.html', label: 'Day View', icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { href: 'trade-view.html', label: 'Trade View', icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path>' },
    { href: 'reports.html', label: 'Reports', icon: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path>' },
    { href: 'ai-chat.html', label: 'AI Chat', icon: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1z"/><path d="M19 13l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5L17 15z"/>' },
    { href: 'trade-replay.html', label: 'Trade Replay', icon: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>' },
    { href: 'progress-tracker.html', label: 'Progress Tracker', icon: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>' },
    { href: 'resources.html', label: 'Resources', icon: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>' }
];

const PAGE_HEADERS = {
    'dashboard.html': { title: 'Trading Dashboard', desc: 'Track, analyze, and optimize your trading performance.' },
    'calendar.html': { title: 'Calendar', desc: 'Your trading month at a glance — click any day to open it.' },
    'day-view.html': { title: 'Day View', desc: 'Deep-dive into a single session — trades, charts, and notes.' },
    'trade-view.html': { title: 'Trade View', desc: 'Search, filter, and manage your complete trade history.' },
    'reports.html': { title: 'Reports', desc: 'Performance breakdowns, drawdowns, and cumulative P/L trends.' },
    'ai-chat.html': { title: 'AI Chat', desc: 'Ask questions about your journal — powered by your trade data.' },
    'trade-replay.html': { title: 'Trade Replay', desc: 'Step through sessions with charts, levels, and playback.' },
    'progress-tracker.html': { title: 'Progress Tracker', desc: 'Visualize your consistency and activity over time.' },
    'resources.html': { title: 'Resources', desc: 'Notebook, links, and reference material for your edge.' },
    'strategies.html': { title: 'Strategies', desc: 'Document and track the setups you trade.' }
};

function applyPageHeader() {
    const page = (window.location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    const meta = PAGE_HEADERS[page];
    if (!meta) return;

    if (page === 'ai-chat.html') {
        const hero = document.getElementById('aiChatHero');
        if (hero && !hero.querySelector('.page-header-eyebrow')) {
            const eyebrow = document.createElement('p');
            eyebrow.className = 'page-header-eyebrow';
            eyebrow.textContent = meta.title;
            const desc = document.createElement('p');
            desc.className = 'page-header-desc';
            desc.textContent = meta.desc;
            const greeting = hero.querySelector('.ai-chat-greeting');
            if (greeting) {
                greeting.before(eyebrow);
                greeting.after(desc);
            }
        }
        return;
    }

    if (page === 'trade-replay.html') {
        const main = document.querySelector('main.replay-page');
        if (main && !main.querySelector('.page-header-block')) {
            const block = document.createElement('header');
            block.className = 'top-header page-header-block';
            block.innerHTML = `<div class="welcome-text"><h1>${meta.title}</h1><p>${meta.desc}</p></div>`;
            main.insertBefore(block, main.firstChild);
        }
        return;
    }

    if (page === 'day-view.html') {
        const header = document.querySelector('.day-view-header');
        if (header && !header.querySelector('.page-intro')) {
            const intro = document.createElement('div');
            intro.className = 'welcome-text page-intro';
            intro.innerHTML = `<h1>${meta.title}</h1><p>${meta.desc}</p>`;
            header.insertBefore(intro, header.firstChild);
        }
        return;
    }

    if (page === 'trade-view.html') {
        const header = document.querySelector('.trade-view-main .top-header');
        if (header && !header.querySelector('.trade-view-title-block')) {
            header.querySelector('h1')?.remove();
            document.getElementById('totalTradesLabel')?.remove();
            const block = document.createElement('div');
            block.className = 'welcome-text trade-view-title-block';
            block.innerHTML = `<h1>${meta.title}</h1><p>${meta.desc}</p>`;
            header.insertBefore(block, header.firstChild);
            header.classList.add('trade-view-header');
        }
        return;
    }

    const header = document.querySelector('main .top-header, main .header');
    if (!header) return;

    let welcome = header.querySelector('.welcome-text');
    if (!welcome) {
        const h1 = header.querySelector('h1');
        const looseP = header.querySelector(':scope > p');
        welcome = document.createElement('div');
        welcome.className = 'welcome-text';
        welcome.innerHTML = `<h1>${meta.title}</h1><p>${meta.desc}</p>`;
        header.insertBefore(welcome, header.firstChild);
        h1?.remove();
        looseP?.remove();
    } else {
        const h1 = welcome.querySelector('h1');
        const p = welcome.querySelector('p');
        if (h1) h1.textContent = meta.title;
        if (p) p.textContent = meta.desc;
        else if (meta.desc) {
            const np = document.createElement('p');
            np.textContent = meta.desc;
            welcome.appendChild(np);
        }
    }
}

function renderSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const current = (window.location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
    const svg = (inner) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const navHtml = SIDEBAR_NAV_ITEMS.map(it => {
        const active = current === it.href.toLowerCase() ? ' active' : '';
        return `<a href="${it.href}" class="nav-item${active}">${svg(it.icon)}<span>${it.label}</span></a>`;
    }).join('');

    sidebar.innerHTML = `
        <div class="logo">
            <span style="color: var(--accent-primary); font-weight: 900; letter-spacing: 1px;">TRADEJOURNAL</span>
        </div>
        <button class="btn-primary" style="margin-bottom: 2rem; width: 100%;" onclick="openModal()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right: 8px;">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add Trade
        </button>
        <nav class="nav-links">${navHtml}</nav>
        <div class="data-backup-panel">
            <div class="data-backup-header">Phone sync</div>
            <button type="button" class="data-backup-btn data-backup-btn--primary" onclick="pushJournalToGithub()">Sync to Phone</button>
            <button type="button" class="data-backup-btn" onclick="pullJournalFromGithub()">Pull Latest</button>
            <input type="file" id="journalImportInput" accept=".json,application/json" style="display:none;" onchange="handleJournalImport(event)">
        </div>
        <div style="margin-top: auto;">
            <a href="#" class="nav-item" onclick="openSettings(); return false;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Settings</span>
            </a>
        </div>
    `;
}

// ---- Theme (dark / light) ----
function applySavedTheme() {
    const theme = localStorage.getItem('tradeJournalTheme') || 'dark';
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function setTheme(theme) {
    localStorage.setItem('tradeJournalTheme', theme);
    applySavedTheme();
}

// Apply immediately so there's no flash of the wrong theme.
applySavedTheme();

// ---- Settings modal (built on demand, works on every page) ----
function openSettings() {
    let modal = document.getElementById('settingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'settingsModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content settings-modal-content">
                <h2 style="margin-bottom: 0.25rem;">Settings</h2>
                <p class="settings-modal-sub">Personalize your journal, fees, and display.</p>

                <div class="settings-section">
                    <div class="settings-section-label">Profile &amp; AI</div>
                    <div class="settings-row settings-row--stack">
                        <div>
                            <div class="settings-row-title">Your name</div>
                            <div class="settings-row-sub">Used in the AI chat greeting.</div>
                        </div>
                        <input type="text" id="settingsUserName" class="settings-token-input" placeholder="Trader" autocomplete="off">
                        <button type="button" class="data-backup-btn" style="width:100%;" onclick="saveUserNameFromSettings()">Save name</button>
                    </div>
                    <div class="settings-row settings-row--stack">
                        <div>
                            <div class="settings-row-title">OpenAI API key (optional)</div>
                            <div class="settings-row-sub">Powers open-ended AI chat. Stored only on this device.</div>
                        </div>
                        <input type="password" id="settingsOpenAIKey" class="settings-token-input" placeholder="sk-..." autocomplete="off">
                        <button type="button" class="data-backup-btn" style="width:100%;" onclick="saveOpenAIKeyFromSettings()">Save API key</button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-label">Trading defaults</div>
                    <div class="settings-row settings-row--stack">
                        <div>
                            <div class="settings-row-title">TOS fee per contract</div>
                            <div class="settings-row-sub">Used for net P/L and fee labels across the journal.</div>
                        </div>
                        <input type="number" id="settingsTosFee" class="settings-token-input" min="0" step="0.01" placeholder="0.65">
                        <button type="button" class="data-backup-btn" style="width:100%;" onclick="saveTosFeeFromSettings()">Save fee rate</button>
                    </div>
                    <div class="settings-row settings-row--stack">
                        <div>
                            <div class="settings-row-title">Default contracts</div>
                            <div class="settings-row-sub">Pre-filled when you open the add-trade form.</div>
                        </div>
                        <input type="number" id="settingsDefaultContracts" class="settings-token-input" min="1" max="999" step="1" placeholder="1">
                        <button type="button" class="data-backup-btn" style="width:100%;" onclick="saveDefaultContractsFromSettings()">Save default</button>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-label">Appearance</div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-title">Light mode</div>
                            <div class="settings-row-sub">Switch between dark and light theme.</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="settingsThemeToggle" onchange="setTheme(this.checked ? 'light' : 'dark')">
                            <span class="switch-slider"></span>
                        </label>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-title">Compact trade table</div>
                            <div class="settings-row-sub">Tighter rows on Trade View for more rows on screen.</div>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="settingsCompactTable" onchange="saveCompactTableFromSettings(this.checked)">
                            <span class="switch-slider"></span>
                        </label>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-label">Sync &amp; backup</div>
                    <div class="settings-row settings-row--stack">
                        <div>
                            <div class="settings-row-title">GitHub sync token</div>
                            <div class="settings-row-sub">One-time setup. Token needs <strong>repo</strong> access at github.com/settings/tokens</div>
                        </div>
                        <input type="password" id="settingsGithubToken" class="settings-token-input" placeholder="ghp_..." autocomplete="off">
                        <button type="button" class="data-backup-btn" style="width:100%;" onclick="saveGithubTokenFromSettings()">Save token</button>
                    </div>
                    <div class="settings-row">
                        <div>
                            <div class="settings-row-title">Backup your data</div>
                            <div class="settings-row-sub">Export or import trades, watchlist, and notes.</div>
                        </div>
                        <div style="display:flex; gap:0.5rem;">
                            <button type="button" class="data-backup-btn" style="width:auto;" onclick="exportJournalData()">Export</button>
                            <button type="button" class="data-backup-btn" style="width:auto;" onclick="importJournalData()">Import</button>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; margin-top:1.25rem;">
                    <button type="button" class="btn-primary" onclick="closeSettings()">Done</button>
                </div>
            </div>
        `;
        modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
        document.body.appendChild(modal);
    }
    const toggle = modal.querySelector('#settingsThemeToggle');
    if (toggle) toggle.checked = (localStorage.getItem('tradeJournalTheme') || 'dark') === 'light';
    const tokenInput = modal.querySelector('#settingsGithubToken');
    if (tokenInput) {
        tokenInput.value = '';
        tokenInput.placeholder = getGithubToken() ? 'Token saved — paste new one to replace' : 'ghp_...';
    }
    const openaiInput = modal.querySelector('#settingsOpenAIKey');
    if (openaiInput) {
        openaiInput.value = '';
        openaiInput.placeholder = getOpenAIKey() ? 'API key saved — paste new one to replace' : 'sk-...';
    }
    const nameInput = modal.querySelector('#settingsUserName');
    if (nameInput) nameInput.value = getUserName();
    const feeInput = modal.querySelector('#settingsTosFee');
    if (feeInput) feeInput.value = getTosFeeRate();
    const contractsInput = modal.querySelector('#settingsDefaultContracts');
    if (contractsInput) contractsInput.value = getDefaultContracts();
    const compactToggle = modal.querySelector('#settingsCompactTable');
    if (compactToggle) compactToggle.checked = isCompactTable();
    modal.style.display = 'flex';
}

function saveTosFeeFromSettings() {
    const input = document.getElementById('settingsTosFee');
    const v = parseFloat(input?.value);
    if (!Number.isFinite(v) || v < 0) {
        showAlert('Enter a valid fee amount (e.g. 0.65).', 'Invalid fee');
        return;
    }
    localStorage.setItem(FEE_SETTING_KEY, String(v));
    updateDashboardStats();
    refreshAllViews();
    showAlert(`Fee rate saved: $${v.toFixed(2)} per contract.`, 'Saved');
}

function saveDefaultContractsFromSettings() {
    const input = document.getElementById('settingsDefaultContracts');
    const v = parseInt(input?.value, 10);
    if (!Number.isFinite(v) || v < 1) {
        showAlert('Enter at least 1 contract.', 'Invalid value');
        return;
    }
    localStorage.setItem(DEFAULT_CONTRACTS_KEY, String(v));
    showAlert(`Default contracts set to ${v}.`, 'Saved');
}

function saveCompactTableFromSettings(enabled) {
    localStorage.setItem(COMPACT_TABLE_KEY, enabled ? '1' : '0');
    populateTradeLog(document.getElementById('tradeLogTableBody') ? getFilteredTrades() : null);
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
}

// ---- AI Chat (OpenAI-powered) ----
const AI_CHAT_KEY = 'tradeJournalAiChat';
const OPENAI_KEY = 'tradeJournalOpenAIKey';
const USER_NAME_KEY = 'tradeJournalUserName';

function getOpenAIKey() {
    return localStorage.getItem(OPENAI_KEY) || '';
}

function setOpenAIKey(key) {
    if (key) localStorage.setItem(OPENAI_KEY, key.trim());
    else localStorage.removeItem(OPENAI_KEY);
}

function updateAiChatSetupUI() {
    const setup = document.getElementById('aiChatSetup');
    const hasKey = !!getOpenAIKey();
    if (setup) setup.hidden = hasKey;
}

window.saveOpenAIKeyFromSettings = function saveOpenAIKeyFromSettings() {
    const input = document.getElementById('settingsOpenAIKey');
    const key = input ? input.value.trim() : '';
    if (!key || key.startsWith('••••')) {
        showAlert('Paste your OpenAI API key first.', 'API Key Needed');
        return;
    }
    setOpenAIKey(key);
    if (input) input.value = '';
    updateAiChatSetupUI();
    showAlert('API key saved. Trade AI is ready.', 'Connected');
};

window.saveOpenAIKeyFromChat = function saveOpenAIKeyFromChat() {
    const input = document.getElementById('aiChatKeyInput');
    const key = input ? input.value.trim() : '';
    if (!key) {
        showAlert('Paste your OpenAI API key first.', 'API Key Needed');
        return;
    }
    setOpenAIKey(key);
    if (input) input.value = '';
    updateAiChatSetupUI();
    showAlert('Connected! Ask me anything about your trades.', 'Ready');
};

function getUserName() {
    return localStorage.getItem(USER_NAME_KEY) || 'Trader';
}

function setUserName(name) {
    localStorage.setItem(USER_NAME_KEY, (name || 'Trader').trim() || 'Trader');
}

window.saveUserNameFromSettings = function saveUserNameFromSettings() {
    const input = document.getElementById('settingsUserName');
    setUserName(input ? input.value : 'Trader');
    showAlert('Name saved.', 'Saved');
    const greeting = document.getElementById('aiChatGreeting');
    if (greeting) greeting.textContent = `${getTimeGreeting()}, ${getUserName()}`;
};

function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
}

function loadAiChatHistory() {
    try {
        const raw = localStorage.getItem(AI_CHAT_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function saveAiChatHistory(messages) {
    localStorage.setItem(AI_CHAT_KEY, JSON.stringify(messages.slice(-40)));
}

function getYesterdayDateStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

function buildTradeContextForAI() {
    const list = trades || [];
    if (!list.length) return 'The user has no trades logged yet.';

    const net = sumNetProfit(list);
    const wins = list.filter(t => getNetProfit(t) > 0);
    const losses = list.filter(t => getNetProfit(t) < 0);
    const winRate = ((wins.length / list.length) * 100).toFixed(1);
    const grossProfit = wins.reduce((s, t) => s + getNetProfit(t), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + getNetProfit(t), 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'N/A';

    const bySymbol = {};
    list.forEach(t => {
        const sym = extractBaseTicker(t.symbol);
        if (!bySymbol[sym]) bySymbol[sym] = { count: 0, pl: 0, wins: 0 };
        bySymbol[sym].count++;
        bySymbol[sym].pl += getNetProfit(t);
        if (getNetProfit(t) >= 0) bySymbol[sym].wins++;
    });
    const topSymbols = Object.entries(bySymbol)
        .map(([sym, s]) => ({ sym, ...s, winRate: ((s.wins / s.count) * 100).toFixed(0) }))
        .sort((a, b) => b.pl - a.pl)
        .slice(0, 8);

    const recent = [...list]
        .sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''))
        .slice(0, 15)
        .map(t => ({
            date: t.date,
            time: t.time,
            symbol: t.symbol,
            type: t.type || '',
            netPL: getNetProfit(t),
            contracts: getTradeContractCount(t),
            notes: (t.notes || '').slice(0, 120)
        }));

    return JSON.stringify({
        totalTrades: list.length,
        netPL: net,
        winRate: `${winRate}%`,
        profitFactor,
        totalFees: sumFees(list),
        topSymbols,
        recentTrades: recent
    });
}

function formatAiMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function isOpenAIUnavailableError(err) {
    const msg = (err?.message || String(err)).toLowerCase();
    return /quota|billing|insufficient|exceeded|rate limit|invalid api key|incorrect api key|authentication/.test(msg);
}

function analyzeBestSetups() {
    const map = {};
    (trades || []).forEach(t => {
        const sym = extractBaseTicker(t.symbol);
        if (!map[sym]) map[sym] = { wins: 0, losses: 0, pl: 0, count: 0 };
        const net = getNetProfit(t);
        map[sym].count++;
        map[sym].pl += net;
        if (net >= 0) map[sym].wins++; else map[sym].losses++;
    });
    const ranked = Object.entries(map)
        .map(([sym, s]) => ({ sym, ...s, winRate: s.count ? (s.wins / s.count * 100) : 0 }))
        .sort((a, b) => b.pl - a.pl);
    if (!ranked.length) return 'You have no trades logged yet. Add some trades and I can analyze your best setups.';
    const top = ranked.slice(0, 5);
    let msg = '**Your best setups by net P/L:**\n\n';
    top.forEach((s, i) => {
        msg += `${i + 1}. **${s.sym}** — ${formatProfit(s.pl)} across ${s.count} trades (${s.winRate.toFixed(0)}% win rate)\n`;
    });
    const best = ranked[0];
    msg += `\nYour strongest ticker so far is **${best.sym}**. Consider focusing on setups you know well there.`;
    return msg;
}

function analyzeYesterday() {
    const y = getYesterdayDateStr();
    const dayTrades = (trades || []).filter(t => t.date === y);
    if (!dayTrades.length) {
        const recent = [...(trades || [])].sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));
        if (!recent.length) return 'No trades in your journal yet.';
        const lastDate = recent[0].date;
        const lastDay = recent.filter(t => t.date === lastDate);
        const pl = sumNetProfit(lastDay);
        let msg = `No trades yesterday. Your most recent session was **${formatTradeDate(lastDate)}** (${formatProfit(pl)}).\n\n`;
        lastDay.forEach(t => {
            msg += `• ${t.symbol} ${formatTime12h(t.time)} — ${formatProfit(getNetProfit(t))}\n`;
        });
        return msg;
    }
    const pl = sumNetProfit(dayTrades);
    const wins = dayTrades.filter(t => getNetProfit(t) >= 0).length;
    let msg = `**Yesterday (${formatTradeDate(y)}):** ${formatProfit(pl)} · ${dayTrades.length} trades · ${wins}W / ${dayTrades.length - wins}L\n\n`;
    dayTrades.forEach(t => {
        msg += `• **${t.symbol}** ${formatTime12h(t.time)} — ${formatProfit(getNetProfit(t))} (${t.type || '—'})\n`;
    });
    return msg;
}

function analyzeMistakes() {
    const list = trades || [];
    if (!list.length) return 'Log more trades and I can spot repeating mistakes.';
    const losses = list.filter(t => getNetProfit(t) < 0);
    if (!losses.length) return 'No losing trades yet — great start! Keep following your rules.';

    const bySymbol = {};
    const byHour = {};
    losses.forEach(t => {
        const sym = extractBaseTicker(t.symbol);
        bySymbol[sym] = (bySymbol[sym] || 0) + 1;
        const h = (t.time || '09:30').split(':')[0];
        byHour[h] = (byHour[h] || 0) + 1;
    });
    const topSym = Object.entries(bySymbol).sort((a, b) => b[1] - a[1])[0];
    const topHour = Object.entries(byHour).sort((a, b) => b[1] - a[1])[0];
    const repeatSymbol = topSym && topSym[1] >= 2;
    const repeatHour = topHour && topHour[1] >= 2;

    let msg = '**Patterns in your losses:**\n\n';
    if (repeatSymbol) msg += `• You lose most often on **${topSym[0]}** (${topSym[1]} losing trades)\n`;
    if (repeatHour) {
        const h = parseInt(topHour[0], 10);
        msg += `• Most losses cluster around **${formatTime12h(`${h}:00`)}** (${topHour[1]} trades)\n`;
    }
    if (!repeatSymbol && !repeatHour) msg += '• Losses are spread out — check if you\'re oversizing or trading outside your best hours.\n';
    const avgLoss = losses.reduce((s, t) => s + getNetProfit(t), 0) / losses.length;
    msg += `• Average loss size: **${formatProfit(avgLoss)}**\n`;
    msg += '\n**Suggestion:** Cut size or skip setups on your worst symbol/time until win rate improves.';
    return msg;
}

function buildGamePlan() {
    const list = trades || [];
    if (!list.length) return 'Add trades to your journal first, then I can build a game plan from your data.';
    const wins = list.filter(t => getNetProfit(t) > 0);
    const winRate = list.length ? (wins.length / list.length * 100) : 0;
    const bestSym = Object.entries(
        list.reduce((m, t) => {
            const s = extractBaseTicker(t.symbol);
            m[s] = (m[s] || 0) + getNetProfit(t);
            return m;
        }, {})
    ).sort((a, b) => b[1] - a[1])[0];

    let msg = '**Game plan for your next session:**\n\n';
    msg += `1. **Focus** — Trade only A+ setups${bestSym ? ` on **${bestSym[0]}** (your best net P/L ticker)` : ''}.\n`;
    msg += `2. **Risk** — Keep position size consistent. Your win rate is **${winRate.toFixed(0)}%**.\n`;
    msg += `3. **Rules** — Stop after 2 consecutive losses or your daily loss limit.\n`;
    msg += `4. **Review** — Log every trade with notes so we can refine this plan.\n`;
    return msg;
}

function summarizePerformance() {
    const list = trades || [];
    if (!list.length) return 'No trades yet. Start logging and I\'ll summarize your performance.';
    const net = sumNetProfit(list);
    const wins = list.filter(t => getNetProfit(t) > 0).length;
    const winRate = (wins / list.length * 100).toFixed(1);
    const grossProfit = list.filter(t => getNetProfit(t) > 0).reduce((s, t) => s + getNetProfit(t), 0);
    const grossLoss = Math.abs(list.filter(t => getNetProfit(t) < 0).reduce((s, t) => s + getNetProfit(t), 0));
    const pf = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';
    return `**Overall performance**\n\n• Net P/L: **${formatProfit(net)}**\n• Trades: **${list.length}**\n• Win rate: **${winRate}%**\n• Profit factor: **${pf}**\n• Fees paid: **${formatMoney(sumFees(list))}**`;
}

function analyzeAccountGoal(question) {
    const list = trades || [];
    if (!list.length) return 'Log some trades first and I can estimate how long it might take to hit your goal.';

    const goalMatch = question.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*k?/i);
    let goal = 1000;
    if (goalMatch) {
        const raw = parseFloat(goalMatch[1].replace(/,/g, ''));
        goal = /k/i.test(goalMatch[0]) ? raw * 1000 : raw;
    }

    const currentNet = sumNetProfit(list);
    const remaining = goal - currentNet;

    if (remaining <= 0) {
        return `**You've already hit ${formatProfit(goal)}** in net P/L (current: **${formatProfit(currentNet)}**). Nice work — consider raising your target or focusing on consistency.`;
    }

    const byDay = {};
    list.forEach(t => {
        if (!t.date) return;
        byDay[t.date] = (byDay[t.date] || 0) + getNetProfit(t);
    });
    const days = Object.keys(byDay).sort();
    const dailyPLs = days.map(d => byDay[d]);
    const avgDaily = dailyPLs.reduce((s, v) => s + v, 0) / dailyPLs.length;

    if (avgDaily <= 0) {
        return `**Goal: ${formatProfit(goal)}** · Current net P/L: **${formatProfit(currentNet)}** · Still need **${formatProfit(remaining)}**\n\nYour average trading day is **${formatProfit(avgDaily)}**, so I can't project a timeline yet. Focus on consistency first — once your average day is positive, ask again.`;
    }

    const tradingDaysNeeded = Math.ceil(remaining / avgDaily);
    const calendarWeeks = Math.ceil((tradingDaysNeeded / 5) * 7 / 7);

    let msg = `**Path to ${formatProfit(goal)} in net P/L**\n\n`;
    msg += `• Current net P/L: **${formatProfit(currentNet)}**\n`;
    msg += `• Remaining: **${formatProfit(remaining)}**\n`;
    msg += `• Avg per trading day: **${formatProfit(avgDaily)}** (across ${days.length} days)\n`;
    msg += `• Est. trading days needed: **~${tradingDaysNeeded}**\n`;
    msg += `• Rough calendar time: **~${calendarWeeks} week${calendarWeeks === 1 ? '' : 's'}** (assuming ~5 trading days/week)\n\n`;
    msg += `_This is based on your journal averages — actual results will vary. Keep size consistent and stick to your best setups._`;
    return msg;
}

function answerWithLocalAI(question) {
    const q = question.toLowerCase();
    if (/best setup|best ticker|best symbol|what.*trade/.test(q)) return analyzeBestSetups();
    if (/yesterday|last session|recent day/.test(q)) return analyzeYesterday();
    if (/mistake|repeat|pattern|losing|bad habit/.test(q)) return analyzeMistakes();
    if (/game plan|tomorrow|plan for|next session/.test(q)) return buildGamePlan();
    if (/summar|overview|performance|how am i|how'm i|win rate|profit factor|net p/.test(q)) return summarizePerformance();
    if (/how long|until|reach|goal|account|1000|\$1,?000|1k/.test(q)) return analyzeAccountGoal(question);
    return null;
}

function localAiFallbackHint() {
    return `I can answer from your journal data. Try:\n\n• "Show my best setups"\n• "Review yesterday's trades"\n• "What mistakes am I repeating?"\n• "How long until I have $1000?"\n• "Summarize my performance"\n\nAdd billing to your OpenAI account (or a new API key in Settings) for open-ended AI chat.`;
}

async function callOpenAIChat(userMessage, history) {
    const key = getOpenAIKey();
    if (!key) throw new Error('No API key — connect OpenAI on the AI Chat page or in Settings.');

    const prior = history
        .filter(m => !m.loading && m.content)
        .slice(-12)
        .map(m => ({ role: m.role, content: m.content }));

    const messages = [
        {
            role: 'system',
            content: `You are Trade AI, an expert trading coach inside a personal options trade journal app. The user is ${getUserName()}.

Always ground answers in their actual journal data below. Be direct, practical, and conversational — not robotic. Use bullet points when listing trades or stats. Reference specific symbols, dates, and dollar amounts from their data.

JOURNAL DATA (JSON):
${buildTradeContextForAI()}`
        },
        ...prior,
        { role: 'user', content: userMessage }
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 800,
            temperature: 0.65
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No response.';
}

function renderAiChatMessages(messages) {
    const thread = document.getElementById('aiChatThread');
    const hero = document.getElementById('aiChatHero');
    const bar = document.getElementById('aiChatComposerBar');
    if (!thread) return;

    const hasMessages = messages.length > 0;
    if (hero) hero.hidden = hasMessages;
    if (bar) bar.hidden = !hasMessages;
    thread.hidden = !hasMessages;

    thread.innerHTML = messages.filter(m => !m.loading).map(m => `
        <div class="ai-chat-msg ai-chat-msg--${m.role}">
            ${m.role === 'assistant' ? '<div class="ai-chat-msg-avatar">📈</div>' : ''}
            <div class="ai-chat-bubble">${m.role === 'assistant' ? formatAiMarkdown(m.content) : escapeHtml(m.content)}</div>
        </div>
    `).join('') + (messages.some(m => m.loading) ? '<div class="ai-chat-msg ai-chat-msg--assistant"><div class="ai-chat-msg-avatar">📈</div><div class="ai-chat-bubble ai-chat-bubble--typing">Thinking…</div></div>' : '');

    thread.scrollTop = thread.scrollHeight;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendAiMessage(text) {
    const msg = (text || '').trim();
    if (!msg) return;

    const history = loadAiChatHistory();
    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: '', loading: true });
    saveAiChatHistory(history);
    renderAiChatMessages(history);

    let reply;

    try {
        if (getOpenAIKey()) {
            reply = await callOpenAIChat(msg, history.filter(m => !m.loading));
        } else {
            reply = answerWithLocalAI(msg);
            if (!reply) reply = localAiFallbackHint();
        }
    } catch (err) {
        if (isOpenAIUnavailableError(err)) {
            reply = answerWithLocalAI(msg);
            if (!reply) {
                reply = `OpenAI quota/billing issue — using journal mode instead.\n\n${localAiFallbackHint()}`;
            } else {
                reply += '\n\n_(OpenAI unavailable — answered from your journal data.)_';
            }
        } else {
            reply = answerWithLocalAI(msg);
            if (reply) {
                reply += '\n\n_(OpenAI error — answered from your journal data.)_';
            } else {
                reply = `Something went wrong: ${err.message}`;
            }
        }
    }

    const updated = loadAiChatHistory().filter(m => !m.loading);
    updated.push({ role: 'assistant', content: reply });
    saveAiChatHistory(updated);
    renderAiChatMessages(updated);
}

window.sendAiChatMessage = sendAiMessage;

function initAiChat() {
    const heroInput = document.getElementById('aiChatInput');
    const barInput = document.getElementById('aiChatInputBar');
    if (!heroInput && !barInput) return;

    const greeting = document.getElementById('aiChatGreeting');
    if (greeting) greeting.textContent = `${getTimeGreeting()}, ${getUserName()}`;

    updateAiChatSetupUI();

    const history = loadAiChatHistory();
    renderAiChatMessages(history);

    const bindInput = (input, btn) => {
        if (!input) return;
        const send = () => {
            sendAiMessage(input.value);
            input.value = '';
            input.style.height = 'auto';
        };
        btn?.addEventListener('click', send);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
        });
    };

    bindInput(heroInput, document.getElementById('aiChatSendBtn'));
    bindInput(barInput, document.getElementById('aiChatSendBarBtn'));

    document.querySelectorAll('.ai-chat-chip').forEach(chip => {
        chip.addEventListener('click', () => sendAiMessage(chip.dataset.prompt));
    });
}

// ---- Whole-page screenshot (camera on every page) ----
function loadHtml2canvas() {
    return new Promise((resolve, reject) => {
        if (typeof html2canvas === 'function') return resolve();
        let s = document.getElementById('html2canvasScript');
        if (s) {
            s.addEventListener('load', () => resolve());
            s.addEventListener('error', reject);
            return;
        }
        s = document.createElement('script');
        s.id = 'html2canvasScript';
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

function screenshotPage() {
    const target = document.querySelector('.main-content') || document.body;
    const btn = document.getElementById('pageScreenshotBtn');
    if (btn) btn.disabled = true;
    loadHtml2canvas()
        .then(() => {
            const bgColor = getComputedStyle(document.body).backgroundColor || '#0b0b0d';
            return html2canvas(target, { backgroundColor: bgColor, scale: 2, useCORS: true });
        })
        .then(canvas => {
            const link = document.createElement('a');
            const page = (window.location.pathname.split('/').pop() || 'page').replace('.html', '') || 'page';
            link.download = `${page}-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        })
        .catch(() => showNotification({ title: 'Screenshot failed', message: 'Could not capture the page. Check your connection and try again.' }))
        .finally(() => { if (btn) btn.disabled = false; });
}

function injectScreenshotButton() {
    if (document.getElementById('pageScreenshotBtn')) return;
    if (!document.querySelector('.main-content')) return;
    const btn = document.createElement('button');
    btn.id = 'pageScreenshotBtn';
    btn.className = 'page-shot-fab';
    btn.title = 'Screenshot this page';
    btn.setAttribute('data-html2canvas-ignore', 'true');
    btn.onclick = screenshotPage;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`;
    document.body.appendChild(btn);
}

// --- NEW CUSTOM MODAL LOGIC (Replaces native alert/confirm/prompt) ---
let modalResolve = null;

function showNotification({ title, message, type = 'alert', defaultValue = '' }) {
    console.log('--- Modal: showNotification triggered ---', { title, type });
    const modal = document.getElementById('notificationModal');
    const titleElem = document.getElementById('notificationTitle');
    const msgElem = document.getElementById('notificationMessage');
    const inputElem = document.getElementById('notificationInput');
    const cancelBtn = document.getElementById('notificationCancel');
    const confirmBtn = document.getElementById('notificationConfirm');

    if (!modal) {
        console.error('Modal element #notificationModal not found in DOM');
        return Promise.resolve(null);
    }

    titleElem.textContent = title;
    msgElem.textContent = message;

    // Reset states
    inputElem.style.display = 'none';
    cancelBtn.style.display = 'none';
    inputElem.value = defaultValue;
    confirmBtn.textContent = 'OK';

    if (type === 'confirm') {
        cancelBtn.style.display = 'flex';
        confirmBtn.textContent = 'Yes, Proceed';
    } else if (type === 'prompt') {
        inputElem.style.display = 'block';
        cancelBtn.style.display = 'flex';
        confirmBtn.textContent = 'Submit';
        setTimeout(() => inputElem.focus(), 100);
    }

    modal.setAttribute('style', `
        display: flex !important;
        position: fixed !important;
        top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 100vh !important;
        background: rgba(0,0,0,0.92) !important;
        z-index: 1000000 !important;
        align-items: center !important;
        justify-content: center !important;
        backdrop-filter: blur(10px) !important;
    `);

    // Restore critical listeners
    confirmBtn.onclick = () => {
        console.log('Modal: Confirm clicked');
        const input = document.getElementById('notificationInput');
        closeNotification(input.style.display !== 'none' ? input.value : true);
    };
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            console.log('Modal: Cancel clicked');
            closeNotification(null);
        };
    }
    modal.onclick = (e) => {
        if (e.target === modal) {
            console.log('Modal: Background clicked');
            closeNotification(null);
        }
    };

    return new Promise((resolve) => {
        modalResolve = resolve;
    });
}

function closeNotification(value) {
    console.log('--- Modal: closeNotification internal triggered with value:', value);
    const modal = document.getElementById('notificationModal');
    if (modal) modal.style.display = 'none';
    if (modalResolve) {
        console.log('--- Modal: Resolving promise with:', value);
        modalResolve(value);
        modalResolve = null;
    } else {
        console.warn('--- Modal: closeNotification called but no promise was waiting (modalResolve is null)');
    }
}

// Convenience wrappers
window.showAlert = (msg, title = 'Success!') => showNotification({ title, message: msg, type: 'alert' });
window.showConfirm = (msg, title = 'Are you sure?') => showNotification({ title, message: msg, type: 'confirm' });
window.showPrompt = (msg, def = '', title = 'Input Required') => showNotification({ title, message: msg, type: 'prompt', defaultValue: def });
// --- END CUSTOM MODAL LOGIC ---

function populateTradeLog(filteredTrades = null) {
    const tableBody = document.getElementById('tradeLogTableBody');
    if (!tableBody) return;

    const tableWrap = document.querySelector('.trade-log-table-wrap');
    if (tableWrap) tableWrap.classList.toggle('trade-log-table-wrap--compact', isCompactTable());

    const dataToDisplay = filteredTrades || trades;
    tableBody.innerHTML = '';

    if (dataToDisplay.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="11" style="padding: 2rem; text-align: center; color: var(--text-muted);">No trades found for the selected range.</td></tr>';
        return;
    }

    const tradeExtremes = getTradeProfitExtremesForList(dataToDisplay);

    dataToDisplay.forEach((t) => {
        const row = document.createElement('tr');
        row.className = 'trade-row-item';

        const netProfit = getNetProfit(t);
        const grossProfit = getGrossProfit(t);
        const netROI = getNetROI(t);
        const tradeType = t.type || (netProfit >= 0 ? 'Call' : 'Put');
        const contracts = getTradeContractCount(t);

        row.innerHTML = `
            <td class="trade-col-date">${formatTradeDate(t.date)}</td>
            <td class="trade-col-time">${formatTradeTimeFrame(t)}</td>
            <td>
                ${renderTickerBadgeHtml(t.symbol, (t.strategy === 'Paper Trading' || t.isPaper) ? '<span class="paper-tag">PAPER</span>' : '')}
            </td>
            <td class="trade-col-ct">${contracts}</td>
            <td>
                <span class="trade-status-badge ${netProfit >= 0 ? 'trade-status-badge--win' : 'trade-status-badge--loss'}">
                    ${netProfit >= 0 ? 'WIN' : 'LOSS'}
                </span>
            </td>
            <td class="trade-col-type" style="color: ${profitColor(netProfit)}">${tradeType}</td>
            <td class="trade-col-pl" style="color: ${profitColor(grossProfit)}">${formatProfit(grossProfit)}</td>
            <td class="trade-col-pl" style="color: ${profitColor(netProfit)}">
                ${formatProfit(netProfit)}
                <div class="trade-fee-note">${getProfitFeeNote(t)}</div>
            </td>
            <td class="trade-col-roi" style="color: ${profitColor(netProfit)}">${formatROI(netROI)}</td>
            <td class="trade-col-scale">${renderTradeScaleHtml(netProfit, tradeExtremes)}</td>
            <td class="trade-col-actions">
                <div class="trade-row-actions">
                    <button class="btn-secondary edit-btn-log" data-id="${t.id}">Edit</button>
                    <button class="btn-secondary delete-btn-log" data-id="${t.id}">Delete</button>
                </div>
            </td>
        `;

        // Direct event listener attachment
        const editBtn = row.querySelector('.edit-btn-log');
        const deleteBtn = row.querySelector('.delete-btn-log');

        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                console.log('Edit button clicked for ID:', t.id);
                e.stopPropagation();
                openEditModal(t.id);
            });
        }
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                console.log('!! Delete button clicked !! for ID:', t.id);
                e.stopPropagation();
                deleteTrade(t.id);
            });
        }

        // Safer row click: Navigate to Day View instead of modal
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) {
                return;
            }
            window.location.href = `day-view.html?date=${t.date}`;
        });

        tableBody.appendChild(row);
    });
}

async function applyDateRange() {
    const startDate = await showPrompt("Enter Start Date (YYYY-MM-DD):", "2026-03-01", "Start Date");
    if (!startDate) return;
    const endDate = await showPrompt("Enter End Date (YYYY-MM-DD):", "2026-03-31", "End Date");
    if (!endDate) return;

    tradeViewDateStart = startDate;
    tradeViewDateEnd = endDate;
    populateTradeLog(getFilteredTrades());
}

function closeDayModal() {
    document.getElementById('dayInfoModal').style.display = 'none';
    if (dayViewChart) dayViewChart.destroy();
}

/**
 * Generates a simulated realistic price path for a single trade
 */
function generatePricePath(t) {
    // Better fallbacks for existing/imported trades
    const entryPrice = parseFloat(t.entryPrice) || parseFloat(t.ask) || 100.00;

    // Determine default direction based on profit if exitPrice is missing
    let defaultExit;
    if (t.exitPrice && parseFloat(t.exitPrice) > 0) {
        defaultExit = parseFloat(t.exitPrice);
    } else {
        const isLoss = (parseFloat(t.profit) < 0);
        defaultExit = isLoss ? (entryPrice * 0.94) : (entryPrice * 1.06);
    }

    const exitPrice = defaultExit;
    const start = t.time || '09:30';
    const end = (t.endTime && t.endTime.includes('T')) ? t.endTime.split('T')[1] : (t.time ? null : '10:30');

    const labels = [];
    const dataPoints = [];
    const steps = 20;

    const startTime = new Date(`2026-01-01T${start}`);
    let endTime;
    if (end) {
        endTime = new Date(`2026-01-01T${end}`);
    } else {
        // If no end time, default to 45 mins later
        endTime = new Date(startTime.getTime() + 45 * 60000);
    }

    if (endTime <= startTime) endTime = new Date(startTime.getTime() + 30 * 60000);

    const timeDiff = (endTime - startTime) / steps;

    for (let i = 0; i <= steps; i++) {
        const stepTime = new Date(startTime.getTime() + timeDiff * i);
        labels.push(stepTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));

        const progress = i / steps;
        const linearPrice = entryPrice + (exitPrice - entryPrice) * progress;
        // Volatility scaled by the move size
        const volatility = Math.abs(exitPrice - entryPrice) * 0.2;
        const noise = (Math.random() - 0.5) * volatility;

        if (i === 0) dataPoints.push(entryPrice);
        else if (i === steps) dataPoints.push(exitPrice);
        else dataPoints.push(linearPrice + noise);
    }
    return { labels, dataPoints };
}

let dayViewChart = null;

function showDayDetail(dateStr) {
    const dayTrades = trades.filter(t => t.date === dateStr);
    if (dayTrades.length === 0) return;

    const modal = document.getElementById('dayInfoModal');
    modal.style.display = 'flex';

    const dateObj = new Date(dateStr);
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    document.getElementById('modalDayDate').textContent = dateObj.toLocaleDateString('en-US', options);

    const dayNet = sumNetProfit(dayTrades);
    const dayFees = sumFees(dayTrades);
    const netPLElem = document.getElementById('modalDayNetPL');
    netPLElem.textContent = `Net P/L ${formatProfit(dayNet)}`;
    netPLElem.style.color = dayNet >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';

    // Ticker vs Total Trades logic
    const categoryLabel = document.getElementById('modalTradeCategory');
    if (dayTrades.length === 1) {
        if (categoryLabel) categoryLabel.textContent = 'Ticker';
        document.getElementById('modalTotalTrades').textContent = dayTrades[0].symbol;
    } else {
        if (categoryLabel) categoryLabel.textContent = 'Total Trades';
        document.getElementById('modalTotalTrades').textContent = dayTrades.length;
    }

    // Calculate Trade Cost (Capital Used)
    const dayTradeCost = dayTrades.reduce((sum, t) => sum + (parseFloat(t.ask) || 0) * (parseInt(t.contracts) || 1) * 100, 0);
    const modalTradeCostElem = document.getElementById('modalTradeCost');
    if (modalTradeCostElem) modalTradeCostElem.textContent = `$${dayTradeCost.toLocaleString()}`;

    document.getElementById('modalGrossPL').textContent = formatProfit(dayNet);
    const modalFeesElem = document.getElementById('modalFeesTotal');
    if (modalFeesElem) modalFeesElem.textContent = formatFeesLabel(dayTrades);
    const wins = dayTrades.filter(t => getNetProfit(t) >= 0).length;
    document.getElementById('modalWinLoss').textContent = `${wins} / ${dayTrades.length - wins}`;
    document.getElementById('modalWinRate').textContent = dayTrades.length > 0 ? `${(wins / dayTrades.length * 100).toFixed(0)}%` : '0%';

    const tbody = document.getElementById('modalTradeTableBody');
    tbody.innerHTML = '';
    dayTrades.forEach(t => {
        const netProfit = getNetProfit(t);
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border)';
        row.innerHTML = `
                <td style="padding: 1rem;">${t.time}</td>
                <td>
                    <div class="ticker-badge" style="background: transparent; color: white; border: 1px solid var(--border); box-shadow: none;">
                        <img src="${getTickerIcon(t.symbol)}" class="ticker-icon">
                        <span>${t.symbol}</span>
                    </div>
                </td>
                <td style="padding: 0 10px;">${t.type || 'CALL'}</td>
                <td style="color: var(--text-muted); font-size: 0.75rem; padding-right: 15px;">WEEKLY</td>
                <td style="color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; font-weight: 700;">${formatProfit(netProfit)}</td>
                <td>${(Math.random() * 50).toFixed(1)}%</td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-secondary edit-btn-day" style="padding: 4px 10px; font-size: 0.7rem;">Edit</button>
                        <button class="btn-secondary delete-btn-day" style="padding: 4px 10px; font-size: 0.7rem; color: var(--loss-red); border-color: rgba(255, 77, 109, 0.3);">Delete</button>
                    </div>
                </td>
            `;

        row.querySelector('.edit-btn-day').addEventListener('click', () => {
            closeDayModal();
            openEditModal(t.id);
        });
        row.querySelector('.delete-btn-day').addEventListener('click', () => {
            deleteTrade(t.id);
        });

        tbody.appendChild(row);
    });

    // Init Mini Chart in Modal - ENHANCED to simulate price action
    if (dayViewChart) dayViewChart.destroy();
    const ctx = document.getElementById('modalDayChart').getContext('2d');

    let labels = [];
    let dataPoints = [];

    if (dayTrades.length === 1) {
        const path = generatePricePath(dayTrades[0]);
        labels = path.labels;
        dataPoints = path.dataPoints;
    } else {
        const chartTrades = [...dayTrades].sort((a, b) => a.time.localeCompare(b.time));
        labels = chartTrades.map(t => t.time);
        dataPoints = chartTrades.map(t => getNetProfit(t));
    }

    const isWinner = dayNet >= 0;

    dayViewChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: dataPoints,
                borderColor: isWinner ? '#00f0a8' : '#ff4d6d',
                backgroundColor: isWinner ? 'rgba(0, 240, 168, 0.05)' : 'rgba(255, 77, 109, 0.05)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: (ctx) => (ctx.dataIndex === 0 || ctx.dataIndex === dataPoints.length - 1) ? 6 : 0,
                pointBackgroundColor: (ctx) => ctx.dataIndex === 0 ? '#ffffff' : (isWinner ? '#0ef0a8' : '#ff4d6d'),
                pointBorderWidth: 2,
                pointBorderColor: '#000'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            scales: {
                x: {
                    display: true,
                    grid: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 }, maxRotation: 0 }
                },
                y: {
                    display: true,
                    position: 'right',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 9 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleColor: '#00f2fe',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: (context) => `Price: $${context.parsed.y.toFixed(2)}`
                    }
                }
            }
        }
    });
}
function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    populateCalendar();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    populateCalendar();
}

// Stepper Logic
function increment() {
    const input = document.getElementById('contractsInput');
    if (input) {
        input.value = parseInt(input.value) + 1;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function decrement() {
    const input = document.getElementById('contractsInput');
    if (input && parseInt(input.value) > 1) {
        input.value = parseInt(input.value) - 1;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

let editingIndex = -1;
let profitManuallyEdited = false;
let formLoadingTrade = false;

async function deleteTrade(tradeId) {
    console.log('!!! CORE: deleteTrade called for ID:', tradeId);
    if (!tradeId) {
        console.error('Core: No ID provided to deleteTrade');
        return;
    }
    const idx = trades.findIndex(t => t.id === tradeId);

    if (idx === -1) {
        console.error('Core: Trade NOT found for ID:', tradeId);
        return;
    }

    console.log('Core: Trade found at index:', idx, trades[idx].symbol);
    const confirmed = await showConfirm('Are you sure you want to delete this trade?', 'Confirm Deletion');
    console.log('Core: Confirm result:', confirmed);

    if (confirmed) {
        trades.splice(idx, 1);
        saveTrades();
        refreshAllViews();
        populateSymbolFilter();
        showAlert('Trade successfully removed.', 'Deleted!');
    }
}

window.deleteAllTrades = async function deleteAllTrades() {
    if (!trades.length) {
        showAlert('There are no trades to delete.', 'Nothing to Delete');
        return;
    }
    const confirmed = await showConfirm(
        `Delete all ${trades.length} trades? This cannot be undone.`,
        'Delete All Trades'
    );
    if (!confirmed) return;
    trades = [];
    tradeViewSymbols = [];
    tradeViewDateStart = '';
    tradeViewDateEnd = '';
    tradeViewResultFilter = 'all';
    tradeViewTypeFilter = 'all';
    saveTrades();
    refreshAllViews();
    populateSymbolFilter();
    showAlert('All trades have been removed.', 'Deleted!');
};

function openEditModal(tradeId) {
    const idx = trades.findIndex(t => t.id === tradeId);
    if (idx === -1) return;

    editingIndex = idx;
    const t = trades[idx];
    formLoadingTrade = true;
    profitManuallyEdited = !!t.profitIsManual;

    // Fill form
    if (document.getElementById('symbolInput')) document.getElementById('symbolInput').value = t.symbol || "";
    if (document.getElementById('actionSelect')) document.getElementById('actionSelect').value = t.type || (t.profit >= 0 ? 'Call' : 'Put');
    if (document.getElementById('contractsInput')) {
        document.getElementById('contractsInput').value = t.contracts || 1;
    }

    // Premium fields
    if (document.getElementById('askInput')) document.getElementById('askInput').value = t.ask || "";
    if (document.getElementById('askRange') && t.ask) document.getElementById('askRange').value = t.ask;

    if (document.getElementById('closePremiumInput')) {
        document.getElementById('closePremiumInput').value = t.closePremium || "";
    }
    if (document.getElementById('closePremiumRange') && t.closePremium) {
        document.getElementById('closePremiumRange').value = t.closePremium;
    }

    // Underlying fields
    if (document.getElementById('entryPriceInput')) {
        document.getElementById('entryPriceInput').value = t.entryPrice || "";
        if (document.getElementById('entryPriceRange')) document.getElementById('entryPriceRange').value = t.entryPrice || 0;
    }
    if (document.getElementById('exitPriceInput')) {
        document.getElementById('exitPriceInput').value = t.exitPrice || "";
        if (document.getElementById('exitPriceRange')) document.getElementById('exitPriceRange').value = t.exitPrice || 0;
    }

    if (document.getElementById('startTimeInput')) document.getElementById('startTimeInput').value = t.date && t.time ? `${t.date}T${t.time}` : "";
    if (document.getElementById('endTimeInput')) document.getElementById('endTimeInput').value = t.endTime || "";

    if (document.getElementById('profitInput')) {
        document.getElementById('profitInput').value = t.profit ?? 0;
        if (document.getElementById('profitRange')) document.getElementById('profitRange').value = t.profit || 0;
    }

    formLoadingTrade = false;
    if (document.getElementById('contractsInput')) {
        document.getElementById('contractsInput').dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (document.getElementById('notesInput')) document.getElementById('notesInput').value = t.notes || "";

    // Prefill image if trade has one
    setImagePreview(t.imageDataUrl || null);

    const tradeModal = document.getElementById('tradeModal');
    if (tradeModal) {
        tradeModal.querySelector('h2').textContent = 'Edit Trade';
        tradeModal.querySelector('button[type="submit"]').textContent = 'Update Trade';
        tradeModal.style.display = 'flex';
    }
}

const DAILY_CHECKLIST_ITEMS = [
    'Reviewed pre-market plan',
    'Only traded watchlist stocks',
    'Respected stop losses',
    'Journaled all trades',
    'No revenge trading'
];

function getChecklistKey(dateStr) {
    return `tradeJournalChecklist_${dateStr}`;
}

function getChecklistState(dateStr) {
    try {
        return JSON.parse(localStorage.getItem(getChecklistKey(dateStr)) || '[]');
    } catch {
        return [];
    }
}

function saveChecklistState(dateStr, checked) {
    localStorage.setItem(getChecklistKey(dateStr), JSON.stringify(checked));
}

function updateTodayScore() {
    const todayStr = fmtDate(new Date());
    const checked = getChecklistState(todayStr);
    const count = checked.filter(Boolean).length;
    const total = DAILY_CHECKLIST_ITEMS.length;
    const display = document.getElementById('todayScoreDisplay');
    const fill = document.getElementById('todayScoreBarFill');
    if (display) display.textContent = `${count}/${total}`;
    if (fill) fill.style.width = `${(count / total) * 100}%`;
}

function openDailyChecklist() {
    const modal = document.getElementById('checklistModal');
    if (!modal) return;
    const todayStr = fmtDate(new Date());
    const checked = getChecklistState(todayStr);
    const container = document.getElementById('checklistItems');
    if (!container) return;

    container.innerHTML = DAILY_CHECKLIST_ITEMS.map((item, i) => `
        <label class="checklist-item">
            <input type="checkbox" data-idx="${i}" ${checked[i] ? 'checked' : ''}>
            <span>${item}</span>
        </label>
    `).join('');

    container.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
            const state = DAILY_CHECKLIST_ITEMS.map((_, idx) => {
                const cb = container.querySelector(`input[data-idx="${idx}"]`);
                return !!(cb && cb.checked);
            });
            saveChecklistState(todayStr, state);
            updateTodayScore();
        });
    });

    modal.style.display = 'flex';
}

function closeDailyChecklist() {
    const modal = document.getElementById('checklistModal');
    if (modal) modal.style.display = 'none';
    updateTodayScore();
}

// Cell color based on that day's net P/L, scaled to your biggest win/loss days.
// Green = profit, red = loss, white = break-even, faint = no trades / non-trading day.
function heatmapActivityColor(dayProfit, tradeCount, extremes) {
    if (tradeCount === 0) return 'rgba(255,255,255,0.04)';
    const intensity = Math.max(profitIntensity(dayProfit, extremes), 0.12);
    const op = 0.28 + intensity * 0.72;
    if (dayProfit > 0) return `rgba(0, 240, 168, ${op})`;
    if (dayProfit < 0) return `rgba(255, 77, 109, ${op})`;
    return 'rgba(255, 255, 255, 0.22)';
}

// Build GitHub-style columns, but only trading days (Mon–Fri). Each column is
// one week with 5 cells; weekends are skipped entirely.
function buildHeatmapWeeks(monthsBack) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start;
    if (monthsBack == null) {
        const tradeDates = trades.map(t => t.date).filter(Boolean).sort();
        start = tradeDates.length
            ? new Date(tradeDates[0] + 'T00:00:00')
            : new Date(today);
    } else {
        start = new Date(today);
        start.setMonth(start.getMonth() - monthsBack);
        start.setDate(1);
    }
    const cursor = new Date(start);
    // Snap back to Monday (0=Sun, 1=Mon).
    while (cursor.getDay() !== 1) cursor.setDate(cursor.getDate() - 1);

    const weeks = [];
    while (true) {
        const week = [];
        for (let i = 0; i < 5; i++) {
            week.push({
                date: fmtDate(cursor),
                isFuture: cursor > today
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        // Skip Saturday & Sunday to land on next Monday.
        cursor.setDate(cursor.getDate() + 2);
        weeks.push(week);
        if (cursor > today) break;
    }
    return weeks;
}

function renderHeatmapMonthLabels(weeks, container) {
    if (!container) return;
    container.innerHTML = '';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const shown = new Set();
    weeks.forEach(week => {
        const col = document.createElement('div');
        col.className = 'progress-heatmap-month-label';
        let label = '';
        for (const day of week) {
            if (day.isFuture) continue;
            const d = new Date(day.date + 'T00:00:00');
            if (d.getDate() <= 7) {
                const key = `${d.getFullYear()}-${d.getMonth()}`;
                if (!shown.has(key)) {
                    shown.add(key);
                    label = monthNames[d.getMonth()];
                    break;
                }
            }
        }
        col.textContent = label;
        container.appendChild(col);
    });
}

function renderActivityHeatmap(grid, monthsBack) {
    const weeks = buildHeatmapWeeks(monthsBack);
    renderHeatmapMonthLabels(weeks, document.getElementById('progressHeatmapMonths'));

    const extremes = getDailyProfitExtremes();
    grid.innerHTML = '';
    weeks.forEach(week => {
        const weekCol = document.createElement('div');
        weekCol.className = 'progress-heatmap-week';
        week.forEach(day => {
            const cell = document.createElement('div');
            cell.className = 'progress-heatmap-cell';
            if (day.isFuture) {
                cell.classList.add('is-future');
                weekCol.appendChild(cell);
                return;
            }

            const dayTrades = trades.filter(t => t.date === day.date);
            const tradeCount = dayTrades.length;
            const dayProfit = sumNetProfit(dayTrades);
            const year = new Date(day.date + 'T00:00:00').getFullYear();
            const holiday = isMarketHoliday(day.date, year) ? getHolidayName(day.date, year) : '';

            if (holiday && tradeCount === 0) {
                cell.classList.add('is-holiday');
                cell.title = `${day.date}: ${holiday} (market closed)`;
            } else {
                cell.style.background = heatmapActivityColor(dayProfit, tradeCount, extremes);
                if (tradeCount > 0) {
                    cell.classList.add('has-trades');
                    cell.title = `${day.date}: ${tradeCount} trade${tradeCount > 1 ? 's' : ''}, ${formatProfit(dayProfit)}`;
                    cell.addEventListener('click', () => {
                        window.location.href = `day-view.html?date=${day.date}`;
                    });
                } else {
                    cell.title = `${day.date}: no trades`;
                }
            }

            weekCol.appendChild(cell);
        });
        grid.appendChild(weekCol);
    });
}

function populateDashboardRecentTrades() {
    const body = document.getElementById('dashboardRecentTradesBody');
    if (!body) return;

    const recent = [...(trades || [])]
        .sort((a, b) => {
            const d = (b.date || '').localeCompare(a.date || '');
            if (d !== 0) return d;
            return (b.time || '').localeCompare(a.time || '');
        })
        .slice(0, 7);

    if (!recent.length) {
        body.innerHTML = '<tr><td colspan="6" style="padding:1.5rem;text-align:center;color:var(--text-muted);">No trades yet — use Add Trade in the sidebar.</td></tr>';
        return;
    }

    body.innerHTML = recent.map(t => {
        const net = getNetProfit(t);
        const gross = getGrossProfit(t);
        const roi = getNetROI(t);
        const side = t.type || (net >= 0 ? 'Call' : 'Put');
        return `<tr class="trade-row-item dashboard-trade-row" onclick="window.location.href='day-view.html?date=${t.date}'">
            <td class="trade-col-date">${formatTradeDate(t.date)}</td>
            <td><span class="ticker-badge trade-ticker-badge">${tickerLogoHtml(t.symbol || '')}<span>${t.symbol || '—'}</span></span></td>
            <td class="trade-col-type" style="color:${profitColor(net)}">${side}</td>
            <td class="trade-col-pl" style="color:${profitColor(gross)}">${formatProfit(gross)}</td>
            <td class="trade-col-pl" style="color:${profitColor(net)}">${formatProfit(net)}</td>
            <td class="trade-col-roi" style="color:${profitColor(net)}">${formatROI(roi)}</td>
        </tr>`;
    }).join('');
}

function populateProgressTracker() {
    const grid = document.getElementById('progressTrackerGrid');
    if (!grid) return;

    let currentStreakCount = 0;
    let longestStreakCount = 0;
    let activeDaysCount = new Set(trades.map(t => t.date).filter(Boolean)).size;

    const tradeDates = trades.map(t => t.date).filter(Boolean).sort();
    const firstTradeStr = tradeDates.length ? tradeDates[0] : fmtDate(new Date());
    const tradingDays = [];
    const cursor = new Date(firstTradeStr + 'T00:00:00');
    const endDate = new Date();
    let guard = 0;
    while (cursor <= endDate && guard < 20000) {
        const ds = fmtDate(cursor);
        if (!isNonTradingDay(ds)) tradingDays.push(ds);
        cursor.setDate(cursor.getDate() + 1);
        guard++;
    }
    const totalTradingDays = tradingDays.length;

    if (grid.classList.contains('progress-heatmap')) {
        const monthsBack = document.querySelector('.progress-tracker-page') ? null : 6;
        renderActivityHeatmap(grid, monthsBack);
        updateTodayScore();
    } else {
        grid.innerHTML = '';
        const dailyExtremes = getDailyProfitExtremes();
        tradingDays.forEach(dateStr => {
            const dayTrades = trades.filter(t => t.date === dateStr);
            const dayProfit = sumNetProfit(dayTrades);
            const tradeCount = dayTrades.length;
            const square = document.createElement('div');
            square.title = `${dateStr}: ${tradeCount} trades, ${formatProfit(dayProfit)}`;
            square.style.width = '18px';
            square.style.height = '18px';
            square.style.borderRadius = '2px';
            if (tradeCount === 0) {
                square.style.background = 'rgba(255,255,255,0.05)';
            } else {
                const intensity = Math.max(profitIntensity(dayProfit, dailyExtremes), 0.15);
                const baseColor = dayProfit > 0 ? '0, 240, 168' : (dayProfit < 0 ? '255, 77, 109' : '255, 255, 255');
                square.style.background = `rgba(${baseColor}, ${0.2 + intensity * 0.8})`;
            }
            grid.appendChild(square);
        });
    }

    // Historical Winning Streak Logic (Unique dates with trades)
    const dailyStats = [...new Set(trades.map(t => t.date))].sort().map(d => ({
        date: d,
        profit: sumNetProfit(trades.filter(t => t.date === d))
    }));

    if (dailyStats.length > 0) {
        let tempStreak = 0;
        let allStreaks = [0];

        for (let i = 0; i < dailyStats.length; i++) {
            const current = dailyStats[i];
            const previous = dailyStats[i - 1];

            const isProfitable = current.profit > 0;
            const isConsecutive = previous ? (previous.date === prevTradingDayStr(current.date)) : true;

            if (isProfitable && isConsecutive) {
                tempStreak++;
            } else if (isProfitable) {
                tempStreak = 1;
            } else {
                tempStreak = 0;
            }
            allStreaks.push(tempStreak);
        }
        longestStreakCount = Math.max(...allStreaks);

        const today = new Date();
        const todayStr = fmtDate(today);
        const prevTradeDayStr = prevTradingDayStr(todayStr);

        const lastTradeDay = dailyStats[dailyStats.length - 1];
        if (lastTradeDay.date === todayStr || lastTradeDay.date === prevTradeDayStr) {
            currentStreakCount = allStreaks[allStreaks.length - 1];
        }
    }

    const csDisplay = document.getElementById('currentStreakDisplay');
    const lsDisplay = document.getElementById('longestStreakDisplay');
    const adDisplay = document.getElementById('activeDaysDisplay');

    if (csDisplay) csDisplay.textContent = `${currentStreakCount} Days`;
    if (lsDisplay) lsDisplay.textContent = `${longestStreakCount} Days`;
    if (adDisplay) adDisplay.textContent = `${activeDaysCount} / ${totalTradingDays}`;
}

function refreshAllViews() {
    populateCalendar();
    if (document.getElementById('tradeLogTableBody')) {
        populateTradeLog(getFilteredTrades());
        populateSymbolFilter();
    } else {
        populateTradeLog();
    }
    updateDashboardStats();
    populateDashboardRecentTrades();
    populateProgressTracker();
    initCharts();
    initPerformanceCharts();
    if (typeof initReports === 'function') initReports();
    if (typeof initDayView === 'function') initDayView();
    if (typeof populateNotebook === 'function') populateNotebook();
}

// --- Watchlist & Trade View Filters ---
const DEFAULT_WATCHLIST = [
    'NFLX', 'GOOG', 'ARM', 'META', 'MSFT', 'SPY', 'TGT', 'NVDA', 'SMCI',
    'AMZN', 'QQQ', 'SHOP', 'IWM', 'AAPL', 'HOOD', 'COIN', 'AMD', 'MU', 'TSLA'
];

let tradeViewSymbols = [];
let tradeViewDateStart = '';
let tradeViewDateEnd = '';
let tradeViewResultFilter = 'all';
let tradeViewTypeFilter = 'all';

function getWatchlist() {
    const stored = localStorage.getItem('tradeJournalWatchlist');
    if (stored) {
        try { return JSON.parse(stored); } catch (e) { /* fall through */ }
    }
    return [...DEFAULT_WATCHLIST];
}

function saveWatchlist(list) {
    localStorage.setItem('tradeJournalWatchlist', JSON.stringify(list));
    syncStocklistDatalists();
    renderWatchlistPanel();
    populateSymbolFilter();
}

function syncStocklistDatalists() {
    const options = getWatchlist().map(s => `<option value="${s}">`).join('');
    document.querySelectorAll('#stocklist').forEach(dl => { dl.innerHTML = options; });
}

function extractBaseTicker(symbol) {
    if (!symbol) return '';
    return symbol.trim().split(/\s+/)[0].toUpperCase();
}

function getTickerLogoUrl(symbol) {
    const ticker = extractBaseTicker(symbol);
    if (!ticker) return '';
    return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
}

function tickerLogoHtml(symbol, className = 'ticker-logo') {
    const ticker = extractBaseTicker(symbol);
    if (!ticker) return '';
    const initial = ticker.charAt(0);
    return `<img class="${className}" src="${getTickerLogoUrl(ticker)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('ticker-logo-fallback--hidden')"><span class="ticker-logo-fallback ticker-logo-fallback--hidden" aria-hidden="true">${initial}</span>`;
}

function renderTickerBadgeHtml(symbol, extraHtml = '') {
    const label = symbol || '—';
    return `<div class="ticker-badge trade-ticker-badge">${tickerLogoHtml(label)}<span>${label}</span>${extraHtml}</div>`;
}

function getFilterSymbolChoices() {
    const symbols = new Set(getWatchlist());
    trades.forEach(t => symbols.add(extractBaseTicker(t.symbol)));
    return [...symbols].filter(Boolean).sort();
}

function populateSymbolFilter() {
    if (document.getElementById('symbolFilterList')) {
        renderSymbolFilterList();
        return;
    }
    const select = document.getElementById('symbolFilterSelect');
    if (!select) return;
    const current = select.value;
    const choices = getFilterSymbolChoices();
    select.innerHTML = '<option value="">All Symbols</option>' +
        choices.map(s => `<option value="${s}">${s}</option>`).join('');
    if (current && choices.includes(current)) select.value = current;
}

function renderSymbolFilterList() {
    const list = document.getElementById('symbolFilterList');
    if (!list) return;
    const search = (document.getElementById('symbolFilterSearch')?.value || '').trim().toUpperCase();
    const choices = getFilterSymbolChoices().filter(s => !search || s.includes(search));
    if (choices.length === 0) {
        list.innerHTML = '<div class="filter-symbol-empty">No tickers found</div>';
        return;
    }
    list.innerHTML = choices.map(s => {
        const checked = tradeViewSymbols.includes(s) ? 'checked' : '';
        return `<label class="filter-symbol-item"><input type="checkbox" value="${s}" ${checked} onchange="applyTradeFilters()"><span>${s}</span></label>`;
    }).join('');
}

function getSelectedSymbols() {
    return Array.from(document.querySelectorAll('#symbolFilterList input[type="checkbox"]:checked')).map(c => c.value);
}

function getFilteredTrades() {
    let filtered = [...trades];
    if (tradeViewSymbols.length) {
        const set = new Set(tradeViewSymbols);
        filtered = filtered.filter(t => set.has(extractBaseTicker(t.symbol)));
    }
    if (tradeViewDateStart && tradeViewDateEnd) {
        filtered = filtered.filter(t => t.date >= tradeViewDateStart && t.date <= tradeViewDateEnd);
    } else if (tradeViewDateStart) {
        filtered = filtered.filter(t => t.date >= tradeViewDateStart);
    } else if (tradeViewDateEnd) {
        filtered = filtered.filter(t => t.date <= tradeViewDateEnd);
    }
    if (tradeViewResultFilter === 'win') {
        filtered = filtered.filter(t => getNetProfit(t) >= 0);
    } else if (tradeViewResultFilter === 'loss') {
        filtered = filtered.filter(t => getNetProfit(t) < 0);
    }
    if (tradeViewTypeFilter !== 'all') {
        filtered = filtered.filter(t => {
            const type = t.type || (getNetProfit(t) >= 0 ? 'Call' : 'Put');
            return type === tradeViewTypeFilter;
        });
    }
    return filtered;
}

// ---- Trade View filter popover (all filters optional, applied live) ----
function toggleFilterPanel(forceClose) {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('filterToggleBtn');
    if (!panel) return;
    const willOpen = forceClose === true ? false : panel.hidden;
    panel.hidden = !willOpen;
    if (btn) btn.classList.toggle('active', willOpen);
}

function countActiveFilters() {
    let n = 0;
    if (tradeViewSymbols.length) n++;
    if (tradeViewResultFilter !== 'all') n++;
    if (tradeViewTypeFilter !== 'all') n++;
    if (tradeViewDateStart || tradeViewDateEnd) n++;
    return n;
}

function updateFilterBadge() {
    const badge = document.getElementById('filterCountBadge');
    if (!badge) return;
    const n = countActiveFilters();
    badge.textContent = n;
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
}

// Read whatever the user has chosen and refresh the table. Nothing is required.
function applyTradeFilters() {
    const startInput = document.getElementById('filterDateStart');
    const endInput = document.getElementById('filterDateEnd');
    const resultActive = document.querySelector('#filterResultGroup button.active');
    const typeActive = document.querySelector('#filterTypeGroup button.active');

    tradeViewSymbols = getSelectedSymbols();
    tradeViewDateStart = startInput ? startInput.value : '';
    tradeViewDateEnd = endInput ? endInput.value : '';
    tradeViewResultFilter = resultActive ? resultActive.dataset.result : 'all';
    tradeViewTypeFilter = typeActive ? typeActive.dataset.type : 'all';

    populateTradeLog(getFilteredTrades());
    updateFilterBadge();
}

function resetTradeFilters() {
    tradeViewSymbols = [];
    tradeViewDateStart = '';
    tradeViewDateEnd = '';
    tradeViewResultFilter = 'all';
    tradeViewTypeFilter = 'all';

    const search = document.getElementById('symbolFilterSearch');
    if (search) search.value = '';
    const startInput = document.getElementById('filterDateStart');
    if (startInput) startInput.value = '';
    const endInput = document.getElementById('filterDateEnd');
    if (endInput) endInput.value = '';
    updateFilterDateDisplay();
    document.querySelectorAll('#filterResultGroup button').forEach(b => b.classList.toggle('active', b.dataset.result === 'all'));
    document.querySelectorAll('#filterTypeGroup button').forEach(b => b.classList.toggle('active', b.dataset.type === 'all'));
    renderSymbolFilterList();

    populateTradeLog(getFilteredTrades());
    updateFilterBadge();
}

function updateFilterDateDisplay() {
    const pairs = [
        ['filterDateStart', 'filterDateStartDisplay', 'Start date'],
        ['filterDateEnd', 'filterDateEndDisplay', 'End date']
    ];
    pairs.forEach(([inputId, displayId, placeholder]) => {
        const input = document.getElementById(inputId);
        const display = document.getElementById(displayId);
        if (!display) return;
        if (input && input.value) {
            display.textContent = formatTradeDate(input.value);
            display.classList.add('has-value');
        } else {
            display.textContent = placeholder;
            display.classList.remove('has-value');
        }
    });
}

function initTradeFilterUI() {
    const panel = document.getElementById('filterPanel');
    if (!panel) return;

    const startInput = document.getElementById('filterDateStart');
    const endInput = document.getElementById('filterDateEnd');
    [startInput, endInput].forEach(input => {
        if (!input) return;
        input.addEventListener('change', () => {
            updateFilterDateDisplay();
            applyTradeFilters();
        });
    });

    panel.querySelectorAll('.filter-date-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById(btn.dataset.for);
            if (!input) return;
            if (typeof input.showPicker === 'function') {
                try { input.showPicker(); } catch (_) { /* ignore */ }
            }
        });
    });

    updateFilterDateDisplay();

    // Segmented toggles (Result / Type) apply instantly
    document.querySelectorAll('.segmented').forEach(group => {
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTradeFilters();
        });
    });

    // Close the popover when clicking outside of it
    document.addEventListener('click', (e) => {
        if (panel.hidden) return;
        if (e.target.closest('#filterPanel') || e.target.closest('#filterToggleBtn')) return;
        toggleFilterPanel(true);
    });
}

// ---- Trade Replay (bar-by-bar playback) ----
const replayState = {
    chart: null,
    series: null,
    vwapSeries: null,
    emaSeries: null,
    priceLines: [],
    levelLineRefs: {},
    levelPrices: null,
    levelsLocked: false,
    levelsHidden: false,
    drawTool: 'crosshair',
    userDrawings: [],
    measurePending: null,
    draggingLevel: null,
    preCandles: [],
    tradeCandles: [],
    postCandles: [],
    priorDayCandles: [],
    allCandles: [],
    levels: null,
    markers: [],
    exec: null,
    currentIndex: 0,
    playing: false,
    timer: null,
    speed: 1,
    intervalMin: 1,
    selectedTradeId: null,
    selectedTrade: null,
    selectedDate: '',
    dataSource: '',
    loading: false,
    needsFit: true,
    priceRangeLocked: false,
    resizeObs: null
};

const REPLAY_LEVEL_DEFS = [
    { key: 'pmHigh', color: '#ff9800', title: 'PM High' },
    { key: 'pmLow', color: '#ff9800', title: 'PM Low' },
    { key: 'priorHigh', color: '#2962ff', title: 'PD High' },
    { key: 'priorLow', color: '#2962ff', title: 'PD Low' }
];

function formatTime12h(timeStr) {
    if (!timeStr) return '--';
    const parts = timeStr.split(':').map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function parseTradeDateTime(dateStr, timeStr) {
    const [y, mo, d] = (dateStr || '').split('-').map(Number);
    const [h, mi] = (timeStr || '09:30').split(':').map(Number);
    return new Date(y, mo - 1, d, h || 9, mi || 30, 0);
}

// Lightweight-charts treats timestamps as UTC — encode local wall-clock time so 9:46 shows as 9:46.
function toChartTime(date) {
    return Math.floor(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds()
    ) / 1000);
}

function addChartMinutes(chartTime, minutes) {
    const d = new Date(chartTime * 1000);
    d.setUTCMinutes(d.getUTCMinutes() + minutes);
    return Math.floor(d.getTime() / 1000);
}

function formatChartWallTime(chartTime) {
    const d = new Date(chartTime * 1000);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getTradeEndDateTime(trade) {
    if (trade.endTime && trade.endTime.includes('T')) {
        const [datePart, timePart] = trade.endTime.split('T');
        return parseTradeDateTime(datePart, timePart);
    }
    const start = parseTradeDateTime(trade.date, trade.time);
    let mins = 15;
    const hMatch = (trade.duration || '').match(/(\d+)h/);
    const mMatch = (trade.duration || '').match(/(\d+)m/);
    if (hMatch) mins = parseInt(hMatch[1], 10) * 60;
    if (mMatch) mins = parseInt(mMatch[1], 10);
    if (hMatch && mMatch) mins = parseInt(hMatch[1], 10) * 60 + parseInt(mMatch[1], 10);
    return new Date(start.getTime() + mins * 60000);
}

const REPLAY_MARKET_TZ = 'America/New_York';

function etWallToUnix(dateStr, hours, minutes) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    let guess = Date.UTC(y, mo - 1, d, hours + 4, minutes, 0);
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: REPLAY_MARKET_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    for (let i = 0; i < 4; i++) {
        const parts = formatter.formatToParts(new Date(guess));
        const pick = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
        const diffMin = (hours * 60 + minutes) - (pick('hour') * 60 + pick('minute'));
        if (diffMin === 0) break;
        guess += diffMin * 60 * 1000;
    }
    return Math.floor(guess / 1000);
}

function tradeTimeToChartTime(dateStr, timeStr) {
    const parts = (timeStr || '09:30').split(':').map(Number);
    const [y, mo, d] = dateStr.split('-').map(Number);
    return Math.floor(Date.UTC(y, mo - 1, d, parts[0] || 9, parts[1] || 30, 0) / 1000);
}

function tradeEndToChartTime(trade) {
    if (trade.endTime && trade.endTime.includes('T')) {
        const [datePart, timePart] = trade.endTime.split('T');
        const [h, mi] = timePart.split(':').map(Number);
        return tradeTimeToChartTime(datePart, `${h}:${mi}`);
    }
    const startCt = tradeTimeToChartTime(trade.date, trade.time);
    let mins = 15;
    const hMatch = (trade.duration || '').match(/(\d+)h/);
    const mMatch = (trade.duration || '').match(/(\d+)m/);
    if (hMatch) mins = parseInt(hMatch[1], 10) * 60;
    if (mMatch) mins = parseInt(mMatch[1], 10);
    if (hMatch && mMatch) mins = parseInt(hMatch[1], 10) * 60 + parseInt(mMatch[1], 10);
    return addChartMinutes(startCt, mins);
}

function marketTsToChartTime(unixSec) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: REPLAY_MARKET_TZ,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    }).formatToParts(new Date(unixSec * 1000));
    const pick = (t) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
    return Math.floor(Date.UTC(
        pick('year'), pick('month') - 1, pick('day'),
        pick('hour'), pick('minute'), pick('second')
    ) / 1000);
}

function getMarketDayUnixRange(dateStr) {
    return {
        period1: etWallToUnix(dateStr, 4, 0),
        period2: etWallToUnix(dateStr, 20, 0)
    };
}

function resampleCandles(candles, intervalMin) {
    if (intervalMin <= 1 || !candles.length) return candles;
    const out = [];
    for (let i = 0; i < candles.length; i += intervalMin) {
        const chunk = candles.slice(i, i + intervalMin);
        if (!chunk.length) continue;
        out.push({
            time: chunk[0].time,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((s, c) => s + (c.volume || 0), 0)
        });
    }
    return out;
}

function getPreviousTradingDay(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcEMA(candles, period = 8) {
    if (!candles.length) return [];
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    return candles.map((c, i) => {
        if (i > 0) ema = c.close * k + ema * (1 - k);
        return { time: c.time, value: ema };
    });
}

function calcVwap(candles, sessionStartTime) {
    let cumVol = 0;
    let cumTpVol = 0;
    const out = [];
    candles.forEach(c => {
        if (c.time < sessionStartTime) return;
        const vol = c.volume > 0 ? c.volume : 1;
        const tp = (c.high + c.low + c.close) / 3;
        cumVol += vol;
        cumTpVol += tp * vol;
        out.push({ time: c.time, value: cumTpVol / cumVol });
    });
    return out;
}

function computeReplayLevels(allCandles, dateStr, priorHigh, priorLow) {
    const preStart = tradeTimeToChartTime(dateStr, '4:00');
    const mktOpen = tradeTimeToChartTime(dateStr, '9:30');
    const premarket = allCandles.filter(c => c.time >= preStart && c.time < mktOpen);
    const pmHigh = premarket.length ? Math.max(...premarket.map(c => c.high)) : null;
    const pmLow = premarket.length ? Math.min(...premarket.map(c => c.low)) : null;

    const prices = allCandles.flatMap(c => [c.high, c.low]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const psychLevels = [];
    const startLvl = Math.floor(minP / 10) * 10;
    const endLvl = Math.ceil(maxP / 10) * 10;
    for (let p = startLvl; p <= endLvl; p += 10) {
        if (p % 10 === 0) psychLevels.push(p);
    }
    return { pmHigh, pmLow, priorHigh, priorLow, psychLevels };
}

function getReplayLevelPrice(key) {
    const prices = replayState.levelPrices || {};
    if (Number.isFinite(prices[key])) return prices[key];
    return replayState.levels?.[key];
}

function clearReplayPriceLines() {
    if (!replayState.series || !replayState.priceLines.length) {
        replayState.priceLines = [];
        replayState.levelLineRefs = {};
        return;
    }
    replayState.priceLines.forEach(pl => {
        try { replayState.series.removePriceLine(pl); } catch (e) { /* ignore */ }
    });
    replayState.priceLines = [];
    replayState.levelLineRefs = {};
}

function applyReplayPriceLines(levels) {
    clearReplayPriceLines();
    if (!replayState.series || !levels || replayState.levelsHidden) {
        updateReplayLevelHandles();
        return;
    }
    const add = (price, color, title, style = 0, width = 1) => {
        if (!Number.isFinite(price)) return null;
        const line = replayState.series.createPriceLine({
            price,
            color,
            lineWidth: width,
            lineStyle: style,
            axisLabelVisible: true,
            title
        });
        replayState.priceLines.push(line);
        return line;
    };
    REPLAY_LEVEL_DEFS.forEach(def => {
        const line = add(getReplayLevelPrice(def.key), def.color, def.title);
        if (line) replayState.levelLineRefs[def.key] = line;
    });
    (levels.psychLevels || []).forEach(p => add(p, '#26a69a', String(p), 2, 1));
    updateReplayLevelHandles();
}

function updateReplayLevelHandles() {
    const container = document.getElementById('replayLevelHandles');
    if (!container || !replayState.series || replayState.levelsHidden || replayState.levelsLocked) {
        if (container) container.innerHTML = '';
        return;
    }
    const canDrag = replayState.drawTool === 'levels';
    if (!canDrag) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = REPLAY_LEVEL_DEFS.map(def => {
        const price = getReplayLevelPrice(def.key);
        if (!Number.isFinite(price)) return '';
        const y = replayState.series.priceToCoordinate(price);
        if (y == null) return '';
        return `<div class="replay-level-drag-strip" data-level-key="${def.key}" style="top:${y - 4}px" title="Drag ${def.title}"><span class="replay-level-drag-line"></span></div>`;
    }).join('');

    container.querySelectorAll('.replay-level-drag-strip').forEach(strip => {
        strip.onmousedown = (e) => {
            if (e.button !== 0) return;
            if (replayState.levelsLocked || replayState.levelsHidden) return;
            if (replayState.drawTool !== 'levels') return;
            replayState.draggingLevel = strip.dataset.levelKey;
            document.querySelector('.replay-chart-wrap')?.classList.add('replay-chart-wrap--dragging-level');
            e.preventDefault();
            e.stopPropagation();
        };
    });
}

function setReplayLevelPrice(key, price) {
    if (!Number.isFinite(price)) return;
    if (!replayState.levelPrices) replayState.levelPrices = {};
    replayState.levelPrices[key] = price;
    replayState.levelLineRefs[key]?.applyOptions({ price });
    updateReplayLevelHandles();
}

function clearReplayUserDrawings() {
    (replayState.userDrawings || []).forEach(d => {
        if (d.priceLine) {
            try { replayState.series?.removePriceLine(d.priceLine); } catch (e) { /* ignore */ }
        }
        if (d.lineSeries) {
            try { replayState.chart?.removeSeries(d.lineSeries); } catch (e) { /* ignore */ }
        }
    });
    replayState.userDrawings = [];
    replayState.measurePending = null;
    const label = document.getElementById('replayMeasureLabel');
    if (label) label.hidden = true;
}

function getReplayPanOptions(enabled) {
    return {
        handleScroll: {
            mouseWheel: enabled,
            pressedMouseMove: enabled,
            horzTouchDrag: enabled,
            vertTouchDrag: enabled
        },
        handleScale: {
            mouseWheel: enabled,
            pinch: enabled,
            axisPressedMouseMove: { time: enabled, price: enabled },
            axisDoubleClickReset: { time: enabled, price: enabled }
        }
    };
}

function collectReplayPricePoints(candles) {
    const prices = [];
    (candles || []).forEach(c => {
        prices.push(c.high, c.low, c.open, c.close);
    });
    REPLAY_LEVEL_DEFS.forEach(def => {
        const p = getReplayLevelPrice(def.key);
        if (Number.isFinite(p)) prices.push(p);
    });
    if (replayState.exec) {
        if (Number.isFinite(replayState.exec.entryPrice)) prices.push(replayState.exec.entryPrice);
        if (Number.isFinite(replayState.exec.exitPrice)) prices.push(replayState.exec.exitPrice);
    }
    return prices.filter(Number.isFinite);
}

function applyReplayPriceViewport(candles, force = false) {
    if (!replayState.series) return;
    const ps = replayState.series.priceScale();
    if (!ps) return;
    if (!force && replayState.priceRangeLocked) {
        const current = ps.getVisibleRange?.();
        if (current && Number.isFinite(current.from) && Number.isFinite(current.to)) return;
    }
    const prices = collectReplayPricePoints(candles);
    if (!prices.length) return;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = Math.max((max - min) * 0.14, 1);
    ps.applyOptions({ autoScale: false });
    ps.setVisibleRange({ from: min - pad, to: max + pad });
    replayState.priceRangeLocked = true;
}

function setReplayDrawTool(tool) {
    replayState.drawTool = tool;
    document.querySelectorAll('.replay-draw-btn[data-draw-tool]').forEach(btn => {
        btn.classList.toggle('replay-draw-btn--active', btn.dataset.drawTool === tool);
    });
    const pan = tool === 'crosshair' || tool === 'levels';
    replayState.chart?.applyOptions(getReplayPanOptions(pan));
    const wrap = document.querySelector('.replay-chart-wrap');
    if (wrap) {
        wrap.classList.toggle('replay-chart-wrap--tool-levels', tool === 'levels');
        wrap.classList.toggle('replay-chart-wrap--tool-draw', ['trendline', 'hline', 'measure'].includes(tool));
    }
    updateReplayLevelHandles();
}

function replayZoomChart(factor) {
    const ts = replayState.chart?.timeScale();
    if (!ts) return;
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const center = (range.from + range.to) / 2;
    const half = Math.max(8, ((range.to - range.from) / 2) * factor);
    ts.setVisibleLogicalRange({ from: center - half, to: center + half });
    scheduleSessionOverlayUpdate();
}

function handleReplayChartPointerDown(e) {
    if (!replayState.chart || !replayState.series || e.button !== 0) return;
    const wrap = e.currentTarget;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = replayState.series.coordinateToPrice(y);
    const time = replayState.chart.timeScale().coordinateToTime(x);

    if (replayState.drawTool === 'hline' && Number.isFinite(price)) {
        const line = replayState.series.createPriceLine({
            price,
            color: '#e91e63',
            lineWidth: 1,
            lineStyle: 0,
            axisLabelVisible: true,
            title: price.toFixed(2)
        });
        replayState.userDrawings.push({ type: 'hline', priceLine: line });
        return;
    }

    if (replayState.drawTool === 'trendline' && time != null && Number.isFinite(price)) {
        const pending = replayState.trendPending;
        if (!pending) {
            replayState.trendPending = { time, price };
            return;
        }
        const lineSeries = replayState.chart.addLineSeries({
            color: '#e91e63',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
        });
        const t1 = pending.time;
        const t2 = time;
        const p1 = pending.price;
        const p2 = price;
        lineSeries.setData(t1 <= t2
            ? [{ time: t1, value: p1 }, { time: t2, value: p2 }]
            : [{ time: t2, value: p2 }, { time: t1, value: p1 }]);
        replayState.userDrawings.push({ type: 'trendline', lineSeries });
        replayState.trendPending = null;
        return;
    }

    if (replayState.drawTool === 'measure' && time != null && Number.isFinite(price)) {
        const pending = replayState.measurePending;
        const label = document.getElementById('replayMeasureLabel');
        if (!pending) {
            replayState.measurePending = { time, price, x, y };
            if (label) {
                label.hidden = false;
                label.textContent = 'Click second point';
                label.style.left = `${x}px`;
                label.style.top = `${y - 28}px`;
            }
            return;
        }
        const priceDiff = price - pending.price;
        const pct = pending.price ? (priceDiff / pending.price) * 100 : 0;
        const bars = Math.abs(Math.round((time - pending.time) / 60 / (replayState.intervalMin || 1)));
        if (label) {
            label.hidden = false;
            label.textContent = `${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) · ${bars} bars`;
            label.style.left = `${(x + pending.x) / 2}px`;
            label.style.top = `${Math.min(y, pending.y) - 32}px`;
        }
        const measureLine = replayState.chart.addLineSeries({
            color: '#f59e0b',
            lineWidth: 2,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false
        });
        const t1 = pending.time;
        const t2 = time;
        measureLine.setData(t1 <= t2
            ? [{ time: t1, value: pending.price }, { time: t2, value: price }]
            : [{ time: t2, value: price }, { time: t1, value: pending.price }]);
        replayState.userDrawings.push({ type: 'measure', lineSeries: measureLine });
        replayState.measurePending = null;
    }
}

function initReplayDrawToolbar() {
    document.querySelectorAll('.replay-draw-btn[data-draw-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            replayState.trendPending = null;
            replayState.measurePending = null;
            setReplayDrawTool(btn.dataset.drawTool);
        });
    });

    document.getElementById('replayZoomInBtn')?.addEventListener('click', () => replayZoomChart(0.72));
    document.getElementById('replayZoomOutBtn')?.addEventListener('click', () => replayZoomChart(1.38));
    document.getElementById('replayFitBtn')?.addEventListener('click', () => {
        replayState.needsFit = true;
        replayState.priceRangeLocked = false;
        renderReplayFrame();
    });

    document.getElementById('replayLockLevelsBtn')?.addEventListener('click', () => {
        replayState.levelsLocked = !replayState.levelsLocked;
        document.getElementById('replayLockLevelsBtn')?.classList.toggle('replay-draw-btn--active', replayState.levelsLocked);
        updateReplayLevelHandles();
    });

    document.getElementById('replayHideLevelsBtn')?.addEventListener('click', () => {
        replayState.levelsHidden = !replayState.levelsHidden;
        document.getElementById('replayHideLevelsBtn')?.classList.toggle('replay-draw-btn--active', replayState.levelsHidden);
        applyReplayPriceLines(replayState.levels);
    });

    document.getElementById('replayClearDrawBtn')?.addEventListener('click', () => {
        clearReplayUserDrawings();
        replayState.trendPending = null;
    });

    const wrap = document.querySelector('.replay-chart-wrap');
    const chartEl = document.getElementById('replayChart');
    if (!wrap || !chartEl) return;

    chartEl.addEventListener('mousedown', (e) => {
        if (!['hline', 'trendline', 'measure'].includes(replayState.drawTool)) return;
        handleReplayChartPointerDown(e);
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (!replayState.draggingLevel || !replayState.series || e.buttons !== 1) return;
        const rect = chartEl.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const price = replayState.series.coordinateToPrice(y);
        if (Number.isFinite(price)) setReplayLevelPrice(replayState.draggingLevel, price);
    });

    window.addEventListener('mouseup', () => {
        if (replayState.draggingLevel) {
            replayState.draggingLevel = null;
            wrap.classList.remove('replay-chart-wrap--dragging-level');
        }
    });
}

function sanitizeMarketCandles(candles) {
    if (!candles.length) return candles;
    return candles.map((c, i) => {
        const prevClose = i > 0 ? candles[i - 1].close : c.open;
        const maxMove = Math.max(prevClose * 0.012, 0.5);
        let { open, high, low, close } = c;

        const bodyHigh = Math.max(open, close);
        const bodyLow = Math.min(open, close);
        const capHigh = Math.max(open, close, prevClose) + maxMove;
        const capLow = Math.min(open, close, prevClose) - maxMove;

        if (high > capHigh) high = bodyHigh + maxMove * 0.35;
        if (low < capLow) low = bodyLow - maxMove * 0.35;

        high = Math.max(high, bodyHigh);
        low = Math.min(low, bodyLow);
        return { ...c, open, high, low, close };
    });
}

function updateSessionOverlays() {
    const overlay = document.getElementById('replaySessionOverlay');
    const trade = replayState.selectedTrade;
    if (!overlay || !replayState.chart || !trade?.date) {
        if (overlay) overlay.innerHTML = '';
        return;
    }
    const ts = replayState.chart.timeScale();
    const dateStr = trade.date;
    const preStart = tradeTimeToChartTime(dateStr, '4:00');
    const mktOpen = tradeTimeToChartTime(dateStr, '9:30');
    const postStart = tradeTimeToChartTime(dateStr, '16:00');
    const postEnd = tradeTimeToChartTime(dateStr, '20:00');
    const all = replayState.allCandles?.length
        ? replayState.allCandles
        : [...(replayState.preCandles || []), ...(replayState.tradeCandles || []), ...(replayState.postCandles || [])];
    const barSec = Math.max(60, (replayState.intervalMin || 1) * 60);

    const coordForTime = (t) => {
        let x = ts.timeToCoordinate(t);
        if (x != null) return x;
        if (!all.length) return null;
        let nearest = all[0].time;
        let bestDiff = Math.abs(nearest - t);
        all.forEach(c => {
            const d = Math.abs(c.time - t);
            if (d < bestDiff) { bestDiff = d; nearest = c.time; }
        });
        return ts.timeToCoordinate(nearest);
    };

    const buildRegion = (from, to, cls, candlesInRange) => {
        let x1;
        let x2;
        if (candlesInRange.length) {
            x1 = ts.timeToCoordinate(candlesInRange[0].time);
            const last = candlesInRange[candlesInRange.length - 1];
            x2 = ts.timeToCoordinate(last.time);
            if (x2 != null) {
                const endCoord = ts.timeToCoordinate(last.time + barSec) ?? ts.timeToCoordinate(to);
                if (endCoord != null) x2 = Math.max(x2, endCoord);
                else x2 += 10;
            }
        } else {
            x1 = coordForTime(from);
            x2 = coordForTime(to);
        }
        if (x1 == null || x2 == null) return '';
        const left = Math.min(x1, x2);
        const width = Math.max(2, Math.abs(x2 - x1));
        return `<div class="${cls}" style="left:${left}px;width:${width}px"></div>`;
    };

    const preCandles = all.filter(c => c.time >= preStart && c.time < mktOpen);
    const postCandles = all.filter(c => c.time >= postStart && c.time <= postEnd);
    const todayPreStart = tradeTimeToChartTime(dateStr, '4:00');
    const priorDayCandles = all.filter(c => c.time < todayPreStart);
    const regions = [];
    if (priorDayCandles.length) {
        regions.push(buildRegion(
            priorDayCandles[0].time,
            todayPreStart,
            'replay-shade-prior-day',
            priorDayCandles
        ));
    }
    regions.push(
        buildRegion(preStart, mktOpen, 'replay-shade-premarket', preCandles),
        buildRegion(postStart, postEnd, 'replay-shade-postmarket', postCandles)
    );
    overlay.innerHTML = regions.filter(Boolean).join('');
}

function scheduleSessionOverlayUpdate() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            updateSessionOverlays();
            updateReplayExecOverlay();
            updateReplayLevelHandles();
        });
    });
}

function replayTimeToCoordinate(ts, chartTime, candles) {
    let x = ts.timeToCoordinate(chartTime);
    if (x != null) return x;
    if (!candles?.length) return null;

    let before = null;
    let after = null;
    candles.forEach(c => {
        if (c.time <= chartTime && (!before || c.time > before.time)) before = c;
        if (c.time >= chartTime && (!after || c.time < after.time)) after = c;
    });

    if (before && after && before.time !== after.time) {
        const xBefore = ts.timeToCoordinate(before.time);
        const xAfter = ts.timeToCoordinate(after.time);
        if (xBefore != null && xAfter != null) {
            const ratio = (chartTime - before.time) / (after.time - before.time);
            return xBefore + (xAfter - xBefore) * ratio;
        }
    }

    const nearest = findCandleAtTime(candles, chartTime);
    return ts.timeToCoordinate(nearest?.time);
}

function buildReplaySeriesMarkers() {
    return [];
}

function fitReplayTradeViewport() {
    const ts = replayState.chart?.timeScale();
    const exec = replayState.exec;
    if (!ts || !exec) return false;
    const barSec = Math.max(60, (replayState.intervalMin || 1) * 60);
    const from = exec.entryTime - barSec * 50;
    const to = exec.exitTime + barSec * 12;
    try {
        ts.setVisibleRange({ from, to });
        return true;
    } catch (e) {
        return false;
    }
}

function setInitialReplayViewport(visibleCount) {
    if (!replayState.chart || visibleCount < 1) return;
    const fitCandles = [
        ...(replayState.preCandles || []),
        ...(replayState.tradeCandles || []),
        ...(replayState.postCandles || [])
    ];
    if (fitReplayTradeViewport()) {
        applyReplayPriceViewport(fitCandles.length ? fitCandles : replayState.allCandles, true);
        scheduleSessionOverlayUpdate();
        return;
    }
    const ts = replayState.chart.timeScale();
    const windowSize = Math.min(visibleCount, 140);
    ts.setVisibleLogicalRange({
        from: Math.max(0, visibleCount - windowSize),
        to: visibleCount + 12
    });
    applyReplayPriceViewport(fitCandles.length ? fitCandles : replayState.allCandles, true);
    scheduleSessionOverlayUpdate();
}

function updateReplayIndicators(visible) {
    if (!visible.length || !replayState.vwapSeries || !replayState.emaSeries) return;
    const sessionOpen = replayState.selectedTrade
        ? tradeTimeToChartTime(replayState.selectedTrade.date, '9:30')
        : 0;
    replayState.emaSeries.setData(calcEMA(visible, 8));
    replayState.vwapSeries.setData(calcVwap(visible, sessionOpen));
}

async function fetchMarketChartJson(url) {
    const errors = [];
    const tryDirect = async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    };
    const tryAllOrigins = async () => {
        const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        const wrap = await res.json();
        if (!wrap?.contents) throw new Error('Empty proxy response');
        return JSON.parse(wrap.contents);
    };
    for (const fn of [tryDirect, tryAllOrigins]) {
        try {
            return await fn();
        } catch (err) {
            errors.push(err.message);
        }
    }
    throw new Error(errors.join(' · '));
}

async function fetchYahooMarketCandles(ticker, dateStr) {
    const { period1, period2 } = getMarketDayUnixRange(dateStr);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&period1=${period1}&period2=${period2}&includePrePost=true`;
    const data = await fetchMarketChartJson(url);
    const err = data?.chart?.error;
    if (err) throw new Error(err.description || 'Market data unavailable');
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No market data for this date');

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
        const open = q.open?.[i];
        const high = q.high?.[i];
        const low = q.low?.[i];
        const close = q.close?.[i];
        if (![open, high, low, close].every(v => Number.isFinite(v))) continue;
        candles.push({
            time: marketTsToChartTime(ts[i]),
            open, high, low, close,
            volume: q.volume?.[i] || 0
        });
    }
    if (!candles.length) throw new Error('No candles returned for this session');
    return sanitizeMarketCandles(candles);
}

function splitCandlesForTrade(allCandles, trade, priorDayCandles = []) {
    const entryTime = tradeTimeToChartTime(trade.date, trade.time);
    const exitTime = tradeEndToChartTime(trade);
    const postEndTime = addChartMinutes(exitTime, 60);
    const todayPre = allCandles.filter(c => c.time < entryTime);
    const pre = [...priorDayCandles, ...todayPre];
    let tradeBars = allCandles.filter(c => c.time >= entryTime && c.time <= exitTime);
    if (!tradeBars.length) {
        const after = allCandles.filter(c => c.time >= entryTime);
        tradeBars = after.slice(0, Math.max(8, Math.ceil((exitTime - entryTime) / 60)));
    }
    const post = allCandles.filter(c => c.time > exitTime && c.time <= postEndTime);
    return { pre, trade: tradeBars, post };
}

function setReplayDataBadge(text, tone = 'live') {
    const el = document.getElementById('replayDataBadge');
    if (!el) return;
    el.textContent = text;
    el.className = 'replay-data-badge' + (tone === 'warn' ? ' replay-data-badge--warn' : tone === 'load' ? ' replay-data-badge--load' : '');
}

function setReplayChartStatus(message, showRetry = false) {
    const el = document.getElementById('replayChartStatus');
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    el.hidden = false;
    el.innerHTML = `
        <p>${escapeHtml(message)}</p>
        ${showRetry ? '<button type="button" class="replay-status-retry" id="replayRetryBtn">Retry</button>' : ''}
    `;
    if (showRetry) {
        document.getElementById('replayRetryBtn')?.addEventListener('click', () => {
            if (replayState.selectedTrade) loadReplayTrade(replayState.selectedTrade);
        });
    }
}

let replayLoadId = 0;

async function buildReplayCandles(trade, intervalMin) {
    const ticker = extractBaseTicker(trade.symbol);
    const raw = await fetchYahooMarketCandles(ticker, trade.date);
    let priorDayCandles = [];
    let priorHigh = null;
    let priorLow = null;
    try {
        const prevDate = getPreviousTradingDay(trade.date);
        const prevRaw = await fetchYahooMarketCandles(ticker, prevDate);
        priorDayCandles = resampleCandles(prevRaw, intervalMin);
        const rthStart = tradeTimeToChartTime(prevDate, '9:30');
        const rthEnd = tradeTimeToChartTime(prevDate, '16:00');
        const rth = priorDayCandles.filter(c => c.time >= rthStart && c.time <= rthEnd);
        const daySlice = rth.length ? rth : priorDayCandles;
        priorHigh = Math.max(...daySlice.map(c => c.high));
        priorLow = Math.min(...daySlice.map(c => c.low));
    } catch (e) { /* prior day optional */ }

    const resampled = resampleCandles(raw, intervalMin);
    const levels = computeReplayLevels(resampled, trade.date, priorHigh, priorLow);
    const { pre, trade: tradeBars, post } = splitCandlesForTrade(resampled, trade, priorDayCandles);
    if (!tradeBars.length) throw new Error('No candles during your trade window');
    return {
        pre,
        trade: tradeBars,
        post,
        priorDay: priorDayCandles,
        all: [...priorDayCandles, ...resampled],
        levels,
        source: 'yahoo',
        ticker
    };
}

function findCandleAtTime(candles, chartTime) {
    let best = candles[0];
    let bestDiff = Infinity;
    candles.forEach(c => {
        const diff = Math.abs(c.time - chartTime);
        if (diff < bestDiff) { bestDiff = diff; best = c; }
    });
    return best;
}

function findCandleContainingTime(candles, chartTime, intervalMin = 1) {
    const barSec = Math.max(60, intervalMin * 60);
    const found = candles.find(c => chartTime >= c.time && chartTime < c.time + barSec);
    return found || findCandleAtTime(candles, chartTime);
}

function getTradeDirection(trade) {
    const type = (trade.type || '').trim().toLowerCase();
    if (type === 'put') return 'short';
    if (type === 'call') return 'long';
    const entry = parseFloat(trade.entryPrice);
    const exit = parseFloat(trade.exitPrice);
    if (Number.isFinite(entry) && Number.isFinite(exit) && entry !== exit) {
        return exit >= entry ? 'long' : 'short';
    }
    return getNetProfit(trade) >= 0 ? 'long' : 'short';
}

function resolveTradeStockPrice(trade, kind, candle) {
    const stored = parseFloat(kind === 'entry' ? trade.entryPrice : trade.exitPrice);
    if (Number.isFinite(stored) && stored > 0) return stored;
    if (!candle) return null;
    const entryTime = tradeTimeToChartTime(trade.date, trade.time);
    const exitTime = tradeEndToChartTime(trade);
    const targetTime = kind === 'entry' ? entryTime : exitTime;
    const barSec = Math.max(60, (replayState.intervalMin || 1) * 60);
    const offset = Math.max(0, Math.min(1, (targetTime - candle.time) / barSec));
    const interpolated = candle.open + (candle.close - candle.open) * offset;
    if (Number.isFinite(interpolated)) return interpolated;
    return candle.close;
}

function buildReplayExecMeta(trade, allCandles) {
    const entryTime = tradeTimeToChartTime(trade.date, trade.time);
    const exitTime = tradeEndToChartTime(trade);
    const intervalMin = replayState.intervalMin || 1;
    const entryBar = findCandleContainingTime(allCandles, entryTime, intervalMin);
    const exitBar = findCandleContainingTime(allCandles, exitTime, intervalMin);
    const entryPrice = resolveTradeStockPrice(trade, 'entry', entryBar);
    const exitPrice = resolveTradeStockPrice(trade, 'exit', exitBar);
    return {
        entryTime,
        exitTime,
        entryPrice,
        exitPrice,
        direction: getTradeDirection(trade),
        label: getTradeDirection(trade) === 'long' ? 'LONG' : 'SHORT'
    };
}

function buildReplayExecArrowHtml(kind, candleX, y, barWidth) {
    if (candleX == null || y == null || !Number.isFinite(barWidth)) return '';
    const halfBar = Math.max(4, barWidth / 2);
    const arrowW = 22;
    const isEntry = kind === 'entry';
    const left = isEntry ? (candleX - halfBar - arrowW - 2) : (candleX + halfBar + 2);
    const flipClass = isEntry ? '' : ' replay-exec-arrow--exit';
    return `
        <div class="replay-exec-arrow${flipClass}" style="left:${left}px;top:${y}px" title="${isEntry ? 'Entry' : 'Exit'}">
            <svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true">
                <path d="M2 7 H15 M10 3 L16 7 L10 11" fill="none" stroke="#ef5350" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>`;
}

function getReplayBarWidthPx(ts, candles, intervalMin) {
    if (!ts || !candles?.length) return 10;
    const interval = intervalMin || 1;
    for (let i = 0; i < candles.length - 1; i++) {
        const x0 = ts.timeToCoordinate(candles[i].time);
        const x1 = ts.timeToCoordinate(candles[i + 1].time);
        if (x0 != null && x1 != null) return Math.max(6, Math.abs(x1 - x0));
    }
    const barSec = Math.max(60, interval * 60);
    const x0 = ts.timeToCoordinate(candles[0].time);
    const x1 = ts.timeToCoordinate(candles[0].time + barSec);
    if (x0 != null && x1 != null) return Math.max(6, Math.abs(x1 - x0));
    return 10;
}

function buildReplayPositionZonesHtml(xEntry, xExit, yEntry, yExit, dir, label, preview = false) {
    if ([xEntry, xExit, yEntry, yExit].some(v => v == null)) return '';
    const left = Math.min(xEntry, xExit);
    const width = Math.max(6, Math.abs(xExit - xEntry));
    const yTop = Math.min(yEntry, yExit);
    const yBottom = Math.max(yEntry, yExit);
    const greenHeight = Math.max(6, yBottom - yTop);
    const redHeight = Math.max(3, greenHeight / 2);
    const previewClass = preview ? ' replay-position-zone--preview' : '';
    return `
        <div class="replay-position-zone replay-position-zone--${dir}${previewClass}" style="left:${left}px;top:${yTop}px;width:${width}px;height:${greenHeight}px">
            <span class="replay-direction-badge replay-direction-badge--${dir}">${label}</span>
        </div>
        <div class="replay-position-zone replay-position-zone--risk${previewClass}" style="left:${left}px;top:${yBottom}px;width:${width}px;height:${redHeight}px"></div>`;
}

function buildReplayExecMarkerHtml(kind, candleX, y, exec, barWidth) {
    const isEntry = kind === 'entry';
    const price = isEntry ? exec.entryPrice : exec.exitPrice;
    if (candleX == null || y == null || !Number.isFinite(price)) return '';
    return buildReplayExecArrowHtml(kind, candleX, y, barWidth);
}

function updateReplayExecOverlay() {
    const overlay = document.getElementById('replayExecOverlay');
    const exec = replayState.exec;
    if (!overlay || !exec || !replayState.chart || !replayState.series) {
        if (overlay) overlay.innerHTML = '';
        return;
    }

    if (!Number.isFinite(exec.entryPrice) || !Number.isFinite(exec.exitPrice)) {
        overlay.innerHTML = '';
        return;
    }

    const coordCandles = getVisibleReplayCandles();
    const allCandles = replayState.allCandles?.length ? replayState.allCandles : coordCandles;
    if (!coordCandles.length) {
        overlay.innerHTML = '';
        return;
    }

    const atExit = replayState.currentIndex >= replayState.tradeCandles.length - 1;
    const inTrade = replayState.currentIndex >= 0;
    const ts = replayState.chart.timeScale();

    const xEntry = replayTimeToCoordinate(ts, exec.entryTime, allCandles);
    const xExitTarget = replayTimeToCoordinate(ts, exec.exitTime, allCandles);
    const lastVisible = coordCandles[coordCandles.length - 1];
    const xCurrent = replayTimeToCoordinate(ts, lastVisible.time, allCandles);
    const xExit = atExit ? xExitTarget : (inTrade ? xCurrent : xExitTarget);

    const yEntry = replayState.series.priceToCoordinate(exec.entryPrice);
    const zoneExitPrice = atExit ? exec.exitPrice : (inTrade ? lastVisible.close : exec.exitPrice);
    const yExit = replayState.series.priceToCoordinate(zoneExitPrice);
    const yExitExact = replayState.series.priceToCoordinate(exec.exitPrice);

    if (xEntry == null || yEntry == null) {
        overlay.innerHTML = '';
        return;
    }

    const dir = exec.direction;
    const barWidth = getReplayBarWidthPx(ts, allCandles, replayState.intervalMin);
    const xEntryCandle = replayTimeToCoordinate(ts, findCandleContainingTime(allCandles, exec.entryTime, replayState.intervalMin || 1)?.time || exec.entryTime, allCandles);
    const xExitCandle = replayTimeToCoordinate(ts, findCandleContainingTime(allCandles, exec.exitTime, replayState.intervalMin || 1)?.time || exec.exitTime, allCandles);

    let html = `
        <div class="replay-exec-vline replay-exec-vline--entry" style="left:${xEntry}px"></div>
        ${buildReplayExecMarkerHtml('entry', xEntryCandle ?? xEntry, yEntry, exec, barWidth)}`;

    if (xExitTarget != null && yExitExact != null) {
        html += `
        <div class="replay-exec-vline replay-exec-vline--exit${atExit ? '' : ' replay-exec-vline--ghost'}" style="left:${xExitTarget}px"></div>
        ${buildReplayExecMarkerHtml('exit', xExitCandle ?? xExitTarget, yExitExact, exec, barWidth)}`;
    }

    if (inTrade && xExit != null && yExit != null) {
        html += buildReplayPositionZonesHtml(xEntry, xExit, yEntry, yExit, dir, exec.label, false);
    } else if (!inTrade && xExitTarget != null && yExitExact != null) {
        html += buildReplayPositionZonesHtml(xEntry, xExitTarget, yEntry, yExitExact, dir, exec.label, true);
    }

    overlay.innerHTML = html;
}

function getReplayDates() {
    const dates = [...new Set((trades || []).map(t => t.date).filter(Boolean))].sort();
    return dates;
}

function getTradesForReplayDate(dateStr) {
    return (trades || []).filter(t => t.date === dateStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

function pauseReplay() {
    replayState.playing = false;
    if (replayState.timer) {
        clearInterval(replayState.timer);
        replayState.timer = null;
    }
    const icon = document.getElementById('replayPlayIcon');
    if (icon) icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
}

function getVisibleReplayCandles() {
    const tradeSlice = replayState.currentIndex < 0
        ? []
        : replayState.tradeCandles.slice(0, replayState.currentIndex + 1);
    const atEnd = replayState.currentIndex >= replayState.tradeCandles.length - 1;
    const post = atEnd ? (replayState.postCandles || []) : [];
    let visible = [...replayState.preCandles, ...tradeSlice, ...post];
    const interval = replayState.intervalMin || 1;
    const all = replayState.allCandles || [];

    const ensureBar = (chartTime) => {
        const bar = findCandleContainingTime(all, chartTime, interval);
        if (bar && !visible.some(c => c.time === bar.time)) visible.push(bar);
    };

    if (replayState.exec) {
        ensureBar(replayState.exec.entryTime);
        ensureBar(replayState.exec.exitTime);
    }

    visible.sort((a, b) => a.time - b.time);
    return visible;
}

function isReplayAtTradeEnd() {
    return replayState.currentIndex >= replayState.tradeCandles.length - 1;
}

function updateReplayOhlc(candle) {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Number.isFinite(val) ? val.toFixed(2) : '—';
    };
    if (!candle) {
        set('replayO', null); set('replayH', null); set('replayL', null); set('replayC', null);
        return;
    }
    set('replayO', candle.open);
    set('replayH', candle.high);
    set('replayL', candle.low);
    set('replayC', candle.close);
}

function renderReplayFrame() {
    if (!replayState.series) return;
    const visible = getVisibleReplayCandles();
    if (!visible.length) {
        replayState.series.setData([]);
        updateReplayExecOverlay();
        return;
    }

    const ts = replayState.chart?.timeScale();
    const ps = replayState.series?.priceScale();
    const keepTimeRange = ts && !replayState.needsFit ? ts.getVisibleLogicalRange() : null;
    const keepPriceRange = ps && replayState.priceRangeLocked && !replayState.needsFit
        ? ps.getVisibleRange?.()
        : null;

    replayState.series.setData(visible);
    replayState.series.setMarkers(buildReplaySeriesMarkers());
    updateReplayIndicators(visible);

    if (keepTimeRange) {
        try { ts.setVisibleLogicalRange(keepTimeRange); } catch (e) { /* ignore */ }
    }
    if (keepPriceRange && Number.isFinite(keepPriceRange.from) && Number.isFinite(keepPriceRange.to)) {
        try { ps.setVisibleRange(keepPriceRange); } catch (e) { /* ignore */ }
    } else if (replayState.needsFit) {
        applyReplayPriceViewport([
            ...(replayState.preCandles || []),
            ...(replayState.tradeCandles || []),
            ...(replayState.postCandles || [])
        ], true);
    }

    const progress = document.getElementById('replayProgress');
    if (progress) progress.value = String(replayState.currentIndex);

    const label = document.getElementById('replayProgressLabel');
    const total = replayState.tradeCandles.length;
    if (label) {
        const shown = replayState.currentIndex < 0 ? 0 : replayState.currentIndex + 1;
        const postNote = isReplayAtTradeEnd() && replayState.postCandles?.length
            ? ` · +${replayState.postCandles.length} post-exit`
            : '';
        label.textContent = `${shown} / ${total}${postNote}`;
    }

    const last = visible[visible.length - 1];
    updateReplayOhlc(last);

    const meta = document.getElementById('replayChartMeta');
    if (meta && last) meta.textContent = formatChartWallTime(last.time);

    if (replayState.chart && visible.length) {
        if (replayState.needsFit) {
            setInitialReplayViewport(visible.length);
            replayState.needsFit = false;
        } else {
            scheduleSessionOverlayUpdate();
        }
    } else {
        scheduleSessionOverlayUpdate();
    }
}

function setReplayIndex(idx) {
    const max = Math.max(0, replayState.tradeCandles.length - 1);
    replayState.currentIndex = Math.max(-1, Math.min(idx, max));
    renderReplayFrame();
}

function replayStepForward() {
    if (replayState.currentIndex >= replayState.tradeCandles.length - 1) {
        pauseReplay();
        return;
    }
    setReplayIndex(replayState.currentIndex + 1);
}

function replayStepBack() {
    setReplayIndex(replayState.currentIndex - 1);
}

function toggleReplayPlay() {
    if (!replayState.tradeCandles.length) return;
    if (replayState.playing) {
        pauseReplay();
        return;
    }
    if (replayState.currentIndex >= replayState.tradeCandles.length - 1) {
        setReplayIndex(-1);
    }
    replayState.playing = true;
    const icon = document.getElementById('replayPlayIcon');
    if (icon) icon.innerHTML = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';
    const delay = 1000 / replayState.speed;
    replayState.timer = setInterval(() => {
        if (replayState.currentIndex >= replayState.tradeCandles.length - 1) {
            pauseReplay();
            return;
        }
        replayStepForward();
    }, delay);
}

function renderReplayTradeDetails(trade) {
    const container = document.getElementById('replayTradeDetails');
    if (!container) return;
    if (!trade) {
        container.innerHTML = '<p class="replay-empty">Select a trade to view details.</p>';
        return;
    }
    const net = getNetProfit(trade);
    const end = getTradeEndDateTime(trade);
    const entry = parseFloat(trade.ask) || 0;
    const exit = parseFloat(trade.closePremium);
    const ct = getTradeContractCount(trade);
    const rows = [
        ['Underlying', extractBaseTicker(trade.symbol)],
        ['Type', trade.type || '—'],
        ['Date', formatTradeDate(trade.date)],
        ['Option entry', `${formatTime12h(trade.time)} @ $${entry.toFixed(2)} premium`],
        ['Option exit', `${formatTime12h(`${end.getHours()}:${end.getMinutes()}`)} @ ${Number.isFinite(exit) ? '$' + exit.toFixed(2) + ' premium' : '—'}`],
        ['Contracts', String(ct)],
        ['Duration', trade.duration || '—'],
        ['Net P/L', formatProfit(net)],
        ['Fees', formatMoney(getTradeFees(trade))],
        ['Chart data', replayState.dataSource === 'yahoo'
            ? 'Yahoo Finance 1m (free; prior day + 1h post-exit). Paid alternatives: Polygon.io, Finnhub, Tiingo.'
            : 'Estimated (no market feed)'],
        ['Notes', (trade.notes || '—').slice(0, 200)]
    ];
    container.innerHTML = rows.map(([k, v]) =>
        `<div class="replay-detail-row"><span class="replay-detail-key">${k}</span><span class="replay-detail-val">${escapeHtml(String(v))}</span></div>`
    ).join('');
}

function renderReplayWatchlistPanel() {
    const list = document.getElementById('replayWatchlist');
    if (!list) return;
    const tickers = getWatchlist();
    if (!tickers.length) {
        list.innerHTML = '<li class="replay-empty">No tickers on watchlist.</li>';
        return;
    }
    list.innerHTML = tickers.map(t =>
        `<li class="replay-watchlist-item">${tickerLogoHtml(t, 'ticker-logo watchlist-logo')}<span>${t}</span></li>`
    ).join('');
}

function switchReplayPanel(panelId) {
    document.querySelectorAll('.replay-rail-btn[data-replay-panel]').forEach(btn => {
        btn.classList.toggle('replay-rail-btn--active', btn.dataset.replayPanel === panelId);
    });
    document.querySelectorAll('.replay-panel-pane').forEach(pane => {
        const active = pane.dataset.replayPane === panelId;
        pane.hidden = !active;
        pane.classList.toggle('replay-panel-pane--active', active);
    });
}

function updateReplaySideHeader(trade) {
    const ticker = document.getElementById('replaySideTicker');
    const type = document.getElementById('replaySideType');
    const pnl = document.getElementById('replaySidePnl');
    if (!trade) {
        if (ticker) ticker.textContent = '—';
        if (type) type.textContent = '—';
        if (pnl) { pnl.textContent = '—'; pnl.style.color = ''; }
        return;
    }
    const net = getNetProfit(trade);
    if (ticker) ticker.textContent = extractBaseTicker(trade.symbol);
    if (type) {
        type.textContent = (trade.type || 'TRADE').toUpperCase();
        type.className = 'replay-symbol-badge' + (trade.type === 'Put' ? ' replay-symbol-badge--put' : '');
    }
    if (pnl) {
        pnl.textContent = formatProfit(net);
        pnl.style.color = profitColor(net);
    }
}

function renderReplayExecutions(trade) {
    const container = document.getElementById('replayExecutions');
    const title = document.getElementById('replayExecutionsTitle');
    if (!container) return;
    if (!trade) {
        if (title) title.textContent = 'Executions';
        container.innerHTML = '<p class="replay-empty">Select a trade to see entries and exits.</p>';
        return;
    }
    const ct = getTradeContractCount(trade);
    const optEntry = parseFloat(trade.ask) || 0;
    const optExit = parseFloat(trade.closePremium);
    const end = getTradeEndDateTime(trade);
    const endTimeStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:00`;

    if (title) title.textContent = 'Executions';
    container.innerHTML = `
        <div class="replay-exec-row replay-exec-row--entry">
            <span class="replay-exec-time">${trade.time || '--'}:00</span>
            <span class="replay-exec-price">${optEntry.toFixed(2)}</span>
            <span class="replay-exec-qty">+${ct}</span>
        </div>
        <div class="replay-exec-row replay-exec-row--exit">
            <span class="replay-exec-time">${endTimeStr}</span>
            <span class="replay-exec-price">${Number.isFinite(optExit) ? optExit.toFixed(2) : '—'}</span>
            <span class="replay-exec-qty">-${ct}</span>
        </div>
        <p class="replay-exec-note">Option premium above · Chart markers use stock entry/exit price when saved, otherwise candle price at your time</p>
    `;
}

function loadReplayTrade(trade) {
    if (!trade) return;
    pauseReplay();
    const loadId = ++replayLoadId;
    const dayTrades = getTradesForReplayDate(replayState.selectedDate);
    const idx = dayTrades.indexOf(trade);
    replayState.selectedTradeId = trade.id || `replay-${idx}`;
    replayState.selectedTrade = trade;
    replayState.preCandles = [];
    replayState.tradeCandles = [];
    replayState.postCandles = [];
    replayState.priorDayCandles = [];
    replayState.markers = [];
    replayState.exec = null;
    replayState.levelPrices = null;
    clearReplayUserDrawings();
    replayState.loading = true;
    setReplayDataBadge('Loading market data…', 'load');
    renderReplayFrame();

    const net = getNetProfit(trade);
    const sym = extractBaseTicker(trade.symbol);
    const title = document.getElementById('replayChartTitle');
    const pnl = document.getElementById('replayChartPnl');
    if (title) title.textContent = `${sym} · ${formatTradeDate(trade.date)}`;
    if (pnl) {
        pnl.textContent = formatProfit(net);
        pnl.style.color = profitColor(net);
    }
    updateReplaySideHeader(trade);
    renderReplayExecutions(trade);
    renderReplayTradeDetails(trade);
    renderReplayTradeList();

    buildReplayCandles(trade, replayState.intervalMin).then(result => {
        if (loadId !== replayLoadId) return;
        replayState.loading = false;
        replayState.dataSource = result.source;
        replayState.preCandles = result.pre;
        replayState.tradeCandles = result.trade;
        replayState.postCandles = result.post || [];
        replayState.priorDayCandles = result.priorDay || [];
        replayState.allCandles = result.all;
        replayState.levels = result.levels;
        replayState.levelPrices = {
            pmHigh: result.levels.pmHigh,
            pmLow: result.levels.pmLow,
            priorHigh: result.levels.priorHigh,
            priorLow: result.levels.priorLow
        };
        replayState.levelsLocked = false;
        replayState.levelsHidden = false;
        document.getElementById('replayLockLevelsBtn')?.classList.remove('replay-draw-btn--active');
        document.getElementById('replayHideLevelsBtn')?.classList.remove('replay-draw-btn--active');
        replayState.needsFit = true;
        replayState.priceRangeLocked = false;
        setReplayChartStatus('');
        applyReplayPriceLines(result.levels);

        const all = [...result.pre, ...result.trade, ...(result.post || [])];
        replayState.exec = buildReplayExecMeta(trade, all);
        replayState.markers = [];

        const progress = document.getElementById('replayProgress');
        if (progress) {
            progress.min = '-1';
            progress.max = String(Math.max(0, replayState.tradeCandles.length - 1));
            progress.value = '-1';
        }
        replayState.currentIndex = -1;

        setReplayDataBadge(`Live · ${result.ticker} · ${replayState.intervalMin}m · Yahoo 1m (prior day + 1h post-exit)`);
        renderReplayTradeDetails(trade);
        renderReplayFrame();
    }).catch(err => {
        if (loadId !== replayLoadId) return;
        replayState.loading = false;
        replayState.dataSource = '';
        replayState.preCandles = [];
        replayState.tradeCandles = [];
        replayState.postCandles = [];
        replayState.priorDayCandles = [];
        replayState.markers = [];
        replayState.exec = null;
        replayState.allCandles = [];
        replayState.levels = null;
        clearReplayPriceLines();
        replayState.series?.setData([]);
        replayState.vwapSeries?.setData([]);
        replayState.emaSeries?.setData([]);
        updateSessionOverlays();
        setReplayDataBadge('Market data failed', 'warn');
        setReplayChartStatus(
            `Could not load real ${sym} stock candles for this date. ${err.message}. 1m data is only available for recent trading days.`,
            true
        );
        updateReplayOhlc(null);
    });
}

function renderReplayTradeList() {
    const list = document.getElementById('replayTradeList');
    if (!list) return;
    const dayTrades = getTradesForReplayDate(replayState.selectedDate);
    if (!dayTrades.length) {
        list.innerHTML = '<p class="replay-empty">No trades on this day.</p>';
        return;
    }
    list.innerHTML = dayTrades.map((t, i) => {
        const net = getNetProfit(t);
        const end = getTradeEndDateTime(t);
        const tradeKey = t.id || `replay-${i}`;
        const active = tradeKey === replayState.selectedTradeId ? ' replay-trade-item--active' : '';
        const checked = tradeKey === replayState.selectedTradeId ? 'checked' : '';
        return `
            <label class="replay-trade-item${active}">
                <input type="radio" name="replayTrade" value="${tradeKey}" ${checked}>
                <div class="replay-trade-item-body">
                    <div class="replay-trade-item-top">
                        <span class="replay-trade-symbol">${t.symbol}</span>
                        <span class="replay-trade-pnl" style="color:${profitColor(net)}">${formatProfit(net)}</span>
                    </div>
                    <div class="replay-trade-item-time">${formatTime12h(t.time)} – ${formatTime12h(`${end.getHours()}:${end.getMinutes()}`)}</div>
                </div>
            </label>
        `;
    }).join('');

    list.querySelectorAll('input[name="replayTrade"]').forEach(input => {
        input.addEventListener('change', () => {
            const trade = dayTrades.find((t, i) => (t.id || `replay-${i}`) === input.value);
            if (trade) loadReplayTrade(trade);
        });
    });
}

function initReplayChart() {
    const wrap = document.querySelector('.replay-chart-wrap');
    const el = document.getElementById('replayChart');
    if (!el || typeof LightweightCharts === 'undefined') return;

    replayState.chart = LightweightCharts.createChart(el, {
        layout: { background: { color: '#131722' }, textColor: '#787b86' },
        grid: {
            vertLines: { color: 'rgba(42, 46, 57, 0.8)' },
            horzLines: { color: 'rgba(42, 46, 57, 0.8)' }
        },
        rightPriceScale: {
            borderColor: '#2a2e39',
            autoScale: false,
            scaleMargins: { top: 0.06, bottom: 0.06 }
        },
        timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 12 },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: 'rgba(120, 123, 134, 0.5)', width: 1, style: 2 },
            horzLine: { color: 'rgba(120, 123, 134, 0.5)', width: 1, style: 2 }
        },
        ...getReplayPanOptions(true)
    });

    replayState.series = replayState.chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ffffff',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ffffff'
    });

    replayState.vwapSeries = replayState.chart.addLineSeries({
        color: '#ff9800',
        lineWidth: 2,
        title: 'VWAP',
        priceLineVisible: false,
        lastValueVisible: true
    });

    replayState.emaSeries = replayState.chart.addLineSeries({
        color: '#2962ff',
        lineWidth: 1,
        title: 'EMA 8',
        priceLineVisible: false,
        lastValueVisible: true
    });

    const resize = () => {
        if (!replayState.chart || !el) return;
        const w = el.clientWidth || wrap?.clientWidth || 600;
        const h = el.clientHeight || wrap?.clientHeight || 480;
        replayState.chart.applyOptions({ width: w, height: h });
        scheduleSessionOverlayUpdate();
    };

    if (wrap && typeof ResizeObserver !== 'undefined') {
        replayState.resizeObs = new ResizeObserver(resize);
        replayState.resizeObs.observe(wrap);
        replayState.resizeObs.observe(el);
    }
    resize();
    window.addEventListener('resize', resize);

    replayState.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        scheduleSessionOverlayUpdate();
    });

    if (typeof replayState.chart.subscribePaneResize === 'function') {
        replayState.chart.subscribePaneResize(() => {
            scheduleSessionOverlayUpdate();
        });
    }

    const priceScale = replayState.chart.priceScale('right');
    if (priceScale && typeof priceScale.subscribeVisibleLogicalRangeChange === 'function') {
        priceScale.subscribeVisibleLogicalRangeChange(() => {
            scheduleSessionOverlayUpdate();
        });
    }
}

function setReplayInterval(min) {
    replayState.intervalMin = min;
    document.querySelectorAll('.replay-pill[data-interval]').forEach(btn => {
        btn.classList.toggle('replay-pill--active', parseInt(btn.dataset.interval, 10) === min);
    });
    if (replayState.selectedTrade) loadReplayTrade(replayState.selectedTrade);
}

function initTradeReplay() {
    const chartEl = document.getElementById('replayChart');
    if (!chartEl) return;

    initReplayChart();
    initReplayDrawToolbar();
    setReplayDrawTool('crosshair');
    renderReplayWatchlistPanel();

    document.querySelectorAll('.replay-rail-btn[data-replay-panel]').forEach(btn => {
        btn.addEventListener('click', () => switchReplayPanel(btn.dataset.replayPanel));
    });

    const dates = getReplayDates();
    const datePicker = document.getElementById('replayDatePicker');
    if (datePicker) {
        if (dates.length) {
            datePicker.innerHTML = dates.map(d =>
                `<option value="${d}">${formatTradeDate(d)}</option>`
            ).join('');
            replayState.selectedDate = dates[dates.length - 1];
            datePicker.value = replayState.selectedDate;
        } else {
            const now = new Date().toISOString().slice(0, 10);
            replayState.selectedDate = now;
            datePicker.innerHTML = `<option value="${now}">${formatTradeDate(now)}</option>`;
            datePicker.value = now;
        }
        datePicker.addEventListener('change', () => {
            replayState.selectedDate = datePicker.value;
            replayState.selectedTradeId = null;
            replayState.selectedTrade = null;
            pauseReplay();
            renderReplayTradeList();
            renderReplayExecutions(null);
            renderReplayTradeDetails(null);
            updateReplaySideHeader(null);
            const dayTrades = getTradesForReplayDate(replayState.selectedDate);
            if (dayTrades.length) loadReplayTrade(dayTrades[0]);
            else {
                replayState.preCandles = [];
                replayState.tradeCandles = [];
                replayState.series?.setData([]);
                updateReplayOhlc(null);
                document.getElementById('replayChartTitle').textContent = 'No trades this day';
                document.getElementById('replayChartPnl').textContent = '—';
            }
        });
    }

    document.getElementById('replayPlayBtn')?.addEventListener('click', toggleReplayPlay);
    document.getElementById('replayForwardBtn')?.addEventListener('click', () => { pauseReplay(); replayStepForward(); });
    document.getElementById('replayBackBtn')?.addEventListener('click', () => { pauseReplay(); replayStepBack(); });
    document.getElementById('replayStartBtn')?.addEventListener('click', () => { pauseReplay(); setReplayIndex(-1); });
    document.getElementById('replayEndBtn')?.addEventListener('click', () => { pauseReplay(); setReplayIndex(replayState.tradeCandles.length - 1); });

    document.getElementById('replayProgress')?.addEventListener('input', (e) => {
        pauseReplay();
        setReplayIndex(parseInt(e.target.value, 10) || 0);
    });

    document.getElementById('replaySpeed')?.addEventListener('input', (e) => {
        replayState.speed = parseFloat(e.target.value) || 1;
        const label = document.getElementById('replaySpeedLabel');
        if (label) label.textContent = `${replayState.speed}x`;
        if (replayState.playing) {
            pauseReplay();
            toggleReplayPlay();
        }
    });

    document.querySelectorAll('.replay-pill[data-interval]').forEach(btn => {
        btn.addEventListener('click', () => setReplayInterval(parseInt(btn.dataset.interval, 10) || 1));
    });

    document.getElementById('replayOpenTvBtn')?.addEventListener('click', () => {
        const trade = replayState.selectedTrade || (trades || []).find(t => t.id === replayState.selectedTradeId);
        const sym = extractBaseTicker(trade?.symbol || 'TSLA');
        window.open(`https://www.tradingview.com/chart/?symbol=NASDAQ:${sym}&interval=1`, '_blank');
    });

    renderReplayTradeList();
    const dayTrades = getTradesForReplayDate(replayState.selectedDate);
    if (dayTrades.length) loadReplayTrade(dayTrades[0]);
    else {
        renderReplayExecutions(null);
        renderReplayTradeDetails(null);
        updateReplaySideHeader(null);
    }
}

function renderWatchlistPanel() {
    const container = document.getElementById('watchlistItems');
    if (!container) return;
    container.innerHTML = getWatchlist().map(ticker => `
        <li class="watchlist-item">
            <a class="watchlist-ticker" href="https://www.tradingview.com/chart/?symbol=NASDAQ:${ticker}" target="_blank" rel="noopener noreferrer" title="Open ${ticker} on TradingView">
                ${tickerLogoHtml(ticker, 'ticker-logo watchlist-logo')}
                <span>${ticker}</span>
            </a>
            <button type="button" class="watchlist-remove-btn" onclick="removeWatchlistTicker('${ticker}')" title="Remove ${ticker}">×</button>
        </li>
    `).join('');
}

window.addWatchlistTicker = function addWatchlistTicker() {
    const input = document.getElementById('watchlistAddInput');
    if (!input) return;
    const ticker = input.value.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!ticker) {
        showAlert('Enter a valid ticker symbol.', 'Invalid Ticker');
        return;
    }
    const list = getWatchlist();
    if (list.includes(ticker)) {
        showAlert(`${ticker} is already on your list.`, 'Already Added');
        return;
    }
    list.push(ticker);
    list.sort();
    saveWatchlist(list);
    input.value = '';
};

window.removeWatchlistTicker = function removeWatchlistTicker(ticker) {
    const list = getWatchlist().filter(s => s !== ticker);
    saveWatchlist(list);
};

// Initialization Logic
// Floating tooltip for any element with a data-tooltip attribute.
// Uses event delegation so it also covers elements added later.
function initInfoTooltips() {
    let tip = document.getElementById('appTooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'appTooltip';
        tip.className = 'app-tooltip';
        document.body.appendChild(tip);
    }

    const show = (target) => {
        const text = target.getAttribute('data-tooltip');
        if (!text) return;
        tip.textContent = text;
        tip.classList.add('visible');
        const rect = target.getBoundingClientRect();
        // Position above the icon, then clamp within the viewport
        const tipRect = tip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.top - tipRect.height - 8;
        if (top < 8) top = rect.bottom + 8; // flip below if no room above
        left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    };

    const hide = () => tip.classList.remove('visible');

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) show(target);
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-tooltip]')) hide();
    });
    document.addEventListener('scroll', hide, true);
}

document.addEventListener('DOMContentLoaded', async () => {
    renderSidebar();
    applySavedTheme();
    applyPageHeader();
    injectScreenshotButton();
    initTradeFilterUI();
    initTradeModalBackdropClose();

    await syncJournalFromRepo();

    initInfoTooltips();
    syncStocklistDatalists();
    renderWatchlistPanel();
    populateSymbolFilter();

    const watchlistInput = document.getElementById('watchlistAddInput');
    if (watchlistInput) {
        watchlistInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addWatchlistTicker();
            }
        });
    }

    initCharts();
    initPerformanceCharts();
    populateCalendar();
    populateTradeLog(document.getElementById('tradeLogTableBody') ? getFilteredTrades() : null);
    updateDashboardStats();
    populateDashboardRecentTrades();
    populateProgressTracker();

    if (window.location.hash === '#add-modal') {
        openModal();
    }

    // Auto-detect page type
    if (document.getElementById('dayTradeDetails')) initDayView();
    if (document.getElementById('reportsDashboard')) initReports();
    if (document.getElementById('notebookEntries')) populateNotebook();
    if (document.getElementById('replayChart')) initTradeReplay();
    if (document.getElementById('aiChatHero')) initAiChat();

    // Notification listeners are now attached dynamically in showNotification()

    const contractsInput = document.getElementById('contractsInput');
    const askInput = document.getElementById('askInput');
    const costDisplay = document.getElementById('costDisplay');

    const closePremiumInput = document.getElementById('closePremiumInput');
    const profitInput = document.getElementById('profitInput');

    function updateCalculations() {
        if (!contractsInput || !askInput) return;
        const contracts = parseFloat(contractsInput.value) || 0;
        const entryPremium = parseFloat(askInput.value) || 0;
        const totalCost = contracts * entryPremium * 100;
        if (costDisplay) costDisplay.textContent = `$${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

        // Only auto-calculate P/L from premiums when the user hasn't entered their own Net P/L
        if (formLoadingTrade || profitManuallyEdited) return;

        if (closePremiumInput && profitInput && closePremiumInput.value) {
            const exitPremium = parseFloat(closePremiumInput.value) || 0;
            const calculatedProfit = (exitPremium - entryPremium) * contracts * 100;

            profitInput.value = calculatedProfit.toFixed(2);
            const profitRangeEl = document.getElementById('profitRange');
            if (profitRangeEl) profitRangeEl.value = calculatedProfit.toFixed(2);
        }
    }

    function markProfitManual() {
        profitManuallyEdited = true;
    }

    if (contractsInput) contractsInput.addEventListener('input', updateCalculations);
    if (askInput) askInput.addEventListener('input', updateCalculations);
    if (closePremiumInput) closePremiumInput.addEventListener('input', updateCalculations);
    if (document.getElementById('actionSelect')) document.getElementById('actionSelect').addEventListener('change', updateCalculations);
    if (profitInput) {
        profitInput.addEventListener('input', markProfitManual);
        profitInput.addEventListener('change', markProfitManual);
    }
    const profitRange = document.getElementById('profitRange');
    if (profitRange) {
        profitRange.addEventListener('input', markProfitManual);
        profitRange.addEventListener('change', markProfitManual);
    }

    const tradeForm = document.getElementById('tradeForm');
    if (tradeForm && !tradeForm.dataset.listenerSet) {
        tradeForm.dataset.listenerSet = 'true';
        tradeForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const symbol = document.getElementById('symbolInput').value.toUpperCase();
            const profitVal = parseFloat(document.getElementById('profitInput').value);
            const startStr = document.getElementById('startTimeInput').value;
            const [logDate, logTime] = startStr.split('T');

            const endStr = document.getElementById('endTimeInput').value;

            let duration = '15m';
            if (startStr && endStr) {
                const start = new Date(startStr);
                const end = new Date(endStr);
                const diffMs = end - start;
                const diffMins = Math.floor(diffMs / 60000);
                if (diffMins >= 60) {
                    const hours = Math.floor(diffMins / 60);
                    const mins = diffMins % 60;
                    duration = `${hours}h ${mins}m`;
                } else {
                    duration = `${diffMins}m`;
                }
            }

            // Capture new strategy fields
            const typeValue = document.getElementById('actionSelect')?.value || (profitVal >= 0 ? 'Call' : 'Put');
            const contracts = document.getElementById('contractsInput')?.value || 1;
            const askPrice = document.getElementById('askInput')?.value || "";
            const closePremium = document.getElementById('closePremiumInput')?.value || "";
            const entryPrice = document.getElementById('entryPriceInput')?.value || "";
            const exitPrice = document.getElementById('exitPriceInput')?.value || "";
            const notes = document.getElementById('notesInput')?.value || "";

            // Capture image: use existing if editing and no new image selected
            const imageInput = document.getElementById('tradeImageInput');
            const previewImg = document.getElementById('imagePreviewImg');
            let imageDataUrl = (previewImg && previewImg.src && !previewImg.src.endsWith(window.location.href)) ? previewImg.src : '';
            // If no new upload but editing, preserve existing
            if (!imageDataUrl && editingIndex > -1 && trades[editingIndex].imageDataUrl) {
                imageDataUrl = trades[editingIndex].imageDataUrl;
            }

            const tradeObj = {
                id: editingIndex > -1 ? trades[editingIndex].id : Date.now() + Math.random().toString(36).substr(2, 9),
                date: logDate,
                symbol: symbol,
                profit: profitVal,
                profitIsManual: profitManuallyEdited,
                win: profitVal >= 0,
                time: logTime || '09:30',
                duration: duration,
                type: typeValue,
                contracts: contracts,
                ask: askPrice,
                closePremium: closePremium,
                entryPrice: entryPrice,
                exitPrice: exitPrice,
                endTime: endStr,
                notes: notes,
                imageDataUrl: imageDataUrl
            };

            if (editingIndex > -1) {
                trades[editingIndex] = tradeObj;
                editingIndex = -1;
            } else {
                trades.push(tradeObj);
            }

            saveTrades();
            refreshAllViews();
            showAlert('Your trade journal has been updated!', 'Success');
            closeModal();
            tradeForm.reset();
            resetImageUpload();
            profitManuallyEdited = false;

            // Reset modal title and button for next time
            if (document.getElementById('tradeModal')) {
                document.getElementById('tradeModal').querySelector('h2').textContent = 'Log New Trade';
                document.getElementById('tradeModal').querySelector('button[type="submit"]').textContent = 'Log Option Trade';
            }
        });
    }

    // Sync numeric inputs back to ranges
    const rangeSyncs = [
        { num: 'askInput', range: 'askRange' },
        { num: 'closePremiumInput', range: 'closePremiumRange' },
        { num: 'entryPriceInput', range: 'entryPriceRange' },
        { num: 'exitPriceInput', range: 'exitPriceRange' },
        { num: 'profitInput', range: 'profitRange' }
    ];

    rangeSyncs.forEach(pair => {
        const numElem = document.getElementById(pair.num);
        const rangeElem = document.getElementById(pair.range);
        if (numElem && rangeElem) {
            numElem.addEventListener('input', () => { rangeElem.value = numElem.value; });
            rangeElem.addEventListener('input', () => { numElem.value = rangeElem.value; });
        }
    });

    const calNavBtns = document.querySelectorAll('.cal-nav-btn');
    if (calNavBtns.length >= 2) {
        calNavBtns[0].onclick = prevMonth;
        calNavBtns[1].onclick = nextMonth;
    }
});

function getDailyProfitMap() {
    const map = {};
    (trades || []).forEach(t => {
        if (!t.date) return;
        map[t.date] = (map[t.date] || 0) + getNetProfit(t);
    });
    return map;
}

function renderDayViewMiniCalendar(viewDate) {
    const panel = document.getElementById('dayMiniCalendarPanel');
    if (!panel) return;

    const [vy, vm] = viewDate.split('-').map(Number);
    let calYear = vy;
    let calMonth = vm - 1;
    const dailyPL = getDailyProfitMap();

    const render = () => {
        const first = new Date(calYear, calMonth, 1);
        const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
        const mondayFirstDay = (first.getDay() + 6) % 7;
        const lastPos = (daysInMonth - 1) + mondayFirstDay;
        const totalWeeks = Math.floor(lastPos / 7) + 1;
        const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        let cells = '';
        for (let w = 0; w < totalWeeks; w++) {
            for (let col = 0; col < 5; col++) {
                const pos = w * 7 + col;
                const d = pos - mondayFirstDay + 1;

                if (d < 1 || d > daysInMonth) {
                    cells += '<span class="day-pick-cell day-pick-cell--empty"></span>';
                    continue;
                }

                const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

                if (isMarketHoliday(ds, calYear)) {
                    const holidayName = getHolidayName(ds, calYear);
                    cells += `<span class="day-pick-cell day-pick-cell--holiday" title="${holidayName} — Market Closed">${d}</span>`;
                    continue;
                }

                const pl = dailyPL[ds];
                const hasTrades = pl !== undefined;
                const isSelected = ds === viewDate;
                let tone = 'flat';
                if (hasTrades) tone = pl > 0 ? 'win' : pl < 0 ? 'loss' : 'flat';
                cells += `<button type="button" class="day-pick-cell day-pick-cell--${tone}${isSelected ? ' day-pick-cell--selected' : ''}" data-date="${ds}">${d}</button>`;
            }
        }

        panel.innerHTML = `
            <div class="day-pick-header">
                <button type="button" class="day-pick-nav" id="dayPickPrev" aria-label="Previous month">‹</button>
                <span class="day-pick-month">${monthLabel}</span>
                <button type="button" class="day-pick-nav" id="dayPickNext" aria-label="Next month">›</button>
            </div>
            <div class="day-pick-dow day-pick-dow--weekdays">
                <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span>
            </div>
            <div class="day-pick-grid day-pick-grid--weekdays">${cells}</div>
        `;

        panel.querySelector('#dayPickPrev')?.addEventListener('click', () => {
            calMonth--;
            if (calMonth < 0) { calMonth = 11; calYear--; }
            render();
        });
        panel.querySelector('#dayPickNext')?.addEventListener('click', () => {
            calMonth++;
            if (calMonth > 11) { calMonth = 0; calYear++; }
            render();
        });
        panel.querySelectorAll('.day-pick-cell[data-date]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.location.href = `day-view.html?date=${btn.dataset.date}`;
            });
        });
    };

    render();
}

function initDayView() {
    const urlParams = new URLSearchParams(window.location.search);
    let viewDate = urlParams.get('date');

    if (!viewDate) {
        const now = new Date();
        viewDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    const dayTrades = (trades || []).filter(t => t.date === viewDate);

    renderDayViewMiniCalendar(viewDate);

    // Header Date
    const dayDateElem = document.getElementById('dayDate');
    if (dayDateElem) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const [y, m, d] = viewDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        dayDateElem.textContent = dateObj.toLocaleDateString('en-US', options);
    }

    // --- Trade Analysis Section ---
    const detailsSection = document.getElementById('dayTradeDetails');
    if (detailsSection) {
        detailsSection.innerHTML = '';
        if (dayTrades.length > 0) {
            const heading = document.createElement('h3');
            heading.className = 'day-trade-details-heading';
            heading.textContent = 'Trade Analysis';
            detailsSection.appendChild(heading);

            dayTrades.forEach(t => {
                const netProfit = getNetProfit(t);
                const grossProfit = getGrossProfit(t);
                const tradeFees = getTradeFees(t);
                const cost = (parseFloat(t.ask) || 0) * getTradeContractCount(t) * 100;
                const roi = getNetROI(t);

                let endTimeDisplay = '';
                if (t.endTime && t.endTime.includes('T')) {
                    endTimeDisplay = t.endTime.split('T')[1].substring(0, 5);
                } else if (t.endTime) {
                    endTimeDisplay = t.endTime.substring(0, 5);
                }
                const timeFrame = endTimeDisplay ? `${t.time} – ${endTimeDisplay}` : t.time;
                const timeframeFull = t.duration ? `${timeFrame} (${t.duration})` : timeFrame;

                const card = document.createElement('div');
                card.className = 'chart-container chart-container--auto day-trade-card';

                const entryPremium = t.ask ? `$${parseFloat(t.ask).toFixed(2)}` : '—';
                const closePremium = t.closePremium ? `$${parseFloat(t.closePremium).toFixed(2)}` : '—';
                const premiumMove = (t.ask && t.closePremium)
                    ? (parseFloat(t.closePremium) - parseFloat(t.ask)).toFixed(2)
                    : null;
                const premiumMoveColor = premiumMove !== null
                    ? (parseFloat(premiumMove) >= 0 ? 'var(--profit-green)' : 'var(--loss-red)')
                    : 'var(--text-muted)';
                const winClass = netProfit >= 0 ? 'win' : 'loss';

                const cardHeader = `
                    <div class="trade-analysis-header">
                        <div class="ticker-badge" style="background:transparent; border:1px solid var(--border); color:white; box-shadow:none;">
                            <span style="font-weight:800;">${t.symbol}</span>
                        </div>
                        <span style="color:${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; font-weight:700; font-size:1.05rem;">${formatProfit(netProfit)}</span>
                        <span class="type-badge ${winClass}">${t.type || 'CALL'}</span>
                        <div class="trade-analysis-actions">
                            <span style="color:var(--text-muted); font-size:0.85rem; font-weight:500;">${timeframeFull}</span>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn-secondary edit-analysis-btn" style="padding: 4px 10px; font-size: 0.7rem;">Edit</button>
                                <button class="btn-secondary delete-analysis-btn" style="padding: 4px 10px; font-size: 0.7rem; color: var(--loss-red); border-color: rgba(255, 77, 109, 0.3);">Delete</button>
                            </div>
                        </div>
                    </div>
                    <div class="trade-metrics-row">
                        <div class="trade-metric-pill">
                            <span class="label">Entry Premium</span>
                            <span class="value">${entryPremium}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">Close Premium</span>
                            <span class="value">${closePremium}</span>
                        </div>
                        ${premiumMove !== null ? `
                        <div class="trade-metric-pill">
                            <span class="label">Premium Move</span>
                            <span class="value" style="color:${premiumMoveColor};">${parseFloat(premiumMove) >= 0 ? '+' : ''}$${premiumMove}</span>
                        </div>` : ''}
                        <div class="trade-metric-pill">
                            <span class="label">Gross P/L</span>
                            <span class="value" style="color:${profitColor(grossProfit)};">${formatProfit(grossProfit)}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">Net P/L</span>
                            <span class="value" style="color:${profitColor(netProfit)};">${formatProfit(netProfit)}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">Trade Cost</span>
                            <span class="value">$${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">Net ROI</span>
                            <span class="value" style="color:${profitColor(netProfit)};">${formatROI(roi)}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">TOS Fees</span>
                            <span class="value" style="color:var(--text-muted);">-${formatMoney(tradeFees)}</span>
                        </div>
                        ${t.contracts ? `
                        <div class="trade-metric-pill">
                            <span class="label">Contracts</span>
                            <span class="value">${t.contracts}</span>
                        </div>` : ''}
                    </div>
                `;

                // Image + Notes side-by-side (or just one if only one exists)
                const hasImage = !!t.imageDataUrl;
                const hasNotes = !!t.notes;

                let bodyContent = `<div style="display:grid; grid-template-columns:${hasImage && hasNotes ? '1.6fr 1fr' : '1fr'}; gap:1.5rem; align-items:flex-start;">`;

                if (hasImage) {
                    bodyContent += `
                        <div>
                            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Chart Screenshot</div>
                            <img src="${t.imageDataUrl}" alt="Trade chart"
                                style="width:100%; max-height:380px; border-radius:10px; object-fit:contain; border:1px solid var(--border); cursor:zoom-in; transition:opacity 0.2s;"
                                onclick="openImageLightbox('${t.id}')"
                                onmouseover="this.style.opacity='0.85'"
                                onmouseout="this.style.opacity='1'">
                        </div>
                    `;
                }

                if (hasNotes) {
                    bodyContent += `
                        <div>
                            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Strategy &amp; Notes</div>
                            <div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:1.4rem 1.6rem; border:1px solid var(--border); color:rgba(255,255,255,0.87); font-size:0.95rem; line-height:1.8; min-height:120px; white-space:pre-wrap;">${t.notes}</div>
                        </div>
                    `;
                }

                bodyContent += `</div>`;
                card.innerHTML = cardHeader + bodyContent;
                
                // Attach button listeners
                const editBtn = card.querySelector('.edit-analysis-btn');
                const deleteBtn = card.querySelector('.delete-analysis-btn');
                
                if (editBtn) {
                    editBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        openEditModal(t.id);
                    });
                }
                
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        deleteTrade(t.id);
                    });
                }

                detailsSection.appendChild(card);
            });
        } else {
            detailsSection.innerHTML = '<p class="day-empty-msg">No trades logged for this day. Pick a trading day on the calendar.</p>';
        }
    }

    // Setup Nav Buttons
    const prevBtn = document.getElementById('dayNavPrev');
    const nextBtn = document.getElementById('dayNavNext');
    if (prevBtn && nextBtn) {
        const [y, m, d] = viewDate.split('-').map(Number);
        prevBtn.onclick = () => {
            const prev = new Date(y, m - 1, d - 1);
            const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
            window.location.href = `day-view.html?date=${prevStr}`;
        };
        nextBtn.onclick = () => {
            const next = new Date(y, m - 1, d + 1);
            const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
            window.location.href = `day-view.html?date=${nextStr}`;
        };
    }
}

function populateNotebook() {
    const container = document.getElementById('notebookEntries');
    if (!container) return;

    container.innerHTML = '';
    if (trades.length === 0) {
        container.innerHTML = `<div class="stat-card" style="text-align:center; padding:3rem; color:var(--text-muted);">Your notebook is empty. Log a trade to start journaling!</div>`;
        return;
    }

    // Sort by date descending
    const sorted = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach((t) => {
        const netProfit = getNetProfit(t);
        // Find original index for editing
        const originalIdx = trades.findIndex(item => item === t);

        const entry = document.createElement('div');
        entry.className = 'notebook-entry stat-card';
        entry.style.marginBottom = '1.5rem';
        entry.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                <div>
                    <h4 style="margin-bottom: 4px;">${new Date(t.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h4>
                    <div class="ticker-badge">
                        <img src="${getTickerIcon(t.symbol)}" class="ticker-icon">
                        <span>${t.symbol}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; font-weight: 800; font-size: 1.2rem;">
                        ${formatProfit(netProfit)}
                    </div>
                    <div style="color: var(--text-muted); font-size: 0.75rem;">${getProfitFeeNote(t)}</div>
                    <div style="color: var(--text-muted); font-size: 0.8rem;">${t.time}</div>
                </div>
            </div>
            <p style="color: var(--text-muted); line-height: 1.6; font-size: 0.9rem;">
                Trade executed at ${t.time}. Total duration was ${t.duration}. ${netProfit >= 0 ? 'Excellent' : 'Risk managed'} execution on ${t.symbol} following the PBInesting strategy criteria.
            </p>
            <div style="margin-top: 1.5rem; display: flex; gap: 0.8rem;">
                <button class="btn-primary" style="padding: 6px 16px; font-size: 0.8rem;" onclick="openEditModal(${originalIdx})">Edit Entry</button>
                <button class="btn-secondary" style="padding: 6px 16px; font-size: 0.8rem; background: rgba(255, 77, 109, 0.1); color: var(--loss-red); border: 1px solid rgba(255, 77, 109, 0.2);" onclick="deleteTrade(${originalIdx})">Delete</button>
            </div>
        `;
        container.appendChild(entry);
    });
}

function initReports() {
    const equityCtx = document.getElementById('equityCurveChart');
    if (!equityCtx) return;

    // Calculate cumulative equity
    let cumulative = 0;
    const sortedByDate = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date));
    const equityData = sortedByDate.map(t => {
        cumulative += getNetProfit(t);
        return cumulative;
    });

    new Chart(equityCtx.getContext('2d'), {
        type: 'line',
        data: {
            labels: sortedByDate.map(t => t.date),
            datasets: [{
                label: 'Cumulative Equity',
                data: equityData.length > 0 ? equityData : [0],
                borderColor: '#7b61ff',
                backgroundColor: 'rgba(123, 97, 255, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: '#8e8e93' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8e8e93' } }
            },
            plugins: { legend: { display: false } }
        }
    });

    const performanceCtx = document.getElementById('performanceRadarChart');
    if (performanceCtx) {
        const wins = trades.filter(t => getNetProfit(t) >= 0).length;

        new Chart(performanceCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Wins', 'Losses'],
                datasets: [{
                    data: [wins, Math.max(0, trades.length - wins)],
                    backgroundColor: ['#00f0a8', '#ff4d6d'],
                    borderWidth: 0,
                    weight: 0.5
                }]
            },
            options: {
                cutout: '80%',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }
}