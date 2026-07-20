"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MiniPickerCandleChart from "@/app/components/MiniPickerCandleChart";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import { TickerSearch } from "@/app/components/TickerSearchBox";
import type { ResultEntry } from "@/app/components/PickerResultPage";

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

const SEE_MORE_BATCH = 36;

// Renders the actual results grid for a single-category picker page
// (/oversold-stocks-today, /plays/bull-flags-adjacent screener pages,
// etc.), reading the same PickerFilterContext ScreenerNav's checkboxes
// write to (see PickerFilterContext.tsx). `entries` is the FULL matched
// set for this page (no longer truncated server-side to config.maxItems --
// see PickerResultPage.tsx) so both the filter and "See more" pagination
// below work entirely off data already sent down with the page: no
// additional network/API requests for either interaction.
export default function PickerResultsGrid({
  entries,
  initialVisibleCount,
  configHref,
  configTitle,
  tone,
  emptyText,
  isEarnings,
}: {
  entries: ResultEntry[];
  initialVisibleCount: number;
  configHref: string;
  configTitle: string;
  tone: PickerTone;
  emptyText: string;
  isEarnings: boolean;
}) {
  const { selectedFilters, setMatchCount } = usePickerFilter();
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);

  const filteredEntries = useMemo(() => {
    if (!selectedFilters.length) return entries;
    return entries.filter((entry) => selectedFilters.every((key) => entry[key] === true));
  }, [entries, selectedFilters]);

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
          {/* Desktop only -- on mobile the same search box already lives
              in the "Select Screener" overlay (see ScreenerNav.tsx); this
              inline variant hides itself under 980px so it never doubles
              up there. */}
          <TickerSearch variant="inline" />
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
                  <div className="reasonChips">
                    {entry.reasons.map((reason) => (
                      <span key={reason} className="reasonChip" style={{ borderColor: toneBorder(entry.tone), color: toneColour(entry.tone) }}>
                        {reason}
                      </span>
                    ))}
                  </div>
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
          {selectedFilters.length ? "No current results match the filters you've selected." : emptyText}
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
