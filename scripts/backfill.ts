#!/usr/bin/env node
/**
 * scripts/backfill.ts — Historical options trade backfiller
 *
 * Loads options trade history from Polygon's REST API and writes to the same
 * options_trades table used by the live WebSocket path. Designed for dev loop
 * iteration on Layers 2–4 (multi-leg, classification, scoring) without waiting
 * for live market hours.
 *
 * Usage:
 *   npm run backfill -- --ticker INTC --date 2026-04-23
 *   npm run backfill -- --ticker INTC,AMZN --from 2026-04-20 --to 2026-04-23
 *   npm run backfill -- --ticker INTC --date 2026-04-23 --dry-run
 *
 * Idempotent: (option_symbol, timestamp, price, size) uniqueness via INSERT OR IGNORE.
 * Re-running the same date is a no-op.
 *
 * Polygon endpoints used (Options Developer tier):
 *   GET /v3/reference/options/contracts  — enumerate contracts for an underlying on a date
 *   GET /v3/trades/{optionsTicker}       — historical trades for a contract
 *   GET /v3/quotes/{optionsTicker}       — historical NBBO for aggressor tagging
 *
 * Aggressor tagging strategy:
 *   1. Fetch all NBBO quotes for the contract for the trading day (one batch call)
 *   2. Binary-search for the last quote at or before each trade's sip_timestamp
 *   3. If within 1 second: tag with high/medium confidence
 *   4. If gap > 1s or no quote found: aggressorSide=unknown, confidence=low
 *   This is strictly better than the live path (60s snapshot gap) for historical data.
 */

import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

// ── Paths ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", "data.db");

// ── Constants ─────────────────────────────────────────────────────────────────

const POLYGON_KEY = process.env.POLYGON_API_KEY ?? "";
const BASE = "https://api.polygon.io";
// Concurrent contract processing — keeps API pressure reasonable
const BATCH_SIZE = 8;
// Brief yield between batches to stay friendly to the API
const INTER_BATCH_DELAY_MS = 80;
// 1 second in nanoseconds — max quote age for confident aggressor tagging
const MAX_QUOTE_AGE_NS = 1_000_000_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedOCC {
  underlying: string;
  expiry: string;
  right: "C" | "P";
  strike: number;
}

interface HistoricalQuote {
  sipNs: number;       // sip_timestamp as float (≈ ns, precision loss is <1μs)
  bid: number;
  ask: number;
}

interface HistoricalTrade {
  sipNs: number;       // sip_timestamp in nanoseconds (float)
  price: number;
  size: number;
  exchange: number;
  conditions: number[];
  sequenceNumber: number;
}

interface ContractStats {
  occTicker: string;
  tradesFound: number;
  tradesInserted: number;
  tradesSkipped: number;   // duplicate (INSERT OR IGNORE hit unique constraint)
  aggressorAsk: number;
  aggressorBid: number;
  aggressorMid: number;
  aggressorUnknown: number;
  quoteAgeMsSum: number;
  quoteAgeCount: number;
}

// ── Inline helpers (avoid importing flowWs.ts which has module-level WS side effects) ──

