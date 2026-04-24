/**
 * flowStorage.ts — Database operations for the Options Flow Scanner
 *
 * All queries use Drizzle ORM's query builder. No raw SQL strings.
 * Portable to Postgres — see docs/adr/001-sqlite-mvp.md for migration path.
 *
 * The `db` instance is imported from storage.ts (shared connection).
 * SQLite WAL mode is already enabled there.
 */

import { db } from "./storage";
import {
  optionsTrades,
  nbboSnapshots,
  classifiedPrints,
  campaigns,
  flowAlerts,
} from "@shared/schema";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import type { EnrichedTrade } from "./flowWs";

// ── Options Trades ────────────────────────────────────────────────────────────

/**
 * Persist an enriched trade to options_trades.
 * Returns the new row's id.
 */
export function insertOptionsTrade(trade: EnrichedTrade): number {
  const result = db
    .insert(optionsTrades)
    .values({
      timestamp: trade.timestamp,
      underlying: trade.underlying,
      optionSymbol: trade.optionSymbol,
      expiry: trade.expiry,
      strike: trade.strike,
      right: trade.right,
      price: trade.price,
      size: trade.size,
      exchange: trade.exchange,
      conditions: JSON.stringify(trade.conditions),
      sequenceNumber: trade.sequenceNumber,
      aggressorSide: trade.aggressorSide,
      aggressorConfidence: trade.aggressorConfidence,
      bid: trade.bid,
      ask: trade.ask,
      quoteAgeMs: trade.quoteAgeMs,
      oi: trade.oi,
      iv: trade.iv,
      delta: trade.delta,
      premium: trade.premium,
      deltaAdjPremium: trade.deltaAdjPremium,
      dte: trade.dte,
      otmPct: trade.otmPct,
    })
    .returning({ id: optionsTrades.id })
    .get();
  return result.id;
}

/**
 * Fetch recent trades, newest first.
 *
 * opts.underlying — filter to a single underlying (e.g. "INTC")
 * opts.minSize    — minimum contract size filter (default 1)
 * opts.minPremium — minimum dollar notional filter
 * opts.since      — only trades after this Unix ms timestamp
 * opts.limit      — max rows returned (default 100, max 500)
 */
export function getRecentTrades(opts: {
  underlying?: string;
  minSize?: number;
  minPremium?: number;
  since?: number;
  limit?: number;
} = {}) {
  const {
    underlying,
    minSize = 1,
    minPremium,
    since,
    limit = 100,
  } = opts;

  const safeLimit = Math.min(limit, 500);
  const conditions: ReturnType<typeof eq>[] = [];

  if (underlying) conditions.push(eq(optionsTrades.underlying, underlying));
  if (minSize > 1)
    conditions.push(
      // Drizzle sqlite doesn't have a native "gte on real column in integer filter"
      // issue — gte works across integer and real columns in SQLite.
      sql`${optionsTrades.size} >= ${minSize}` as any
    );
  if (minPremium != null)
    conditions.push(sql`${optionsTrades.premium} >= ${minPremium}` as any);
  if (since != null) conditions.push(gte(optionsTrades.timestamp, since));

  const base = db
    .select()
    .from(optionsTrades)
    .orderBy(desc(optionsTrades.timestamp))
    .limit(safeLimit);

  if (conditions.length === 0) return base.all();
  if (conditions.length === 1) return base.where(conditions[0]).all();
  return base.where(and(...conditions)).all();
}

/**
 * Retrieve a single trade by id.
 */
export function getTradeById(id: number) {
  return db
    .select()
    .from(optionsTrades)
    .where(eq(optionsTrades.id, id))
    .get();
}

/**
 * Count total trades in the DB. Used by /api/flow/status.
 */
export function getTradeCount(): number {
  const result = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(optionsTrades)
    .get();
  return result?.count ?? 0;
}

/**
 * Sum of premium (dollar notional) for today's session.
 * "Today" = since midnight UTC of the current calendar day.
 */
