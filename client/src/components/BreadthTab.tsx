import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";

const SETUP_TICKERS_COUNT = 42;

// ── 5-tier palette (exact hex as specified) ───────────────────────────────
const T1 = "#14532d"; // extremely bullish — dark green
const T2 = "#16a34a"; // bullish — medium green
const T3 = "#1e293b"; // neutral — dark slate
const T4 = "#991b1b"; // bearish — medium red
const T5 = "#7f1d1d"; // extremely bearish — dark red

function tierColor(col: string, raw: number): string {
  switch (col) {
    case "stocksUp4Today":
      return raw >= 1500 ? T1 : raw >= 800 ? T2 : raw >= 300 ? T3 : raw >= 100 ? T4 : T5;
    case "stocksDown4Today":
      return raw < 100 ? T1 : raw < 300 ? T2 : raw < 800 ? T3 : raw < 1500 ? T4 : T5;
    case "fiveDayRatio":
    case "tenDayRatio":
      return raw >= 3.0 ? T1 : raw >= 1.5 ? T2 : raw >= 0.8 ? T3 : raw >= 0.5 ? T4 : T5;
    case "upVolPct":
      return raw >= 70 ? T1 : raw >= 55 ? T2 : raw >= 45 ? T3 : raw >= 35 ? T4 : T5;
    case "up25Month":
      return raw >= 200 ? T1 : raw >= 100 ? T2 : raw >= 50 ? T3 : raw >= 20 ? T4 : T5;
    case "down25Month":
      return raw < 20 ? T1 : raw < 50 ? T2 : raw < 100 ? T3 : raw < 200 ? T4 : T5;
    case "above20dma":
      return raw >= 70 ? T1 : raw >= 55 ? T2 : raw >= 40 ? T3 : raw >= 25 ? T4 : T5;
    case "above50dma":
      return raw >= 65 ? T1 : raw >= 50 ? T2 : raw >= 35 ? T3 : raw >= 20 ? T4 : T5;
    case "above200dma":
      return raw >= 65 ? T1 : raw >= 50 ? T2 : raw >= 35 ? T3 : raw >= 20 ? T4 : T5;
    case "nhiloRatio":
      return raw >= 0.80 ? T1 : raw >= 0.60 ? T2 : raw >= 0.40 ? T3 : raw >= 0.20 ? T4 : T5;
    case "mcclellan":
      return raw >= 100 ? T1 : raw > 0 ? T2 : raw === 0 ? T3 : raw > -100 ? T4 : T5;
    case "tenxAtrExt":
      return raw === 0 ? T1 : raw === 1 ? T2 : raw <= 3 ? T3 : raw <= 6 ? T4 : T5;
    default:
      return T3;
  }
}

function DataCell({
  col,
  value,
  display,
  bold,
}: {
  col: string;
  value: number;
  display: string;
  bold?: boolean;
}) {
  const bg = tierColor(col, value);
  return (
    <td
      style={{
        background: bg,
        color: "#fff",
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 10,
        fontWeight: bold ? 700 : 500,
        textAlign: "center",
        padding: "4px 5px",
        border: "1px solid #0a0f1a",
        whiteSpace: "nowrap",
        minWidth: 50,
        boxShadow: bold ? "inset 0 0 0 1px rgba(255,255,255,0.2)" : "none",
      }}
    >
      {display}
    </td>
  );
}

