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

// ── OHLCV fetcher ─────────────────────────────────────────────────────────────

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

// ── Condition schema ──────────────────────────────────────────────────────────
//
// A ConditionGroup is a boolean tree: each node is either a leaf Condition
// or a group of sub-nodes joined by AND or OR.
//
// Example:
//   { logic: "AND", conditions: [
//     { type: "price_change_pct", direction: "up", value: 18.5, lookback: 8 },
//     { type: "rsi", direction: "above", value: 70 },
//     { type: "price_extended_pct", direction: "above", value: 10, lookback: 20, useEMA: true }
//   ]}
//
// For OR at the top level:
//   { logic: "OR", conditions: [
//     { type: "rsi", direction: "above", value: 75 },
//     { type: "bb_width", direction: "above", value: 0.1 }
//   ]}

export type ConditionType =
  | "price_change_pct"    // price up/down X% over Y days
  | "price_above_ma"      // price above/below N-day SMA
  | "price_extended_pct"  // price is X% above/below N-period EMA or SMA
  | "rsi"                 // RSI above/below threshold
  | "bb_width"            // Bollinger Band Width above/below threshold
  | "bb_position"         // price above/below upper or lower BB
  | "volume_surge"        // volume N× above 20d avg
  | "gap_up"              // gap up X% on open vs prev close
  | "near_52w_high"       // within X% of 52-week high
  | "near_52w_low";       // within X% of 52-week low

export interface Condition {
  type: ConditionType;
  direction?: "above" | "below" | "up" | "down";
  value: number;
  lookback?: number;   // days window or MA/BB period
  useEMA?: boolean;    // for price_extended_pct: true=EMA (default), false=SMA
  bbPeriod?: number;   // for BB conditions, default 20
  bbStdDev?: number;   // for BB conditions, default 2
}

export type Logic = "AND" | "OR";

export interface ConditionGroup {
  logic: Logic;
  conditions: Array<Condition | ConditionGroup>;
}

// Top-level query params — now accepts a ConditionGroup instead of flat array
export interface QueryParams {
  ticker: string;
  group: ConditionGroup;
  label?: string;
}

// ── Technical indicators ──────────────────────────────────────────────────────

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
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcSMA(closes: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes: number[], period: number, i: number): number | null {
  if (i < period - 1) return null;
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  for (let j = period; j <= i; j++) {
    ema = closes[j] * k + ema * (1 - k);
  }
  return ema;
}

// Bollinger Band Width = (upper - lower) / middle  (normalized, no units)
function calcBBWidth(closes: number[], period: number, stdMult: number, i: number): number | null {
  const sma = calcSMA(closes, period, i);
  if (sma === null) return null;
  const slice = closes.slice(i - period + 1, i + 1);
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + stdMult * std;
  const lower = sma - stdMult * std;
  return (upper - lower) / sma;
}

// ── Leaf condition evaluator ──────────────────────────────────────────────────

