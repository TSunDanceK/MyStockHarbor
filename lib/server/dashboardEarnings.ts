// THE ANALYSER'S "FILED EARNINGS" TAB (#563 COWORK #154 §6): the newest 8
// filed quarters' diluted EPS (bars) and operating margin (a line), for the
// dashboard's selected symbol.
//
// NOTHING HERE IS A NEW READING OF THE FILINGS. It is A's earnings page, cut
// down: the same stored fact set (resolveFactSetForRender: the CIK and security
// gates, then ONE Redis GET, never an SEC call), the same view
// (buildSecEarningsView: split-adjusted per-share figures, the non-USD
// refusal, the quarter-or-year anchor), and the same margin rule
// (buildGrowthVisuals' operating margin, which already refuses a margin it
// cannot stand behind). A period with no filed diluted EPS is left out, never
// drawn as zero.
//
// COST: one GET per symbol, cached in the Data Cache for an hour per symbol
// (getDashboardEarnings), and the route adds a CDN window on top. Route-only:
// the page never calls this (scripts/check-page-read-cache.mjs).
import { unstable_cache } from "next/cache";
import { cikForSymbol, resolveFactSetForRender } from "@/lib/server/secColdFetch";
import { buildSecEarningsView } from "@/lib/server/secEarningsView";
import { annualOnlyForm } from "@/lib/server/annualOnly";
import { registrantFor } from "@/lib/server/stockProfile";
import { buildGrowthVisuals } from "@/lib/growthVisuals";
import { cleanSymbol } from "@/lib/symbol";
import type { DashboardEarnings, FiledPeriod } from "@/lib/filedEarnings";
export type { DashboardEarnings, FiledPeriod };

/** How many filed periods the tab draws, newest last. */
export const FILED_PERIODS = 8;

/** No settled answer yet (not read, or the store could not be read): say "not available", cache nothing. */
export class NotSettled extends Error {}

const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;

export async function loadDashboardEarnings(raw: string): Promise<DashboardEarnings> {
  const symbol = cleanSymbol(raw);
  const none: DashboardEarnings = { symbol, available: false };
  if (!symbol) return none;
  const cold = await resolveFactSetForRender(symbol);
  // "Not read yet" is also what a failed store read looks like (readFactSet
  // swallows it), so it is never cached: thrown out of unstable_cache and
  // answered uncached by the route. Every other status is a settled answer.
  if (cold.status === "pending") throw new NotSettled();
  if (cold.status !== "ready") return none;
  const annualForm = annualOnlyForm(registrantFor(symbol)?.annualForm, cold.set, new Date().toISOString().slice(0, 10));
  const view = buildSecEarningsView(cold.set, { annualForm, cik: cikForSymbol(symbol) });
  if (!view) return none;
  const series = buildGrowthVisuals(view, { oneOffs: view.oneOffs, unchecked: view.oneOffUnchecked }).quarters;
  const opOf = new Map((series?.periods ?? []).map((p) => [p.label, p]));
  // recentPeriods is newest first; the chart reads oldest → newest.
  const periods: FiledPeriod[] = view.recentPeriods
    .filter((p) => typeof p.epsDiluted.val === "number" && Number.isFinite(p.epsDiluted.val))
    .slice(0, FILED_PERIODS)
    .reverse()
    .map((p) => {
      const g = opOf.get(p.label);
      return { label: p.label, short: g?.short ?? p.label, eps: p.epsDiluted.val as number, epsText: money(p.epsDiluted.val as number), opPct: g?.opPct ?? null, opText: g?.opText ?? null };
    });
  return periods.length ? { symbol, available: true, many: series?.many ?? "quarters", periods } : none;
}

/** An hour per symbol: a new filing reaches the tab within the hour, as the earnings page's own cache does. */
export const getDashboardEarnings = unstable_cache(loadDashboardEarnings, ["dashboard-earnings-v1"], { revalidate: 3600, tags: ["dashboard-earnings"] });
