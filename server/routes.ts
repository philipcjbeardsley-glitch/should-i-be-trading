import type { Express } from "express";
import type { Server } from "http";
import { fetchAllMarketData } from "./marketData";
import { fetchMacroIntelligence } from "./macroData";
import { fetchThemeTrackerData, fetchSectorSnapshot, fetchCOTData } from "./themeData";
import { fetchBreadthData, fetchSetupsData } from "./breadthData";
import { runExpectancyQuery, parseNaturalQuery } from "./expectancyData";
import {
  getBreadthData, getMacroData, getLiquidityComposite, getYieldCurve,
  getCreditSpreads, getFedBalanceSheet, getSectorRotation, getRatioData,
  getCOTData as getChartCOTData, getCTAModel, getTrendPower, getDSI, getATRExtension,
  fetchOHLCV,
} from "./chartData";

let cachedDashboard: any = null;
let lastFetch = 0;
const SERVER_CACHE_TTL = 30 * 1000;

// Separate caches for each endpoint
let cachedMacro: any = null;
let lastMacroFetch = 0;
const MACRO_CACHE_TTL = 60 * 1000;

let cachedThemes: any = null;
let lastThemesFetch = 0;

let cachedBreadth: any = null;
let lastBreadthFetch = 0;

let cachedSetups: any = null;
let lastSetupsFetch = 0;

let cachedCOT: any = null;
let lastCOTFetch = 0;
const COT_CACHE_TTL = 300 * 1000; // 5 min

