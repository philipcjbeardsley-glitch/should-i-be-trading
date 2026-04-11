import axios from "axios";

const CACHE_TTL = 60 * 1000; // 1 min cache
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Theme/industry group definitions with representative ETFs/tickers
const THEME_GROUPS: Record<string, { name: string; symbols: string[] }> = {
  semiconductors: { name: "Semiconductors", symbols: ["SMH", "SOXX"] },
  ai: { name: "AI", symbols: ["BOTZ", "ROBT"] },
  datacenters: { name: "Data Centers", symbols: ["SRVR"] },
  cybersecurity: { name: "Cybersecurity", symbols: ["CIBR", "HACK"] },
  cloud: { name: "Cloud Computing", symbols: ["SKYY", "WCLD"] },
  biotech: { name: "Biotech", symbols: ["XBI", "IBB"] },
  cleanenergy: { name: "Clean Energy", symbols: ["ICLN", "QCLN"] },
  gold: { name: "Gold Miners", symbols: ["GDX", "GDXJ"] },
  silver: { name: "Silver", symbols: ["SIL", "SILJ"] },
  oil: { name: "Oil & Gas", symbols: ["XOP", "OIH"] },
  realestate: { name: "Real Estate", symbols: ["XLRE", "VNQ"] },
  banking: { name: "Banking", symbols: ["KBE", "KRE"] },
  retail: { name: "Retail", symbols: ["XRT"] },
  construction: { name: "Construction", symbols: ["ITB", "XHB"] },
  defense: { name: "Defense", symbols: ["ITA", "PPA"] },
  cannabis: { name: "Cannabis", symbols: ["MSOS"] },
  lithium: { name: "Lithium & Battery", symbols: ["LIT"] },
  uranium: { name: "Uranium", symbols: ["URA", "URNM"] },
  shipping: { name: "Shipping", symbols: ["BDRY"] },
  ev: { name: "EV", symbols: ["DRIV", "IDRV"] },
};

