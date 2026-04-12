import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ForwardStat {
  winRate: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
  n: number;
}
interface ExpectancyResult {
  ticker: string;
  label: string;
  events: Array<{
    date: string;
    price: number;
    triggerPct: number | null;
    returns: Record<string, number | null>;
  }>;
  summary: Record<string, ForwardStat | null>;
  dateRange: string;
  plainText?: string;
  error?: string;
}

const WINDOWS = ["1D", "1W", "1M", "3M", "1Y"];

// ── Color helpers ─────────────────────────────────────────────────────────────
function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}
function pctColor(v: number | null | undefined): string {
  if (v == null) return "var(--bb-text-dim)";
  if (v > 0) return "#00d4a0";
  if (v < 0) return "#ff4d4d";
  return "var(--bb-text-dim)";
}
function winRateColor(v: number): string {
  if (v >= 65) return "#00d4a0";
  if (v >= 50) return "#ffa500";
  return "#ff4d4d";
}

// ── Condition Builder types ───────────────────────────────────────────────────
type CondType =
  | "price_change_pct"
  | "price_above_ma"
  | "price_extended_pct"
  | "rsi"
  | "bb_width"
  | "bb_position"
  | "volume_surge"
  | "gap_up"
  | "near_52w_high"
  | "near_52w_low";

type Logic = "AND" | "OR";

interface CondRow {
  id: number;
  type: CondType;
  direction: string;
  value: string;
  lookback: string;
  useEMA: boolean;
}

const COND_META: Record<CondType, { label: string; hasDirection: boolean; hasValue: boolean; valueSuffix: string; hasLookback: boolean; lookbackLabel: string; hasMAType: boolean }> = {
  price_change_pct:   { label: "Price Change %",        hasDirection: true, hasValue: true,  valueSuffix: "%",      hasLookback: true,  lookbackLabel: "days",   hasMAType: false },
  price_above_ma:     { label: "Price vs SMA",           hasDirection: true, hasValue: false, valueSuffix: "",       hasLookback: true,  lookbackLabel: "-period",hasMAType: false },
  price_extended_pct: { label: "% Extended vs EMA/SMA", hasDirection: true, hasValue: true,  valueSuffix: "%",      hasLookback: true,  lookbackLabel: "-period",hasMAType: true  },
  rsi:                { label: "RSI",                    hasDirection: true, hasValue: true,  valueSuffix: "",       hasLookback: false, lookbackLabel: "",       hasMAType: false },
  bb_width:           { label: "Bollinger Band Width",   hasDirection: true, hasValue: true,  valueSuffix: "(ratio)",hasLookback: false, lookbackLabel: "",       hasMAType: false },
  bb_position:        { label: "Price vs BB Band",       hasDirection: true, hasValue: false, valueSuffix: "",       hasLookback: false, lookbackLabel: "",       hasMAType: false },
  volume_surge:       { label: "Volume Surge",           hasDirection: false,hasValue: true,  valueSuffix: "× avg",  hasLookback: false, lookbackLabel: "",       hasMAType: false },
  gap_up:             { label: "Gap Up",                 hasDirection: false,hasValue: true,  valueSuffix: "%",      hasLookback: false, lookbackLabel: "",       hasMAType: false },
  near_52w_high:      { label: "Near 52W High",          hasDirection: false,hasValue: false, valueSuffix: "",       hasLookback: false, lookbackLabel: "",       hasMAType: false },
  near_52w_low:       { label: "Near 52W Low",           hasDirection: false,hasValue: false, valueSuffix: "",       hasLookback: false, lookbackLabel: "",       hasMAType: false },
};

function defaultRow(id: number): CondRow {
  return { id, type: "price_change_pct", direction: "up", value: "5", lookback: "5", useEMA: true };
}

function condToPayload(c: CondRow) {
  return {
    type: c.type,
    direction: c.direction || undefined,
    value: parseFloat(c.value) || 0,
    lookback: c.lookback ? parseInt(c.lookback) : undefined,
    useEMA: c.useEMA,
  };
}

// ── Shared input styles ───────────────────────────────────────────────────────
const IS: React.CSSProperties = {
  fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
  background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
  color: "var(--bb-text)", borderRadius: 2, padding: "4px 7px",
};
const SS: React.CSSProperties = { ...IS, cursor: "pointer" };

