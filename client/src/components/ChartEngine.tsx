import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown, ChevronRight, RefreshCw, Download, BarChart2,
  Activity, TrendingUp, Globe, Layers
} from "lucide-react";
import {
  createChart, LineSeries, HistogramSeries, AreaSeries,
  LineStyle, ColorType,
} from "lightweight-charts";

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
  bg: "#060b14",
  grid: "#0d1f35",
  text: "#94a3b8",
  textDim: "#4a5568",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#eab308",
  blue: "#38bdf8",
  purple: "#a78bfa",
  orange: "#f97316",
  border: "#132035",
  panelBg: "#08111e",
  accent: "#00d4a0",
  priceLine: "#d1d5db",   // thin light line for top price pane
};

// ─── Base chart options ───────────────────────────────────────────────────────
function makeChartOpts(height: number) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: C.panelBg },
      textColor: C.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: C.grid, style: LineStyle.Dotted },
      horzLines: { color: C.grid, style: LineStyle.Dotted },
    },
    crosshair: { vertLine: { color: "#38bdf850" }, horzLine: { color: "#38bdf850" } },
    rightPriceScale: { borderColor: C.border, textColor: C.text },
    leftPriceScale: { visible: false, borderColor: C.border },
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
    handleScroll: true,
    handleScale: true,
    width: 0, // set dynamically
    height,
  };
}

// ─── Timeframe filter ─────────────────────────────────────────────────────────
type TF = "1Y" | "2Y" | "5Y" | "10Y";
const TF_DAYS: Record<TF, number> = { "1Y": 365, "2Y": 730, "5Y": 1825, "10Y": 3650 };

function filterByTF(data: any[], tf: TF): any[] {
  if (!data?.length) return [];
  const cutoff = Date.now() - TF_DAYS[tf] * 86400 * 1000;
  return data.filter((d: any) => {
    const dateStr = d.date ?? d.time;
    if (!dateStr) return false;
    return new Date(dateStr).getTime() >= cutoff;
  });
}

// ─── Chart Definitions ────────────────────────────────────────────────────────
interface ChartDef {
  id: string;
  label: string;
  desc: string;
  category: string;
  endpoint: string;
  /** Does the chart use split-panel (price top / indicator bottom)? */
  splitPanel?: boolean;
  /** Ticker for the price pane in split-panel mode */
  priceTicker?: string;
  renderType: "line" | "histogram" | "multi-line" | "area" | "scatter" | "split-histogram" | "split-line" | "split-area" | "spy-volume" | "sentiment";
  tickers?: string[];
  defaultTicker?: string;
  notes?: string;
}

