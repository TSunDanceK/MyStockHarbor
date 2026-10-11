# User-traffic cost: the gaps not closed (2026-09-04)

An audit of every FMP call reachable from a user request found **the
architecture is sound**: nearly everything on the render path sits behind
`next: { revalidate: N }` (1h–30d) or a Redis TTL, so cost is **symbol-shaped,
not traffic-shaped**. A thousand people viewing AAPL costs what one person
costs.

What *does* scale with traffic is **Redis commands and Lambda invocations** —
which is what caused the 2026-08-28 Upstash suspension. Three PRs closed the
paths where that scaling was unnecessary or unbounded:

* **#413** — nine unauthenticated debug routes, one reading the ~8 MB pickers
  payload from Redis per request, another pulling 3.0 MB of FMP.
* **#414** — five client cache-busters throwing away CDN caching the routes
  already declared, including every `/pickers` view being a Lambda serialising
  ~8 MB.
* **#415** — `/earnings-calendar` at ~22 Redis commands per view.

**These are the ones that were found and NOT fixed.** They are smaller, and they
are written down here rather than carried in a chat so they are findable.

---

## 1. `/stock-search?query=` — free-text FMP search, outside the API rules

Free-text search against FMP with a 1h Data Cache, **no BotID guard**, **no
`Cache-Control` header**, and — the part that matters most — it is **not under
`/api/`**, so the firewall's API rate-limit rules do not see it at all.

Free text means the cache key space is unbounded: a scraper varying the query
misses the Data Cache on every request.

## 2. `/api/market` — `no-store` on its FMP quote, no bot guard

Its FMP quote call uses `cache: "no-store"`, there is no BotID guard, and the
route is not in the protect list. Every request is a real FMP call.

## 3. `/api/internal-news?symbol=` — the most expensive endpoint on the plan

No BotID guard. A **cold arbitrary symbol** triggers a full-window
`/stable/news/stock` fetch at ~66 KB — the most expensive endpoint the plan
serves. Arbitrary symbols mean an attacker chooses the cache key.

## 4. `/dashboard?symbol=` — force-dynamic, arbitrary symbol, no cap

`force-dynamic`, no bot guard, and **no daily cap**: `middleware.ts` gates
`/stock/*` only. The symbol is arbitrary.

## 5. `app/api/quote`'s page-token gate protects nothing today

The gate is **log-only** unless `QUOTE_TOKEN_ENFORCE=1`, and that variable is
not set. It looks like a guard and is a counter.

---

## Two more, found while doing the three PRs

## 6. `/api/stock-earnings/[symbol]` cannot express failure, so it cannot be cached

`getLatestEarningsData` catches its own errors and returns an **all-nulls object
with a 200**, so "FMP is down" and "this ticker has no earnings" are the same
response. `/api/stock-valuation` wrote the precondition for its siblings in its
own comment — *"a 200 that might mean 'we are broken' cannot safely be stored,
so the distinction has to exist before anyone adds a cache header here, not
after"* — and this route still fails it.

Until the status codes distinguish the three cases (400 bad symbol, 503 broken
server, 200 genuine answer), the client fetch stays uncached and costs a Lambda
per stock-page view. **The fix is the status codes, not the header.**
`scripts/check-cdn-not-busted.mjs` asserts it stays uncached until then.

## 7. `/pickers` serialises its payload twice per view

The page server-renders the full pickers payload into the HTML **and then** the
client fetches `/api/pickers` again on mount as a "silent background refresh".
#414 made that second fetch a CDN hit, which is most of the win — but skipping
it entirely when the server already seeded data would save the round trip
outright.

It is a behaviour change (the refresh exists to catch a rebuild landing between
render and mount, a window of milliseconds), so it was flagged rather than done.

---

## The shape they share

Every one of these is **an arbitrary parameter chosen by the caller** reaching
an expensive origin operation with **no gate and no shared cache**. That is the
same shape as the nine open debug routes, and the reason the fix for those was a
single guard rather than nine copies: the rule is worth having in one place.
