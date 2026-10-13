"use client";

// THE ANALYSER'S "FILED EARNINGS" TAB (#563 COWORK #160, owner ruling): the
// stock page's Earnings snapshot, rendered unchanged. LatestEarningsCard is
// IMPORTED, not copied: the yearly revenue / net income / net margin chart,
// the latest-quarter EPS, gross margin and operating margin tiles, "See full
// report →" and "About these figures" are A's, exactly as on /stock/SYM.
//
// Fetched only when the tab is open, from /api/dashboard-earnings/SYM (A's
// getSecEarningsSnapshot through lib/server/dashboardEarnings.ts, cached an
// hour). With no snapshot (a fund, no fact set, or not read yet) the tab keeps
// its empty state. Describes the filings; never advises.
//
// RETIRED 7 OCT 2026 (#563 COWORK #160): FiledBars, the custom EPS bars and
// operating-margin line (#154 §6), and the verdict chip above them (the card
// carries its own verdict). Removed; the history is in git (#823).
import { useEffect, useState } from "react";
import Link from "next/link";
import LatestEarningsCard from "@/app/components/LatestEarningsCard";
import type { DashboardEarnings } from "@/lib/filedEarnings";
import { useFiledEarnings } from "@/app/components/useFiledEarnings";

/** One fetch per symbol per visit: switching tabs or symbols back never refetches. */
const SEEN = new Map<string, DashboardEarnings>();

/** What the tab shows for an answer (or none yet). Pure, so the check renders it. */
export function FiledEarningsBody(p: BodyProps) {
  const { symbol, data } = p;
  if (!data?.available) {
    const empty = p.failed || data !== null;
    return (
      <div className="fe" data-filed-earnings={empty ? "empty" : "loading"}>
        {empty ? <p className="dlEmpty" data-filed-empty="">Filed figures not available for {symbol}.</p> : <p className="dlEmpty">Loading the filed figures…</p>}
        {p.hasFiledEarnings ? <Link className="dlMore" href={`/stock/${encodeURIComponent(symbol)}/earnings`} prefetch={false}>Full earnings →</Link> : null}
        <p className="dlFine" data-fine-print="">Filings from SEC EDGAR</p>
      </div>
    );
  }
  return (
    <div className="fe" data-filed-earnings="snapshot">
      <LatestEarningsCard snapshot={data} symbol={symbol} hasFiledEarnings={p.hasFiledEarnings} />
    </div>
  );
}

export default function FiledEarningsChart({ symbol }: { symbol: string }) {
  const { hasFiledEarnings } = useFiledEarnings(); // #552 COWORK #197: earnings link only with a filed set
  // Answers by symbol; state is only set when a fetch settles, never in the effect body.
  const [, setTick] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  useEffect(() => {
    if (SEEN.has(symbol)) return;
    let gone = false;
    fetch(`/api/dashboard-earnings/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DashboardEarnings) => { SEEN.set(symbol, d); if (!gone) setTick((t) => t + 1); })
      .catch(() => { if (!gone) setFailedFor(symbol); });
    return () => { gone = true; };
  }, [symbol]);
  const data = SEEN.get(symbol) ?? null, failed = failedFor === symbol && !data;
  return <FiledEarningsBody symbol={symbol} data={data} failed={failed} hasFiledEarnings={hasFiledEarnings(symbol)} />;
}

// Declared below its use on purpose: the earnings-link scan (check-earnings-link-gate)
// looks for the gate in the lines above each link, and the link's own line must carry it.
type BodyProps = { symbol: string; data: DashboardEarnings | null; failed: boolean; hasFiledEarnings: boolean };

export const FILED_EARNINGS_CSS = `
.fe{display:grid;gap:8px;min-width:0;}
`;
