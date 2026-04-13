import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect, useCallback } from "react";
import Plot from "react-plotly.js";

// ── BUG 5 FIX: Percentile-based color intensity ───────────────────────────────
// 0-10th:   fully saturated red
// 10-25th:  muted red (70% opacity equivalent)
// 25-45th:  dark muted warm
// 45-55th:  near-black neutral
// 55-75th:  dark muted green
// 75-90th:  muted green
// 90-100th: fully saturated green
function pctileColor(pct: number | undefined): { bg: string; text: string } {
  if (pct === undefined || pct === null) return { bg: "rgb(40,40,40)", text: "#4b5563" };
  if (pct >= 90) return { bg: "rgb(22,163,74)",   text: "#fff" };       // fully sat green
  if (pct >= 75) return { bg: "rgb(22,101,52)",   text: "#d1fae5" };    // muted green
  if (pct >= 55) return { bg: "rgb(20,56,30)",    text: "#6b7280" };    // dark muted green
  if (pct >= 45) return { bg: "rgb(18,18,22)",    text: "#374151" };    // near-black neutral
  if (pct >= 25) return { bg: "rgb(50,20,20)",    text: "#6b7280" };    // dark muted warm
  if (pct >= 10) return { bg: "rgb(120,27,27)",   text: "#fca5a5" };    // muted red
  return              { bg: "rgb(220,38,38)",     text: "#fff" };        // fully sat red
}

function sectorAdColor(val: number): { bg: string; text: string } {
  if (val >= 3.0)  return { bg: "rgb(22,163,74)",  text: "#fff" };
  if (val >= 1.8)  return { bg: "rgb(22,101,52)",  text: "#d1fae5" };
  if (val >= 1.0)  return { bg: "rgb(18,18,22)",   text: "#374151" };
  if (val >= 0.6)  return { bg: "rgb(120,27,27)",  text: "#fca5a5" };
  return               { bg: "rgb(220,38,38)",  text: "#fff" };
}

// ── Data cell: percentile-colored ────────────────────────────────────────────
function DC({
  pct, display, bold, small, overrideBg, overrideText,
}: {
  pct?: number; display: string | number;
  bold?: boolean; small?: boolean;
  overrideBg?: string; overrideText?: string;
}) {
  const { bg, text } = overrideBg
    ? { bg: overrideBg, text: overrideText ?? "#fff" }
    : pctileColor(pct);
  return (
    <td style={{
      background: bg,
      color: text,
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: small ? 9 : 10,
      fontWeight: bold ? 700 : 500,
      textAlign: "center",
      padding: "3px 5px",
      border: "1px solid #0a0f1a",
      whiteSpace: "nowrap",
    }}>
      {display}
    </td>
  );
}

const GRP_BORDER = "2px solid #1e3a5f";

// ── BUG 4 FIX: Composite Score Banner — score → sparkline → arrow → text ─────
function CompositeBanner({ composite, mcv, above20 }: {
  composite: any; mcv: number; above20: number;
}) {
  if (!composite) return null;
  const { score, trend5d, regimeSummary, scoreHistory } = composite;

  let bg: string, borderColor: string, label: string;
  if      (score >= 75) { bg = "#14532d"; borderColor = "#22c55e"; label = "EXTREMELY BULLISH"; }
  else if (score >= 55) { bg = "#166534"; borderColor = "#16a34a"; label = "BULLISH"; }
  else if (score >= 40) { bg = "#78350f"; borderColor = "#d97706"; label = "NEUTRAL"; }
  else if (score >= 25) { bg = "#7f1d1d"; borderColor = "#ef4444"; label = "BEARISH"; }
  else                  { bg = "#4c0519"; borderColor = "#9f1239"; label = "EXTREMELY BEARISH"; }

  const arrow = trend5d > 3 ? "↑" : trend5d < -3 ? "↓" : "→";
  const arrowColor = trend5d > 3 ? "#4ade80" : trend5d < -3 ? "#f87171" : "#94a3b8";

  let extras = "";
  if (mcv < -150) extras += " Oversold thrust conditions building.";
  if (above20 > 90) extras += " Short-term overbought, expect pullback.";

  const hist: number[] = (scoreHistory || []).slice(0, 7).reverse();

  return (
    <div style={{
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 4,
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexShrink: 0,
      boxShadow: `0 0 16px ${borderColor}33`,
      width: "100%",
      boxSizing: "border-box",
    }}>
      {/* Big score number */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 56, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>/100</span>
      </div>

      {/* BUG 4 FIX: Sparkline immediately right of score */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>7D TREND</div>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 28 }}>
          {hist.map((s: number, i: number) => {
            const isLast = i === hist.length - 1;
            const h = Math.max(3, Math.round((Math.min(100, s) / 100) * 28));
            return (
              <div key={i} style={{
                width: 7,
                background: isLast ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
                height: `${h}px`,
                borderRadius: 1,
              }} />
            );
          })}
        </div>
      </div>

      {/* Trend arrow */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 26, color: arrowColor, lineHeight: 1 }}>{arrow}</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "rgba(255,255,255,0.45)" }}>
          {trend5d > 0 ? "+" : ""}{trend5d} vs 5d
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 50, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />

      {/* Label + text summary */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "rgba(255,255,255,0.75)", marginBottom: 5 }}>
          {label}
        </div>
        <div style={{ fontFamily: "IBM Plex Sans, sans-serif", fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.55 }}>
          {regimeSummary}{extras && <span style={{ color: "rgba(255,255,255,0.65)", fontStyle: "italic" }}>{extras}</span>}
        </div>
      </div>
    </div>
  );
}

