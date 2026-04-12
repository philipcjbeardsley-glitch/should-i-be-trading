import axios from "axios";
import * as ind from "./indicators";

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { data: any; ts: number }>();
function gc(key: string) { const e = cache.get(key); return e && Date.now() - e.ts < CACHE_TTL ? e.data : null; }
function sc(key: string, data: any) { cache.set(key, { data, ts: Date.now() }); }

// ── Yahoo Finance OHLCV ───────────────────────────────────────────────────────
export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; }

export async function fetchOHLCV(ticker: string, range = "10y"): Promise<Bar[]> {
  const key = `ohlcv_${ticker}_${range}`;
  const cached = gc(key); if (cached) return cached;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
    const r = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    const res = r.data?.chart?.result?.[0];
    if (!res) return [];
    const ts: number[] = res.timestamp ?? [];
    const q = res.indicators?.quote?.[0] ?? {};
    const bars: Bar[] = ts.map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? 0, high: q.high?.[i] ?? 0, low: q.low?.[i] ?? 0,
      close: q.close?.[i] ?? 0, volume: q.volume?.[i] ?? 0,
    })).filter(b => b.close > 0);
    sc(key, bars); return bars;
  } catch { return []; }
}

// ── FRED ──────────────────────────────────────────────────────────────────────
export interface FredPoint { date: string; value: number; }
async function fetchFred(series: string): Promise<FredPoint[]> {
  const key = `fred_${series}`;
  const cached = gc(key); if (cached) return cached;
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}&vintage_date=`;
    const r = await axios.get(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=DEMO_KEY&file_type=json&observation_start=2005-01-01`, { timeout: 10000 });
    const obs = r.data?.observations ?? [];
    const data: FredPoint[] = obs.filter((o: any) => o.value !== ".").map((o: any) => ({ date: o.date, value: parseFloat(o.value) }));
    sc(key, data); return data;
  } catch { return []; }
}

// ── CFTC COT ──────────────────────────────────────────────────────────────────
// Using CFTC public data API (Socrata)
export interface COTPoint { date: string; largeSpecNet: number; assetMgrNet: number; dealerNet: number; openInterest: number; }

const COT_CODES: Record<string, string> = {
  ES: "13874A", NQ: "209742", RTY: "239742", ZN: "043602", ZT: "042601",
  VI: "1170E1", BTC: "133741", CL: "067651", GC: "088691", "6E": "099741", "6J": "097741",
};

async function fetchCOT(contract: string): Promise<COTPoint[]> {
  const key = `cot_${contract}`;
  const cached = gc(key); if (cached) return cached;
  const code = COT_CODES[contract];
  if (!code) return [];
  try {
    const url = `https://publicreporting.cftc.gov/resource/jun7-fc8e.json?cftc_contract_market_code=${code}&$limit=200&$order=report_date_as_yyyy_mm_dd DESC`;
    const r = await axios.get(url, { timeout: 10000 });
    const rows = r.data ?? [];
    const data: COTPoint[] = rows.map((row: any) => ({
      date: (row.report_date_as_yyyy_mm_dd ?? "").slice(0, 10),
      largeSpecNet: (parseFloat(row.noncomm_positions_long_all ?? "0") - parseFloat(row.noncomm_positions_short_all ?? "0")),
      assetMgrNet: (parseFloat(row.asset_mgr_positions_long ?? "0") - parseFloat(row.asset_mgr_positions_short ?? "0")),
      dealerNet: (parseFloat(row.dealer_positions_long ?? "0") - parseFloat(row.dealer_positions_short ?? "0")),
      openInterest: parseFloat(row.open_interest_all ?? "0"),
    })).filter((r: COTPoint) => r.date).reverse();
    sc(key, data); return data;
  } catch { return []; }
}

// ── BREADTH ───────────────────────────────────────────────────────────────────
const SECTOR_ETFS = ["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"];

async function fetchAllSectors(): Promise<Record<string, Bar[]>> {
  const results = await Promise.all(SECTOR_ETFS.map(t => fetchOHLCV(t)));
  return Object.fromEntries(SECTOR_ETFS.map((t, i) => [t, results[i]]));
}

