/**
 * flowWs.ts — Polygon Options WebSocket connection manager
 *
 * Connects to wss://socket.polygon.io/options, authenticates with
 * POLYGON_API_KEY, and subscribes to real-time options trades (T.*).
 * Filters in-process for configured underlyings.
 *
 * For each incoming trade:
 *   1. Parse OCC symbol → underlying / expiry / right / strike
 *   2. Look up bid/ask/greeks from in-memory snapshot cache (60s TTL)
 *   3. Compute aggressor side + confidence
 *   4. Compute derived fields (premium, delta-adj premium, DTE)
 *   5. Persist to options_trades via flowStorage
 *   6. Emit EnrichedTrade to all registered handlers (SSE broadcaster)
 *
 * Subscription tier: Polygon Options Developer (~$79/mo).
 *
 * KNOWN LIMITATIONS (see docs/adr/002-polygon-developer-tier.md):
 *
 * 1. No real-time NBBO stream (Advanced tier only). Aggressor tagging uses
 *    snapshot bid/ask, refreshed every 60s. quoteAgeMs = time between the
 *    snapshot's quote timestamp and the trade's SIP timestamp. When this
 *    exceeds 60s, aggressorConfidence is set to 'low' and aggressorSide to
 *    'unknown'. This is a structural limitation of the Developer tier —
 *    all aggressor calls on illiquid contracts should be treated as noise.
 *
 * 2. OPRA condition codes. Polygon does not provide full OPRA condition
 *    codes at this tier. We store raw exchange condition integers but cannot
 *    reliably distinguish sweep-of-the-floor, block, ISO, or SPHR (floor
 *    print) trades. Plan v2 migration: CBOE LiveVol DataShop or Databento.
 *
 * 3. Closing trades. Size > OI is a strong opening signal. Size <= OI is
 *    ambiguous — the trade could be opening or closing. closing_probability
 *    is a heuristic computed in flowClassify.ts. Surface uncertainty rather
 *    than guessing.
 *
 * 4. Stock position context unavailable. Covered calls vs naked shorts are
 *    indistinguishable from options-only data. Intent classifier tags these
 *    as 'ambiguous'.
 *
 * 5. OTM% requires the underlying spot price. Stubbed as 0 in Layer 1.
 *    Layer 3 will pull spot from the existing fetchOHLCV infrastructure.
 */

import WebSocket from "ws";
import axios from "axios";
import { insertOptionsTrade } from "./flowStorage";

const POLYGON_KEY = process.env.POLYGON_API_KEY ?? "";
const WS_URL = "wss://socket.polygon.io/options";
// Snapshot refresh cadence. Trade quotes older than this relative to the
// trade timestamp will receive aggressorConfidence = 'low'.
const SNAPSHOT_TTL_MS = 60_000;
// Maximum reconnect delay (doubles from 1s up to this cap)
const MAX_RECONNECT_DELAY_MS = 60_000;

// ── Logging ───────────────────────────────────────────────────────────────────

function wsLog(msg: string) {
  const t = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "2-digit", second: "2-digit" });
  console.log(`${t} [flowWs] ${msg}`);
}

// ── OCC Symbol Parser ─────────────────────────────────────────────────────────
//
// OCC format: O:{UNDERLYING}{YYMMDD}{C|P}{STRIKE×1000, 8 digits}
// Example:    O:INTC260117C00027000 → INTC, 2026-01-17, Call, $27.000
// Underlying may contain dots (e.g. BRK.B) — [A-Z.]+ handles these.

export interface ParsedOCC {
  underlying: string; // e.g. "INTC"
  expiry: string;     // YYYY-MM-DD
  right: "C" | "P";
  strike: number;     // dollars, e.g. 27.0
}