const CHARTS: ChartDef[] = [
  // ── BREADTH ─────────────────────────────────────────────────────────────────
  {
    id: "1A", label: "% Above MA", desc: "% of S&P sectors above 20/50/200-day MAs",
    category: "breadth", endpoint: "/api/charts/breadth/pct_above_ma",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "1B", label: "McClellan Osc", desc: "Breadth momentum oscillator (19/39 EMA of A-D spread)",
    category: "breadth", endpoint: "/api/charts/breadth/mcclellan",
    splitPanel: true, priceTicker: "SPY", renderType: "split-histogram",
  },
  {
    id: "1C", label: "RSI Breadth", desc: "Median RSI across S&P sectors",
    category: "breadth", endpoint: "/api/charts/breadth/rsi_breadth",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "1D", label: "MACD Breadth", desc: "% of sectors with MACD above signal line",
    category: "breadth", endpoint: "/api/charts/breadth/macd_breadth",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "1E", label: "Zweig Thrust", desc: "Zweig Breadth Thrust oscillator (10-day EMA A-D ratio)",
    category: "breadth", endpoint: "/api/charts/breadth/zweig",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "1F", label: "A-D Line", desc: "Advance-Decline cumulative line",
    category: "breadth", endpoint: "/api/charts/breadth/ad_line",
    splitPanel: true, priceTicker: "SPY", renderType: "split-area",
  },

  // ── SENTIMENT / POSITIONING ─────────────────────────────────────────────────
  {
    id: "2A", label: "ES Positioning", desc: "E-Mini S&P 500 COT: Large Spec / Asset Mgr / Dealer net",
    category: "sentiment", endpoint: "/api/charts/cot/ES",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "2B", label: "NQ Positioning", desc: "E-Mini Nasdaq COT: Large Spec / Asset Mgr / Dealer net",
    category: "sentiment", endpoint: "/api/charts/cot/NQ",
    splitPanel: true, priceTicker: "QQQ", renderType: "split-line",
  },
  {
    id: "2C", label: "RTY Positioning", desc: "E-Mini Russell 2000 COT",
    category: "sentiment", endpoint: "/api/charts/cot/RTY",
    splitPanel: true, priceTicker: "IWM", renderType: "split-line",
  },
  {
    id: "2D", label: "VIX Futures Pos.", desc: "VIX Futures COT: Large Spec Net (sentiment gauge)",
    category: "sentiment", endpoint: "/api/charts/cot/VI",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "2E", label: "CTA Model", desc: "Estimated CTA trend-following exposure (SPY-based)",
    category: "sentiment", endpoint: "/api/charts/cta",
    splitPanel: true, priceTicker: "SPY", renderType: "split-area",
  },
  {
    id: "2F", label: "Put/Call Proxy", desc: "DSI proxy: short-term RSI smoothed as P/C surrogate",
    category: "sentiment", endpoint: "/api/charts/dsi/SPY",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "2G", label: "Speculative Vol", desc: "VIX vs 20d SMA — speculative options activity proxy",
    category: "sentiment", endpoint: "/api/charts/spec-vol",
    splitPanel: true, priceTicker: "SPY", renderType: "sentiment",
  },
  {
    id: "2H", label: "Sentiment Composite", desc: "VIX percentile + credit spreads → market fear/greed score",
    category: "sentiment", endpoint: "/api/charts/sentiment",
    splitPanel: true, priceTicker: "SPY", renderType: "sentiment",
  },

  // ── MACRO / LIQUIDITY ───────────────────────────────────────────────────────
  {
    id: "3A", label: "Liquidity Composite", desc: "6-series FRED liquidity composite (M2, repo, Fed BS, credit...)",
    category: "macro", endpoint: "/api/charts/liquidity",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "3B", label: "Yield Curve", desc: "10Y-2Y and 10Y-3M spreads (FRED)",
    category: "macro", endpoint: "/api/charts/yield-curve",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "3C", label: "Credit Spreads", desc: "HY OAS and BBB OAS (FRED — ICE BofA)",
    category: "macro", endpoint: "/api/charts/credit-spreads",
    splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "3D", label: "Fed Balance Sheet", desc: "Fed total assets ($B) vs SPY price",
    category: "macro", endpoint: "/api/charts/fed-balance-sheet",
    renderType: "multi-line",
  },
  {
    id: "3E", label: "Sector Rotation", desc: "Momentum vs relative strength scatter — 11 SPDR ETFs",
    category: "macro", endpoint: "/api/charts/sector-rotation",
    renderType: "scatter",
  },
  {
    id: "3F", label: "XLE/SPY Ratio", desc: "Energy vs broad market ratio",
    category: "macro", endpoint: "/api/charts/ratio/XLE/SPY",
    splitPanel: true, priceTicker: "SPY", renderType: "split-area",
  },

  // ── TECHNICAL ───────────────────────────────────────────────────────────────
  {
    id: "4A", label: "Trend Power Osc", desc: "SMA slope × RSI z-score composite",
    category: "technical",
    tickers: ["SPY", "QQQ", "IWM", "DIA", "GLD", "TLT", "XLE", "XLF"], defaultTicker: "SPY",
    endpoint: "/api/charts/tpo/SPY", splitPanel: true, priceTicker: "SPY", renderType: "split-histogram",
  },
  {
    id: "4B", label: "Daily Sentiment", desc: "DSI proxy: 5-day RSI smoothed 3-day EMA",
    category: "technical",
    tickers: ["SPY", "QQQ", "IWM", "GLD", "TLT", "BTC-USD"], defaultTicker: "SPY",
    endpoint: "/api/charts/dsi/SPY", splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "4C", label: "SPY Volume", desc: "SPY price (top) + daily volume histogram with 20d avg line",
    category: "technical", endpoint: "/api/charts/spy-volume",
    renderType: "spy-volume",
  },
  {
    id: "4D", label: "ATR Extension", desc: "Price % extended beyond N-ATR bands from SMA20",
    category: "technical",
    tickers: ["SPY", "QQQ", "IWM", "AAPL", "TSLA", "NVDA", "GLD", "TLT"], defaultTicker: "SPY",
    endpoint: "/api/charts/atr-ext/SPY", splitPanel: true, priceTicker: "SPY", renderType: "split-line",
  },
  {
    id: "4E", label: "Rel Strength", desc: "Ticker vs SPY relative strength ratio",
    category: "technical",
    tickers: ["QQQ", "IWM", "XLE", "XLF", "XLK", "GLD", "TLT", "AAPL", "NVDA"], defaultTicker: "QQQ",
    endpoint: "/api/charts/ratio/QQQ/SPY", splitPanel: true, priceTicker: "SPY", renderType: "split-area",
  },
];

