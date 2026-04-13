import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";

const SETUP_TICKERS_COUNT = 42;

type CellData = { value: string | number; color: "green" | "red" | "neutral" };

function Cell({ cell, size = 11 }: { cell: CellData; size?: number }) {
  if (!cell) return <td style={{ border: "1px solid hsl(220 15% 10%)", padding: "5px 6px", minWidth: 44 }} />;
  const isNeutral = cell.color === "neutral";
  const bg = isNeutral ? "transparent" : cell.color === "green" ? "rgba(0,180,0,0.75)" : "rgba(180,0,0,0.75)";
  const textColor = isNeutral ? "var(--bb-text-dim)" : "#fff";
  return (
    <td style={{ background: bg, color: textColor, fontFamily: "IBM Plex Mono, monospace", fontSize: size, fontWeight: 600, textAlign: "center", padding: "5px 6px", border: "1px solid hsl(220 15% 10%)", whiteSpace: "nowrap", minWidth: 44 }}>
      {cell.value}
    </td>
  );
}

export default function BreadthTab() {
  // ── All hooks must be at the top, before any early returns ──
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

  // ── Loading skeleton ──
  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        <div className="panel">
          {[...Array(15)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 28, marginBottom: 3 }} />
          ))}
        </div>
      </div>
    );
  }

  const rows: any[] = data?.rows ?? [];
  const headerSummary = data?.headerSummary ?? {};

  async function handleAtrClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = Math.max(8, rect.left);
    setPopoverPos({ top, left });
    setAtrOpen(true);
    if (atrData) return;
    setAtrLoading(true);
    try {
      const res = await fetch("/api/breadth/atr-extended");
      const json = await res.json();
      setAtrData(json);
    } catch {
      setAtrData({ tickers: [], count: 0 });
    } finally {
      setAtrLoading(false);
    }
  }

  const subHeaders = [
    { label: "Stocks Up 4%+ Today", bg: "#c8a800", tc: "#000" },
    { label: "Stocks Down 4%+ Today", bg: "#c8a800", tc: "#000" },
    { label: "5 Day Ratio", bg: "#c8a800", tc: "#000" },
    { label: "10 Day Ratio", bg: "#c8a800", tc: "#000" },
    { label: "Up 25%+ Quarter", bg: "#1a6b1a", tc: "#fff" },
    { label: "Down 25%+ Quarter", bg: "#1a6b1a", tc: "#fff" },
    { label: "Up 25%+ Month", bg: "#1a6b1a", tc: "#fff" },
    { label: "Down 25%+ Month", bg: "#1a6b1a", tc: "#fff" },
    { label: "Up 50%+ Month", bg: "#1a6b1a", tc: "#fff" },
    { label: "Down 50%+ Month", bg: "#1a6b1a", tc: "#fff" },
    { label: "Up 13%+ 34 Days", bg: "#1a6b1a", tc: "#fff" },
    { label: "Down 13%+ 34 Days", bg: "#1a6b1a", tc: "#fff" },
  ];

  const summaryStat = [
    { label: "Advancing", value: headerSummary.advancing, pct: headerSummary.advancingPct, color: "#00d4a0" },
    { label: "Declining", value: headerSummary.declining, pct: headerSummary.decliningPct, color: "#ff4d4d" },
    { label: "New High", value: headerSummary.newHigh, pct: headerSummary.newHighPct, color: "#4da6ff" },
    { label: "New Low", value: headerSummary.newLow, pct: headerSummary.newLowPct, color: "#ffa500" },
  ];

  return (
    <>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Summary bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "8px 14px", background: "hsl(220 18% 9%)", borderRadius: 3, border: "1px solid var(--bb-border)", flexWrap: "wrap" }}>
          {summaryStat.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="font-mono" style={{ fontSize: 10, fontWeight: 600, color: item.color }}>{item.label}</span>
              <div style={{ width: 80, height: 6, background: "hsl(220 15% 15%)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, parseFloat(String(item.pct ?? 0)))}%`, height: "100%", background: item.color, borderRadius: 3 }} />
              </div>
              <span className="font-mono num" style={{ fontSize: 10, color: item.color }}>
                {item.pct}% ({(item.value ?? 0).toLocaleString()})
              </span>
            </div>
          ))}
        </div>

        {/* Heatmap table */}
        <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 220px)" }}>
          <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr>
                <th rowSpan={2} style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, padding: "6px 10px", border: "1px solid hsl(220 15% 10%)", textAlign: "left", verticalAlign: "bottom", minWidth: 90 }}>Date</th>
                <th colSpan={4} style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, padding: "6px 10px", border: "1px solid hsl(220 15% 10%)", textAlign: "center" }}>Primary Breadth Indicators</th>
                <th colSpan={8} style={{ background: "#1a6b1a", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, padding: "6px 10px", border: "1px solid hsl(220 15% 10%)", textAlign: "center" }}>Secondary Breadth Indicators</th>
                <th style={{ background: "#7b3db5", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, padding: "6px 6px", border: "1px solid hsl(220 15% 10%)", textAlign: "center", minWidth: 55 }}>10x ATR Ext.</th>
                <th style={{ background: "#4a7fc1", color: "#fff", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, padding: "6px 6px", border: "1px solid hsl(220 15% 10%)", textAlign: "center", minWidth: 55 }}>&gt;50dma</th>
                <th style={{ background: "#c8a800", color: "#000", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, padding: "6px 6px", border: "1px solid hsl(220 15% 10%)", textAlign: "center", minWidth: 60 }}>Stock Universe</th>
              </tr>
              <tr>
                {subHeaders.map((h) => (
                  <th key={h.label} style={{ background: h.bg, color: h.tc, fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, padding: "4px 5px", border: "1px solid hsl(220 15% 10%)", textAlign: "center", minWidth: 50, lineHeight: 1.3 }}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => {
                const isToday = i === 0;
                const atrVal = row?.tenxAtrExt?.value ?? 0;
                return (
                  <tr key={row?.date ?? i} style={{ background: isToday ? "hsl(220 18% 11%)" : "transparent" }}>
                    <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--bb-green)" : "var(--bb-text-dim)", padding: "5px 10px", border: "1px solid hsl(220 15% 10%)", whiteSpace: "nowrap" }}>
                      {row?.date}
                    </td>
                    <Cell cell={row?.stocksUp4Today} />
                    <Cell cell={row?.stocksDown4Today} />
                    <Cell cell={row?.fiveDayRatio} />
                    <Cell cell={row?.tenDayRatio} />
                    <Cell cell={row?.up25Quarter} />
                    <Cell cell={row?.down25Quarter} />
                    <Cell cell={row?.up25Month} />
                    <Cell cell={row?.down25Month} />
                    <Cell cell={row?.up50Month} />
                    <Cell cell={row?.down50Month} />
                    <Cell cell={row?.up13_34days} />
                    <Cell cell={row?.down13_34days} />
                    {/* Clickable ATR cell — today only */}
                    <td
                      onClick={isToday ? handleAtrClick : undefined}
                      style={{
                        background: atrVal > 5 ? "rgba(180,0,0,0.75)" : "transparent",
                        color: atrVal > 5 ? "#fff" : "var(--bb-text-dim)",
                        fontFamily: "IBM Plex Mono, monospace",
                        fontSize: 11,
                        fontWeight: 600,
                        textAlign: "center",
                        padding: "5px 6px",
                        border: "1px solid hsl(220 15% 10%)",
                        whiteSpace: "nowrap",
                        minWidth: 44,
                        cursor: isToday ? "pointer" : "default",
                      }}
                    >
                      {atrVal}{isToday && <span style={{ fontSize: 7, color: "#64748b", marginLeft: 2, verticalAlign: "super" }}>▼</span>}
                    </td>
                    <Cell cell={row?.above50dma} />
                    <Cell cell={row?.stockUniverse} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ATR Popover — rendered via portal-style fixed positioning */}
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
            <button onClick={() => setAtrOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>
              ✕
            </button>
          </div>
          {atrLoading && (
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", padding: "8px 0" }}>
              Scanning tickers...
            </div>
          )}
          {!atrLoading && atrData && atrData.tickers.length === 0 && (
            <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#64748b", padding: "8px 0" }}>
              No tickers currently 10x+ ATR from SMA20.
            </div>
          )}
          {!atrLoading && atrData && atrData.tickers.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Ticker", "Close", "SMA20", "ATR", "Ext×"].map(h => (
                    <th key={h} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, color: "#475569", textAlign: h === "Ticker" ? "left" : "right", paddingBottom: 4, borderBottom: "1px solid #1e3a5f" }}>
                      {h}
                    </th>
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