export function parseOCC(symbol: string): ParsedOCC | null {
  const raw = symbol.startsWith("O:") ? symbol.slice(2) : symbol;
  const m = raw.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, dateStr, right, strikeStr] = m;
  const yr = parseInt(dateStr.slice(0, 2), 10) + 2000;
  const expiry = `${yr}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  return { underlying, expiry, right: right as "C" | "P", strike };
}

// ── Snapshot Cache ────────────────────────────────────────────────────────────
//
// Keyed by full OCC symbol (with O: prefix).
// Refreshed by polling /v3/snapshot/options/{underlying} every SNAPSHOT_TTL_MS.
// Used for: bid/ask (aggressor tagging), OI (opening probability), IV + delta
// (scoring inputs).

interface SnapshotEntry {
  bid: number;
  ask: number;
  mid: number;
  quoteTimestamp: number; // ms — from Polygon's last_quote.last_updated
  oi: number;
  iv: number;
  delta: number;
}

const snapshotCache = new Map<string, SnapshotEntry>();
const snapshotLastRefresh: Record<string, number> = {};

async function refreshSnapshot(underlying: string): Promise<void> {
  if (!POLYGON_KEY) return;
  try {
    // Fetch up to 250 contracts per page. For large chains (SPY, QQQ) this
    // may require pagination — add pagination in Layer 2 when expanding to
    // index ETFs. For INTC, 250 covers the full active chain.
    const url =
      `https://api.polygon.io/v3/snapshot/options/${underlying}` +
      `?limit=250&apiKey=${POLYGON_KEY}`;
    const resp = await axios.get(url, { timeout: 10_000 });
    const results: any[] = resp.data?.results ?? [];

    for (const r of results) {
      const ticker: string = r.ticker;
      if (!ticker) continue;
      const lq = r.last_quote ?? {};
      const bid = lq.bid ?? 0;
      const ask = lq.ask ?? 0;
      // Polygon returns last_updated in nanoseconds for some endpoints,
      // milliseconds for others. Normalize: if > 1e15, divide by 1e6.
      const rawTs: number = lq.last_updated ?? lq.sip_timestamp ?? 0;
      const quoteTimestamp = rawTs > 1e15 ? Math.round(rawTs / 1e6) : rawTs;

      snapshotCache.set(ticker, {
        bid,
        ask,
        mid: lq.midpoint ?? (bid + ask) / 2,
        quoteTimestamp: quoteTimestamp || Date.now() - SNAPSHOT_TTL_MS,
        oi: r.open_interest ?? 0,
        iv: r.implied_volatility ?? 0,
        delta: r.greeks?.delta ?? 0,
      });
    }

    snapshotLastRefresh[underlying] = Date.now();
    wsLog(`Snapshot refreshed: ${underlying} (${results.length} contracts cached)`);
  } catch (err: any) {
    console.error(`[flowWs] Snapshot refresh failed for ${underlying}: ${err?.message}`);
  }
}

// ── Aggressor Tagger ──────────────────────────────────────────────────────────
//
// Classifies the trade as buyer-initiated (ask-side) or seller-initiated
// (bid-side) based on price relative to the spread.
//
// confidence = 'high':   price is at/beyond the near edge of the spread
// confidence = 'medium': price is inside the spread but clearly bid or ask side
// confidence = 'low':    quote is stale, spread is zero, or price is at mid
//
// Context required for interpretation (Layer 3):
//   ask-side call  → bullish initiator
//   bid-side put   → bullish initiator (sold put = synthetic long)
//   ask-side put   → bearish initiator (bought put)
//   bid-side call  → bearish or covered call (ambiguous without stock data)

export type AggressorSide = "ask" | "bid" | "mid" | "unknown";
export type AggressorConfidence = "high" | "medium" | "low";

function tagAggressor(
  price: number,
  bid: number,
  ask: number,
  quoteAgeMs: number,
): { side: AggressorSide; confidence: AggressorConfidence } {
  // Structural limitation: snapshot quotes are refreshed every 60s.
  // Per spec: flag confidence 'low' when NBBO is stale beyond ~1s from trade.
  // At Developer tier, virtually all quotes exceed 1s staleness. We use 60s as
  // the low-confidence threshold — within one snapshot cycle the spread is
  // likely still representative for liquid options, beyond it we cannot tell.
  if (quoteAgeMs > 60_000 || bid <= 0 || ask <= 0) {
    return { side: "unknown", confidence: "low" };
  }

  const spread = ask - bid;
  if (spread <= 0) {
    return { side: "unknown", confidence: "low" };
  }

  // Buffer: 20% of spread avoids misclassifying mid-prints as directional
  const buf = spread * 0.2;

  if (price >= ask - buf) {
    const overAsk = price - ask;
    // Paid above ask = aggressive buyer, high conviction
    const conf: AggressorConfidence = overAsk >= 0 ? "high" : "medium";
    return { side: "ask", confidence: conf };
  }

  if (price <= bid + buf) {
    const belowBid = bid - price;
    const conf: AggressorConfidence = belowBid >= 0 ? "high" : "medium";
    return { side: "bid", confidence: conf };
  }

  return { side: "mid", confidence: "low" };
}

// ── DTE Calculator ────────────────────────────────────────────────────────────

function calcDte(expiry: string): number {
  // Options formally expire at market close (4pm ET ≈ 20:00 UTC) on expiry date.
  const expiryMs = new Date(`${expiry}T20:00:00Z`).getTime();
  return Math.max(0, Math.ceil((expiryMs - Date.now()) / 86_400_000));
}