const CATEGORIES = [
  { id: "breadth", label: "Breadth", icon: BarChart2, color: C.green },
  { id: "sentiment", label: "Sentiment & Positioning", icon: Activity, color: C.amber },
  { id: "macro", label: "Macro & Liquidity", icon: Globe, color: C.blue },
  { id: "technical", label: "Technical / Price Action", icon: TrendingUp, color: C.purple },
];

// ─── Helper: add a horizontal price line to a series ─────────────────────────
function addHLine(series: any, value: number, color: string, title: string) {
  try {
    series.createPriceLine({
      price: value,
      color: `${color}99`,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title,
    });
  } catch { /* ignore */ }
}

// ─── Helper: toLineData ───────────────────────────────────────────────────────
function toLineData(arr: any[], dateKey = "date", valueKey = "value") {
  return arr
    .filter((d: any) => d[dateKey] && d[valueKey] != null && !isNaN(Number(d[valueKey])))
    .map((d: any) => ({ time: d[dateKey] as any, value: Number(d[valueKey]) }));
}

// ─── Sector Rotation Scatter (SVG) ───────────────────────────────────────────
function SectorRotationChart({ data }: { data: any }) {
  if (!data?.length) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.textDim, fontFamily: "IBM Plex Mono", fontSize: 11 }}>
      NO DATA
    </div>
  );

  const w = 600, h = 440, pad = 50;
  const rs: number[] = data.map((d: any) => d.rs ?? 0);
  const mom: number[] = data.map((d: any) => d.momentum ?? 0);
  const minX = Math.min(...rs), maxX = Math.max(...rs);
  const minY = Math.min(...mom), maxY = Math.max(...mom);

  const xScale = (v: number) => pad + ((v - minX) / (maxX - minX + 0.001)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - minY) / (maxY - minY + 0.001)) * (h - pad * 2);

  const midX = xScale((minX + maxX) / 2);
  const midY = yScale((minY + maxY) / 2);

  const quadrantColor = (cx: number, cy: number) => {
    if (cx > midX && cy < midY) return C.green;
    if (cx > midX && cy > midY) return C.amber;
    if (cx < midX && cy > midY) return C.red;
    return C.blue;
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: C.panelBg, maxHeight: 440 }}>
        <line x1={midX} y1={pad} x2={midX} y2={h - pad} stroke={C.grid} strokeWidth="1" strokeDasharray="4,4" />
        <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke={C.grid} strokeWidth="1" strokeDasharray="4,4" />
        <text x={w - pad - 4} y={pad + 14} fill={C.green} fontSize="10" textAnchor="end" fontFamily="IBM Plex Mono">LEADING</text>
        <text x={w - pad - 4} y={h - pad - 6} fill={C.amber} fontSize="10" textAnchor="end" fontFamily="IBM Plex Mono">WEAKENING</text>
        <text x={pad + 4} y={h - pad - 6} fill={C.red} fontSize="10" fontFamily="IBM Plex Mono">LAGGING</text>
        <text x={pad + 4} y={pad + 14} fill={C.blue} fontSize="10" fontFamily="IBM Plex Mono">IMPROVING</text>
        <text x={w / 2} y={h - 8} fill={C.text} fontSize="10" textAnchor="middle" fontFamily="IBM Plex Mono">Relative Strength →</text>
        <text x={12} y={h / 2} fill={C.text} fontSize="10" textAnchor="middle" fontFamily="IBM Plex Mono" transform={`rotate(-90,12,${h / 2})`}>Momentum →</text>
        {data.map((d: any, i: number) => {
          const cx = xScale(d.rs ?? 0);
          const cy = yScale(d.momentum ?? 0);
          const clr = quadrantColor(cx, cy);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={18} fill={`${clr}22`} stroke={clr} strokeWidth="1.5" />
              <text x={cx} y={cy + 4} fill={clr} fontSize="9" textAnchor="middle" fontFamily="IBM Plex Mono" fontWeight="600">{d.symbol}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Split Panel Chart (macrocharts.com style) ───────────────────────────────
// Top pane: SPY/index price line (thin, light)
// Bottom pane: indicator (bold colored line or histogram + gray daily bars behind)
interface SplitPanelProps {
  containerRef: React.RefObject<HTMLDivElement>;
  priceData: any[] | null;
  indicatorData: any;
  def: ChartDef;
  tf: TF;
  activeTicker: string;
}

function useSplitPanelChart({
  containerRef, priceData, indicatorData, def, tf, activeTicker,
}: SplitPanelProps) {
  useEffect(() => {
    if (!containerRef.current || !indicatorData) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const totalH = container.clientHeight || 520;
    const topH = Math.round(totalH * 0.35);
    const botH = totalH - topH;

    // ── Top pane: price
    const topEl = document.createElement("div");
    topEl.style.cssText = `width:100%;height:${topH}px;`;
    container.appendChild(topEl);

    const topChart = createChart(topEl, {
      ...makeChartOpts(topH),
      width: container.clientWidth,
      rightPriceScale: { borderColor: C.border, textColor: C.text },
      timeScale: { borderColor: C.border, visible: false },
    });

    if (priceData?.length) {
      const filtered = filterByTF(priceData, tf);
      const priceSeries = topChart.addSeries(LineSeries, {
        color: C.priceLine,
        lineWidth: 1,
        title: activeTicker,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      priceSeries.setData(
        filtered
          .filter((b: any) => b.date && b.close != null)
          .map((b: any) => ({ time: b.date as any, value: b.close }))
      );
    }

    // Divider
    const divider = document.createElement("div");
    divider.style.cssText = `width:100%;height:1px;background:${C.border};`;
    container.appendChild(divider);

    // ── Bottom pane: indicator
    const botEl = document.createElement("div");
    botEl.style.cssText = `width:100%;height:${botH - 1}px;`;
    container.appendChild(botEl);

    const botChart = createChart(botEl, {
      ...makeChartOpts(botH - 1),
      width: container.clientWidth,
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
    });

    const filtered = Array.isArray(indicatorData) ? filterByTF(indicatorData, tf) : indicatorData;

    try {
      renderIndicatorPane(botChart, def, filtered, tf);
    } catch (e) {
      console.warn("Indicator pane error:", def.id, e);
    }

    // Sync time scales
    topChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) botChart.timeScale().setVisibleLogicalRange(range);
    });
    botChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) topChart.timeScale().setVisibleLogicalRange(range);
    });

    // Fit both
    topChart.timeScale().fitContent();
    botChart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      topChart.applyOptions({ width: w });
      botChart.applyOptions({ width: w });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      topChart.remove();
      botChart.remove();
    };
  }, [priceData, indicatorData, tf, activeTicker]); // eslint-disable-line
}

