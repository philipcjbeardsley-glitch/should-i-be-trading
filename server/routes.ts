import type { Express } from "express";
import type { Server } from "http";
import { fetchAllMarketData } from "./marketData";
import { fetchMacroIntelligence } from "./macroData";
import { fetchThemeTrackerData, fetchSectorSnapshot, fetchCOTData } from "./themeData";
import { fetchBreadthData, fetchSetupsData } from "./breadthData";

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

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
}
