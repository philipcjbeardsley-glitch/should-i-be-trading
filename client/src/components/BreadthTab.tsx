import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect, useCallback } from "react";
import Plot from "react-plotly.js";

// ── 5-tier palette ────────────────────────────────────────────────────────
const T1 = "#14532d";
const T2 = "#16a34a";
const T3 = "#1e293b";
const T4 = "#991b1b";
const T5 = "#7f1d1d";

function tierColor(col: string, val: number): string {
  switch (col) {
    case "oneDayRatio":
    case "fiveDayRatio":
    case "tenDayRatio":
      return val >= 3.0 ? T1 : val >= 1.5 ? T2 : val >= 0.8 ? T3 : val >= 0.5 ? T4 : T5;
    case "upVolPct":
    case "upVolMa10":
      return val >= 70 ? T1 : val >= 55 ? T2 : val >= 45 ? T3 : val >= 35 ? T4 : T5;
    case "netNewHighs":
    case "netNewHighsMa10":
      return val >= 200 ? T1 : val >= 50 ? T2 : val >= -50 ? T3 : val >= -200 ? T4 : T5;
    case "above5dma":
      return val >= 75 ? T1 : val >= 60 ? T2 : val >= 40 ? T3 : val >= 25 ? T4 : T5;
    case "above20dma":
      return val >= 70 ? T1 : val >= 55 ? T2 : val >= 40 ? T3 : val >= 25 ? T4 : T5;
    case "above50dma":
      return val >= 65 ? T1 : val >= 50 ? T2 : val >= 35 ? T3 : val >= 20 ? T4 : T5;
    case "above200dma":
      return val >= 65 ? T1 : val >= 50 ? T2 : val >= 35 ? T3 : val >= 20 ? T4 : T5;
    case "mcclellan":
      return val >= 100 ? T1 : val > 0 ? T2 : val === 0 ? T3 : val > -100 ? T4 : T5;
    case "mclSummation":
      return val >= 500 ? T1 : val >= 0 ? T2 : val >= -500 ? T3 : val >= -1000 ? T4 : T5;
    case "nhiloRatio":
      return val >= 0.80 ? T1 : val >= 0.60 ? T2 : val >= 0.40 ? T3 : val >= 0.20 ? T4 : T5;
    case "zbtVal":
      return val >= 0.615 ? T1 : val >= 0.55 ? T2 : val >= 0.45 ? T3 : val >= 0.40 ? T4 : T5;
    case "atrOverextended":
      return val === 0 ? T1 : val <= 50 ? T2 : val <= 150 ? T3 : val <= 300 ? T4 : T5;
    case "atrWashout":
      return val === 0 ? T1 : val <= 50 ? T2 : val <= 150 ? T3 : val <= 300 ? T4 : T5;
    case "sectorMA":
      return val >= 80 ? T1 : val >= 60 ? T2 : val >= 40 ? T3 : val >= 20 ? T4 : T5;
    case "sectorAD":
      return val >= 3 ? T1 : val >= 1.5 ? T2 : val >= 0.8 ? T3 : val >= 0.5 ? T4 : T5;
    default:
      return T3;
  }
}

function DC({ col, val, display, bold, small }: { col: string; val: number; display: string | number; bold?: boolean; small?: boolean }) {
  return (
    <td style={{
      background: tierColor(col, val),
      color: "#fff",
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: small ? 9 : 10,
      fontWeight: bold ? 700 : 500,
      textAlign: "center",
      padding: "3px 4px",
      border: "1px solid #0a0f1a",
      whiteSpace: "nowrap",
      minWidth: 46,
      boxShadow: bold ? "inset 0 0 0 1px rgba(255,255,255,0.2)" : "none",
    }}>
      {display}
    </td>
  );
}

const GRP_BORDER = "2px solid #334155";

function GroupSep() {
  return <td style={{ width: 3, background: "#334155", padding: 0, border: "none" }} />;
}

