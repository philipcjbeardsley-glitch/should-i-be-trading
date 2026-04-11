import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function BiasTag({ bias }: { bias: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    Hawkish: { bg: "rgba(255,77,77,0.15)", text: "#ff4d4d" },
    Dovish: { bg: "rgba(0,212,160,0.15)", text: "#00d4a0" },
    Neutral: { bg: "rgba(255,255,255,0.08)", text: "hsl(210 8% 55%)" },
    Mixed: { bg: "rgba(160,100,255,0.15)", text: "#a064ff" },
    Tightening: { bg: "rgba(255,165,0,0.15)", text: "#ffa500" },
  };
  const c = colors[bias] ?? colors.Neutral;
  return (
    <span className="font-mono" style={{ fontSize: 9, padding: "2px 8px", borderRadius: 2, background: c.bg, color: c.text, fontWeight: 600, letterSpacing: "0.06em" }}>
      {bias}
    </span>
  );
}

// Donut chart for signal balance
function SignalDonut({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = [
    { key: "hawkish", color: "#ff4d4d", label: "Hawkish" },
    { key: "tightening", color: "#ffa500", label: "Tightening" },
    { key: "neutral", color: "hsl(210 8% 55%)", label: "Neutral" },
    { key: "mixed", color: "#a064ff", label: "Mixed" },
    { key: "dovish", color: "#00d4a0", label: "Dovish" },
  ];

  const size = 120;
  const r = 42;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {entries.map(e => {
          const pct = (counts[e.key] ?? 0) / total;
          const dash = circ * pct;
          const currentOffset = offset;
          offset += dash;
          return (
            <circle
              key={e.key}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={e.color} strokeWidth="18"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-currentOffset}
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {entries.map(e => (
          <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.color, flexShrink: 0 }} />
            <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-dim)", width: 80 }}>{e.label}</span>
            <span className="font-mono num" style={{ fontSize: 10, color: "var(--bb-text)" }}>{counts[e.key] ?? 0}/{total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Liquidity gauge ring
function GaugeRing({ value, label, color, size = 56 }: { value: number; label: string; color: string; size?: number }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value);
  return (
    <div style={{ position: "relative", width: size, height: size, textAlign: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(220 15% 14%)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span className="font-mono num" style={{ fontSize: 13, fontWeight: 600, color }}>{value.toFixed(2)}</span>
      </div>
      <span className="font-mono" style={{ fontSize: 7, color: "var(--bb-text-faint)", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}

export default function MacroIntelligence() {
  const [feedFilter, setFeedFilter] = useState<string>("All Signals");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/macro"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/macro");
      return res.json();
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 12, display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="panel">
            <div className="skeleton" style={{ height: 10, width: "40%", marginBottom: 10 }} />
            {[...Array(3)].map((_, j) => <div key={j} className="skeleton" style={{ height: 10, marginBottom: 6, width: `${60 + Math.random() * 30}%` }} />)}
          </div>
        ))}
      </div>
    );
  }

  const { indicators, signalBalance, bottomLine, liquidity, fiscal, feed } = data;

  const categories = ["All Signals", "Fed & Monetary", "Labor & Data", "Corporate", "Fiscal"];
  const filteredFeed = feedFilter === "All Signals" ? feed : feed.filter((f: any) => f.category === feedFilter);
  const categoryCounts: Record<string, number> = {};
  for (const f of feed) {
    categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
  }

  return (
    <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Key Indicator Tiles */}
      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "flex", gap: 6, minWidth: "max-content" }}>
          {Object.values(indicators).map((ind: any, i: number) => (
            <div key={i} className="panel" style={{ padding: "8px 12px", minWidth: 110, flexShrink: 0 }}>
              <div className="font-mono" style={{ fontSize: 7, color: "var(--bb-text-faint)", letterSpacing: "0.1em", marginBottom: 4 }}>
                {ind.label}
              </div>
              <div className="font-mono num" style={{
                fontSize: 16, fontWeight: 700, lineHeight: 1.2,
                color: ind.hot ? "#ff4d4d" : ind.trend === "up" ? "#ffa500" : ind.trend === "down" ? "#00d4a0" : "var(--bb-text)"
              }}>
                {ind.prefix ?? ""}{typeof ind.value === "number" ? ind.value.toFixed(1) : ind.value}{ind.unit ?? ""}
                {ind.trend === "up" && <span style={{ fontSize: 9, marginLeft: 3 }}>↑</span>}
                {ind.trend === "down" && <span style={{ fontSize: 9, marginLeft: 3 }}>↓</span>}
              </div>
              {ind.period && (
                <div className="font-mono" style={{ fontSize: 7, color: "var(--bb-text-faint)", marginTop: 2 }}>({ind.period})</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Signal Balance + Bottom Line row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
        {/* Signal Balance */}
        <div className="panel">
          <div className="panel-label">SIGNAL BALANCE</div>
          <div style={{ marginBottom: 8 }}>
            <span className="font-mono" style={{ fontSize: 12, color: "var(--bb-text)" }}>Leaning </span>
            <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: signalBalance.leaning === "Hawkish" ? "#ff4d4d" : "#00d4a0" }}>
              {signalBalance.leaning}
            </span>
          </div>
          <SignalDonut counts={signalBalance.counts} total={signalBalance.total} />
        </div>

        {/* Bottom Line */}
        <div className="panel">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ color: "#ffa500", fontSize: 14 }}>⚠</span>
            <span className="panel-label" style={{ marginBottom: 0, color: "#ff4d4d", fontWeight: 700, fontSize: 10 }}>BOTTOM LINE</span>
          </div>
          <div className="font-mono" style={{ fontSize: 11, lineHeight: 1.7, color: "var(--bb-text)" }}>
            {bottomLine.text}
          </div>
        </div>
      </div>

      {/* Liquidity Regime */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div className="panel-label" style={{ marginBottom: 0 }}>LIQUIDITY REGIME</div>
          <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{liquidity.percentile}th percentile (10yr)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
          <span className="font-mono" style={{
            fontSize: 24, fontWeight: 700, letterSpacing: "0.04em",
            color: liquidity.regime === "NEUTRAL" ? "#ffa500" : liquidity.regime === "TIGHT" ? "#ff4d4d" : "#00d4a0"
          }}>
            {liquidity.regime}
          </span>
          <GaugeRing value={liquidity.usScore} label="US Score" color="#4da6ff" />
          <GaugeRing value={liquidity.globalScore} label="Global Score" color="#a064ff" />
          <GaugeRing value={liquidity.composite} label="Composite" color="var(--bb-text-dim)" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* US Liquidity */}
          <div>
            <div className="panel-label">US LIQUIDITY</div>
            {Object.entries(liquidity.usLiquidity).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = {
                nfci: "NFCI", anfci: "ANFCI", fedBalanceSheet: "Fed Balance Sheet",
                bankReserves: "Bank Reserves", onRrp: "ON RRP", tgaBalance: "TGA Balance",
                hyOas: "HY OAS", igBbbOas: "IG BBB OAS",
              };
              const isSpread = key === "hyOas" || key === "igBbbOas";
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: typeof val === "number" && val < 0 ? "#00d4a0" : "#ffa500" }} />
                    <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)" }}>{labels[key] ?? key}</span>
                  </div>
                  <span className="font-mono num" style={{ fontSize: 10, color: "var(--bb-text)" }}>
                    {typeof val === "number" ? (isSpread ? `${val} bps` : val.toFixed(2)) : val}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Global Liquidity */}
          <div>
            <div className="panel-label">GLOBAL LIQUIDITY</div>
            {Object.entries(liquidity.globalLiquidity).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = {
                usdFxCredit: "USD FX Credit Growth", eurFxCredit: "EUR FX Credit Growth",
                jpyFxCredit: "JPY FX Credit Growth", crossBorderCredit: "Cross-Border Bank Credit",
                nbfiCredit: "NBFI Credit Growth",
              };
              const isPositive = String(val).includes("+");
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: isPositive ? "#00d4a0" : "#ff4d4d" }} />
                    <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)" }}>{labels[key] ?? key}</span>
                  </div>
                  <span className="font-mono num" style={{ fontSize: 10, color: isPositive ? "#00d4a0" : "#ff4d4d" }}>{val}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* US Fiscal Health */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div className="panel-label" style={{ marginBottom: 0 }}>U.S. FISCAL HEALTH</div>
          <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>CBO Feb 2026 / Daily Treasury Statement</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          {/* Debt Overview */}
          <div>
            <div className="panel-label">DEBT OVERVIEW</div>
            {Object.entries(fiscal.debtOverview).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = {
                totalDebt: "Total U.S. Debt", dailyGrowth: "Daily Debt Growth",
                grossDebtGdp: "Gross Debt / GDP", publicDebtGdp: "Public Debt / GDP",
                cboDeficit: "CBO Deficit (FY26)", deficitGdp: "Deficit / GDP",
              };
              const isRed = String(val).includes("T") || String(val).includes("B") || String(val).includes("%");
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
                  <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{labels[key] ?? key}</span>
                  <span className="font-mono num" style={{ fontSize: 10, fontWeight: 500, color: "#ff4d4d" }}>{val}</span>
                </div>
              );
            })}
          </div>
          {/* Revenue & Spending */}
          <div>
            <div className="panel-label">REVENUE & SPENDING</div>
            {Object.entries(fiscal.revenueSpending).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = {
                federalRevenues: "Federal Revenues", revenueGdp: "Revenues / GDP",
                federalOutlays: "Federal Outlays", outlaysGdp: "Outlays / GDP",
                revenueOutlayRatio: "Revenue/Outlay Ratio", primaryDeficit: "Primary Deficit",
              };
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
                  <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{labels[key] ?? key}</span>
                  <span className="font-mono num" style={{ fontSize: 10, color: String(val).includes("T") ? "#ff4d4d" : "var(--bb-text)" }}>{val}</span>
                </div>
              );
            })}
          </div>
          {/* Interest Burden */}
          <div>
            <div className="panel-label">INTEREST BURDEN</div>
            {Object.entries(fiscal.interestBurden).map(([key, val]: [string, any]) => {
              const labels: Record<string, string> = {
                netInterestCost: "Net Interest Cost", interestOutlays: "Interest / Outlays",
                interestGdp: "Interest / GDP",
              };
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid hsl(220 15% 13%)" }}>
                  <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>{labels[key] ?? key}</span>
                  <span className="font-mono num" style={{ fontSize: 10, fontWeight: 500, color: "#ff4d4d" }}>{val}</span>
                </div>
              );
            })}
            {/* GDP bar chart */}
            <div style={{ marginTop: 12 }}>
              <div className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", marginBottom: 6 }}>% OF GDP</div>
              {[
                { label: "Revenue", pct: 17.5, color: "#00d4a0" },
                { label: "Outlays", pct: 23.3, color: "#ff4d4d" },
                { label: "Deficit", pct: 5.8, color: "#a064ff" },
              ].map(bar => (
                <div key={bar.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", width: 50 }}>{bar.label}</span>
                  <div style={{ flex: 1, height: 12, background: "hsl(220 15% 13%)", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(bar.pct / 25) * 100}%`, background: bar.color, transition: "width 1s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Intelligence Feed */}
      <div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {categories.map(cat => {
            const count = cat === "All Signals" ? feed.length : (categoryCounts[cat] ?? 0);
            const isActive = feedFilter === cat;
            return (
              <button
                key={cat}
                data-testid={`feed-filter-${cat.toLowerCase().replace(/[^a-z]/g, '-')}`}
                onClick={() => setFeedFilter(cat)}
                className="font-mono"
                style={{
                  fontSize: 10, padding: "5px 12px", borderRadius: 2, cursor: "pointer",
                  border: isActive ? "1px solid #4da6ff" : "1px solid var(--bb-border)",
                  background: isActive ? "rgba(77,166,255,0.15)" : "transparent",
                  color: isActive ? "#4da6ff" : "var(--bb-text-dim)",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                {cat} {count > 0 && <span style={{ opacity: 0.7 }}>{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="panel-label">INTELLIGENCE FEED · {filteredFeed.length} ITEMS</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {filteredFeed.map((item: any) => (
            <div key={item.id} className="panel" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--bb-text)" }}>{item.source}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>P{item.priority}</span>
                  <BiasTag bias={item.bias} />
                </div>
              </div>
              <div className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", marginBottom: 6 }}>
                {item.date}{item.time ? ` — ${item.time}` : ""}{item.location ? ` · ${item.location}` : ""}
              </div>
              <div className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", marginBottom: 6 }}>{item.title}</div>
              <div className="font-mono" style={{ fontSize: 10, lineHeight: 1.6, color: "var(--bb-text)", marginBottom: 8 }}>
                {item.body}
              </div>
              {item.implication && (
                <div className="font-mono" style={{ fontSize: 9, lineHeight: 1.5, color: item.bias === "Hawkish" || item.bias === "Tightening" ? "#ff4d4d" : item.bias === "Dovish" ? "#00d4a0" : "#ffa500" }}>
                  ↳ {item.implication}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
