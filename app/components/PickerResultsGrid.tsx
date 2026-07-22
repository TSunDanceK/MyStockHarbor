"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MiniPickerCandleChart from "@/app/components/MiniPickerCandleChart";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import type { ResultEntry } from "@/app/components/PickerResultPage";
import { FILTER_DEFS, CATEGORY_FILTER_DEFS, type AnyFilterKey } from "@/lib/pickerFilters";

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
// the human label that shows on a card's reason chip. Reason chips carry
// only their label string (see PickerResultPage's getFlagReasons), so this
// is how the custom-screener page decides which chips correspond to the
// conditions the visitor actually checked vs the ones the stock merely
// "also qualifies for". Labels are unique across both def lists.
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

// Reason chips for a single card. On most pages every chip shows at once
// (splitBySelection=false). On the /custom-screener page it's set true:
// only the chips matching the conditions the visitor checked stay visible,
// and every other condition the stock qualifies for collapses behind an
// "Also Qualifies for" pill that expands them on click. Because the card is
// itself a <Link>, the pill button stops the click from navigating.
function ReasonChips({
  reasons,
  tone,
  selectedFilters,
  splitBySelection,
}: {
  reasons: string[];
  tone: PickerTone;
  selectedFilters: AnyFilterKey[];
  splitBySelection: boolean;
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

// Page sizes. List view is the new default (30/page); chart view is heavier
// to render (a mini SVG candle chart per card) so it paginates tighter at
// 21/page to keep the server-rendered first paint fast -- 21 = 7 full rows
// of 3 cards, so the grid stays symmetrical with no half-empty last row.
// Both grow via the "Show more" button entirely from data already sent down
// with the page -- no extra network/API requests for pagination.
const LIST_PAGE_SIZE = 30;
const CHART_PAGE_SIZE = 21;

type ViewMode = "list" | "chart";

type SortKey =
  | "symbol"
  | "name"
  | "marketCap"
  | "price"
  | "change"
  | "industry"
  | "volume"
  | "pe"
  | "ma200";

type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

type DerivedRow = {
  price: number | null;
  changePct: number | null;
  volume: number | null;
  ma200: number | null;
};

// Everything the list view's Price / % Change / Volume / 200 MA columns
// need is already present in each entry's chartPoints (the same array the
// mini candle chart draws), so those four columns cost zero extra data:
// last close = price, last-vs-previous close = % change, last volume, last
// ma200. Market cap / PE / industry come from the cron-warmed fundamentals
// attached server-side (see PickerResultPage.getPickerData).
function deriveRow(entry: ResultEntry): DerivedRow {
  const pts = Array.isArray(entry.chartPoints) ? entry.chartPoints : [];
  const last = pts.length ? pts[pts.length - 1] : undefined;
  const prev = pts.length > 1 ? pts[pts.length - 2] : undefined;
  const price = last && Number.isFinite(last.close) ? last.close : null;
  const prevClose = prev && Number.isFinite(prev.close) ? prev.close : null;
  const changePct =
    price != null && prevClose != null && prevClose !== 0
      ? ((price - prevClose) / prevClose) * 100
      : null;
  const volume = last && typeof last.volume === "number" && Number.isFinite(last.volume) ? last.volume : null;
  const ma200 = last && typeof last.ma200 === "number" && Number.isFinite(last.ma200) ? last.ma200 : null;
  return { price, changePct, volume, ma200 };
}

const COLUMNS: Array<{ key: SortKey; label: string; type: "str" | "num"; cls?: string }> = [
  { key: "symbol", label: "Symbol", type: "str" },
  { key: "name", label: "Company Name", type: "str", cls: "colName" },
  { key: "marketCap", label: "Market Cap", type: "num" },
  { key: "price", label: "Stock Price", type: "num" },
  { key: "change", label: "% Change", type: "num" },
  { key: "industry", label: "Industry", type: "str", cls: "colInd" },
  { key: "volume", label: "Volume", type: "num" },
  { key: "pe", label: "PE Ratio", type: "num" },
  { key: "ma200", label: "200 MA", type: "num" },
];

function fmtCap(v: number | null) {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return `${v}`;
}

function fmtNum(v: number | null, digits = 2) {
  if (v == null) return null;
  return v.toFixed(digits);
}

function fmtVolume(v: number | null) {
  if (v == null) return null;
  return Math.round(v).toLocaleString("en-US");
}

const MUTED = <span className="muted">–</span>;

// Renders the results for a single-category picker page (or the custom
// screener). Two view modes share the same filtered/paginated data set:
//   * list  (default) -- a sortable table with the columns Symbol, Company,
//     Market Cap, Price, % Change, Industry, Volume, PE, 200 MA
//   * chart (opt-in via the "Chart View Mode" toggle) -- the original mini
//     candle-chart cards
// `entries` is the FULL matched set for this page, so filtering, sorting and
// "See more" pagination all run entirely off data already sent down with the
// page: no additional network/API requests for any of them.
//
// `hideUntilFiltered` (only the /custom-screener page): results only appear
// once at least one condition is checked. `splitReasonsBySelection` (also
// only custom-screener, chart view): collapse non-selected reason chips
// behind an "Also Qualifies for" pill.
export default function PickerResultsGrid({
  entries,
  configHref,
  configTitle,
  tone,
  emptyText,
  isEarnings,
  hideUntilFiltered = false,
  splitReasonsBySelection = false,
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
}) {
  const { selectedFilters, setMatchCount } = usePickerFilter();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sort, setSort] = useState<SortState>(null);
  const pageSize = viewMode === "list" ? LIST_PAGE_SIZE : CHART_PAGE_SIZE;
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);

  const filteredEntries = useMemo(() => {
    if (!selectedFilters.length) return hideUntilFiltered ? [] : entries;
    return entries.filter((entry) => selectedFilters.every((key) => entry[key] === true));
  }, [entries, selectedFilters, hideUntilFiltered]);

  // Precompute the price/%change/volume/200MA once per entry (not per sort or
  // per render of a row), keyed by the entry object itself.
  const derivedByEntry = useMemo(() => {
    const map = new WeakMap<ResultEntry, DerivedRow>();
    for (const entry of entries) map.set(entry, deriveRow(entry));
    return map;
  }, [entries]);

  const sortedEntries = useMemo(() => {
    if (!sort) return filteredEntries;
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;

    const strVal = (e: ResultEntry): string => {
      if (key === "symbol") return e.symbol ?? "";
      if (key === "name") return e.companyName ?? "";
      if (key === "industry") return e.industry ?? "";
      return "";
    };
    const numVal = (e: ResultEntry): number | null => {
      const d = derivedByEntry.get(e);
      if (key === "marketCap") return e.marketCap ?? null;
      if (key === "price") return d?.price ?? null;
      if (key === "change") return d?.changePct ?? null;
      if (key === "volume") return d?.volume ?? null;
      if (key === "pe") return e.peRatio ?? null;
      if (key === "ma200") return d?.ma200 ?? null;
      return null;
    };

    const isStr = key === "symbol" || key === "name" || key === "industry";
    const copy = filteredEntries.slice();
    copy.sort((a, b) => {
      if (isStr) {
        const av = strVal(a);
        const bv = strVal(b);
        // Empty strings always sink to the bottom regardless of direction.
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return factor * av.localeCompare(bv);
      }
      const av = numVal(a);
      const bv = numVal(b);
      // Missing numbers always sink to the bottom regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return factor * (av - bv);
    });
    return copy;
  }, [filteredEntries, sort, derivedByEntry]);

  // Reset back to the top of the list whenever the data set or view changes.
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [selectedFilters, sort, viewMode, pageSize]);

  // Lets ScreenerNav's FilterChecklist show a live "N matching" count next
  // to the checkboxes without needing its own copy of the data.
  useEffect(() => {
    setMatchCount(selectedFilters.length ? filteredEntries.length : null);
    return () => setMatchCount(null);
  }, [filteredEntries.length, selectedFilters.length, setMatchCount]);

  const shown = sortedEntries.slice(0, visibleCount);
  const hasMore = visibleCount < sortedEntries.length;

  const onHeaderClick = (key: SortKey, type: "str" | "num") => {
    setSort((current) => {
      if (current && current.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      // Sensible default direction: A->Z for text, largest-first for numbers.
      return { key, dir: type === "str" ? "asc" : "desc" };
    });
  };

  const cardHrefFor = (entry: ResultEntry) =>
    isEarnings ? `/stock/${encodeURIComponent(entry.symbol)}/earnings` : entry.chartHref;

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
        {selectedFilters.length ? (
          <p className="filterMatchLine">
            {filteredEntries.length} of {entries.length} match your {selectedFilters.length === 1 ? "filter" : `${selectedFilters.length} filters`}.
          </p>
        ) : null}
      </div>

      {shown.length ? (
        viewMode === "list" ? (
          <div className="listTableWrap">
            <table className="listTable">
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const active = sort?.key === col.key;
                    return (
                      <th
                        key={col.key}
                        className={col.cls}
                        onClick={() => onHeaderClick(col.key, col.type)}
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
                  const d = derivedByEntry.get(entry);
                  const href = cardHrefFor(entry);
                  const cap = fmtCap(entry.marketCap ?? null);
                  const price = fmtNum(d?.price ?? null);
                  const chg = d?.changePct ?? null;
                  const vol = fmtVolume(d?.volume ?? null);
                  const pe = fmtNum(entry.peRatio ?? null);
                  const ma = fmtNum(d?.ma200 ?? null);
                  return (
                    <tr
                      key={`${entry.symbol}-${entry.note}`}
                      id={`picker-${entry.symbol}`}
                      onClick={() => { window.location.href = href; }}
                    >
                      <td>
                        <a
                          href={href}
                          className="listSym"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="dot" style={{ background: toneColour(entry.tone) }} aria-hidden="true" />
                          {entry.symbol}
                        </a>
                      </td>
                      <td className="colName"><span className="listName">{entry.companyName ?? MUTED}</span></td>
                      <td>{cap ?? MUTED}</td>
                      <td>{price ?? MUTED}</td>
                      <td>
                        {chg == null ? MUTED : (
                          <span className={chg >= 0 ? "chgUp" : "chgDown"}>
                            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="colInd"><span className="listInd">{entry.industry ?? MUTED}</span></td>
                      <td>{vol ?? MUTED}</td>
                      <td>{pe ?? MUTED}</td>
                      <td>{ma ?? MUTED}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
          {hideUntilFiltered && !selectedFilters.length
            ? "Select at least one condition on the left to see matching stocks."
            : selectedFilters.length
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