function evalLeaf(
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
      const ma = calcSMA(closes, cond.lookback ?? 50, i);
      if (ma === null) return false;
      if (cond.direction === "above") return price > ma;
      if (cond.direction === "below") return price < ma;
      return false;
    }

    case "price_extended_pct": {
      const period = cond.lookback ?? 20;
      const ma = cond.useEMA !== false
        ? calcEMA(closes, period, i)
        : calcSMA(closes, period, i);
      if (ma === null || ma === 0) return false;
      const ext = ((price - ma) / ma) * 100;
      if (cond.direction === "above") return ext >= cond.value;
      if (cond.direction === "below") return ext <= -Math.abs(cond.value);
      return Math.abs(ext) >= cond.value;
    }

    case "rsi": {
      const rsi = calcRSI(closes, 14, i);
      if (rsi === null) return false;
      if (cond.direction === "above") return rsi >= cond.value;
      if (cond.direction === "below") return rsi <= cond.value;
      return false;
    }

    case "bb_width": {
      const period = cond.bbPeriod ?? 20;
      const mult = cond.bbStdDev ?? 2;
      const bbw = calcBBWidth(closes, period, mult, i);
      if (bbw === null) return false;
      if (cond.direction === "above") return bbw >= cond.value;
      if (cond.direction === "below") return bbw <= cond.value;
      return false;
    }

    case "bb_position": {
      const period = cond.bbPeriod ?? 20;
      const mult = cond.bbStdDev ?? 2;
      const sma = calcSMA(closes, period, i);
      if (sma === null) return false;
      const slice = closes.slice(i - period + 1, i + 1);
      const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
      const upper = sma + mult * std;
      const lower = sma - mult * std;
      if (cond.direction === "above") return price >= upper;   // above upper band
      if (cond.direction === "below") return price <= lower;   // below lower band
      return false;
    }

    case "volume_surge": {
      const avgVol = volumes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + (b ?? 0), 0) / 20;
      if (!avgVol) return false;
      return (volumes[i] ?? 0) >= avgVol * cond.value;
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
      return ((high52 - price) / high52) * 100 <= cond.value;
    }

    case "near_52w_low": {
      const window = Math.min(i, 252);
      const low52 = Math.min(...closes.slice(i - window, i + 1).filter(v => v > 0));
      return ((price - low52) / low52) * 100 <= cond.value;
    }

    default:
      return false;
  }
}

// ── Recursive group evaluator ─────────────────────────────────────────────────

function evalGroup(
  node: Condition | ConditionGroup,
  i: number,
  closes: number[],
  opens: number[],
  highs: number[],
  lows: number[],
  volumes: number[]
): boolean {
  // Is it a leaf Condition or a ConditionGroup?
  if ("logic" in node) {
    const g = node as ConditionGroup;
    if (g.logic === "AND") {
      return g.conditions.every(child => evalGroup(child, i, closes, opens, highs, lows, volumes));
    } else {
      return g.conditions.some(child => evalGroup(child, i, closes, opens, highs, lows, volumes));
    }
  } else {
    return evalLeaf(node as Condition, i, closes, opens, highs, lows, volumes);
  }
}

// ── Forward returns ───────────────────────────────────────────────────────────

const FORWARD_WINDOWS = [
  { label: "1D", days: 1 },
  { label: "1W", days: 5 },
  { label: "1M", days: 21 },
  { label: "3M", days: 63 },
  { label: "1Y", days: 252 },
];

function forwardReturn(closes: number[], i: number, days: number): number | null {
  const future = closes[i + days];
  if (!future) return null;
  return ((future - closes[i]) / closes[i]) * 100;
}

// ── Main query engine ─────────────────────────────────────────────────────────

