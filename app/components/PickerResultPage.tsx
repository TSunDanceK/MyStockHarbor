import Link from "next/link";
import { headers } from "next/headers";
import type { MiniCandlePoint, SupportResistanceZone } from "@/app/components/MiniPickerCandleChart";
import PickerHighlightScroller from "@/app/components/PickerHighlightScroller";
import ScreenerNav from "@/app/components/ScreenerNav";
import HowToCollapse from "@/app/components/HowToCollapse";
import ScreenerHeroHeading from "@/app/components/ScreenerHeroHeading";
import PickerResultsGrid, { type TabKey } from "@/app/components/PickerResultsGrid";
import ScanFooter from "@/app/components/ScanFooter";
import { PickerFilterProvider } from "@/app/components/PickerFilterContext";
import { getCompanyNameMap } from "@/lib/server/companyNames";
import { readCachedFundamentalsBulk } from "@/lib/server/fundamentalsCache";
import { readPricePoolBulk } from "@/lib/server/pricePool";
import { readCachedStockDataBulk } from "@/lib/server/stockDataCache";
import { getPickersData } from "@/lib/server/pickersBuilder";
import { WatermarkVisibilityProvider, HideWatermarksBar } from "@/app/components/WatermarkVisibility";
import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type FilterKey, type AnyFilterKey } from "@/lib/pickerFilters";
import { CATEGORY_FIELDS, valueSatisfies, type Predicate } from "@/lib/screenerFields";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

export type PickerResultKind = "section" | "buySignals" | "sellSignals" | "allSymbols" | "preset";

export type PickerResultConfig = {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  explainerTitle: string;
  explainerBody: string;
  // Real body copy, rendered below the results as ordinary always-present
  // prose.
  //
  // Deliberately NOT reusing explainerBody. HowToCollapse is a client component
  // that renders its body only once opened (`{open ? <p>…</p> : null}`), and it
  // defaults to closed, so that text never reaches the rendered markup -- it
  // only appears after a click, and crawlers do not click.
  //
  // Be careful checking this: the string IS present in view-source, because
  // Next serialises the prop into the RSC flight payload for hydration. But it
  // is inside a <script> tag, not in the document body. Verified on production
  // 2026-08-04 by fetching /semiconductor-stocks and stripping script tags --
  // the explainer copy vanishes, this bodySections copy survives. Payload text
  // is data for the client runtime, not page content.
  //
  // Fine for a one-line usage hint on a condition page; useless for a landing
  // page, where the copy IS the reason the page can rank. A filtered table plus
  // one generated sentence is thin content -- see
  // claude/preset-pages-universe-blocker-2026-08-04.md.
  bodySections?: { heading: string; paragraphs: string[] }[];
  // Which results tab to open on. Defaults to "general". Set it to the tab
  // holding the metric this page screens on, so the number the page is named
  // after is visible on arrival rather than a click away — dividend growth,
  // payout ratio and free cash flow each appear on exactly one tab.
  defaultTab?: TabKey;
  // The explainer guide covering the same idea as this screen, e.g.
  // /oversold-stocks-today -> /oversold-stocks.
  //
  // These pairs already existed and were not linked in either direction: the
  // guide linked only to the generic /pickers hub, and the screener linked
  // nowhere. Two thin pages targeting the same query with no relationship
  // between them is a cannibalisation setup -- the link is what tells a search
  // engine (and a reader) which is the explanation and which is the live list.
  relatedGuide?: { href: string; label: string; blurb: string };
  emptyText: string;
  tone: PickerTone;
  kind: PickerResultKind;
  sectionIncludes?: string[];
  maxItems?: number;
  filterTimeframe?: "D" | "W";
  // Pages that ship the full analyzed universe whole, with these condition
  // flags pre-ticked client-side (see PickerResultPage below). Accepts both the
  // 18 custom-builder keys (e.g. "belowMA200") and the 7 category-membership
  // keys (e.g. "bestTrendPick", "hasBuySignal"), since several dedicated pages
  // are defined by section membership or a computed score rather than a raw
  // record flag. Setting this is what opts a page into in-place filtering,
  // independently of its `kind`.
  presetFilters?: AnyFilterKey[];
  // Non-boolean seeds: a numeric bound or a category value (see
  // PickerFilterProvider's initialPredicates). This is what defines the
  // "Popular Screens" pages -- /low-pe-stocks is `peRatio` under 15,
  // /semiconductor-stocks is `industry` = Semiconductors. Behaves exactly like
  // presetFilters otherwise: the page ships the full universe with these
  // already applied, and the visitor can loosen or combine them in place.
  presetPredicates?: Predicate[];
  // "allSymbols" pages: show the whole list on load instead of hiding until a
  // condition is checked (used by the plain "All Stocks" / Stock Screener page).
  showAllImmediately?: boolean;
};

type PickerChartFocus = { kind: "ath" | "rangeHigh"; price: number; date: string };

type PickerSectionItem = {
  symbol?: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M" | "ST";
  indicator?: string;
  dashboardHref?: string;
  chartPoints?: MiniCandlePoint[];
  score?: number;
  supportResistanceZone?: SupportResistanceZone;
  chartFocus?: PickerChartFocus;
  dominantIndicator?: string;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items?: PickerSectionItem[];
};

type SignalRecord = {
  symbol?: string;
  note?: string;
  tone?: PickerTone;
  chartPoints?: MiniCandlePoint[];
  score?: number;
  dashboardHref?: string;

  oversold?: boolean;
  overbought?: boolean;
  buyTheDip?: boolean;
  breakout?: boolean;
  volumeSpike?: boolean;
  atrSpike?: boolean;
  aboveMA50?: boolean;
  belowMA50?: boolean;
  aboveMA200?: boolean;
  belowMA200?: boolean;
  dailyMa200Proximity?: boolean;
  weeklyMa200Proximity?: boolean;
  bullishRsiDivergence?: boolean;
  bearishRsiDivergence?: boolean;
  bullishMacdDivergence?: boolean;
  bearishMacdDivergence?: boolean;
  positiveLastEarnings?: boolean;
  strongEarningsGrowth?: boolean;
};

type PickersPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  sections?: PickerSection[];
  signalRecords?: SignalRecord[];
};

// The 18 boolean fields the /pickers "custom builder" filter chips match
// against (see lib/pickerFilters.ts). Carried on every ResultEntry so
// PickerResultsGrid can apply the exact same filter logic client-side,
// against data that's already been sent down for this page -- no refetch.
export type ResultEntryFlags = {
  oversold?: boolean;
  overbought?: boolean;
  buyTheDip?: boolean;
  breakout?: boolean;
  volumeSpike?: boolean;
  atrSpike?: boolean;
  aboveMA50?: boolean;
  belowMA50?: boolean;
  aboveMA200?: boolean;
  belowMA200?: boolean;
  dailyMa200Proximity?: boolean;
  weeklyMa200Proximity?: boolean;
  bullishRsiDivergence?: boolean;
  bearishRsiDivergence?: boolean;
  bullishMacdDivergence?: boolean;
  bearishMacdDivergence?: boolean;
  positiveLastEarnings?: boolean;
  strongEarningsGrowth?: boolean;

  // Category-membership flags (see buildCategoryFlags below) -- "is this
  // symbol also a member of the Buy Signals / Best Trend / Divergence /
  // ATH Breakouts / 3-Month Highs / Macro S/R page's own list right now".
  // Attached to every entry on every page (not just that category's own
  // page) so ScreenerNav's checkboxes for these categories (see
  // ScreenerNav.tsx GROUPS) can narrow *any* page's results the same way
  // the 18 custom-builder conditions already do. Computed for free from
  // the same full `sections` + `signalRecords` payload every picker page
  // already fetches -- no extra requests.
  hasBuySignal?: boolean;
  hasSellSignal?: boolean;
  bestTrendPick?: boolean;
  divergencePick?: boolean;
  athBreakoutPick?: boolean;
  threeMonthHighPick?: boolean;
  macroSrPick?: boolean;
};

