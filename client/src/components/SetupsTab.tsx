import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(decimals)}%`;
}

function patternBadgeStyle(pattern: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    "Bull Flag": { bg: "rgba(0,212,160,0.18)", text: "#00d4a0" },
    "Bear Flag": { bg: "rgba(255,77,77,0.18)", text: "#ff4d4d" },
    "Power Earnings Gap": { bg: "rgba(77,166,255,0.18)", text: "#4da6ff" },
    "Earnings Failure Gap": { bg: "rgba(255,165,0,0.18)", text: "#ffa500" },
    "Flat Base Breakout": { bg: "rgba(0,212,160,0.12)", text: "#00d4a0" },
    "High Tight Flag": { bg: "rgba(160,100,255,0.18)", text: "#a064ff" },
    "Parabolic Short": { bg: "rgba(255,77,77,0.12)", text: "#ff4d4d" },
    "Double Top": { bg: "rgba(255,165,0,0.12)", text: "#ffa500" },
  };
  return map[pattern] ?? { bg: "rgba(255,255,255,0.08)", text: "var(--bb-text-dim)" };
}

function confidenceColor(c: number): string {
  if (c >= 85) return "#00d4a0";
  if (c >= 70) return "#4da6ff";
  if (c >= 55) return "#ffa500";
  return "#ff4d4d";
}

// Real close-based sparkline
function Sparkline({ closes, positive }: { closes: number[]; positive: boolean }) {
  if (!closes || closes.length < 2) {
    return <div style={{ height: 65, background: "hsl(220 15% 12%)", borderRadius: 2 }} />;
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const w = 200, h = 60;
  const pts = closes.map((v, i) => {
    const x = (i / (closes.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const color = positive ? "#00d4a0" : "#ff4d4d";
  const fillColor = positive ? "rgba(0,212,160,0.08)" : "rgba(255,77,77,0.08)";

  // MA line (10-period)
  const maPts = closes.map((_, i) => {
    if (i < 9) return null;
    const ma = closes.slice(i - 9, i + 1).reduce((a, b) => a + b, 0) / 10;
    const x = (i / (closes.length - 1)) * w;
    const y = h - ((ma - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).filter(Boolean);

  const fillPath = `M${pts[0]} L${pts.join(" L")} L${w},${h} L0,${h} Z`;

  return (
    <div style={{ height: 65, background: "hsl(220 15% 11%)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path d={fillPath} fill={fillColor} />
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts.join(" ")} />
        {maPts.length > 1 && (
          <polyline fill="none" stroke="#c87940" strokeWidth="1" opacity="0.8" points={maPts.join(" ")} />
        )}
      </svg>
      {/* Current price label */}
      <span style={{
        position: "absolute", bottom: 3, right: 5,
        fontFamily: "IBM Plex Mono, monospace", fontSize: 9, color: "var(--bb-text-faint)"
      }}>
        ${closes[closes.length - 1]?.toFixed(2)}
      </span>
    </div>
  );
}

// Define Setup modal/panel
function DefineSetupPanel({ onClose, onSave }: { onClose: () => void; onSave: (p: any) => void }) {
  const [name, setName] = useState("");
  const [priceVsMa, setPriceVsMa] = useState<"above" | "below" | "any">("any");
  const [maWindow, setMaWindow] = useState(20);
  const [minTrend5, setMinTrend5] = useState<string>("");
  const [maxTrend5, setMaxTrend5] = useState<string>("");
  const [minGap, setMinGap] = useState<string>("");
  const [maxGap, setMaxGap] = useState<string>("");

  const fieldStyle = {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
    background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
    color: "var(--bb-text)", borderRadius: 2, padding: "5px 8px", width: "100%",
  };
  const labelStyle = {
    fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
    color: "var(--bb-text-faint)", letterSpacing: "0.08em", marginBottom: 3, display: "block" as const,
  };

  function handleSave() {
    if (!name.trim()) return;
    const pattern: any = { name: name.trim() };
    if (priceVsMa !== "any") {
      pattern.priceAboveMa = priceVsMa === "above";
      pattern.priceAboveMaWindow = maWindow;
    }
    if (minTrend5 !== "") pattern.minTrend5 = parseFloat(minTrend5);
    if (maxTrend5 !== "") pattern.maxTrend5 = parseFloat(maxTrend5);
    if (minGap !== "") pattern.minGapPct = parseFloat(minGap);
    if (maxGap !== "") pattern.maxGapPct = parseFloat(maxGap);
    onSave(pattern);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "hsl(220 20% 8%)", border: "1px solid var(--bb-green)",
        borderRadius: 4, padding: 20, width: 400, maxWidth: "90vw",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--bb-green)", letterSpacing: "0.08em" }}>
            DEFINE CUSTOM SETUP
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--bb-text-faint)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>SETUP NAME</label>
            <input style={fieldStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Momentum Breakout" />
          </div>

          <div>
            <label style={labelStyle}>PRICE VS MOVING AVERAGE</label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["any", "above", "below"] as const).map(opt => (
                <button key={opt} onClick={() => setPriceVsMa(opt)} className="font-mono" style={{
                  flex: 1, padding: "5px 0", borderRadius: 2, cursor: "pointer", fontSize: 10,
                  border: priceVsMa === opt ? "1px solid var(--bb-green)" : "1px solid var(--bb-border)",
                  background: priceVsMa === opt ? "rgba(0,212,160,0.12)" : "transparent",
                  color: priceVsMa === opt ? "var(--bb-green)" : "var(--bb-text-dim)",
                }}>{opt.toUpperCase()}</button>
              ))}
            </div>
          </div>

          {priceVsMa !== "any" && (
            <div>
              <label style={labelStyle}>MA PERIOD (DAYS)</label>
              <input type="number" style={fieldStyle} value={maWindow} onChange={e => setMaWindow(parseInt(e.target.value) || 20)} min={5} max={200} />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={labelStyle}>MIN 5-DAY TREND %</label>
              <input type="number" style={fieldStyle} value={minTrend5} onChange={e => setMinTrend5(e.target.value)} placeholder="e.g. 3" />
            </div>
            <div>
              <label style={labelStyle}>MAX 5-DAY TREND %</label>
              <input type="number" style={fieldStyle} value={maxTrend5} onChange={e => setMaxTrend5(e.target.value)} placeholder="e.g. 15" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={labelStyle}>MIN GAP % (DAY OVER DAY)</label>
              <input type="number" style={fieldStyle} value={minGap} onChange={e => setMinGap(e.target.value)} placeholder="e.g. 5" />
            </div>
            <div>
              <label style={labelStyle}>MAX GAP %</label>
              <input type="number" style={fieldStyle} value={maxGap} onChange={e => setMaxGap(e.target.value)} placeholder="e.g. 20" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} className="font-mono" style={{
              flex: 1, padding: "8px 0", borderRadius: 2, cursor: "pointer", fontSize: 10,
              border: "1px solid var(--bb-border)", background: "transparent", color: "var(--bb-text-dim)",
            }}>CANCEL</button>
            <button onClick={handleSave} className="font-mono" style={{
              flex: 2, padding: "8px 0", borderRadius: 2, cursor: "pointer", fontSize: 10,
              border: "1px solid var(--bb-green)", background: "rgba(0,212,160,0.15)", color: "var(--bb-green)", fontWeight: 700,
            }}>SAVE &amp; SCAN</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SetupsTab() {
  const [selectedPattern, setSelectedPattern] = useState<string>("All");
  const [sortBy, setSortBy] = useState<string>("confidence");
  const [showDefine, setShowDefine] = useState(false);
  const [customPatterns, setCustomPatterns] = useState<any[]>([]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/setups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/setups");
      return res.json();
    },
    refetchInterval: 120000,
    staleTime: 60000,
  });

  function handleSavePattern(pattern: any) {
    const updated = [...customPatterns, pattern];
    setCustomPatterns(updated);
    setShowDefine(false);
    queryClient.invalidateQueries({ queryKey: ["/api/setups"] });
  }

  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
          {[...Array(12)].map((_, i) => (
            <div key={i} className="panel">
              <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 65, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 10, width: "80%" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { setups, patternCounts } = data;

  const allPatterns = { ...patternCounts };
  for (const cp of customPatterns) {
    if (!allPatterns[cp.name]) allPatterns[cp.name] = 0;
  }

  const filtered = selectedPattern === "All" ? setups : setups.filter((s: any) => s.pattern === selectedPattern);
  const sorted = [...filtered].sort((a: any, b: any) => {
    if (sortBy === "confidence") return b.confidence - a.confidence;
    if (sortBy === "gapPct") return Math.abs(b.gapPct) - Math.abs(a.gapPct);
    if (sortBy === "volRatio") return b.volRatio - a.volRatio;
    return 0;
  });

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {showDefine && <DefineSetupPanel onClose={() => setShowDefine(false)} onSave={handleSavePattern} />}

      {/* Filter + controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        {/* Pattern filters */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
          {Object.entries(allPatterns).map(([pattern, count]) => {
            const isCustom = customPatterns.some(cp => cp.name === pattern);
            return (
              <button
                key={pattern}
                data-testid={`pattern-${pattern.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setSelectedPattern(pattern)}
                className="font-mono"
                style={{
                  fontSize: 9, padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                  border: selectedPattern === pattern
                    ? `1px solid ${isCustom ? "#a064ff" : "var(--bb-green)"}`
                    : "1px solid var(--bb-border)",
                  background: selectedPattern === pattern
                    ? isCustom ? "rgba(160,100,255,0.1)" : "rgba(0,212,160,0.1)"
                    : "transparent",
                  color: selectedPattern === pattern
                    ? isCustom ? "#a064ff" : "var(--bb-green)"
                    : "var(--bb-text-dim)",
                  fontWeight: selectedPattern === pattern ? 600 : 400,
                }}
              >
                {pattern} <span style={{ opacity: 0.6 }}>({count as number})</span>
                {isCustom && <span style={{ marginLeft: 4, fontSize: 7, color: "#a064ff" }}>★</span>}
              </button>
            );
          })}
        </div>

        {/* Right controls */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            data-testid="setups-sort"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="font-mono"
            style={{
              fontSize: 9, padding: "5px 10px", borderRadius: 2,
              background: "hsl(220 18% 9%)", border: "1px solid var(--bb-border)",
              color: "var(--bb-text)", cursor: "pointer",
            }}
          >
            <option value="confidence">Sort: Confidence</option>
            <option value="gapPct">Sort: Gap %</option>
            <option value="volRatio">Sort: Vol Ratio</option>
          </select>

          <button
            onClick={() => setShowDefine(true)}
            className="font-mono"
            style={{
              fontSize: 9, padding: "5px 12px", borderRadius: 2, cursor: "pointer",
              border: "1px solid var(--bb-green)", background: "rgba(0,212,160,0.1)",
              color: "var(--bb-green)", fontWeight: 600, letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            + DEFINE SETUP
          </button>
        </div>
      </div>

      {/* Custom patterns saved */}
      {customPatterns.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span className="font-mono" style={{ fontSize: 8, color: "var(--bb-text-faint)", letterSpacing: "0.08em" }}>CUSTOM:</span>
          {customPatterns.map((cp, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(160,100,255,0.1)", border: "1px solid rgba(160,100,255,0.3)", borderRadius: 2, padding: "2px 8px" }}>
              <span className="font-mono" style={{ fontSize: 9, color: "#a064ff" }}>{cp.name}</span>
              <button onClick={() => setCustomPatterns(customPatterns.filter((_, i) => i !== idx))}
                style={{ background: "none", border: "none", color: "#ff4d4d", cursor: "pointer", fontSize: 10, padding: "0 0 0 4px" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Setup cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
        {sorted.map((setup: any) => {
          const badge = patternBadgeStyle(setup.pattern);
          const isPositive = setup.gapPct >= 0;
          return (
            <div
              key={setup.id}
              className="panel fade-in"
              style={{ padding: "10px 12px", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--bb-green)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--bb-border)")}
            >
              {/* Header row: ticker + price + confidence score */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--bb-text)" }}>{setup.ticker}</span>
                  <span className="font-mono num" style={{ fontSize: 10, color: "var(--bb-text-dim)", marginLeft: 8 }}>
                    ${setup.price.toFixed(2)}
                  </span>
                </div>
                <span className="font-mono num" style={{ fontSize: 20, fontWeight: 700, color: confidenceColor(setup.confidence) }}>
                  {setup.confidence}
                </span>
              </div>

              {/* Pattern badge */}
              <div style={{ marginBottom: 7 }}>
                <span className="font-mono" style={{
                  fontSize: 8, padding: "2px 8px", borderRadius: 2,
                  background: badge.bg, color: badge.text,
                  fontWeight: 700, letterSpacing: "0.06em",
                }}>
                  {setup.pattern.toUpperCase()}
                </span>
              </div>

              {/* Real sparkline using actual closes */}
              <div style={{ marginBottom: 8 }}>
                <Sparkline closes={setup.closes ?? []} positive={isPositive} />
              </div>

              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                {[
                  { label: "GAP%", value: fmtPct(setup.gapPct, 1), color: isPositive ? "#00d4a0" : "#ff4d4d" },
                  { label: "VOL RATIO", value: `${setup.volRatio}x`, color: setup.volRatio > 2 ? "#00d4a0" : "var(--bb-text-dim)" },
                  { label: "DAYS AGO", value: String(setup.daysAgo), color: "var(--bb-text-dim)" },
                  { label: "GAP HELD", value: setup.gapHeld ? "YES" : "NO", color: setup.gapHeld ? "#00d4a0" : "#ff4d4d" },
                ].map(stat => (
                  <div key={stat.label} style={{ textAlign: "center" }}>
                    <div className="font-mono" style={{ fontSize: 7, color: "var(--bb-text-faint)", letterSpacing: "0.08em", marginBottom: 2 }}>{stat.label}</div>
                    <div className="font-mono num" style={{ fontSize: 10, fontWeight: 600, color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div className="panel" style={{ gridColumn: "1/-1", textAlign: "center", padding: 40 }}>
            <span className="font-mono" style={{ color: "var(--bb-text-faint)", fontSize: 12 }}>
              No setups match the selected filter
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
