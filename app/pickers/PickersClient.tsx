"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

type PickerSupportResistanceZone = { kind: "support" | "resistance"; lower: number; upper: number };
type PickerChartFocus = { kind: "ath" | "rangeHigh"; price: number; date: string };

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  supportResistanceZone?: PickerSupportResistanceZone;
  chartFocus?: PickerChartFocus;
  dominantIndicator?: string;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items: PickerItem[];
};

type SignalRecord = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  oversold: boolean; overbought: boolean; buyTheDip: boolean; breakout: boolean;
  volumeSpike: boolean; atrSpike: boolean; aboveMA50: boolean; belowMA50: boolean;
  aboveMA200: boolean; belowMA200: boolean; dailyMa200Proximity: boolean; weeklyMa200Proximity: boolean;
  bullishRsiDivergence: boolean; bearishRsiDivergence: boolean; bullishMacdDivergence: boolean; bearishMacdDivergence: boolean;
  positiveLastEarnings?: boolean; strongEarningsGrowth?: boolean;
  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  isDynamicUniverse?: boolean;
};

type PickersPayload = {
  updatedAt?: string; universeSize?: number; dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[]; dynamicSymbols?: string[];
  estimatedApiCalls?: number; sections?: PickerSection[]; signalRecords?: SignalRecord[];
};

type FilterKey = "oversold"|"overbought"|"buyTheDip"|"breakout"|"volumeSpike"|"atrSpike"|"aboveMA50"|"belowMA50"|"aboveMA200"|"belowMA200"|"dailyMa200Proximity"|"weeklyMa200Proximity"|"bullishRsiDivergence"|"bearishRsiDivergence"|"bullishMacdDivergence"|"bearishMacdDivergence"|"positiveLastEarnings"|"strongEarningsGrowth";
type FilterDef = { key: FilterKey; label: string; tone: PickerTone; };

const FILTER_DEFS: FilterDef[] = [
  { key: "oversold", label: "Oversold", tone: "green" },
  { key: "overbought", label: "Overbought", tone: "red" },
  { key: "buyTheDip", label: "20%+ From ATH", tone: "yellow" },
  { key: "breakout", label: "Breakout", tone: "orange" },
  { key: "volumeSpike", label: "Volume Spike", tone: "orange" },
  { key: "atrSpike", label: "ATR Spike", tone: "orange" },
  { key: "aboveMA50", label: "Above MA50", tone: "yellow" },
  { key: "belowMA50", label: "Below MA50", tone: "yellow" },
  { key: "aboveMA200", label: "Above MA200", tone: "yellow" },
  { key: "belowMA200", label: "Below MA200", tone: "yellow" },
  { key: "dailyMa200Proximity", label: "Near 200-Day MA (Daily)", tone: "yellow" },
  { key: "weeklyMa200Proximity", label: "Near 200-Day MA (Weekly)", tone: "yellow" },
  { key: "bullishRsiDivergence", label: "Bullish RSI Divergence", tone: "green" },
  { key: "bearishRsiDivergence", label: "Bearish RSI Divergence", tone: "red" },
  { key: "bullishMacdDivergence", label: "Bullish MACD Divergence", tone: "green" },
  { key: "bearishMacdDivergence", label: "Bearish MACD Divergence", tone: "red" },
  { key: "positiveLastEarnings", label: "Positive Last Earnings", tone: "green" },
  { key: "strongEarningsGrowth", label: "Strong Earnings Growth", tone: "green" },
];

function toneDot(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  if (tone === "blue") return "#60a5fa";
  return "rgba(255,255,255,0.30)";
}

function toChartHref(href: string, symbol?: string) {
  const cleanedSymbol = String(symbol || "").trim().toUpperCase();
  const fallback = cleanedSymbol ? `/dashboard?symbol=${encodeURIComponent(cleanedSymbol)}` : "/dashboard";
  const raw = href && href.trim() ? href.trim() : "";
  const normalised = raw.startsWith("/?symbol=") ? raw.replace("/?symbol=", "/dashboard?symbol=") : raw.startsWith("/?")  
    ? raw.replace("/?", "/dashboard?") : raw;
  const base = normalised.startsWith("/dashboard") ? normalised : fallback;
  return base.includes("#chart") ? base : `${base}#chart`;
}

