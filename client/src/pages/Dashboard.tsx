import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { RefreshCw, Activity, TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, BarChart2, Globe, Layers, Brain, LineChart, Grid3x3, Crosshair } from "lucide-react";
import MacroIntelligence from "@/components/MacroIntelligence";
import ThemeTracker from "@/components/ThemeTracker";
import BreadthTab from "@/components/BreadthTab";
import SetupsTab from "@/components/SetupsTab";

// ─── Types ──────────────────────────────────────────────────────────────────
interface SectorData {
  symbol: string; price: number | null; change: number; perf5d: number; perf20d: number;
}
interface DashboardData {
  timestamp: string; decision: "YES" | "CAUTION" | "NO";
  marketQualityScore: number; execScore: number; analysis: string;
  volatility: { vix: { level: number; slope5d: number; percentile: number }; vvix: number | null; putCallEstimate: number; score: number; interpretation: string; direction: string; health: string };
  trend: { spy: { price: number | null; change: number; ma20: number | null; ma50: number | null; ma200: number | null }; qqq: { price: number | null; change: number; ma50: number | null }; rsi: number | null; regime: string; score: number; direction: string; health: string };
  breadth: { pctAbove20: number; pctAbove50: number; pctAbove200: number; adRatio: number; mcclellan: number; score: number; direction: string; health: string };
  momentum: { positiveSectors: number; sectorSpread: number; score: number; direction: string; health: string };
  macro: { tnx: { level: number | null; slope5d: number }; dxy: { level: number | null; slope5d: number }; fedStance: string; fomcNext: string | null; fomcDaysAway: number; fomcImminent: boolean; score: number; direction: string; health: string };
  sectors: SectorData[];
  topSectors: SectorData[];
  bottomSectors: SectorData[];
  scoring: { categories: { name: string; weight: number; score: number; weighted: number }[] };
  cached?: boolean;
}

type MainTab = "pulse" | "macro" | "themes" | "breadth" | "setups";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SECTOR_NAMES: Record<string, string> = {
  XLK: "Technology", XLF: "Financials", XLE: "Energy", XLV: "Healthcare",
  XLI: "Industrials", XLY: "Cons Disc", XLP: "Cons Staples", XLU: "Utilities",
  XLB: "Materials", XLRE: "Real Estate", XLC: "Comm Svcs"
};

