// EVERYTHING THE INSIGHT PAGE READS (#563 COWORK #132/#133), in one place so
// the page stays layout and the command count is countable.
//
// READS, PER REFILL. The route renders per request (see page.tsx), so the
// whole result is cached per post for 6 hours (getInsightPageDataCached): the
// figures are end-of-day, and a reader sees the same page all day. Per refill:
//   readTiingoHistory(SYM), readTiingoHistory("SPY")  2 GETs, Data Cache 24 h
//   readReportDatesChecked                             1 GET: the next-report line (outlookFromRead)
//                                                      and the reader vote's windows, from one record
//   readVoteTally (the closed vote window, PR 2)       1 HGETALL, only once a window has closed
//   getStockPageSecFacts                               2 GETs (fact set + report dates)
//   readPeSectorMedians                                0 (Data Cache blobs, 6 h)
//   getSectorPerformanceRow                            1 GET (15 min key)
//   readScreenFlags (pickers payload, below)           ~3 commands, Data Cache 6 h, shared by every post
//   capex records                                      2 GETs, Data Cache 1 h, shared by every post
// About 9 commands a refill, at most 4 refills a post a day: under 2,200 a day
// for all 59 posts if every one is read every 6 hours, plus the shared
// caches' refills. Nothing here writes.
//
// Every read degrades to null on its own: a missing store hides its block,
// never the page.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { unstable_cache } from "next/cache";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import { outlookFromRead } from "@/lib/server/symbolOutlook";
import { readReportDatesChecked } from "@/lib/server/secReportDatesStore";
import { announcedDates, readVoteTally } from "@/lib/server/insightVoteStore";
import { calledWords, voteWindows } from "@/lib/insightVote";
import { getStockPageSecFacts } from "@/lib/server/secEarningsSnapshot";
import type { SecEarningsSnapshot } from "@/lib/server/secEarningsSnapshot";
import { marketCap, peRatio } from "@/lib/server/secValuation";
import { isBankSic, peSectorOf, readPeSectorMedians } from "@/lib/server/peSectorMedians";
import { registrantFor } from "@/lib/server/stockProfile";
import { readableDate } from "@/lib/server/secEstimates";
import { peSectorLine } from "@/lib/peSectorLine";
import { sicProfileFor } from "@/lib/server/staticProfile";
import { getSectorByLabel } from "@/lib/sectors";
import { getSectorPerformanceRow } from "@/lib/server/sectorPanels";
import { bucketFor, type CardArt } from "@/lib/server/news/art";
import { planSymbolCardArt } from "@/lib/server/news/artTags";
import { getPickersData } from "@/lib/server/pickersBuilder";
import { readSpendingRecord } from "@/lib/server/capexSpending";
import { RECEIVER_ENTRIES, readReceiversRecord } from "@/lib/server/capexReceivers";
import { buildTopReceivers } from "@/lib/capexPresent";
import { snapshotCompanyName } from "@/lib/server/companyNameSnapshot";
import { normaliseCompanyName } from "@/lib/server/news/companyName";
import { getAllBottleneckPosts } from "@/lib/bottlenecks";
import { buildHubCompanies } from "@/lib/bottleneckHub";
import { getAllPosts } from "@/lib/blog";
import { getStockNewsBaseData } from "@/lib/stock-news-data";
import { resolveFactSetForRender } from "@/lib/server/secColdFetch";
import { toSpendingInput } from "@/lib/server/capexSpendingJob";
import { confluence } from "@/lib/ta/confluence";
import type { KeyBar } from "@/lib/ta/keyLevels";
import {
  dayWords, differenceNote, indexOnOrBefore, levelSeries, normaliseInsight, setupLabel, sinceView, LEVEL_NAME,
  type EodBar, type NormalisedInsight, type SetupLabel, type SinceView,
} from "@/lib/insightView";
import { SCREEN_ROUTES, screenFor, type ScreenFlag } from "@/lib/insightScreens";
import { junkReason } from "@/lib/server/news/junkTitle";

const INSIGHTS_DIR = path.join(process.cwd(), "content/insights");
/**
 * PREVIEW-ONLY FIXTURES (#563 COWORK #133: "a new-format fixture" for Cowork's
 * preview): served by the page off production only, never listed by
 * getAllPosts, never in the sitemap, and marked noindex by the page.
 */
