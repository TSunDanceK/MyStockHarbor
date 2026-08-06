# NEXT SESSION — the FMP screener multi-field opportunity

Written 2026-08-06 ~18:30Z at the end of a long session. **Read this first.**
Background on how we got here: `claude/universe-consolidation-remaining-work.md`
(same folder). This file is the forward-looking task.

Repo: `TSunDanceK/MyStockHarbor` · Vercel project: `mystockharbor`

---

## Where things stand right now

The universe work finished today and is healthy:

```
scan universe         700   <- at the cap, goal reached
records / withCharts  700 / 700, 0 without
Redis payload write   958KB (10MB limit)
pool                  575   equities only, still climbing to 700
masterList           1050   (was 407)
masterListVersion       3
dynamic universe ZSET 575 / 575 in step, no legacy fallback
```

Nothing is broken. Nothing is urgent. This is an optimisation task.

---

## The finding

The codebase states, in `lib/server/stockDataCache.ts`:

> *"FMP Starter plan reality (all confirmed 200 via app/api/debug probes,
> 2026-07-23): no multi-symbol endpoint works, so every field is per-symbol."*

**That is true for `quote`, `profile` and `ratios-ttm`. It is NOT true for
`stable/company-screener`, and nothing in the code knew that.**

One call returns up to 1000 rows, each carrying:

```json
{
  "symbol": "NVDA", "companyName": "NVIDIA Corporation",
  "marketCap": 5343588578000, "sector": "Technology",
  "industry": "Semiconductors", "beta": 2.211,
  "price": 220.618, "lastAnnualDividend": 0.28,
  "volume": 78249850.12181, "exchange": "NASDAQ Global Select",
  "exchangeShortName": "NASDAQ", "country": "US",
  "isEtf": false, "isFund": false, "isActivelyTrading": true
}
```

Verify it yourself at **`/api/debug/fmp-endpoints`** — it reports `rowKeys` and
`sampleRow` for every probe. Needs Chrome (`WebFetch` is blocked for the domain).

The screener is already called once per master-list rebuild in
`app/api/market/route.ts` (`fetchFmpScreenerSymbols`), but **it throws away
every field except `symbol`.**

---

## STEP 1 — verify what `price` and `volume` actually mean. Do this first.

**Do not skip this.** `"volume": 78249850.12181` is fractional. You cannot trade
0.12 of a share, so that is almost certainly an **average** volume, not the
current session's. If volume is averaged, `price` may be lagged too.

How to check:

