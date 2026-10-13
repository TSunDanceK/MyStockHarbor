// A TIME BUDGET FOR ONE SOURCE OF A PAGE, so a read that never answers costs
// that source, not the page.
//
// ── WHY THIS EXISTS (#553 CODE-B #137, COWORK #145/#146) ─────────────────
// /dashboard timed out at Vercel's 300 s limit on ~3.5% of cold renders (7 in
// 24 h, each a different symbol). The page awaits five independent reads in one
// Promise.all, and none of them had a deadline: our Upstash client sets no
// request timeout, so a connection that never answers held the whole render
// until the platform killed it. The relay timing run (the same five reads off
// Vercel) finished in 4.3–4.4 s, so the cause is a call that sometimes never
// answers, not slow code.
//
// So each source races a budget. A source that runs over resolves to its own
// "missing" value, the page renders its other sections, and ONE log line names
// the source and the symbol, so the next slow source identifies itself without
// any env change (the production timing logs are off).
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
// It does not cancel the underlying request. The hung promise is abandoned,
// not aborted: the response no longer waits on it, which is the whole fix for
// the page. Bounding the request itself is the client-wide Upstash timeout,
// which is a separate proposal (COWORK #146) because that client is shared by
// every relay.
//
// A rejection resolves to the fallback too, without a log line: every source
// here already turns its own errors into "missing", and this keeps that true
// for one that doesn't.
//
// `setTimer` / `log` are injected so scripts/check-source-budget.mjs can drive
// them without waiting real seconds.

/** Each /dashboard source's budget. The five together took 4.3–4.4 s off Vercel. */
export const DASHBOARD_SOURCE_BUDGET_MS = 8_000;

/**
 * Deferred news-store writes (after()). Three Redis writes; these take well
 * under a second when Redis answers, and they must not hold a function open
 * when it doesn't.
 */
export const NEWS_DEFERRED_WRITE_BUDGET_MS = 10_000;

export type BudgetDeps = {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (line: string) => void;
};

/**
 * `work`, or `fallback` once `ms` passes first. Logs one line on a timeout:
 * `[budget] <page> source=<source> symbol=<symbol> ran past <ms>ms -- rendered without it`.
 */
export function withBudget<T>(
  page: string,
  source: string,
  symbol: string,
  work: Promise<T>,
  fallback: T,
  ms: number,
  deps: BudgetDeps = {}
): Promise<T> {
  const setTimer = deps.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = deps.log ?? ((line: string) => console.warn(line));

  return new Promise<T>((resolve) => {
    let settled = false;
    const handle = setTimer(() => {
      if (settled) return;
      settled = true;
      log(`[budget] ${page} source=${source} symbol=${symbol} ran past ${ms}ms -- rendered without it`);
      resolve(fallback);
    }, ms);

    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimer(handle);
        resolve(fallback);
      }
    );
  });
}

/**
 * For work handed to after(): the same race, resolving to undefined. after()
 * keeps the function alive until its callback settles, so an unbounded
 * callback on a hung Redis write holds the invocation to the platform limit
 * even though the response has already gone.
 */
export function boundedDeferred(
  label: string,
  key: string,
  work: () => Promise<unknown>,
  ms: number,
  deps: BudgetDeps = {}
): () => Promise<void> {
  return async () => {
    let run: Promise<unknown>;
    try {
      run = work();
    } catch {
      return;
    }
    await withBudget(label, "deferred", key, run.then(() => undefined), undefined, ms, deps);
  };
}
