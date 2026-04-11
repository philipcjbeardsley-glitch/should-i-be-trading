# Should I Be Trading?

A Bloomberg Terminal-style market dashboard that evaluates the current stock market environment and outputs a clear YES / CAUTION / NO trading decision for swing traders.

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen) ![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-gray)

## What It Does

- **Decision Engine**: Weighted scoring across 5 categories → Market Quality Score (0–100) → YES / CAUTION / NO
- **Live Data**: Fetches real market data from Yahoo Finance every 45 seconds
- **Terminal Analysis**: Plain-English summary of the current environment with actionable guidance

## Quick Start

```bash
git clone https://github.com/philipcjbeardsley-glitch/should-i-be-trading.git
cd should-i-be-trading
npm install
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) — that's it.

## Data Sources

All data comes from **Yahoo Finance** (free, no API key needed).

| Category | Tickers | What's Calculated |
|---|---|---|
| **Volatility** | ^VIX, ^VVIX | VIX level, 5d slope, 1yr percentile, P/C ratio estimate |
| **Trend** | SPY, QQQ | Price vs 20/50/200 MAs, 14d RSI, regime classification |
| **Breadth** | 11 sector ETFs | % above 20/50/200 MAs, A/D ratio, McClellan approx |
| **Momentum** | XLK, XLF, XLE, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC | Sector spread, leaders/laggards, positive count |
| **Macro** | ^TNX, DX-Y.NYB | 10yr yield trend, DXY trend, Fed stance, FOMC calendar |

## Scoring System

| Category | Weight | What Drives It |
|---|---|---|
| Volatility | 25% | VIX level + trend direction |
| Momentum | 25% | Sector participation + spread |
| Trend | 20% | SPY regime + RSI health |
| Breadth | 20% | % of sectors above key MAs |
| Macro/Liquidity | 10% | Rates, dollar, Fed stance, FOMC proximity |

**Decision thresholds:**
- **80–100** → YES — Full position sizing, press risk
- **60–79** → CAUTION — Half size, A+ setups only
- **< 60** → NO — Avoid trading, preserve capital

## Architecture

```
trading-dashboard/
├── client/                # React + Tailwind + shadcn/ui frontend
│   └── src/
│       ├── pages/
│       │   └── Dashboard.tsx    # Main dashboard (all panels, scoring UI)
│       └── index.css            # Bloomberg terminal theme
├── server/
│   ├── routes.ts          # Express API routes (/api/dashboard)
│   ├── marketData.ts      # Data fetching + scoring engine (this is the brain)
│   └── index.ts           # Server entry point
├── shared/
│   └── schema.ts          # Shared types
└── package.json
```

### Key Files to Modify

- **`server/marketData.ts`** — Scoring weights, decision thresholds, data fetching, analysis text generation. This is where all the logic lives.
- **`client/src/pages/Dashboard.tsx`** — All UI panels, layout, and visual components.
- **`client/src/index.css`** — Bloomberg terminal color theme and custom CSS.

## Customization Ideas

- **Swap data source**: Replace Yahoo Finance with Polygon.io, Alpha Vantage, or any other provider in `marketData.ts`
- **Adjust scoring weights**: Change the 25/25/20/20/10 split in `fetchAllMarketData()`
- **Add new indicators**: Add MACD, Bollinger Bands, or custom signals — just add to the return object and create a new panel
- **Day trading mode**: The toggle exists in the UI — wire it to tighter thresholds in the backend
- **Alerts**: Add email/SMS alerts when the score crosses thresholds
- **Historical tracking**: Store scores in the SQLite database over time and chart them

## Tech Stack

- **Frontend**: React 19, Tailwind CSS v3, shadcn/ui, Lucide icons
- **Backend**: Express.js, Node.js
- **Data**: Yahoo Finance (free, no API key)
- **Fonts**: IBM Plex Mono + IBM Plex Sans
- **Build**: Vite, TypeScript

## Scripts

```bash
npm run dev      # Start dev server (hot reload)
npm run build    # Production build
node dist/index.cjs  # Run production server
```

## License

MIT — do whatever you want with it.
