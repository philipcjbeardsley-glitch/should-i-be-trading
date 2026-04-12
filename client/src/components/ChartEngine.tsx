import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
};

// ─── Chart Config ─────────────────────────────────────────────────────────────
const BASE_CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: C.panelBg },
    textColor: C.text,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
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
};

// ─── Timeframe filter ─────────────────────────────────────────────────────────
type TF = "1Y" | "2Y" | "5Y" | "10Y";
const TF_DAYS: Record<TF, number> = { "1Y": 365, "2Y": 730, "5Y": 1825, "10Y": 3650 };

function filterByTF(data: any[], tf: TF): any[] {
  if (!data?.length) return [];
  const cutoff = Date.now() - TF_DAYS[tf] * 86400 * 1000;
  return data.filter((d: any) => {
    const ts = d.time ? new Date(d.time).getTime() : d.date ? new Date(d.date).getTime() : 0;
    return ts >= cutoff;
  });
}

// ─── Chart Definitions ────────────────────────────────────────────────────────
interface ChartDef {
  id: string;
  label: string;
  desc: string;
  category: string;
  endpoint: string;
  renderType: "line" | "histogram" | "multi-line" | "area" | "scatter" | "candlestick" | "ratio";
  tickers?: string[];
  defaultTicker?: string;
  extraParams?: Record<string, string>;
  notes?: string;
}

