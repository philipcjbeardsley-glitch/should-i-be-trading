# ADR 001 — SQLite for Flow Scanner MVP

**Status:** Accepted  
**Date:** 2026-04-23  
**Deciders:** Philip Beardsley

---

## Context

The Options Flow Scanner (Layer 1–8) requires time-series storage for:
- Raw OPRA options trades (filtered, not all ~2M OPRA prints/day — estimated 2k–10k rows/day post-filter)
- NBBO snapshots (fetched via REST on Developer tier — not full tick stream)
- Classified prints with scores and intent labels
- Campaign state (one row per ticker/direction per active campaign)
- Alerts with user labels and outcome tracking

The existing application uses **SQLite + Drizzle ORM** (`better-sqlite3`) for user authentication. No Postgres, no Redis, no message queue exists in the stack.

## Decision

Use SQLite for the Flow Scanner's persistent storage in the MVP.

All new tables (`options_trades`, `nbbo_snapshots`, `open_interest_daily`, `classified_prints`, `spread_groups`, `campaigns`, `flow_alerts`) are defined in `shared/schema.ts` using Drizzle's `sqliteTable`. The same `db` connection instance from `server/storage.ts` is shared.

### Portability constraints (must be honored in all schema/query code)

To keep the Postgres migration mechanical rather than a rewrite:

- **Column types only:** `integer`, `text`, `real`. No `blob`, no `numeric`, no SQLite-specific affinity tricks.
- **Timestamps as `integer` (Unix ms).** Maps to Postgres `bigint`. Convert to ISO strings only at the API boundary.
- **JSON arrays as `text`.** `JSON.stringify()` on write, `JSON.parse()` on read. In Postgres, swap to `jsonb` column type — query patterns don't change because we don't use Postgres-specific JSON operators in the ORM layer.
- **Drizzle query builder only** (`.select().from().where().orderBy()`). No raw SQL strings that use SQLite-specific syntax. If a query can't be expressed in Drizzle's builder, write it in a way that works for both dialects.
- **No `RETURNING` with complex expressions.** The `.returning().get()` pattern is Drizzle-portable (Postgres supports `RETURNING` natively).
- **Migrations via `drizzle-kit push`** during development. For Postgres production, switch to versioned `drizzle-kit generate` + `migrate`.

### What actually needs to change to migrate to Postgres

1. `package.json`: replace `better-sqlite3` + `@types/better-sqlite3` with `postgres` (or `pg`)
2. `server/storage.ts`: swap `drizzle(sqlite)` for `drizzle(postgresClient)`
3. `shared/schema.ts`: replace `import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core"` with `import { pgTable, bigint, text, doublePrecision } from "drizzle-orm/pg-core"` and rename column types
4. `drizzle.config.ts`: change `dialect: "sqlite"` to `dialect: "postgresql"` and update `dbCredentials`
5. Railway: add the Postgres addon and set `DATABASE_URL`
6. TimescaleDB: run `CREATE EXTENSION IF NOT EXISTS timescaledb;` then convert `options_trades` to a hypertable: `SELECT create_hypertable('options_trades', 'timestamp');`

No application logic changes required if the portability constraints above are honored.

## Migration Trigger Conditions

Migrate to Postgres + TimescaleDB when **any one** of the following is true:

| Condition | Threshold | How to measure |
|---|---|---|
| Daily trade insert volume | > 50,000 rows/day | `SELECT COUNT(*) FROM options_trades WHERE timestamp > {start_of_day_ms}` |
| Query latency (recent trades) | P95 > 200ms | Log query duration in `flowStorage.ts` |
| Concurrent write pressure | WAL checkpoint stalls > 5/hour | SQLite WAL metrics in `server/storage.ts` |
| Expanding to > 20 watched underlyings | — | Configuration threshold |
| Need for time-bucket aggregations | — | TimescaleDB-specific feature |

## Consequences

**Positive:**
- Zero infra overhead for MVP. No Postgres addon on Railway, no connection pooling.
- `better-sqlite3` is synchronous — no `await` overhead on individual inserts during the hot path.
- `drizzle-kit push` schema syncs are instant during development.

**Negative:**
- SQLite WAL mode handles concurrent reads well but serializes all writes. Under high-frequency ingestion (> 1k inserts/sec), write contention could become an issue.
- No window functions or advanced time-series queries until migration. Workarounds with application-layer aggregation are acceptable at current scale.
- Backups require file-level copy (`VACUUM INTO`) rather than pg_dump. Acceptable for single-user app.
