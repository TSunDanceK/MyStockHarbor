// THE DASHBOARD'S LANDING DATA (#563 COWORK #134, the approved mock-up): the
// "Market right now" figures and the "Only on MyStockHarbor today" cards, in
// one place so the page stays layout and the command count is countable.
//
// EVERY NUMBER COMES FROM AN EXISTING ENGINE OR STORE; nothing here is new
// data. Each card is read through the same reader its own page uses:
//
//   Market Mood         readMarketMood            Data Cache 24 h (the /markets/spx card)
//   S&P close, record   content/markets/spx-weekly.json   a file, 0 commands
//   Trend score         readTiingoHistory("SPY")  Data Cache 24 h (the /markets/spx tile)
//   Sectors YTD, best   getSectorPerformanceTable 1 GET (the /sector table, 15 min key)
//   Bottlenecks         getBottleneckHub          content files, 0 commands
//   Follow the money    readCapexShared           2 GETs, Data Cache 1 h (shared with the insight pages)
//   Pickers             getPickersData            ~3 commands, Data Cache 6 h (below)
//   Earnings            getCalendarForwardSections  2 commands + 1 HMGET for the caps (the calendar's)
//   Insight of the day  getInsightPageDataCached  Data Cache 6 h (shared with the post's own page)
//   Headlines           getGeneralMarketHeadlines Data Cache 30 min (the /headlines feed, no Redis)
//
// THE WHOLE RESULT IS CACHED FOR 15 MINUTES (getDashboardCards), the shortest
// of its sources' windows (the sector table). A warm render reads it from the
// Data Cache: 0 Redis commands per render. A refill costs about 9 commands
// when the inner caches are warm too, at most 96 refills a day.
//
// Every card degrades to null on its own: a missing store hides that card's
// figures behind its empty state, never the page. Nothing here writes.
import fs from "node:fs";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { readMarketMood } from "@/lib/server/marketMoodRead";
import { moodView } from "@/lib/marketMood";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import { buildMarketMoodScore } from "@/lib/market-mood";
import { rsiWilder, lastNum } from "@/lib/indicators";
import { trendWords } from "@/lib/spxPage";
import { parseSpxWeekly } from "@/lib/spxWeekly";
import { getSectorPerformanceTable } from "@/lib/server/sectorPanels";
import { getAllBottleneckPosts, getBottleneckHub } from "@/lib/bottlenecks";
import { readCapexShared, getInsightPageDataCached } from "@/lib/server/insightPage";
import { getPickersData } from "@/lib/server/pickersBuilder";
import { getCalendarForwardSections } from "@/lib/server/dueInputs";
import { easternDate } from "@/lib/server/calendarDayState";
import { readPricePoolBulk } from "@/lib/server/pricePool";
import { registrantFor } from "@/lib/server/stockProfile";
import { addDays, comingUpColumns, onePerCompany } from "@/lib/server/earningsWeek";
import { getAllPosts } from "@/lib/blog";
import { getGeneralMarketHeadlines } from "@/lib/general-market-news";
import { outcomeWords } from "@/lib/insightView";
import type { CardArt } from "@/lib/server/news/art";
import type { MoodCardView } from "@/app/markets/spx/MarketMoodCard";

export type DashboardMarket = {
  mood: MoodCardView | null;
  /** The weekly file's index close and its distance from the record close. */
  spx: { close: number; fromRecordPct: number; asOf: string } | null;
  trend: { score: number; words: string } | null;
  bestSector: { name: string; slug: string; ytd: number } | null;
  /** Stock pages on Bottlenecks, for the hero's "Who depends on who". */
  mapped: number | null;
};

export type DashboardCards = {
  hub: { mapped: number; top: { ticker: string; name: string; count: number }[] } | null;
  capex: { spenders: { ticker: string; amount: string }[]; receivers: { ticker: string; amount: string }[]; lead: { ticker: string; amount: string } | null } | null;
  pickers: { screens: { label: string; href: string; count: number }[]; universe: number } | null;
  earnings: { windows: { label: string; range: string; count: number; top: string[] }[] } | null;
  sectors: { tiles: { name: string; slug: string; ytd: number | null }[]; leader: string | null; laggard: string | null } | null;
  insight: { slug: string; title: string; symbol: string; date: string; art: CardArt; movePct: number | null; outcome: string | null } | null;
  news: { title: string; url: string; source: string; date: string | null }[] | null;
};

