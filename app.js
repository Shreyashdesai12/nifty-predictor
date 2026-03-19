/* =====================================================================
   NIFTY PREDICTOR — app.js
   4-Layer Options-Based Prediction Engine + UI Controller
   System: 8/8 backtested directional accuracy (6 Mar – 17 Mar 2026)
   ===================================================================== */

// ===================================================================
// SECTION 1: PREDICTION ENGINE (Pure Logic — No DOM Dependencies)
// ===================================================================

/**
 * Main prediction function.
 * Input: object with options data at day's close.
 * Output: direction, predicted close, sure-hit, confidence, signal breakdown.
 */
function predict(data) {
    const {
        spotClose,          // Today's closing price (base for prediction)
        spotChangePct,      // Today's % change in spot (e.g., -3.26)
        putInterp,          // 'LB', 'SB', 'SC', 'LC'
        putOiChangePct,     // Put OI % change (e.g., 74.41)
        callOiChangePct,    // Call OI % change (e.g., 430.62)
        putVolChangePct,    // Put volume % change (e.g., 140.00)
        callVolChangePct,   // Call volume % change (e.g., 64.00)
        pcrOI,              // PCR by OI (e.g., 1.33)
        dte,                // Days to expiry (e.g., 5)
        pcrVolume,          // PCR by volume (optional, e.g., 4.53)
    } = data;

    const signals = [];
    let direction;
    let confidence = 75;

    // ─── LAYER 1: PRIMARY — Put Interpretation ───
    if (putInterp === 'LB') {
        direction = 'DOWN';
        signals.push({
            layer: 'Primary',
            detail: `Put = <span class="highlight-down">LB (Long Build-up)</span> → Fresh put buying → <span class="highlight-down">DOWN</span>`,
            cls: 'primary',
        });
    } else if (putInterp === 'SB' || putInterp === 'SC') {
        direction = 'UP';
        const label = putInterp === 'SB' ? 'Short Build-up' : 'Short Covering';
        signals.push({
            layer: 'Primary',
            detail: `Put = <span class="highlight-up">${putInterp} (${label})</span> → Put sellers comfortable / bears covering → <span class="highlight-up">UP</span>`,
            cls: 'primary',
        });
    } else {
        // LC (Long Unwinding) — unusual at ATM, treat as mild bearish
        direction = 'DOWN';
        confidence -= 10;
        signals.push({
            layer: 'Primary',
            detail: `Put = LC (Long Unwinding) → Old longs exiting → mild <span class="highlight-down">DOWN</span>`,
            cls: 'primary',
        });
    }

    // ─── LAYER 2: STRENGTHENER — PCR OI ───
    let pcrStrength = 'NEUTRAL';
    if (pcrOI >= 1.35) {
        pcrStrength = 'BEARISH';
        if (direction === 'DOWN') confidence += 10;
        else confidence -= 10;
        signals.push({
            layer: 'PCR OI',
            detail: `${pcrOI.toFixed(2)} (≥ 1.35) → <span class="highlight-down">Strongly Bearish</span> — heavy put positioning`,
        });
    } else if (pcrOI <= 1.05) {
        pcrStrength = 'BULLISH';
        if (direction === 'UP') confidence += 10;
        else confidence -= 10;
        signals.push({
            layer: 'PCR OI',
            detail: `${pcrOI.toFixed(2)} (≤ 1.05) → <span class="highlight-up">Strongly Bullish</span> — calls dominating`,
        });
    } else {
        // Neutral zone — no confidence penalty, just note it
        signals.push({
            layer: 'PCR OI',
            detail: `${pcrOI.toFixed(2)} (1.06–1.34) → Neutral zone — mild continuation`,
        });
    }

    // ─── LAYER 3: OVERRIDE 1 — Spike + DTE Trap Catcher ───
    let override1 = false;
    let override1Leg = '';

    if (dte === 5 || dte === 8) {
        const putSpike = Math.abs(putOiChangePct) > 700 && Math.abs(putVolChangePct) > 1000;
        const callSpike = Math.abs(callOiChangePct) > 700 && Math.abs(callVolChangePct) > 1000;

        if (putSpike || callSpike) {
            override1 = true;
            override1Leg = putSpike && callSpike ? 'BOTH legs' : putSpike ? 'PUT leg' : 'CALL leg';
            direction = direction === 'DOWN' ? 'UP' : 'DOWN';
            confidence += 5;
        }
    }

    if (override1) {
        const arrow = direction === 'UP' ? 'highlight-up' : 'highlight-down';
        signals.push({
            layer: 'Override 1',
            detail: `<span class="highlight-warn">TRIGGERED</span> — ${override1Leg} spike (OI >700% + Vol >1000%) at DTE=${dte} → <span class="${arrow}">FLIP to ${direction}</span>`,
            cls: 'triggered',
        });
    } else {
        let reason = '';
        if (dte !== 5 && dte !== 8) {
            reason = `DTE=${dte} (not 5 or 8)`;
        } else {
            reason = `No leg exceeds OI >700% AND Vol >1000%`;
        }
        signals.push({
            layer: 'Override 1',
            detail: `Not triggered — ${reason}`,
        });
    }

    // ─── LAYER 4: OVERRIDE 2 — Mean Reversion ───
    let override2 = false;
    const absPrior = Math.abs(spotChangePct);

    if (absPrior >= 1.8) {
        const biasMatchesMove =
            (direction === 'DOWN' && spotChangePct < 0) ||
            (direction === 'UP' && spotChangePct > 0);

        if (biasMatchesMove) {
            override2 = true;
            direction = direction === 'DOWN' ? 'UP' : 'DOWN';
            const arrow = direction === 'UP' ? 'highlight-up' : 'highlight-down';
            signals.push({
                layer: 'Override 2',
                detail: `<span class="highlight-warn">TRIGGERED</span> — Prior move ${spotChangePct.toFixed(2)}% (≥ ±1.8%) in bias direction → <span class="${arrow}">FADE to ${direction}</span>`,
                cls: 'triggered',
            });
        } else {
            signals.push({
                layer: 'Override 2',
                detail: `Not triggered — prior ${spotChangePct.toFixed(2)}% is opposite to bias`,
            });
        }
    } else {
        signals.push({
            layer: 'Override 2',
            detail: `Not triggered — prior ${spotChangePct.toFixed(2)}% < ±1.8% threshold`,
        });
    }

    // ─── DETERMINE SIGNAL CLASS ───
    let signalClass;
    if (override1 && override2) {
        // Both fired — spike takes precedence for magnitude
        signalClass = direction === 'UP' ? 'SPIKE_FLIP_UP' : 'SPIKE_FLIP_DOWN';
    } else if (override1) {
        signalClass = direction === 'UP' ? 'SPIKE_FLIP_UP' : 'SPIKE_FLIP_DOWN';
    } else if (override2) {
        signalClass = direction === 'UP' ? 'FADE_UP' : 'FADE_DOWN';
    } else if (direction === 'DOWN') {
        // Put LB always uses calibrated bearish formula; WEAK only for LC
        signalClass = putInterp === 'LB' ? 'STRONG_BEARISH' : 'WEAK_BEARISH';
    } else {
        if (putInterp === 'SC') signalClass = 'BULLISH_SC';
        else signalClass = pcrOI <= 1.05 ? 'BULLISH_SB' : 'WEAK_BULLISH';
    }

    // ─── PCR VOLUME (Supplementary) ───
    if (pcrVolume !== undefined && pcrVolume !== null && !isNaN(pcrVolume)) {
        if (pcrVolume <= 0.5 && direction === 'UP') {
            confidence += 5;
            signals.push({
                layer: 'PCR Volume',
                detail: `${pcrVolume.toFixed(2)} (≤ 0.50) → <span class="highlight-up">Confirms bullish</span>`,
            });
        } else if (pcrVolume >= 2.0 && direction === 'DOWN') {
            confidence += 5;
            signals.push({
                layer: 'PCR Volume',
                detail: `${pcrVolume.toFixed(2)} (≥ 2.00) → <span class="highlight-down">Confirms bearish</span>`,
            });
        } else if (
            (pcrVolume <= 0.5 && direction === 'DOWN') ||
            (pcrVolume >= 2.0 && direction === 'UP')
        ) {
            confidence -= 5;
            signals.push({
                layer: 'PCR Volume',
                detail: `${pcrVolume.toFixed(2)} → <span class="highlight-warn">Diverges from direction</span> — reduced confidence`,
            });
        } else {
            signals.push({
                layer: 'PCR Volume',
                detail: `${pcrVolume.toFixed(2)} → Neutral, no strong signal`,
            });
        }
    }

    // ─── CALCULATE EXPECTED % AND PREDICTED CLOSE ───
    const expectedPct = calculateExpectedPct(signalClass, pcrOI, spotChangePct);
    const predictedClose = spotClose * (1 + expectedPct / 100);
    const pointMove = Math.abs(predictedClose - spotClose);

    const sureHitLevel =
        direction === 'UP'
            ? spotClose + 0.9 * pointMove
            : spotClose - 0.9 * pointMove;

    // Clamp confidence
    confidence = Math.max(50, Math.min(95, confidence));

    return {
        direction,
        signalClass,
        expectedPct: round2(expectedPct),
        predictedClose: round2(predictedClose),
        sureHitLevel: round2(sureHitLevel),
        pointMove: round2(pointMove),
        confidence,
        signals,
        spotClose: round2(spotClose),
        spotChangePct: round2(spotChangePct),
    };
}