function alignDates(sectors: Record<string, Bar[]>): string[] {
  const sets = Object.values(sectors).map(bars => new Set(bars.map(b => b.date)));
  const common = sets.reduce((a, b) => new Set([...a].filter(d => b.has(d))));
  return [...common].sort();
}

export async function getBreadthData(indicator: string) {
  const key = `breadth_${indicator}`; const cached = gc(key); if (cached) return cached;
  const sectors = await fetchAllSectors();
  const dates = alignDates(sectors);
  const sectorBars = Object.values(sectors);

  let data: any[] = [];

  if (indicator === "pct_above_ma") {
    data = dates.map(date => {
      const closes = sectorBars.map(bars => bars.find(b => b.date === date)?.close).filter((v): v is number => v != null);
      function pctAbove(period: number) {
        return closes.map((c, si) => {
          const bars = sectorBars[si];
          const idx = bars.findIndex(b => b.date === date);
          if (idx < period) return null;
          const ma = bars.slice(idx - period + 1, idx + 1).map(b => b.close).reduce((a, b) => a + b, 0) / period;
          return c > ma ? 1 : 0;
        }).filter((v): v is number => v !== null);
      }
      const a20 = pctAbove(20); const a50 = pctAbove(50); const a200 = pctAbove(200);
      return {
        date,
        pct20: a20.length ? Math.round(a20.reduce((a,b)=>a+b,0)/a20.length*100) : null,
        pct50: a50.length ? Math.round(a50.reduce((a,b)=>a+b,0)/a50.length*100) : null,
        pct200: a200.length ? Math.round(a200.reduce((a,b)=>a+b,0)/a200.length*100) : null,
      };
    });
  }

  else if (indicator === "mcclellan") {
    // A-D ratio proxy: count sectors up vs down each day
    const adLine = dates.map((date, di) => {
      if (di === 0) return 0;
      const prevDate = dates[di - 1];
      let adv = 0, dec = 0;
      for (const bars of sectorBars) {
        const cur = bars.find(b => b.date === date)?.close;
        const prev = bars.find(b => b.date === prevDate)?.close;
        if (cur && prev) { if (cur > prev) adv++; else if (cur < prev) dec++; }
      }
      return adv - dec;
    });
    const ema19 = ind.EMA(adLine, 19);
    const ema39 = ind.EMA(adLine, 39);
    data = dates.map((date, i) => ({
      date,
      mcclellan: (ema19[i] !== null && ema39[i] !== null) ? +(ema19[i]! - ema39[i]!).toFixed(2) : null,
      adv_dec: adLine[i],
    }));
  }

  else if (indicator === "rsi_breadth") {
    data = dates.map(date => {
      let ob = 0, os = 0, total = 0;
      for (const bars of sectorBars) {
        const idx = bars.findIndex(b => b.date === date);
        if (idx < 14) continue;
        const closes = bars.slice(0, idx + 1).map(b => b.close);
        const rsiArr = ind.RSI(closes, 14);
        const rsi = rsiArr[rsiArr.length - 1];
        if (rsi === null) continue;
        total++;
        if (rsi > 70) ob++;
        if (rsi < 30) os++;
      }
      return {
        date,
        overbought: total ? Math.round(ob / total * 100) : null,
        oversold: total ? -Math.round(os / total * 100) : null,
      };
    });
  }

  else if (indicator === "macd_breadth") {
    data = dates.map(date => {
      let aboveSignal = 0, aboveZero = 0, total = 0;
      for (const bars of sectorBars) {
        const idx = bars.findIndex(b => b.date === date);
        if (idx < 35) continue;
        const closes = bars.slice(0, idx + 1).map(b => b.close);
        const macdArr = ind.MACD(closes);
        const m = macdArr[macdArr.length - 1];
        if (!m || m.macd === null) continue;
        total++;
        if (m.signal !== null && m.macd > m.signal) aboveSignal++;
        if (m.macd > 0) aboveZero++;
      }
      return {
        date,
        aboveSignal: total ? Math.round(aboveSignal / total * 100) : null,
        aboveZero: total ? Math.round(aboveZero / total * 100) : null,
      };
    });
  }

  else if (indicator === "zweig") {
    const adLine = dates.map((date, di) => {
      if (di === 0) return 0.5;
      const prevDate = dates[di - 1];
      let adv = 0, total = 0;
      for (const bars of sectorBars) {
        const cur = bars.find(b => b.date === date)?.close;
        const prev = bars.find(b => b.date === prevDate)?.close;
        if (cur && prev) { total++; if (cur > prev) adv++; }
      }
      return total > 0 ? adv / total : 0.5;
    });
    const ema10 = ind.EMA(adLine, 10);
    // Detect Zweig Breadth Thrust: rises from <0.40 to >0.615 within 10 days
    const signals: string[] = [];
    for (let i = 10; i < ema10.length; i++) {
      const cur = ema10[i];
      if (cur === null || cur <= 0.615) continue;
      for (let j = i - 10; j < i; j++) {
        if ((ema10[j] ?? 1) < 0.40) { signals.push(dates[i]); break; }
      }
    }
    data = dates.map((date, i) => ({
      date, zweig: ema10[i] !== null ? +ema10[i]!.toFixed(4) : null, signal: signals.includes(date),
    }));
  }

  else if (indicator === "ad_line") {
    let cumAD = 0;
    data = dates.map((date, di) => {
      if (di === 0) return { date, adLine: 0 };
      const prevDate = dates[di - 1];
      let adv = 0, dec = 0;
      for (const bars of sectorBars) {
        const cur = bars.find(b => b.date === date)?.close;
        const prev = bars.find(b => b.date === prevDate)?.close;
        if (cur && prev) { if (cur > prev) adv++; else if (cur < prev) dec++; }
      }
      cumAD += adv - dec;
      return { date, adLine: cumAD };
    });
  }

  sc(key, data); return data;
}