export type ResultEntry = ResultEntryFlags & {
  symbol: string;
  companyName?: string;
  note: string;
  tone: PickerTone;
  stockHref: string;
  chartHref: string;
  chartPoints: MiniCandlePoint[];
  badge?: string;
  score?: number;
  reasons?: string[];
  supportResistanceZone?: SupportResistanceZone;

  // Cron-warmed extras attached from Redis in getPickerData. All optional --
  // a symbol not yet warmed just falls back: Market Cap / PE / Industry show
  // "--", and price / % change / volume fall back to the end-of-day close from
  // chartPoints. Industry comes from the fundamentals cache (see
  // fundamentalsCache.ts); price / changePct / volume + fresh marketCap /
  // peRatio come from the ~15-min price pool (see pricePool.ts, layered on top
  // of the fundamentals values).
  marketCap?: number;
  peRatio?: number;
  industry?: string;
  // Broad sector (~11 values, e.g. "Technology") as opposed to the much
  // finer-grained `industry` (~150 values). Both come off the same cached
  // profile record; sector is the one that's usable as a filter, since a
  // dropdown of 150 industries isn't, and "tech stocks" means the sector.
  sector?: string;
  price?: number;
  changePct?: number;
  volume?: number;

  // Extended data for the Valuation / Dividends / Financials / Analysts /
  // Performance list-view tabs. Cron-warmed into Redis by stockDataCache.ts
  // (readCachedStockDataBulk), attached in getPickerData. All optional -- a
  // symbol not yet warmed just shows "--" in those tab columns.
  enterpriseValue?: number;
  forwardEps?: number; // Forward P/E is computed in the grid as price / forwardEps
  psRatio?: number;
  pbRatio?: number;
  pfcfRatio?: number;
  divPerShare?: number;
  divYield?: number; // percent
  payoutRatio?: number; // percent
  divGrowth?: number; // percent, YoY
  payoutFreq?: string;
  revenue?: number;
  operatingIncome?: number;
  netIncome?: number;
  freeCashFlow?: number;
  epsTtm?: number;
  rating?: string;
  analystCount?: number;
  priceTarget?: number;
  perf1w?: number;
  perf1m?: number;
  perf6m?: number;
  perfYtd?: number;
  perf1y?: number;
};

// Deliberately typed as FilterKey (the exact 18-key union from
// lib/pickerFilters.ts), NOT `keyof ResultEntryFlags` -- ResultEntryFlags
// also carries the 7 newer category-membership keys (hasBuySignal etc.,
// see below) which don't exist on SignalRecord. Indexing `record[key]`
// below needs a key type that's guaranteed to be a real SignalRecord field.
const FLAG_KEYS: FilterKey[] = [
  "oversold", "overbought", "buyTheDip", "breakout", "volumeSpike", "atrSpike",
  "aboveMA50", "belowMA50", "aboveMA200", "belowMA200", "dailyMa200Proximity", "weeklyMa200Proximity",
  "bullishRsiDivergence", "bearishRsiDivergence", "bullishMacdDivergence", "bearishMacdDivergence",
  "positiveLastEarnings", "strongEarningsGrowth",
];

function flagsFromRecord(record?: SignalRecord): ResultEntryFlags {
  const flags: ResultEntryFlags = {};
  if (!record) return flags;
  for (const key of FLAG_KEYS) {
    if (record[key] === true) flags[key] = true;
  }
  return flags;
}

