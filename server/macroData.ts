import axios from "axios";

const CACHE_TTL = 5 * 60 * 1000; // 5 min cache for macro data
const cache = new Map<string, { data: any; timestamp: number }>();

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

// FRED API (free, no key needed for basic series)
async function fetchFRED(seriesId: string): Promise<number | null> {
  const cached = getCached(`fred_${seriesId}`);
  if (cached !== null) return cached;
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=5`;
    const resp = await axios.get(url, { timeout: 8000 });
    const obs = resp.data?.observations;
    if (obs && obs.length > 0) {
      const val = parseFloat(obs[0].value);
      if (!isNaN(val)) {
        setCached(`fred_${seriesId}`, val);
        return val;
      }
    }
  } catch {}
  return null;
}

// Static macro indicator data (updated periodically)
function getStaticMacroIndicators() {
  return {
    fedFunds: { value: "3.50%-3.75%", label: "FED FUNDS", icon: "🏛", trend: "flat" },
    cpi: { value: 2.4, label: "CPI YoY", period: "Feb", icon: "📈", trend: "down" },
    coreCpi: { value: 2.5, label: "CORE CPI", period: "Feb", icon: "⊙", trend: "flat" },
    ppi: { value: 3.4, label: "PPI YoY", period: "Feb", icon: "🏭", trend: "up", hot: true },
    corePpi: { value: 3.5, label: "CORE PPI", period: "Feb", icon: "📊", trend: "up", hot: true },
    pce: { value: 2.8, label: "PCE YoY", period: "Jan", icon: "💳", trend: "flat" },
    corePce: { value: 3.1, label: "CORE PCE", period: "Jan", icon: "⊙", trend: "up", hot: true },
    unemployment: { value: 4.4, label: "UNEMPLOYMENT", period: "Feb", icon: "👷", trend: "up" },
    nfp: { value: -92, label: "NFP", period: "Feb", icon: "📋", trend: "down", unit: "K" },
    brentCrude: { value: 113, label: "BRENT CRUDE", icon: "🛢", trend: "up", prefix: "$" },
    sentiment: { value: 55.5, label: "SENTIMENT", icon: "❤", trend: "down" },
    deficit: { value: "1.9T", label: "DEFICIT", period: "CBO FY26 est", icon: "📂" },
  };
}

// Signal balance
function getSignalBalance() {
  return {
    leaning: "Hawkish",
    counts: {
      hawkish: 5,
      dovish: 2,
      neutral: 2,
      mixed: 2,
      tightening: 4,
    },
    total: 15,
  };
}

// Bottom line analysis
function getBottomLine() {
  return {
    text: "The macro picture is deteriorating on multiple fronts simultaneously. The S&P 500 closed below its 200-day moving average for the first time in 10 months. The Fed remains completely boxed in — hawkish on inflation, watching the labor market crack, and unable to respond to either.",
    highlights: [
      { text: "200-day moving average", color: "#ff4d4d" },
      { text: "boxed in", color: "#ffa500" },
    ],
  };
}

// Liquidity regime
function getLiquidityRegime() {
  return {
    regime: "NEUTRAL",
    usScore: 0.52,
    globalScore: 0.68,
    composite: 0.58,
    percentile: 55,
    usLiquidity: {
      nfci: -0.49,
      anfci: -0.47,
      fedBalanceSheet: "6.66T",
      bankReserves: "3.08T",
      onRrp: "$0.6B",
      tgaBalance: "$876B",
      hyOas: 320,
      igBbbOas: 113,
    },
    globalLiquidity: {
      usdFxCredit: "+7% YoY",
      eurFxCredit: "+11% YoY",
      jpyFxCredit: "+4% YoY",
      crossBorderCredit: "$45T (+10%)",
      nbfiCredit: "+13% YoY",
    },
  };
}

// US Fiscal Health
function getFiscalHealth() {
  return {
    debtOverview: {
      totalDebt: "$39.0T",
      dailyGrowth: "$7.23B/day",
      grossDebtGdp: "125%+ (gross)",
      publicDebtGdp: "101%",
      cboDeficit: "$1.9T (FY26 est)",
      deficitGdp: "5.8%",
    },
    revenueSpending: {
      federalRevenues: "$5.6T (FY26 est)",
      revenueGdp: "17.5%",
      federalOutlays: "$7.4T (FY26 est)",
      outlaysGdp: "23.3%",
      revenueOutlayRatio: "0.76x",
      primaryDeficit: "2.6% of GDP",
    },
    interestBurden: {
      netInterestCost: "$1.0T+ (FY26 est)",
      interestOutlays: "13.9%",
      interestGdp: "3.3%",
    },
  };
}

// Intelligence feed items
function getIntelligenceFeed() {
  return [
    {
      id: 1, source: "FOMC", category: "Fed & Monetary", priority: 1, bias: "Hawkish",
      date: "March 18, 2026", time: "2:00 PM ET", location: "Federal Reserve, Washington DC",
      title: "FOMC Decision",
      body: "FOMC voted 11-1 to hold rates at 3.50%-3.75%. Dot plot median unchanged: one 25bps cut in 2026. Hawkish shift — 14 of 19 officials now see zero or one cut. SEP raised PCE to 2.7%, GDP to 2.4%.",
      implication: "Distribution shifted hawkish — 14 of 19 see at most one cut, 7 see none. Inflation forecast raised.",
    },
    {
      id: 2, source: "Bureau of Labor Statistics", category: "Labor & Data", priority: 1, bias: "Hawkish",
      date: "March 18, 2026", time: "8:30 AM ET", location: "",
      title: "Producer Price Index Report (Feb data)",
      body: "Feb PPI surged +0.7% MoM, more than double +0.3% consensus and hottest since Aug 2023. YoY final demand PPI hit 3.4%. Core PPI ex food/energy/trade rose +0.5% MoM.",
      implication: "More than double expectations — removes any near-term case for Fed easing",
    },
    {
      id: 3, source: "Department of Labor", category: "Labor & Data", priority: 2, bias: "Neutral",
      date: "March 19, 2026", time: "8:30 AM ET", location: "",
      title: "Weekly Unemployment Insurance Claims Report",
      body: "Initial jobless claims fell 8,000 to 205,000 for week ending March 14 — lowest since January and below 215K consensus. Four-week average dipped to 210,750.",
      implication: "Layoffs contained but hiring frozen — claims low enough to keep Fed from cutting",
    },
    {
      id: 4, source: "Federal Reserve Board", category: "Fed & Monetary", priority: 2, bias: "Dovish",
      date: "March 19, 2026", time: "10:00 AM ET", location: "Washington DC",
      title: "Basel III Capital Requirements Proposal",
      body: "Fed unveiled three proposals to modernize Basel III capital requirements. Largest banks (JPMorgan, BofA) would see CET1 capital requirements fall 4.8%.",
      implication: "Easing bank capital requirements loosens financial conditions and supports credit availability",
    },
    {
      id: 5, source: "Census Bureau", category: "Labor & Data", priority: 2, bias: "Dovish",
      date: "March 19, 2026", time: "", location: "",
      title: "New Residential Sales Report (Jan data)",
      body: "New home sales plunged 17.6% MoM to 587,000 SAAR in January — lowest since October 2022. Collapse came despite lower mortgage rates.",
      implication: "Housing collapsing to multi-year lows supports case for eventual rate relief",
    },
    {
      id: 6, source: "University of Michigan", category: "Labor & Data", priority: 2, bias: "Hawkish",
      date: "March 13, 2026", time: "", location: "Surveys of Consumers",
      title: "Consumer Sentiment (Preliminary March)",
      body: "Consumer sentiment fell to 55.5, lowest of the year. Year-ahead inflation expectations stalled at 3.4%.",
      implication: "Elevated inflation expectations constrain Fed easing room",
    },
    {
      id: 7, source: "S&P 500 / Equity Markets", category: "Fed & Monetary", priority: 1, bias: "Tightening",
      date: "March 19-20, 2026", time: "", location: "NYSE",
      title: "S&P 500 Breaks Below 200-Day MA",
      body: "S&P 500 fell to 6,606 on March 19, closing below 200-day MA (6,615) for first time since May 2025. Fourth consecutive losing week.",
      implication: "Sustained break below 200-day MA, fourth losing week, recession probability repricing — risk-off regime strengthening",
    },
    {
      id: 8, source: "Iran War / Energy Crisis", category: "Fed & Monetary", priority: 1, bias: "Tightening",
      date: "March 19-20, 2026", time: "", location: "Persian Gulf / Global energy markets",
      title: "Iran War / Energy Crisis Escalation",
      body: "War intensified into Day 20. Israel struck 200+ targets across Iran. Gulf energy infrastructure under attack from both sides. Brent pulled back ~1.6% but still above $113.",
      implication: "Escalation continues with no ceasefire in sight — Netanyahu signaling prolonged campaign",
    },
    {
      id: 9, source: "Congressional Budget Office", category: "Fiscal", priority: 4, bias: "Neutral",
      date: "March 9-18, 2026", time: "", location: "",
      title: "Budget Outlook & IEEPA Impact Report",
      body: "FY2026 deficit projected at $1.9T (5.8% of GDP). Debt held by public at 101% of GDP, rising to 120% by 2036. Net interest over $1T/year.",
      implication: "Structural fiscal deterioration limits policy flexibility",
    },
    {
      id: 10, source: "US National Debt / Treasury", category: "Fiscal", priority: 1, bias: "Tightening",
      date: "March 17-18, 2026", time: "", location: "",
      title: "US Gross National Debt Crosses $39T",
      body: "US gross national debt crossed $39 trillion for the first time, confirmed in the Daily Treasury Statement. Added $1T in under 5 months. Net interest costs on track to exceed $1T in FY2026.",
      implication: "Debt trajectory unsustainable — acceleration points to fiscal dominance risk",
    },
    {
      id: 11, source: "HSBC / Goldman Sachs", category: "Fed & Monetary", priority: 2, bias: "Hawkish",
      date: "March 18-20, 2026", time: "", location: "Research notes / CNBC",
      title: "Wall Street Strategists Update",
      body: "HSBC: equity market pricing 35% recession probability. Goldman Sachs: market pullback could get worse, equities not pricing enough risk premium.",
      implication: "Rate cut expectations evaporate — HSBC sees no cuts",
    },
    {
      id: 12, source: "Super Micro Computer (SMCI)", category: "Corporate", priority: 3, bias: "Mixed",
      date: "March 19-20, 2026", time: "", location: "US Attorney SDNY / CNBC",
      title: "SMCI / DOJ Investigation",
      body: "SMCI co-founder charged with smuggling billions of dollars' worth of Nvidia-powered servers to China. Stock plunged 27% in premarket.",
      implication: "Enforcement action tightens tech export controls narrative",
    },
    {
      id: 13, source: "FedEx (FDX)", category: "Corporate", priority: 2, bias: "Mixed",
      date: "March 19, 2026", time: "After Close", location: "Q3 FY2026 Earnings Report",
      title: "FedEx Q3 Earnings Beat",
      body: "Beat decisively: adj EPS $5.25 vs $4.17 consensus (+26% beat), revenue $24.0B vs $23.5B. Raised FY2026 guidance.",
      implication: "Strong beat and raised guidance signal resilient shipping demand, but capex cuts suggest cost caution",
    },
  ];
}

export async function fetchMacroIntelligence() {
  const indicators = getStaticMacroIndicators();
  const signalBalance = getSignalBalance();
  const bottomLine = getBottomLine();
  const liquidity = getLiquidityRegime();
  const fiscal = getFiscalHealth();
  const feed = getIntelligenceFeed();

  // Try to fetch live NFCI from FRED
  const nfci = await fetchFRED("NFCI");
  if (nfci !== null) {
    liquidity.usLiquidity.nfci = nfci;
  }

  return {
    timestamp: new Date().toISOString(),
    indicators,
    signalBalance,
    bottomLine,
    liquidity,
    fiscal,
    feed,
  };
}
