import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect, useCallback } from "react";
import Plot from "react-plotly.js";

// ── Color system — 7 tiers ────────────────────────────────────────────────────
function pctileColor(pct: number | undefined): { bg: string; text: string } {
  if (pct === undefined || pct === null) return { bg: "rgb(18,18,22)", text: "#374151" };
  if (pct >= 90) return { bg: "rgb(22,163,74)",  text: "#fff" };
  if (pct >= 75) return { bg: "rgb(22,101,52)",  text: "#d1fae5" };
  if (pct >= 60) return { bg: "rgb(13,35,18)",   text: "#4b5563" };
  if (pct >= 40) return { bg: "rgb(18,18,22)",   text: "#374151" };
  if (pct >= 25) return { bg: "rgb(38,15,15)",   text: "#4b5563" };
  if (pct >= 10) return { bg: "rgb(153,27,27)",  text: "#fca5a5" };
  return              { bg: "rgb(220,38,38)",    text: "#fff" };
}

function sectorAdColor(val: number): { bg: string; text: string } {
  if (val >= 4.0) return { bg: "rgb(22,163,74)",  text: "#fff" };
  if (val >= 2.5) return { bg: "rgb(22,101,52)",  text: "#d1fae5" };
  if (val >= 1.2) return { bg: "rgb(18,18,22)",   text: "#374151" };
  if (val >= 0.5) return { bg: "rgb(38,15,15)",   text: "#4b5563" };
  if (val >= 0.3) return { bg: "rgb(153,27,27)",  text: "#fca5a5" };
  return               { bg: "rgb(220,38,38)",   text: "#fff" };
}

function scoreColor60(s: number): string {
  if (s >= 65) return "#22c55e";
  if (s >= 50) return "#16a34a";
  if (s >= 35) return "#d97706";
  return "#ef4444";
}

// ── Data cell ─────────────────────────────────────────────────────────────────
function DC({ pct, display, bold, small, overrideBg, overrideText }: {
  pct?: number; display: string | number; bold?: boolean; small?: boolean;
  overrideBg?: string; overrideText?: string;
}) {
  const { bg, text } = overrideBg ? { bg: overrideBg, text: overrideText ?? "#fff" } : pctileColor(pct);
  return (
    <td style={{
      background: bg, color: text, fontFamily: "IBM Plex Mono, monospace",
      fontSize: small ? 9 : 10, fontWeight: bold ? 700 : 500,
      textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a", whiteSpace: "nowrap",
    }}>{display}</td>
  );
}

// Per-row composite score from 7 pct values
function rowCompositeScore(row: any): number {
  const pcts = [
    row?.fiveDayRatio?.pct, row?.upVolMa10?.pct, row?.above40dma?.pct,
    row?.above50dma?.pct, row?.mcclellan?.pct, row?.nhiloRatio?.pct,
    row?.netNewHighsMa10?.pct,
  ].filter((p): p is number => typeof p === "number");
  if (pcts.length === 0) return 50;
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
}

function rowTintBg(rc: number): string {
  if (rc >= 70) return "rgba(34,197,94,0.045)";
  if (rc <= 30) return "rgba(239,68,68,0.045)";
  return "transparent";
}

// ── Thrust Checklist ──────────────────────────────────────────────────────────
function ThrustChecklist({ thrustChecks }: { thrustChecks: any }) {
  if (!thrustChecks) return null;
  const { zbt, upVol90, whaley, t2108Washout, divergence } = thrustChecks;

  const checks = [
    {
      label:   "Zweig Breadth Thrust",
      active:  zbt?.signal || zbt?.building,
      dot:     zbt?.signal ? "#4ade80" : zbt?.building ? "#fbbf24" : "#1e3a5f",
      status:  zbt?.signal ? "TRIGGERED ⚡" : zbt?.building ? `BUILDING ${zbt?.progress ?? 0}%` : "Inactive",
      sColor:  zbt?.signal ? "#4ade80" : zbt?.building ? "#fbbf24" : "#334155",
      reading: `EMA: ${(zbt?.value ?? 0).toFixed(3)}`,
    },
    {
      label:   "90% Up Volume Day",
      active:  upVol90?.active,
      dot:     upVol90?.active ? "#4ade80" : "#1e3a5f",
      status:  upVol90?.active ? "YES" : "No",
      sColor:  upVol90?.active ? "#4ade80" : "#334155",
      reading: `${upVol90?.value ?? 0}% up vol`,
    },
    {
      label:   "Whaley Thrust (2:1 A/D)",
      active:  whaley?.active,
      dot:     whaley?.active ? "#4ade80" : "#1e3a5f",
      status:  whaley?.active ? `Active` : "Inactive",
      sColor:  whaley?.active ? "#4ade80" : "#334155",
      reading: `Streak: ${whaley?.streak ?? 0}d`,
    },
    {
      label:   "T2108 Washout (<8%)",
      active:  t2108Washout?.active,
      dot:     t2108Washout?.active ? "#ef4444" : "#1e3a5f",
      status:  t2108Washout?.active ? "OVERSOLD" : "Clear",
      sColor:  t2108Washout?.active ? "#ef4444" : "#334155",
      reading: `T2108: ${(t2108Washout?.value ?? 50).toFixed(0)}%`,
    },
    {
      label:   "McClellan Divergence",
      active:  divergence?.type !== "none",
      dot:     divergence?.type === "bullish" ? "#4ade80" : divergence?.type === "bearish" ? "#ef4444" : "#1e3a5f",
      status:  divergence?.type === "bullish" ? "BULLISH" : divergence?.type === "bearish" ? "BEARISH" : "None",
      sColor:  divergence?.type === "bullish" ? "#4ade80" : divergence?.type === "bearish" ? "#ef4444" : "#334155",
      reading: `NYMO: ${(divergence?.nymo ?? 0) > 0 ? "+" : ""}${divergence?.nymo ?? 0}`,
    },
  ];

  return (
    <div style={{
      background: "#060b14", border: "1px solid #1e3a5f", borderRadius: 4,
      padding: "8px 12px", height: "100%", boxSizing: "border-box",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155",
        letterSpacing: "0.12em", marginBottom: 5, flexShrink: 0,
      }}>THRUST CONDITIONS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, flex: 1, justifyContent: "space-between" }}>
        {checks.map((c, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 7, padding: "3px 0",
            borderBottom: i < checks.length - 1 ? "1px solid #0a1220" : "none",
          }}>
            <span style={{ color: c.dot, fontSize: 9, flexShrink: 0, lineHeight: 1 }}>●</span>
            <span style={{
              fontFamily: "IBM Plex Sans, sans-serif", fontSize: 10, color: "#64748b",
              flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{c.label}</span>
            <span style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: c.sColor,
              fontWeight: c.active ? 700 : 400, flexShrink: 0, minWidth: 72, textAlign: "right",
            }}>{c.status}</span>
            <span style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155",
              flexShrink: 0, minWidth: 88, textAlign: "right",
            }}>{c.reading}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Composite Score Banner ────────────────────────────────────────────────────