// Inserts extra query params into a toChartHref()-built URL (which already
// ends in "#chart") ahead of the hash, so deep-link params never end up
// tacked on after the fragment.
function buildDashboardHref(rawHref: string, symbol: string, extraParams?: Record<string, string | number>) {
  const base = toChartHref(rawHref, symbol);
  if (!extraParams || !Object.keys(extraParams).length) return base;
  const hashIdx = base.indexOf("#");
  const beforeHash = hashIdx >= 0 ? base.slice(0, hashIdx) : base;
  const hash = hashIdx >= 0 ? base.slice(hashIdx) : "";
  const sep = beforeHash.includes("?") ? "&" : "?";
  const qs = Object.entries(extraParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${beforeHash}${sep}${qs}${hash}`;
}

// Category-aware destination for a picker row: most categories still open
// the dashboard chart, but a few now carry enough data to open a more
// useful, pre-configured view -- the earnings page for earnings picks, the
// chart pre-zoomed to the referenced high with a line for ATH/3-month-high
// picks, the macro zone pre-drawn for support/resistance picks, the
// triggering indicator auto-selected for oversold/overbought picks, and
// both trend MAs for trend-score picks.
function buildPickHref(sectionTitle: string, item: PickerItem): string {
  const symbol = String(item.symbol ?? "").trim().toUpperCase();
  const title = sectionTitle.toLowerCase();
  const rawHref = item.dashboardHref ?? "";

  if (title.includes("earnings")) {
    return `/stock/${encodeURIComponent(symbol)}/earnings`;
  }

  if (title.includes("macro") && title.includes("support") && title.includes("resistance") && item.supportResistanceZone) {
    const z = item.supportResistanceZone;
    return buildDashboardHref(rawHref, symbol, { srLower: z.lower, srUpper: z.upper, srKind: z.kind });
  }

  if ((title.includes("all-time high breakout") || title.includes("all-time highs")) && item.chartFocus?.kind === "ath") {
    return buildDashboardHref(rawHref, symbol, { athPrice: item.chartFocus.price, athDate: item.chartFocus.date });
  }

  if (title.includes("3-month high breakout") && item.chartFocus?.kind === "rangeHigh") {
    return buildDashboardHref(rawHref, symbol, { rangeHighPrice: item.chartFocus.price, rangeHighDate: item.chartFocus.date });
  }

  if ((title.includes("oversold") || title.includes("overbought")) && item.dominantIndicator) {
    return buildDashboardHref(rawHref, symbol, { indicator: item.dominantIndicator });
  }

  if (title.includes("best trend score")) {
    return buildDashboardHref(rawHref, symbol, { indicators: "MA50,MA200" });
  }

  return toChartHref(rawHref, symbol);
}

function getFilterLabel(key: FilterKey) { return FILTER_DEFS.find((f) => f.key === key)?.label ?? key; }

function matchedSignalsForRecord(record: SignalRecord): FilterKey[] {
  const out: FilterKey[] = [];
  if (record.oversold) out.push("oversold");
  if (record.overbought) out.push("overbought");
  if (record.buyTheDip) out.push("buyTheDip");
  if (record.breakout) out.push("breakout");
  if (record.volumeSpike) out.push("volumeSpike");
  if (record.atrSpike) out.push("atrSpike");
  if (record.aboveMA50) out.push("aboveMA50");
  if (record.belowMA50) out.push("belowMA50");
  if (record.aboveMA200) out.push("aboveMA200");
  if (record.belowMA200) out.push("belowMA200");
  if (record.dailyMa200Proximity) out.push("dailyMa200Proximity");
  if (record.weeklyMa200Proximity) out.push("weeklyMa200Proximity");
  if (record.bullishRsiDivergence) out.push("bullishRsiDivergence");
  if (record.bearishRsiDivergence) out.push("bearishRsiDivergence");
  if (record.bullishMacdDivergence) out.push("bullishMacdDivergence");
  if (record.bearishMacdDivergence) out.push("bearishMacdDivergence");
  if (record.positiveLastEarnings) out.push("positiveLastEarnings");
  if (record.strongEarningsGrowth) out.push("strongEarningsGrowth");
  return out;
}

function chooseCardTone(record: SignalRecord, matchedFilters: FilterKey[]): PickerTone | undefined {
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "green") return "green"; }
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "red") return "red"; }
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "orange") return "orange"; }
  return record.tone;
}

function getBuySignalCount(record: SignalRecord) {
  if (!record.aboveMA200) return 0;
  let count = 0;
  if (record.oversold) count++; if (record.buyTheDip) count++; if (record.breakout) count++;
  if (record.volumeSpike) count++; if (record.atrSpike) count++; if (record.aboveMA50) count++;
  if (record.aboveMA200) count++; if (record.bullishRsiDivergence) count++; if (record.bullishMacdDivergence) count++;
  return count;
}

function getSellSignalCount(record: SignalRecord) {
  let count = 0;
  if (record.overbought) count++; if (record.belowMA50) count++; if (record.belowMA200) count++;
  if (record.bearishRsiDivergence) count++; if (record.bearishMacdDivergence) count++;
  return count;
}

function getHeaderHelp(title: string) {
  if (title.includes("Buy Signals")) return "Stocks showing multiple bullish technical conditions at the same time, ranked by signal count.";
  if (title.includes("Sell Signals")) return "Stocks showing multiple bearish technical conditions, ranked by signal count.";
  if (title.includes("Oversold")) return "Ranked oversold setups favouring stronger oversold readings, better liquidity and cleaner rebound potential.";
  if (title.includes("Best Trend Score")) return "Stocks with strong trend structure: price above MA50/MA200, correct MA alignment, positive MACD momentum.";
  if (title.includes("Positive Last Earnings")) return "Ranked by the most recent earnings report — EPS beats, revenue beats and positive EPS carry more weight.";
  if (title.includes("Strong Earnings Growth")) return "Ranked by year-over-year earnings improvement, recent positive EPS consistency and revenue growth.";
  if (title.includes("Overbought")) return "Ranked overbought setups favouring stronger extension and cleaner pullback-risk profiles.";
  if (title.includes("Divergence")) return "Ranked by timeframe, duration and structure quality. Weekly divergences usually carry more weight than daily ones.";
  if (title.includes("Macro Support") || title.includes("Resistance")) return "Stocks near wider weekly support or resistance zones, ranked by touch count, distance and structure length.";
  if (title.includes("All-Time Highs")) return "Pullback setups from all-time highs, ranked to favour liquid, tradable names over broken charts.";
  if (title.toLowerCase().includes("ma200")) return "Stocks near the 200-day moving average — a key long-term level traders watch for support, resistance and trend direction.";
  if (title.includes("Breakout")) return "Ranked to favour newer, cleaner and more liquid breakouts over older or more stretched moves.";
  return "Stocks matching multiple technical conditions worth reviewing on the chart.";
}

function seoHrefForTitle(rawTitle: string): string {
  const title = rawTitle.toLowerCase();
  if (title.includes("positive last earnings")) return "/stocks-with-positive-last-earnings";
  if (title.includes("strong earnings growth")) return "/stocks-with-strong-earnings-growth";
  if (title.includes("all-time high breakout")) return "/all-time-high-breakout-stocks";
  if (title.includes("3-month high breakout")) return "/3-month-high-breakout-stocks";
  if (title.includes("all-time highs")) return "/stocks-down-20-from-all-time-highs";
  if (title.includes("macro") && title.includes("support") && title.includes("resistance")) return "/macro-support-resistance-stocks";
  if (title.includes("buy signals")) return "/top-stocks-with-buy-signals";
  if (title.includes("sell signals")) return "/top-stocks-with-sell-signals";
  if (title.includes("oversold")) return "/oversold-stocks-today";
  if (title.includes("overbought")) return "/overbought-stocks-today";
  if (title.includes("best trend score")) return "/best-trend-score-stocks";
  if (title.includes("divergence")) return "/bullish-bearish-divergence-stocks";
  if (title.includes("daily ma200")) return "/stocks-near-200-day-moving-average";
  if (title.includes("weekly ma200")) return "/stocks-near-weekly-200-day-moving-average";
  return "";
}

function seeAllHrefFor(sec: { title: string }, lazySeeAllHref?: string, highlightSymbol?: string) {
  const base = lazySeeAllHref || seoHrefForTitle(sec.title);
  if (!base) return "";
  if (!highlightSymbol) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}symbol=${encodeURIComponent(highlightSymbol)}`;
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pickers-help-tip" style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.60)", fontSize: 10, fontWeight: 700, cursor: "pointer", marginLeft: 4, flex: "0 0 auto" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((v) => !v)}>
      ?
      {open ? <span style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 999, width: 240, maxWidth: "min(240px, 76vw)", padding: "10px 12px", borderRadius: 10, background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", color: "#cbd5e1", fontSize: 12, lineHeight: 1.5, fontWeight: 500, boxShadow: "0 14px 30px rgba(0,0,0,0.35)", textAlign: "left", pointerEvents: "none" }}>{text}</span> : null}
    </span>
  );
}

function createEmptySignalRecord(symbol: string, item?: PickerItem): SignalRecord {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  return {
    symbol: cleanSymbol, note: item?.note, tone: item?.tone,
    oversold: false, overbought: false, buyTheDip: false, breakout: false,
    volumeSpike: false, atrSpike: false, aboveMA50: false, belowMA50: false,
    aboveMA200: false, belowMA200: false, dailyMa200Proximity: false, weeklyMa200Proximity: false,
    bullishRsiDivergence: false, bearishRsiDivergence: false, bullishMacdDivergence: false, bearishMacdDivergence: false,
    positiveLastEarnings: false, strongEarningsGrowth: false,
    preferredTimeframe: item?.timeframe, preferredIndicator: item?.indicator,
    dashboardHref: toChartHref(item?.dashboardHref ?? "", cleanSymbol),
  };
}

type PlayCardDef = { title: string; href: string; tone: "green" | "red" | "blue"; pattern: "ascending" | "descending" | "bullFlag" | "macroSR"; };

const PLAY_CARDS: PlayCardDef[] = [
  { title: "Ascending Triangle Plays", href: "/plays", tone: "green", pattern: "ascending" },
  { title: "Descending Triangle Plays", href: "/plays/descending-triangles", tone: "red", pattern: "descending" },
  { title: "Bull Flag Plays", href: "/plays/bull-flags", tone: "blue", pattern: "bullFlag" },
  { title: "Macro Support / Resistance Plays", href: "/macro-support-resistance-stocks", tone: "blue", pattern: "macroSR" },
];

function playTone(tone: PlayCardDef["tone"]) {
  if (tone === "green") return { dot: "#22c55e", border: "rgba(34,197,94,0.20)", bg: "rgba(8,24,18,0.60)", line: "#22c55e", accent: "#60a5fa", color: "#bbf7d0" };
  if (tone === "red") return { dot: "#ef4444", border: "rgba(239,68,68,0.20)", bg: "rgba(32,12,18,0.60)", line: "#ef4444", accent: "#60a5fa", color: "#fecaca" };
  return { dot: "#60a5fa", border: "rgba(96,165,250,0.20)", bg: "rgba(10,18,36,0.60)", line: "#60a5fa", accent: "#22c55e", color: "#dbeafe" };
}