const FIXTURES_DIR = path.join(process.cwd(), "content/insights-fixtures");
export const fixturesServed = () => process.env.VERCEL_ENV !== "production";
export function isInsightFixture(slug: string): boolean {
  return fixturesServed() && /^[a-z0-9-]+$/.test(slug) && !fs.existsSync(path.join(INSIGHTS_DIR, `${slug}.md`)) && fs.existsSync(path.join(FIXTURES_DIR, `${slug}.md`));
}

/** The post as written: frontmatter and body, both formats. Throws on a missing file (the page 404s). */
export function readInsightSource(slug: string): { n: NormalisedInsight; data: Record<string, unknown> } {
  const raw = fs.readFileSync(path.join(isInsightFixture(slug) ? FIXTURES_DIR : INSIGHTS_DIR, `${slug}.md`), "utf8");
  const { data, content } = matter(raw);
  return { n: normaliseInsight(slug, data as Record<string, unknown>, content), data: data as Record<string, unknown> };
}

// ── SCREENS (one shared map, 6 h) ───────────────────────────────────────────
// The pickers payload's per-symbol flags, reduced to symbol → the flags that
// have a screen page. Read through getPickersData, the reader every picker
// page uses; the map is small enough for the Data Cache.
const readScreenFlags = unstable_cache(
  async (): Promise<Record<string, ScreenFlag[]> | null> => {
    try {
      const data = await getPickersData("https://www.mystockharbor.com");
      const out: Record<string, ScreenFlag[]> = {};
      for (const r of data.signalRecords as unknown as Array<Record<string, unknown>>) {
        const sym = String(r.symbol ?? "").toUpperCase();
        const flags = (Object.keys(SCREEN_ROUTES) as ScreenFlag[]).filter((k) => r[k] === true);
        if (sym && flags.length) out[sym] = flags;
      }
      return out;
    } catch {
      return null;
    }
  },
  ["insight-screen-flags-v1"],
  { revalidate: 21600, tags: ["insight-screen-flags"] },
);

// ── CAPEX (shared, 1 h) ─────────────────────────────────────────────────────
// "Follow the money" (#563 COWORK #138 §5): where a ticker sits on the
// spending and receiving lists, and each list's top three for the flow.
export type CapexMention =
  | { list: "spending"; rank: number; of: number; value: number; amount: string }
  | { list: "receiving"; rank: number; of: number; amount: string; line: string; changePct: number | null; fyTo: string };
export type CapexFlowItem = { ticker: string; value: number; amount: string };
export type CapexShared = { mentions: Record<string, CapexMention>; topSpenders: CapexFlowItem[]; topReceivers: CapexFlowItem[] };
const bn = (v: number) => `$${(v / 1e9).toFixed(1)}bn`;
export const readCapexShared = unstable_cache(
  async (): Promise<CapexShared | null> => {
    const [sp, rc] = await Promise.all([readSpendingRecord().catch(() => null), readReceiversRecord().catch(() => null)]);
    if (!sp && !rc) return null;
    const mentions: Record<string, CapexMention> = {};
    const leaders = sp?.leaders ?? [];
    leaders.forEach((l, i) => { mentions[l.symbol.toUpperCase()] = { list: "spending", rank: i + 1, of: leaders.length, value: l.capex, amount: bn(l.capex) }; });
    const rows = rc?.rows ?? {};
    const recv = rc ? buildTopReceivers(RECEIVER_ENTRIES, rows, () => "", Infinity) : [];
    const valueOf = (id: string) => Number((rows as Record<string, { current?: number }>)[id]?.current ?? NaN);
    recv.forEach((r, i) => {
      const t = r.ticker.toUpperCase();
      const f = (rows as Record<string, { changePct?: number | null }>)[r.id];
      if (!mentions[t]) mentions[t] = { list: "receiving", rank: i + 1, of: recv.length, amount: r.amount, line: r.line, changePct: f?.changePct ?? null, fyTo: r.fyTo };
    });
    return {
      mentions,
      topSpenders: leaders.slice(0, 3).map((l) => ({ ticker: l.symbol.toUpperCase(), value: l.capex, amount: bn(l.capex) })),
      topReceivers: recv.slice(0, 3).map((r) => ({ ticker: r.ticker.toUpperCase(), value: valueOf(r.id), amount: r.amount })),
    };
  },
  ["insight-capex-shared-v2"],
  { revalidate: 3600, tags: ["insight-capex-ranks"] },
);