function CompositeBanner({ composite, rows }: { composite: any; rows: any[] }) {
  if (!composite) return null;
  const { score, trend5d, regimeSummary, scoreHistory } = composite;

  const latestRow = rows[0] ?? {};
  const prevRow2  = rows[2] ?? {};
  const t2108     = latestRow.above40dma?.value ?? 50;
  const t2108_2d  = prevRow2.above40dma?.value  ?? 50;
  const above5    = latestRow.above5dma?.value   ?? 50;
  const mcv       = latestRow.mcclellan?.value   ?? 0;

  let bg: string, borderColor: string, label: string, sColor: string;
  if      (score >= 80) { bg = "#052e16"; borderColor = "#4ade80"; label = "EXTREMELY BULLISH"; sColor = "#4ade80"; }
  else if (score >= 65) { bg = "#14532d"; borderColor = "#22c55e"; label = "VERY BULLISH";      sColor = "#86efac"; }
  else if (score >= 50) { bg = "#166534"; borderColor = "#16a34a"; label = "BULLISH";            sColor = "#86efac"; }
  else if (score >= 35) { bg = "#422006"; borderColor = "#d97706"; label = "NEUTRAL";            sColor = "#fde68a"; }
  else if (score >= 20) { bg = "#7f1d1d"; borderColor = "#ef4444"; label = "BEARISH";            sColor = "#fca5a5"; }
  else                  { bg = "#450a0a"; borderColor = "#dc2626"; label = "EXTREMELY BEARISH";  sColor = "#fca5a5"; }

  const arrow      = trend5d > 3 ? "↑" : trend5d < -3 ? "↓" : "→";
  const arrowColor = trend5d > 3 ? "#4ade80" : trend5d < -3 ? "#f87171" : "#94a3b8";

  // 60-day histogram (subtle background) + 7-day sparkline
  const hist60: number[] = ((scoreHistory as number[]) || []).slice(0, 60).reverse();
  const hist7:  number[] = ((scoreHistory as number[]) || []).slice(0, 7).reverse();

  const appends: { text: string; color: string }[] = [];
  if (t2108 < 8) {
    appends.push({ text: "T2108 deeply oversold (<8%) — historically rare washout, high probability bounce within 1-5 days.", color: "#ef4444" });
  } else if (t2108 < 20) {
    appends.push({ text: "T2108 oversold — mean reversion setup building.", color: "#fbbf24" });
  }
  if (t2108 > 70 && t2108 < t2108_2d) {
    appends.push({ text: "T2108 rolling over from overbought — breadth narrowing, tighten stops.", color: "#fbbf24" });
  }
  if (above5 > 85) {
    appends.push({ text: "Short-term overbought, expect pullback.", color: "#fbbf24" });
  } else if (above5 < 15) {
    appends.push({ text: "Short-term washed out, bounce likely within 1-3 days.", color: "#fbbf24" });
  }
  if (mcv < -150) {
    appends.push({ text: "Oversold thrust conditions building.", color: "#fbbf24" });
  }

  return (
    <div style={{
      background: bg, border: `1px solid ${borderColor}`, borderRadius: 4,
      padding: "10px 14px", display: "flex", alignItems: "center", gap: 12,
      height: "100%", boxSizing: "border-box",
      boxShadow: `0 0 16px ${borderColor}22`,
      position: "relative", overflow: "hidden",
    }}>
      {/* 60-day mini histogram — subtle background */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "100%",
        display: "flex", alignItems: "flex-end", gap: "0.5px", padding: "0 4px",
        opacity: 0.1, pointerEvents: "none",
      }}>
        {hist60.map((s, i) => (
          <div key={i} style={{
            flex: 1, borderRadius: "1px 1px 0 0",
            background: scoreColor60(s),
            height: `${Math.max(4, Math.round((s / 100) * 90))}%`,
          }} />
        ))}
      </div>

      {/* Score block */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 48, fontWeight: 700, color: sColor, lineHeight: 1 }}>
            {score}
          </span>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>/100</span>
        </div>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 7, color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
          BASED ON PRIOR CLOSE
        </span>
      </div>

      {/* 7-day sparkline */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 2, position: "relative" }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 7, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>7D</div>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 26 }}>
          {hist7.map((s, i) => (
            <div key={i} style={{
              width: 6,
              background: i === hist7.length - 1 ? sColor : "rgba(255,255,255,0.18)",
              height: `${Math.max(3, Math.round((Math.min(100, s) / 100) * 26))}px`,
              borderRadius: 1,
            }} />
          ))}
        </div>
      </div>

      {/* Trend arrow */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, position: "relative" }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 22, color: arrowColor, lineHeight: 1 }}>{arrow}</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
          {trend5d > 0 ? "+" : ""}{trend5d} vs 5d
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 50, background: "rgba(255,255,255,0.1)", flexShrink: 0, position: "relative" }} />

      {/* Regime label + summary */}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700,
          letterSpacing: "0.15em", color: sColor, marginBottom: 4,
        }}>
          {label}
        </div>
        <div style={{ fontFamily: "IBM Plex Sans, sans-serif", fontSize: 11, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
          {regimeSummary}
          {appends.map((a, idx) => (
            <span key={idx} style={{ color: a.color, fontStyle: "italic" }}> {a.text}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sector Breadth Heatmap ────────────────────────────────────────────────────
const SECTOR_DISPLAY_NAMES: Record<string, string> = {
  XLK: "Technology", XLV: "Health Care", XLF: "Financials", XLY: "Cons. Disc.",
  XLP: "Cons. Staples", XLI: "Industrials", XLE: "Energy", XLB: "Materials",
  XLU: "Utilities", XLRE: "Real Estate", XLC: "Comm. Svcs",
};

function SectorHeatmap({ sectorBreadth }: { sectorBreadth: any[] }) {
  if (!sectorBreadth.length) return null;

  // Sectors come pre-sorted by sectorScore descending from backend
  const sectors = sectorBreadth;

  // Participation summary
  const strongCount = sectors.filter(s => (s.sectorScore ?? 0) >= 60).length;
  let participationText =
    strongCount >= 8 ? "Broad-based participation — healthy breadth." :
    strongCount >= 5 ? "Moderate breadth — leadership concentrated but not dangerously narrow." :
    strongCount >= 3 ? "Narrow breadth — rally driven by few sectors. Caution warranted." :
                       "Extremely narrow — market carried by 1-2 sectors. High risk.";
  const top2 = sectors.slice(0, 2).map(s => s.sym).join(", ");
  const bot2 = sectors.slice(-2).map(s => s.sym).join(", ");

  const headers = ["Sector", "Chg", "%>5d", "%>20d", "T2108", "%>50d", "%>200d", "A/D", "Score", "N20H"];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", letterSpacing: "0.12em", marginBottom: 4, flexShrink: 0 }}>
        SECTOR BREADTH
      </div>
      <div style={{
        fontFamily: "IBM Plex Sans, sans-serif", fontSize: 9, color: "#475569",
        marginBottom: 5, lineHeight: 1.4, flexShrink: 0,
      }}>
        {participationText}{" "}
        <span style={{ color: "#22c55e" }}>Leading: {top2}.</span>{" "}
        <span style={{ color: "#f87171" }}>Lagging: {bot2}.</span>
      </div>
      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap", width: "100%" }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} style={{
                  background: "#0a1220", color: "#334155",
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                  padding: "4px 6px", border: "1px solid #0a0f1a",
                  textAlign: i <= 1 ? "left" : "center",
                  position: "sticky", top: 0, zIndex: 2,
                  minWidth: i === 0 ? 110 : 44,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectors.map((s: any) => {
              const chg   = s.dailyChg ?? 0;
              const chgColor = chg > 0 ? "#4ade80" : chg < 0 ? "#f87171" : "#64748b";
              const scoreC = pctileColor(s.sectorScore);
              return (
                <tr key={s.sym}>
                  <td style={{ background: "rgb(14,18,30)", color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 6px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#475569", fontSize: 8, marginRight: 4 }}>{s.sym}</span>
                    {SECTOR_DISPLAY_NAMES[s.sym] ?? s.name}
                  </td>
                  <td style={{ background: "rgb(14,18,30)", color: chgColor, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 6px", border: "1px solid #0a0f1a", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {chg > 0 ? "+" : ""}{chg.toFixed(2)}%
                  </td>
                  {[
                    pctileColor(s.ma5),
                    pctileColor(s.ma20),
                    pctileColor(s.ma40),
                    pctileColor(s.ma50),
                    pctileColor(s.ma200),
                  ].map((c, ci) => {
                    const val = [s.ma5, s.ma20, s.ma40, s.ma50, s.ma200][ci];
                    return (
                      <td key={ci} style={{ background: c.bg, color: c.text, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a" }}>
                        {val ?? 0}%
                      </td>
                    );
                  })}
                  {/* A/D */}
                  <td style={{ background: sectorAdColor(s.adRatio5d ?? 1).bg, color: sectorAdColor(s.adRatio5d ?? 1).text, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a" }}>
                    {s.adRatio5d ?? "–"}
                  </td>
                  {/* Sector Score */}
                  <td style={{ background: scoreC.bg, color: scoreC.text, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a", fontWeight: 700 }}>
                    {s.sectorScore ?? 50}
                  </td>
                  {/* New 20d High */}
                  <td style={{
                    background: s.new20dHigh ? "rgb(13,35,18)" : "rgb(18,18,22)",
                    color: s.new20dHigh ? "#4ade80" : "#374151",
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 9, textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                  }}>
                    {s.new20dHigh ? "✓" : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Breadth Charts ────────────────────────────────────────────────────────────
function BreadthCharts({
  adLine, mcLine, chartRange, chartH,
}: {
  adLine: any[]; mcLine: any[]; chartRange: number; chartH: number;
}) {
  const plotBg    = "#060b14";
  const gridColor = "#0d1f35";
  const tickFont  = { family: "IBM Plex Mono, monospace", size: 8, color: "#475569" };

  const slicedAd = adLine.slice(-chartRange);
  const slicedMc = mcLine.slice(-chartRange);

  // A/D MAs
  const adVals = slicedAd.map((d: any) => d.ad);
  const ad20 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 19), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });
  const ad50 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 49), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });

  // A/D trend label
  const adLast    = adVals[adVals.length - 1] ?? 0;
  const ad20Last  = ad20[ad20.length - 1] ?? 0;
  const ad50Last  = ad50[ad50.length - 1] ?? 0;
  const adTrend   = (adLast > ad20Last && adLast > ad50Last) ? "HEALTHY"
                  : (adLast < ad20Last && adLast < ad50Last) ? "DAMAGED"
                  : "TRANSITIONAL";
  const adTrendColor = adTrend === "HEALTHY" ? "#22c55e" : adTrend === "DAMAGED" ? "#ef4444" : "#fbbf24";

  // McClellan label
  const latestMc = slicedMc[slicedMc.length - 1];
  const mcCur    = latestMc?.osc ?? 0;
  const mcZone   = mcCur > 150 ? "Overbought" : mcCur > 100 ? "Strong" : mcCur > -100 ? "Neutral" : mcCur > -150 ? "Weak" : "Oversold";
  const mcLabel  = `NYMO: ${mcCur > 0 ? "+" : ""}${mcCur} (${mcZone})`;

  // Divergence markers
  const bullDivDates = slicedAd.filter((d: any) => d.div === "bullish").map((d: any) => d.date);
  const bearDivDates = slicedAd.filter((d: any) => d.div === "bearish").map((d: any) => d.date);
  const bullDivAd    = slicedAd.filter((d: any) => d.div === "bullish").map((d: any) => d.ad);
  const bearDivAd    = slicedAd.filter((d: any) => d.div === "bearish").map((d: any) => d.ad);

  const baseLayout: any = {
    paper_bgcolor: plotBg, plot_bgcolor: plotBg,
    margin: { l: 48, r: 52, t: 20, b: 28 },
    font: tickFont,
    xaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true },
    yaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1 },
    showlegend: true,
    legend: { font: { family: "IBM Plex Mono, monospace", size: 8, color: "#475569" }, bgcolor: "rgba(0,0,0,0)", x: 0, y: 1.08, orientation: "h" },
    hovermode: "x unified",
  };

  return (
    <>
      {/* A/D Line Chart */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 2, right: 56, zIndex: 5, fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: adTrendColor, pointerEvents: "none" }}>
          A/D TREND: {adTrend}
        </div>
        {slicedAd.length > 0 && (
          <Plot
            data={[
              { x: slicedAd.map((d: any) => d.date), y: adVals, type: "scatter", mode: "lines", name: "A/D Line", line: { color: "#38bdf8", width: 1.5 }, yaxis: "y", hovertemplate: "A/D: %{y:,.0f}<extra></extra>" },
              { x: slicedAd.map((d: any) => d.date), y: ad20,   type: "scatter", mode: "lines", name: "20d MA",   line: { color: "#eab308", width: 1, dash: "dot"  }, yaxis: "y", hovertemplate: "20d: %{y:,.0f}<extra></extra>" },
              { x: slicedAd.map((d: any) => d.date), y: ad50,   type: "scatter", mode: "lines", name: "50d MA",   line: { color: "#f97316", width: 1, dash: "dash" }, yaxis: "y", hovertemplate: "50d: %{y:,.0f}<extra></extra>" },
              { x: slicedAd.map((d: any) => d.date), y: slicedAd.map((d: any) => d.spy), type: "scatter", mode: "lines", name: "SPY", line: { color: "#374151", width: 1 }, yaxis: "y2", hovertemplate: "SPY: $%{y:.2f}<extra></extra>" },
              ...(bullDivDates.length > 0 ? [{ x: bullDivDates, y: bullDivAd, type: "scatter" as const, mode: "markers" as const, name: "▲ Bull Div", marker: { symbol: "triangle-up", color: "#22c55e", size: 8 }, yaxis: "y", hovertemplate: "Bullish div<extra></extra>" }] : []),
              ...(bearDivDates.length > 0 ? [{ x: bearDivDates, y: bearDivAd, type: "scatter" as const, mode: "markers" as const, name: "▼ Bear Div", marker: { symbol: "triangle-down", color: "#ef4444", size: 8 }, yaxis: "y", hovertemplate: "Bearish div<extra></extra>" }] : []),
            ]}
            layout={{
              ...baseLayout, height: chartH,
              yaxis:  { ...baseLayout.yaxis, title: { text: "A/D", font: { size: 8, color: "#38bdf8", family: "IBM Plex Mono, monospace" } } },
              yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont, title: { text: "SPY", font: { size: 8, color: "#374151", family: "IBM Plex Mono, monospace" } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        )}
      </div>

      {/* McClellan Chart */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 2, right: 56, zIndex: 5, fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: mcCur > 100 ? "#22c55e" : mcCur < -100 ? "#ef4444" : "#94a3b8", pointerEvents: "none" }}>
          {mcLabel}
        </div>
        {slicedMc.length > 0 && (
          <Plot
            data={[
              { x: slicedMc.map((d: any) => d.date), y: slicedMc.map((d: any) => d.osc),  type: "bar",     name: "NYMO",  marker: { color: slicedMc.map((d: any) => d.osc >= 0 ? "#22c55e" : "#ef4444"), opacity: 0.8, line: { width: 0 } }, yaxis: "y",  hovertemplate: "NYMO: %{y:.0f}<extra></extra>" },
              { x: slicedMc.map((d: any) => d.date), y: slicedMc.map((d: any) => d.namo), type: "scatter", name: "NAMO",  line: { color: "#a78bfa", width: 1, dash: "dot" }, yaxis: "y",  hovertemplate: "NAMO: %{y:.0f}<extra></extra>" },
              { x: slicedMc.map((d: any) => d.date), y: slicedMc.map((d: any) => d.sum),  type: "scatter", name: "Sum",   line: { color: "#38bdf8", width: 1.5 },             yaxis: "y2", hovertemplate: "Sum: %{y:.0f}<extra></extra>" },
            ]}
            layout={{
              ...baseLayout, height: chartH,
              shapes: [
                { type: "line", x0: 0, x1: 1, xref: "paper", y0:  150, y1:  150, yref: "y", line: { color: "#334155", dash: "dash", width: 1 } },
                { type: "line", x0: 0, x1: 1, xref: "paper", y0:  100, y1:  100, yref: "y", line: { color: "#1e3a5f", dash: "dot",  width: 1 } },
                { type: "line", x0: 0, x1: 1, xref: "paper", y0: -100, y1: -100, yref: "y", line: { color: "#1e3a5f", dash: "dot",  width: 1 } },
                { type: "line", x0: 0, x1: 1, xref: "paper", y0: -150, y1: -150, yref: "y", line: { color: "#334155", dash: "dash", width: 1 } },
              ],
              annotations: [
                { x: 1, xref: "paper", y:  150, yref: "y", text: "+150", showarrow: false, font: { size: 7, color: "#334155", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                { x: 1, xref: "paper", y:  100, yref: "y", text: "+100", showarrow: false, font: { size: 7, color: "#334155", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                { x: 1, xref: "paper", y: -100, yref: "y", text: "−100", showarrow: false, font: { size: 7, color: "#334155", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                { x: 1, xref: "paper", y: -150, yref: "y", text: "−150", showarrow: false, font: { size: 7, color: "#334155", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
              ],
              yaxis:  { ...baseLayout.yaxis, title: { text: "Osc", font: { size: 8, color: "#64748b", family: "IBM Plex Mono, monospace" } } },
              yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont, title: { text: "Sum", font: { size: 8, color: "#38bdf8", family: "IBM Plex Mono, monospace" } } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
          />
        )}
      </div>
    </>
  );
}

// ── Group colors ──────────────────────────────────────────────────────────────
const GRP_BORDER = "2px solid #1e3a5f";
const GRP_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "#b8960a", text: "#000" },
  2: { bg: "#1a5c1a", text: "#fff" },
  3: { bg: "#1a3a5c", text: "#fff" },
  4: { bg: "#4a1572", text: "#fff" },
};

function grpTh(grp: number) {
  const gc = GRP_COLORS[grp];
  return {
    background: gc.bg, color: gc.text,
    fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700,
    padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center" as const,
  };
}

// ── Summary view columns ──────────────────────────────────────────────────────
const SUMMARY_COLS = [
  { key: "fiveDayRatio",    label: "5D A/D",   sub: "ratio",    grp: 1 },
  { key: "upVolMa10",       label: "Up Vol",    sub: "10d MA",   grp: 1 },
  { key: "above40dma",      label: "T2108",     sub: ">40d MA%", grp: 2 },
  { key: "above50dma",      label: ">50d MA",   sub: "%",        grp: 2 },
  { key: "new20dHighPct",   label: "N20H",      sub: "% at 20dH", grp: 1 },
  { key: "mcclellan",       label: "NYMO",      sub: "osc",      grp: 3 },
  { key: "mclSummation",    label: "McCl Sum",  sub: "cumul.",   grp: 3 },
  { key: "nhiloRatio",      label: "Hi/Lo",     sub: "ratio",    grp: 3 },
  { key: "netNewHighsMa10", label: "NNH",       sub: "10d MA",   grp: 1 },
  { key: "zbtVal",          label: "ZBT",       sub: "EMA",      grp: 4 },
] as const;

// ── Full detail columns ───────────────────────────────────────────────────────
const FULL_COLS = [
  // Group 1 — Core
  { grp: 1, key: "oneDayRatio",     label: "1D A/D",    sub: "ratio",     first: true  },
  { grp: 1, key: "fiveDayRatio",    label: "5D A/D",    sub: "ratio",     first: false },
  { grp: 1, key: "upVolPct",        label: "Up Vol",    sub: "% daily",   first: false },
  { grp: 1, key: "upVolMa10",       label: "Up Vol",    sub: "10d MA",    first: false },
  { grp: 1, key: "netNewHighs",     label: "Net NHs",   sub: "daily",     first: false },
  { grp: 1, key: "netNewHighsMa10", label: "NNH",       sub: "10d MA",    first: false },
  { grp: 1, key: "new20dHighPct",   label: "N20H",      sub: "% at 20dH", first: false },
  { grp: 1, key: "new20dLowPct",    label: "N20L",      sub: "% at 20dL", first: false },
  // Group 2 — Regime
  { grp: 2, key: "above5dma",       label: ">5d MA",    sub: "%",         first: true  },
  { grp: 2, key: "above20dma",      label: ">20d MA",   sub: "%",         first: false },
  { grp: 2, key: "above40dma",      label: "T2108",     sub: ">40d MA%",  first: false },
  { grp: 2, key: "above50dma",      label: ">50d MA",   sub: "%",         first: false },
  { grp: 2, key: "above200dma",     label: ">200d MA",  sub: "%",         first: false },
  // Group 3 — Oscillators
  { grp: 3, key: "mcclellan",       label: "NYMO",      sub: "NYSE McCl", first: true  },
  { grp: 3, key: "namo",            label: "NAMO",      sub: "NQ McCl",   first: false },
  { grp: 3, key: "mclSummation",    label: "McCl Sum",  sub: "cumul.",    first: false },
  { grp: 3, key: "nhiloRatio",      label: "Hi/Lo",     sub: "ratio",     first: false },
  // Group 4 — Thrust/Extremes
  { grp: 4, key: "zbtVal",          label: "ZBT",       sub: "EMA",       first: true  },
  { grp: 4, key: "atrOverextended", label: "3+ATR",     sub: "over",      first: false },
  { grp: 4, key: "atrWashout",      label: "3+ATR",     sub: "wash",      first: false },
] as const;

// ── Main Component ────────────────────────────────────────────────────────────
export default function BreadthTab() {
  // ALL hooks before any early return
  const [showFullDetail, setShowFullDetail]   = useState(false);
  const [showMonthly,    setShowMonthly]       = useState(false);
  const [sortState,      setSortState]         = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [atrOpen,        setAtrOpen]           = useState(false);
  const [atrData,        setAtrData]           = useState<any>(null);
  const [atrLoading,     setAtrLoading]        = useState(false);
  const [popPos,         setPopPos]            = useState({ top: 100, left: 100 });
  const [chartRange,     setChartRange]        = useState(130);
  const [chartH,         setChartH]            = useState(170);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      // Each chart gets half of tier2 height (41vh) minus header/gap overhead
      setChartH(Math.max(130, Math.floor(window.innerHeight * 0.41 / 2) - 18));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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
      const res = await apiRequest("GET", "/api/breadth/atr-extended");
      setAtrData(await res.json());
    } catch { setAtrData({ tickers: [], count: 0 }); }
    finally { setAtrLoading(false); }
  }, [atrData]);

  const exportCSV = useCallback(() => {
    if (!data?.rows?.length) return;
    const headers = ["Date","1D A/D","5D A/D","Up Vol%","Up Vol 10d MA","Net NHs","NNH 10d MA","N20H%","N20L%",
      "%>5d MA","%>20d MA","%>40d MA(T2108)","%>50d MA","%>200d MA",
      "NYMO","NAMO","McCl Sum","Hi/Lo","ZBT EMA","3+ATR Over","3+ATR Wash"];
    const csvRows = data.rows.map((r: any) => [
      r.date, r.oneDayRatio?.value, r.fiveDayRatio?.value, r.upVolPct?.value, r.upVolMa10?.value,
      r.netNewHighs?.value, r.netNewHighsMa10?.value, r.new20dHighPct?.value, r.new20dLowPct?.value,
      r.above5dma?.value, r.above20dma?.value, r.above40dma?.value, r.above50dma?.value, r.above200dma?.value,
      r.mcclellan?.value, r.namo?.value, r.mclSummation?.value, r.nhiloRatio?.value,
      r.zbtVal?.value, r.atrOverextended?.value, r.atrWashout?.value,
    ].join(","));
    const csv = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `breadth_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  // Loading skeleton
  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        {[...Array(15)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 26, marginBottom: 3 }} />
        ))}
      </div>
    );
  }

  const rows: any[]          = data?.rows ?? [];
  const hs                   = data?.headerSummary ?? {};
  const composite            = data?.composite;
  const thrustChecks         = data?.thrustChecks;
  const sectorBreadth: any[] = data?.sectorBreadth ?? [];
  const adLine: any[]        = data?.adLine ?? [];
  const mcLine: any[]        = data?.mcLine ?? [];

  const summaryStat = [
    { label: "Adv",      value: hs.advancing, pct: hs.advancingPct, color: "#00d4a0" },
    { label: "Dec",      value: hs.declining, pct: hs.decliningPct, color: "#ff4d4d" },
    { label: "New High", value: hs.newHigh,   pct: hs.newHighPct,   color: "#4da6ff" },
    { label: "New Low",  value: hs.newLow,    pct: hs.newLowPct,    color: "#ffa500" },
  ];

  // Sort rows for Full Detail view
  const displayRows = (showFullDetail && sortState)
    ? [...rows].sort((a, b) => {
        const va = parseFloat(String(a[sortState.col]?.value ?? "0")) || 0;
        const vb = parseFloat(String(b[sortState.col]?.value ?? "0")) || 0;
        return sortState.dir === "desc" ? vb - va : va - vb;
      })
    : rows;

  function toggleSort(col: string) {
    setSortState(prev =>
      prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
    );
  }

  function sortInd(col: string) {
    if (!sortState || sortState.col !== col) return <span style={{ color: "#374151", fontSize: 8, marginLeft: 2 }}>⇅</span>;
    return <span style={{ color: "#7dd3fc", fontSize: 8, marginLeft: 2 }}>{sortState.dir === "desc" ? "↓" : "↑"}</span>;
  }

  const CHART_RANGE_OPTS = [
    { label: "3m", val: 63 },
    { label: "6m", val: 130 },
    { label: "1y", val: 252 },
  ];

  // ── Three-tier single-viewport layout ─────────────────────────────────────
  return (
    <>
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        overflow: "hidden", padding: "6px 8px 4px", gap: 5,
        boxSizing: "border-box", background: "#080c18",
      }}>

        {/* ── TOP STRIP: Advancing/Declining bar ── */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 18,
          padding: "4px 12px", background: "hsl(220 18% 8%)", borderRadius: 3,
          border: "1px solid hsl(220 15% 12%)", height: 26,
        }}>
          {summaryStat.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 600, color: item.color }}>{item.label}</span>
              <div style={{ width: 50, height: 4, background: "hsl(220 15% 12%)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, parseFloat(String(item.pct ?? 0)))}%`, height: "100%", background: item.color, borderRadius: 2 }} />
              </div>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: item.color }}>
                {item.pct}% ({(item.value ?? 0).toLocaleString()})
              </span>
            </div>
          ))}
        </div>

        {/* ── TIER 1: Composite Banner (left) + Thrust Checklist (right) ── */}
        <div style={{
          flexShrink: 0, display: "flex", gap: 6,
          height: "14vh", minHeight: 95, maxHeight: 160,
        }}>
          <div style={{ flex: "0 0 62%", minWidth: 0, overflow: "hidden" }}>
            <CompositeBanner composite={composite} rows={rows} />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <ThrustChecklist thrustChecks={thrustChecks} />
          </div>
        </div>

        {/* ── TIER 2: Sector Heatmap (left) + Charts (right) ── */}
        <div style={{
          flexShrink: 0, display: "flex", gap: 6,
          height: "41vh", minHeight: 220, overflow: "hidden",
        }}>
          {/* Left: Sector Heatmap */}
          <div style={{ flex: "0 0 48%", minWidth: 0, overflow: "hidden" }}>
            <SectorHeatmap sectorBreadth={sectorBreadth} />
          </div>

          {/* Right: Two charts stacked */}
          <div style={{
            flex: 1, minWidth: 0, overflow: "hidden",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <BreadthCharts
              adLine={adLine}
              mcLine={mcLine}
              chartRange={chartRange}
              chartH={chartH}
            />
          </div>
        </div>

        {/* ── TOOLBAR ── */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
          height: 28, flexWrap: "nowrap",
        }}>
          {/* Summary / Full Detail toggle */}
          <div style={{ display: "flex", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 3, overflow: "hidden" }}>
            <button
              onClick={() => { setShowFullDetail(false); setSortState(null); }}
              style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 10px", background: !showFullDetail ? "#1e3a5f" : "transparent", border: "none", color: !showFullDetail ? "#7dd3fc" : "#475569", cursor: "pointer" }}
            >Summary</button>
            <button
              onClick={() => setShowFullDetail(true)}
              style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 10px", background: showFullDetail ? "#1e3a5f" : "transparent", border: "none", color: showFullDetail ? "#7dd3fc" : "#475569", cursor: "pointer" }}
            >Full Detail</button>
          </div>

          {/* Monthly cols (full detail only) */}
          {showFullDetail && (
            <button
              onClick={() => setShowMonthly(v => !v)}
              style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "2px 8px", background: showMonthly ? "#1e3a5f" : "#0d1829", border: "1px solid #1e3a5f", borderRadius: 3, color: showMonthly ? "#7dd3fc" : "#475569", cursor: "pointer" }}
            >
              {showMonthly ? "▼" : "▶"} Monthly
            </button>
          )}

          {/* Chart timeframe */}
          <div style={{ display: "flex", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 3, overflow: "hidden", marginLeft: "auto" }}>
            {CHART_RANGE_OPTS.map(o => (
              <button key={o.label} onClick={() => setChartRange(o.val)} style={{
                fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "3px 8px",
                background: chartRange === o.val ? "#1e3a5f" : "transparent",
                border: "none", color: chartRange === o.val ? "#7dd3fc" : "#475569", cursor: "pointer",
              }}>{o.label}</button>
            ))}
          </div>

          {/* CSV Export */}
          <button
            onClick={exportCSV}
            style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, padding: "2px 10px", background: "#0d1829", border: "1px solid #334155", borderRadius: 3, color: "#475569", cursor: "pointer" }}
          >↓ CSV</button>
        </div>

        {/* ── TIER 3: Data Table (only element with internal scroll) ── */}
        <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
          <div style={{ height: "100%", overflowY: "auto", overflowX: "auto" }}>
            {!showFullDetail ? (
              /* ── SUMMARY VIEW ── */
              <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap", width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "72px" }} />
                  {SUMMARY_COLS.map((_, i) => <col key={i} />)}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ background: "#0a1220", color: "#475569", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "left" }} rowSpan={2}>Date</th>
                    {SUMMARY_COLS.map((col) => {
                      const gc = GRP_COLORS[col.grp];
                      return (
                        <th key={col.key} style={{
                          background: gc.bg, color: gc.text,
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                          padding: "3px 3px", border: "1px solid #0a0f1a", textAlign: "center", lineHeight: 1.3,
                        }}>
                          <div>{col.label}</div>
                          <div style={{ fontSize: 7, opacity: 0.7 }}>{col.sub}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any, i: number) => {
                    const isToday = i === 0;
                    const rc = rowCompositeScore(row);
                    const isZBT = row?.zbtVal?.signal;
                    const rowBg = isZBT ? "rgba(202,138,4,0.1)" : rowTintBg(rc);

                    const r5   = parseFloat(row?.fiveDayRatio?.value ?? "1");
                    const uvm  = row?.upVolMa10?.value ?? 50;
                    const a40  = row?.above40dma?.value ?? 50;
                    const a50  = row?.above50dma?.value ?? 50;
                    const n20h = row?.new20dHighPct?.value ?? 0;
                    const mc   = row?.mcclellan?.value ?? 0;
                    const mcs  = row?.mclSummation?.value ?? 0;
                    const hilo = row?.nhiloRatio?.value ?? 0.5;
                    const nnhm = row?.netNewHighsMa10?.value ?? 0;
                    const zbt  = row?.zbtVal?.value ?? 0;

                    return (
                      <tr key={row?.date ?? i} style={{ background: rowBg }}>
                        <td style={{
                          background: isToday ? "#1e3a5f" : "rgb(14,18,30)",
                          color: isToday ? "#7dd3fc" : "#374151",
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                          fontWeight: isToday ? 700 : 400, padding: "3px 6px", border: "1px solid #0a0f1a",
                        }}>
                          {row?.date}{isZBT && <span style={{ color: "#fbbf24", marginLeft: 3, fontSize: 9 }}>⚡</span>}
                        </td>
                        <DC pct={row?.fiveDayRatio?.pct}    display={`${r5}`} />
                        <DC pct={row?.upVolMa10?.pct}       display={`${uvm}%`} />
                        <DC pct={row?.above40dma?.pct}      display={`${a40}%`} />
                        <DC pct={row?.above50dma?.pct}      display={`${a50}%`} />
                        <DC pct={row?.new20dHighPct?.pct}   display={`${n20h}%`} />
                        <DC pct={row?.mcclellan?.pct}       display={mc > 0 ? `+${mc}` : String(mc)} bold={Math.abs(mc) >= 50} />
                        <DC pct={row?.mclSummation?.pct}    display={mcs > 0 ? `+${mcs}` : String(mcs)} small />
                        <DC pct={row?.nhiloRatio?.pct}      display={hilo.toFixed(2)} />
                        <DC pct={row?.netNewHighsMa10?.pct} display={nnhm > 0 ? `+${nnhm}` : String(nnhm)} />
                        {/* ZBT special coloring */}
                        <td style={{
                          background: row?.zbtVal?.signal   ? "rgb(202,138,4)"
                                    : row?.zbtVal?.building ? "rgb(120,53,15)"
                                    : pctileColor(row?.zbtVal?.pct).bg,
                          color: row?.zbtVal?.signal ? "#000" : pctileColor(row?.zbtVal?.pct).text,
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                          fontWeight: (row?.zbtVal?.signal || row?.zbtVal?.building) ? 700 : 500,
                          textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                        }}>
                          {zbt.toFixed(3)}{row?.zbtVal?.signal && " ⚡"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* ── FULL DETAIL VIEW ── */
              <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap", width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "72px" }} />
                  {FULL_COLS.map((_, i) => <col key={i} />)}
                  {showMonthly && <><col /><col /></>}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "left" }} rowSpan={2}>Date</th>
                    <th style={{ ...grpTh(1), borderLeft: GRP_BORDER }} colSpan={8}>GROUP 1 — CORE</th>
                    <th style={{ ...grpTh(2), borderLeft: GRP_BORDER }} colSpan={5}>GROUP 2 — REGIME</th>
                    <th style={{ ...grpTh(3), borderLeft: GRP_BORDER }} colSpan={4}>GROUP 3 — OSCILLATORS</th>
                    <th style={{ ...grpTh(4), borderLeft: GRP_BORDER }} colSpan={showMonthly ? 5 : 3}>GROUP 4 — THRUST / EXTREMES</th>
                  </tr>
                  <tr>
                    {FULL_COLS.map((col) => {
                      const gc = GRP_COLORS[col.grp];
                      return (
                        <th key={col.key}
                          onClick={() => toggleSort(col.key)}
                          style={{
                            background: gc.bg, color: gc.text,
                            fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                            padding: "3px 3px", border: "1px solid #0a0f1a", textAlign: "center",
                            lineHeight: 1.3, cursor: "pointer",
                            borderLeft: col.first ? GRP_BORDER : "1px solid #0a0f1a",
                          }}>
                          <div>{col.label}{sortInd(col.key)}</div>
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
                  {displayRows.map((row: any, i: number) => {
                    const isToday = !sortState && i === 0;
                    const isZBT  = row?.zbtVal?.signal;
                    const rc     = rowCompositeScore(row);
                    const rowBg  = isZBT ? "rgba(202,138,4,0.1)" : rowTintBg(rc);

                    const r1   = parseFloat(row?.oneDayRatio?.value ?? "1");
                    const r5   = parseFloat(row?.fiveDayRatio?.value ?? "1");
                    const uv   = row?.upVolPct?.value ?? 50;
                    const uvm  = row?.upVolMa10?.value ?? 50;
                    const nnh  = row?.netNewHighs?.value ?? 0;
                    const nnhm = row?.netNewHighsMa10?.value ?? 0;
                    const n20h = row?.new20dHighPct?.value ?? 0;
                    const n20l = row?.new20dLowPct?.value ?? 0;
                    const a5   = row?.above5dma?.value ?? 50;
                    const a20  = row?.above20dma?.value ?? 50;
                    const a40  = row?.above40dma?.value ?? 50;
                    const a50  = row?.above50dma?.value ?? 50;
                    const a200 = row?.above200dma?.value ?? 50;
                    const mc   = row?.mcclellan?.value ?? 0;
                    const namo = row?.namo?.value ?? 0;
                    const mcs  = row?.mclSummation?.value ?? 0;
                    const hilo = row?.nhiloRatio?.value ?? 0.5;
                    const zbt  = row?.zbtVal?.value ?? 0;
                    const ato  = row?.atrOverextended?.value ?? 0;
                    const atw  = row?.atrWashout?.value ?? 0;

                    return (
                      <tr key={row?.date ?? i} style={{ background: rowBg }}>
                        <td style={{
                          background: isToday ? "#1e3a5f" : "rgb(14,18,30)",
                          color: isToday ? "#7dd3fc" : "#374151",
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                          fontWeight: isToday ? 700 : 400, padding: "3px 6px", border: "1px solid #0a0f1a",
                        }}>
                          {row?.date}{isZBT && <span style={{ color: "#fbbf24", marginLeft: 3, fontSize: 9 }}>⚡</span>}
                        </td>
                        {/* Group 1 */}
                        <DC pct={row?.oneDayRatio?.pct}     display={`${r1}`} />
                        <DC pct={row?.fiveDayRatio?.pct}    display={`${r5}`} />
                        <DC pct={row?.upVolPct?.pct}        display={`${uv}%`} />
                        <DC pct={row?.upVolMa10?.pct}       display={`${uvm}%`} />
                        <DC pct={row?.netNewHighs?.pct}     display={nnh > 0 ? `+${nnh}` : String(nnh)} />
                        <DC pct={row?.netNewHighsMa10?.pct} display={nnhm > 0 ? `+${nnhm}` : String(nnhm)} />
                        <DC pct={row?.new20dHighPct?.pct}   display={`${n20h}%`} />
                        <DC pct={row?.new20dLowPct?.pct}    display={`${n20l}%`} />
                        {/* Group 2 */}
                        <DC pct={row?.above5dma?.pct}   display={`${a5}%`} />
                        <DC pct={row?.above20dma?.pct}  display={`${a20}%`} />
                        <DC pct={row?.above40dma?.pct}  display={`${a40}%`} />
                        <DC pct={row?.above50dma?.pct}  display={`${a50}%`} />
                        <DC pct={row?.above200dma?.pct} display={`${a200}%`} />
                        {/* Group 3 */}
                        <DC pct={row?.mcclellan?.pct}    display={mc > 0 ? `+${mc}` : String(mc)} bold={Math.abs(mc) >= 50} />
                        <DC pct={row?.namo?.pct}         display={namo > 0 ? `+${namo}` : String(namo)} bold={Math.abs(namo) >= 50} />
                        <DC pct={row?.mclSummation?.pct} display={mcs > 0 ? `+${mcs}` : String(mcs)} small />
                        <DC pct={row?.nhiloRatio?.pct}   display={hilo.toFixed(2)} />
                        {/* Group 4 — ZBT special */}
                        <td style={{
                          background: row?.zbtVal?.signal   ? "rgb(202,138,4)"
                                    : row?.zbtVal?.building ? "rgb(120,53,15)"
                                    : pctileColor(row?.zbtVal?.pct).bg,
                          color: row?.zbtVal?.signal ? "#000" : pctileColor(row?.zbtVal?.pct).text,
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                          fontWeight: (row?.zbtVal?.signal || row?.zbtVal?.building) ? 700 : 500,
                          textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                        }}>
                          {zbt.toFixed(3)}{row?.zbtVal?.signal && " ⚡"}
                        </td>
                        <td onClick={isToday ? handleAtrClick : undefined} style={{
                          background: pctileColor(ato === 0 ? undefined : row?.atrOverextended?.pct).bg,
                          color: pctileColor(ato === 0 ? undefined : row?.atrOverextended?.pct).text,
                          fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                          textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                          cursor: isToday ? "pointer" : "default",
                        }}>
                          {ato === 0 ? "—" : ato}
                          {isToday && <span style={{ fontSize: 7, opacity: 0.35, marginLeft: 1 }}>▼</span>}
                        </td>
                        <DC pct={atw === 0 ? undefined : row?.atrWashout?.pct} display={atw === 0 ? "—" : String(atw)} />
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
            )}
          </div>
        </div>

      </div>

      {/* ── ATR Popover ── */}
      {atrOpen && (
        <div ref={popRef} style={{
          position: "fixed", top: popPos.top, left: popPos.left, width: 340, maxHeight: 320,
          overflowY: "auto", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 4,
          zIndex: 9999, padding: "10px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
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
