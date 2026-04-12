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
// showPrice: true  = indicator top 63%, price bottom 32%, gap 5%
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

  // ── Shared layout constants ────────────────────────────────────────────────
  const IND_DOMAIN_FULL: [number,number]   = [0.0,  1.0];
  const IND_DOMAIN_SPLIT: [number,number]  = [0.36, 1.0];
  const PRICE_DOMAIN: [number,number]      = [0.0,  0.32];

  const indDomain  = hasPricePane ? IND_DOMAIN_SPLIT : IND_DOMAIN_FULL;

  // Shared axis style
  const ax = (extra: any = {}): any => ({
    gridcolor: "#0d1f35",
    gridwidth: 0.5,
    linecolor: "#0d1f35",
    linewidth: 0.5,
    zerolinecolor: "#1e3a5f",
    zerolinewidth: 1,
    tickfont: { family: FONT, size: 10, color: "#64748b" },
    color: "#64748b",
    showgrid: true,
    ...extra,
  });

  const baseL = (): any => ({
    paper_bgcolor: "#060b14",
    plot_bgcolor:  "#060b14",
    font: { family: FONT, size: 10, color: "#64748b" },
    margin: { l: 60, r: 20, t: 10, b: 40 },
    showlegend: true,
    legend: {
      x: 0.01, y: 0.99, xanchor: "left", yanchor: "top",
      bgcolor: "rgba(6,11,20,0.75)", bordercolor: "#0d1f35", borderwidth: 1,
      font: { family: FONT, size: 9, color: "#64748b" },
      orientation: "h",
    },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#0f172a", bordercolor: "#1e293b", font: { family: FONT, size: 10 } },
    dragmode: "pan",
  });

  // Helper: right-edge annotation
  const rightAnnot = (text: string, y: number, yref: string, color: string, yanchor = "middle"): any => ({
    xref: "paper", x: 1.0, xanchor: "left",
    yref, y, yanchor,
    text, showarrow: false,
    font: { family: FONT, size: 8, color },
  });

  // Helper: horizontal dotted reference line
  const refLine = (y: number, yref: string, color = "#334155", width = 1, dash = "dot"): any => ({
    type: "line", xref: "paper", x0: 0, x1: 1,
    yref, y0: y, y1: y,
    line: { color, width, dash },
  });

  // Helper: full-width vertical line (for signals)
  const vline = (x: string, color: string, width = 1): any => ({
    type: "line", yref: "paper", y0: 0, y1: 1,
    xref: "x", x0: x, x1: x,
    line: { color, width, dash: "solid" },
  });

  // Helper: price area trace on y1
  const priceAreaTrace = (dates: string[], closes: number[], label: string): any => ({
    type: "scatter", mode: "lines",
    x: dates, y: closes, name: label, yaxis: "y1",
    line: { color: "#38bdf8", width: 1 },
    fill: "tozeroy", fillcolor: "rgba(56,189,248,0.06)",
    hovertemplate: `${label}: %{y:.2f}<extra></extra>`,
  });

  // Build filtered price arrays
  let priceDates: string[] = [];
  let priceClose: number[] = [];
  if (hasPricePane && priceData) {
    const pf = filterDates(priceData, tf);
    pf.forEach((b: any) => { if (b.close != null) { priceDates.push(b.date); priceClose.push(b.close); } });
  }

  // Standard dual-pane layout builder
  const dualLayout = (extraShapes: any[] = [], extraAnnots: any[] = []): any => ({
    ...baseL(),
    shapes: extraShapes,
    annotations: extraAnnots,
    ...(hasPricePane ? {
      yaxis:  ax({ domain: PRICE_DOMAIN, side: "right", color: "#334155", tickfont: { family: FONT, size: 9, color: "#334155" }, showgrid: false }),
      yaxis2: ax({ domain: IND_DOMAIN_SPLIT, side: "left" }),
      xaxis:  ax({ anchor: "y2", matches: "x" }),
    } : {
      yaxis2: ax({ domain: IND_DOMAIN_FULL, side: "left" }),
      xaxis:  ax({ anchor: "y2" }),
    }),
  });

  // ── Sector Rotation scatter ────────────────────────────────────────────────
  if (def.id === "3E") {
    if (!Array.isArray(indData) || !indData.length) return null;
    // Quadrant colors
    const qColor = (d: any) => d.rs > 0 && d.momentum > 0 ? "#22c55e"
      : d.rs <= 0 && d.momentum > 0 ? "#eab308"
      : d.rs > 0 && d.momentum <= 0 ? "#38bdf8"
      : "#ef4444";
    const colors = indData.map(qColor);

    // Quadrant background shapes
    const qShapes: any[] = [
      { type: "rect", xref: "paper", yref: "paper", x0: 0.5, x1: 1, y0: 0.5, y1: 1, fillcolor: "rgba(34,197,94,0.06)",  line: { width: 0 } },
      { type: "rect", xref: "paper", yref: "paper", x0: 0,   x1: 0.5, y0: 0.5, y1: 1, fillcolor: "rgba(234,179,8,0.06)", line: { width: 0 } },
      { type: "rect", xref: "paper", yref: "paper", x0: 0,   x1: 0.5, y0: 0,   y1: 0.5, fillcolor: "rgba(239,68,68,0.06)",  line: { width: 0 } },
      { type: "rect", xref: "paper", yref: "paper", x0: 0.5, x1: 1,   y0: 0,   y1: 0.5, fillcolor: "rgba(56,189,248,0.06)", line: { width: 0 } },
    ];

    const qAnnots: any[] = [
      { xref: "paper", yref: "paper", x: 0.97, y: 0.97, text: "LEADING",   showarrow: false, font: { family: FONT, size: 9, color: "#22c55e" }, xanchor: "right", yanchor: "top" },
      { xref: "paper", yref: "paper", x: 0.03, y: 0.97, text: "WEAKENING", showarrow: false, font: { family: FONT, size: 9, color: "#eab308" }, xanchor: "left",  yanchor: "top" },
      { xref: "paper", yref: "paper", x: 0.03, y: 0.03, text: "LAGGING",   showarrow: false, font: { family: FONT, size: 9, color: "#ef4444" }, xanchor: "left",  yanchor: "bottom" },
      { xref: "paper", yref: "paper", x: 0.97, y: 0.03, text: "IMPROVING", showarrow: false, font: { family: FONT, size: 9, color: "#38bdf8" }, xanchor: "right", yanchor: "bottom" },
    ];

    return {
      data: [
        {
          type: "scatter", mode: "markers",
          x: indData.map((d: any) => d.rs),
          y: indData.map((d: any) => d.momentum),
          marker: { color: colors, size: 10, opacity: 0.9, line: { color: colors, width: 1 } },
          hovertemplate: "<b>%{text}</b><br>RS: %{x:.2f}<br>Mom: %{y:.2f}<extra></extra>",
          text: indData.map((d: any) => d.symbol),
          showlegend: false,
        } as any,
        // Sector label annotations rendered as scatter text
        {
          type: "scatter", mode: "text",
          x: indData.map((d: any) => d.rs),
          y: indData.map((d: any) => d.momentum),
          text: indData.map((d: any) => d.symbol),
          textposition: "top center",
          textfont: { family: FONT, size: 9, color: colors },
          hoverinfo: "skip",
          showlegend: false,
        } as any,
      ],
      layout: {
        ...baseL(),
        shapes: qShapes,
        annotations: qAnnots,
        xaxis: ax({ title: { text: "Relative Strength", font: { family: FONT, size: 10, color: "#64748b" } }, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1.5 }),
        yaxis: ax({ title: { text: "Momentum", font: { family: FONT, size: 10, color: "#64748b" } }, zeroline: true, zerolinecolor: "#1e3a5f", zerolinewidth: 1.5 }),
      },
    };
  }

  // ── SPY Volume ──────────────────────────────────────────────────────────────
  if (def.id === "4C") {
    if (!Array.isArray(indData) || !indData.length) return null;
    const d = filterDates(indData, tf);
    const dates  = d.map((r: any) => r.date);
    const closes = d.map((r: any) => r.close);
    const vols   = d.map((r: any) => r.volume);
    const avg20  = d.map((r: any) => r.avgVol20);
    const volColors = d.map((r: any) =>
      (r.avgVol20 != null && r.volume > r.avgVol20) ? "rgba(239,68,68,0.75)" : "rgba(56,189,248,0.35)"
    );
    return {
      data: [
        { type: "scatter", mode: "lines", x: dates, y: closes, yaxis: "y1", name: "SPY",
          line: { color: "#38bdf8", width: 1 }, fill: "tozeroy", fillcolor: "rgba(56,189,248,0.06)",
          hovertemplate: "SPY: %{y:.2f}<extra></extra>" } as any,
        { type: "bar", x: dates, y: vols, yaxis: "y2", name: "Volume",
          marker: { color: volColors }, hovertemplate: "Vol: %{y:,.0f}<extra></extra>" } as any,
        { type: "scatter", mode: "lines", x: dates, y: avg20, yaxis: "y2", name: "20d Avg",
          line: { color: "#eab308", width: 1.5, dash: "dot" },
          hovertemplate: "20d Avg: %{y:,.0f}<extra></extra>" } as any,
      ],
      layout: {
        ...baseL(),
        yaxis:  ax({ domain: [0.38, 1.0], side: "right", color: "#334155", showgrid: false }),
        yaxis2: ax({ domain: [0.0, 0.34], side: "left" }),
        xaxis:  ax({ anchor: "y2", matches: "x" }),
        shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "paper", y0: 0.36, y1: 0.36, line: { color: "#0d1f35", width: 1 } }],
      },
    };
  }

  // ── Fed Balance Sheet ────────────────────────────────────────────────────
  if (def.id === "3D") {
    if (!Array.isArray(indData) || !indData.length) return null;
    const d = filterDates(indData, tf);
    return {
      data: [
        { type: "scatter", mode: "lines", x: d.map((r: any) => r.date), y: d.map((r: any) => r.fedBS),
          name: "Fed Assets ($B)", fill: "tozeroy", fillcolor: "rgba(56,189,248,0.08)",
          line: { color: "#38bdf8", width: 1.5 }, yaxis: "y1",
          hovertemplate: "Fed BS: $%{y:.0f}B<extra></extra>" } as any,
        { type: "scatter", mode: "lines", x: d.map((r: any) => r.date), y: d.map((r: any) => r.spyClose),
          name: "SPY", line: { color: "#22c55e", width: 1.5 }, yaxis: "y2",
          hovertemplate: "SPY: %{y:.2f}<extra></extra>" } as any,
      ],
      layout: {
        ...baseL(),
        yaxis:  ax({ title: { text: "Fed Assets ($B)", font: { size: 9, color: "#38bdf8", family: FONT } }, side: "left" }),
        yaxis2: ax({ title: { text: "SPY", font: { size: 9, color: "#22c55e", family: FONT } }, side: "right", overlaying: "y" }),
        xaxis:  ax({}),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────
  // STANDARD DUAL-PANE CHARTS
  // ───────────────────────────────────────────────────────────────
  const traces: any[] = [];
  const shapes: any[] = [];
  const annots: any[] = [];
  const raw = Array.isArray(indData) ? filterDates(indData, tf) : [];

  // Price trace (y1, bottom pane)
  if (hasPricePane) {
    traces.push(priceAreaTrace(priceDates, priceClose, activeTicker));
  }

  switch (def.id) {

    // ── 1A: % Above Moving Averages ──────────────────────────────────────
    case "1A": {
      const x   = raw.map((d: any) => d.date);
      const v200 = raw.map((d: any) => d.pct200 ?? null);
      traces.push(
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.pct20  ?? null), name: "20d MA",  yaxis: "y2", line: { color: "#38bdf8", width: 1.5 }, hovertemplate: "20d: %{y:.0f}%<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.pct50  ?? null), name: "50d MA",  yaxis: "y2", line: { color: "#eab308", width: 1.5 }, hovertemplate: "50d: %{y:.0f}%<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: v200, name: "200d MA", yaxis: "y2", line: { color: "#22c55e", width: 1.5 }, hovertemplate: "200d: %{y:.0f}%<extra></extra>" },
      );
      // Background zones based on % above 200d
      raw.forEach((d: any, i: number) => {
        if (i === 0 || !d.pct200 || !raw[i-1].pct200) return;
        const v = d.pct200;
        const color = v > 60 ? "rgba(34,197,94,0.04)" : v < 40 ? "rgba(239,68,68,0.04)" : null;
        if (color) {
          shapes.push({ type: "rect", xref: "x", yref: "paper",
            x0: raw[i-1].date, x1: d.date,
            y0: hasPricePane ? IND_DOMAIN_SPLIT[0] : 0,
            y1: 1,
            fillcolor: color, line: { width: 0 }, layer: "below" });
        }
      });
      shapes.push(
        refLine(80, "y2", "#1e3a5f"), refLine(60, "y2"),
        refLine(40, "y2"), refLine(20, "y2", "#1e3a5f"),
      );
      break;
    }

    // ── 1B: McClellan Oscillator ──────────────────────────────────────────
    case "1B": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      traces.push({
        type: "bar", x, y, name: "McClellan", yaxis: "y2",
        marker: { color: y.map((v: any) => (v ?? 0) >= 0 ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)") },
        hovertemplate: "McC: %{y:.2f}<extra></extra>",
      });
      shapes.push(
        { ...refLine(0,   "y2", "#1e3a5f", 1.5, "solid") },
        { ...refLine(50,  "y2", "#475569", 1,   "dash") },
        { ...refLine(-50, "y2", "#475569", 1,   "dash") },
      );
      annots.push(
        rightAnnot("OVERBOUGHT",  50,  "y2", "#475569", "bottom"),
        rightAnnot("OVERSOLD",   -50,  "y2", "#475569", "top"),
      );
      break;
    }

    // ── 1C: RSI Breadth ───────────────────────────────────────────────────
    case "1C": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: "Median RSI", yaxis: "y2", line: { color: "#38bdf8", width: 1.5 },
        hovertemplate: "RSI: %{y:.1f}<extra></extra>" });
      shapes.push(
        refLine(70, "y2", "#475569", 1, "dash"),
        refLine(50, "y2"),
        refLine(30, "y2", "#475569", 1, "dash"),
      );
      annots.push(
        rightAnnot("OB 70", 70, "y2", "#475569", "bottom"),
        rightAnnot("OS 30", 30, "y2", "#475569", "top"),
      );
      break;
    }

    // ── 1D: MACD Breadth ─────────────────────────────────────────────────
    case "1D": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: "% MACD Bullish", yaxis: "y2", line: { color: "#eab308", width: 1.5 },
        hovertemplate: "MACD Breadth: %{y:.1f}%<extra></extra>" });
      shapes.push(refLine(50, "y2"), refLine(80, "y2", "#475569", 1, "dash"), refLine(20, "y2", "#475569", 1, "dash"));
      annots.push(rightAnnot("80", 80, "y2", "#475569"), rightAnnot("20", 20, "y2", "#475569"));
      break;
    }

    // ── 1E: Zweig Breadth Thrust ───────────────────────────────────────────
    case "1E": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      traces.push({ type: "scatter", mode: "lines", x, y,
        name: "Zweig Thrust", yaxis: "y2", line: { color: "#38bdf8", width: 1.5 },
        hovertemplate: "ZBT: %{y:.4f}<extra></extra>" });
      // Neutral zone 0.40–0.615 shaded
      shapes.push(
        { type: "rect", xref: "paper", yref: "y2", x0: 0, x1: 1,
          y0: 0.40, y1: 0.615, fillcolor: "rgba(234,179,8,0.08)", line: { width: 0 }, layer: "below" },
        refLine(0.615, "y2", "#22c55e", 1, "dash"),
        refLine(0.40,  "y2", "#ef4444", 1, "dash"),
        refLine(0.5,   "y2"),
      );
      annots.push(
        rightAnnot("THRUST 0.615", 0.615, "y2", "#22c55e", "bottom"),
        rightAnnot("BEAR 0.40",    0.40,  "y2", "#ef4444", "top"),
      );
      // Detect ZBT signals: value crosses from <0.40 to >0.615 within 10 days
      for (let i = 1; i < raw.length; i++) {
        const cur = raw[i].value ?? 0;
        if (cur >= 0.615) {
          // Look back 10 bars for a reading below 0.40
          const lookback = raw.slice(Math.max(0, i - 10), i);
          const hadLow = lookback.some((d: any) => (d.value ?? 1) < 0.40);
          if (hadLow) {
            shapes.push({ type: "line", xref: "x", yref: "paper",
              x0: raw[i].date, x1: raw[i].date, y0: 0, y1: 1,
              line: { color: "#22c55e", width: 1.5, dash: "solid" } });
            annots.push({ xref: "x", yref: "paper", x: raw[i].date, y: 0.98,
              text: "ZBT", showarrow: false,
              font: { family: FONT, size: 9, color: "#22c55e" }, yanchor: "top", xanchor: "center" });
          }
        }
      }
      break;
    }

    // ── 1F: A-D Line ───────────────────────────────────────────────────────────
    case "1F": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: "A-D Line", yaxis: "y2",
        line: { color: "#38bdf8", width: 1.5 },
        fill: "tozeroy", fillcolor: "rgba(56,189,248,0.08)",
        hovertemplate: "A-D: %{y:.0f}<extra></extra>" });
      break;
    }

    // ── 2A/2B/2C/2D: COT Positioning ───────────────────────────────────────
    case "2A": case "2B": case "2C": case "2D": {
      const x = raw.map((d: any) => d.date);
      const specVals = raw.map((d: any) => d.largeSpecNet ?? null);
      // Large Spec as green/red histogram
      traces.push({
        type: "bar", x, y: specVals, name: "Large Spec Net", yaxis: "y2",
        marker: { color: specVals.map((v: any) => (v ?? 0) >= 0 ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)") },
        hovertemplate: "Spec: %{y:,.0f}<extra></extra>",
      });
      // Asset Manager as thick blue line
      traces.push({
        type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.assetMgrNet ?? null),
        name: "Asset Mgr Net", yaxis: "y2",
        line: { color: "#38bdf8", width: 2 },
        hovertemplate: "AssetMgr: %{y:,.0f}<extra></extra>",
      });
      // ±2 SD lines
      const validSpec = specVals.filter((v: any) => v != null) as number[];
      if (validSpec.length > 10) {
        const mean = validSpec.reduce((a: number, b: number) => a + b, 0) / validSpec.length;
        const std  = Math.sqrt(validSpec.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / validSpec.length);
        const hi = mean + 2 * std;
        const lo = mean - 2 * std;
        shapes.push(
          refLine(hi, "y2", "#ef4444", 1, "dash"),
          refLine(lo, "y2", "#22c55e", 1, "dash"),
          refLine(0,  "y2", "#1e3a5f", 1, "solid"),
        );
        annots.push(
          rightAnnot("MAX CROWDED LONG",  hi, "y2", "#ef4444", "bottom"),
          rightAnnot("MAX CROWDED SHORT", lo, "y2", "#22c55e", "top"),
        );
      }
      break;
    }

    // ── 2E: CTA Trend Model ────────────────────────────────────────────────
    case "2E": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      // Positive fill
      traces.push({ type: "scatter", mode: "lines", x,
        y: y.map((v: any) => v != null ? Math.max(0, v) : null),
        name: "CTA Long", yaxis: "y2",
        line: { color: "rgba(34,197,94,0)", width: 0 },
        fill: "tozeroy", fillcolor: "rgba(34,197,94,0.08)",
        showlegend: false, hoverinfo: "skip" });
      // Negative fill
      traces.push({ type: "scatter", mode: "lines", x,
        y: y.map((v: any) => v != null ? Math.min(0, v) : null),
        name: "CTA Short", yaxis: "y2",
        line: { color: "rgba(239,68,68,0)", width: 0 },
        fill: "tozeroy", fillcolor: "rgba(239,68,68,0.08)",
        showlegend: false, hoverinfo: "skip" });
      // Main line
      traces.push({ type: "scatter", mode: "lines", x, y,
        name: "CTA Exposure", yaxis: "y2",
        line: { color: "#ef4444", width: 2 },
        hovertemplate: "CTA: %{y:.1f}<extra></extra>" });
      shapes.push(
        refLine(0,   "y2", "#1e3a5f", 1, "solid"),
        refLine(75,  "y2", "#475569", 1, "dash"),
        refLine(-75, "y2", "#475569", 1, "dash"),
      );
      annots.push(
        rightAnnot("MAX CROWDED LONG",  75,  "y2", "#475569", "bottom"),
        rightAnnot("MAX CROWDED SHORT", -75, "y2", "#475569", "top"),
      );
      break;
    }

    // ── 2F: Put/Call Proxy ─────────────────────────────────────────────────
    case "2F": {
      const x  = raw.map((d: any) => d.date);
      const y  = raw.map((d: any) => d.value ?? null);
      // 10-day SMA of the P/C proxy
      const smaY: (number|null)[] = y.map((_: any, i: number) => {
        if (i < 9) return null;
        const slice = y.slice(i - 9, i + 1).filter((v: any) => v != null) as number[];
        return slice.length === 10 ? slice.reduce((a: number, b: number) => a + b, 0) / 10 : null;
      });
      traces.push(
        { type: "scatter", mode: "lines", x, y, name: "P/C Proxy", yaxis: "y2",
          line: { color: "#eab308", width: 1.5 }, hovertemplate: "P/C: %{y:.1f}<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: smaY, name: "10d SMA", yaxis: "y2",
          line: { color: "#38bdf8", width: 1, dash: "dash" }, hovertemplate: "SMA: %{y:.1f}<extra></extra>" },
      );
      shapes.push(
        refLine(85, "y2", "#ef4444", 1, "dash"),
        refLine(50, "y2"),
        refLine(20, "y2", "#22c55e", 1, "dash"),
      );
      annots.push(
        rightAnnot("FEAR THRESHOLD 85", 85, "y2", "#ef4444", "bottom"),
        rightAnnot("20", 20, "y2", "#22c55e", "top"),
      );
      // Buy signal markers on price pane: every time P/C proxy crosses above 85
      if (hasPricePane && priceData) {
        const priceMap = new Map(filterDates(priceData, tf).map((b: any) => [b.date, b.close]));
        const sigDates: string[] = [];
        const sigPrices: number[] = [];
        for (let i = 1; i < raw.length; i++) {
          const prev = raw[i-1].value ?? 0;
          const cur  = raw[i].value   ?? 0;
          if (prev < 85 && cur >= 85) {
            const p = priceMap.get(raw[i].date);
            if (p != null) { sigDates.push(raw[i].date); sigPrices.push(p); }
          }
        }
        if (sigDates.length) {
          traces.push({ type: "scatter", mode: "markers", x: sigDates, y: sigPrices,
            name: "Buy Signal", yaxis: "y1",
            marker: { symbol: "circle", color: "#22c55e", size: 8, line: { color: "#22c55e", width: 1 } },
            hovertemplate: "BUY: %{y:.2f}<extra></extra>" });
        }
      }
      break;
    }

    // ── 2G: Speculative Vol (VIX) ────────────────────────────────────────
    case "2G": {
      const x = raw.map((d: any) => d.date);
      traces.push(
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
          name: "VIX", yaxis: "y2", line: { color: "#38bdf8", width: 1.5 },
          hovertemplate: "VIX: %{y:.2f}<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.vixSMA20 ?? null),
          name: "VIX 20d SMA", yaxis: "y2", line: { color: "#eab308", width: 1.5 },
          hovertemplate: "SMA20: %{y:.2f}<extra></extra>" },
      );
      shapes.push(
        refLine(20, "y2"), refLine(30, "y2", "#eab308", 1, "dash"),
        refLine(40, "y2", "#ef4444", 1, "dash"),
      );
      annots.push(
        rightAnnot("VIX 30", 30, "y2", "#eab308"),
        rightAnnot("VIX 40", 40, "y2", "#ef4444"),
      );
      break;
    }

    // ── 2H: Sentiment Composite ──────────────────────────────────────────
    case "2H": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: "Sentiment Score", yaxis: "y2",
        line: { color: "#38bdf8", width: 1.5 },
        fill: "tozeroy", fillcolor: "rgba(56,189,248,0.06)",
        hovertemplate: "Sentiment: %{y:.1f}<extra></extra>" });
      shapes.push(
        refLine(80, "y2", "#475569", 1, "dash"),
        refLine(50, "y2"),
        refLine(20, "y2", "#475569", 1, "dash"),
      );
      annots.push(
        rightAnnot("EXTREME BULL", 80, "y2", "#475569", "bottom"),
        rightAnnot("EXTREME BEAR", 20, "y2", "#475569", "top"),
      );
      break;
    }

    // ── 3A: Liquidity Composite ──────────────────────────────────────────
    case "3A": {
      const x = raw.map((d: any) => d.date);
      const yComp = raw.map((d: any) => d.composite ?? null);
      traces.push(
        { type: "scatter", mode: "lines", x, y: yComp,
          name: "Composite", yaxis: "y2", line: { color: "#38bdf8", width: 2 },
          hovertemplate: "Composite: %{y:.3f}<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.m2 ?? null),
          name: "M2", yaxis: "y2", line: { color: "#eab308", width: 1, dash: "dot" },
          hovertemplate: "M2: %{y:.3f}<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.rrp ?? null),
          name: "RRP", yaxis: "y2", line: { color: "#a855f7", width: 1, dash: "dot" },
          hovertemplate: "RRP: %{y:.3f}<extra></extra>" },
      );
      // Background regime zones
      shapes.push(
        { type: "rect", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: 0.67, y1: 1.5,  fillcolor: "rgba(34,197,94,0.08)",  line: { width: 0 }, layer: "below" },
        { type: "rect", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: 0.33, y1: 0.67, fillcolor: "rgba(234,179,8,0.06)",  line: { width: 0 }, layer: "below" },
        { type: "rect", xref: "paper", yref: "y2", x0: 0, x1: 1, y0: -0.5, y1: 0.33, fillcolor: "rgba(239,68,68,0.08)",  line: { width: 0 }, layer: "below" },
        refLine(0.67, "y2", "#334155"), refLine(0.33, "y2", "#334155"),
      );
      annots.push(
        rightAnnot("LOOSE",   0.84, "y2", "#22c55e"),
        rightAnnot("NEUTRAL", 0.50, "y2", "#eab308"),
        rightAnnot("TIGHT",   0.16, "y2", "#ef4444"),
      );
      // Current regime annotation top-right
      const lastVal = yComp.filter((v: any) => v != null).slice(-1)[0];
      if (lastVal != null) {
        const regimeLabel = lastVal > 0.67 ? "LOOSE" : lastVal > 0.33 ? "NEUTRAL" : "TIGHT";
        const regimeColor = lastVal > 0.67 ? "#22c55e" : lastVal > 0.33 ? "#eab308" : "#ef4444";
        annots.push({
          xref: "paper", yref: "paper", x: 0.99, y: 0.99,
          xanchor: "right", yanchor: "top",
          text: `<b>${regimeLabel}</b> ${lastVal.toFixed(2)}`,
          showarrow: false,
          font: { family: FONT, size: 14, color: regimeColor },
          bgcolor: "rgba(6,11,20,0.7)", bordercolor: regimeColor, borderwidth: 1, borderpad: 4,
        });
      }
      break;
    }

    // ── 3B: Yield Curve ─────────────────────────────────────────────────────
    case "3B": {
      const x     = raw.map((d: any) => d.date);
      const y2y   = raw.map((d: any) => d.t10y2y ?? null);
      const y3m   = raw.map((d: any) => d.t10y3m ?? null);
      traces.push(
        { type: "scatter", mode: "lines", x, y: y2y, name: "10Y-2Y", yaxis: "y2",
          line: { color: "#38bdf8", width: 1.5 }, hovertemplate: "10Y-2Y: %{y:.2f}%<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: y3m, name: "10Y-3M", yaxis: "y2",
          line: { color: "#eab308", width: 1.5 }, hovertemplate: "10Y-3M: %{y:.2f}%<extra></extra>" },
      );
      shapes.push({ ...refLine(0, "y2", "#475569", 1.5, "solid") });
      // Background shading: both below 0 = red, both above 0 = green
      for (let i = 1; i < raw.length; i++) {
        const a2 = raw[i].t10y2y ?? null; const b2 = raw[i-1].t10y2y ?? null;
        const a3 = raw[i].t10y3m ?? null; const b3 = raw[i-1].t10y3m ?? null;
        if (a2 == null || a3 == null) continue;
        const color = (a2 < 0 && a3 < 0) ? "rgba(239,68,68,0.08)"
          : (a2 > 0 && a3 > 0) ? "rgba(34,197,94,0.06)" : null;
        if (color) {
          shapes.push({ type: "rect", xref: "x", yref: "paper",
            x0: raw[i-1].date, x1: raw[i].date,
            y0: hasPricePane ? IND_DOMAIN_SPLIT[0] : 0, y1: 1,
            fillcolor: color, line: { width: 0 }, layer: "below" });
        }
      }
      break;
    }

    // ── 3C: Credit Spreads ────────────────────────────────────────────────
    case "3C": {
      const x = raw.map((d: any) => d.date);
      traces.push(
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.hyOAS  ?? null),
          name: "HY OAS", yaxis: "y2", line: { color: "#38bdf8", width: 1.5 },
          hovertemplate: "HY OAS: %{y:.2f}%<extra></extra>" },
        { type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.bbbOAS ?? null),
          name: "BBB OAS", yaxis: "y2", line: { color: "#eab308", width: 1.5 },
          hovertemplate: "BBB OAS: %{y:.2f}%<extra></extra>" },
      );
      break;
    }

    // ── 3F: Ratio chart ─────────────────────────────────────────────────────
    case "3F": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: "XLE/SPY", yaxis: "y2",
        line: { color: "#eab308", width: 1.5 },
        fill: "tozeroy", fillcolor: "rgba(234,179,8,0.06)",
        hovertemplate: "XLE/SPY: %{y:.4f}<extra></extra>" });
      break;
    }

    // ── 4A: Trend Power Oscillator ─────────────────────────────────────────
    case "4A": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      traces.push({ type: "bar", x, y, name: "Trend Power", yaxis: "y2",
        marker: { color: y.map((v: any) => {
          const n = v ?? 0;
          return n >= 0.5 ? "rgba(34,197,94,0.8)" : n <= -0.5 ? "rgba(239,68,68,0.8)" : "rgba(234,179,8,0.8)";
        })},
        hovertemplate: "TPO: %{y:.3f}<extra></extra>" });
      shapes.push(refLine(0, "y2", "#1e3a5f", 1.5, "solid"));
      break;
    }

    // ── 4B: DSI Proxy ──────────────────────────────────────────────────────────
    case "4B": {
      const x = raw.map((d: any) => d.date);
      const y = raw.map((d: any) => d.value ?? null);
      traces.push({ type: "scatter", mode: "lines", x, y,
        name: "DSI Proxy", yaxis: "y2",
        line: { color: "#eab308", width: 1.5 },
        hovertemplate: "DSI: %{y:.1f}<extra></extra>" });
      shapes.push(
        refLine(80, "y2", "#475569", 1, "dash"),
        refLine(20, "y2", "#475569", 1, "dash"),
        refLine(50, "y2"),
      );
      annots.push(
        rightAnnot("OB 80", 80, "y2", "#475569", "bottom"),
        rightAnnot("OS 20", 20, "y2", "#475569", "top"),
      );
      // Buy signal circles: every cross below 20 → mark on price pane
      if (hasPricePane && priceData) {
        const priceMap = new Map(filterDates(priceData, tf).map((b: any) => [b.date, b.close]));
        const sigDates: string[] = []; const sigPrices: number[] = [];
        for (let i = 1; i < raw.length; i++) {
          if ((raw[i-1].value ?? 100) >= 20 && (raw[i].value ?? 100) < 20) {
            const p = priceMap.get(raw[i].date);
            if (p != null) { sigDates.push(raw[i].date); sigPrices.push(p); }
          }
        }
        if (sigDates.length) {
          traces.push({ type: "scatter", mode: "markers", x: sigDates, y: sigPrices,
            name: "DSI Buy", yaxis: "y1",
            marker: { symbol: "circle", color: "#22c55e", size: 8, line: { color: "#22c55e", width: 1 } },
            hovertemplate: "DSI BUY: %{y:.2f}<extra></extra>" });
        }
      }
      break;
    }

    // ── 4D: ATR Extension ──────────────────────────────────────────────────
    case "4D": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.pctExtension ?? null),
        name: "ATR Extension", yaxis: "y2",
        line: { color: "#eab308", width: 1.5 },
        fill: "tozeroy", fillcolor: "rgba(234,179,8,0.06)",
        hovertemplate: "ATR Ext: %{y:.2f}<extra></extra>" });
      shapes.push(
        refLine( 2, "y2", "#ef4444", 1, "dash"),
        refLine(-2, "y2", "#22c55e", 1, "dash"),
        refLine( 0, "y2", "#1e3a5f", 1, "solid"),
      );
      annots.push(
        rightAnnot("+2 ATR", 2,  "y2", "#ef4444", "bottom"),
        rightAnnot("-2 ATR", -2, "y2", "#22c55e", "top"),
      );
      break;
    }

    // ── 4E: Relative Strength ───────────────────────────────────────────────
    case "4E": {
      const x = raw.map((d: any) => d.date);
      traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
        name: `${activeTicker}/SPY`, yaxis: "y2",
        line: { color: "#a855f7", width: 1.5 },
        fill: "tozeroy", fillcolor: "rgba(168,85,247,0.06)",
        hovertemplate: "RS: %{y:.4f}<extra></extra>" });
      break;
    }

    default: {
      const x = raw.map((d: any) => d.date);
      if (raw.length > 0 && raw[0].value !== undefined) {
        traces.push({ type: "scatter", mode: "lines", x, y: raw.map((d: any) => d.value ?? null),
          name: def.label, yaxis: "y2", line: { color: "#38bdf8", width: 1.5 },
          hovertemplate: `${def.label}: %{y:.3f}<extra></extra>` });
      }
    }
  }

  return { data: traces, layout: dualLayout(shapes, annots) };
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
