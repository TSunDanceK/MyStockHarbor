"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import MiniPickerCandleChart from "@/app/components/MiniPickerCandleChart";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import type { ResultEntry } from "@/app/components/PickerResultPage";
import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type AnyFilterKey } from "@/lib/pickerFilters";
import ScreenerFilterBar from "@/app/components/ScreenerFilterBar";
import { valueSatisfies } from "@/lib/screenerFields";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

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

// Reverse lookup from a checkable filter key (the 18 custom-builder
// FilterKeys + the 7 category-membership keys, see lib/pickerFilters.ts) to
// the human label that shows on a card's reason chip.
const LABEL_BY_KEY = new Map<AnyFilterKey, string>([
  ...FILTER_DEFS.map((d) => [d.key, d.label] as const),
  ...CATEGORY_FILTER_DEFS.map((d) => [d.key, d.label] as const),
]);

// Tone per checkable condition, from the same defs. Lets a card's dot follow
// the condition the visitor actually applied rather than the page it happens to
// be sitting on -- see displayTone below.
const TONE_BY_KEY = new Map<AnyFilterKey, PickerTone>([
  ...FILTER_DEFS.map((d) => [d.key, d.tone] as const),
  ...CATEGORY_FILTER_DEFS.map((d) => [d.key, d.tone] as const),
]);

// Which indicator panel (if any) the mini-chart draws beneath the candles.
//
// This is a property of the PAGE, not of the stock. A curated condition page is
// about one indicator, so its cards show that indicator. Anywhere the visitor
// assembles their own list -- the Advanced Screener, the sector pages, Buy/Sell
// Signals, any custom filter combination -- there is no such condition, so the
// cards show plain candles.
//
// The divergence pages are the one exception, and the reason the per-entry
// branch still exists: a divergence card carries its own indicator (RSI on one,
// MACD on the next), and the combined page mixes both, so there the card's own
// text has to choose. Everywhere else reading the card's text was actively
// wrong -- on the Advanced Screener a card picked up an RSI or MACD panel
// purely because one of the ~25 conditions it happened to qualify for mentioned
// that indicator, so two cards side by side drew different panels on a page
// that was about neither.
//
// ORDER IS LOAD-BEARING. These are substring tests against the href, and the
// specific breakout pages have to be checked before the generic one:
// /all-time-high-breakout-stocks and /3-month-high-breakout-stocks both contain
// "breakout" but want their own reference line, not the catch-all.
function chartOverlayForEntry(configHref: string, configTitle: string, entry: ResultEntry) {
  const href = configHref.toLowerCase();
  const perCardIndicator = href.includes("divergence");
  const entryText = perCardIndicator
    ? `${entry.badge ?? ""} ${entry.note} ${entry.reasons?.join(" ") ?? ""}`
    : "";
  const text = `${configTitle} ${entryText}`.toLowerCase();
  if (text.includes("macd")) return "macd" as const;
  if (text.includes("rsi") || href.includes("overbought") || href.includes("oversold")) return "rsi" as const;
  // The two DAILY trend-flip pages draw the Trend Helper (Slow) HMA itself,
  // coloured by confirmed state -- the same line the dashboard's Basic chart
  // draws, and the same signal the page screens on.
  //
  // The data arrives as the section items' `trendSeries`, which PickerResultPage
  // merges onto the record's chartPoints. NOT as enriched chartPoints: takeTop
  // strips section chartPoints, so a line attached to them is discarded before
  // the payload is written -- which is how the first attempt at this shipped a
  // correct-looking diff that rendered nothing.
  //
  // There is no client fallback, so a page routed here without that series
  // draws nothing rather than drawing something wrong.
  //
  // The WEEKLY flip pages are excluded on purpose: their flip is weekly and this
  // line is daily, so it would contradict the flip date in the same row.
  if (href.includes("trend-flip") && !href.includes("weekly")) return "trendHelper" as const;
  if (href.includes("best-trend")) return "trend" as const;
  // The 50-day pages drew bare candles: the chart has always computed ma50 (and
  // falls back to a local SMA when the payload omits it) but only ever drew it
  // under the "trend" overlay, and nothing routed here. Matching the full
  // "50-day-moving-average" rather than "50-day" so a future /...-150-day-...
  // route can't land here by accident.
  if (href.includes("50-day-moving-average") || href.includes("ma50")) return "ma50" as const;
  if (href.includes("200-day") || href.includes("ma200")) return "ma200" as const;
  if (href.includes("all-time-high-breakout")) return "ath" as const;
  if (href.includes("3-month-high")) return "recentHigh" as const;
  if (href.includes("all-time-highs")) return "ath" as const;
  // Generic breakout pages -- /breakout-signal-stocks, /breakout-stocks,
  // /stocks-ready-to-break-out, /stock-screener-for-breakouts. A breakout is
  // defined against the prior high, so that is the line worth drawing; without
  // this they fell through to "none" and showed candles with nothing to break
  // out of. Both spellings, since one route hyphenates "break-out".
  if (href.includes("breakout") || href.includes("break-out")) return "recentHigh" as const;
  return "none" as const;
}

function scoreLabelForEntry(entry: ResultEntry) {
  if (typeof entry.score === "number" && Number.isFinite(entry.score)) return Math.round(entry.score);
  const match = entry.note.match(/(\d+)\s+(?:buy|sell) signal/i);
  if (match) return Number(match[1]);
  return null;
}

// Reason chips for a single card (chart view only). See prior behaviour.
function ReasonChips({
  reasons,
  tone,
  selectedFilters,
  splitBySelection,
  collapseAll = false,
}: {
  reasons: string[];
  tone: PickerTone;
  selectedFilters: AnyFilterKey[];
  splitBySelection: boolean;
  // When true, hide EVERY qualifying pill behind a single "Qualified screeners"
  // dropdown pill (used on the All Stocks screener, where an unfiltered stock
  // can qualify for a dozen conditions and the inline chips get very noisy).
  collapseAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const border = toneBorder(tone);
  const colour = toneColour(tone);

  const selectedLabels = useMemo(() => {
    const set = new Set<string>();
    for (const key of selectedFilters) {
      const label = LABEL_BY_KEY.get(key);
      if (label) set.add(label);
    }
    return set;
  }, [selectedFilters]);

  const { primary, extra } = useMemo(() => {
    if (!splitBySelection || selectedLabels.size === 0) {
      return { primary: reasons, extra: [] as string[] };
    }
    const primaryList: string[] = [];
    const extraList: string[] = [];
    for (const reason of reasons) {
      if (selectedLabels.has(reason)) primaryList.push(reason);
      else extraList.push(reason);
    }
    return { primary: primaryList, extra: extraList };
  }, [reasons, selectedLabels, splitBySelection]);

  const renderChip = (reason: string) => (
    <span key={reason} className="reasonChip" style={{ borderColor: border, color: colour }}>
      {reason}
    </span>
  );

  // Collapsed mode: a single "Qualified screeners" dropdown pill that expands to
  // reveal every qualifying chip. Keeps the All Stocks cards tidy since, with no
  // filter applied, a stock can list a dozen conditions at once.
  if (collapseAll && reasons.length > 0) {
    return (
      <div className="reasonChips">
        <button
          type="button"
          className="reasonChip"
          style={{
            borderColor: border,
            color: "#ffffff",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 900,
            gap: 5,
            background: "rgba(96,165,250,0.12)",
            borderStyle: "dashed",
          }}
          aria-expanded={expanded}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          Qualified screeners ({reasons.length})
          <span aria-hidden="true" style={{ fontSize: 8, lineHeight: 1 }}>{expanded ? "▲" : "▼"}</span>
        </button>
        {expanded ? reasons.map(renderChip) : null}
      </div>
    );
  }

  return (
    <div className="reasonChips">
      {primary.map(renderChip)}
      {expanded ? extra.map(renderChip) : null}
      {extra.length > 0 ? (
        <button
          type="button"
          className="reasonChip"
          style={{
            borderColor: border,
            color: "#ffffff",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 900,
            gap: 5,
            background: "rgba(96,165,250,0.12)",
            borderStyle: "dashed",
          }}
          aria-expanded={expanded}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? "Show less" : `Also Qualifies for (${extra.length})`}
          <span aria-hidden="true" style={{ fontSize: 8, lineHeight: 1 }}>{expanded ? "▲" : "▼"}</span>
        </button>
      ) : null}
    </div>
  );
}