// ── Condition row component ───────────────────────────────────────────────────
function ConditionRow({ row, onChange, onRemove, isLast, logic, onLogicChange }: {
  row: CondRow;
  onChange: (r: CondRow) => void;
  onRemove: () => void;
  isLast: boolean;
  logic: Logic;
  onLogicChange: (l: Logic) => void;
}) {
  const meta = COND_META[row.type];

  function set(field: keyof CondRow, val: string | boolean) {
    onChange({ ...row, [field]: val });
  }

  // Reset direction default when type changes
  function setType(t: CondType) {
    const defaults: Partial<CondRow> = { type: t };
    if (t === "price_change_pct") defaults.direction = "up";
    else if (t === "bb_width") { defaults.direction = "above"; defaults.value = "0.1"; }
    else if (t === "rsi") { defaults.direction = "above"; defaults.value = "70"; }
    else if (t === "volume_surge") { defaults.value = "2"; }
    else if (t === "gap_up") { defaults.value = "3"; }
    else defaults.direction = "above";
    onChange({ ...row, ...defaults });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>

        {/* Type selector */}
        <select value={row.type} onChange={e => setType(e.target.value as CondType)} style={{ ...SS, minWidth: 175 }}>
          {(Object.entries(COND_META) as [CondType, typeof COND_META[CondType]][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Direction */}
        {meta.hasDirection && (
          <select value={row.direction} onChange={e => set("direction", e.target.value)} style={{ ...SS, minWidth: 80 }}>
            {row.type === "price_change_pct" ? (
              <><option value="up">↑ Up</option><option value="down">↓ Down</option></>
            ) : row.type === "bb_position" ? (
              <><option value="above">Above Upper</option><option value="below">Below Lower</option></>
            ) : (
              <><option value="above">Above</option><option value="below">Below</option></>
            )}
          </select>
        )}

        {/* Value */}
        {meta.hasValue && (
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <input
              type="number" value={row.value} step="0.01"
              onChange={e => set("value", e.target.value)}
              style={{ ...IS, width: 64 }}
              placeholder={row.type === "bb_width" ? "0.1" : row.type === "volume_surge" ? "2" : "5"}
            />
            <span style={{ fontSize: 9, color: "var(--bb-text-faint)", fontFamily: "IBM Plex Mono" }}>
              {meta.valueSuffix}
            </span>
          </div>
        )}

        {/* Lookback */}
        {meta.hasLookback && (
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {row.type === "price_change_pct" && (
              <span style={{ fontSize: 9, color: "var(--bb-text-faint)", fontFamily: "IBM Plex Mono" }}>in</span>
            )}
            <input
              type="number" value={row.lookback}
              onChange={e => set("lookback", e.target.value)}
              style={{ ...IS, width: 48 }}
              placeholder={row.type === "price_change_pct" ? "5" : "20"}
            />
            <span style={{ fontSize: 9, color: "var(--bb-text-faint)", fontFamily: "IBM Plex Mono" }}>
              {meta.lookbackLabel}
            </span>
          </div>
        )}

        {/* EMA/SMA toggle */}
        {meta.hasMAType && (
          <select
            value={row.useEMA ? "ema" : "sma"}
            onChange={e => set("useEMA", e.target.value === "ema")}
            style={{ ...SS, minWidth: 56 }}
          >
            <option value="ema">EMA</option>
            <option value="sma">SMA</option>
          </select>
        )}

        {/* Remove */}
        <button onClick={onRemove} style={{
          background: "none", border: "none", color: "#ff4d4d",
          cursor: "pointer", fontSize: 14, padding: "0 4px",
        }}>×</button>
      </div>

      {/* AND / OR connector between rows */}
      {!isLast && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "5px 0 5px 4px" }}>
          <div style={{ height: 1, width: 16, background: "var(--bb-border)" }} />
          <button
            onClick={() => onLogicChange(logic === "AND" ? "OR" : "AND")}
            style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 9, fontWeight: 700,
              padding: "2px 10px", borderRadius: 2, cursor: "pointer",
              border: `1px solid ${logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)"}`,
              background: logic === "OR" ? "rgba(255,165,0,0.1)" : "rgba(0,212,160,0.08)",
              color: logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)",
              letterSpacing: "0.1em",
            }}
          >
            {logic}
          </button>
          <div style={{ height: 1, flex: 1, background: "var(--bb-border)" }} />
          <span style={{ fontSize: 8, color: "var(--bb-text-faint)", fontFamily: "IBM Plex Mono" }}>
            click to toggle
          </span>
        </div>
      )}
    </div>
  );
}

