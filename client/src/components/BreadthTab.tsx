import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";

const SETUP_TICKERS_COUNT = 42;

// ── 5-tier color system ──────────────────────────────────────────────────────
const T1 = "#14532d"; // extremely bullish
const T2 = "#16a34a"; // bullish
const T3 = "#1e293b"; // neutral
const T4 = "#dc2626"; // bearish
const T5 = "#7f1d1d"; // extremely bearish

function tier(val: number, thresholds: [number, number, number, number], inverse = false): string {
  // thresholds: [t1_min, t2_min, t4_max, t5_max]
  // inverse = true means higher is worse (e.g. stocks down)
  const [t1, t2, t4, t5] = thresholds;
  if (!inverse) {
    if (val >= t1) return T1;
    if (val >= t2) return T2;
    if (val >= t4) return T3;
    if (val >= t5) return T4;
    return T5;
  } else {
    if (val <= t5) return T1;
    if (val <= t4) return T2;
    if (val <= t2) return T3;
    if (val <= t1) return T4;
    return T5;
  }
}

// Per-column tier logic
function tierFor(col: string, val: number): string {
  switch (col) {
    case "stocksUp4Today":
      return tier(val, [1500, 800, 300, 100]);
    case "stocksDown4Today":
      return tier(val, [1500, 800, 300, 100], true);
    case "fiveDayRatio":
    case "tenDayRatio": {
      const v = typeof val === "string" ? parseFloat(val) : val;
      if (v >= 3.0) return T1;
      if (v >= 1.5) return T2;
      if (v >= 0.8) return T3;
      if (v >= 0.5) return T4;
      return T5;
    }
    case "upVolPct":
      return tier(val, [70, 55, 45, 35]);
    case "up25Month":
      return tier(val, [200, 100, 50, 20]);
    case "down25Month":
      return tier(val, [200, 100, 50, 20], true);
    case "above20dma":
      return tier(val, [70, 55, 40, 25]);
    case "above50dma":
      return tier(val, [65, 50, 35, 20]);
    case "above200dma":
      return tier(val, [65, 50, 35, 20]);
    case "nhiloRatio": {
      if (val >= 0.80) return T1;
      if (val >= 0.60) return T2;
      if (val >= 0.40) return T3;
      if (val >= 0.20) return T4;
      return T5;
    }
    case "mcclellan": {
      if (val >= 100) return T1;
      if (val > 0) return T2;
      if (val === 0) return T3;
      if (val > -100) return T4;
      return T5;
    }
    case "tenxAtrExt": {
      if (val === 0) return T1;
      if (val === 1) return T2;
      if (val <= 3) return T3;
      if (val <= 6) return T4;
      return T5;
    }
    default:
      return T3;
  }
}

function Cell({
  col,
  value,
  bold,
}: {
  col: string;
  value: string | number;
  bold?: boolean;
}) {
  const numVal = typeof value === "string" ? parseFloat(value) : value;
  const bg = col === "date" || col === "stockUniverse" ? T3 : tierFor(col, numVal);
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
        minWidth: 46,
      }}
    >
      {value}
    </td>
  );
}