// ── MACRO ─────────────────────────────────────────────────────────────────────
export async function getMacroData(series: string): Promise<FredPoint[]> {
  return fetchFred(series);
}

export async function getLiquidityComposite() {
  const key = "liquidity_composite"; const cached = gc(key); if (cached) return cached;
  const [nfci, anfci, walcl, wresbal, rrp, tga] = await Promise.all([
    fetchFred("NFCI"), fetchFred("ANFCI"), fetchFred("WALCL"),
    fetchFred("WRESBAL"), fetchFred("RRPONTSYD"), fetchFred("WTREGEN"),
  ]);
  // Align on NFCI dates (weekly)
  const dates = nfci.map(p => p.date);
  const lookup = (arr: FredPoint[], d: string) => arr.find(p => p.date <= d)?.value ?? null;
  const raw = dates.map(date => ({
    date,
    nfci: lookup(nfci, date),
    anfci: lookup(anfci, date),
    walcl: lookup(walcl, date),
    wresbal: lookup(wresbal, date),
    rrp: lookup(rrp, date),
    tga: lookup(tga, date),
  }));
  // Normalize each series to 0-1 over trailing 3 years (156 weeks)
  function norm(arr: (number | null)[], invert: boolean, window = 156): (number | null)[] {
    return arr.map((v, i) => {
      if (v === null) return null;
      const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter((x): x is number => x !== null);
      if (slice.length < 10) return null;
      const mn = Math.min(...slice), mx = Math.max(...slice);
      if (mx === mn) return 0.5;
      const n = (v - mn) / (mx - mn);
      return invert ? 1 - n : n;
    });
  }
  const nNFCI = norm(raw.map(r => r.nfci), true);
  const nANFCI = norm(raw.map(r => r.anfci), true);
  const walclROC = raw.map((r, i) => i < 13 || raw[i - 13].walcl === null ? null : (r.walcl! - raw[i - 13].walcl!) / raw[i - 13].walcl! * 100);
  const nWALCL = norm(walclROC, false);
  const nWRES = norm(raw.map(r => r.wresbal), false);
  const nRRP = norm(raw.map(r => r.rrp), true);
  const nTGA = norm(raw.map(r => r.tga), true);

  const data = dates.map((date, i) => {
    const vals = [nNFCI[i], nANFCI[i], nWALCL[i], nWRES[i], nRRP[i], nTGA[i]].filter((v): v is number => v !== null);
    const composite = vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { date, composite: composite !== null ? +composite.toFixed(4) : null };
  }).filter(d => d.composite !== null);
  sc(key, data); return data;
}