function cleanSymbol(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

// Routes "Open chart" links to /dashboard -- works correctly on both mobile and desktop.
function chartHrefFor(symbol: string, href?: string) {
  const fallback = `/dashboard?symbol=${encodeURIComponent(symbol)}`;
  const raw = href && href.trim() ? href.trim() : "";

  // Rewrite legacy /?symbol= links to /dashboard?symbol=
  const normalised = raw.startsWith("/?symbol=")
    ? raw.replace("/?symbol=", "/dashboard?symbol=")
    : raw.startsWith("/?")
    ? raw.replace("/?", "/dashboard?")
    : raw;

  const base = normalised.startsWith("/dashboard") ? normalised : fallback;
  return base.includes("#chart") ? base : `${base}#chart`;
}

// Inserts extra deep-link query params ahead of the "#chart" fragment.
function withExtraChartParams(base: string, extra: Record<string, string | number>) {
  const hashIdx = base.indexOf("#");
  const beforeHash = hashIdx >= 0 ? base.slice(0, hashIdx) : base;
  const hash = hashIdx >= 0 ? base.slice(hashIdx) : "";
  const sep = beforeHash.includes("?") ? "&" : "?";
  const qs = Object.entries(extra)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${beforeHash}${sep}${qs}${hash}`;
}

// Page-specific (config.href-keyed) equivalent of PickersClient's
// buildPickHref -- these dedicated SEO pages are exactly where the
// /pickers accordion's "See all" links send people, so they should carry
// the same pre-configured chart deep links (reference line + zoom, macro
// S/R zone, dominant oversold/overbought indicator, trend MAs).
function chartHrefForEntry(
  configHref: string,
  symbol: string,
  rawHref: string | undefined,
  item: { supportResistanceZone?: SupportResistanceZone; chartFocus?: PickerChartFocus; dominantIndicator?: string }
) {
  const base = chartHrefFor(symbol, rawHref);
  const href = configHref.toLowerCase();

  if (href.includes("macro-support-resistance") && item.supportResistanceZone) {
    const z = item.supportResistanceZone;
    return withExtraChartParams(base, { srLower: z.lower, srUpper: z.upper, srKind: z.kind });
  }
  if ((href.includes("all-time-high-breakout") || href.includes("all-time-highs")) && item.chartFocus?.kind === "ath") {
    return withExtraChartParams(base, { athPrice: item.chartFocus.price, athDate: item.chartFocus.date });
  }
  if (href.includes("3-month-high-breakout") && item.chartFocus?.kind === "rangeHigh") {
    return withExtraChartParams(base, { rangeHighPrice: item.chartFocus.price, rangeHighDate: item.chartFocus.date });
  }
  if ((href.includes("oversold-stocks-today") || href.includes("overbought-stocks-today")) && item.dominantIndicator) {
    return withExtraChartParams(base, { indicator: item.dominantIndicator });
  }
  if (href.includes("best-trend-score")) {
    return withExtraChartParams(base, { indicators: "MA50,MA200" });
  }
  return base;
}

function getBuySignalCount(record: SignalRecord) {
  if (!record.aboveMA200) return 0;
  let count = 0;
  if (record.oversold) count += 1;
  if (record.buyTheDip) count += 1;
  if (record.breakout) count += 1;
  if (record.volumeSpike) count += 1;
  if (record.atrSpike) count += 1;
  if (record.aboveMA50) count += 1;
  if (record.aboveMA200) count += 1;
  if (record.bullishRsiDivergence) count += 1;
  if (record.bullishMacdDivergence) count += 1;
  return count;
}

function getSellSignalCount(record: SignalRecord) {
  let count = 0;
  if (record.overbought) count += 1;
  if (record.belowMA50) count += 1;
  if (record.belowMA200) count += 1;
  if (record.bearishRsiDivergence) count += 1;
  if (record.bearishMacdDivergence) count += 1;
  return count;
}

// Readable labels for each boolean condition behind a buy/sell signal
// score, using the same short indicator naming already used on the
// dashboard's Breakdown panel (RSI Div, MACD, MA200, etc.) so the language
// is consistent across the site. Order here doubles as display priority.
const BUY_REASON_DEFS: Array<{ key: keyof SignalRecord; label: string }> = [
  { key: "aboveMA200", label: "Above MA200" },
  { key: "aboveMA50", label: "Above MA50" },
  { key: "bullishMacdDivergence", label: "MACD Bullish Div" },
  { key: "bullishRsiDivergence", label: "RSI Bullish Div" },
  { key: "breakout", label: "Breakout" },
  { key: "buyTheDip", label: "Buy The Dip" },
  { key: "oversold", label: "RSI Oversold" },
  { key: "volumeSpike", label: "Volume Spike" },
  { key: "atrSpike", label: "ATR Spike" },
];

const SELL_REASON_DEFS: Array<{ key: keyof SignalRecord; label: string }> = [
  { key: "belowMA200", label: "Below MA200" },
  { key: "belowMA50", label: "Below MA50" },
  { key: "bearishMacdDivergence", label: "MACD Bearish Div" },
  { key: "bearishRsiDivergence", label: "RSI Bearish Div" },
  { key: "overbought", label: "RSI Overbought" },
];

function getReasons(record: SignalRecord, defs: Array<{ key: keyof SignalRecord; label: string }>) {
  return defs.filter((def) => record[def.key] === true).map((def) => def.label);
}

// Combined labels for every checkable condition -- the 18 custom-builder
// FILTER_DEFS plus the 7 category-membership CATEGORY_FILTER_DEFS (both
// from lib/pickerFilters.ts) -- used only by the "allSymbols" kind (the
// /custom-screener page) to build reason chips + a score for every
// analyzed symbol, not just the ones clearing a specific score threshold
// the way Buy/Sell Signals do.
const ALL_REASON_DEFS: Array<{ key: keyof ResultEntryFlags; label: string }> = [
  ...FILTER_DEFS.map((def) => ({ key: def.key as keyof ResultEntryFlags, label: def.label })),
  ...CATEGORY_FILTER_DEFS.map((def) => ({ key: def.key as keyof ResultEntryFlags, label: def.label })),
];

function getFlagReasons(flags: ResultEntryFlags, defs: Array<{ key: keyof ResultEntryFlags; label: string }>) {
  return defs.filter((def) => flags[def.key] === true).map((def) => def.label);
}

// Renders the payload timestamp with an EXPLICIT timezone label.
//
// This previously called toLocaleString with no `timeZone`, and it runs
// server-side where Vercel's Node defaults to UTC -- so the string was baked as
// UTC and never re-rendered in the viewer's timezone. A UK visitor on BST read
// a 24-minute-old payload as 84 minutes old and reasonably concluded the cache
// had gone stale. That false alarm is the whole reason for this change.
//
// Deliberately UTC-with-a-label rather than the viewer's local time: this is a
// server component and the formatted string is passed down to ScanFooter as a
// prop, so localising it would need the raw ISO value threaded through and
// re-formatted after hydration -- which risks a hydration mismatch on a value
// that appears on every screener page. Labelling it is unambiguous for every
// visitor regardless of where they are, and carries no such risk.
function formatUpdatedAt(value?: string | null) {
  if (!value) return "Live data";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

async function getOriginFromHeaders() {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host") || "www.mystockharbor.com";
  const proto = headerStore.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function findSection(sections: PickerSection[], includes: string[] = []) {
  return sections.find((section) => {
    const title = section.title.toLowerCase();
    return includes.every((needle) => title.includes(needle.toLowerCase()));
  });
}

function makeRecordMap(records: SignalRecord[]) {
  const map = new Map<string, SignalRecord>();
  for (const record of records) {
    const symbol = cleanSymbol(record.symbol);
    if (!symbol) continue;
    map.set(symbol, record);
  }
  return map;
}

// Hard safety ceiling so a pathological universe (or a future symbol-count
// blowup) can't ship an unbounded payload -- well above anything the
// current universe can produce, so it never actually truncates real results
// the way the old per-page maxItems slice did.
//
// Raised from 500 to 900: the analyzed universe has grown to ~553 symbols, so
// 500 had started silently truncating. Because the allSymbols/preset branch
// sorts by score (conditions met) DESCENDING before slicing, the symbols being
// dropped were the lowest-scoring ones -- which is exactly where a stock that
// meets only one condition lives. That made it possible for a genuine match to
// go missing from its own condition page now that those pages filter the full
// universe client-side.
const RESULT_SAFETY_CAP = 900;

function entriesFromSection(args: {
  configHref: string;
  section: PickerSection | undefined;
  recordMap: Map<string, SignalRecord>;
  fallbackTone: PickerTone;
  filterTimeframe?: "D" | "W";
}) {
  const items = Array.isArray(args.section?.items) ? args.section.items : [];
  const filteredItems = args.filterTimeframe ? items.filter((item) => item.timeframe === args.filterTimeframe) : items;
  return filteredItems.slice(0, RESULT_SAFETY_CAP).map((item): ResultEntry | null => {
    const symbol = cleanSymbol(item.symbol);
    if (!symbol) return null;
    const record = args.recordMap.get(symbol);
    const chartPoints = Array.isArray(item.chartPoints) ? item.chartPoints : Array.isArray(record?.chartPoints) ? record.chartPoints : [];
    const tone = item.tone || record?.tone || args.fallbackTone;
    const note = item.note || record?.note || [item.timeframe, item.indicator].filter(Boolean).join(" · ") || "Screened setup";
    return {
      symbol,
      note,
      tone,
      stockHref: `/stock/${encodeURIComponent(symbol)}`,
      chartHref: chartHrefForEntry(args.configHref, symbol, item.dashboardHref || record?.dashboardHref, item),
      chartPoints,
      badge: [item.timeframe, item.indicator].filter(Boolean).join(" · "),
      score: typeof item.score === "number" ? item.score : typeof record?.score === "number" ? record.score : undefined,
      supportResistanceZone: item.supportResistanceZone,
      ...flagsFromRecord(record),
    };
  }).filter((entry): entry is ResultEntry => Boolean(entry));
}

function buildEntries(args: { config: PickerResultConfig; sections: PickerSection[]; signalRecords: SignalRecord[] }) {
  const { config, sections, signalRecords } = args;
  const recordMap = makeRecordMap(signalRecords);

  if (config.kind === "buySignals") {
    // Every analyzed symbol is kept, not just those scoring above zero. The
    // page's own condition (`hasBuySignal`) is applied client-side instead, by
    // seeding it into PickerFilterProvider as an already-ticked checkbox -- same
    // approach as the "preset" branch below, and for the same reason: dropping
    // the non-qualifying symbols here is what made the Select Screener
    // checkboxes useless on this page, since ANDing a second condition onto a
    // list that was already only buy-signal stocks collapsed to ~zero matches.
    //
    // This branch stays separate from "preset" so the buy-specific presentation
    // survives: the "N of 9 bullish conditions met" note, the score pill driven
    // by that same count, and reason chips drawn from BUY_REASON_DEFS rather
    // than all 25 tracked conditions. A symbol that meets none of them simply
    // reads "0 of 9" and sorts to the bottom -- only ever visible if the visitor
    // unticks Buy Signals, at which point that's the accurate thing to say.
    return signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const score = getBuySignalCount(record);
      // A symbol meeting no bullish conditions is only ever on screen because
      // the visitor unticked Buy Signals -- at which point "0 of 9 bullish
      // conditions met", an empty score pill and a stray chip are noise about a
      // condition they've just switched off. Blank the lot so those rows read
      // as plain universe entries. Note the reasons wipe matters even at score
      // 0: getBuySignalCount gates the whole score on aboveMA200, so a stock
      // below its MA200 scores 0 while getReasons would still return chips for
      // any other conditions it happens to meet.
      const qualifies = score > 0;
      const reasons = qualifies ? getReasons(record, BUY_REASON_DEFS) : [];
      return {
        symbol,
        note: qualifies ? `${score} of ${BUY_REASON_DEFS.length} bullish conditions met` : "",
        tone: "green",
        score: qualifies ? score : undefined,
        reasons,
        stockHref: `/stock/${encodeURIComponent(symbol)}`,
        chartHref: chartHrefFor(symbol, record.dashboardHref),
        chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [],
        ...flagsFromRecord(record),
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, RESULT_SAFETY_CAP);
  }

  if (config.kind === "sellSignals") {
    // Mirror of the buySignals branch above -- see that comment for the
    // reasoning. Keeps SELL_REASON_DEFS chips and the "N of 5 bearish
    // conditions met" note rather than falling back to the generic 25-condition
    // presentation.
    return signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const score = getSellSignalCount(record);
      // Same reasoning as buySignals above -- blank the note, score pill and
      // chips for rows meeting no bearish conditions, since they're only
      // visible once Sell Signals has been unticked.
      const qualifies = score > 0;
      const reasons = qualifies ? getReasons(record, SELL_REASON_DEFS) : [];
      return {
        symbol,
        note: qualifies ? `${score} of ${SELL_REASON_DEFS.length} bearish conditions met` : "",
        tone: "red",
        score: qualifies ? score : undefined,
        reasons,
        stockHref: `/stock/${encodeURIComponent(symbol)}`,
        chartHref: chartHrefFor(symbol, record.dashboardHref),
        chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [],
        ...flagsFromRecord(record),
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, RESULT_SAFETY_CAP);
  }

  if (config.kind === "allSymbols" || config.kind === "preset") {
    // Every analyzed symbol is a candidate entry here (no score-based
    // skipping like buySignals/sellSignals above). For "allSymbols" the
    // filtering happens client-side against whatever the visitor checks; for
    // "preset" (dedicated condition pages like Below MA200) the same full set
    // is filtered server-side to config.presetFilters below. Category-
    // membership flags are computed once up front so they can be folded into
    // each entry's reasons/score alongside the 18 custom-builder flags.
    const categoryFlags = buildCategoryFlags(sections, signalRecords);
    const all = signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const flags: ResultEntryFlags = { ...flagsFromRecord(record), ...(categoryFlags.get(symbol) ?? {}) };
      const reasons = getFlagReasons(flags, ALL_REASON_DEFS);
      const score = reasons.length;
      return {
        symbol,
        note: `${score} of ${FILTER_DEFS.length + CATEGORY_FILTER_DEFS.length} tracked conditions met`,
        tone: config.tone,
        score,
        reasons,
        stockHref: `/stock/${encodeURIComponent(symbol)}`,
        chartHref: chartHrefFor(symbol, record.dashboardHref),
        chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [],
        ...flags,
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, RESULT_SAFETY_CAP);

    // NOTE: "preset" deliberately returns the FULL universe here, exactly like
    // "allSymbols". The page's own condition is applied client-side instead,
    // by seeding it into PickerFilterProvider's initialFilters (see the page
    // component below). Server-filtering it here is what used to make the
    // Select Screener checkboxes useless on these pages -- the shipped data set
    // was only that one category's stocks, so ANDing any second condition onto
    // it collapsed to ~zero matches. Shipping the whole universe lets a visitor
    // untick the page's own condition (turning it into the All Stocks screener
    // in place) or combine it with another, without navigating away.
    //
    // Preset pages converted over from the old "section" kind additionally
    // declare `sectionIncludes`. Those pages' entries used to be built straight
    // from the section's item list, which carries per-item detail that does NOT
    // exist on a plain signalRecord: the chart deep-link inputs
    // (supportResistanceZone / chartFocus / dominantIndicator, consumed by
    // chartHrefForEntry), the timeframe+indicator badge, richer chartPoints, and
    // the section's own ordering. Dropping to the universe alone would silently
    // lose all of that. So: build from the universe, then re-apply the section's
    // detail to the entries that appear in it, and sort section members first in
    // the section's own order. Presets with no sectionIncludes (the 2026-07-23
    // batch) skip this entirely and keep the plain score-descending order.
    if (config.kind === "preset" && config.sectionIncludes?.length) {
      const presetSection = findSection(sections, config.sectionIncludes);
      const sectionItems = Array.isArray(presetSection?.items) ? presetSection.items : [];
      const timeframeItems = config.filterTimeframe
        ? sectionItems.filter((item) => item.timeframe === config.filterTimeframe)
        : sectionItems;

      const itemBySymbol = new Map<string, { item: PickerSectionItem; rank: number }>();
      timeframeItems.forEach((item, index) => {
        const itemSymbol = cleanSymbol(item.symbol);
        if (!itemSymbol || itemBySymbol.has(itemSymbol)) return;
        itemBySymbol.set(itemSymbol, { item, rank: index });
      });

      const UNRANKED = Number.MAX_SAFE_INTEGER;
      const ranked = all.map((entry) => {
        const hit = itemBySymbol.get(entry.symbol);
        if (!hit) return { entry, rank: UNRANKED };
        const { item } = hit;
        // Rebuild the chart link with this page's deep-link params (macro S/R
        // zone, ATH / 3-month-high reference line, dominant RSI/MACD indicator).
        entry.chartHref = chartHrefForEntry(config.href, entry.symbol, item.dashboardHref, item);
        if (item.supportResistanceZone) entry.supportResistanceZone = item.supportResistanceZone;
        if (Array.isArray(item.chartPoints) && item.chartPoints.length) entry.chartPoints = item.chartPoints;
        if (item.tone) entry.tone = item.tone;
        const badge = [item.timeframe, item.indicator].filter(Boolean).join(" · ");
        if (badge) entry.badge = badge;
        return { entry, rank: hit.rank };
      });

      ranked.sort(
        (a, b) =>
          a.rank - b.rank ||
          (b.entry.score ?? 0) - (a.entry.score ?? 0) ||
          a.entry.symbol.localeCompare(b.entry.symbol)
      );
      return ranked.map((r) => r.entry);
    }

    return all;
  }

  const section = findSection(sections, config.sectionIncludes ?? []);
  return entriesFromSection({ configHref: config.href, section, recordMap, fallbackTone: config.tone, filterTimeframe: config.filterTimeframe });
}

// The same `sectionIncludes` needles each dedicated page's own config
// already uses to find its section (see e.g. app/best-trend-score-stocks/
// page.tsx) -- reused here so "is this symbol a member of that category"
// is computed identically to how that category's own page decides it.
// kept in one place so the two can't drift apart.
const CATEGORY_SECTION_DEFS: Array<{ key: keyof ResultEntryFlags; includes: string[] }> = [
  { key: "bestTrendPick", includes: ["best trend score"] },
  { key: "divergencePick", includes: ["divergence"] },
  { key: "macroSrPick", includes: ["macro", "support", "resistance"] },
  { key: "athBreakoutPick", includes: ["all-time high breakout"] },
  { key: "threeMonthHighPick", includes: ["3-month high breakout"] },
];

// Builds a symbol -> category-membership map covering every checkable
// category that isn't already one of the 18 custom-builder flags (see
// ResultEntryFlags above) -- Buy/Sell Signals (a computed score threshold,
// same logic as their own dedicated pages) plus the five section-backed
// categories (membership in that section's own item list). Runs once per
// request against data the page already fetched in full (`sections` and
// `signalRecords` are never trimmed to just the current page's own
// category), so every page can offer every category as a checkbox with no
// extra network/API cost.
function buildCategoryFlags(sections: PickerSection[], signalRecords: SignalRecord[]) {
  const flags = new Map<string, Partial<ResultEntryFlags>>();
  const setFlag = (symbol: string, key: keyof ResultEntryFlags) => {
    const clean = cleanSymbol(symbol);
    if (!clean) return;
    const existing = flags.get(clean) ?? {};
    existing[key] = true;
    flags.set(clean, existing);
  };

  for (const def of CATEGORY_SECTION_DEFS) {
    const section = findSection(sections, def.includes);
    for (const item of section?.items ?? []) {
      if (item.symbol) setFlag(item.symbol, def.key);
    }
  }

  for (const record of signalRecords) {
    if (!record.symbol) continue;
    if (getBuySignalCount(record) > 0) setFlag(record.symbol, "hasBuySignal");
    if (getSellSignalCount(record) > 0) setFlag(record.symbol, "hasSellSignal");
  }

  return flags;
}

// Server-side twin of PickerResultsGrid's `valueForField`: resolves a registry
// field key to the value a predicate is tested against. Everything in
// lib/screenerFields.ts is a plain ResultEntry property except price /
// changePct / volume, which fall back to the end-of-day close and volume off
// chartPoints when the ~15-min price pool hasn't warmed that symbol.
//
// The two have to agree, because they filter the same page from opposite ends:
// the grid decides what the visitor sees, this decides what the crawler gets in
// the SSR'd HTML and what goes into the ItemList structured data. If they
// diverged, a preset page would advertise a different set than it displays.
// None of the six launch screens use the derived three, but a future
// `price=..50` page would land here silently, so the fallback is handled rather
// than left as a trap.
function valueForPredicateField(entry: ResultEntry, field: string): unknown {
  const direct = (entry as unknown as Record<string, unknown>)[field];
  if (field !== "price" && field !== "changePct" && field !== "volume") return direct;
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;

  const points = Array.isArray(entry.chartPoints) ? entry.chartPoints : [];
  const last = points[points.length - 1];
  if (!last) return undefined;

  if (field === "price") {
    return Number.isFinite(last.close) ? last.close : undefined;
  }
  if (field === "volume") {
    return typeof last.volume === "number" && Number.isFinite(last.volume) ? last.volume : undefined;
  }

  const prev = points.length > 1 ? points[points.length - 2] : undefined;
  const lastClose = Number.isFinite(last.close) ? last.close : null;
  const prevClose = prev && Number.isFinite(prev.close) ? prev.close : null;
  return lastClose != null && prevClose != null && prevClose !== 0
    ? ((lastClose - prevClose) / prevClose) * 100
    : undefined;
}

async function getPickerData(config: PickerResultConfig) {
  try {
    const origin = await getOriginFromHeaders();
    // Read the pickers payload in-process (the same Redis-cached builder the
    // /api/pickers route uses) instead of the server fetching its own public
    // URL. That self-request looked like an anonymous bot to our own Vercel
    // firewall; going in-process removes it entirely. See
    // claude/pickers-firewall-selfblock-2026-07-17.md.
    const payload = (await getPickersData(origin)) as unknown as PickersPayload;
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const signalRecords = Array.isArray(payload.signalRecords) ? payload.signalRecords : [];
    const matchedSection = config.kind === "section" ? findSection(sections, config.sectionIncludes ?? []) : undefined;
    // Full matched set (bounded only by RESULT_SAFETY_CAP, not by
    // config.maxItems) -- config.maxItems is now just the initial "shown"
    // batch size for the client-side See More button, not a hard cutoff of
    // what's computed/sent. See PickerResultsGrid.tsx.
    const entries = buildEntries({ config, sections, signalRecords });

    // Merge in category-membership flags (Buy Signals, Sell Signals, Best
    // Trend, Divergence, ATH Breakouts, 3-Month Highs, Macro S/R) so
    // ScreenerNav's checkboxes for those categories can filter *this*
    // page's entries too, not just the categories that already had a
    // custom-builder equivalent. See buildCategoryFlags above.
    const categoryFlags = buildCategoryFlags(sections, signalRecords);
    for (const entry of entries) {
      const extra = categoryFlags.get(entry.symbol);
      if (extra) Object.assign(entry, extra);
    }

    // Best-effort company names for the card display line. Never blocks or
    // breaks the page: any symbol that doesn't resolve just shows the ticker.
    try {
      const nameMap = await getCompanyNameMap();
      if (nameMap.size) {
        for (const entry of entries) {
          const name = nameMap.get(entry.symbol);
          if (name) entry.companyName = name;
        }
      }
    } catch {
      // names are optional
    }

    // Best-effort fundamentals (market cap, PE, industry) for the list view's
    // extra columns. Redis-ONLY read (see fundamentalsCache.readCachedFundamentalsBulk)
    // -- populated daily by the warm-fundamentals cron, so this never spends
    // an FMP call on a page render. Any symbol not yet warmed just shows "--".
    try {
      const fundamentals = await readCachedFundamentalsBulk(entries.map((e) => e.symbol));
      if (fundamentals.size) {
        for (const entry of entries) {
          const f = fundamentals.get(entry.symbol);
          if (!f) continue;
          if (f.marketCap != null) entry.marketCap = f.marketCap;
          if (f.peRatio != null) entry.peRatio = f.peRatio;
          if (f.industry) entry.industry = f.industry;
          if (f.sector) entry.sector = f.sector;
        }
      }
    } catch {
      // fundamentals are optional
    }

    // Fresher ~15-min quotes (price, % change, volume + fresh market cap & PE)
    // from the price pool, layered on top of the daily/fundamentals values
    // above. Redis-ONLY read (see pricePool.readPricePoolBulk) -- populated by
    // the warm-price-pool cron, so a page render never spends an FMP call. Any
    // symbol not yet pooled just keeps its EOD/fundamentals values (the list
    // view falls back to the end-of-day close for price/%change/volume).
    try {
      const pool = await readPricePoolBulk(entries.map((e) => e.symbol));
      if (pool.size) {
        for (const entry of entries) {
          const p = pool.get(entry.symbol);
          if (!p) continue;
          if (p.price != null) entry.price = p.price;
          if (p.changePct != null) entry.changePct = p.changePct;
          if (p.volume != null) entry.volume = p.volume;
          if (p.marketCap != null) entry.marketCap = p.marketCap;
          if (p.pe != null) entry.peRatio = p.pe;
        }
      }
    } catch {
      // pooled quotes are optional
    }

    // Extended data (valuation / dividends / financials / analysts / performance)
    // for the list-view tabs. Redis-ONLY read (see stockDataCache) -- warmed by
    // the warm-stock-data cron, so a page render never spends an FMP call. Any
    // symbol not yet warmed just shows "--" in those tab columns.
    try {
      const extra = await readCachedStockDataBulk(entries.map((e) => e.symbol));
      if (extra.size) {
        for (const entry of entries) {
          const d = extra.get(entry.symbol);
          if (!d) continue;
          if (d.enterpriseValue != null) entry.enterpriseValue = d.enterpriseValue;
          if (d.forwardEps != null) entry.forwardEps = d.forwardEps;
          if (d.psRatio != null) entry.psRatio = d.psRatio;
          if (d.pbRatio != null) entry.pbRatio = d.pbRatio;
          if (d.pfcfRatio != null) entry.pfcfRatio = d.pfcfRatio;
          if (d.divPerShare != null) entry.divPerShare = d.divPerShare;
          if (d.divYield != null) entry.divYield = d.divYield;
          if (d.payoutRatio != null) entry.payoutRatio = d.payoutRatio;
          if (d.divGrowth != null) entry.divGrowth = d.divGrowth;
          if (d.payoutFreq) entry.payoutFreq = d.payoutFreq;
          if (d.revenue != null) entry.revenue = d.revenue;
          if (d.operatingIncome != null) entry.operatingIncome = d.operatingIncome;
          if (d.netIncome != null) entry.netIncome = d.netIncome;
          if (d.freeCashFlow != null) entry.freeCashFlow = d.freeCashFlow;
          if (d.epsTtm != null) entry.epsTtm = d.epsTtm;
          if (d.rating) entry.rating = d.rating;
          if (d.analystCount != null) entry.analystCount = d.analystCount;
          if (d.priceTarget != null) entry.priceTarget = d.priceTarget;
          if (d.perf1w != null) entry.perf1w = d.perf1w;
          if (d.perf1m != null) entry.perf1m = d.perf1m;
          if (d.perf6m != null) entry.perf6m = d.perf6m;
          if (d.perfYtd != null) entry.perfYtd = d.perfYtd;
          if (d.perf1y != null) entry.perf1y = d.perf1y;
        }
      }
    } catch {
      // extended data is optional
    }

    // On any page that ships the full universe with its own condition seeded
    // client-side (see buildEntries), that condition still has to be applied
    // here for the two things decided server-side and not re-derivable on the
    // client: the CollectionPage/ItemList structured data (which must describe
    // the stocks this URL actually ranks for, not the full universe) and the
    // "Live matches" count. Keyed off presetFilters so it covers both the
    // "preset" kind and the Buy/Sell Signals pages. Everything the visitor sees
    // is filtered client-side from the same seeded selection.
    const presetKeys = config.presetFilters ?? [];
    const presetPredicates = config.presetPredicates ?? [];
    const seoEntries =
      presetKeys.length || presetPredicates.length
        ? entries.filter(
            (entry) =>
              presetKeys.every((k) => entry[k] === true) &&
              presetPredicates.every((p) => valueSatisfies(p, valueForPredicateField(entry, p.field)))
          )
        : entries;

    return {
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      universeSize: typeof payload.universeSize === "number" ? payload.universeSize : null,
      dynamicUniverseCount: typeof payload.dynamicUniverseCount === "number" ? payload.dynamicUniverseCount : null,
      entries,
      seoEntries,
      foundCount: config.filterTimeframe ? seoEntries.length : typeof matchedSection?.foundCount === "number" ? matchedSection.foundCount : seoEntries.length,
    };
  } catch {
    return { updatedAt: null, universeSize: null, dynamicUniverseCount: null, entries: [], seoEntries: [], foundCount: 0 };
  }
}

function isEarningsPickerPage(config: PickerResultConfig) {
  return config.href.includes("earnings");
}

export default async function PickerResultPage({
  config,
  searchParams,
}: {
  config: PickerResultConfig;
  searchParams?: Promise<{ symbol?: string | string[] }>;
}) {
  const { entries, seoEntries, updatedAt, universeSize, dynamicUniverseCount, foundCount } = await getPickerData(config);
  const initialVisibleCount = config.maxItems ?? 36;

  // Pages that ship the full universe and apply their own condition client-side
  // (see buildEntries + PickerFilterProvider below), so the checkboxes in
  // "Select Screener" can narrow or widen the list in place. Driven off
  // `presetFilters` rather than `kind`, because Buy/Sell Signals keep their own
  // kinds for their bespoke scoring and reason chips while still opting in.
  const initialFilters = config.presetFilters ?? [];
  const initialPredicates = config.presetPredicates ?? [];
  const isFilterablePage =
    config.kind === "allSymbols" ||
    config.kind === "preset" ||
    initialFilters.length > 0 ||
    initialPredicates.length > 0;

  // Values actually present in this page's payload for each category field,
  // alphabetical. Derived from the entries rather than hardcoded so a value with
  // nothing behind it is never offered, and so it self-corrects if the profile
  // cache starts returning something we didn't anticipate. Symbols whose profile
  // hasn't been warmed yet simply have no sector/industry and sit outside those
  // filters.
  //
  // Deliberately built from the FULL universe this page ships, not from whatever
  // subset is currently filtered -- otherwise the industry list would collapse
  // as soon as a condition narrowed the results, and you could never widen back
  // out to an industry you'd just filtered away from.
  const categoryValues = Object.fromEntries(
    CATEGORY_FIELDS.map((field) => [
      field.key,
      Array.from(
        new Set(
          entries
            .map((entry) => (entry as unknown as Record<string, unknown>)[field.key])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        )
      ).sort((a, b) => a.localeCompare(b)),
    ])
  ) as Record<string, string[]>;

  // `universeSize` and `dynamicUniverseCount` are now passed to ScanFooter
  // SEPARATELY and rendered as "Universe 260 · Pool 353".
  //
  // They used to be summed into one `combinedUniverseSize`, on the reasoning
  // that a single figure which visibly moves proves the dynamic-universe
  // top-up job is running. It did move, but it was a sum of two different
  // kinds of thing -- symbols actually analyzed, plus an overlapping pool of
  // candidates eligible for a future build -- and the result read as a
  // universe of 613 when only 260 symbols are ever analyzed.
  //
  // That cost real time: a whole investigation went looking for 353 symbols
  // that were being "dropped between the universe and the screener", and they
  // had never existed. Two numbers, each labelled, still show the top-up job
  // working and cannot be misread the same way. See
  // claude/preset-pages-universe-blocker-2026-08-04.md.

  // Supports deep links from the /pickers accordion like
  // /all-time-high-breakout-stocks?symbol=MTB -- scrolls to and briefly
  // highlights that specific card instead of just landing at the top of
  // the list. See PickerHighlightScroller for the client-side scroll/pulse.
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawHighlight = resolvedSearchParams?.symbol;
  const highlightSymbol = cleanSymbol(Array.isArray(rawHighlight) ? rawHighlight[0] : rawHighlight);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: config.title,
    url: `https://www.mystockharbor.com${config.href}`,
    description: config.description,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: seoEntries.slice(0, 24).map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: { "@type": "Thing", name: `${entry.symbol} ${config.title}`, url: `https://www.mystockharbor.com${entry.stockHref}` },
      })),
    },
  };

  return (
    <WatermarkVisibilityProvider>
      <main className="pickerResultPage">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <style>{`
        .pickerResultPage { min-height: 100vh; background: radial-gradient(circle at 12% 0%, rgba(59,130,246,0.16), transparent 30%), radial-gradient(circle at 92% 4%, rgba(34,197,94,0.08), transparent 28%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .resultWrap { max-width: 1360px; margin: 0 auto; padding: 26px 18px 58px; }
        .resultShell { display: grid; grid-template-columns: 288px minmax(0, 1fr); gap: 22px; align-items: start; }
        .resultMain { min-width: 0; }
        .hero { border: 1px solid ${toneBorder(config.tone)}; border-radius: 28px; padding: 22px; background: ${toneBackground(config.tone)}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.045), 0 18px 42px rgba(0,0,0,0.26); }
        .eyebrow { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid ${toneBorder(config.tone)}; background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
        .hero h1 { margin: 12px 0 0; font-size: 44px; line-height: 1.03; letter-spacing: -0.055em; }
        .hero > p { margin: 10px 0 0; max-width: 820px; color: rgba(226,232,240,0.78); font-size: 16px; line-height: 1.65; }
        .heroHowTo { margin-top: 16px; padding: 14px 16px; border-radius: 16px; border: 1px solid rgba(59,130,246,0.18); background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(8,13,22,0.6)); }
        .heroHowToToggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: none; padding: 0; margin: 0; cursor: pointer; font: inherit; text-align: left; color: inherit; }
        .heroHowToLabel { display: block; font-size: 11px; font-weight: 950; letter-spacing: 0.1em; text-transform: uppercase; color: #93c5fd; }
        .heroHowToChevron { flex: 0 0 auto; margin-left: 10px; color: #93c5fd; font-size: 12px; transition: transform 160ms ease; }
        .heroHowTo p { margin: 7px 0 0; max-width: 860px; color: rgba(226,232,240,0.8); font-size: 14px; line-height: 1.65; }
        .resultsHeader { margin-top: 22px; }
        .resultsHeaderTop { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
        .resultsHeaderTop h2 { margin: 0; font-size: 26px; letter-spacing: -0.04em; }
        .resultsHeader p { margin: 8px 0 0; color: rgba(226,232,240,0.70); line-height: 1.6; }
        .resultsGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
        .resultCard { display: block; border: 1px solid rgba(255,255,255,0.09); border-radius: 22px; padding: 15px; background: linear-gradient(180deg, rgba(255,255,255,0.042), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); text-decoration: none; color: inherit; cursor: pointer; transition: transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
        .resultCard:hover { transform: translateY(-2px); border-color: rgba(96,165,250,0.42); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 16px 32px rgba(0,0,0,0.28); }
        .resultCard:focus-visible { outline: 2px solid rgba(96,165,250,0.7); outline-offset: 2px; }
        .resultCardTop { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .resultCardHead { min-width: 0; flex: 1 1 auto; }
        .symbolLine { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
        .symbolLine span.dot { align-self: center; width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; box-shadow: 0 0 0 4px rgba(255,255,255,0.04); }
        .symbolLine h3 { margin: 0; font-size: 23px; letter-spacing: -0.04em; flex: 0 0 auto; }
        .companyName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; letter-spacing: -0.01em; color: rgba(148,163,184,0.92); }
        .badge { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(96,165,250,0.22); border-radius: 999px; padding: 6px 9px; background: rgba(59,130,246,0.08); color: #dbeafe; font-size: 11px; font-weight: 950; white-space: nowrap; }
        .scorePill { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 62px; min-height: 52px; border-radius: 15px; border: 1px solid rgba(34,197,94,0.26); background: rgba(34,197,94,0.10); color: #dcfce7; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); flex: 0 0 auto; }
        .scorePill strong { font-size: 22px; line-height: 1; letter-spacing: -0.04em; }
        .scorePill span { margin-top: 5px; font-size: 10px; font-weight: 950; letter-spacing: 0.04em; color: rgba(220,252,231,0.72); }
        .reasonChips { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
        .reasonChip { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; border: 1px solid; background: rgba(255,255,255,0.04); font-size: 11px; font-weight: 800; letter-spacing: 0.01em; white-space: nowrap; }
        .note { margin: 10px 0 0; color: rgba(226,232,240,0.74); font-size: 13px; line-height: 1.55; min-height: 40px; }
        .emptyBox { margin-top: 16px; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px; padding: 18px; background: rgba(255,255,255,0.035); color: rgba(226,232,240,0.72); line-height: 1.7; }
        .scanDebug { margin-top: 30px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; line-height: 1.5; color: rgba(148,163,184,0.5); letter-spacing: 0.02em; }

        .screenerProse { margin-top: 40px; padding-top: 28px; border-top: 1px solid rgba(255,255,255,0.08); max-width: 780px; }
        .screenerProseBlock + .screenerProseBlock { margin-top: 28px; }
        .screenerProse h2 { margin: 0 0 10px; font-size: 19px; line-height: 1.3; font-weight: 800; color: #e2e8f0; letter-spacing: -0.01em; }
        .screenerProse p { margin: 0 0 12px; font-size: 14.5px; line-height: 1.75; color: rgba(226,232,240,0.78); }
        .screenerProse p:last-child { margin-bottom: 0; }

        .screenerGuideLink { margin-top: 28px; padding: 16px 18px; border: 1px solid rgba(96,165,250,0.28); border-radius: 16px; background: rgba(59,130,246,0.08); max-width: 780px; }
        .screenerGuideEyebrow { display: block; font-size: 10.5px; font-weight: 900; letter-spacing: 0.09em; text-transform: uppercase; color: rgba(147,197,253,0.85); margin-bottom: 6px; }
        .screenerGuideLink p { margin: 0; font-size: 14px; line-height: 1.65; color: rgba(226,232,240,0.8); }
        .screenerGuideLink a { color: #93c5fd; font-weight: 800; text-decoration: underline; text-underline-offset: 2px; }
        @media (max-width: 640px) {
          .screenerProse { margin-top: 32px; padding-top: 22px; }
          .screenerProse h2 { font-size: 17.5px; }
          .screenerProse p { font-size: 14px; line-height: 1.7; }
        }

        .seeMoreWrap { margin-top: 20px; display: flex; justify-content: center; }
        .seeMoreBtn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10); color: #dbeafe; font-weight: 800; font-size: 13.5px; cursor: pointer; }
        .seeMoreBtn:hover { background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); }
        .filterMatchLine { margin: 8px 0 0; font-size: 12.5px; color: rgba(226,232,240,0.65); }
        .viewToggle { display: inline-flex; align-items: center; gap: 6px; padding: 9px 15px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10); color: #dbeafe; font-weight: 800; font-size: 12.5px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; }
        .viewToggle:hover { background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); }
        /* Data-view tabs (General / Performance / Valuation / Dividends / Financials / Analysts) */
        .viewTabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; }
        .viewTab { padding: 7px 13px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); color: rgba(226,232,240,0.78); font-weight: 800; font-size: 12.5px; cursor: pointer; white-space: nowrap; font-family: inherit; }
        .viewTab:hover { border-color: rgba(96,165,250,0.45); color: #dbeafe; }
        .viewTab.active { background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); color: #eff6ff; }
        /* Mobile: the tab row collapses to a dropdown pill in the controls row */
        .tabSelectWrap { display: none; flex: 0 0 auto; }
        .tabSelect { padding: 9px 15px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10); color: #dbeafe; font-weight: 800; font-size: 12.5px; font-family: inherit; cursor: pointer; }
        /* Grey horizontal scrollbar (matches /insights) + a synced top scrollbar */
        .msScrollGrey { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
        .msScrollGrey::-webkit-scrollbar { height: 10px; width: 10px; }
        .msScrollGrey::-webkit-scrollbar-track { background: transparent; }
        .msScrollGrey::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 999px; }
        .msScrollGrey::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.28); }
        .listScrollTop { overflow-x: auto; overflow-y: hidden; margin-top: 14px; }
        .listScrollTop > div { height: 1px; }
        .listTableWrap { margin-top: 8px; border: 1px solid rgba(255,255,255,0.09); border-radius: 18px; overflow: auto; max-height: 66vh; min-height: 220px; background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015)); }
        .listTable { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 860px; }
        .listTable thead th { position: sticky; top: 0; z-index: 2; background: #0b1220; text-align: right; padding: 12px 14px; font-size: 11px; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(148,163,184,0.92); border-bottom: 1px solid rgba(255,255,255,0.10); white-space: nowrap; cursor: pointer; user-select: none; }
        .listTable thead th:first-child, .listTable tbody td:first-child { text-align: left; }
        .listTable thead th.colName, .listTable tbody td.colName, .listTable thead th.colInd, .listTable tbody td.colInd { text-align: left; }
        .listTable thead th:hover { color: #dbeafe; }
        .listTable thead th .sortArrow { margin-left: 5px; font-size: 9px; opacity: 0.9; }
        /* Sticky first column (Symbol) so the row's identity stays visible while
           scrolling horizontally through the rest of the columns. The header's
           corner cell needs the highest z-index (sits above both the plain sticky
           header row and the plain sticky first column); body cells need an
           opaque background so the scrolled-under columns don't show through. */
        .listTable thead th:first-child { left: 0; z-index: 3; box-shadow: 3px 0 8px rgba(0,0,0,0.4); }
        .listTable tbody td:first-child { position: sticky; left: 0; z-index: 1; background: #0a0e17; box-shadow: 3px 0 8px rgba(0,0,0,0.4); }
        .listTable tbody tr:hover td:first-child { background: #131c2e; }
        .listTable tbody tr { cursor: pointer; transition: background 120ms ease; }
        .listTable tbody tr:hover { background: rgba(96,165,250,0.08); }
        .listTable tbody td { padding: 11px 14px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.055); white-space: nowrap; color: rgba(226,232,240,0.92); }
        .listTable tbody tr:last-child td { border-bottom: none; }
        .listSym { display: inline-flex; align-items: center; gap: 8px; font-weight: 900; font-size: 14px; color: #eaf2ff; text-decoration: none; }
        .listSym .dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
        /* display:inline-block is load-bearing, not cosmetic. A <span> is an
           inline box, and max-width / overflow / text-overflow do not apply to
           inline non-replaced elements -- so the caps below were silently
           ignored and a 133-character company name (PAC) stretched the cell,
           the table, and every column to its right clean off the screen.
           The td caps are the belt to that braces: they stop the COLUMN
           growing even if a cell's content escapes the span. */
        .listName { display: inline-block; vertical-align: middle; max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(148,163,184,0.92); }
        .listInd { display: inline-block; vertical-align: middle; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(148,163,184,0.86); }
        .listTable thead th.colName, .listTable tbody td.colName { max-width: 258px; }
        .listTable thead th.colInd, .listTable tbody td.colInd { max-width: 218px; }
        .chgUp { color: #4ade80; font-weight: 800; }
        .chgDown { color: #f87171; font-weight: 800; }
        .muted { color: rgba(148,163,184,0.55); }
        @keyframes pickerHighlightPulse {
          0% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
          15% { box-shadow: 0 0 0 4px rgba(245,197,66,0.35); border-color: #f5c542; }
          50% { box-shadow: 0 0 28px 4px rgba(245,197,66,0.55); border-color: #f5c542; }
          100% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
        }
        .resultCard.highlight { animation: pickerHighlightPulse 2.4s ease-out 1; scroll-margin-top: 90px; }
        .listTable tbody tr.highlight { animation: pickerHighlightPulse 2.4s ease-out 1; scroll-margin-top: 90px; }
        @media (max-width: 980px) {
          .resultShell { grid-template-columns: 1fr; gap: 14px; }
          /* NOTE: the mobile screener trigger no longer lives in its own sticky
             bar here. It's now the first pill in the results controls row (see
             .screenerControls in PickerResultsGrid.tsx), which is where the
             sticky behaviour moved with it -- hung off the results <section> so
             it has real travel, the same lesson the old .screenerTriggerWrap
             taught. The overflow rule below still matters to it: an ancestor
             that is a scroll container breaks position: sticky, which is why
             .resultWrap uses overflow-x: clip rather than hidden. */
        }
        @media (max-width: 720px) {
          .pickerResultPage, .pickerResultPage * { box-sizing: border-box; }
          /* Deliberately "clip", not "hidden". Per the CSS Overflow spec,
             setting one axis to a non-visible value forces the other axis to
             compute as auto, which turns the element into a scroll container --
             and a scroll container silently breaks position: sticky for
             everything inside it. That's the exact bug that stopped the results
             table's sticky header working, and it would stop the controls row
             sticking too. "clip" is the carve-out: paired with "visible" on the
             other axis neither value is coerced, and clip never creates a
             scroll container. Same horizontal-overflow protection, without the
             side effect. */
          .pickerResultPage { overflow-x: clip; }
          .resultWrap { width: 100%; padding: 14px 10px 44px; overflow-x: clip; }
          .hero { border-radius: 20px; padding: 15px; }
          .eyebrow { max-width: 100%; white-space: normal; text-align: center; line-height: 1.35; }
          .hero h1 { font-size: clamp(28px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero > p { font-size: 14px; line-height: 1.62; }
          .heroHowTo { padding: 12px 13px; }
          .resultsHeader { margin-top: 18px; }
          .resultsHeaderTop h2 { font-size: 22px; line-height: 1.14; }
          .resultsHeader p { font-size: 14px; line-height: 1.62; }
          .viewTabs { display: none; }
          .tabSelectWrap { display: inline-flex; }
          .resultsGrid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .resultCard { border-radius: 18px; padding: 13px; }
          .resultCardTop { gap: 10px; }
          .symbolLine h3 { font-size: 21px; }
          .companyName { font-size: 12.5px; }
          .badge { max-width: 100%; white-space: normal; text-align: center; line-height: 1.25; }
          .scorePill { min-width: 54px; min-height: 48px; border-radius: 13px; }
          .scorePill strong { font-size: 20px; }
          .reasonChip { font-size: 10.5px; padding: 4px 8px; }
          .note { min-height: 0; font-size: 13px; }
          .listTableWrap { max-height: 58vh; }
          /* Tighter name/industry caps on phones -- the table already scrolls
             sideways here, so every pixel the name column gives back is one
             fewer swipe to reach the numbers. */
          .listName { max-width: 150px; }
          .listInd { max-width: 130px; }
          .listTable thead th.colName, .listTable tbody td.colName { max-width: 178px; }
          .listTable thead th.colInd, .listTable tbody td.colInd { max-width: 158px; }
        }
        @media (max-width: 390px) { .resultWrap { padding-left: 8px; padding-right: 8px; } .hero, .resultCard { padding: 12px; } }
      `}</style>

        <div className="resultWrap">
          <PickerFilterProvider initialFilters={initialFilters} initialPredicates={initialPredicates}>
            <div className="resultShell">
              <ScreenerNav currentHref={config.href} variant="sidebar" showFilters showSearch alwaysFilterMode={isFilterablePage} categoryValues={categoryValues} />

              <div className="resultMain">
                {/* The hero's "Search a ticker" box has been removed. It answered
                    "does this one stock meet any tracked condition", which is a
                    single-stock question on a page whose whole job is ranking a
                    list -- and it sat between the visitor and the results,
                    costing a screenful on a phone. The site's other ticker
                    searches (header, stock pages, earnings) already cover
                    looking one name up. CustomScreenerSymbolSearch.tsx is left
                    in the repo unreferenced in case it wants a home elsewhere. */}
                <section className="hero">
                  <ScreenerHeroHeading
                    eyebrow={config.eyebrow}
                    title={config.title}
                    description={config.description}
                    presetFilters={initialFilters}
                    presetHref={config.href}
                    dotColour={toneColour(config.tone)}
                  >
                    <HowToCollapse title={config.explainerTitle} body={config.explainerBody} />
                  </ScreenerHeroHeading>
                </section>

                {highlightSymbol ? <PickerHighlightScroller symbol={highlightSymbol} /> : null}

                <PickerResultsGrid
                  entries={entries}
                  initialVisibleCount={initialVisibleCount}
                  configHref={config.href}
                  configTitle={config.title}
                  tone={config.tone}
                  emptyText={config.emptyText}
                  isEarnings={isEarningsPickerPage(config)}
                  hideUntilFiltered={config.kind === "allSymbols" && !config.showAllImmediately}
                  splitReasonsBySelection={isFilterablePage}
                  // The mobile screener trigger, handed to the grid so it can
                  // render as the first pill in the results controls row rather
                  // than occupying its own full-width sticky bar above them. It
                  // has to be constructed here, not in the grid: it's a
                  // ScreenerNav instance and needs this page's currentHref,
                  // filter mode and categoryValues, none of which the grid has.
                  screenerControl={
                    <ScreenerNav
                      currentHref={config.href}
                      variant="trigger"
                      compact
                      showFilters
                      showSearch
                      alwaysFilterMode={isFilterablePage}
                      categoryValues={categoryValues}
                    />
                  }
                  // Collapse the qualifying-condition chips into a single
                  // dropdown on any page whose own condition is NOT one of the
                  // 25 tracked booleans.
                  //
                  // splitReasonsBySelection can only split chips into "matched"
                  // and "also qualifies for" by comparing them against
                  // selectedFilters, which holds flag predicates only. A page
                  // seeded with `peRatio <= 15` has no flag selected, so the
                  // split finds nothing to promote, every chip lands in
                  // `primary`, and a stock meeting ten conditions rendered ten
                  // chips stacked above its mini chart. Collapsing is the
                  // behaviour that already exists for exactly this case on All
                  // Stocks, where nothing is ticked either.
                  collapseReasons={
                    config.kind === "allSymbols" || (config.presetPredicates?.length ?? 0) > 0
                  }
                  defaultTab={config.defaultTab}
                />

                {config.bodySections?.length ? (
                  <section className="screenerProse">
                    {config.bodySections.map((section) => (
                      <div key={section.heading} className="screenerProseBlock">
                        <h2>{section.heading}</h2>
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                        ))}
                      </div>
                    ))}
                  </section>
                ) : null}

                {config.relatedGuide ? (
                  <section className="screenerGuideLink">
                    <span className="screenerGuideEyebrow">Background reading</span>
                    <p>
                      {config.relatedGuide.blurb}{" "}
                      <Link href={config.relatedGuide.href}>{config.relatedGuide.label}</Link>.
                    </p>
                  </section>
                ) : null}

                <ScanFooter
                  serverMatchCount={foundCount}
                  universeSize={universeSize}
                  poolSize={dynamicUniverseCount}
                  updatedLabel={formatUpdatedAt(updatedAt)}
                />

                <HideWatermarksBar />
              </div>
            </div>
          </PickerFilterProvider>
        </div>
      </main>
    </WatermarkVisibilityProvider>
  );
}

function toneColour(tone?: PickerTone) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#facc15";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  if (tone === "blue") return "#60a5fa";
  return "#94a3b8";
}

function toneBorder(tone?: PickerTone) {
  if (tone === "green") return "rgba(34,197,94,0.32)";
  if (tone === "yellow") return "rgba(250,204,21,0.32)";
  if (tone === "orange") return "rgba(251,146,60,0.32)";
  if (tone === "red") return "rgba(239,68,68,0.32)";
  if (tone === "blue") return "rgba(96,165,250,0.32)";
  return "rgba(148,163,184,0.24)";
}

function toneBackground(tone?: PickerTone) {
  if (tone === "green") return "linear-gradient(180deg, rgba(8,24,18,0.96), rgba(6,12,18,0.98))";
  if (tone === "yellow") return "linear-gradient(180deg, rgba(28,24,8,0.96), rgba(8,12,18,0.98))";
  if (tone === "orange") return "linear-gradient(180deg, rgba(32,20,8,0.96), rgba(8,12,18,0.98))";
  if (tone === "red") return "linear-gradient(180deg, rgba(32,10,14,0.96), rgba(8,12,18,0.98))";
  return "linear-gradient(180deg, rgba(8,16,32,0.96), rgba(6,10,18,0.98))";
}
