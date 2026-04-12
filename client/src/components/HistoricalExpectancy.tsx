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

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Condition Builder ─────────────────────────────────────────────────────────
type ConditionType = "price_change_pct" | "price_above_ma" | "rsi" | "volume_surge" | "gap_up" | "near_52w_high" | "near_52w_low";

interface ConditionRow {
  id: number;
  type: ConditionType;
  direction: string;
  value: string;
  lookback: string;
}

const CONDITION_LABELS: Record<ConditionType, string> = {
  price_change_pct: "Price Change %",
  price_above_ma: "Price vs MA",
  rsi: "RSI",
  volume_surge: "Volume Surge",
  gap_up: "Gap Up %",
  near_52w_high: "Near 52W High",
  near_52w_low: "Near 52W Low",
};

function ConditionBuilder({ conditions, onChange }: { conditions: ConditionRow[]; onChange: (c: ConditionRow[]) => void }) {
  function addRow() {
    onChange([...conditions, { id: Date.now(), type: "price_change_pct", direction: "up", value: "5", lookback: "5" }]);
  }
  function removeRow(id: number) {
    onChange(conditions.filter(c => c.id !== id));
  }
  function updateRow(id: number, field: keyof ConditionRow, val: string) {
    onChange(conditions.map(c => c.id === id ? { ...c, [field]: val } : c));
  }

  const inputStyle = {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 10,
    background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
    color: "var(--bb-text)", borderRadius: 2, padding: "4px 7px",
  };
  const selectStyle = { ...inputStyle, cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {conditions.map(c => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <select value={c.type} onChange={e => updateRow(c.id, "type", e.target.value)} style={{ ...selectStyle, minWidth: 140 }}>
            {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>

          {(c.type === "price_change_pct" || c.type === "rsi" || c.type === "price_above_ma") && (
            <select value={c.direction} onChange={e => updateRow(c.id, "direction", e.target.value)} style={{ ...selectStyle, minWidth: 70 }}>
              {c.type === "price_change_pct" ? (
                <><option value="up">Up</option><option value="down">Down</option></>
              ) : (
                <><option value="above">Above</option><option value="below">Below</option></>
              )}
            </select>
          )}

          {c.type !== "near_52w_high" && c.type !== "near_52w_low" && (
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <input
                type="number" value={c.value}
                onChange={e => updateRow(c.id, "value", e.target.value)}
                style={{ ...inputStyle, width: 60 }}
                placeholder={c.type === "volume_surge" ? "2" : c.type === "price_above_ma" ? "50" : "5"}
              />
              <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>
                {c.type === "volume_surge" ? "× avg vol" : c.type === "price_above_ma" ? "dma" : "%"}
              </span>
            </div>
          )}

          {(c.type === "price_change_pct") && (
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>in</span>
              <input
                type="number" value={c.lookback}
                onChange={e => updateRow(c.id, "lookback", e.target.value)}
                style={{ ...inputStyle, width: 50 }}
              />
              <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)" }}>days</span>
            </div>
          )}

          <button onClick={() => removeRow(c.id)} style={{
            background: "none", border: "none", color: "#ff4d4d", cursor: "pointer", fontSize: 14, padding: "0 2px",
          }}>×</button>
        </div>
      ))}
      <button onClick={addRow} className="font-mono" style={{
        fontSize: 9, padding: "5px 12px", borderRadius: 2, cursor: "pointer",
        border: "1px dashed var(--bb-border)", background: "transparent",
        color: "var(--bb-text-faint)", alignSelf: "flex-start", marginTop: 2,
      }}>+ ADD CONDITION</button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function HistoricalExpectancy() {
  const [mode, setMode] = useState<"natural" | "builder">("natural");
  const [naturalQuery, setNaturalQuery] = useState("");
  const [ticker, setTicker] = useState("QQQ");
  const [conditions, setConditions] = useState<ConditionRow[]>([
    { id: 1, type: "price_change_pct", direction: "up", value: "8.5", lookback: "6" },
  ]);
  const [result, setResult] = useState<ExpectancyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const EXAMPLE_QUERIES = [
    "QQQ up 8.5% in 6 days",
    "TSLA up 15% in 10 days",
    "SPY down 5% in 5 days",
    "NVDA up 20% in 5 days and RSI above 70",
    "AAPL above 200dma",
    "AMZN gap up 5%",
    "SPY near 52-week high",
    "QQQ down 10% in 21 days",
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
        if (!ticker.trim() || conditions.length === 0) { setError("Enter ticker and at least one condition"); setLoading(false); return; }
        const mappedConditions = conditions.map(c => ({
          type: c.type,
          direction: c.direction || undefined,
          value: parseFloat(c.value) || 0,
          lookback: c.lookback ? parseInt(c.lookback) : undefined,
        }));
        body = { ticker: ticker.toUpperCase(), conditions: mappedConditions };
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

  const fieldStyle = {
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
            <button key={m} onClick={() => setMode(m)} className="font-mono" style={{
              fontSize: 9, padding: "4px 14px", borderRadius: 2, cursor: "pointer",
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
                placeholder='e.g. "QQQ up 8.5% in 6 days" or "TSLA up 10% in 5 days and RSI above 70"'
                style={{ ...fieldStyle, flex: 1, fontSize: 12 }}
                data-testid="expectancy-query-input"
              />
              <button onClick={runQuery} disabled={loading} className="font-mono" style={{
                fontSize: 10, padding: "8px 20px", borderRadius: 2, cursor: loading ? "default" : "pointer",
                border: "1px solid var(--bb-green)", background: loading ? "transparent" : "rgba(0,212,160,0.15)",
                color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.07em", whiteSpace: "nowrap",
              }}>
                {loading ? "RUNNING…" : "RUN QUERY"}
              </button>
            </div>

            {/* Example chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
              {EXAMPLE_QUERIES.map(q => (
                <button key={q} onClick={() => { setNaturalQuery(q); }} className="font-mono" style={{
                  fontSize: 8, padding: "3px 9px", borderRadius: 2, cursor: "pointer",
                  border: "1px solid var(--bb-border)", background: "transparent",
                  color: "var(--bb-text-faint)",
                }}>
                  {q}
                </button>
              ))}
            </div>

            {/* History */}
            {history.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>RECENT:</span>
                {history.map(q => (
                  <button key={q} onClick={() => setNaturalQuery(q)} className="font-mono" style={{
                    fontSize: 8, padding: "2px 8px", borderRadius: 2, cursor: "pointer",
                    border: "1px solid rgba(0,212,160,0.2)", background: "rgba(0,212,160,0.05)",
                    color: "var(--bb-green)",
                  }}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em", minWidth: 40 }}>TICKER</span>
              <input
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                style={{ ...fieldStyle, width: 90, fontSize: 14, fontWeight: 700, textAlign: "center" }}
              />
            </div>
            <div>
              <span className="font-mono" style={{ fontSize: 9, color: "var(--bb-text-faint)", letterSpacing: "0.08em", display: "block", marginBottom: 8 }}>CONDITIONS (ALL must be true)</span>
              <ConditionBuilder conditions={conditions} onChange={setConditions} />
            </div>
            <button onClick={runQuery} disabled={loading} className="font-mono" style={{
              fontSize: 10, padding: "8px 20px", borderRadius: 2, cursor: loading ? "default" : "pointer",
              border: "1px solid var(--bb-green)", background: loading ? "transparent" : "rgba(0,212,160,0.15)",
              color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.07em", alignSelf: "flex-start",
            }}>
              {loading ? "RUNNING…" : "RUN QUERY"}
            </button>
          </div>
        )}

        {error && (
          <div className="font-mono" style={{ marginTop: 10, fontSize: 11, color: "#ff4d4d", padding: "8px 12px", background: "rgba(255,77,77,0.08)", borderRadius: 2, border: "1px solid rgba(255,77,77,0.2)" }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {loading && (
        <div className="panel" style={{ padding: 30, textAlign: "center" }}>
          <span className="font-mono" style={{ fontSize: 11, color: "var(--bb-text-faint)" }}>
            Scanning historical data…
          </span>
        </div>
      )}

      {result && !loading && (
        <>
          {result.error ? (
            <div className="panel" style={{ padding: 20 }}>
              <span className="font-mono" style={{ fontSize: 11, color: "#ff4d4d" }}>{result.error}</span>
            </div>
          ) : (
            <>
              {/* Title */}
              <div style={{ textAlign: "center" }}>
                <div className="font-mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--bb-text)", letterSpacing: "0.05em" }}>
                  {result.label}: Historical Analysis
                </div>
                <div className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)", marginTop: 4 }}>
                  {result.events.length} events · {result.dateRange}
                </div>
              </div>

              {result.events.length === 0 ? (
                <div className="panel" style={{ padding: 30, textAlign: "center" }}>
                  <span className="font-mono" style={{ fontSize: 11, color: "var(--bb-text-faint)" }}>
                    No historical matches found for this pattern. Try relaxing the conditions.
                  </span>
                </div>
              ) : (
                <>
                  {/* Forward Returns Summary table */}
                  <div className="panel" style={{ padding: "14px 16px" }}>
                    <div className="font-mono" style={{ fontSize: 10, color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>
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
                            { label: "MEAN", key: "mean", fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MEDIAN", key: "median", fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MIN", key: "min", fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "MAX", key: "max", fmt: (v: any) => fmtPct(v), color: pctColor },
                            { label: "STD", key: "std", fmt: (v: any) => `${v}%`, color: () => "var(--bb-text-dim)" },
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

                  {/* Plain English summary */}
                  {result.plainText && (
                    <div className="font-mono" style={{ fontSize: 11, color: "var(--bb-text-dim)", fontStyle: "italic", textAlign: "center", padding: "2px 8px" }}>
                      {result.plainText}
                    </div>
                  )}

                  {/* Individual events table */}
                  <div className="panel" style={{ padding: "14px 16px" }}>
                    <div className="font-mono" style={{ fontSize: 10, color: "var(--bb-green)", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>
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
          <div className="font-mono" style={{ fontSize: 13, color: "var(--bb-text-dim)", marginBottom: 8 }}>HISTORICAL EXPECTANCY ENGINE</div>
          <div className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-faint)", lineHeight: 1.7 }}>
            Quantify forward returns for any pattern going back 10 years.<br />
            Type a query above or use the condition builder to get started.
          </div>
        </div>
      )}
    </div>
  );
}