function parseOCC(symbol: string): ParsedOCC | null {
  const raw = symbol.startsWith("O:") ? symbol.slice(2) : symbol;
  const m = raw.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, dateStr, right, strikeStr] = m;
  const yr = parseInt(dateStr.slice(0, 2), 10) + 2000;
  const expiry = `${yr}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  return { underlying, expiry, right: right as "C" | "P", strike };
}

function calcDte(expiry: string): number {
  const expiryMs = new Date(`${expiry}T20:00:00Z`).getTime();
  return Math.max(0, Math.ceil((expiryMs - Date.now()) / 86_400_000));
}

function tagAggressor(
  price: number,
  bid: number,
  ask: number,
  quoteAgeMs: number,
): { side: string; confidence: string } {
  if (quoteAgeMs > 60_000 || bid <= 0 || ask <= 0) {
    return { side: "unknown", confidence: "low" };
  }
  const spread = ask - bid;
  if (spread <= 0) return { side: "unknown", confidence: "low" };
  const buf = spread * 0.2;
  if (price >= ask - buf) {
    return { side: "ask", confidence: price >= ask ? "high" : "medium" };
  }
  if (price <= bid + buf) {
    return { side: "bid", confidence: price <= bid ? "high" : "medium" };
  }
  return { side: "mid", confidence: "low" };
}

// ── CLI Arg Parser ────────────────────────────────────────────────────────────

interface CliOpts {
  tickers: string[];
  dates: string[];
  dryRun: boolean;
}

function parseCli(): CliOpts {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const tickerArg = get("--ticker");
  if (!tickerArg) {
    console.error("Error: --ticker is required. Example: --ticker INTC or --ticker INTC,AMZN");
    process.exit(1);
  }
  const tickers = tickerArg.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  const dateArg  = get("--date");
  const fromArg  = get("--from");
  const toArg    = get("--to");

  let dates: string[] = [];
  if (dateArg) {
    dates = [dateArg];
  } else if (fromArg && toArg) {
    dates = dateRange(fromArg, toArg);
  } else {
    console.error("Error: provide --date YYYY-MM-DD or --from YYYY-MM-DD --to YYYY-MM-DD");
    process.exit(1);
  }

  return { tickers, dates, dryRun: has("--dry-run") };
}

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── DB Setup and Migrations ───────────────────────────────────────────────────

function setupDb(): BetterSqlite3.Database {
  const sqlite = new BetterSqlite3(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  runMigrations(sqlite);
  return sqlite;
}

function runMigrations(sqlite: BetterSqlite3.Database): void {
  // Add source column if the live server hasn't pushed the schema yet.
  // SQLite doesn't support IF NOT EXISTS for ADD COLUMN — use try/catch.
  try {
    sqlite.exec(`ALTER TABLE options_trades ADD COLUMN source TEXT DEFAULT 'live'`);
    console.log("[migrate] Added options_trades.source column (default: 'live')");
  } catch {
    // Column already exists — expected on subsequent runs
  }

  // Unique index for idempotency: same contract + ms-timestamp + price + size
  // INSERT OR IGNORE will silently skip duplicates. Two trades on the same
  // contract at the same millisecond with the same price and size are
  // effectively impossible for real OPRA data.
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_dedup
    ON options_trades (option_symbol, timestamp, price, size)
  `);
}

// ── Polygon API Helpers ───────────────────────────────────────────────────────

/**
 * Follow next_url pagination and collect all results from a Polygon v3 endpoint.
 * Appends &apiKey=... to each URL (Polygon strips it from next_url).
 */
async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = initialUrl;
  let page = 0;

  while (url) {
    page++;
    const resp = await axios.get<{ results?: T[]; next_url?: string; status?: string }>(
      url,
      { timeout: 15_000 },
    );

    if (resp.data.status && resp.data.status !== "OK") {
      const body = JSON.stringify(resp.data);
      throw new Error(`Polygon returned status="${resp.data.status}": ${body}`);
    }

    const batch = resp.data.results ?? [];
    results.push(...batch);

    const nextUrl = resp.data.next_url;
    url = nextUrl ? `${nextUrl}&apiKey=${POLYGON_KEY}` : null;
  }

  return results;
}

/**
 * Enumerate all option contracts for an underlying that were active on a given date.
 * Returns an array of full OCC ticker strings (with "O:" prefix).
 */
async function getContracts(underlying: string, date: string): Promise<string[]> {
  const url =
    `${BASE}/v3/reference/options/contracts` +
    `?underlying_ticker=${underlying}` +
    `&as_of=${date}` +
    `&expired=false` +
    `&limit=1000` +
    `&apiKey=${POLYGON_KEY}`;

  interface ContractRef { ticker: string }
  const contracts = await fetchAllPages<ContractRef>(url);
  return contracts.map(c => c.ticker).filter(Boolean);
}

/**
 * Fetch all historical NBBO quotes for an options contract on a given date.
 * Returns quotes sorted ascending by sip_timestamp.
 * sip_timestamp values are stored as floats (nanoseconds; precision loss < 1μs).
 */
async function getQuotesForDay(occTicker: string, date: string): Promise<HistoricalQuote[]> {
  const url =
    `${BASE}/v3/quotes/${encodeURIComponent(occTicker)}` +
    `?timestamp.gte=${date}` +
    `&timestamp.lt=${nextDate(date)}` +
    `&limit=50000` +
    `&order=asc` +
    `&apiKey=${POLYGON_KEY}`;

  interface RawQuote {
    sip_timestamp: number;
    bid_price?: number;
    ask_price?: number;
  }

  const raw = await fetchAllPages<RawQuote>(url);
  return raw
    .filter(q => q.sip_timestamp > 0)
    .map(q => ({
      sipNs: q.sip_timestamp,
      bid: q.bid_price ?? 0,
      ask: q.ask_price ?? 0,
    }));
}

/**
 * Fetch all historical trades for an options contract on a given date.
 * Returns trades sorted ascending by sip_timestamp.
 */