function fmt(n: number | null | undefined, decimals = 2, prefix = ""): string {
  if (n == null) return "—";
  return `${prefix}${n.toFixed(decimals)}`;
}
function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(decimals)}%`;
}
function scoreColor(score: number): string {
  if (score >= 70) return "#00d4a0";
  if (score >= 50) return "#ffa500";
  return "#ff4d4d";
}
function healthColor(health: string): string {
  if (health === "healthy") return "var(--bb-green)";
  if (health === "weakening") return "var(--bb-amber)";
  return "var(--bb-red)";
}
function healthLabel(health: string): string {
  if (health === "healthy") return "HEALTHY";
  if (health === "weakening") return "WEAKENING";
  return "RISK-OFF";
}
function dirIcon(dir: string) {
  if (dir === "↑") return <TrendingUp size={12} className="text-bb-green inline" />;
  if (dir === "↓") return <TrendingDown size={12} className="text-bb-red inline" />;
  return <Minus size={12} className="text-bb-amber inline" />;
}
function changeColor(n: number): string {
  if (n > 0) return "var(--bb-green)";
  if (n < 0) return "var(--bb-red)";
  return "var(--bb-text-dim)";
}

// ─── Circular Score Ring ─────────────────────────────────────────────────────
function ScoreRing({ score, label, size = 180 }: { score: number; label: string; size?: number }) {
  const r = (size / 2) - 14;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const color = scoreColor(score);

  return (
    <div style={{ position: "relative", width: size, height: size }} className="mx-auto">
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(220 15% 14%)" strokeWidth="8" />
        <circle
          cx={size/2} cy={size/2} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          className="score-ring"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span className="font-mono num" style={{ fontSize: 38, fontWeight: 600, color, lineHeight: 1 }}>{score}</span>
        <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.1em", marginTop: 4 }}>{label}</span>
      </div>
    </div>
  );
}

// ─── Decision Badge ───────────────────────────────────────────────────────────
function DecisionBadge({ decision }: { decision: "YES" | "CAUTION" | "NO" }) {
  const map = {
    YES: { color: "#00d4a0", bg: "rgba(0,212,160,0.1)", border: "rgba(0,212,160,0.4)", glow: "glow-green", label: "YES — TRADE", sub: "Full position sizing · Press risk" },
    CAUTION: { color: "#ffa500", bg: "rgba(255,165,0,0.08)", border: "rgba(255,165,0,0.35)", glow: "glow-amber", label: "CAUTION", sub: "Half size · A+ setups only" },
    NO: { color: "#ff4d4d", bg: "rgba(255,77,77,0.08)", border: "rgba(255,77,77,0.35)", glow: "glow-red", label: "NO — STAY OUT", sub: "Preserve capital · Wait for clarity" },
  };
  const m = map[decision];
  return (
    <div style={{ border: `1px solid ${m.border}`, background: m.bg, borderRadius: 3, padding: "16px 28px", textAlign: "center" }}>
      <div className={`font-mono ${m.glow} num`} style={{ fontSize: 32, fontWeight: 700, color: m.color, letterSpacing: "0.06em" }}>{m.label}</div>
      <div className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-dim)", marginTop: 4, letterSpacing: "0.08em" }}>{m.sub}</div>
    </div>
  );
}

// ─── Panel Component ──────────────────────────────────────────────────────────
function Panel({ title, icon, score, direction, health, children }: {
  title: string; icon: React.ReactNode; score: number; direction: string; health: string; children: React.ReactNode;
}) {
  return (
    <div className="panel fade-in" data-testid={`panel-${title.toLowerCase().replace(/[^a-z]/g, '-')}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{ color: "var(--bb-text-faint)", flexShrink: 0 }}>{icon}</span>
          <span className="panel-label" style={{ marginBottom: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
          <span className="font-mono" style={{ fontSize: 8, color: healthColor(health), letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{healthLabel(health)}</span>
          <span style={{ color: "var(--bb-text-faint)", display: "flex", alignItems: "center" }}>{dirIcon(direction)}</span>
          <span className="font-mono num" style={{ fontSize: 13, fontWeight: 600, color: scoreColor(score) }}>{score}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Stat Row ─────────────────────────────────────────────────────────────────
function StatRow({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
      <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span className="font-mono num" style={{ fontSize: 11, color: valueColor ?? "var(--bb-text)", fontWeight: 500 }}>{value}</span>
        {sub && <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", marginLeft: 6 }}>{sub}</span>}
      </div>
    </div>
  );
}

// ─── Sector Bar ───────────────────────────────────────────────────────────────
function SectorBar({ sector, max }: { sector: SectorData; max: number }) {
  const pct = Math.abs(sector.perf5d);
  const width = max > 0 ? (pct / max) * 100 : 0;
  const color = sector.perf5d >= 0 ? "var(--bb-green)" : "var(--bb-red)";
  const isTop = sector.perf5d >= 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-dim)", width: 32, flexShrink: 0 }}>{sector.symbol}</span>
      <div style={{ flex: 1, height: 10, background: "hsl(220 15% 13%)", borderRadius: 1, overflow: "hidden" }}>
        <div className="bar-fill" style={{ height: "100%", width: `${width}%`, background: color, opacity: isTop ? 1 : 0.85, boxShadow: `0 0 4px ${color}55` }} />
      </div>
      <span className="font-mono num" style={{ fontSize: 9, color, width: 48, textAlign: "right", flexShrink: 0 }}>{fmtPct(sector.perf5d, 1)}</span>
    </div>
  );
}

// ─── Ticker Tape ─────────────────────────────────────────────────────────────
function TickerTape({ data }: { data: DashboardData }) {
  const items = [
    { sym: "SPY", val: fmt(data.trend.spy.price, 2), chg: data.trend.spy.change },
    { sym: "QQQ", val: fmt(data.trend.qqq.price, 2), chg: data.trend.qqq.change },
    { sym: "VIX", val: fmt(data.volatility.vix.level, 2), chg: -data.volatility.vix.slope5d / 10 },
    { sym: "TNX", val: `${fmt(data.macro.tnx.level, 2)}%`, chg: data.macro.tnx.slope5d },
    { sym: "DXY", val: fmt(data.macro.dxy.level, 2), chg: data.macro.dxy.slope5d },
    ...data.sectors.map(s => ({ sym: s.symbol, val: fmt(s.price, 2), chg: s.change })),
  ];
  const doubled = [...items, ...items];
  return (
    <div style={{ overflow: "hidden", background: "hsl(220 18% 7%)", borderBottom: "1px solid var(--bb-border)", height: 28, display: "flex", alignItems: "center" }}>
      <div className="ticker-scroll" style={{ display: "flex", gap: 0 }}>
        {doubled.map((item, i) => (
          <span key={i} className="font-mono num" style={{ fontSize: 10, padding: "0 14px", borderRight: "1px solid hsl(220 15% 14%)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: "var(--bb-text-faint)", letterSpacing: "0.06em" }}>{item.sym}</span>
            <span style={{ color: "var(--bb-text)", fontWeight: 500 }}>{item.val}</span>
            <span style={{ color: changeColor(item.chg) }}>{fmtPct(item.chg, 1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ padding: "20px", display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="panel">
          <div className="skeleton" style={{ height: 10, width: "40%", marginBottom: 10 }} />
          {[...Array(4)].map((_, j) => (
            <div key={j} className="skeleton" style={{ height: 10, marginBottom: 6, width: `${70 + Math.random() * 30}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Score Bar ────────────────────────────────────────────────────────────────
function ScoreBar({ category }: { category: { name: string; weight: number; score: number; weighted: number } }) {
  const color = scoreColor(category.score);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{category.name.toUpperCase()}</span>
        <div style={{ display: "flex", gap: 12 }}>
          <span className="font-mono num" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{category.weight}%</span>
          <span className="font-mono num" style={{ fontSize: 9, color }}>+{category.weighted}pts</span>
        </div>
      </div>
      <div style={{ height: 8, background: "hsl(220 15% 13%)", borderRadius: 1, overflow: "hidden" }}>
        <div className="bar-fill" style={{ height: "100%", width: `${category.score}%`, background: color, boxShadow: `0 0 6px ${color}44` }} />
      </div>
    </div>
  );
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────
type TradingMode = "swing" | "day";

// ─── Tab Config ───────────────────────────────────────────────────────────────
const TABS: { key: MainTab; label: string; icon: React.ReactNode }[] = [
  { key: "pulse", label: "Market Pulse", icon: <Activity size={12} /> },
  { key: "macro", label: "Macro Intelligence", icon: <Brain size={12} /> },
  { key: "themes", label: "Theme Tracker", icon: <LineChart size={12} /> },
  { key: "breadth", label: "Breadth", icon: <Grid3x3 size={12} /> },
  { key: "setups", label: "Setups", icon: <Crosshair size={12} /> },
];

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [mode, setMode] = useState<TradingMode>("swing");
  const [activeTab, setActiveTab] = useState<MainTab>("pulse");
  const [isUpdating, setIsUpdating] = useState(false);
  const refreshInterval = 45 * 1000;

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/dashboard");
      return res.json();
    },
    refetchInterval: refreshInterval,
    staleTime: 25 * 1000,
  });

  // Show brief "updating" flash on refetch
  useEffect(() => {
    if (dataUpdatedAt > 0) {
      setIsUpdating(true);
      const t = setTimeout(() => setIsUpdating(false), 1200);
      return () => clearTimeout(t);
    }
  }, [dataUpdatedAt]);

  const handleRefresh = () => {
    setIsUpdating(true);
    refetch().finally(() => setTimeout(() => setIsUpdating(false), 1200));
  };

  const lastUpdated = data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : "—";

  // Day mode adjustments — slightly tighter thresholds shown in UI label
  const modeLabel = mode === "swing" ? "SWING TRADING" : "DAY TRADING";

  const maxSectorMove = data ? Math.max(...data.sectors.map(s => Math.abs(s.perf5d)), 1) : 1;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(220 20% 6%)" }}>
      {/* ── Header ── */}
      <header style={{ background: "hsl(220 22% 7%)", borderBottom: "1px solid var(--bb-border)", padding: "0 14px", height: 46, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 10 }}>
        {/* Logo + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-label="Should I Be Trading logo">
            <rect x="1" y="1" width="24" height="24" rx="2" stroke="var(--bb-green)" strokeWidth="1.5" />
            <path d="M5 18 L9 12 L13 15 L18 8" stroke="var(--bb-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="18" cy="8" r="2" fill="var(--bb-green)" />
            <rect x="5" y="20" width="4" height="3" rx="0.5" fill="var(--bb-green)" opacity="0.5" />
            <rect x="11" y="17" width="4" height="6" rx="0.5" fill="var(--bb-green)" opacity="0.75" />
            <rect x="17" y="14" width="4" height="9" rx="0.5" fill="var(--bb-green)" />
          </svg>
          <div>
            <div className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--bb-text)", letterSpacing: "0.05em" }}>SHOULD I BE TRADING?</div>
            <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.1em" }}>MARKET INTELLIGENCE TERMINAL</div>
          </div>
        </div>

        {/* Center — mode toggle */}
        <div style={{ display: "flex", gap: 2, background: "hsl(220 18% 9%)", padding: 3, borderRadius: 3, border: "1px solid var(--bb-border)" }}>
          {(["swing","day"] as TradingMode[]).map(m => (
            <button
              key={m}
              data-testid={`mode-${m}`}
              onClick={() => setMode(m)}
              className="font-mono"
              style={{
                fontSize: 9, padding: "4px 12px", borderRadius: 2, cursor: "pointer", border: "none",
                background: mode === m ? "var(--bb-green)" : "transparent",
                color: mode === m ? "#0a1a14" : "var(--bb-text-faint)",
                fontWeight: mode === m ? 700 : 400, letterSpacing: "0.1em",
                transition: "all 0.15s ease",
              }}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Right — status + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: isUpdating ? "var(--bb-amber)" : error ? "var(--bb-red)" : "var(--bb-green)", display: "inline-block" }} />
            <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>
              {isUpdating ? "UPDATING" : error ? "ERROR" : "LIVE"}
            </span>
          </div>
          <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{lastUpdated}</span>
          <button
            data-testid="btn-refresh"
            onClick={handleRefresh}
            style={{ background: "none", border: "1px solid var(--bb-border)", borderRadius: 2, padding: "4px 6px", cursor: "pointer", color: "var(--bb-text-dim)", display: "flex", alignItems: "center" }}
          >
            <RefreshCw size={12} style={{ animation: isUpdating ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
      </header>

      {/* ── Ticker tape ── */}
      {data && <TickerTape data={data} />}

      {/* ── FOMC Alert Banner ── */}
      {data?.macro.fomcImminent && (
        <div style={{ background: "rgba(255,165,0,0.1)", borderBottom: "1px solid rgba(255,165,0,0.3)", padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <AlertTriangle size={12} style={{ color: "var(--bb-amber)" }} />
          <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-amber)", letterSpacing: "0.08em" }}>
            FOMC MEETING IN {data.macro.fomcDaysAway} DAY{data.macro.fomcDaysAway !== 1 ? "S" : ""} — REDUCE POSITION SIZE AND RISK AHEAD OF EVENT
          </span>
        </div>
      )}

      {/* ── Tab Navigation ── */}
      <div style={{ background: "hsl(220 22% 7%)", borderBottom: "1px solid var(--bb-border)", padding: "0 14px", display: "flex", gap: 0, flexShrink: 0, overflowX: "auto" }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            data-testid={`tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className="font-mono"
            style={{
              fontSize: 10, padding: "8px 16px", cursor: "pointer", border: "none",
              background: "transparent",
              color: activeTab === tab.key ? "var(--bb-green)" : "var(--bb-text-faint)",
              fontWeight: activeTab === tab.key ? 600 : 400,
              letterSpacing: "0.08em",
              borderBottom: activeTab === tab.key ? "2px solid var(--bb-green)" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ opacity: activeTab === tab.key ? 1 : 0.5 }}>{tab.icon}</span>
            {tab.label.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Main scrollable content ── */}
      <div style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain" }}>
        {/* Market Pulse tab (original dashboard) */}
        {activeTab === "pulse" && (
          <>
            {isLoading && <Skeleton />}
            {error && !data && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12 }}>
                <span style={{ color: "var(--bb-red)", fontSize: 12 }} className="font-mono">MARKET DATA UNAVAILABLE</span>
                <span style={{ color: "var(--bb-text-faint)", fontSize: 10 }} className="font-mono">Check connection or try refreshing</span>
                <button onClick={handleRefresh} className="font-mono" style={{ fontSize: 10, padding: "6px 14px", border: "1px solid var(--bb-border)", borderRadius: 2, background: "none", color: "var(--bb-text-dim)", cursor: "pointer" }}>RETRY</button>
              </div>
            )}
            {data && (
              <div style={{ padding: "12px 12px 20px", display: "grid", gap: 10, gridTemplateColumns: "repeat(12, 1fr)", gridAutoRows: "auto" }}>

                {/* ── Hero Panel — spans 4 cols ── */}
                <div className="panel fade-in" style={{ gridColumn: "span 4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 16px", gap: 12 }}>
                  <div className="panel-label" style={{ marginBottom: 0, alignSelf: "flex-start" }}>TRADING DECISION · {modeLabel}</div>
                  <DecisionBadge decision={data.decision} />
                  <ScoreRing score={data.marketQualityScore} label="MARKET QUALITY" size={160} />
                  <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                      <div className="font-mono num" style={{ fontSize: 22, fontWeight: 700, color: scoreColor(data.execScore) }}>{data.execScore}</div>
                      <div className="panel-label" style={{ marginBottom: 0 }}>EXEC WINDOW</div>
                    </div>
                    <div style={{ width: 1, height: 32, background: "var(--bb-border)" }} />
                    <div style={{ textAlign: "center" }}>
                      <div className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: data.trend.regime === "uptrend" ? "var(--bb-green)" : data.trend.regime === "downtrend" ? "var(--bb-red)" : "var(--bb-amber)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{data.trend.regime}</div>
                      <div className="panel-label" style={{ marginBottom: 0 }}>REGIME</div>
                    </div>
                  </div>
                </div>

                {/* ── Terminal Analysis ── */}
                <div className="panel fade-in" style={{ gridColumn: "span 8", display: "flex", flexDirection: "column", minHeight: 0, alignSelf: "start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Zap size={11} style={{ color: "var(--bb-text-faint)" }} />
                    <span className="panel-label" style={{ marginBottom: 0 }}>TERMINAL ANALYSIS</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: 11, lineHeight: 1.7, color: "var(--bb-text)", flex: 1 }}>
                    {data.analysis}
                  </div>
                  {/* Score summary chips */}
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {data.scoring.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: 5, background: "hsl(220 15% 12%)", border: "1px solid var(--bb-border)", borderRadius: 2, padding: "3px 8px" }}>
                        <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>{cat.name.toUpperCase().split("/")[0]}</span>
                        <span className="font-mono num" style={{ fontSize: 9, fontWeight: 600, color: scoreColor(cat.score) }}>{cat.score}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Volatility Panel ── */}
                <div style={{ gridColumn: "span 3" }}>
                <Panel title="Volatility" icon={<Activity size={11} />} score={data.volatility.score} direction={data.volatility.direction} health={data.volatility.health}>
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <div className="font-mono num" style={{ fontSize: 24, fontWeight: 700, color: scoreColor(data.volatility.score), lineHeight: 1 }}>{fmt(data.volatility.vix.level, 1)}</div>
                      <div className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>VIX — {data.volatility.interpretation.toUpperCase()}</div>
                    </div>
                    <StatRow label="VIX 5d Slope" value={fmtPct(data.volatility.vix.slope5d, 1)} valueColor={data.volatility.vix.slope5d > 0 ? "var(--bb-red)" : "var(--bb-green)"} />
                    <StatRow label="VIX Percentile (1yr)" value={`${data.volatility.vix.percentile}th`} />
                    {data.volatility.vvix && <StatRow label="VVIX" value={fmt(data.volatility.vvix, 1)} />}
                    <StatRow label="P/C Ratio Est." value={fmt(data.volatility.putCallEstimate, 2)} valueColor={data.volatility.putCallEstimate > 1.1 ? "var(--bb-red)" : "var(--bb-green)"} />
                  </div>
                </Panel>
                </div>

                {/* ── Trend Panel ── */}
                <div style={{ gridColumn: "span 3" }}>
                <Panel title="Trend & Structure" icon={<TrendingUp size={11} />} score={data.trend.score} direction={data.trend.direction} health={data.trend.health}>
                  <div>
                    <div style={{ marginBottom: 8, display: "flex", gap: 16 }}>
                      <div>
                        <div className="font-mono num" style={{ fontSize: 18, fontWeight: 700, color: data.trend.spy.change >= 0 ? "var(--bb-green)" : "var(--bb-red)", lineHeight: 1 }}>
                          {fmt(data.trend.spy.price, 2)}
                        </div>
                        <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>SPY {fmtPct(data.trend.spy.change, 1)}</div>
                      </div>
                      <div>
                        <div className="font-mono num" style={{ fontSize: 18, fontWeight: 700, color: data.trend.qqq.change >= 0 ? "var(--bb-green)" : "var(--bb-red)", lineHeight: 1 }}>
                          {fmt(data.trend.qqq.price, 2)}
                        </div>
                        <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>QQQ {fmtPct(data.trend.qqq.change, 1)}</div>
                      </div>
                    </div>
                    <StatRow label="SPY vs 20MA" value={data.trend.spy.ma20 ? (data.trend.spy.price ?? 0) > data.trend.spy.ma20 ? `✓ ${fmt(data.trend.spy.ma20, 2)}` : `✗ ${fmt(data.trend.spy.ma20, 2)}` : "—"} valueColor={(data.trend.spy.price ?? 0) > (data.trend.spy.ma20 ?? 0) ? "var(--bb-green)" : "var(--bb-red)"} />
                    <StatRow label="SPY vs 50MA" value={data.trend.spy.ma50 ? (data.trend.spy.price ?? 0) > data.trend.spy.ma50 ? `✓ ${fmt(data.trend.spy.ma50, 2)}` : `✗ ${fmt(data.trend.spy.ma50, 2)}` : "—"} valueColor={(data.trend.spy.price ?? 0) > (data.trend.spy.ma50 ?? 0) ? "var(--bb-green)" : "var(--bb-red)"} />
                    <StatRow label="SPY vs 200MA" value={data.trend.spy.ma200 ? (data.trend.spy.price ?? 0) > data.trend.spy.ma200 ? `✓ ${fmt(data.trend.spy.ma200, 2)}` : `✗ ${fmt(data.trend.spy.ma200, 2)}` : "—"} valueColor={(data.trend.spy.price ?? 0) > (data.trend.spy.ma200 ?? 0) ? "var(--bb-green)" : "var(--bb-red)"} />
                    <StatRow label="QQQ vs 50MA" value={data.trend.qqq.ma50 ? (data.trend.qqq.price ?? 0) > data.trend.qqq.ma50 ? `✓ ${fmt(data.trend.qqq.ma50, 2)}` : `✗ ${fmt(data.trend.qqq.ma50, 2)}` : "—"} valueColor={(data.trend.qqq.price ?? 0) > (data.trend.qqq.ma50 ?? 0) ? "var(--bb-green)" : "var(--bb-red)"} />
                    <StatRow
                      label="RSI (14d)"
                      value={fmt(data.trend.rsi, 1)}
                      valueColor={(data.trend.rsi ?? 50) > 70 ? "var(--bb-amber)" : (data.trend.rsi ?? 50) < 30 ? "var(--bb-red)" : "var(--bb-green)"}
                      sub={(data.trend.rsi ?? 50) > 70 ? "OVERBOUGHT" : (data.trend.rsi ?? 50) < 30 ? "OVERSOLD" : undefined}
                    />
                  </div>
                </Panel>
                </div>

                {/* ── Breadth Panel ── */}
                <div style={{ gridColumn: "span 3" }}>
                <Panel title="Market Breadth" icon={<BarChart2 size={11} />} score={data.breadth.score} direction={data.breadth.direction} health={data.breadth.health}>
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <span className="font-mono num" style={{ fontSize: 22, fontWeight: 700, color: scoreColor(data.breadth.pctAbove50), lineHeight: 1 }}>{data.breadth.pctAbove50}%</span>
                      <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", marginLeft: 6 }}>ABOVE 50MA</span>
                    </div>
                    {[
                      { label: "% Above 20MA", val: `${data.breadth.pctAbove20}%` },
                      { label: "% Above 50MA", val: `${data.breadth.pctAbove50}%` },
                      { label: "% Above 200MA", val: `${data.breadth.pctAbove200}%` },
                      { label: "A/D Ratio (est.)", val: fmt(data.breadth.adRatio, 2) },
                      { label: "McClellan Osc.", val: fmt(data.breadth.mcclellan, 0) },
                    ].map(r => (
                      <StatRow key={r.label} label={r.label} value={r.val} />
                    ))}
                  </div>
                </Panel>
                </div>

                {/* ── Momentum Panel ── */}
                <div style={{ gridColumn: "span 3" }}>
                <Panel title="Momentum & Participation" icon={<Zap size={11} />} score={data.momentum.score} direction={data.momentum.direction} health={data.momentum.health}>
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <span className="font-mono num" style={{ fontSize: 22, fontWeight: 700, color: scoreColor(Math.round(data.momentum.positiveSectors / 11 * 100)), lineHeight: 1 }}>{data.momentum.positiveSectors}<span style={{ fontSize: 12, fontWeight: 400 }}>/11</span></span>
                      <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", marginLeft: 6 }}>POSITIVE SECTORS</span>
                    </div>
                    <StatRow label="Sector Spread (5d)" value={fmtPct(data.momentum.sectorSpread, 1)} valueColor={data.momentum.sectorSpread < 8 ? "var(--bb-green)" : data.momentum.sectorSpread < 15 ? "var(--bb-amber)" : "var(--bb-red)"} />
                    <StatRow label="Leaders (5d)" value={data.topSectors.map(s=>s.symbol).join(", ")} valueColor="var(--bb-green)" />
                    <StatRow label="Laggards (5d)" value={data.bottomSectors.map(s=>s.symbol).join(", ")} valueColor="var(--bb-red)" />
                  </div>
                </Panel>
                </div>

                {/* ── Macro Panel ── */}
                <div style={{ gridColumn: "span 3" }}>
                <Panel title="Macro & Liquidity" icon={<Globe size={11} />} score={data.macro.score} direction={data.macro.direction} health={data.macro.health}>
                  <div>
                    <div style={{ marginBottom: 8, display: "flex", gap: 16 }}>
                      <div>
                        <div className="font-mono num" style={{ fontSize: 18, fontWeight: 700, color: data.macro.tnx.level && data.macro.tnx.slope5d > 0 ? "var(--bb-red)" : "var(--bb-green)", lineHeight: 1 }}>{fmt(data.macro.tnx.level, 2)}%</div>
                        <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>10YR YIELD</div>
                      </div>
                      <div>
                        <div className="font-mono num" style={{ fontSize: 18, fontWeight: 700, color: data.macro.dxy.slope5d > 0 ? "var(--bb-red)" : "var(--bb-green)", lineHeight: 1 }}>{fmt(data.macro.dxy.level, 2)}</div>
                        <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>DXY</div>
                      </div>
                    </div>
                    <StatRow label="TNX Trend (5d)" value={fmtPct(data.macro.tnx.slope5d, 1)} valueColor={data.macro.tnx.slope5d > 0 ? "var(--bb-red)" : "var(--bb-green)"} />
                    <StatRow label="DXY Trend (5d)" value={fmtPct(data.macro.dxy.slope5d, 1)} valueColor={data.macro.dxy.slope5d > 0 ? "var(--bb-red)" : "var(--bb-green)"} />
                    <StatRow label="Fed Stance" value={data.macro.fedStance.toUpperCase()} valueColor={data.macro.fedStance === "dovish" ? "var(--bb-green)" : data.macro.fedStance === "hawkish" ? "var(--bb-red)" : "var(--bb-amber)"} />
                    <StatRow label="FOMC Next" value={data.macro.fomcNext ?? "—"} sub={data.macro.fomcDaysAway < 99 ? `${data.macro.fomcDaysAway}d away` : undefined} valueColor={data.macro.fomcImminent ? "var(--bb-amber)" : undefined} />
                  </div>
                </Panel>
                </div>

                {/* ── Sector Heatmap ── */}
                <div className="panel fade-in" style={{ gridColumn: "span 6" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Layers size={11} style={{ color: "var(--bb-text-faint)" }} />
                    <span className="panel-label" style={{ marginBottom: 0 }}>SECTOR HEATMAP (5d PERFORMANCE)</span>
                  </div>
                  <div>
                    {[...data.sectors]
                      .sort((a, b) => b.perf5d - a.perf5d)
                      .map(s => (
                        <SectorBar key={s.symbol} sector={s} max={maxSectorMove} />
                      ))}
                  </div>
                </div>

                {/* ── Scoring Breakdown ── */}
                <div className="panel fade-in" style={{ gridColumn: "span 6" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <BarChart2 size={11} style={{ color: "var(--bb-text-faint)" }} />
                      <span className="panel-label" style={{ marginBottom: 0 }}>SCORE BREAKDOWN</span>
                    </div>
                    <div className="font-mono num" style={{ fontSize: 22, fontWeight: 700, color: scoreColor(data.marketQualityScore) }}>{data.marketQualityScore}<span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)" }}>/100</span></div>
                  </div>
                  {data.scoring.categories.map(cat => <ScoreBar key={cat.name} category={cat} />)}
                  <div style={{ marginTop: 12, padding: "8px 0", borderTop: "1px solid var(--bb-border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>EXECUTION WINDOW SCORE</span>
                      <span className="font-mono num" style={{ fontSize: 11, fontWeight: 600, color: scoreColor(data.execScore) }}>{data.execScore}/100</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--bb-text-faint)", lineHeight: 1.5 }}>
                      {data.execScore >= 70 ? "Breakouts holding · Pullbacks being bought · Follow-through evident" :
                       data.execScore >= 50 ? "Mixed execution · Selective setups recommended · Watch for volume" :
                       "Poor follow-through · Breakouts failing · Avoid new entries"}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </>
        )}

        {/* Macro Intelligence tab */}
        {activeTab === "macro" && <MacroIntelligence />}

        {/* Theme Tracker tab */}
        {activeTab === "themes" && <ThemeTracker />}

        {/* Breadth tab */}
        {activeTab === "breadth" && <BreadthTab />}

        {/* Setups tab */}
        {activeTab === "setups" && <SetupsTab />}
      </div>

      {/* ── Footer ── */}
      <footer style={{ background: "hsl(220 22% 7%)", borderTop: "1px solid var(--bb-border)", padding: "4px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>DATA: YAHOO FINANCE · FRED · CFTC · REFRESHES EVERY 45S · NOT FINANCIAL ADVICE</span>
        <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>SHOULD I BE TRADING? © 2026</span>
      </footer>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