const CHARTS: ChartDef[] = [
  // BREADTH
  { id: "1A", label: "% Above MA", desc: "% of S&P sectors above 20/50/200-day MAs", category: "breadth", endpoint: "/api/charts/breadth/pct_above_ma", renderType: "multi-line" },
  { id: "1B", label: "McClellan Osc", desc: "Breadth momentum oscillator (19/39 EMA of A-D spread)", category: "breadth", endpoint: "/api/charts/breadth/mcclellan", renderType: "histogram" },
  { id: "1C", label: "RSI Breadth", desc: "Median RSI across S&P sectors", category: "breadth", endpoint: "/api/charts/breadth/rsi_breadth", renderType: "line" },
  { id: "1D", label: "MACD Breadth", desc: "% of sectors with MACD above signal line", category: "breadth", endpoint: "/api/charts/breadth/macd_breadth", renderType: "line" },
  { id: "1E", label: "Zweig Thrust", desc: "Zweig Breadth Thrust oscillator (10-day EMA A-D ratio)", category: "breadth", endpoint: "/api/charts/breadth/zweig", renderType: "line" },
  { id: "1F", label: "A-D Line", desc: "Advance-Decline cumulative line", category: "breadth", endpoint: "/api/charts/breadth/ad_line", renderType: "area" },

  // SENTIMENT / POSITIONING
  { id: "2A", label: "ES Positioning", desc: "E-Mini S&P 500 COT: Large Spec Net", category: "sentiment", endpoint: "/api/charts/cot/ES", renderType: "multi-line" },
  { id: "2B", label: "NQ Positioning", desc: "E-Mini Nasdaq 100 COT: Large Spec Net", category: "sentiment", endpoint: "/api/charts/cot/NQ", renderType: "multi-line" },
  { id: "2C", label: "RTY Positioning", desc: "E-Mini Russell 2000 COT: Large Spec Net", category: "sentiment", endpoint: "/api/charts/cot/RTY", renderType: "multi-line" },
  { id: "2D", label: "VIX Futures Pos.", desc: "VIX Futures COT: Large Spec Net (sentiment gauge)", category: "sentiment", endpoint: "/api/charts/cot/VI", renderType: "multi-line" },
  { id: "2E", label: "CTA Model", desc: "Estimated CTA trend-following exposure (SPY-based)", category: "sentiment", endpoint: "/api/charts/cta", renderType: "line" },
  { id: "2F", label: "Put/Call Ratio", desc: "Equity put/call ratio proxy (SPY options vol est.)", category: "sentiment", endpoint: "/api/charts/dsi/SPY", renderType: "line" },
  { id: "2G", label: "Speculative Vol", desc: "Speculative options volume proxy", category: "sentiment", endpoint: "/api/charts/dsi/QQQ", renderType: "line" },
  { id: "2H", label: "ETF Flows", desc: "ETF flows proxy via SPY vs trend deviation", category: "sentiment", endpoint: "/api/charts/tpo/SPY", renderType: "histogram" },

  // MACRO / LIQUIDITY
  { id: "3A", label: "Liquidity Composite", desc: "6-series FRED liquidity composite (M2, repo, Fed BS, credit...)", category: "macro", endpoint: "/api/charts/liquidity", renderType: "multi-line" },
  { id: "3B", label: "Yield Curve", desc: "10Y-2Y and 10Y-3M spreads", category: "macro", endpoint: "/api/charts/yield-curve", renderType: "multi-line" },
  { id: "3C", label: "Credit Spreads", desc: "HY OAS and BBB OAS (FRED)", category: "macro", endpoint: "/api/charts/credit-spreads", renderType: "multi-line" },
  { id: "3D", label: "Fed Balance Sheet", desc: "Fed BS total assets vs SPY price overlay", category: "macro", endpoint: "/api/charts/fed-balance-sheet", renderType: "multi-line" },
  { id: "3E", label: "Sector Rotation", desc: "Momentum vs relative strength scatter — 11 SPDR ETFs", category: "macro", endpoint: "/api/charts/sector-rotation", renderType: "scatter" },
  { id: "3F", label: "XLE/SPY Ratio", desc: "Energy vs broad market ratio", category: "macro", endpoint: "/api/charts/ratio/XLE/SPY", renderType: "line" },

  // TECHNICAL
  { id: "4A", label: "Trend Power Osc", desc: "Custom oscillator: SMA slope × RSI z-score composite", category: "technical", tickers: ["SPY","QQQ","IWM","DIA","GLD","TLT","XLE","XLF"], defaultTicker: "SPY", endpoint: "/api/charts/tpo/SPY", renderType: "histogram" },
  { id: "4B", label: "Daily Sentiment", desc: "DSI proxy: RSI × z-score momentum reading", category: "technical", tickers: ["SPY","QQQ","IWM","GLD","TLT","BTC-USD"], defaultTicker: "SPY", endpoint: "/api/charts/dsi/SPY", renderType: "line" },
  { id: "4D", label: "ATR Extension", desc: "Price % extended beyond N-ATR bands", category: "technical", tickers: ["SPY","QQQ","IWM","AAPL","TSLA","NVDA","GLD","TLT"], defaultTicker: "SPY", endpoint: "/api/charts/atr-ext/SPY", renderType: "line" },
  { id: "4E", label: "Rel Strength", desc: "Ticker vs SPY relative strength ratio", category: "technical", tickers: ["QQQ","IWM","XLE","XLF","XLK","GLD","TLT","AAPL","NVDA"], defaultTicker: "QQQ", endpoint: "/api/charts/ratio/QQQ/SPY", renderType: "line" },
];

const CATEGORIES = [
  { id: "breadth", label: "Breadth", icon: BarChart2, color: C.green },
  { id: "sentiment", label: "Sentiment & Positioning", icon: Activity, color: C.amber },
  { id: "macro", label: "Macro & Liquidity", icon: Globe, color: C.blue },
  { id: "technical", label: "Technical / Price Action", icon: TrendingUp, color: C.purple },
];

