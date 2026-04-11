import type { Express } from "express";
import type { Server } from "http";
import { fetchAllMarketData } from "./marketData";

let cachedDashboard: any = null;
let lastFetch = 0;
const SERVER_CACHE_TTL = 30 * 1000;

export async function registerRoutes(httpServer: Server, app: Express) {
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

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
}
