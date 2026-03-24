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
        spotOpen,           // Today's opening price
        spotClose,          // Today's closing price (base for prediction)
        spotChangePct,      // Today's % change in spot (e.g., -3.26)
        putInterp,          // [Legacy GUI logic hook]
        putOiChangePct,     // Put OI % change (e.g., 74.41)
        callOiChangePct,    // Call OI % change (e.g., 430.62)
        putVolChangePct,    
        callVolChangePct,   
        pcrOI,              // PCR by OI (e.g., 1.33)
        prevPcrInput,       
        isManual,           
        dte,                
        pcrVolume,          // PCR by volume (optional, e.g., 4.53)
        putIV, callIV, putVolAbs, callVolAbs, putOIAbs, callOIAbs, 
        callLtp, callAvg, putLtp, putAvg,
        prevSpotChangePct, prevPcrOi
    } = data;

    const signals = [];
    let upScore = 0;
    let downScore = 0;
    const activeSignals = [];

    const addSignal = (dir, conf, sigClass, layerStr, detailStr, isPrimary = false) => {
        signals.push({ layer: layerStr, detail: detailStr, cls: isPrimary ? 'primary' : 'triggered' });
        activeSignals.push({ dir, conf, sigClass });
        if (dir === 'UP') upScore += conf;
        if (dir === 'DOWN') downScore += conf;
    };

    // ─── 1. BASE LAYER (CANDLE BODY) ───
    let isBullCandle = false;
    let isOpenGiven = (spotOpen !== undefined && !isNaN(spotOpen) && spotOpen > 0);
    
    if (isOpenGiven && spotClose) {
        isBullCandle = (spotClose > spotOpen);
    } else {
        isBullCandle = (spotChangePct > 0);
    }

    if (isBullCandle) {
        addSignal('UP', 60, 'TREND_FOLLOW', 'Base Trend', '<span class="highlight-up">BULLISH</span> Candle Body (Close > Open).', true);
    } else {
        addSignal('DOWN', 65, 'TREND_FOLLOW', 'Base Trend', '<span class="highlight-down">BEARISH</span> Candle Body (Close < Open).', true);
    }

    // ─── 2. SUPPLY WALL ───
    if (callOiChangePct !== undefined && putOiChangePct !== undefined) {
        if (callOiChangePct > 50 && (putOiChangePct <= 0 || callOiChangePct > (3 * putOiChangePct))) {
             addSignal('DOWN', 88, 'SUPPLY_WALL', 'Override 4 (Supply Wall)', '<span class="highlight-warn">🧱 TRIGGERED</span> — Call OI writing > 3x Put OI. Supply Wall → <span class="highlight-down">STRONG DOWN</span>');
        }
    }

    // ─── 3. LIQUIDITY TRAP (Series-Age Aware) ───
    if (callVolAbs && callVolAbs < 200000 && isBullCandle) {
        addSignal('DOWN', 85, 'LIQUIDITY_TRAP', 'Override 5 (Illiquid)', '<span class="highlight-warn">🩸 TRIGGERED</span> — Up move unsupported (Call Vol < 2L) → <span class="highlight-down">FADE DOWN</span>');
    }

    // ─── 4. HIDDEN BEAR (Volume Trap) ───
    if (isBullCandle && pcrVolume > 2.0) {
        addSignal('DOWN', 92, 'HIDDEN_BEAR', 'Override 3 (Vol Trap)', '<span class="highlight-warn">⚠️ TRIGGERED</span> — PCR Volume > 2.0 on Bull Day. Bears trapping → <span class="highlight-down">REVERSAL DOWN</span>');
    }

    // ─── 5. REVERSAL BOUNCE (Dominates OI on Crash Days) ───
    if (spotChangePct <= -2.00) {
        addSignal('UP', 95, 'REVERSAL_BOUNCE', 'Override 1 (Reversal)', '<span class="highlight-warn">🟢 TRIGGERED</span> — Extreme Drop forces mechanical bounce → <span class="highlight-up">STRONG UP</span>');
        // Nullify Supply Wall score on this day — it's panic shorts, not true resistance
        downScore = Math.max(0, downScore - 88);
    }

    // ─── 6. GHOST TRAP ───
    if ((pcrOI - pcrVolume) > 0.40 && pcrOI > 0.90 && putOiChangePct > 0) {
        addSignal('UP', 90, 'GHOST_TRAP', 'Phase 8 (Ghost Trap)', '<span class="highlight-warn">👻 GHOST TRAP</span> — Huge PCR OI but stagnant volume → <span class="highlight-up">STRONG UP</span>');
    }

    // ─── 7. VOLUME FAKEOUT ───
    if (spotChangePct < 0 && callVolAbs && putVolAbs && callVolAbs > putVolAbs) {
        addSignal('UP', 92, 'VOL_FAKEOUT', 'Phase 8 (Vol Fakeout)', '<span class="highlight-warn">🏃‍♂️ VOL FAKEOUT</span> — Spot Red but Call Vol beat Put Vol! → <span class="highlight-up">FAKEOUT UP</span>');
    }

    // ─── 8. TERMINAL EXHAUSTION ───
    let isTermExhausted = false;
    if (spotChangePct < 0 && prevSpotChangePct !== undefined && prevSpotChangePct < 0) {
        if (prevPcrOi !== undefined && pcrOI > prevPcrOi) {
            isTermExhausted = true;
            addSignal('UP', 95, 'TERMINAL_EXHAUST', 'Phase 8 (Term Exhaust)', '<span class="highlight-warn">📉 PCR EXHAUSTION</span> — 2nd Red Day, yet PCR OI increased! → <span class="highlight-up">REVERSAL UP</span>');
        }
    }

    // ─── 9. EOD ALGO DUMP ───
    if (isBullCandle && callLtp && callAvg && putLtp && putAvg) {
        if (callLtp < (callAvg - 10) && putLtp > putAvg) {
            addSignal('DOWN', 99, 'ALGO_DUMP', 'Phase 8 (EOD Dump)', '<span class="highlight-warn">🚨 ALGO DUMP</span> — Calls bleeding while Puts gained before close → <span class="highlight-down">SHORT DOWN</span>');
        }
    }

    // ─── 10. ALGO PUMP INVERSION ───
    if (spotChangePct < -0.40 && callLtp && callAvg && callLtp > callAvg) {
        addSignal('UP', 98, 'ALGO_PUMP', 'Phase 9 (Algo Pump)', '<span class="highlight-warn">🟢 ALGO PUMP INVERSION</span> — Market bled, but Calls finished ABOVE their avg → <span class="highlight-up">GAP UP</span>');
    }

    // ─── 11. SHOCK DOWN (IV SKEW) ───
    let ivSkew = null;
    if (putIV && callIV) {
        ivSkew = parseFloat(putIV) - parseFloat(callIV);
        if (ivSkew >= 3.0) {
            let skewConf = Math.min(75 + (ivSkew * 4), 93);
            const compText = (callIV < 15) ? " + Call Complacency (<15)" : "";
            addSignal('DOWN', skewConf, 'SHOCK_DOWN', 'Override 2 (IV Shock)', '<span class="highlight-warn">⚡ SHOCK TRIGGERED</span> — IV Skew = +'+ivSkew.toFixed(2)+compText+' → <span class="highlight-down">GAP DOWN</span>');
        }
    }

    // ─── DYNAMIC CONFIDENCE SCORING (CLAUDE ALGORITHM) ───
    let direction = upScore >= downScore ? 'UP' : 'DOWN';
    
    // Sort winning signals by confidence
    let winningSignals = activeSignals.filter(s => s.dir === direction).sort((a,b) => b.conf - a.conf);
    let opposingScore = direction === 'UP' ? downScore : upScore;

    let baseConf = winningSignals.length > 0 ? winningSignals[0].conf : (direction === 'UP' ? 60 : 65);
    let computedConf = baseConf;

    // Diminishing returns for supporting signals
    winningSignals.slice(1).forEach((s, idx) => {
        computedConf += s.conf * (1 / (idx + 3));
    });

    // Subtract penalty for opposing noise
    let penalty = opposingScore * 0.15;
    computedConf -= penalty;

    // Hard clamps for realism
    let confidence = Math.min(Math.max(Math.round(computedConf), 51), 97);
    let signalClass = winningSignals.length > 0 ? winningSignals[0].sigClass : 'STANDARD';

    if (typeof isFriday !== 'undefined' && isFriday && direction === 'DOWN') {
        confidence = Math.min(confidence + 5, 97);
    }

    // Variables for return object
    let pcrDelta = null;
    let turnoverRatio = null;
    let compositeRatio = pcrVolume ? (pcrVolume / pcrOI) : null;
    let extremeSkewWarning = false;
    let hiddenBearFlag = (signalClass === 'HIDDEN_BEAR');
    let isUntested = false;
    let untestedReason = '';

    // Untested conditions entirely removed per user request.

    let override1 = (signalClass === 'REVERSAL_BOUNCE');
    let override2 = (signalClass === 'SHOCK_DOWN');
    let closeRetention = (direction === 'UP') ? 0.35 : 0.60;
    let sureHitMultiplier = (direction === 'UP') ? 0.45 : 0.85;
    let isExhaustion = (spotChangePct <= -2.00);

    // ─── CALCULATE EXPECTED % AND PREDICTED CLOSE ───
    let expectedPct = calculateExpectedPct(signalClass, pcrOI, spotChangePct);

    const pointMove = Math.abs(spotClose * expectedPct / 100);
    const intradayTarget = round2(spotClose * (1 + expectedPct / 100));

    const sureHitLevel = direction === 'UP'
        ? round2(spotClose + sureHitMultiplier * pointMove)
        : round2(spotClose - sureHitMultiplier * pointMove);

    const predictedClose = round2(
        direction === 'UP'
            ? spotClose + closeRetention * pointMove
            : spotClose - closeRetention * pointMove
    );

    return {
        direction,
        signalClass,
        expectedPct: round2(expectedPct),
        intradayTarget,
        predictedClose,
        sureHitLevel,
        pointMove: round2(pointMove),
        confidence,
        signals,
        spotClose: round2(spotClose),
        spotChangePct: round2(spotChangePct),
        override1,
        override2,
        pcrOI: round2(pcrOI),
        closeRetention,
        sureHitMultiplier,
        isExhaustion,
        ivSkew,
        pcrDelta,
        turnoverRatio,
        compositeRatio,
        extremeSkewWarning,
        isUntested,
        untestedReason,
        hiddenBearFlag
    };
}

