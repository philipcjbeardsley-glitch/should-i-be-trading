import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect, useCallback } from "react";
import Plot from "react-plotly.js";

// ── Color system ────────────────────────────────────────────────────────────
// Priority 6: 7-tier percentile-based gradient.
// Middle of distribution is very dark/muted. Extremes are saturated.
const PCTILE_COLORS = [
  { min: 90, bg: "#14532d", text: "#fff" },  // 90-100th: deep saturated green
  { min: 75, bg: "#166534", text: "#fff" },  // 75-90th:  muted green
  { min: 55, bg: "#1a3320", text: "#9ca3af" }, // 55-75th:  dark muted green
  { min: 45, bg: "#0e1420", text: "#64748b" }, // 45-55th:  near-black neutral
  { min: 25, bg: "#2a1010", text: "#9ca3af" }, // 25-45th:  dark muted warm
  { min: 10, bg: "#7f1d1d", text: "#fff" },  // 10-25th:  muted red
  { min: 0,  bg: "#4c0519", text: "#fff" },  // 0-10th:   deep saturated red
];

function pctileColor(pct: number | undefined): { bg: string; text: string } {
  if (pct === undefined || pct === null) return { bg: "#0e1420", text: "#64748b" };
  for (const tier of PCTILE_COLORS) {
    if (pct >= tier.min) return { bg: tier.bg, text: tier.text };
  }
  return { bg: "#4c0519", text: "#fff" };
}

// Legacy 5-tier for columns that don't have percentile data yet
const T1 = "#14532d";
const T2 = "#16a34a";
const T3 = "#1e293b";
const T4 = "#991b1b";
const T5 = "#7f1d1d";

// Sector heatmap color (same gradient, val is 0-100 pct above MA)
function sectorColor(val: number): { bg: string; text: string } {
  if (val >= 90) return { bg: "#14532d", text: "#fff" };
  if (val >= 75) return { bg: "#166534", text: "#fff" };
  if (val >= 55) return { bg: "#1a3320", text: "#9ca3af" };
  if (val >= 45) return { bg: "#0e1420", text: "#64748b" };
  if (val >= 25) return { bg: "#2a1010", text: "#9ca3af" };
  if (val >= 10) return { bg: "#7f1d1d", text: "#fff" };
  return { bg: "#4c0519", text: "#fff" };
}

function sectorAdColor(val: number): { bg: string; text: string } {
  if (val >= 3.0) return { bg: "#14532d", text: "#fff" };
  if (val >= 1.5) return { bg: "#166534", text: "#fff" };
  if (val >= 0.8) return { bg: "#0e1420", text: "#64748b" };
  if (val >= 0.5) return { bg: "#7f1d1d", text: "#fff" };
  return { bg: "#4c0519", text: "#fff" };
}

// ── Data cell with percentile coloring ───────────────────────────────────────
function DC({
  val, pct, display, bold, small, highlight,
}: {
  val?: number; pct?: number; display: string | number;
  bold?: boolean; small?: boolean; highlight?: string;
}) {
  const { bg, text } = highlight
    ? { bg: highlight, text: "#fff" }
    : pctileColor(pct);
  return (
    <td style={{
      background: bg,
      color: text,
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: small ? 9 : 10,
      fontWeight: bold ? 700 : 500,
      textAlign: "center",
      padding: "3px 4px",
      border: "1px solid #0a0f1a",
      whiteSpace: "nowrap",
      minWidth: 46,
      boxShadow: bold ? "inset 0 0 0 1px rgba(255,255,255,0.15)" : "none",
    }}>
      {display}
    </td>
  );
}

const GRP_BORDER = "2px solid #334155";

function GroupSep() {
  return <td style={{ width: 3, background: "#334155", padding: 0, border: "none" }} />;
}