// Page sizes. List view is the default (30/page); chart view paginates tighter
// at 21/page (7 rows of 3) to keep the server-rendered first paint fast. Both
// grow via "Show more" entirely from data already sent down -- no extra API.
const LIST_PAGE_SIZE = 30;
const CHART_PAGE_SIZE = 21;

type ViewMode = "list" | "chart";

// The list view now has data tabs, each with its own column set. Only columns
// for data the site actually pulls are included (per the stockanalysis-style
// spec). General/Performance/Valuation/Dividends/Financials/Analysts.
export type TabKey = "general" | "performance" | "valuation" | "dividends" | "financials" | "analysts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "performance", label: "Performance" },
  { key: "valuation", label: "Valuation" },
  { key: "dividends", label: "Dividends" },
  { key: "financials", label: "Financials" },
  { key: "analysts", label: "Analysts" },
];

// The one number each tab leads with on a phone.
//
// A 9-column table can show every metric at once and let the visitor pick one
// by tapping a header. A phone row has space for exactly one headline figure,
// so each tab needs a defined default -- the metric that tab is *about*. Once
// the visitor sorts by something else, the sorted metric takes over as the
// headline (see headlineColumn below), which is what makes sorting legible:
// sort by Payout Ratio and every row shows its payout ratio.
const DEFAULT_METRIC_BY_TAB: Record<TabKey, string> = {
  general: "price",
  performance: "perf1m",
  valuation: "pe",
  dividends: "dyield",
  financials: "revenue",
  analysts: "ptgt",
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

type DerivedRow = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  ma200: number | null;
};

// Price / % change / volume come from the ~15-min price pool when present
// (attached server-side), falling back to the end-of-day close/volume from
// chartPoints on a pool miss. 200 MA always comes from chartPoints.
function deriveRow(entry: ResultEntry): DerivedRow {
  const pts = Array.isArray(entry.chartPoints) ? entry.chartPoints : [];
  const last = pts.length ? pts[pts.length - 1] : undefined;
  const prev = pts.length > 1 ? pts[pts.length - 2] : undefined;
  const eodClose = last && Number.isFinite(last.close) ? last.close : null;
  const prevClose = prev && Number.isFinite(prev.close) ? prev.close : null;
  const eodChangePct =
    eodClose != null && prevClose != null && prevClose !== 0
      ? ((eodClose - prevClose) / prevClose) * 100
      : null;
  const eodVolume = last && typeof last.volume === "number" && Number.isFinite(last.volume) ? last.volume : null;

  // Zero is treated as MISSING for price and volume, not as data.
  //
  // A listed stock never trades exactly 0 shares in a session and never has a
  // price of exactly 0, so a zero here is the pool reporting "I don't have
  // this" in a numeric field. The old check only asked Number.isFinite, which
  // 0 passes, so the zero won and the end-of-day fallback never ran -- INTC and
  // NVDA were both showing Volume 0 on the screener while every other row had a
  // real figure. Falling through to the chartPoints close/volume gives the last
  // known good value instead of a figure that is not merely stale but wrong.
  //
  // changePct is deliberately NOT guarded this way: a stock genuinely can close
  // unchanged, so 0 there is a real observation rather than a missing one.
  const price =
    typeof entry.price === "number" && Number.isFinite(entry.price) && entry.price > 0
      ? entry.price
      : eodClose;
  const changePct =
    typeof entry.changePct === "number" && Number.isFinite(entry.changePct) ? entry.changePct : eodChangePct;
  const volume =
    typeof entry.volume === "number" && Number.isFinite(entry.volume) && entry.volume > 0
      ? entry.volume
      : eodVolume;
  const ma200 = last && typeof last.ma200 === "number" && Number.isFinite(last.ma200) ? last.ma200 : null;
  return { price, changePct, volume, ma200 };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Resolves a registry field key to the value to test a predicate against.
// Everything in lib/screenerFields.ts is a plain ResultEntry property except
// these three, which are derived (pool quote, falling back to the end-of-day
// close/volume from chartPoints) -- see deriveRow above.
function valueForField(entry: ResultEntry, derived: DerivedRow, field: string): unknown {
  if (field === "price") return derived.price;
  if (field === "changePct") return derived.changePct;
  if (field === "volume") return derived.volume;
  return (entry as unknown as Record<string, unknown>)[field];
}

function fmtCap(v: number | null) {
  if (v == null || !Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return `${v.toFixed(2)}`;
}

function fmtNum(v: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return null;
  return v.toFixed(digits);
}

function fmtVolume(v: number | null) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v).toLocaleString("en-US");
}

const MUTED = <span className="muted">–</span>;

// ── Control-bar icons ────────────────────────────────
//
// The docked bar used text glyphs (▤ ▦ ⇅) and two CSS ::before escapes. Four
// near-identical hatched rectangles is what they render as at 19px on a phone,
// so nothing in the bar was distinguishable from anything else in it. These are
// drawn instead: one shape per job, stroked in currentColor so they inherit the
// item's active/inactive treatment, and sized by CSS rather than the viewBox.
function CtrlIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ctrlIcon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// (The screener item's sliders icon lives in ScreenerNav, which renders it.)

// Candles: what chart view actually shows.
const ICON_CHARTS = (
  <CtrlIcon>
    <path d="M8 4v3M8 15v5M16 4v5M16 17v3" />
    <rect x="5.5" y="7" width="5" height="8" rx="1.2" />
    <rect x="13.5" y="9" width="5" height="8" rx="1.2" />
  </CtrlIcon>
);

// Rows: what list view shows. Deliberately not the same family as the metrics
// table below -- these two sit two slots apart and must not be confusable.
const ICON_LIST = (
  <CtrlIcon>
    <path d="M4.6 6.5h.8M4.6 12h.8M4.6 17.5h.8" />
    <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5" />
  </CtrlIcon>
);

// A table with a header row and columns: the menu swaps which set of figures
// the results carry, and that is the thing it swaps.
const ICON_METRICS = (
  <CtrlIcon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M10 9.5v10M15.5 9.5v10" />
  </CtrlIcon>
);

// Two arrows, opposed. Now that direction is folded into the options this is
// the only place either arrow appears.
const ICON_SORT = (
  <CtrlIcon>
    <path d="M7 4.5v15M7 4.5 4 8M7 4.5 10 8" />
    <path d="M17 19.5v-15M17 19.5 14 16M17 19.5 20 16" />
  </CtrlIcon>
);

// ── cell formatters (return display nodes)
function capCell(v: number | null): ReactNode {
  return fmtCap(v) ?? MUTED;
}
function numCell(v: number | null, digits = 2): ReactNode {
  return fmtNum(v, digits) ?? MUTED;
}
function volCell(v: number | null): ReactNode {
  return fmtVolume(v) ?? MUTED;
}
function moneyCell(v: number | null): ReactNode {
  // signed B/M for revenue / income / FCF
  return fmtCap(v) ?? MUTED;
}
function pctCell(v: number | null): ReactNode {
  if (v == null || !Number.isFinite(v)) return MUTED;
  const up = v >= 0;
  return <span className={up ? "chgUp" : "chgDown"}>{up ? "+" : ""}{v.toFixed(2)}%</span>;
}
function plainPctCell(v: number | null): ReactNode {
  if (v == null || !Number.isFinite(v)) return MUTED;
  return `${v.toFixed(2)}%`;
}
function dollarCell(v: number | null): ReactNode {
  if (v == null || !Number.isFinite(v)) return MUTED;
  return `$${v.toFixed(2)}`;
}
function textCell(v: string | null | undefined): ReactNode {
  return v ? v : MUTED;
}