export async function registerRoutes(httpServer: Server, app: Express) {
  // Original dashboard endpoint
  app.get("/api/dashboard", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedDashboard && now - lastFetch < SERVER_CACHE_TTL) {
        return res.json({ ...cachedDashboard, cached: true });
      }
      const data = await fetchAllMarketData();
      cachedDashboard = data;
      lastFetch = now;
      res.json({ ...data, cached: false });
    } catch (err: any) {
      console.error("Dashboard error:", err?.message);
      res.status(500).json({ error: "Failed to fetch market data", detail: err?.message });
    }
  });

  // Macro Intelligence endpoint
  app.get("/api/macro", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedMacro && now - lastMacroFetch < MACRO_CACHE_TTL) {
        return res.json({ ...cachedMacro, cached: true });
      }
      const data = await fetchMacroIntelligence();
      cachedMacro = data;
      lastMacroFetch = now;
      res.json({ ...data, cached: false });
    } catch (err: any) {
      console.error("Macro error:", err?.message);
      res.status(500).json({ error: "Failed to fetch macro data", detail: err?.message });
    }
  });

  // Theme Tracker endpoint
  app.get("/api/themes", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedThemes && now - lastThemesFetch < SERVER_CACHE_TTL) {
        return res.json({ ...cachedThemes, cached: true });
      }
      const data = await fetchThemeTrackerData();
      cachedThemes = data;
      lastThemesFetch = now;
      res.json({ ...data, cached: false });
    } catch (err: any) {
      console.error("Themes error:", err?.message);
      res.status(500).json({ error: "Failed to fetch theme data", detail: err?.message });
    }
  });

  // Sector Snapshot endpoint
  app.get("/api/sectors/:view", async (req, res) => {
    try {
      const data = await fetchSectorSnapshot(req.params.view);
      res.json(data);
    } catch (err: any) {
      console.error("Sectors error:", err?.message);
      res.status(500).json({ error: "Failed to fetch sector data", detail: err?.message });
    }
  });

  // COT Data endpoint
  app.get("/api/cot", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedCOT && now - lastCOTFetch < COT_CACHE_TTL) {
        return res.json(cachedCOT);
      }
      const data = fetchCOTData();
      cachedCOT = data;
      lastCOTFetch = now;
      res.json(data);
    } catch (err: any) {
      console.error("COT error:", err?.message);
      res.status(500).json({ error: "Failed to fetch COT data", detail: err?.message });
    }
  });

  // Breadth Data endpoint
  app.get("/api/breadth", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedBreadth && now - lastBreadthFetch < SERVER_CACHE_TTL) {
        return res.json({ ...cachedBreadth, cached: true });
      }
      const data = await fetchBreadthData();
      cachedBreadth = data;
      lastBreadthFetch = now;
      res.json({ ...data, cached: false });
    } catch (err: any) {
      console.error("Breadth error:", err?.message);
      res.status(500).json({ error: "Failed to fetch breadth data", detail: err?.message });
    }
  });

  // Setups/Scanner endpoint
  app.get("/api/setups", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedSetups && now - lastSetupsFetch < SERVER_CACHE_TTL) {
        return res.json({ ...cachedSetups, cached: true });
      }
      const data = await fetchSetupsData();
      cachedSetups = data;
      lastSetupsFetch = now;
      res.json({ ...data, cached: false });
    } catch (err: any) {
      console.error("Setups error:", err?.message);
      res.status(500).json({ error: "Failed to fetch setups data", detail: err?.message });
    }
  });


  // Historical Expectancy
  app.post("/api/expectancy", async (req, res) => {
    try {
      const { query, ticker, conditions, group, label, logic } = req.body;
      let params: any = null;

      if (query && typeof query === "string") {
        // Natural language path
        params = parseNaturalQuery(query);
        if (!params) {
          return res.status(400).json({ error: "Could not parse query. Try: 'TSLA up 10% in 5 days' or 'AMZN up 18.5% in 8 days, RSI above 70, price >10% extended above 20 EMA'" });
        }
      } else if (ticker && group) {
        // New structured path: full ConditionGroup tree
        params = { ticker, group, label };
      } else if (ticker && conditions) {
        // Legacy flat array path: wrap into an AND group for backward compat
        params = {
          ticker,
          label,
          group: { logic: logic ?? "AND", conditions },
        };
      } else {
        return res.status(400).json({ error: "Provide either a natural language 'query' string, or 'ticker' + 'group', or 'ticker' + 'conditions'" });
      }

      const result = await runExpectancyQuery(params);
      res.json(result);
    } catch (err: any) {
      console.error("Expectancy error:", err?.message);
      res.status(500).json({ error: "Query failed", detail: err?.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // ── CHART ENGINE ROUTES ──────────────────────────────────────────────────────

  // Breadth charts
  app.get("/api/charts/breadth/:indicator", async (req, res) => {
    try {
      const data = await getBreadthData(req.params.indicator);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // COT positioning charts
  app.get("/api/charts/cot/:contract", async (req, res) => {
    try {
      const data = await getChartCOTData(req.params.contract);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // FRED macro series
  app.get("/api/charts/macro/:series", async (req, res) => {
    try {
      const data = await getMacroData(req.params.series);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Price / OHLCV
  app.get("/api/charts/price/:ticker", async (req, res) => {
    try {
      const data = await fetchOHLCV(req.params.ticker);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Ratio chart (ticker vs benchmark)
  app.get("/api/charts/ratio/:ticker/:benchmark", async (req, res) => {
    try {
      const data = await getRatioData(req.params.ticker, req.params.benchmark);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Liquidity composite
  app.get("/api/charts/liquidity", async (_req, res) => {
    try {
      const data = await getLiquidityComposite();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Yield curve
  app.get("/api/charts/yield-curve", async (_req, res) => {
    try {
      const data = await getYieldCurve();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Credit spreads
  app.get("/api/charts/credit-spreads", async (_req, res) => {
    try {
      const data = await getCreditSpreads();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Sector rotation
  app.get("/api/charts/sector-rotation", async (_req, res) => {
    try {
      const data = await getSectorRotation();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Fed balance sheet
  app.get("/api/charts/fed-balance-sheet", async (_req, res) => {
    try {
      const data = await getFedBalanceSheet();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // CTA positioning model
  app.get("/api/charts/cta", async (_req, res) => {
    try {
      const data = await getCTAModel();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Trend Power Oscillator
  app.get("/api/charts/tpo/:ticker", async (req, res) => {
    try {
      const data = await getTrendPower(req.params.ticker);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Daily Sentiment Index proxy
  app.get("/api/charts/dsi/:ticker", async (req, res) => {
    try {
      const data = await getDSI(req.params.ticker);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ATR Extension
  app.get("/api/charts/atr-ext/:ticker", async (req, res) => {
    try {
      const data = await getATRExtension(req.params.ticker);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
