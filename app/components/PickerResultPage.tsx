import Link from "next/link";
import { headers } from "next/headers";
import MiniPickerCandleChart, {
  type MiniCandlePoint,
} from "@/app/components/MiniPickerCandleChart";

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

type PickerSectionItem = {
  symbol?: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M" | "ST";
  indicator?: string;
  dashboardHref?: string;
  chartPoints?: MiniCandlePoint[];
  score?: number;
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
  sections?: PickerSection[];
  signalRecords?: SignalRecord[];
};

type ResultEntry = {
  symbol: string;
  note: string;
  tone: PickerTone;
  stockHref: string;
  chartHref: string;
  chartPoints: MiniCandlePoint[];
  badge?: string;
  score?: number;
};

const PICKER_NAV: Array<{
  href: string;
  label: string;
  icon: string;
  tone: PickerTone;
}> = [
  { href: "/top-stocks-with-buy-signals", label: "Buy Signals", icon: "\u25b2", tone: "green" },
  { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", icon: "\u25c6", tone: "yellow" },
  { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts", icon: "\u2197", tone: "orange" },
  { href: "/3-month-high-breakout-stocks", label: "3-Month Highs", icon: "\u2197", tone: "orange" },
  { href: "/top-stocks-with-sell-signals", label: "Sell Signals", icon: "\u25bc", tone: "red" },
  { href: "/oversold-stocks-today", label: "Oversold", icon: "\u25cf", tone: "green" },
  { href: "/best-trend-score-stocks", label: "Best Trend", icon: "\u2605", tone: "green" },
  { href: "/stocks-with-positive-last-earnings", label: "Last Earnings", icon: "\u2713", tone: "green" },
  { href: "/stocks-with-strong-earnings-growth", label: "Earnings Growth", icon: "\u2197", tone: "green" },
  { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", icon: "\u25c7", tone: "yellow" },
  { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", icon: "\u25c6", tone: "yellow" },
  { href: "/macro-support-resistance-stocks", label: "Macro S/R", icon: "\u21c4", tone: "blue" },
  { href: "/overbought-stocks-today", label: "Overbought", icon: "\u25cf", tone: "red" },
  { href: "/bullish-bearish-divergence-stocks", label: "Divergence", icon: "\u2301", tone: "blue" },
];

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

// Routes "Open chart" links to /dashboard — works correctly on both mobile and desktop.
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

function entriesFromSection(args: {
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
      chartHref: chartHrefFor(symbol, item.dashboardHref || record?.dashboardHref),
      chartPoints,
      badge: [item.timeframe, item.indicator].filter(Boolean).join(" \u00b7 "),
      score: typeof item.score === "number" ? item.score : typeof record?.score === "number" ? record.score : undefined,
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
      return { symbol, note: `${score} buy signal${score === 1 ? "" : "s"}`, tone: "green", score, stockHref: `/stock/${encodeURIComponent(symbol)}`, chartHref: chartHrefFor(symbol, record.dashboardHref), chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [], badge: "Buy signals" };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, maxItems);
  }

  if (config.kind === "sellSignals") {
    return signalRecords.map((record): ResultEntry | null => {
      const symbol = cleanSymbol(record.symbol);
      if (!symbol) return null;
      const score = getSellSignalCount(record);
      if (score <= 0) return null;
      return { symbol, note: `${score} sell signal${score === 1 ? "" : "s"}`, tone: "red", score, stockHref: `/stock/${encodeURIComponent(symbol)}`, chartHref: chartHrefFor(symbol, record.dashboardHref), chartPoints: Array.isArray(record.chartPoints) ? record.chartPoints : [], badge: "Sell signals" };
    }).filter((entry): entry is ResultEntry => Boolean(entry)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.symbol.localeCompare(b.symbol)).slice(0, maxItems);
  }

  const section = findSection(sections, config.sectionIncludes ?? []);
  return entriesFromSection({ section, recordMap, fallbackTone: config.tone, maxItems, filterTimeframe: config.filterTimeframe });
}

async function getPickerData(config: PickerResultConfig) {
  try {
    const origin = await getOriginFromHeaders();
    const res = await fetch(`${origin}/api/pickers`, { cache: "no-store" });
    if (!res.ok) return { updatedAt: null, universeSize: null, entries: [], foundCount: 0 };
    const payload = (await res.json()) as PickersPayload;
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const signalRecords = Array.isArray(payload.signalRecords) ? payload.signalRecords : [];
    const matchedSection = config.kind === "section" ? findSection(sections, config.sectionIncludes ?? []) : undefined;
    const entries = buildEntries({ config, sections, signalRecords });
    return {
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      universeSize: typeof payload.universeSize === "number" ? payload.universeSize : null,
      entries,
      foundCount: config.filterTimeframe ? entries.length : typeof matchedSection?.foundCount === "number" ? matchedSection.foundCount : entries.length,
    };
  } catch {
    return { updatedAt: null, universeSize: null, entries: [], foundCount: 0 };
  }
}

function SignalNav({ currentHref }: { currentHref: string }) {
  return (
    <nav className="signalTabs" aria-label="Stock picker pages">
      {PICKER_NAV.map((item) => {
        const active = item.href === currentHref;
        const colour = toneColour(item.tone);
        return (
          <Link key={item.href} href={item.href} className={active ? "signalTab active" : "signalTab"} style={{ borderColor: active ? `${colour}99` : "rgba(96,165,250,0.36)", background: active ? `linear-gradient(135deg, ${colour}2e, rgba(30,64,175,0.16))` : "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(15,23,42,0.62))" }}>
            <span style={{ color: colour }}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function chartOverlayForEntry(config: PickerResultConfig, entry: ResultEntry) {
  const href = config.href.toLowerCase();
  const text = `${config.title} ${entry.badge ?? ""} ${entry.note}`.toLowerCase();
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

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metricCard">
      <div>{label}</div>
      <strong>{value}</strong>
    </div>
  );
}

export default async function PickerResultPage({ config }: { config: PickerResultConfig }) {
  const { entries, updatedAt, universeSize, foundCount } = await getPickerData(config);

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
        .resultWrap { max-width: 1240px; margin: 0 auto; padding: 26px 18px 58px; }
        .topNav { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .topNav a { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 9px 13px; border-radius: 13px; border: 1px solid rgba(96,165,250,0.30); background: rgba(59,130,246,0.10); color: #dbeafe; text-decoration: none; font-weight: 900; font-size: 13px; }
        .hero { border: 1px solid ${toneBorder(config.tone)}; border-radius: 28px; padding: 22px; background: ${toneBackground(config.tone)}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.045), 0 18px 42px rgba(0,0,0,0.26); }
        .heroTop { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 24px; align-items: start; }
        .heroCopy { min-width: 0; }
        .eyebrow { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid ${toneBorder(config.tone)}; background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
        .hero h1 { margin: 12px 0 0; font-size: 46px; line-height: 1.03; letter-spacing: -0.055em; }
        .hero p { margin: 10px 0 0; max-width: 820px; color: rgba(226,232,240,0.78); font-size: 16px; line-height: 1.65; }
        .scanPanel { border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; padding: 18px 20px; background: linear-gradient(180deg, rgba(3,7,18,0.72), rgba(2,6,23,0.92)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); }
        .scanPanelTitle { font-size: 12px; font-weight: 950; letter-spacing: 0.12em; text-transform: uppercase; color: #93c5fd; margin-bottom: 10px; }
        .metricGrid { display: grid; gap: 0; }
        .metricCard { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 11px 0; border-top: 1px solid rgba(255,255,255,0.08); background: transparent; }
        .metricCard:first-child { border-top: 0; }
        .metricCard div { font-size: 12px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(203,213,225,0.78); }
        .metricCard strong { display: block; font-size: 18px; letter-spacing: -0.03em; text-align: right; white-space: nowrap; }
        .signalTabs { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 10px; }
        .signalTab { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 9px 14px; border-radius: 14px; border: 1px solid; color: #eff6ff; text-decoration: none; font-size: 13px; font-weight: 950; box-shadow: 0 10px 24px rgba(0,0,0,0.16); transition: transform 140ms ease, filter 140ms ease; }
        .signalTab:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .signalTab.active { box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 26px rgba(0,0,0,0.20); }
        .explainer { margin-top: 20px; border: 1px solid rgba(59,130,246,0.18); border-radius: 22px; padding: 18px; background: linear-gradient(180deg, rgba(15,23,42,0.78), rgba(8,13,22,0.96)); }
        .explainer h2 { margin: 0; font-size: 24px; letter-spacing: -0.035em; }
        .explainer p { margin: 10px 0 0; max-width: 900px; color: rgba(226,232,240,0.78); line-height: 1.7; }
        .resultsHeader { margin-top: 22px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: end; }
        .resultsHeader h2 { margin: 0; font-size: 28px; letter-spacing: -0.04em; }
        .resultsHeader p { margin: 8px 0 0; color: rgba(226,232,240,0.70); line-height: 1.6; }
        .resultsGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 16px; }
        .resultCard { border: 1px solid rgba(255,255,255,0.09); border-radius: 22px; padding: 15px; background: linear-gradient(180deg, rgba(255,255,255,0.042), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); }
        .resultCardTop { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .symbolLine { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .symbolLine span.dot { width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; box-shadow: 0 0 0 4px rgba(255,255,255,0.04); }
        .symbolLine h3 { margin: 0; font-size: 24px; letter-spacing: -0.04em; }
        .badge { display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(96,165,250,0.22); border-radius: 999px; padding: 6px 9px; background: rgba(59,130,246,0.08); color: #dbeafe; font-size: 11px; font-weight: 950; white-space: nowrap; }
        .scorePill { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 62px; min-height: 52px; border-radius: 15px; border: 1px solid rgba(34,197,94,0.26); background: rgba(34,197,94,0.10); color: #dcfce7; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); }
        .scorePill strong { font-size: 22px; line-height: 1; letter-spacing: -0.04em; }
        .scorePill span { margin-top: 5px; font-size: 10px; font-weight: 950; letter-spacing: 0.04em; color: rgba(220,252,231,0.72); }
        .note { margin: 10px 0 0; color: rgba(226,232,240,0.74); font-size: 13px; line-height: 1.55; min-height: 40px; }
        .cardActions { margin-top: 13px; display: flex; gap: 10px; flex-wrap: wrap; }
        .cardActions a { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 8px 11px; border-radius: 11px; border: 1px solid rgba(96,165,250,0.26); background: rgba(59,130,246,0.09); color: #dbeafe; text-decoration: none; font-size: 12px; font-weight: 950; }
        .cardActions a.green { border-color: rgba(34,197,94,0.26); background: rgba(34,197,94,0.09); color: #dcfce7; }
        .emptyBox { margin-top: 16px; border: 1px solid rgba(255,255,255,0.10); border-radius: 18px; padding: 18px; background: rgba(255,255,255,0.035); color: rgba(226,232,240,0.72); line-height: 1.7; }
        @media (max-width: 980px) { .heroTop { grid-template-columns: 1fr; } .scanPanel { width: 100%; } }
        @media (max-width: 720px) {
          .pickerResultPage, .pickerResultPage * { box-sizing: border-box; }
          .pickerResultPage { overflow-x: hidden; }
          .resultWrap { width: 100%; padding: 14px 10px 44px; overflow-x: hidden; }
          .topNav { display: grid; grid-template-columns: 1fr; gap: 8px; justify-content: stretch; margin-bottom: 12px; }
          .topNav a { width: 100%; min-height: 44px; padding: 10px 12px; text-align: center; }
          .hero { border-radius: 20px; padding: 15px; }
          .heroTop { gap: 16px; }
          .eyebrow { max-width: 100%; white-space: normal; text-align: center; line-height: 1.35; }
          .hero h1 { font-size: clamp(30px, 9vw, 38px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero p { font-size: 14px; line-height: 1.62; }
          .scanPanel { border-radius: 18px; padding: 14px; }
          .metricGrid { grid-template-columns: 1fr; }
          .metricCard { gap: 12px; padding: 10px 0; }
          .metricCard div { font-size: 11px; line-height: 1.35; }
          .metricCard strong { font-size: 15px; white-space: normal; word-break: break-word; }
          .signalTabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
          .signalTab { width: 100%; min-height: 44px; padding: 9px 8px; gap: 6px; border-radius: 13px; font-size: 12px; line-height: 1.2; text-align: center; white-space: normal; }
          .explainer { margin-top: 16px; border-radius: 18px; padding: 15px; }
          .explainer h2, .resultsHeader h2 { font-size: 23px; line-height: 1.14; }
          .explainer p, .resultsHeader p { font-size: 14px; line-height: 1.62; }
          .resultsHeader { margin-top: 18px; align-items: flex-start; }
          .resultsGrid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .resultCard { width: 100%; min-width: 0; border-radius: 18px; padding: 13px; }
          .resultCardTop { gap: 10px; }
          .symbolLine h3 { font-size: 22px; }
          .badge { max-width: 100%; white-space: normal; text-align: center; line-height: 1.25; }
          .scorePill { min-width: 54px; min-height: 48px; border-radius: 13px; }
          .scorePill strong { font-size: 20px; }
          .note { min-height: 0; font-size: 13px; }
          .cardActions { display: grid; grid-template-columns: 1fr; gap: 8px; }
          .cardActions a { width: 100%; min-height: 42px; }
        }
        @media (max-width: 390px) { .resultWrap { padding-left: 8px; padding-right: 8px; } .hero, .scanPanel, .explainer, .resultCard { padding: 12px; } .signalTabs { grid-template-columns: 1fr; } }
      `}</style>

      <div className="resultWrap">
        <nav className="topNav" aria-label="Primary navigation">
          <Link href="/dashboard">📈 Dashboard</Link>
          <Link href="/pickers">📊 Stock Pickers</Link>
          <Link href="/plays">▲ Chart Plays</Link>
        </nav>

        <section className="hero">
          <div className="heroTop">
            <div className="heroCopy">
              <div className="eyebrow">
                <span style={{ color: toneColour(config.tone) }}>●</span>
                {config.eyebrow}
              </div>
              <h1>{config.title}</h1>
              <p>{config.description}</p>
            </div>
            <aside className="scanPanel" aria-label="Current scan summary">
              <div className="scanPanelTitle">Current scan</div>
              <div className="metricGrid">
                <MetricCard label="Live matches" value={foundCount} />
                <MetricCard label="Shown here" value={entries.length} />
                <MetricCard label="Universe" value={universeSize ?? "Live"} />
                <MetricCard label="Updated" value={formatUpdatedAt(updatedAt)} />
              </div>
            </aside>
          </div>
          <SignalNav currentHref={config.href} />
        </section>

        <section className="explainer">
          <h2>{config.explainerTitle}</h2>
          <p>{config.explainerBody}</p>
        </section>

        <section>
          <div className="resultsHeader">
            <div>
              <h2>Current screened results</h2>
              <p>Each card includes a mini candle preview. Open the chart for the full dashboard view or open the stock page for more context.</p>
            </div>
          </div>

          {entries.length ? (
            <div className="resultsGrid">
              {entries.map((entry) => (
                <article key={`${entry.symbol}-${entry.note}`} className="resultCard">
                  <div className="resultCardTop">
                    <div>
                      <div className="symbolLine">
                        <span className="dot" style={{ background: toneColour(entry.tone) }} aria-hidden="true" />
                        <h3>{entry.symbol}</h3>
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
                  <MiniPickerCandleChart points={entry.chartPoints} tone={config.tone} overlay={chartOverlayForEntry(config, entry)} />
                  <div className="note">{entry.note}</div>
                  <div className="cardActions">
                    {isEarningsPickerPage(config) ? (
                      <Link className="green" href={`/stock/${encodeURIComponent(entry.symbol)}/earnings`}>Open earnings →</Link>
                    ) : (
                      <Link className="green" href={entry.chartHref}>Open chart ↗</Link>
                    )}
                    <Link href={entry.stockHref}>Stock page →</Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="emptyBox">{config.emptyText}</div>
          )}
        </section>
      </div>
    </main>
  );
}
