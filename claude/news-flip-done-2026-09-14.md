# The flip went live, and what the wire leg is actually worth

**Date:** 2026-09-14. Records what was measured around #453's merge, and the one
question still open. Companion to `claude/news-adapter-spec-2026-09-13.md`.

## 1. The flip is live, and the merge is what did it

#453 merged 07:06:58Z. `NEWS_PROVIDER` was **not** pinned in Production, so the
merge itself was the flip. Evidence, from production runtime logs:

```
07:10:46  dpl_8VgLznhx…  within90d   (no adapter lines)   ← FMP, previous build
07:16:48  dpl_DvPzijDJ…  within45d   [gnews] WSO …        ← FREE
          [news] WSO: wire failed, serving 2 of 3 adapters
07:20:04  dpl_DvPzijDJ…  within45d   [gnews] COP …        ← FREE
          [news] COP: wire failed, serving 2 of 3 adapters
```

The 45-day window is visibly in force: WSO went `afterFilters=33 → within45d=12`.
Twenty-one items dropped out of display. That is the documented content change,
not a fault.

**The 5 s adapter timeout shipped in the same PR, which is the only reason this
reads as a normal morning.** Without it those page loads would have been
71-second renders.

## 2. The render measurement, before and after

Preview, `MSH_TIMING=1`, cold store (`/stock/AMD/news`), before the timeout:

```
[timing] news adapter sec   AMD      70ms
[timing] news adapter gnews AMD     573ms
[timing] news adapter wire  AMD   70630ms   ← 99.3% of the render
[timing] page stockNews     AMD   71133ms
```

Same page, **warm store: 545 ms total, news 515 ms, store 7 ms.** The store and
the adapters cost nothing once the store answers; the entire problem is the cold
path and it is one source.

After the timeout, two independent cold renders:

| | LII | SNA |
|---|---|---|
| `wireFeed prnewswire` | 25 ms | 39 ms |
| `adapter gnews` | 328 ms | 332 ms |
| `adapter sec` | 0 ms¹ | 57 ms |
| `adapter wire` | **5002 ms** | **5003 ms** |
| `page stockNews` | **5685 ms** | **5837 ms** |

¹ 0 ms because LII has no CIK — see §5.

**71,133 ms → 5,685 ms.** The partial-result contract held: wire abandoned,
gnews and sec delivered, store written.

## 3. GlobeNewswire is the hanging host

`prnewswire` logged 25 ms and 39 ms. `globenewswire` logged **nothing at all** in
either render — and the absence is the evidence, not a gap. `endPoll()` sits in a
`finally`, so it fires even when a feed errors. The only way it does not fire is
a fetch that never settles: the 5 s timeout rejects the *adapter* promise while
the inner fetch is still open.

Consistent with `scripts/news-timing-probe.mjs`, where GlobeNewswire answers in
12–330 ms **from a GitHub runner**. The host is up. The failure is specific to
Vercel's egress.

## 4. On stock pages the wire leg contributes nothing, and cannot

Two facts from `lib/server/news/wireProvider.ts`:

```ts
const tickers = source.id === "globenewswire" ? tickersFromCategories(stockCategories) : [];
…
return (await pollAll()).filter((item) => item.tickers?.includes(wanted));
```

PR Newswire items are built with `tickers: []`, and `fetchForSymbol` filters on
exactly that field. **PR Newswire can never match any symbol.** This is measured,
not inferred — `scripts/fixtures/wire-prnewswire.xml` records it: *"NONE of the
20 items carried a ticker. There is no `<category>` element in this feed at all…
the measurement is 0/20, and that stands."*

So on `/stock/[symbol]/news` the wire adapter can only ever contribute
GlobeNewswire items, and GlobeNewswire does not answer. **The 5,002 ms is buying
zero.**

Three consequences worth stating plainly:

- **The leg is not dead everywhere.** `fetchMarket()` is unfiltered, so PR
  Newswire still feeds `/headlines` and sector seeding. The dead path is
  specifically per-symbol.
- **There is a wasted fetch independent of the hang.** `fetchForSymbol` calls
  `pollAll()`, which polls both feeds and then discards 100% of the PR Newswire
  items at the filter. Even with both hosts healthy that request is pure waste on
  a stock page.
- **Dropping GlobeNewswire is not a small trim.** It is the sole ticker-bearing
  feed, so removing it makes the wire adapter permanently incapable of
  contributing anything to a stock page. Not cheaply reversible in judgement even
  though it is in code.

## 5. Unlooked-for: `data/cik-map.json` is missing CIKs

Two of four symbols touched on 2026-09-14:

```
[sec] LII: no CIK in data/cik-map.json — regenerate it (relay task "sec", symbols=cik-map)
[timing] news adapter sec LII 0ms
[sec] WSO: no CIK in data/cik-map.json — regenerate it
```

**A 0 ms adapter returning nothing is indistinguishable from a fast one in any
aggregate.** Post-flip, `sec` is one of only two legs contributing on a stock
page. The miss rate across the universe is the thing worth knowing; regenerating
without measuring it just resets the clock on a problem nobody sized.

## 6. Open: is GlobeNewswire blocked, or slow?

Nobody has measured it, and every remaining option depends on the answer.
`app/api/debug/wire-egress` exists to answer it, because only a Vercel function
can: the sandbox cannot reach the host, and a runner reaches it fine.

| result | reading | points to |
|---|---|---|
| immediate refusal / 403 | IP-level block | structural |
| hangs to timeout, no bytes | silent drop, likely deliberate | structural |
| answers, slowly or intermittently | transient | a per-feed timeout suffices |

**This is a content-source decision and it is the owner's call, not an
implementation detail.** The verdict belongs in this section once taken.
