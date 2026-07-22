import { headers } from "next/headers";
import type { MiniCandlePoint, SupportResistanceZone } from "@/app/components/MiniPickerCandleChart";
import PickerHighlightScroller from "@/app/components/PickerHighlightScroller";
import ScreenerNav from "@/app/components/ScreenerNav";
import HowToCollapse from "@/app/components/HowToCollapse";
import PickerResultsGrid from "@/app/components/PickerResultsGrid";
import CustomScreenerSymbolSearch from "@/app/components/CustomScreenerSymbolSearch";
import { PickerFilterProvider } from "@/app/components/PickerFilterContext";
import { getCompanyNameMap } from "@/lib/server/companyNames";
import { getPickersData } from "@/lib/server/pickersBuilder";
import { WatermarkVisibilityProvider, HideWatermarksBar } from "@/app/components/WatermarkVisibility";
import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type FilterKey } from "@/lib/pickerFilters";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

export type PickerResultKind = "section" | "buySignals" | "sellSignals" | "allSymbols";

export type PickerResultConfig = {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  explainerTitle: string;
  explainerBody: string;
  emptyText: string;
  tone: PickerTone;
  kind: PickerResultKind;
  sectionIncludes?: string[];
  maxItems?: number;
  filterTimeframe?: "D" | "W";
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

function formatUpdatedAt(value?: string | null) {
  if (!value) return "Live data";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
// current ~200-symbol universe cap can produce, so it never actually
// truncates real results the way the old per-page maxItems slice did.
const RESULT_SAFETY_CAP = 500;

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
    return signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const score = getBuySignalCount(record);
      if (score <= 0) return null;
      const reasons = getReasons(record, BUY_REASON_DEFS);
      return {
        symbol,
        note: `${score} of ${BUY_REASON_DEFS.length} bullish conditions met`,
        tone: "green",
        score,
        reasons,
        stockHref: `/stock/${encodeURIComponent(symbol)}`,
        chartHref: chartHrefFor(symbol, record.dashboardHref),
        chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [],
        ...flagsFromRecord(record),
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, RESULT_SAFETY_CAP);
  }

  if (config.kind === "sellSignals") {
    return signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const score = getSellSignalCount(record);
      if (score <= 0) return null;
      const reasons = getReasons(record, SELL_REASON_DEFS);
      return {
        symbol,
        note: `${score} of ${SELL_REASON_DEFS.length} bearish conditions met`,
        tone: "red",
        score,
        reasons,
        stockHref: `/stock/${encodeURIComponent(symbol)}`,
        chartHref: chartHrefFor(symbol, record.dashboardHref),
        chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [],
        ...flagsFromRecord(record),
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, RESULT_SAFETY_CAP);
  }

  if (config.kind === "allSymbols") {
    // Every analyzed symbol is a candidate entry here (no score-based
    // skipping like buySignals/sellSignals above) -- filtering only
    // happens client-side, against whatever conditions the visitor checks
    // (see PickerResultsGrid's hideUntilFiltered mode). Category-membership
    // flags (Buy Signal, Best Trend, etc.) are computed once up front, same
    // as getPickerData does for every other kind further down, so they can
    // be folded into each entry's reasons/score alongside the 18
    // custom-builder flags.
    const categoryFlags = buildCategoryFlags(sections, signalRecords);
    return signalRecords.map((record): ResultEntry | null => {
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

    return {
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      universeSize: typeof payload.universeSize === "number" ? payload.universeSize : null,
      dynamicUniverseCount: typeof payload.dynamicUniverseCount === "number" ? payload.dynamicUniverseCount : null,
      entries,
      foundCount: config.filterTimeframe ? entries.length : typeof matchedSection?.foundCount === "number" ? matchedSection.foundCount : entries.length,
    };
  } catch {
    return { updatedAt: null, universeSize: null, dynamicUniverseCount: null, entries: [], foundCount: 0 };
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
  const { entries, updatedAt, universeSize, dynamicUniverseCount, foundCount } = await getPickerData(config);
  const initialVisibleCount = config.maxItems ?? 36;

  // "Universe" metric is a debug/sanity-check number for confirming the
  // dynamic-universe top-up job is actually running: universeSize is the
  // fixed ~200-symbol cap actually analyzed per build (UNIVERSE_CAP, see
  // claude/CACHING_REFRESH_ARCHITECTURE_PLAN.md), which never changes even
  // when the broader dynamic-universe candidate pool grows. Adding
  // dynamicUniverseCount (the size of that pool, up to 700) on top gives a
  // combined number that visibly moves when the pool is topping up
  // correctly, rather than always reading a static "200".
  const combinedUniverseSize =
    universeSize != null || dynamicUniverseCount != null
      ? (universeSize ?? 0) + (dynamicUniverseCount ?? 0)
      : null;

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
      itemListElement: entries.slice(0, 24).map((entry, index) => ({
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
        .screenerTriggerWrap { margin: 20px 0 4px; }
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
        .seeMoreWrap { margin-top: 20px; display: flex; justify-content: center; }
        .seeMoreBtn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px; border-radius: 999px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10); color: #dbeafe; font-weight: 800; font-size: 13.5px; cursor: pointer; }
        .seeMoreBtn:hover { background: rgba(59,130,246,0.16); border-color: rgba(96,165,250,0.6); }
        .filterMatchLine { margin: 8px 0 0; font-size: 12.5px; color: rgba(226,232,240,0.65); }
        @keyframes pickerHighlightPulse {
          0% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
          15% { box-shadow: 0 0 0 4px rgba(245,197,66,0.35); border-color: #f5c542; }
          50% { box-shadow: 0 0 28px 4px rgba(245,197,66,0.55); border-color: #f5c542; }
          100% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
        }
        .resultCard.highlight { animation: pickerHighlightPulse 2.4s ease-out 1; scroll-margin-top: 90px; }
        @media (max-width: 980px) {
          .resultShell { grid-template-columns: 1fr; gap: 14px; }
        }
        @media (max-width: 720px) {
          .pickerResultPage, .pickerResultPage * { box-sizing: border-box; }
          .pickerResultPage { overflow-x: hidden; }
          .resultWrap { width: 100%; padding: 14px 10px 44px; overflow-x: hidden; }
          .hero { border-radius: 20px; padding: 15px; }
          .eyebrow { max-width: 100%; white-space: normal; text-align: center; line-height: 1.35; }
          .hero h1 { font-size: clamp(28px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero > p { font-size: 14px; line-height: 1.62; }
          .heroHowTo { padding: 12px 13px; }
          .resultsHeader { margin-top: 18px; }
          .resultsHeaderTop h2 { font-size: 22px; line-height: 1.14; }
          .resultsHeader p { font-size: 14px; line-height: 1.62; }
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
        }
        @media (max-width: 390px) { .resultWrap { padding-left: 8px; padding-right: 8px; } .hero, .resultCard { padding: 12px; } }
      `}</style>

        <div className="resultWrap">
          <PickerFilterProvider>
            <div className="resultShell">
              <ScreenerNav currentHref={config.href} variant="sidebar" showFilters showSearch alwaysFilterMode={config.kind === "allSymbols"} />

              <div className="resultMain">
                <section className="hero">
                  <div className="eyebrow">
                    <span style={{ color: toneColour(config.tone) }}>●</span>
                    {config.eyebrow}
                  </div>
                  <h1>{config.title}</h1>
                  <p>{config.description}</p>
                  <HowToCollapse title={config.explainerTitle} body={config.explainerBody} />
                  {config.kind === "allSymbols" ? (
                    <div style={{ marginTop: 16 }}>
                      <CustomScreenerSymbolSearch
                        universe={entries.map((e) => ({
                          symbol: e.symbol,
                          companyName: e.companyName,
                          reasons: e.reasons,
                          score: e.score,
                        }))}
                      />
                    </div>
                  ) : null}
                </section>

                <div className="screenerTriggerWrap">
                  <ScreenerNav currentHref={config.href} variant="trigger" showFilters showSearch alwaysFilterMode={config.kind === "allSymbols"} />
                </div>

                {highlightSymbol ? <PickerHighlightScroller symbol={highlightSymbol} /> : null}

                <PickerResultsGrid
                  entries={entries}
                  initialVisibleCount={initialVisibleCount}
                  configHref={config.href}
                  configTitle={config.title}
                  tone={config.tone}
                  emptyText={config.emptyText}
                  isEarnings={isEarningsPickerPage(config)}
                  hideUntilFiltered={config.kind === "allSymbols"}
                  splitReasonsBySelection={config.kind === "allSymbols"}
                />

                <div className="scanDebug">
                  Current scan · Live matches {foundCount} · Shown {entries.length} · Universe {combinedUniverseSize ?? "Live"} · Updated {formatUpdatedAt(updatedAt)}
                </div>

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