// ─── Lightweight Chart Hook ───────────────────────────────────────────────────
function useLightweightChart(
  containerRef: React.RefObject<HTMLDivElement>,
  data: any,
  chartDef: ChartDef,
  tf: TF,
  activeTicker: string,
) {
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;
    const container = containerRef.current;
    container.innerHTML = "";

    const chart = createChart(container, {
      ...BASE_CHART_OPTS,
      width: container.clientWidth,
      height: container.clientHeight || 420,
    });
    chartRef.current = chart;

    const filtered = Array.isArray(data) ? filterByTF(data, tf) : data;

    try {
      renderChart(chart, chartDef, filtered, tf, activeTicker);
    } catch (e) {
      console.warn("Chart render error:", chartDef.id, e);
    }

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, tf, activeTicker]); // eslint-disable-line

  return chartRef;
}

function toLineData(arr: any[], dateKey = "date", valueKey = "value") {
  return arr
    .filter((d: any) => d[dateKey] && d[valueKey] != null && !isNaN(d[valueKey]))
    .map((d: any) => ({ time: d[dateKey] as any, value: Number(d[valueKey]) }));
}

function renderChart(chart: any, def: ChartDef, data: any, tf: TF, activeTicker: string) {
  if (!data) return;

  switch (def.id) {
    // ── BREADTH ────────────────────────────────────────────────────────────────
    case "1A": { // pct_above_ma: { date, ma20, ma50, ma200 }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s20 = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "% >20d" });
      const s50 = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "% >50d" });
      const s200 = chart.addSeries(LineSeries, { color: C.red, lineWidth: 2, title: "% >200d" });
      s20.setData(raw.map((d: any) => ({ time: d.date, value: d.ma20 })).filter((d: any) => d.value != null));
      s50.setData(raw.map((d: any) => ({ time: d.date, value: d.ma50 })).filter((d: any) => d.value != null));
      s200.setData(raw.map((d: any) => ({ time: d.date, value: d.ma200 })).filter((d: any) => d.value != null));
      break;
    }
    case "1B": { // mcclellan: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(HistogramSeries, {
        color: C.green, title: "McClellan",
        positiveColor: C.green, negativeColor: C.red,
      });
      s.setData(raw.map((d: any) => ({
        time: d.date, value: d.value,
        color: d.value >= 0 ? C.green : C.red,
      })).filter((d: any) => d.value != null));
      break;
    }
    case "1C": { // rsi_breadth: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: "Median RSI" });
      s.setData(toLineData(raw));
      addHLine(chart, 70, C.red, "OB 70");
      addHLine(chart, 30, C.green, "OS 30");
      addHLine(chart, 50, C.textDim, "50");
      break;
    }
    case "1D": { // macd_breadth: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "% MACD Bullish" });
      s.setData(toLineData(raw));
      addHLine(chart, 50, C.textDim, "50%");
      break;
    }
    case "1E": { // zweig: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(LineSeries, { color: C.accent, lineWidth: 2, title: "Zweig Thrust" });
      s.setData(toLineData(raw));
      addHLine(chart, 0.615, C.green, "Thrust 0.615");
      addHLine(chart, 0.4, C.red, "Bear 0.4");
      break;
    }
    case "1F": { // ad_line: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.green, topColor: `${C.green}44`, bottomColor: `${C.green}00`, lineWidth: 2, title: "A-D Line" });
      s.setData(toLineData(raw));
      break;
    }

    // ── COT POSITIONING ────────────────────────────────────────────────────────
    case "2A": case "2B": case "2C": case "2D": {
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const sLarge = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "Large Spec Net" });
      const sAsset = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 1, title: "Asset Mgr Net" });
      const sDealer = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 1, title: "Dealer Net" });
      sLarge.setData(raw.map((d: any) => ({ time: d.date, value: d.largeSpecNet })).filter((d: any) => d.time && d.value != null));
      sAsset.setData(raw.map((d: any) => ({ time: d.date, value: d.assetMgrNet })).filter((d: any) => d.time && d.value != null));
      sDealer.setData(raw.map((d: any) => ({ time: d.date, value: d.dealerNet })).filter((d: any) => d.time && d.value != null));
      addZeroLine(chart);
      break;
    }

    // ── SENTIMENT PROXIES ──────────────────────────────────────────────────────
    case "2E": { // CTA Model: { date, value, zScore }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}44`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "CTA Exposure" });
      s.setData(toLineData(raw));
      addZeroLine(chart);
      break;
    }
    case "2F": case "2G": { // DSI proxy
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: def.id === "2F" ? "Put/Call Proxy" : "Spec Vol Proxy" });
      s.setData(toLineData(raw));
      addHLine(chart, 80, C.red, "Extreme Bull 80");
      addHLine(chart, 20, C.green, "Extreme Bear 20");
      break;
    }
    case "2H": { // ETF flows proxy via TPO
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(HistogramSeries, { title: "TPO / Flow Proxy" });
      s.setData(raw.map((d: any) => ({
        time: d.date, value: d.value,
        color: (d.value ?? 0) >= 0 ? C.green : C.red,
      })).filter((d: any) => d.time && d.value != null));
      addZeroLine(chart);
      break;
    }

    // ── MACRO / LIQUIDITY ──────────────────────────────────────────────────────
    case "3A": { // liquidity composite: { date, composite, m2, tga, rrp, fedbs, sofr, credit }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const sComp = chart.addSeries(LineSeries, { color: C.accent, lineWidth: 3, title: "Composite" });
      sComp.setData(raw.map((d: any) => ({ time: d.date, value: d.composite })).filter((d: any) => d.time && d.composite != null));
      const sM2 = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 1, title: "M2" });
      sM2.setData(raw.map((d: any) => ({ time: d.date, value: d.m2 })).filter((d: any) => d.time && d.m2 != null));
      break;
    }
    case "3B": { // yield curve: { date, t10y2y, t10y3m }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s1 = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "10Y-2Y" });
      const s2 = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: "10Y-3M" });
      s1.setData(raw.map((d: any) => ({ time: d.date, value: d.t10y2y })).filter((d: any) => d.time && d.t10y2y != null));
      s2.setData(raw.map((d: any) => ({ time: d.date, value: d.t10y3m })).filter((d: any) => d.time && d.t10y3m != null));
      addZeroLine(chart);
      break;
    }
    case "3C": { // credit spreads: { date, hyOAS, bbbOAS }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const sHY = chart.addSeries(LineSeries, { color: C.red, lineWidth: 2, title: "HY OAS" });
      const sBBB = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 2, title: "BBB OAS" });
      sHY.setData(raw.map((d: any) => ({ time: d.date, value: d.hyOAS })).filter((d: any) => d.time && d.hyOAS != null));
      sBBB.setData(raw.map((d: any) => ({ time: d.date, value: d.bbbOAS })).filter((d: any) => d.time && d.bbbOAS != null));
      break;
    }
    case "3D": { // fed balance sheet: { date, fedBS, spyClose }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s1 = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}33`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "Fed Assets ($B)" });
      s1.setData(raw.map((d: any) => ({ time: d.date, value: d.fedBS })).filter((d: any) => d.time && d.fedBS != null));
      // SPY overlay on right scale would need separate price scale — show as line
      const s2 = chart.addSeries(LineSeries, { color: C.green, lineWidth: 2, title: "SPY Price" });
      s2.setData(raw.map((d: any) => ({ time: d.date, value: d.spyClose })).filter((d: any) => d.time && d.spyClose != null));
      break;
    }
    case "3E": { // sector rotation scatter: { symbol, rs, momentum }[]
      // lightweight-charts doesn't do scatter natively — render as SVG overlay
      renderScatterPlot(data);
      break;
    }
    case "3F": { // ratio: { date, value }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.amber, topColor: `${C.amber}33`, bottomColor: `${C.amber}00`, lineWidth: 2, title: "XLE/SPY" });
      s.setData(toLineData(raw));
      break;
    }

    // ── TECHNICAL ──────────────────────────────────────────────────────────────
    case "4A": case "2H_alt": { // Trend Power Oscillator
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(HistogramSeries, { title: "Trend Power Osc" });
      s.setData(raw.map((d: any) => ({
        time: d.date, value: d.value,
        color: (d.value ?? 0) >= 0.5 ? C.green : (d.value ?? 0) <= -0.5 ? C.red : C.amber,
      })).filter((d: any) => d.time && d.value != null));
      addZeroLine(chart);
      break;
    }
    case "4B": { // DSI proxy
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.blue, topColor: `${C.blue}44`, bottomColor: `${C.blue}00`, lineWidth: 2, title: "DSI Proxy" });
      s.setData(toLineData(raw));
      addHLine(chart, 80, C.red, "Extreme Bull");
      addHLine(chart, 20, C.green, "Extreme Bear");
      addHLine(chart, 50, C.textDim, "Neutral");
      break;
    }
    case "4D": { // ATR Extension: { date, pctExtension, upperBand, lowerBand }[]
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.amber, topColor: `${C.amber}44`, bottomColor: `${C.amber}00`, lineWidth: 2, title: "ATR % Extension" });
      s.setData(raw.map((d: any) => ({ time: d.date, value: d.pctExtension })).filter((d: any) => d.time && d.pctExtension != null));
      addZeroLine(chart);
      addHLine(chart, 2, C.red, "+2 ATR");
      addHLine(chart, -2, C.green, "-2 ATR");
      break;
    }
    case "4E": { // relative strength ratio
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      const s = chart.addSeries(AreaSeries, { lineColor: C.purple, topColor: `${C.purple}33`, bottomColor: `${C.purple}00`, lineWidth: 2, title: "RS Ratio" });
      s.setData(toLineData(raw));
      break;
    }

    default: {
      // Generic fallback: try to render as a simple line
      const raw = Array.isArray(data) ? filterByTF(data, tf) : [];
      if (raw.length > 0) {
        const s = chart.addSeries(LineSeries, { color: C.blue, lineWidth: 2, title: def.label });
        s.setData(toLineData(raw));
      }
    }
  }

  chart.timeScale().fitContent();
}

