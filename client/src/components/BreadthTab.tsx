import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

type CellData = { value: string | number; color: "green" | "red" | "neutral" };

function Cell({ cell, size = 11 }: { cell: CellData; size?: number }) {
  const isNeutral = cell.color === "neutral";
  const bg = isNeutral
    ? "transparent"
    : cell.color === "green"
    ? "rgba(0,180,0,0.75)"
    : "rgba(180,0,0,0.75)";
  const textColor = isNeutral ? "var(--bb-text-dim)" : "#fff";

  return (
    <td
      style={{
        background: bg,
        color: textColor,
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: size,
        fontWeight: 600,
        textAlign: "center",
        padding: "5px 6px",
        border: "1px solid hsl(220 15% 10%)",
        whiteSpace: "nowrap",
        minWidth: 44,
      }}
    >
      {cell.value}
    </td>
  );
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
          {[...Array(15)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 28, marginBottom: 3 }} />
          ))}
        </div>
      </div>
    );
  }

  const { rows, headerSummary } = data;

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Advance/Decline summary bar — matches reference top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "8px 14px",
          background: "hsl(220 18% 9%)",
          borderRadius: 3,
          border: "1px solid var(--bb-border)",
          flexWrap: "wrap",
        }}
      >
        {[
          {
            label: "Advancing",
            value: headerSummary.advancing,
            pct: headerSummary.advancingPct,
            color: "#00d4a0",
            barColor: "#00d4a0",
          },
          {
            label: "Declining",
            value: headerSummary.declining,
            pct: headerSummary.decliningPct,
            color: "#ff4d4d",
            barColor: "#ff4d4d",
          },
          {
            label: "New High",
            value: headerSummary.newHigh,
            pct: headerSummary.newHighPct,
            color: "#4da6ff",
            barColor: "#4da6ff",
          },
          {
            label: "New Low",
            value: headerSummary.newLow,
            pct: headerSummary.newLowPct,
            color: "#ffa500",
            barColor: "#ffa500",
          },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="font-mono"
              style={{ fontSize: 10, fontWeight: 600, color: item.color }}
            >
              {item.label}
            </span>
            <div
              style={{
                width: 80,
                height: 6,
                background: "hsl(220 15% 15%)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, parseFloat(item.pct))}%`,
                  height: "100%",
                  background: item.barColor,
                  borderRadius: 3,
                }}
              />
            </div>
            <span className="font-mono num" style={{ fontSize: 10, color: item.color }}>
              {item.pct}% ({item.value.toLocaleString()})
            </span>
          </div>
        ))}
      </div>

      {/* Main heatmap table */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 220px)" }}>
        <table
          style={{
            borderCollapse: "collapse",
            minWidth: "100%",
            fontSize: 11,
          }}
        >
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            {/* Group header row */}
            <tr>
              <th
                rowSpan={2}
                style={{
                  background: "#c8a800",
                  color: "#000",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "6px 10px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "left",
                  verticalAlign: "bottom",
                  minWidth: 90,
                }}
              >
                Date
              </th>
              <th
                colSpan={4}
                style={{
                  background: "#c8a800",
                  color: "#000",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "6px 10px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "center",
                }}
              >
                Primary Breadth Indicators
              </th>
              <th
                colSpan={8}
                style={{
                  background: "#1a6b1a",
                  color: "#fff",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "6px 10px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "center",
                }}
              >
                Secondary Breadth Indicators
              </th>
              <th
                style={{
                  background: "#7b3db5",
                  color: "#fff",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "6px 6px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "center",
                  minWidth: 55,
                }}
              >
                10x ATR Ext.
              </th>
              <th
                style={{
                  background: "#4a7fc1",
                  color: "#fff",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "6px 6px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "center",
                  minWidth: 55,
                }}
              >
                &gt;50dma
              </th>
              <th
                style={{
                  background: "#c8a800",
                  color: "#000",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "6px 6px",
                  border: "1px solid hsl(220 15% 10%)",
                  textAlign: "center",
                  minWidth: 60,
                }}
              >
                Stock Universe
              </th>
            </tr>
            {/* Sub-header row */}
            <tr>
              {[
                { label: "Stocks Up 4%+ Today", bg: "#c8a800", tc: "#000" },
                { label: "Stocks Down 4%+ Today", bg: "#c8a800", tc: "#000" },
                { label: "5 Day Ratio", bg: "#c8a800", tc: "#000" },
                { label: "10 Day Ratio", bg: "#c8a800", tc: "#000" },
                { label: "Up 25%+ Quarter", bg: "#1a6b1a", tc: "#fff" },
                { label: "Down 25%+ Quarter", bg: "#1a6b1a", tc: "#fff" },
                { label: "Up 25%+ Month", bg: "#1a6b1a", tc: "#fff" },
                { label: "Down 25%+ Month", bg: "#1a6b1a", tc: "#fff" },
                { label: "Up 50%+ Month", bg: "#1a6b1a", tc: "#fff" },
                { label: "Down 50%+ Month", bg: "#1a6b1a", tc: "#fff" },
                { label: "Up 13%+ 34 Days", bg: "#1a6b1a", tc: "#fff" },
                { label: "Down 13%+ 34 Days", bg: "#1a6b1a", tc: "#fff" },
              ].map((h) => (
                <th
                  key={h.label}
                  style={{
                    background: h.bg,
                    color: h.tc,
                    fontFamily: "IBM Plex Mono, monospace",
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "4px 5px",
                    border: "1px solid hsl(220 15% 10%)",
                    textAlign: "center",
                    minWidth: 50,
                    lineHeight: 1.3,
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, i: number) => {
              const isToday = i === 0;
              return (
                <tr
                  key={row.date}
                  style={{
                    background: isToday ? "hsl(220 18% 11%)" : "transparent",
                  }}
                >
                  {/* Date cell */}
                  <td
                    style={{
                      fontFamily: "IBM Plex Mono, monospace",
                      fontSize: 11,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "var(--bb-green)" : "var(--bb-text-dim)",
                      padding: "5px 10px",
                      border: "1px solid hsl(220 15% 10%)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.date}
                  </td>
                  <Cell cell={row.stocksUp4Today} />
                  <Cell cell={row.stocksDown4Today} />
                  <Cell cell={row.fiveDayRatio} />
                  <Cell cell={row.tenDayRatio} />
                  <Cell cell={row.up25Quarter} />
                  <Cell cell={row.down25Quarter} />
                  <Cell cell={row.up25Month} />
                  <Cell cell={row.down25Month} />
                  <Cell cell={row.up50Month} />
                  <Cell cell={row.down50Month} />
                  <Cell cell={row.up13_34days} />
                  <Cell cell={row.down13_34days} />
                  <Cell cell={row.tenxAtrExt} />
                  <Cell cell={row.above50dma} />
                  <Cell cell={row.stockUniverse} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
