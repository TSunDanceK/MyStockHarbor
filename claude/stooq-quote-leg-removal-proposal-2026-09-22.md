# Proposal: delete the Stooq leg from the news quote path

> **2026-09-23: APPROVED by the owner and applied** (#535 COWORK #4) — both
> functions and both call sites deleted from `lib/stock-news-data.ts`. The body
> below is the original proposal, unedited.

**Status (as written 2026-09-22): PROPOSED, NOT APPLIED.** Nothing in this PR removes it. The code
still calls Stooq exactly as it did yesterday. This document exists so the
decision is made on measurements rather than on a recollection, and it stays
unapplied until the owner says so.

Date: 2026-09-22. Measured on Actions run
[35794824846](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35794824846),
`scripts/share-class-spelling-probe.mjs`.

---

## 1. What is proposed

Delete two functions from `lib/stock-news-data.ts` and the two lines that call
them:

| Function | Line (before this PR) | Endpoint |
|---|---|---|
| `fetchStooqQuote` | 211 | `https://stooq.com/q/l/?s={sym}.us&f=sd2t2l&h&e=csv` |
| `fetchStooqHistory` | 314 | `https://stooq.com/q/d/l/?s={sym}.us&i=d` |

Nothing else in `lib/` or `app/` calls stooq.com. Four other files mention
Stooq, all in prose — `lib/server/gridPriceCoverage.ts`,
`lib/server/secColdFetch.ts`, `app/api/jobs/sec-facts/route.ts`,
`lib/server/news/index.ts` — and none of them makes a request. Those comments
should stay: two of them cite Stooq as the precedent for "a 200 carrying HTML
is not data", which is a rule about parsing, not about this vendor.

## 2. What calls it, and what the fallback order becomes

Both call sites are in `lib/stock-news-data.ts`, and both are reached from one
place: `getStockNewsBaseDataInner`, which awaits `fetchQuote(upper)` and
`fetchHistory(upper)` together (line 2678–2679).

**Quote — `fetchQuote()`**

| | today | proposed |
|---|---|---|
| 1 | FMP `stable/quote` | FMP `stable/quote` |
| 2 | **Stooq quote CSV** | Yahoo v8 chart, `range=5d` |
| 3 | Yahoo v8 chart, `range=5d` | — |

**History — `fetchHistory()`**

| | today | proposed |
|---|---|---|
| 1 | **Stooq history CSV** | Yahoo v8 chart, `range=2y` |
| 2 | Yahoo v8 chart, `range=2y` | — |

Downstream of both, unchanged: `hasNoQuote && hasNoHistory` sets
`isDataUnavailable`, which is what renders LAST PRICE: DATA UNAVAILABLE. The
proposal does not touch that logic.

One reader-visible consequence: `Quote.source` can no longer be the string
`"Stooq"`, so the page's "Source:" line will read FMP or Yahoo only. It already
effectively does — see below.

## 3. The evidence

### 3a. Today's measurement, from a runner with full internet

Not from the sandbox: stooq.com is `403 CONNECT` there, and a sandbox failure
proves nothing about what Vercel would get. This ran on a GitHub Actions runner.

| endpoint | AAPL (control) | BRK.B | BRK-B |
|---|---|---|---|
| quote CSV `/q/l/` | HTTP 404, 1 line of CSV | HTTP 404 | HTTP 404 |
| history CSV `/q/d/l/` | HTTP 200, **browser-verification page** | same | same |

**The control is the finding.** AAPL is not a share class, not obscure and not
newly listed. The quote endpoint 404s it and the history endpoint answers with
a JavaScript interstitial instead of CSV. A vendor that cannot serve AAPL to an
honest, identified client is not serving this site either.

This is also a *worse* reading than the one on record: on 2026-09-12 both
endpoints returned the browser challenge; today the quote endpoint has moved to
an outright 404. It has not recovered in the ten days since.

### 3b. What was already on record

- `claude/stooq-inaccessible-sec-viable-2026-09-12.md` — every spelling returns
  the JavaScript browser-verification page.
- `lib/server/gridPriceCoverage.ts:30` — owner decision 2026-09-21, "Stooq was
  eliminated from three independent egress paths". Stage 4's permanent-absence
  argument already assumes Stooq is gone.

Three independent measurements, ten days apart, agree.

## 4. Why this is a low-risk removal

**It is behaviour-neutral by measurement, not by argument.** A leg that returns
nothing and a leg that is absent produce the same `Quote | null` and the same
`Point[]`. `fetchStooqQuote` returns `null` on a 404 before it parses anything,
which is what both spellings and the control got. `fetchStooqHistory` gets a
200, so it does parse — and every row of an HTML page fails its
`!date || !Number.isFinite(close) || close <= 0` guard, so it returns `[]`.
That second one is derived from the guard, not observed row by row: what was
observed is that the body is the challenge page, not CSV. Either way no price
on the site is coming from Stooq today. Removing the calls changes which
requests are made, not which data is shown.

**It buys latency on a path that is always paid.** `fetchQuote` only reaches
Stooq when FMP fails, but `fetchHistory` calls Stooq **first, on every uncached
render**, and waits for it before falling through to Yahoo. Single-sample
timings from the run above: the quote endpoint took ~680 ms, the history
endpoint ~150 ms. One sample each, from a runner, not an average and not from
Vercel's egress — but the shape is a round trip to a host that will not answer,
in front of the one that will.

**The zero-price guard stays relevant.** `price > 0` (not merely finite) exists
because Stooq served a literal `0`. That reasoning is recorded at `fetchQuote`'s
header and applies to all three legs; it must survive the deletion of the leg
that motivated it. If the Stooq functions go, that comment needs rewording, not
removing.

## 5. What would change my recommendation

- **A measurement showing Stooq answering.** If it serves CSV again from a
  Vercel IP, this proposal is void — re-run `share-class-spelling` first.
- **Any caller I did not find.** The grep above covered `lib/` and `app/` for
  `stooq` case-insensitively. `scripts/` has probes that call it deliberately;
  those are measurement tools and must stay.

## 6. Not proposed here

Converting the Stooq leg's spelling. It takes `symbol.toLowerCase() + ".us"`
and converts no dot. On today's evidence that is moot — no spelling gets data —
and a conversion added to a leg slated for deletion is work that exists to be
deleted. If the removal is declined, the spelling gap becomes live again and
should be fixed then, with a probe to say which spelling Stooq wants, since
that has never been measured while the vendor was answering.