// ── ZBT Banner ────────────────────────────────────────────────────────────────
function ZbtBanner({ zbtStatus }: { zbtStatus: any }) {
  if (!zbtStatus?.building && !zbtStatus?.signal) return null;
  const { building, progress, signal, value } = zbtStatus;

  if (signal) {
    return (
      <div style={{
        background: "#ca8a04", border: "2px solid #fbbf24", borderRadius: 4,
        padding: "12px 18px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
        boxShadow: "0 0 24px rgba(251,191,36,0.35)",
      }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, fontWeight: 700, color: "#000", letterSpacing: "0.1em", marginBottom: 2 }}>
            ZWEIG BREADTH THRUST TRIGGERED
          </div>
          <div style={{ fontFamily: "IBM Plex Sans, sans-serif", fontSize: 11, color: "#1c1407" }}>
            10-day EMA crossed above 0.615 from below 0.40 within 10 days. Among the most powerful breadth signals in technical analysis.
          </div>
        </div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 18, fontWeight: 700, color: "#000" }}>
          {value?.toFixed(3)}
        </div>
      </div>
    );
  }

  const pctVal = Math.min(100, Math.max(0, progress ?? 0));
  return (
    <div style={{ background: "#1a1005", border: "2px solid #ca8a04", borderRadius: 4, padding: "10px 16px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.1em" }}>
          ⚡ ZBT CONDITIONS BUILDING
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#92400e", flex: 1 }}>
          EMA was below 0.40 recently, now rising toward 0.615 — monitoring for thrust confirmation
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>
          {value?.toFixed(3)} / 0.615
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#d97706" }}>{pctVal}%</span>
      </div>
      <div style={{ background: "#2a1c05", borderRadius: 3, height: 8, width: "100%", overflow: "hidden", border: "1px solid #78350f" }}>
        <div style={{
          background: `linear-gradient(90deg, #92400e, #fbbf24)`,
          height: "100%", width: `${pctVal}%`, borderRadius: 3, transition: "width 0.4s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#78350f" }}>0.400</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#78350f" }}>0.615 (signal)</span>
      </div>
    </div>
  );
}