// Hard character cap on the Company Name cell.
//
// The CSS cap (.listName, max-width + ellipsis) is the visual guarantee, but a
// character cap is what keeps the *table* honest: the widest name in the
// currently-rendered 30 rows sets the column width, so one 133-character entry
// like PAC's used to blow the table out to several screens wide. Re-sorting
// then swapped that row in or out, the name column resized underneath you, and
// every column to its right slid sideways -- which is what made a sort click
// feel like it threw you off the page. Capping the string keeps the column the
// same width no matter which rows are on screen.
//
// The full name is still exposed via title=, so hovering (or a screen reader)
// gets the untruncated text.
const MAX_NAME_CHARS = 40;

function truncateName(name: string, max = MAX_NAME_CHARS) {
  if (name.length <= max) return name;
  // Cut on a word boundary when there is one reasonably near the limit, so we
  // get "Grupo Aeroportuario Del Pacifico…" rather than "…Pacif…".
  const slice = name.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,;:–-]+$/, "")}…`;
}

function forwardPe(e: ResultEntry, d: DerivedRow): number | null {
  const eps = num(e.forwardEps);
  if (d.price == null || eps == null || eps <= 0) return null;
  return d.price / eps;
}
function ptUpside(e: ResultEntry, d: DerivedRow): number | null {
  const tgt = num(e.priceTarget);
  if (d.price == null || d.price <= 0 || tgt == null) return null;
  return ((tgt - d.price) / d.price) * 100;
}

type Col = {
  key: string;
  label: string;
  sortType: "str" | "num";
  cls?: string;
  get: (e: ResultEntry, d: DerivedRow) => string | number | null;
  cell: (e: ResultEntry, d: DerivedRow) => ReactNode;
};

// Compact price line for a phone row.
//
// Deliberately NOT MiniPickerCandleChart: that draws candles, wicks, volume and
// an optional indicator pane, which is the right thing for a 300px card and far
// too much ink for a 54x22 strip beside a company name. This is one <path> and
// no state, so putting one on all 30 rows costs a fraction of what a row of
// mini-candle charts would. The real chart is one tap away in the panel.
const SPARK_W = 54;
const SPARK_H = 22;
const SPARK_MAX_POINTS = 40;

function sparkCloses(entry: ResultEntry): number[] {
  const pts = Array.isArray(entry.chartPoints) ? entry.chartPoints : [];
  const out: number[] = [];
  for (const p of pts.slice(-SPARK_MAX_POINTS)) {
    if (typeof p.close === "number" && Number.isFinite(p.close)) out.push(p.close);
  }
  return out;
}

function Sparkline({ closes, up }: { closes: number[]; up: boolean }) {
  // Two points is the minimum that describes a direction; below that there is
  // nothing to draw and the row simply goes without one rather than showing a
  // flat line that would read as "unchanged".
  if (closes.length < 2) return null;
  let min = closes[0];
  let max = closes[0];
  for (const c of closes) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  // A dead-flat series has nothing to scale against. Guarding with span = 1
  // would put every point at (c - min) / span = 0, i.e. hard along the bottom
  // edge, which reads as a crash rather than as no movement -- so flat is drawn
  // through the middle instead.
  const flat = max === min;
  const span = flat ? 1 : max - min;
  const step = SPARK_W / (closes.length - 1);
  // Inset by half the stroke so the extremes aren't clipped by the viewBox edge.
  const top = 1;
  const usable = SPARK_H - 2;
  const d = closes
    .map((c, i) => {
      const x = (i * step).toFixed(1);
      const y = (flat ? top + usable / 2 : top + usable - ((c - min) / span) * usable).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
  return (
    <svg
      className="mRowSpark"
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={d}
        fill="none"
        stroke={up ? "#22c55e" : "#ef4444"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Renders the results for a picker/screener page. List view (default) is a
// sortable, tabbed table; chart view is the mini candle-chart cards. `entries`
// is the FULL matched set, so filtering / sorting / "Show more" all run off
// data already sent down -- no additional API requests.
export default function PickerResultsGrid({
  entries,
  configHref,
  configTitle,
  tone,
  emptyText,
  isEarnings,
  hideUntilFiltered = false,
  splitReasonsBySelection = false,
  collapseReasons = false,
  defaultTab = "general",
  screenerControl = null,
}: {
  entries: ResultEntry[];
  initialVisibleCount?: number;
  configHref: string;
  configTitle: string;
  tone: PickerTone;
  emptyText: string;
  isEarnings: boolean;
  hideUntilFiltered?: boolean;
  splitReasonsBySelection?: boolean;
  collapseReasons?: boolean;
  // Which column set to open on. "general" everywhere by default, which is the
  // right overview for a page defined by a chart condition -- price, change,
  // industry, volume.
  //
  // A page defined by a fundamental screen should open on the tab holding the
  // metric it screens on. Landing the dividend-growth page on a table with no
  // dividend column in it makes the visitor hunt for the one number the page is
  // about, and several of these metrics (dividend growth, payout ratio, free
  // cash flow) appear on exactly one tab. See defaultTab in PickerResultPage's
  // config.
  defaultTab?: TabKey;
  // The mobile screener trigger, rendered as the first pill in the controls row
  // (see .screenerControls below). Passed in rather than rendered here because
  // it's a ScreenerNav instance and needs the page's currentHref, filter mode
  // and categoryValues, all of which live in PickerResultPage.
  //
  // It used to sit in its own full-width sticky bar between the hero and the
  // results, which meant a phone showed two separate control surfaces -- one
  // for "which screener", one for "how to view it" -- stacked on top of each
  // other. They're one decision, so they're now one row.
  screenerControl?: ReactNode;
}) {
  const { predicates, selectedFilters, setMatchCount, setConditionCounts, isPristine } = usePickerFilter();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);
  const [sort, setSort] = useState<SortState>(null);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);

  // Phone layout swap. The 9-column table needs horizontal scrolling to read a
  // single number, which is a spreadsheet gesture, not an app one -- below this
  // width the same data renders as full-width rows instead (see the mRows
  // branch below).
  //
  // Deliberately state + matchMedia rather than rendering both trees and hiding
  // one with CSS: two copies of every ticker in the DOM is duplicated content
  // on pages that are actively being indexed. Starting false means the server
  // render (and therefore the crawler) always gets the table, which is the
  // text-richer of the two; a phone swaps to rows on hydration.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Rows are the phone's LIST view, not the phone's only view.
  //
  // These briefly replaced chart view entirely on mobile, on the reasoning that
  // a sparkline in each row plus a full chart one tap into the panel left a
  // separate chart *mode* with nothing to offer. That was wrong: the card grid
  // is its own way of reading the market -- pattern after pattern, no figures
  // in the way -- and on the chart-pattern pages that browsing is the point.
  // Removing it took a feature away to save a pill.
  const showMobileRows = viewMode === "list" && isNarrow;

  const pageSize = viewMode === "list" ? LIST_PAGE_SIZE : CHART_PAGE_SIZE;

  // Which mobile rows are expanded to show their full field set. Keyed by
  // symbol; cleared whenever the tab changes, since a panel opened on Dividends
  // is showing fields that no longer exist on Financials.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());

  const cardHrefFor = (entry: ResultEntry) =>
    isEarnings ? `/stock/${encodeURIComponent(entry.symbol)}/earnings` : entry.chartHref;

  // Every entry is stamped with the PAGE's tone server-side (see buildEntries in
  // PickerResultPage.tsx), which is correct right up until the visitor filters
  // to something else. After that it actively misleads: untick Overbought on
  // /overbought-stocks-today, tick Oversold, and you get oversold stocks still
  // wearing the page's red dot. That is a wrong signal, not a cosmetic one.
  //
  // So once the selection has diverged from the page's own preset, the tone
  // follows the applied condition instead. While pristine we deliberately keep
  // entry.tone rather than recomputing it: preset pages built from a section can
  // carry per-item tones (bullish vs bearish on the Divergence page, say) that
  // are more specific than any single condition's tone.
  //
  // null means "leave every entry as it is".
  const displayTone = useMemo<PickerTone | null>(() => {
    if (isPristine) return null;
    if (predicates.length === 1) {
      const only = predicates[0];
      if (only.kind === "flag") return TONE_BY_KEY.get(only.field) ?? "blue";
    }
    // Nothing selected, or a combination with no single condition to speak for
    // it -- neutral rather than borrowing a colour that would imply a direction.
    return "blue";
  }, [isPristine, predicates]);

  const toneFor = (entry: ResultEntry) => displayTone ?? entry.tone;

  // Column sets per tab. Only columns backed by data the site pulls are shown.
  const columnSets = useMemo(() => {
    const symbol: Col = {
      key: "symbol",
      label: "Symbol",
      sortType: "str",
      get: (e) => e.symbol ?? "",
      cell: (e) => {
        const href = isEarnings ? `/stock/${encodeURIComponent(e.symbol)}/earnings` : e.chartHref;
        return (
          <a href={href} className="listSym" onClick={(ev) => ev.stopPropagation()}>
            <span className="dot" style={{ background: toneColour(displayTone ?? e.tone) }} aria-hidden="true" />
            {e.symbol}
          </a>
        );
      },
    };
    const name: Col = {
      key: "name",
      label: "Company Name",
      sortType: "str",
      cls: "colName",
      get: (e) => e.companyName ?? "",
      cell: (e) =>
        e.companyName ? (
          <span className="listName" title={e.companyName}>
            {truncateName(e.companyName)}
          </span>
        ) : (
          MUTED
        ),
    };
    const marketCap: Col = { key: "marketCap", label: "Market Cap", sortType: "num", get: (e) => num(e.marketCap), cell: (e) => capCell(num(e.marketCap)) };
    const price: Col = { key: "price", label: "Stock Price", sortType: "num", get: (_e, d) => d.price, cell: (_e, d) => numCell(d.price) };
    const change: Col = { key: "change", label: "% Change", sortType: "num", get: (_e, d) => d.changePct, cell: (_e, d) => pctCell(d.changePct) };
    // TRUNCATED TO 26, PAIRED WITH .listInd's 150px CAP in PickerResultPage.
    // This was the last column forcing horizontal scroll on the General tab.
    // Both halves are needed: the JS truncation alone does not reclaim width
    // (the span still sizes to its cap), and the cap alone would ellipsize a
    // string the DOM is still carrying in full.
    //
    // `title` and `get` deliberately stay the FULL industry: the tooltip loses
    // nothing, and the column must sort by the real value rather than by the
    // shortened label the reader happens to see.
    const industry: Col = { key: "industry", label: "Industry", sortType: "str", cls: "colInd", get: (e) => e.industry ?? "", cell: (e) => (e.industry ? <span className="listInd" title={e.industry}>{truncateName(e.industry, 26)}</span> : MUTED) };
    const volume: Col = { key: "volume", label: "Volume", sortType: "num", get: (_e, d) => d.volume, cell: (_e, d) => volCell(d.volume) };
    // Which of the six composite checks fired, strongest first.
    //
    // The oversold/overbought screeners select on "2 or more of six", so the
    // existing note ("3 oversold") tells a reader how many fired and never
    // which. That matters most for RSI: /stock/[symbol] says "Overbought" when
    // RSI >= 70 and nothing else, so the same word on the two pages can rest on
    // entirely different evidence. Naming the checks lets a reader see that for
    // themselves instead of inferring it.
    //
    // Sorted as a string on the joined label so the column is orderable like
    // any other; the underlying order is by how far each check passed its own
    // trigger, which is the same order the chart deep-link's dominant indicator
    // is picked from.
    // COUNTS SCREENER MEMBERSHIP, NOT INDICATOR NAMES. `firedIndicators` --
    // what this column read until now -- is the composite's oversold/overbought
    // indicator list, populated only for stocks the composite flagged. On a page
    // like Near 200-Day most rows are neither, so the column sat blank for rows
    // that plainly satisfy the condition the page screens on, and showed
    // "MACD(12,26,9) · MA50" for the few that happened to be overbought too.
    // Both halves were the same column reporting a quantity nobody asked for.
    //
    // `reasons` is the right quantity: getFlagReasons over ALL_REASON_DEFS in
    // PickerResultPage, which is FILTER_DEFS + CATEGORY_FILTER_DEFS -- the same
    // list the Screeners sidebar checkboxes are built from. It is already the
    // card's Score pill and the "N of 30 tracked conditions met" line; the list
    // view was the only place it was missing.
    //
    // A bare number, deliberately: the names are on hover and the column is
    // called Signals, so the digits do not need the word repeating after them.
    // This is also why there is no longer a collapse threshold -- that existed
    // to protect a text rendering that no longer exists.
    const signals: Col = {
      key: "signals",
      label: "Signals",
      sortType: "num",
      cls: "colInd",
      // null, not 0, when nothing matched. The comparator tests `an == null`
      // before applying the sort direction, so nulls sink to the bottom both
      // ways, like every other numeric column. A 0 would ride to the top of an
      // ascending sort while the cell shows a dash.
      //
      // NOT floored to 1. With a filter applied every visible row scores at
      // least 1 by construction, because the applied filter is one of the
      // conditions counted -- but the unfiltered All Stocks view can genuinely
      // match none, and an absence is not a zero.
      get: (e) => e.reasons?.length || null,
      cell: (e) => {
        const reasons = e.reasons ?? [];
        if (!reasons.length) return MUTED;
        return (
          <span className="listInd" title={reasons.join(" · ")}>
            {reasons.length}
          </span>
        );
      },
    };
    const pe: Col = { key: "pe", label: "PE Ratio", sortType: "num", get: (e) => num(e.peRatio), cell: (e) => numCell(num(e.peRatio)) };
    const ma200: Col = { key: "ma200", label: "200 MA", sortType: "num", get: (_e, d) => d.ma200, cell: (_e, d) => numCell(d.ma200) };

    const perf1w: Col = { key: "perf1w", label: "1W", sortType: "num", get: (e) => num(e.perf1w), cell: (e) => pctCell(num(e.perf1w)) };
    const perf1m: Col = { key: "perf1m", label: "1M", sortType: "num", get: (e) => num(e.perf1m), cell: (e) => pctCell(num(e.perf1m)) };
    const perf6m: Col = { key: "perf6m", label: "6M", sortType: "num", get: (e) => num(e.perf6m), cell: (e) => pctCell(num(e.perf6m)) };
    const perfYtd: Col = { key: "perfYtd", label: "YTD", sortType: "num", get: (e) => num(e.perfYtd), cell: (e) => pctCell(num(e.perfYtd)) };
    const perf1y: Col = { key: "perf1y", label: "1Y", sortType: "num", get: (e) => num(e.perf1y), cell: (e) => pctCell(num(e.perf1y)) };

    const ev: Col = { key: "ev", label: "Ent. Value", sortType: "num", get: (e) => num(e.enterpriseValue), cell: (e) => capCell(num(e.enterpriseValue)) };
    const fwdpe: Col = { key: "fwdpe", label: "Forward PE", sortType: "num", get: (e, d) => forwardPe(e, d), cell: (e, d) => numCell(forwardPe(e, d)) };
    const ps: Col = { key: "ps", label: "PS Ratio", sortType: "num", get: (e) => num(e.psRatio), cell: (e) => numCell(num(e.psRatio)) };
    const pb: Col = { key: "pb", label: "PB Ratio", sortType: "num", get: (e) => num(e.pbRatio), cell: (e) => numCell(num(e.pbRatio)) };
    const pfcf: Col = { key: "pfcf", label: "P/FCF", sortType: "num", get: (e) => num(e.pfcfRatio), cell: (e) => numCell(num(e.pfcfRatio)) };

    const dps: Col = { key: "dps", label: "Div ($)", sortType: "num", get: (e) => num(e.divPerShare), cell: (e) => dollarCell(num(e.divPerShare)) };
    const dyield: Col = { key: "dyield", label: "Div Yield", sortType: "num", get: (e) => num(e.divYield), cell: (e) => plainPctCell(num(e.divYield)) };
    const payout: Col = { key: "payout", label: "Payout Ratio", sortType: "num", get: (e) => num(e.payoutRatio), cell: (e) => plainPctCell(num(e.payoutRatio)) };
    const dgrowth: Col = { key: "dgrowth", label: "Div Growth", sortType: "num", get: (e) => num(e.divGrowth), cell: (e) => pctCell(num(e.divGrowth)) };
    const freq: Col = { key: "freq", label: "Payout Freq.", sortType: "str", get: (e) => e.payoutFreq ?? "", cell: (e) => textCell(e.payoutFreq) };

    const revenue: Col = { key: "revenue", label: "Revenue", sortType: "num", get: (e) => num(e.revenue), cell: (e) => moneyCell(num(e.revenue)) };
    const opinc: Col = { key: "opinc", label: "Op. Income", sortType: "num", get: (e) => num(e.operatingIncome), cell: (e) => moneyCell(num(e.operatingIncome)) };
    const netinc: Col = { key: "netinc", label: "Net Income", sortType: "num", get: (e) => num(e.netIncome), cell: (e) => moneyCell(num(e.netIncome)) };
    const fcf: Col = { key: "fcf", label: "FCF", sortType: "num", get: (e) => num(e.freeCashFlow), cell: (e) => moneyCell(num(e.freeCashFlow)) };
    const eps: Col = { key: "eps", label: "EPS", sortType: "num", get: (e) => num(e.epsTtm), cell: (e) => numCell(num(e.epsTtm)) };

    const rating: Col = { key: "rating", label: "Rating", sortType: "str", get: (e) => e.rating ?? "", cell: (e) => textCell(e.rating) };
    const analysts: Col = { key: "analysts", label: "Analysts", sortType: "num", get: (e) => num(e.analystCount), cell: (e) => numCell(num(e.analystCount), 0) };
    const ptgt: Col = { key: "ptgt", label: "Price Target", sortType: "num", get: (e) => num(e.priceTarget), cell: (e) => numCell(num(e.priceTarget)) };
    const ptups: Col = { key: "ptups", label: "PT Upside", sortType: "num", get: (e, d) => ptUpside(e, d), cell: (e, d) => pctCell(ptUpside(e, d)) };

    const sets: Record<TabKey, Col[]> = {
      general: [symbol, name, marketCap, price, change, signals, industry, volume, pe, ma200],
      performance: [symbol, name, marketCap, price, change, perf1w, perf1m, perf6m, perfYtd, perf1y],
      valuation: [symbol, name, marketCap, ev, pe, fwdpe, ps, pb, pfcf],
      dividends: [symbol, name, marketCap, dps, dyield, payout, dgrowth, freq],
      financials: [symbol, name, marketCap, revenue, opinc, netinc, fcf, eps],
      analysts: [symbol, name, marketCap, rating, analysts, price, ptgt, ptups],
    };
    return sets;
    // displayTone is a real dependency: the symbol cell renders the dot, so
    // without it the table keeps the tone it was first built with.
  }, [isEarnings, displayTone]);

  const activeColumns = columnSets[activeTab];

  // Every column a phone row can lead with or sort by -- i.e. everything except
  // the two identity columns, which are already the row's left-hand side.
  const metricColumns = useMemo(
    () => activeColumns.filter((col) => col.key !== "symbol" && col.key !== "name"),
    [activeColumns]
  );

  // The single figure each row leads with. Follows the sort when there is one,
  // so sorting by Payout Ratio makes every row show its payout ratio; otherwise
  // it's the tab's defining metric. Falls back to the first metric column if
  // neither resolves (a tab whose default was renamed, say).
  const headlineColumn = useMemo(() => {
    const wanted = sort && sort.key !== "symbol" && sort.key !== "name" ? sort.key : DEFAULT_METRIC_BY_TAB[activeTab];
    return metricColumns.find((col) => col.key === wanted) ?? metricColumns[0] ?? null;
  }, [sort, activeTab, metricColumns]);

  // The smaller figure under the headline. Usually the day's % change, since
  // that's the context you want next to any other number -- unless the headline
  // IS the change, in which case show the price instead. Tabs carrying neither
  // (Dividends, Financials) simply get no sub-line.
  const subColumn = useMemo(() => {
    if (!headlineColumn) return null;
    const wanted = headlineColumn.key === "change" ? "price" : "change";
    return activeColumns.find((col) => col.key === wanted) ?? null;
  }, [headlineColumn, activeColumns]);

  const derivedByEntry = useMemo(() => {
    const map = new WeakMap<ResultEntry, DerivedRow>();
    for (const entry of entries) map.set(entry, deriveRow(entry));
    return map;
  }, [entries]);

  // One evaluator over the predicate list, replacing the separate condition and
  // sector loops this used to run. Semantics are unchanged: predicates AND with
  // each other, values within a single category predicate OR (see
  // valueSatisfies in lib/screenerFields.ts). The difference is that a numeric
  // filter now needs no new code here at all -- it's just another predicate.
  const filteredEntries = useMemo(() => {
    if (!predicates.length) return hideUntilFiltered ? [] : entries;
    return entries.filter((entry) => {
      const derived = derivedByEntry.get(entry) ?? deriveRow(entry);
      return predicates.every((p) => valueSatisfies(p, valueForField(entry, derived, p.field)));
    });
  }, [entries, predicates, hideUntilFiltered, derivedByEntry]);

  const sortedEntries = useMemo(() => {
    const sortCol = sort ? activeColumns.find((c) => c.key === sort.key) : null;
    if (!sortCol || !sort) return filteredEntries;
    const factor = sort.dir === "asc" ? 1 : -1;
    const copy = filteredEntries.slice();
    copy.sort((a, b) => {
      const da = derivedByEntry.get(a) ?? deriveRow(a);
      const db = derivedByEntry.get(b) ?? deriveRow(b);
      const av = sortCol.get(a, da);
      const bv = sortCol.get(b, db);
      if (sortCol.sortType === "str") {
        const as = (av as string) || "";
        const bs = (bv as string) || "";
        if (!as && !bs) return 0;
        if (!as) return 1;
        if (!bs) return -1;
        return factor * as.localeCompare(bs);
      }
      const an = av as number | null;
      const bn = bv as number | null;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      return factor * (an - bn);
    });
    return copy;
  }, [filteredEntries, sort, activeColumns, derivedByEntry]);

  // Reset the page size when the RESULT SET changes (filters, tab, view), but
  // deliberately NOT when only the sort order changes. Sorting reorders the
  // same rows -- collapsing 300 expanded rows back to 30 shortens the document
  // under the visitor's feet, so the browser scrolls them somewhere else the
  // instant they click a column header. Keeping the count means clicking
  // "Stock Price" re-orders the list and leaves you exactly where you were.
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [predicates, viewMode, pageSize, activeTab]);

  useEffect(() => {
    setMatchCount(predicates.length ? filteredEntries.length : null);
    return () => setMatchCount(null);
  }, [filteredEntries.length, predicates.length, setMatchCount]);

  // How many of the currently shown results also satisfy each checkable
  // condition -- what you would be left with if you ticked it.
  //
  // Counted against filteredEntries, not `entries`, so the numbers compose:
  // predicates AND, so (current results) INTERSECT (this condition) is exactly
  // the set ticking it would produce. A condition already ticked therefore
  // counts every current result, which is correct rather than coincidental.
  //
  // The `predicates.length ?` guard is for hideUntilFiltered pages, where
  // filteredEntries is deliberately empty until something is selected. Counting
  // against that would report 0 for all 25 conditions and paint every one as a
  // dead end on the exact page where the visitor most needs to know where to
  // start.
  //
  // Every checkable key is a flag predicate (valueSatisfies: `value === true`),
  // so this is one boolean read per key per row -- ~25 x 700 at the largest
  // universe, on a set already materialised in memory. No new data and no
  // request.
  const countBase = predicates.length ? filteredEntries : entries;

  const conditionCounts = useMemo(() => {
    const counts: Partial<Record<AnyFilterKey, number>> = {};
    const keys: AnyFilterKey[] = [
      ...FILTER_DEFS.map((d) => d.key),
      ...CATEGORY_FILTER_DEFS.map((d) => d.key),
    ];
    for (const key of keys) counts[key] = 0;
    for (const entry of countBase) {
      const record = entry as unknown as Record<string, unknown>;
      for (const key of keys) {
        if (record[key] === true) counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [countBase]);

  useEffect(() => {
    setConditionCounts(conditionCounts);
    return () => setConditionCounts(null);
  }, [conditionCounts, setConditionCounts]);

  const shown = sortedEntries.slice(0, visibleCount);
  const hasMore = visibleCount < sortedEntries.length;

  // Synced top + bottom horizontal scrollbars (grey /insights style). The top
  // strip mirrors the table's scroll width; scrolling either moves the other.
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  // Where the table was scrolled to, horizontally and vertically, at the moment
  // a column header was clicked. Restored synchronously after the re-sorted
  // rows commit (see the layout effect below) so the header you clicked is
  // still under your cursor rather than somewhere off to the left.
  const restoreScroll = useRef<{ left: number; top: number } | null>(null);

  const onHeaderClick = (key: string, type: "str" | "num") => {
    const wrap = tableWrapRef.current;
    if (wrap) restoreScroll.current = { left: wrap.scrollLeft, top: wrap.scrollTop };
    setSort((current) => {
      if (current && current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: type === "str" ? "asc" : "desc" };
    });
  };

  const onTabChange = (tab: TabKey) => {
    // A tab swap really is a different table -- different columns, different
    // widths -- so there is nothing meaningful to restore. Drop the pending
    // position rather than reapplying it to a layout it doesn't describe.
    restoreScroll.current = null;
    setActiveTab(tab);
    setSort(null);
    // Panels opened on the previous tab describe fields this one doesn't have.
    setExpandedRows(new Set());
  };

  const toggleRow = (symbol: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  useEffect(() => {
    const table = tableWrapRef.current?.querySelector("table");
    setScrollWidth(table ? table.scrollWidth : 0);
  }, [shown, activeColumns, viewMode]);

  // useLayoutEffect, not useEffect: this has to run before the browser paints,
  // otherwise the visitor sees one frame of the table snapped back to the left
  // edge before it jumps back.
  useLayoutEffect(() => {
    const pending = restoreScroll.current;
    if (!pending) return;
    restoreScroll.current = null;
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    wrap.scrollLeft = pending.left;
    wrap.scrollTop = pending.top;
    if (topScrollRef.current) topScrollRef.current.scrollLeft = wrap.scrollLeft;
  }, [sort]);

  const syncFromTop = () => {
    if (tableWrapRef.current && topScrollRef.current) {
      tableWrapRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };
  const syncFromWrap = () => {
    if (tableWrapRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableWrapRef.current.scrollLeft;
    }
  };

  const description =
    viewMode === "chart"
      ? "Each card shows a mini candle preview — select any stock to open its full view."
      : showMobileRows
        ? "Tap any row for its chart, the rest of its figures and where to open it."
        : "Sortable table of the current screened results — click any column header to sort, or a row to open the full view.";

  const sortKey = headlineColumn?.key ?? "";

  // Direction is a property of the chosen sort, not a separate control, so the
  // select carries both and there is no arrow button beside it. When nothing is
  // sorted yet this reports the direction that choosing the headline metric
  // would apply, which is what the old arrow showed too.
  const sortDir: "asc" | "desc" =
    sort && sort.key === sortKey ? sort.dir : headlineColumn?.sortType === "str" ? "asc" : "desc";

  return (
    <section>
      <div className="resultsHeader">
        <div className="resultsHeaderTop">
          <h2>Current screened results</h2>
        </div>
        <p>{description}</p>
        {viewMode === "list" ? (
          <div className="viewTabs" role="tablist" aria-label="Data view">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={`viewTab${activeTab === t.key ? " active" : ""}`}
                onClick={() => onTabChange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
        <ScreenerFilterBar matched={filteredEntries.length} total={entries.length} />
      </div>

      {/* One control row: which screener, which view, which data tab, which
          sort. These four are a single decision about what you're looking at,
          so they sit together rather than in two stacked bars.

          On a phone this is docked to the BOTTOM of the screen rather than
          under the header -- see the media query below for why. On desktop it
          stays exactly where it was, right-aligned above the results, because
          a mouse has no reach problem and the sidebar is already showing the
          screener list. */}
      <div className="screenerControls">
        {screenerControl}
        <button
          type="button"
          className="viewToggle"
          onClick={() => setViewMode((v) => (v === "list" ? "chart" : "list"))}
          aria-label={viewMode === "list" ? "Switch to chart view" : "Switch to list view"}
        >
          {viewMode === "list" ? ICON_CHARTS : ICON_LIST}
          <span className="viewToggleLabel">{viewMode === "list" ? "Charts" : "List"}</span>
        </button>
        <span className="ctrlBreak" aria-hidden="true" />
        {viewMode === "list" ? (
          <span className="tabSelectWrap">
            {ICON_METRICS}
            <span className="ctrlCaption" aria-hidden="true">Metrics</span>
            <select
              className="tabSelect"
              value={activeTab}
              onChange={(e) => onTabChange(e.target.value as TabKey)}
              aria-label="Which figures to show"
            >
              {TABS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </span>
        ) : null}
        {/* Sorting on a phone can't be "tap a column header" -- there are no
            headers once the table is gone, and reaching them meant swiping
            sideways even when there were. So it becomes a visible control,
            and the metric it names is the one every row then leads with. */}
        {showMobileRows && metricColumns.length ? (
          <span className="mSortWrap">
            {ICON_SORT}
            <span className="ctrlCaption" aria-hidden="true">Sort</span>
            {/* Metric and direction in one list. They were two controls, and the
                arrow button was the loser of that arrangement: a 26px target
                wedged into the corner of a quarter-width bar item, showing a
                state ("descending") that means nothing until you already know
                which column it applies to. Spelled out per option there is
                nothing to decode and nothing to cram. */}
            <select
              className="tabSelect"
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                const col = metricColumns.find((c) => c.key === key);
                if (!col) return;
                setSort({ key: col.key, dir: dir === "asc" ? "asc" : "desc" });
              }}
              aria-label="Sort results"
            >
              {metricColumns.flatMap((col) => {
                // Biggest-first for figures, A-Z for names: the order you'd want
                // if you picked that column and said nothing else.
                const dirs = col.sortType === "str" ? (["asc", "desc"] as const) : (["desc", "asc"] as const);
                return dirs.map((dir) => (
                  <option key={`${col.key}:${dir}`} value={`${col.key}:${dir}`}>
                    {col.sortType === "str"
                      ? `${col.label} (${dir === "asc" ? "A to Z" : "Z to A"})`
                      : `${col.label} (${dir === "desc" ? "high to low" : "low to high"})`}
                  </option>
                ));
              })}
            </select>
          </span>
        ) : null}
      </div>

      {shown.length ? (
        showMobileRows ? (
          <div className="mRows">
            {shown.map((entry) => {
              const d = derivedByEntry.get(entry) ?? deriveRow(entry);
              const open = expandedRows.has(entry.symbol);
              // Only the fields this symbol actually has a value for, rather
              // than a column of dashes.
              //
              // Mostly these gaps are REAL, not a warming lag: a company that
              // pays no dividend has no yield, payout ratio or growth figure and
              // never will; an ETF has no income statement; a small name may
              // have no analyst coverage. (Coverage itself is fine -- the
              // warm-stock-data cron cycles all ~755 targets in about five
              // hours against a 26-hour TTL, so every symbol is refreshed
              // several times over before it could expire.) Hence the empty
              // message says N/A rather than promising the number is on its way.
              const panelColumns = metricColumns.filter((col) => {
                const value = col.get(entry, d);
                return value != null && value !== "";
              });
              const closes = sparkCloses(entry);
              // Direction comes from the day's % change where we have it, so
              // the line's colour agrees with the % figure printed beside it.
              // Falling back to first-vs-last close keeps a colour on rows the
              // price pool missed, where the sparkline is the only signal.
              const sparkUp =
                d.changePct != null
                  ? d.changePct >= 0
                  : closes.length > 1
                    ? closes[closes.length - 1] >= closes[0]
                    : true;
              return (
                <div key={`${entry.symbol}-${entry.note}`} id={`picker-${entry.symbol}`} className={open ? "mRow open" : "mRow"}>
                  <div className="mRowTop">
                    {/* The whole collapsed row is one target and it only
                        expands. Nothing here navigates.

                        This was one link filling the row, so the blank space
                        between the name and the price silently threw you onto
                        the dashboard; the intermediate fix left the ticker as a
                        link, which still meant the row had two outcomes
                        depending on which few pixels you hit, and the
                        destructive one was the accident. Leaving the page is
                        now always a deliberate tap on a named button in the
                        panel. */}
                    <button
                      type="button"
                      className="mRowToggle"
                      onClick={() => toggleRow(entry.symbol)}
                      aria-expanded={open}
                      aria-label={open ? `Hide ${entry.symbol} details` : `Show ${entry.symbol} details`}
                    >
                      <span className="mRowId">
                        <span className="dot" style={{ background: toneColour(toneFor(entry)) }} aria-hidden="true" />
                        <span className="mRowSym">{entry.symbol}</span>
                        {entry.companyName ? (
                          <span className="mRowName" title={entry.companyName}>{entry.companyName}</span>
                        ) : null}
                      </span>
                      <Sparkline closes={closes} up={sparkUp} />
                      <span className="mRowFigures">
                        {headlineColumn ? (
                          <>
                            <span className="mRowLabel">{headlineColumn.label}</span>
                            <span className="mRowValue">{headlineColumn.cell(entry, d)}</span>
                          </>
                        ) : null}
                        {subColumn ? <span className="mRowSub">{subColumn.cell(entry, d)}</span> : null}
                      </span>
                      <span className="mRowChev" aria-hidden="true">{open ? "▲" : "▼"}</span>
                    </button>
                  </div>
                  {open ? (
                    <div className="mRowPanel">
                      {/* The full chart, one tap in. Chart view is still there
                          as its own mode -- this is for reading one row without
                          leaving the list. Mounted only while the row is open,
                          so a 30-row list still holds a handful rather than 30. */}
                      {closes.length > 1 ? (
                        <div className="mRowChart">
                          <MiniPickerCandleChart
                            points={entry.chartPoints}
                            tone={displayTone ?? tone}
                            overlay={chartOverlayForEntry(configHref, configTitle, entry)}
                            supportResistanceZone={entry.supportResistanceZone}
                          />
                        </div>
                      ) : null}
                      {panelColumns.length ? (
                        panelColumns.map((col) => (
                          <div key={col.key} className="mRowField">
                            <span className="mRowFieldLabel">{col.label}</span>
                            <span className="mRowFieldValue">{col.cell(entry, d)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="mRowEmpty">{TABS.find((t) => t.key === activeTab)?.label} data: N/A</div>
                      )}
                      {/* Every way off this row, named, inside the panel the
                          visitor deliberately opened -- rather than left
                          implicit in whichever part of the row they happened to
                          tap. On an earnings page the row used to open the
                          earnings view, so that destination leads here rather
                          than disappearing with the link. */}
                      <div className="mRowActions">
                        {isEarnings ? (
                          <Link href={`${entry.stockHref}/earnings`} className="mRowAction">Earnings</Link>
                        ) : null}
                        <Link href={entry.chartHref} className="mRowAction">Chart</Link>
                        <Link href={entry.stockHref} className="mRowAction">Analysis</Link>
                        <Link href={`${entry.stockHref}/news`} className="mRowAction">News</Link>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : viewMode === "list" ? (
          <>
            <div className="listScrollTop msScrollGrey" ref={topScrollRef} onScroll={syncFromTop} aria-hidden="true">
              <div style={{ width: scrollWidth || 1 }} />
            </div>
            <div className="listTableWrap msScrollGrey" ref={tableWrapRef} onScroll={syncFromWrap}>
              <table className="listTable">
                <thead>
                  <tr>
                    {activeColumns.map((col) => {
                      const active = sort?.key === col.key;
                      return (
                        <th
                          key={col.key}
                          className={col.cls}
                          onClick={() => onHeaderClick(col.key, col.sortType)}
                          aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                        >
                          {col.label}
                          {active ? <span className="sortArrow" aria-hidden="true">{sort?.dir === "asc" ? "▲" : "▼"}</span> : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => {
                    const d = derivedByEntry.get(entry) ?? deriveRow(entry);
                    const href = cardHrefFor(entry);
                    return (
                      <tr
                        key={`${entry.symbol}-${entry.note}`}
                        id={`picker-${entry.symbol}`}
                        // THE ROW'S NOTE, ON HOVER, because the table renders it
                        // nowhere else. It matters most on the two daily
                        // trend-flip pages: their note carries the flip date
                        // ("Bullish Trend Helper flip • session of 2026-08-28"),
                        // which used to reach list view through the Signals
                        // column and no longer does now that column is a count.
                        // One attribute rather than a column, since every other
                        // page's note is already implied by the page itself.
                        title={entry.note || undefined}
                        onClick={() => { window.location.href = href; }}
                      >
                        {activeColumns.map((col) => (
                          <td key={col.key} className={col.cls}>{col.cell(entry, d)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="resultsGrid">
            {shown.map((entry) => {
              const cardHref = cardHrefFor(entry);
              const scoreValue = scoreLabelForEntry(entry);
              return (
                <Link key={`${entry.symbol}-${entry.note}`} id={`picker-${entry.symbol}`} href={cardHref} className="resultCard">
                  <div className="resultCardTop">
                    <div className="resultCardHead">
                      <div className="symbolLine">
                        <span className="dot" style={{ background: toneColour(toneFor(entry)) }} aria-hidden="true" />
                        <h3>{entry.symbol}</h3>
                        {entry.companyName ? <span className="companyName">{entry.companyName}</span> : null}
                      </div>
                      {entry.badge ? <div className="badge" style={{ marginTop: 8 }}>{entry.badge}</div> : null}
                    </div>
                    {scoreValue != null ? (
                      <div className="scorePill">
                        <strong>{scoreValue}</strong>
                        <span>Score</span>
                      </div>
                    ) : null}
                  </div>
                  {entry.reasons && entry.reasons.length > 0 ? (
                    <ReasonChips
                      reasons={entry.reasons}
                      tone={toneFor(entry)}
                      selectedFilters={selectedFilters}
                      splitBySelection={splitReasonsBySelection}
                      collapseAll={collapseReasons}
                    />
                  ) : null}
                  <MiniPickerCandleChart
                    points={entry.chartPoints}
                    tone={displayTone ?? tone}
                    overlay={chartOverlayForEntry(configHref, configTitle, entry)}
                    supportResistanceZone={entry.supportResistanceZone}
                  />
                  <div className="note">{entry.note}</div>
                </Link>
              );
            })}
          </div>
        )
      ) : (
        <div className="emptyBox">
          {hideUntilFiltered && !predicates.length
            ? "Select at least one condition on the left to see matching stocks."
            : predicates.length
            ? "No current results match the filters you've selected."
            : emptyText}
        </div>
      )}

      {hasMore ? (
        <div className="seeMoreWrap">
          <button
            type="button"
            className="seeMoreBtn"
            onClick={() => setVisibleCount((count) => Math.min(count + pageSize, sortedEntries.length))}
          >
            Show more ({sortedEntries.length - visibleCount} more)
          </button>
        </div>
      ) : null}

      <style>{`
        .screenerControls {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          justify-content: flex-end; margin-top: 14px;
        }
        /* Zero-height full-width flex item -- forces everything after it onto a
           new line. Only active on mobile; on desktop the tab and sort pills are
           hidden anyway (the tab row and column headers do those jobs there), so
           a break would just leave a gap under a lone view-mode button. */
        .ctrlBreak { display: none; }

        .viewToggleLabel { display: inline; }

        /* Sized here rather than on the viewBox so one number moves every icon
           in the bar. 15px on desktop, where it sits beside a label on a pill;
           the docked bar scales it up (see globals.css). */
        .ctrlIcon { width: 15px; height: 15px; flex: 0 0 auto; display: block; }
        /* The static word under each icon in the docked bar. Off everywhere
           else -- desktop shows the select itself, which reads its own value. */
        .ctrlCaption { display: none; }

        .mSortWrap { display: inline-flex; align-items: stretch; gap: 6px; flex: 0 0 auto; }

        .mRows { margin-top: 12px; display: grid; gap: 8px; }
        .mRow {
          border: 1px solid rgba(255,255,255,0.09); border-radius: 14px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          overflow: hidden;
        }
        .mRow.open { border-color: rgba(96,165,250,0.4); }
        .mRowTop { display: flex; }
        /* The entire collapsed row is the button. */
        .mRowToggle {
          flex: 1 1 auto; display: flex; width: 100%; align-items: center; gap: 10px;
          padding: 11px 12px; border: none; background: none;
          font-family: inherit; color: inherit; cursor: pointer; text-align: left;
        }
        .mRowToggle:active { background: rgba(255,255,255,0.03); }
        .mRowId { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
        .mRowId .dot { width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto; }
        .mRowSym { flex: 0 0 auto; font-size: 15px; font-weight: 950; letter-spacing: -0.02em; color: #eaf2ff; }
        .mRowName {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 12px; font-weight: 700; color: rgba(148,163,184,0.9);
        }
        .mRowSpark { flex: 0 0 auto; display: block; width: 54px; height: 22px; opacity: 0.9; }
        .mRowFigures { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; text-align: right; }
        .mRowLabel { font-size: 9px; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(148,163,184,0.62); }
        .mRowValue { font-size: 14.5px; font-weight: 900; color: #f1f5f9; white-space: nowrap; }
        .mRowSub { font-size: 11.5px; font-weight: 800; white-space: nowrap; }
        .mRowChev { flex: 0 0 auto; font-size: 10px; color: rgba(226,232,240,0.6); }
        .mRow.open .mRowChev { color: #93c5fd; }

        .mRowPanel {
          border-top: 1px solid rgba(255,255,255,0.08);
          padding: 4px 12px 12px;
          display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px;
        }
        .mRowChart { grid-column: 1 / -1; margin: 8px 0 2px; }
        .mRowField {
          display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
          padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.055); min-width: 0;
        }
        .mRowFieldLabel { font-size: 11px; font-weight: 800; color: rgba(148,163,184,0.8); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mRowFieldValue { flex: 0 0 auto; font-size: 12.5px; font-weight: 800; color: rgba(226,232,240,0.94); white-space: nowrap; }
        .mRowEmpty { grid-column: 1 / -1; padding: 10px 0 4px; font-size: 12px; color: rgba(148,163,184,0.75); }

        /* Wraps rather than a fixed row: earnings pages carry a fourth button,
           and four labels across a 390px screen leave each about 85px, which
           "Earnings" plus its padding does not fit without shrinking the type
           below a comfortable tap target. flex-basis 40% gives 3-up on one line
           and 2x2 on four. */
        .mRowActions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .mRowAction {
          flex: 1 1 40%; display: inline-flex; align-items: center; justify-content: center;
          padding: 10px 6px; border-radius: 10px;
          border: 1px solid rgba(96,165,250,0.32); background: rgba(59,130,246,0.10);
          color: #dbeafe; font-size: 12.5px; font-weight: 850; text-decoration: none; white-space: nowrap;
        }
        .mRowAction:active { background: rgba(59,130,246,0.2); }

        @media (max-width: 980px) {
          /* Docked to the BOTTOM of the screen rather than under the header.
             Three reasons, in order of how much they matter:

             1. Reach. These are the four controls a visitor actually presses
                on this page, and the top of a 6.7" screen is where a thumb
                cannot go without shifting grip. The list is what you read; the
                controls are what you press. They were the wrong way up.
             2. Height. Under the header they stacked with it -- 62px of header
                plus ~110px of controls before a single result. At the bottom
                they stop competing for the same strip, and going to one row
                halves what they cost either way.
             3. They stay put. A control docked at the bottom does not need to
                hide on scroll to earn its space, which is why the scroll
                machinery came back out.

             z-index 55 keeps it under the screener sheet (70) and the site
             header (100). While the sheet is open its own Go button owns the
             bottom of the screen, and this belongs behind it. */
          .screenerControls {
            position: fixed; left: 0; right: 0; bottom: 0; top: auto;
            z-index: 55;
            justify-content: center;
            flex-wrap: nowrap;
            gap: 6px;
            margin: 0; padding: 9px 10px calc(9px + env(safe-area-inset-bottom));
            border-top: 1px solid rgba(255,255,255,0.10);
            /* Opaque. A translucent bar over a dense column of figures reads
               as smeared rather than as depth. */
            background: #080b12;
          }
          /* Reserves the bar's height at the foot of the document, so the last
             row of a list and the "Show more" button are not sitting
             underneath it. Without this it is not docked, it is covering
             something. */
          body { padding-bottom: calc(56px + env(safe-area-inset-bottom)); }

          /* One row, so the line break that used to force tab and sort onto a
             second line is off again. */
          .ctrlBreak { display: none; }

          /* Four controls across ~370px of usable width. The screener name is
             the elastic one -- it is the only label that varies in length --
             so it gives up width first and ellipses, while the three fixed
             controls keep their full targets. */
          .screenerControls .screenerPillBtn {
            max-width: 38vw; padding: 9px 12px; gap: 5px;
          }
          .screenerControls .viewToggle { flex: 0 0 auto; }
          .mSortWrap { min-width: 0; }
        }
        @media (max-width: 430px) {
          /* Two columns of label+value stops fitting once the labels are this
             long ("Payout Ratio", "Op. Income") -- one column keeps every value
             on the same line as its own label. */
          .mRowPanel { grid-template-columns: minmax(0, 1fr); }
          .mRowName { font-size: 11.5px; }
          /* The sparkline gives up 10px before the company name does -- the
             name is the thing you read, the line is the thing you glance at. */
          .mRowSpark { width: 44px; }
        }
      `}</style>
    </section>
  );
}
