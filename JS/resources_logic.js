
document.addEventListener('DOMContentLoaded', () => {
    const notesArea = document.getElementById('tradingNotesArea');
    const saveBtn = document.getElementById('saveNotesBtn');

    // Default content from the user request
    const defaultNotes = `
<div class="notes-section">
    <h2>Trading Notes</h2>
    <div class="notes-grid">
        <div class="notes-card">
            <h3>Youtubers</h3>
            <p><strong>Investing Youtubers:</strong> PBInvesting</p>
        </div>
        <div class="notes-card">
            <h3>Hours</h3>
            <ul>
                <li><strong>Pre-Market:</strong> 4:00 AM - 9:30 AM</li>
                <li><strong>Market-Open:</strong> 9:30 AM - 4:00 PM</li>
                <li><strong>Post-Market:</strong> 4:00 PM - 8:00 PM</li>
            </ul>
        </div>
    </div>

    <h3>Vocab</h3>
    <div class="vocab-grid">
        <div class="vocab-item">
            <h4>Direction & Bias</h4>
            <p><strong>Bullish</strong> = Price likely going up → Look for Calls</p>
            <p><strong>Bearish</strong> = Price likely going down → Look for Puts</p>
        </div>
        <div class="vocab-item">
            <h4>Entries & Exits</h4>
            <p><strong>Enter (Entry)</strong> = When you open your trade</p>
            <p><strong>Exit</strong> = When you close your trade</p>
            <p><strong>Trimming</strong> = Sell some contracts early to lock profit / reduce risk</p>
            <p><strong>Runner</strong> = Last contract(s) you hold for a bigger move</p>
        </div>
        <div class="vocab-item">
            <h4>Candles</h4>
            <p><strong>Candle Body</strong> = Open → Close</p>
            <p><strong>Wick</strong> = Highest & lowest price reached</p>
            <p><strong>Close</strong> = Final price of the candle</p>
            <p><strong>Timeframes</strong> = 1m (fast), 3m (balanced), 5m (cleaner trends)</p>
        </div>
        <div class="vocab-item">
            <h4>Key Indicators</h4>
            <p><strong>9 EMA</strong> = short-term trend (very important for entries/exits). Price above = bullish, below = bearish.</p>
            <p><strong>VWAP</strong> = Volume Weighted Average Price. Acts like a magnet. Above = stronger, Below = weaker.</p>
        </div>
    </div>

    <h3>Simple Strategy Example</h3>
    <div class="strategy-card">
        <ul>
            <li>Above VWAP + holding 9 EMA → Calls</li>
            <li>Below VWAP + rejecting 9 EMA → Puts</li>
            <li>Break pre-market high → Strong bullish signal</li>
            <li>Trim profits on spikes, leave a runner</li>
        </ul>
    </div>

    <h2>Strategy Execution</h2>
    <div class="execution-steps">
        <div class="step">
            <h4>1. Mark Pre-Market Low & High</h4>
            <p>Watch the first 5 min (9:30–9:35):</p>
            <ul>
                <li>If price closes below pre-market low → look for puts.</li>
                <li>If price closes above pre-market high → look for calls.</li>
                <li>Never trade in chop (price stuck between pre-market low & high).</li>
                <li>If VWAP is under pre-market low, look for VWAP retest.</li>
            </ul>
        </div>
        <div class="step">
            <h4>2. Option Chain Choice</h4>
            <ul>
                <li>Pick nearest expiration (weeklies).</li>
                <li>Choose Strike Price near current stock price.</li>
                <li>Premium ≤ $0.90 ($90 budget).</li>
                <li>Volume (Vol) high (500+).</li>
                <li>Open Interest (OI) high.</li>
                <li>Tight Bid/Ask spread.</li>
            </ul>
        </div>
        <div class="step">
            <h4>3. Buying & Selling</h4>
            <p><strong>Buying:</strong> Click Ask → Buy order. Qty = 1. Order Type = Limit. Confirm price.</p>
            <p><strong>Selling:</strong> Watch premium. Right-Click → Create Closing Order → Sell. Set Limit price.</p>
        </div>
    </div>

    <div class="risk-reminder">
        <h3>Risk Reminder</h3>
        <p>Max loss = what you paid (premium). Don't hold too long — quick in/out. Small profits add up.</p>
    </div>
</div>
    `;

    // Load notes from localStorage
    const savedNotes = localStorage.getItem('tradingNotes');
    notesArea.innerHTML = savedNotes || defaultNotes;

    saveBtn.addEventListener('click', () => {
        localStorage.setItem('tradingNotes', notesArea.innerHTML);
        
        // Show success feedback
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Notes Saved!';
        saveBtn.style.background = 'var(--profit-green)';
        
        setTimeout(() => {
            saveBtn.textContent = originalText;
            saveBtn.style.background = '';
        }, 2000);
    });
});
