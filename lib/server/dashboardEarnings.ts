// THE ANALYSER'S "FILED EARNINGS" TAB (#563 COWORK #160): the stock page's own
// Earnings snapshot for the dashboard's selected symbol.
//
// ONE READER, NOT TWO. The tab used to draw its own EPS / operating-margin chart
// from a cut-down earnings view (#154 §6), and on TSLA it disagreed with the
// stock page's snapshot for the same quarter. The owner ruled the tab shows the
// stock page's snapshot as it is, so this returns A's getSecEarningsSnapshot
// unchanged and the tab renders A's LatestEarningsCard with it.
//
// COST: the snapshot's own reads (the fact set: ONE Redis GET, never an SEC
// call; the report dates), cached in the Data Cache for an hour per symbol, and
// the route adds a CDN window on top. Route-only: the page never calls this.
import { unstable_cache } from "next/cache";
import { getSecEarningsSnapshot } from "@/lib/server/secEarningsSnapshot";
import { cleanSymbol } from "@/lib/symbol";
import type { DashboardEarnings } from "@/lib/filedEarnings";
export type { DashboardEarnings };

/** No settled answer yet (not read, or the store could not be read): say "not available", cache nothing. */
export class NotSettled extends Error {}

export async function loadDashboardEarnings(raw: string): Promise<DashboardEarnings> {
  const symbol = cleanSymbol(raw);
  if (!symbol) return { symbol, available: false };
  const snapshot = await getSecEarningsSnapshot(symbol);
  // "Not read yet" is also what a failed store read looks like (readFactSet
  // swallows it), so it is never cached: thrown out of unstable_cache and
  // answered uncached by the route. Every other answer is settled.
  if (snapshot.awaitingRead) throw new NotSettled();
  return snapshot;
}

/** An hour per symbol: a new filing reaches the tab within the hour, as the stock page's own window does. */
export const getDashboardEarnings = unstable_cache(loadDashboardEarnings, ["dashboard-earnings-snapshot-v1"], { revalidate: 3600, tags: ["dashboard-earnings"] });

// RETIRED 7 OCT 2026 (#563 COWORK #160): FILED_PERIODS and the per-quarter
// EPS / operating-margin series built from buildSecEarningsView and
// buildGrowthVisuals for the custom chart. Removed with the chart; the history
// is in git (#823).
