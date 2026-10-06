// EVERYTHING THE INSIGHT PAGE READS (#563 COWORK #132/#133), in one place so
// the page stays layout and the command count is countable.
//
// READS, PER REFILL. The route renders per request (see page.tsx), so the
// whole result is cached per post for 6 hours (getInsightPageDataCached): the
// figures are end-of-day, and a reader sees the same page all day. Per refill:
//   readTiingoHistory(SYM), readTiingoHistory("SPY")  2 GETs, Data Cache 24 h
//   getSymbolOutlook                                   2 GETs (report dates + the universe probe)
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
import { getSymbolOutlook } from "@/lib/server/symbolOutlook";
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
import { confluence } from "@/lib/ta/confluence";
import { keyLevels, type KeyBar } from "@/lib/ta/keyLevels";
import {
  differenceNote, levelSeries, normaliseInsight, setupLabel, sinceView, LEVEL_NAME,
  type EodBar, type NormalisedInsight, type SetupLabel, type SinceView,
} from "@/lib/insightView";
import { SCREEN_ROUTES, screenFor, type ScreenFlag } from "@/lib/insightScreens";

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
export type CapexMention = { list: "spending" | "receiving"; rank: number; of: number; amount: string; line: string | null };
const readCapexRanks = unstable_cache(
  async (): Promise<Record<string, CapexMention> | null> => {
    const [sp, rc] = await Promise.all([readSpendingRecord().catch(() => null), readReceiversRecord().catch(() => null)]);
    if (!sp && !rc) return null;
    const out: Record<string, CapexMention> = {};
    const leaders = sp?.leaders ?? [];
    leaders.forEach((l, i) => { out[l.symbol.toUpperCase()] = { list: "spending", rank: i + 1, of: leaders.length, amount: `$${(l.capex / 1e9).toFixed(1)}bn`, line: null }; });
    const recv = rc ? buildTopReceivers(RECEIVER_ENTRIES, rc.rows ?? {}, () => "", Infinity) : [];
    recv.forEach((r, i) => {
      const t = r.ticker.toUpperCase();
      if (!out[t]) out[t] = { list: "receiving", rank: i + 1, of: recv.length, amount: r.amount, line: r.line };
    });
    return out;
  },
  ["insight-capex-ranks-v1"],
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

export type ZoneRow = { lo: number; hi: number; count: number };
export type LevelsToday = {
  price: number;
  above: ZoneRow[];
  below: ZoneRow[];
  inside: ZoneRow | null;
  monthLow: number | null;
  discussed: { name: string; value: number; pct: number } | null;
  asOf: string;
};

export type MoreCard =
  | { kind: "bottlenecks"; href: string; count: number; company: string; pages: string[]; ownPage: boolean }
  | { kind: "capex"; href: string; mention: CapexMention }
  | { kind: "pickers"; href: string; label: string }
  | { kind: "sector"; href: string; name: string }
  | { kind: "calendar"; href: string }
  | { kind: "spx"; href: string };

export type InsightPageData = {
  n: NormalisedInsight;
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
  levelsToday: LevelsToday | null;
  screens: { label: string; href: string }[] | null;
  sectorMove: { name: string; slug: string; day: number | null; week: number | null; month: number | null; ytd: number | null; rank: number | null } | null;
  more: MoreCard[];
  related: { slug: string; title: string; date: string; symbol: string; art: CardArt }[];
  onTiingo: boolean;
};

const capText = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

function sectorOf(symbol: string): { name: string; slug: string | null } | null {
  const label = sicProfileFor(symbol)?.sector ?? null;
  if (!label) return null;
  const def = getSectorByLabel(label);
  return { name: def?.shortName ?? label, slug: def?.slug ?? null };
}

function artFor(symbol: string, title: string, key: string, taken: { names: Set<string>; buckets: Map<string, Set<number>> }): CardArt {
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
  const [eod, spyEod, outlook, facts, medians] = await Promise.all([
    readTiingoHistory(sym).catch(() => null),
    readTiingoHistory("SPY").catch(() => null),
    getSymbolOutlook(sym, today).catch(() => null),
    getStockPageSecFacts(sym).catch(() => null),
    readPeSectorMedians().catch(() => null),
  ]);
  const bars = ((eod?.bars ?? []) as EodBar[]).filter((b) => Number.isFinite(b[4]) && b[4] > 0);
  const spy = ((spyEod?.bars ?? []) as EodBar[]).filter((b) => Number.isFinite(b[4]) && b[4] > 0);
  const sector = sectorOf(sym);
  const [sectorRow, screenFlags, capex] = await Promise.all([
    sector?.slug ? getSectorPerformanceRow(sector.slug).catch(() => null) : null,
    readScreenFlags().catch(() => null),
    readCapexRanks().catch(() => null),
  ]);

  const company = normaliseCompanyName(snapshotCompanyName(sym)) || facts?.profileFacts.entityName || sym;
  const label = bars.length ? setupLabel(bars, n.date, level) : null;
  const since = bars.length ? sinceView(bars, spy.length ? spy : null, n.date, level) : null;
  const price = bars.at(-1)?.[4] ?? null;

  // THE CHART: the post's window, its level and today's zones.
  let chart: ChartData | null = null, thumb: number[] | null = null, levelsToday: LevelsToday | null = null;
  if (bars.length >= 2) {
    const pub = Math.max(0, bars.findLastIndex((b) => b[0] <= n.date));
    const start = Math.max(0, Math.min(pub - LEAD_IN, bars.length - MIN_BARS));
    const closes = bars.map((b) => b[4]);
    const cut = <T,>(a: T[]) => a.slice(start);
    const keyBars: KeyBar[] = bars.map(([date, open, high, low, close]) => ({ date, open, high, low, close }));
    const ma50 = levelSeries(bars, "MA50"), ma200 = levelSeries(bars, "MA200");
    const conf = confluence({ bars: keyBars, lastPrice: price, nowMs, ma50: ma50.at(-1) ?? null, ma200: ma200.at(-1) ?? null, macro: null });
    const mid = (z: { lo: number; hi: number; count: number }): ZoneRow => ({ lo: z.lo, hi: z.hi, count: z.count });
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
    const kl = keyLevels(keyBars, { nowMs });
    const month = kl.periods.find((p) => p.key === "month");
    const lv = lvlSeries?.at(-1) ?? null;
    levelsToday = {
      price: price ?? bars.at(-1)![4],
      above: conf.above.map(mid), below: conf.below.map(mid), inside: conf.inside ? mid(conf.inside) : null,
      monthLow: month && !month.reason ? (month.levels.low?.value ?? null) : null,
      discussed: level && lv !== null && price !== null ? { name: LEVEL_NAME[level], value: lv, pct: ((price - lv) / lv) * 100 } : null,
      asOf: bars.at(-1)![0],
    };
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
  const screens = flags ? flags.map((f) => ({ label: SCREEN_ROUTES[f].label, href: SCREEN_ROUTES[f].href })) : screenFlags ? [] : null;

  // MORE ON {TICKER}: three cards, each only when the stock has that data.
  const more: MoreCard[] = [];
  const bnPosts = getAllBottleneckPosts();
  const named = buildHubCompanies(bnPosts).find((c) => c.key === sym);
  const ownPage = bnPosts.some((p) => p.slug === sym.toLowerCase());
  if (named || ownPage) {
    more.push({ kind: "bottlenecks", href: ownPage ? `/bottlenecks/${sym.toLowerCase()}` : "/bottlenecks", count: named?.count ?? 0, company, pages: (named?.pages ?? []).slice(0, 8).map((p) => p.symbol), ownPage });
  }
  if (capex?.[sym]) more.push({ kind: "capex", href: "/bottlenecks/capex", mention: capex[sym] });
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

  return {
    n, company, label, since,
    difference: bars.length ? differenceNote(n, bars) : null,
    chart, thumb, art, sector,
    capWords: cap?.ok ? capText(cap.val) : null,
    nextReport: outlook?.window ? (outlook.window.estimate ? `~${outlook.window.line} (estimated)` : outlook.window.line) : null,
    snapshot: facts?.snapshot ?? null,
    pe, levelsToday, screens,
    sectorMove: sectorRow ? { name: sectorRow.name, slug: sectorRow.slug, day: sectorRow.day, week: sectorRow.week, month: sectorRow.month, ytd: sectorRow.ytd, rank: sectorRow.rank } : null,
    more: more.slice(0, 3), related,
    onTiingo: bars.length > 0,
  };
}

/** The page's data, cached per post for 6 hours (the reads above, at most four times a day a post). */
export const getInsightPageDataCached = unstable_cache(
  (slug: string) => getInsightPageData(slug),
  ["insight-page-data-v1"],
  { revalidate: 21600, tags: ["insight-page-data"] },
);
