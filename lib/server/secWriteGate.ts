// WHERE SEC STATE MAY BE WRITTEN, AND NOWHERE ELSE.
//
// ── WHAT THIS EXISTS FOR, MEASURED ───────────────────────────────────────
// An audit of the shared store on 2026-09-16 found twelve fact sets appearing
// in four minutes with no job running: ADSEW, ALMU, ESP, ISPR, KO, LEN, LUXE,
// NCPL, NCPLW, PEP, RVSN, RVSNW, RZLT, SANG. They carried a field only the
// unmerged branch's code could produce, so a PREVIEW deployment had written
// them — its cold path fetching, extracting and storing into the database
// production reads, on any preview render of a symbol with no stored set.
//
// Nothing about that fails. The sets are valid and the pages render. It is
// simply an unmerged branch deciding what production shows, and an eye-check
// spending production's SEC budget.
//
// ── ONE PREDICATE, EVERY WRITE SITE ──────────────────────────────────────
// Not a check at the top of the cold path: the cold path is one of six places
// that write, and the next one added would be gated by whoever remembered.
// check-sec-write-gate enumerates the call sites from the source and asserts
// each is behind this function, with a mutation removing one gate.
//
// ── READS ARE UNTOUCHED, AND THAT IS THE POINT ───────────────────────────
// A preview still fetches from SEC, still extracts, still renders the page
// from the set it holds in memory. What it does not do is keep it. The
// eye-check sees exactly what production will see; production's state is not
// a side effect of looking.

import { isProductionDeployment, noteWriteBlocked } from "./deployTarget";

/**
 * True only on the production deployment.
 *
 * ── WHY `!== "production"` RATHER THAN `=== "preview"` ───────────────────
 * Vercel sets VERCEL_ENV to "production", "preview" or "development". An
 * environment that sets none of them — a local `next start`, a container, a
 * CI runner pointed at the live credentials — is not production either, and a
 * gate that only knows the word "preview" would let every one of those write.
 * The question is "am I the production deployment", and the honest default for
 * anything that cannot prove it is no.
 *
 * THE FAILURE MODE THIS CREATES IS DELIBERATE AND LOUD. If production ever
 * runs without VERCEL_ENV, the pipeline stops writing — so it says so, once
 * per process, rather than going quiet. A silent no-write is the worse bug:
 * the cron would report success having stored nothing.
 */
export function canWriteSecState(): boolean {
  return isProductionDeployment();
}

/** Log the refusal once per process, so a wrongly-configured host is visible. */
export function noteSecWriteBlocked(site: string): void {
  noteWriteBlocked("sec", site);
}

/**
 * The prefix the SEC RATE COUNTERS live under.
 *
 * ── SKIPPING THE COUNTER WOULD BE WORSE THAN SPENDING THE BUDGET ─────────
 * The brief said the counters must not touch production's keys from a preview,
 * and the obvious reading — don't count at all — leaves a preview deployment
 * with NO rate limit at all against data.sec.gov. SEC blocks by requester, and
 * a block earned by a preview falls on the live site.
 *
 * So a preview counts against its OWN bucket: rate-limited exactly as
 * production is, sharing none of its keys and none of its allowance. The
 * production prefix is returned verbatim so the live keys, the cache-health
 * panel and every census keep reading the same names they always have.
 */
export function secCounterPrefix(base: string): string {
  return canWriteSecState() ? base : `${base}:preview`;
}
