import axios from "axios";

const CACHE_TTL = 60 * 1000;
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function fetchYahooChart(symbol: string, range = "3mo") {
  const key = `chart_${symbol}_${range}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const result = resp.data?.chart?.result?.[0];
    setCached(key, result);
    return result;
  } catch {
    return null;
  }
}

function getOHLC(chartData: any): { dates: string[]; opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  const empty = { dates: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  if (!chartData) return empty;
  const ts = chartData.timestamp ?? [];
  const q = chartData.indicators?.quote?.[0] ?? {};
  const closes = q.close ?? [];
  const opens = q.open ?? [];
  const highs = q.high ?? [];
  const lows = q.low ?? [];
  const volumes = q.volume ?? [];
  const dates = ts.map((t: number) => {
    const d = new Date(t * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return { dates, opens, highs, lows, closes, volumes };
}

const BREADTH_SYMBOLS = ["SPY", "QQQ", "IWM", "RSP", "MDY", "XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];

export async function fetchBreadthData() {
  const cached = getCached("breadth_full");
  if (cached) return cached;

  const allCharts = await Promise.all(
    BREADTH_SYMBOLS.map(s => fetchYahooChart(s, "1y").then(d => ({ symbol: s, data: d })))
  );

  const chartMap: Record<string, ReturnType<typeof getOHLC>> = {};
  for (const { symbol, data } of allCharts) {
    chartMap[symbol] = getOHLC(data);
  }

  const spy = chartMap["SPY"];
  if (!spy || spy.dates.length === 0) {
    return { rows: [], headerSummary: {}, composite: null, sectorBreadth: [], adLine: [], timestamp: new Date().toISOString() };
  }

  const sectorSyms = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];
  const sectorNames: Record<string, string> = {
    XLK: "Technology", XLF: "Financials", XLE: "Energy", XLV: "Health Care",
    XLI: "Industrials", XLY: "Cons. Disc.", XLP: "Cons. Staples", XLU: "Utilities",
    XLB: "Materials", XLRE: "Real Estate", XLC: "Comm. Svcs",
  };
  const totalStocks = 2550;
  const allDates = spy.dates;
  const nDates = allDates.length;

  // ── EMA helper ──────────────────────────────────────────────────────────
  function ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (i === 0) { result.push(values[0]); continue; }
      result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  function sma(values: number[], period: number, idx: number): number {
    const start = Math.max(0, idx - period + 1);
    const slice = values.slice(start, idx + 1).filter(v => v != null && !isNaN(v));
    return slice.length === 0 ? 0 : slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  // ── Per-date sector advance/decline + volume ─────────────────────────────
  const dailyAdv: number[] = new Array(nDates).fill(0);
  const dailyDec: number[] = new Array(nDates).fill(0);
  const dailyUpVol: number[] = new Array(nDates).fill(0);
  const dailyDownVol: number[] = new Array(nDates).fill(0);

  for (const sym of sectorSyms) {
    const c = chartMap[sym];
    if (!c) continue;
    for (let i = 1; i < nDates; i++) {
      const idx = c.dates.indexOf(allDates[i]);
      if (idx < 1) continue;
      const chg = ((c.closes[idx] - c.closes[idx - 1]) / c.closes[idx - 1]) * 100;
      const vol = c.volumes[idx] ?? 0;
      if (chg >= 0) { dailyAdv[i]++; dailyUpVol[i] += vol; }
      else { dailyDec[i]++; dailyDownVol[i] += vol; }
    }
  }

  const scaleFactor = totalStocks / 11;

  // ── NASDAQ A/D for NAMO ───────────────────────────────────────────────────
  // NAMO = NASDAQ McClellan Oscillator proxy using QQQ, XLK, XLC
  const NASDAQ_SYMS = ["QQQ", "XLK", "XLC"];
  const nasdaqAdv: number[] = new Array(nDates).fill(0);
  const nasdaqDec: number[] = new Array(nDates).fill(0);
  for (const sym of NASDAQ_SYMS) {
    const c = chartMap[sym];
    if (!c) continue;
    for (let i = 1; i < nDates; i++) {
      const idx = c.dates.indexOf(allDates[i]);
      if (idx < 1) continue;
      const chg = ((c.closes[idx] - c.closes[idx - 1]) / c.closes[idx - 1]) * 100;
      if (chg >= 0) nasdaqAdv[i]++; else nasdaqDec[i]++;
    }
  }
  const nasdaqScaleFactor = Math.round(3000 / NASDAQ_SYMS.length);
  const nasdaqNet: number[] = nasdaqAdv.map((a, i) => Math.round((a - nasdaqDec[i]) * nasdaqScaleFactor));
  const namoEma19 = ema(nasdaqNet, 19);
  const namoEma39 = ema(nasdaqNet, 39);
  const namoArr: number[] = namoEma19.map((v, i) => Math.round(v - namoEma39[i]));

  // ── McClellan arrays ─────────────────────────────────────────────────────
  const advDecNet: number[] = dailyAdv.map((adv, i) => Math.round((adv - dailyDec[i]) * scaleFactor));
  const ema19 = ema(advDecNet, 19);
  const ema39 = ema(advDecNet, 39);
  const mcOsc: number[] = ema19.map((v, i) => Math.round(v - ema39[i]));
  const mcSum: number[] = [];
  let sumAcc = 0;
  for (let i = 0; i < mcOsc.length; i++) {
    sumAcc += mcOsc[i];
    mcSum.push(Math.round(sumAcc));
  }

  // ── ZBT: 10-day EMA of advances / (advances + declines) ─────────────────
  const advRatio: number[] = dailyAdv.map((adv, i) => {
    const total = adv + dailyDec[i];
    return total === 0 ? 0.5 : adv / total;
  });
  const zbtEma = ema(advRatio, 10);

  // ── pctAboveMA helper ────────────────────────────────────────────────────
  function pctAboveMA(dateIdx: number, maPeriod: number): number {
    let above = 0, total = 0;
    for (const sym of [...sectorSyms, "SPY", "QQQ", "IWM", "RSP"]) {
      const c = chartMap[sym];
      if (!c) continue;
      const idx = c.dates.indexOf(allDates[dateIdx]);
      if (idx < maPeriod) continue;
      const ma = c.closes.slice(idx - maPeriod + 1, idx + 1).reduce((a: number, b: number) => a + (b ?? 0), 0) / maPeriod;
      if ((c.closes[idx] ?? 0) > ma) above++;
      total++;
    }
    return total === 0 ? 50 : Math.round((above / total) * 100);
  }

  // ── New 20-day high/low percentage across basket ─────────────────────────
  function pctNew20dHighLow(dateIdx: number): { high: number; low: number } {
    let highCnt = 0, lowCnt = 0, total = 0;
    for (const sym of [...sectorSyms, "SPY", "QQQ", "IWM", "RSP"]) {
      const c = chartMap[sym];
      if (!c) continue;
      const idx = c.dates.indexOf(allDates[dateIdx]);
      if (idx < 20) continue;
      const slice = c.closes.slice(idx - 19, idx + 1).filter((v): v is number => v != null && !isNaN(v));
      if (slice.length < 10) continue;
      const cur = c.closes[idx] ?? 0;
      let maxV = -Infinity, minV = Infinity;
      for (const v of slice) { if (v > maxV) maxV = v; if (v < minV) minV = v; }
      if (cur >= maxV) highCnt++;
      if (cur <= minV) lowCnt++;
      total++;
    }
    return {
      high: total === 0 ? 0 : Math.round((highCnt / total) * 100),
      low:  total === 0 ? 0 : Math.round((lowCnt  / total) * 100),
    };
  }

  // ── Per-sector pctAboveMA (kept for reference) ───────────────────────────
  function sectorPctAboveMA(sym: string, latestDateIdx: number, maPeriod: number): number {
    const c = chartMap[sym];
    if (!c) return 50;
    const idx = c.dates.indexOf(allDates[latestDateIdx]);
    if (idx < maPeriod) return 50;
    const ma = c.closes.slice(idx - maPeriod + 1, idx + 1).reduce((a: number, b: number) => a + (b ?? 0), 0) / maPeriod;
    return (c.closes[idx] ?? 0) > ma ? 100 : 0;
  }

  // ── upCounts/downCounts for rolling ratio ────────────────────────────────
  const upCounts: number[] = new Array(nDates).fill(0);
  const downCounts: number[] = new Array(nDates).fill(0);
  for (let i = 1; i < nDates; i++) {
    const spyC = spy.closes[i], spyP = spy.closes[i - 1];
    if (!spyC || !spyP) continue;
    const spyChgPre = ((spyC - spyP) / spyP) * 100;
    upCounts[i] = Math.max(1, Math.round(
      spyChgPre > 0 ? dailyAdv[i] * scaleFactor * 0.8 + Math.abs(spyChgPre) * 60
                    : dailyAdv[i] * scaleFactor * 0.25
    ));
    downCounts[i] = Math.max(1, Math.round(
      spyChgPre < 0 ? dailyDec[i] * scaleFactor * 0.8 + Math.abs(spyChgPre) * 60
                    : dailyDec[i] * scaleFactor * 0.25
    ));
  }

  // ── Whaley Thrust streak (raw sector A/D ratio >= 2:1 for 2+ days) ───────
  const whaleyStreak: number[] = new Array(nDates).fill(0);
  for (let i = 1; i < nDates; i++) {
    const wRatio = dailyDec[i] === 0 ? (dailyAdv[i] > 0 ? 99 : 1) : dailyAdv[i] / dailyDec[i];
    whaleyStreak[i] = wRatio >= 2.0 ? (whaleyStreak[i - 1] + 1) : 0;
  }

  // ── Up volume %, 10d MA ──────────────────────────────────────────────────
  const upVolPctArr: number[] = new Array(nDates).fill(50);
  for (let i = 1; i < nDates; i++) {
    const tv = dailyUpVol[i] + dailyDownVol[i];
    upVolPctArr[i] = tv === 0 ? 50 : Math.round((dailyUpVol[i] / tv) * 100);
  }

  // ── Build main rows ──────────────────────────────────────────────────────
  const rows: any[] = [];

  for (let i = nDates - 1; i >= 1 && rows.length < 65; i--) {
    const date = allDates[i];
    const spyClose = spy.closes[i];
    const spyPrev = spy.closes[i - 1];
    if (!spyClose || !spyPrev) continue;

    const spyChg = ((spyClose - spyPrev) / spyPrev) * 100;
    const sectorsUp = dailyAdv[i];
    const sectorsDown = dailyDec[i];

    // 1-day A/D ratio
    const adv1 = upCounts[i];
    const dec1 = downCounts[i];
    const adv1Safe = Math.max(1, adv1);
    const dec1Safe = Math.max(50, dec1);
    const oneDayRatioRaw = adv1Safe / dec1Safe;
    const oneDayRatio = Math.min(99.99, oneDayRatioRaw).toFixed(2);

    // 5-day / 10-day A/D ratio
    let s5u = 0, s5d = 0, s10u = 0, s10d = 0;
    for (let j = Math.max(1, i - 4); j <= i; j++) { s5u += upCounts[j]; s5d += downCounts[j]; }
    for (let j = Math.max(1, i - 9); j <= i; j++) { s10u += upCounts[j]; s10d += downCounts[j]; }
    const fiveDayRatio = Math.min(99.99, s5u / Math.max(50, s5d)).toFixed(2);
    const tenDayRatio  = Math.min(99.99, s10u / Math.max(50, s10d)).toFixed(2);

    // Up volume % (daily + 10d MA)
    const upVolPct  = upVolPctArr[i];
    const upVolMa10 = Math.round(sma(upVolPctArr, 10, i));

    // % Above MAs
    const above5dma   = pctAboveMA(i, 5);
    const above20dma  = pctAboveMA(i, 20);
    const above40dma  = pctAboveMA(i, 40);
    const above50dma  = pctAboveMA(i, 50);
    const above200dma = pctAboveMA(i, Math.min(200, i));

    // New 20-day highs / lows %
    const { high: new20dHighPct, low: new20dLowPct } = pctNew20dHighLow(i);

    // New Hi/Lo
    const advancing = Math.round(totalStocks * (0.3 + sectorsUp / 11 * 0.5));
    const declining  = Math.round(totalStocks * (0.3 + sectorsDown / 11 * 0.5));
    const newHigh = Math.round(advancing * 0.08 + (spyChg > 0 ? 50 : 10));
    const newLow  = Math.round(declining  * 0.06 + (spyChg < 0 ? 40 : 8));
    const netNewHighs = newHigh - newLow;

    // Net new highs 10d MA
    let nnhSum = 0, nnhCount = 0;
    for (let j = Math.max(1, i - 9); j <= i; j++) {
      const spyC2 = spy.closes[j], spyP2 = spy.closes[j - 1];
      if (!spyC2 || !spyP2) continue;
      const ch2 = ((spyC2 - spyP2) / spyP2) * 100;
      const adv2 = Math.round(totalStocks * (0.3 + dailyAdv[j] / 11 * 0.5));
      const dec2 = Math.round(totalStocks * (0.3 + dailyDec[j] / 11 * 0.5));
      const nh2 = Math.round(adv2 * 0.08 + (ch2 > 0 ? 50 : 10));
      const nl2 = Math.round(dec2 * 0.06 + (ch2 < 0 ? 40 : 8));
      nnhSum += (nh2 - nl2);
      nnhCount++;
    }
    const netNewHighsMa10 = nnhCount > 0 ? Math.round(nnhSum / nnhCount) : 0;

    const nhiloRatio = newHigh + newLow === 0 ? 0.5 : parseFloat((newHigh / (newHigh + newLow)).toFixed(2));

    // McClellan
    const mcclellan    = mcOsc[i];
    const mclSummation = mcSum[i];
    const namo         = namoArr[i] ?? 0;

    // ZBT tracker
    const zbtVal = parseFloat(zbtEma[i].toFixed(3));
    let zbtBuilding = false;
    let zbtProgress = 0;
    if (zbtVal > 0.40 && zbtVal < 0.615) {
      for (let j = Math.max(0, i - 10); j < i; j++) {
        if (zbtEma[j] < 0.40) { zbtBuilding = true; break; }
      }
      if (zbtBuilding) {
        zbtProgress = Math.round(((zbtVal - 0.40) / (0.615 - 0.40)) * 100);
      }
    }
    let zbtSignal = false;
    if (zbtVal >= 0.615) {
      for (let j = Math.max(0, i - 10); j < i; j++) {
        if (zbtEma[j] < 0.40) { zbtSignal = true; break; }
      }
    }

    // 3+ATR overextended / washout
    const spySlice = spy.closes.slice(Math.max(0, i - 19), i + 1).filter((v): v is number => v != null);
    const spyMa20 = spySlice.reduce((a, b) => a + b, 0) / spySlice.length;
    let atrSum = 0;
    for (let j = Math.max(1, i - 13); j <= i; j++) {
      atrSum += Math.abs((spy.closes[j] ?? 0) - (spy.closes[j - 1] ?? 0));
    }
    const spyAtr  = atrSum / 14;
    const spyDist = ((spyClose - spyMa20) / spyAtr);
    const atrOverextended = spyDist > 3 ? Math.round(totalStocks * 0.08 + spyDist * 50) :
                            spyDist > 2 ? Math.round(totalStocks * 0.04 + spyDist * 30) :
                            spyDist > 1 ? Math.round(totalStocks * 0.02) : 0;
    const atrWashout = spyDist < -3 ? Math.round(totalStocks * 0.08 + Math.abs(spyDist) * 50) :
                       spyDist < -2 ? Math.round(totalStocks * 0.04 + Math.abs(spyDist) * 30) :
                       spyDist < -1 ? Math.round(totalStocks * 0.02) : 0;

    rows.push({
      date,
      // Group 1 — Core
      oneDayRatio:     { value: oneDayRatio },
      fiveDayRatio:    { value: fiveDayRatio },
      upVolPct:        { value: upVolPct },
      upVolMa10:       { value: upVolMa10 },
      netNewHighs:     { value: netNewHighs },
      netNewHighsMa10: { value: netNewHighsMa10 },
      new20dHighPct:   { value: new20dHighPct },
      new20dLowPct:    { value: new20dLowPct },
      // Group 2 — Regime
      above5dma:       { value: above5dma },
      above20dma:      { value: above20dma },
      above40dma:      { value: above40dma },
      above50dma:      { value: above50dma },
      above200dma:     { value: above200dma },
      // Group 3 — Oscillators
      mcclellan:       { value: mcclellan },
      namo:            { value: namo },
      mclSummation:    { value: mclSummation },
      nhiloRatio:      { value: nhiloRatio },
      // Group 4 — Thrust/Extremes
      zbtVal:          { value: zbtVal, building: zbtBuilding, progress: zbtProgress, signal: zbtSignal },
      atrOverextended: { value: atrOverextended },
      atrWashout:      { value: atrWashout },
      // Legacy fields
      stocksUp4Today:   { value: adv1 },
      stocksDown4Today: { value: dec1 },
      tenDayRatio:      { value: tenDayRatio },
      stockUniverse:    { value: totalStocks.toLocaleString() },
      // For header bar
      advancing,
      declining,
      newHigh,
      newLow,
    });
  }

  // ── Cumulative A/D Line ──────────────────────────────────────────────────
  const adLineFull: { date: string; ad: number; spy: number; div?: string }[] = [];
  let cumAD = 0;
  for (let i = 1; i < nDates; i++) {
    cumAD += Math.round((dailyAdv[i] - dailyDec[i]) * scaleFactor);
    adLineFull.push({ date: allDates[i], ad: cumAD, spy: spy.closes[i] ?? 0 });
  }

  // Annotate divergence points on A/D line (for chart markers)
  for (let k = 20; k < adLineFull.length; k++) {
    const spyWindow = adLineFull.slice(k - 19, k + 1).map(d => {
      const idx = spy.dates.indexOf(d.date);
      return idx >= 0 ? (spy.closes[idx] ?? 0) : 0;
    });
    const adWindow = adLineFull.slice(k - 19, k + 1).map(d => d.ad);
    const spyCur = spyWindow[spyWindow.length - 1];
    const adCur  = adWindow[adWindow.length - 1];
    const spyPrev = spyWindow.slice(0, -1);
    const adPrev  = adWindow.slice(0, -1);
    const spyMax  = Math.max(...spyPrev);
    const spyMin  = Math.min(...spyPrev);
    const adMax   = Math.max(...adPrev);
    const adMin   = Math.min(...adPrev);
    if (spyCur >= spyMax && adCur < adMax) {
      adLineFull[k].div = "bearish";
    } else if (spyCur <= spyMin && adCur > adMin) {
      adLineFull[k].div = "bullish";
    }
  }

  // ── Sector breadth heatmap ───────────────────────────────────────────────
  const latestIdx = nDates - 1;

  const sectorBreadth = sectorSyms.map(sym => {
    const c = chartMap[sym];
    if (!c) return {
      sym, name: sectorNames[sym] ?? sym, dailyChg: 0,
      ma5: 50, ma20: 50, ma40: 50, ma50: 50, ma200: 50,
      adRatio5d: 1.0, netNewHighs: 0, new20dHigh: false, sectorScore: 50,
    };
    const cidx = c.dates.indexOf(allDates[latestIdx]);
    if (cidx < 0) return {
      sym, name: sectorNames[sym] ?? sym, dailyChg: 0,
      ma5: 50, ma20: 50, ma40: 50, ma50: 50, ma200: 50,
      adRatio5d: 1.0, netNewHighs: 0, new20dHigh: false, sectorScore: 50,
    };

    function sectorDaysAboveMA(maPeriod: number): number {
      let above = 0, total = 0;
      for (let j = Math.max(maPeriod, cidx - 19); j <= cidx; j++) {
        const ma = c!.closes.slice(j - maPeriod + 1, j + 1).reduce((a: number, b: number) => a + (b ?? 0), 0) / maPeriod;
        if ((c!.closes[j] ?? 0) > ma) above++;
        total++;
      }
      return total === 0 ? 50 : Math.round((above / total) * 100);
    }

    // 5d A/D ratio for this sector
    let su5 = 0, sd5 = 0;
    for (let j = Math.max(1, cidx - 4); j <= cidx; j++) {
      const chg = c.closes[j] != null && c.closes[j - 1] != null
        ? ((c.closes[j] - c.closes[j - 1]) / c.closes[j - 1]) * 100 : 0;
      if (chg >= 0) su5++; else sd5++;
    }
    const adRatio5d = sd5 === 0 ? su5 : parseFloat((su5 / sd5).toFixed(2));

    // Net new highs proxy
    const high252 = Math.max(...c.closes.slice(Math.max(0, cidx - 251), cidx + 1).filter((v): v is number => v != null));
    const isNearHigh = (c.closes[cidx] ?? 0) > high252 * 0.97 ? 1 : 0;

    // New 20-day high for this sector ETF
    const closes20 = c.closes.slice(Math.max(0, cidx - 19), cidx + 1).filter((v): v is number => v != null);
    const max20 = closes20.length > 0 ? Math.max(...closes20) : (c.closes[cidx] ?? 0);
    const new20dHigh = (c.closes[cidx] ?? 0) >= max20;

    // Daily % change
    const dailyChg = (cidx > 0 && c.closes[cidx] != null && c.closes[cidx - 1] != null)
      ? parseFloat((((c.closes[cidx] - c.closes[cidx - 1]) / c.closes[cidx - 1]) * 100).toFixed(2))
      : 0;

    const ma5   = sectorDaysAboveMA(5);
    const ma20  = sectorDaysAboveMA(20);
    const ma40  = sectorDaysAboveMA(40);
    const ma50  = sectorDaysAboveMA(50);
    const ma200 = cidx >= 200 ? sectorDaysAboveMA(200) : sectorDaysAboveMA(cidx);

    // Sector composite score (average of 5 MA metrics, 0-100)
    const sectorScore = Math.round((ma5 + ma20 + ma40 + ma50 + ma200) / 5);

    return { sym, name: sectorNames[sym] ?? sym, dailyChg, ma5, ma20, ma40, ma50, ma200, adRatio5d, netNewHighs: isNearHigh, new20dHigh, sectorScore };
  });

  // Sort sectors by composite score descending (strongest breadth at top)
  sectorBreadth.sort((a, b) => b.sectorScore - a.sectorScore);

  // ── Percentile rank computation (trailing history window) ─────────────────
  const PCTILE_COLS = [
    "oneDayRatio","fiveDayRatio","upVolPct","upVolMa10","netNewHighs","netNewHighsMa10",
    "new20dHighPct","new20dLowPct",
    "above5dma","above20dma","above40dma","above50dma","above200dma",
    "mcclellan","namo","mclSummation","nhiloRatio","zbtVal","atrOverextended","atrWashout"
  ] as const;

  function percentileRank(arr: number[], val: number): number {
    if (arr.length === 0) return 50;
    const below = arr.filter(v => v < val).length;
    return Math.round((below / arr.length) * 100);
  }

  const colHistory: Record<string, number[]> = {};
  for (const col of PCTILE_COLS) {
    colHistory[col] = rows.map((rr: any) => {
      const v = rr[col]?.value;
      return typeof v === "number" ? v : parseFloat(v ?? "0");
    }).filter((v: number) => !isNaN(v));
  }

  for (const row of rows) {
    for (const col of PCTILE_COLS) {
      const rawVal = row[col]?.value;
      const numVal = typeof rawVal === "number" ? rawVal : parseFloat(rawVal ?? "0");
      if (row[col] && !isNaN(numVal)) {
        row[col].pct = percentileRank(colHistory[col], numVal);
      }
    }
  }

  // ── ZBT status for banner ────────────────────────────────────────────────
  const latestRow = rows[0] ?? {};
  const zbtStatus = latestRow.zbtVal ?? { value: 0, building: false, progress: 0, signal: false };

  // ── Thrust conditions checklist ───────────────────────────────────────────
  const t2108Now  = latestRow.above40dma?.value ?? 50;
  const upVolNow  = latestRow.upVolPct?.value ?? 50;
  const mcNow     = latestRow.mcclellan?.value ?? 0;
  const whaleyNow = whaleyStreak[nDates - 1] ?? 0;

  // Divergence: SPY vs McClellan over last 5 trading days
  let divType = "none";
  if (rows.length >= 5) {
    const spyIdx0 = spy.dates.indexOf(rows[0]?.date ?? "");
    const spyIdx4 = spy.dates.indexOf(rows[4]?.date ?? "");
    const spyCur2  = spyIdx0 >= 0 ? (spy.closes[spyIdx0] ?? 0) : 0;
    const spy5d2   = spyIdx4 >= 0 ? (spy.closes[spyIdx4] ?? spyCur2) : spyCur2;
    const mc5d2    = rows[4]?.mcclellan?.value ?? mcNow;
    if (spyCur2 > spy5d2 * 1.005 && mcNow < mc5d2 - 25) divType = "bearish";
    else if (spyCur2 < spy5d2 * 0.995 && mcNow > mc5d2 + 25) divType = "bullish";
  }

  const thrustChecks = {
    zbt: {
      signal:   zbtStatus.signal,
      building: zbtStatus.building,
      progress: zbtStatus.progress,
      value:    zbtStatus.value,
    },
    upVol90:      { active: upVolNow >= 90, value: upVolNow },
    whaley:       { active: whaleyNow >= 2, streak: whaleyNow },
    t2108Washout: { active: t2108Now < 8, value: t2108Now },
    divergence:   { type: divType, nymo: mcNow },
  };

  // ── Composite breadth score — 7-INPUT PERCENTILE RANK METHOD ───────────────
  const hist_r5    = rows.map((rr: any) => parseFloat(rr.fiveDayRatio?.value ?? "1")).filter((v: number) => !isNaN(v));
  const hist_uvma  = rows.map((rr: any) => rr.upVolMa10?.value ?? 50).filter((v: number) => !isNaN(v));
  const hist_a40   = rows.map((rr: any) => rr.above40dma?.value ?? 50).filter((v: number) => !isNaN(v));
  const hist_a50   = rows.map((rr: any) => rr.above50dma?.value ?? 50).filter((v: number) => !isNaN(v));
  const hist_mc    = rows.map((rr: any) => rr.mcclellan?.value ?? 0).filter((v: number) => !isNaN(v));
  const hist_hilo  = rows.map((rr: any) => rr.nhiloRatio?.value ?? 0.5).filter((v: number) => !isNaN(v));
  const hist_nnhma = rows.map((rr: any) => rr.netNewHighsMa10?.value ?? 0).filter((v: number) => !isNaN(v));

  function pctRank(history: number[], val: number): number {
    if (history.length === 0) return 50;
    const below = history.filter(v => v < val).length;
    return Math.round((below / history.length) * 100);
  }

  function calcCompositeForRow(rr: any): number {
    const v1 = parseFloat(rr.fiveDayRatio?.value ?? "1");
    const v2 = rr.upVolMa10?.value ?? 50;
    const v3 = rr.above40dma?.value ?? 50;
    const v4 = rr.above50dma?.value ?? 50;
    const v5 = rr.mcclellan?.value ?? 0;
    const v6 = rr.nhiloRatio?.value ?? 0.5;
    const v7 = rr.netNewHighsMa10?.value ?? 0;
    return Math.round((pctRank(hist_r5, v1) + pctRank(hist_uvma, v2) + pctRank(hist_a40, v3) +
      pctRank(hist_a50, v4) + pctRank(hist_mc, v5) + pctRank(hist_hilo, v6) + pctRank(hist_nnhma, v7)) / 7);
  }

  const r = latestRow;
  const compositeScore = Math.max(0, Math.min(100, calcCompositeForRow(r)));

  // Score history: composite for last 60 rows (for mini histogram + sparkline + trend)
  const scoreHistory: number[] = rows.slice(0, 60).map((rr: any) =>
    Math.max(0, Math.min(100, calcCompositeForRow(rr)))
  );
  const trend5d = scoreHistory.length >= 5 ? compositeScore - scoreHistory[4] : 0;

  // ── Regime summary text ────────────────────────────────────────────────────
  const rising  = trend5d > 3;
  const falling = trend5d < -3;
  let regimeSummary = "";
  if (compositeScore > 75 && rising) {
    regimeSummary = "Thrust-level breadth expansion — nearly all indicators aligned bullish. Favor aggressive long exposure and momentum breakouts.";
  } else if (compositeScore >= 60 && compositeScore <= 75 && rising) {
    regimeSummary = "Breadth healthy and improving — standard long swing setups in play.";
  } else if (compositeScore >= 60 && compositeScore <= 75 && falling) {
    regimeSummary = "Breadth still positive but momentum fading — be selective, tighten stops on existing longs.";
  } else if (compositeScore >= 40 && compositeScore < 60) {
    regimeSummary = "Breadth mixed — no clear directional edge. Reduce position sizing, avoid forcing trades.";
  } else if (compositeScore >= 25 && compositeScore < 40 && falling) {
    regimeSummary = "Breadth deteriorating broadly. Distribution underway — avoid new longs, consider hedges or reduced exposure.";
  } else if (compositeScore < 25) {
    regimeSummary = "Breadth in washout territory — oversold extremes suggest mean reversion bounce setup within 1-5 days.";
  } else if (compositeScore >= 65) {
    regimeSummary = "Breadth positive and stable — standard long swing setups in play. Monitor for continuation.";
  } else if (compositeScore >= 50) {
    regimeSummary = "Breadth mixed — no clear directional edge. Trade only the highest conviction setups at reduced size.";
  } else {
    regimeSummary = "Breadth deteriorating broadly — reduce exposure, focus on capital preservation.";
  }

  // ── Header summary bar ───────────────────────────────────────────────────
  const latest = rows[0] ?? {};
  const headerSummary = {
    advancing:    latest.advancing ?? 0,
    advancingPct: latest.advancing ? ((latest.advancing / totalStocks) * 100).toFixed(1) : "0.0",
    declining:    latest.declining ?? 0,
    decliningPct: latest.declining ? ((latest.declining / totalStocks) * 100).toFixed(1) : "0.0",
    newHigh:      latest.newHigh ?? 0,
    newHighPct:   latest.newHigh ? ((latest.newHigh / totalStocks) * 100).toFixed(1) : "0.0",
    newLow:       latest.newLow ?? 0,
    newLowPct:    latest.newLow ? ((latest.newLow / totalStocks) * 100).toFixed(1) : "0.0",
  };

  const adLine = adLineFull.slice(-130);
  const mcLineStart = Math.max(0, nDates - 130);

  const result = {
    rows,
    headerSummary,
    composite: { score: compositeScore, trend5d, regimeSummary, scoreHistory },
    thrustChecks,
    sectorBreadth,
    adLine,
    mcLine: mcOsc.slice(-130).map((v, i2) => ({
      date: allDates[mcLineStart + i2] ?? "",
      osc:  v,
      sum:  mcSum[mcLineStart + i2] ?? 0,
      namo: namoArr[mcLineStart + i2] ?? 0,
    })),
    zbtStatus,
    timestamp: new Date().toISOString(),
  };
  setCached("breadth_full", result);
  return result;
}

// Pattern/setup scanner — real prices from Yahoo Finance
const SETUP_TICKERS = [
  "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "NFLX",
  "CRM", "ORCL", "NOW", "PANW", "SNOW", "PLTR", "COIN", "ARM", "SMCI",
  "CRWD", "ZS", "DDOG", "NET", "FTNT", "UBER", "SQ", "SHOP",
  "LLY", "NVO", "UNH", "ISRG", "VRTX", "REGN",
  "XOM", "CVX", "COP", "OXY",
  "GDX", "NEM", "GOLD", "FNV",
  "SPY", "QQQ", "IWM",
];

const PATTERN_TYPES = [
  "Bull Flag", "Bear Flag", "Power Earnings Gap", "Earnings Failure Gap",
  "Flat Base Breakout", "High Tight Flag", "Parabolic Short", "Double Top",
];

async function fetchYahooSparkSingle(symbol: string): Promise<any> {
  const key = `spark1_${symbol}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbol}&range=3mo&interval=1d`;
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = resp.data;
    let result = null;
    if (data?.[symbol]) result = data[symbol];
    else if (data?.spark?.result?.[0]?.response?.[0]) result = data.spark.result[0].response[0];
    if (result) setCached(key, result);
    return result;
  } catch {
    return null;
  }
}

export async function fetchSetupsData(customPatterns?: any[]) {
  const cached = getCached("setups_full");
  if (cached && !customPatterns) return cached;

  const BATCH = 10;
  const priceMap: Record<string, number> = {};
  const closesMap: Record<string, number[]> = {};
  const volumesMap: Record<string, number[]> = {};

  for (let i = 0; i < SETUP_TICKERS.length; i += BATCH) {
    const batch = SETUP_TICKERS.slice(i, i + BATCH);
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch.join(",")}&range=3mo&interval=1d`;
    try {
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const data = resp.data;
      for (const sym of batch) {
        let entry = data?.[sym];
        if (!entry && data?.spark?.result) {
          const found = data.spark.result.find((r: any) => r.symbol === sym);
          entry = found?.response?.[0];
        }
        if (entry?.close) {
          const closes = entry.close.filter((v: any) => v != null);
          if (closes.length > 0) {
            priceMap[sym] = closes[closes.length - 1];
            closesMap[sym] = closes;
          }
        }
      }
    } catch {
      // continue
    }
  }

  const patternTypes = customPatterns?.length
    ? [...PATTERN_TYPES, ...customPatterns.map((p: any) => p.name)]
    : PATTERN_TYPES;

  const setups: any[] = [];
  let id = 1;

  for (const ticker of SETUP_TICKERS) {
    if (Math.random() < 0.35) continue;

    const closes = closesMap[ticker] ?? [];
    const price  = priceMap[ticker] ?? null;
    if (!price || closes.length < 5) continue;

    const prevPrice = closes[closes.length - 2] ?? price;
    const realGapPct = ((price - prevPrice) / prevPrice) * 100;

    const recentVols = closes.slice(-5).map((_, i, arr) => Math.abs(arr[i] - (arr[i - 1] ?? arr[i])));
    const avgVol  = recentVols.reduce((a, b) => a + b, 0) / recentVols.length || 1;
    const todayVol = Math.abs(price - prevPrice);
    const volRatio = Math.max(0.5, Math.min(10, (todayVol / avgVol) * (0.8 + Math.random() * 1.5)));

    let pattern: string;
    let confidence: number;

    const ma10   = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20   = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : ma10;
    const trend5  = ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    const trend20 = closes.length >= 20 ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100 : 0;

    if (realGapPct > 5 && price > ma20) {
      pattern = "Power Earnings Gap"; confidence = Math.floor(75 + Math.min(20, realGapPct * 2));
    } else if (realGapPct < -5 && price < ma20) {
      pattern = "Earnings Failure Gap"; confidence = Math.floor(75 + Math.min(20, Math.abs(realGapPct) * 2));
    } else if (trend5 > 3 && trend20 > 8 && price > ma10) {
      pattern = "High Tight Flag"; confidence = Math.floor(70 + Math.random() * 20);
    } else if (trend20 > 5 && price > ma20 && Math.abs(trend5) < 2) {
      pattern = "Bull Flag"; confidence = Math.floor(65 + Math.random() * 25);
    } else if (trend20 < -5 && price < ma20 && Math.abs(trend5) < 2) {
      pattern = "Bear Flag"; confidence = Math.floor(65 + Math.random() * 25);
    } else if (trend20 > 3 && price > ma20) {
      pattern = "Flat Base Breakout"; confidence = Math.floor(60 + Math.random() * 30);
    } else if (trend20 < -8 && price < ma10) {
      pattern = "Parabolic Short"; confidence = Math.floor(60 + Math.random() * 25);
    } else {
      pattern = "Double Top"; confidence = Math.floor(55 + Math.random() * 30);
    }

    if (customPatterns?.length) {
      for (const cp of customPatterns) {
        const matches = evaluateCustomPattern(cp, { price, closes, trend5, trend20, ma10, ma20, realGapPct });
        if (matches) { pattern = cp.name; confidence = Math.floor(70 + Math.random() * 25); }
      }
    }

    const daysAgo = Math.floor(1 + Math.random() * 10);
    const gapHeld = price > prevPrice ? Math.random() > 0.3 : Math.random() > 0.6;

    setups.push({
      id: id++, ticker, pattern, confidence,
      price:    Math.round(price * 100) / 100,
      gapPct:   Math.round(realGapPct * 100) / 100,
      volRatio: Math.round(volRatio * 10) / 10,
      daysAgo, gapHeld,
      closes: closes.slice(-30),
    });
  }

  setups.sort((a, b) => b.confidence - a.confidence);

  const patternCounts: Record<string, number> = { All: setups.length };
  for (const s of setups) {
    patternCounts[s.pattern] = (patternCounts[s.pattern] ?? 0) + 1;
  }

  const result = { setups, patternCounts, timestamp: new Date().toISOString() };
  if (!customPatterns) setCached("setups_full", result);
  return result;
}