export default function BreadthTab() {
  // ── Hooks always first ──
  const [atrOpen, setAtrOpen] = useState(false);
  const [atrData, setAtrData] = useState<{ tickers: any[]; count: number } | null>(null);
  const [atrLoading, setAtrLoading] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 100, left: 100 });
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!atrOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setAtrOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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
    setPopoverPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
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

  // Column definitions — order matches spec
  const COLS = [
    { key: "date",            label: "Date",            sub: "",               colSpan: 1 },
    { key: "stocksUp4Today",  label: "↑4%+ Today",      sub: "stocks up",      colSpan: 1 },
    { key: "stocksDown4Today",label: "↓4%+ Today",      sub: "stocks down",    colSpan: 1 },
    { key: "fiveDayRatio",    label: "5D A/D",           sub: "ratio",          colSpan: 1 },
    { key: "tenDayRatio",     label: "10D A/D",          sub: "ratio",          colSpan: 1 },
    { key: "upVolPct",        label: "Up Vol",           sub: "% of total",     colSpan: 1 },
    { key: "up25Month",       label: "↑25%+ Mo",         sub: "count",          colSpan: 1 },
    { key: "down25Month",     label: "↓25%+ Mo",         sub: "count",          colSpan: 1 },
    { key: "above20dma",      label: "% > 20d",          sub: "MA",             colSpan: 1 },
    { key: "above50dma",      label: "% > 50d",          sub: "MA",             colSpan: 1 },
    { key: "above200dma",     label: "% > 200d",         sub: "MA",             colSpan: 1 },
    { key: "nhiloRatio",      label: "Hi/Lo",            sub: "ratio",          colSpan: 1 },
    { key: "mcclellan",       label: "McClellan",        sub: "oscillator",     colSpan: 1 },
    { key: "tenxAtrExt",      label: "10x ATR",          sub: "extended",       colSpan: 1 },
    { key: "stockUniverse",   label: "Universe",         sub: "total stocks",   colSpan: 1 },
  ];

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
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      background: c.key === "date" || c.key === "stockUniverse" ? "#c8a800"
                        : ["stocksUp4Today","stocksDown4Today","fiveDayRatio","tenDayRatio"].includes(c.key) ? "#b8960a"
                        : c.key === "tenxAtrExt" ? "#7b3db5"
                        : "#1a6b1a",
                      color: c.key === "tenxAtrExt" ? "#fff" : "#000",
                      fontFamily: "IBM Plex Mono, monospace",
                      fontSize: 9,
                      fontWeight: 700,
                      padding: "5px 5px 2px",
                      border: "1px solid #0a0f1a",
                      textAlign: "center",
                      minWidth: c.key === "date" ? 80 : 52,
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div>{c.label}</div>
                    {c.sub && <div style={{ fontSize: 8, fontWeight: 500, opacity: 0.75 }}>{c.sub}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const isToday = i === 0;
                const atrVal = row?.tenxAtrExt?.value ?? 0;
                const mcVal = row?.mcclellan?.value ?? 0;
                return (
                  <tr key={row?.date ?? i}>
                    {/* Date */}
                    <td style={{
                      background: isToday ? "#1e3a5f" : T3,
                      color: isToday ? "#7dd3fc" : "#94a3b8",
                      fontFamily: "IBM Plex Mono, monospace",
                      fontSize: 10,
                      fontWeight: isToday ? 700 : 400,
                      padding: "4px 8px",
                      border: "1px solid #0a0f1a",
                      whiteSpace: "nowrap",
                    }}>
                      {row?.date}
                    </td>
                    <Cell col="stocksUp4Today"  value={row?.stocksUp4Today?.value ?? 0} />
                    <Cell col="stocksDown4Today" value={row?.stocksDown4Today?.value ?? 0} />
                    <Cell col="fiveDayRatio"    value={row?.fiveDayRatio?.value ?? "–"} />
                    <Cell col="tenDayRatio"     value={row?.tenDayRatio?.value ?? "–"} />
                    <Cell col="upVolPct"        value={`${row?.upVolPct?.value ?? 0}%`} />
                    <Cell col="up25Month"       value={row?.up25Month?.value ?? 0} />
                    <Cell col="down25Month"     value={row?.down25Month?.value ?? 0} />
                    <Cell col="above20dma"      value={`${row?.above20dma?.value ?? 0}%`} />
                    <Cell col="above50dma"      value={`${row?.above50dma?.value ?? 0}%`} />
                    <Cell col="above200dma"     value={`${row?.above200dma?.value ?? 0}%`} />
                    <Cell col="nhiloRatio"      value={row?.nhiloRatio?.value ?? "–"} />
                    {/* McClellan — bold + highlighted when |val| > 50 */}
                    <td
                      style={{
                        background: tierFor("mcclellan", mcVal),
                        color: "#fff",
                        fontFamily: "IBM Plex Mono, monospace",
                        fontSize: 10,
                        fontWeight: Math.abs(mcVal) >= 50 ? 700 : 500,
                        textAlign: "center",
                        padding: "4px 5px",
                        border: "1px solid #0a0f1a",
                        whiteSpace: "nowrap",
                        minWidth: 52,
                        boxShadow: Math.abs(mcVal) >= 50 ? "inset 0 0 0 1px rgba(255,255,255,0.25)" : "none",
                      }}
                    >
                      {mcVal > 0 ? `+${mcVal}` : mcVal}
                    </td>
                    {/* 10x ATR — clickable on today's row */}
                    <td
                      onClick={isToday ? handleAtrClick : undefined}
                      style={{
                        background: tierFor("tenxAtrExt", atrVal),
                        color: "#fff",
                        fontFamily: "IBM Plex Mono, monospace",
                        fontSize: 10,
                        fontWeight: 500,
                        textAlign: "center",
                        padding: "4px 5px",
                        border: "1px solid #0a0f1a",
                        whiteSpace: "nowrap",
                        minWidth: 52,
                        cursor: isToday ? "pointer" : "default",
                      }}
                    >
                      {atrVal}{isToday && <span style={{ fontSize: 7, color: "rgba(255,255,255,0.5)", marginLeft: 2 }}>▼</span>}
                    </td>
                    <Cell col="stockUniverse"   value={row?.stockUniverse?.value ?? "–"} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Tier legend ── */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
          {[
            { bg: T1, label: "Extremely Bullish" },
            { bg: T2, label: "Bullish" },
            { bg: T3, label: "Neutral" },
            { bg: T4, label: "Bearish" },
            { bg: T5, label: "Extremely Bearish" },
          ].map((t) => (
            <div key={t.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, background: t.bg, borderRadius: 2, border: "1px solid #334155" }} />
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569" }}>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── ATR Popover ── */}
      {atrOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: popoverPos.top,
            left: popoverPos.left,
            width: 320,
            maxHeight: 300,
            overflowY: "auto",
            background: "#0d1829",
            border: "1px solid #1e3a5f",
            borderRadius: 4,
            zIndex: 9999,
            padding: "10px 12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "#7b3db5" }}>
              10x ATR Extended — Today
            </span>
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