function PlayDiagram({ pattern, tone }: { pattern: PlayCardDef["pattern"]; tone: PlayCardDef["tone"] }) {
  const c = playTone(tone);

  if (pattern === "ascending") return (
    <svg viewBox="0 0 280 110" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Ascending triangle">
      <path d="M20 28 H260" stroke={c.line} strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" opacity="0.85" />
      <path d="M20 88 L260 28" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <path d="M22 86 L50 28 L72 62 L100 28 L122 50 L150 28 L172 42 L200 28 L222 35 L250 28" stroke="rgba(226,232,240,0.75)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M250 28 L268 14" stroke={c.line} strokeWidth="2.5" strokeLinecap="round" opacity="0.90" />
    </svg>
  );

  if (pattern === "descending") return (
    <svg viewBox="0 0 280 110" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Descending triangle">
      <path d="M20 82 H260" stroke={c.line} strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" opacity="0.85" />
      <path d="M20 24 L260 82" stroke={c.accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <path d="M22 26 L50 82 L72 54 L100 82 L122 62 L150 82 L172 70 L200 82 L222 77 L250 82" stroke="rgba(226,232,240,0.75)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M250 82 L268 96" stroke={c.line} strokeWidth="2.5" strokeLinecap="round" opacity="0.90" />
    </svg>
  );

  if (pattern === "bullFlag") return (
    <svg viewBox="0 0 240 110" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Bull flag">
      <path d="M28 96 L48 78 L62 58 L76 30" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M76 30 L168 44" stroke="rgba(226,232,240,0.40)" strokeWidth="1.5" strokeDasharray="5 4" strokeLinecap="round" />
      <path d="M76 50 L168 62" stroke="rgba(226,232,240,0.40)" strokeWidth="1.5" strokeDasharray="5 4" strokeLinecap="round" />
      <path d="M78 33 L104 47 L130 40 L156 52 L168 45" stroke="rgba(226,232,240,0.70)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M168 45 L192 28 L218 14" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  if (pattern === "macroSR") return (
    <svg viewBox="0 0 280 110" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Macro support resistance">
      <path d="M20 22 H260" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" opacity="0.80" />
      <path d="M20 78 H260" stroke="#22c55e" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" opacity="0.80" />
      <path d="M22 72 L50 26 L80 72 L110 26 L140 68 L168 26 L196 72 L224 28 L252 72" stroke="rgba(226,232,240,0.72)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return null;
}

function PatternPlaysSection() {
  return (
    <section style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "rgba(226,232,240,0.90)" }}>Chart Pattern Plays</h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.55, lineHeight: 1.5 }}>Visual chart-pattern pages — click through to the full play lists.</p>
      </div>
      <div className="pattern-plays-grid">
        {PLAY_CARDS.map((play) => {
          const c = playTone(play.tone);
          return (
            <a key={play.href} href={play.href} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 12, border: `1px solid ${c.border}`, background: c.bg, textDecoration: "none", color: "#f1f5f9", transition: "transform 140ms ease, filter 140ms ease", boxSizing: "border-box" }} className="pattern-play-card">
              <PlayDiagram pattern={play.pattern} tone={play.tone} />
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: c.dot, flex: "0 0 auto" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: c.color, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{play.title}</span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

// Small schematic chart icons for each accordion category -- illustrative
// only (don't correspond to any real stock's actual chart), matching the
// same idea as the ascending/descending/bull-flag PlayDiagram SVGs above
// but sized down for an accordion row header.
const PATTERN_SVG_INNER: Record<string, string> = {
  buy: `<polyline points="5,48 22,40 34,42 50,26 66,30 90,10" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M84,6 L96,8 L90,20 Z" fill="currentColor"/>`,
  sell: `<polyline points="5,12 22,20 34,18 50,34 66,30 90,50" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M84,54 L96,52 L90,40 Z" fill="currentColor"/>`,
  macro: `<line x1="5" y1="30" x2="95" y2="30" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5" opacity=".55"/><polyline points="5,45 20,32 35,28 50,32 65,20 80,30 95,15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ath: `<line x1="5" y1="18" x2="70" y2="18" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5" opacity=".55"/><polyline points="5,48 25,40 45,36 60,24 75,10 95,4" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  breakout3mo: `<line x1="30" y1="24" x2="80" y2="24" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5" opacity=".55"/><polyline points="5,46 25,38 45,32 60,26 75,14 95,8" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  oversold: `<polyline points="5,15 25,30 45,50 65,32 95,12" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="45" cy="50" r="5" fill="currentColor"/>`,
  overbought: `<polyline points="5,45 25,30 45,10 65,28 95,48" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="45" cy="10" r="5" fill="currentColor"/>`,
  earnings: `<rect x="8" y="34" width="14" height="20" rx="2" fill="currentColor" opacity=".9"/><rect x="30" y="24" width="14" height="30" rx="2" fill="currentColor" opacity=".9"/><rect x="52" y="14" width="14" height="40" rx="2" fill="currentColor" opacity=".9"/><rect x="74" y="4" width="14" height="50" rx="2" fill="currentColor" opacity=".9"/>`,
  divergence: `<polyline points="5,40 30,32 55,30 80,14 95,8" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="5,50 30,50 55,52 80,54 95,56" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="3 4" opacity=".6" stroke-linecap="round"/>`,
  trend: `<polyline points="5,50 25,42 45,38 65,24 85,16 95,10" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  posEarnings: `<path d="M8,32 L22,46 L46,12" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><rect x="60" y="26" width="12" height="28" rx="2" fill="currentColor" opacity=".85"/><rect x="78" y="14" width="12" height="40" rx="2" fill="currentColor" opacity=".85"/>`,
  maDaily: `<line x1="5" y1="34" x2="95" y2="34" stroke="currentColor" stroke-width="4" opacity=".5"/><polyline points="5,50 20,44 35,36 50,32 65,34 80,30 95,20" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  maWeekly: `<line x1="5" y1="32" x2="95" y2="30" stroke="currentColor" stroke-width="4" opacity=".5"/><polyline points="5,46 25,40 45,34 65,32 85,26 95,22" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  down20: `<line x1="5" y1="10" x2="30" y2="10" stroke="currentColor" stroke-width="4" stroke-dasharray="5 4" opacity=".5"/><polyline points="8,12 25,10 40,28 55,38 75,42 95,40" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  triAsc: `<line x1="5" y1="12" x2="95" y2="12" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5" opacity=".55"/><line x1="5" y1="50" x2="95" y2="12" stroke="currentColor" stroke-width="3" stroke-dasharray="3 4" opacity=".4"/><polyline points="5,50 30,26 55,36 80,16 95,12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  triDesc: `<line x1="5" y1="48" x2="95" y2="48" stroke="currentColor" stroke-width="4" stroke-dasharray="6 5" opacity=".55"/><line x1="5" y1="10" x2="95" y2="48" stroke="currentColor" stroke-width="3" stroke-dasharray="3 4" opacity=".4"/><polyline points="5,10 30,34 55,24 80,44 95,48" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  flag: `<polyline points="10,52 25,16" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><rect x="20" y="16" width="34" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="4" opacity=".7" transform="rotate(-8 37 26)"/><polyline points="54,26 75,18 95,4" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function iconPatternForTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("buy signals")) return "buy";
  if (t.includes("sell signals")) return "sell";
  if (t.includes("oversold")) return "oversold";
  if (t.includes("overbought")) return "overbought";
  if (t.includes("strong earnings growth")) return "earnings";
  if (t.includes("positive last earnings")) return "posEarnings";
  if (t.includes("divergence")) return "divergence";
  if (t.includes("best trend")) return "trend";
  if (t.includes("daily ma200")) return "maDaily";
  if (t.includes("weekly ma200")) return "maWeekly";
  if (t.includes("macro") && t.includes("support")) return "macro";
  if (t.includes("all-time high breakout")) return "ath";
  if (t.includes("3-month high breakout")) return "breakout3mo";
  if (t.includes("all-time highs")) return "down20";
  if (t.includes("ascending triangle")) return "triAsc";
  if (t.includes("descending triangle")) return "triDesc";
  if (t.includes("bull flag")) return "flag";
  return "trend";
}

function colorForTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("sell") || t.includes("overbought") || t.includes("descending triangle")) return "#ef4444";
  if (t.includes("divergence") || t.includes("macro")) return "#60a5fa";
  if (t.includes("earnings")) return "#22d3ee";
  if (t.includes("ma200") || t.includes("all-time highs")) return "#eab308";
  if (t.includes("breakout") || t.includes("ascending triangle") || t.includes("bull flag")) return "#fb923c";
  return "#22c55e";
}

function PatternIcon({ title }: { title: string }) {
  const pattern = iconPatternForTitle(title);
  const color = colorForTitle(title);
  const inner = PATTERN_SVG_INNER[pattern] ?? PATTERN_SVG_INNER.trend;
  return (
    <svg
      viewBox="0 0 100 60"
      style={{ width: 34, height: 22, display: "block", color, flex: "0 0 auto" }}
      role="img"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

function PickerRowContent({ symbol, note, companyName }: { symbol: string; note?: string; companyName?: string }) {
  const fullLine1 = companyName ? `${symbol} · ${companyName}` : symbol;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, overflow: "hidden" }}>
      <span title={companyName ? fullLine1 : undefined} style={{ display: "flex", alignItems: "baseline", minWidth: 0, overflow: "hidden" }}>
        <span className="picker-row-ticker">{symbol}</span>
        {companyName ? (
          <>
            <span className="picker-name-sep">&nbsp;·&nbsp;</span>
            <span className="picker-row-company">{companyName}</span>
          </>
        ) : null}
      </span>
      {note ? <span className="picker-row-note" title={note}>{note}</span> : null}
    </span>
  );
}

type InsightSummary = { slug: string; title: string; date: string; symbol: string | null };

export default function PickersClient({ latestInsights = [] }: { latestInsights?: InsightSummary[] }) {
  const SHOW_FORCE_FETCH_BUTTON = false;

  const [sections, setSections] = useState<PickerSection[]>([]);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(null);
  const [dynamicUniversePreview, setDynamicUniversePreview] = useState<string[] | null>(null);
  const [dynamicSymbols, setDynamicSymbols] = useState<string[]>([]);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);
  const [earningsFetchBusy, setEarningsFetchBusy] = useState(false);
  const [earningsFetchLockedUntil, setEarningsFetchLockedUntil] = useState(0);
  const [earningsFetchTick, setEarningsFetchTick] = useState(0);
  const [earningsFetchMessage, setEarningsFetchMessage] = useState<string | null>(null);
  const [companyNames, setCompanyNames] = useState<Map<string, string>>(new Map());

  // Accordion + sidebar + search state (draft-approved redesign of the
  // pickers results area -- see claude/PICKERS_ACCORDION_REDESIGN.md).
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [highlightRowKey, setHighlightRowKey] = useState<string | null>(null);
  const rowRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState("");

  // Header "Build Screener" dropdown link deep-links to /pickers#custom-screener --
  // once the results have loaded, scroll the custom screener panel into view and
  // give it a brief glow so the user's eye lands on it without staying lit forever.
  const [screenerHighlight, setScreenerHighlight] = useState(false);
  const screenerPanelRef = React.useRef<HTMLElement | null>(null);
  const screenerHashHandledRef = React.useRef(false);

  useEffect(() => {
    if (loading) return;
    if (screenerHashHandledRef.current) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#custom-screener") return;
    screenerHashHandledRef.current = true;

    window.setTimeout(() => {
      screenerPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setScreenerHighlight(true);
      window.setTimeout(() => setScreenerHighlight(false), 2700);
    }, 80);
  }, [loading]);

  const EARNINGS_FETCH_LOCK_MS = 90 * 1000;
  void earningsFetchTick;
  const earningsFetchRemainingSeconds = Math.max(0, Math.ceil((earningsFetchLockedUntil - Date.now()) / 1000));

  async function handleFetchEarnings() {
    if (earningsFetchBusy || Date.now() < earningsFetchLockedUntil) return;
    setEarningsFetchBusy(true); setEarningsFetchMessage(null);
    try {
      const res = await fetch(`/api/jobs/warm-earnings?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Earnings warm-up failed");
      const data = (await res.json()) as { fetchedCount?: number; checked?: number; deferredCount?: number; failedCount?: number };
      const fetched = typeof data?.fetchedCount === "number" ? data.fetchedCount : 0;
      const checked = typeof data?.checked === "number" ? data.checked : 0;
      const deferred = typeof data?.deferredCount === "number" ? data.deferredCount : 0;
      const failed = typeof data?.failedCount === "number" ? data.failedCount : 0;
      setEarningsFetchMessage(`Checked ${checked}, fetched ${fetched}, deferred ${deferred}, failed ${failed}.`);
      const lockUntil = Date.now() + EARNINGS_FETCH_LOCK_MS;
      setEarningsFetchLockedUntil(lockUntil);
      try { window.localStorage.setItem("msh:lastEarningsFetchUntil", String(lockUntil)); } catch { /* ignore */ }
      await loadPickers(true);
    } catch { setEarningsFetchMessage("Earnings warm-up failed. Try again in a moment."); }
    finally { setEarningsFetchBusy(false); }
  }

  function toggleSection(title: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  // Shared by "click a ticker anywhere", "Top Picks" sidebar rows, and
  // ticker-search result chips: expand that category, scroll the specific
  // row into view, and give it a brief highlight pulse -- the in-page
  // version of the "jump to a specific stock" behaviour used for the
  // seeAll deep links.
  function focusPick(title: string, symbol: string) {
    setExpandedSections((prev) => new Set(prev).add(title));
    const key = `${title}::${symbol}`;
    window.setTimeout(() => {
      const el = rowRefs.current.get(key);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightRowKey(key);
      window.setTimeout(() => {
        setHighlightRowKey((cur) => (cur === key ? null : cur));
      }, 2200);
    }, 80);
  }

  async function loadPickers(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;
    setBusy(true); setErr(null);
    try {
      const url = force ? `/api/pickers?force=1&t=${Date.now()}` : `/api/pickers?t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Pickers API failed");
      const data = (await res.json()) as PickersPayload;
      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setSignalRecords(Array.isArray(data?.signalRecords) ? data.signalRecords : []);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
      setDynamicUniverseCount(typeof data?.dynamicUniverseCount === "number" ? data.dynamicUniverseCount : null);
      setDynamicUniversePreview(Array.isArray(data?.dynamicUniversePreview) ? data.dynamicUniversePreview : null);
      setDynamicSymbols(Array.isArray(data?.dynamicSymbols) ? data.dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []);
      setEstimatedApiCalls(typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null);
    } catch {
      setErr(force ? "Force refresh failed." : "Failed to load stock ideas.");
      if (!force) { setSections([]); setSignalRecords([]); setUpdatedAt(null); setUniverseSize(null); setDynamicUniverseCount(null); setDynamicUniversePreview(null); setDynamicSymbols([]); setEstimatedApiCalls(null); }
    } finally { setBusy(false); }
  }

  useEffect(() => {
    try { const saved = Number(window.localStorage.getItem("msh:lastEarningsFetchUntil") || "0"); if (Number.isFinite(saved) && saved > Date.now()) setEarningsFetchLockedUntil(saved); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;
    const interval = window.setInterval(() => setEarningsFetchTick((v) => v + 1), 1000);
    return () => window.clearInterval(interval);
  }, [earningsFetchLockedUntil]);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;
    if (Date.now() < earningsFetchLockedUntil) return;
    setEarningsFetchLockedUntil(0);
    try { window.localStorage.removeItem("msh:lastEarningsFetchUntil"); } catch { /* ignore */ }
  }, [earningsFetchTick, earningsFetchLockedUntil]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(`/api/pickers?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Pickers API failed");
        const data = (await res.json()) as PickersPayload;
        if (!cancelled) {
          setSections(Array.isArray(data?.sections) ? data.sections : []);
          setSignalRecords(Array.isArray(data?.signalRecords) ? data.signalRecords : []);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
          setDynamicUniverseCount(typeof data?.dynamicUniverseCount === "number" ? data.dynamicUniverseCount : null);
          setDynamicUniversePreview(Array.isArray(data?.dynamicUniversePreview) ? data.dynamicUniversePreview : null);
          setDynamicSymbols(Array.isArray(data?.dynamicSymbols) ? data.dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []);
          setEstimatedApiCalls(typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null);
        }
      } catch {
        if (!cancelled) { setErr("Failed to load stock ideas."); setSections([]); setSignalRecords([]); setUpdatedAt(null); setUniverseSize(null); setDynamicUniverseCount(null); setDynamicUniversePreview(null); setDynamicSymbols([]); setEstimatedApiCalls(null); }
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sections.length && !signalRecords.length) return;

    let cancelled = false;

    const sectionSymbols = sections.flatMap((sec) =>
      (Array.isArray(sec.items) ? sec.items.slice(0, 4) : []).map((it) =>
        String(it.symbol ?? "").trim().toUpperCase()
      )
    );

    const topBuySymbols = signalRecords
      .map((record) => ({
        symbol: String(record.symbol ?? "").trim().toUpperCase(),
        buyCount: getBuySignalCount(record),
      }))
      .filter((item) => item.symbol && item.buyCount > 0)
      .sort((a, b) => b.buyCount !== a.buyCount ? b.buyCount - a.buyCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((item) => item.symbol);

    const topSellSymbols = signalRecords
      .map((record) => ({
        symbol: String(record.symbol ?? "").trim().toUpperCase(),
        sellCount: getSellSignalCount(record),
      }))
      .filter((item) => item.symbol && item.sellCount > 0)
      .sort((a, b) => b.sellCount !== a.sellCount ? b.sellCount - a.sellCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((item) => item.symbol);

    const uniqueSymbols = Array.from(new Set([...sectionSymbols, ...topBuySymbols, ...topSellSymbols])).filter(Boolean);

    async function fetchNames() {
      const BATCH = 8;

      for (let i = 0; i < uniqueSymbols.length; i += BATCH) {
        if (cancelled) return;

        const batch = uniqueSymbols.slice(i, i + BATCH);
        const batchMap = new Map<string, string>();

        await Promise.all(batch.map(async (sym) => {
          try {
            // Use no-store so stale empty results from previous cold-start
            // failures don't get permanently cached in the browser.
            const res = await fetch(`/api/symbols?q=${encodeURIComponent(sym)}`, { cache: "no-store" });
            if (!res.ok) return;

            const data = (await res.json()) as { results?: { symbol: string; name: string }[] };
            const results = Array.isArray(data.results) ? data.results : [];

            const exact = results.find((r) =>
              String(r.symbol ?? "").trim().toUpperCase() === sym
            );

            const name = typeof exact?.name === "string" ? exact.name.trim() : "";
            if (name) batchMap.set(sym, name);
          } catch {
            /* ignore */
          }
        }));

        if (!cancelled && batchMap.size > 0) {
          setCompanyNames((prev) => {
            const next = new Map(prev);
            for (const [sym, name] of batchMap) next.set(sym, name);
            return next;
          });
        }
      }
    }

    void fetchNames();

    return () => { cancelled = true; };
  }, [sections, signalRecords]);

  const safeSections = useMemo(() => Array.isArray(sections) ? sections : [], [sections]);
  const safeSignalRecords = useMemo(() => Array.isArray(signalRecords) ? signalRecords : [], [signalRecords]);

  const earningsSectionSymbolSets = useMemo(() => {
    const positiveLastEarnings = new Set<string>(); const strongEarningsGrowth = new Set<string>();
    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        if (title.includes("positive last earnings")) positiveLastEarnings.add(symbol);
        if (title.includes("strong earnings growth")) strongEarningsGrowth.add(symbol);
      }
    }
    return { positiveLastEarnings, strongEarningsGrowth };
  }, [safeSections]);

  const enrichedSignalRecords = useMemo(() => {
    const map = new Map<string, SignalRecord>();
    for (const record of safeSignalRecords) {
      const symbol = String(record.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, { ...record, symbol, positiveLastEarnings: record.positiveLastEarnings === true || earningsSectionSymbolSets.positiveLastEarnings.has(symbol), strongEarningsGrowth: record.strongEarningsGrowth === true || earningsSectionSymbolSets.strongEarningsGrowth.has(symbol) });
    }
    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      const isPLE = title.includes("positive last earnings"), isSEG = title.includes("strong earnings growth");
      if (!isPLE && !isSEG) continue;
      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        const existing = map.get(symbol) ?? createEmptySignalRecord(symbol, item);
        map.set(symbol, { ...existing, note: existing.note ?? item.note, tone: existing.tone ?? item.tone, dashboardHref: existing.dashboardHref ?? item.dashboardHref, positiveLastEarnings: existing.positiveLastEarnings === true || isPLE, strongEarningsGrowth: existing.strongEarningsGrowth === true || isSEG });
      }
    }
    return Array.from(map.values());
  }, [safeSections, safeSignalRecords, earningsSectionSymbolSets]);

  const signalRecordMap = useMemo(() => {
    const map = new Map<string, SignalRecord>();
    for (const record of enrichedSignalRecords) { const symbol = String(record.symbol ?? "").trim().toUpperCase(); if (!symbol) continue; map.set(symbol, record); }
    return map;
  }, [enrichedSignalRecords]);

  const dynamicSymbolSet = useMemo(() => new Set(dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean)), [dynamicSymbols]);

  const topBuySection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((r) => ({ symbol: r.symbol, buyCount: getBuySignalCount(r), dashboardHref: toChartHref(r.dashboardHref ?? "", r.symbol) }))
      .filter((i) => i.buyCount > 0)
      .sort((a, b) => b.buyCount !== a.buyCount ? b.buyCount - a.buyCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((i) => ({ symbol: i.symbol, note: `${i.buyCount} buy signal${i.buyCount === 1 ? "" : "s"}`, tone: "green" as PickerTone, dashboardHref: i.dashboardHref }));
    if (!items.length) return null;
    return { title: "Top Stocks With Buy Signals (Live Scan)", items };
  }, [safeSignalRecords]);

  const topSellSection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((r) => ({ symbol: r.symbol, sellCount: getSellSignalCount(r), dashboardHref: toChartHref(r.dashboardHref ?? "", r.symbol) }))
      .filter((i) => i.sellCount > 0)
      .sort((a, b) => b.sellCount !== a.sellCount ? b.sellCount - a.sellCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((i) => ({ symbol: i.symbol, note: `${i.sellCount} sell signal${i.sellCount === 1 ? "" : "s"}`, tone: "red" as PickerTone, dashboardHref: i.dashboardHref }));
    if (!items.length) return null;
    return { title: "Top Stocks With Sell Signals (Bearish Setups)", items };
  }, [safeSignalRecords]);

  const displaySections = useMemo(() => {
    const out: PickerSection[] = [];
    const ma200Daily  = safeSections.find((s) => s.title.toLowerCase().includes("daily ma200"));
    const ma200Weekly = safeSections.find((s) => s.title.toLowerCase().includes("weekly ma200"));
    const buyDip      = safeSections.find((s) => s.title.includes("All-Time Highs") && !s.title.includes("Breakout"));
    const athBreak    = safeSections.find((s) => s.title.includes("All-Time High Breakout"));
    const threeMonth  = safeSections.find((s) => s.title.includes("3-Month High Breakout"));
    const oversold    = safeSections.find((s) => s.title.toLowerCase().includes("oversold"));
    const macroSR     = safeSections.find((s) => { const t = s.title.toLowerCase(); return t.includes("macro") && t.includes("support") && t.includes("resistance"); });
    const earningsGrowth = safeSections.find((s) => s.title.toLowerCase().includes("strong earnings growth"));
    const divergence  = safeSections.find((s) => s.title.toLowerCase().includes("divergence"));
    const placed = new Set([ma200Daily, ma200Weekly, buyDip, athBreak, threeMonth, oversold, macroSR, earningsGrowth, divergence].filter(Boolean));
    const others = safeSections.filter((s) => !placed.has(s) && !s.title.toLowerCase().includes("hot market names"));
    if (ma200Daily) out.push(ma200Daily);
    if (ma200Weekly) out.push(ma200Weekly);
    if (topBuySection) out.push(topBuySection);
    if (buyDip) out.push(buyDip);
    if (macroSR) out.push(macroSR);
    if (athBreak) out.push(athBreak);
    if (threeMonth) out.push(threeMonth);
    if (topSellSection) out.push(topSellSection);
    if (oversold) out.push(oversold);
    if (earningsGrowth) out.push(earningsGrowth);
    if (divergence) out.push(divergence);
    return [...out, ...others];
  }, [safeSections, topBuySection, topSellSection]);

  // Cross-category overlap for the sidebar's "Top Picks" widget -- symbols
  // appearing in 2+ of the always-loaded categories above. Deliberately
  // scoped to displaySections (not the 3 lazy chart-pattern categories,
  // which aren't fetched until expanded).
  const topPicks = useMemo(() => {
    const map = new Map<string, { count: number; titles: string[] }>();
    for (const sec of displaySections) {
      for (const item of Array.isArray(sec.items) ? sec.items : []) {
        const symbol = String(item.symbol ?? "").trim().toUpperCase();
        if (!symbol) continue;
        const entry = map.get(symbol) ?? { count: 0, titles: [] };
        entry.count += 1;
        entry.titles.push(sec.title);
        map.set(symbol, entry);
      }
    }
    return Array.from(map.entries())
      .map(([symbol, v]) => ({ symbol, count: v.count, titles: v.titles }))
      .filter((p) => p.count > 1)
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.symbol.localeCompare(b.symbol)))
      .slice(0, 6);
  }, [displaySections]);

  // symbol -> every (title, note, tone) it currently qualifies for, built
  // from the same always-loaded categories -- powers the ticker search box.
  const symbolCategoryIndex = useMemo(() => {
    const map = new Map<string, { title: string; note?: string; tone?: PickerTone }[]>();
    for (const sec of displaySections) {
      for (const item of Array.isArray(sec.items) ? sec.items : []) {
        const symbol = String(item.symbol ?? "").trim().toUpperCase();
        if (!symbol) continue;
        const arr = map.get(symbol) ?? [];
        arr.push({ title: sec.title, note: item.note, tone: item.tone });
        map.set(symbol, arr);
      }
    }
    return map;
  }, [displaySections]);

  const searchResults = searchSubmitted ? symbolCategoryIndex.get(searchSubmitted) ?? [] : null;

  const customMode = selectedFilters.length > 0;

  const customMatches = useMemo(() => {
    if (!customMode) return [];
    return enrichedSignalRecords
      .filter((record) => selectedFilters.every((filter) => record[filter] === true))
      .map((record) => { const matchedSignals = matchedSignalsForRecord(record).filter((key) => selectedFilters.includes(key)); return { ...record, matchedSignals, displayTone: chooseCardTone(record, matchedSignals) }; })
      .sort((a, b) => { const d = b.matchedSignals.length - a.matchedSignals.length; return d !== 0 ? d : a.symbol.localeCompare(b.symbol); });
  }, [customMode, enrichedSignalRecords, selectedFilters]);

  function toggleFilter(key: FilterKey) { setSelectedFilters((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]); }
  function clearFilters() { setSelectedFilters([]); }
  function handleScreenerButton() { setScreenerOpen((prev) => !prev); }

  return (
    <section aria-label="Live stock idea results" style={{ width: "100%", minWidth: 0 }}>
      <style>{`
  @keyframes pickersBar { 0%{transform:translateX(-60%);opacity:0.55;} 50%{transform:translateX(140%);opacity:0.95;} 100%{transform:translateX(320%);opacity:0.55;} }
  .pickers-loading-bar { height:100%;width:35%;border-radius:999px;background:rgba(59,130,246,0.90);animation:pickersBar 1.1s linear infinite; }
  .pickers-shell { width:100%;min-width:0;grid-template-columns:minmax(0,1fr); }
  .picker-row { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06);min-width:0; }
  .picker-row:last-child { border-bottom:none; }
  .picker-row-left { display:flex;align-items:center;gap:10px;min-width:0;flex:1;overflow:hidden; }
  .picker-row-ticker { font-size:16px;font-weight:700;color:#e2e8f0;letter-spacing:0.01em;flex:0 0 auto;line-height:1.2; }
  .picker-name-sep { font-size:11px;color:rgba(148,163,184,0.28);flex:0 0 auto;user-select:none; }
  .picker-row-company { font-size:11px;color:rgba(148,163,184,0.55);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1; }
  .picker-row-note { font-size:11px;color:rgba(148,163,184,0.58);font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block; }
  .picker-row-link { font-size:11px;font-weight:600;color:rgba(148,163,184,0.55);text-decoration:none;white-space:nowrap;flex:0 0 auto;transition:color 120ms ease; }
  .picker-row-link:hover { color:#93c5fd !important; }
  .pickers-see-all { display:inline-flex !important;align-items:center;padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);font-size:11px;font-weight:600;color:#4ade80;text-decoration:none;transition:color 120ms ease,background 120ms ease;white-space:nowrap; }
  .pickers-see-all:hover { background:rgba(255,255,255,0.07);color:#86efac !important;filter:none !important;transform:none !important; }
  .pickers-section-footer { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:nowrap; }
  .pickers-section-footer-left { display:flex;align-items:center;gap:8px;flex:1;min-width:0; }
  .pattern-plays-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px; }
  .pattern-play-card:hover { transform:translateY(-2px);filter:brightness(1.08); }
  .pickers-filter-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px; }
  .pickers-card-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px; }
  .pickers-section-title { display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0; }
  .pickers-section-title-text { min-width:0;line-height:1.22;font-size:14px;font-weight:700; }
  .pickers-screener-panel { display:block; }
  .pickers-earnings-fetch-button:hover:not(:disabled) { filter:brightness(1.08);transform:translateY(-1px); }

  @keyframes screenerHighlightGlow {
    0% { box-shadow:0 0 0 0 rgba(59,130,246,0);border-color:rgba(255,255,255,0.08); }
    15% { box-shadow:0 0 0 4px rgba(59,130,246,0.30),0 0 26px rgba(59,130,246,0.45);border-color:rgba(96,165,250,0.65); }
    100% { box-shadow:0 0 0 0 rgba(59,130,246,0);border-color:rgba(255,255,255,0.08); }
  }
  .pickers-screener-panel.screenerHighlightPulse { animation:screenerHighlightGlow 2.6s ease-out 1; }

  /* Accordion + sidebar (replaces the old fixed 3-col card grid) */
  .pickers-accordion-layout { display:grid;grid-template-columns:minmax(0,2.15fr) minmax(0,1fr);gap:18px;align-items:start; }
  .pickers-accordion { display:flex;flex-direction:column;gap:8px;min-width:0; }
  .acc-item { border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.025);overflow:hidden;min-width:0; }
  .acc-item.open { border-color:rgba(96,165,250,0.35); }
  .acc-head { width:100%;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:none;border:none;cursor:pointer;text-align:left;color:inherit;font:inherit; }
  .acc-head-left { display:flex;align-items:center;gap:10px;min-width:0;flex:1; }
  .acc-head-text { display:flex;flex-direction:column;gap:2px;min-width:0; }
  .acc-icon { width:44px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden; }
  .acc-count { font-size:11px;color:rgba(148,163,184,0.55); }
  .acc-chevron { color:rgba(148,163,184,0.45);transition:transform 160ms ease;flex:0 0 auto;font-size:12px; }
  .acc-item.open .acc-chevron { transform:rotate(90deg);color:#93c5fd; }
  .acc-body { padding:0 14px 12px;border-top:1px solid rgba(255,255,255,0.06); }
  .pickers-sidebar { position:sticky;top:16px;display:flex;flex-direction:column;gap:14px; }
  .pickers-side-panel { border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.025);padding:14px; }
  .pickers-side-panel-head { font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:rgba(226,232,240,0.72); }
  .pickers-side-panel-sub { margin:4px 0 10px;font-size:11px;color:rgba(148,163,184,0.55);line-height:1.5; }
  .pickers-side-empty { font-size:12px;color:rgba(148,163,184,0.50);padding:6px 0; }
  .toppick-row { display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer; }
  .toppick-row:last-child { border-bottom:none; }
  .toppick-row:hover .sym { text-decoration:underline; }
  .toppick-badge { width:22px;height:22px;border-radius:6px;background:rgba(245,197,66,0.14);color:#f5c542;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto; }
  .toppick-cats { font-size:11px;color:rgba(148,163,184,0.55);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
  .insight-row { display:block;text-decoration:none;color:inherit;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05); }
  .insight-row:last-of-type { border-bottom:none; }
  .insight-tag { display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.03em;color:#c084fc;background:rgba(192,132,252,0.12);border:1px solid rgba(192,132,252,0.28);padding:2px 6px;border-radius:5px;margin-bottom:5px; }
  .insight-title { font-size:13px;font-weight:600;line-height:1.35;color:#e2e8f0; }
  .insight-row:hover .insight-title { color:#67e8f9; }
  .insight-meta { font-size:10.5px;color:rgba(148,163,184,0.50);margin-top:3px; }
  .pickers-side-footer-link { display:block;text-align:right;margin-top:6px;font-size:11px;font-weight:600;color:#4ade80;text-decoration:none; }
  @keyframes pickerRowHighlight {
    0% { background:rgba(245,197,66,0); }
    20% { background:rgba(245,197,66,0.18); }
    100% { background:rgba(245,197,66,0); }
  }
  .picker-row.rowHighlight { animation:pickerRowHighlight 2.2s ease-out 1;border-radius:8px; }

  @media (max-width: 1100px) {
    .pattern-plays-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pickers-filter-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .pickers-accordion-layout { grid-template-columns:minmax(0,1fr); }
    .pickers-sidebar { position:static; }
  }
  @media (max-width: 820px) {
    .pickers-filter-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pickers-card-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (max-width: 640px) {
    .pickers-screener-panel { display:none !important; }
    .pattern-plays-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:8px; }
    .pickers-section-description { display:none; }
    .pickers-help-tip { width:18px !important;height:18px !important;font-size:10px !important; }
    .pickers-section-title-text { font-size:13px !important; }
    .picker-row-note { display:none !important; }
    .picker-row-ticker { font-size:14px !important; }
    .pickers-section-footer { flex-wrap:wrap; }
    .pickers-see-all { width:100%;justify-content:center;padding:6px 10px;font-size:12px; }
  }
  @media (max-width: 400px) {
    .pattern-plays-grid { grid-template-columns:minmax(0,1fr) !important; }
  }
`}</style>

      {loading ? (
        <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 18, background: "#0b1220", boxSizing: "border-box" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Gathering stocks, please wait…</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.65 }}>First load can take 10–15 seconds. Cached loads are faster.</div>
          <div style={{ marginTop: 14, width: 360, maxWidth: "100%", height: 6, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.07)" }}>
            <div className="pickers-loading-bar" />
          </div>
        </div>
      ) : null}

      {err ? <div style={{ border: "1px solid rgba(239,68,68,0.18)", borderRadius: 12, padding: 14, background: "rgba(239,68,68,0.06)", color: "#fecaca", fontSize: 14 }}>{err}</div> : null}

      {!loading && !err ? (
        <section
          id="custom-screener"
          ref={screenerPanelRef}
          className={`pickers-screener-panel${screenerHighlight ? " screenerHighlightPulse" : ""}`}
          style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 16px", background: "rgba(255,255,255,0.02)", marginBottom: 14, boxSizing: "border-box" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#e2e8f0" }}>Custom Screener</span>
              <span style={{ fontSize: 14, color: "rgba(148,163,184,0.75)", fontWeight: 400 }}>Select conditions — only stocks matching all will show.</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
              <button type="button" onClick={handleScreenerButton} style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid rgba(34,197,94,0.28)", background: screenerOpen ? "rgba(34,197,94,0.14)" : "rgba(34,197,94,0.06)", color: "#86efac" }}>
                {screenerOpen ? "Hide" : "Open Filters"}
              </button>
              {customMode ? <button type="button" onClick={clearFilters} style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid rgba(239,68,68,0.28)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}>Clear ({selectedFilters.length})</button> : null}
            </div>
          </div>
          <div style={{ marginTop: screenerOpen ? 10 : 0, maxHeight: screenerOpen ? 1200 : 0, opacity: screenerOpen ? 1 : 0, overflow: "hidden", transition: "max-height 0.30s ease, opacity 0.18s ease, margin-top 0.20s ease" }}>
            <div className="pickers-filter-grid">
              {FILTER_DEFS.map((filter) => {
                const active = selectedFilters.includes(filter.key);
                return (
                  <button key={filter.key} type="button" onClick={() => toggleFilter(filter.key)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: active ? `1px solid ${toneDot(filter.tone)}` : "1px solid rgba(255,255,255,0.09)", background: active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.02)", color: "#e2e8f0", textAlign: "left", fontWeight: active ? 700 : 500, fontSize: 12, cursor: "pointer", boxSizing: "border-box" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: toneDot(filter.tone), flex: "0 0 auto" }} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filter.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className="pickers-shell" style={{ marginTop: loading || err ? 16 : 0, display: "grid", gap: 12, boxSizing: "border-box" }}>
        {!loading && !err && !customMode ? <PatternPlaysSection /> : null}

        {!loading && !err && !customMode ? (
          <section style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 16px", background: "rgba(255,255,255,0.02)", boxSizing: "border-box" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#67e8f9", marginBottom: 6 }}>Search a ticker</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearchSubmitted(searchQuery.trim().toUpperCase()); }}
                placeholder="e.g. AAPL — see every list it qualifies for"
                style={{ flex: 1, minWidth: 180, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, padding: "9px 12px", color: "#e2e8f0", fontSize: 13 }}
              />
              <button type="button" onClick={() => setSearchSubmitted(searchQuery.trim().toUpperCase())} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid rgba(34,197,94,0.28)", background: "rgba(34,197,94,0.10)", color: "#86efac", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Search</button>
            </div>
            {searchResults != null ? (
              <div style={{ marginTop: 10 }}>
                {searchResults.length ? (
                  <>
                    <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}><b>{searchSubmitted}</b> qualifies for {searchResults.length} {searchResults.length === 1 ? "list" : "lists"}:</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {searchResults.map((r) => (
                        <button key={r.title} type="button" onClick={() => focusPick(r.title, searchSubmitted)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: toneDot(r.tone), flex: "0 0 auto" }} />
                          {r.title}
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10.5, opacity: 0.4 }}>Doesn&apos;t include Ascending/Descending Triangle or Bull Flag plays until those are expanded below.</div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.55 }}>No current picker lists match &ldquo;{searchSubmitted}&rdquo;.</div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {customMode ? (
          <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, background: "#0b1220", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Custom Screener Results</h2>
              <div style={{ fontSize: 12, opacity: 0.55 }}>{customMatches.length} {customMatches.length === 1 ? "match" : "matches"}</div>
            </div>
            {customMatches.length ? (
              <div className="pickers-card-grid">
                {customMatches.map((item) => (
                  <a key={item.symbol} href={toChartHref(item.dashboardHref ?? "", item.symbol)} style={{ display: "block", textDecoration: "none", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.03)", boxSizing: "border-box" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: toneDot(item.displayTone), flex: "0 0 auto" }} />
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{item.symbol}</span>
                        {item.note ? <span style={{ fontSize: 11, opacity: 0.55 }}>{item.note}</span> : null}
                      </div>
                      <a href={toChartHref(item.dashboardHref ?? "", item.symbol)} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, fontWeight: 600, color: "rgba(148,163,184,0.55)", textDecoration: "none" }}>Chart ↗</a>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {item.matchedSignals.map((signal) => {
                        const def = FILTER_DEFS.find((f) => f.key === signal);
                        return <span key={`${item.symbol}-${signal}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", fontSize: 11, fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: toneDot(def?.tone), flex: "0 0 auto" }} />{getFilterLabel(signal)}</span>;
                      })}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 14, opacity: 0.65, padding: "10px 0" }}>No stocks currently match all selected filters. Try removing one condition.</div>
            )}
          </section>
        ) : (
          <div className="pickers-accordion-layout">
            <div className="pickers-accordion">
              {displaySections.map((sec) => {
                const isEarnings = sec.title.toLowerCase().includes("earnings");
                const isOpen = expandedSections.has(sec.title);
                const items = Array.isArray(sec.items)
                  ? sec.items.map((it) => {
                      const symbol = String(it.symbol ?? "").trim().toUpperCase();
                      const record = signalRecordMap.get(symbol);
                      const checkCount = record ? matchedSignalsForRecord(record).length : 0;
                      const isDynamic = dynamicSymbolSet.has(symbol);
                      return { ...it, symbol, checkCount, isDynamic };
                    })
                  : [];
                // Items already arrive strongest-first from the API; only
                // show the top 5 inline and point to the dedicated page
                // (via seeAllHref) for the rest, rather than dumping the
                // full up-to-20-item list into every dropdown.
                const visibleItems = items.slice(0, 5);
                const seeAllHref = seeAllHrefFor(sec);

                return (
                  <div key={sec.title} className={isOpen ? "acc-item open" : "acc-item"}>
                    <button type="button" className="acc-head" onClick={() => toggleSection(sec.title)}>
                      <span className="acc-head-left">
                        <span className="acc-icon" style={{ background: `${colorForTitle(sec.title)}1a` }}>
                          <PatternIcon title={sec.title} />
                        </span>
                        <span className="acc-head-text">
                          <span className="pickers-section-title">
                            <span className="pickers-section-title-text">{sec.title}</span>
                            <HelpTip text={getHeaderHelp(sec.title)} />
                          </span>
                          <span className="acc-count">{typeof sec.foundCount === "number" ? sec.foundCount : items.length} matches</span>
                        </span>
                      </span>
                      <span className="acc-chevron">▶</span>
                    </button>

                    {isOpen ? (
                      <div className="acc-body">
                        <div>
                          {visibleItems.map((it) => {
                            const rowKey = `${sec.title}::${it.symbol}`;
                            const href = buildPickHref(sec.title, it);
                            const linkLabel = isEarnings ? "Earnings →" : "Chart ↗";
                            return (
                              <div
                                key={it.symbol}
                                className={highlightRowKey === rowKey ? "picker-row rowHighlight" : "picker-row"}
                                ref={(el) => { if (el) rowRefs.current.set(rowKey, el); }}
                              >
                                <div className="picker-row-left">
                                  <span style={{ width: 6, height: 6, borderRadius: 999, background: toneDot(it.tone), flex: "0 0 auto" }} />
                                  <a href={href} style={{ textDecoration: "none", minWidth: 0, flex: 1, overflow: "hidden" }}>
                                    <PickerRowContent symbol={it.symbol} note={it.note} companyName={companyNames.get(it.symbol)} />
                                  </a>
                                </div>
                                <a href={href} className="picker-row-link">{linkLabel}</a>
                              </div>
                            );
                          })}
                        </div>

                        {(isEarnings || seeAllHref) ? (
                          <div className="pickers-section-footer">
                            <div className="pickers-section-footer-left">
                              {isEarnings ? (
                                <>
                                  <button type="button" className="pickers-earnings-fetch-button" onClick={handleFetchEarnings} disabled={earningsFetchBusy || earningsFetchRemainingSeconds > 0} style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(34,197,94,0.24)", background: "rgba(34,197,94,0.06)", color: "rgba(134,239,172,0.80)", fontSize: 11, fontWeight: 600, cursor: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? "not-allowed" : "pointer", opacity: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? 0.65 : 1, whiteSpace: "nowrap", flex: "0 0 auto" }}>
                                    {earningsFetchBusy ? "Fetching…" : earningsFetchRemainingSeconds > 0 ? `Fetch (${earningsFetchRemainingSeconds}s)` : "Fetch Earnings"}
                                  </button>
                                  {earningsFetchMessage ? <span style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.4, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{earningsFetchMessage}</span> : null}
                                </>
                              ) : null}
                            </div>
                            {seeAllHref ? <a href={seeAllHref} className="pickers-see-all">See all →</a> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <aside className="pickers-sidebar">
              <div className="pickers-side-panel">
                <div className="pickers-side-panel-head">Top Picks</div>
                <p className="pickers-side-panel-sub">Stocks showing up on the most lists right now — worth a closer look.</p>
                {topPicks.length ? topPicks.map((p) => (
                  <div key={p.symbol} className="toppick-row" onClick={() => focusPick(p.titles[0], p.symbol)}>
                    <span className="toppick-badge">{p.count}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="sym" style={{ display: "block" }}>{p.symbol}</span>
                      <span className="toppick-cats">{p.titles.slice(0, 2).join(", ")}</span>
                    </span>
                  </div>
                )) : <div className="pickers-side-empty">Not enough overlap between lists yet.</div>}
              </div>

              <div className="pickers-side-panel">
                <div className="pickers-side-panel-head">From the Insights blog</div>
                {latestInsights.length ? latestInsights.map((post) => (
                  <Link key={post.slug} href={`/insights/${post.slug}`} className="insight-row">
                    {post.symbol ? <span className="insight-tag">{post.symbol}</span> : null}
                    <div className="insight-title">{post.title}</div>
                    <div className="insight-meta">{new Date(post.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
                  </Link>
                )) : <div className="pickers-side-empty">No recent posts yet.</div>}
                <Link href="/insights" className="pickers-side-footer-link">More reads →</Link>
              </div>
            </aside>
          </div>
        )}

        {!loading && !err && SHOW_FORCE_FETCH_BUTTON ? (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
            <button type="button" onClick={() => { void loadPickers(true); }} disabled={forceRefreshing} style={{ minHeight: 38, padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: forceRefreshing ? "wait" : "pointer", border: "1px solid rgba(59,130,246,0.24)", background: "rgba(59,130,246,0.06)", color: "#93c5fd", opacity: forceRefreshing ? 0.70 : 1 }}>
              {forceRefreshing ? "Refreshing…" : "Force Refresh"}
            </button>
          </div>
        ) : null}

        {!loading && !err && (updatedAt || universeSize) ? (
          <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.5, opacity: 0.28, textAlign: "right", userSelect: "none" }}>
            {updatedAt ? <div>{new Date(updatedAt).toLocaleString()}</div> : null}
            {universeSize != null ? <div>Universe: {universeSize}</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