// ─── Indicator pane renderer ─────────────────────────────────────────────────
function renderIndicatorPane(chart: any, def: ChartDef, data: any, tf: TF) {
  if (!data) return;

  switch (def.id) {
    // ── BREADTH ──────────────────────────────────────────────────────────────
    case "1A": {
      // pct_above_ma: { date, pct20, pct50, pct200 }[]
      const raw = Array.isArray(data) ? data : [];
      const s20 = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "% >20d" });
      const s50 = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "% >50d" });
      const s200 = chart.addSeries(LineSeries, { color: C.red, lineWidth: 2, title: "% >200d" });
      s20.setData(raw.filter((d: any) => d.pct20 != null).map((d: any) => ({ time: d.date, value: d.pct20 })));
      s50.setData(raw.filter((d: any) => d.pct50 != null).map((d: any) => ({ time: d.date, value: d.pct50 })));
      s200.setData(raw.filter((d: any) => d.pct200 != null).map((d: any) => ({ time: d.date, value: d.pct200 })));
      addHLine(s20, 80, C.red, "OB 80");
      addHLine(s20, 20, C.green, "OS 20");
      addHLine(s20, 50, C.textDim, "50");
      break;
    }
    case "1B": {
      // mcclellan: { date, value }[]
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(HistogramSeries, { title: "McClellan" });
      s.setData(raw.filter((d: any) => d.value != null).map((d: any) => ({
        time: d.date, value: d.value,
        color: d.value >= 0 ? `${C.green}cc` : `${C.red}cc`,
      })));
      addHLine(s, 0, C.textDim, "0");
      break;
    }
    case "1C": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: "Median RSI" });
      s.setData(toLineData(raw));
      addHLine(s, 70, C.red, "OB 70");
      addHLine(s, 30, C.green, "OS 30");
      addHLine(s, 50, C.textDim, "50");
      break;
    }
    case "1D": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "% MACD Bullish" });
      s.setData(toLineData(raw));
      addHLine(s, 50, C.textDim, "50%");
      break;
    }
    case "1E": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(LineSeries, { color: C.accent, lineWidth: 2, title: "Zweig Thrust" });
      s.setData(toLineData(raw));
      addHLine(s, 0.615, C.green, "Thrust 0.615");
      addHLine(s, 0.4, C.red, "Bear 0.4");
      addHLine(s, 0.5, C.textDim, "0.5");
      break;
    }
    case "1F": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.green, topColor: `${C.green}44`, bottomColor: `${C.green}00`, lineWidth: 2, title: "A-D Line" });
      s.setData(toLineData(raw));
      break;
    }

    // ── COT POSITIONING ───────────────────────────────────────────────────────
    case "2A": case "2B": case "2C": case "2D": {
      const raw = Array.isArray(data) ? data : [];
      const sLarge = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "Large Spec Net" });
      const sAsset = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 1, title: "Asset Mgr Net" });
      const sDealer = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 1, title: "Dealer Net" });
      sLarge.setData(raw.filter((d: any) => d.largeSpecNet != null).map((d: any) => ({ time: d.date, value: d.largeSpecNet })));
      sAsset.setData(raw.filter((d: any) => d.assetMgrNet != null).map((d: any) => ({ time: d.date, value: d.assetMgrNet })));
      sDealer.setData(raw.filter((d: any) => d.dealerNet != null).map((d: any) => ({ time: d.date, value: d.dealerNet })));
      addHLine(sLarge, 0, C.textDim, "0");
      break;
    }

    // ── SENTIMENT ─────────────────────────────────────────────────────────────
    case "2E": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}44`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "CTA Exposure" });
      s.setData(toLineData(raw));
      addHLine(s, 0, C.textDim, "0");
      addHLine(s, 50, C.red, "Max Long 50");
      addHLine(s, -50, C.green, "Max Short -50");
      break;
    }
    case "2F": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "P/C Proxy" });
      s.setData(toLineData(raw));
      addHLine(s, 80, C.red, "Extreme Bull 80");
      addHLine(s, 20, C.green, "Extreme Bear 20");
      addHLine(s, 50, C.textDim, "Neutral 50");
      break;
    }
    case "2G": {
      // VIX vs SMA20 — spec vol proxy
      const raw = Array.isArray(data) ? data : [];
      const sVix = chart.addSeries(LineSeries, { color: C.red, lineWidth: 2, title: "VIX" });
      const sSMA = chart.addSeries(LineSeries, { color: `${C.textDim}`, lineWidth: 1, title: "VIX 20d SMA" });
      sVix.setData(raw.filter((d: any) => d.value != null).map((d: any) => ({ time: d.date, value: d.value })));
      sSMA.setData(raw.filter((d: any) => d.vixSMA20 != null).map((d: any) => ({ time: d.date, value: d.vixSMA20 })));
      addHLine(sVix, 20, C.textDim, "20");
      addHLine(sVix, 30, C.amber, "30");
      addHLine(sVix, 40, C.red, "40");
      break;
    }
    case "2H": {
      // Sentiment composite: value 0-100
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.accent, topColor: `${C.accent}44`, bottomColor: `${C.accent}00`, lineWidth: 2, title: "Sentiment" });
      s.setData(raw.filter((d: any) => d.value != null).map((d: any) => ({ time: d.date, value: d.value })));
      addHLine(s, 80, C.red, "Extreme Bull 80");
      addHLine(s, 20, C.green, "Extreme Bear 20");
      addHLine(s, 50, C.textDim, "Neutral 50");
      break;
    }

    // ── MACRO ─────────────────────────────────────────────────────────────────
    case "3A": {
      const raw = Array.isArray(data) ? data : [];
      const sComp = chart.addSeries(LineSeries, { color: C.accent, lineWidth: 2, title: "Composite" });
      sComp.setData(raw.filter((d: any) => d.composite != null).map((d: any) => ({ time: d.date, value: d.composite })));
      const sM2 = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 1, title: "M2" });
      sM2.setData(raw.filter((d: any) => d.m2 != null).map((d: any) => ({ time: d.date, value: d.m2 })));
      const sRRP = chart.addSeries(LineSeries, { color: `${C.amber}99`, lineWidth: 1, title: "RRP" });
      sRRP.setData(raw.filter((d: any) => d.rrp != null).map((d: any) => ({ time: d.date, value: d.rrp })));
      break;
    }
    case "3B": {
      const raw = Array.isArray(data) ? data : [];
      const s1 = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "10Y-2Y" });
      const s2 = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: "10Y-3M" });
      s1.setData(raw.filter((d: any) => d.t10y2y != null).map((d: any) => ({ time: d.date, value: d.t10y2y })));
      s2.setData(raw.filter((d: any) => d.t10y3m != null).map((d: any) => ({ time: d.date, value: d.t10y3m })));
      addHLine(s1, 0, C.red, "Inversion 0");
      break;
    }
    case "3C": {
      const raw = Array.isArray(data) ? data : [];
      const sHY = chart.addSeries(LineSeries, { color: C.red, lineWidth: 2, title: "HY OAS" });
      const sBBB = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "BBB OAS" });
      sHY.setData(raw.filter((d: any) => d.hyOAS != null).map((d: any) => ({ time: d.date, value: d.hyOAS })));
      sBBB.setData(raw.filter((d: any) => d.bbbOAS != null).map((d: any) => ({ time: d.date, value: d.bbbOAS })));
      break;
    }
    case "3F": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.amber, topColor: `${C.amber}33`, bottomColor: `${C.amber}00`, lineWidth: 2, title: "XLE/SPY" });
      s.setData(toLineData(raw));
      break;
    }

    // ── TECHNICAL ─────────────────────────────────────────────────────────────
    case "4A": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(HistogramSeries, { title: "Trend Power Osc" });
      s.setData(raw.filter((d: any) => d.value != null).map((d: any) => ({
        time: d.date, value: d.value,
        color: (d.value ?? 0) >= 0.5 ? `${C.green}cc` : (d.value ?? 0) <= -0.5 ? `${C.red}cc` : `${C.amber}cc`,
      })));
      addHLine(s, 0, C.textDim, "0");
      break;
    }
    case "4B": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}44`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "DSI Proxy" });
      s.setData(toLineData(raw));
      addHLine(s, 80, C.red, "Extreme Bull");
      addHLine(s, 20, C.green, "Extreme Bear");
      addHLine(s, 50, C.textDim, "Neutral");
      break;
    }
    case "4D": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.amber, topColor: `${C.amber}44`, bottomColor: `${C.amber}00`, lineWidth: 2, title: "ATR % Extension" });
      s.setData(raw.filter((d: any) => d.pctExtension != null).map((d: any) => ({ time: d.date, value: d.pctExtension })));
      addHLine(s, 0, C.textDim, "0");
      addHLine(s, 2, C.red, "+2 ATR");
      addHLine(s, -2, C.green, "-2 ATR");
      break;
    }
    case "4E": {
      const raw = Array.isArray(data) ? data : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.purple, topColor: `${C.purple}33`, bottomColor: `${C.purple}00`, lineWidth: 2, title: "RS Ratio" });
      s.setData(toLineData(raw));
      break;
    }

    default: {
      const raw = Array.isArray(data) ? data : [];
      if (raw.length > 0) {
        const s = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: def.label });
        s.setData(toLineData(raw));
      }
    }
  }

  chart.timeScale().fitContent();
}