export async function runExpectancyQuery(params: QueryParams) {
  const cacheKey = `expectancy_v2_${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const hist = await fetchHistory(params.ticker);
  if (!hist) {
    return { error: `Could not fetch history for ${params.ticker}`, events: [], summary: null };
  }

  const { dates, opens, highs, lows, closes, volumes } = hist;
  const MIN_LOOKBACK = 60;

  const matchedEvents: any[] = [];

  for (let i = MIN_LOOKBACK; i < closes.length - 5; i++) {
    if (!closes[i]) continue;
    if (!evalGroup(params.group, i, closes, opens, highs, lows, volumes)) continue;

    const returns: Record<string, number | null> = {};
    for (const w of FORWARD_WINDOWS) {
      returns[w.label] = forwardReturn(closes, i, w.days);
    }

    // Best-effort trigger % from the first price_change_pct leaf
    const triggerPct = (() => {
      function findFirstPriceChange(node: Condition | ConditionGroup): Condition | null {
        if ("logic" in node) {
          for (const child of (node as ConditionGroup).conditions) {
            const found = findFirstPriceChange(child);
            if (found) return found;
          }
          return null;
        }
        return (node as Condition).type === "price_change_pct" ? (node as Condition) : null;
      }
      const pc = findFirstPriceChange(params.group);
      if (!pc) return null;
      const lb = pc.lookback ?? 5;
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
      label: params.label ?? buildGroupLabel(params.ticker, params.group),
      events: [],
      summary: null,
      totalBars: closes.length,
      dateRange: dates.length > 0 ? `${dates[0]} – ${dates[dates.length - 1]}` : "",
    };
    setCached(cacheKey, result);
    return result;
  }

  // Summary statistics
  const summary: Record<string, any> = {};
  for (const w of FORWARD_WINDOWS) {
    const vals = matchedEvents
      .map(e => e.returns[w.label])
      .filter((v): v is number => v !== null);
    if (vals.length === 0) { summary[w.label] = null; continue; }
    const wins = vals.filter(v => v > 0).length;
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
    summary[w.label] = {
      winRate: Math.round((wins / vals.length) * 100),
      mean: Math.round(mean * 10) / 10,
      median: Math.round(median * 10) / 10,
      min: Math.round(sorted[0] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
      std: Math.round(Math.sqrt(variance) * 10) / 10,
      n: vals.length,
    };
  }

  const threeMonth = summary["3M"];
  const plainText = threeMonth
    ? `When ${params.ticker} matched this pattern, the 3-month win rate was ${threeMonth.winRate}% with a mean return of ${threeMonth.mean > 0 ? "+" : ""}${threeMonth.mean}% across ${matchedEvents.length} events.`
    : `Found ${matchedEvents.length} historical matches for this pattern.`;

  const result = {
    ticker: params.ticker,
    label: params.label ?? buildGroupLabel(params.ticker, params.group),
    events: matchedEvents,
    summary,
    totalBars: closes.length,
    dateRange: `${dates[MIN_LOOKBACK]} – ${dates[dates.length - 1]}`,
    plainText,
  };

  setCached(cacheKey, result);
  return result;
}

// ── Label builder ─────────────────────────────────────────────────────────────

function conditionLabel(c: Condition): string {
  switch (c.type) {
    case "price_change_pct":
      return `${c.direction === "down" ? "↓" : "↑"}${c.value}%+ in ${c.lookback}d`;
    case "price_above_ma":
      return `price ${c.direction} ${c.lookback}d SMA`;
    case "price_extended_pct":
      return `>${c.value}% ${c.direction} ${c.lookback}p ${c.useEMA !== false ? "EMA" : "SMA"}`;
    case "rsi":
      return `RSI ${c.direction} ${c.value}`;
    case "bb_width":
      return `BBW ${c.direction} ${c.value}`;
    case "bb_position":
      return `price ${c.direction} ${c.bbPeriod ?? 20}p BB`;
    case "volume_surge":
      return `vol ≥${c.value}× avg`;
    case "gap_up":
      return `gap up ${c.value}%+`;
    case "near_52w_high":
      return `near 52w high`;
    case "near_52w_low":
      return `near 52w low`;
    default:
      return "";
  }
}

function groupLabel(g: ConditionGroup): string {
  const parts = g.conditions.map(node =>
    "logic" in node ? `(${groupLabel(node as ConditionGroup)})` : conditionLabel(node as Condition)
  );
  return parts.join(` ${g.logic} `);
}

function buildGroupLabel(ticker: string, g: ConditionGroup): string {
  return `${ticker}: ${groupLabel(g)}`;
}

// ── NLP parser → structured ConditionGroup ────────────────────────────────────
//
// Strategy: parse the input into a flat list of Condition objects, then wrap
// them in a ConditionGroup.  The logic (AND/OR) is inferred from the connector
// words: "and" → AND, "or" → OR.  Mixed logic defaults to AND.
//
// The key architectural improvement: parsing is two-phase:
//   Phase 1: Normalize + tokenize into segments (split on "and"/"or")
//   Phase 2: For each segment, run focused pattern matchers → Condition
//   Phase 3: Wrap into ConditionGroup with the inferred logic

export function parseNaturalQuery(query: string): QueryParams | null {
  // ── Phase 1: Normalize ────────────────────────────────────────────────────
  const raw = query.trim();
  const q = raw.toLowerCase()
    .replace(/trading sessions?/g, "days")
    .replace(/\bsessions?\b/g, "days")
    .replace(/\bweeks?\b/g, "week")
    .replace(/\bmonths?\b/g, "month")
    // "RSI at X" → "RSI above X-2" (RSI at 70 means overbought, roughly above 68)
    .replace(/rsi\s*(?:at|=|is|of)\s*([\d.]+)/g, (_, n) => `rsi above ${parseFloat(n) - 2}`)
    .replace(/rsi\s*(?:around|near|~)\s*([\d.]+)/g, (_, n) => `rsi above ${parseFloat(n) - 3}`)
    // ">70" → "above 70" for RSI shorthand
    .replace(/rsi\s*>\s*([\d.]+)/g, (_, n) => `rsi above ${n}`)
    .replace(/rsi\s*<\s*([\d.]+)/g, (_, n) => `rsi below ${n}`);

  // ── Extract ticker (first word) ───────────────────────────────────────────
  const tickerMatch = raw.match(/^([A-Za-z]{1,5})\b/);
  if (!tickerMatch) return null;
  const ticker = tickerMatch[1].toUpperCase();

  // ── Detect logic operator ──────────────────────────────────────────────────
  const hasOr = /\bor\b/.test(q);
  const hasAnd = /\band\b|,/.test(q);
  const logic: Logic = (hasOr && !hasAnd) ? "OR" : "AND";

  // ── Phase 2: Segment → Condition matchers ─────────────────────────────────
  // Split on "and", "or", and commas to get individual clause strings
  const segments = q.split(/\band\b|\bor\b|,/).map(s => s.trim()).filter(Boolean);

  const conditions: Condition[] = [];

  for (const seg of segments) {

    // ── Price Change: "up X% in Y days/weeks/months"
    const priceUp = seg.match(/up\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
    if (priceUp) {
      const pct = parseFloat(priceUp[1]);
      const num = parseFloat(priceUp[2]);
      const unit = priceUp[3];
      const days = unit.startsWith("week") ? num * 5 : unit.startsWith("month") ? num * 21 : num;
      conditions.push({ type: "price_change_pct", direction: "up", value: pct, lookback: Math.round(days) });
      continue;
    }

    const priceDown = seg.match(/down\s+([\d.]+)\s*%\s*(?:in|over)\s+([\d.]+)\s*(day|week|month)/);
    if (priceDown) {
      const pct = parseFloat(priceDown[1]);
      const num = parseFloat(priceDown[2]);
      const unit = priceDown[3];
      const days = unit.startsWith("week") ? num * 5 : unit.startsWith("month") ? num * 21 : num;
      conditions.push({ type: "price_change_pct", direction: "down", value: pct, lookback: Math.round(days) });
      continue;
    }

    // ── RSI
    const rsi = seg.match(/rsi\s*(above|below|over|under)\s*([\d.]+)/);
    if (rsi) {
      const dir = rsi[1] === "above" || rsi[1] === "over" ? "above" : "below";
      conditions.push({ type: "rsi", direction: dir, value: parseFloat(rsi[2]) });
      continue;
    }

    // ── EMA/SMA Extension: "price >X% extended above Y EMA"
    // Handles: ">10% above 20 EMA", "price >10% extended above 20 EMA",
    //          "10% extended above 20-day EMA", "price is 10% above the 20 EMA"
    const extMatch =
      seg.match(/(?:price\s*)?[>≥]?\s*([\d.]+)\s*%?\s*(?:extended\s+)?(above|below)\s+([\d]+)[\s-]*(?:day|d)?[\s-]*(?:period)?[\s-]*(ema|sma)/) ||
      seg.match(/(?:extended|ext)\s+([\d.]+)\s*%\s*(above|below)\s+([\d]+)[\s-]*(?:day|d)?[\s-]*(ema|sma)/) ||
      seg.match(/price\s+(?:is\s+)?(?:more\s+than\s+)?([\d.]+)\s*%\s*(above|below)\s+(?:the\s+)?([\d]+)[\s-]*(?:day|d)?[\s-]*(ema|sma)/);
    if (extMatch) {
      conditions.push({
        type: "price_extended_pct",
        direction: extMatch[2] as "above" | "below",
        value: parseFloat(extMatch[1]),
        lookback: parseInt(extMatch[3]),
        useEMA: extMatch[4] === "ema",
      });
      continue;
    }

    // ── Simple price above/below SMA (no extension %): "above 200dma", "above 50-day MA"
    const maMatch =
      seg.match(/(above|below)\s+([\d]+)[\s-]*(?:d|day)?[\s-]*(?:ma|sma|dma)/) ||
      seg.match(/(above|below)\s+([\d]+)[\s-]*(?:d|day)?[\s-]*(ema)(?!\s*[\d])/);
    if (maMatch) {
      conditions.push({
        type: "price_above_ma",
        direction: maMatch[1] as "above" | "below",
        value: 0,
        lookback: parseInt(maMatch[2]),
      });
      continue;
    }

    // ── Bollinger Band Width: "BB width above 0.1", "BBW > 0.15"
    const bbwMatch =
      seg.match(/(?:bb(?:and)?(?:\s*width)?|bbw)\s*(?:above|>|≥|expanded?)\s*([\d.]+)/) ||
      seg.match(/(?:bb(?:and)?(?:\s*width)?|bbw)\s*(?:below|<|≤|contracted?)\s*([\d.]+)/);
    if (bbwMatch) {
      const isAbove = /above|>|expanded/.test(seg);
      conditions.push({
        type: "bb_width",
        direction: isAbove ? "above" : "below",
        value: parseFloat(bbwMatch[1]),
      });
      continue;
    }

    // ── Bollinger Band position: "price above upper BB", "price below lower band"
    const bbPosMatch =
      seg.match(/price\s*(above|below)\s*(?:upper|lower)?\s*(?:bb|bollinger|band)/) ||
      seg.match(/(above|below)\s*(?:upper|lower)\s*(?:bb|band)/);
    if (bbPosMatch) {
      const rawDir = bbPosMatch[1];
      // "price above upper BB" → above; "price below lower BB" → below
      // Also handle "above lower BB" as below, etc.
      const lowerMentioned = /lower/.test(seg);
      const dir: "above" | "below" = lowerMentioned ? "below" : (rawDir === "above" ? "above" : "below");
      conditions.push({ type: "bb_position", direction: dir, value: 0 });
      continue;
    }

    // ── Gap up
    const gapMatch = seg.match(/gap\s*up\s*([\d.]+)\s*%/);
    if (gapMatch) {
      conditions.push({ type: "gap_up", value: parseFloat(gapMatch[1]) });
      continue;
    }

    // ── Volume surge
    const volMatch = seg.match(/vol(?:ume)?\s*(?:surge|spike|above|×|x)?\s*([\d.]+)\s*[×x]/);
    if (volMatch) {
      conditions.push({ type: "volume_surge", value: parseFloat(volMatch[1]) });
      continue;
    }

    // ── 52-week high/low
    if (/near\s*52.?w(?:eek)?\s*high/.test(seg)) {
      conditions.push({ type: "near_52w_high", value: 5 });
      continue;
    }
    if (/near\s*52.?w(?:eek)?\s*low/.test(seg)) {
      conditions.push({ type: "near_52w_low", value: 5 });
      continue;
    }
  }

  if (conditions.length === 0) return null;

  const group: ConditionGroup = { logic, conditions };
  return { ticker, group, label: buildGroupLabel(ticker, group) };
}
