# What bounds /stock/[symbol]/earnings — 2026-09-16

Three limits apply to the earnings page, at three different layers. Only two of
them live in this repository, and the third is the one most likely to be
forgotten, which is why it is written down here.

## 1. Per IP — the Vercel Firewall, not code

    VERCEL FIREWALL: /stock — 25 requests / 600s per IP — Challenge

Configured in the Vercel dashboard (Project → Firewall), **not** in this
repository. It runs at the edge, before any lambda, and costs zero Redis
commands.

**This is the per-IP bound, and there is deliberately no per-IP logic in the
code.** The middleware alternative — one Redis `EXISTS` on the fact-set key per
earnings *request*, to tell a cold request from a warm one before counting — was
considered and refused: it duplicates a rule the edge already enforces, at a
per-request cost on a meter already under pressure, in the one place where
reading the client address (`headers()`) turns an ISR route into a 500.

At 25 requests per 600s, a single address cannot reach the 20-cold-fetches-per-
minute site budget below at all, so the case the site-wide bucket cannot defend
against is closed at the layer above it.

**A rule that lives outside the repo is a rule that silently stops being true.**
So the same line is written into `lib/server/secColdFetch.ts`'s `claimColdFetch`
docblock, and `scripts/check-sec-rate-limits.mjs` asserts the two copies agree.
If the dashboard rule is ever changed, change both copies — the check cannot see
the dashboard, only whether the repo still agrees with itself.

## 2. Site-wide external fetches — `SEC_COLD_FETCHES_PER_MINUTE`

`lib/server/secColdFetch.ts`. One minute-resolution Redis bucket, INCR with a
120s expiry (not 60: a bucket created at :59 would otherwise hand the next
second a fresh allowance). Past the cap the symbol is **queued**, not failed,
and the page renders pending.

It counts FETCHES, not requests: a visitor reading twenty cached pages spends
nothing.

Fails **open** — a Redis error lets the fetch through, because refusing there
costs a reader their page.

Exhaustion is counted, not just logged: `msh:sec:cold-exhausted:v1:<UTC date>`,
incremented only on the exhausted path, kept 14 days, shown on `/cache-health`.
That counter is the decision procedure for whether per-IP isolation in code ever
has a case. If it stays at zero, it never did.

## 3. SEC's own fair-access policy

10 requests/second, published. The site budget of 20/minute is two orders of
magnitude inside it, and the cron's own pacing (8 req/s, 1920 requests per run)
is the larger consumer by far. Neither path can approach the published limit.

## What was REMOVED, and why it is not a fourth limit

A refresh-on-view path had its own 10/minute bucket, a per-symbol hourly
cooldown and a 60s lock. It was removed in #469: `revalidatePath` is refused
from a page render's `after()`, so it corrected sets it could not flush, and the
ISR cache meant the visitor who triggered a refresh was the only one who could.
Its three Redis prefixes are gone. See `secColdFetch`'s populated branch for the
full reasoning.