// ── THE PAGE'S DATA ─────────────────────────────────────────────────────────

export type ChartData = {
  points: { date: string; close: number }[];
  /** Every close on file, for the Trend Helper's warm-up, and where the window starts in it. */
  fullCloses: number[];
  displayStart: number;
  ma50: (number | null)[];
  ma200: (number | null)[];
  wma200: (number | null)[] | null;
  bbMid: (number | null)[] | null;
  /** The publish bar's index in `points`. */
  publishIndex: number;
  level: { kind: string; name: string; series: (number | null)[] } | null;
  /** Today's zones as reference lines. */
  todayLevels: { price: number; label: string }[];
};

export type MoreCard =
  // BOTH DIRECTIONS (#563 COWORK #138 §4): who it depends on (its own page's
  // suppliers, by the page's editorial %) and who depends on it (×N, three names).
  | { kind: "bottlenecks"; href: string; company: string; ownPage: boolean;
      suppliers: { name: string; ticker: string | null; pct: number }[];
      dependants: { count: number; names: string[] } }
  | { kind: "capex"; href: string; mention: CapexMention; flow: { from: CapexFlowItem[]; to: CapexFlowItem[] };
      /** A spender's own capex, latest and prior fiscal year, from its filings. */
      own: { year: string; value: number; prior: number | null; changePct: number | null } | null }
  | { kind: "pickers"; href: string; label: string }
  | { kind: "sector"; href: string; name: string }
  | { kind: "calendar"; href: string }
  | { kind: "spx"; href: string };

/** The headlines the news card shows under the drivers paragraph, at most (#146). */
export const NEWS_SHOWN = 3;
/** "What's driving {TICKER} now" (#563 COWORK #138 §1): the news page's own items and score. */
export type InsightNews = {
  items: { title: string; link: string; source: string | null; date: string | null }[];
  score: { label: string; tone: "green" | "yellow" | "red"; reason: string } | null;
};

export type InsightPageData = {
  n: NormalisedInsight;
  news: InsightNews | null;
  /** The bars the rail's Key levels pole reads (#139): the last ~70 sessions. */
  railBars: KeyBar[];
  discussed: { label: string; value: number } | null;
  /** The screens card's faint background (#138 §6): the last 60 closes and the screen's own line. */
  screenChart: { closes: number[]; ref: (number | null)[] | null } | null;
  company: string;
  label: SetupLabel | null;
  since: SinceView | null;
  difference: string | null;
  chart: ChartData | null;
  /** The closes up to publication, for the "Chart when published" thumbnail. */
  thumb: number[] | null;
  art: CardArt;
  sector: { name: string; slug: string | null } | null;
  capWords: string | null;
  nextReport: string | null;
  snapshot: SecEarningsSnapshot | null;
  pe: { value: number; text: string; note: string; median: number } | null;
  screens: { label: string; href: string }[] | null;
  sectorMove: { name: string; slug: string; day: number | null; week: number | null; month: number | null; ytd: number | null; rank: number | null } | null;
  more: MoreCard[];
  related: { slug: string; title: string; date: string; symbol: string; art: CardArt }[];
  onTiingo: boolean;
  /**
   * THE READER VOTE (PR 2): the current window's id (the newest results
   * announcement on or before today, or "open"), and how readers called the
   * window the newest report closed, in words (null when too few voted).
   */
  vote: { window: string; called: string | null };
};

const capText = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

function sectorOf(symbol: string): { name: string; slug: string | null } | null {
  const label = sicProfileFor(symbol)?.sector ?? null;
  if (!label) return null;
  const def = getSectorByLabel(label);
  return { name: def?.shortName ?? label, slug: def?.slug ?? null };
}