async function getTradesForDay(occTicker: string, date: string): Promise<HistoricalTrade[]> {
  const url =
    `${BASE}/v3/trades/${encodeURIComponent(occTicker)}` +
    `?timestamp.gte=${date}` +
    `&timestamp.lt=${nextDate(date)}` +
    `&limit=50000` +
    `&order=asc` +
    `&apiKey=${POLYGON_KEY}`;

  interface RawTrade {
    sip_timestamp: number;
    price: number;
    size: number;
    exchange?: number;
    conditions?: number[];
    sequence_number?: number;
  }

  const raw = await fetchAllPages<RawTrade>(url);
  return raw
    .filter(t => t.sip_timestamp > 0 && t.price > 0 && t.size > 0)
    .map(t => ({
      sipNs: t.sip_timestamp,
      price: t.price,
      size: t.size,
      exchange: t.exchange ?? 0,
      conditions: t.conditions ?? [],
      sequenceNumber: t.sequence_number ?? 0,
    }));
}

// ── Quote Matching ────────────────────────────────────────────────────────────

/**
 * Binary search: find the last quote with sipNs <= tradeSipNs.
 * Returns null if no quote found or the gap exceeds MAX_QUOTE_AGE_NS (1 second).
 * Quotes array must be sorted ascending by sipNs.
 */
function findQuoteAtTime(quotes: HistoricalQuote[], tradeSipNs: number): HistoricalQuote | null {
  if (quotes.length === 0) return null;

  let lo = 0, hi = quotes.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (quotes[mid].sipNs <= tradeSipNs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === -1) return null;
  const quote = quotes[best];
  const gapNs = tradeSipNs - quote.sipNs;
  return gapNs <= MAX_QUOTE_AGE_NS ? quote : null;
}

// ── Per-Contract Backfill ─────────────────────────────────────────────────────

async function backfillContract(
  insertStmt: BetterSqlite3.Statement,
  occTicker: string,
  date: string,
  dryRun: boolean,
): Promise<ContractStats> {
  const stats: ContractStats = {
    occTicker, tradesFound: 0, tradesInserted: 0, tradesSkipped: 0,
    aggressorAsk: 0, aggressorBid: 0, aggressorMid: 0, aggressorUnknown: 0,
    quoteAgeMsSum: 0, quoteAgeCount: 0,
  };

  // Fetch trades first — skip quote call if contract had no activity today
  const trades = await getTradesForDay(occTicker, date);
  stats.tradesFound = trades.length;
  if (trades.length === 0) return stats;

  // Only pay for a quote fetch on contracts with actual trades
  const quotes = await getQuotesForDay(occTicker, date);

  const parsed = parseOCC(occTicker);
  if (!parsed) return stats;

  const dte = calcDte(parsed.expiry);

  for (const trade of trades) {
    const tsMs = Math.round(trade.sipNs / 1_000_000);
    const quote = findQuoteAtTime(quotes, trade.sipNs);

    let bid = 0, ask = 0, quoteAgeMs = -1;
    if (quote) {
      bid = quote.bid;
      ask = quote.ask;
      quoteAgeMs = Math.round((trade.sipNs - quote.sipNs) / 1_000_000);
    }

    const { side: aggressorSide, confidence: aggressorConfidence } =
      tagAggressor(trade.price, bid, ask, quote ? quoteAgeMs : Number.POSITIVE_INFINITY);

    const premium = trade.price * trade.size * 100;
    // Use 0.5 delta proxy when unknown (same as live path)
    const delta = 0; // Layer 3 will populate from snapshot greeks
    const effectiveDelta = 0.5;
    const deltaAdjPremium = premium * effectiveDelta;

    // Track aggressor distribution
    if (aggressorSide === "ask") stats.aggressorAsk++;
    else if (aggressorSide === "bid") stats.aggressorBid++;
    else if (aggressorSide === "mid") stats.aggressorMid++;
    else stats.aggressorUnknown++;

    if (quoteAgeMs >= 0) {
      stats.quoteAgeMsSum += quoteAgeMs;
      stats.quoteAgeCount++;
    }

    if (dryRun) {
      stats.tradesInserted++;
      continue;
    }

    try {
      const result = insertStmt.run(
        tsMs,                              // timestamp
        parsed.underlying,                 // underlying
        occTicker,                         // option_symbol
        parsed.expiry,                     // expiry
        parsed.strike,                     // strike
        parsed.right,                      // right
        trade.price,                       // price
        trade.size,                        // size
        String(trade.exchange),            // exchange
        JSON.stringify(trade.conditions),  // conditions (JSON)
        trade.sequenceNumber,              // sequence_number
        aggressorSide,                     // aggressor_side
        aggressorConfidence,               // aggressor_confidence
        bid,                               // bid
        ask,                               // ask
        quoteAgeMs,                        // quote_age_ms
        0,                                 // oi (not available from trades endpoint)
        0,                                 // iv (not available from trades endpoint)
        delta,                             // delta
        premium,                           // premium
        deltaAdjPremium,                   // delta_adj_premium
        dte,                               // dte
        0,                                 // otm_pct (Layer 3)
        "backfill",                        // source
      );
      if (result.changes > 0) {
        stats.tradesInserted++;
      } else {
        stats.tradesSkipped++;
      }
    } catch (err: any) {
      // If the unique index fires on a constraint violation (shouldn't happen
      // since we use INSERT OR IGNORE), surface it explicitly
      if (!err.message?.includes("UNIQUE constraint failed")) {
        console.error(`  [ERROR] Insert failed for ${occTicker}: ${err.message}`);
      }
      stats.tradesSkipped++;
    }
  }

  return stats;
}

