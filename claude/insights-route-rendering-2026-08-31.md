# Why the insights routes are `ƒ`, and why `/` is (2026-08-31)

Investigation prompted by #381's preview route table, which showed three routes
as `ƒ` that nobody had gone looking for. **No behaviour is changed by this work.**
It answers why, and corrects a doc that had gone wrong.

## Summary

| Route | Why `ƒ` | Should it change? |
|---|---|---|
| `/insights/[slug]` | `generateStaticParams` is **deliberately absent** — removed in #323 after #310's outage | Eventually. One blocker left. |
| `/insights/videos/[videoId]` | no `generateStaticParams`, so `revalidate = 1800` is inert | Eventually. Same one blocker. |
| `/` | reads `headers()`, and mints a time-limited token per request | **No. Leave it.** |

The two insights routes turn out to be blocked by **the same single line**, which
is a better outcome than two separate fixes: `lib/server/quoteData.ts:154`.

## `/insights/[slug]` — the fix did not fail, it was reverted

The premise that prompted this — that the route "HAS generateStaticParams —
three occurrences" — is not the case. **All three occurrences are inside
comments.** There is no such export. `grep` counts mentions; only the first
column of the route table counts exports.

It is absent on purpose. From the file's own header:

> `generateStaticParams` is REMOVED, and must stay removed until the condition
> below is met. #310 added it as an empty array, which made this route ● — and a
> prerendered route that performs a `no-store` fetch at request time throws
> DYNAMIC_SERVER_USAGE and returns 500. […] every request to a real slug 500'd in
> production for ~3.5 hours. Reverted in #323.

So this is not a fix that never took. It is a fix that took, caused an outage,
and was withdrawn — and the route being `ƒ` is the documented, accepted cost of
that withdrawal. The header states it plainly: "That is a performance cost, not
an outage, and it is the correct trade until the read path is safe."

### Where the preconditions stand

The file names two. They have moved since they were written:

1. **Every Redis client on the transitive read path uses `PAGE_READ_CACHE`** —
   **NOW MET.** It names `getOrCreateInsightSnapshot` in `lib/insightSnapshots.ts`
   as the place to start; that module passes `PAGE_READ_CACHE` today, and
   `scripts/check-static-safety.mjs` reports no bare clients for this route.
2. **A real slug returns 200 from a preview** — still outstanding, and now
   demonstrably blocked by something precondition 1 does not cover.

### The one thing actually blocking it

`check-static-safety.mjs` on this route reports exactly one hit:

```
lib/server/quoteData.ts
  :154  cache: "no-store"   via lib/insightSnapshots.ts
```

That line's own comment names itself:

> **THE REMAINING BLOCKER** for prerendering any route that reaches this module.
> On a Redis cache miss this runs during the render, and a literal no-store fetch
> on a static route throws DYNAMIC_SERVER_USAGE -> 500. A warm cache hides it,
> which is exactly why it must not be reasoned about as "rarely fires": #310
> shipped on that class of reasoning.

No Redis client option fixes a literal `cache: "no-store"`. The fix its author
identified is wrapping it in `unstable_cache`, as `lib/youtube.ts` already does
for its own no-store fetches — and they deliberately left it, because choosing a
cache window for a 60-second quote TTL is a freshness decision, not an
outage-recovery one.

## `/insights/videos/[videoId]` — same blocker, one extra step

Two differences from its sibling, one now closed:

- Its Redis-client precondition was **not** met: `lib/youtube.ts:99` built a bare
  `Redis.fromEnv()`. Fixed in #383.
- It has never had `generateStaticParams` at all, so adding one is still required.

After #383 it reaches the same single blocker, via `getVideoStockData` instead of
`getOrCreateInsightSnapshot`. **One fix to `quoteData.ts` unblocks both routes.**

### The order this wants to happen in

1. #383 — `lib/youtube.ts` gets `PAGE_READ_CACHE`. *(open)*
2. Wrap `quoteData.ts:154` in `unstable_cache`. A freshness decision about a 60s
   quote TTL; wants to be its own PR.
3. Only then add `generateStaticParams` to the videos route, and consider
   restoring it on `/insights/[slug]`.
4. For each, verify a **real slug returns 200 against a preview**. The route table
   showing `●` proves the route became static; it says nothing about whether the
   route survives being static, and a preview build never issues that request on
   its own. That is the #310 lesson exactly.

## `/` — intentional, and it should stay `ƒ`

Two independent reasons, both load-bearing:

**It reads `headers()`.** `getInitialIsMobile()` sniffs the user-agent so the
server renders the correct mobile/desktop variant. This was added deliberately:
before it, `HomePageRouter` started with `isMobile = null` and returned `null`
until a mount-time `window.innerWidth` check ran, so the server HTML for `/` and
every `/?symbol=…` variant contained no `<h1>`, no hero, nothing. Bing's Site
Scan flagged it across dozens of URLs on 2026-08-07. Reading `headers()` forces
the route dynamic; that is the price of crawlable HTML here.

**It mints a per-request token.** `mintQuoteToken()` produces an HMAC over
`now + ttl`. A prerendered page would bake in one token and serve it until the
next regeneration, handing every visitor a shared and eventually expired
credential.

The two no-store fetches `check-static-safety.mjs` reports for this route are in
`DashboardClient.tsx` (inside a `useEffect`) and `InteractiveChart.tsx` — both
client components, running in the browser, not during SSR. They are not why the
route is dynamic and would not be fixed by changing it.

Every request to `/` being a full render is real cost, and worth knowing. But it
is bought deliberately, and the SEO regression from reverting it is worse than
the render cost. **Leave it.**

## Doc corrected

`claude/traps/inert-route-revalidate.md` said an empty `generateStaticParams`
"addresses it completely" for `/insights/[slug]`. That is the change #310 made
and #323 reverted after a 3.5-hour outage, so the doc was recommending the thing
that broke production. Corrected in place, with the second half of the trap
spelled out: the route table showing `●` proves a route *became* static and
proves nothing about whether it *survives* being static.