// ── Condition Builder ─────────────────────────────────────────────────────────
function ConditionBuilder({
  conditions, logic, onChange, onLogicChange,
}: {
  conditions: CondRow[];
  logic: Logic;
  onChange: (c: CondRow[]) => void;
  onLogicChange: (l: Logic) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {conditions.map((c, idx) => (
        <ConditionRow
          key={c.id}
          row={c}
          logic={logic}
          onLogicChange={onLogicChange}
          isLast={idx === conditions.length - 1}
          onChange={updated => onChange(conditions.map(r => r.id === c.id ? updated : r))}
          onRemove={() => onChange(conditions.filter(r => r.id !== c.id))}
        />
      ))}
      <button
        onClick={() => onChange([...conditions, defaultRow(Date.now())])}
        style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
          padding: "5px 12px", borderRadius: 2, cursor: "pointer",
          border: "1px dashed var(--bb-border)", background: "transparent",
          color: "var(--bb-text-faint)", alignSelf: "flex-start", marginTop: 8,
        }}
      >
        + ADD CONDITION
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function HistoricalExpectancy() {
  const [mode, setMode] = useState<"natural" | "builder">("natural");
  const [naturalQuery, setNaturalQuery] = useState("");
  const [ticker, setTicker] = useState("QQQ");
  const [conditions, setConditions] = useState<CondRow[]>([defaultRow(1)]);
  const [logic, setLogic] = useState<Logic>("AND");
  const [result, setResult] = useState<ExpectancyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const EXAMPLES = [
    "QQQ up 8.5% in 6 days",
    "TSLA up 15% in 10 days",
    "SPY down 5% in 5 days",
    "NVDA up 20% in 5 days and RSI above 70",
    "AMZN up 18.5% in 8 sessions, RSI >70, price >10% extended above 20 EMA",
    "AAPL above 200dma",
    "SPY near 52-week high",
    "TSLA gap up 5%",
  ];

  async function runQuery() {
    setLoading(true);
    setError(null);
    try {
      let body: any;
      if (mode === "natural") {
        if (!naturalQuery.trim()) { setError("Enter a query"); setLoading(false); return; }
        body = { query: naturalQuery.trim() };
        if (!history.includes(naturalQuery.trim())) {
          setHistory(prev => [naturalQuery.trim(), ...prev].slice(0, 10));
        }
      } else {
        if (!ticker.trim() || conditions.length === 0) {
          setError("Enter a ticker and at least one condition");
          setLoading(false);
          return;
        }
        // Build a ConditionGroup with the chosen logic
        body = {
          ticker: ticker.toUpperCase(),
          group: {
            logic,
            conditions: conditions.map(condToPayload),
          },
        };
      }

      const res = await apiRequest("POST", "/api/expectancy", body);
      const data = await res.json();
      if (data.error) { setError(data.error); setResult(null); }
      else setResult(data);
    } catch (e: any) {
      setError(e?.message ?? "Request failed");
    }
    setLoading(false);
  }

  const fieldStyle: React.CSSProperties = {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
    background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
    color: "var(--bb-text)", borderRadius: 2, padding: "8px 12px",
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Query panel ── */}
      <div className="panel" style={{ padding: "14px 16px" }}>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {(["natural", "builder"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
              padding: "4px 14px", borderRadius: 2, cursor: "pointer",
              border: mode === m ? "1px solid var(--bb-green)" : "1px solid var(--bb-border)",
              background: mode === m ? "rgba(0,212,160,0.1)" : "transparent",
              color: mode === m ? "var(--bb-green)" : "var(--bb-text-dim)",
              fontWeight: mode === m ? 700 : 400, letterSpacing: "0.07em",
            }}>
              {m === "natural" ? "NATURAL LANGUAGE" : "CONDITION BUILDER"}
            </button>
          ))}
        </div>

        {mode === "natural" ? (
          <div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={naturalQuery}
                onChange={e => setNaturalQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runQuery()}
                placeholder='e.g. "AMZN up 18.5% in 8 days, RSI >70, price >10% extended above 20 EMA"'
                style={{ ...fieldStyle, flex: 1, fontSize: 12 }}
              />
              <button onClick={runQuery} disabled={loading} style={{
                fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
                padding: "8px 20px", borderRadius: 2, cursor: loading ? "default" : "pointer",
                border: "1px solid var(--bb-green)", background: loading ? "transparent" : "rgba(0,212,160,0.15)",
                color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.07em", whiteSpace: "nowrap",
              }}>
                {loading ? "RUNNING…" : "RUN QUERY"}
              </button>
            </div>

            {/* Example chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
              {EXAMPLES.map(q => (
                <button key={q} onClick={() => setNaturalQuery(q)} style={{
                  fontFamily: "IBM Plex Mono, monospace", fontSize: 8,
                  padding: "3px 9px", borderRadius: 2, cursor: "pointer",
                  border: "1px solid var(--bb-border)", background: "transparent",
                  color: "var(--bb-text-faint)",
                }}>
                  {q}
                </button>
              ))}
            </div>

            {history.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>RECENT:</span>
                {history.map(q => (
                  <button key={q} onClick={() => setNaturalQuery(q)} style={{
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 8,
                    padding: "2px 8px", borderRadius: 2, cursor: "pointer",
                    border: "1px solid rgba(0,212,160,0.2)", background: "rgba(0,212,160,0.05)",
                    color: "var(--bb-green)",
                  }}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Ticker + Global logic */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>TICKER</span>
                <input
                  value={ticker}
                  onChange={e => setTicker(e.target.value.toUpperCase())}
                  style={{ ...fieldStyle, width: 80, fontSize: 14, fontWeight: 700, textAlign: "center" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>LOGIC</span>
                <button
                  onClick={() => setLogic(l => l === "AND" ? "OR" : "AND")}
                  style={{
                    fontFamily: "IBM Plex Mono, monospace", fontSize: 10, fontWeight: 700,
                    padding: "4px 16px", borderRadius: 2, cursor: "pointer",
                    border: `1px solid ${logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)"}`,
                    background: logic === "OR" ? "rgba(255,165,0,0.12)" : "rgba(0,212,160,0.12)",
                    color: logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)",
                    letterSpacing: "0.12em",
                  }}
                >
                  {logic}
                </button>
                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 8, color: "var(--bb-text-faint)" }}>
                  {logic === "AND" ? "all must match" : "any must match"}
                </span>
              </div>
            </div>

            <ConditionBuilder
              conditions={conditions}
              logic={logic}
              onChange={setConditions}
              onLogicChange={setLogic}
            />

            <button onClick={runQuery} disabled={loading} style={{
              fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
              padding: "8px 20px", borderRadius: 2, cursor: loading ? "default" : "pointer",
              border: "1px solid var(--bb-green)", background: loading ? "transparent" : "rgba(0,212,160,0.15)",
              color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.07em", alignSelf: "flex-start",
            }}>
              {loading ? "RUNNING…" : "RUN QUERY"}
            </button>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 10, fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
            color: "#ff4d4d", padding: "8px 12px",
            background: "rgba(255,77,77,0.08)", borderRadius: 2, border: "1px solid rgba(255,77,77,0.2)",
          }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="panel" style={{ padding: 30, textAlign: "center" }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--bb-text-faint)" }}>
            Scanning 10 years of historical data…
          </span>
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <>
          {result.error ? (
            <div className="panel" style={{ padding: 20 }}>
              <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "#ff4d4d" }}>{result.error}</span>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 15, fontWeight: 700, color: "var(--bb-text)", letterSpacing: "0.04em" }}>
                  {result.label}
                </div>
                <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--bb-text-faint)", marginTop: 4 }}>
                  {result.events.length} events · {result.dateRange}
                </div>
              </div>

              {result.events.length === 0 ? (
                <div className="panel" style={{ padding: 30, textAlign: "center" }}>
                  <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--bb-text-faint)" }}>
                    No historical matches found. Try relaxing conditions or switching to OR logic.
                  </span>
                </div>
              ) : (
                <>
                  {/* Summary table */}
                  <div className="panel" style={{ padding: "14px 16px" }}>
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>
                      FORWARD RETURNS SUMMARY
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 500 }}>
                        <thead>
                          <tr>
                            <td style={{ padding: "6px 14px", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)" }} />
                            {WINDOWS.map(w => (
                              <th key={w} style={{ padding: "6px 14px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, fontWeight: 700, color: "var(--bb-green)", textAlign: "center", letterSpacing: "0.08em" }}>
                                {w}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label: "WIN RATE", key: "winRate", fmt: (v: any) => `${v}%`, color: (v: any) => winRateColor(v) },
                            { label: "MEAN",     key: "mean",    fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MEDIAN",   key: "median",  fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MIN",      key: "min",     fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MAX",      key: "max",     fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "STD DEV",  key: "std",     fmt: (v: any) => `${v}%`,   color: () => "var(--bb-text-dim)" },
                          ].map(row => (
                            <tr key={row.label} style={{ borderTop: "1px solid hsl(220 15% 10%)" }}>
                              <td style={{ padding: "8px 14px", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em", fontWeight: 600 }}>
                                {row.label}
                              </td>
                              {WINDOWS.map(w => {
                                const stat = result.summary?.[w];
                                const val = stat ? (stat as any)[row.key] : null;
                                return (
                                  <td key={w} style={{ padding: "8px 14px", textAlign: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 12, fontWeight: 600, color: val != null ? row.color(val) : "var(--bb-text-faint)" }}>
                                    {val != null ? row.fmt(val) : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Plain English */}
                  {result.plainText && (
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--bb-text-dim)", fontStyle: "italic", textAlign: "center", padding: "2px 8px" }}>
                      {result.plainText}
                    </div>
                  )}

                  {/* Events table */}
                  <div className="panel" style={{ padding: "14px 16px" }}>
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>
                      INDIVIDUAL EVENTS ({result.events.length})
                    </div>
                    <div style={{ overflowX: "auto", maxHeight: 440, overflowY: "auto" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
                        <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
                          <tr style={{ background: "hsl(220 20% 8%)" }}>
                            {["DATE", "PRICE", "TRIGGER", ...WINDOWS].map(h => (
                              <th key={h} style={{ padding: "6px 12px", fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)", textAlign: h === "DATE" ? "left" : "center", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--bb-border)" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.events.map((ev, i) => (
                            <tr key={ev.date} style={{ borderTop: "1px solid hsl(220 15% 9%)", background: i % 2 === 0 ? "transparent" : "hsl(220 18% 8%)" }}>
                              <td style={{ padding: "7px 12px", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--bb-text-dim)", whiteSpace: "nowrap" }}>{ev.date}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--bb-text)" }}>${ev.price}</td>
                              <td style={{ padding: "7px 12px", textAlign: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: ev.triggerPct != null ? pctColor(ev.triggerPct) : "var(--bb-text-faint)" }}>
                                {ev.triggerPct != null ? fmtPct(ev.triggerPct) : "—"}
                              </td>
                              {WINDOWS.map(w => {
                                const v = ev.returns[w];
                                return (
                                  <td key={w} style={{ padding: "7px 12px", textAlign: "center", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: v != null ? pctColor(v) : "var(--bb-text-faint)", fontWeight: v != null && Math.abs(v) > 10 ? 700 : 400 }}>
                                    {v != null ? fmtPct(v) : "—"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, color: "var(--bb-text-dim)", marginBottom: 8 }}>HISTORICAL EXPECTANCY ENGINE</div>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: "var(--bb-text-faint)", lineHeight: 1.8 }}>
            Quantify forward returns for any combination of conditions over 10 years of history.<br />
            Combine Price Momentum · RSI · MA Deviation · Bollinger Bands · Volume with AND / OR logic.
          </div>
        </div>
      )}
    </div>
  );
}
