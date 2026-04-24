import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Options Flow Scanner ──────────────────────────────────────────────────────
//
// Portability note (see docs/adr/001-sqlite-mvp.md):
//   - integer → Postgres bigint / integer
//   - real    → Postgres double precision
//   - text    → Postgres text
//   - JSON arrays/objects stored as text; swap to jsonb on Postgres migration
//
// All timestamps are Unix milliseconds (UTC). Convert to ISO strings at API boundary.

// Raw OPRA trade as received from Polygon websocket, plus synchronously-computed
// aggressor fields from snapshot cache. Intentionally denormalized for query speed.
export const optionsTrades = sqliteTable("options_trades", {
  id:                  integer("id").primaryKey({ autoIncrement: true }),
  // Core trade fields (from Polygon T.O:* event)
  timestamp:           integer("timestamp").notNull(),        // SIP timestamp, Unix ms
  underlying:          text("underlying").notNull(),          // e.g. "INTC"
  optionSymbol:        text("option_symbol").notNull(),       // OCC with prefix e.g. "O:INTC260117C00027000"
  expiry:              text("expiry").notNull(),               // YYYY-MM-DD
  strike:              real("strike").notNull(),               // e.g. 27.0
  right:               text("right").notNull(),               // "C" | "P"
  price:               real("price").notNull(),               // dollars per contract
  size:                integer("size").notNull(),             // number of contracts
  exchange:            text("exchange"),                      // Polygon exchange code (string)
  conditions:          text("conditions"),                    // JSON: number[] — raw condition codes
  sequenceNumber:      integer("sequence_number"),
  // Aggressor fields (computed from snapshot cache at ingestion time)
  // Limitation: snapshot is refreshed every 60s — see docs/adr/002-polygon-developer-tier.md
  aggressorSide:       text("aggressor_side"),               // "ask"|"bid"|"mid"|"unknown"
  aggressorConfidence: text("aggressor_confidence"),         // "high"|"medium"|"low"
  bid:                 real("bid"),                           // bid at snapshot time
  ask:                 real("ask"),                           // ask at snapshot time
  quoteAgeMs:          integer("quote_age_ms"),              // ms between quote snapshot and trade
  // From options chain snapshot (greeks, OI, IV)
  oi:                  integer("oi"),                        // open interest (prior close)
  iv:                  real("iv"),                           // implied volatility at print (0–1)
  delta:               real("delta"),                        // option delta (−1 to +1)
  // Derived at ingestion
  premium:             real("premium"),                      // price × size × 100 (total dollar notional)
  deltaAdjPremium:     real("delta_adj_premium"),            // premium × |delta| (directional notional)
  dte:                 integer("dte"),                       // calendar days to expiry
  // Populated in Layer 3 (needs underlying spot price)
  otmPct:              real("otm_pct"),                      // % out-of-the-money (0 if ATM/ITM)
  // "live" = ingested from WebSocket; "backfill" = loaded from Polygon historical REST API
  source:              text("source").default("live"),
});

// Point-in-time NBBO snapshots stored for audit trail and later aggressor re-scoring.
// Populated from Polygon's /v3/snapshot/options/{underlying} on 60s refresh.
export const nbboSnapshots = sqliteTable("nbbo_snapshots", {
  id:           integer("id").primaryKey({ autoIncrement: true }),
  capturedAt:   integer("captured_at").notNull(),             // Unix ms when snapshot was fetched
  underlying:   text("underlying").notNull(),
  optionSymbol: text("option_symbol").notNull(),
  bid:          real("bid"),
  bidSize:      integer("bid_size"),
  ask:          real("ask"),
  askSize:      integer("ask_size"),
  quoteTime:    integer("quote_time"),                        // timestamp from Polygon's quote object
  iv:           real("iv"),
  delta:        real("delta"),
  oi:           integer("oi"),
});