// ── Composite score banner ────────────────────────────────────────────────
function CompositeBanner({ composite }: { composite: any }) {
  if (!composite) return null;
  const { score, trend5d, regimeSummary } = composite;

  let bg: string, label: string;
  if (score >= 75) { bg = "#14532d"; label = "EXTREMELY BULLISH"; }
  else if (score >= 55) { bg = "#166534"; label = "BULLISH"; }
  else if (score >= 40) { bg = "#78350f"; label = "NEUTRAL"; }
  else if (score >= 25) { bg = "#7f1d1d"; label = "BEARISH"; }
  else { bg = "#4c0519"; label = "EXTREMELY BEARISH"; }

  const arrow = trend5d > 3 ? "↑" : trend5d < -3 ? "↓" : "→";
  const arrowColor = trend5d > 3 ? "#4ade80" : trend5d < -3 ? "#f87171" : "#94a3b8";

  return (
    <div style={{ background: bg, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "14px 20px", display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
      {/* Score */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 52, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
          {score}
        </span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 14, color: "rgba(255,255,255,0.6)" }}>/100</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 28, color: arrowColor, lineHeight: 1 }}>{arrow}</span>
      </div>
      {/* Label + summary */}
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.75)", marginBottom: 5 }}>
          {label}
        </div>
        <div style={{ fontFamily: "IBM Plex Sans, sans-serif", fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.5, maxWidth: 600 }}>
          {regimeSummary}
        </div>
      </div>
      {/* Mini sparkline of score history */}
      <div style={{ flexShrink: 0, textAlign: "right" }}>
        <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>5-DAY TREND</div>
        <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 24 }}>
          {(composite.scoreHistory || []).slice(0, 5).reverse().map((s: number, i: number) => (
            <div key={i} style={{ width: 8, background: "rgba(255,255,255,0.3)", height: `${Math.max(4, s / 5)}px`, borderRadius: 1 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ZBT alert banner ─────────────────────────────────────────────────────
function ZbtBanner({ zbtStatus }: { zbtStatus: any }) {
  if (!zbtStatus?.building && !zbtStatus?.signal) return null;
  const { building, progress, signal, value } = zbtStatus;

  if (signal) {
    return (
      <div style={{ background: "#78350f", border: "1px solid #f59e0b", borderRadius: 4, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#fef08a", letterSpacing: "0.1em" }}>⚡ ZWEIG BREADTH THRUST CONFIRMED</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#fde68a" }}>10-day EMA crossed above 0.615 from below 0.40 — among the most powerful breadth signals in technical analysis.</span>
      </div>
    );
  }

  return (
    <div style={{ background: "#1c1208", border: "1px solid #854d0e", borderRadius: 4, padding: "10px 16px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.1em" }}>⚡ ZBT CONDITIONS BUILDING</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#d97706" }}>EMA dropped below 0.40 and now rising toward 0.615 — monitoring for thrust signal</span>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#fbbf24", marginLeft: "auto" }}>{value?.toFixed(3)} / 0.615</span>
      </div>
      <div style={{ background: "#292015", borderRadius: 2, height: 6, width: "100%" }}>
        <div style={{ background: "#f59e0b", height: "100%", width: `${progress ?? 0}%`, borderRadius: 2, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

export default function BreadthTab() {
  // ── Hooks first ───────────────────────────────────────────────────────────
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

  // ── CSV export ────────────────────────────────────────────────────────────
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

  const rows: any[] = data?.rows ?? [];
  const hs = data?.headerSummary ?? {};
  const composite = data?.composite;
  const sectorBreadth: any[] = data?.sectorBreadth ?? [];
  const adLine: any[] = data?.adLine ?? [];
  const mcLine: any[] = data?.mcLine ?? [];
  const zbtStatus = data?.zbtStatus ?? {};

  const summaryStat = [
    { label: "Advancing", value: hs.advancing, pct: hs.advancingPct, color: "#00d4a0" },
    { label: "Declining", value: hs.declining, pct: hs.decliningPct, color: "#ff4d4d" },
    { label: "New High",  value: hs.newHigh,   pct: hs.newHighPct,   color: "#4da6ff" },
    { label: "New Low",   value: hs.newLow,    pct: hs.newLowPct,    color: "#ffa500" },
  ];

  // ── Plotly layout base ────────────────────────────────────────────────────
  const plotBg = "#060b14";
  const gridColor = "#0d1f35";
  const tickFont = { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" };
  const baseLayout: any = {
    paper_bgcolor: plotBg, plot_bgcolor: plotBg,
    margin: { l: 50, r: 50, t: 24, b: 36 },
    font: tickFont,
    xaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true },
    yaxis: { gridcolor: gridColor, gridwidth: 0.5, tickfont: tickFont, showgrid: true, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1 },
    showlegend: true,
    legend: { font: { family: "IBM Plex Mono, monospace", size: 9, color: "#64748b" }, bgcolor: "rgba(0,0,0,0)", x: 0, y: 1 },
    hovermode: "x unified",
  };

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

        {/* ── Composite score banner ── */}
        <CompositeBanner composite={composite} />

        {/* ── ZBT alert banner ── */}
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

        {/* ── Main heatmap table ── */}
        <div style={{ overflowX: "auto", flexShrink: 0 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, whiteSpace: "nowrap" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              {/* Group headers */}
              <tr>
                <th style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 8px", border: "1px solid #0a0f1a", textAlign: "left", verticalAlign: "bottom" }} rowSpan={2}>Date</th>
                <th style={{ background: "#b8960a", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={6}>GROUP 1 — CORE</th>
                <th style={{ background: "#1a5c1a", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={4}>GROUP 2 — REGIME</th>
                <th style={{ background: "#1a3a5c", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={3}>GROUP 3 — OSCILLATORS</th>
                <th style={{ background: "#4a1572", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 6px", border: "1px solid #0a0f1a", textAlign: "center", borderLeft: GRP_BORDER }} colSpan={showMonthly ? 5 : 3}>GROUP 4 — THRUST / EXTREMES</th>
              </tr>
              {/* Column sub-headers */}
              <tr>
                {[
                  { label: "1D A/D",    sub: "ratio",      grp: 1 },
                  { label: "5D A/D",    sub: "ratio",      grp: 1 },
                  { label: "Up Vol",    sub: "% daily",    grp: 1 },
                  { label: "Up Vol",    sub: "10d MA",     grp: 1 },
                  { label: "Net NHs",   sub: "daily",      grp: 1 },
                  { label: "NNH",       sub: "10d MA",     grp: 1 },
                  { label: ">5d MA",    sub: "%",          grp: 2 },
                  { label: ">20d MA",   sub: "%",          grp: 2 },
                  { label: ">50d MA",   sub: "%",          grp: 2 },
                  { label: ">200d MA",  sub: "%",          grp: 2 },
                  { label: "McCl.",     sub: "osc",        grp: 3 },
                  { label: "McCl Sum",  sub: "cumul.",     grp: 3 },
                  { label: "Hi/Lo",     sub: "ratio",      grp: 3 },
                  { label: "ZBT",       sub: "EMA",        grp: 4 },
                  { label: "3+ATR",     sub: "over",       grp: 4 },
                  { label: "3+ATR",     sub: "wash",       grp: 4 },
                  ...(showMonthly ? [
                    { label: "↑25%+",   sub: "month",      grp: 4 },
                    { label: "↓25%+",   sub: "month",      grp: 4 },
                  ] : []),
                ].map((h, idx) => {
                  const grpBg = h.grp === 1 ? "#b8960a" : h.grp === 2 ? "#1a5c1a" : h.grp === 3 ? "#1a3a5c" : "#4a1572";
                  const grpTc = h.grp === 1 ? "#000" : "#fff";
                  const isFirst = idx === 0 || [0,6,10,13].includes(idx);
                  return (
                    <th key={`${h.label}-${h.sub}-${idx}`} style={{
                      background: grpBg, color: grpTc,
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 8, fontWeight: 700,
                      padding: "3px 4px", border: "1px solid #0a0f1a", textAlign: "center",
                      minWidth: 46, lineHeight: 1.3,
                      borderLeft: isFirst ? GRP_BORDER : "1px solid #0a0f1a",
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
                const r5  = parseFloat(row?.fiveDayRatio?.value ?? "1");
                const r1  = parseFloat(row?.oneDayRatio?.value ?? "1");
                const uv  = row?.upVolPct?.value ?? 50;
                const uvm = row?.upVolMa10?.value ?? 50;
                const nnh = row?.netNewHighs?.value ?? 0;
                const nnhm = row?.netNewHighsMa10?.value ?? 0;
                const a5  = row?.above5dma?.value ?? 50;
                const a20 = row?.above20dma?.value ?? 50;
                const a50 = row?.above50dma?.value ?? 50;
                const a200= row?.above200dma?.value ?? 50;
                const mc  = row?.mcclellan?.value ?? 0;
                const mcs = row?.mclSummation?.value ?? 0;
                const hilo= row?.nhiloRatio?.value ?? 0.5;
                const zbt = row?.zbtVal?.value ?? 0;
                const ato = row?.atrOverextended?.value ?? 0;
                const atw = row?.atrWashout?.value ?? 0;

                const rowBg = isZBT ? "rgba(202,138,4,0.15)" : isToday ? "rgba(30,58,95,0.4)" : "transparent";

                return (
                  <tr key={row?.date ?? i} style={{ background: rowBg }}>
                    <td style={{ background: isToday ? "#1e3a5f" : T3, color: isToday ? "#7dd3fc" : "#475569", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: isToday ? 700 : 400, padding: "3px 7px", border: "1px solid #0a0f1a" }}>
                      {row?.date}{isZBT && <span style={{ color: "#fbbf24", marginLeft: 4, fontSize: 9 }}>⚡</span>}
                    </td>
                    <DC col="oneDayRatio"      val={r1}   display={row?.oneDayRatio?.value ?? "–"}  />
                    <DC col="fiveDayRatio"     val={r5}   display={row?.fiveDayRatio?.value ?? "–"} />
                    <DC col="upVolPct"         val={uv}   display={`${uv}%`}  />
                    <DC col="upVolMa10"        val={uvm}  display={`${uvm}%`} />
                    <DC col="netNewHighs"      val={nnh}  display={nnh > 0 ? `+${nnh}` : String(nnh)} />
                    <DC col="netNewHighsMa10"  val={nnhm} display={nnhm > 0 ? `+${nnhm}` : String(nnhm)} />
                    <DC col="above5dma"        val={a5}   display={`${a5}%`}  />
                    <DC col="above20dma"       val={a20}  display={`${a20}%`} />
                    <DC col="above50dma"       val={a50}  display={`${a50}%`} />
                    <DC col="above200dma"      val={a200} display={`${a200}%`} />
                    <DC col="mcclellan"        val={mc}   display={mc > 0 ? `+${mc}` : String(mc)} bold={Math.abs(mc) >= 50} />
                    <DC col="mclSummation"     val={mcs}  display={mcs > 0 ? `+${mcs}` : String(mcs)} small />
                    <DC col="nhiloRatio"       val={hilo} display={hilo.toFixed(2)} />
                    {/* ZBT — highlighted when building */}
                    <td onClick={undefined} style={{
                      background: row?.zbtVal?.building ? "#78350f" : tierColor("zbtVal", zbt),
                      color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: row?.zbtVal?.building ? 700 : 500,
                      textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                      boxShadow: row?.zbtVal?.signal ? "inset 0 0 0 1px #fbbf24" : "none",
                    }}>
                      {zbt.toFixed(3)}{row?.zbtVal?.signal && " ⚡"}
                    </td>
                    {/* 3+ATR over/washout — clickable on today */}
                    <td onClick={isToday ? handleAtrClick : undefined} style={{
                      background: tierColor("atrOverextended", ato), color: "#fff",
                      fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 500,
                      textAlign: "center", padding: "3px 4px", border: "1px solid #0a0f1a",
                      cursor: isToday ? "pointer" : "default",
                    }}>
                      {ato}{isToday && <span style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", marginLeft: 1 }}>▼</span>}
                    </td>
                    <DC col="atrWashout"       val={atw}  display={String(atw)} />
                    {showMonthly && (
                      <>
                        <DC col="upVolPct" val={row?.up25Month?.value ?? 0} display={String(row?.up25Month?.value ?? 0)} />
                        <DC col="atrWashout" val={row?.down25Month?.value ?? 0} display={String(row?.down25Month?.value ?? 0)} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Tier legend ── */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexShrink: 0 }}>
          {[{bg:T1,l:"Extremely Bullish"},{bg:T2,l:"Bullish"},{bg:T3,l:"Neutral"},{bg:T4,l:"Bearish"},{bg:T5,l:"Extremely Bearish"}].map(t => (
            <div key={t.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, background: t.bg, borderRadius: 2, border: "1px solid #334155" }} />
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569" }}>{t.l}</span>
            </div>
          ))}
        </div>

        {/* ── Sector Breadth Heatmap ── */}
        {sectorBreadth.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.1em", marginBottom: 6 }}>SECTOR BREADTH</div>
            <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr>
                  {["Sector", "% >5d MA", "% >20d MA", "% >50d MA", "% >200d MA", "5D A/D", "Near 52W Hi"].map((h, i) => (
                    <th key={h} style={{ background: "#0d1829", color: "#475569", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 8px", border: "1px solid #0a0f1a", textAlign: i === 0 ? "left" : "center", minWidth: i === 0 ? 110 : 72 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectorBreadth.map((s: any) => (
                  <tr key={s.sym}>
                    <td style={{ background: T3, color: "#94a3b8", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, padding: "3px 8px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>{s.name}</td>
                    <DC col="sectorMA"  val={s.ma5}   display={`${s.ma5}%`}  />
                    <DC col="sectorMA"  val={s.ma20}  display={`${s.ma20}%`} />
                    <DC col="sectorMA"  val={s.ma50}  display={`${s.ma50}%`} />
                    <DC col="sectorMA"  val={s.ma200} display={`${s.ma200}%`} />
                    <DC col="sectorAD"  val={s.adRatio5d} display={String(s.adRatio5d)} />
                    <td style={{ background: s.netNewHighs ? T2 : T3, color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, textAlign: "center", padding: "3px 8px", border: "1px solid #0a0f1a" }}>{s.netNewHighs ? "Yes" : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Charts ── */}
        {adLine.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.1em", marginBottom: 6 }}>CUMULATIVE A/D LINE vs SPY</div>
            <Plot
              data={[
                {
                  x: adLine.map((d: any) => d.date),
                  y: adLine.map((d: any) => d.ad),
                  type: "scatter", mode: "lines", name: "A/D Line",
                  line: { color: "#38bdf8", width: 1.5 },
                  yaxis: "y",
                },
                {
                  x: adLine.map((d: any) => d.date),
                  y: adLine.map((d: any) => {
                    const vals = adLine.map((dd: any) => dd.ad);
                    const idx = adLine.indexOf(d);
                    const slice = vals.slice(Math.max(0, idx - 19), idx + 1);
                    return slice.reduce((a: number, b: number) => a + b, 0) / slice.length;
                  }),
                  type: "scatter", mode: "lines", name: "20d MA",
                  line: { color: "#eab308", width: 1, dash: "dot" },
                  yaxis: "y",
                },
                {
                  x: adLine.map((d: any) => d.date),
                  y: adLine.map((d: any) => d.spy),
                  type: "scatter", mode: "lines", name: "SPY",
                  line: { color: "#a855f7", width: 1 },
                  yaxis: "y2",
                },
              ]}
              layout={{
                ...baseLayout,
                height: 200,
                yaxis: { ...baseLayout.yaxis, title: { text: "A/D", font: { size: 9, color: "#475569", family: "IBM Plex Mono, monospace" } } },
                yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont, title: { text: "SPY", font: { size: 9, color: "#a855f7", family: "IBM Plex Mono, monospace" } } },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </div>
        )}

        {mcLine.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#475569", letterSpacing: "0.1em", marginBottom: 6 }}>McCLELLAN OSCILLATOR + SUMMATION INDEX</div>
            <Plot
              data={[
                {
                  x: mcLine.map((d: any) => d.date),
                  y: mcLine.map((d: any) => d.osc),
                  type: "bar", name: "McClellan Osc",
                  marker: { color: mcLine.map((d: any) => d.osc >= 0 ? "#22c55e" : "#ef4444"), opacity: 0.85 },
                  yaxis: "y",
                },
                {
                  x: mcLine.map((d: any) => d.date),
                  y: mcLine.map((d: any) => d.sum),
                  type: "scatter", mode: "lines", name: "Summation",
                  line: { color: "#38bdf8", width: 1.5 },
                  yaxis: "y2",
                },
              ]}
              layout={{
                ...baseLayout,
                height: 200,
                shapes: [
                  { type: "line", x0: 0, x1: 1, xref: "paper", y0: 100,  y1: 100,  yref: "y", line: { color: "#475569", dash: "dot", width: 1 } },
                  { type: "line", x0: 0, x1: 1, xref: "paper", y0: -100, y1: -100, yref: "y", line: { color: "#475569", dash: "dot", width: 1 } },
                  { type: "line", x0: 0, x1: 1, xref: "paper", y0: 150,  y1: 150,  yref: "y", line: { color: "#64748b", dash: "dash", width: 1 } },
                  { type: "line", x0: 0, x1: 1, xref: "paper", y0: -150, y1: -150, yref: "y", line: { color: "#64748b", dash: "dash", width: 1 } },
                ],
                yaxis: { ...baseLayout.yaxis },
                yaxis2: { overlaying: "y", side: "right", showgrid: false, tickfont: tickFont },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          </div>
        )}

      </div>

      {/* ── ATR popover ── */}
      {atrOpen && (
        <div ref={popRef} style={{ position: "fixed", top: popPos.top, left: popPos.left, width: 320, maxHeight: 300, overflowY: "auto", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 4, zIndex: 9999, padding: "10px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)" }}>
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
