// The dashboard landing's data for the measure (#563 COWORK #134): every card
// filled, shaped as lib/server/dashboardCards.ts returns it. Fixture values in
// the mock-up's ranges; nothing is read. MEASURE_LANDING=empty serves the
// all-missing landing instead, so every empty state renders too.
const spark = Array.from({ length: 90 }, (_, i) => ({ d: `2026-${String(6 + Math.floor(i / 30)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, r: 40 + Math.round(10 * Math.sin(i / 7)) }));
export const EMPTY_LANDING = {
  market: { mood: null, spx: null, trend: null, bestSector: null, mapped: null },
  cards: { hub: null, capex: null, pickers: null, earnings: null, sectors: null, insight: null, news: null },
  bottlenecks: {},
};
export const FULL_LANDING = {
  market: {
    mood: { day: { d: "2026-10-05", r: 44, n: 6, s: { momentum: 40, strength: 38, breadth: 47, volatility: 52, safeHaven: 41, junk: 46 } }, label: "Fear", spark },
    spx: { close: 669.21, date: "2026-10-06", fromHighPct: -1.04, since: "2021-06-01" },
    trend: { score: 85, words: "Strong uptrend" },
    bestSector: { name: "Technology", slug: "technology", ytd: 55.43 },
    mapped: 109,
  },
  cards: {
    hub: { mapped: 109, top: [{ ticker: "AMZN", name: "Amazon", count: 44 }, { ticker: "GOOGL", name: "Alphabet", count: 38 }, { ticker: "MSFT", name: "Microsoft", count: 34 }] },
    capex: { lead: { ticker: "AMZN", amount: "$131.8bn" }, spenders: [{ ticker: "AMZN", amount: "$131.8bn" }, { ticker: "MSFT", amount: "$116.0bn" }, { ticker: "GOOGL", amount: "$91.4bn" }], receivers: [{ ticker: "NVDA", amount: "$194bn" }, { ticker: "HPE", amount: "$17.6bn" }, { ticker: "INTC", amount: "$16.9bn" }] },
    pickers: { universe: 685, screens: [{ label: "Near the 200-day", href: "/stocks-near-200-day-moving-average", count: 32 }, { label: "Breakout", href: "/breakout-signal-stocks", count: 23 }, { label: "Trend flip up (daily)", href: "/stocks-with-bullish-trend-flip", count: 15 }, { label: "Trend flip down (daily)", href: "/stocks-with-bearish-trend-flip", count: 8 }, { label: "Volume spike", href: "/volume-spike-stocks", count: 0 }] },
    earnings: { windows: [{ label: "Next week", range: "12–18 Oct", count: 12, top: ["JPM", "BAC", "WFC"] }, { label: "Week of 19 Oct", range: "19–25 Oct", count: 28, top: ["GOOGL", "TSLA", "INTC"] }, { label: "Week of 26 Oct", range: "26 Oct–1 Nov", count: 32, top: ["AAPL", "MSFT", "AMZN"] }] },
    sectors: { leader: "Technology", laggard: "Consumer Cyclical", tiles: [["Technology", "technology", 55.4], ["Energy", "energy", 42.3], ["Industrials", "industrials", 34.4], ["Basic Materials", "basic-materials", 22.0], ["Communication Services", "communication-services", 8.6], ["Healthcare", "healthcare", 7.5], ["Utilities", "utilities", -0.2], ["Consumer Cyclical", "consumer-cyclical", -2.6]].map(([name, slug, ytd]) => ({ name, slug, ytd })) },
    insight: { slug: "amzn-daily-ma200-buy-zone-july-2026", title: "Amazon back above its 200-day after Q2", symbol: "AMZN", date: "2026-07-28", art: { kind: "none" }, movePct: 11.7, outcome: "held the 200-day average" },
    news: [{ title: "Alphabet lifts its 2026 capex plan as cloud demand outruns supply", url: "https://example.com/1", source: "CNBC", date: "2026-10-05", symbol: "GOOGL" }, { title: "Apple supplier orders point to steady iPhone demand", url: "https://example.com/2", source: "MarketWatch", date: "2026-10-03", symbol: "AAPL" }, { title: "Chip supplier guides higher on data-centre orders", url: "https://example.com/3", source: "GlobeNewswire", date: "2026-10-02", symbol: "NVDA" }],
  },
  bottlenecks: { AAPL: "aapl", TSLA: "tsla", SPY: "spy" },
};
export async function getDashboardLanding() { return process.env.MEASURE_LANDING === "empty" ? EMPTY_LANDING : FULL_LANDING; }