export default function BreadthTab() {
  // ── All hooks before any early return ────────────────────────────────────
  const [atrOpen, setAtrOpen] = useState(false);
  const [atrData, setAtrData] = useState<{ tickers: any[]; count: number } | null>(null);
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

  async function handleAtrClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
    setAtrOpen(true);
    if (atrData) return;
    setAtrLoading(true);
    try {
      const res = await fetch("/api/breadth/atr-extended");
      setAtrData(await res.json());
    } catch {
      setAtrData({ tickers: [], count: 0 });
    } finally {
      setAtrLoading(false);
    }
  }

  // ── Header group definitions ──────────────────────────────────────────────
  // Groups: Primary (4 cols) | New (5 cols) | Secondary (2 cols) | Special (2) | Universe
  const headerBg = {
    primary: "#b8960a",
    newCols: "#1a6b1a",
    secondary: "#1a6b1a",
    atr: "#7b3db5",
    universe: "#c8a800",
    date: "#c8a800",
  };

  const summaryStat = [
    { label: "Advancing", value: hs.advancing, pct: hs.advancingPct, color: "#00d4a0" },
    { label: "Declining", value: hs.declining, pct: hs.decliningPct, color: "#ff4d4d" },
    { label: "New High",  value: hs.newHigh,   pct: hs.newHighPct,   color: "#4da6ff" },
    { label: "New Low",   value: hs.newLow,    pct: hs.newLowPct,    color: "#ffa500" },
  ];

  return (
    <>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, height: "100%", boxSizing: "border-box" }}>

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

        {/* ── Heatmap table ── */}
        <div style={{ overflowX: "auto", overflowY: "auto", flex: 1, minHeight: 0 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 10, tableLayout: "fixed", width: "100%" }}>
            <colgroup>
              <col style={{ width: 82 }} /> {/* Date */}
              <col style={{ width: 58 }} /> {/* Up 4% */}
              <col style={{ width: 58 }} /> {/* Dn 4% */}
              <col style={{ width: 52 }} /> {/* 5D */}
              <col style={{ width: 52 }} /> {/* 10D */}
              <col style={{ width: 54 }} /> {/* Up Vol */}
              <col style={{ width: 58 }} /> {/* Up 25% Mo */}
              <col style={{ width: 58 }} /> {/* Dn 25% Mo */}
              <col style={{ width: 54 }} /> {/* >20d */}
              <col style={{ width: 54 }} /> {/* >50d */}
              <col style={{ width: 54 }} /> {/* >200d */}
              <col style={{ width: 52 }} /> {/* Hi/Lo */}
              <col style={{ width: 62 }} /> {/* McClellan */}
              <col style={{ width: 52 }} /> {/* 10x ATR */}
              <col style={{ width: 60 }} /> {/* Universe */}
            </colgroup>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              {/* ── Group row ── */}
              <tr>
                <th rowSpan={2} style={{ background: headerBg.date, color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, padding: "5px 6px", border: "1px solid #0a0f1a", textAlign: "left", verticalAlign: "bottom" }}>
                  Date
                </th>
                <th colSpan={4} style={{ background: headerBg.primary, color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 5px", border: "1px solid #0a0f1a", textAlign: "center" }}>
                  Primary Breadth
                </th>
                <th colSpan={8} style={{ background: headerBg.newCols, color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 5px", border: "1px solid #0a0f1a", textAlign: "center" }}>
                  Advanced Breadth
                </th>
                <th style={{ background: headerBg.atr, color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 5px", border: "1px solid #0a0f1a", textAlign: "center" }}>
                  ATR
                </th>
                <th style={{ background: headerBg.universe, color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 5px", border: "1px solid #0a0f1a", textAlign: "center" }}>
                  Univ.
                </th>
              </tr>
              {/* ── Column row ── */}
              <tr>
                {[
                  { label: "↑4%+",    sub: "today",    bg: headerBg.primary,   tc: "#000" },
                  { label: "↓4%+",    sub: "today",    bg: headerBg.primary,   tc: "#000" },
                  { label: "5D A/D",  sub: "ratio",    bg: headerBg.primary,   tc: "#000" },
                  { label: "10D A/D", sub: "ratio",    bg: headerBg.primary,   tc: "#000" },
                  { label: "Up Vol",  sub: "% total",  bg: headerBg.newCols,   tc: "#fff" },
                  { label: "↑25%+",   sub: "month",    bg: headerBg.newCols,   tc: "#fff" },
                  { label: "↓25%+",   sub: "month",    bg: headerBg.newCols,   tc: "#fff" },
                  { label: ">20d",    sub: "MA %",     bg: headerBg.newCols,   tc: "#fff" },
                  { label: ">50d",    sub: "MA %",     bg: headerBg.newCols,   tc: "#fff" },
                  { label: ">200d",   sub: "MA %",     bg: headerBg.newCols,   tc: "#fff" },
                  { label: "Hi/Lo",   sub: "ratio",    bg: headerBg.newCols,   tc: "#fff" },
                  { label: "McCl.",   sub: "oscillat", bg: headerBg.newCols,   tc: "#fff" },
                ].map((h) => (
                  <th key={h.label} style={{ background: h.bg, color: h.tc, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "3px 4px", border: "1px solid #0a0f1a", textAlign: "center", lineHeight: 1.2 }}>
                    <div>{h.label}</div>
                    <div style={{ fontSize: 8, opacity: 0.7, fontWeight: 500 }}>{h.sub}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const isToday = i === 0;

                const upVal    = row?.stocksUp4Today?.value ?? 0;
                const downVal  = row?.stocksDown4Today?.value ?? 0;
                const r5Val    = parseFloat(row?.fiveDayRatio?.value ?? "1");
                const r10Val   = parseFloat(row?.tenDayRatio?.value ?? "1");
                const volVal   = row?.upVolPct?.value ?? 50;
                const up25Val  = row?.up25Month?.value ?? 0;
                const dn25Val  = row?.down25Month?.value ?? 0;
                const ma20Val  = row?.above20dma?.value ?? 0;
                const ma50Val  = row?.above50dma?.value ?? 0;
                const ma200Val = row?.above200dma?.value ?? 0;
                const hiloVal  = parseFloat(row?.nhiloRatio?.value ?? "0.5");
                const mcVal    = row?.mcclellan?.value ?? 0;
                const atrVal   = row?.tenxAtrExt?.value ?? 0;

                return (
                  <tr key={row?.date ?? i}>
                    {/* Date — no color coding */}
                    <td style={{ background: isToday ? "#1e3a5f" : T3, color: isToday ? "#7dd3fc" : "#64748b", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: isToday ? 700 : 400, padding: "4px 7px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
                      {row?.date}
                    </td>

                    <DataCell col="stocksUp4Today"   value={upVal}    display={String(upVal)} />
                    <DataCell col="stocksDown4Today" value={downVal}   display={String(downVal)} />
                    <DataCell col="fiveDayRatio"     value={r5Val}    display={row?.fiveDayRatio?.value ?? "–"} />
                    <DataCell col="tenDayRatio"      value={r10Val}   display={row?.tenDayRatio?.value ?? "–"} />
                    <DataCell col="upVolPct"         value={volVal}   display={`${volVal}%`} />
                    <DataCell col="up25Month"        value={up25Val}  display={String(up25Val)} />
                    <DataCell col="down25Month"      value={dn25Val}  display={String(dn25Val)} />
                    <DataCell col="above20dma"       value={ma20Val}  display={`${ma20Val}%`} />
                    <DataCell col="above50dma"       value={ma50Val}  display={`${ma50Val}%`} />
                    <DataCell col="above200dma"      value={ma200Val} display={`${ma200Val}%`} />
                    <DataCell col="nhiloRatio"       value={hiloVal}  display={hiloVal.toFixed(2)} />

                    {/* McClellan — bold + inner glow when |val| >= 50 */}
                    <DataCell
                      col="mcclellan"
                      value={mcVal}
                      display={mcVal > 0 ? `+${mcVal}` : String(mcVal)}
                      bold={Math.abs(mcVal) >= 50}
                    />

                    {/* 10x ATR — clickable on today */}
                    <td
                      onClick={isToday ? handleAtrClick : undefined}
                      style={{
                        background: tierColor("tenxAtrExt", atrVal),
                        color: "#fff",
                        fontFamily: "IBM Plex Mono, monospace",
                        fontSize: 10,
                        fontWeight: 500,
                        textAlign: "center",
                        padding: "4px 5px",
                        border: "1px solid #0a0f1a",
                        whiteSpace: "nowrap",
                        cursor: isToday ? "pointer" : "default",
                      }}
                    >
                      {atrVal}{isToday && <span style={{ fontSize: 7, color: "rgba(255,255,255,0.45)", marginLeft: 2 }}>▼</span>}
                    </td>

                    {/* Stock Universe — no color coding */}
                    <td style={{ background: T3, color: "#475569", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 400, textAlign: "center", padding: "4px 5px", border: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
                      {row?.stockUniverse?.value ?? "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Tier legend ── */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
          {[
            { bg: T1, label: "Extremely Bullish" },
            { bg: T2, label: "Bullish" },
            { bg: T3, label: "Neutral" },
            { bg: T4, label: "Bearish" },
            { bg: T5, label: "Extremely Bearish" },
          ].map((t) => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, background: t.bg, borderRadius: 2, border: "1px solid #334155" }} />
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569" }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── ATR popover ── */}
      {atrOpen && (
        <div
          ref={popRef}
          style={{ position: "fixed", top: popPos.top, left: popPos.left, width: 320, maxHeight: 300, overflowY: "auto", background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 4, zIndex: 9999, padding: "10px 12px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#7b3db5" }}>10x ATR Extended — Today</span>
            <button onClick={() => setAtrOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
          </div>
          {atrLoading && <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", padding: "8px 0" }}>Scanning tickers...</div>}
          {!atrLoading && atrData && atrData.tickers.length === 0 && (
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", padding: "8px 0" }}>No tickers currently 10x+ ATR from SMA20.</div>
          )}
          {!atrLoading && atrData && atrData.tickers.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Ticker","Close","SMA20","ATR","Ext×"].map(h => (
                    <th key={h} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, color: "#475569", textAlign: h === "Ticker" ? "left" : "right", paddingBottom: 4, borderBottom: "1px solid #1e3a5f" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {atrData.tickers.map((t: any) => (
                  <tr key={t.symbol}>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: t.direction === "above" ? "#22c55e" : "#ef4444", padding: "3px 0" }}>{t.symbol}</td>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#cbd5e1", textAlign: "right", padding: "3px 4px" }}>{t.close}</td>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#94a3b8", textAlign: "right", padding: "3px 4px" }}>{t.sma20}</td>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", textAlign: "right", padding: "3px 4px" }}>{t.atr}</td>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#eab308", textAlign: "right", padding: "3px 0" }}>{t.extension}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 8, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155" }}>
            Universe: {SETUP_TICKERS_COUNT} tracked names · green = above SMA20 · red = below
          </div>
        </div>
      )}
    </>
  );
}
