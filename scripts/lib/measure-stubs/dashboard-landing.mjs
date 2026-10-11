// The dashboard landing's data for the measure (#563 COWORK #134, v2 #164): every card
// filled, shaped as lib/server/dashboardCards.ts returns it. Fixture values in
// the mock-up's ranges; nothing is read. MEASURE_LANDING=empty serves the
// all-missing landing instead, so every empty state renders too.
const spark = Array.from({ length: 90 }, (_, i) => ({ d: `2026-${String(6 + Math.floor(i / 30)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, r: 40 + Math.round(10 * Math.sin(i / 7)) }));
export const EMPTY_LANDING = {
  market: { mood: null, spx: null, trend: null, bestSector: null, indices: [], mapped: null },
  cards: { hub: null, capex: null, pickers: null, earnings: null, sectors: null, insights: null, news: null },
  bottlenecks: {},
};
export const FULL_LANDING = {
  market: {
    mood: { day: { d: "2026-10-05", r: 44, n: 6, s: { momentum: 40, strength: 38, breadth: 47, volatility: 52, safeHaven: 41, junk: 46 } }, label: "Fear", spark },
    spx: { close: 669.21, date: "2026-10-06", fromHighPct: -1.04, since: "2021-06-01" },
    trend: { score: 85, words: "Strong uptrend" },
    bestSector: { name: "Technology", slug: "technology", ytd: 55.43 },
    indices: [
      { symbol: "SPY", label: "S&P 500", close: 669.21, changePct: -1.04, date: "2026-10-06" },
      { symbol: "QQQ", label: "Nasdaq 100", close: 601.12, changePct: -1.38, date: "2026-10-06" },
      { symbol: "DIA", label: "Dow 30", close: 462.4, changePct: 0.21, date: "2026-10-06" },
      { symbol: "IWM", label: "Russell 2000", close: 241.9, changePct: 0, date: "2026-10-06" },
    ],
    mapped: 109,
  },
  cards: {
    hub: { mapped: 109, top: [{ ticker: "AMZN", name: "Amazon", count: 44 }, { ticker: "GOOGL", name: "Alphabet", count: 38 }, { ticker: "MSFT", name: "Microsoft", count: 34 }] },
    capex: { lead: { ticker: "AMZN", amount: "$131.8bn" }, spenders: [{ ticker: "AMZN", amount: "$131.8bn", value: 131.8e9 }, { ticker: "MSFT", amount: "$116.0bn", value: 116e9 }, { ticker: "GOOGL", amount: "$91.4bn", value: 91.4e9 }], receivers: [{ ticker: "NVDA", amount: "$194bn", value: 194e9 }, { ticker: "HPE", amount: "$17.6bn", value: 17.6e9 }, { ticker: "INTC", amount: "$16.9bn", value: 16.9e9 }] },
    pickers: { universe: 685, mover: { symbol: "SMCI", changePct: 9.42, label: null }, screens: [{ label: "Near the 200-day", href: "/stocks-near-200-day-moving-average", count: 32, peek: ["AAPL", "MSFT", "AMZN"] }, { label: "Breakout", href: "/breakout-signal-stocks", count: 23, peek: ["NVDA", "META", "AVGO"] }, { label: "Trend flip up (daily)", href: "/stocks-with-bullish-trend-flip", count: 15, peek: ["JPM", "V", "MA"] }, { label: "Trend flip down (daily)", href: "/stocks-with-bearish-trend-flip", count: 8, peek: ["KO", "PEP"] }, { label: "Volume spike", href: "/volume-spike-stocks", count: 0, peek: [] }] },
    earnings: { windows: [
      { label: "Next week", range: "12–18 Oct", count: 11, top: [{ symbol: "JPM", name: "JPMorgan Chase & Co.", day: "Tue 14 Oct" }, { symbol: "BAC", name: "Bank of America Corporation", day: "Wed 15 Oct" }, { symbol: "BRK.B", name: "The Very Long Named Holdings Company Incorporated of America", day: "Fri 17 Oct" }] },
      { label: "Week of 19 Oct", range: "19–25 Oct", count: 38, top: [{ symbol: "GOOGL", name: "Alphabet Inc.", day: "Tue 21 Oct" }, { symbol: "TSLA", name: "Tesla, Inc.", day: "Wed 22 Oct" }, { symbol: "IBM", name: "International Business Machines Corporation", day: "Wed 22 Oct" }] },
    ] },
    sectors: { leader: "Technology", laggard: "Consumer Cyclical", spxYtd: 14.2, rows: [["Technology", "technology", 55.4], ["Energy", "energy", 42.3], ["Industrials", "industrials", 34.4], ["Basic Materials", "basic-materials", 22.0], ["Financial Services", "financial-services", 15.1], ["Communication Services", "communication-services", 8.6], ["Healthcare", "healthcare", 7.5], ["Real Estate", "real-estate", 3.1], ["Utilities", "utilities", -0.2], ["Consumer Defensive", "consumer-defensive", -1.4], ["Consumer Cyclical", "consumer-cyclical", -2.6]].map(([name, slug, ytd]) => ({ name, slug, ytd })) },
    insights: [
      { slug: "amzn-daily-ma200-buy-zone-july-2026", title: "Amazon back above its 200-day after Q2", symbol: "AMZN", date: "2026-07-28", art: { kind: "library", art: { src: "/news-art/any-earnings-01.webp", srcSet: "", width: 1200, height: 675, bucket: "any-earnings" } }, movePct: 11.7, outcome: "held the 200-day average" },
      { slug: "riot-daily-bollinger-accumulation-july-2026", title: "Riot Platforms basing inside a tightening range", symbol: "RIOT", date: "2026-07-27", art: { kind: "library", art: { src: "/news-art/ai-compute-any-01.webp", srcSet: "", width: 1200, height: 675, bucket: "ai-compute" } }, movePct: -4.2, outcome: null },
    ],
    news: [{ title: "Alphabet lifts its 2026 capex plan as cloud demand outruns supply", url: "https://example.com/1", source: "CNBC", date: "2026-10-05", symbol: "GOOGL", thumb: "/news-art/advertising-any-01.webp" }, { title: "Apple supplier orders point to steady iPhone demand", url: "https://example.com/2", source: "MarketWatch", date: "2026-10-03", symbol: "AAPL", thumb: "/news-art/advertising-any-02.webp" }, { title: "Chip supplier guides higher on data-centre orders", url: "https://example.com/3", source: "GlobeNewswire", date: "2026-10-02", symbol: "NVDA", thumb: null }, { title: "Microsoft widens its sovereign-cloud programme to four more European countries after a long pilot", url: "https://example.com/4", source: "CNBC", date: "2026-10-01", symbol: "MSFT", thumb: "/news-art/advertising-any-03.webp" }],
  },
  bottlenecks: { AAPL: "aapl", TSLA: "tsla", SPY: "spy" },
};
export async function getDashboardLanding() { return process.env.MEASURE_LANDING === "empty" ? EMPTY_LANDING : FULL_LANDING; }