// ── Progress Printer ──────────────────────────────────────────────────────────

function printProgress(done: number, total: number, totalTrades: number): void {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
  process.stdout.write(`\r  [${bar}] ${pct}% — ${done}/${total} contracts — ${totalTrades.toLocaleString()} trades`);
}

// ── Batch Processor ───────────────────────────────────────────────────────────

/**
 * Process an array in batches of batchSize, with an optional delay between batches.
 * Returns all results in the original order.
 */
async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (done: number, results: R[]) => void,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    onProgress?.(results.length, results);
    if (delayMs > 0 && i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseCli();

  if (!POLYGON_KEY) {
    console.error("Error: POLYGON_API_KEY environment variable is not set.");
    process.exit(1);
  }

  console.log(`\nOptions Flow Backfiller`);
  console.log(`  Tickers : ${opts.tickers.join(", ")}`);
  console.log(`  Dates   : ${opts.dates[0]}${opts.dates.length > 1 ? ` → ${opts.dates[opts.dates.length - 1]} (${opts.dates.length} days)` : ""}`);
  console.log(`  Dry run : ${opts.dryRun ? "YES — no DB writes" : "no"}`);
  console.log(`  DB path : ${DB_PATH}\n`);

  const sqlite = setupDb();

  // Prepare INSERT OR IGNORE statement once — reuse for all trades
  const insertStmt = sqlite.prepare(`
    INSERT OR IGNORE INTO options_trades
      (timestamp, underlying, option_symbol, expiry, strike, right,
       price, size, exchange, conditions, sequence_number,
       aggressor_side, aggressor_confidence, bid, ask, quote_age_ms,
       oi, iv, delta, premium, delta_adj_premium, dte, otm_pct, source)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const globalStart = Date.now();

  // Aggregate stats across all ticker × date pairs
  let grandTotalInserted = 0;
  let grandTotalSkipped  = 0;
  let grandTotalTrades   = 0;
  let grandAsk = 0, grandBid = 0, grandMid = 0, grandUnknown = 0;
  let grandQuoteAgeMsSum = 0, grandQuoteAgeCount = 0;

  for (const ticker of opts.tickers) {
    for (const date of opts.dates) {
      const sessionStart = Date.now();
      console.log(`\n── ${ticker} / ${date} ──────────────────────────────────────────`);

      // Step 1: enumerate contracts
      process.stdout.write(`  Enumerating contracts...`);
      let contracts: string[];
      try {
        contracts = await getContracts(ticker, date);
      } catch (err: any) {
        console.error(`\n  [ERROR] Failed to enumerate contracts: ${err.message}`);
        continue;
      }
      process.stdout.write(` ${contracts.length} found\n`);

      if (contracts.length === 0) {
        console.log(`  No contracts returned for ${ticker} on ${date}. Skipping.`);
        continue;
      }

      // Step 2: process all contracts
      console.log(`  Processing in batches of ${BATCH_SIZE}...\n`);
      let contractsDone = 0;
      let runningTrades = 0;

      const allStats = await processBatches(
        contracts,
        BATCH_SIZE,
        INTER_BATCH_DELAY_MS,
        (occ) => backfillContract(insertStmt, occ, date, opts.dryRun),
        (done, results) => {
          contractsDone = done;
          runningTrades = results.reduce((s, r) => s + r.tradesInserted, 0);
          printProgress(done, contracts.length, runningTrades);
        },
      );

      process.stdout.write("\n"); // newline after progress bar

      // Step 3: aggregate stats for this session
      const sessionStats = allStats.reduce(
        (acc, s) => {
          acc.tradesFound    += s.tradesFound;
          acc.tradesInserted += s.tradesInserted;
          acc.tradesSkipped  += s.tradesSkipped;
          acc.ask            += s.aggressorAsk;
          acc.bid            += s.aggressorBid;
          acc.mid            += s.aggressorMid;
          acc.unknown        += s.aggressorUnknown;
          acc.quoteAgeMsSum  += s.quoteAgeMsSum;
          acc.quoteAgeCount  += s.quoteAgeCount;
          return acc;
        },
        { tradesFound: 0, tradesInserted: 0, tradesSkipped: 0, ask: 0, bid: 0, mid: 0, unknown: 0, quoteAgeMsSum: 0, quoteAgeCount: 0 },
      );

      const elapsedSec = ((Date.now() - sessionStart) / 1_000).toFixed(1);
      const total = sessionStats.tradesInserted;
      const avgQuoteAgeMs = sessionStats.quoteAgeCount > 0
        ? Math.round(sessionStats.quoteAgeMsSum / sessionStats.quoteAgeCount)
        : null;

      // Step 4: print session summary
      console.log(`\n  ── Summary: ${ticker} / ${date} ──`);
      console.log(`  Contracts processed : ${contracts.length} (${allStats.filter(s => s.tradesFound > 0).length} with trades)`);
      console.log(`  Trades found        : ${sessionStats.tradesFound.toLocaleString()}`);
      console.log(`  Trades written      : ${sessionStats.tradesInserted.toLocaleString()}${opts.dryRun ? " (dry run)" : ""}`);
      console.log(`  Trades skipped      : ${sessionStats.tradesSkipped.toLocaleString()} (duplicate)`);
      if (total > 0) {
        const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
        console.log(`  Aggressor split     : ask=${pct(sessionStats.ask)} bid=${pct(sessionStats.bid)} mid=${pct(sessionStats.mid)} unknown=${pct(sessionStats.unknown)}`);
      }
      if (avgQuoteAgeMs !== null) {
        console.log(`  Avg quote age       : ${avgQuoteAgeMs}ms`);
      }
      console.log(`  Elapsed             : ${elapsedSec}s`);

      grandTotalInserted += sessionStats.tradesInserted;
      grandTotalSkipped  += sessionStats.tradesSkipped;
      grandTotalTrades   += sessionStats.tradesFound;
      grandAsk     += sessionStats.ask;
      grandBid     += sessionStats.bid;
      grandMid     += sessionStats.mid;
      grandUnknown += sessionStats.unknown;
      grandQuoteAgeMsSum  += sessionStats.quoteAgeMsSum;
      grandQuoteAgeCount  += sessionStats.quoteAgeCount;
    }
  }

  // Grand total summary (only shown for multi-ticker/multi-day runs)
  const totalPairs = opts.tickers.length * opts.dates.length;
  if (totalPairs > 1) {
    const totalElapsed = ((Date.now() - globalStart) / 1_000).toFixed(1);
    const grandAvgAge = grandQuoteAgeCount > 0
      ? Math.round(grandQuoteAgeMsSum / grandQuoteAgeCount)
      : null;
    console.log(`\n═══ Grand Total ═══════════════════════════════════════════════════`);
    console.log(`  Total trades written : ${grandTotalInserted.toLocaleString()}`);
    console.log(`  Total skipped        : ${grandTotalSkipped.toLocaleString()}`);
    const grandTotal = grandTotalInserted;
    if (grandTotal > 0) {
      const pct = (n: number) => `${Math.round((n / grandTotal) * 100)}%`;
      console.log(`  Aggressor split      : ask=${pct(grandAsk)} bid=${pct(grandBid)} mid=${pct(grandMid)} unknown=${pct(grandUnknown)}`);
    }
    if (grandAvgAge !== null) console.log(`  Avg quote age        : ${grandAvgAge}ms`);
    console.log(`  Total elapsed        : ${totalElapsed}s`);
  }

  if (!opts.dryRun && grandTotalInserted > 0) {
    console.log(`\n✓ Done. Refresh the Flow tab — live feed and top prints should now reflect backfilled data.\n`);
  } else if (opts.dryRun) {
    console.log(`\n✓ Dry run complete — no data was written.\n`);
  } else {
    console.log(`\n✓ Done — no new trades found.\n`);
  }

  sqlite.close();
  process.exit(0);
}

main().catch(err => {
  console.error("\nFatal error:", err?.message ?? err);
  process.exit(1);
});
