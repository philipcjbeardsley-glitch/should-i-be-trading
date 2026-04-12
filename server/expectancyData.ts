import axios from "axios";

const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { data: any; timestamp: number }>();
function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.timestamp < CACHE_TTL) return e.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ── OHLCV fetcher ─────────────────────────────────────────────────────────────
export async function fetchHistory(ticker: string): Promise<{
  dates: string[]; opens: number[]; highs: number[];
  lows: number[]; closes: number[]; volumes: number[];
} | null> {
  const key = `hist_${ticker.toUpperCase()}`;
  const cached = getCached(key);
  if (cached) return cached;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}?range=10y&interval=1d`;
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    const result = resp.data?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const dates = ts.map((t) => {
      const d = new Date(t * 1000);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    });
    const data = {
      dates, opens: q.open ?? [], highs: q.high ?? [],
      lows: q.low ?? [], closes: q.close ?? [], volumes: q.volume ?? [],
    };
    setCached(key, data);
    return data;
  } catch (err) {
    console.error(`fetchHistory error for ${ticker}:`, (err as any)?.message);
    return null;
  }
}

// ── Condition schema ──────────────────────────────────────────────────────────
export type ConditionType =
  // Trend & Structure
  | "price_above_ma"        // price above/below N-day SMA
  | "ma_alignment"          // 50d SMA above/below 200d SMA (golden/death cross structure)
  | "price_extended_pct"    // price X% above/below N-period EMA or SMA
  | "new_high"              // made a new 52-week high within last N days
  // Momentum & Velocity
  | "price_change_pct"      // ROC: price up/down X% over Y days
  | "rsi"                   // RSI above/below threshold (configurable period)
  | "rsi_divergence"        // RSI holding above/below a level (proxy for divergence)
  | "macd_histogram"        // MACD histogram expanding (above 0 and growing) or contracting
  | "macd_crossover"        // MACD line crosses above/below signal line
  // Volatility & Compression
  | "bb_width"              // BBW above/below threshold
  | "bb_squeeze"            // BBW at Z-period low (squeeze condition)
  | "bb_position"           // price above upper / below lower BB
  | "atr_expansion"         // ATR expanding: current ATR > N-period avg ATR
  // Volume & Liquidity
  | "volume_surge"          // volume Nx above 20d avg (RVOL)
  | "gap_up"                // gap up X% on open vs prev close
  | "near_52w_high"         // within X% of 52-week high
  | "near_52w_low";         // within X% of 52-week low

export interface Condition {
  type: ConditionType;
  direction?: "above" | "below" | "up" | "down";
  value: number;
  lookback?: number;    // MA period, ROC window, or BB period
  lookback2?: number;   // secondary period (e.g. squeeze lookback Z)
  useEMA?: boolean;     // for price_extended_pct: true=EMA (default), false=SMA
  rsiPeriod?: number;   // RSI period, default 14
}

export type Logic = "AND" | "OR";

export interface ConditionGroup {
  logic: Logic;
  conditions: Array<Condition | ConditionGroup>;
}

export interface QueryParams {
  ticker: string;
  group: ConditionGroup;
  label?: string;
}

// ── Indicators ────────────────────────────────────────────────────────────────

function calcSMA(closes: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  for (let j = period; j <= i; j++) ema = closes[j] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes: number[], period: number, i: number): number | null {
  if (i < period) return null;
  let gains = 0, losses = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const chg = closes[j] - closes[j - 1];
    if (chg > 0) gains += chg; else losses -= chg;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcATR(highs: number[], lows: number[], closes: number[], period: number, i: number): number | null {
  if (i < period) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const tr = Math.max(
      highs[j] - lows[j],
      Math.abs(highs[j] - closes[j - 1]),
      Math.abs(lows[j] - closes[j - 1])
    );
    sum += tr;
  }
  return sum / period;
}

function calcBBStd(closes: number[], period: number, i: number): { sma: number; std: number } | null {
  const sma = calcSMA(closes, period, i);
  if (sma === null) return null;
  const slice = closes.slice(i - period + 1, i + 1);
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  return { sma, std: Math.sqrt(variance) };
}

function calcBBWidth(closes: number[], period: number, stdMult: number, i: number): number | null {
  const bb = calcBBStd(closes, period, i);
  if (!bb) return null;
  return (2 * stdMult * bb.std) / bb.sma;
}

// MACD line = EMA(12) - EMA(26), Signal = EMA(9) of MACD
function calcMACD(closes: number[], i: number): { macd: number; signal: number; histogram: number } | null {
  if (i < 34) return null; // need at least 26 + 9 bars
  const ema12 = calcEMA(closes, 12, i);
  const ema26 = calcEMA(closes, 26, i);
  if (ema12 === null || ema26 === null) return null;
  // Build a mini MACD series for the signal EMA(9)
  const macdSeries: number[] = [];
  for (let j = 25; j <= i; j++) {
    const e12 = calcEMA(closes, 12, j);
    const e26 = calcEMA(closes, 26, j);
    if (e12 !== null && e26 !== null) macdSeries.push(e12 - e26);
  }
  if (macdSeries.length < 9) return null;
  const macdVal = macdSeries[macdSeries.length - 1];
  // Signal = EMA(9) of MACD series
  let sig = macdSeries.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  const k = 2 / 10;
  for (let j = 9; j < macdSeries.length; j++) sig = macdSeries[j] * k + sig * (1 - k);
  return { macd: macdVal, signal: sig, histogram: macdVal - sig };
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function evalLeaf(
  cond: Condition, i: number,
  closes: number[], opens: number[], highs: number[], lows: number[], volumes: number[]
): boolean {
  const price = closes[i];
  if (!price) return false;

  switch (cond.type) {

    // ── Trend & Structure ─────────────────────────────────────────────────────

    case "price_above_ma": {
      const ma = calcSMA(closes, cond.lookback ?? 50, i);
      if (ma === null) return false;
      return cond.direction === "above" ? price > ma : price < ma;
    }

    case "ma_alignment": {
      // direction "above" = 50d SMA above 200d SMA (bullish)
      // direction "below" = 50d SMA below 200d SMA (bearish)
      const sma50 = calcSMA(closes, 50, i);
      const sma200 = calcSMA(closes, 200, i);
      if (sma50 === null || sma200 === null) return false;
      return cond.direction === "above" ? sma50 > sma200 : sma50 < sma200;
    }

    case "price_extended_pct": {
      const period = cond.lookback ?? 20;
      const ma = cond.useEMA !== false ? calcEMA(closes, period, i) : calcSMA(closes, period, i);
      if (ma === null || ma === 0) return false;
      const ext = ((price - ma) / ma) * 100;
      if (cond.direction === "above") return ext >= cond.value;
      if (cond.direction === "below") return ext <= -Math.abs(cond.value);
      return Math.abs(ext) >= cond.value;
    }

    case "new_high": {
      // Did price hit a 52-week high within the last N days?
      const n = cond.lookback ?? 5;
      const window = Math.min(i, 252);
      const recent = closes.slice(Math.max(0, i - n + 1), i + 1);
      const hist = closes.slice(i - window, i + 1);
      const high52 = Math.max(...hist);
      return recent.some(p => p >= high52 * 0.995);
    }

    // ── Momentum & Velocity ───────────────────────────────────────────────────

    case "price_change_pct": {
      const lb = cond.lookback ?? 5;
      if (i < lb) return false;
      const prev = closes[i - lb];
      if (!prev) return false;
      const pct = ((price - prev) / prev) * 100;
      if (cond.direction === "up" || cond.direction === "above") return pct >= cond.value;
      if (cond.direction === "down" || cond.direction === "below") return pct <= -Math.abs(cond.value);
      return Math.abs(pct) >= cond.value;
    }

    case "rsi": {
      const period = cond.rsiPeriod ?? 14;
      const rsi = calcRSI(closes, period, i);
      if (rsi === null) return false;
      return cond.direction === "above" ? rsi >= cond.value : rsi <= cond.value;
    }

    case "rsi_divergence": {
      // Proxy: RSI holding above 50 (bullish) or below 50 (bearish) for N consecutive bars
      const period = cond.rsiPeriod ?? 14;
      const n = cond.lookback ?? 3;
      for (let j = i - n + 1; j <= i; j++) {
        const rsi = calcRSI(closes, period, j);
        if (rsi === null) return false;
        if (cond.direction === "above" && rsi < cond.value) return false;
        if (cond.direction === "below" && rsi > cond.value) return false;
      }
      return true;
    }

    case "macd_histogram": {
      const cur = calcMACD(closes, i);
      const prev = i > 0 ? calcMACD(closes, i - 1) : null;
      if (!cur || !prev) return false;
      if (cond.direction === "above") {
        // Histogram positive and growing (expanding bullish momentum)
        return cur.histogram > 0 && cur.histogram > prev.histogram;
      } else {
        // Histogram negative and falling (expanding bearish momentum)
        return cur.histogram < 0 && cur.histogram < prev.histogram;
      }
    }

    case "macd_crossover": {
      // Bullish crossover: MACD crosses above signal; bearish: crosses below
      const cur = calcMACD(closes, i);
      const prev = i > 0 ? calcMACD(closes, i - 1) : null;
      if (!cur || !prev) return false;
      if (cond.direction === "above") {
        return prev.macd <= prev.signal && cur.macd > cur.signal;
      } else {
        return prev.macd >= prev.signal && cur.macd < cur.signal;
      }
    }

    // ── Volatility & Compression ──────────────────────────────────────────────

    case "bb_width": {
      const bbw = calcBBWidth(closes, cond.lookback ?? 20, 2, i);
      if (bbw === null) return false;
      return cond.direction === "above" ? bbw >= cond.value : bbw <= cond.value;
    }

    case "bb_squeeze": {
      // BBW is at its lowest in the last Z periods (squeeze)
      const period = cond.lookback ?? 20;
      const zLookback = cond.lookback2 ?? 126; // default 6-month low
      const currentBBW = calcBBWidth(closes, period, 2, i);
      if (currentBBW === null) return false;
      for (let j = i - 1; j >= Math.max(0, i - zLookback); j--) {
        const pastBBW = calcBBWidth(closes, period, 2, j);
        if (pastBBW !== null && pastBBW <= currentBBW) return false; // not the lowest
      }
      return true; // current BBW is lowest in Z periods = squeeze
    }

    case "bb_position": {
      const bb = calcBBStd(closes, cond.lookback ?? 20, i);
      if (!bb) return false;
      const upper = bb.sma + 2 * bb.std;
      const lower = bb.sma - 2 * bb.std;
      return cond.direction === "above" ? price >= upper : price <= lower;
    }

    case "atr_expansion": {
      const period = cond.lookback ?? 14;
      const curATR = calcATR(highs, lows, closes, period, i);
      if (curATR === null || i < period * 2) return false;
      // Average ATR over the prior period
      const atrs: number[] = [];
      for (let j = i - period; j < i; j++) {
        const a = calcATR(highs, lows, closes, period, j);
        if (a !== null) atrs.push(a);
      }
      if (atrs.length === 0) return false;
      const avgATR = atrs.reduce((a, b) => a + b, 0) / atrs.length;
      const expansionPct = ((curATR - avgATR) / avgATR) * 100;
      return cond.direction === "above"
        ? expansionPct >= cond.value   // ATR expanded by X%
        : expansionPct <= -Math.abs(cond.value); // ATR contracted
    }

    // ── Volume & Liquidity ────────────────────────────────────────────────────

    case "volume_surge": {
      const avgVol = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + (b ?? 0), 0) / 20;
      if (!avgVol) return false;
      return (volumes[i] ?? 0) >= avgVol * cond.value;
    }

    case "gap_up": {
      if (i < 1) return false;
      const prevClose = closes[i - 1];
      if (!prevClose || !opens[i]) return false;
      return ((opens[i] - prevClose) / prevClose) * 100 >= cond.value;
    }

    case "near_52w_high": {
      const window = Math.min(i, 252);
      const high52 = Math.max(...closes.slice(i - window, i + 1));
      return ((high52 - price) / high52) * 100 <= cond.value;
    }

    case "near_52w_low": {
      const window = Math.min(i, 252);
      const low52 = Math.min(...closes.slice(i - window, i + 1).filter(v => v > 0));
      return ((price - low52) / low52) * 100 <= cond.value;
    }

    default: return false;
  }
}

// ── Recursive group evaluator ─────────────────────────────────────────────────
function evalGroup(
  node: Condition | ConditionGroup, i: number,
  closes: number[], opens: number[], highs: number[], lows: number[], volumes: number[]
): boolean {
  if ("logic" in node) {
    const g = node as ConditionGroup;
    return g.logic === "AND"
      ? g.conditions.every(c => evalGroup(c, i, closes, opens, highs, lows, volumes))
      : g.conditions.some(c => evalGroup(c, i, closes, opens, highs, lows, volumes));
  }
  return evalLeaf(node as Condition, i, closes, opens, highs, lows, volumes);
}

// ── Forward returns ───────────────────────────────────────────────────────────
const FORWARD_WINDOWS = [
  { label: "1D", days: 1 }, { label: "1W", days: 5 },
  { label: "1M", days: 21 }, { label: "3M", days: 63 }, { label: "1Y", days: 252 },
];

// ── Main query engine ─────────────────────────────────────────────────────────
export async function runExpectancyQuery(params: QueryParams) {
  const cacheKey = `expectancy_v3_${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const hist = await fetchHistory(params.ticker);
  if (!hist) return { error: `Could not fetch history for ${params.ticker}`, events: [], summary: null };

  const { dates, opens, highs, lows, closes, volumes } = hist;
  const MIN_LOOKBACK = 60;
  const matchedEvents: any[] = [];

  for (let i = MIN_LOOKBACK; i < closes.length - 5; i++) {
    if (!closes[i]) continue;
    if (!evalGroup(params.group, i, closes, opens, highs, lows, volumes)) continue;

    const returns: Record<string, number | null> = {};
    for (const w of FORWARD_WINDOWS) {
      const future = closes[i + w.days];
      returns[w.label] = future ? ((future - closes[i]) / closes[i]) * 100 : null;
    }

    // Best-effort trigger % from first price_change_pct leaf
    function findPC(node: Condition | ConditionGroup): Condition | null {
      if ("logic" in node) {
        for (const c of (node as ConditionGroup).conditions) { const f = findPC(c); if (f) return f; }
        return null;
      }
      return (node as Condition).type === "price_change_pct" ? (node as Condition) : null;
    }
    const pc = findPC(params.group);
    const triggerPct = pc ? (() => {
      const lb = pc.lookback ?? 5;
      const prev = closes[i - lb];
      return prev ? Math.round(((closes[i] - prev) / prev) * 1000) / 10 : null;
    })() : null;

    matchedEvents.push({ date: dates[i], price: Math.round(closes[i] * 100) / 100, triggerPct, returns });
  }

  if (matchedEvents.length === 0) {
    const result = {
      ticker: params.ticker,
      label: params.label ?? buildGroupLabel(params.ticker, params.group),
      events: [], summary: null, totalBars: closes.length,
      dateRange: dates.length > 0 ? `${dates[0]} – ${dates[dates.length - 1]}` : "",
    };
    setCached(cacheKey, result);
    return result;
  }

  const summary: Record<string, any> = {};
  for (const w of FORWARD_WINDOWS) {
    const vals = matchedEvents.map(e => e.returns[w.label]).filter((v): v is number => v !== null);
    if (!vals.length) { summary[w.label] = null; continue; }
    const wins = vals.filter(v => v > 0).length;
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    summary[w.label] = {
      winRate: Math.round((wins / vals.length) * 100),
      mean: Math.round(mean * 10) / 10,
      median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
      min: Math.round(sorted[0] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
      std: Math.round(Math.sqrt(variance) * 10) / 10,
      n: vals.length,
    };
  }

  const t = summary["3M"];
  const plainText = t
    ? `When ${params.ticker} matched this pattern, the 3-month win rate was ${t.winRate}% with a mean return of ${t.mean > 0 ? "+" : ""}${t.mean}% across ${matchedEvents.length} events.`
    : `Found ${matchedEvents.length} historical matches.`;

  const result = {
    ticker: params.ticker,
    label: params.label ?? buildGroupLabel(params.ticker, params.group),
    events: matchedEvents, summary, totalBars: closes.length,
    dateRange: `${dates[MIN_LOOKBACK]} – ${dates[dates.length - 1]}`,
    plainText,
  };
  setCached(cacheKey, result);
  return result;
}

// ── Label builder ─────────────────────────────────────────────────────────────
function condLabel(c: Condition): string {
  switch (c.type) {
    case "price_change_pct":   return `${c.direction === "down" ? "↓" : "↑"}${c.value}%+ in ${c.lookback}d`;
    case "price_above_ma":     return `price ${c.direction} ${c.lookback}d SMA`;
    case "ma_alignment":       return c.direction === "above" ? "50d > 200d (bull)" : "50d < 200d (bear)";
    case "price_extended_pct": return `>${c.value}% ${c.direction} ${c.lookback}p ${c.useEMA !== false ? "EMA" : "SMA"}`;
    case "new_high":           return `new high in ${c.lookback ?? 5}d`;
    case "rsi":                return `RSI(${c.rsiPeriod ?? 14}) ${c.direction} ${c.value}`;
    case "rsi_divergence":     return `RSI(${c.rsiPeriod ?? 14}) holding ${c.direction} ${c.value} for ${c.lookback ?? 3}d`;
    case "macd_histogram":     return `MACD hist ${c.direction === "above" ? "expanding ↑" : "expanding ↓"}`;
    case "macd_crossover":     return `MACD ${c.direction === "above" ? "bullish" : "bearish"} crossover`;
    case "bb_width":           return `BBW ${c.direction} ${c.value}`;
    case "bb_squeeze":         return `BB squeeze (${c.lookback2 ?? 126}d low)`;
    case "bb_position":        return `price ${c.direction === "above" ? "above upper" : "below lower"} BB`;
    case "atr_expansion":      return `ATR ${c.direction === "above" ? "expanded" : "contracted"} ${c.value}%+`;
    case "volume_surge":       return `RVOL ≥${c.value}×`;
    case "gap_up":             return `gap up ${c.value}%+`;
    case "near_52w_high":      return `near 52w high`;
    case "near_52w_low":       return `near 52w low`;
    default: return "";
  }
}
function groupLabel(g: ConditionGroup): string {
  return g.conditions.map(n => "logic" in n ? `(${groupLabel(n as ConditionGroup)})` : condLabel(n as Condition)).join(` ${g.logic} `);
}
function buildGroupLabel(ticker: string, g: ConditionGroup): string {
  return `${ticker}: ${groupLabel(g)}`;
}

// ── NLP parser ────────────────────────────────────────────────────────────────
export function parseNaturalQuery(query: string): QueryParams | null {
  const raw = query.trim();
  const q = raw.toLowerCase()
    .replace(/trading sessions?/g, "days").replace(/\bsessions?\b/g, "days")
    .replace(/\bweeks?\b/g, "week").replace(/\bmonths?\b/g, "month")
    .replace(/rsi\s*(?:at|=|is|of)\s*([\d.]+)/g, (_, n) => `rsi above ${parseFloat(n) - 2}`)
    .replace(/rsi\s*(?:around|near|~)\s*([\d.]+)/g, (_, n) => `rsi above ${parseFloat(n) - 3}`)
    .replace(/rsi\s*>\s*([\d.]+)/g, (_, n) => `rsi above ${n}`)
    .replace(/rsi\s*<\s*([\d.]+)/g, (_, n) => `rsi below ${n}`);

  const tickerMatch = raw.match(/^([A-Za-z]{1,5})\b/);
  if (!tickerMatch) return null;
  const ticker = tickerMatch[1].toUpperCase();

  const hasOr = /\bor\b/.test(q);
  const hasAnd = /\band\b|,/.test(q);
  const logic: Logic = (hasOr && !hasAnd) ? "OR" : "AND";
  const segments = q.split(/\band\b|\bor\b|,/).map(s => s.trim()).filter(Boolean);

  const conditions: Condition[] = [];

  for (const seg of segments) {
    const priceUp = seg.match(/up\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
    if (priceUp) {
      const u = priceUp[3]; const n = parseFloat(priceUp[2]);
      conditions.push({ type: "price_change_pct", direction: "up", value: parseFloat(priceUp[1]), lookback: Math.round(u.startsWith("w") ? n*5 : u.startsWith("m") ? n*21 : n) });
      continue;
    }
    const priceDown = seg.match(/down\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
    if (priceDown) {
      const u = priceDown[3]; const n = parseFloat(priceDown[2]);
      conditions.push({ type: "price_change_pct", direction: "down", value: parseFloat(priceDown[1]), lookback: Math.round(u.startsWith("w") ? n*5 : u.startsWith("m") ? n*21 : n) });
      continue;
    }
    const rsi = seg.match(/rsi\s*(above|below|over|under)\s*([\d.]+)/);
    if (rsi) {
      conditions.push({ type: "rsi", direction: rsi[1] === "above" || rsi[1] === "over" ? "above" : "below", value: parseFloat(rsi[2]) });
      continue;
    }
    const extMatch =
      seg.match(/(?:price\s*)?[>≥]?\s*([\d.]+)\s*%?\s*(?:extended\s+)?(above|below)\s+([\d]+)[\s-]*(?:day|d)?[\s-]*(?:period)?[\s-]*(ema|sma)/) ||
      seg.match(/price\s+(?:is\s+)?(?:more\s+than\s+)?([\d.]+)\s*%\s*(above|below)\s+(?:the\s+)?([\d]+)[\s-]*(?:day|d)?[\s-]*(ema|sma)/);
    if (extMatch) {
      conditions.push({ type: "price_extended_pct", direction: extMatch[2] as "above"|"below", value: parseFloat(extMatch[1]), lookback: parseInt(extMatch[3]), useEMA: extMatch[4] === "ema" });
      continue;
    }
    const maMatch = seg.match(/(above|below)\s+([\d]+)[\s-]*(?:d|day)?[\s-]*(?:ma|sma|dma)/);
    if (maMatch) { conditions.push({ type: "price_above_ma", direction: maMatch[1] as "above"|"below", value: 0, lookback: parseInt(maMatch[2]) }); continue; }
    if (/golden cross|50.*above.*200|bull(?:ish)? alignment/.test(seg)) { conditions.push({ type: "ma_alignment", direction: "above", value: 0 }); continue; }
    if (/death cross|50.*below.*200|bear(?:ish)? alignment/.test(seg)) { conditions.push({ type: "ma_alignment", direction: "below", value: 0 }); continue; }
    if (/macd.*cross.*above|bullish.*crossover|macd.*bull/.test(seg)) { conditions.push({ type: "macd_crossover", direction: "above", value: 0 }); continue; }
    if (/macd.*cross.*below|bearish.*crossover|macd.*bear/.test(seg)) { conditions.push({ type: "macd_crossover", direction: "below", value: 0 }); continue; }
    if (/macd.*expand|histogram.*expand|macd.*bull/.test(seg)) { conditions.push({ type: "macd_histogram", direction: "above", value: 0 }); continue; }
    if (/bb.*squeeze|bollinger.*squeeze|squeeze/.test(seg)) { conditions.push({ type: "bb_squeeze", value: 0, lookback: 20, lookback2: 126 }); continue; }
    const bbwMatch = seg.match(/(?:bbw?|band\s*width)\s*(?:above|>|expanded?)\s*([\d.]+)/);
    if (bbwMatch) { conditions.push({ type: "bb_width", direction: "above", value: parseFloat(bbwMatch[1]) }); continue; }
    const atrMatch = seg.match(/atr.*expan/);
    if (atrMatch) { conditions.push({ type: "atr_expansion", direction: "above", value: 20 }); continue; }
    const gapMatch = seg.match(/gap\s*up\s*([\d.]+)\s*%/);
    if (gapMatch) { conditions.push({ type: "gap_up", value: parseFloat(gapMatch[1]) }); continue; }
    const volMatch = seg.match(/(?:rvol|vol(?:ume)?)\s*(?:surge|spike|above|×|x)?\s*([\d.]+)\s*[×x]/);
    if (volMatch) { conditions.push({ type: "volume_surge", value: parseFloat(volMatch[1]) }); continue; }
    if (/near\s*52.?w(?:eek)?\s*high/.test(seg)) { conditions.push({ type: "near_52w_high", value: 5 }); continue; }
    if (/near\s*52.?w(?:eek)?\s*low/.test(seg)) { conditions.push({ type: "near_52w_low", value: 5 }); continue; }
  }

  if (!conditions.length) return null;
  const group: ConditionGroup = { logic, conditions };
  return { ticker, group, label: buildGroupLabel(ticker, group) };
}
