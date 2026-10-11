# A visible failure is not a harmless one — and how to refuse to cache it

`feedCache` (see `return-type-cannot-express-failure`) made a failed upstream
read distinguishable from a
genuinely empty one. That fixed the *diagnosis* and not the *blast radius*.

**Under ISR, a failed read is baked into the prerendered artefact** and served
to every visitor and every crawler for the whole revalidate window, with no
reload path out. "We couldn't load the IPO calendar" stops being a blip a
refresh fixes and becomes *the page*, for everyone, until the window expires.
`/upcoming-ipos` and `/recently-added-to-index` were held back from ISR for
exactly this reason: their `f` status is what makes the failure self-heal.

### The technique

`await connection()` on the degraded path, via
`lib/server/degradedRender.ts`. It does better than "don't persist the
failure": the visitor keeps being served the **last known-good HTML**, so a
failed *revalidation* is invisible to them rather than merely non-permanent.
With no good copy it degrades to exactly today's dynamic behaviour.

Measured against `next start` (Next 16.1.6), upstream toggled mid-run:

```
without   req1 STALE/good   req2 HIT/DEGRADED   req3 HIT/DEGRADED
with      req1 STALE/good   req2 HIT/good       req3 HIT/good
```

### The limit — this is the half that will bite someone

**Safe only on paramless static routes.** On a route with
`generateStaticParams` it returns a **500**, measured on the same probe:

```
/pbail           (paramless)             -> 200, last known-good HTML
/bailparam/[id]  (generateStaticParams)  -> 500
```

**CONFIRMED IN PRODUCTION, 2026-08-21.** When this limit was first written, the
500 was measured against `next start` and #302's PR body hedged that it might be
a local artefact — that Vercel would "degrade to per-request rendering instead
of erroring." That was labelled as inference rather than measurement, which was
honest, but the inference was wrong and it granted the mechanism a free pass.

It is fatal in production. #310 added an empty `generateStaticParams` to
`/insights/[slug]` and `/insights/videos/[videoId]`, both of which reach Redis
through clients that did not pass `PAGE_READ_CACHE`. Every request to a real
slug returned **500** for ~3.5 hours on live traffic, on pages that are in the
sitemap:

```
Route /insights/[slug] couldn't be rendered statically because it used
no-store fetch https://game-dinosaur-75465.upstash.io/pipeline
digest: 'DYNAMIC_SERVER_USAGE'
```

Reverted in #323. The lesson is not only about `connection()`: ANY no-store call
reaching the renderer on a prerendered route does this, and a Redis client built
without `PAGE_READ_CACHE` is one, because `@upstash/redis` sets
`cache: "no-store"` on every REST call by default.

A 500 there is worse than the problem. `/stock/[symbol]` receives enumerated
junk from something crawling ~1,519 distinct paths, and sustained 5xx makes
Google throttle crawl rate **site-wide** — undoing the ISR work this enables.
Per the #281 corollary: on a dynamic segment the tool is **200 + noindex**,
never a 5xx.

So: `/upcoming-ipos` yes. `/stock/[symbol]` never.

### The cost, which is silent

If the read fails **during a build**, the route cannot be prerendered and ships
`f` for that entire deployment — not until upstream recovers, but until the
next deploy. **The build stays green.** Measured: probe built with upstream
failing, exit code 0, `f /pbail` in the route table.

That trade is acceptable (a dynamic route behaves as these pages do today; a
route with a failure baked in does not) but it is only acceptable *because
something says it happened*. The `console.warn` naming the route is the entire
early-warning system. Without it this becomes "the page quietly stopped being
cached six weeks ago" — which is `test-the-second-visit`'s shape, and this
project has paid for
it three times already.
