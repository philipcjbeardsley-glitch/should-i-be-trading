# ADR 002 — Polygon Options Developer Tier

**Status:** Accepted  
**Date:** 2026-04-23  
**Deciders:** Philip Beardsley  
**Cost:** $79/mo (Polygon Starter) + Options add-on = ~$79/mo total (Options Developer plan)

---

## Context

The Flow Scanner needs real-time options market data. The existing Polygon integration
only uses the free-tier daily OHLCV REST endpoint. The Options Developer plan was 
upgraded specifically to support this scanner.

## What the Options Developer Plan Provides

| Data | Available | Notes |
|---|---|---|
| Real-time options trades websocket (`T.O:*`) | ✓ | Via `wss://socket.polygon.io/options` |
| Options chain snapshot (greeks, IV, OI) | ✓ | `GET /v3/snapshot/options/{underlying}` |
| Historical options trades (4 years) | ✓ | `GET /v3/trades/{optionsTicker}` |
| Options aggregates (OHLCV) | ✓ | `GET /v2/aggs/ticker/O:*/range/...` |
| Last NBBO (REST, not streaming) | ✓ | From snapshot `last_quote` field |
| Same API key as existing OHLCV integration | ✓ | `POLYGON_API_KEY` env var |

## What the Options Developer Plan Does NOT Provide

| Data | Tier Required | Impact on Scanner |
|---|---|---|
| Real-time NBBO stream (`Q.O:*`) | Advanced ($199/mo) | Aggressor tagging uses snapshot quotes (60s cadence). `aggressor_confidence` is flagged "low" when quote age relative to trade timestamp exceeds 60s. See `server/flowWs.ts` `tagAggressor()`. |
| OPRA condition codes (sweep / block / ISO / floor) | CBOE LiveVol DataShop or Databento | Cannot distinguish sweeps from blocks or floor prints (SPHR). Condition codes from Polygon are exchange-internal, not full OPRA. All prints are classified as "unclassified" for condition type. Plan v2 migration. |
| Level II options depth (full order book) | Not available via Polygon at any tier | Cannot infer iceberg orders or size accumulation in book. |

## Design Decisions Driven by Tier Limitations

### Aggressor Tagging Without Real-Time NBBO

Without `Q.O:*` streaming, we use a **snapshot polling approach**:
1. `GET /v3/snapshot/options/{underlying}` every 60 seconds
2. Cache bid/ask/midpoint keyed by option symbol in memory (`snapshotCache` in `flowWs.ts`)
3. On each trade: look up cached quote, compute aggressor side, compute `quoteAgeMs`
4. If `quoteAgeMs > 60_000`: set `aggressorConfidence = 'low'`, `aggressorSide = 'unknown'`

This means aggressor confidence is structurally limited at this tier. The scoring function
accounts for this: trades with `aggressorConfidence = 'low'` receive a 40% penalty on the
aggressor clarity component (15% of total score × 0.4 = effectively 9% weight reduction).

### Quote Age Interpretation

The snapshot `last_quote.last_updated` timestamp tells us when Polygon last received an
NBBO update for that contract. For liquid options (tight spread, active trading), this is
typically < 5 seconds stale even with 60s snapshot refresh. For illiquid deep-OTM or
long-dated options, quotes can be hours stale — those prints are inherently unclassifiable
at this tier and will surface with `aggressorConfidence = 'low'`.

### No Sweep/Block Classification

OPRA condition codes that distinguish sweep-of-the-floor (high conviction) from a block
trade (negotiated, often a hedge) are not available. This is the single largest signal
quality gap vs. Cheddar Flow / Unusual Whales (who pay for full OPRA via CBOE direct feed).
All prints that clear other filters will be marked `condition_type = 'unclassified'`.

## Upgrade Trigger Conditions

Upgrade to **Polygon Options Advanced ($199/mo)** when:

| Condition | Threshold |
|---|---|
| Aggressor confidence rate | < 40% of scored prints have confidence 'high' or 'medium' |
| High-score prints with low confidence | > 30% of alerts (score > 60) have `aggressorConfidence = 'low'` |
| False positive rate from labeling | > 50% of user-labeled alerts are 'hedge' or 'spread_leg' when aggressor confidence is 'low' |

Upgrade to **CBOE LiveVol DataShop or Databento** when:
- Sweep vs. block classification becomes a product requirement
- Condition-code-based filtering would materially reduce false positives
- Estimated improvement in precision justifies $500–$2k/mo cost

## Consequences

**Positive:**
- Unblocks the scanner with real-time trade flow at reasonable cost
- Snapshot-based quotes are sufficient for large-size prints (the ones we care about) because liquid options have tight, stable spreads between quote updates
- Same API key as existing app — zero new credential management

**Negative:**
- Aggressor confidence is structurally capped for illiquid contracts
- No sweep detection — must rely on size and delta-premium normalization as proxies
- Snapshot data is 60s stale at worst — trades in fast-moving markets (earnings, macro events) will have worse aggressor tagging precisely when conviction is highest

**Mitigation:** The scoring function is explicitly designed to not rely solely on aggressor side. A large opening trade in the right context scores high even with `aggressorConfidence = 'low'`. The labeling UI surfaces confidence explicitly so the human reviewer knows which signals are clean vs. estimated.