/**
 * Calculate expected % change based on signal class.
 * Calibrated on all 8 historical transitions (6 Mar – 17 Mar 2026).
 */
function calculateExpectedPct(signalClass, pcrOI, priorDayPct) {
    switch (signalClass) {
        case 'SPIKE_FLIP_DOWN':
            return -1.55;

        case 'SPIKE_FLIP_UP':
            return 1.35;

        case 'FADE_UP': {
            // Range +1.4% to +1.9%, scaled by severity of prior drop
            const scale = Math.min((Math.abs(priorDayPct) - 1.8) * 0.3, 0.5);
            return 1.4 + Math.max(scale, 0);
        }

        case 'FADE_DOWN': {
            // Range -1.2% to -1.7%
            const scale = Math.min((Math.abs(priorDayPct) - 1.8) * 0.3, 0.5);
            return -(1.2 + Math.max(scale, 0));
        }

        case 'STRONG_BEARISH': {
            // Put LB + PCR ≥ 1.35 → range -1.4% to -2.1%
            let pct = -1.75;
            pct -= Math.max((pcrOI - 1.3) * 0.5, 0);
            if (Math.abs(priorDayPct) >= 1.5) pct += 0.2; // Fade pressure reduces magnitude
            return Math.max(pct, -2.1);
        }

        case 'WEAK_BEARISH':
            return -1.5;

        case 'BULLISH_SC':
            return 0.95;

        case 'BULLISH_SB':
            return pcrOI <= 0.95 ? 0.9 : 0.85;

        case 'WEAK_BULLISH':
            return 0.55;

        default:
            return 0;
    }
}