// ── Enriched Trade Type ────────────────────────────────────────────────────────

export interface EnrichedTrade {
  timestamp: number;
  optionSymbol: string;
  underlying: string;
  expiry: string;
  right: "C" | "P";
  strike: number;
  price: number;
  size: number;
  exchange: string;
  conditions: number[];
  sequenceNumber: number;
  aggressorSide: AggressorSide;
  aggressorConfidence: AggressorConfidence;
  bid: number;
  ask: number;
  mid: number;
  quoteAgeMs: number;
  oi: number;
  iv: number;
  delta: number;
  premium: number;         // price × size × 100 (total dollar notional)
  deltaAdjPremium: number; // premium × |delta|
  dte: number;
  otmPct: number;          // 0 in Layer 1; populated in Layer 3
}

// ── Trade Handlers ────────────────────────────────────────────────────────────

type TradeHandler = (trade: EnrichedTrade) => void;
const handlers = new Set<TradeHandler>();

export function onTrade(handler: TradeHandler): void {
  handlers.add(handler);
}
export function offTrade(handler: TradeHandler): void {
  handlers.delete(handler);
}

// ── Raw Polygon Message Types ─────────────────────────────────────────────────

interface PolyStatusEvent {
  ev: "status";
  status: "connected" | "auth_success" | "auth_failed" | "success" | "error";
  message?: string;
}

interface PolyTradeEvent {
  ev: "T";
  sym: string;   // full OCC symbol, e.g. "O:INTC260117C00027000"
  x: number;    // exchange ID
  p: number;    // price
  s: number;    // size (contracts)
  c?: number[]; // condition codes
  t: number;    // SIP timestamp ms
  q?: number;   // sequence number
}

// ── Enrichment Pipeline ───────────────────────────────────────────────────────

async function enrichAndEmit(raw: PolyTradeEvent): Promise<void> {
  const parsed = parseOCC(raw.sym);
  if (!parsed) return;

  const snap = snapshotCache.get(raw.sym);
  // quoteAgeMs: how stale the bid/ask was relative to when the trade happened
  const quoteAgeMs = snap
    ? Math.max(0, raw.t - snap.quoteTimestamp)
    : Number.POSITIVE_INFINITY;

  const bid = snap?.bid ?? 0;
  const ask = snap?.ask ?? 0;
  const mid = snap ? (bid + ask) / 2 : raw.p;
  const { side: aggressorSide, confidence: aggressorConfidence } =
    tagAggressor(raw.p, bid, ask, quoteAgeMs);

  const premium = raw.p * raw.s * 100;
  const delta = snap?.delta ?? 0;
  // If delta is unknown, use 0.5 as a conservative proxy (avoid zero)
  const effectiveDelta = Math.abs(delta) > 0.01 ? Math.abs(delta) : 0.5;
  const deltaAdjPremium = premium * effectiveDelta;

  const trade: EnrichedTrade = {
    timestamp: raw.t,
    optionSymbol: raw.sym,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    right: parsed.right,
    strike: parsed.strike,
    price: raw.p,
    size: raw.s,
    exchange: String(raw.x),
    conditions: raw.c ?? [],
    sequenceNumber: raw.q ?? 0,
    aggressorSide,
    aggressorConfidence,
    bid,
    ask,
    mid,
    quoteAgeMs: isFinite(quoteAgeMs) ? quoteAgeMs : -1,
    oi: snap?.oi ?? 0,
    iv: snap?.iv ?? 0,
    delta,
    premium,
    deltaAdjPremium,
    dte: calcDte(parsed.expiry),
    otmPct: 0, // TODO Layer 3: requires underlying spot price from fetchOHLCV
  };

  // Persist
  try {
    await insertOptionsTrade(trade);
  } catch (err: any) {
    console.error("[flowWs] DB insert failed:", err?.message);
  }

  // Broadcast to all registered handlers (SSE broadcaster, tests, etc.)
  handlers.forEach(h => {
    try { h(trade); } catch { /* never let a broken handler kill ingestion */ }
  });
}

// ── WebSocket State Machine ───────────────────────────────────────────────────

type WsState = "disconnected" | "connecting" | "auth_pending" | "active";

let ws: WebSocket | null = null;
let wsState: WsState = "disconnected";
let reconnectDelay = 1_000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Underlyings we want to watch. We subscribe to T.* and filter in-process.
// Note: Polygon options websocket may support per-underlying wildcards
// (T.O:INTC*) but the exact syntax is not documented reliably. Using T.*
// with in-process filter is safe at Developer tier volumes for 1–5 underlyings.
// Optimize to per-underlying subscription in Layer 2 when scaling.
const watchedUnderlyings = new Set<string>();

