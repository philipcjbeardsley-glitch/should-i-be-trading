/**
 * flowRoutes.ts — Express router for /api/flow/*
 *
 * Endpoints:
 *   GET /api/flow/status      — websocket connection state + DB stats
 *   GET /api/flow/trades      — paginated recent trades from DB
 *   GET /api/flow/trades/today — today's top prints by premium
 *   GET /api/flow/stream      — Server-Sent Events live feed
 *   PATCH /api/flow/alerts/:id/label — apply a user label to an alert
 *
 * The SSE endpoint (/api/flow/stream) is the primary real-time interface.
 * The frontend FlowTab connects via EventSource and receives:
 *   event: trade   — every new EnrichedTrade as it's ingested
 *   event: status  — periodic websocket health pings (every 30s)
 *
 * No authentication guard in Layer 1 — this app has no multi-user auth on
 * the market-data tabs (same pattern as /api/breadth, /api/dashboard, etc.).
 */

import { Router, type Request, type Response } from "express";
import { onTrade, offTrade, getWsStatus, getWsHealth, type EnrichedTrade } from "./flowWs";
import {
  getRecentTrades,
  getTodayTopTrades,
  getTradeCount,
  getTodayTotalPremium,
  labelAlert,
  getRecentAlerts,
  getActiveCampaigns,
} from "./flowStorage";

export const flowRouter = Router();

// ── Query param helper ────────────────────────────────────────────────────────
// Express query params can be string | ParsedQs | string[] | ParsedQs[].
// Coerce to string | undefined for safe parseInt / passthrough.
function qs(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v[0] != null ? String(v[0]) : undefined;
  return String(v);
}

// ── SSE Broadcaster ───────────────────────────────────────────────────────────
//
// Maintains a set of active SSE response objects. When flowWs emits a trade,
// we serialize it and write to all connected clients.

const sseClients = new Set<Response>();

function broadcastTrade(trade: EnrichedTrade): void {
  if (sseClients.size === 0) return;
  const data = JSON.stringify(trade);
  const chunk = `event: trade\ndata: ${data}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(chunk);
    } catch {
      sseClients.delete(res);
    }
  });
}

// Register the broadcaster with the websocket manager once at module load.
// This runs when flowRoutes.ts is first imported (i.e., at server startup).
onTrade(broadcastTrade);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/flow/health
 * Detailed diagnostic endpoint: snapshot cache state, last fetch status/error,
 * trades received in the last hour, WS reconnect count, API key presence.
 * Use this to debug snapshot refresh issues.
 */
flowRouter.get("/health", (_req: Request, res: Response) => {
  try {
    const health = getWsHealth();
    res.json(health);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/status
 * Returns current WS connection state and basic DB statistics.
 * The FlowTab polls this to display a connection indicator.
 */
flowRouter.get("/status", (_req: Request, res: Response) => {
  try {
    const ws = getWsStatus();
    const db = {
      totalTrades: getTradeCount(),
      todayPremium: getTodayTotalPremium(),
    };
    res.json({ ws, db, sseClients: sseClients.size, timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/trades
 * Query params:
 *   underlying  — filter by underlying symbol (e.g. "INTC")
 *   minSize     — minimum contract size (integer)
 *   minPremium  — minimum dollar notional
 *   since       — Unix ms timestamp lower bound
 *   limit       — max rows (1–500, default 100)
 */
flowRouter.get("/trades", (req: Request, res: Response) => {
  try {
    const underlying = qs(req.query.underlying);
    const minSize    = qs(req.query.minSize);
    const minPremium = qs(req.query.minPremium);
    const since      = qs(req.query.since);
    const limit      = qs(req.query.limit);
    const trades = getRecentTrades({
      underlying: underlying || undefined,
      minSize: minSize ? parseInt(minSize, 10) : undefined,
      minPremium: minPremium ? parseFloat(minPremium) : undefined,
      since: since ? parseInt(since, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    res.json({ trades, count: trades.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/trades/today
 * Today's top prints sorted by dollar premium. Used in the "Top Prints" panel.
 */
flowRouter.get("/trades/today", (req: Request, res: Response) => {
  try {
    const limit = qs(req.query.limit) ? parseInt(qs(req.query.limit)!, 10) : 50;
    const trades = getTodayTopTrades(Math.min(limit, 200));
    res.json({ trades, count: trades.length, date: new Date().toISOString().slice(0, 10) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/alerts
 * Recent fired alerts (Layers 6–7 will populate these).
 */
flowRouter.get("/alerts", (req: Request, res: Response) => {
  try {
    const limit = qs(req.query.limit) ? parseInt(qs(req.query.limit)!, 10) : 50;
    const alerts = getRecentAlerts(Math.min(limit, 200));
    res.json({ alerts, count: alerts.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * PATCH /api/flow/alerts/:id/label
 * Body: { label: string, notes?: string }
 * Labels: "real_directional" | "hedge" | "spread_leg" | "closing_trade" | "unknown"
 */
flowRouter.patch("/alerts/:id/label", (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { label, notes } = req.body as { label: string; notes?: string };
    const validLabels = ["real_directional", "hedge", "spread_leg", "closing_trade", "unknown"];
    if (!validLabels.includes(label)) {
      return res.status(400).json({ error: `Invalid label. Must be one of: ${validLabels.join(", ")}` });
    }
    labelAlert(id, label, notes);
    res.json({ ok: true, id, label });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/campaigns
 * Active institutional campaigns (Layer 5 will populate these).
 */
flowRouter.get("/campaigns", (_req: Request, res: Response) => {
  try {
    const campaigns = getActiveCampaigns();
    res.json({ campaigns, count: campaigns.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/flow/stream
 * Server-Sent Events endpoint for the real-time live feed.
 *
 * The client connects via:
 *   const es = new EventSource('/api/flow/stream');
 *   es.addEventListener('trade', e => { const trade = JSON.parse(e.data); ... });
 *   es.addEventListener('status', e => { ... });
 *
 * A keepalive comment is written every 30s to prevent proxy timeouts.
 * A status ping is written every 30s with current WS + DB state.
 */
flowRouter.get("/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  // Disable response buffering so events reach the client immediately
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send an initial status event so the client knows the connection is live
  const initialStatus = JSON.stringify({ ...getWsStatus(), connected: true });
  res.write(`event: status\ndata: ${initialStatus}\n\n`);

  sseClients.add(res);

  // Keepalive + periodic status ping every 30s
  const pingInterval = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
      const statusData = JSON.stringify(getWsStatus());
      res.write(`event: status\ndata: ${statusData}\n\n`);
    } catch {
      clearInterval(pingInterval);
      sseClients.delete(res);
    }
  }, 30_000);

  req.on("close", () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
  });
});
