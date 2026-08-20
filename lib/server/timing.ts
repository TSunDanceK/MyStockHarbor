// lib/server/timing.ts
//
// Opt-in server-render timing, for answering "which upstream call dominates
// TTFB, and is it hitting Redis or falling through to FMP?" with numbers
// instead of a hypothesis.
//
// Why this exists at all: that question cannot be answered from outside the
// deployment. Vercel's runtime logs record cache=MISS but no durations, the
// production domain sits behind a firewall that challenges any programmatic
// request, and a local run without UPSTASH_REDIS_REST_* / FMP_API_KEY proves
// nothing -- the Redis client short-circuits and never issues the call, which
// is the same trap written up as Rule 1 in
// claude/picker-pages-isr-2026-08-20.md. The only place the answer exists is
// a real deployment with real credentials, so the measurement has to ship.
//
// It is behind MSH_TIMING because it should NOT be permanently on: one line
// per upstream call per render is real log volume and real cost at 500
// renders/day, and the value is in a bounded measurement window, not a
// permanent feed. Set MSH_TIMING=1 in the Vercel project, read the logs,
// unset it. With the flag unset every helper here is a boolean check and a
// pass-through -- no timers, no allocation, no log lines.
//
// Deliberately console.log and nothing else. The warm jobs already log this
// way ("[warm-price-pool] {...}", "[pickers] build complete: ... 10197ms")
// and those lines are readable in the Vercel runtime log viewer without any
// extra tooling, which is the whole point.

export const TIMING_ENABLED = process.env.MSH_TIMING === "1";

// Times a promise and logs `[timing] <scope> <label> <ms>ms`. Returns the
// promise's own result untouched, and never changes its rejection behaviour
// -- callers keep whatever .catch()/try-catch they already had.
export function timed<T>(
  scope: string,
  label: string,
  work: Promise<T>
): Promise<T> {
  if (!TIMING_ENABLED) return work;

  const startedAt = Date.now();
  let settled = "ok";

  return work
    .catch((error: unknown) => {
      settled = "threw";
      throw error;
    })
    .finally(() => {
      console.log(
        `[timing] ${scope} ${label} ${Date.now() - startedAt}ms ${settled}`
      );
    });
}

// Starts a timer and returns the function that ends it. Exists so a caller
// inside a render never has to call Date.now() itself -- the react-hooks
// purity rule flags that as an impure call during render, correctly in
// general even though a Server Component render is the one place it is
// harmless. Keeping the clock read behind this boundary means instrumenting
// a page costs no lint suppressions.
export function beginTiming(scope: string, label: string): () => void {
  if (!TIMING_ENABLED) return () => {};

  const startedAt = Date.now();
  return (detail?: string) => {
    console.log(
      `[timing] ${scope} ${label} ${Date.now() - startedAt}ms${detail ? ` ${detail}` : ""}`
    );
  };
}

// Records a cache outcome: `[timing] <scope> <label> <outcome>`.
//
// This is the half that actually answers the Redis-vs-FMP question. A
// duration alone cannot distinguish "Redis hit, 8ms" from "Redis miss, FMP
// answered fast" -- and the difference decides whether ISR would fix the
// problem or merely move it.
export function timingCache(
  scope: string,
  label: string,
  outcome: "hit" | "miss" | "skip",
  detail?: string
) {
  if (!TIMING_ENABLED) return;

  console.log(
    `[timing] ${scope} ${label} ${outcome}${detail ? ` ${detail}` : ""}`
  );
}