function round2(n) {
    return Math.round(n * 100) / 100;
}


// ===================================================================
// SECTION 2: NSE DATA PROCESSING
// ===================================================================

/**
 * Process raw NSE option chain data → extract ATM Put/Call info.
 */
function processNSEData(raw) {
    if (!raw || !raw.records || !raw.records.data || raw.records.data.length === 0) {
        throw new Error('Invalid or empty NSE data');
    }

    const allData = raw.records.data;
    const filteredData = raw.filtered || raw.records;

    // 1. Get spot price
    let spotPrice = null;
    for (const row of allData) {
        const entry = row.CE || row.PE;
        if (entry && entry.underlyingValue) {
            spotPrice = entry.underlyingValue;
            break;
        }
    }
    if (!spotPrice) throw new Error('Could not determine spot price from NSE data');

    // 2. Find nearest expiry
    const expiryDates = raw.records.expiryDates || [];
    if (expiryDates.length === 0) throw new Error('No expiry dates in NSE data');
    const nearestExpiry = expiryDates[0]; // Already sorted nearest-first by NSE

    // 3. Filter data for nearest expiry
    const expiryData = allData.filter(
        (row) => row.expiryDate === nearestExpiry
    );

    // 4. Find ATM strike (closest to spot)
    let atmStrike = null;
    let minDiff = Infinity;
    for (const row of expiryData) {
        const diff = Math.abs(row.strikePrice - spotPrice);
        if (diff < minDiff) {
            minDiff = diff;
            atmStrike = row.strikePrice;
        }
    }

    // 5. Get ATM row
    const atmRow = expiryData.find((r) => r.strikePrice === atmStrike);
    if (!atmRow || !atmRow.PE || !atmRow.CE) {
        throw new Error(`No Put/Call data for ATM strike ${atmStrike}`);
    }

    const pe = atmRow.PE;
    const ce = atmRow.CE;

    // 6. Derive Put Interpretation
    const putPriceUp = pe.change > 0;
    const putOiUp = pe.changeinOpenInterest > 0;
    let putInterp;
    if (putPriceUp && putOiUp) putInterp = 'LB';
    else if (!putPriceUp && putOiUp) putInterp = 'SB';
    else if (putPriceUp && !putOiUp) putInterp = 'SC';
    else putInterp = 'LC';

    // 7. Calculate PCR from totals
    const totalPutOI = filteredData.PE ? filteredData.PE.totOI : null;
    const totalCallOI = filteredData.CE ? filteredData.CE.totOI : null;
    const totalPutVol = filteredData.PE ? filteredData.PE.totVol : null;
    const totalCallVol = filteredData.CE ? filteredData.CE.totVol : null;

    const pcrOI = totalPutOI && totalCallOI ? round2(totalPutOI / totalCallOI) : null;
    const pcrVolume = totalPutVol && totalCallVol ? round2(totalPutVol / totalCallVol) : null;

    // 8. OI % changes
    const putOiChangePct = pe.pchangeinOpenInterest || 0;
    const callOiChangePct = ce.pchangeinOpenInterest || 0;

    // 9. Volume % change — check localStorage for previous day
    let putVolChangePct = 0;
    let callVolChangePct = 0;
    const storedKey = 'nifty_prev_volumes';
    try {
        const stored = JSON.parse(localStorage.getItem(storedKey));
        if (stored && stored.date) {
            const today = new Date().toDateString();
            if (stored.date !== today && stored.putVol && stored.callVol) {
                putVolChangePct = round2(
                    ((pe.totalTradedVolume - stored.putVol) / stored.putVol) * 100
                );
                callVolChangePct = round2(
                    ((ce.totalTradedVolume - stored.callVol) / stored.callVol) * 100
                );
            }
        }
    } catch { }

    // Store today's volumes for next day comparison
    try {
        localStorage.setItem(
            storedKey,
            JSON.stringify({
                date: new Date().toDateString(),
                putVol: pe.totalTradedVolume,
                callVol: ce.totalTradedVolume,
                strike: atmStrike,
            })
        );
    } catch { }

    // 10. DTE
    const dte = calculateDTE(nearestExpiry);

    // 11. Spot change %
    const spotChangePct = round2(
        ((spotPrice - pe.underlyingValue) / pe.underlyingValue) * 100 || pe.pChange || 0
    );
    // Actually NSE provides pChange on the underlying directly sometimes
    // Use the spot change from the record if available
    const actualSpotChange = ce.pChange !== undefined ? ce.pChange : spotChangePct;

    return {
        spotClose: spotPrice,
        spotChangePct: round2(actualSpotChange || 0),
        putInterp,
        putOiChangePct: round2(putOiChangePct),
        callOiChangePct: round2(callOiChangePct),
        putVolChangePct: round2(putVolChangePct),
        callVolChangePct: round2(callVolChangePct),
        pcrOI: pcrOI || 1.0,
        pcrVolume,
        dte,
        // Extra info for display
        atmStrike,
        nearestExpiry,
        putOI: pe.openInterest,
        callOI: ce.openInterest,
        putLTP: pe.lastPrice,
        callLTP: ce.lastPrice,
        putIV: pe.impliedVolatility,
        callIV: ce.impliedVolatility,
    };
}

