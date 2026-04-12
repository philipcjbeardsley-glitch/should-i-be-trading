/**
 * chartData.ts — Chart Engine data layer
 * All FRED calls use real API key. All Yahoo Finance OHLCV via yfinance-style URL.
 * McClellan / breadth computed from sector ETF A-D proxies (best free approach).
 */
import axios from "axios";

const FRED_KEY = "9c1ea0c6ace2cad8f356ff321919313c";

// ── Simple in-memory cache ────────────────────────────────────────────────────
const _cache: Record<string, { ts: number; data: any }> = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 min
function gc(k: string) { const c = _cache[k]; return c && Date.now() - c.ts < CACHE_TTL ? c.data : null; }
function sc(k: string, d: any) { _cache[k] = { ts: Date.now(), data: d }; }

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; }
interface COTPoint { date: string; largeSpecNet: number; assetMgrNet: number; dealerNet: number; openInterest: number; }

// ── Yahoo Finance OHLCV ───────────────────────────────────────────────────────
export async function fetchOHLCV(ticker: string, range = "10y"): Promise<Bar[]> {
  const key = `ohlcv_${ticker}_${range}`;
  const cached = gc(key); if (cached) return cached;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
    const r = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    const res = r.data?.chart?.result?.[0];
    if (!res) return [];
    const ts: number[] = res.timestamps ?? res.timestamp ?? [];
    const q = res.indicators?.quote?.[0] ?? {};
    const bars: Bar[] = ts.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close: q.close?.[i] ?? null,
      volume: q.volume?.[i] ?? 0,
    })).filter(b => b.close != null && b.date);
    sc(key, bars); return bars;
  } catch { return []; }
}