export function getTodayTotalPremium(): number {
  const dayStartMs = new Date();
  dayStartMs.setUTCHours(0, 0, 0, 0);
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${optionsTrades.premium}), 0)` })
    .from(optionsTrades)
    .where(gte(optionsTrades.timestamp, dayStartMs.getTime()))
    .get();
  return result?.total ?? 0;
}

/**
 * Top N trades today by dollar premium, newest first on ties.
 * Used by the Flow tab's "Today's Top Prints" panel.
 */
export function getTodayTopTrades(limit = 50) {
  const dayStartMs = new Date();
  dayStartMs.setUTCHours(0, 0, 0, 0);
  return db
    .select()
    .from(optionsTrades)
    .where(gte(optionsTrades.timestamp, dayStartMs.getTime()))
    .orderBy(desc(optionsTrades.premium))
    .limit(limit)
    .all();
}

// ── NBBO Snapshots ────────────────────────────────────────────────────────────

/**
 * Persist a snapshot of the full chain quote data for one underlying.
 * Called by the snapshot refresh loop in flowWs.ts.
 * Each call writes one row per contract in the snapshot.
 */
export function insertNbboSnapshot(rows: {
  capturedAt: number;
  underlying: string;
  optionSymbol: string;
  bid: number | null;
  bidSize: number | null;
  ask: number | null;
  askSize: number | null;
  quoteTime: number | null;
  iv: number | null;
  delta: number | null;
  oi: number | null;
}[]) {
  if (rows.length === 0) return;
  // Drizzle SQLite supports batch insert via values([...])
  db.insert(nbboSnapshots).values(rows).run();
}

// ── Classified Prints ─────────────────────────────────────────────────────────
//
// These functions are stubs in Layer 1 — classification runs in Layer 3/4.

export function insertClassifiedPrint(row: {
  tradeId: number;
  isSpreadLeg?: number;
  spreadGroupId?: number | null;
  structureType?: string | null;
  intentDirection?: string | null;
  intentConfidence?: number | null;
  openingProbability?: number | null;
  closingProbability?: number | null;
  score?: number | null;
  sizeVsOiRatio?: number | null;
  ivChange?: number | null;
  isPreEarnings?: number;
  daysToEarnings?: number | null;
  campaignId?: number | null;
}): number {
  const result = db
    .insert(classifiedPrints)
    .values({
      tradeId: row.tradeId,
      isSpreadLeg: row.isSpreadLeg ?? 0,
      spreadGroupId: row.spreadGroupId ?? null,
      structureType: row.structureType ?? null,
      intentDirection: row.intentDirection ?? null,
      intentConfidence: row.intentConfidence ?? null,
      openingProbability: row.openingProbability ?? null,
      closingProbability: row.closingProbability ?? null,
      score: row.score ?? null,
      sizeVsOiRatio: row.sizeVsOiRatio ?? null,
      ivChange: row.ivChange ?? null,
      isPreEarnings: row.isPreEarnings ?? 0,
      daysToEarnings: row.daysToEarnings ?? null,
      campaignId: row.campaignId ?? null,
    })
    .returning({ id: classifiedPrints.id })
    .get();
  return result.id;
}

// ── Flow Alerts ───────────────────────────────────────────────────────────────

export function insertFlowAlert(row: {
  tradeId: number;
  firedAt: number;
  score: number;
  alertPayload: object;
}): number {
  const result = db
    .insert(flowAlerts)
    .values({
      tradeId: row.tradeId,
      firedAt: row.firedAt,
      score: row.score,
      alertPayload: JSON.stringify(row.alertPayload),
    })
    .returning({ id: flowAlerts.id })
    .get();
  return result.id;
}

/**
 * Update a user label on an alert. Called by the review/labeling UI.
 */
export function labelAlert(
  alertId: number,
  label: string,
  notes?: string
): void {
  db.update(flowAlerts)
    .set({
      userLabel: label,
      labelNotes: notes ?? null,
      labeledAt: Date.now(),
    })
    .where(eq(flowAlerts.id, alertId))
    .run();
}

export function getRecentAlerts(limit = 50) {
  return db
    .select()
    .from(flowAlerts)
    .orderBy(desc(flowAlerts.firedAt))
    .limit(limit)
    .all();
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
//
// Stubs in Layer 1 — campaign tracking runs in Layer 5.

export function upsertCampaign(row: {
  underlying: string;
  direction: string;
  structureFamily?: string | null;
  firstSeen: number;
  lastSeen: number;
  totalPremium: number;
  totalPrints: number;
  score: number;
}): number {
  const result = db
    .insert(campaigns)
    .values({
      underlying: row.underlying,
      direction: row.direction,
      structureFamily: row.structureFamily ?? null,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      totalPremium: row.totalPremium,
      totalPrints: row.totalPrints,
      score: row.score,
      isActive: 1,
    })
    .returning({ id: campaigns.id })
    .get();
  return result.id;
}

export function getActiveCampaigns() {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.isActive, 1))
    .orderBy(desc(campaigns.score))
    .all();
}
