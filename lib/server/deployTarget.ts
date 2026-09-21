// WHICH DEPLOYMENT THIS IS — the one fact several gates need, in one place.
//
// ── WHY IT IS NOT IN THE GATE THAT FIRST NEEDED IT ───────────────────────
// `canWriteSecState` was written for the SEC pipeline, after a preview
// deployment's cold path wrote twelve fact sets into the database production
// reads. The second gate that needs the same question is about view counters
// and ticker demand, which has nothing to do with SEC — and importing a
// SEC-named predicate there would read as a mistake and invite a second copy.
//
// Two gates, one environment question. The gates stay separate because they
// protect different things and their docblocks say different things; the
// answer to "am I production" is shared, so it cannot drift between them.

/**
 * True only on the production deployment.
 *
 * ── `!== "production"`, NOT `=== "preview"` ──────────────────────────────
 * Vercel sets VERCEL_ENV to "production", "preview" or "development". An
 * environment that sets none — a local `next start`, a container, a CI job
 * pointed at the live credentials — is not production either, and a predicate
 * that only knows the word "preview" would let every one of those through.
 * Anything that cannot prove it is production is not production.
 */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

const announced = new Set<string>();
/**
 * Log a refusal once per gate per process.
 *
 * A SILENT NO-WRITE IS THE WORSE BUG. If production ever runs without
 * VERCEL_ENV, every counter here goes quietly to zero and the first sign is a
 * demand ranking that stopped moving weeks ago.
 */
export function noteWriteBlocked(gate: string, site: string): void {
  if (announced.has(gate)) return;
  announced.add(gate);
  console.log(
    `[${gate}] writes disabled outside production`,
    JSON.stringify({ site, vercelEnv: process.env.VERCEL_ENV ?? null })
  );
}
