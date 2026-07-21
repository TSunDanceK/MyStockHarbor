"use client";

import Link from "next/link";
import { useState } from "react";
import { toneDotColor } from "@/lib/pickerFilters";

type TickerMatch = { source: string; title: string; tone?: string; href: string };

const SOURCE_LABELS: Record<string, string> = {
  pickers: "Pickers",
  plays: "Ascending Triangles",
  bullFlags: "Bull Flags",
  descendingTriangles: "Descending Triangles",
};

// "Search a ticker across our pickers" -- on-demand only (fires on submit,
// never on keystroke/on mount) so it costs nothing on a normal page view.
// Hits /api/ticker-lookup, which itself only ever reads each builder's
// existing memo/Redis cache in-process -- no rebuilds are ever triggered
// from here. See app/api/ticker-lookup/route.ts for the full reasoning.
//
// Split out of ScreenerNav.tsx so the same fetch/state logic can back two
// different layouts:
//   - "block" (default): the labelled group used inside ScreenerNav's
//     mobile "Select Screener" overlay -- unchanged from before.
//   - "inline": a compact single-row version rendered on the right side of
//     the results header on desktop (see PickerResultsGrid.tsx), with
//     results dropping into a small floating panel instead of pushing the
//     header layout around. Hides itself under 980px so it never doubles
//     up with the "block" version already living in the mobile overlay.
export function TickerSearch({ variant = "block" }: { variant?: "block" | "inline" }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; matches: TickerMatch[] } | null>(null);

  async function runSearch() {
    const symbol = value.trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ticker-lookup?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      setResult({ symbol, matches: Array.isArray(data.matches) ? data.matches : [] });
    } catch {
      setError("Search failed -- please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const resultsList = result ? (
    result.matches.length ? (
      <>
        <div className="screenerSearchNote">
          <b>{result.symbol}</b> qualifies for {result.matches.length} {result.matches.length === 1 ? "list" : "lists"}:
        </div>
        {result.matches.map((match) => (
          <Link key={`${match.source}-${match.title}`} href={match.href} className="screenerSearchChip" prefetch={false}>
            <span className="screenerFilterDot" style={{ background: toneDotColor(match.tone) }} aria-hidden="true" />
            {match.title}
            <span className="screenerSearchSource">{SOURCE_LABELS[match.source] ?? match.source}</span>
          </Link>
        ))}
      </>
    ) : (
      <div className="screenerSearchNote">No current picker lists match &ldquo;{result.symbol}&rdquo;.</div>
    )
  ) : null;

  if (variant === "inline") {
    return (
      <div className="tickerSearchInline">
        <div className="tickerSearchInlineRow">
          <span className="tickerSearchInlineLabel">Search a ticker</span>
          <input
            type="text"
            className="tickerSearchInlineInput"
            placeholder="e.g. AAPL"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
          />
          <button type="button" className="tickerSearchInlineBtn" onClick={runSearch} disabled={loading || !value.trim()}>
            {loading ? "…" : "Search"}
          </button>
        </div>
        {error ? <div className="tickerSearchInlineResults screenerSearchNote">{error}</div> : null}
        {resultsList ? <div className="tickerSearchInlineResults screenerSearchResults">{resultsList}</div> : null}
        <style>{`
          .tickerSearchInline { position: relative; }
          .tickerSearchInlineRow { display: flex; align-items: center; gap: 8px; }
          .tickerSearchInlineLabel { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(148,163,184,0.75); white-space: nowrap; }
          .tickerSearchInlineInput { width: 130px; padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.03); color: #f1f5f9; font-size: 12.5px; font-weight: 700; }
          .tickerSearchInlineInput:focus { outline: none; border-color: rgba(96,165,250,0.55); }
          .tickerSearchInlineBtn { padding: 8px 14px; border-radius: 9px; border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.14); color: #dbeafe; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
          .tickerSearchInlineBtn:disabled { opacity: 0.5; cursor: default; }
          .tickerSearchInlineResults {
            position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
            width: 280px; max-width: 80vw; padding: 12px; border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.12); background: #0b1220;
            box-shadow: 0 18px 40px rgba(0,0,0,0.4);
            display: grid; gap: 6px;
          }
          @media (max-width: 980px) {
            .tickerSearchInline { display: none; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="screenerNavGroup screenerSearchGroup">
      <div className="screenerNavHeading" style={{ color: "#93c5fd" }}>
        Search a ticker
      </div>
      <div className="screenerSearchRow">
        <input
          type="text"
          className="screenerSearchInput"
          placeholder="e.g. AAPL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
        />
        <button type="button" className="screenerSearchBtn" onClick={runSearch} disabled={loading || !value.trim()}>
          {loading ? "…" : "Search"}
        </button>
      </div>
      {error ? <div className="screenerSearchNote">{error}</div> : null}
      {resultsList ? <div className="screenerSearchResults">{resultsList}</div> : null}
    </div>
  );
}