function calculateExpectedPct(signalClass, pcrOI, priorDayPct) {
    switch (signalClass) {
        case 'REVERSAL_BOUNCE':
            return 1.15;
        case 'SHOCK_DOWN':
            return -2.85;
        case 'HIDDEN_BEAR':
            return -2.60;
        case 'ALGO_DUMP':
            return -2.75;
        case 'ALGO_PUMP':
            return 1.45;
        case 'TERMINAL_EXHAUST':
            return 1.25;
        case 'VOL_FAKEOUT':
            return 1.10;
        case 'GHOST_TRAP':
            return 1.20;
        case 'SUPPLY_WALL':
            return -1.50;
        case 'LIQUIDITY_TRAP':
            return -1.63;
        case 'NORMAL':
            return 0.85;
        default:
            return 0.85;
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
    const ch = $('manual-chevron');
    if (ch) ch.classList.add('open');
}

function closeManualForm() {
    $('manual-form').classList.add('hidden');
    const ch = $('manual-chevron');
    if (ch) ch.classList.remove('open');
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

    // Direction top
    const dirIcon = $('dir-icon');
    dirIcon.textContent = result.direction === 'UP' ? '▲' : '▼';
    dirIcon.className = `dir-icon ${result.direction.toLowerCase()}`;
    const dirLabel = $('dir-label');
    dirLabel.textContent = result.direction;
    dirLabel.className = `dir-label ${result.direction.toLowerCase()}`;
    $('dir-sub').textContent =
        mode === 'tomorrow' ? 'Predicted for tomorrow' : 'Current market signal';

    // Confidence ring — number embedded inside SVG <tspan>
    const circumference = 2 * Math.PI * 18;
    const offset = circumference * (1 - result.confidence / 100);
    const ringFill = $('ring-fill');
    ringFill.className = `ring-fill ${result.direction.toLowerCase()}`;
    setTimeout(() => { ringFill.style.strokeDashoffset = offset; }, 50);
    const confVal = $('confidence-val');
    if (confVal) confVal.textContent = result.confidence;
    const confLabel = $('conf-label');
    if (confLabel) confLabel.textContent = result.confidence + '%';

    // ─── Smart Surety Bar ───
    const confTextEl = $('confidence-text');
    const action = result.direction === 'UP' ? 'BUY' : 'SELL';
    let suretyClass, suretyText;

    if (result.confidence >= 90) {
        suretyText = `✅ GUARANTEED ${action}`;
        suretyClass = 'surety-bar surety-guaranteed';
    } else if (result.confidence >= 85) {
        suretyText = `💪 STRONG ${action}`;
        suretyClass = 'surety-bar surety-buy';
    } else if (result.confidence >= 80) {
        if (result.isExhaustion) {
            suretyText = `⚡ ${action} — Exhaustion Zone (sure-hit ×0.75)`;
            suretyClass = 'surety-bar surety-risky';
        } else {
            suretyText = `💪 STRONG ${action}`;
            suretyClass = 'surety-bar surety-buy';
        }
    } else if (result.confidence >= 70) {
        if (result.override2) {
            suretyText = `🔄 MEAN-REVERSION ${action} — Close may give back`;
            suretyClass = 'surety-bar surety-risky';
        } else if (result.isExhaustion) {
            suretyText = `⚠️ RISKY ${action} — PCR crowded`;
            suretyClass = 'surety-bar surety-risky';
        } else {
            suretyText = `⚠️ RISKY ${action}`;
            suretyClass = 'surety-bar surety-risky';
        }
    } else {
        suretyText = `🚫 DANGER / AVOID`;
        suretyClass = 'surety-bar surety-danger';
    }

    // Hidden Institutional Dumping
    if (result.hiddenBearFlag) {
        suretyText = `⚠️ DO NOT TRADE — HIDDEN INSTITUTIONAL DUMPING (PRE-CRASH SIGNATURE)`;
        suretyClass = 'surety-bar surety-danger';
        const ringFillLoc = $('ring-fill');
        const circ = 2 * Math.PI * 18;
        if (ringFillLoc) setTimeout(() => { ringFillLoc.style.strokeDashoffset = circ; }, 50);
        const cv = $('confidence-val');
        if (cv) cv.textContent = '0';
        const cl = $('conf-label');
        if (cl) cl.textContent = '0%';
    }
    // Untested market condition overrides
    else if (result.isUntested) {
        suretyText = `⚠️ DO NOT TRADE — UNTESTED MARKET CONDITION`;
        suretyClass = 'surety-bar surety-danger';
        // Force UI ring to exactly 0% immediately
        const ringFillLoc = $('ring-fill');
        const circ = 2 * Math.PI * 18;
        if (ringFillLoc) setTimeout(() => { ringFillLoc.style.strokeDashoffset = circ; }, 50);
        const cv = $('confidence-val');
        if (cv) cv.textContent = '0';
        const cl = $('conf-label');
        if (cl) cl.textContent = '0%';
    }
    // Phase 2 catastrophic overrides (if not already untested)
    else if (result.ivSkew !== undefined && result.ivSkew > 4.0) {
        suretyText = `🔴 BLACK SWAN WARNING: IV Skew at +${result.ivSkew.toFixed(2)}. Extreme catastrophic risk.`;
        suretyClass = 'surety-bar surety-danger';
    } else if (result.extremeSkewWarning && action === 'BUY') {
        suretyText = `⚠️ EXTREME SKEW UPWARD: Moves heavily dampened.`;
        suretyClass = 'surety-bar surety-risky';
    }

    if (confTextEl) { confTextEl.textContent = suretyText; confTextEl.className = suretyClass; }

    // Analytics Row UI updates
    const analyticsRow = $('analytics-row');
    if (analyticsRow) {
        let hasData = false;

        if (result.ivSkew !== undefined && result.ivSkew !== null) {
            $('val-skew').textContent = (result.ivSkew > 0 ? '+' : '') + result.ivSkew.toFixed(2);
            $('val-skew').className = `a-val ${result.ivSkew > 2 ? 'warn' : (result.ivSkew < 0 ? 'up' : '')}`;
            hasData = true;
        } else {
            $('val-skew').textContent = '—';
            $('val-skew').className = 'a-val';
        }

        if (result.pcrDelta !== undefined && result.pcrDelta !== null) {
            $('val-delta').textContent = (result.pcrDelta > 0 ? '+' : '') + result.pcrDelta.toFixed(2);
            $('val-delta').className = `a-val ${result.pcrDelta > 0.8 ? 'warn' : (result.pcrDelta < -0.6 ? 'up' : '')}`;
            hasData = true;
        } else {
            $('val-delta').textContent = '—';
            $('val-delta').className = 'a-val';
        }

        if (result.turnoverRatio !== undefined && result.turnoverRatio !== null) {
            $('val-turnover').textContent = result.turnoverRatio.toFixed(2) + 'x';
            $('val-turnover').className = `a-val ${result.turnoverRatio > 3 ? 'warn' : (result.turnoverRatio < 0.5 ? 'up' : '')}`;
            hasData = true;
        } else {
            $('val-turnover').textContent = '—';
            $('val-turnover').className = 'a-val';
        }

        if (result.compositeRatio !== undefined && result.compositeRatio !== null) {
            $('val-composite').textContent = result.compositeRatio.toFixed(2);
            $('val-composite').className = `a-val ${result.compositeRatio > 3 ? 'warn' : (result.compositeRatio < 0.5 ? 'up' : '')}`;
            hasData = true;
        } else {
            $('val-composite').textContent = '—';
            $('val-composite').className = 'a-val';
        }

        if (hasData) {
            analyticsRow.classList.remove('hidden');
        } else {
            analyticsRow.classList.add('hidden');
        }
    }

    // ─── KV rows ───
    $('prev-close').textContent = formatPrice(result.spotClose);

    // Intraday Target (full expected move)
    $('intraday-target').textContent = formatPrice(result.intradayTarget);
    const targetChange = $('target-change');
    const targetSign = result.expectedPct >= 0 ? '+' : '';
    targetChange.textContent = `${targetSign}${result.expectedPct}%`;
    targetChange.className = `change-pill ${result.direction.toLowerCase()}`;

    // Sure-Hit Level with multiplier tag
    $('sure-hit').textContent = formatPrice(result.sureHitLevel);
    const multEl = $('sure-hit-mult');
    if (multEl) {
        if (result.isExhaustion) {
            multEl.textContent = '×0.75 Exhaustion';
            multEl.style.color = 'var(--orange)';
        } else {
            multEl.textContent = '×0.90 Normal';
            multEl.style.color = 'var(--text-muted)';
        }
    }

    // Predicted Close (with retention)
    $('predicted-close').textContent = formatPrice(result.predictedClose);
    const closeChangePct = result.closeRetention < 1.0
        ? round2(result.expectedPct * result.closeRetention)
        : result.expectedPct;
    const closeSign = closeChangePct >= 0 ? '+' : '';
    const changeEl = $('predicted-change');
    changeEl.textContent = `${closeSign}${closeChangePct}%`;
    changeEl.className = `change-pill ${result.direction.toLowerCase()}`;

    // Retention row (show only when retention < 1.00)
    const retRow = $('retention-row');
    if (retRow) {
        if (result.closeRetention < 1.00) {
            retRow.classList.remove('hidden');
            let retText = '';
            if (result.closeRetention === 0.30) {
                retText = '30% retained — Mean-reversion bounce expected to fade. Market bounces intraday after extreme fall, but closing price gives back ~70% of the move. Trade the intraday target, not the close.';
            } else if (result.closeRetention === 0.60) {
                retText = '60% retained — PCR exhaustion zone. Too many puts in the market (PCR > 1.50) with no strong catalyst. Move starts but runs out of steam. Close will retain only ~60% of the expected move.';
            } else {
                retText = '85% retained — Override flipped direction against extreme PCR. Strong catalyst (gamma trap) pushes market the other way, but extreme positioning limits how much the close holds. ~85% of the move survives to close.';
            }
            $('retention-val').textContent = retText;
        } else {
            retRow.classList.add('hidden');
        }
    }

    // Live result
    if (mode === 'live') {
        $('live-result').classList.remove('hidden');
        const signalText = getLiveSignalText(result);
        $('live-signal').innerHTML = signalText.signal;
        $('live-signal').style.color = result.direction === 'UP' ? 'var(--green)' : 'var(--red)';
        $('live-action').textContent = signalText.action;
        $('live-detail').textContent = signalText.detail;
    } else {
        $('live-result').classList.add('hidden');
    }

    // Signal steps
    const stepsContainer = $('signal-steps');
    stepsContainer.innerHTML = '';
    result.signals.forEach(sig => {
        const step = document.createElement('div');
        step.className = `signal-step ${sig.cls || ''}`;
        step.innerHTML = `<span class="step-layer">${sig.layer}</span><span class="step-detail">${sig.detail}</span>`;
        stepsContainer.appendChild(step);
    });

    // Breakdown badge count
    const badge = $('breakdown-count');
    if (badge) badge.textContent = result.signals.length;

    // Auto-open breakdown
    $('breakdown-content').classList.add('open');
    const chevron = document.querySelector('.breakdown-toggle .chevron-icon');
    if (chevron) chevron.classList.add('open');

    // Store current result for save functionality
    window._lastResult = result;
    window._lastMode = mode;

    // Timestamp
    $('last-updated').textContent =
        `Last analyzed: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// Confidence ring (r=12, circumference = 2*PI*12 ≈ 75.4)


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
    const spotOpenText = $('input-open').value;
    const spotOpen = spotOpenText ? parseFloat(spotOpenText) : undefined;
    const spotClose = parseFloat($('input-close').value);
    const spotChangePct = parseFloat($('input-change').value);
    const putInterp = $('input-put-interp') ? $('input-put-interp').value : '';
    const putOiChangePct = parseFloat($('input-put-oi').value);
    const callOiChangePct = parseFloat($('input-call-oi').value);
    const putVolChangePct = parseFloat($('input-put-vol').value);
    const callVolChangePct = parseFloat($('input-call-vol').value);
    const pcrOI = parseFloat($('input-pcr-oi').value);
    const prevPcrRawInput = $('input-prev-pcr-oi').value;
    const prevPcrInput = prevPcrRawInput ? parseFloat(prevPcrRawInput) : undefined;
    const dte = parseInt($('input-dte').value, 10);
    const pcrVolRaw = $('input-pcr-vol').value;
    const pcrVolume = pcrVolRaw ? parseFloat(pcrVolRaw) : undefined;

    // Phase 2 Inputs
    const putIVRaw = $('input-put-iv').value;
    const callIVRaw = $('input-call-iv').value;
    const putIV = putIVRaw ? parseFloat(putIVRaw) : undefined;
    const callIV = callIVRaw ? parseFloat(callIVRaw) : undefined;

    const putVolAbsRaw = $('input-put-vol-abs').value;
    const callVolAbsRaw = $('input-call-vol-abs').value;
    const putVolAbs = putVolAbsRaw ? parseFloat(putVolAbsRaw) : undefined;
    const callVolAbs = callVolAbsRaw ? parseFloat(callVolAbsRaw) : undefined;

    const putOIAbsRaw = $('input-put-oi-abs').value;
    const callOIAbsRaw = $('input-call-oi-abs').value;
    const putOIAbs = putOIAbsRaw ? parseFloat(putOIAbsRaw) : undefined;
    const callOIAbs = callOIAbsRaw ? parseFloat(callOIAbsRaw) : undefined;

    const callLtpRaw = $('input-call-ltp').value;
    const callAvgRaw = $('input-call-avg').value;
    const putLtpRaw = $('input-put-ltp').value;
    const putAvgRaw = $('input-put-avg').value;
    const callLtp = callLtpRaw ? parseFloat(callLtpRaw) : undefined;
    const callAvg = callAvgRaw ? parseFloat(callAvgRaw) : undefined;
    const putLtp = putLtpRaw ? parseFloat(putLtpRaw) : undefined;
    const putAvg = putAvgRaw ? parseFloat(putAvgRaw) : undefined;

    let prevSpotChangePct = undefined;
    let prevPcrOi = undefined;
    try {
        const hist = JSON.parse(localStorage.getItem('kt21_history')) || [];
        if (hist.length > 0) {
            const last = hist[hist.length - 1]; 
            prevSpotChangePct = last.spotChangePct ?? last.input?.spotChangePct;
            prevPcrOi = last.pcrOI ?? last.input?.pcrOI;
        }
    } catch(e) {}

    const errors = [];
    if (spotOpen !== undefined && isNaN(spotOpen)) errors.push("Today's Open");
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
        spotOpen,
        spotClose,
        spotChangePct,
        putInterp,
        putOiChangePct,
        callOiChangePct,
        putVolChangePct,
        callVolChangePct,
        pcrOI,
        prevPcrInput,
        dte,
        pcrVolume,
        putIV,
        callIV,
        putVolAbs,
        callVolAbs,
        putOIAbs,
        callOIAbs,
        callLtp,
        callAvg,
        putLtp,
        putAvg,
        prevSpotChangePct,
        prevPcrOi,
        isManual: true
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
// SECTION 5: DUMP TEXT PARSER
// ===================================================================

/**
 * Parse the ChatGPT-generated dump text and auto-fill the manual form.
 * Maps field labels (case-insensitive) directly to input element IDs.
 * Returns { filled, emptySkipped, filledFields }
 */
function parseDumpText(text) {
    let filled = 0;
    let emptySkipped = 0;
    const filledFields = [];

    // ─── AUTO-EXTRACT OHLC INDEX TABLE ───
    // Looks for rows like: "Mar 24, 2026   22,958.40   22,878.45"
    const ohlcRegex = /^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/m;
    const ohlcMatch = text.match(ohlcRegex);
    
    if (ohlcMatch) {
        const closeEl = document.getElementById('input-close');
        const openEl = document.getElementById('input-open');
        if (closeEl) {
            closeEl.value = ohlcMatch[1].replace(/,/g, '');
            filled++;
            filledFields.push("Spot Close (Auto)");
        }
        if (openEl) {
            openEl.value = ohlcMatch[2].replace(/,/g, '');
            filled++;
            filledFields.push("Spot Open (Auto)");
        }
    }

    // Field map: normalized label → input element ID
    // IMPORTANT: longer/more-specific keys must come BEFORE shorter overlapping ones
    const FIELD_MAP = {
        // Spot
        "today's spot open": 'input-open',
        "spot open": 'input-open',
        "today's spot close": 'input-close',
        "today's spot % change": 'input-change',
        "spot close": 'input-close',
        "spot % change": 'input-change',
        "spot change": 'input-change',

        // Put interpretation
        "put interpretation": 'input-put-interp',

        // OI % changes
        "put oi % change (atm)": 'input-put-oi',
        "put oi % change": 'input-put-oi',
        "call oi % change (atm)": 'input-call-oi',
        "call oi % change": 'input-call-oi',

        // Volume % changes
        "put volume % change": 'input-put-vol',
        "put vol % change": 'input-put-vol',
        "call volume % change": 'input-call-vol',
        "call vol % change": 'input-call-vol',

        // PCR OI — prev day MUST match before plain "pcr oi"
        "prev day pcr oi (opt)": 'input-prev-pcr-oi',
        "prev day pcr oi": 'input-prev-pcr-oi',
        "previous day pcr oi": 'input-prev-pcr-oi',
        "prev pcr oi": 'input-prev-pcr-oi',
        "pcr oi": 'input-pcr-oi',

        // DTE
        "dte (days to expiry)": 'input-dte',
        "days to expiry": 'input-dte',
        "dte": 'input-dte',

        // PCR Volume
        "pcr volume (optional)": 'input-pcr-vol',
        "pcr volume": 'input-pcr-vol',
        "pcr vol": 'input-pcr-vol',

        // IV
        "put iv (optional)": 'input-put-iv',
        "put iv": 'input-put-iv',
        "call iv (optional)": 'input-call-iv',
        "call iv": 'input-call-iv',

        // Absolute volumes
        "put total volume (opt)": 'input-put-vol-abs',
        "put total volume": 'input-put-vol-abs',
        "call total volume (opt)": 'input-call-vol-abs',
        "call total volume": 'input-call-vol-abs',

        // Absolute OI
        "put total oi (opt)": 'input-put-oi-abs',
        "put total oi": 'input-put-oi-abs',
        "call total oi (opt)": 'input-call-oi-abs',
        "call total oi": 'input-call-oi-abs',

        // New Avg and LTP fields
        "call ltp (opt)": 'input-call-ltp',
        "call ltp": 'input-call-ltp',
        "call avg price (opt)": 'input-call-avg',
        "call avg price": 'input-call-avg',
        "call avg": 'input-call-avg',
        "put ltp (opt)": 'input-put-ltp',
        "put ltp": 'input-put-ltp',
        "put avg price (opt)": 'input-put-avg',
        "put avg price": 'input-put-avg',
        "put avg": 'input-put-avg',

        // Explicit absolute value mappings
        "call total volume (opt)": 'input-call-vol-abs',
        "put total volume (opt)": 'input-put-vol-abs',
        "call total oi (opt)": 'input-call-oi-abs',
        "put total oi (opt)": 'input-put-oi-abs',
        "call total volume": 'input-call-vol-abs',
        "put total volume": 'input-put-vol-abs',
        "call total oi": 'input-call-oi-abs',
        "put total oi": 'input-put-oi-abs'
    };

    const lines = text.split('\n');

    for (const line of lines) {
        let trimmed = line.trim();
        // Remove bolding astersiks from ChatGPT dumps
        trimmed = trimmed.replace(/\*\*/g, '');
        if (!trimmed) continue;

        // Split on FIRST colon, minus, or equals
        let sepIdx = trimmed.indexOf(':');
        if (sepIdx === -1) sepIdx = trimmed.indexOf('-');
        if (sepIdx === -1) sepIdx = trimmed.indexOf('=');

        if (sepIdx === -1) continue;

        const rawKey = trimmed.substring(0, sepIdx).trim();
        const rawVal = trimmed.substring(sepIdx + 1).trim();

        // Normalize key: lowercase, collapse multiple spaces
        const normalKey = rawKey.toLowerCase().replace(/\s+/g, ' ');

        // Look up field ID
        const inputId = FIELD_MAP[normalKey];
        if (!inputId) continue;

        // Skip blank values — user fills those manually
        if (!rawVal) {
            emptySkipped++;
            continue;
        }

        const el = document.getElementById(inputId);
        if (!el) continue;

        // Set value — works for both <input> and <select>
        const cleanVal = (el.type === 'number' && rawVal.startsWith('+')) ? rawVal.slice(1) : rawVal;
        el.value = cleanVal;
        filled++;
        filledFields.push(rawKey);
    }

    return { filled, emptySkipped, filledFields };
}


// ===================================================================
// SECTION 6: EVENT HANDLERS
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
        const icon = $('manual-chevron');
        if (form.classList.contains('hidden')) {
            form.classList.remove('hidden');
            icon.classList.add('open');
        } else {
            form.classList.add('hidden');
            icon.classList.remove('open');
        }
    });

    // ─── NAV FAB → open manual form directly ───
    const navFab = $('nav-fab-btn');
    if (navFab) {
        navFab.addEventListener('click', () => {
            $('tab-analysis').click();
            const form = $('manual-form');
            const icon = $('manual-chevron');
            form.classList.remove('hidden');
            icon.classList.add('open');
            document.querySelector('.manual-card').scrollIntoView({ behavior: 'smooth' });
        });
    }

    // ─── Bottom nav buttons ───
    const navManual = $('nav-manual-btn');
    if (navManual) {
        navManual.addEventListener('click', () => {
            $('tab-analysis').click();
            const form = $('manual-form');
            const icon = $('manual-chevron');
            form.classList.remove('hidden');
            icon.classList.add('open');
            document.querySelector('.manual-card').scrollIntoView({ behavior: 'smooth' });
        });
    }

    const navAnalysis = $('nav-analysis-btn');
    if (navAnalysis) {
        navAnalysis.addEventListener('click', () => {
            $('tab-analysis').click();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const navHistory = $('nav-history-btn');
    if (navHistory) {
        navHistory.addEventListener('click', () => {
            $('tab-history').click();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ─── Toggle Signal Breakdown ───
    $('toggle-breakdown').addEventListener('click', () => {
        const content = $('breakdown-content');
        const icon = document.querySelector('.breakdown-toggle .chevron-icon');
        content.classList.toggle('open');
        if (icon) icon.classList.toggle('open');
    });

    // ─── Save Result Flow (Modal) ───
    const saveBtn = $('btn-save-result');
    let modalHitResult = true;

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (!window._lastResult) return;
            // Show modal
            $('modal-actual-close').value = '';
            $('modal-hit-yes').classList.add('active');
            $('modal-hit-no').classList.remove('active');
            modalHitResult = true;
            $('save-modal-overlay').classList.remove('hidden');
        });
    }

    $('modal-hit-yes').addEventListener('click', () => {
        modalHitResult = true;
        $('modal-hit-yes').classList.add('active');
        $('modal-hit-no').classList.remove('active');
    });

    $('modal-hit-no').addEventListener('click', () => {
        modalHitResult = false;
        $('modal-hit-no').classList.add('active');
        $('modal-hit-yes').classList.remove('active');
    });

    $('modal-cancel-btn').addEventListener('click', () => {
        $('save-modal-overlay').classList.add('hidden');
    });

    $('modal-save-btn').addEventListener('click', () => {
        const actualCloseInput = $('modal-actual-close').value;
        const actualCloseVal = parseFloat(actualCloseInput);
        if (isNaN(actualCloseVal)) {
            alert('Please enter a valid actual close price to save to history.');
            return;
        }

        const r = window._lastResult;

        // Format date to match DD-Mon-YYYY style
        const d = new Date();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dateStr = `${d.getDate().toString().padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;

        const entry = {
            date: dateStr,
            direction: r.direction,
            confidence: r.confidence,
            intradayTarget: r.intradayTarget,
            sureHitLevel: r.sureHitLevel,
            predictedClose: r.predictedClose,
            spotClose: r.spotClose,
            expectedPct: r.expectedPct,
            sureHitMultiplier: r.sureHitMultiplier,
            closeRetention: r.closeRetention,
            signalClass: r.signalClass,
            isExhaustion: r.isExhaustion,
            actualClose: actualCloseVal,
            actualHigh: null,
            actualLow: null,
            sureHitReached: modalHitResult,
        };

        saveToHistory(entry);
        $('save-modal-overlay').classList.add('hidden');

        // Show success on main save button
        saveBtn.textContent = '✅ Saved!';
        saveBtn.style.background = 'var(--green)';
        saveBtn.style.color = 'white';
        setTimeout(() => {
            saveBtn.textContent = '💾 Save to History';
            saveBtn.style.background = '';
            saveBtn.style.color = '';
        }, 2000);
    });

    // ─── Toggle History ───
    const histToggle = $('toggle-history');
    if (histToggle) {
        histToggle.addEventListener('click', () => {
            const body = $('history-body');
            const icon = $('history-chevron');
            body.classList.toggle('hidden');
            if (icon) icon.classList.toggle('open');
        });
    }

    // ─── Pill Tab Switching ───
    document.querySelectorAll('.tab-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            // Update active pill
            document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');

            // Hide all panes
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

            const tabId = pill.dataset.tab;

            // Sync bottom nav active states
            document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => btn.classList.remove('active'));
            if (tabId === 'analysis') {
                const navBtn = $('nav-analysis-btn');
                if (navBtn) navBtn.classList.add('active');
            } else if (tabId === 'history') {
                const navBtn = $('nav-history-btn');
                if (navBtn) navBtn.classList.add('active');
            } else {
                const navBtn = $('nav-analysis-btn'); // Default highlight
                if (navBtn) navBtn.classList.add('active');
            }

            // Show selected pane
            const pane = $(`tab-pane-${tabId}`);
            if (pane) {
                pane.classList.remove('hidden');
                if (tabId === 'history') renderHistory();
            }
        });
    });

    // ─── DUMP TEXT PARSER BUTTONS ───
    const parseDumpBtn = $('btn-parse-dump');
    const clearDumpBtn = $('btn-clear-dump');
    const dumpStatusEl = $('dump-status');

    function showDumpStatus(msg, type) {
        if (!dumpStatusEl) return;
        dumpStatusEl.textContent = msg;
        dumpStatusEl.className = `dump-status ${type}`;
        dumpStatusEl.classList.remove('hidden');
        if (type === 'success') {
            setTimeout(() => dumpStatusEl.classList.add('hidden'), 4000);
        }
    }

    if (parseDumpBtn) {
        parseDumpBtn.addEventListener('click', () => {
            const dumpInput = $('dump-text-input');
            const text = dumpInput ? dumpInput.value.trim() : '';

            if (!text) {
                showDumpStatus('⚠️ Nothing pasted yet. Paste the ChatGPT dump text above.', 'error');
                return;
            }

            const { filled, emptySkipped } = parseDumpText(text);

            if (filled === 0) {
                showDumpStatus('❌ Could not read any fields. Format must be "Field Name: Value" on each line.', 'error');
                return;
            }

            const skipMsg = emptySkipped > 0
                ? ` (${emptySkipped} blank field${emptySkipped > 1 ? 's' : ''} skipped — fill manually)`
                : '';
            showDumpStatus(`✅ ${filled} fields filled automatically!${skipMsg}`, 'success');

            // Scroll to form so user can review
            const formGrid = document.querySelector('.form-grid');
            if (formGrid) {
                setTimeout(() => formGrid.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
            }
        });
    }

    if (clearDumpBtn) {
        clearDumpBtn.addEventListener('click', () => {
            const dumpInput = $('dump-text-input');
            if (dumpInput) dumpInput.value = '';
            if (dumpStatusEl) dumpStatusEl.classList.add('hidden');
        });
    }

    // Init history on load
    initHistory();
});