export type DashboardLanding = {
  market: DashboardMarket;
  cards: DashboardCards;
  /** Symbol → Bottlenecks page slug, for the analyser's "On Bottlenecks" link. */
  bottlenecks: Record<string, string>;
};

/**
 * THE PICKERS CARD'S FIVE SCREENS, fixed (the brief allows "a fixed set"), in
 * the mock-up's order. Each key is a SignalRecord flag; each href is one of
 * PICKER_ROUTES (scripts/check-dashboard-landing.mjs holds them to it).
 */
export const DASHBOARD_SCREENS = [
  { flag: "dailyMa200Proximity", label: "Near the 200-day", href: "/stocks-near-200-day-moving-average" },
  { flag: "breakout", label: "Breakout", href: "/breakout-signal-stocks" },
  { flag: "trendFlipBullish", label: "Trend flip up (daily)", href: "/stocks-with-bullish-trend-flip" },
  { flag: "trendFlipBearish", label: "Trend flip down (daily)", href: "/stocks-with-bearish-trend-flip" },
  { flag: "volumeSpike", label: "Volume spike", href: "/volume-spike-stocks" },
] as const;

// ── PICKERS (6 h) ───────────────────────────────────────────────────────────
const readScreenCounts = unstable_cache(
  async (): Promise<DashboardCards["pickers"]> => {
    try {
      const data = await getPickersData("https://www.mystockharbor.com");
      const recs = data.signalRecords as unknown as Array<Record<string, unknown>>;
      if (!recs.length) return null;
      return {
        universe: recs.length,
        screens: DASHBOARD_SCREENS.map((s) => ({ label: s.label, href: s.href, count: recs.filter((r) => r[s.flag] === true).length })),
      };
    } catch {
      return null;
    }
  },
  ["dashboard-screen-counts-v1"],
  { revalidate: 21600, tags: ["dashboard-screen-counts"] },
);

// ── THE PARTS (each null on its own failure) ────────────────────────────────

function readSpxWeekly(): DashboardMarket["spx"] {
  try {
    const r = parseSpxWeekly(JSON.parse(fs.readFileSync(path.join(process.cwd(), "content/markets/spx-weekly.json"), "utf8")));
    if (!r.ok) return null;
    return { close: r.data.indexClose, fromRecordPct: (r.data.indexClose / r.data.ath.level - 1) * 100, asOf: r.data.asOf };
  } catch {
    return null;
  }
}

/** The /markets/spx "Trend score": SPY's close against its 50/200-day averages and RSI (14). */
async function readTrend(): Promise<DashboardMarket["trend"]> {
  const eod = await readTiingoHistory("SPY").catch(() => null);
  const closes = (eod?.bars ?? []).map((b) => b[4]).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 200) return null;
  const avg = (n: number) => closes.slice(-n).reduce((a, b) => a + b, 0) / n;
  const t = buildMarketMoodScore({ lastClose: closes[closes.length - 1], ma50: avg(50), ma200: avg(200), rsi: lastNum(rsiWilder(closes, 14)) });
  return t ? { score: t.score, words: trendWords(t.score) } : null;
}

function readHub(): DashboardCards["hub"] {
  try {
    const hub = getBottleneckHub();
    const top = hub.companies.filter((c) => c.ticker).slice(0, 3).map((c) => ({ ticker: c.ticker as string, name: c.name, count: c.count }));
    return top.length ? { mapped: hub.stats.stocksMapped, top } : null;
  } catch {
    return null;
  }
}

async function readCapex(): Promise<DashboardCards["capex"]> {
  const c = await readCapexShared().catch(() => null);
  if (!c || (!c.topSpenders.length && !c.topReceivers.length)) return null;
  const pick = (x: { ticker: string; amount: string }) => ({ ticker: x.ticker, amount: x.amount });
  return { spenders: c.topSpenders.map(pick), receivers: c.topReceivers.map(pick), lead: c.topSpenders[0] ? pick(c.topSpenders[0]) : null };
}

