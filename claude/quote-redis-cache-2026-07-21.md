# The single-quote Redis cache (2026-07-21)

> **Provenance.** This is the repo mirror. The original lives in the Claude
> Project "My Stock Harbor Website", which a Claude Code session cannot read —
> so this file was **reconstructed from the code that cites it** rather than
> copied. If the Project copy differs, the Project copy is the original and
> should replace this file wholesale. What is written below is checkable
> against `lib/server/quoteData.ts` today; the July narrative is reconstructed
> and is marked where it is.
>
> Mirrored 2026-09-02 to close the dangling citation from
> `lib/server/quoteData.ts` (`scripts/check-doc-citations.mjs`). The citation
> is the argument — a citation pointing at nothing reads as "the reasoning is
> recorded elsewhere" when it is not.

## What it is

A single symbol's quote is served through **three layers**, all in
`lib/server/quoteData.ts`:

| Layer | Where | Lifetime | What it stops |
|---|---|---|---|
| In-flight map | per instance, `inFlight` | the request | two concurrent renders of the same symbol making two calls |
| Redis | `msh:quote:v1:<SYMBOL>` | `QUOTE_CACHE_TTL_SECONDS` = 60s | every instance paying for the same symbol every minute |
| Next Data Cache | `unstable_cache(["quote-from-fmp"])` | `revalidate: 60`, tag `quotes` | a render path issuing a `no-store` fetch at all |

The two 60s numbers are deliberately the same constant: the module already
declares 60s as its freshness budget, so the second layer reuses that number
rather than inventing one.

`fetchQuoteFromFmpUncached` — the layer that actually calls FMP — is now
reached directly **only** from `/api/quote`, which is `force-dynamic` and
answers `Cache-Control: no-store`. Every render path goes through
`fetchQuoteFromFmpCached`. That matters beyond cost: a literal `no-store` fetch
on a prerendered route throws `DYNAMIC_SERVER_USAGE`, which is the shape of the
#310 outage.

## The follow-up this doc is cited for, and why it took six weeks

The July write-up recorded a follow-up and it **was not actioned at the time**:

> the quote calls bypass the FMP minute counter entirely.

That is the sentence `quoteData.ts` cites. The consequence was not "some calls
are uncounted" — it was that **575 quotes in a 15-minute window spent the plan
limit while every warm job read a counter that said there was room**. The warm
jobs compute their own backoff from that number, so the invisibility was not
neutral: it made their pacing wrong *in the direction of overspending*.

### How it was closed

`fetchQuoteFromFmpUncached` now calls **`tryReserveFmpCallSlot()`** — and
deliberately not `reserveFmpCallSlot()`:

* `reserveFmpCallSlot` waits up to 20s for room. Correct for a warm job, wrong
  on a render: a visitor waiting 20 seconds for a price is worse than a price
  being briefly unavailable, and it converts a budget shortage into an
  availability incident.
* A render cannot usefully defer anyway — it either has a price to show or it
  does not.
* Worst-case added latency is **one Redis INCR**, not one wait.

When the minute is already spent the call returns `emptyQuote(symbol)`. FMP
would have answered a 429; being turned away here is the same outcome sooner,
without deepening the shortage that caused it. It renders as an absent quote —
degraded, and honest.

## Why the TTL is 60s and not longer

A quote is the one number a visitor checks against another tab. 60s is short
enough that the page is never obviously wrong and long enough that the
dashboard's render rate does not translate into FMP calls one-for-one. Note the
cost side of that choice, recorded in `timingCache`'s own comment: at the
dashboard's render rate **this cache may miss most of the time**, which is the
distinction the hit/miss instrumentation exists to measure rather than assume.

Bulk price coverage is not this cache's job — that is the price pool
(`lib/server/pricePool.ts`), which is read-only on renders so a page load never
spends an FMP call at all.
