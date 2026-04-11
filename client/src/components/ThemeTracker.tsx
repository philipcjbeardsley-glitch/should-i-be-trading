import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(decimals)}%`;
}

function changeColor(n: number): string {
  if (n > 0) return "#00d4a0";
  if (n < 0) return "#ff4d4d";
  return "var(--bb-text-dim)";
}

type TimePeriod = "today" | "oneWeek" | "oneMonth" | "threeMonth" | "ytd";
type SubTab = "themes" | "cotData" | "snapshot";
type SnapshotView = "sp500" | "thematic" | "country";

// COT Chart (simplified bar chart)
function COTChart({ data, selectedContract }: { data: any; selectedContract: string }) {
  const contract = data?.contracts?.find((c: any) => c.code === selectedContract);
  if (!contract) return <div className="font-mono" style={{ color: "var(--bb-text-faint)", padding: 20, textAlign: "center" }}>No data available</div>;

  const weeks = contract.weeks.slice(-52);
  const maxVal = Math.max(...weeks.map((w: any) => Math.max(Math.abs(w.commercials), Math.abs(w.largeSpeculators), Math.abs(w.smallSpeculators))));
  const maxOI = Math.max(...weeks.map((w: any) => w.openInterest));
  const chartH = 280;
  const barW = Math.max(4, Math.floor(700 / weeks.length) - 1);

  return (
    <div>
      <div className="font-mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--bb-text)", textAlign: "center", marginBottom: 16 }}>
        {contract.name} — {contract.code}
      </div>
      <div style={{ position: "relative", height: chartH + 40, overflowX: "auto", overflowY: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-end", height: chartH, gap: 1, minWidth: weeks.length * (barW + 1), position: "relative" }}>
          {/* Center line */}
          <div style={{ position: "absolute", top: chartH / 2, left: 0, right: 0, height: 1, background: "hsl(220 15% 20%)", zIndex: 1 }} />
          {/* OI line */}
          <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: chartH, zIndex: 2, pointerEvents: "none" }}>
            <polyline
              fill="none"
              stroke="#00d4a0"
              strokeWidth="1.5"
              opacity="0.6"
              points={weeks.map((w: any, i: number) => {
                const x = i * (barW + 1) + barW / 2;
                const y = chartH - (w.openInterest / maxOI) * chartH;
                return `${x},${y}`;
              }).join(" ")}
            />
          </svg>
          {weeks.map((w: any, i: number) => {
            const scale = (chartH / 2) / maxVal;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: barW, position: "relative", height: chartH }}>
                {/* Small speculators (yellow) */}
                <div style={{
                  position: "absolute",
                  bottom: w.smallSpeculators >= 0 ? chartH / 2 : undefined,
                  top: w.smallSpeculators < 0 ? chartH / 2 : undefined,
                  height: Math.abs(w.smallSpeculators) * scale,
                  width: barW,
                  background: "#ffe566",
                  opacity: 0.8,
                }} />
                {/* Large speculators (blue) */}
                <div style={{
                  position: "absolute",
                  bottom: w.largeSpeculators >= 0 ? chartH / 2 : undefined,
                  top: w.largeSpeculators < 0 ? chartH / 2 : undefined,
                  height: Math.abs(w.largeSpeculators) * scale,
                  width: barW,
                  background: "#4da6ff",
                  opacity: 0.7,
                }} />
                {/* Commercials (red) */}
                <div style={{
                  position: "absolute",
                  bottom: w.commercials >= 0 ? chartH / 2 : undefined,
                  top: w.commercials < 0 ? chartH / 2 : undefined,
                  height: Math.abs(w.commercials) * scale,
                  width: barW,
                  background: "#ff4d4d",
                  opacity: 0.7,
                }} />
              </div>
            );
          })}
        </div>
        {/* Date labels */}
        <div style={{ display: "flex", justifyContent: "space-between", minWidth: weeks.length * (barW + 1), paddingTop: 4 }}>
          {weeks.filter((_: any, i: number) => i % 8 === 0).map((w: any, i: number) => (
            <span key={i} className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>{w.date.slice(0, 7)}</span>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
        {[
          { color: "#ffe566", label: "Small Speculators" },
          { color: "#4da6ff", label: "Large Speculators" },
          { color: "#ff4d4d", label: "Commercials" },
          { color: "#00d4a0", label: "Open Interest" },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, background: l.color, borderRadius: l.label === "Open Interest" ? "50%" : 1, opacity: 0.8 }} />
            <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-dim)" }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ThemeTracker() {
  const [subTab, setSubTab] = useState<SubTab>("themes");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("today");
  const [snapshotView, setSnapshotView] = useState<SnapshotView>("sp500");
  const [cotContract, setCotContract] = useState("ES");

  const { data: themeData, isLoading: themesLoading } = useQuery<any>({
    queryKey: ["/api/themes"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/themes"); return res.json(); },
    refetchInterval: 60000, staleTime: 30000,
  });

  const { data: sectorData } = useQuery<any>({
    queryKey: ["/api/sectors", snapshotView],
    queryFn: async () => { const res = await apiRequest("GET", `/api/sectors/${snapshotView}`); return res.json(); },
    refetchInterval: 60000, staleTime: 30000,
    enabled: subTab === "snapshot",
  });

  const { data: cotData } = useQuery<any>({
    queryKey: ["/api/cot"],
    queryFn: async () => { const res = await apiRequest("GET", "/api/cot"); return res.json(); },
    staleTime: 300000,
    enabled: subTab === "cotData",
  });

  const timePeriods: { key: TimePeriod; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "oneWeek", label: "1W" },
    { key: "oneMonth", label: "1M" },
    { key: "threeMonth", label: "3M" },
    { key: "ytd", label: "YTD" },
  ];

  const snapshotViews: { key: SnapshotView; label: string }[] = [
    { key: "sp500", label: "S&P Sectors" },
    { key: "thematic", label: "Thematic ETFs" },
    { key: "country", label: "Country ETFs" },
  ];

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Sub-tab navigation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 2 }}>
          {(["themes", "cotData", "snapshot"] as SubTab[]).map(tab => {
            const labels: Record<SubTab, string> = { themes: "Theme Tracker", cotData: "COT Data", snapshot: "Market Snapshot" };
            return (
              <button
                key={tab}
                data-testid={`subtab-${tab}`}
                onClick={() => setSubTab(tab)}
                className="font-mono"
                style={{
                  fontSize: 10, padding: "6px 14px", borderRadius: 2, cursor: "pointer",
                  border: subTab === tab ? "1px solid var(--bb-green)" : "1px solid var(--bb-border)",
                  background: subTab === tab ? "rgba(0,212,160,0.1)" : "transparent",
                  color: subTab === tab ? "var(--bb-green)" : "var(--bb-text-dim)",
                  fontWeight: subTab === tab ? 600 : 400, letterSpacing: "0.06em",
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Time period toggle (for themes and snapshot) */}
        {subTab !== "cotData" && (
          <div style={{ display: "flex", gap: 2, background: "hsl(220 18% 9%)", padding: 2, borderRadius: 2, border: "1px solid var(--bb-border)" }}>
            {timePeriods.map(tp => (
              <button
                key={tp.key}
                data-testid={`period-${tp.key}`}
                onClick={() => setTimePeriod(tp.key)}
                className="font-mono"
                style={{
                  fontSize: 9, padding: "3px 10px", borderRadius: 2, cursor: "pointer", border: "none",
                  background: timePeriod === tp.key ? "#4da6ff" : "transparent",
                  color: timePeriod === tp.key ? "#0a1a14" : "var(--bb-text-faint)",
                  fontWeight: timePeriod === tp.key ? 700 : 400,
                }}
              >
                {tp.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Theme Tracker Table */}
      {subTab === "themes" && (
        <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
          {themesLoading ? (
            <div style={{ padding: 20 }}>
              {[...Array(10)].map((_, i) => <div key={i} className="skeleton" style={{ height: 24, marginBottom: 4 }} />)}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bb-border)" }}>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "left", padding: "8px 14px", letterSpacing: "0.1em" }}>THEME</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px", letterSpacing: "0.1em" }}>TODAY</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px", letterSpacing: "0.1em" }}>1W</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px", letterSpacing: "0.1em" }}>1M</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px", letterSpacing: "0.1em" }}>3M</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px", letterSpacing: "0.1em" }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {(themeData?.themes ?? []).map((theme: any) => {
                  const perfValue = theme[timePeriod];
                  const maxPerf = Math.max(...(themeData?.themes ?? []).map((t: any) => Math.abs(t[timePeriod])), 1);
                  const barWidth = Math.abs(perfValue) / maxPerf * 100;
                  return (
                    <tr key={theme.id} style={{ borderBottom: "1px solid hsl(220 15% 11%)", cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 15% 10%)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "8px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--bb-text)" }}>{theme.name}</span>
                          <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)" }}>{theme.symbol}</span>
                        </div>
                      </td>
                      {["today", "oneWeek", "oneMonth", "threeMonth", "ytd"].map(period => (
                        <td key={period} style={{ padding: "8px 14px", textAlign: "right", position: "relative" }}>
                          {period === timePeriod && (
                            <div style={{
                              position: "absolute", top: 4, bottom: 4, right: 14,
                              width: `${barWidth}%`, maxWidth: "90%",
                              background: theme[period] >= 0 ? "rgba(0,212,160,0.1)" : "rgba(255,77,77,0.1)",
                              borderRadius: 1,
                            }} />
                          )}
                          <span className="font-mono num" style={{ fontSize: 11, color: changeColor(theme[period]), position: "relative", zIndex: 1 }}>
                            {fmtPct(theme[period], 2)}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* COT Data */}
      {subTab === "cotData" && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <select
              data-testid="cot-contract-select"
              value={cotContract}
              onChange={e => setCotContract(e.target.value)}
              className="font-mono"
              style={{
                fontSize: 10, padding: "5px 10px", borderRadius: 2,
                background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
                color: "var(--bb-text)", cursor: "pointer", minWidth: 200,
              }}
            >
              {cotData?.contracts?.map((c: any) => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          {cotData ? <COTChart data={cotData} selectedContract={cotContract} /> : (
            <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="font-mono" style={{ color: "var(--bb-text-faint)" }}>Loading COT data...</span>
            </div>
          )}
        </div>
      )}

      {/* Market Snapshot */}
      {subTab === "snapshot" && (
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {snapshotViews.map(sv => (
              <button
                key={sv.key}
                data-testid={`snapshot-${sv.key}`}
                onClick={() => setSnapshotView(sv.key)}
                className="font-mono"
                style={{
                  fontSize: 10, padding: "5px 12px", borderRadius: 2, cursor: "pointer",
                  border: snapshotView === sv.key ? "1px solid #4da6ff" : "1px solid var(--bb-border)",
                  background: snapshotView === sv.key ? "rgba(77,166,255,0.15)" : "transparent",
                  color: snapshotView === sv.key ? "#4da6ff" : "var(--bb-text-dim)",
                  fontWeight: snapshotView === sv.key ? 600 : 400,
                }}
              >
                {sv.label}
              </button>
            ))}
          </div>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--bb-border)" }}>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "left", padding: "8px 14px", letterSpacing: "0.1em" }}>TICKER</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px" }}>TODAY</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px" }}>1W</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px" }}>1M</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px" }}>3M</th>
                  <th className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", textAlign: "right", padding: "8px 14px" }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {(sectorData?.sectors ?? []).map((s: any) => (
                  <tr key={s.symbol} style={{ borderBottom: "1px solid hsl(220 15% 11%)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "hsl(220 15% 10%)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "8px 14px" }}>
                      <span className="font-mono" style={{ fontSize: 11, fontWeight: 600, color: "var(--bb-text)" }}>{s.symbol}</span>
                    </td>
                    {["today", "oneWeek", "oneMonth", "threeMonth", "ytd"].map(p => (
                      <td key={p} className="font-mono num" style={{ fontSize: 11, textAlign: "right", padding: "8px 14px", color: changeColor(s[p]) }}>
                        {fmtPct(s[p], 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
