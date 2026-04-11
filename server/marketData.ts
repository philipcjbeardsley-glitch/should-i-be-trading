import axios from "axios";

const CACHE_TTL = 30 * 1000; // 30 seconds
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}

function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function yahooFetch(symbols: string[]) {
  const cacheKey = symbols.sort().join(",");
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.join(",")}&range=6mo&interval=1d`;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const data = resp.data;
    setCached(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

async function yahooQuote(symbols: string[]) {
  const cacheKey = `quote_${symbols.sort().join(",")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.join(",")}&range=5d&interval=1d`;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    setCached(cacheKey, resp.data);
    return resp.data;
  } catch {
    return null;
  }
}

async function fetchQuoteSummary(symbol: string) {
  const cacheKey = `summary_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=price,summaryDetail`;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    setCached(cacheKey, resp.data);
    return resp.data;
  } catch {
    return null;
  }
}

// Get OHLCV history for a symbol
async function fetchHistory(symbol: string, period = "6mo") {
  const cacheKey = `hist_${symbol}_${period}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${period}&interval=1d`;
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const result = resp.data?.chart?.result?.[0];
    setCached(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

// Calculate SMA from close prices
function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Calculate RSI
function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate 5-day slope (trend direction)
function slope5d(prices: number[]): number {
  if (prices.length < 5) return 0;
  const recent = prices.slice(-5);
  const first = recent[0], last = recent[recent.length - 1];
  return ((last - first) / first) * 100;
}

// Calculate percentile rank of value within array
function percentile(arr: number[], value: number): number {
  const below = arr.filter(v => v < value).length;
  return Math.round((below / arr.length) * 100);
}

export async function fetchAllMarketData() {
  const allSymbols = [
    "SPY", "QQQ", "^VIX", "^VVIX", "DX-Y.NYB",
    "^TNX", "XLK", "XLF", "XLE", "XLV", "XLI",
    "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC",
    "^GSPC", "^IXIC"
  ];

  // Fetch histories in parallel
  const histories = await Promise.all(
    allSymbols.map(s => fetchHistory(s).then(d => ({ symbol: s, data: d })))
  );

  const histMap: Record<string, any> = {};
  for (const { symbol, data } of histories) {
    histMap[symbol] = data;
  }

  // Helper: extract closing prices
  function closes(symbol: string): number[] {
    const h = histMap[symbol];
    if (!h?.indicators?.quote?.[0]?.close) return [];
    return h.indicators.quote[0].close.filter((v: any) => v !== null && !isNaN(v));
  }

  function currentPrice(symbol: string): number | null {
    const c = closes(symbol);
    return c.length > 0 ? c[c.length - 1] : null;
  }

  function dayChange(symbol: string): number | null {
    const c = closes(symbol);
    if (c.length < 2) return null;
    return ((c[c.length - 1] - c[c.length - 2]) / c[c.length - 2]) * 100;
  }

  // ---- VIX ----
  const vixPrices = closes("^VIX");
  const vixLevel = currentPrice("^VIX") ?? 20;
  const vvixLevel = currentPrice("^VVIX");
  const vixSlope = slope5d(vixPrices);
  const vixPercentile = vixPrices.length > 20 ? percentile(vixPrices, vixLevel) : 50;

  // Derived put/call estimate from VIX regime
  let putCallEstimate: number;
  if (vixLevel < 15) putCallEstimate = 0.75;
  else if (vixLevel < 20) putCallEstimate = 0.90;
  else if (vixLevel < 30) putCallEstimate = 1.1;
  else putCallEstimate = 1.35;

  // ---- SPY trend ----
  const spyPrices = closes("SPY");
  const spyPrice = currentPrice("SPY");
  const spy20 = sma(spyPrices, 20);
  const spy50 = sma(spyPrices, 50);
  const spy200 = sma(spyPrices, 200);
  const spyRSI = rsi(spyPrices);
  const spyChange = dayChange("SPY");

  // ---- QQQ ----
  const qqqPrices = closes("QQQ");
  const qqqPrice = currentPrice("QQQ");
  const qqq50 = sma(qqqPrices, 50);
  const qqqChange = dayChange("QQQ");

  // ---- Market Regime ----
  let regime: "uptrend" | "downtrend" | "chop" = "chop";
  if (spyPrice && spy20 && spy50 && spy200) {
    if (spyPrice > spy20 && spyPrice > spy50 && spyPrice > spy200) regime = "uptrend";
    else if (spyPrice < spy20 && spyPrice < spy50 && spyPrice < spy200) regime = "downtrend";
    else regime = "chop";
  }

  // ---- Treasury / Macro ----
  const tnxPrices = closes("^TNX");
  const tnxLevel = currentPrice("^TNX");
  const tnxSlope = slope5d(tnxPrices);
  const dxyPrices = closes("DX-Y.NYB");
  const dxyLevel = currentPrice("DX-Y.NYB");
  const dxySlope = slope5d(dxyPrices);

  // ---- Sectors ----
  const sectors = ["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"];
  const sectorData = sectors.map(s => {
    const c = closes(s);
    const price = currentPrice(s);
    const prev = c.length > 1 ? c[c.length - 2] : null;
    const chg = (price && prev) ? ((price - prev) / prev) * 100 : 0;
    // 5-day performance
    const perf5d = c.length >= 5 ? ((c[c.length-1] - c[c.length-5]) / c[c.length-5]) * 100 : chg;
    // 20-day performance
    const perf20d = c.length >= 20 ? ((c[c.length-1] - c[c.length-20]) / c[c.length-20]) * 100 : perf5d;
    return { symbol: s, price, change: chg, perf5d, perf20d };
  });

  const sortedSectors = [...sectorData].sort((a, b) => b.perf5d - a.perf5d);
  const top3 = sortedSectors.slice(0, 3);
  const bottom3 = sortedSectors.slice(-3);
  const sectorSpread = top3[0].perf5d - bottom3[2].perf5d;

  // ---- Breadth approximation ----
  // Use SPY vs its MAs as proxy for market breadth
  let pctAbove20 = 50, pctAbove50 = 50, pctAbove200 = 50;
  if (spyPrice && spy20) {
    // Scale from sector data
    const above20 = sectorData.filter(s => {
      const c = closes(s.symbol);
      const ma20 = sma(c, 20);
      return ma20 && currentPrice(s.symbol)! > ma20;
    }).length;
    const above50 = sectorData.filter(s => {
      const c = closes(s.symbol);
      const ma50 = sma(c, 50);
      return ma50 && currentPrice(s.symbol)! > ma50;
    }).length;
    const above200 = sectorData.filter(s => {
      const c = closes(s.symbol);
      const ma200 = sma(c, 200);
      return ma200 && currentPrice(s.symbol)! > ma200;
    }).length;
    pctAbove20 = Math.round((above20 / sectors.length) * 100);
    pctAbove50 = Math.round((above50 / sectors.length) * 100);
    pctAbove200 = Math.round((above200 / sectors.length) * 100);
  }

  // AD ratio estimate from SPY components
  const adRatio = spyChange ? (spyChange > 0 ? 1.2 + (spyChange * 0.1) : 0.8 + (spyChange * 0.1)) : 1.0;

  // McClellan Oscillator approximation
  const spySlope5 = slope5d(spyPrices);
  const spySlope20 = spyPrices.length >= 20 ? ((spyPrices[spyPrices.length-1] - spyPrices[spyPrices.length-20]) / spyPrices[spyPrices.length-20]) * 100 : 0;
  const mcclellan = Math.round((spySlope5 - spySlope20) * 10);

  // ---- Fed Stance (derived from rates) ----
  let fedStance: "hawkish" | "neutral" | "dovish" = "neutral";
  if (tnxLevel) {
    if (tnxLevel > 4.5 && tnxSlope > 0) fedStance = "hawkish";
    else if (tnxLevel < 3.5 && tnxSlope < 0) fedStance = "dovish";
    else fedStance = "neutral";
  }

  // ---- FOMC Calendar (next approximate meeting) ----
  const now = new Date();
  // 2025 FOMC dates
  const fomcDates = [
    new Date("2025-01-29"), new Date("2025-03-19"), new Date("2025-05-07"),
    new Date("2025-06-18"), new Date("2025-07-30"), new Date("2025-09-17"),
    new Date("2025-10-29"), new Date("2025-12-10"),
    new Date("2026-01-28"), new Date("2026-03-18"), new Date("2026-05-06"),
    new Date("2026-06-17"), new Date("2026-07-29"), new Date("2026-09-16"),
    new Date("2026-10-28"), new Date("2026-12-09"),
  ];
  const nextFomc = fomcDates.find(d => d >= now) ?? null;
  const fomcDaysAway = nextFomc ? Math.round((nextFomc.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 99;
  const fomcImminent = fomcDaysAway <= 3;

  // ---- SCORING ----
  // Volatility score (25%)
  let volScore = 100;
  if (vixLevel > 40) volScore = 10;
  else if (vixLevel > 30) volScore = 25;
  else if (vixLevel > 25) volScore = 45;
  else if (vixLevel > 20) volScore = 65;
  else if (vixLevel > 17) volScore = 80;
  else volScore = 95;
  // Penalize for rising VIX
  if (vixSlope > 10) volScore = Math.max(0, volScore - 20);
  else if (vixSlope > 5) volScore = Math.max(0, volScore - 10);

  // Trend score (20%)
  let trendScore = 50;
  if (regime === "uptrend") trendScore = 85;
  else if (regime === "downtrend") trendScore = 20;
  else trendScore = 45;
  // RSI adjustment
  if (spyRSI) {
    if (spyRSI > 70) trendScore = Math.max(0, trendScore - 10); // overbought
    if (spyRSI < 30) trendScore = Math.max(0, trendScore - 20); // oversold/panicking
    if (spyRSI >= 50 && spyRSI <= 65) trendScore = Math.min(100, trendScore + 5); // healthy momentum
  }

  // Breadth score (20%)
  let breadthScore = 50;
  breadthScore = Math.round((pctAbove20 * 0.3 + pctAbove50 * 0.4 + pctAbove200 * 0.3));
  if (adRatio > 1.5) breadthScore = Math.min(100, breadthScore + 10);
  if (adRatio < 0.7) breadthScore = Math.max(0, breadthScore - 10);

  // Momentum score (25%)
  let momentumScore = 50;
  const positiveSectors = sectorData.filter(s => s.perf5d > 0).length;
  momentumScore = Math.round((positiveSectors / sectors.length) * 100);
  if (sectorSpread < 5) momentumScore = Math.min(100, momentumScore + 10); // tight = orderly
  if (sectorSpread > 15) momentumScore = Math.max(0, momentumScore - 10); // wide = chaotic rotation
  // QQQ above 50 adds momentum
  if (qqqPrice && qqq50 && qqqPrice > qqq50) momentumScore = Math.min(100, momentumScore + 8);

  // Macro score (10%)
  let macroScore = 60;
  if (fedStance === "dovish") macroScore = 80;
  else if (fedStance === "hawkish") macroScore = 40;
  else macroScore = 65;
  if (tnxSlope > 5) macroScore = Math.max(0, macroScore - 15); // rates rising fast = bad
  if (dxySlope > 3) macroScore = Math.max(0, macroScore - 10); // dollar surging = risk-off
  if (fomcImminent) macroScore = Math.max(0, macroScore - 10);

  // Weighted Market Quality Score
  const marketQualityScore = Math.round(
    volScore * 0.25 +
    momentumScore * 0.25 +
    trendScore * 0.20 +
    breadthScore * 0.20 +
    macroScore * 0.10
  );

  // Execution Window Score (independent)
  let execScore = 50;
  // Breakouts holding: if SPY above all MAs and RSI 50-70
  if (regime === "uptrend" && spyRSI && spyRSI >= 50 && spyRSI <= 70) execScore += 20;
  if (regime === "downtrend") execScore -= 20;
  // Breadth supports execution
  if (pctAbove20 > 60) execScore += 15;
  else if (pctAbove20 < 40) execScore -= 15;
  // Low VIX = cleaner breakouts
  if (vixLevel < 18) execScore += 15;
  else if (vixLevel > 25) execScore -= 15;
  // Sector participation
  if (positiveSectors >= 8) execScore += 10;
  else if (positiveSectors <= 4) execScore -= 10;
  execScore = Math.max(0, Math.min(100, execScore));

  // Decision
  let decision: "YES" | "CAUTION" | "NO";
  if (marketQualityScore >= 80) decision = "YES";
  else if (marketQualityScore >= 60) decision = "CAUTION";
  else decision = "NO";

  // Generate AI terminal analysis
  const analysis = generateAnalysis({
    decision, marketQualityScore, execScore,
    regime, vixLevel, spyRSI: spyRSI ?? 50,
    pctAbove50, top3, bottom3, fedStance, fomcImminent
  });

  return {
    timestamp: new Date().toISOString(),
    decision,
    marketQualityScore,
    execScore,
    analysis,
    volatility: {
      vix: { level: Math.round(vixLevel * 100) / 100, slope5d: Math.round(vixSlope * 100) / 100, percentile: vixPercentile },
      vvix: vvixLevel ? Math.round(vvixLevel * 100) / 100 : null,
      putCallEstimate: Math.round(putCallEstimate * 100) / 100,
      score: volScore,
      interpretation: vixLevel < 15 ? "Complacent" : vixLevel < 20 ? "Calm" : vixLevel < 25 ? "Elevated" : vixLevel < 30 ? "Fearful" : "Extreme Fear",
      direction: vixSlope > 2 ? "↑" : vixSlope < -2 ? "↓" : "→",
      health: vixLevel < 20 ? "healthy" : vixLevel < 28 ? "caution" : "risk-off",
    },
    trend: {
      spy: { price: spyPrice, change: Math.round((spyChange ?? 0) * 100) / 100, ma20: spy20 ? Math.round(spy20 * 100) / 100 : null, ma50: spy50 ? Math.round(spy50 * 100) / 100 : null, ma200: spy200 ? Math.round(spy200 * 100) / 100 : null },
      qqq: { price: qqqPrice, change: Math.round((qqqChange ?? 0) * 100) / 100, ma50: qqq50 ? Math.round(qqq50 * 100) / 100 : null },
      rsi: spyRSI ? Math.round(spyRSI * 10) / 10 : null,
      regime,
      score: trendScore,
      direction: regime === "uptrend" ? "↑" : regime === "downtrend" ? "↓" : "→",
      health: regime === "uptrend" ? "healthy" : regime === "downtrend" ? "risk-off" : "weakening",
    },
    breadth: {
      pctAbove20,
      pctAbove50,
      pctAbove200,
      adRatio: Math.round(adRatio * 100) / 100,
      mcclellan,
      score: breadthScore,
      direction: pctAbove50 > 60 ? "↑" : pctAbove50 < 40 ? "↓" : "→",
      health: pctAbove50 > 60 ? "healthy" : pctAbove50 > 40 ? "weakening" : "risk-off",
    },
    momentum: {
      positiveSectors,
      sectorSpread: Math.round(sectorSpread * 100) / 100,
      score: momentumScore,
      direction: positiveSectors >= 7 ? "↑" : positiveSectors <= 4 ? "↓" : "→",
      health: positiveSectors >= 8 ? "healthy" : positiveSectors >= 5 ? "weakening" : "risk-off",
    },
    macro: {
      tnx: { level: tnxLevel ? Math.round(tnxLevel * 100) / 100 : null, slope5d: Math.round(tnxSlope * 100) / 100 },
      dxy: { level: dxyLevel ? Math.round(dxyLevel * 100) / 100 : null, slope5d: Math.round(dxySlope * 100) / 100 },
      fedStance,
      fomcNext: nextFomc?.toISOString().split("T")[0] ?? null,
      fomcDaysAway,
      fomcImminent,
      score: macroScore,
      direction: fedStance === "dovish" ? "↑" : fedStance === "hawkish" ? "↓" : "→",
      health: fedStance === "dovish" ? "healthy" : fedStance === "hawkish" ? "risk-off" : "weakening",
    },
    sectors: sectorData,
    topSectors: top3,
    bottomSectors: bottom3,
    scoring: {
      categories: [
        { name: "Volatility", weight: 25, score: volScore, weighted: Math.round(volScore * 0.25) },
        { name: "Momentum", weight: 25, score: momentumScore, weighted: Math.round(momentumScore * 0.25) },
        { name: "Trend", weight: 20, score: trendScore, weighted: Math.round(trendScore * 0.20) },
        { name: "Breadth", weight: 20, score: breadthScore, weighted: Math.round(breadthScore * 0.20) },
        { name: "Macro/Liquidity", weight: 10, score: macroScore, weighted: Math.round(macroScore * 0.10) },
      ]
    }
  };
}

function generateAnalysis(params: {
  decision: string;
  marketQualityScore: number;
  execScore: number;
  regime: string;
  vixLevel: number;
  spyRSI: number;
  pctAbove50: number;
  top3: any[];
  bottom3: any[];
  fedStance: string;
  fomcImminent: boolean;
}) {
  const {
    decision, marketQualityScore, execScore,
    regime, vixLevel, spyRSI, pctAbove50,
    top3, bottom3, fedStance, fomcImminent
  } = params;

  const regimeStr = regime === "uptrend" ? "established uptrend" : regime === "downtrend" ? "active downtrend" : "choppy, trendless environment";
  const vixStr = vixLevel < 16 ? "subdued" : vixLevel < 22 ? "moderate" : vixLevel < 30 ? "elevated" : "extreme";
  const breadthStr = pctAbove50 > 65 ? "expanding breadth" : pctAbove50 > 45 ? "mixed breadth" : "deteriorating breadth";
  const topNames = top3.map(s => s.symbol).join(", ");
  const bottomNames = bottom3.map(s => s.symbol).join(", ");
  const rsiStr = spyRSI > 70 ? "overbought" : spyRSI < 40 ? "oversold" : spyRSI > 55 ? "healthy bullish momentum" : "neutral";
  const fomcStr = fomcImminent ? " FOMC meeting imminent — reduce size and risk." : "";

  let base = `${regimeStr.charAt(0).toUpperCase() + regimeStr.slice(1)} with ${vixStr} volatility (VIX ${vixLevel.toFixed(1)}) and ${breadthStr} (${pctAbove50}% of sectors above 50d MA). RSI reading ${rsiStr}. Sector leadership in ${topNames}; laggards include ${bottomNames}. Fed stance is ${fedStance}.${fomcStr}`;

  if (decision === "YES") {
    return base + ` Conditions support full-size swing trades — favor ${topNames} setups with disciplined risk management.`;
  } else if (decision === "CAUTION") {
    return base + ` Take A+ setups only at half position size. Wait for confirmed breakouts with volume.`;
  } else {
    return base + ` Avoid new swing trades. Preserve capital. Wait for regime clarity before deploying risk.`;
  }
}