function addHLine(chart: any, value: number, color: string, title: string) {
  try {
    const s = chart.addSeries(LineSeries, {
      color: `${color}80`, lineWidth: 1, lineStyle: LineStyle.Dashed, title, priceLineVisible: false, lastValueVisible: false,
    });
    // Will be an empty placeholder — horizontal lines need to be added via priceLine on a series
    // Use the series' price line feature instead
    s.remove?.();
  } catch { /* ignore */ }
}

function addZeroLine(chart: any) {
  // no-op visual; handled by chart grid at 0
}

// Scatter plot rendered as SVG for sector rotation
function renderScatterPlot(_data: any) {
  // Will be handled by SectorRotationChart component below
}

// ─── Sector Rotation Scatter (SVG-based) ─────────────────────────────────────
function SectorRotationChart({ data, tf }: { data: any; tf: TF }) {
  if (!data?.length) return <div className="flex items-center justify-center h-full text-[#4a5568] font-mono text-xs">NO DATA</div>;

  const w = 600, h = 420, pad = 50;
  const rs: number[] = data.map((d: any) => d.rs ?? 0);
  const mom: number[] = data.map((d: any) => d.momentum ?? 0);
  const minX = Math.min(...rs), maxX = Math.max(...rs);
  const minY = Math.min(...mom), maxY = Math.max(...mom);

  const xScale = (v: number) => pad + ((v - minX) / (maxX - minX + 0.001)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - minY) / (maxY - minY + 0.001)) * (h - pad * 2);

  const midX = xScale((minX + maxX) / 2);
  const midY = yScale((minY + maxY) / 2);

  const quadrantColor = (x: number, y: number) => {
    if (x > midX && y < midY) return C.green;   // leading: strong RS + rising momentum
    if (x > midX && y > midY) return C.amber;   // weakening
    if (x < midX && y > midY) return C.red;     // lagging
    return C.blue;                                // improving
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ background: C.panelBg, maxHeight: 420 }}>
        {/* Grid lines */}
        <line x1={midX} y1={pad} x2={midX} y2={h - pad} stroke={C.grid} strokeWidth="1" strokeDasharray="4,4" />
        <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke={C.grid} strokeWidth="1" strokeDasharray="4,4" />
        {/* Quadrant labels */}
        <text x={w - pad - 4} y={pad + 14} fill={C.green} fontSize="10" textAnchor="end" fontFamily="IBM Plex Mono">LEADING</text>
        <text x={w - pad - 4} y={h - pad - 6} fill={C.amber} fontSize="10" textAnchor="end" fontFamily="IBM Plex Mono">WEAKENING</text>
        <text x={pad + 4} y={h - pad - 6} fill={C.red} fontSize="10" fontFamily="IBM Plex Mono">LAGGING</text>
        <text x={pad + 4} y={pad + 14} fill={C.blue} fontSize="10" fontFamily="IBM Plex Mono">IMPROVING</text>
        {/* Axes */}
        <text x={w / 2} y={h - 8} fill={C.text} fontSize="10" textAnchor="middle" fontFamily="IBM Plex Mono">Relative Strength →</text>
        <text x={12} y={h / 2} fill={C.text} fontSize="10" textAnchor="middle" fontFamily="IBM Plex Mono" transform={`rotate(-90,12,${h / 2})`}>Momentum →</text>
        {/* Points */}
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

