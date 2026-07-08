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
// Updates localStorage + the in-memory `trades` array WITHOUT rendering, because
// the normal startup render runs right after this resolves.
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

        // Seed a fresh device (e.g. your phone) from the repo, and pull newer
        // pushes on devices that have already synced. Never clobber unsynced
        // local edits (e.g. your PC's working data).
        const shouldApply = !hasLocalTrades || (appliedStamp && remoteStamp > appliedStamp);
        if (!shouldApply) return;

        trades = payload.trades.map(t => {
            if (!t.id) t.id = Date.now() + Math.random().toString(36).substr(2, 9);
            return t;
        });
        localStorage.setItem('tradeJournalData', JSON.stringify(trades));

        if (payload.watchlist) {
            localStorage.setItem('tradeJournalWatchlist', JSON.stringify(payload.watchlist));
        }
        if (typeof payload.tradingNotes === 'string') {
            localStorage.setItem('tradingNotes', payload.tradingNotes);
        }

        localStorage.setItem(SYNC_MARKER_KEY, remoteStamp);
    } catch (err) {
        // Offline, running from file://, or no data file yet — just use local data.
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

function getTradeContractCount(trade) {
    return Math.max(1, parseInt(trade.contracts, 10) || 1);
}

function getTradeFeeSides(trade) {
    const close = trade.closePremium;
    return close !== undefined && close !== null && String(close).trim() !== '' ? 2 : 1;
}

function getTradeFees(trade) {
    return getTradeContractCount(trade) * getTradeFeeSides(trade) * TOS_FEE_PER_CONTRACT;
}

function getNetProfit(trade) {
    const profit = parseFloat(trade.profit) || 0;
    // User-entered P/L (e.g. from Thinkorswim) is the source of truth — don't recalc or subtract fees
    if (trade.profitIsManual) return profit;
    return profit - getTradeFees(trade);
}

function getProfitFeeNote(trade) {
    const fees = getTradeFees(trade);
    if (trade.profitIsManual) {
        return fees > 0 ? `${formatMoney(fees)} est. fees (not deducted)` : 'Manual P/L';
    }
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
    return `${formatMoney(total)} TOS fees (@ $0.65/contract)`;
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

// Biggest single-trade gain / loss across all history (used for scatter charts).
function getTradeProfitExtremes() {
    let maxGain = 0, maxLoss = 0;
    (trades || []).forEach(t => {
        const v = getNetProfit(t);
        if (v > maxGain) maxGain = v;
        if (v < 0 && Math.abs(v) > maxLoss) maxLoss = Math.abs(v);
    });
    return { maxGain, maxLoss };
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
    if (tradeModal) {
        tradeModal.querySelector('h2').textContent = 'Log New Trade';
        tradeModal.querySelector('button[type="submit"]').textContent = 'Log Option Trade';
        const tradeForm = document.getElementById('tradeForm');
        if (tradeForm) tradeForm.reset();

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
    const pfSub = document.getElementById('profitFactorSub');
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
            if (pfSub) pfSub.textContent = 'Excellent Efficiency';
        } else if (profitFactorNum >= 1) {
            pfElem.style.color = '#ffcc00';
            if (pfSub) pfSub.textContent = 'Decent Efficiency';
        } else {
            pfElem.style.color = 'var(--loss-red)';
            if (pfSub) pfSub.textContent = 'Needs Improvement';
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
function initCharts() {
    const tradeExtremes = getTradeProfitExtremes();
    const list = trades || [];

    // Auto-scale the profit (y) axis to the biggest win/loss you've had
    const maxProfitAbs = list.reduce((m, t) => Math.max(m, Math.abs(getNetProfit(t))), 0);
    const yBound = niceAxisBound(maxProfitAbs * 1.1) || 100;

    const timeCtx = document.getElementById('timePerformanceChart');
    if (timeCtx) {
        new Chart(timeCtx.getContext('2d'), {
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
        // Auto-scale the duration (x) axis to your longest trade
        const maxDur = list.reduce((m, t) => Math.max(m, parseDurationMins(t)), 0);
        const xBound = niceAxisBound(Math.max(maxDur, 5) * 1.1);

        new Chart(durationCtx.getContext('2d'), {
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
    calendarGrid.style.gridTemplateColumns = 'repeat(5, 1fr) 120px';

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
    const totalLabel = document.getElementById('totalTradesLabel');
    if (!tableBody) return;

    const dataToDisplay = filteredTrades || trades;
    tableBody.innerHTML = '';

    if (totalLabel) {
        totalLabel.textContent = `(${dataToDisplay.length} total)`;
    }

    if (dataToDisplay.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No trades found for the selected range.</td></tr>';
        return;
    }

    dataToDisplay.forEach((t) => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border)';
        row.style.cursor = 'pointer';
        row.className = 'trade-row-item';

        const netProfit = getNetProfit(t);
        const tradeType = t.type || (netProfit >= 0 ? 'Call' : 'Put');

        row.innerHTML = `
            <td style="padding: 1.2rem; color: var(--text-muted); font-size: 0.85rem;">
                <div style="color: white; font-weight: 500; margin-bottom: 2px;">${t.date}</div>
                <div style="font-size: 0.75rem;">${t.endTime ? `${t.time} - ${t.endTime.split('T')[1]}` : t.time}</div>
            </td>
            <td>
                <div class="ticker-badge" style="background: transparent; border: 1px solid var(--border); color: white; display: inline-flex;">
                    <span style="font-weight: 800;">${t.symbol}</span>
                    ${(t.strategy === 'Paper Trading' || t.isPaper) ? '<span style="margin-left: 8px; background: rgba(123, 97, 255, 0.1); color: #7b61ff; font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;">PAPER</span>' : ''}
                </div>
            </td>
            <td>
                <span style="background: ${netProfit >= 0 ? 'rgba(0, 240, 168, 0.1)' : 'rgba(255, 77, 109, 0.1)'}; color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; border: 1px solid ${netProfit >= 0 ? 'rgba(0, 240, 168, 0.2)' : 'rgba(255, 77, 109, 0.2)'};">
                    ${netProfit >= 0 ? 'WIN' : 'LOSS'}
                </span>
            </td>
            <td style="font-weight: 600; font-size: 0.9rem; color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; opacity: 0.8;">${tradeType}</td>
            <td style="color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; font-weight: 800; font-size: 1rem;">
                ${formatProfit(netProfit)}
                <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500; margin-top: 2px;">${getProfitFeeNote(t)}</div>
            </td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">${t.duration || '15m'}</td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="event.stopPropagation(); showDayDetail('${t.date}')">Analytics</button>
                    <button class="btn-secondary edit-btn-log" style="padding: 6px 12px; font-size: 0.75rem;" data-id="${t.id}">Edit</button>
                    <button class="btn-secondary delete-btn-log" style="padding: 6px 12px; font-size: 0.75rem; color: var(--loss-red); border-color: rgba(255, 77, 109, 0.3);" data-id="${t.id}">Delete</button>
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
    tradeViewSymbolFilter = '';
    tradeViewDateStart = '';
    tradeViewDateEnd = '';
    saveTrades();
    refreshAllViews();
    populateSymbolFilter();
    const select = document.getElementById('symbolFilterSelect');
    if (select) select.value = '';
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

function heatmapActivityColor(tradeCount) {
    if (tradeCount === 0) return 'rgba(255,255,255,0.05)';
    if (tradeCount === 1) return 'rgba(123, 97, 255, 0.25)';
    if (tradeCount === 2) return 'rgba(123, 97, 255, 0.45)';
    if (tradeCount <= 4) return 'rgba(123, 97, 255, 0.7)';
    return 'rgba(123, 97, 255, 1)';
}

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
    while (cursor.getDay() !== 0) cursor.setDate(cursor.getDate() - 1);

    const weeks = [];
    while (true) {
        const week = [];
        for (let i = 0; i < 7; i++) {
            week.push({
                date: fmtDate(cursor),
                isFuture: cursor > today
            });
            cursor.setDate(cursor.getDate() + 1);
        }
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
            cell.style.background = heatmapActivityColor(tradeCount);
            cell.title = tradeCount > 0
                ? `${day.date}: ${tradeCount} trade${tradeCount > 1 ? 's' : ''}, ${formatProfit(dayProfit)}`
                : `${day.date}: no trades`;
            weekCol.appendChild(cell);
        });
        grid.appendChild(weekCol);
    });
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
    populateProgressTracker();
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

let tradeViewSymbolFilter = '';
let tradeViewDateStart = '';
let tradeViewDateEnd = '';

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

function getFilterSymbolChoices() {
    const symbols = new Set(getWatchlist());
    trades.forEach(t => symbols.add(extractBaseTicker(t.symbol)));
    return [...symbols].filter(Boolean).sort();
}

function populateSymbolFilter() {
    const select = document.getElementById('symbolFilterSelect');
    if (!select) return;
    const current = select.value;
    const choices = getFilterSymbolChoices();
    select.innerHTML = '<option value="">All Symbols</option>' +
        choices.map(s => `<option value="${s}">${s}</option>`).join('');
    if (current && choices.includes(current)) select.value = current;
}

function getFilteredTrades() {
    let filtered = [...trades];
    if (tradeViewSymbolFilter) {
        filtered = filtered.filter(t =>
            extractBaseTicker(t.symbol) === tradeViewSymbolFilter ||
            t.symbol.toUpperCase().includes(tradeViewSymbolFilter)
        );
    }
    if (tradeViewDateStart && tradeViewDateEnd) {
        filtered = filtered.filter(t => t.date >= tradeViewDateStart && t.date <= tradeViewDateEnd);
    }
    return filtered;
}

window.applySymbolFilter = function applySymbolFilter() {
    const select = document.getElementById('symbolFilterSelect');
    tradeViewSymbolFilter = select ? select.value : '';
    populateTradeLog(getFilteredTrades());
};

function renderWatchlistPanel() {
    const container = document.getElementById('watchlistItems');
    if (!container) return;
    container.innerHTML = getWatchlist().map(ticker => `
        <li class="watchlist-item">
            <span>${ticker}</span>
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
    populateProgressTracker();

    if (window.location.hash === '#add-modal') {
        openModal();
    }

    // Auto-detect page type
    if (document.getElementById('dayTradeTableBody')) initDayView();
    if (document.getElementById('reportsDashboard')) initReports();
    if (document.getElementById('notebookEntries')) populateNotebook();

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

function initDayView() {
    const urlParams = new URLSearchParams(window.location.search);
    let viewDate = urlParams.get('date');

    if (!viewDate) {
        const now = new Date();
        viewDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    const dayTrades = (trades || []).filter(t => t.date === viewDate);

    // Header Date
    const dayDateElem = document.getElementById('dayDate');
    if (dayDateElem) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const [y, m, d] = viewDate.split('-').map(Number);
        const dateObj = new Date(y, m - 1, d);
        dayDateElem.textContent = dateObj.toLocaleDateString('en-US', options);
    }

    // Main Stats
    const netPL = sumNetProfit(dayTrades);
    const dayFees = sumFees(dayTrades);

    const netPLElem = document.getElementById('dayNetPL');
    if (netPLElem) {
        netPLElem.textContent = formatProfit(netPL);
        netPLElem.style.color = netPL >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
    }

    const dayFeesSub = document.getElementById('dayFeesSub');
    if (dayFeesSub) dayFeesSub.textContent = formatFeesLabel(dayTrades);

    const volElem = document.getElementById('dayVolume');
    const volLabel = document.getElementById('dayVolumeLabel');
    if (volElem) {
        if (dayTrades.length === 1) {
            if (volLabel) volLabel.textContent = 'Symbol';
            volElem.textContent = dayTrades[0].symbol;
        } else {
            if (volLabel) volLabel.textContent = 'Volume';
            volElem.textContent = dayTrades.length;
        }
    }

    const winsElem = document.getElementById('dayWins');
    const winsLabel = document.getElementById('dayWinsLabel');
    if (winsElem) {
        const wins = dayTrades.filter(t => getNetProfit(t) >= 0).length;
        if (dayTrades.length === 1) {
            if (winsLabel) winsLabel.textContent = 'Result';
            const singleNet = getNetProfit(dayTrades[0]);
            winsElem.textContent = singleNet >= 0 ? 'WIN' : 'LOSS';
            winsElem.style.color = singleNet >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
        } else {
            if (winsLabel) winsLabel.textContent = 'Wins / Losses';
            winsElem.textContent = `${wins} / ${dayTrades.length - wins}`;
            winsElem.style.color = 'inherit';
        }
    }

    // Update Trade Cost card
    const totalDayCost = dayTrades.reduce((sum, t) => sum + (parseFloat(t.ask) || 0) * (parseInt(t.contracts) || 1) * 100, 0);
    const dayTradeCostElem = document.getElementById('dayTradeCost');
    if (dayTradeCostElem) {
        dayTradeCostElem.textContent = `$${totalDayCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    }

    // --- Trade Analysis Section: Image + Notes below chart ---
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
                const tradeFees = getTradeFees(t);
                const cost = (parseFloat(t.ask) || 0) * (parseInt(t.contracts) || 1) * 100;
                const roi = cost > 0 ? ((netProfit / cost) * 100).toFixed(1) : '—';

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
                            <span class="label">Net ROI</span>
                            <span class="value" style="color:${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'};">${roi}${roi !== '—' ? '%' : ''}</span>
                        </div>
                        <div class="trade-metric-pill">
                            <span class="label">TOS Fees</span>
                            <span class="value" style="color:var(--text-muted);">${t.profitIsManual ? `${formatMoney(tradeFees)} est.` : `-${formatMoney(tradeFees)}`}</span>
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
        }
    }

    // --- Trade Table ---
    const tbody = document.getElementById('dayTradeTableBody');
    if (tbody) {
        tbody.innerHTML = '';
        if (dayTrades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding: 2rem; text-align: center; color: var(--text-muted);">No trades logged for today.</td></tr>';
        } else {
            dayTrades.forEach(t => {
                const netProfit = getNetProfit(t);
                // Build time frame string: "09:30 – 10:15"
                let endTimeDisplay = '';
                if (t.endTime && t.endTime.includes('T')) {
                    endTimeDisplay = t.endTime.split('T')[1].substring(0, 5);
                } else if (t.endTime) {
                    endTimeDisplay = t.endTime.substring(0, 5);
                }
                const timeFrame = endTimeDisplay ? `${t.time} – ${endTimeDisplay}` : t.time;

                // Calculate ROI
                const cost = (parseFloat(t.ask) || 0) * (parseInt(t.contracts) || 1) * 100;
                const roi = cost > 0 ? ((netProfit / cost) * 100).toFixed(1) : '—';

                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid var(--border)';
                row.innerHTML = `
                    <td style="padding: 1rem; font-size:0.85rem;">
                        <div style="color:white; font-weight:500;">${timeFrame}</div>
                        <div style="color:var(--text-muted); font-size:0.72rem; margin-top:2px;">${t.duration || ''}</div>
                    </td>
                    <td>
                        <div class="ticker-badge" style="background: transparent; color: white; border: 1px solid var(--border); box-shadow: none;">
                            <span style="font-weight:800;">${t.symbol}</span>
                        </div>
                    </td>
                    <td>
                        <span style="background:${netProfit >= 0 ? 'rgba(0,240,168,0.1)' : 'rgba(255,77,109,0.1)'}; color:${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; padding:3px 10px; border-radius:5px; font-size:0.75rem; font-weight:800;">${t.type || 'CALL'}</span>
                    </td>
                    <td style="color: var(--text-muted); font-size: 0.75rem;">WEEKLY</td>
                    <td style="color: ${netProfit >= 0 ? 'var(--profit-green)' : 'var(--loss-red)'}; font-weight: 700;">${formatProfit(netProfit)}</td>
                    <td style="color:var(--text-muted);">${roi}${roi !== '—' ? '%' : ''}</td>
                    <td>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-secondary edit-btn-init" style="padding: 4px 10px; font-size: 0.7rem;">Edit</button>
                            <button class="btn-secondary delete-btn-init" style="padding: 4px 10px; font-size: 0.7rem; color: var(--loss-red); border-color: rgba(255, 77, 109, 0.3);">Delete</button>
                        </div>
                    </td>
                `;

                const deleteBtn = row.querySelector('.delete-btn-init');
                const editBtn = row.querySelector('.edit-btn-init');

                if (editBtn) {
                    editBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openEditModal(t.id);
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteTrade(t.id);
                    });
                }

                row.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    window.location.href = `day-view.html?date=${t.date}`;
                });

                tbody.appendChild(row);
            });
        }
    }

    // Chart logic
    const ctx = document.getElementById('intraDayChart');
    if (ctx) {
        let labels = [];
        let dataPoints = [];

        if (dayTrades.length === 1) {
            const path = generatePricePath(dayTrades[0]);
            labels = path.labels;
            dataPoints = path.dataPoints;
        } else {
            labels = dayTrades.length > 0 ? dayTrades.map(t => t.time) : ['9:30', '16:00'];
            dataPoints = dayTrades.length > 0 ? dayTrades.map(t => getNetProfit(t)) : [0, 0];
        }

        const isWinner = netPL >= 0;

        new Chart(ctx.getContext('2d'), {
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
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                scales: {
                    x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } } },
                    y: {
                        position: 'right',
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a1a1a',
                        callbacks: { label: (c) => `Price: $${c.parsed.y.toFixed(2)}` }
                    }
                }
            }
        });
    }

    // Setup Nav Buttons
    const navBtns = document.querySelectorAll('.calendar-nav-btn');
    if (navBtns.length >= 2) {
        const [y, m, d] = viewDate.split('-').map(Number);

        navBtns[0].onclick = () => {
            const prev = new Date(y, m - 1, d - 1);
            const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
            window.location.href = `day-view.html?date=${prevStr}`;
        };

        navBtns[1].onclick = () => {
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