import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

function cellColor(color: string): string {
  return color === "green" ? "#00d4a0" : "#ff4d4d";
}

function cellBg(color: string): string {
  return color === "green" ? "rgba(0,212,160,0.08)" : "rgba(255,77,77,0.08)";
}

export default function BreadthTab() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/breadth"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/breadth");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 12 }}>
        <div className="panel">
          {[...Array(12)].map((_, i) => <div key={i} className="skeleton" style={{ height: 28, marginBottom: 4 }} />)}
        </div>
      </div>
    );
  }

  const { breadthMatrix } = data;
  const { primary, secondary, summary } = breadthMatrix;

  const primaryRows = [
    { label: "Stocks Up 4%+ Today", ...primary.stocksUp4Today },
    { label: "Stocks Down 4%+ Today", ...primary.stocksDown4Today },
    { label: "5-Day Up/Down Ratio", ...primary.fiveDayRatio },
    { label: "10-Day Up/Down Ratio", ...primary.tenDayRatio },
  ];

  const secondaryRows = [
    { label: "Up 25%+ Quarter", ...secondary.up25Quarter },
    { label: "Down 25%+ Quarter", ...secondary.down25Quarter },
    { label: "Up 25%+ Month", ...secondary.up25Month },
    { label: "Down 25%+ Month", ...secondary.down25Month },
    { label: "Up 50%+ Month", ...secondary.up50Month },
    { label: "Down 50%+ Month", ...secondary.down50Month },
    { label: "Up 13%+ 34 Days", ...secondary.up13_34days },
    { label: "Down 13%+ 34 Days", ...secondary.down13_34days },
  ];

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Summary bar */}
      <div style={{ display: "flex", gap: 10 }}>
        <div className="panel" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
          <div className="panel-label">10x ATR EXTENSIONS</div>
          <div className="font-mono num" style={{ fontSize: 28, fontWeight: 700, color: summary.tenxAtrExt > 5 ? "#ff4d4d" : "#00d4a0" }}>{summary.tenxAtrExt}</div>
        </div>
        <div className="panel" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
          <div className="panel-label">&gt;50 DMA</div>
          <div className="font-mono num" style={{ fontSize: 28, fontWeight: 700, color: summary.above50dma > 50 ? "#00d4a0" : "#ff4d4d" }}>{summary.above50dma}%</div>
        </div>
        <div className="panel" style={{ flex: 1, textAlign: "center", padding: "12px 16px" }}>
          <div className="panel-label">STOCK UNIVERSE</div>
          <div className="font-mono num" style={{ fontSize: 28, fontWeight: 700, color: "var(--bb-text)" }}>{summary.stockUniverse.toLocaleString()}</div>
        </div>
      </div>

      {/* Primary Breadth Indicators */}
      <div className="panel">
        <div className="panel-label" style={{ marginBottom: 10 }}>PRIMARY BREADTH INDICATORS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
          {primaryRows.map((row, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", borderBottom: "1px solid hsl(220 15% 11%)",
              background: cellBg(row.color),
            }}>
              <span className="font-mono" style={{ fontSize: 11, color: "var(--bb-text)" }}>{row.label}</span>
              <span className="font-mono num" style={{ fontSize: 16, fontWeight: 700, color: cellColor(row.color) }}>
                {typeof row.value === "number" && row.value % 1 !== 0 ? row.value.toFixed(1) : row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary Breadth Indicators */}
      <div className="panel">
        <div className="panel-label" style={{ marginBottom: 10 }}>SECONDARY BREADTH INDICATORS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          {secondaryRows.map((row, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px",
              borderBottom: "1px solid hsl(220 15% 11%)",
              borderRight: i % 2 === 0 ? "1px solid hsl(220 15% 11%)" : "none",
              background: cellBg(row.color),
            }}>
              <span className="font-mono" style={{ fontSize: 10, color: "var(--bb-text-dim)" }}>{row.label}</span>
              <span className="font-mono num" style={{ fontSize: 14, fontWeight: 700, color: cellColor(row.color) }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
