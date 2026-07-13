import Link from "next/link";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import MiniPickerCandleChart, {
  type MiniCandlePoint,
  type SupportResistanceZone,
} from "@/app/components/MiniPickerCandleChart";
import PickerHighlightScroller from "@/app/components/PickerHighlightScroller";
import PickerScreenerNav from "@/app/components/PickerScreenerNav";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

export type PickerResultKind = "section" | "buySignals" | "sellSignals";

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
};

type PickersPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  sections?: PickerSection[];
  signalRecords?: SignalRecord[];
};

type ResultEntry = {
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

// ---------------------------------------------------------------------------
// Company-name lookup.
//
// The /api/pickers payload is symbol-only, so we map ticker -> company name
// from the public Nasdaq symbol directories (same source lib/stock-news-data
// already uses). The parsed map is cached for 24h via unstable_cache so we
// don't refetch/reparse on every request. Fails open: if the fetch is
// unavailable, cards simply render without a company name.
// ---------------------------------------------------------------------------
const getSymbolNameMap = unstable_cache(
  async (): Promise<Record<string, string>> => {
    try {
      const [nasdaqTxt, otherTxt] = await Promise.all([
        fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", {
          next: { revalidate: 86400 },
        }).then((r) => (r.ok ? r.text() : "")),
        fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt", {
          next: { revalidate: 86400 },
        }).then((r) => (r.ok ? r.text() : "")),
      ]);

      const map: Record<string, string> = {};
      const ingest = (txt: string) => {
        for (const row of txt.split("\n")) {
          const cols = row.split("|");
          const symbol = (cols[0] || "").trim().toUpperCase();
          const name = (cols[1] || "").trim();
          if (!symbol || !name) continue;
          if (symbol === "SYMBOL" || symbol === "ACT SYMBOL") continue; // header rows
          if (!map[symbol]) map[symbol] = name;
        }
      };
      ingest(nasdaqTxt);
      ingest(otherTxt);
      return map;
    } catch {
      return {};
    }
  },
  ["msh-symbol-name-map-v1"],
  { revalidate: 86400 }
);

// Strips the security-type suffix the Nasdaq directories append
// ("Apple Inc. - Common Stock" -> "Apple Inc."). The card truncates with
// an ellipsis in CSS, so this only needs to be light-touch.
function cleanCompanyName(raw: string) {
  if (!raw) return "";
  return raw
    .replace(
      /\s*-\s*(common stock|class [a-z].*|ordinary shares.*|american depositary.*|depositary.*|warrants?.*|units?.*|preferred.*|rights?.*|notes?.*).*$/i,
      ""
    )
    .replace(/\s+(common stock|common shares|ordinary shares)\s*$/i, "")
    .trim();
}

function entriesFromSection(args: {
  configHref: string;
  section: PickerSection | undefined;
  recordMap: Map<string, SignalRecord>;
  fallbackTone: PickerTone;
  maxItems: number;
  filterTimeframe?: "D" | "W";
}) {
  const items = Array.isArray(args.section?.items) ? args.section.items : [];
  const filteredItems = args.filterTimeframe ? items.filter((item) => item.timeframe === args.filterTimeframe) : items;
  return filteredItems.slice(0, args.maxItems).map((item): ResultEntry | null => {
    const symbol = cleanSymbol(item.symbol);
    if (!symbol) return null;
    const record = args.recordMap.get(symbol);
    const chartPoints = Array.isArray(item.chartPoints) ? item.chartPoints : Array.isArray(record?.chartPoints) ? record.chartPoints : [];
    const tone = item.tone || record?.tone || args.fallbackTone;
    const note = item.note || record?.note || [item.timeframe, item.indicator].filter(Boolean).join(" \u00b7 ") || "Screened setup";
    return {
      symbol,
      note,
      tone,
      stockHref: `/stock/${encodeURIComponent(symbol)}`,
      chartHref: chartHrefForEntry(args.configHref, symbol, item.dashboardHref || record?.dashboardHref, item),
      chartPoints,
      badge: [item.timeframe, item.indicator].filter(Boolean).join(" \u00b7 "),
      score: typeof item.score === "number" ? item.score : typeof record?.score === "number" ? record.score : undefined,
      supportResistanceZone: item.supportResistanceZone,
    };
  }).filter((entry): entry is ResultEntry => Boolean(entry));
}