// ─── Single Chart Renderer ────────────────────────────────────────────────────
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

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["chart", def.id, activeTicker],
    queryFn: () => apiRequest("GET", endpoint()),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useLightweightChart(containerRef, data, def, tf, activeTicker);

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

  return (
    <div style={{ background: C.panelBg, border: `1px solid ${C.border}`, borderRadius: 4, display: "flex", flexDirection: "column", height: "100%", minHeight: 480 }}>
      {/* Panel Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span className="font-mono" style={{ fontSize: 10, color: C.textDim, letterSpacing: "0.05em" }}>{def.id}</span>
        <span className="font-mono font-semibold" style={{ fontSize: 12, color: "#e2e8f0" }}>{def.label}</span>
        <span className="font-mono" style={{ fontSize: 10, color: C.textDim, marginLeft: 4, flex: 1 }}>{def.desc}</span>

        {/* Per-chart ticker selector */}
        {def.tickers && (
          <select
            value={activeTicker}
            onChange={e => setActiveTicker(e.target.value)}
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, fontFamily: "IBM Plex Mono", fontSize: 10, padding: "2px 4px", borderRadius: 2 }}
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
          <SectorRotationChart data={data} tf={tf} />
        ) : (
          <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 400 }} />
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  selected,
  onSelect,
  collapsed,
  setCollapsed,
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
            {/* Category header */}
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

            {/* Chart list */}
            {isOpen && catCharts.map(chart => (
              <button
                key={chart.id}
                onClick={() => onSelect(chart.id)}
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 12px 7px 20px",
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
  const [tf, setTF] = useState<TF>("1Y");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const activeDef = CHARTS.find(c => c.id === selected) ?? CHARTS[0];
  const activeCat = CATEGORIES.find(c => c.category === activeDef.category || c.id === activeDef.category);

  return (
    <div style={{ display: "flex", height: "100%", background: C.bg, fontFamily: "'IBM Plex Mono', monospace", overflow: "hidden" }}>
      {/* Sidebar */}
      <Sidebar
        selected={selected}
        onSelect={setSelected}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
      />

      {/* Main content */}
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

        {/* Chart area */}
        <div style={{ flex: 1, padding: 16, overflow: "auto" }}>
          <ChartPanel key={`${selected}-${tf}`} def={activeDef} tf={tf} />
        </div>
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
