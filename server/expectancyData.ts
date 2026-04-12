import axios from "axios";

const CACHE_TTL = 10 * 60 * 1000; // 10 min
const cache = new Map<string, { data: any; timestamp: number }>();
function getCached(key: string) {
  const e = cache.get(key);
  if (e && Date.now() - e.timestamp < CACHE_TTL) return e.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Fetch full daily OHLCV history for a ticker (up to 10 years)
export async function fetchHistory(ticker: string): Promise<{
  dates: string[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
} | null> {
  const key = `hist_${ticker.toUpperCase()}`;
  const cached = getCached(key);
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}?range=10y&interval=1d`;
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const result = resp.data?.chart?.result?.[0];
    if (!result) return null;

    const ts: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const closes: number[] = q.close ?? [];
    const opens: number[] = q.open ?? [];
    const highs: number[] = q.high ?? [];
    const lows: number[] = q.low ?? [];
    const volumes: number[] = q.volume ?? [];

    const dates = ts.map((t) => {
      const d = new Date(t * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });

    const data = { dates, opens, highs, lows, closes, volumes };
    setCached(key, data);
    return data;
  } catch (err) {
    console.error(`fetchHistory error for ${ticker}:`, (err as any)?.message);
    return null;
  }
}

// ── Condition types ──────────────────────────────────────────────────────────

export type ConditionType =
  | "price_change_pct"   // price up/down X% over Y days
  | "price_above_ma"     // price above/below N-day MA
  | "rsi"                // RSI above/below threshold
  | "volume_surge"       // volume N× above avg
  | "price_level"        // price above/below $X
  | "gap_up"             // gap up X% on open
  | "near_52w_high"      // within X% of 52-week high
  | "near_52w_low";      // within X% of 52-week low

export interface Condition {
  type: ConditionType;
  direction?: "above" | "below" | "up" | "down"; // for price_change, rsi, ma, price_level
  value: number;        // threshold (pct, level, multiplier, etc.)
  lookback?: number;    // days window (for price_change)
}

export interface QueryParams {
  ticker: string;
  conditions: Condition[];
  label?: string;       // optional human-readable label
}

// ── Technical indicators ─────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14, i: number): number | null {
  if (i < period) return null;
  let gains = 0, losses = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const chg = closes[j] - closes[j - 1];
    if (chg > 0) gains += chg; else losses -= chg;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMA(closes: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14, i: number): number | null {
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

// ── Condition evaluator ──────────────────────────────────────────────────────

function evaluateCondition(
  cond: Condition,
  i: number,
  closes: number[],
  opens: number[],
  highs: number[],
  lows: number[],
  volumes: number[]
): boolean {
  const price = closes[i];
  if (!price) return false;

  switch (cond.type) {
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

    case "price_above_ma": {
      const ma = calcMA(closes, cond.lookback ?? 50, i);
      if (ma === null) return false;
      if (cond.direction === "above") return price > ma;
      if (cond.direction === "below") return price < ma;
      return false;
    }

    case "rsi": {
      const rsi = calcRSI(closes, 14, i);
      if (rsi === null) return false;
      if (cond.direction === "above") return rsi >= cond.value;
      if (cond.direction === "below") return rsi <= cond.value;
      return false;
    }

    case "volume_surge": {
      const avgVol = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + (b ?? 0), 0) / 20;
      if (!avgVol) return false;
      return (volumes[i] ?? 0) >= avgVol * cond.value;
    }

    case "price_level": {
      if (cond.direction === "above") return price >= cond.value;
      if (cond.direction === "below") return price <= cond.value;
      return false;
    }

    case "gap_up": {
      if (i < 1) return false;
      const prevClose = closes[i - 1];
      if (!prevClose || !opens[i]) return false;
      const gapPct = ((opens[i] - prevClose) / prevClose) * 100;
      return gapPct >= cond.value;
    }

    case "near_52w_high": {
      const window = Math.min(i, 252);
      const high52 = Math.max(...closes.slice(i - window, i + 1));
      const pctFromHigh = ((high52 - price) / high52) * 100;
      return pctFromHigh <= cond.value; // within X% of high
    }

    case "near_52w_low": {
      const window = Math.min(i, 252);
      const low52 = Math.min(...closes.slice(i - window, i + 1).filter(v => v > 0));
      const pctFromLow = ((price - low52) / low52) * 100;
      return pctFromLow <= cond.value; // within X% of low
    }

    default:
      return false;
  }
}

// ── Forward returns calculator ───────────────────────────────────────────────

const FORWARD_WINDOWS = [
  { label: "0+C", days: 0 },   // same day close vs open
  { label: "1D", days: 1 },
  { label: "1W", days: 5 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "1Y", days: 252 },
];

function forwardReturn(closes: number[], i: number, days: number): number | null {
  if (days === 0) return null; // placeholder
  const future = closes[i + days];
  if (!future) return null;
  return ((future - closes[i]) / closes[i]) * 100;
}

// ── Main query engine ────────────────────────────────────────────────────────

export async function runExpectancyQuery(params: QueryParams) {
  const cacheKey = `expectancy_${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const hist = await fetchHistory(params.ticker);
  if (!hist) {
    return { error: `Could not fetch history for ${params.ticker}`, events: [], summary: null };
  }

  const { dates, opens, highs, lows, closes, volumes } = hist;
  const MIN_LOOKBACK = 60; // need enough history for indicators

  const matchedEvents: any[] = [];

  for (let i = MIN_LOOKBACK; i < closes.length - 5; i++) {
    if (!closes[i]) continue;

    // All conditions must be true
    const allMatch = params.conditions.every(cond =>
      evaluateCondition(cond, i, closes, opens, highs, lows, volumes)
    );

    if (!allMatch) continue;

    // Calculate forward returns
    const returns: Record<string, number | null> = {};
    for (const w of FORWARD_WINDOWS) {
      returns[w.label] = forwardReturn(closes, i, w.days);
    }

    // Build a description of the trigger
    const maxLookback = Math.max(...params.conditions.map(c => c.lookback ?? 1));
    const triggerPct = (() => {
      const priceCond = params.conditions.find(c => c.type === "price_change_pct");
      if (!priceCond) return null;
      const lb = priceCond.lookback ?? 5;
      const prev = closes[i - lb];
      if (!prev) return null;
      return ((closes[i] - prev) / prev) * 100;
    })();

    matchedEvents.push({
      date: dates[i],
      price: Math.round(closes[i] * 100) / 100,
      triggerPct: triggerPct !== null ? Math.round(triggerPct * 10) / 10 : null,
      returns,
    });
  }

  if (matchedEvents.length === 0) {
    const result = {
      ticker: params.ticker,
      label: params.label ?? buildLabel(params),
      events: [],
      summary: null,
      totalBars: closes.length,
      dateRange: dates.length > 0 ? `${dates[0]} – ${dates[dates.length - 1]}` : "",
    };
    setCached(cacheKey, result);
    return result;
  }

  // ── Summary statistics ────────────────────────────────────────────────────
  const summary: Record<string, any> = {};
  for (const w of FORWARD_WINDOWS.filter(x => x.days > 0)) {
    const vals = matchedEvents
      .map(e => e.returns[w.label])
      .filter((v): v is number => v !== null);
    if (vals.length === 0) { summary[w.label] = null; continue; }

    const wins = vals.filter(v => v > 0).length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
    const std = Math.sqrt(variance);

    summary[w.label] = {
      winRate: Math.round((wins / vals.length) * 100),
      mean: Math.round(mean * 10) / 10,
      median: Math.round(median * 10) / 10,
      min: Math.round(min * 10) / 10,
      max: Math.round(max * 10) / 10,
      std: Math.round(std * 10) / 10,
      n: vals.length,
    };
  }

  // Plain-English summary
  const threeMonth = summary["3M"];
  const plainText = threeMonth
    ? `When ${params.ticker} matched this pattern, the 3-month win rate was ${threeMonth.winRate}% with a mean return of ${threeMonth.mean > 0 ? "+" : ""}${threeMonth.mean}% across ${matchedEvents.length} events since ${dates[MIN_LOOKBACK]?.slice(0, 4)}.`
    : `Found ${matchedEvents.length} historical matches for this pattern.`;

  const result = {
    ticker: params.ticker,
    label: params.label ?? buildLabel(params),
    events: matchedEvents,
    summary,
    totalBars: closes.length,
    dateRange: `${dates[MIN_LOOKBACK]} – ${dates[dates.length - 1]}`,
    plainText,
  };

  setCached(cacheKey, result);
  return result;
}

// ── Natural language parser ───────────────────────────────────────────────────
// Parses queries like:
//   "QQQ up 8.5% in 6 days"
//   "TSLA up 10% in 5 days and RSI above 70"
//   "AMZN down 15% in 1 month"
//   "SPY above 200dma"
//   "NVDA gap up 5%"
//   "AAPL near 52-week high"

export function parseNaturalQuery(query: string): QueryParams | null {
  const q = query.trim().toLowerCase();

  // Extract ticker — first word that's all caps (or we uppercase first token)
  const tickerMatch = query.match(/^([A-Za-z]{1,5})\b/);
  if (!tickerMatch) return null;
  const ticker = tickerMatch[1].toUpperCase();

  const conditions: Condition[] = [];

  // "up X% in Y days/weeks/months"
  const priceUpMatch = q.match(/up\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
  if (priceUpMatch) {
    const pct = parseFloat(priceUpMatch[1]);
    const num = parseFloat(priceUpMatch[2]);
    const unit = priceUpMatch[3];
    const days = unit.startsWith("week") ? num * 5 : unit.startsWith("month") ? num * 21 : num;
    conditions.push({ type: "price_change_pct", direction: "up", value: pct, lookback: Math.round(days) });
  }

  // "down X% in Y days/weeks/months"
  const priceDownMatch = q.match(/down\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
  if (priceDownMatch) {
    const pct = parseFloat(priceDownMatch[1]);
    const num = parseFloat(priceDownMatch[2]);
    const unit = priceDownMatch[3];
    const days = unit.startsWith("week") ? num * 5 : unit.startsWith("month") ? num * 21 : num;
    conditions.push({ type: "price_change_pct", direction: "down", value: pct, lookback: Math.round(days) });
  }

  // "RSI above/below X"
  const rsiMatch = q.match(/rsi\s*(above|below|over|under)\s*([\d.]+)/);
  if (rsiMatch) {
    const dir = rsiMatch[1].startsWith("above") || rsiMatch[1] === "over" ? "above" : "below";
    conditions.push({ type: "rsi", direction: dir, value: parseFloat(rsiMatch[2]) });
  }

  // "above/below Xdma" or "above X-day MA"
  const maMatch = q.match(/(above|below)\s*([\d]+)\s*(?:d|day|-)?\s*(?:ma|sma|ema)/);
  if (maMatch) {
    const dir = maMatch[1] as "above" | "below";
    conditions.push({ type: "price_above_ma", direction: dir, value: 0, lookback: parseInt(maMatch[2]) });
  }

  // "gap up X%"
  const gapMatch = q.match(/gap\s*up\s*([\d.]+)\s*%/);
  if (gapMatch) {
    conditions.push({ type: "gap_up", value: parseFloat(gapMatch[1]) });
  }

  // "volume X× above average" or "vol surge X"
  const volMatch = q.match(/vol(?:ume)?\s*(?:surge|spike|above|×)?\s*([\d.]+)\s*[×x]/);
  if (volMatch) {
    conditions.push({ type: "volume_surge", value: parseFloat(volMatch[1]) });
  }

  // "near 52-week high" / "near 52w high"
  if (q.match(/near\s*52.?w(?:eek)?\s*high/)) {
    conditions.push({ type: "near_52w_high", value: 5 });
  }
  if (q.match(/near\s*52.?w(?:eek)?\s*low/)) {
    conditions.push({ type: "near_52w_low", value: 5 });
  }

  if (conditions.length === 0) return null;

  return { ticker, conditions, label: buildLabel({ ticker, conditions }) };
}

function buildLabel(params: QueryParams): string {
  const parts = params.conditions.map(c => {
    switch (c.type) {
      case "price_change_pct":
        return `${c.direction === "down" ? "down" : "up"} ${c.value}%+ in ${c.lookback}d`;
      case "price_above_ma":
        return `${c.direction} ${c.lookback}dma`;
      case "rsi":
        return `RSI ${c.direction} ${c.value}`;
      case "volume_surge":
        return `vol ${c.value}× avg`;
      case "gap_up":
        return `gap up ${c.value}%+`;
      case "near_52w_high":
        return `near 52w high`;
      case "near_52w_low":
        return `near 52w low`;
      default:
        return "";
    }
  });
  return `${params.ticker} ${parts.join(" + ")}`;
}