1. Pick 3-4 symbols across different liquidity levels (e.g. NVDA, F, a mid-cap).
2. Compare the screener's `price` and `volume` against the same symbols in
   `msh:price-pool:v1` (visible on any screener page's Stock Price / Volume
   columns, which come from the pool's live-ish quote).
3. Also compare against `stable/most-actives`, which returns real
   `price` / `change` / `changesPercentage` for 50 symbols.

Write down the answer. It decides everything below.

---

## STEP 2 — the win that is almost certainly real: `warm-fundamentals`

`lib/server/fundamentalsCache.ts` fetches **market cap, PE and industry
per symbol**. Its industry backfill is capped at 120 misses per run on a daily
cron — that is the job that starved in July (PR #207) and takes days to cover
newly discovered symbols. With the universe now at 700 that tail is longer.

`marketCap`, `sector` and `industry` are **static-ish data that does not need to
be live**, and the screener returns all three for 1000 symbols in one call.

So: fetch the screener once, build a `symbol -> {marketCap, sector, industry,
beta, lastAnnualDividend}` map, and use it to satisfy those fields for the whole
universe. Fall back to the existing per-symbol path only for symbols the screener
did not return (anything below `SCREENER_MIN_MARKET_CAP`, or non-US).

**This is worth doing regardless of what Step 1 finds**, because none of these
fields are price-sensitive. Expect it to turn hundreds of calls into one and to
remove the industry-coverage tail entirely.

PE is **not** in the screener — it still needs `ratios-ttm` per symbol, or can be
derived if you have price and EPS. Do not assume it comes free.

---

## STEP 3 — the maybe: `warm-price-pool`

`warmPricePool` makes `ceil(universe/4)` sequential quote calls per run —
currently ~175 at a 700 universe, every 3 minutes. It is the single largest
consumer of the FMP budget and it caused a **live 504 today** (fixed by raising
`maxDuration` to 300, but that treats the symptom).

The screener cannot replace it outright: **there is no `changesPercentage`
field**, and no previous close to derive it from, so the % change column has no
source there.

But depending on Step 1, it might still:

- give **cold** symbols (just rotated in, never warmed) a baseline price and
  market cap immediately rather than waiting up to 12 minutes for the rotation
- reduce how often the full per-symbol sweep is actually needed

**Do not rewire the price pool to averaged data.** If Step 1 shows `price` is
lagged or `volume` is an average, use it only as a cold-start fallback, never as
the displayed live price. The site's ~15-min delayed positioning is deliberate
(it keeps FMP display licensing in the cheaper bucket) but "delayed" is not the
same as "wrong", and a fabricated volume figure is worse than a blank cell.

---

## Working style that worked today

- **PR → wait for green Vercel preview → merge → verify on production.**
  Previews cannot cold-build pickers (a preview must fetch `/api/market` on the
  production domain and that is refused), so preview builds prove compilation
  only. Real verification happens on production, immediately after merge, with a
  revert ready.
- **Verify capabilities, do not infer them.** `/api/debug/fmp-endpoints` answered
  in one request what had been guessed at three different ways. Extend it rather
  than reasoning about what FMP "probably" supports.
- **Check what an endpoint RETURNS, not just that it works.** Today's worst bug
  was shipping a stock screener that was 42.5% mutual funds, because the probe
  only checked for a 200 and extracted `symbol`. The probe now reports
  `fundLikeSymbols`, `rowKeys` and `sampleRow` for exactly this reason.
- **Push notes:** `git push` is blocked for this repo from the Claude sandbox
  (the proxy withholds credentials), so pushes go through the GitHub API. The
  stop-hook "unpushed commits" warning fires constantly as a result — verify
  against `origin/main` rather than dismissing it.

## Verification endpoints (all need Chrome)

| endpoint | reports |
|---|---|
| `/api/debug/fmp-endpoints` | which FMP endpoints this plan serves, symbol counts, `fundLikeSymbols`, `rowKeys`, `sampleRow` |
| `/api/market` | `dynamicUniverseSize`, `masterListSize`, `debug.pointer`, `debug.masterListVersion`, `discoveryReason` |
| `/api/debug/universe-size` | ZSET cardinalities, in-step, legacy-fallback flag, stalest sample |
| `/api/debug/pickers-size` | `strippedPayloadChars` (the figure against the 10MB limit), records, withCharts |

Log lines worth grepping in Vercel runtime logs:

```
[market] discovery admitted N symbols -> dynamic universe (attempted A, qualified Q, rejected R, pool P)
[market] reconciled pool against rebuilt master list: evicted N ...
[pickers] build complete: universe N, N records, N failed, Nms
[warm-fundamentals] {...}
[warm-price-pool] targets: N (displayed D, universe U)
```

## Other open items (lower priority)

- **`topRanges` is dead in production** — `buildRowsFromQuotes` sets
  `rangePct: null` unconditionally and `topRanges` filters `rangePct != null`, so
  it is always `[]`. Implement or remove.
- **Chart re-attach is over-broad** — list view is the default and draws ZERO
  charts; chart view draws 21 (`CHART_PAGE_SIZE`). Every series ships on every
  render.
- **Divergence pages render 20 empty charts** (pre-existing) — they read
  `item.chartPoints` only and the section is built without `keepChartPoints`.
- **`hasFmpCapacity` is TOCTOU-racy** (plain GET, compare, no reservation).
  `reserveFmpCallSlot` is safe (atomic INCR). This blocks bounded-concurrency
  fetching, which is the proper fix for the sequential-call problem behind
  today's 504.
- **Market-hours gating on the price pool** — it refreshes every 3 min around the
  clock but FMP's quote endpoint is static outside US market hours, so ~75% of
  runs re-fetch identical data. Would cut real waste and free FMP headroom for
  discovery overnight.
- **`state.dynamic` is a QUOTE CACHE, not a duplicate universe** — its values feed
  `buildRowsFromQuotes` → the homepage movers. Retiring it means moving those
  onto `msh:price-pool:v1`. Scope before starting.
