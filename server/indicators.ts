// ── Pure indicator functions ──────────────────────────────────────────────────
// All operate on number[] and return number[] aligned to the same index.
// null values indicate insufficient lookback.

export function SMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function EMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function RSI(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - values[j - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const ag = gains / period, al = losses / period;
    result[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return result;
}

export interface MACDResult { macd: number | null; signal: number | null; histogram: number | null; }
export function MACD(values: number[], fast = 12, slow = 26, sig = 9): MACDResult[] {
  const result: MACDResult[] = values.map(() => ({ macd: null, signal: null, histogram: null }));
  const emaFast = EMA(values, fast);
  const emaSlow = EMA(values, slow);
  const macdLine: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null
  );
  // Build signal from macdLine non-null values
  const firstNonNull = macdLine.findIndex(v => v !== null);
  if (firstNonNull < 0) return result;
  const macdNonNull = macdLine.slice(firstNonNull).filter((v): v is number => v !== null);
  const sigEMA = EMA(macdNonNull, sig);
  let sigIdx = 0;
  for (let i = firstNonNull; i < values.length; i++) {
    if (macdLine[i] === null) continue;
    result[i].macd = macdLine[i];
    result[i].signal = sigEMA[sigIdx] ?? null;
    if (result[i].macd !== null && result[i].signal !== null) {
      result[i].histogram = result[i].macd! - result[i].signal!;
    }
    sigIdx++;
  }
  return result;
}

export interface BBResult { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null; }
export function BollingerBands(values: number[], period = 20, stdDev = 2): BBResult[] {
  return values.map((_, i) => {
    if (i < period - 1) return { upper: null, middle: null, lower: null, bandwidth: null };
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    return { upper, middle: mean, lower, bandwidth: mean > 0 ? (upper - lower) / mean : null };
  });
}

export function ATR(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const tr = high.map((h, i) => {
    if (i === 0) return h - low[i];
    return Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  });
  return SMA(tr, period);
}

export interface StochResult { k: number | null; d: number | null; }
export function Stochastic(high: number[], low: number[], close: number[], kPeriod = 14, dPeriod = 3): StochResult[] {
  const k: (number | null)[] = close.map((c, i) => {
    if (i < kPeriod - 1) return null;
    const hh = Math.max(...high.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...low.slice(i - kPeriod + 1, i + 1));
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
  const kNums = k.map(v => v ?? 0);
  const d = SMA(kNums, dPeriod);
  return close.map((_, i) => ({ k: k[i], d: i < kPeriod + dPeriod - 2 ? null : d[i] }));
}

export function ROC(values: number[], period = 10): (number | null)[] {
  return values.map((v, i) => {
    if (i < period || !values[i - period]) return null;
    return ((v - values[i - period]) / values[i - period]) * 100;
  });
}

export function ZScore(values: number[], lookback = 252): (number | null)[] {
  return values.map((v, i) => {
    if (i < lookback - 1) return null;
    const slice = values.slice(i - lookback + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / lookback;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / lookback);
    return std === 0 ? 0 : (v - mean) / std;
  });
}

export function TrendPowerOscillator(
  high: number[], low: number[], close: number[], period = 20, smoothing = 10
): (number | null)[] {
  const raw: (number | null)[] = close.map((c, i) => {
    if (i < period - 1) return null;
    const hh = Math.max(...high.slice(i - period + 1, i + 1));
    const ll = Math.min(...low.slice(i - period + 1, i + 1));
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
  const nums = raw.map(v => v ?? 50);
  const smoothed = EMA(nums, smoothing);
  return close.map((_, i) => (raw[i] === null ? null : smoothed[i]));
}

// Normalize array to 0-1 range over trailing window
export function Normalize01(values: number[], window: number): (number | null)[] {
  return values.map((v, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    const mn = Math.min(...slice), mx = Math.max(...slice);
    return mx === mn ? 0.5 : (v - mn) / (mx - mn);
  });
}