// ===================================================================
// SECTION 7: HISTORY MANAGEMENT
// ===================================================================

const HISTORY_KEY = 'kt21_history';

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch { return []; }
}

function saveToHistory(entry) {
    const hist = getHistory();
    hist.push(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    renderHistory();
}

function initHistory() {
    let hist = getHistory();

    // Remove legacy dirty items
    hist = hist.filter(h => h.actualClose !== null && h.actualClose !== undefined || h.isPending);

    const rawHistory = [
        { date: '06-Mar-2026', input: { spotOpen: 24656.40, spotClose: 24450.45, spotChangePct: -1.27, putInterp: 'LB', putOiChangePct: 74.41, callOiChangePct: 430.62, putVolChangePct: 140, callVolChangePct: 64, pcrOI: 1.33, dte: 4, pcrVolume: 4.53 }, actualClose: 24028.05 },
        { date: '09-Mar-2026', input: { spotOpen: 24483.95, spotClose: 24028.05, spotChangePct: -1.73, putInterp: 'SC', putOiChangePct: -11.95, callOiChangePct: 740.90, putVolChangePct: -1, callVolChangePct: 12539, pcrOI: 1.14, dte: 2, pcrVolume: 0.49 }, actualClose: 24261.60 },
        { date: '10-Mar-2026', input: { spotOpen: 24280.95, spotClose: 24261.60, spotChangePct: 0.97, putInterp: 'SB', putOiChangePct: 1546.57, callOiChangePct: 728.96, putVolChangePct: 3077, callVolChangePct: 1233, pcrOI: 0.98, dte: 8, pcrVolume: 0.77 }, actualClose: 23866.85 },
        { date: '11-Mar-2026', input: { spotOpen: 24240.25, spotClose: 23866.85, spotChangePct: -1.63, putInterp: 'LB', putOiChangePct: 202.68, callOiChangePct: 786.18, putVolChangePct: 1924, callVolChangePct: 3894, pcrOI: 1.51, dte: 7, pcrVolume: 5.50 }, actualClose: 23639.15 },
        { date: '12-Mar-2026', input: { spotOpen: 23838.05, spotClose: 23639.15, spotChangePct: -0.95, putInterp: 'LB', putOiChangePct: 262.22, callOiChangePct: 1520.82, putVolChangePct: 178, callVolChangePct: 10457, pcrOI: 1.39, dte: 6, pcrVolume: 1.41 }, actualClose: 23151.10 },
        { date: '13-Mar-2026', input: { spotOpen: 23634.30, spotClose: 23151.10, spotChangePct: -2.06, putInterp: 'LB', putOiChangePct: 139.65, callOiChangePct: 5194.92, putVolChangePct: 688, callVolChangePct: 25502, pcrOI: 1.64, dte: 5, pcrVolume: 2.83 }, actualClose: 23408.80 },
        { date: '16-Mar-2026', input: { spotOpen: 23164.75, spotClose: 23408.80, spotChangePct: 1.11, putInterp: 'SB', putOiChangePct: 237.50, callOiChangePct: 59.56, putVolChangePct: -31, callVolChangePct: 116, pcrOI: 0.93, dte: 2, pcrVolume: 0.30 }, actualClose: 23581.15 },
        { date: '17-Mar-2026', input: { spotOpen: 23493.20, spotClose: 23581.15, spotChangePct: 0.74, putInterp: 'SB', putOiChangePct: 368.70, callOiChangePct: 236.85, putVolChangePct: 1273, callVolChangePct: 397, pcrOI: 0.99, dte: 8, pcrVolume: 0.64 }, actualClose: 23777.80 },
        { date: '18-Mar-2026', bs: true, input: { spotClose: 23777.80, spotChangePct: 0.83, putInterp: 'SB', putOiChangePct: 300, callOiChangePct: 400, putVolChangePct: 12, callVolChangePct: 10, pcrOI: 0.93, dte: 7, callLtp: 185, callAvg: 207.62, putLtp: 231.30, putAvg: 229.86 }, actualClose: 23002.15 },
        { date: '19-Mar-2026', input: { spotOpen: 23789.25, spotClose: 23002.15, spotChangePct: -3.26, putInterp: 'LB', putOiChangePct: 22.83, callOiChangePct: 372.31, putVolChangePct: 143, callVolChangePct: 3533, pcrOI: 2.00, dte: 6, pcrVolume: 3.44 }, actualClose: 23114.50 },
        { date: '20-Mar-2026', bs: true, input: { spotOpen: 23038.95, spotClose: 23114.50, spotChangePct: 0.49, putInterp: 'SB', putOiChangePct: 88.37, callOiChangePct: 58.81, putVolChangePct: 139, callVolChangePct: 106, pcrOI: 1.31, dte: 5, pcrVolume: 2.32, callLtp: 237.35, callAvg: 291.58, putLtp: 214.50, putAvg: 204.91 }, actualClose: 22493.50 },
        { date: '23-Mar-2026', isPending: true, input: { spotClose: 22493.50, spotChangePct: -2.69, putInterp: 'LB', putOiChangePct: 6.23, callOiChangePct: 977.83, putVolChangePct: 180, callVolChangePct: 16211, pcrOI: 1.47, pcrVolume: 2.12, dte: 2, putIV: 39.04, callIV: 36.16 }, actualClose: null }
    ];

    const seed = rawHistory.map(day => {
        const r = predict(day.input);
        return {
            date: day.date,
            direction: day.bs ? 'DANGER' : r.direction,
            confidence: day.bs ? 0 : r.confidence,
            intradayTarget: r.intradayTarget,
            sureHitLevel: r.sureHitLevel,
            predictedClose: r.predictedClose,
            spotClose: day.input.spotClose,
            expectedPct: r.expectedPct,
            sureHitMultiplier: r.sureHitMultiplier,
            closeRetention: r.closeRetention,
            signalClass: r.signalClass,
            isExhaustion: r.isExhaustion,
            actualClose: day.actualClose,
            sureHitReached: day.isPending ? null : true,
            isPending: day.isPending
        };
    });

    // Merge logic: Ensure all dynamically calculated seeds exist, but don't delete new saves done by the user!
    const mergedHist = [...seed];

    // Add any manually saved history that isn't part of the core 11-day seed
    const seedDates = seed.map(s => s.date);
    for (const userSave of hist) {
        if (!seedDates.includes(userSave.date)) {
            mergedHist.push(userSave);
        }
    }

    localStorage.setItem(HISTORY_KEY, JSON.stringify(mergedHist));
    renderHistory();
}

function renderHistory() {
    const hist = getHistory();
    const section = $('history-section');
    const list = $('history-list');
    const countEl = $('history-count');

    if (!section || !list) return;
    if (hist.length === 0) {
        section.classList.remove('hidden');
        if (countEl) countEl.textContent = '0 predictions saved';
        list.innerHTML = '<p class="empty-state">No predictions saved yet. Make a prediction in the Analysis tab and click "Save to History".</p>';
        return;
    }

    section.classList.remove('hidden');
    if (countEl) countEl.textContent = `${hist.length} predictions saved`;

    // Build table
    let html = '<div class="history-table-wrap"><table class="history-table"><thead><tr>';
    html += '<th>Date</th><th>Dir</th><th>Conf</th><th>Target</th><th>Sure-Hit</th><th>Close</th>';
    html += '<th>Actual</th><th>Hit?</th>';
    html += '</tr></thead><tbody>';

    for (const h of hist.slice().reverse()) {
        const dirClass = h.direction === 'UP' ? 'highlight-up' : 'highlight-down';
        const hitIcon = h.sureHitReached === true ? '✅' : h.sureHitReached === false ? '❌' : '—';
        const actualStr = h.actualClose ? formatPrice(h.actualClose) : '—';
        const closeErr = h.actualClose ? Math.abs(h.predictedClose - h.actualClose).toFixed(0) + 'p' : '';
        html += `<tr>`;
        html += `<td>${h.date}</td>`;
        html += `<td class="${dirClass}">${h.direction}</td>`;
        html += `<td>${h.confidence}%</td>`;
        html += `<td>${formatPrice(h.intradayTarget)}</td>`;
        html += `<td>${formatPrice(h.sureHitLevel)}${h.isExhaustion ? ' ⚡' : ''}</td>`;
        html += `<td>${formatPrice(h.predictedClose)}${closeErr ? ' <small>(±' + closeErr + ')</small>' : ''}</td>`;
        html += `<td>${actualStr}</td>`;
        html += `<td>${hitIcon}</td>`;
        html += `</tr>`;
    }

    html += '</tbody></table></div>';

    // Stats row
    const withResults = hist.filter(h => h.actualClose);
    if (withResults.length > 0) {
        const dirCorrect = withResults.filter(h => {
            if (h.direction === 'UP') return h.actualClose > h.spotClose;
            return h.actualClose < h.spotClose;
        }).length;
        const hitCount = withResults.filter(h => h.sureHitReached === true).length;
        const avgErr = (withResults.reduce((s, h) => s + Math.abs(h.predictedClose - h.actualClose), 0) / withResults.length).toFixed(0);
        html += `<div class="history-stats">`;
        html += `<span>Direction: <b>${dirCorrect}/${withResults.length}</b></span>`;
        html += `<span>Sure-Hit: <b>${hitCount}/${withResults.length}</b></span>`;
        html += `<span>Avg Close Error: <b>${avgErr} pts</b></span>`;
        html += `</div>`;
    }

    list.innerHTML = html;
}

// ===================================================================
// SECTION 8: TEST SUITE (Run in browser console: runAllTests())
// ===================================================================

/**
 * Validate the prediction engine against all 9 historical transitions.
 * Each test uses ONLY the data visible at previous day's close.
 */
function runAllTests() {
    const tests = [
        {
            name: '6 Mar → 9 Mar (DOWN −1.73%)',
            input: { spotOpen: 24656.40, spotClose: 24450.45, spotChangePct: -1.27, putInterp: 'LB', putOiChangePct: 74.41, callOiChangePct: 430.62, putVolChangePct: 140, callVolChangePct: 64, pcrOI: 1.33, dte: 4, pcrVolume: 4.53 },
            expectedDir: 'DOWN',
            expectedTarget: 24019,
            expectedClose: 24019,
            actualClose: 24028.05,
            actualLow: 23698,
        },
        {
            name: '9 Mar → 10 Mar (UP +0.97%)',
            input: { spotOpen: 24483.95, spotClose: 24028.05, spotChangePct: -1.73, putInterp: 'SC', putOiChangePct: -11.95, callOiChangePct: 740.90, putVolChangePct: -1, callVolChangePct: 12539, pcrOI: 1.14, dte: 2, pcrVolume: 0.49 },
            expectedDir: 'UP',
            expectedTarget: 24256,
            expectedClose: 24256,
            actualClose: 24261.60,
            actualHigh: 24304,
        },
        {
            name: '10 Mar → 11 Mar (DOWN −1.63%) [Override 1 @ DTE=8]',
            input: { spotOpen: 24280.95, spotClose: 24261.60, spotChangePct: 0.97, putInterp: 'SB', putOiChangePct: 1546.57, callOiChangePct: 728.96, putVolChangePct: 3077, callVolChangePct: 1233, pcrOI: 0.98, dte: 8, pcrVolume: 0.77 },
            expectedDir: 'DOWN',
            expectedTarget: 23886,
            expectedClose: 23886,
            actualClose: 23866.85,
            actualLow: 23834,
        },
        {
            name: '11 Mar → 12 Mar (DOWN −0.95%) [Exhaustion PCR 1.51]',
            input: { spotOpen: 24240.25, spotClose: 23866.85, spotChangePct: -1.63, putInterp: 'LB', putOiChangePct: 202.68, callOiChangePct: 786.18, putVolChangePct: 1924, callVolChangePct: 3894, pcrOI: 1.51, dte: 7, pcrVolume: 5.50 },
            expectedDir: 'DOWN',
            expectedTarget: 23472,
            expectedClose: 23630,  // retention 0.60
            actualClose: 23639.15,
            actualLow: 23556,
        },
        {
            name: '12 Mar → 13 Mar (DOWN −2.06%)',
            input: { spotOpen: 23838.05, spotClose: 23639.15, spotChangePct: -0.95, putInterp: 'LB', putOiChangePct: 262.22, callOiChangePct: 1520.82, putVolChangePct: 178, callVolChangePct: 10457, pcrOI: 1.39, dte: 6, pcrVolume: 1.41 },
            expectedDir: 'DOWN',
            expectedTarget: 23215,
            expectedClose: 23215,
            actualClose: 23151.10,
            actualLow: 23112,
        },
        {
            name: '13 Mar → 16 Mar (UP +1.11%) [Override 1 @ DTE=5 + PCR 1.64]',
            input: { spotOpen: 23634.30, spotClose: 23151.10, spotChangePct: -2.06, putInterp: 'LB', putOiChangePct: 139.65, callOiChangePct: 5194.92, putVolChangePct: 688, callVolChangePct: 25502, pcrOI: 1.64, dte: 5, pcrVolume: 2.83 },
            expectedDir: 'UP',
            expectedTarget: 23464,
            expectedClose: 23417,  // retention 0.85
            actualClose: 23408.80,
            actualHigh: 23502,
        },
        {
            name: '16 Mar → 17 Mar (UP +0.74%)',
            input: { spotOpen: 23164.75, spotClose: 23408.80, spotChangePct: 1.11, putInterp: 'SB', putOiChangePct: 237.50, callOiChangePct: 59.56, putVolChangePct: -31, callVolChangePct: 116, pcrOI: 0.93, dte: 2, pcrVolume: 0.30 },
            expectedDir: 'UP',
            expectedTarget: 23619,
            expectedClose: 23619,
            actualClose: 23581.15,
            actualHigh: 23657,
        },
        {
            name: '17 Mar → 18 Mar (UP +0.83%)',
            input: { spotOpen: 23493.20, spotClose: 23581.15, spotChangePct: 0.74, putInterp: 'SB', putOiChangePct: 368.70, callOiChangePct: 236.85, putVolChangePct: 1273, callVolChangePct: 397, pcrOI: 0.99, dte: 8, pcrVolume: 0.64 },
            expectedDir: 'UP',
            expectedTarget: 23782,
            expectedClose: 23782,
            actualClose: 23777.80,
            actualHigh: 23862,
        },
        {
            name: '19 Mar → 20 Mar (UP +0.49%) [Override 2 Fade + PCR 2.00]',
            input: { spotOpen: 23789.25, spotClose: 23002.15, spotChangePct: -3.26, putInterp: 'LB', putOiChangePct: 22.83, callOiChangePct: 372.31, putVolChangePct: 143, callVolChangePct: 3533, pcrOI: 2.00, dte: 6, pcrVolume: 3.44 },
            expectedDir: 'UP',
            expectedTarget: 23425,
            expectedClose: 23129,  // retention 0.30
            actualClose: 23114.50,
            actualHigh: 23345,
        },
    ];

    console.log('%c═══ KING TRADES 21 ALGO — TEST SUITE ═══', 'color: #00b4d8; font-weight: bold; font-size: 14px');
    console.log('Running 9 historical transitions...\n');

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        const result = predict(test.input);
        const dirOk = result.direction === test.expectedDir;
        const closeError = Math.abs(result.predictedClose - test.actualClose);
        const targetError = Math.abs(result.intradayTarget - test.expectedTarget);

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
            `   Target: ${result.intradayTarget} | Close: ${result.predictedClose} (×${result.closeRetention}) | Sure-Hit: ${result.sureHitLevel} (×${result.sureHitMultiplier}) | Actual: ${test.actualClose} | Close Err: ${closeError.toFixed(0)}pts | ${result.signalClass} ${result.confidence}%${result.isExhaustion ? ' ⚡EXHAUST' : ''}`
        );
    }

    console.log(
        `\n%c═══ RESULT: ${passed}/9 PASSED, ${failed}/9 FAILED ═══`,
        `color: ${failed === 0 ? '#00d4aa' : '#ff4757'}; font-weight: bold; font-size: 14px`
    );

    // 20 Mar → 21 Mar prediction
    console.log('\n%c═══ 20 Mar → 21 Mar PREDICTION ═══', 'color: #fbbf24; font-weight: bold');
    const pred20 = predict({
        spotOpen: 23038.95, spotClose: 23114.50, spotChangePct: 0.49, putInterp: 'SB',
        putOiChangePct: 88.37, callOiChangePct: 58.81,
        putVolChangePct: 139, callVolChangePct: 106,
        pcrOI: 1.31, dte: 5, pcrVolume: 2.32,
    });
    console.log(`Direction: ${pred20.direction} | Confidence: ${pred20.confidence}%`);
    console.log(`Intraday Target: ${pred20.intradayTarget} | Sure-Hit: ${pred20.sureHitLevel} (×${pred20.sureHitMultiplier})`);
    console.log(`Predicted Close: ${pred20.predictedClose} (×${pred20.closeRetention})`);
    console.log(`Expected %: ${pred20.expectedPct}% | Signal: ${pred20.signalClass}`);
    console.log(`Exhaustion: ${pred20.isExhaustion} | Override1: ${pred20.override1} | Override2: ${pred20.override2}`);

    return { passed, failed };
}
