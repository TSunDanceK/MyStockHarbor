import { connection } from "next/server";

/**
 * Refuse to persist the CURRENT render as a cached artefact, because the data
 * behind it is degraded.
 *
 * ---------------------------------------------------------------------------
 * The problem this exists for
 * ---------------------------------------------------------------------------
 *
 * `feedCache` made a failed upstream read VISIBLE (a failed read and a
 * genuinely empty market no longer look alike -- see
 * claude/silent-failure-traps.md #1). It did not make it HARMLESS.
 *
 * Under ISR a failed read is baked into the prerendered artefact and served to
 * every visitor and every crawler for the whole revalidate window, with no
 * reload path out of it. A page asserting "we couldn't load the IPO calendar"
 * stops being a blip a refresh fixes and becomes the page, for everyone, until
 * the window expires. Today that is survivable only because these routes are
 * still dynamic and self-heal on reload -- which is the thing that has been
 * blocking them from being cached at all.
 *
 * Calling this on the degraded path fixes that, and does better than the
 * "don't persist the failure" it was asked for: the visitor keeps being served
 * the last known-good HTML, so a failed REVALIDATION is invisible to them
 * rather than merely non-permanent. With no good copy to fall back on it
 * degrades to exactly today's behaviour.
 *
 * Measured against `next start` (Next 16.1.6), upstream toggled mid-run:
 *
 *   without this   req1 STALE/good  req2 HIT/DEGRADED  req3 HIT/DEGRADED
 *   with this      req1 STALE/good  req2 HIT/good      req3 HIT/good
 *
 * ---------------------------------------------------------------------------
 * THE LIMIT -- read before adding a call site
 * ---------------------------------------------------------------------------
 *
 * SAFE ONLY ON PARAMLESS STATIC ROUTES. On a route with `generateStaticParams`
 * this does not degrade gracefully -- it returns a 500. Measured, same probe:
 *
 *   /pbail            (paramless)               -> 200, last known-good HTML
 *   /bailparam/[id]   (generateStaticParams)    -> 500
 *
 * A 500 here would be worse than the problem. `/stock/[symbol]` and friends
 * receive enumerated junk input from something crawling ~1,519 distinct paths,
 * and sustained 5xx makes Google throttle crawl rate SITE-WIDE -- undoing the
 * ISR work this is meant to enable. See the #281 corollary in
 * claude/picker-pages-isr-2026-08-20.md: the tool for a bad artefact on a
 * dynamic segment is 200 + noindex, never a 5xx.
 *
 * So: `/upcoming-ipos` yes. `/stock/[symbol]` never.
 *
 * ---------------------------------------------------------------------------
 * The deploy-window cost
 * ---------------------------------------------------------------------------
 *
 * If the read fails DURING A BUILD, the route cannot be prerendered and ships
 * dynamic (`f`) for that entire deployment -- not until upstream recovers, but
 * until the next deploy. The build stays green, so this is invisible unless
 * something says it happened. Measured: same probe, built with upstream
 * failing, exit code 0 and `f /pbail` in the route table.
 *
 * That is the trade. A route that is dynamic for a deployment behaves exactly
 * as these pages do today; a route with a failure baked in does not.
 *
 * The console.warn is not optional decoration -- it is the only signal that
 * either of the above happened. "This page quietly stopped being cached six
 * weeks ago" is the invisible-degradation failure this project has already
 * paid for three times.
 */
export async function refuseToCacheDegradedRender(route: string): Promise<void> {
  // Logged BEFORE the bail: connection() aborts the prerender, so anything
  // after it does not run during static generation.
  console.warn(
    `[degraded] ${route}: upstream read failed, refusing to cache this render` +
      ` (serving last known-good if one exists, otherwise rendering dynamically)`
  );

  await connection();
}
