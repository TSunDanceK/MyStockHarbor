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

## 4. On stock pages the wire leg contributes nothing — but NOT because it cannot

> **CORRECTED 2026-09-14 07:47Z.** This section originally concluded that the
> wire leg "contributes nothing, and cannot" on stock pages, and that the "cannot"
> was structural. **The second half was wrong.** The egress probe found
> GlobeNewswire reachable and fast from Vercel (28 ms warm, 9/9 HTTP 200). The
> feed is healthy, so per-symbol wire attribution is RECOVERABLE — see §6.
> What survives is the first half: it contributes nothing *today*, and the
> 5,002 ms buys zero *today*.

Two facts from `lib/server/news/wireProvider.ts`:

```ts
const tickers = source.id === "globenewswire" ? tickersFromCategories(stockCategories) : [];
…
return (await pollAll()).filter((item) => item.tickers?.includes(wanted));
```

PR Newswire items are built with `tickers: []`, and `fetchForSymbol` filters on
exactly that field. **PR Newswire can never match any symbol.** Measured, not
inferred — `scripts/fixtures/wire-prnewswire.xml` records it: *"NONE of the 20
items carried a ticker. There is no `<category>` element in this feed at all…
the measurement is 0/20, and that stands."*

So GlobeNewswire is the **sole ticker-bearing feed**. That was true before the
probe and is still true; what changed is what follows from it. Because the feed
is healthy, this is now a reason to FIX the hang rather than to route around it.

Three consequences that survive the correction:

- **The leg is not dead everywhere.** `fetchMarket()` is unfiltered, so PR
  Newswire still feeds `/headlines` and sector seeding. Any dead path is
  specifically per-symbol.
- **There is a wasted fetch independent of the hang.** `fetchForSymbol` calls
  `pollAll()`, which polls both feeds and then discards 100% of the PR Newswire
  items at the filter. Even with both hosts healthy that request is pure waste on
  a stock page. Worth fixing on its own merits, not as a workaround.
- **Do not drop GlobeNewswire from `SOURCES`.** It is the sole ticker path, and
  it is now known to be healthy. Removing it would forfeit the one recoverable
  source of issuer-tagged per-symbol wire news.

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

## 6. GlobeNewswire is NOT blocked — the hang is ours

Probe run on `dpl_3H95tgd1hA3xWbhbtVTKAmvE5vPw` (`bf6e638`), 07:47Z:

| host | verdict | ms per round | status | bytes |
|---|---|---|---|---|
| globenewswire | `answers` | 157 / 38 / 28 | 200 ×3 | 31,368 ×3 |
| prnewswire | `answers` | 22 / 12 / 14 | 200 ×3 | 40,881 ×3 |
| gnews-control | `answers` | 326 / 10 / 7 | 200 ×3 | 123,354 ×3 |

Nine attempts, nine 200s, zero aborts, zero causes. **The control answered**, so
the function had real egress and the subject verdicts are meaningful.

**GlobeNewswire is reachable from Vercel and fast — 28 ms warm.** The 5,002 ms
hang is ours, not the network's. The same cause explains yesterday's 70,630 ms.

This overturns everything built on the block theory: no dropping the feed, no
stopping the per-symbol poll for structural reasons, no relay route. And a
per-feed timeout is not the fix either — it bounds a symptom whose cause is not
the network.

### What the probe does NOT establish

It changed **two** things at once versus `pollAll()`, so it proves reachability
and nothing about the hang:

| | render (`pollAll`) | probe |
|---|---|---|
| cache mode | `next: { revalidate: 3600 }` | `cache: "no-store"` |
| User-Agent | none | `MyStockHarbor/1.0 (…)` |

### Next: a 2×2 on globenewswire only

|  | no UA | UA set |
|---|---|---|
| `cache: "no-store"` | **A** | **B** — done: answers, 28 ms |
| `next: { revalidate: 3600 }` | **C** ← the render's exact configuration | **D** |

**C is the decisive cell.** C hangs + A answers ⇒ the Data Cache path. C hangs +
A hangs ⇒ the User-Agent.

**Leading hypothesis: the missing User-Agent.** WAFs that tarpit unidentified
clients produce exactly this signature — no bytes, no error, never settles, so
`endPoll()` never fires and no `wireFeed` line appears. Precedent is in this
repo: `SEC_USER_AGENT` exists because `sec.gov` is *"PASS with UA set"* and fails
without. It also explains the asymmetry without strain: prnewswire and gnews are
equally UA-less and both answer, because their edge does not care.

**A hypothesis to test, not a conclusion to implement.** The 2×2 runs before any
fix is written.

If it is the UA: fix it with a header on the wire fetches, reusing the
`SEC_USER_AGENT` convention rather than inventing a second mechanism. Expect the
cold stock render around 700 ms **with the ticker path intact** — better than any
outcome previously on the table. Keep the per-feed timeout afterwards as a
**backstop**, not as the fix: it is what stops the next silent host costing the
full adapter budget. Insurance, not a performance change.