/** The news pipeline's library art for a symbol's item (the insight hero's, and the dashboard news thumbnails'). Pure. */
export function artFor(symbol: string, title: string, key: string, taken: { names: Set<string>; buckets: Map<string, Set<number>> }): CardArt {
  const prof = sicProfileFor(symbol);
  const slug = getSectorByLabel(prof?.sector ?? null)?.slug ?? null;
  return planSymbolCardArt({
    variant: "lead", title, industry: prof?.industry ?? null, sectorBucket: bucketFor(slug, prof?.industry ?? null),
    key, takenNames: taken.names, takenBuckets: taken.buckets, canGenerate: true,
  });
}

/** The chart's window: from 60 sessions before publication (at least 120 bars) to today. */
const LEAD_IN = 60, MIN_BARS = 120;

export async function getInsightPageData(slug: string, nowMs = Date.now()): Promise<InsightPageData> {
  const { n } = readInsightSource(slug);
  const sym = n.symbol;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const level = n.levels[0];
  // The news page's cached read, by its own key (same symbol, same options), so
  // a warm news page costs nothing here; the fact set is read once (secColdFetch
  // dedupes the in-flight read getStockPageSecFacts makes).
  const [eod, spyEod, dates, facts, medians, newsBase, cold] = await Promise.all([
    readTiingoHistory(sym).catch(() => null),
    readTiingoHistory("SPY").catch(() => null),
    readReportDatesChecked(sym).catch(() => ({ ok: false as const })),
    getStockPageSecFacts(sym).catch(() => null),
    readPeSectorMedians().catch(() => null),
    getStockNewsBaseData(sym, { maxDetailedItems: 5 }).catch(() => null),
    resolveFactSetForRender(sym).catch(() => null),
  ]);
  const bars = ((eod?.bars ?? []) as EodBar[]).filter((b) => Number.isFinite(b[4]) && b[4] > 0);
  const spy = ((spyEod?.bars ?? []) as EodBar[]).filter((b) => Number.isFinite(b[4]) && b[4] > 0);
  const sector = sectorOf(sym);
  // THE NEXT-REPORT LINE AND THE VOTE'S WINDOWS, from the one record read above.
  const outlook = outlookFromRead(sym, dates, today);
  const windows = voteWindows(announcedDates(dates.ok ? dates.rec : null), today);
  let called: string | null = null;
  if (windows.previous) {
    const prev = windows.previous;
    const tally = await readVoteTally(slug, prev.id).catch(() => null);
    if (tally) {
      const a = prev.from ? indexOnOrBefore(bars, prev.from) : -1, b = indexOnOrBefore(bars, prev.to);
      const move = a >= 0 && b > a ? ((bars[b][4] - bars[a][4]) / bars[a][4]) * 100 : null;
      called = calledWords(sym, tally, move, dayWords(prev.to));
    }
  }
  const [sectorRow, screenFlags, capex] = await Promise.all([
    sector?.slug ? getSectorPerformanceRow(sector.slug).catch(() => null) : null,
    readScreenFlags().catch(() => null),
    readCapexShared().catch(() => null),
  ]);

  const company = normaliseCompanyName(snapshotCompanyName(sym)) || facts?.profileFacts.entityName || sym;
  const label = bars.length ? setupLabel(bars, n.date, level) : null;
  const since = bars.length ? sinceView(bars, spy.length ? spy : null, n.date, level) : null;
  const price = bars.at(-1)?.[4] ?? null;

  // THE CHART: the post's window, its level and today's zones.
  let chart: ChartData | null = null, thumb: number[] | null = null;
  if (bars.length >= 2) {
    const pub = Math.max(0, bars.findLastIndex((b) => b[0] <= n.date));
    const start = Math.max(0, Math.min(pub - LEAD_IN, bars.length - MIN_BARS));
    const closes = bars.map((b) => b[4]);
    const cut = <T,>(a: T[]) => a.slice(start);
    const keyBars: KeyBar[] = bars.map(([date, open, high, low, close]) => ({ date, open, high, low, close }));
    const ma50 = levelSeries(bars, "MA50"), ma200 = levelSeries(bars, "MA200");
    const conf = confluence({ bars: keyBars, lastPrice: price, nowMs, ma50: ma50.at(-1) ?? null, ma200: ma200.at(-1) ?? null, macro: null });
    const lvlSeries = level ? levelSeries(bars, level) : null;
    chart = {
      points: cut(bars.map((b) => ({ date: b[0], close: b[4] }))),
      fullCloses: closes,
      displayStart: start,
      ma50: cut(ma50), ma200: cut(ma200),
      wma200: level === "WMA200" ? cut(lvlSeries!) : null,
      bbMid: level === "BBMID" ? cut(lvlSeries!) : null,
      publishIndex: pub - start,
      level: level && lvlSeries ? { kind: level, name: LEVEL_NAME[level], series: cut(lvlSeries) } : null,
      todayLevels: [...conf.above, ...(conf.inside ? [conf.inside] : []), ...conf.below].map((z) => ({ price: (z.lo + z.hi) / 2, label: `${z.count} levels` })),
    };
    thumb = closes.slice(Math.max(0, pub - 119), pub + 1);
  }

  // FROM THE FILINGS: the snapshot tiles, the P/E against its sector's median, the cap.
  const inputs = facts?.profileFacts.valuation ?? null;
  const cap = inputs ? marketCap(inputs, price) : null;
  const peFig = inputs ? peRatio(inputs, price) : null;
  let pe: InsightPageData["pe"] = null;
  if (peFig?.ok && !isBankSic(registrantFor(sym)?.sic)) {
    const s = peSectorOf(sym);
    const line = s ? peSectorLine(peFig.val, s, medians?.sectors[s as string], medians?.asOf ? readableDate(medians.asOf) : "") : null;
    if (line && line.median !== null) pe = { value: peFig.val, text: line.text, note: line.note, median: line.median };
  }

  // SCREENS: the flags with a page, ordered as SCREEN_ROUTES lists them.
  const flags = screenFlags?.[sym] ?? null;
  const capexMention = capex?.mentions[sym] ?? null;
  const screens = flags ? flags.map((f) => ({ label: SCREEN_ROUTES[f].label, href: SCREEN_ROUTES[f].href })) : screenFlags ? [] : null;

  // MORE ON {TICKER}: three cards, each only when the stock has that data.
  const more: MoreCard[] = [];
  const bnPosts = getAllBottleneckPosts();
  const named = buildHubCompanies(bnPosts).find((c) => c.key === sym);
  const own = bnPosts.find((p) => p.slug === sym.toLowerCase()) ?? null;
  if (named || own) {
    more.push({
      kind: "bottlenecks", href: own ? `/bottlenecks/${sym.toLowerCase()}` : "/bottlenecks", company, ownPage: !!own,
      suppliers: own ? [...own.supplyChain].sort((x, y) => y.pct - x.pct).slice(0, 4).map((c) => ({ name: c.name, ticker: c.ticker, pct: c.pct })) : [],
      dependants: { count: named?.count ?? 0, names: (named?.pages ?? []).slice(0, 3).map((p) => p.companyName || p.symbol) },
    });
  }
  if (capexMention && capex) {
    // A spender's own capex, latest and prior year, from the fact set already read.
    let ownCapex: Extract<MoreCard, { kind: "capex" }>["own"] = null;
    if (capexMention.list === "spending" && cold?.status === "ready") {
      const ys = toSpendingInput(cold.set, null, null).years.filter((y) => typeof y.capex === "number" && y.capex !== 0).sort((x, y) => x.e.localeCompare(y.e));
      const latest = ys.at(-1), prior = ys.at(-2);
      if (latest?.capex) ownCapex = { year: latest.e.slice(0, 4), value: Math.abs(latest.capex), prior: prior?.capex ? Math.abs(prior.capex) : null,
        changePct: prior?.capex ? ((Math.abs(latest.capex) - Math.abs(prior.capex)) / Math.abs(prior.capex)) * 100 : null };
    }
    more.push({ kind: "capex", href: "/bottlenecks/capex", mention: capexMention, own: ownCapex,
      flow: capexMention.list === "spending" ? { from: [], to: capex.topReceivers } : { from: capex.topSpenders, to: [] } });
  }
  const pick = screenFor(label, flags);
  if (pick) more.push({ kind: "pickers", href: pick.href, label: pick.label });
  if (more.length < 3 && sector?.slug) more.push({ kind: "sector", href: `/sector/${sector.slug}`, name: sector.name });
  if (more.length < 3) more.push({ kind: "calendar", href: "/earnings-calendar" });
  if (more.length < 3) more.push({ kind: "spx", href: "/markets/spx" });

  // RELATED: three by peer, then sector, then newest; each with its picture.
  const taken = { names: new Set<string>(), buckets: new Map<string, Set<number>>() };
  const art = artFor(sym, n.title, `insight:${slug}`, taken);
  const all = getAllPosts().filter((p) => p.slug !== slug && p.symbol);
  const same = (p: (typeof all)[number]) => (p.symbol ?? "").toUpperCase() === sym;
  const sameSector = (p: (typeof all)[number]) => !!sector && sectorOf(String(p.symbol))?.name === sector.name;
  const ranked = [...all.filter(same), ...all.filter((p) => !same(p) && sameSector(p)), ...all.filter((p) => !same(p) && !sameSector(p))].slice(0, 3);
  const related = ranked.map((p) => ({ slug: p.slug, title: p.title, date: p.date, symbol: String(p.symbol).toUpperCase(), art: artFor(String(p.symbol), p.title, `insight:${p.slug}`, taken) }));

  // WHAT'S DRIVING IT NOW: the news page's lead items (newest, deduped, on topic) and its score.
  const news: InsightNews | null = newsBase ? {
    // AT MOST THREE, AND NO FILING NOTICES, QUOTE PAGES OR FOREIGN LISTINGS
    // (#563 COWORK #146 §2/§5, #147): B's predicate (lib/server/news/junkTitle.ts,
    // #818), the same rule the news store applies. The card's items carry no
    // provider, so the SEC adapter's exemption does not arise here.
    items: (newsBase.detailedNews ?? []).filter((i) => i.title && /^https?:\/\//.test(i.link ?? "") && junkReason(i.title) === null).slice(0, NEWS_SHOWN).map((i) => ({ title: i.title, link: i.link, source: i.source ?? null, date: i.pubDate ?? null })),
    score: newsBase.newsScore?.available ? { label: newsBase.newsScore.label, tone: newsBase.newsScore.tone, reason: newsBase.newsScore.reason } : null,
  } : null;
  const SHORT: Record<string, string> = { MA50: "50-day", MA200: "200-day", WMA200: "200-week", BBMID: "20-day" };
  const lvNow = level && bars.length ? levelSeries(bars, level).at(-1) ?? null : null;
  const screenRef = pick && /200-day/.test(pick.label) ? levelSeries(bars, "MA200") : pick && /50-day/.test(pick.label) ? levelSeries(bars, "MA50") : null;

  return {
    n, company, label, since, news,
    railBars: bars.slice(-70).map(([date, open, high, low, close]) => ({ date, open, high, low, close })),
    discussed: level && lvNow !== null ? { label: SHORT[level], value: lvNow } : null,
    screenChart: bars.length >= 20 ? { closes: bars.slice(-60).map((b) => b[4]), ref: screenRef ? screenRef.slice(-60) : null } : null,
    difference: bars.length ? differenceNote(n, bars) : null,
    chart, thumb, art, sector,
    capWords: cap?.ok ? capText(cap.val) : null,
    nextReport: outlook?.window ? (outlook.window.estimate ? `~${outlook.window.line} (estimated)` : outlook.window.line) : null,
    snapshot: facts?.snapshot ?? null,
    pe, screens,
    sectorMove: sectorRow ? { name: sectorRow.name, slug: sectorRow.slug, day: sectorRow.day, week: sectorRow.week, month: sectorRow.month, ytd: sectorRow.ytd, rank: sectorRow.rank } : null,
    more: more.slice(0, 3), related,
    onTiingo: bars.length > 0,
    vote: { window: windows.current.id, called },
  };
}

/** The page's data, cached per post for 6 hours (the reads above, at most four times a day a post). */
export const getInsightPageDataCached = unstable_cache(
  (slug: string) => getInsightPageData(slug),
  ["insight-page-data-v4"],
  { revalidate: 21600, tags: ["insight-page-data"] },
);