export async function getYieldCurve() {
  const key = "yield_curve"; const cached = gc(key); if (cached) return cached;
  const [t10y2y, t10y3m] = await Promise.all([fetchFred("T10Y2Y"), fetchFred("T10Y3M")]);
  const dates = [...new Set([...t10y2y.map(p => p.date), ...t10y3m.map(p => p.date)])].sort();
  const byDate2y = Object.fromEntries(t10y2y.map(p => [p.date, p.value]));
  const by3m = Object.fromEntries(t10y3m.map(p => [p.date, p.value]));
  const data = dates.map(date => ({
    date, t10y2y: byDate2y[date] ?? null, t10y3m: by3m[date] ?? null,
  })).filter(d => d.t10y2y !== null || d.t10y3m !== null);
  sc(key, data); return data;
}

export async function getCreditSpreads() {
  const key = "credit_spreads"; const cached = gc(key); if (cached) return cached;
  const [hy, bbb] = await Promise.all([fetchFred("BAMLH0A0HYM2"), fetchFred("BAMLC0A4CBBB")]);
  const dates = [...new Set([...hy.map(p => p.date), ...bbb.map(p => p.date)])].sort();
  const byHY = Object.fromEntries(hy.map(p => [p.date, p.value]));
  const byBBB = Object.fromEntries(bbb.map(p => [p.date, p.value]));
  const data = dates.map(date => ({ date, hy: byHY[date] ?? null, bbb: byBBB[date] ?? null }))
    .filter(d => d.hy !== null || d.bbb !== null);
  sc(key, data); return data;
}

export async function getFedBalanceSheet() {
  return fetchFred("WALCL");
}

export async function getSectorRotation() {
  const key = "sector_rotation"; const cached = gc(key); if (cached) return cached;
  const [spy, ...sectorData] = await Promise.all([fetchOHLCV("SPY"), ...SECTOR_ETFS.map(t => fetchOHLCV(t))]);
  const sectors: Record<string, Bar[]> = Object.fromEntries(SECTOR_ETFS.map((t, i) => [t, sectorData[i]]));
  // For each sector compute last 4 weeks of (RS vs SPY, RS momentum) for the trail
  const today = spy[spy.length - 1]?.date ?? "";
  const result = SECTOR_ETFS.map(ticker => {
    const bars = sectors[ticker];
    const trail = [];
    for (let w = 3; w >= 0; w--) {
      const endIdx = bars.length - 1 - w * 5;
      if (endIdx < 21) continue;
      const endDate = bars[endIdx]?.date;
      const spyBar = spy.find(b => b.date === endDate);
      if (!spyBar) continue;
      const c = bars[endIdx].close;
      const c21 = bars[endIdx - 21]?.close;
      const spyC = spyBar.close;
      const spyC21 = spy[spy.findIndex(b => b.date === endDate) - 21]?.close;
      if (!c21 || !spyC21) continue;
      const rs1m = (c / c21 - 1) * 100 - (spyC / spyC21 - 1) * 100;
      const prevRS = w < 3 ? trail[trail.length - 1]?.rs1m : null;
      const momentum = prevRS !== null ? rs1m - prevRS : 0;
      trail.push({ date: endDate, rs1m: +rs1m.toFixed(2), momentum: +momentum.toFixed(2) });
    }
    const latest = trail[trail.length - 1] ?? { rs1m: 0, momentum: 0 };
    return { ticker, rs: latest.rs1m, momentum: latest.momentum, trail };
  });
  sc(key, result); return result;
}

