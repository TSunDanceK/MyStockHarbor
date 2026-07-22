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
            color: colour,
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

const SEE_MORE_BATCH = 36;

// Renders the actual results grid for a single-category picker page
// (/oversold-stocks-today, /plays/bull-flags-adjacent screener pages,
// etc.), reading the same PickerFilterContext ScreenerNav's checkboxes
// write to (see PickerFilterContext.tsx). `entries` is the FULL matched
// set for this page (no longer truncated server-side to config.maxItems --
// see PickerResultPage.tsx) so both the filter and "See more" pagination
// below work entirely off data already sent down with the page: no
// additional network/API requests for either interaction.
//
// `hideUntilFiltered` is only set on the dedicated /custom-screener page
// (see PickerResultPage.tsx): unlike every other page, that page should
// never show a default "everything" view -- results only appear once the
// visitor has checked at least one condition. Every other page passes this
// as false/omitted and keeps its existing default-show-everything
// behaviour unchanged.
//
// `splitReasonsBySelection` is likewise only set on /custom-screener: with
// 25 checkable conditions a matching card would otherwise show a wall of
// chips, so there we surface only the chips for the checked conditions and
// tuck the rest behind an "Also Qualifies for" pill (see ReasonChips).
export default function PickerResultsGrid({
  entries,
  initialVisibleCount,
  configHref,
  configTitle,
  tone,
  emptyText,
  isEarnings,
  hideUntilFiltered = false,
  splitReasonsBySelection = false,
}: {
  entries: ResultEntry[];
  initialVisibleCount: number;
  configHref: string;
  configTitle: string;
  tone: PickerTone;
  emptyText: string;
  isEarnings: boolean;
  hideUntilFiltered?: boolean;
  splitReasonsBySelection?: boolean;
}) {
  const { selectedFilters, setMatchCount } = usePickerFilter();
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);

  const filteredEntries = useMemo(() => {
    if (!selectedFilters.length) return hideUntilFiltered ? [] : entries;
    return entries.filter((entry) => selectedFilters.every((key) => entry[key] === true));
  }, [entries, selectedFilters, hideUntilFiltered]);

  // Selecting/clearing a filter starts back at the top of the (now
  // differently-sized) result list, same as /pickers' own behaviour.
  useEffect(() => {
    setVisibleCount(initialVisibleCount);
  }, [selectedFilters, initialVisibleCount]);

  // Lets ScreenerNav's FilterChecklist show a live "N matching" count next
  // to the checkboxes without needing its own copy of the data.
  useEffect(() => {
    setMatchCount(selectedFilters.length ? filteredEntries.length : null);
    return () => setMatchCount(null);
  }, [filteredEntries.length, selectedFilters.length, setMatchCount]);

  const shown = filteredEntries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredEntries.length;

  return (
    <section>
      <div className="resultsHeader">
        <div className="resultsHeaderTop">
          <h2>Current screened results</h2>
        </div>
        <p>Each card shows a mini candle preview — select any stock to open its full view.</p>
        {selectedFilters.length ? (
          <p className="filterMatchLine">
            {filteredEntries.length} of {entries.length} match your {selectedFilters.length === 1 ? "filter" : `${selectedFilters.length} filters`}.
          </p>
        ) : null}
      </div>

      {shown.length ? (
        <div className="resultsGrid">
          {shown.map((entry) => {
            const cardHref = isEarnings ? `/stock/${encodeURIComponent(entry.symbol)}/earnings` : entry.chartHref;
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
            onClick={() => setVisibleCount((count) => Math.min(count + SEE_MORE_BATCH, filteredEntries.length))}
          >
            See more ({filteredEntries.length - visibleCount} more)
          </button>
        </div>
      ) : null}
    </section>
  );
}