// ── Priority 1: Composite Score Banner ───────────────────────────────────────
function CompositeBanner({ composite, mcv, above20 }: {
  composite: any; mcv: number; above20: number;
}) {
  if (!composite) return null;
  const { score, trend5d, regimeSummary, scoreHistory } = composite;

  let bg: string, borderColor: string, label: string;
  if (score >= 75) {
    bg = "#14532d"; borderColor = "#22c55e"; label = "EXTREMELY BULLISH";
  } else if (score >= 55) {
    bg = "#166534"; borderColor = "#16a34a"; label = "BULLISH";
  } else if (score >= 40) {
    bg = "#78350f"; borderColor = "#d97706"; label = "NEUTRAL";
  } else if (score >= 25) {
    bg = "#7f1d1d"; borderColor = "#ef4444"; label = "BEARISH";
  } else {
    bg = "#4c0519"; borderColor = "#9f1239"; label = "EXTREMELY BEARISH";
  }

  const arrow = trend5d > 3 ? "↑" : trend5d < -3 ? "↓" : "→";
  const arrowColor = trend5d > 3 ? "#4ade80" : trend5d < -3 ? "#f87171" : "#94a3b8";

  // Extra annotations
  let extras = "";
  if (mcv < -150) extras += " Oversold thrust conditions building.";
  if (above20 > 90) extras += " Short-term overbought, expect pullback.";

  const fullSummary = regimeSummary + extras;

  // Mini bar chart of score history
  const hist = (scoreHistory || []).slice(0, 7).reverse();
  const maxH = Math.max(...hist, 1);

  return (
    <div style={{
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 4,
      padding: "16px 20px",
      display: "flex",
      alignItems: "stretch",
      gap: 0,
      flexShrink: 0,
      boxShadow: `0 0 20px ${borderColor}22`,
    }}>
      {/* Score box */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 110,
        paddingRight: 20,
        borderRight: `1px solid rgba(255,255,255,0.12)`,
        gap: 4,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{
            fontFamily: "IBM Plex Mono, monospace",
            fontSize: 56,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1,
          }}>
            {score}
          </span>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1 }}>/100</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 22, color: arrowColor, lineHeight: 1 }}>{arrow}</span>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
            {trend5d > 0 ? "+" : ""}{trend5d} vs 5d
          </span>
        </div>
      </div>

      {/* Label + summary */}
      <div style={{ flex: 1, padding: "0 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
        <div style={{
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.8)",
        }}>
          {label}
        </div>
        <div style={{
          fontFamily: "IBM Plex Sans, sans-serif",
          fontSize: 12,
          color: "rgba(255,255,255,0.9)",
          lineHeight: 1.6,
          maxWidth: 680,
        }}>
          {fullSummary}
        </div>
      </div>

      {/* Score history bars */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", paddingLeft: 20, borderLeft: "1px solid rgba(255,255,255,0.12)", gap: 4 }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>7-DAY HISTORY</div>
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 32 }}>
          {hist.map((s: number, i: number) => {
            const isLast = i === hist.length - 1;
            const barH = Math.max(4, Math.round((s / 100) * 32));
            return (
              <div key={i} style={{
                width: 10,
                background: isLast ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
                height: `${barH}px`,
                borderRadius: 1,
                transition: "height 0.3s",
              }} />
            );
          })}
        </div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
          {hist[0] ?? "–"} → {hist[hist.length - 1] ?? "–"}
        </div>
      </div>
    </div>
  );
}

