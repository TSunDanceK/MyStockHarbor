# Universe consolidation — COMPLETE (2026-08-06)

The universe grows for the first time in months and is now equities-only.

Repo mirror (per CLAUDE.md's convention) so it is readable from GitHub without
opening Claude. Per-PR docs live in the Claude Project **"My Stock Harbor
Website"**. Everything load-bearing is inlined here.

Repo: `TSunDanceK/MyStockHarbor` · Vercel project: `mystockharbor`

## The root cause — none of the things we assumed

The universe sat at exactly 353 for months. Three wrong hypotheses: not the cap
(raised 260→450→700, no effect), not FMP starvation
(`fmpCapacityAvailable: true`), not the two-store split.

**Actual cause:** `buildExpandedDiscoveryMasterList` called three FMP
constituent endpoints (`sp500`/`nasdaq`/`dowjones-constituent`). All three answer
`402 Restricted Endpoint: not available under your current subscription`, and
`fetchFmpConstituentSymbols` swallowed the non-ok response into `[]` — so they
failed **silently on every rebuild**. The master list was always the 407-name
static fallback.

The arithmetic was exact:

```
pool 353  +  CURATED_UNIVERSE 54  =  407  =  masterListSize
```

`getNextDiscoveryBatch` skips already-admitted **and** curated names, so every
name was one or the other. Discovery had nothing left to find, permanently.

**A comment above that code said the 402 was harmless** because it would
"auto-recover the moment the FMP plan includes them." That comment is a large
part of why this survived. Rewritten.

## The fix, and the three follow-on problems it caused

Probed the plan directly via a new `/api/debug/fmp-endpoints` route rather than
guessing. `company-screener` **is** available and returns 1000 symbols; the
constituent endpoints are confirmed 402. Discovery now uses the screener.

Each of the next three problems was found only because the previous fix landed.

**1. The screener fix was latent.** Lowering `MIN_DYNAMIC_MASTER_SIZE` 500→350
(needed, see below) made the early-return in `ensureDailyShuffledMasterList`
start firing — which then accepted the **stale 407-name list** and skipped the
rebuild that would call the screener. Fixed with `MASTER_LIST_SOURCE_VERSION`,
now part of the early-return condition and stamped onto stored state.
**A stored artifact should carry the version of the code that produced it.**

**2. `warm-price-pool` started timing out.** Confirmed live:
`16:45:17 GET /api/jobs/warm-price-pool 504 — Task timed out after 60 seconds`.
The price slice is `ceil(universe/4)`, so 416→663 pushed it to **166 sequential
FMP calls inside a 60s function**. Most runs squeaked through; that one didn't
and the whole run was discarded. `maxDuration` 60→300 on `warm-price-pool` and
`warm-stock-data` (the latter is arguably more exposed: 25 × 8 = ~200 sequential
calls per run, a fixed cost independent of universe size).

**3. 42.5% of the screener results were MUTUAL FUNDS.** Measured:
425 of 1000 — VTSAX, VFIAX, VFINX and friends — being admitted into a stock
screener. Market cap + exchange + actively-trading filters do **not** exclude
funds. `isEtf=false&isFund=false` returns a full 1000 with **zero** fund-like
symbols, so the exclusion costs no coverage.

Fixing the filter stopped new ones arriving but not the ones already in. So the
master-list rebuild now **reconciles**: any pooled symbol no longer a candidate,
and not curated, is evicted from both `state.dynamic` and the universe ZSET.
Curated names are exempt (discovery deliberately skips them, so they would be
evicted every rebuild otherwise). Guarded by the existing
`MIN_DYNAMIC_MASTER_SIZE` acceptance check, so one bad fetch cannot cause a mass
eviction.

Live result:

```
[market] reconciled pool against rebuilt master list: evicted 178
         no-longer-candidate symbols (178 removed from the shared universe), pool now 475
[market] discovery admitted 50 symbols (attempted 50, qualified 50, rejected 0, pool 525)
```

Stalest sample went from `["AAGTX","AALTX","ACN",...]` to
`["ACN","AEM","AMT","AU","AWK","BNY","CCJ","EPD","EXR","FERG"]` — all equities.

## Other bug found on the way

**Pointer reset on every request.** `MIN_DYNAMIC_MASTER_SIZE` was 500 but the
list could only ever be 407, so the early-return never fired: every request
rebuilt the list, reshuffled it and reset `state.pointer = 0`. Discovery never
walked systematically. Now 350.

**Scan footer showed UTC unlabelled.** `formatUpdatedAt` called `toLocaleString`
with no `timeZone` in a server component, where Vercel's Node defaults to UTC —
so UK visitors on BST read it an hour behind and a 24-minute-old payload looked
84 minutes old, i.e. past its TTL. Now renders `06 Aug, 15:45 UTC`.

## All PRs / commits

| ref | what |
|---|---|
| #214 `c96f755` | chart series off the cached payload (Redis write 3.38MB → 0.51MB) |
| #215 `74e652e` | dynamic universe blob → Redis ZSETs (v1 lost 95% of concurrent increments) |
| #216 `fd56a4d` | four duplicate `PRESET_UNIVERSE` copies → one module |
| #217 `a718390` | warm jobs target displayed ∪ universe |
| #218 `3206dcd` | cap 260→450, build timing, `maxDuration` on pickers routes |
| #219 `e56776d` | cap 450→700 |
| #220 `20263c6` | pointer-reset fix + Job A (discovery writes the ZSET directly) |
| #221 `549a64e` | company-screener replaces the dead constituent endpoints |
| #222 `c48da58` | version the master list source |
| #223 `bc28fe6` | label the scan footer timestamp as UTC |
| `47fbcee` | maxDuration 60→300 on the two warm jobs (fixes the 504) |
| `92293cf` | exclude funds/ETFs + reconcile-and-evict |

## Live state (2026-08-06 ~17:55Z)

```
pool                  525   equities only, climbing to the 700 cap
masterList           1050   (was 407)
masterListVersion       3
dynamic universe ZSET 525 / 525 in step, no legacy fallback
scan universe         663   (last pickers rebuild; follows the pool hourly)
build duration      9,091ms at universe 663   (300s limit)
Redis payload write   934KB                    (10MB limit)
```

## Two clocks — important when reading the footer

The footer is a **snapshot from the last payload build**, not live values.

- **Discovery** grows the pool every ~5 min (gated on FMP headroom).
- **The pickers payload** has a 1h TTL, so the footer lags by up to an hour.

The `warm-price-pool` cron calls `getPickersData()` every 3 min, so the moment
the TTL lapses the next heartbeat rebuilds — that is already the "heartbeat"
mechanism. `PICKERS_REDIS_TTL_SECONDS` is the dial if tighter tracking is wanted;
each rebuild is a full scan (9.1s at 663) plus FMP history for uncached symbols.

## Still open

- **`state.dynamic` is a QUOTE CACHE, not a duplicate universe.** Its values feed
  `buildRowsFromQuotes` → `topTraded`/`topMovers`/`topRanges`. Retiring it means
  moving the homepage movers onto `msh:price-pool:v1` — scope before starting.
- **`topRanges` is dead in production.** `buildRowsFromQuotes` sets
  `rangePct: null` unconditionally and `topRanges` filters `rangePct != null`, so
  it is always `[]`. Implement or remove.
- **Chart re-attach is over-broad.** List view is the default and draws ZERO
  charts; chart view draws 21. Every series ships on every render.
- **Divergence pages render 20 empty charts** (pre-existing).
- **`hasFmpCapacity` is TOCTOU-racy** — plain GET, compare, no reservation.
  `reserveFmpCallSlot` is safe (atomic INCR). Blocks bounded-concurrency fetching,
  which is the proper fix for the sequential-call problem that caused the 504.
- **Market-hours gating on the price pool.** It refreshes every 3 min around the
  clock, but FMP's quote endpoint is static outside US market hours — roughly 75%
  of runs re-fetch identical data. Gating would cut waste and free FMP headroom
  for discovery overnight.

## Things learned worth not relearning

- **A silently-swallowed error plus a reassuring comment hid this for months.**
  When an integration fails open, LOG the failure.
- **Verify plan capabilities, don't infer them.** `/api/debug/fmp-endpoints`
  answered in one request what had been guessed at three different ways.
- **Market cap + exchange filters do not exclude funds.** Always `isEtf=false&isFund=false`.
- **Fixing one constraint reveals the next.** Each of the three follow-on problems
  was invisible until the previous fix landed. Budget for that.
- **Preview and production share one Upstash.** Key/version the stored artifact.
- **Previews cannot cold-build pickers** — a preview must fetch `/api/market` on
  the production domain and that is refused. Verify on production post-merge.
- **A local redis-server behind a ~50-line Upstash REST shim** tests Redis-layer
  changes properly. Trap: the client sends `Upstash-Encoding: base64`, so a shim
  returning raw strings makes every value come back as garbage.
- **Forcing a pickers rebuild needs `?force=1&key=<EARNINGS_BACKFILL_KEY>`.** The
  Vercel cron "Run" button does NOT rebuild — the handler serves the cache.

## Verification endpoints

Need Chrome — `WebFetch` is blocked for the domain and previews sit behind Vercel
SSO. A session without a browser can still read Vercel runtime logs.

| endpoint | reports |
|---|---|
| `/api/market` | `dynamicUniverseSize`, `masterListSize`, `debug.pointer`, `debug.masterListVersion`, `discoveryReason` |
| `/api/debug/universe-size` | ZSET cardinalities, in-step, legacy-fallback flag, stalest sample |
| `/api/debug/pickers-size` | `strippedPayloadChars` (the figure against the 10MB limit), records, withCharts |
| `/api/debug/fmp-endpoints` | which FMP endpoints this plan serves, symbol counts, `fundLikeSymbols` |

Log lines worth grepping:

```
[market] discovery admitted N symbols -> dynamic universe (attempted A, qualified Q, rejected R, pool P)
[market] reconciled pool against rebuilt master list: evicted N ...
[pickers] build complete: universe N, N records, N failed, Nms
[warm-price-pool] targets: N (displayed D, universe U)
[picker-charts] chunk ... failed          <- should never appear
[dynamic-universe] v2 returned nothing    <- should never appear
```
