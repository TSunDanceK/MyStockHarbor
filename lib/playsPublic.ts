/**
 * ── TIINGO BARS STAY OFF THE PUBLIC PLAYS JSON (#553 COWORK #103, 2026-10-03) ──
 *
 * Contract ruling: Tiingo-derived bars and returns don't go out through public
 * JSON; pages read them in-process.
 *
 * /api/plays, /api/bull-flags and /api/descending-triangles are public and
 * carry CDN cache headers. With the scans on stored Tiingo bars (#689, B4)
 * every item's `chartPoints` (up to 280 daily bars of close/high/low/volume)
 * is Tiingo's, so the routes now answer with the bars removed:
 *
 *   route   publicPlaysPayload(): every item loses `chartPoints`, and the
 *           payload says `chartPointsWithheld: true`. Withheld unless the
 *           payload says it was built from FMP (`history.provider === "fmp"`)
 *           -- fail closed: a payload that does not say where its bars came
 *           from is treated as Tiingo's.
 *   page    app/plays/<page>/page.tsx renders from the in-process builder read
 *           (server props, bars included), exactly as before.
 *   client  after its mount refresh of the route, resolvePlaysRefresh(): a
 *           withheld payload for the scan already on screen changes nothing
 *           (the server props hold its bars); a newer scan is read in-process
 *           through the page's server action (app/plays/playsPagePayload.ts),
 *           never through public JSON.
 *
 * THE CREDIT FOLLOWS THE BARS. playsBarsFromTiingo() is true only when the
 * payload records that the scan read Tiingo's bars (provider "tiingo" and at
 * least one series from the Tiingo tiers), not merely when the flag is on.
 *
 * IMPORTS NOTHING: the three play clients (client components) import it.
 * Checked by scripts/check-fmpoff-plays-perf.mjs.
 */

/** What a plays payload records about where its bars came from (the builders' `history`). */
export type PlaysHistoryInfo =
  | { provider?: string; memory?: number; cache?: number; fmpFallback?: number; missing?: number }
  | null
  | undefined;

/** True only when the scan's bars actually came from Tiingo. */
export function playsBarsFromTiingo(history: PlaysHistoryInfo): boolean {
  if (!history || history.provider !== "tiingo") return false;
  const fromTiingo = Number(history.memory ?? 0) + Number(history.cache ?? 0);
  return Number.isFinite(fromTiingo) && fromTiingo > 0;
}

/** Whether a payload's chart bars must stay off public JSON: any payload not built from FMP. */
export function playsBarsWithheld(history: PlaysHistoryInfo): boolean {
  return history?.provider !== "fmp";
}

type PlaysShape = {
  history?: PlaysHistoryInfo;
  sections?: unknown;
  updatedAt?: unknown;
  chartPointsWithheld?: boolean;
};

function withoutChartPoints(item: unknown): unknown {
  if (!item || typeof item !== "object" || !("chartPoints" in item)) return item;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (k !== "chartPoints") out[k] = v;
  }
  return out;
}

/**
 * The public route's answer: the payload with every item's `chartPoints`
 * removed, unless it was built from FMP. Never mutates its input (it is the
 * builder's shared memo).
 */
export function publicPlaysPayload<T>(data: T): T {
  const d = data as PlaysShape | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.sections)) return data;
  if (!playsBarsWithheld(d.history)) return data;
  const sections = (d.sections as unknown[]).map((section) => {
    if (!section || typeof section !== "object") return section;
    const items = (section as { items?: unknown }).items;
    return Array.isArray(items) ? { ...(section as object), items: items.map(withoutChartPoints) } : section;
  });
  return { ...(d as object), sections, chartPointsWithheld: true } as T;
}

/**
 * What a plays client shows after refreshing from its route. Returns null for
 * "keep what is on screen".
 *
 *   the route kept its bars (FMP)            -> the route's payload
 *   withheld, same scan as the one on screen
 *     with its bars (`shownWithBars`)        -> null (the server props hold them)
 *   withheld, a different scan               -> the page's in-process read, when
 *                                               it has sections and its bars;
 *                                               else the route's payload (the
 *                                               charts then say they are
 *                                               unavailable)
 */
export async function resolvePlaysRefresh<P extends PlaysShape>(
  routeData: P,
  shownWithBars: string | null,
  readInProcess: () => Promise<P | null>
): Promise<P | null> {
  if (!routeData || !routeData.chartPointsWithheld) return routeData;
  if (shownWithBars && routeData.updatedAt === shownWithBars) return null;
  try {
    const full = await readInProcess();
    if (full && Array.isArray(full.sections) && !full.chartPointsWithheld) return full;
  } catch {
    // an in-process read that fails leaves the route's payload, without charts
  }
  return routeData;
}