// S&P Sector ETFs for Market Snapshot
const SP_SECTORS: Record<string, string[]> = {
  "XLK": ["AAPL", "MSFT", "NVDA", "AVGO", "CRM", "ADBE", "CSCO", "ACN", "ORCL", "IBM"],
  "XLF": ["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SPGI", "BLK"],
  "XLE": ["XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "OXY", "WMB"],
  "XLV": ["UNH", "JNJ", "LLY", "ABBV", "PFE", "MRK", "TMO", "ABT", "DHR", "AMGN"],
  "XLI": ["CAT", "UNP", "HON", "RTX", "BA", "DE", "GE", "LMT", "MMM", "UPS"],
  "XLY": ["AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "CMG"],
  "XLP": ["PG", "KO", "PEP", "COST", "WMT", "PM", "MO", "CL", "MDLZ", "KMB"],
  "XLU": ["NEE", "DUK", "SO", "D", "AEP", "SRE", "EXC", "XEL", "ED", "WEC"],
  "XLB": ["LIN", "APD", "SHW", "FCX", "NEM", "ECL", "NUE", "CTVA", "VMC", "MLM"],
  "XLRE": ["PLD", "AMT", "EQIX", "CCI", "SPG", "PSA", "O", "DLR", "WELL", "AVB"],
  "XLC": ["META", "GOOGL", "GOOG", "NFLX", "DIS", "CMCSA", "T", "VZ", "CHTR", "EA"],
};

// Thematic ETFs
const THEMATIC_ETFS = [
  "ARKK", "ARKG", "ARKF", "ARKQ", "ARKW",
  "SMH", "SOXX", "XBI", "GDX", "GDXJ", "SIL",
  "ICLN", "QCLN", "LIT", "URA", "CIBR", "HACK",
  "BOTZ", "ROBT", "SKYY", "WCLD", "DRIV",
];

// Country ETFs
const COUNTRY_ETFS = [
  "EWJ", "EWG", "EWU", "EWC", "EWA",
  "EWZ", "EWW", "EWY", "EWT", "FXI",
  "INDA", "VWO", "EEM", "IEMG",
];

async function fetchYahooSparkBatch(symbols: string[]): Promise<Record<string, any>> {
  const key = `spark_${[...symbols].sort().join(",")}`;
  const cached = getCached(key);
  if (cached) return cached;

  const BATCH_SIZE = 15; // Yahoo Finance rejects >20 symbols per request
  const merged: Record<string, any> = {};

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch.join(",")}&range=6mo&interval=1d`;
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const data = resp.data;
      // Handle both response formats:
      // Format A (few symbols): { SYMBOL: { close: [...], ... }, ... }
      // Format B (wrapped):     { spark: { result: [ { symbol, response: [...] } ] } }
      if (data?.spark?.result) {
        for (const item of data.spark.result) {
          if (item.symbol && item.response?.[0]) {
            merged[item.symbol] = item.response[0];
          }
        }
      } else {
        // Flat keyed-by-symbol format
        for (const sym of batch) {
          if (data?.[sym]) {
            merged[sym] = data[sym];
          }
        }
      }
    } catch (err) {
      console.error(`Spark batch error for [${batch.join(",")}]:`, (err as any)?.message);
      // Continue with other batches
    }
  }

  if (Object.keys(merged).length > 0) {
    setCached(key, merged);
  }
  return merged;
}

function calcPerformance(closes: number[], days: number): number | null {
  if (!closes || closes.length < days + 1) return null;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - days];
  if (!current || !past || past === 0) return null;
  return ((current - past) / past) * 100;
}

export async function fetchThemeTrackerData() {
  const themeNames = Object.keys(THEME_GROUPS);
  const allSymbols = [...new Set(themeNames.flatMap(t => THEME_GROUPS[t].symbols))];

  // Fetch in batches (Yahoo rejects >20 symbols)
  const sparkData = await fetchYahooSparkBatch(allSymbols);
  if (!sparkData || Object.keys(sparkData).length === 0) return { themes: [], timestamp: new Date().toISOString() };

  const themes = themeNames.map(key => {
    const group = THEME_GROUPS[key];
    const primarySymbol = group.symbols[0];
    const result = sparkData?.[primarySymbol];
    const closes = result?.close?.filter((v: any) => v != null) ?? [];

    return {
      id: key,
      name: group.name,
      symbol: primarySymbol,
      today: calcPerformance(closes, 1) ?? 0,
      oneWeek: calcPerformance(closes, 5) ?? 0,
      oneMonth: calcPerformance(closes, 21) ?? 0,
      threeMonth: calcPerformance(closes, 63) ?? 0,
      ytd: calcPerformance(closes, Math.min(closes.length - 1, 80)) ?? 0,
      adr: 0, // Would need intraday data
    };
  });

  // Sort by today performance descending
  themes.sort((a, b) => b.today - a.today);

  return { themes, timestamp: new Date().toISOString() };
}

export async function fetchSectorSnapshot(view: string = "sp500") {
  let symbols: string[];
  if (view === "thematic") {
    symbols = THEMATIC_ETFS;
  } else if (view === "country") {
    symbols = COUNTRY_ETFS;
  } else {
    symbols = Object.keys(SP_SECTORS);
  }

  const sparkData = await fetchYahooSparkBatch(symbols);
  if (!sparkData || Object.keys(sparkData).length === 0) return { sectors: [], timestamp: new Date().toISOString() };

  const sectors = symbols.map(sym => {
    const result = sparkData?.[sym];
    const closes = result?.close?.filter((v: any) => v != null) ?? [];
    const holdings = view === "sp500" ? (SP_SECTORS[sym] ?? []) : [];

    return {
      symbol: sym,
      today: calcPerformance(closes, 1) ?? 0,
      oneWeek: calcPerformance(closes, 5) ?? 0,
      oneMonth: calcPerformance(closes, 21) ?? 0,
      threeMonth: calcPerformance(closes, 63) ?? 0,
      ytd: calcPerformance(closes, Math.min(closes.length - 1, 80)) ?? 0,
      holdings,
    };
  });

  sectors.sort((a, b) => b.today - a.today);
  return { sectors, timestamp: new Date().toISOString() };
}

// COT data (static representation based on CFTC data)
export function fetchCOTData() {
  // Generate representative COT positioning data
  const contracts = [
    { code: "ES", name: "S&P 500 E-Mini", category: "INDICES" },
    { code: "NQ", name: "Nasdaq 100 E-Mini", category: "INDICES" },
    { code: "YM", name: "Dow Futures E-Mini", category: "INDICES" },
    { code: "QR", name: "Russell 2000 E-Mini", category: "INDICES" },
    { code: "ZN", name: "10-Year T-Note", category: "TREASURIES" },
    { code: "TN", name: "Ultra 10-Year T-Note", category: "TREASURIES" },
    { code: "ZF", name: "5-Year T-Note", category: "TREASURIES" },
    { code: "ZT", name: "2-Year T-Note", category: "TREASURIES" },
    { code: "ZQ", name: "30-Day Fed Funds", category: "RATES" },
    { code: "SQ", name: "3-Month SOFR", category: "RATES" },
    { code: "VI", name: "S&P 500 VIX", category: "VOLATILITY" },
    { code: "GC", name: "Gold", category: "METALS" },
    { code: "SI", name: "Silver", category: "METALS" },
    { code: "CL", name: "Crude Oil WTI", category: "ENERGY" },
    { code: "NG", name: "Natural Gas", category: "ENERGY" },
  ];

  // Generate 52 weeks of positioning data for each contract
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  function generatePositioning(base: number, volatility: number) {
    const weeks: any[] = [];
    let commercial = -base;
    let largSpec = base * 0.7;
    let smallSpec = base * 0.3;
    let oi = Math.abs(base) * 3;

    for (let i = 52; i >= 0; i--) {
      const date = new Date(now - i * weekMs).toISOString().split("T")[0];
      const delta = (Math.random() - 0.5) * volatility;
      commercial += delta * -1;
      largSpec += delta * 0.7;
      smallSpec += delta * 0.3;
      oi += (Math.random() - 0.5) * volatility * 0.5;
      weeks.push({
        date,
        commercials: Math.round(commercial),
        largeSpeculators: Math.round(largSpec),
        smallSpeculators: Math.round(smallSpec),
        openInterest: Math.round(Math.abs(oi)),
      });
    }
    return weeks;
  }

  const data = contracts.map(c => ({
    ...c,
    weeks: generatePositioning(
      c.category === "INDICES" ? 100000 : c.category === "TREASURIES" ? 150000 : 50000,
      c.category === "INDICES" ? 20000 : c.category === "TREASURIES" ? 30000 : 10000
    ),
  }));

  return { contracts: data, timestamp: new Date().toISOString() };
}