/** The calendar's "Coming up" windows after this week: count and the three largest names. */
async function readEarnings(): Promise<DashboardCards["earnings"]> {
  const today = easternDate(new Date());
  const forward = await getCalendarForwardSections(today).catch(() => null);
  if (!forward || forward.expected.kind !== "listed") return null;
  const rows = forward.expected.rows;
  const pool = rows.length ? await readPricePoolBulk(rows.map((r) => r.symbol)).catch(() => new Map()) : new Map();
  const cikOf = (s: string) => registrantFor(s)?.cik ?? null;
  const list = onePerCompany(rows.map((r) => ({ symbol: r.symbol, estimatedOn: addDays(today, r.daysAway), cap: pool.get(r.symbol)?.marketCap ?? null })), cikOf);
  const windows = comingUpColumns(list, today).filter((c) => !c.isThisWeek).slice(0, 3)
    .map((c) => ({ label: c.label, range: c.range, count: c.items.length, top: c.items.slice(0, 3).map((i) => i.symbol) }));
  return windows.length ? { windows } : null;
}

async function readSectors(): Promise<{ cards: DashboardCards["sectors"]; best: DashboardMarket["bestSector"] }> {
  const table = await getSectorPerformanceTable().catch(() => null);
  const rows = table?.rows ?? [];
  if (!rows.length) return { cards: null, best: null };
  const ranked = rows.filter((r) => typeof r.ytd === "number").sort((a, b) => (b.ytd as number) - (a.ytd as number));
  const tiles = (ranked.length ? ranked : rows).slice(0, 8).map((r) => ({ name: r.name, slug: r.slug, ytd: r.ytd }));
  const best = ranked[0] ? { name: ranked[0].name, slug: ranked[0].slug, ytd: ranked[0].ytd as number } : null;
  return { cards: { tiles, leader: ranked[0]?.name ?? null, laggard: ranked.length > 1 ? ranked[ranked.length - 1].name : null }, best };
}

/** The newest post, with its own page's "since published" result. */
async function readInsight(): Promise<DashboardCards["insight"]> {
  const post = getAllPosts()[0];
  if (!post) return null;
  const d = await getInsightPageDataCached(post.slug).catch(() => null);
  if (!d) return null;
  return {
    slug: post.slug,
    title: d.n.title,
    symbol: d.n.symbol,
    date: d.n.date,
    art: d.art,
    movePct: d.since?.movePct ?? null,
    outcome: d.since?.level ? `${outcomeWords(d.since.level.outcome).word.toLowerCase()} the ${d.since.level.name}` : null,
  };
}

async function readNews(): Promise<DashboardCards["news"]> {
  const h = await getGeneralMarketHeadlines().catch(() => []);
  const top = h.filter((x) => x.title && x.url).slice(0, 3).map((x) => ({ title: x.title, url: x.url, source: x.source, date: x.publishedDate }));
  return top.length ? top : null;
}

async function loadDashboardLanding(): Promise<DashboardLanding> {
  const hub = readHub();
  const [moodRaw, trend, sectors, capex, pickers, earnings, insight, news] = await Promise.all([
    readMarketMood().catch(() => null),
    readTrend().catch(() => null),
    readSectors().catch(() => ({ cards: null, best: null })),
    readCapex().catch(() => null),
    readScreenCounts().catch(() => null),
    readEarnings().catch(() => null),
    readInsight().catch(() => null),
    readNews().catch(() => null),
  ]);
  return {
    market: { mood: moodView(moodRaw), spx: readSpxWeekly(), trend, bestSector: sectors.best, mapped: hub?.mapped ?? null },
    cards: { hub, capex, pickers, earnings, sectors: sectors.cards, insight, news },
    bottlenecks: readBottleneckSlugs(),
  };
}

function readBottleneckSlugs(): Record<string, string> {
  try {
    return Object.fromEntries(getAllBottleneckPosts().filter((p) => p.symbol).map((p) => [p.symbol.toUpperCase(), p.slug]));
  } catch {
    return {};
  }
}

/** The landing, cached 15 minutes; never throws (an empty landing renders every empty state). */
export const getDashboardLanding = unstable_cache(loadDashboardLanding, ["dashboard-landing-v1"], { revalidate: 900, tags: ["dashboard-landing"] });

export const EMPTY_LANDING: DashboardLanding = {
  market: { mood: null, spx: null, trend: null, bestSector: null, mapped: null },
  cards: { hub: null, capex: null, pickers: null, earnings: null, sectors: null, insight: null, news: null },
  bottlenecks: {},
};