// ─── SPY Volume Chart (standalone — split not needed) ────────────────────────
// Top: SPY price line, Bottom: volume histogram (red when volume > 20d avg) + 20d avg line
function SPYVolumeChart({ data, tf }: { data: any; tf: TF }) {
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data?.length) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const totalH = container.clientHeight || 520;
    const topH = Math.round(totalH * 0.55);
    const botH = totalH - topH;

    const topEl = document.createElement("div");
    topEl.style.cssText = `width:100%;height:${topH}px;`;
    container.appendChild(topEl);

    const divider = document.createElement("div");
    divider.style.cssText = `width:100%;height:1px;background:${C.border};`;
    container.appendChild(divider);

    const botEl = document.createElement("div");
    botEl.style.cssText = `width:100%;height:${botH - 1}px;`;
    container.appendChild(botEl);

    const filtered = filterByTF(data, tf);

    // Top: price line
    const topChart = createChart(topEl, {
      ...makeChartOpts(topH),
      width: container.clientWidth,
      timeScale: { borderColor: C.border, visible: false },
    });
    const priceSeries = topChart.addSeries(LineSeries, {
      color: C.priceLine, lineWidth: 1, title: "SPY", priceLineVisible: false,
    });
    priceSeries.setData(
      filtered.filter((d: any) => d.close != null).map((d: any) => ({ time: d.date as any, value: d.close }))
    );

    // Bottom: volume histogram + 20d avg line
    const botChart = createChart(botEl, {
      ...makeChartOpts(botH - 1),
      width: container.clientWidth,
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
    });

    const volSeries = botChart.addSeries(HistogramSeries, { title: "Volume" });
    volSeries.setData(
      filtered.filter((d: any) => d.volume != null).map((d: any) => ({
        time: d.date as any,
        value: d.volume,
        color: d.avgVol20 != null && d.volume > d.avgVol20 ? `${C.red}cc` : `${C.blue}66`,
      }))
    );

    const avgSeries = botChart.addSeries(LineSeries, {
      color: C.amber, lineWidth: 1, lineStyle: LineStyle.Dashed, title: "20d Avg",
    });
    avgSeries.setData(
      filtered.filter((d: any) => d.avgVol20 != null).map((d: any) => ({ time: d.date as any, value: d.avgVol20 }))
    );

    // Sync
    topChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) botChart.timeScale().setVisibleLogicalRange(range);
    });
    botChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) topChart.timeScale().setVisibleLogicalRange(range);
    });

    topChart.timeScale().fitContent();
    botChart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      topChart.applyOptions({ width: w });
      botChart.applyOptions({ width: w });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      topChart.remove();
      botChart.remove();
    };
  }, [data, tf]); // eslint-disable-line

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// ─── Multi-line chart (no split panel — for Fed BS, etc.) ────────────────────
function SinglePaneChart({ data, def, tf }: { data: any; def: ChartDef; tf: TF }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const chart = createChart(container, {
      ...makeChartOpts(container.clientHeight || 480),
      width: container.clientWidth,
    });

    const filtered = Array.isArray(data) ? filterByTF(data, tf) : data;

    // 3D — Fed Balance Sheet
    if (def.id === "3D") {
      const raw = Array.isArray(filtered) ? filtered : [];
      const s1 = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}33`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "Fed Assets ($B)" });
      s1.setData(raw.filter((d: any) => d.fedBS != null).map((d: any) => ({ time: d.date, value: d.fedBS })));
      const s2 = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "SPY Price" });
      s2.setData(raw.filter((d: any) => d.spyClose != null).map((d: any) => ({ time: d.date, value: d.spyClose })));
    } else {
      // generic fallback
      const raw = Array.isArray(filtered) ? filtered : [];
      if (raw.length > 0) {
        const s = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: def.label });
        s.setData(toLineData(raw));
      }
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, tf]); // eslint-disable-line

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// ─── Chart Panel (full card) ──────────────────────────────────────────────────
function ChartPanel({ def, tf }: { def: ChartDef; tf: TF }) {
  const [activeTicker, setActiveTicker] = useState(def.defaultTicker ?? "SPY");
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute dynamic endpoint based on activeTicker
  const endpoint = useCallback(() => {
    if (def.id === "4A") return `/api/charts/tpo/${activeTicker}`;
    if (def.id === "4B") return `/api/charts/dsi/${activeTicker}`;
    if (def.id === "4D") return `/api/charts/atr-ext/${activeTicker}`;
    if (def.id === "4E") return `/api/charts/ratio/${activeTicker}/SPY`;
    return def.endpoint;
  }, [def.id, def.endpoint, activeTicker]);

  const priceTicker = def.id === "4A" || def.id === "4B" || def.id === "4D" || def.id === "4E"
    ? activeTicker
    : (def.priceTicker ?? "SPY");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["chart", def.id, activeTicker],
    queryFn: async () => {
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}${endpoint()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Price data for top pane (only for split-panel charts)
  const { data: priceData } = useQuery({
    queryKey: ["chart-price", priceTicker],
    queryFn: async () => {
      if (!def.splitPanel) return null;
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/charts/price/${priceTicker}`);
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!def.splitPanel,
  });

  // Split-panel chart hook
  useSplitPanelChart({
    containerRef,
    priceData: def.splitPanel ? (priceData ?? null) : null,
    indicatorData: def.splitPanel ? data : null,
    def,
    tf,
    activeTicker,
  });

  const handleDownload = () => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${def.id}-${def.label.replace(/\s+/g, "-")}-${tf}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const isScatter = def.id === "3E";
  const isSPYVol = def.id === "4C";
  const isNoSplit = !def.splitPanel; // 3D, 3E, 4C

  return (
    <div style={{
      background: C.panelBg,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 500,
    }}>
      {/* Panel Header */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}>
        <span className="font-mono" style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.05em" }}>{def.id}</span>
        <span className="font-mono font-semibold" style={{ fontSize: 12, color: "#e2e8f0" }}>{def.label}</span>
        <span className="font-mono" style={{ fontSize: 10, color: C.textDim, marginLeft: 4, flex: 1 }}>{def.desc}</span>

        {/* Per-chart ticker selector */}
        {def.tickers && (
          <select
            value={activeTicker}
            onChange={e => setActiveTicker(e.target.value)}
            style={{
              background: C.bg, border: `1px solid ${C.border}`, color: C.text,
              fontFamily: "IBM Plex Mono", fontSize: 10, padding: "2px 4px", borderRadius: 2,
            }}
          >
            {def.tickers.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <button
          onClick={() => refetch()}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, padding: 2 }}
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={handleDownload}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, padding: 2 }}
          title="Download PNG"
        >
          <Download size={12} />
        </button>
      </div>

      {/* Chart Area */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {isLoading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.panelBg, zIndex: 10 }}>
            <div style={{ width: 32, height: 32, border: `2px solid ${C.border}`, borderTopColor: C.blue, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          </div>
        )}
        {isError && !isLoading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.textDim }}>
            <span className="font-mono" style={{ fontSize: 11 }}>FETCH ERROR</span>
            <button onClick={() => refetch()} style={{ marginTop: 8, background: C.border, border: "none", color: C.text, fontFamily: "IBM Plex Mono", fontSize: 10, padding: "4px 8px", cursor: "pointer", borderRadius: 2 }}>RETRY</button>
          </div>
        )}

        {isScatter && data ? (
          <SectorRotationChart data={data} />
        ) : isSPYVol && data ? (
          <SPYVolumeChart data={data} tf={tf} />
        ) : isNoSplit && data ? (
          <SinglePaneChart data={data} def={def} tf={tf} />
        ) : (
          // Split-panel: ref driven by useSplitPanelChart
          <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  selected, onSelect, collapsed, setCollapsed,
}: {
  selected: string;
  onSelect: (id: string) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const toggle = (catId: string) => setCollapsed(p => ({ ...p, [catId]: !p[catId] }));

  return (
    <div style={{
      width: 260, flexShrink: 0, background: "#08111e", borderRight: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", overflowY: "auto",
    }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
        <span className="font-mono" style={{ fontSize: 9, letterSpacing: "0.15em", color: C.textDim }}>CMT CHART ENGINE</span>
      </div>

      {CATEGORIES.map(cat => {
        const catCharts = CHARTS.filter(c => c.category === cat.id);
        const Icon = cat.icon;
        const isOpen = !collapsed[cat.id];

        return (
          <div key={cat.id}>
            <button
              onClick={() => toggle(cat.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
                background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${C.border}22`,
              }}
            >
              <Icon size={12} color={cat.color} />
              <span className="font-mono" style={{ fontSize: 10, color: cat.color, letterSpacing: "0.08em", flex: 1, textAlign: "left" }}>
                {cat.label.toUpperCase()}
              </span>
              {isOpen ? <ChevronDown size={12} color={C.textDim} /> : <ChevronRight size={12} color={C.textDim} />}
            </button>

            {isOpen && catCharts.map(chart => (
              <button
                key={chart.id}
                onClick={() => onSelect(chart.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "7px 12px 7px 20px",
                  background: selected === chart.id ? `${cat.color}15` : "none",
                  border: "none",
                  borderLeft: selected === chart.id ? `2px solid ${cat.color}` : "2px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span className="font-mono" style={{ fontSize: 9, color: selected === chart.id ? cat.color : C.textDim, minWidth: 20, paddingTop: 1 }}>{chart.id}</span>
                <div>
                  <div className="font-mono" style={{ fontSize: 11, color: selected === chart.id ? "#e2e8f0" : C.text }}>{chart.label}</div>
                  <div className="font-mono" style={{ fontSize: 9, color: C.textDim, marginTop: 1, lineHeight: 1.3 }}>{chart.desc}</div>
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ChartEngine Component ───────────────────────────────────────────────
export default function ChartEngine() {
  const [selected, setSelected] = useState("1A");
  const [tf, setTF] = useState<TF>("2Y");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeDef = CHARTS.find(c => c.id === selected) ?? CHARTS[0];
  const activeCat = CATEGORIES.find(c => c.id === activeDef.category);

  return (
    <div style={{ display: "flex", height: "100%", background: C.bg, fontFamily: "'IBM Plex Mono', monospace", overflow: "hidden" }}>
      <Sidebar selected={selected} onSelect={setSelected} collapsed={collapsed} setCollapsed={setCollapsed} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
          borderBottom: `1px solid ${C.border}`, background: "#08111e", flexShrink: 0,
        }}>
          <Layers size={14} color={activeCat?.color ?? C.accent} />
          <span className="font-mono font-semibold" style={{ fontSize: 13, color: "#e2e8f0" }}>
            {activeDef.label}
          </span>
          <span className="font-mono" style={{ fontSize: 10, color: C.textDim }}>
            {activeDef.desc}
          </span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {(["1Y", "2Y", "5Y", "10Y"] as TF[]).map(t => (
              <button
                key={t}
                onClick={() => setTF(t)}
                style={{
                  background: tf === t ? `${C.blue}22` : "none",
                  border: `1px solid ${tf === t ? C.blue : C.border}`,
                  color: tf === t ? C.blue : C.textDim,
                  fontFamily: "IBM Plex Mono",
                  fontSize: 10, padding: "3px 8px", cursor: "pointer", borderRadius: 2,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Chart area — key forces full remount on chart change */}
        <div style={{ flex: 1, padding: 16, overflow: "auto" }}>
          <ChartPanel key={`${selected}-${tf}`} def={activeDef} tf={tf} />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
