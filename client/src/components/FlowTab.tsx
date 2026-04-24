/**
 * FlowTab.tsx — Options Flow Scanner UI
 *
 * Layer 1 (current): Diagnostic view for verifying data pipeline.
 *   - Live SSE feed of incoming trades (newest first)
 *   - Connection status indicator
 *   - Today's top prints from DB
 *   - Per-trade aggressor confidence display
 *
 * Layer 7 will expand this to: live feed with scores, top prints table with
 * filters, campaigns panel, and the review/labeling interface.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedTrade {
  timestamp: number;
  optionSymbol: string;
  underlying: string;
  expiry: string;
  right: "C" | "P";
  strike: number;
  price: number;
  size: number;
  aggressorSide: "ask" | "bid" | "mid" | "unknown";
  aggressorConfidence: "high" | "medium" | "low";
  bid: number;
  ask: number;
  quoteAgeMs: number;
  oi: number;
  iv: number;
  delta: number;
  premium: number;
  deltaAdjPremium: number;
  dte: number;
}

interface WsStatus {
  state: "disconnected" | "connecting" | "auth_pending" | "active";
  watchedUnderlyings: string[];
  snapshotCacheSize: number;
  snapshotLastRefresh: Record<string, string>;
}

interface StatusPayload {
  ws: WsStatus;
  db: { totalTrades: number; todayPremium: number };
  sseClients: number;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function aggressorColor(side: string, right: string): string {
  if (side === "ask") return right === "C" ? "#4ade80" : "#f87171"; // call bought = bullish; put bought = bearish
  if (side === "bid") return right === "C" ? "#f87171" : "#4ade80"; // call sold = bearish; put sold = bullish
  return "#64748b";
}

function aggressorLabel(side: string, right: string): string {
  if (side === "ask") return right === "C" ? "BOT CALL ▲" : "BOT PUT ▼";
  if (side === "bid") return right === "C" ? "SLD CALL ▼" : "SLD PUT ▲";
  if (side === "mid") return "MID";
  return "UNKN";
}

function confidenceDot(conf: string): string {
  if (conf === "high")   return "#4ade80";
  if (conf === "medium") return "#fbbf24";
  return "#374151";
}

function fmtPremium(p: number): string {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000)     return `$${(p / 1_000).toFixed(0)}K`;
  return `$${p.toFixed(0)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function wsStateColor(state: string): string {
  if (state === "active")       return "#4ade80";
  if (state === "auth_pending") return "#fbbf24";
  if (state === "connecting")   return "#fbbf24";
  return "#f87171";
}

// ── Trade Row ─────────────────────────────────────────────────────────────────

function TradeRow({ t, isNew }: { t: EnrichedTrade; isNew?: boolean }) {
  const dirColor = aggressorColor(t.aggressorSide, t.right);
  const dirLabel = aggressorLabel(t.aggressorSide, t.right);
  const confDot  = confidenceDot(t.aggressorConfidence);
  const strikeFmt = t.strike % 1 === 0 ? `$${t.strike}` : `$${t.strike.toFixed(1)}`;

  return (
    <tr style={{
      background: isNew ? "rgba(0,212,160,0.04)" : "transparent",
      transition: "background 2s",
    }}>
      {/* Time */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
        {fmtTime(t.timestamp)}
      </td>
      {/* Underlying */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700, color: "#cbd5e1", padding: "3px 6px", borderBottom: "1px solid #0a0f1a" }}>
        {t.underlying}
      </td>
      {/* Contract */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#64748b", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
        {t.expiry.slice(2)} {strikeFmt} {t.right}
        <span style={{ color: "#334155", marginLeft: 4, fontSize: 8 }}>DTE:{t.dte}</span>
      </td>
      {/* Size */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#94a3b8", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", textAlign: "right" }}>
        {t.size.toLocaleString()}
      </td>
      {/* Price */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#cbd5e1", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", textAlign: "right" }}>
        ${t.price.toFixed(2)}
        <div style={{ fontSize: 8, color: "#334155" }}>
          {t.bid.toFixed(2)}×{t.ask.toFixed(2)}
        </div>
      </td>
      {/* Premium */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 600, color: "#e2e8f0", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", textAlign: "right" }}>
        {fmtPremium(t.premium)}
        <div style={{ fontSize: 8, color: "#334155" }}>Δ-adj: {fmtPremium(t.deltaAdjPremium)}</div>
      </td>
      {/* Direction */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, color: dirColor, padding: "3px 6px", borderBottom: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
        {dirLabel}
      </td>
      {/* Aggressor confidence + quote age */}
      <td style={{ padding: "3px 6px", borderBottom: "1px solid #0a0f1a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: confDot, display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>
            {t.aggressorConfidence}
            {t.quoteAgeMs > 0 && (
              <span style={{ color: t.quoteAgeMs > 60_000 ? "#f87171" : "#334155", marginLeft: 3 }}>
                ({Math.round(t.quoteAgeMs / 1_000)}s)
              </span>
            )}
          </span>
        </div>
      </td>
      {/* IV / Delta / OI */}
      <td style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", padding: "3px 6px", borderBottom: "1px solid #0a0f1a", whiteSpace: "nowrap" }}>
        {t.iv > 0 && <span>IV:{(t.iv * 100).toFixed(0)}%</span>}
        {t.delta !== 0 && <span style={{ marginLeft: 4 }}>Δ:{t.delta.toFixed(2)}</span>}
        {t.oi > 0 && (
          <span style={{ marginLeft: 4, color: t.size > t.oi ? "#fbbf24" : "#334155" }}>
            OI:{t.oi.toLocaleString()}
            {t.size > t.oi && <span style={{ color: "#fbbf24" }}> OPEN↑</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const MAX_LIVE_TRADES = 200;

export default function FlowTab() {
  const [liveTrades, setLiveTrades]       = useState<EnrichedTrade[]>([]);
  const [wsStatus, setWsStatus]           = useState<WsStatus | null>(null);
  const [sseState, setSseState]           = useState<"connecting" | "live" | "error">("connecting");
  const [newTradeIds, setNewTradeIds]     = useState<Set<number>>(new Set());
  const [minSize, setMinSize]             = useState(10);
  const esRef = useRef<EventSource | null>(null);

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/flow/stream");
    esRef.current = es;

    es.onopen = () => setSseState("live");
    es.onerror = () => setSseState("error");

    es.addEventListener("trade", (e: MessageEvent) => {
      try {
        const trade: EnrichedTrade = JSON.parse(e.data);
        setLiveTrades(prev => {
          const next = [trade, ...prev].slice(0, MAX_LIVE_TRADES);
          return next;
        });
        // Briefly highlight new row
        setNewTradeIds(prev => {
          const s = new Set(prev);
          s.add(trade.timestamp);
          return s;
        });
        setTimeout(() => {
          setNewTradeIds(prev => {
            const s = new Set(prev);
            s.delete(trade.timestamp);
            return s;
          });
        }, 2_000);
      } catch { /* malformed event — ignore */ }
    });

    es.addEventListener("status", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setWsStatus(payload);
        setSseState("live");
      } catch { /* ignore */ }
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // ── Status polling (fallback when no trades are flowing) ───────────────────
  const { data: statusData } = useQuery<StatusPayload>({
    queryKey: ["/api/flow/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/flow/status");
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // ── Today's top prints ─────────────────────────────────────────────────────
  const { data: todayData, refetch: refetchToday } = useQuery<{ trades: EnrichedTrade[] }>({
    queryKey: ["/api/flow/trades/today"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/flow/trades/today?limit=100");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const effectiveStatus = wsStatus ?? statusData?.ws ?? null;
  const dbStats = statusData?.db;

  // ── Filtered live feed ─────────────────────────────────────────────────────
  const filteredLive = liveTrades.filter(t => t.size >= minSize);

  return (
    <div style={{ padding: "8px 12px", background: "#080c18", minHeight: "100%" }}>

      {/* ── Header bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 10,
        paddingBottom: 8, borderBottom: "1px solid hsl(220 15% 12%)",
      }}>
        <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700, color: "#475569", letterSpacing: "0.15em" }}>
          OPTIONS FLOW SCANNER
        </span>

        {/* WS connection indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: wsStateColor(effectiveStatus?.state ?? "disconnected"), display: "inline-block" }} />
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569" }}>
            POLYGON WS: {(effectiveStatus?.state ?? "—").toUpperCase()}
          </span>
        </div>

        {/* SSE indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: sseState === "live" ? "#4ade80" : sseState === "error" ? "#f87171" : "#fbbf24", display: "inline-block" }} />
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#475569" }}>
            SSE: {sseState.toUpperCase()}
          </span>
        </div>

        {/* Watched underlyings */}
        {effectiveStatus?.watchedUnderlyings && effectiveStatus.watchedUnderlyings.length > 0 && (
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#00d4a0" }}>
            WATCHING: {effectiveStatus.watchedUnderlyings.join(", ")}
          </span>
        )}

        {/* DB stats */}
        {dbStats && (
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155", marginLeft: "auto" }}>
            {dbStats.totalTrades.toLocaleString()} TRADES · TODAY: {fmtPremium(dbStats.todayPremium)} PREMIUM
          </span>
        )}

        {/* Snapshot cache info */}
        {effectiveStatus?.snapshotCacheSize != null && (
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "#334155" }}>
            SNAP: {effectiveStatus.snapshotCacheSize} CONTRACTS
          </span>
        )}
      </div>

      {/* ── Limitation disclaimer ── */}
      <div style={{
        background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
        borderRadius: 3, padding: "5px 10px", marginBottom: 10,
        fontFamily: "IBM Plex Sans, sans-serif", fontSize: 9, color: "#92400e", lineHeight: 1.5,
      }}>
        <strong style={{ color: "#fbbf24" }}>LAYER 1 — INGESTION ONLY.</strong>{" "}
        Multi-leg detection, intent classification, and scoring are not yet active (Layers 2–4).
        Aggressor confidence marked <span style={{ color: "#f87171" }}>low</span> when quote age &gt;60s (Polygon Developer tier — no real-time NBBO stream).
        <span style={{ color: "#475569", marginLeft: 6 }}>See docs/adr/002-polygon-developer-tier.md</span>
      </div>

      {/* ── Two-column layout: live feed (left) + today's top (right) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>

        {/* ── LIVE FEED ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", letterSpacing: "0.12em" }}>
              LIVE FEED ({filteredLive.length} shown)
            </span>
            {/* Size filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155" }}>MIN SIZE</span>
              {[1, 10, 25, 50, 100].map(n => (
                <button key={n} onClick={() => setMinSize(n)} style={{
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 8, padding: "2px 5px",
                  background: minSize === n ? "#1e3a5f" : "#0d1829",
                  border: "1px solid #1e3a5f", borderRadius: 2,
                  color: minSize === n ? "#7dd3fc" : "#475569", cursor: "pointer",
                }}>{n}</button>
              ))}
            </div>
          </div>

          {filteredLive.length === 0 ? (
            <div style={{
              background: "#060b14", border: "1px solid #1e3a5f", borderRadius: 4,
              padding: "24px", textAlign: "center",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#334155",
            }}>
              {sseState === "connecting" ? "Connecting to live stream..." :
               effectiveStatus?.state !== "active" ? "Waiting for Polygon WebSocket to connect..." :
               liveTrades.length === 0 ? "No trades yet — market may be closed, or INTC options have low activity." :
               `All ${liveTrades.length} recent trades below size filter (${minSize} contracts). Lower the filter.`}
            </div>
          ) : (
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", whiteSpace: "nowrap" }}>
                <thead>
                  <tr>
                    {["Time", "Ticker", "Contract", "Size", "Price", "Premium", "Direction", "Confidence", "Greeks"].map(h => (
                      <th key={h} style={{
                        fontFamily: "IBM Plex Mono, monospace", fontSize: 7, color: "#334155",
                        fontWeight: 700, padding: "3px 6px", background: "#0a1220",
                        borderBottom: "1px solid #1e3a5f", textAlign: h === "Time" || h === "Ticker" || h === "Contract" ? "left" : "right",
                        position: "sticky", top: 0, zIndex: 2,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLive.map(t => (
                    <TradeRow
                      key={`${t.timestamp}-${t.optionSymbol}`}
                      t={t}
                      isNew={newTradeIds.has(t.timestamp)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── TODAY'S TOP PRINTS ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", letterSpacing: "0.12em" }}>
              TODAY'S TOP PRINTS (by premium)
            </span>
            <button onClick={() => refetchToday()} style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 8, padding: "2px 6px",
              background: "#0d1829", border: "1px solid #1e3a5f", borderRadius: 2,
              color: "#475569", cursor: "pointer", marginLeft: "auto",
            }}>↻</button>
          </div>

          {!todayData?.trades?.length ? (
            <div style={{
              background: "#060b14", border: "1px solid #1e3a5f", borderRadius: 4,
              padding: "24px", textAlign: "center",
              fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "#334155",
            }}>
              No trades recorded today yet.
            </div>
          ) : (
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 200px)" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", whiteSpace: "nowrap" }}>
                <thead>
                  <tr>
                    {["Time", "Ticker", "Contract", "Size", "Price", "Premium", "Direction", "Confidence", "Greeks"].map(h => (
                      <th key={h} style={{
                        fontFamily: "IBM Plex Mono, monospace", fontSize: 7, color: "#334155",
                        fontWeight: 700, padding: "3px 6px", background: "#0a1220",
                        borderBottom: "1px solid #1e3a5f", textAlign: h === "Time" || h === "Ticker" || h === "Contract" ? "left" : "right",
                        position: "sticky", top: 0, zIndex: 2,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {todayData.trades.map(t => (
                    <TradeRow key={`today-${t.timestamp}-${t.optionSymbol}`} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Snapshot / WS debug panel ── */}
      {effectiveStatus && (
        <div style={{
          marginTop: 16, padding: "8px 12px",
          background: "#060b14", border: "1px solid #0d1829", borderRadius: 3,
        }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#334155", letterSpacing: "0.12em", marginBottom: 4 }}>
            SYSTEM DIAGNOSTICS
          </div>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>WS STATE: </span>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: wsStateColor(effectiveStatus.state) }}>{effectiveStatus.state}</span>
            </div>
            <div>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>SNAPSHOT CACHE: </span>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#94a3b8" }}>{effectiveStatus.snapshotCacheSize} contracts</span>
            </div>
            {Object.entries(effectiveStatus.snapshotLastRefresh).map(([u, age]) => (
              <div key={u}>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>SNAP {u}: </span>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "#475569" }}>{age}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
