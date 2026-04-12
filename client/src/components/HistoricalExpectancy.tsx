import { useState, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ForwardStat { winRate: number; mean: number; median: number; min: number; max: number; std: number; n: number; }
interface ExpectancyResult {
  ticker: string; label: string;
  events: Array<{ date: string; price: number; triggerPct: number | null; returns: Record<string, number | null> }>;
  summary: Record<string, ForwardStat | null>;
  dateRange: string; plainText?: string; error?: string;
}
const WINDOWS = ["1D", "1W", "1M", "3M", "1Y"];
function fmtPct(v: number | null | undefined, d = 1) { if (v == null) return "—"; return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`; }
function pctColor(v: number | null | undefined) { if (v == null) return "var(--bb-text-dim)"; return v > 0 ? "#00d4a0" : v < 0 ? "#ff4d4d" : "var(--bb-text-dim)"; }
function winColor(v: number) { return v >= 65 ? "#00d4a0" : v >= 50 ? "#ffa500" : "#ff4d4d"; }

// ── Condition schema ──────────────────────────────────────────────────────────
type CondType =
  // Trend & Structure
  | "price_above_ma" | "ma_alignment" | "price_extended_pct" | "new_high"
  // Momentum & Velocity
  | "price_change_pct" | "rsi" | "rsi_divergence" | "macd_histogram" | "macd_crossover"
  // Volatility & Compression
  | "bb_width" | "bb_squeeze" | "bb_position" | "atr_expansion"
  // Volume & Liquidity
  | "volume_surge" | "gap_up" | "near_52w_high" | "near_52w_low";

type Bucket = "setup" | "trigger" | "filter";
type Logic = "AND" | "OR";

interface CondRow {
  id: number;
  type: CondType;
  direction: string;
  value: string;
  lookback: string;
  lookback2: string;
  useEMA: boolean;
  rsiPeriod: string;
  bucket: Bucket;
}

// Condition metadata
const BUCKETS: Bucket[] = ["setup", "trigger", "filter"];
const BUCKET_COLORS: Record<Bucket, string> = {
  setup: "#7b8cde",
  trigger: "#00d4a0",
  filter: "#ffa500",
};
const BUCKET_LABELS: Record<Bucket, string> = {
  setup: "SETUP",
  trigger: "TRIGGER",
  filter: "FILTER",
};

type CMeta = { label: string; bucket: Bucket; hasDir: boolean; hasVal: boolean; valLabel: string; valPlaceholder: string; hasLookback: boolean; lbLabel: string; lbPlaceholder: string; hasLookback2: boolean; lb2Label: string; hasMAType: boolean; hasRSIPeriod: boolean; };
const CM: Record<CondType, CMeta> = {
  // Trend & Structure
  price_above_ma:     { label:"Price vs SMA",          bucket:"setup",   hasDir:true, hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:true,  lbLabel:"period",  lbPlaceholder:"50",  hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  ma_alignment:       { label:"MA Alignment (50/200)", bucket:"setup",   hasDir:true, hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  price_extended_pct: { label:"% Extension from MA",   bucket:"setup",   hasDir:true, hasVal:true,  valLabel:"%",        valPlaceholder:"5",   hasLookback:true,  lbLabel:"period",  lbPlaceholder:"20",  hasLookback2:false, lb2Label:"",         hasMAType:true,  hasRSIPeriod:false },
  new_high:           { label:"New 52W High",           bucket:"setup",   hasDir:false,hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:true,  lbLabel:"within d",lbPlaceholder:"5",   hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  // Momentum & Velocity
  price_change_pct:   { label:"Rate of Change (ROC)",  bucket:"trigger", hasDir:true, hasVal:true,  valLabel:"%",        valPlaceholder:"5",   hasLookback:true,  lbLabel:"days",    lbPlaceholder:"5",   hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  rsi:                { label:"RSI Level",              bucket:"trigger", hasDir:true, hasVal:true,  valLabel:"",         valPlaceholder:"70",  hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:true  },
  rsi_divergence:     { label:"RSI Holding (Divergence)",bucket:"trigger",hasDir:true, hasVal:true,  valLabel:"",         valPlaceholder:"50",  hasLookback:true,  lbLabel:"bars",    lbPlaceholder:"3",   hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:true  },
  macd_histogram:     { label:"MACD Histogram",         bucket:"trigger", hasDir:true, hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  macd_crossover:     { label:"MACD Crossover",         bucket:"trigger", hasDir:true, hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  // Volatility & Compression
  bb_width:           { label:"Bollinger Band Width",   bucket:"trigger", hasDir:true, hasVal:true,  valLabel:"ratio",    valPlaceholder:"0.1", hasLookback:true,  lbLabel:"period",  lbPlaceholder:"20",  hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  bb_squeeze:         { label:"BB Squeeze (VCP)",       bucket:"trigger", hasDir:false,hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:true,  lbLabel:"BB per.", lbPlaceholder:"20",  hasLookback2:true,  lb2Label:"squeeze d",hasMAType:false, hasRSIPeriod:false },
  bb_position:        { label:"Price vs BB Band",       bucket:"trigger", hasDir:true, hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  atr_expansion:      { label:"ATR Expansion",          bucket:"trigger", hasDir:true, hasVal:true,  valLabel:"%",        valPlaceholder:"20",  hasLookback:true,  lbLabel:"period",  lbPlaceholder:"14",  hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  // Volume & Liquidity
  volume_surge:       { label:"Relative Volume (RVOL)", bucket:"filter",  hasDir:false,hasVal:true,  valLabel:"× avg",    valPlaceholder:"2",   hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  gap_up:             { label:"Gap Up",                 bucket:"filter",  hasDir:false,hasVal:true,  valLabel:"%",        valPlaceholder:"3",   hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  near_52w_high:      { label:"Near 52W High",          bucket:"setup",   hasDir:false,hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
  near_52w_low:       { label:"Near 52W Low",           bucket:"setup",   hasDir:false,hasVal:false, valLabel:"",         valPlaceholder:"",    hasLookback:false, lbLabel:"",        lbPlaceholder:"",    hasLookback2:false, lb2Label:"",         hasMAType:false, hasRSIPeriod:false },
};

const BUCKET_GROUPS: Record<Bucket, { title: string; desc: string; types: CondType[] }> = {
  setup: {
    title: "TREND & STRUCTURE",
    desc: "Foundation — define the environment before oscillators",
    types: ["price_above_ma","ma_alignment","price_extended_pct","new_high","near_52w_high","near_52w_low"],
  },
  trigger: {
    title: "MOMENTUM / VOLATILITY",
    desc: "Fuel & Spring — speed, RSI, MACD, BB compression",
    types: ["price_change_pct","rsi","rsi_divergence","macd_histogram","macd_crossover","bb_width","bb_squeeze","bb_position","atr_expansion"],
  },
  filter: {
    title: "VOLUME & LIQUIDITY",
    desc: "Conviction — ensure institutional backing",
    types: ["volume_surge","gap_up"],
  },
};

function defaultRow(id: number, type: CondType = "price_change_pct"): CondRow {
  return { id, type, direction: type === "price_change_pct" ? "up" : "above", value: "5", lookback: "5", lookback2: "126", useEMA: true, rsiPeriod: "14", bucket: CM[type].bucket };
}

function rowToPayload(r: CondRow) {
  return {
    type: r.type,
    direction: r.direction || undefined,
    value: parseFloat(r.value) || 0,
    lookback: r.lookback ? parseInt(r.lookback) : undefined,
    lookback2: r.lookback2 ? parseInt(r.lookback2) : undefined,
    useEMA: r.useEMA,
    rsiPeriod: r.rsiPeriod ? parseInt(r.rsiPeriod) : 14,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const IS: React.CSSProperties = { fontFamily:"IBM Plex Mono,monospace", fontSize:10, background:"hsl(220 18% 9%)", border:"1px solid var(--bb-border)", color:"var(--bb-text)", borderRadius:2, padding:"4px 7px" };
const SS: React.CSSProperties = { ...IS, cursor:"pointer" };

// ── Single condition row ──────────────────────────────────────────────────────
function CondRow({ row, onChange, onRemove }: { row: CondRow; onChange: (r: CondRow) => void; onRemove: () => void }) {
  const m = CM[row.type];
  function set(field: keyof CondRow, val: any) { onChange({ ...row, [field]: val }); }
  function setType(t: CondType) {
    const defs: Partial<CondRow> = { type: t, bucket: CM[t].bucket };
    if (t === "price_change_pct") { defs.direction = "up"; defs.lookback = "5"; defs.value = "5"; }
    else if (t === "rsi") { defs.direction = "above"; defs.value = "70"; defs.rsiPeriod = "14"; }
    else if (t === "rsi_divergence") { defs.direction = "above"; defs.value = "50"; defs.lookback = "3"; defs.rsiPeriod = "14"; }
    else if (t === "volume_surge") { defs.direction = ""; defs.value = "2"; }
    else if (t === "gap_up") { defs.direction = ""; defs.value = "3"; }
    else if (t === "bb_width") { defs.direction = "above"; defs.value = "0.1"; defs.lookback = "20"; }
    else if (t === "bb_squeeze") { defs.direction = ""; defs.lookback = "20"; defs.lookback2 = "126"; }
    else if (t === "atr_expansion") { defs.direction = "above"; defs.value = "20"; defs.lookback = "14"; }
    else if (t === "macd_histogram" || t === "macd_crossover") { defs.direction = "above"; defs.value = "0"; }
    else if (t === "ma_alignment") { defs.direction = "above"; defs.value = "0"; }
    else { defs.direction = "above"; defs.value = ""; }
    onChange({ ...row, ...defs });
  }

  const bucketColor = BUCKET_COLORS[row.bucket];

  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", padding:"6px 8px", borderRadius:3, background:"hsl(220 18% 8%)", border:`1px solid hsl(220 15% 14%)`, marginBottom:4 }}>
      {/* Bucket badge */}
      <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:7, fontWeight:700, letterSpacing:"0.12em", color:bucketColor, border:`1px solid ${bucketColor}`, padding:"2px 6px", borderRadius:2, minWidth:46, textAlign:"center", opacity:0.9 }}>
        {BUCKET_LABELS[row.bucket]}
      </span>

      {/* Type selector */}
      <select value={row.type} onChange={e => setType(e.target.value as CondType)} style={{ ...SS, minWidth:185 }}>
        {BUCKETS.map(b => (
          <optgroup key={b} label={`── ${BUCKET_GROUPS[b].title} ──`}>
            {BUCKET_GROUPS[b].types.map(t => <option key={t} value={t}>{CM[t].label}</option>)}
          </optgroup>
        ))}
      </select>

      {/* Direction */}
      {m.hasDir && (
        <select value={row.direction} onChange={e => set("direction", e.target.value)} style={{ ...SS, minWidth:90 }}>
          {row.type === "price_change_pct" ? (
            <><option value="up">↑ Up</option><option value="down">↓ Down</option></>
          ) : row.type === "ma_alignment" ? (
            <><option value="above">50d &gt; 200d ↑</option><option value="below">50d &lt; 200d ↓</option></>
          ) : row.type === "bb_position" ? (
            <><option value="above">Above Upper</option><option value="below">Below Lower</option></>
          ) : row.type === "macd_histogram" ? (
            <><option value="above">Expanding ↑</option><option value="below">Expanding ↓</option></>
          ) : row.type === "macd_crossover" ? (
            <><option value="above">Bullish ✕</option><option value="below">Bearish ✕</option></>
          ) : row.type === "atr_expansion" ? (
            <><option value="above">Expanded ↑</option><option value="below">Contracted ↓</option></>
          ) : (
            <><option value="above">Above</option><option value="below">Below</option></>
          )}
        </select>
      )}

      {/* Value */}
      {m.hasVal && (
        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
          <input type="number" step="0.01" value={row.value} onChange={e => set("value", e.target.value)}
            style={{ ...IS, width:64 }} placeholder={m.valPlaceholder} />
          <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }}>{m.valLabel}</span>
        </div>
      )}

      {/* Lookback */}
      {m.hasLookback && (
        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
          {row.type === "price_change_pct" && <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }}>in</span>}
          <input type="number" value={row.lookback} onChange={e => set("lookback", e.target.value)}
            style={{ ...IS, width:50 }} placeholder={m.lbPlaceholder} />
          <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }}>{m.lbLabel}</span>
        </div>
      )}

      {/* Lookback2 (squeeze window) */}
      {m.hasLookback2 && (
        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
          <input type="number" value={row.lookback2} onChange={e => set("lookback2", e.target.value)}
            style={{ ...IS, width:50 }} placeholder="126" />
          <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }}>{m.lb2Label}</span>
        </div>
      )}

      {/* EMA/SMA toggle */}
      {m.hasMAType && (
        <select value={row.useEMA ? "ema" : "sma"} onChange={e => set("useEMA", e.target.value === "ema")} style={{ ...SS, minWidth:56 }}>
          <option value="ema">EMA</option>
          <option value="sma">SMA</option>
        </select>
      )}

      {/* RSI period */}
      {m.hasRSIPeriod && (
        <div style={{ display:"flex", alignItems:"center", gap:3 }}>
          <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }}>period</span>
          <input type="number" value={row.rsiPeriod} onChange={e => set("rsiPeriod", e.target.value)}
            style={{ ...IS, width:42 }} placeholder="14" />
        </div>
      )}

      <button onClick={onRemove} style={{ background:"none", border:"none", color:"#ff4d4d", cursor:"pointer", fontSize:14, padding:"0 4px", marginLeft:"auto" }}>×</button>
    </div>
  );
}

// ── Condition Builder with AND/OR connector ───────────────────────────────────
function ConditionBuilder({ conditions, logic, onChange, onLogicChange }: {
  conditions: CondRow[]; logic: Logic; onChange: (c: CondRow[]) => void; onLogicChange: (l: Logic) => void;
}) {
  return (
    <div>
      {conditions.map((c, idx) => (
        <div key={c.id}>
          <CondRow row={c}
            onChange={updated => onChange(conditions.map(r => r.id === c.id ? updated : r))}
            onRemove={() => onChange(conditions.filter(r => r.id !== c.id))}
          />
          {idx < conditions.length - 1 && (
            <div style={{ display:"flex", alignItems:"center", gap:6, margin:"2px 0 2px 8px" }}>
              <div style={{ height:1, width:12, background:"var(--bb-border)" }} />
              <button onClick={() => onLogicChange(logic === "AND" ? "OR" : "AND")} style={{
                fontFamily:"IBM Plex Mono,monospace", fontSize:9, fontWeight:700, padding:"2px 10px", borderRadius:2, cursor:"pointer",
                border:`1px solid ${logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)"}`,
                background: logic === "OR" ? "rgba(255,165,0,0.1)" : "rgba(0,212,160,0.08)",
                color: logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)",
                letterSpacing:"0.1em",
              }}>{logic}</button>
              <div style={{ height:1, flex:1, background:"var(--bb-border)" }} />
              <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:7, color:"var(--bb-text-faint)" }}>tap to toggle</span>
            </div>
          )}
        </div>
      ))}
      <button onClick={() => onChange([...conditions, defaultRow(Date.now())])} style={{
        fontFamily:"IBM Plex Mono,monospace", fontSize:9, padding:"5px 12px", borderRadius:2, cursor:"pointer",
        border:"1px dashed var(--bb-border)", background:"transparent", color:"var(--bb-text-faint)", marginTop:8,
      }}>+ ADD CONDITION</button>
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
    "NVDA up 20% in 5 days and RSI above 70",
    "AMZN up 18.5% in 8 sessions, RSI >70, price >10% extended above 20 EMA",
    "SPY near 52-week high",
    "TSLA gap up 5%",
    "AAPL above 200dma",
    "SPY down 5% in 5 days",
  ];

  async function runQuery() {
    setLoading(true); setError(null);
    try {
      let body: any;
      if (mode === "natural") {
        if (!naturalQuery.trim()) { setError("Enter a query"); setLoading(false); return; }
        body = { query: naturalQuery.trim() };
        if (!history.includes(naturalQuery.trim())) setHistory(p => [naturalQuery.trim(), ...p].slice(0, 10));
      } else {
        if (!ticker.trim() || !conditions.length) { setError("Enter a ticker and at least one condition"); setLoading(false); return; }
        // Send both formats: new `group` for updated Railway, plus legacy `conditions`
        // array so it works even if Railway hasn't redeployed yet
        const mappedConds = conditions.map(rowToPayload);
        body = {
          ticker: ticker.toUpperCase(),
          logic,
          conditions: mappedConds,
          group: { logic, conditions: mappedConds },
        };
      }
      const res = await apiRequest("POST", "/api/expectancy", body);
      const data = await res.json();
      if (data.error) { setError(data.error); setResult(null); } else setResult(data);
    } catch (e: any) { setError(e?.message ?? "Request failed"); }
    setLoading(false);
  }

  const FS: React.CSSProperties = { fontFamily:"IBM Plex Mono,monospace", fontSize:11, background:"hsl(220 18% 9%)", border:"1px solid var(--bb-border)", color:"var(--bb-text)", borderRadius:2, padding:"8px 12px" };

  return (
    <div style={{ padding:12, display:"flex", flexDirection:"column", gap:12 }}>

      {/* ── Query panel ── */}
      <div className="panel" style={{ padding:"14px 16px" }}>
        {/* Mode toggle */}
        <div style={{ display:"flex", gap:6, marginBottom:14 }}>
          {(["natural","builder"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontFamily:"IBM Plex Mono,monospace", fontSize:9, padding:"4px 14px", borderRadius:2, cursor:"pointer",
              border: mode===m ? "1px solid var(--bb-green)" : "1px solid var(--bb-border)",
              background: mode===m ? "rgba(0,212,160,0.1)" : "transparent",
              color: mode===m ? "var(--bb-green)" : "var(--bb-text-dim)",
              fontWeight: mode===m ? 700 : 400, letterSpacing:"0.07em",
            }}>
              {m === "natural" ? "NATURAL LANGUAGE" : "CONDITION BUILDER"}
            </button>
          ))}
        </div>

        {mode === "natural" ? (
          <div>
            <div style={{ display:"flex", gap:8 }}>
              <input ref={inputRef} value={naturalQuery} onChange={e => setNaturalQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runQuery()}
                placeholder='e.g. "AMZN up 18.5% in 8 days, RSI >70, price >10% extended above 20 EMA"'
                style={{ ...FS, flex:1, fontSize:12 }} />
              <button onClick={runQuery} disabled={loading} style={{
                fontFamily:"IBM Plex Mono,monospace", fontSize:10, padding:"8px 20px", borderRadius:2,
                cursor: loading ? "default" : "pointer", border:"1px solid var(--bb-green)",
                background: loading ? "transparent" : "rgba(0,212,160,0.15)",
                color:"var(--bb-green)", fontWeight:700, letterSpacing:"0.07em", whiteSpace:"nowrap",
              }}>{loading ? "RUNNING…" : "RUN QUERY"}</button>
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:10 }}>
              {EXAMPLES.map(q => (
                <button key={q} onClick={() => setNaturalQuery(q)} style={{
                  fontFamily:"IBM Plex Mono,monospace", fontSize:8, padding:"3px 9px", borderRadius:2,
                  cursor:"pointer", border:"1px solid var(--bb-border)", background:"transparent", color:"var(--bb-text-faint)",
                }}>{q}</button>
              ))}
            </div>
            {history.length > 0 && (
              <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:8, color:"var(--bb-text-faint)", letterSpacing:"0.08em" }}>RECENT:</span>
                {history.map(q => (
                  <button key={q} onClick={() => setNaturalQuery(q)} style={{
                    fontFamily:"IBM Plex Mono,monospace", fontSize:8, padding:"2px 8px", borderRadius:2, cursor:"pointer",
                    border:"1px solid rgba(0,212,160,0.2)", background:"rgba(0,212,160,0.05)", color:"var(--bb-green)",
                  }}>{q}</button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {/* Ticker + Logic */}
            <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)", letterSpacing:"0.08em" }}>TICKER</span>
                <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                  style={{ ...FS, width:80, fontSize:14, fontWeight:700, textAlign:"center" }} />
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)", letterSpacing:"0.08em" }}>LOGIC</span>
                <button onClick={() => setLogic(l => l === "AND" ? "OR" : "AND")} style={{
                  fontFamily:"IBM Plex Mono,monospace", fontSize:10, fontWeight:700, padding:"4px 16px", borderRadius:2, cursor:"pointer",
                  border:`1px solid ${logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)"}`,
                  background: logic === "OR" ? "rgba(255,165,0,0.12)" : "rgba(0,212,160,0.12)",
                  color: logic === "OR" ? "var(--bb-amber)" : "var(--bb-green)", letterSpacing:"0.12em",
                }}>{logic}</button>
                <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:8, color:"var(--bb-text-faint)" }}>
                  {logic === "AND" ? "all must match" : "any must match"}
                </span>
              </div>
            </div>

            {/* Bucket legend */}
            <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
              {BUCKETS.map(b => (
                <div key={b} style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ width:8, height:8, borderRadius:1, background:BUCKET_COLORS[b], display:"inline-block" }} />
                  <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:8, color:"var(--bb-text-faint)" }}>
                    <span style={{ color:BUCKET_COLORS[b], fontWeight:700 }}>{BUCKET_LABELS[b]}</span> — {BUCKET_GROUPS[b].desc.split(" — ")[0]}
                  </span>
                </div>
              ))}
            </div>

            <ConditionBuilder conditions={conditions} logic={logic} onChange={setConditions} onLogicChange={setLogic} />

            <button onClick={runQuery} disabled={loading} style={{
              fontFamily:"IBM Plex Mono,monospace", fontSize:10, padding:"8px 20px", borderRadius:2,
              cursor: loading ? "default" : "pointer", border:"1px solid var(--bb-green)",
              background: loading ? "transparent" : "rgba(0,212,160,0.15)",
              color:"var(--bb-green)", fontWeight:700, letterSpacing:"0.07em", alignSelf:"flex-start",
            }}>{loading ? "RUNNING…" : "RUN QUERY"}</button>
          </div>
        )}

        {error && (
          <div style={{ marginTop:10, fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"#ff4d4d", padding:"8px 12px", background:"rgba(255,77,77,0.08)", borderRadius:2, border:"1px solid rgba(255,77,77,0.2)" }}>
            {error}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="panel" style={{ padding:30, textAlign:"center" }}>
          <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"var(--bb-text-faint)" }}>
            Scanning 10 years of data…
          </span>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {result.error ? (
            <div className="panel" style={{ padding:20 }}>
              <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"#ff4d4d" }}>{result.error}</span>
            </div>
          ) : (
            <>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:14, fontWeight:700, color:"var(--bb-text)", letterSpacing:"0.04em" }}>{result.label}</div>
                <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:10, color:"var(--bb-text-faint)", marginTop:4 }}>{result.events.length} events · {result.dateRange}</div>
              </div>

              {result.events.length === 0 ? (
                <div className="panel" style={{ padding:30, textAlign:"center" }}>
                  <span style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"var(--bb-text-faint)" }}>
                    No historical matches. Try relaxing conditions or switching to OR logic.
                  </span>
                </div>
              ) : (
                <>
                  <div className="panel" style={{ padding:"14px 16px" }}>
                    <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:10, color:"var(--bb-green)", fontWeight:700, letterSpacing:"0.1em", marginBottom:12 }}>FORWARD RETURNS SUMMARY</div>
                    <div style={{ overflowX:"auto" }}>
                      <table style={{ borderCollapse:"collapse", width:"100%", minWidth:500 }}>
                        <thead>
                          <tr>
                            <td style={{ padding:"6px 14px", fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)" }} />
                            {WINDOWS.map(w => <th key={w} style={{ padding:"6px 14px", fontFamily:"IBM Plex Mono,monospace", fontSize:11, fontWeight:700, color:"var(--bb-green)", textAlign:"center", letterSpacing:"0.08em" }}>{w}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label:"WIN RATE", key:"winRate", fmt:(v:any) => `${v}%`,   color:(v:any) => winColor(v) },
                            { label:"MEAN",     key:"mean",    fmt:(v:any) => fmtPct(v), color: pctColor },
                            { label:"MEDIAN",   key:"median",  fmt:(v:any) => fmtPct(v), color: pctColor },
                            { label:"MIN",      key:"min",     fmt:(v:any) => fmtPct(v), color: pctColor },
                            { label:"MAX",      key:"max",     fmt:(v:any) => fmtPct(v), color: pctColor },
                            { label:"STD DEV",  key:"std",     fmt:(v:any) => `${v}%`,   color: () => "var(--bb-text-dim)" },
                          ].map(row => (
                            <tr key={row.label} style={{ borderTop:"1px solid hsl(220 15% 10%)" }}>
                              <td style={{ padding:"8px 14px", fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)", letterSpacing:"0.08em", fontWeight:600 }}>{row.label}</td>
                              {WINDOWS.map(w => {
                                const stat = result.summary?.[w]; const val = stat ? (stat as any)[row.key] : null;
                                return <td key={w} style={{ padding:"8px 14px", textAlign:"center", fontFamily:"IBM Plex Mono,monospace", fontSize:12, fontWeight:600, color: val!=null ? row.color(val) : "var(--bb-text-faint)" }}>{val!=null ? row.fmt(val) : "—"}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {result.plainText && (
                    <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"var(--bb-text-dim)", fontStyle:"italic", textAlign:"center", padding:"2px 8px" }}>{result.plainText}</div>
                  )}

                  <div className="panel" style={{ padding:"14px 16px" }}>
                    <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:10, color:"var(--bb-green)", fontWeight:700, letterSpacing:"0.1em", marginBottom:12 }}>INDIVIDUAL EVENTS ({result.events.length})</div>
                    <div style={{ overflowX:"auto", maxHeight:440, overflowY:"auto" }}>
                      <table style={{ borderCollapse:"collapse", width:"100%", minWidth:560 }}>
                        <thead style={{ position:"sticky", top:0, zIndex:5 }}>
                          <tr style={{ background:"hsl(220 20% 8%)" }}>
                            {["DATE","PRICE","TRIGGER",...WINDOWS].map(h => (
                              <th key={h} style={{ padding:"6px 12px", fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)", textAlign: h==="DATE" ? "left" : "center", letterSpacing:"0.08em", fontWeight:600, borderBottom:"1px solid var(--bb-border)" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.events.map((ev, i) => (
                            <tr key={ev.date} style={{ borderTop:"1px solid hsl(220 15% 9%)", background: i%2===0 ? "transparent" : "hsl(220 18% 8%)" }}>
                              <td style={{ padding:"7px 12px", fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"var(--bb-text-dim)", whiteSpace:"nowrap" }}>{ev.date}</td>
                              <td style={{ padding:"7px 12px", textAlign:"center", fontFamily:"IBM Plex Mono,monospace", fontSize:11, color:"var(--bb-text)" }}>${ev.price}</td>
                              <td style={{ padding:"7px 12px", textAlign:"center", fontFamily:"IBM Plex Mono,monospace", fontSize:11, color: ev.triggerPct!=null ? pctColor(ev.triggerPct) : "var(--bb-text-faint)" }}>{ev.triggerPct!=null ? fmtPct(ev.triggerPct) : "—"}</td>
                              {WINDOWS.map(w => { const v = ev.returns[w]; return <td key={w} style={{ padding:"7px 12px", textAlign:"center", fontFamily:"IBM Plex Mono,monospace", fontSize:11, color: v!=null ? pctColor(v) : "var(--bb-text-faint)", fontWeight: v!=null && Math.abs(v)>10 ? 700 : 400 }}>{v!=null ? fmtPct(v) : "—"}</td>; })}
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

      {!result && !loading && (
        <div style={{ textAlign:"center", padding:"40px 20px" }}>
          <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:13, color:"var(--bb-text-dim)", marginBottom:10 }}>HISTORICAL EXPECTANCY ENGINE</div>
          <div style={{ fontFamily:"IBM Plex Mono,monospace", fontSize:9, color:"var(--bb-text-faint)", lineHeight:2.0 }}>
            <span style={{ color:BUCKET_COLORS.setup }}>■ SETUP</span> — Trend &amp; Structure (MA Alignment, % Extension, New Highs){"  "}
            <span style={{ color:BUCKET_COLORS.trigger }}>■ TRIGGER</span> — Momentum &amp; Volatility (RSI, MACD, BB Squeeze, ATR){"  "}
            <span style={{ color:BUCKET_COLORS.filter }}>■ FILTER</span> — Volume &amp; Conviction (RVOL, Gap Up)<br />
            Combine with <span style={{ color:"var(--bb-green)" }}>AND</span> / <span style={{ color:"var(--bb-amber)" }}>OR</span> logic · Any ticker · 10 years of data
          </div>
        </div>
      )}
    </div>
  );
}