// ── ADD 2: Sector Breadth Heatmap ─────────────────────────────────────────────
function SectorHeatmap({ sectorBreadth }: { sectorBreadth: any[] }) {
  const [open, setOpen] = useState(true);
  if (!sectorBreadth.length) return null;

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700,
          color: "#475569", letterSpacing: "0.12em", marginBottom: open ? 8 : 0,
          background: "none", border: "none", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ fontSize: 9, color: "#334155" }}>{open ? "▼" : "▶"}</span>
        SECTOR BREADTH
      </button>
      {open && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap", width: "100%" }}>
            <thead>
              <tr>
                {["Sector", "% >5d MA", "% >20d MA", "% >50d MA", "% >200d MA", "5D A/D"].map((h, i) => (
                  <th key={h} style={{
                    background: "#0a1220", color: "#475569",
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700,
                    padding: "5px 10px", border: "1px solid #0a0f1a",
                    textAlign: i === 0 ? "left" : "center",
                    minWidth: i === 0 ? 140 : 80,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectorBreadth.map((s: any) => {
                // Use percentile-based coloring for MA cols (0-100 pct above = percentile proxy)
                const ma5Color   = pctileColor(s.ma5);
                const ma20Color  = pctileColor(s.ma20);
                const ma50Color  = pctileColor(s.ma50);
                const ma200Color = pctileColor(s.ma200);
                const adColor    = sectorAdColor(s.adRatio5d ?? 1);
                return (
                  <tr key={s.sym}>
                    <td style={{ background: "rgb(14,18,30)", color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, padding: "4px 10px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#334155", fontSize: 9, marginRight: 6 }}>{s.sym}</span>{s.name}
                    </td>
                    {[
                      { c: ma5Color,   v: `${s.ma5 ?? 0}%` },
                      { c: ma20Color,  v: `${s.ma20 ?? 0}%` },
                      { c: ma50Color,  v: `${s.ma50 ?? 0}%` },
                      { c: ma200Color, v: `${s.ma200 ?? 0}%` },
                      { c: adColor,    v: String(s.adRatio5d ?? "–") },
                    ].map(({ c, v }, ci) => (
                      <td key={ci} style={{
                        background: c.bg, color: c.text,
                        fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                        textAlign: "center", padding: "4px 10px",
                        border: "1px solid #0a0f1a", fontWeight: 500,
                      }}>{v}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── ADD 3: Two charts side by side ────────────────────────────────────────────
function BreadthCharts({ adLine, mcLine }: { adLine: any[]; mcLine: any[] }) {
  const [open, setOpen] = useState(true);
  if (!adLine.length && !mcLine.length) return null;

  const plotBg = "#060b14";
  const gridColor = "#0d1f35";
  const tickFont = { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" };
  const baseLayout: any = {
    paper_bgcolor: plotBg, plot_bgcolor: plotBg,
    margin: { l: 50, r: 50, t: 28, b: 36 },
    font: tickFont,
    xaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true },
    yaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1 },
    showlegend: true,
    legend: { font: { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" }, bgcolor: "rgba(0,0,0,0)", x: 0, y: 1.12, orientation: "h" },
    hovermode: "x unified",
  };

  // A/D Line MAs
  const adVals = adLine.map((d: any) => d.ad);
  const ad20 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 19), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });
  const ad50 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 49), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700,
          color: "#475569", letterSpacing: "0.12em", marginBottom: open ? 10 : 0,
          background: "none", border: "none", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <span style={{ fontSize: 9, color: "#334155" }}>{open ? "▼" : "▶"}</span>
        BREADTH CHARTS
      </button>
      {open && (
        <div style={{ display: "flex", gap: 12 }}>
          {/* Left: Cumulative A/D Line */}
          {adLine.length > 0 && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>
                CUMULATIVE A/D LINE + SPY
              </div>
              <Plot
                data={[
                  {
                    x: adLine.map((d: any) => d.date),
                    y: adVals,
                    type: "scatter", mode: "lines", name: "A/D Line",
                    line: { color: "#38bdf8", width: 2 },
                    yaxis: "y",
                    hovertemplate: "A/D: %{y:,.0f}<extra></extra>",
                  },
                  {
                    x: adLine.map((d: any) => d.date),
                    y: ad20,
                    type: "scatter", mode: "lines", name: "20d MA",
                    line: { color: "#eab308", width: 1.2, dash: "dot" },
                    yaxis: "y",
                    hovertemplate: "20d: %{y:,.0f}<extra></extra>",
                  },
                  {
                    x: adLine.map((d: any) => d.date),
                    y: ad50,
                    type: "scatter", mode: "lines", name: "50d MA",
                    line: { color: "#f97316", width: 1.2, dash: "dash" },
                    yaxis: "y",
                    hovertemplate: "50d: %{y:,.0f}<extra></extra>",
                  },
                  {
                    x: adLine.map((d: any) => d.date),
                    y: adLine.map((d: any) => d.spy),
                    type: "scatter", mode: "lines", name: "SPY",
                    line: { color: "#6b7280", width: 1 },
                    yaxis: "y2",
                    hovertemplate: "SPY: $%{y:.2f}<extra></extra>",
                  },
                ]}
                layout={{
                  ...baseLayout,
                  height: 220,
                  yaxis: { ...baseLayout.yaxis, title: { text: "A/D", font: { size: 9, color: "#38bdf8", family: "IBM Plex Mono, monospace" } } },
                  yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont, title: { text: "SPY", font: { size: 9, color: "#6b7280", family: "IBM Plex Mono, monospace" } } },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
          )}

          {/* Right: McClellan Oscillator */}
          {mcLine.length > 0 && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155", letterSpacing: "0.1em", marginBottom: 4 }}>
                McCLELLAN OSCILLATOR + SUMMATION
              </div>
              <Plot
                data={[
                  {
                    x: mcLine.map((d: any) => d.date),
                    y: mcLine.map((d: any) => d.osc),
                    type: "bar", name: "Osc",
                    marker: { color: mcLine.map((d: any) => d.osc >= 0 ? "#22c55e" : "#ef4444"), opacity: 0.85, line: { width: 0 } },
                    yaxis: "y",
                    hovertemplate: "Osc: %{y:.0f}<extra></extra>",
                  },
                  {
                    x: mcLine.map((d: any) => d.date),
                    y: mcLine.map((d: any) => d.sum),
                    type: "scatter", mode: "lines", name: "Summation",
                    line: { color: "#38bdf8", width: 1.5 },
                    yaxis: "y2",
                    hovertemplate: "Sum: %{y:.0f}<extra></extra>",
                  },
                ]}
                layout={{
                  ...baseLayout,
                  height: 220,
                  shapes: [
                    { type: "line", x0: 0, x1: 1, xref: "paper", y0: 100,  y1: 100,  yref: "y", line: { color: "#475569", dash: "dot",  width: 1 } },
                    { type: "line", x0: 0, x1: 1, xref: "paper", y0: -100, y1: -100, yref: "y", line: { color: "#475569", dash: "dot",  width: 1 } },
                    { type: "line", x0: 0, x1: 1, xref: "paper", y0: 150,  y1: 150,  yref: "y", line: { color: "#64748b", dash: "dash", width: 1 } },
                    { type: "line", x0: 0, x1: 1, xref: "paper", y0: -150, y1: -150, yref: "y", line: { color: "#64748b", dash: "dash", width: 1 } },
                  ],
                  annotations: [
                    { x: 1, xref: "paper", y: 100,  yref: "y", text: "+100", showarrow: false, font: { size: 8, color: "#475569", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                    { x: 1, xref: "paper", y: -100, yref: "y", text: "−100", showarrow: false, font: { size: 8, color: "#475569", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                    { x: 1, xref: "paper", y: 150,  yref: "y", text: "+150", showarrow: false, font: { size: 8, color: "#64748b", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                    { x: 1, xref: "paper", y: -150, yref: "y", text: "−150", showarrow: false, font: { size: 8, color: "#64748b", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                  ],
                  yaxis: { ...baseLayout.yaxis, title: { text: "Osc", font: { size: 9, color: "#64748b", family: "IBM Plex Mono, monospace" } } },
                  yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont, title: { text: "Sum", font: { size: 9, color: "#38bdf8", family: "IBM Plex Mono, monospace" } } },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Column header def ─────────────────────────────────────────────────────────
const COL_DEFS = [
  // grp, label, sub, key, firstInGrp
  { grp: 1, label: "1D A/D",   sub: "ratio",    key: "oneDayRatio",     first: true  },
  { grp: 1, label: "5D A/D",   sub: "ratio",    key: "fiveDayRatio",    first: false },
  { grp: 1, label: "Up Vol",   sub: "% daily",  key: "upVolPct",        first: false },
  { grp: 1, label: "Up Vol",   sub: "10d MA",   key: "upVolMa10",       first: false },
  { grp: 1, label: "Net NHs",  sub: "daily",    key: "netNewHighs",     first: false },
  { grp: 1, label: "NNH",      sub: "10d MA",   key: "netNewHighsMa10", first: false },
  // ADD 1: %>5d added as first in Group 2
  { grp: 2, label: ">5d MA",   sub: "%",        key: "above5dma",       first: true  },
  { grp: 2, label: ">20d MA",  sub: "%",        key: "above20dma",      first: false },
  { grp: 2, label: ">50d MA",  sub: "%",        key: "above50dma",      first: false },
  { grp: 2, label: ">200d MA", sub: "%",        key: "above200dma",     first: false },
  { grp: 3, label: "McCl.",    sub: "osc",      key: "mcclellan",       first: true  },
  { grp: 3, label: "McCl Sum", sub: "cumul.",   key: "mclSummation",    first: false },
  { grp: 3, label: "Hi/Lo",    sub: "ratio",    key: "nhiloRatio",      first: false },
  { grp: 4, label: "ZBT",      sub: "EMA",      key: "zbtVal",          first: true  },
  { grp: 4, label: "3+ATR",    sub: "over",     key: "atrOverextended", first: false },
  { grp: 4, label: "3+ATR",    sub: "wash",     key: "atrWashout",      first: false },
] as const;

const GRP_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "#b8960a", text: "#000" },
  2: { bg: "#1a5c1a", text: "#fff" },
  3: { bg: "#1a3a5c", text: "#fff" },
  4: { bg: "#4a1572", text: "#fff" },
};

export default function BreadthTab() {
  // ── All hooks before any early return ────────────────────────────────────
  const [showMonthly, setShowMonthly] = useState(false);
  const [atrOpen, setAtrOpen] = useState(false);
  const [atrData, setAtrData] = useState<any>(null);
  const [atrLoading, setAtrLoading] = useState(false);
  const [popPos, setPopPos] = useState({ top: 100, left: 100 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!atrOpen) return;
    const h = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setAtrOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [atrOpen]);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/breadth"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/breadth");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const handleAtrClick = useCallback(async (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    setAtrOpen(true);
    if (atrData) return;
    setAtrLoading(true);
    try {
      const res = await fetch("/api/breadth/atr-extended");
      setAtrData(await res.json());
    } catch { setAtrData({ tickers: [], count: 0 }); }
    finally { setAtrLoading(false); }
  }, [atrData]);

  const exportCSV = useCallback(() => {
    if (!data?.rows?.length) return;
    const headers = ["Date","1D A/D","5D A/D","Up Vol%","Up Vol 10d MA","Net New Highs","NNH 10d MA",
      "%>5d MA","%>20d MA","%>50d MA","%>200d MA","McClellan","McCl Summation","Hi/Lo Ratio",
      "ZBT EMA","3+ATR Over","3+ATR Wash"];
    const csvRows = data.rows.map((r: any) => [
      r.date, r.oneDayRatio?.value, r.fiveDayRatio?.value, r.upVolPct?.value, r.upVolMa10?.value,
      r.netNewHighs?.value, r.netNewHighsMa10?.value, r.above5dma?.value, r.above20dma?.value,
      r.above50dma?.value, r.above200dma?.value, r.mcclellan?.value, r.mclSummation?.value,
      r.nhiloRatio?.value, r.zbtVal?.value, r.atrOverextended?.value, r.atrWashout?.value,
    ].join(","));
    const csv = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `breadth_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [data]);

  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        {[...Array(15)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 26, marginBottom: 3 }} />
        ))}
      </div>
    );
  }

  const rows: any[]        = data?.rows ?? [];
  const hs                 = data?.headerSummary ?? {};
  const composite          = data?.composite;
  const sectorBreadth: any[] = data?.sectorBreadth ?? [];
  const adLine: any[]      = data?.adLine ?? [];
  const mcLine: any[]      = data?.mcLine ?? [];
  const zbtStatus          = data?.zbtStatus ?? {};

  const latestRow   = rows[0] ?? {};
  const mcvLatest   = latestRow.mcclellan?.value ?? 0;
  const above20Latest = latestRow.above20dma?.value ?? 50;

  const summaryStat = [
    { label: "Advancing", value: hs.advancing, pct: hs.advancingPct, color: "#00d4a0" },
    { label: "Declining", value: hs.declining, pct: hs.decliningPct, color: "#ff4d4d" },
    { label: "New High",  value: hs.newHigh,   pct: hs.newHighPct,   color: "#4da6ff" },
    { label: "New Low",   value: hs.newLow,    pct: hs.newLowPct,    color: "#ffa500" },
  ];

  // Group spans: grp1=6, grp2=4 (incl %>5d), grp3=3, grp4=3+optional
  const grp2Span = 4; // %>5d, %>20d, %>50d, %>200d
  const grp4Span = showMonthly ? 5 : 3;

  return (
    <>
      {/* BUG 3 FIX: outer wrapper fills full width */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, height: "100%", overflowY: "auto", boxSizing: "border-box", width: "100%" }}>

        {/* ── Summary bar ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "7px 14px", background: "hsl(220 18% 9%)", borderRadius: 3, border: "1px solid var(--bb-border)", flexWrap: "wrap", flexShrink: 0 }}>
          {summaryStat.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600, color: item.color }}>{item.label}</span>
              <div style={{ width: 70, height: 5, background: "hsl(220 15% 15%)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, parseFloat(String(item.pct ?? 0)))}%`, height: "100%", background: item.color, borderRadius: 3 }} />
              </div>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: item.color }}>
                {item.pct}% ({(item.value ?? 0).toLocaleString()})
              </span>
            </div>
          ))}
        </div>

        {/* ── Composite Score Banner ── */}
        <CompositeBanner composite={composite} mcv={mcvLatest} above20={above20Latest} />

        {/* ── ZBT Alert Banner ── */}
        <ZbtBanner zbtStatus={zbtStatus} />

        {/* ── Table toolbar ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => setShowMonthly(v => !v)}
            style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 10px", background: showMonthly ? "#1e3a5f" : "#0d1829", border: "1px solid #1e3a5f", borderRadius: 3, color: showMonthly ? "#7dd3fc" : "#475569", cursor: "pointer" }}
          >
            {showMonthly ? "▼ Monthly Cols" : "▶ Monthly Cols"}
          </button>
          <button
            onClick={exportCSV}
            style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 10px", background: "#0d1829", border: "1px solid #334155", borderRadius: 3, color: "#475569", cursor: "pointer", marginLeft: "auto" }}
          >
            ↓ CSV Export
          </button>
        </div>

        {/* BUG 3 FIX: table wrapper fills all available width */}
        <div style={{ overflowX: "auto", flexShrink: 0, width: "100%" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap", width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              {/* Date col wider, all data cols auto-stretch */}
              <col style={{ width: "72px" }} />
              {COL_DEFS.map((c, i) => <col key={i} />)}
              {showMonthly && <><col /><col /></>}
            </colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "left" }} rowSpan={2}>Date</th>
                <th style={{ ...grpTh(1), borderLeft: GRP_BORDER }} colSpan={6}>GROUP 1 — CORE</th>
                <th style={{ ...grpTh(2), borderLeft: GRP_BORDER }} colSpan={grp2Span}>GROUP 2 — REGIME</th>
                <th style={{ ...grpTh(3), borderLeft: GRP_BORDER }} colSpan={3}>GROUP 3 — OSCILLATORS</th>
                <th style={{ ...grpTh(4), borderLeft: GRP_BORDER }} colSpan={grp4Span}>GROUP 4 — THRUST / EXTREMES</th>
              </tr>
              <tr>
                {COL_DEFS.map((col) => {
                  const gc = GRP_COLORS[col.grp];
                  return (
                    <th key={col.key} style={{
                      background: gc.bg, color: gc.text,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                      padding: "3px 3px", border: "1px solid #0a0f1a", textAlign: "center",
                      lineHeight: 1.3,
                      borderLeft: col.first ? GRP_BORDER : "1px solid #0a0f1a",
                    }}>
                      <div>{col.label}</div>
                      <div style={{ fontSize: 7, opacity: 0.7 }}>{col.sub}</div>
                    </th>
                  );
                })}
                {showMonthly && (
                  <>
                    <th style={{ background: GRP_COLORS[4].bg, color: GRP_COLORS[4].text, fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700, padding: "3px 3px", border: "1px solid #0a0f1a", textAlign: "center", lineHeight: 1.3 }}>
                      <div>↑25%+</div><div style={{ fontSize: 7, opacity: 0.7 }}>month</div>
                    </th>
                    <th style={{ background: GRP_COLORS[4].bg, color: GRP_COLORS[4].text, fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700, padding: "3px 3px", border: "1px solid #0a0f1a", textAlign: "center", lineHeight: 1.3 }}>
                      <div>↓25%+</div><div style={{ fontSize: 7, opacity: 0.7 }}>month</div>
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const isToday = i === 0;
                const isZBT   = row?.zbtVal?.signal;

                const r1   = parseFloat(row?.oneDayRatio?.value ?? "1");
                const r5   = parseFloat(row?.fiveDayRatio?.value ?? "1");
                const uv   = row?.upVolPct?.value ?? 50;
                const uvm  = row?.upVolMa10?.value ?? 50;
                const nnh  = row?.netNewHighs?.value ?? 0;
                const nnhm = row?.netNewHighsMa10?.value ?? 0;
                const a5   = row?.above5dma?.value ?? 50;
                const a20  = row?.above20dma?.value ?? 50;
                const a50  = row?.above50dma?.value ?? 50;
                const a200 = row?.above200dma?.value ?? 50;
                const mc   = row?.mcclellan?.value ?? 0;
                const mcs  = row?.mclSummation?.value ?? 0;
                const hilo = row?.nhiloRatio?.value ?? 0.5;
                const zbt  = row?.zbtVal?.value ?? 0;
                const ato  = row?.atrOverextended?.value ?? 0;
                const atw  = row?.atrWashout?.value ?? 0;

                const rowBg = isZBT ? "rgba(202,138,4,0.1)" : isToday ? "rgba(30,58,95,0.25)" : "transparent";

                return (
                  <tr key={row?.date ?? i} style={{ background: rowBg }}>
                    {/* Date */}
                    <td style={{
                      background: isToday ? "#1e3a5f" : "rgb(14,18,30)",
                      color: isToday ? "#7dd3fc" : "#374151",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      fontWeight: isToday ? 700 : 400,
                      padding: "3px 6px", border: "1px solid #0a0f1a",
                    }}>
                      {row?.date}{isZBT && <span style={{ color: "#fbbf24", marginLeft: 3, fontSize: 9 }}>⚡</span>}
                    </td>

                    {/* Group 1 */}
                    <DC pct={row?.oneDayRatio?.pct}     display={row?.oneDayRatio?.value ?? "–"} />
                    <DC pct={row?.fiveDayRatio?.pct}    display={row?.fiveDayRatio?.value ?? "–"} />
                    <DC pct={row?.upVolPct?.pct}        display={`${uv}%`} />
                    <DC pct={row?.upVolMa10?.pct}       display={`${uvm}%`} />
                    <DC pct={row?.netNewHighs?.pct}     display={nnh > 0 ? `+${nnh}` : String(nnh)} />
                    <DC pct={row?.netNewHighsMa10?.pct} display={nnhm > 0 ? `+${nnhm}` : String(nnhm)} />

                    {/* Group 2 — ADD 1: %>5d first */}
                    <DC pct={row?.above5dma?.pct}   display={`${a5}%`} />
                    <DC pct={row?.above20dma?.pct}  display={`${a20}%`} />
                    <DC pct={row?.above50dma?.pct}  display={`${a50}%`} />
                    <DC pct={row?.above200dma?.pct} display={`${a200}%`} />

                    {/* Group 3 */}
                    <DC pct={row?.mcclellan?.pct}    display={mc > 0 ? `+${mc}` : String(mc)} bold={Math.abs(mc) >= 50} />
                    <DC pct={row?.mclSummation?.pct} display={mcs > 0 ? `+${mcs}` : String(mcs)} small />
                    <DC pct={row?.nhiloRatio?.pct}   display={hilo.toFixed(2)} />

                    {/* Group 4 — ZBT special coloring */}
                    <td style={{
                      background: row?.zbtVal?.signal  ? "rgb(202,138,4)"
                                : row?.zbtVal?.building ? "rgb(120,53,15)"
                                : pctileColor(row?.zbtVal?.pct).bg,
                      color: row?.zbtVal?.signal ? "#000" : pctileColor(row?.zbtVal?.pct).text,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      fontWeight: (row?.zbtVal?.signal || row?.zbtVal?.building) ? 700 : 500,
                      textAlign: "center", padding: "3px 5px", border: "1px solid #0a0f1a",
                      boxShadow: row?.zbtVal?.signal ? "inset 0 0 0 1px #fbbf24" : "none",
                    }}>
                      {zbt.toFixed(3)}{row?.zbtVal?.signal && " ⚡"}
                    </td>

                    {/* 3+ATR Over — clickable today */}
                    <td onClick={isToday ? handleAtrClick : undefined} style={{
                      background: pctileColor(row?.atrOverextended?.pct).bg,
                      color: pctileColor(row?.atrOverextended?.pct).text,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      textAlign: "center", padding: "3px 5px", border: "1px solid #0a0f1a",
                      cursor: isToday ? "pointer" : "default",
                    }}>
                      {ato}{isToday && <span style={{ fontSize: 7, opacity: 0.4, marginLeft: 1 }}>▼</span>}
                    </td>

                    <DC pct={row?.atrWashout?.pct} display={String(atw)} />

                    {showMonthly && (
                      <>
                        <DC pct={undefined} display={String(row?.up25Month?.value ?? 0)} />
                        <DC pct={undefined} display={String(row?.down25Month?.value ?? 0)} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Percentile legend */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#1e293b", letterSpacing: "0.1em" }}>252-DAY PERCENTILE:</span>
          {[
            { bg: "rgb(220,38,38)",   label: "0-10th" },
            { bg: "rgb(120,27,27)",   label: "10-25th" },
            { bg: "rgb(50,20,20)",    label: "25-45th" },
            { bg: "rgb(18,18,22)",    label: "45-55th" },
            { bg: "rgb(20,56,30)",    label: "55-75th" },
            { bg: "rgb(22,101,52)",   label: "75-90th" },
            { bg: "rgb(22,163,74)",   label: "90-100th" },
          ].map(t => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ width: 10, height: 10, background: t.bg, borderRadius: 2, border: "1px solid #1e293b" }} />
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155" }}>{t.label}</span>
            </div>
          ))}
        </div>

        {/* ── ADD 2: Sector Breadth Heatmap ── */}
        <SectorHeatmap sectorBreadth={sectorBreadth} />

        {/* ── ADD 3: Breadth Charts side by side ── */}
        <BreadthCharts adLine={adLine} mcLine={mcLine} />

      </div>

      {/* ATR popover */}
      {atrOpen && (
        <div ref={popRef} style={{ position: "fixed", top: popPos.top, left: popPos.left, width: 340, maxHeight: 320, overflowY: "auto", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 4, zIndex: 9999, padding: "10px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#7b3db5" }}>3+ ATR Extended — Today</span>
            <button onClick={() => setAtrOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
          </div>
          {atrLoading && <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b" }}>Scanning tickers...</div>}
          {!atrLoading && atrData?.tickers?.length === 0 && <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b" }}>No tickers currently 3+ ATR extended.</div>}
          {!atrLoading && atrData?.tickers?.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Ticker","Close","SMA20","ATR","Ext×"].map(h => (
                <th key={h} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569", textAlign: h === "Ticker" ? "left" : "right", paddingBottom: 4, borderBottom: "1px solid #1e3a5f" }}>{h}</th>
              ))}</tr></thead>
              <tbody>{atrData.tickers.map((t: any) => (
                <tr key={t.symbol}>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: t.direction === "above" ? "#22c55e" : "#ef4444", padding: "3px 0" }}>{t.symbol}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#cbd5e1", textAlign: "right", padding: "3px 4px" }}>{t.close}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#94a3b8", textAlign: "right", padding: "3px 4px" }}>{t.sma20}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", textAlign: "right", padding: "3px 4px" }}>{t.atr}</td>
                  <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#eab308", textAlign: "right", padding: "3px 0" }}>{t.extension}×</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

// ── Helper: group header th style ─────────────────────────────────────────────
function grpTh(grp: number) {
  const gc = GRP_COLORS[grp];
  return {
    background: gc.bg,
    color: gc.text,
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 9,
    fontWeight: 700,
    padding: "4px 6px",
    border: "1px solid #0a0f1a",
    textAlign: "center" as const,
  };
}
