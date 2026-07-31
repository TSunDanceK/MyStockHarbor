"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

function chartOverlayForEntry(configHref: string, configTitle: string, entry: ResultEntry) {
  const href = configHref.toLowerCase();
  const text = `${configTitle} ${entry.badge ?? ""} ${entry.note} ${entry.reasons?.join(" ") ?? ""}`.toLowerCase();
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
type TabKey = "general" | "performance" | "valuation" | "dividends" | "financials" | "analysts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "performance", label: "Performance" },
  { key: "valuation", label: "Valuation" },
  { key: "dividends", label: "Dividends" },
  { key: "financials", label: "Financials" },
  { key: "analysts", label: "Analysts" },
];

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
  const price =
    typeof entry.price === "number" && Number.isFinite(entry.price) ? entry.price : eodClose;
  const changePct =
    typeof entry.changePct === "number" && Number.isFinite(entry.changePct) ? entry.changePct : eodChangePct;
  const volume =
    typeof entry.volume === "number" && Number.isFinite(entry.volume) ? entry.volume : eodVolume;
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

// ── cell formatters (return display nodes) ──────────────────────────────────
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
}) {
  const { predicates, selectedFilters, setMatchCount } = usePickerFilter();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [sort, setSort] = useState<SortState>(null);
  const pageSize = viewMode === "list" ? LIST_PAGE_SIZE : CHART_PAGE_SIZE;
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);

  const cardHrefFor = (entry: ResultEntry) =>
    isEarnings ? `/stock/${encodeURIComponent(entry.symbol)}/earnings` : entry.chartHref;

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
            <span className="dot" style={{ background: toneColour(e.tone) }} aria-hidden="true" />
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
      cell: (e) => (e.companyName ? <span className="listName">{e.companyName}</span> : MUTED),
    };
    const marketCap: Col = { key: "marketCap", label: "Market Cap", sortType: "num", get: (e) => num(e.marketCap), cell: (e) => capCell(num(e.marketCap)) };
    const price: Col = { key: "price", label: "Stock Price", sortType: "num", get: (_e, d) => d.price, cell: (_e, d) => numCell(d.price) };
    const change: Col = { key: "change", label: "% Change", sortType: "num", get: (_e, d) => d.changePct, cell: (_e, d) => pctCell(d.changePct) };
    const industry: Col = { key: "industry", label: "Industry", sortType: "str", cls: "colInd", get: (e) => e.industry ?? "", cell: (e) => (e.industry ? <span className="listInd">{e.industry}</span> : MUTED) };
    const volume: Col = { key: "volume", label: "Volume", sortType: "num", get: (_e, d) => d.volume, cell: (_e, d) => volCell(d.volume) };
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
      general: [symbol, name, marketCap, price, change, industry, volume, pe, ma200],
      performance: [symbol, name, marketCap, price, change, perf1w, perf1m, perf6m, perfYtd, perf1y],
      valuation: [symbol, name, marketCap, ev, pe, fwdpe, ps, pb, pfcf],
      dividends: [symbol, name, marketCap, dps, dyield, payout, dgrowth, freq],
      financials: [symbol, name, marketCap, revenue, opinc, netinc, fcf, eps],
      analysts: [symbol, name, marketCap, rating, analysts, price, ptgt, ptups],
    };
    return sets;
  }, [isEarnings]);

  const activeColumns = columnSets[activeTab];

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

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [predicates, sort, viewMode, pageSize, activeTab]);

  useEffect(() => {
    setMatchCount(predicates.length ? filteredEntries.length : null);
    return () => setMatchCount(null);
  }, [filteredEntries.length, predicates.length, setMatchCount]);

  const shown = sortedEntries.slice(0, visibleCount);
  const hasMore = visibleCount < sortedEntries.length;

  const onHeaderClick = (key: string, type: "str" | "num") => {
    setSort((current) => {
      if (current && current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: type === "str" ? "asc" : "desc" };
    });
  };

  const onTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSort(null);
  };

  // Synced top + bottom horizontal scrollbars (grey /insights style). The top
  // strip mirrors the table's scroll width; scrolling either moves the other.
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    const table = tableWrapRef.current?.querySelector("table");
    setScrollWidth(table ? table.scrollWidth : 0);
  }, [shown, activeColumns, viewMode]);

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
    viewMode === "list"
      ? "Sortable table of the current screened results — click any column header to sort, or a row to open the full view."
      : "Each card shows a mini candle preview — select any stock to open its full view.";

  return (
    <section>
      <div className="resultsHeader">
        <div className="resultsHeaderTop">
          <h2>Current screened results</h2>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: "8px 0 0" }}>{description}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
            {viewMode === "list" ? (
              <span className="tabSelectWrap">
                <select
                  className="tabSelect"
                  value={activeTab}
                  onChange={(e) => onTabChange(e.target.value as TabKey)}
                  aria-label="Data view"
                >
                  {TABS.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </span>
            ) : null}
            <button
              type="button"
              className="viewToggle"
              onClick={() => setViewMode((v) => (v === "list" ? "chart" : "list"))}
              aria-label={viewMode === "list" ? "Switch to chart view" : "Switch to list view"}
            >
              {viewMode === "list" ? "Chart View Mode" : "List View Mode"}
              <span aria-hidden="true" style={{ fontSize: 12 }}>{viewMode === "list" ? "▦" : "▤"}</span>
            </button>
          </div>
        </div>
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

      {shown.length ? (
        viewMode === "list" ? (
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
                        <span className="dot" style={{ background: toneColour(entry.tone) }} aria-hidden="true" />
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
                      tone={entry.tone}
                      selectedFilters={selectedFilters}
                      splitBySelection={splitReasonsBySelection}
                      collapseAll={collapseReasons}
                    />
                  ) : null}
                  <MiniPickerCandleChart
                    points={entry.chartPoints}
                    tone={tone}
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
    </section>
  );
}
