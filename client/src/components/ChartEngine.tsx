/**
 * ChartEngine.tsx — Plotly-powered CMT-style dual-pane charts
 * Visual target: macrocharts.com — indicator fills full pane by default,
 * price pane collapsed (toggleable), shared x-axis when open.
 * Global ticker bar: persistent text input at top, Enter updates all ticker-based charts.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Plot from "react-plotly.js";
import {
  ChevronDown, ChevronRight, RefreshCw,
  BarChart2, Activity, TrendingUp, Globe, Layers, ChevronUp,
} from "lucide-react";

// ─── API Base ─────────────────────────────────────────────────────────────────
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// ─── Colors ───────────────────────────────────────────────────────────────────
const BG       = "#060b14";
const PAPER    = "#060b14";
const GRID     = "#0d1f35";
const AXIS_CLR = "#64748b";
const GREEN    = "#22c55e";
const RED      = "#ef4444";
const AMBER    = "#eab308";
const BLUE     = "#38bdf8";
const PURPLE   = "#a78bfa";
const ACCENT   = "#00d4a0";
const PRICE_CLR = "#cbd5e1";  // thin light price line
const REFLINE  = "#334155";   // dashed reference lines
const FONT     = "'IBM Plex Mono', monospace";

// ─── Timeframe ────────────────────────────────────────────────────────────────
type TF = "1Y" | "2Y" | "5Y" | "10Y";
const TF_DAYS: Record<TF, number> = { "1Y": 365, "2Y": 730, "5Y": 1825, "10Y": 3650 };

function cutoffDate(tf: TF): string {
  const d = new Date(Date.now() - TF_DAYS[tf] * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function filterDates<T extends { date: string }>(arr: T[], tf: TF): T[] {
  const cut = cutoffDate(tf);
  return arr.filter(d => d.date >= cut);
}

// ─── Plotly base layout ───────────────────────────────────────────────────────
function baseLayout(title?: string): Partial<Plotly.Layout> {
  return {
    paper_bgcolor: PAPER,
    plot_bgcolor: BG,
    font: { family: FONT, size: 10, color: AXIS_CLR },
    margin: { l: 52, r: 60, t: title ? 32 : 8, b: 40 },
    showlegend: true,
    legend: {
      x: 0.01, y: 0.99, xanchor: "left", yanchor: "top",
      bgcolor: "rgba(6,11,20,0.7)", bordercolor: GRID, borderwidth: 1,
      font: { family: FONT, size: 9, color: AXIS_CLR },
      orientation: "h",
    },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#0d1f35", bordercolor: GRID, font: { family: FONT, size: 10 } },
    dragmode: "pan",
    ...(title ? { title: { text: title, font: { family: FONT, size: 11, color: AXIS_CLR }, x: 0.01 } } : {}),
  } as any;
}

function axisStyle(opts: Partial<Plotly.Axis> = {}): Partial<Plotly.Axis> {
  return {
    gridcolor: GRID,
    gridwidth: 1,
    linecolor: GRID,
    zerolinecolor: REFLINE,
    zerolinewidth: 1,
    tickfont: { family: FONT, size: 9, color: AXIS_CLR },
    color: AXIS_CLR,
    showgrid: true,
    ...opts,
  } as any;
}

const PLOTLY_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["select2d", "lasso2d", "resetScale2d", "toImage"] as any,
  modeBarButtonsToAdd: [],
  scrollZoom: true,
};

// ─── Reference line shape helper ─────────────────────────────────────────────
function hline(y: number, yref: string, label: string, color: string = REFLINE): Partial<Plotly.Shape> {
  return {
    type: "line",
    xref: "paper", x0: 0, x1: 1,
    yref: yref as any, y0: y, y1: y,
    line: { color, width: 1, dash: "dash" },
  } as any;
}

// ─── Chart Definitions ────────────────────────────────────────────────────────
interface ChartDef {
  id: string;
  label: string;
  desc: string;
  category: string;
  endpoint: string;
  priceTicker?: string;        // undefined = no price pane
  tickers?: string[];
  defaultTicker?: string;
}

const CHARTS: ChartDef[] = [
  // BREADTH
  { id: "1A", label: "% Above MA", desc: "% of S&P sectors above 20/50/200-day MAs", category: "breadth", endpoint: "/api/charts/breadth/pct_above_ma", priceTicker: "SPY" },
  { id: "1B", label: "McClellan Osc", desc: "Breadth momentum oscillator (19/39 EMA of A-D spread)", category: "breadth", endpoint: "/api/charts/breadth/mcclellan", priceTicker: "SPY" },
  { id: "1C", label: "RSI Breadth", desc: "Median RSI across S&P sectors", category: "breadth", endpoint: "/api/charts/breadth/rsi_breadth", priceTicker: "SPY" },
  { id: "1D", label: "MACD Breadth", desc: "% of sectors with MACD above signal line", category: "breadth", endpoint: "/api/charts/breadth/macd_breadth", priceTicker: "SPY" },
  { id: "1E", label: "Zweig Thrust", desc: "Zweig Breadth Thrust oscillator (10-day EMA A-D ratio)", category: "breadth", endpoint: "/api/charts/breadth/zweig", priceTicker: "SPY" },
  { id: "1F", label: "A-D Line", desc: "Advance-Decline cumulative line", category: "breadth", endpoint: "/api/charts/breadth/ad_line", priceTicker: "SPY" },

  // SENTIMENT / POSITIONING
  { id: "2A", label: "ES Positioning", desc: "E-Mini S&P 500 COT: Large Spec / Asset Mgr / Dealer net", category: "sentiment", endpoint: "/api/charts/cot/ES", priceTicker: "SPY" },
  { id: "2B", label: "NQ Positioning", desc: "E-Mini Nasdaq COT: Large Spec / Asset Mgr / Dealer net", category: "sentiment", endpoint: "/api/charts/cot/NQ", priceTicker: "QQQ" },
  { id: "2C", label: "RTY Positioning", desc: "E-Mini Russell 2000 COT", category: "sentiment", endpoint: "/api/charts/cot/RTY", priceTicker: "IWM" },
  { id: "2D", label: "VIX Futures Pos.", desc: "VIX Futures COT: Large Spec Net", category: "sentiment", endpoint: "/api/charts/cot/VI", priceTicker: "SPY" },
  { id: "2E", label: "CTA Model", desc: "Estimated CTA trend-following exposure (SPY-based)", category: "sentiment", endpoint: "/api/charts/cta", priceTicker: "SPY" },
  { id: "2F", label: "Put/Call Proxy", desc: "DSI proxy: short-term RSI smoothed as P/C surrogate", category: "sentiment", endpoint: "/api/charts/dsi/SPY", priceTicker: "SPY" },
  { id: "2G", label: "Speculative Vol", desc: "VIX vs 20d SMA — speculative options activity proxy", category: "sentiment", endpoint: "/api/charts/spec-vol", priceTicker: "SPY" },
  { id: "2H", label: "Sentiment Composite", desc: "VIX percentile + credit spreads → fear/greed score 0-100", category: "sentiment", endpoint: "/api/charts/sentiment", priceTicker: "SPY" },

  // MACRO / LIQUIDITY
  { id: "3A", label: "Liquidity Composite", desc: "6-series FRED liquidity composite (M2, repo, Fed BS, credit)", category: "macro", endpoint: "/api/charts/liquidity", priceTicker: "SPY" },
  { id: "3B", label: "Yield Curve", desc: "10Y-2Y and 10Y-3M spreads (FRED)", category: "macro", endpoint: "/api/charts/yield-curve", priceTicker: "SPY" },
  { id: "3C", label: "Credit Spreads", desc: "HY OAS and BBB OAS (FRED — ICE BofA)", category: "macro", endpoint: "/api/charts/credit-spreads", priceTicker: "SPY" },
  { id: "3D", label: "Fed Balance Sheet", desc: "Fed total assets ($B) vs SPY price", category: "macro", endpoint: "/api/charts/fed-balance-sheet" },
  { id: "3E", label: "Sector Rotation", desc: "Momentum vs relative strength scatter — 11 SPDR ETFs", category: "macro", endpoint: "/api/charts/sector-rotation" },
  { id: "3F", label: "XLE/SPY Ratio", desc: "Energy vs broad market ratio", category: "macro", endpoint: "/api/charts/ratio/XLE/SPY", priceTicker: "SPY" },

  // TECHNICAL
  { id: "4A", label: "Trend Power Osc", desc: "SMA slope × RSI z-score composite", category: "technical", tickers: ["SPY","QQQ","IWM","DIA","GLD","TLT","XLE","XLF"], defaultTicker: "SPY", endpoint: "/api/charts/tpo/SPY", priceTicker: "SPY" },
  { id: "4B", label: "Daily Sentiment", desc: "DSI proxy: 5-day RSI smoothed 3-day EMA", category: "technical", tickers: ["SPY","QQQ","IWM","GLD","TLT","BTC-USD"], defaultTicker: "SPY", endpoint: "/api/charts/dsi/SPY", priceTicker: "SPY" },
  { id: "4C", label: "SPY Volume", desc: "SPY price (top) + daily volume histogram with 20d avg", category: "technical", endpoint: "/api/charts/spy-volume" },
  { id: "4D", label: "ATR Extension", desc: "Price % extended beyond N-ATR bands from SMA20", category: "technical", tickers: ["SPY","QQQ","IWM","AAPL","TSLA","NVDA","GLD","TLT"], defaultTicker: "SPY", endpoint: "/api/charts/atr-ext/SPY", priceTicker: "SPY" },
  { id: "4E", label: "Rel Strength", desc: "Ticker vs SPY relative strength ratio", category: "technical", tickers: ["QQQ","IWM","XLE","XLF","XLK","GLD","TLT","AAPL","NVDA"], defaultTicker: "QQQ", endpoint: "/api/charts/ratio/QQQ/SPY", priceTicker: "SPY" },
];

const CATEGORIES = [
  { id: "breadth",   label: "Breadth",                  icon: BarChart2, color: GREEN  },
  { id: "sentiment", label: "Sentiment & Positioning",  icon: Activity,  color: AMBER  },
  { id: "macro",     label: "Macro & Liquidity",        icon: Globe,     color: BLUE   },
  { id: "technical", label: "Technical / Price Action", icon: TrendingUp,color: PURPLE },
];

// ─── Build Plotly figure from data + chart def ────────────────────────────────
// showPrice: false = indicator fills full height (default)
// showPrice: true  = indicator top 65%, price bottom 35%
function buildFigure(
  def: ChartDef,
  indData: any,
  priceData: any[] | null,
  tf: TF,
  activeTicker: string,
  showPrice: boolean,
): { data: Plotly.Data[]; layout: Partial<Plotly.Layout> } | null {

  if (!indData) return null;

  const hasPricePane = showPrice && !!def.priceTicker && !!priceData?.length;

  // ── Sector Rotation scatter (special case — no price pane ever) ────────────
  if (def.id === "3E") {
    if (!Array.isArray(indData) || !indData.length) return null;
    const colors = indData.map((d: any) => {
      if (d.rs > 0 && d.momentum > 0) return GREEN;
      if (d.rs > 0 && d.momentum <= 0) return AMBER;
      if (d.rs <= 0 && d.momentum > 0) return BLUE;
      return RED;
    });
    return {
      data: [{
        type: "scatter",
        mode: "markers+text",
        x: indData.map((d: any) => d.rs),
        y: indData.map((d: any) => d.momentum),
        text: indData.map((d: any) => d.symbol),
        textposition: "middle center",
        textfont: { family: FONT, size: 10, color: colors },
        marker: { color: colors, size: 28, opacity: 0.15, line: { color: colors, width: 1.5 } },
        hovertemplate: "<b>%{text}</b><br>RS: %{x:.2f}<br>Mom: %{y:.2f}<extra></extra>",
      } as any],
      layout: {
        ...baseLayout("Sector Rotation — RS vs Momentum"),
        xaxis: { ...axisStyle(), title: { text: "Relative Strength →", font: { family: FONT, size: 10, color: AXIS_CLR } }, zeroline: true, zerolinecolor: REFLINE, zerolinewidth: 1 },
        yaxis: { ...axisStyle(), title: { text: "Momentum →", font: { family: FONT, size: 10, color: AXIS_CLR } }, zeroline: true },
        annotations: [
          { x: 0.95, y: 0.95, xref: "paper", yref: "paper", text: "LEADING", showarrow: false, font: { color: GREEN, size: 9, family: FONT } },
          { x: 0.05, y: 0.95, xref: "paper", yref: "paper", text: "IMPROVING", showarrow: false, font: { color: BLUE, size: 9, family: FONT } },
          { x: 0.95, y: 0.05, xref: "paper", yref: "paper", text: "WEAKENING", showarrow: false, font: { color: AMBER, size: 9, family: FONT } },
          { x: 0.05, y: 0.05, xref: "paper", yref: "paper", text: "LAGGING", showarrow: false, font: { color: RED, size: 9, family: FONT } },
        ],
      } as any,
    };
  }

  // ── SPY Volume (special: keep as-is — price on top, histogram below) ──────
  if (def.id === "4C") {
    if (!Array.isArray(indData) || !indData.length) return null;
    const d = filterDates(indData, tf);
    const dates = d.map((r: any) => r.date);
    const closes = d.map((r: any) => r.close);
    const vols = d.map((r: any) => r.volume);
    const avg20 = d.map((r: any) => r.avgVol20);
    const volColors = d.map((r: any) =>
      (r.avgVol20 != null && r.volume > r.avgVol20) ? RED + "cc" : BLUE + "55"
    );

    return {
      data: [
        {
          type: "scatter", mode: "lines",
          x: dates, y: closes, yaxis: "y1", name: "SPY",
          line: { color: PRICE_CLR, width: 1 },
          hovertemplate: "SPY: %{y:.2f}<extra></extra>",
        },
        {
          type: "bar",
          x: dates, y: vols, yaxis: "y2", name: "Volume",
          marker: { color: volColors },
          hovertemplate: "Vol: %{y:,.0f}<extra></extra>",
        },
        {
          type: "scatter", mode: "lines",
          x: dates, y: avg20, yaxis: "y2", name: "20d Avg",
          line: { color: AMBER, width: 1.5, dash: "dot" },
          hovertemplate: "20d Avg: %{y:,.0f}<extra></extra>",
        },
      ] as any,
      layout: {
        ...baseLayout(),
        grid: { rows: 2, columns: 1, pattern: "coupled", roworder: "top to bottom" },
        yaxis:  { ...axisStyle(), domain: [0.38, 1.0], title: { text: "SPY", font: { size: 9, color: AXIS_CLR, family: FONT } } },
        yaxis2: { ...axisStyle(), domain: [0, 0.34] },
        xaxis:  { ...axisStyle(), anchor: "y2", matches: "x" },
        shapes: [
          { type: "line", xref: "paper", x0: 0, x1: 1, yref: "paper", y0: 0.36, y1: 0.36, line: { color: GRID, width: 1 } } as any,
        ],
        margin: { l: 52, r: 60, t: 8, b: 40 },
      } as any,
    };
  }

  // ── Fed Balance Sheet (no price pane, overlay on same chart — keep as-is) ──
  if (def.id === "3D") {
    if (!Array.isArray(indData) || !indData.length) return null;
    const d = filterDates(indData, tf);
    return {
      data: [
        {
          type: "scatter", mode: "lines",
          x: d.map((r: any) => r.date),
          y: d.map((r: any) => r.fedBS),
          name: "Fed Assets ($B)",
          fill: "tozeroy",
          fillcolor: BLUE + "22",
          line: { color: BLUE, width: 2 },
          yaxis: "y1",
          hovertemplate: "Fed BS: $%{y:.0f}B<extra></extra>",
        },
        {
          type: "scatter", mode: "lines",
          x: d.map((r: any) => r.date),
          y: d.map((r: any) => r.spyClose),
          name: "SPY",
          line: { color: GREEN, width: 1.5 },
          yaxis: "y2",
          hovertemplate: "SPY: %{y:.2f}<extra></extra>",
        },
      ] as any,
      layout: {
        ...baseLayout(),
        yaxis:  { ...axisStyle(), title: { text: "Fed Assets ($B)", font: { size: 9, color: BLUE, family: FONT } }, side: "left" },
        yaxis2: { ...axisStyle(), title: { text: "SPY", font: { size: 9, color: GREEN, family: FONT } }, side: "right", overlaying: "y" },
        xaxis:  { ...axisStyle() },
      } as any,
    };
  }

  // ── Standard dual-pane charts ────────────────────────────────────────────
  // Pane geometry:
  //   Default (showPrice=false): indicator y2 fills [0, 1], no price pane
  //   Toggle open (showPrice=true): indicator y2 = [0.37, 1.0], price y1 = [0.0, 0.33]
  const indDomain: [number, number] = hasPricePane ? [0.37, 1.0] : [0.0, 1.0];
  const priceDomain: [number, number] = [0.0, 0.33];

  // Build price trace (bottom pane, y1) — only when showPrice=true
  const priceDates: string[] = [];
  const priceClose: number[] = [];
  if (hasPricePane && priceData) {
    const pFiltered = filterDates(priceData, tf);
    pFiltered.forEach((b: any) => { if (b.close != null) { priceDates.push(b.date); priceClose.push(b.close); } });
  }

  const traces: Plotly.Data[] = [];
  const shapes: Partial<Plotly.Shape>[] = [];

  // Divider line between panes — only when price pane is visible
  if (hasPricePane) {
    shapes.push(
      { type: "line", xref: "paper", x0: 0, x1: 1, yref: "paper", y0: 0.35, y1: 0.35, line: { color: GRID, width: 1 } } as any,
    );
  }

  if (hasPricePane) {
    traces.push({
      type: "scatter", mode: "lines",
      x: priceDates, y: priceClose,
      name: activeTicker,
      yaxis: "y1",
      line: { color: PRICE_CLR, width: 1 },
      hovertemplate: `${activeTicker}: %{y:.2f}<extra></extra>`,
    } as any);
  }

  // ── Build indicator traces (y2) ────────────────────────────────────────────
  const iref = "y2";

  const addLine = (x: string[], y: (number|null)[], name: string, color: string, width = 2.5, dash?: string) => {
    traces.push({
      type: "scatter", mode: "lines",
      x, y, name, yaxis: iref,
      line: { color, width, ...(dash ? { dash } : {}) },
      hovertemplate: `${name}: %{y:.3f}<extra></extra>`,
    } as any);
  };

  const addBar = (x: string[], y: (number|null)[], name: string, colors: string[]) => {
    traces.push({
      type: "bar",
      x, y, name, yaxis: iref,
      marker: { color: colors },
      hovertemplate: `${name}: %{y:.3f}<extra></extra>`,
    } as any);
  };

  const raw = Array.isArray(indData) ? filterDates(indData, tf) : [];

  switch (def.id) {
    // ── BREADTH ──────────────────────────────────────────────────────────────
    case "1A": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.pct20  ?? null), "% >20d MA",  GREEN, 2);
      addLine(x, raw.map((d: any) => d.pct50  ?? null), "% >50d MA",  AMBER, 2);
      addLine(x, raw.map((d: any) => d.pct200 ?? null), "% >200d MA", RED,   2);
      shapes.push(
        hline(80, iref, "OB", RED + "99"),
        hline(20, iref, "OS", GREEN + "99"),
        hline(50, iref, "50", REFLINE),
      );
      break;
    }
    case "1B": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      const barColors = raw.map((d: any) => (d.value ?? 0) >= 0 ? GREEN + "cc" : RED + "cc");
      addBar(x, y, "McClellan Osc", barColors);
      shapes.push(hline(0, iref, "0", REFLINE));
      break;
    }
    case "1C": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.value ?? null), "Median RSI", BLUE);
      shapes.push(
        hline(70, iref, "OB 70", RED + "99"),
        hline(30, iref, "OS 30", GREEN + "99"),
        hline(50, iref, "Neutral", REFLINE),
      );
      break;
    }
    case "1D": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.value ?? null), "% MACD Bullish", AMBER);
      shapes.push(hline(50, iref, "50%", REFLINE));
      break;
    }
    case "1E": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.value ?? null), "Zweig Thrust", ACCENT, 2.5);
      shapes.push(
        hline(0.615, iref, "Thrust 0.615", GREEN + "99"),
        hline(0.4,   iref, "Bear 0.4",     RED   + "99"),
        hline(0.5,   iref, "Neutral",       REFLINE),
      );
      break;
    }
    case "1F": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: "A-D Line", yaxis: iref,
        fill: "tozeroy", fillcolor: GREEN + "22",
        line: { color: GREEN, width: 2 },
        hovertemplate: "A-D: %{y:.0f}<extra></extra>",
      } as any);
      break;
    }

    // ── COT POSITIONING ───────────────────────────────────────────────────────
    case "2A": case "2B": case "2C": case "2D": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.largeSpecNet ?? null), "Large Spec Net", GREEN, 2.5);
      addLine(x, raw.map((d: any) => d.assetMgrNet  ?? null), "Asset Mgr Net",  BLUE, 1.5, "dot");
      addLine(x, raw.map((d: any) => d.dealerNet    ?? null), "Dealer Net",      AMBER, 1.5, "dot");
      shapes.push(hline(0, iref, "0", REFLINE));
      break;
    }

    // ── SENTIMENT ─────────────────────────────────────────────────────────────
    case "2E": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: "CTA Exposure", yaxis: iref,
        fill: "tozeroy", fillcolor: BLUE + "22",
        line: { color: BLUE, width: 2.5 },
        hovertemplate: "CTA: %{y:.1f}<extra></extra>",
      } as any);
      shapes.push(
        hline(0, iref, "0", REFLINE),
        hline(50,  iref, "Max Long",  RED   + "99"),
        hline(-50, iref, "Max Short", GREEN + "99"),
      );
      break;
    }
    case "2F": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.value ?? null), "P/C Proxy", AMBER);
      shapes.push(
        hline(80, iref, "Extreme Bull", RED   + "99"),
        hline(20, iref, "Extreme Bear", GREEN + "99"),
        hline(50, iref, "Neutral",       REFLINE),
      );
      break;
    }
    case "2G": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.value    ?? null), "VIX",      RED,  2.5);
      addLine(x, raw.map((d: any) => d.vixSMA20 ?? null), "VIX 20d", AXIS_CLR, 1, "dot");
      shapes.push(
        hline(20, iref, "VIX 20", REFLINE),
        hline(30, iref, "VIX 30", AMBER + "99"),
        hline(40, iref, "VIX 40", RED   + "99"),
      );
      break;
    }
    case "2H": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: "Sentiment Score", yaxis: iref,
        fill: "tozeroy", fillcolor: ACCENT + "22",
        line: { color: ACCENT, width: 2.5 },
        hovertemplate: "Sentiment: %{y:.1f}<extra></extra>",
      } as any);
      shapes.push(
        hline(80, iref, "Extreme Bull", RED   + "99"),
        hline(20, iref, "Extreme Bear", GREEN + "99"),
        hline(50, iref, "Neutral",       REFLINE),
      );
      break;
    }

    // ── MACRO ─────────────────────────────────────────────────────────────────
    case "3A": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.composite ?? null), "Composite", ACCENT, 2.5);
      addLine(x, raw.map((d: any) => d.m2        ?? null), "M2",        BLUE,  1, "dot");
      addLine(x, raw.map((d: any) => d.rrp       ?? null), "RRP",       AMBER, 1, "dot");
      break;
    }
    case "3B": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.t10y2y ?? null), "10Y-2Y", AMBER, 2.5);
      addLine(x, raw.map((d: any) => d.t10y3m ?? null), "10Y-3M", BLUE,  2);
      shapes.push(hline(0, iref, "Inversion", RED + "99"));
      break;
    }
    case "3C": {
      const x = raw.map((d: any) => d.date);
      addLine(x, raw.map((d: any) => d.hyOAS  ?? null), "HY OAS",  RED,  2.5);
      addLine(x, raw.map((d: any) => d.bbbOAS ?? null), "BBB OAS", AMBER, 2);
      break;
    }
    case "3F": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: "XLE/SPY Ratio", yaxis: iref,
        fill: "tozeroy", fillcolor: AMBER + "22",
        line: { color: AMBER, width: 2 },
        hovertemplate: "XLE/SPY: %{y:.4f}<extra></extra>",
      } as any);
      break;
    }

    // ── TECHNICAL ─────────────────────────────────────────────────────────────
    case "4A": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      const barColors = raw.map((d: any) => {
        const v = d.value ?? 0;
        return v >= 0.5 ? GREEN + "cc" : v <= -0.5 ? RED + "cc" : AMBER + "cc";
      });
      addBar(x, y, "Trend Power Osc", barColors);
      shapes.push(hline(0, iref, "0", REFLINE));
      break;
    }
    case "4B": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: "DSI Proxy", yaxis: iref,
        fill: "tozeroy", fillcolor: BLUE + "22",
        line: { color: BLUE, width: 2.5 },
        hovertemplate: "DSI: %{y:.1f}<extra></extra>",
      } as any);
      shapes.push(
        hline(80, iref, "Extreme Bull", RED   + "99"),
        hline(20, iref, "Extreme Bear", GREEN + "99"),
        hline(50, iref, "Neutral",       REFLINE),
      );
      break;
    }
    case "4D": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.pctExtension ?? null),
        name: "ATR % Extension", yaxis: iref,
        fill: "tozeroy", fillcolor: AMBER + "22",
        line: { color: AMBER, width: 2.5 },
        hovertemplate: "ATR Ext: %{y:.2f}<extra></extra>",
      } as any);
      shapes.push(
        hline( 2, iref, "+2 ATR",  RED   + "99"),
        hline(-2, iref, "-2 ATR",  GREEN + "99"),
        hline( 0, iref, "0",        REFLINE),
      );
      break;
    }
    case "4E": {
      const x = raw.map((d: any) => d.date);
      traces.push({
        type: "scatter", mode: "lines",
        x, y: raw.map((d: any) => d.value ?? null),
        name: `${activeTicker}/SPY`, yaxis: iref,
        fill: "tozeroy", fillcolor: PURPLE + "22",
        line: { color: PURPLE, width: 2.5 },
        hovertemplate: "RS: %{y:.4f}<extra></extra>",
      } as any);
      break;
    }

    default: {
      // Generic fallback
      const x = raw.map((d: any) => d.date);
      if (raw.length > 0 && raw[0].value !== undefined) {
        addLine(x, raw.map((d: any) => d.value ?? null), def.label, BLUE);
      }
    }
  }

  // ── Build layout ─────────────────────────────────────────────────────────
  const layout: Partial<Plotly.Layout> = {
    ...baseLayout(),
    margin: { l: 52, r: 60, t: 8, b: 40 },
    shapes: shapes as any,
    ...(hasPricePane ? {
      // Toggle open: indicator top 65%, price bottom 35%
      yaxis: {
        ...axisStyle(),
        domain: priceDomain,
        title: { text: activeTicker, font: { size: 9, color: AXIS_CLR, family: FONT } },
      },
      yaxis2: {
        ...axisStyle(),
        domain: indDomain,
      },
      xaxis: {
        ...axisStyle(),
        anchor: "y2",
        matches: "x",
      },
    } : {
      // Default: indicator fills full height
      yaxis2: {
        ...axisStyle(),
        domain: indDomain,
      },
      xaxis: { ...axisStyle(), anchor: "y2" },
    }),
  } as any;

  return { data: traces, layout };
}

// ─── ChartPanel component ─────────────────────────────────────────────────────
// globalTicker: lifted from ChartEngine parent — drives per-ticker endpoints + price overlay label
// showPrice: local toggle state per panel
function ChartPanel({ def, tf, globalTicker }: { def: ChartDef; tf: TF; globalTicker: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  // Price pane collapsed by default
  const [showPrice, setShowPrice] = useState(false);

  // Track container size via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setDims({ width, height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Derive active ticker for endpoint routing:
  // Charts 4A/4B/4D/4E: use globalTicker
  // All others: their endpoint is fixed, globalTicker only affects price overlay label
  const activeTicker = (def.id === "4A" || def.id === "4B" || def.id === "4D" || def.id === "4E")
    ? globalTicker
    : (def.defaultTicker ?? "SPY");

  const endpoint = useCallback(() => {
    if (def.id === "4A") return `/api/charts/tpo/${globalTicker}`;
    if (def.id === "4B") return `/api/charts/dsi/${globalTicker}`;
    if (def.id === "4D") return `/api/charts/atr-ext/${globalTicker}`;
    if (def.id === "4E") return `/api/charts/ratio/${globalTicker}/SPY`;
    return def.endpoint;
  }, [def.id, def.endpoint, globalTicker]);

  const priceTicker = (def.id === "4A" || def.id === "4B" || def.id === "4D" || def.id === "4E")
    ? globalTicker
    : (def.priceTicker ?? "SPY");

  const { data: indData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["chart", def.id, activeTicker],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}${endpoint()}`);
      if (!res.ok) {
        const msg = `${def.id} fetch error: ${res.status} ${res.statusText} — ${endpoint()}`;
        console.error("[ChartEngine]", msg);
        throw new Error(msg);
      }
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) {
        console.warn("[ChartEngine] No data returned for", def.id, endpoint());
      }
      return json;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: priceData } = useQuery({
    queryKey: ["chart-price", priceTicker],
    queryFn: async () => {
      if (!def.priceTicker) return null;
      const res = await fetch(`${API_BASE}/api/charts/price/${priceTicker}`);
      if (!res.ok) {
        console.warn("[ChartEngine] Price fetch failed for", priceTicker);
        return null;
      }
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!def.priceTicker,
  });

  const figure = (!isLoading && !isError && indData)
    ? buildFigure(def, indData, priceData ?? null, tf, activeTicker, showPrice)
    : null;

  const isEmpty = figure && (
    Array.isArray(indData) && indData.length === 0
  );

  // Whether this chart can show a price toggle at all
  // 3D and 3E have no priceTicker — no toggle
  // 4C is special-cased (own layout) — no toggle
  const canTogglePrice = !!def.priceTicker && def.id !== "4C" && def.id !== "3D" && def.id !== "3E";

  return (
    <div style={{
      background: "#08111e",
      border: `1px solid #132035`,
      borderRadius: 4,
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
    }}>
      {/* Panel header */}
      <div style={{
        borderBottom: "1px solid #132035",
        padding: "7px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        background: "#07101d",
      }}>
        <span style={{ fontSize: 10, color: AXIS_CLR, fontFamily: FONT, letterSpacing: "0.05em" }}>{def.id}</span>
        <span style={{ fontSize: 12, color: "#e2e8f0", fontFamily: FONT, fontWeight: 600 }}>{def.label}</span>
        <span style={{ fontSize: 10, color: AXIS_CLR, fontFamily: FONT, flex: 1 }}>{def.desc}</span>

        {/* Price pane toggle — only for charts that support it */}
        {canTogglePrice && (
          <button
            onClick={() => setShowPrice(p => !p)}
            title={showPrice ? "Hide price pane" : "Show price pane"}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              background: showPrice ? `${PRICE_CLR}15` : "none",
              border: `1px solid ${showPrice ? PRICE_CLR + "44" : "#132035"}`,
              color: showPrice ? PRICE_CLR : AXIS_CLR,
              fontFamily: FONT, fontSize: 9,
              padding: "2px 7px", cursor: "pointer", borderRadius: 2,
              letterSpacing: "0.05em",
            }}
          >
            {showPrice ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
            PRICE
          </button>
        )}

        <button onClick={() => refetch()} title="Refresh"
          style={{ background: "none", border: "none", cursor: "pointer", color: AXIS_CLR, padding: 2 }}>
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Chart body */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {isLoading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#08111e", zIndex: 10 }}>
            <div style={{ width: 28, height: 28, border: `2px solid #132035`, borderTopColor: BLUE, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          </div>
        )}
        {isError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ color: RED, fontFamily: FONT, fontSize: 11 }}>FETCH ERROR</span>
            <span style={{ color: AXIS_CLR, fontFamily: FONT, fontSize: 9, maxWidth: 320, textAlign: "center" }}>
              {(error as Error)?.message}
            </span>
            <button onClick={() => refetch()}
              style={{ background: "#132035", border: "none", color: "#94a3b8", fontFamily: FONT, fontSize: 10, padding: "4px 10px", cursor: "pointer", borderRadius: 2 }}>
              RETRY
            </button>
          </div>
        )}
        {isEmpty && !isLoading && !isError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: AXIS_CLR, fontFamily: FONT, fontSize: 11 }}>NO DATA AVAILABLE</span>
            <span style={{ color: AXIS_CLR, fontFamily: FONT, fontSize: 9, marginTop: 4 }}>Backend returned empty dataset for {def.id}</span>
          </div>
        )}
        {figure && !isEmpty && dims.width > 0 && (
          <Plot
            data={figure.data}
            layout={{
              ...figure.layout,
              width: dims.width,
              height: dims.height,
              autosize: false,
            }}
            config={PLOTLY_CONFIG}
            style={{ width: "100%", height: "100%", display: "block" }}
            useResizeHandler={true}
          />
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
  const toggle = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  return (
    <div style={{
      width: 240, flexShrink: 0,
      background: "#07101d",
      borderRight: "1px solid #132035",
      display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #132035" }}>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.15em", color: AXIS_CLR }}>CMT CHART ENGINE</span>
      </div>

      {CATEGORIES.map(cat => {
        const catCharts = CHARTS.filter(c => c.category === cat.id);
        const Icon = cat.icon;
        const isOpen = !collapsed[cat.id];
        return (
          <div key={cat.id}>
            <button onClick={() => toggle(cat.id)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
              background: "none", border: "none", cursor: "pointer",
              borderBottom: "1px solid #0d1f3522",
            }}>
              <Icon size={12} color={cat.color} />
              <span style={{ fontFamily: FONT, fontSize: 10, color: cat.color, letterSpacing: "0.08em", flex: 1, textAlign: "left" }}>
                {cat.label.toUpperCase()}
              </span>
              {isOpen ? <ChevronDown size={11} color={AXIS_CLR} /> : <ChevronRight size={11} color={AXIS_CLR} />}
            </button>
            {isOpen && catCharts.map(chart => (
              <button key={chart.id} onClick={() => onSelect(chart.id)} style={{
                width: "100%", display: "flex", alignItems: "flex-start", gap: 8,
                padding: "7px 12px 7px 20px",
                background: selected === chart.id ? `${cat.color}15` : "none",
                border: "none",
                borderLeft: selected === chart.id ? `2px solid ${cat.color}` : "2px solid transparent",
                cursor: "pointer", textAlign: "left",
              }}>
                <span style={{ fontFamily: FONT, fontSize: 9, color: selected === chart.id ? cat.color : AXIS_CLR, minWidth: 20, paddingTop: 1 }}>
                  {chart.id}
                </span>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 11, color: selected === chart.id ? "#e2e8f0" : "#94a3b8" }}>{chart.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: AXIS_CLR, marginTop: 1, lineHeight: 1.3 }}>{chart.desc}</div>
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ChartEngine ─────────────────────────────────────────────────────────
export default function ChartEngine() {
  const [selected, setSelected] = useState("1A");
  const [tf, setTF] = useState<TF>("2Y");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Global ticker state — drives all per-ticker chart endpoints + price overlay label
  const [globalTicker, setGlobalTicker] = useState("SPY");
  const [tickerInput, setTickerInput] = useState("SPY");
  const tickerInputRef = useRef<HTMLInputElement>(null);

  const commitTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) setGlobalTicker(t);
  };

  const activeDef = CHARTS.find(c => c.id === selected) ?? CHARTS[0];
  const activeCat = CATEGORIES.find(c => c.id === activeDef.category);

  return (
    <div style={{
      display: "flex", width: "100%", height: "100%",
      background: BG, overflow: "hidden",
      flexDirection: "column",
    }}>

      {/* ── Persistent Ticker Control Bar — sits directly below tab nav ─────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 14px",
        borderBottom: "1px solid #132035",
        background: "#04080f",
        flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 9, color: AXIS_CLR, letterSpacing: "0.12em", whiteSpace: "nowrap" }}>
          TICKER
        </span>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            ref={tickerInputRef}
            value={tickerInput}
            onChange={e => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === "Enter") commitTicker(); }}
            onBlur={commitTicker}
            placeholder="SPY"
            style={{
              background: "#07101d",
              border: `1px solid ${tickerInput.trim().toUpperCase() !== globalTicker ? AMBER + "88" : "#1a2d47"}`,
              color: "#e2e8f0",
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              padding: "4px 10px",
              width: 90,
              borderRadius: 3,
              outline: "none",
              textTransform: "uppercase",
            }}
          />
        </div>
        {/* Active ticker badge */}
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `${ACCENT}18`,
          border: `1px solid ${ACCENT}44`,
          borderRadius: 3, padding: "3px 8px",
        }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: ACCENT }} />
          <span style={{ fontFamily: FONT, fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: "0.08em" }}>
            {globalTicker}
          </span>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 9, color: AXIS_CLR }}>
          ↵ Enter to apply
        </span>
      </div>

      {/* ── Main content: sidebar + chart area ─────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <Sidebar selected={selected} onSelect={setSelected} collapsed={collapsed} setCollapsed={setCollapsed} />

        {/* Right side: topbar + chart fills all remaining space */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Top bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "7px 14px",
            borderBottom: "1px solid #132035", background: "#07101d", flexShrink: 0,
          }}>
            <Layers size={13} color={activeCat?.color ?? ACCENT} />
            <span style={{ fontFamily: FONT, fontSize: 12, color: "#e2e8f0", fontWeight: 600 }}>{activeDef.label}</span>
            <span style={{ fontFamily: FONT, fontSize: 10, color: AXIS_CLR, flex: 1 }}>{activeDef.desc}</span>

            <div style={{ display: "flex", gap: 4 }}>
              {(["1Y","2Y","5Y","10Y"] as TF[]).map(t => (
                <button key={t} onClick={() => setTF(t)} style={{
                  background: tf === t ? `${BLUE}22` : "none",
                  border: `1px solid ${tf === t ? BLUE : "#132035"}`,
                  color: tf === t ? BLUE : AXIS_CLR,
                  fontFamily: FONT, fontSize: 10,
                  padding: "3px 8px", cursor: "pointer", borderRadius: 2,
                }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Chart — takes ALL remaining height */}
          <div style={{ flex: 1, padding: 12, overflow: "hidden", minHeight: 0, display: "flex" }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              <ChartPanel key={`${selected}-${tf}-${globalTicker}`} def={activeDef} tf={tf} globalTicker={globalTicker} />
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