function buildEntries(args: { config: PickerResultConfig; sections: PickerSection[]; signalRecords: SignalRecord[] }) {
  const { config, sections, signalRecords } = args;
  const recordMap = makeRecordMap(signalRecords);
  const maxItems = config.maxItems ?? 36;

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
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, maxItems);
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
      };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, maxItems);
  }

  const section = findSection(sections, config.sectionIncludes ?? []);
  return entriesFromSection({ configHref: config.href, section, recordMap, fallbackTone: config.tone, maxItems, filterTimeframe: config.filterTimeframe });
}

async function getPickerData(config: PickerResultConfig) {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/pickers`, { cache: "no-store" });
    if (!res.ok) return { updatedAt: null, universeSize: null, dynamicUniverseCount: null, entries: [], foundCount: 0 };
    const payload = (await res.json()) as PickersPayload;
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const signalRecords = Array.isArray(payload.signalRecords) ? payload.signalRecords : [];
    const matchedSection = config.kind === "section" ? findSection(sections, config.sectionIncludes ?? []) : undefined;
    const entries = buildEntries({ config, sections, signalRecords });

    // Attach company names (cached map; fails open to symbol-only cards).
    const nameMap = await getSymbolNameMap();
    const namedEntries = entries.map((entry) => {
      const name = cleanCompanyName(nameMap[entry.symbol] ?? "");
      return name ? { ...entry, companyName: name } : entry;
    });

    return {
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      universeSize: typeof payload.universeSize === "number" ? payload.universeSize : null,
      dynamicUniverseCount: typeof payload.dynamicUniverseCount === "number" ? payload.dynamicUniverseCount : null,
      entries: namedEntries,
      foundCount: config.filterTimeframe ? namedEntries.length : typeof matchedSection?.foundCount === "number" ? matchedSection.foundCount : namedEntries.length,
    };
  } catch {
    return { updatedAt: null, universeSize: null, dynamicUniverseCount: null, entries: [], foundCount: 0 };
  }
}

function chartOverlayForEntry(config: PickerResultConfig, entry: ResultEntry) {
  const href = config.href.toLowerCase();
  const text = `${config.title} ${entry.badge ?? ""} ${entry.note} ${entry.reasons?.join(" ") ?? ""}`.toLowerCase();
  if (text.includes("macd")) return "macd" as const;
  if (text.includes("rsi") || href.includes("overbought") || href.includes("oversold")) return "rsi" as const;
  if (href.includes("200-day") || href.includes("ma200") || href.includes("best-trend")) return href.includes("best-trend") ? ("trend" as const) : ("ma200" as const);
  if (href.includes("all-time-high-breakout")) return "ath" as const;
  if (href.includes("3-month-high")) return "recentHigh" as const;
  if (href.includes("all-time-highs")) return "ath" as const;
  return "none" as const;
}

function scoreLabelForEntry(entry: ResultEntry) {
  if (typeof entry.score === "number" && Number.isFinite(entry.score)) return Math.round(entry.score);
  const match = entry.note.match(/(\d+)\s+(?:buy|sell) signal/i);
  if (match) return Number(match[1]);
  return null;
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
    <main className="pickerResultPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <style>{`
        .pickerResultPage { min-height: 100vh; background: radial-gradient(circle at 12% 0%, rgba(59,130,246,0.16), transparent 30%), radial-gradient(circle at 92% 4%, rgba(34,197,94,0.08), transparent 28%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .pickerShell { max-width: 1240px; margin: 0 auto; padding: 24px; display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 24px; align-items: start; }
        .pickerMain { min-width: 0; }
        .hero { border: 1px solid ${toneBorder(config.tone)}; border-radius: 24px; padding: 22px; background: ${toneBackground(config.tone)}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.045), 0 18px 42px rgba(0,0,0,0.26); }
        .heroCopy { min-width: 0; }
        .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid ${toneBorder(config.tone)}; background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
        .hero h1 { margin: 12px 0 0; font-size: 42px; line-height: 1.04; letter-spacing: -0.05em; }
        .hero > .heroCopy > p { margin: 10px 0 0; max-width: 820px; color: rgba(226,232,240,0.78); font-size: 16px; line-height: 1.6; }
        .howto { margin-top: 14px; border-left: 2px solid ${toneBorder(config.tone)}; padding: 1px 0 1px 14px; }
        .howtoLabel { font-size: 11px; font-weight: 950; letter-spacing: 0.1em; text-transform: uppercase; color: #93c5fd; }
        .howto p { margin: 5px 0 0; max-width: 900px; font-size: 14px; line-height: 1.65; color: rgba(226,232,240,0.74); }
        .resultsHeader { margin-top: 22px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: end; }
        .resultsHeader h2 { margin: 0; font-size: 26px; letter-spacing: -0.04em; }
        .resultsHeader p { margin: 8px 0 0; color: rgba(226,232,240,0.70); line-height: 1.6; }
        .resultsGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
        .resultCard { display: block; text-decoration: none; color: inherit; border: 1px solid rgba(255,255,255,0.09); border-radius: 20px; padding: 15px; background: linear-gradient(180deg, rgba(255,255,255,0.042), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
        .resultCard:hover { transform: translateY(-2px); border-color: rgba(96,165,250,0.34); box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 16px 34px rgba(0,0,0,0.28); }
        .resultCard:focus-visible { outline: 2px solid rgba(96,165,250,0.7); outline-offset: 2px; }
        .resultCardTop { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .cardHead { min-width: 0; flex: 1 1 auto; }
        .symbolLine { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
        .symbolLine span.dot { align-self: center; width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; box-shadow: 0 0 0 4px rgba(255,255,255,0.04); }
        .symbolLine h3 { margin: 0; font-size: 23px; letter-spacing: -0.04em; flex: 0 0 auto; }
        .companyName { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; color: rgba(226,232,240,0.55); }
        .badge { display: inline-flex; align-items: center; border: 1px solid rgba(96,165,250,0.22); border-radius: 999px; padding: 6px 9px; background: rgba(59,130,246,0.08); color: #dbeafe; font-size: 11px; font-weight: 950; white-space: nowrap; }
        .scorePill { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 62px; min-height: 52px; border-radius: 15px; border: 1px solid rgba(34,197,94,0.26); background: rgba(34,197,94,0.10); color: #dcfce7; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); flex: 0 0 auto; }
        .scorePill strong { font-size: 22px; line-height: 1; letter-spacing: -0.04em; }
        .scorePill span { margin-top: 5px; font-size: 10px; font-weight: 950; letter-spacing: 0.04em; color: rgba(220,252,231,0.72); }
        .reasonChips { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
        .reasonChip { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; border: 1px solid; background: rgba(255,255,255,0.04); font-size: 11px; font-weight: 800; letter-spacing: 0.01em; white-space: nowrap; }
        .note { margin: 10px 0 0; color: rgba(226,232,240,0.74); font-size: 13px; line-height: 1.55; min-height: 40px; }
        .emptyBox { margin-top: 16px; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px; padding: 18px; background: rgba(255,255,255,0.035); color: rgba(226,232,240,0.72); line-height: 1.7; }
        .debugLine { margin: 26px 0 0; font-size: 11px; color: rgba(148,163,184,0.5); letter-spacing: 0.02em; }
        @keyframes pickerHighlightPulse {
          0% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
          15% { box-shadow: 0 0 0 4px rgba(245,197,66,0.35); border-color: #f5c542; }
          50% { box-shadow: 0 0 28px 4px rgba(245,197,66,0.55); border-color: #f5c542; }
          100% { box-shadow: 0 0 0 0 rgba(245,197,66,0); border-color: rgba(255,255,255,0.09); }
        }
        .resultCard.highlight { animation: pickerHighlightPulse 2.4s ease-out 1; scroll-margin-top: 90px; }
        @media (max-width: 980px) {
          .pickerShell { grid-template-columns: 1fr; padding: 16px 12px 44px; gap: 14px; }
        }
        @media (max-width: 720px) {
          .pickerResultPage, .pickerResultPage * { box-sizing: border-box; }
          .pickerResultPage { overflow-x: hidden; }
          .pickerShell { width: 100%; padding: 12px 10px 44px; overflow-x: hidden; }
          .hero { border-radius: 18px; padding: 15px; }
          .eyebrow { max-width: 100%; }
          .hero h1 { font-size: clamp(28px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero > .heroCopy > p { font-size: 14px; line-height: 1.6; }
          .howto p { font-size: 13.5px; }
          .resultsHeader { margin-top: 18px; align-items: flex-start; }
          .resultsHeader h2 { font-size: 22px; }
          .resultsHeader p { font-size: 14px; }
          .resultsGrid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .resultCard { border-radius: 16px; padding: 13px; }
          .symbolLine h3 { font-size: 21px; }
          .companyName { font-size: 12px; }
          .badge { max-width: 100%; white-space: normal; text-align: center; line-height: 1.25; }
          .scorePill { min-width: 54px; min-height: 48px; border-radius: 13px; }
          .scorePill strong { font-size: 20px; }
          .reasonChip { font-size: 10.5px; padding: 4px 8px; }
          .note { min-height: 0; font-size: 13px; }
        }
        @media (max-width: 390px) { .pickerShell { padding-left: 8px; padding-right: 8px; } .hero, .resultCard { padding: 12px; } }
      `}</style>

      <div className="pickerShell">
        <PickerScreenerNav currentHref={config.href} />

        <div className="pickerMain">
          <section className="hero">
            <div className="heroCopy">
              <div className="eyebrow">
                <span style={{ color: toneColour(config.tone) }}>\u25CF</span>
                {config.eyebrow}
              </div>
              <h1>{config.title}</h1>
              <p>{config.description}</p>
              {config.explainerBody ? (
                <div className="howto">
                  <span className="howtoLabel">How to use</span>
                  <p>{config.explainerBody}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="resultsHeader">
              <div>
                <h2>Current screened results</h2>
                <p>
                  {isEarningsPickerPage(config)
                    ? "Tap any stock to open its earnings breakdown."
                    : "Tap any stock to open its chart on the dashboard, focused on the relevant indicator."}
                </p>
              </div>
            </div>

            {highlightSymbol ? <PickerHighlightScroller symbol={highlightSymbol} /> : null}

            {entries.length ? (
              <div className="resultsGrid">
                {entries.map((entry) => {
                  const cardHref = isEarningsPickerPage(config)
                    ? `/stock/${encodeURIComponent(entry.symbol)}/earnings`
                    : entry.chartHref;
                  return (
                    <Link
                      key={`${entry.symbol}-${entry.note}`}
                      id={`picker-${entry.symbol}`}
                      href={cardHref}
                      className="resultCard"
                      aria-label={
                        isEarningsPickerPage(config)
                          ? `Open ${entry.symbol} earnings`
                          : `Open ${entry.symbol} chart`
                      }
                    >
                      <div className="resultCardTop">
                        <div className="cardHead">
                          <div className="symbolLine">
                            <span className="dot" style={{ background: toneColour(entry.tone) }} aria-hidden="true" />
                            <h3>{entry.symbol}</h3>
                            {entry.companyName ? <span className="companyName">{entry.companyName}</span> : null}
                          </div>
                          {entry.badge ? <div className="badge" style={{ marginTop: 8 }}>{entry.badge}</div> : null}
                        </div>
                        {scoreLabelForEntry(entry) != null ? (
                          <div className="scorePill">
                            <strong>{scoreLabelForEntry(entry)}</strong>
                            <span>Score</span>
                          </div>
                        ) : null}
                      </div>
                      {entry.reasons && entry.reasons.length > 0 ? (
                        <div className="reasonChips">
                          {entry.reasons.map((reason) => (
                            <span
                              key={reason}
                              className="reasonChip"
                              style={{ borderColor: toneBorder(entry.tone), color: toneColour(entry.tone) }}
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <MiniPickerCandleChart points={entry.chartPoints} tone={config.tone} overlay={chartOverlayForEntry(config, entry)} supportResistanceZone={entry.supportResistanceZone} />
                      <div className="note">{entry.note}</div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="emptyBox">{config.emptyText}</div>
            )}
          </section>

          <p className="debugLine">
            Debug \u00b7 Live matches {foundCount} \u00b7 Shown {entries.length} \u00b7 Universe {combinedUniverseSize ?? "Live"} \u00b7 Updated {formatUpdatedAt(updatedAt)}
          </p>
        </div>
      </div>
    </main>
  );
}