// ── Priority 3: ZBT Alert Banner ──────────────────────────────────────────────
function ZbtBanner({ zbtStatus }: { zbtStatus: any }) {
  if (!zbtStatus?.building && !zbtStatus?.signal) return null;
  const { building, progress, signal, value } = zbtStatus;

  if (signal) {
    return (
      <div style={{
        background: "#ca8a04",
        border: "2px solid #fbbf24",
        borderRadius: 4,
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexShrink: 0,
        boxShadow: "0 0 24px rgba(251,191,36,0.35)",
      }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 12, fontWeight: 700, color: "#000", letterSpacing: "0.1em", marginBottom: 2 }}>
            ZWEIG BREADTH THRUST TRIGGERED
          </div>
          <div style={{ fontFamily: "IBM Plex Sans, sans-serif", fontSize: 11, color: "#1c1407" }}>
            10-day EMA crossed above 0.615 from below 0.40 within 10 days. Among the most powerful breadth signals in technical analysis. Persist 5 trading days.
          </div>
        </div>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 18, fontWeight: 700, color: "#000" }}>
          {value?.toFixed(3)}
        </div>
      </div>
    );
  }

  // Building state — gold-bordered with progress bar
  const pctVal = progress ?? 0;
  return (
    <div style={{
      background: "#1a1005",
      border: "2px solid #ca8a04",
      borderRadius: 4,
      padding: "10px 16px",
      flexShrink: 0,
      boxShadow: "0 0 12px rgba(202,138,4,0.2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.1em" }}>
          ⚡ ZBT CONDITIONS BUILDING
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#92400e", flex: 1 }}>
          EMA was below 0.40 recently, now rising toward 0.615 — monitoring for thrust confirmation
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#fbbf24", flexShrink: 0 }}>
          {value?.toFixed(3)} / 0.615
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#d97706", flexShrink: 0 }}>
          {pctVal}%
        </span>
      </div>
      {/* Progress bar */}
      <div style={{ background: "#2a1c05", borderRadius: 3, height: 8, width: "100%", overflow: "hidden", border: "1px solid #78350f" }}>
        <div style={{
          background: `linear-gradient(90deg, #92400e 0%, #f59e0b ${pctVal}%, #fbbf24 ${pctVal}%)`,
          height: "100%",
          width: `${pctVal}%`,
          borderRadius: 3,
          transition: "width 0.4s ease",
          boxShadow: "0 0 6px rgba(251,191,36,0.5)",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#78350f" }}>0.400 (start)</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#78350f" }}>0.615 (signal)</span>
      </div>
    </div>
  );
}

// ── Priority 4: Sector Breadth Heatmap ────────────────────────────────────────
function SectorHeatmap({ sectorBreadth }: { sectorBreadth: any[] }) {
  if (!sectorBreadth.length) return null;

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.12em", marginBottom: 8 }}>
        SECTOR BREADTH HEATMAP — 11 GICS SECTORS
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              {["Sector", "% >5d MA", "% >20d MA", "% >50d MA", "% >200d MA", "5D A/D"].map((h, i) => (
                <th key={h} style={{
                  background: "#0a1220",
                  color: "#475569",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "5px 8px",
                  border: "1px solid #0a0f1a",
                  textAlign: i === 0 ? "left" : "center",
                  minWidth: i === 0 ? 120 : 76,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectorBreadth.map((s: any) => {
              const { bg: bg5, text: tx5 } = sectorColor(s.ma5 ?? 50);
              const { bg: bg20, text: tx20 } = sectorColor(s.ma20 ?? 50);
              const { bg: bg50, text: tx50 } = sectorColor(s.ma50 ?? 50);
              const { bg: bg200, text: tx200 } = sectorColor(s.ma200 ?? 50);
              const { bg: bgAD, text: txAD } = sectorAdColor(s.adRatio5d ?? 1);
              return (
                <tr key={s.sym}>
                  <td style={{ background: "#0e1420", color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, padding: "3px 8px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
                    <span style={{ color: "#475569", fontSize: 9, marginRight: 5 }}>{s.sym}</span>
                    {s.name}
                  </td>
                  <td style={{ background: bg5, color: tx5, fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.ma5}%</td>
                  <td style={{ background: bg20, color: tx20, fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.ma20}%</td>
                  <td style={{ background: bg50, color: tx50, fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.ma50}%</td>
                  <td style={{ background: bg200, color: tx200, fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.ma200}%</td>
                  <td style={{ background: bgAD, color: txAD, fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.adRatio5d}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BreadthTab() {
  // ── All hooks first — never after early return ────────────────────────────
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

  // ── CSV export ─────────────────────────────────────────────────────────────
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

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        {[...Array(15)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 26, marginBottom: 3 }} />
        ))}
      </div>
    );
  }

  // ── Destructure data ───────────────────────────────────────────────────────
  const rows: any[] = data?.rows ?? [];
  const hs = data?.headerSummary ?? {};
  const composite = data?.composite;
  const sectorBreadth: any[] = data?.sectorBreadth ?? [];
  const adLine: any[] = data?.adLine ?? [];
  const mcLine: any[] = data?.mcLine ?? [];
  const zbtStatus = data?.zbtStatus ?? {};

  const latestRow = rows[0] ?? {};
  const mcvLatest: number = latestRow.mcclellan?.value ?? 0;
  const above20Latest: number = latestRow.above20dma?.value ?? 50;

  // ── Summary stats bar ──────────────────────────────────────────────────────
  const summaryStat = [
    { label: "Advancing", value: hs.advancing, pct: hs.advancingPct, color: "#00d4a0" },
    { label: "Declining", value: hs.declining, pct: hs.decliningPct, color: "#ff4d4d" },
    { label: "New High",  value: hs.newHigh,   pct: hs.newHighPct,   color: "#4da6ff" },
    { label: "New Low",   value: hs.newLow,    pct: hs.newLowPct,    color: "#ffa500" },
  ];

  // ── Plotly base layout ─────────────────────────────────────────────────────
  const plotBg = "#060b14";
  const gridColor = "#0d1f35";
  const tickFont = { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" };
  const baseLayout: any = {
    paper_bgcolor: plotBg,
    plot_bgcolor: plotBg,
    margin: { l: 54, r: 54, t: 28, b: 40 },
    font: tickFont,
    xaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true },
    yaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1 },
    showlegend: true,
    legend: { font: { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" }, bgcolor: "rgba(0,0,0,0)", x: 0, y: 1.08, orientation: "h" },
    hovermode: "x unified",
  };

  // ── A/D Line: compute 20d + 50d MAs ────────────────────────────────────────
  const adVals = adLine.map((d: any) => d.ad);
  const ad20 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 19), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });
  const ad50 = adVals.map((_: number, idx: number) => {
    const s = adVals.slice(Math.max(0, idx - 49), idx + 1);
    return s.reduce((a: number, b: number) => a + b, 0) / s.length;
  });

  // ── Legend items ───────────────────────────────────────────────────────────
  const LEGEND = [
    { bg: "#14532d", label: "90-100th pct" },
    { bg: "#166534", label: "75-90th pct" },
    { bg: "#1a3320", label: "55-75th pct" },
    { bg: "#0e1420", label: "45-55th pct (neutral)" },
    { bg: "#2a1010", label: "25-45th pct" },
    { bg: "#7f1d1d", label: "10-25th pct" },
    { bg: "#4c0519", label: "0-10th pct" },
  ];

  return (
    <>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10, height: "100%", overflowY: "auto", boxSizing: "border-box" }}>

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

        {/* ── Priority 1: Composite Score Banner ── */}
        <CompositeBanner composite={composite} mcv={mcvLatest} above20={above20Latest} />

        {/* ── Priority 3: ZBT Alert Banner ── */}
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

        {/* ── Priority 2 + 6: Main heatmap table ── */}
        <div style={{ overflowX: "auto", flexShrink: 0 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              {/* Group headers */}
              <tr>
                <th style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 8px", border: "1px solid #0a0f1a", textAlign: "left", verticalAlign: "bottom" }} rowSpan={2}>Date</th>
                {/* Group 1 — Core (6 cols) */}
                <th style={{ background: "#b8960a", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={6}>GROUP 1 — CORE</th>
                {/* Group 2 — Regime (5 cols: %>5d, %>20d, %>50d, %>200d) */}
                <th style={{ background: "#1a5c1a", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={4}>GROUP 2 — REGIME</th>
                {/* Group 3 — Oscillators (3 cols: McCl, McCl Sum, Hi/Lo) */}
                <th style={{ background: "#1a3a5c", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={3}>GROUP 3 — OSCILLATORS</th>
                {/* Group 4 — Thrust/Extremes (3 base cols + optional monthly) */}
                <th style={{ background: "#4a1572", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={showMonthly ? 5 : 3}>GROUP 4 — THRUST / EXTREMES</th>
              </tr>
              {/* Column sub-headers */}
              <tr>
                {[
                  // Group 1 — Core
                  { label: "1D A/D",    sub: "ratio",    grp: 1, idx: 0  },
                  { label: "5D A/D",    sub: "ratio",    grp: 1, idx: 1  },
                  { label: "Up Vol",    sub: "% daily",  grp: 1, idx: 2  },
                  { label: "Up Vol",    sub: "10d MA",   grp: 1, idx: 3  },
                  { label: "Net NHs",   sub: "daily",    grp: 1, idx: 4  },
                  { label: "NNH",       sub: "10d MA",   grp: 1, idx: 5  },
                  // Group 2 — Regime
                  { label: ">5d MA",    sub: "%",        grp: 2, idx: 6  },
                  { label: ">20d MA",   sub: "%",        grp: 2, idx: 7  },
                  { label: ">50d MA",   sub: "%",        grp: 2, idx: 8  },
                  { label: ">200d MA",  sub: "%",        grp: 2, idx: 9  },
                  // Group 3 — Oscillators
                  { label: "McCl.",     sub: "osc",      grp: 3, idx: 10 },
                  { label: "McCl Sum",  sub: "cumul.",   grp: 3, idx: 11 },
                  { label: "Hi/Lo",     sub: "ratio",    grp: 3, idx: 12 },
                  // Group 4 — Thrust/Extremes
                  { label: "ZBT",       sub: "EMA",      grp: 4, idx: 13 },
                  { label: "3+ATR",     sub: "over",     grp: 4, idx: 14 },
                  { label: "3+ATR",     sub: "wash",     grp: 4, idx: 15 },
                  ...(showMonthly ? [
                    { label: "↑25%+",   sub: "month",    grp: 4, idx: 16 },
                    { label: "↓25%+",   sub: "month",    grp: 4, idx: 17 },
                  ] : []),
                ].map((h) => {
                  const grpBg = h.grp === 1 ? "#b8960a" : h.grp === 2 ? "#1a5c1a" : h.grp === 3 ? "#1a3a5c" : "#4a1572";
                  const grpTc = h.grp === 1 ? "#000" : "#fff";
                  const isFirstInGrp = [0, 6, 10, 13].includes(h.idx);
                  return (
                    <th key={`${h.label}-${h.sub}-${h.idx}`} style={{
                      background: grpBg, color: grpTc,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                      padding: "3px 4px", border: "1px solid #0a0f1a", textAlign: "center",
                      minWidth: 46, lineHeight: 1.3,
                      borderLeft: isFirstInGrp ? GRP_BORDER : "1px solid #0a0f1a",
                    }}>
                      <div>{h.label}</div>
                      <div style={{ fontSize: 7, opacity: 0.7 }}>{h.sub}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const isToday = i === 0;
                const isZBT = row?.zbtVal?.signal;

                // Extract values
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

                // Percentile ranks
                const p1   = row?.oneDayRatio?.pct;
                const p5   = row?.fiveDayRatio?.pct;
                const puv  = row?.upVolPct?.pct;
                const puvm = row?.upVolMa10?.pct;
                const pnnh = row?.netNewHighs?.pct;
                const pnnhm = row?.netNewHighsMa10?.pct;
                const pa5  = row?.above5dma?.pct;
                const pa20 = row?.above20dma?.pct;
                const pa50 = row?.above50dma?.pct;
                const pa200 = row?.above200dma?.pct;
                const pmc  = row?.mcclellan?.pct;
                const pmcs = row?.mclSummation?.pct;
                const philo = row?.nhiloRatio?.pct;
                const pzbt = row?.zbtVal?.pct;
                const pato = row?.atrOverextended?.pct;
                const patw = row?.atrWashout?.pct;

                const rowBg = isZBT ? "rgba(202,138,4,0.12)" : isToday ? "rgba(30,58,95,0.3)" : "transparent";

                return (
                  <tr key={row?.date ?? i} style={{ background: rowBg }}>
                    <td style={{
                      background: isToday ? "#1e3a5f" : T3,
                      color: isToday ? "#7dd3fc" : "#475569",
                      fontFamily: "IBM Plex Mono, monospace",
                      fontSize: 10, fontWeight: isToday ? 700 : 400,
                      padding: "3px 7px", border: "1px solid #0a0f1a",
                    }}>
                      {row?.date}{isZBT && <span style={{ color: "#fbbf24", marginLeft: 4, fontSize: 9 }}>⚡</span>}
                    </td>

                    {/* Group 1 — Core */}
                    <DC pct={p1}   val={r1}   display={row?.oneDayRatio?.value ?? "–"} />
                    <DC pct={p5}   val={r5}   display={row?.fiveDayRatio?.value ?? "–"} />
                    <DC pct={puv}  val={uv}   display={`${uv}%`} />
                    <DC pct={puvm} val={uvm}  display={`${uvm}%`} />
                    <DC pct={pnnh} val={nnh}  display={nnh > 0 ? `+${nnh}` : String(nnh)} />
                    <DC pct={pnnhm} val={nnhm} display={nnhm > 0 ? `+${nnhm}` : String(nnhm)} />

                    {/* Group 2 — Regime */}
                    <DC pct={pa5}   val={a5}   display={`${a5}%`} />
                    <DC pct={pa20}  val={a20}  display={`${a20}%`} />
                    <DC pct={pa50}  val={a50}  display={`${a50}%`} />
                    <DC pct={pa200} val={a200} display={`${a200}%`} />

                    {/* Group 3 — Oscillators */}
                    <DC pct={pmc}  val={mc}  display={mc > 0 ? `+${mc}` : String(mc)} bold={Math.abs(mc) >= 50} />
                    <DC pct={pmcs} val={mcs} display={mcs > 0 ? `+${mcs}` : String(mcs)} small />
                    <DC pct={philo} val={hilo} display={hilo.toFixed(2)} />

                    {/* Group 4 — ZBT: gold highlight when signal, amber when building */}
                    <td style={{
                      background: row?.zbtVal?.signal ? "#ca8a04" : row?.zbtVal?.building ? "#78350f" : pctileColor(pzbt).bg,
                      color: row?.zbtVal?.signal ? "#000" : "#fff",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                      fontWeight: (row?.zbtVal?.signal || row?.zbtVal?.building) ? 700 : 500,
                      textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                      boxShadow: row?.zbtVal?.signal ? "inset 0 0 0 1px #fbbf24" : "none",
                    }}>
                      {zbt.toFixed(3)}{row?.zbtVal?.signal && " ⚡"}
                    </td>

                    {/* 3+ATR Over — clickable today */}
                    <td onClick={isToday ? handleAtrClick : undefined} style={{
                      background: pctileColor(pato).bg,
                      color: pctileColor(pato).text,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 500,
                      textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                      cursor: isToday ? "pointer" : "default",
                    }}>
                      {ato}{isToday && <span style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", marginLeft: 1 }}>▼</span>}
                    </td>

                    {/* 3+ATR Wash */}
                    <DC pct={patw} val={atw} display={String(atw)} />

                    {showMonthly && (
                      <>
                        <DC pct={undefined} val={row?.up25Month?.value ?? 0} display={String(row?.up25Month?.value ?? 0)} />
                        <DC pct={undefined} val={row?.down25Month?.value ?? 0} display={String(row?.down25Month?.value ?? 0)} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Percentile legend ── */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", letterSpacing: "0.1em" }}>252-DAY PERCENTILE</span>
          {LEGEND.map(t => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, background: t.bg, borderRadius: 2, border: "1px solid #334155" }} />
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>{t.label}</span>
            </div>
          ))}
        </div>

        {/* ── Priority 4: Sector Breadth Heatmap ── */}
        <SectorHeatmap sectorBreadth={sectorBreadth} />

        {/* ── Priority 5: Chart 1 — Cumulative A/D Line ── */}
        {adLine.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.12em", marginBottom: 6 }}>
              CUMULATIVE A/D LINE — with 20d / 50d MAs + SPY
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
                  hovertemplate: "20d MA: %{y:,.0f}<extra></extra>",
                },
                {
                  x: adLine.map((d: any) => d.date),
                  y: ad50,
                  type: "scatter", mode: "lines", name: "50d MA",
                  line: { color: "#f97316", width: 1.2, dash: "dash" },
                  yaxis: "y",
                  hovertemplate: "50d MA: %{y:,.0f}<extra></extra>",
                },
                {
                  x: adLine.map((d: any) => d.date),
                  y: adLine.map((d: any) => d.spy),
                  type: "scatter", mode: "lines", name: "SPY",
                  line: { color: "#a855f7", width: 1 },
                  yaxis: "y2",
                  hovertemplate: "SPY: $%{y:.2f}<extra></extra>",
                },
              ]}
              layout={{
                ...baseLayout,
                height: 220,
                yaxis: {
                  ...baseLayout.yaxis,
                  title: { text: "A/D", font: { size: 9, color: "#38bdf8", family: "IBM Plex Mono, monospace" } },
                },
                yaxis2: {
                  overlaying: "y", side: "right", showgrid: false, tickfont: tickFont,
                  title: { text: "SPY", font: { size: 9, color: "#a855f7", family: "IBM Plex Mono, monospace" } },
                },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </div>
        )}

        {/* ── Priority 5: Chart 2 — McClellan Oscillator + Summation ── */}
        {mcLine.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.12em", marginBottom: 6 }}>
              McCLELLAN OSCILLATOR (histogram) + SUMMATION INDEX (line)
            </div>
            <Plot
              data={[
                {
                  x: mcLine.map((d: any) => d.date),
                  y: mcLine.map((d: any) => d.osc),
                  type: "bar", name: "McClellan Osc",
                  marker: {
                    color: mcLine.map((d: any) => d.osc >= 0 ? "#22c55e" : "#ef4444"),
                    opacity: 0.85,
                    line: { width: 0 },
                  },
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
                  { x: 1, xref: "paper", y: 100,  yref: "y", text: "+100",  showarrow: false, font: { size: 8, color: "#475569", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                  { x: 1, xref: "paper", y: -100, yref: "y", text: "−100",  showarrow: false, font: { size: 8, color: "#475569", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                  { x: 1, xref: "paper", y: 150,  yref: "y", text: "+150",  showarrow: false, font: { size: 8, color: "#64748b", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
                  { x: 1, xref: "paper", y: -150, yref: "y", text: "−150",  showarrow: false, font: { size: 8, color: "#64748b", family: "IBM Plex Mono, monospace" }, xanchor: "left", yanchor: "middle" },
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

      {/* ── ATR popover (clickable cell) ── */}
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