// ── FRED single series ────────────────────────────────────────────────────────
async function fetchFRED(seriesId: string, limit = 2000): Promise<{ date: string; value: number }[]> {
  const key = `fred_${seriesId}`;
  const cached = gc(key); if (cached) return cached;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&limit=${limit}&sort_order=asc`;
    const r = await axios.get(url, { timeout: 15000 });
    const obs = r.data?.observations ?? [];
    const data = obs
      .filter((o: any) => o.value !== "." && o.value !== "")
      .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }))
      .filter((o: any) => !isNaN(o.value));
    sc(key, data); return data;
  } catch { return []; }
}

// ── COT ───────────────────────────────────────────────────────────────────────
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
    const r = await axios.get(url, { timeout: 12000 });
    const rows = r.data ?? [];
    const data: COTPoint[] = rows.map((row: any) => ({
      date: (row.report_date_as_yyyy_mm_dd ?? "").slice(0, 10),
      largeSpecNet: parseFloat(row.noncomm_positions_long_all ?? "0") - parseFloat(row.noncomm_positions_short_all ?? "0"),
      assetMgrNet: parseFloat(row.asset_mgr_positions_long ?? "0") - parseFloat(row.asset_mgr_positions_short ?? "0"),
      dealerNet: parseFloat(row.dealer_positions_long ?? "0") - parseFloat(row.dealer_positions_short ?? "0"),
      openInterest: parseFloat(row.open_interest_all ?? "0"),
    })).filter((r: COTPoint) => r.date).reverse();
    sc(key, data); return data;
  } catch { return []; }
}

export async function getCOTData(contract: string) { return fetchCOT(contract); }

// ── Breadth — computed from 11 SPDR sector ETFs ───────────────────────────────
// Best free approach: compute breadth indicators across 11 sector ETFs
const SECTOR_ETFS = ["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"];

async function fetchAllSectors(): Promise<Record<string, Bar[]>> {
  const results = await Promise.all(SECTOR_ETFS.map(t => fetchOHLCV(t)));
  return Object.fromEntries(SECTOR_ETFS.map((t, i) => [t, results[i]]));
}

function getAlignedDates(sectors: Record<string, Bar[]>): string[] {
  // Use union of all dates, sorted
  const allDates = new Set<string>();
  Object.values(sectors).forEach(bars => bars.forEach(b => allDates.add(b.date)));
  return [...allDates].sort();
}

function getClose(bars: Bar[], date: string): number | null {
  return bars.find(b => b.date === date)?.close ?? null;
}

function sma(arr: number[], period: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    const slice = arr.slice(i - period + 1, i + 1);
    if (slice.some(v => v == null || isNaN(v))) return null;
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function ema(arr: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(arr.length).fill(null);
  let started = false;
  let prev = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null || isNaN(arr[i])) continue;
    if (!started) {
      if (i >= period - 1) {
        const slice = arr.slice(i - period + 1, i + 1).filter(v => v != null) as number[];
        if (slice.length === period) {
          prev = slice.reduce((a, b) => a + b, 0) / period;
          out[i] = prev;
          started = true;
        }
      }
    } else {
      prev = arr[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function calcMACD(closes: number[]): { macd: (number|null)[]; signal: (number|null)[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => {
    if (ema12[i] == null || ema26[i] == null) return null;
    return (ema12[i] as number) - (ema26[i] as number);
  });
  const macdVals = macdLine.map(v => v ?? NaN);
  const signalLine = ema(macdVals, 9);
  return { macd: macdLine, signal: signalLine };
}

export async function getBreadthData(indicator: string) {
  const key = `breadth_${indicator}`; const cached = gc(key); if (cached) return cached;
  const sectors = await fetchAllSectors();
  const dates = getAlignedDates(sectors);
  const sectorBars = Object.values(sectors);
  const n = sectorBars.length;

  let data: any[] = [];

  if (indicator === "pct_above_ma") {
    data = dates.map(date => {
      const closes = sectorBars.map(bars => getClose(bars, date)).filter((v): v is number => v != null);
      if (closes.length < 5) return null;

      let above20 = 0, above50 = 0, above200 = 0;
      sectorBars.forEach(bars => {
        const idx = bars.findIndex(b => b.date === date);
        if (idx < 0) return;
        const c = bars[idx].close;
        const closes20 = bars.slice(Math.max(0, idx - 19), idx + 1).map(b => b.close);
        const closes50 = bars.slice(Math.max(0, idx - 49), idx + 1).map(b => b.close);
        const closes200 = bars.slice(Math.max(0, idx - 199), idx + 1).map(b => b.close);
        const m20 = closes20.length >= 20 ? closes20.reduce((a,b)=>a+b,0)/closes20.length : null;
        const m50 = closes50.length >= 50 ? closes50.reduce((a,b)=>a+b,0)/closes50.length : null;
        const m200 = closes200.length >= 200 ? closes200.reduce((a,b)=>a+b,0)/closes200.length : null;
        if (m20 && c > m20) above20++;
        if (m50 && c > m50) above50++;
        if (m200 && c > m200) above200++;
      });
      return { date, pct20: Math.round(above20/n*100), pct50: Math.round(above50/n*100), pct200: Math.round(above200/n*100) };
    }).filter(Boolean);

  } else if (indicator === "mcclellan") {
    // McClellan using advancing/declining sectors as proxy
    // Advance = sectors up on day, Decline = sectors down on day
    const advDecRatios: number[] = [];
    const mcclellanDates: string[] = [];

    for (let di = 1; di < dates.length; di++) {
      const date = dates[di];
      const prev = dates[di - 1];
      let adv = 0, dec = 0;
      sectorBars.forEach(bars => {
        const c = getClose(bars, date);
        const p = getClose(bars, prev);
        if (c != null && p != null) {
          if (c > p) adv++; else if (c < p) dec++;
        }
      });
      const total = adv + dec;
      advDecRatios.push(total > 0 ? (adv - dec) / total : 0);
      mcclellanDates.push(date);
    }

    const ema19 = ema(advDecRatios, 19);
    const ema39 = ema(advDecRatios, 39);

    data = mcclellanDates.map((date, i) => {
      const val = (ema19[i] != null && ema39[i] != null)
        ? ((ema19[i] as number) - (ema39[i] as number)) * 100
        : null;
      return { date, value: val != null ? parseFloat(val.toFixed(3)) : null };
    }).filter(d => d.value != null);

  } else if (indicator === "rsi_breadth") {
    // For each date: median RSI across all sectors, + pct overbought (>70) / oversold (<30)
    const sectorRSIs: (number|null)[][] = sectorBars.map(bars => {
      const closes = bars.map(b => b.close);
      return calcRSI(closes, 14);
    });

    data = dates.map((date, di) => {
      const rsis: number[] = [];
      sectorBars.forEach((bars, si) => {
        const barIdx = bars.findIndex(b => b.date === date);
        if (barIdx >= 0 && sectorRSIs[si][barIdx] != null) {
          rsis.push(sectorRSIs[si][barIdx] as number);
        }
      });
      if (rsis.length < 5) return null;
      rsis.sort((a, b) => a - b);
      const median = rsis[Math.floor(rsis.length / 2)];
      const overbought = Math.round(rsis.filter(r => r > 70).length / rsis.length * 100);
      const oversold = Math.round(rsis.filter(r => r < 30).length / rsis.length * 100);
      return { date, value: parseFloat(median.toFixed(2)), overbought, oversold };
    }).filter(Boolean);

  } else if (indicator === "macd_breadth") {
    const sectorMACDs: { macd: (number|null)[]; signal: (number|null)[] }[] = sectorBars.map(bars => {
      return calcMACD(bars.map(b => b.close));
    });

    data = dates.map((date, di) => {
      let bullish = 0, total = 0;
      sectorBars.forEach((bars, si) => {
        const barIdx = bars.findIndex(b => b.date === date);
        if (barIdx >= 0) {
          const m = sectorMACDs[si].macd[barIdx];
          const s = sectorMACDs[si].signal[barIdx];
          if (m != null && s != null) { total++; if (m > s) bullish++; }
        }
      });
      if (total < 5) return null;
      return { date, value: parseFloat((bullish / total * 100).toFixed(1)), pctBullish: Math.round(bullish/total*100) };
    }).filter(Boolean);

  } else if (indicator === "zweig") {
    // Zweig Breadth Thrust: 10-day EMA of (Adv / (Adv+Dec)) ratio
    // Thrust signal when crosses from <0.40 to >0.615 within 10 days
    const advRatios: number[] = [];
    const zwDates: string[] = [];

    for (let di = 1; di < dates.length; di++) {
      const date = dates[di];
      const prev = dates[di - 1];
      let adv = 0, total = 0;
      sectorBars.forEach(bars => {
        const c = getClose(bars, date);
        const p = getClose(bars, prev);
        if (c != null && p != null) { total++; if (c > p) adv++; }
      });
      advRatios.push(total > 0 ? adv / total : 0.5);
      zwDates.push(date);
    }

    const ema10 = ema(advRatios, 10);
    data = zwDates.map((date, i) => ({
      date,
      value: ema10[i] != null ? parseFloat((ema10[i] as number).toFixed(4)) : null,
    })).filter(d => d.value != null);

  } else if (indicator === "ad_line") {
    // Cumulative A-D line
    let cumulative = 0;
    const adDates: string[] = [];
    const adValues: number[] = [];

    for (let di = 1; di < dates.length; di++) {
      const date = dates[di];
      const prev = dates[di - 1];
      let adv = 0, dec = 0;
      sectorBars.forEach(bars => {
        const c = getClose(bars, date);
        const p = getClose(bars, prev);
        if (c != null && p != null) { if (c > p) adv++; else if (c < p) dec++; }
      });
      cumulative += (adv - dec);
      adDates.push(date);
      adValues.push(cumulative);
    }
    data = adDates.map((date, i) => ({ date, value: adValues[i] }));
  }

  sc(key, data); return data;
}

// ── FRED macro series ─────────────────────────────────────────────────────────
export async function getMacroData(series: string) {
  return fetchFRED(series);
}

// ── Liquidity Composite ───────────────────────────────────────────────────────
// Components: Fed Balance Sheet (WALCL), M2 (M2SL), RRP (RRPONTSYD),
//             Bank Reserves (WRESBAL), TGA (WDTGAL), HY Spreads inverted (BAMLH0A0HYM2)
export async function getLiquidityComposite() {
  const key = "liquidity_composite"; const cached = gc(key); if (cached) return cached;
  try {
    const [walcl, m2, rrp, reserves, tga, hy] = await Promise.all([
      fetchFRED("WALCL"),       // Fed assets $M
      fetchFRED("M2SL"),        // M2 $B
      fetchFRED("RRPONTSYD"),   // RRP overnight $B
      fetchFRED("WRESBAL"),     // Bank reserves $M
      fetchFRED("WDTGAL"),      // TGA $M
      fetchFRED("BAMLH0A0HYM2"),// HY OAS %
    ]);

    // Align to weekly dates from WALCL
    function normalize(arr: { date: string; value: number }[]): Map<string, number> {
      if (!arr.length) return new Map();
      const min = Math.min(...arr.map(d => d.value));
      const max = Math.max(...arr.map(d => d.value));
      const range = max - min || 1;
      return new Map(arr.map(d => [d.date, (d.value - min) / range]));
    }

    const nWalcl = normalize(walcl);
    const nM2 = normalize(m2);
    const nRrp = normalize(rrp);
    const nRes = normalize(reserves);
    const nTga = normalize(tga);
    const nHy = normalize(hy); // inverted for liquidity

    // Fill forward for lower-frequency series
    function fillForward(map: Map<string, number>, dates: string[]): Map<string, number> {
      let last = 0;
      const out = new Map<string, number>();
      for (const d of dates) {
        if (map.has(d)) last = map.get(d)!;
        out.set(d, last);
      }
      return out;
    }

    const allDates = [...new Set([...walcl, ...reserves].map(d => d.date))].sort();
    const ffM2 = fillForward(nM2, allDates);
    const ffRrp = fillForward(nRrp, allDates);
    const ffTga = fillForward(nTga, allDates);
    const ffHy = fillForward(nHy, allDates);

    const data = allDates.map(date => {
      const w = nWalcl.get(date);
      const m = ffM2.get(date) ?? 0;
      const r = ffRrp.get(date) ?? 0;
      const res = nRes.get(date);
      const t = ffTga.get(date) ?? 0;
      const h = ffHy.get(date) ?? 0;
      if (w == null && res == null) return null;
      // Fed BS + M2 + Reserves - RRP - TGA - HY_spread (higher spreads = less liquidity)
      const composite = ((w ?? 0) + m + (res ?? 0) - r * 0.5 - t * 0.3 - h * 0.5) / 3;
      return {
        date,
        composite: parseFloat(composite.toFixed(4)),
        fedBS: w != null ? parseFloat(w.toFixed(4)) : null,
        m2: parseFloat(m.toFixed(4)),
        rrp: parseFloat(r.toFixed(4)),
        reserves: res != null ? parseFloat(res.toFixed(4)) : null,
      };
    }).filter(Boolean);

    sc(key, data); return data;
  } catch { return []; }
}

// ── Yield Curve ───────────────────────────────────────────────────────────────
export async function getYieldCurve() {
  const key = "yield_curve"; const cached = gc(key); if (cached) return cached;
  try {
    const [t10y2y, t10y3m] = await Promise.all([
      fetchFRED("T10Y2Y"),
      fetchFRED("T10Y3M"),
    ]);
    const map10y3m = new Map(t10y3m.map(d => [d.date, d.value]));
    const data = t10y2y.map(d => ({
      date: d.date,
      t10y2y: d.value,
      t10y3m: map10y3m.get(d.date) ?? null,
    }));
    sc(key, data); return data;
  } catch { return []; }
}

// ── Credit Spreads ────────────────────────────────────────────────────────────
export async function getCreditSpreads() {
  const key = "credit_spreads"; const cached = gc(key); if (cached) return cached;
  try {
    const [hy, bbb] = await Promise.all([
      fetchFRED("BAMLH0A0HYM2"),    // ICE BofA HY OAS
      fetchFRED("BAMLC0A4CBBB"),    // ICE BofA BBB OAS
    ]);
    const mapBBB = new Map(bbb.map(d => [d.date, d.value]));
    const data = hy.map(d => ({
      date: d.date,
      hyOAS: d.value,
      bbbOAS: mapBBB.get(d.date) ?? null,
    }));
    sc(key, data); return data;
  } catch { return []; }
}

// ── Fed Balance Sheet vs SPY ──────────────────────────────────────────────────
export async function getFedBalanceSheet() {
  const key = "fed_bs"; const cached = gc(key); if (cached) return cached;
  try {
    const [fedBS, spy] = await Promise.all([
      fetchFRED("WALCL"),
      fetchOHLCV("SPY"),
    ]);
    const spyMap = new Map(spy.map(b => [b.date, b.close]));

    // Fill SPY forward for weekly WALCL dates
    let lastSPY = 0;
    const allSpyDates = spy.map(b => b.date).sort();

    const data = fedBS.map(d => {
      // Find closest SPY price on or before this date
      const spyClose = spyMap.get(d.date) ??
        spy.filter(b => b.date <= d.date).slice(-1)[0]?.close ?? null;
      if (spyClose) lastSPY = spyClose;
      return {
        date: d.date,
        fedBS: parseFloat((d.value / 1000).toFixed(1)), // convert to $B
        spyClose: spyClose ?? lastSPY,
      };
    });
    sc(key, data); return data;
  } catch { return []; }
}

// ── Sector Rotation (RS × Momentum scatter) ───────────────────────────────────
export async function getSectorRotation() {
  const key = "sector_rotation"; const cached = gc(key); if (cached) return cached;
  try {
    const spyBars = await fetchOHLCV("SPY");
    const sectorData = await Promise.all(SECTOR_ETFS.map(async t => {
      const bars = await fetchOHLCV(t);
      return { ticker: t, bars };
    }));

    const result = sectorData.map(({ ticker, bars }) => {
      if (bars.length < 65) return null;
      const recent = bars.slice(-65);
      const spy = spyBars.slice(-65);

      // RS: 20-day performance relative to SPY
      const secPerf20 = (recent.slice(-1)[0].close - recent.slice(-21)[0].close) / recent.slice(-21)[0].close * 100;
      const spyPerf20 = spy.length >= 21 ? (spy.slice(-1)[0].close - spy.slice(-21)[0].close) / spy.slice(-21)[0].close * 100 : 0;
      const rs = parseFloat((secPerf20 - spyPerf20).toFixed(2));

      // Momentum: rate of change of RS over last 4 weeks
      const secPerf5 = (recent.slice(-1)[0].close - recent.slice(-6)[0].close) / recent.slice(-6)[0].close * 100;
      const spyPerf5 = spy.length >= 6 ? (spy.slice(-1)[0].close - spy.slice(-6)[0].close) / spy.slice(-6)[0].close * 100 : 0;
      const momentum = parseFloat((secPerf5 - spyPerf5).toFixed(2));

      return { symbol: ticker, rs, momentum };
    }).filter(Boolean);

    sc(key, result); return result;
  } catch { return []; }
}

// ── Ratio chart (ticker / benchmark) ─────────────────────────────────────────
export async function getRatioData(ticker: string, benchmark: string) {
  const key = `ratio_${ticker}_${benchmark}`; const cached = gc(key); if (cached) return cached;
  try {
    const [a, b] = await Promise.all([fetchOHLCV(ticker), fetchOHLCV(benchmark)]);
    const bMap = new Map(b.map(bar => [bar.date, bar.close]));
    const data = a
      .filter(bar => bMap.has(bar.date) && bMap.get(bar.date)! > 0)
      .map(bar => ({ date: bar.date, value: parseFloat((bar.close / bMap.get(bar.date)!).toFixed(6)) }));
    sc(key, data); return data;
  } catch { return []; }
}

// ── CTA Positioning Model ─────────────────────────────────────────────────────
// Derived from SPY trend-following signals: position = f(SMA crossovers, momentum z-score)
export async function getCTAModel() {
  const key = "cta_model"; const cached = gc(key); if (cached) return cached;
  try {
    const bars = await fetchOHLCV("SPY");
    if (bars.length < 200) return [];
    const closes = bars.map(b => b.close);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const sma20 = sma(closes, 20);

    // Rolling 63-day z-score of returns
    const returns = closes.map((c, i) => i > 0 ? (c - closes[i-1]) / closes[i-1] : 0);

    const data = bars.map((b, i) => {
      if (sma50[i] == null || sma200[i] == null || sma20[i] == null || i < 63) return null;
      // Score: SMA trend alignment + momentum
      const trendScore = (closes[i] > (sma50[i] as number) ? 0.33 : -0.33)
        + ((sma50[i] as number) > (sma200[i] as number) ? 0.33 : -0.33)
        + (closes[i] > (sma20[i] as number) ? 0.33 : -0.33);

      // 63-day return z-score
      const window = returns.slice(i - 62, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const std = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length) || 0.0001;
      const zScore = (returns[i] - mean) / std;

      const score = parseFloat(((trendScore * 0.7 + Math.max(-1, Math.min(1, zScore * 0.3))) * 100).toFixed(2));
      return { date: b.date, value: score, zScore: parseFloat(zScore.toFixed(3)) };
    }).filter(Boolean);

    sc(key, data); return data;
  } catch { return []; }
}

// ── Trend Power Oscillator ────────────────────────────────────────────────────
// From macrocharts: composite of trend strength + momentum
export async function getTrendPower(ticker: string) {
  const key = `tpo_${ticker}`; const cached = gc(key); if (cached) return cached;
  try {
    const bars = await fetchOHLCV(ticker);
    if (bars.length < 50) return [];
    const closes = bars.map(b => b.close);
    const rsi14 = calcRSI(closes, 14);
    const sma20arr = sma(closes, 20);
    const sma50arr = sma(closes, 50);

    // TPO = RSI z-score × trend direction composite
    const rsiVals = rsi14.filter(v => v != null) as number[];
    const rsiMean = rsiVals.length ? rsiVals.reduce((a, b) => a + b, 0) / rsiVals.length : 50;
    const rsiStd = rsiVals.length ? Math.sqrt(rsiVals.reduce((a, b) => a + (b - rsiMean) ** 2, 0) / rsiVals.length) : 10;

    const data = bars.map((b, i) => {
      if (rsi14[i] == null || sma20arr[i] == null || sma50arr[i] == null) return null;
      const rsiZ = ((rsi14[i] as number) - rsiMean) / (rsiStd || 1);
      const trend = (closes[i] > (sma20arr[i] as number) ? 0.5 : -0.5)
        + ((sma20arr[i] as number) > (sma50arr[i] as number) ? 0.5 : -0.5);
      const tpo = parseFloat((rsiZ * 0.6 + trend * 0.4).toFixed(4));
      return { date: b.date, value: tpo };
    }).filter(Boolean);

    sc(key, data); return data;
  } catch { return []; }
}

// ── DSI Proxy (Daily Sentiment Index) ─────────────────────────────────────────
// DSI is proprietary (Trade-Futures.com). Best free proxy:
// Short-term RSI mapped 0-100 with mean-reversion characteristics
export async function getDSI(ticker: string) {
  const key = `dsi_${ticker}`; const cached = gc(key); if (cached) return cached;
  try {
    const bars = await fetchOHLCV(ticker);
    if (bars.length < 20) return [];
    const closes = bars.map(b => b.close);

    // DSI proxy: 5-day RSI smoothed with 3-day EMA, mapped to 0-100
    const rsi5 = calcRSI(closes, 5);
    const rsi5vals = rsi5.map(v => v ?? NaN);
    const smoothed = ema(rsi5vals, 3);

    const data = bars.map((b, i) => {
      if (smoothed[i] == null || isNaN(smoothed[i] as number)) return null;
      return { date: b.date, value: parseFloat((smoothed[i] as number).toFixed(2)) };
    }).filter(Boolean);

    sc(key, data); return data;
  } catch { return []; }
}

// ── ATR Extension ─────────────────────────────────────────────────────────────
export async function getATRExtension(ticker: string) {
  const key = `atr_ext_${ticker}`; const cached = gc(key); if (cached) return cached;
  try {
    const bars = await fetchOHLCV(ticker);
    if (bars.length < 20) return [];
    const period = 14;

    // True Range
    const tr = bars.map((b, i) => {
      if (i === 0) return b.high - b.low;
      const prev = bars[i - 1].close;
      return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
    });

    // ATR (Wilder smoothing)
    const atr: (number | null)[] = new Array(bars.length).fill(null);
    let atrVal = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    atr[period - 1] = atrVal;
    for (let i = period; i < bars.length; i++) {
      atrVal = (atrVal * (period - 1) + tr[i]) / period;
      atr[i] = atrVal;
    }

    // SMA20 as baseline
    const sma20arr = sma(bars.map(b => b.close), 20);

    const data = bars.map((b, i) => {
      if (atr[i] == null || sma20arr[i] == null) return null;
      const pctExtension = (b.close - (sma20arr[i] as number)) / (atr[i] as number);
      return {
        date: b.date,
        value: parseFloat(pctExtension.toFixed(3)),
        pctExtension: parseFloat(pctExtension.toFixed(3)),
        atr: parseFloat((atr[i] as number).toFixed(4)),
        sma20: parseFloat((sma20arr[i] as number).toFixed(2)),
      };
    }).filter(Boolean);

    sc(key, data); return data;
  } catch { return []; }
}

// ── SPY Volume ────────────────────────────────────────────────────────────────
export async function getSPYVolume() {
  const key = "spy_volume"; const cached = gc(key); if (cached) return cached;
  try {
    const bars = await fetchOHLCV("SPY");
    // Compute 20-day average volume for reference line
    const vols = bars.map(b => b.volume);
    const avgVol = sma(vols, 20);
    const data = bars.map((b, i) => ({
      date: b.date,
      volume: b.volume,
      close: b.close,
      avgVol20: avgVol[i],
    }));
    sc(key, data); return data;
  } catch { return []; }
}

// ── Speculative Options Volume (UVXY/SVXY ratio as fear proxy) ────────────────
export async function getSpeculativeVolume() {
  const key = "spec_vol"; const cached = gc(key); if (cached) return cached;
  try {
    // Use VIX vs its 20d SMA as a cleaner fear/greed proxy
    // VIXCLS from FRED is daily
    const [vixFred, spy] = await Promise.all([
      fetchFRED("VIXCLS"),
      fetchOHLCV("SPY"),
    ]);
    const spyMap = new Map(spy.map(b => [b.date, b.close]));
    const vixVals = vixFred.map(d => d.value);
    const vixSMA20 = sma(vixVals, 20);
    const data = vixFred.map((d, i) => ({
      date: d.date,
      value: parseFloat(d.value.toFixed(2)),
      vixSMA20: vixSMA20[i] != null ? parseFloat((vixSMA20[i] as number).toFixed(2)) : null,
      spyClose: spyMap.get(d.date) ?? null,
    })).filter(d => d.spyClose != null);
    sc(key, data); return data;
  } catch { return []; }
}

// ── AAII Sentiment (via manual CSV parsing) ───────────────────────────────────
// AAII blocks direct downloads; use FRED proxy: no AAII series there.
// Best free: scrape their public weekly data page or use static fallback.
// We'll compute a synthetic fear/greed from: VIX percentile + CTA score + credit spreads
export async function getMarketSentimentComposite() {
  const key = "sentiment_composite"; const cached = gc(key); if (cached) return cached;
  try {
    const [vix, hy, spy] = await Promise.all([
      fetchFRED("VIXCLS"),
      fetchFRED("BAMLH0A0HYM2"),
      fetchOHLCV("SPY"),
    ]);

    // Rolling percentile rank of VIX (252-day window)
    const vixRank = vix.map((d, i) => {
      const window = vix.slice(Math.max(0, i - 251), i + 1).map(x => x.value);
      const rank = window.filter(v => v <= d.value).length / window.length;
      return rank;
    });

    const hyMap = new Map(hy.map(d => [d.date, d.value]));
    const spyMap = new Map(spy.map(b => [b.date, b.close]));

    const data = vix.map((d, i) => {
      const vixPct = vixRank[i]; // high = fearful
      const hyCurrent = hyMap.get(d.date) ?? 4;
      const hyPct = hy.filter(h => h.value <= hyCurrent).length / hy.length;
      // Sentiment = inverted fear: low VIX + low spreads = high sentiment
      const sentScore = parseFloat(((1 - vixPct * 0.6 - hyPct * 0.4) * 100).toFixed(1));
      return {
        date: d.date,
        value: sentScore,
        vix: d.value,
        spyClose: spyMap.get(d.date) ?? null,
      };
    }).filter(d => d.spyClose != null);

    sc(key, data); return data;
  } catch { return []; }
}