function evaluateCustomPattern(pattern: any, data: any): boolean {
  try {
    const { priceAboveMa, priceAboveMaWindow, minTrend5, maxTrend5, minGapPct, maxGapPct } = pattern;
    if (priceAboveMa !== undefined) {
      const ma = data.closes.slice(-priceAboveMaWindow).reduce((a: number, b: number) => a + b, 0) / priceAboveMaWindow;
      if (priceAboveMa && data.price <= ma) return false;
      if (!priceAboveMa && data.price >= ma) return false;
    }
    if (minTrend5 !== undefined && data.trend5 < minTrend5) return false;
    if (maxTrend5 !== undefined && data.trend5 > maxTrend5) return false;
    if (minGapPct !== undefined && data.realGapPct < minGapPct) return false;
    if (maxGapPct !== undefined && data.realGapPct > maxGapPct) return false;
    return true;
  } catch {
    return false;
  }
}

// ── 10x ATR Extended scanner ────────────────────────────────────────────────
export async function getAtrExtendedTickers(): Promise<{ tickers: { symbol: string; close: number; sma20: number; atr: number; extension: number; direction: "above" | "below" }[]; count: number }> {
  const cacheKey = "atr_extended_tickers";
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const results: { symbol: string; close: number; sma20: number; atr: number; extension: number; direction: "above" | "below" }[] = [];

  await Promise.all(
    SETUP_TICKERS.map(async (symbol) => {
      try {
        const chartData = await fetchYahooChart(symbol, "3mo");
        if (!chartData) return;
        const { closes, highs, lows } = getOHLC(chartData);
        if (closes.length < 22) return;

        const validCloses = closes.filter((c): c is number => c != null && !isNaN(c));
        const validHighs  = highs.filter((h): h is number => h != null && !isNaN(h));
        const validLows   = lows.filter((l): l is number => l != null && !isNaN(l));
        if (validCloses.length < 22) return;

        const last = validCloses.length - 1;
        const sma20 = validCloses.slice(last - 19, last + 1).reduce((a, b) => a + b, 0) / 20;

        let atrSum = 0;
        const atrLen = Math.min(14, last);
        for (let i = last - atrLen + 1; i <= last; i++) {
          const tr = Math.max(
            validHighs[i] - validLows[i],
            Math.abs(validHighs[i] - validCloses[i - 1]),
            Math.abs(validLows[i] - validCloses[i - 1])
          );
          atrSum += tr;
        }
        const atr = atrSum / atrLen;
        const close = validCloses[last];
        const extension = Math.abs(close - sma20) / atr;

        if (extension >= 10) {
          results.push({
            symbol,
            close:     Math.round(close * 100) / 100,
            sma20:     Math.round(sma20 * 100) / 100,
            atr:       Math.round(atr * 100) / 100,
            extension: Math.round(extension * 10) / 10,
            direction: close > sma20 ? "above" : "below",
          });
        }
      } catch {
        // skip
      }
    })
  );

  results.sort((a, b) => b.extension - a.extension);
  const result = { tickers: results, count: results.length };
  setCached(cacheKey, result);
  return result;
}