export async function getRatioData(ticker: string, benchmark: string) {
  const key = `ratio_${ticker}_${benchmark}`; const cached = gc(key); if (cached) return cached;
  const [a, b] = await Promise.all([fetchOHLCV(ticker), fetchOHLCV(benchmark)]);
  const bMap = Object.fromEntries(b.map(bar => [bar.date, bar.close]));
  const data = a.filter(bar => bMap[bar.date]).map(bar => ({
    date: bar.date, ratio: +(bar.close / bMap[bar.date]!).toFixed(6),
  }));
  sc(key, data); return data;
}

export async function getCOTData(contract: string) { return fetchCOT(contract); }

export async function getCTAModel() {
  const key = "cta_model"; const cached = gc(key); if (cached) return cached;
  const spy = await fetchOHLCV("SPY");
  const closes = spy.map(b => b.close);
  const data = spy.map((b, i) => {
    if (i < 252) return { date: b.date, score: null };
    const r1m = (closes[i] / closes[i - 21] - 1) * 100;
    const r3m = (closes[i] / closes[i - 63] - 1) * 100;
    const r6m = (closes[i] / closes[i - 126] - 1) * 100;
    const r12m = (closes[i] / closes[i - 252] - 1) * 100;
    const raw = (r1m + r3m + r6m + r12m) / 4;
    // Normalize to -100..+100 using trailing 252-day range
    const slice: number[] = [];
    for (let j = i - 252; j <= i; j++) {
      if (j < 252) continue;
      const rr = ((closes[j] / closes[j - 21] - 1) + (closes[j] / closes[j - 63] - 1) +
                  (closes[j] / closes[j - 126] - 1) + (closes[j] / closes[j - 252] - 1)) / 4 * 100;
      slice.push(rr);
    }
    if (!slice.length) return { date: b.date, score: null };
    const mn = Math.min(...slice), mx = Math.max(...slice);
    const score = mx === mn ? 0 : ((raw * 100 - mn) / (mx - mn)) * 200 - 100;
    return { date: b.date, score: +score.toFixed(1) };
  }).filter(d => d.score !== null);
  sc(key, data); return data;
}

export async function getTrendPower(ticker: string) {
  const bars = await fetchOHLCV(ticker);
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low), closes = bars.map(b => b.close);
  const tpo = ind.TrendPowerOscillator(highs, lows, closes, 20, 10);
  return bars.map((b, i) => ({ date: b.date, value: tpo[i] !== null ? +tpo[i]!.toFixed(2) : null }));
}

export async function getDSI(ticker: string) {
  const bars = await fetchOHLCV(ticker);
  const closes = bars.map(b => b.close);
  return bars.map((b, i) => {
    if (i < 14) return { date: b.date, value: null };
    const slice = closes.slice(i - 13, i + 1);
    let upDays = 0, upMag = 0, total = 0;
    for (let j = 1; j < slice.length; j++) {
      const chg = Math.abs(slice[j] - slice[j - 1]);
      total += chg;
      if (slice[j] > slice[j - 1]) { upDays++; upMag += chg; }
    }
    const pctUp = upDays / 14;
    const avgUpMag = upDays > 0 ? upMag / upDays : 0;
    const avgMag = total / 14;
    const raw = avgMag > 0 ? pctUp * (avgUpMag / avgMag) : 0.5;
    return { date: b.date, value: +(raw * 100).toFixed(1) };
  });
}

export async function getATRExtension(ticker: string) {
  const bars = await fetchOHLCV(ticker);
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low), closes = bars.map(b => b.close);
  const atr14 = ind.ATR(highs, lows, closes, 14);
  const sma50 = ind.SMA(closes, 50);
  return bars.map((b, i) => {
    if (atr14[i] === null || sma50[i] === null || atr14[i] === 0) return { date: b.date, value: null };
    return { date: b.date, value: +((b.close - sma50[i]!) / atr14[i]!).toFixed(2) };
  });
}

export { fetchOHLCV as getPriceData, getCOTData as getCOT };