// Daily open interest per option symbol (from snapshot, captured at market open).
export const openInterestDaily = sqliteTable("open_interest_daily", {
  id:           integer("id").primaryKey({ autoIncrement: true }),
  date:         text("date").notNull(),                       // YYYY-MM-DD
  underlying:   text("underlying").notNull(),
  optionSymbol: text("option_symbol").notNull(),
  oi:           integer("oi").notNull(),
});

// Classified prints — one row per trade (or per spread group for multi-leg).
// Populated in Layers 2–4. Empty in Layer 1.
export const classifiedPrints = sqliteTable("classified_prints", {
  id:                  integer("id").primaryKey({ autoIncrement: true }),
  tradeId:             integer("trade_id").notNull(),         // FK → options_trades.id
  // Multi-leg detection (Layer 2)
  isSpreadLeg:         integer("is_spread_leg").notNull().default(0),  // 0|1
  spreadGroupId:       integer("spread_group_id"),            // FK → spread_groups.id
  structureType:       text("structure_type"),               // "single"|"vertical"|"calendar"|"risk_reversal"|"straddle"|"strangle"|"butterfly"|"collar"
  // Intent classification (Layer 3)
  intentDirection:     text("intent_direction"),             // "bullish"|"bearish"|"neutral"|"unclear"
  intentConfidence:    real("intent_confidence"),            // 0–1
  // Closing probability heuristic (Layer 3)
  openingProbability:  real("opening_probability"),          // 0–1 (size > OI → high)
  closingProbability:  real("closing_probability"),          // 0–1 heuristic — see flowClassify.ts
  // Scoring inputs (Layer 4)
  score:               real("score"),                        // 0–100 composite
  sizeVsOiRatio:       real("size_vs_oi_ratio"),
  ivChange:            real("iv_change"),                    // vs prior close IV
  isPreEarnings:       integer("is_pre_earnings").default(0),
  daysToEarnings:      integer("days_to_earnings"),
  campaignId:          integer("campaign_id"),               // FK → campaigns.id (if matched)
});

// Multi-leg spread groups (Layer 2).
export const spreadGroups = sqliteTable("spread_groups", {
  id:            integer("id").primaryKey({ autoIncrement: true }),
  detectedAt:    integer("detected_at").notNull(),
  underlying:    text("underlying").notNull(),
  structureType: text("structure_type").notNull(),
  legTradeIds:   text("leg_trade_ids").notNull(),            // JSON: number[] of options_trades.id
  netPremium:    real("net_premium"),
  netDelta:      real("net_delta"),
});

// Persistent institutional campaigns — accumulated across sessions (Layer 5).
export const campaigns = sqliteTable("campaigns", {
  id:              integer("id").primaryKey({ autoIncrement: true }),
  underlying:      text("underlying").notNull(),
  direction:       text("direction").notNull(),              // "bullish"|"bearish"
  structureFamily: text("structure_family"),
  firstSeen:       integer("first_seen").notNull(),          // Unix ms
  lastSeen:        integer("last_seen").notNull(),           // Unix ms
  totalPremium:    real("total_premium").default(0),
  totalPrints:     integer("total_prints").default(0),
  score:           real("score").default(0),
  isActive:        integer("is_active").default(1),          // 0|1
});

// Fired alerts — the unit of human review and outcome tracking (Layer 6–7).
export const flowAlerts = sqliteTable("flow_alerts", {
  id:            integer("id").primaryKey({ autoIncrement: true }),
  tradeId:       integer("trade_id").notNull(),
  firedAt:       integer("fired_at").notNull(),              // Unix ms
  score:         real("score").notNull(),
  alertPayload:  text("alert_payload").notNull(),            // JSON snapshot of full context
  // Human labeling (Layer 7 review UI)
  userLabel:     text("user_label"),                         // "real_directional"|"hedge"|"spread_leg"|"closing_trade"|"unknown"
  labelNotes:    text("label_notes"),
  labeledAt:     integer("labeled_at"),
  // Outcome tracking (populated T+5d and T+20d by nightly job)
  outcome5d:     real("outcome_pnl_5d"),                    // % move in underlying 5 trading days after alert
  outcome20d:    real("outcome_pnl_20d"),
});