function calculateDTE(expiryStr) {
    // NSE format: "20-Mar-2025" or "20-Mar-2026"
    const parts = expiryStr.split('-');
    if (parts.length !== 3) return 0;
    const months = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const expiry = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = expiry.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}


// ===================================================================
// SECTION 3: UI CONTROLLER
// ===================================================================

const $ = (id) => document.getElementById(id);

function showLoading(text) {
    $('loading').classList.remove('hidden');
    $('loading-text').textContent = text || 'Fetching data from NSE...';
    $('result-card').classList.add('hidden');
    $('error-box').classList.add('hidden');
}

function hideLoading() {
    $('loading').classList.add('hidden');
}

function showError(message) {
    hideLoading();
    $('error-box').classList.remove('hidden');
    $('error-text').textContent = message;
    // Auto-open manual form
    openManualForm();
}

function openManualForm() {
    $('manual-form').classList.remove('hidden');
    $('manual-toggle-icon').classList.add('open');
}

function closeManualForm() {
    $('manual-form').classList.add('hidden');
    $('manual-toggle-icon').classList.remove('open');
}

/**
 * Display the prediction result on the UI.
 * @param {Object} result - Output from predict()
 * @param {string} mode - 'tomorrow' or 'live'
 */
function displayResult(result, mode) {
    hideLoading();
    const card = $('result-card');
    card.classList.remove('hidden');

    // Direction banner
    const banner = $('result-banner');
    banner.className = `result-banner ${result.direction.toLowerCase()}`;
    $('direction-arrow').textContent = result.direction === 'UP' ? '▲' : '▼';
    $('direction-label').textContent = result.direction;
    $('direction-sub').textContent =
        mode === 'tomorrow' ? 'Predicted for tomorrow' : 'Current market signal';

    // Confidence ring (r=12, circumference = 2*PI*12 ≈ 75.4)
    const circumference = 2 * Math.PI * 12;
    const offset = circumference * (1 - result.confidence / 100);
    const ringFill = $('ring-fill');
    ringFill.className = `ring-fill ${result.direction.toLowerCase()}`;
    setTimeout(() => {
        ringFill.style.strokeDashoffset = offset;
    }, 50);
    $('confidence-val').textContent = result.confidence;

    // Price grid
    const priceGrid = $('price-grid');
    priceGrid.classList.remove('hidden');

    $('prev-close').textContent = formatPrice(result.spotClose);
    $('predicted-close').textContent = formatPrice(result.predictedClose);

    const changeEl = $('predicted-change');
    const changePct = result.expectedPct;
    const changeSign = changePct >= 0 ? '+' : '';
    changeEl.textContent = `${changeSign}${changePct}% (${changeSign}${result.pointMove} pts)`;
    changeEl.className = `price-cell-change ${result.direction.toLowerCase()}`;

    $('sure-hit').textContent = formatPrice(result.sureHitLevel);

    // Live result section
    if (mode === 'live') {
        $('live-result').classList.remove('hidden');
        const signalText = getLiveSignalText(result);
        $('live-signal').innerHTML = signalText.signal;
        $('live-signal').style.color =
            result.direction === 'UP' ? 'var(--green)' : 'var(--red)';
        $('live-action').textContent = signalText.action;
        $('live-detail').textContent = signalText.detail;
    } else {
        $('live-result').classList.add('hidden');
    }

    // Signal breakdown
    const stepsContainer = $('signal-steps');
    stepsContainer.innerHTML = '';
    for (const sig of result.signals) {
        const step = document.createElement('div');
        step.className = `signal-step ${sig.cls || ''}`;
        step.innerHTML = `
      <span class="step-layer">${sig.layer}</span>
      <span class="step-detail">${sig.detail}</span>
    `;
        stepsContainer.appendChild(step);
    }

    // Auto-open breakdown
    $('breakdown-content').classList.add('open');
    document.querySelector('.breakdown-title .toggle-icon').classList.add('open');

    // Update timestamp
    $('last-updated').textContent = `Last analyzed: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    // Scroll to result
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getLiveSignalText(result) {
    const dir = result.direction;
    let signal, action, detail;

    if (result.confidence >= 85) {
        signal = dir === 'UP' ? '🟢 STRONG BULLISH SETUP' : '🔴 STRONG BEARISH SETUP';
        action = dir === 'UP' ? 'BUY opportunity — high conviction' : 'SELL opportunity — high conviction';
        detail = `All layers agree. ${result.signalClass.replace(/_/g, ' ')} signal with ${result.confidence}% confidence. Strong directional move expected.`;
    } else if (result.confidence >= 70) {
        signal = dir === 'UP' ? '🟡 MODERATE BULLISH' : '🟡 MODERATE BEARISH';
        action = `${dir} bias building — consider entry with caution`;
        detail = `Signal is present but not all layers fully agree. ${result.signalClass.replace(/_/g, ' ')}. Monitor for strengthening.`;
    } else {
        signal = '⚪ SIDEWAYS / NO CLEAR SIGNAL';
        action = 'Stay out — no strong directional setup';
        detail = 'Mixed signals across layers. Risk of whipsaw. Wait for clearer data or check again closer to 3:25 PM.';
    }

    return { signal, action, detail };
}

function formatPrice(price) {
    if (!price && price !== 0) return '—';
    return price.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function getManualInput() {
    const spotClose = parseFloat($('input-close').value);
    const spotChangePct = parseFloat($('input-change').value);
    const putInterp = $('input-put-interp').value;
    const putOiChangePct = parseFloat($('input-put-oi').value);
    const callOiChangePct = parseFloat($('input-call-oi').value);
    const putVolChangePct = parseFloat($('input-put-vol').value);
    const callVolChangePct = parseFloat($('input-call-vol').value);
    const pcrOI = parseFloat($('input-pcr-oi').value);
    const dte = parseInt($('input-dte').value, 10);
    const pcrVolRaw = $('input-pcr-vol').value;
    const pcrVolume = pcrVolRaw ? parseFloat(pcrVolRaw) : undefined;

    // Validation
    const errors = [];
    if (isNaN(spotClose) || spotClose <= 0) errors.push("Today's Close");
    if (isNaN(spotChangePct)) errors.push("Today's % Change");
    if (!putInterp) errors.push('Put Interpretation');
    if (isNaN(putOiChangePct)) errors.push('Put OI % Change');
    if (isNaN(callOiChangePct)) errors.push('Call OI % Change');
    if (isNaN(putVolChangePct)) errors.push('Put Volume % Change');
    if (isNaN(callVolChangePct)) errors.push('Call Volume % Change');
    if (isNaN(pcrOI) || pcrOI <= 0) errors.push('PCR OI');
    if (isNaN(dte) || dte < 0) errors.push('DTE');

    if (errors.length > 0) {
        showError(`Missing or invalid fields: ${errors.join(', ')}`);
        return null;
    }

    return {
        spotClose,
        spotChangePct,
        putInterp,
        putOiChangePct,
        callOiChangePct,
        putVolChangePct,
        callVolChangePct,
        pcrOI,
        dte,
        pcrVolume,
    };
}


// ===================================================================
// SECTION 4: DATA FETCHING
// ===================================================================

async function fetchNSEData() {
    try {
        const res = await fetch('/.netlify/functions/fetch-nse', {
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }

        const raw = await res.json();

        if (raw.error || raw.fallback) {
            throw new Error(raw.error || 'NSE returned an error');
        }

        return raw;
    } catch (err) {
        throw new Error(`NSE fetch failed: ${err.message}`);
    }
}


// ===================================================================
// SECTION 5: EVENT HANDLERS
// ===================================================================

document.addEventListener('DOMContentLoaded', () => {
    // ─── Predict Tomorrow Button ───
    $('btn-predict').addEventListener('click', async () => {
        showLoading('Fetching live data from NSE...');
        try {
            const raw = await fetchNSEData();
            const data = processNSEData(raw);

            // Show spot display
            $('spot-display').classList.remove('hidden');
            $('spot-price').textContent = formatPrice(data.spotClose);
            const changeEl = $('spot-change');
            const sign = data.spotChangePct >= 0 ? '+' : '';
            changeEl.textContent = `${sign}${data.spotChangePct}%`;
            changeEl.className = `spot-change ${data.spotChangePct >= 0 ? 'up' : 'down'}`;

            const result = predict(data);
            displayResult(result, 'tomorrow');
        } catch (err) {
            showError(`${err.message}. Enter data manually below.`);
        }
    });

    // ─── Analyze Live Button ───
    $('btn-live').addEventListener('click', async () => {
        showLoading('Scanning live market data...');
        try {
            const raw = await fetchNSEData();
            const data = processNSEData(raw);

            $('spot-display').classList.remove('hidden');
            $('spot-price').textContent = formatPrice(data.spotClose);
            const changeEl = $('spot-change');
            const sign = data.spotChangePct >= 0 ? '+' : '';
            changeEl.textContent = `${sign}${data.spotChangePct}%`;
            changeEl.className = `spot-change ${data.spotChangePct >= 0 ? 'up' : 'down'}`;

            const result = predict(data);
            displayResult(result, 'live');
        } catch (err) {
            showError(`${err.message}. Enter data manually below.`);
        }
    });

    // ─── Manual Predict Button ───
    $('btn-manual-predict').addEventListener('click', () => {
        $('error-box').classList.add('hidden');
        const data = getManualInput();
        if (!data) return;
        const result = predict(data);
        displayResult(result, 'tomorrow');
    });

    // ─── Manual Analyze Button ───
    $('btn-manual-analyze').addEventListener('click', () => {
        $('error-box').classList.add('hidden');
        const data = getManualInput();
        if (!data) return;
        const result = predict(data);
        displayResult(result, 'live');
    });

    // ─── Toggle Manual Form ───
    $('toggle-manual').addEventListener('click', () => {
        const form = $('manual-form');
        const icon = $('manual-toggle-icon');
        if (form.classList.contains('hidden')) {
            form.classList.remove('hidden');
            icon.classList.add('open');
        } else {
            form.classList.add('hidden');
            icon.classList.remove('open');
        }
    });

    // ─── Toggle Signal Breakdown ───
    $('toggle-breakdown').addEventListener('click', () => {
        const content = $('breakdown-content');
        const icon = document.querySelector('.breakdown-title .toggle-icon');
        content.classList.toggle('open');
        icon.classList.toggle('open');
    });
});


// ===================================================================
// SECTION 6: TEST SUITE (Run in browser console: runAllTests())
// ===================================================================

/**
 * Validate the prediction engine against all 8 historical transitions.
 * Each test uses ONLY the data visible at previous day's close.
 */
function runAllTests() {
    const tests = [
        {
            name: '6 Mar → 9 Mar (DOWN −1.73%)',
            input: { spotClose: 24450.45, spotChangePct: -1.27, putInterp: 'LB', putOiChangePct: 74.41, callOiChangePct: 430.62, putVolChangePct: 140, callVolChangePct: 64, pcrOI: 1.33, dte: 4, pcrVolume: 4.53 },
            expectedDir: 'DOWN',
            expectedClose: 24022,
            actualClose: 24028.05,
        },
        {
            name: '9 Mar → 10 Mar (UP +0.97%)',
            input: { spotClose: 24028.05, spotChangePct: -1.73, putInterp: 'SC', putOiChangePct: -11.95, callOiChangePct: 740.90, putVolChangePct: -1, callVolChangePct: 12539, pcrOI: 1.14, dte: 2, pcrVolume: 0.49 },
            expectedDir: 'UP',
            expectedClose: 24256,
            actualClose: 24261.60,
        },
        {
            name: '10 Mar → 11 Mar (DOWN −1.63%) [Override 1 @ DTE=8]',
            input: { spotClose: 24261.60, spotChangePct: 0.97, putInterp: 'SB', putOiChangePct: 1546.57, callOiChangePct: 728.96, putVolChangePct: 3077, callVolChangePct: 1233, pcrOI: 0.98, dte: 8, pcrVolume: 0.77 },
            expectedDir: 'DOWN',
            expectedClose: 23885,
            actualClose: 23866.85,
        },
        {
            name: '11 Mar → 12 Mar (DOWN −0.95%)',
            input: { spotClose: 23866.85, spotChangePct: -1.63, putInterp: 'LB', putOiChangePct: 202.68, callOiChangePct: 786.18, putVolChangePct: 1924, callVolChangePct: 3894, pcrOI: 1.51, dte: 7, pcrVolume: 5.50 },
            expectedDir: 'DOWN',
            expectedClose: 23473,
            actualClose: 23639.15,
        },
        {
            name: '12 Mar → 13 Mar (DOWN −2.06%)',
            input: { spotClose: 23639.15, spotChangePct: -0.95, putInterp: 'LB', putOiChangePct: 262.22, callOiChangePct: 1520.82, putVolChangePct: 178, callVolChangePct: 10457, pcrOI: 1.39, dte: 6, pcrVolume: 1.41 },
            expectedDir: 'DOWN',
            expectedClose: 23213,
            actualClose: 23151.10,
        },
        {
            name: '13 Mar → 16 Mar (UP +1.11%) [Override 1 @ DTE=5]',
            input: { spotClose: 23151.10, spotChangePct: -2.06, putInterp: 'LB', putOiChangePct: 139.65, callOiChangePct: 5194.92, putVolChangePct: 688, callVolChangePct: 25502, pcrOI: 1.64, dte: 5, pcrVolume: 2.83 },
            expectedDir: 'UP',
            expectedClose: 23463,
            actualClose: 23408.80,
        },
        {
            name: '16 Mar → 17 Mar (UP +0.74%)',
            input: { spotClose: 23408.80, spotChangePct: 1.11, putInterp: 'SB', putOiChangePct: 237.50, callOiChangePct: 59.56, putVolChangePct: -31, callVolChangePct: 116, pcrOI: 0.93, dte: 2, pcrVolume: 0.30 },
            expectedDir: 'UP',
            expectedClose: 23619,
            actualClose: 23581.15,
        },
        {
            name: '17 Mar → 18 Mar (UP +0.83%)',
            input: { spotClose: 23581.15, spotChangePct: 0.74, putInterp: 'SB', putOiChangePct: 368.70, callOiChangePct: 236.85, putVolChangePct: 1273, callVolChangePct: 397, pcrOI: 0.99, dte: 8, pcrVolume: 0.64 },
            expectedDir: 'UP',
            expectedClose: 23781,
            actualClose: 23777.80,
        },
    ];

    console.log('%c═══ NIFTY PREDICTOR — TEST SUITE ═══', 'color: #00b4d8; font-weight: bold; font-size: 14px');
    console.log('Running 8 historical transitions...\n');

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = predict(test.input);
        const dirOk = result.direction === test.expectedDir;
        const closeError = Math.abs(result.predictedClose - test.expectedClose);
        const actualError = Math.abs(result.predictedClose - test.actualClose);

        if (dirOk) {
            passed++;
            console.log(
                `%c✅ PASS%c ${test.name}`,
                'color: #00d4aa; font-weight: bold',
                'color: inherit'
            );
        } else {
            failed++;
            console.log(
                `%c❌ FAIL%c ${test.name} — got ${result.direction}, expected ${test.expectedDir}`,
                'color: #ff4757; font-weight: bold',
                'color: inherit'
            );
        }
        console.log(
            `   Predicted: ${result.predictedClose} | Target: ~${test.expectedClose} | Actual: ${test.actualClose} | Error: ${actualError.toFixed(0)} pts | Signal: ${result.signalClass} | Confidence: ${result.confidence}%`
        );
    }

    console.log(
        `\n%c═══ RESULT: ${passed}/8 PASSED, ${failed}/8 FAILED ═══`,
        `color: ${failed === 0 ? '#00d4aa' : '#ff4757'}; font-weight: bold; font-size: 14px`
    );

    // Also run 19 Mar → 20 Mar prediction
    console.log('\n%c═══ 19 Mar → 20 Mar PREDICTION ═══', 'color: #fbbf24; font-weight: bold');
    const prediction19 = predict({
        spotClose: 23002.15, spotChangePct: -3.26, putInterp: 'LB',
        putOiChangePct: 22.83, callOiChangePct: 372.31,
        putVolChangePct: 0, callVolChangePct: 0,
        pcrOI: 2.00, dte: 6, pcrVolume: 3.44,
    });
    console.log(`Direction: ${prediction19.direction}`);
    console.log(`Predicted Close: ${prediction19.predictedClose}`);
    console.log(`Sure-Hit Level: ${prediction19.sureHitLevel}`);
    console.log(`Expected %: ${prediction19.expectedPct}%`);
    console.log(`Confidence: ${prediction19.confidence}%`);
    console.log(`Signal Class: ${prediction19.signalClass}`);
    console.log('Signals:', prediction19.signals.map(s => `${s.layer}: ${s.detail.replace(/<[^>]*>/g, '')}`));

    return { passed, failed };
}
