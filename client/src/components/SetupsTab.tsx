import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(decimals)}%`;
}

function patternBadgeColor(pattern: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    "Bull Flag": { bg: "rgba(0,212,160,0.15)", text: "#00d4a0" },
    "Bear Flag": { bg: "rgba(255,77,77,0.15)", text: "#ff4d4d" },
    "Power Earnings Gap": { bg: "rgba(77,166,255,0.15)", text: "#4da6ff" },
    "Earnings Failure Gap": { bg: "rgba(255,165,0,0.15)", text: "#ffa500" },
    "Flat Base Breakout": { bg: "rgba(0,212,160,0.12)", text: "#00d4a0" },
    "High Tight Flag": { bg: "rgba(160,100,255,0.15)", text: "#a064ff" },
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

export default function SetupsTab() {
  const [selectedPattern, setSelectedPattern] = useState<string>("All");
  const [sortBy, setSortBy] = useState<string>("confidence");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/setups"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/setups");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {[...Array(12)].map((_, i) => (
            <div key={i} className="panel">
              <div className="skeleton" style={{ height: 14, width: "50%", marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 80, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 10, width: "80%" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { setups, patternCounts } = data;

  const filtered = selectedPattern === "All" ? setups : setups.filter((s: any) => s.pattern === selectedPattern);
  const sorted = [...filtered].sort((a: any, b: any) => {
    if (sortBy === "confidence") return b.confidence - a.confidence;
    if (sortBy === "gapPct") return Math.abs(b.gapPct) - Math.abs(a.gapPct);
    if (sortBy === "volRatio") return b.volRatio - a.volRatio;
    return 0;
  });

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Filter bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Pattern type selector */}
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {Object.entries(patternCounts).map(([pattern, count]) => (
            <button
              key={pattern}
              data-testid={`pattern-${pattern.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setSelectedPattern(pattern)}
              className="font-mono"
              style={{
                fontSize: 9, padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                border: selectedPattern === pattern ? "1px solid var(--bb-green)" : "1px solid var(--bb-border)",
                background: selectedPattern === pattern ? "rgba(0,212,160,0.1)" : "transparent",
                color: selectedPattern === pattern ? "var(--bb-green)" : "var(--bb-text-dim)",
                fontWeight: selectedPattern === pattern ? 600 : 400,
              }}
            >
              {pattern} <span style={{ opacity: 0.6 }}>({count as number})</span>
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
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
      </div>

      {/* Setup cards grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
        {sorted.map((setup: any) => {
          const badge = patternBadgeColor(setup.pattern);
          return (
            <div key={setup.id} className="panel fade-in" style={{ padding: "10px 12px", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--bb-green)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--bb-border)")}
            >
              {/* Header: ticker + pattern + confidence */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--bb-text)" }}>{setup.ticker}</span>
                  <span className="font-mono num" style={{ fontSize: 10, color: "var(--bb-text-dim)", marginLeft: 8 }}>${setup.price.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                  <span className="font-mono num" style={{ fontSize: 18, fontWeight: 700, color: confidenceColor(setup.confidence) }}>
                    {setup.confidence}
                  </span>
                </div>
              </div>

              {/* Pattern badge */}
              <div style={{ marginBottom: 8 }}>
                <span className="font-mono" style={{ fontSize: 8, padding: "2px 8px", borderRadius: 2, background: badge.bg, color: badge.text, fontWeight: 600, letterSpacing: "0.06em" }}>
                  {setup.pattern.toUpperCase()}
                </span>
              </div>

              {/* Mini candlestick placeholder (colored gradient bar) */}
              <div style={{
                height: 60, marginBottom: 8, borderRadius: 2, overflow: "hidden",
                background: `linear-gradient(90deg, hsl(220 15% 12%), hsl(220 15% 14%), hsl(220 15% 11%))`,
                position: "relative",
              }}>
                {/* Simulated price action line */}
                <svg width="100%" height="100%" viewBox="0 0 200 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                  <path
                    d={`M0,${30 + Math.random() * 10} ${Array.from({ length: 20 }, (_, i) =>
                      `L${(i + 1) * 10},${15 + Math.random() * 30}`
                    ).join(" ")}`}
                    fill="none"
                    stroke={setup.gapPct >= 0 ? "#00d4a088" : "#ff4d4d88"}
                    strokeWidth="1.5"
                  />
                </svg>
              </div>

              {/* Stats row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                {[
                  { label: "GAP%", value: fmtPct(setup.gapPct, 1), color: setup.gapPct >= 0 ? "#00d4a0" : "#ff4d4d" },
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
      </div>
    </div>
  );
}