function sendWs(msg: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connectWs(): void {
  if (wsState !== "disconnected") return;
  wsState = "connecting";
  wsLog(`Connecting to ${WS_URL} ...`);

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    wsLog("Socket open — authenticating");
    wsState = "auth_pending";
    sendWs({ action: "auth", params: POLYGON_KEY });
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    let events: any[];
    try {
      const parsed = JSON.parse(raw.toString());
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return;
    }

    for (const ev of events) {
      // Status / control messages
      if (ev.ev === "status") {
        const s = ev as PolyStatusEvent;
        if (s.status === "connected") {
          wsLog("Connected — waiting for auth");
        } else if (s.status === "auth_success") {
          wsLog("Authenticated — subscribing to T.*");
          wsState = "active";
          reconnectDelay = 1_000; // reset backoff on successful session
          // Subscribe to all options trades; we filter by underlying in-process.
          sendWs({ action: "subscribe", params: "T.*" });
        } else if (s.status === "auth_failed") {
          console.error(`[flowWs] Auth failed: ${s.message} — check POLYGON_API_KEY`);
          ws?.close();
        } else if (s.status === "success") {
          wsLog(`Subscription confirmed: ${s.message}`);
        } else if (s.status === "error") {
          console.error(`[flowWs] Server error: ${s.message}`);
        }
        continue;
      }

      // Options trade events
      if (ev.ev === "T") {
        const trade = ev as PolyTradeEvent;
        const parsed = parseOCC(trade.sym);
        if (!parsed) continue;
        if (!watchedUnderlyings.has(parsed.underlying)) continue;
        // Fire-and-forget — DB insert is async but we don't await here so
        // the message loop is never blocked.
        enrichAndEmit(trade).catch(err =>
          console.error("[flowWs] enrichAndEmit error:", err?.message)
        );
      }
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    wsLog(`Connection closed (${code}: ${reason.toString() || "no reason"})`);
    wsState = "disconnected";
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (err: Error) => {
    // The 'close' event fires after 'error' — reconnect logic lives there.
    console.error("[flowWs] WebSocket error:", err.message);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  wsLog(`Reconnecting in ${reconnectDelay / 1_000}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
}

// ── Snapshot Refresh Loop ─────────────────────────────────────────────────────

let snapshotInterval: ReturnType<typeof setInterval> | null = null;

function startSnapshotRefreshLoop(): void {
  if (snapshotInterval) return;
  snapshotInterval = setInterval(() => {
    watchedUnderlyings.forEach(u => {
      refreshSnapshot(u).catch(err =>
        console.error("[flowWs] Snapshot refresh error:", err?.message)
      );
    });
  }, SNAPSHOT_TTL_MS);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start ingesting options trades for the given underlying symbols.
 * Safe to call multiple times — adds new underlyings to the watched set
 * without restarting an active connection.
 *
 * Layer 1: call with ['INTC'] for initial testing.
 */
export function startFlowIngestion(underlyings: string[]): void {
  if (!POLYGON_KEY) {
    console.error("[flowWs] POLYGON_API_KEY not set — flow ingestion disabled");
    return;
  }

  const added: string[] = [];
  for (const u of underlyings) {
    const sym = u.toUpperCase();
    if (!watchedUnderlyings.has(sym)) {
      watchedUnderlyings.add(sym);
      added.push(sym);
    }
  }

  if (added.length === 0) return;

  wsLog(`Adding underlyings: ${added.join(", ")} (watching: ${Array.from(watchedUnderlyings).join(", ")})`);

  // Initial snapshot fetch for new underlyings
  added.forEach(u => {
    refreshSnapshot(u).catch(err =>
      console.error("[flowWs] Initial snapshot error:", err?.message)
    );
  });

  // Start snapshot refresh loop (idempotent)
  startSnapshotRefreshLoop();

  // Connect websocket if not already connected/connecting
  if (wsState === "disconnected" && !reconnectTimer) {
    connectWs();
  }
}

/** Returns current connection status for the /api/flow/status endpoint. */
export function getWsStatus() {
  return {
    state: wsState,
    watchedUnderlyings: Array.from(watchedUnderlyings),
    snapshotCacheSize: snapshotCache.size,
    snapshotLastRefresh: Object.fromEntries(
      Array.from(watchedUnderlyings).map(u => [
        u,
        snapshotLastRefresh[u]
          ? Math.round((Date.now() - snapshotLastRefresh[u]) / 1_000) + "s ago"
          : "never",
      ])
    ),
  };
}
