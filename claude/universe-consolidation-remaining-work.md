# Universe consolidation — COMPLETE (2026-08-06)

The universe is growing for the first time: **353 → 403 → 453**, climbing toward
the 700 cap at 50 per 5-minute discovery run.

This file is the repo mirror (per CLAUDE.md's convention) so it is readable from
GitHub without opening Claude. Companion per-PR docs live in the Claude Project
**"My Stock Harbor Website"**. Everything load-bearing is inlined here.

Repo: `TSunDanceK/MyStockHarbor` · Vercel project: `mystockharbor`

## The root cause — none of the things we assumed

The universe sat at exactly 353 for months. Three hypotheses were wrong:

1. **Not the cap.** `UNIVERSE_CAP` was 260, raised to 450, then 700. No effect.
2. **Not FMP starvation.** `fmpCapacityAvailable: true` throughout.
3. **Not the two-store split.** Real duplication, but not what capped anything.

**The actual cause:** `buildExpandedDiscoveryMasterList` called three FMP
constituent endpoints (`sp500-constituent`, `nasdaq-constituent`,
`dowjones-constituent`). All three answer:

```
402 Restricted Endpoint: This endpoint is not available under your current subscription
```

`fetchFmpConstituentSymbols` swallowed the non-ok response into `[]`, so all
three failed **silently, on every rebuild**. The master list was always the
static fallback: **407 names**.

And the arithmetic was exact:

```
pool 353  +  CURATED_UNIVERSE 54  =  407  =  masterListSize
```

`getNextDiscoveryBatch` skips anything already admitted **and** anything curated.
With a 407-name list, every name was one or the other — so discovery had
literally nothing left to find, permanently.

**A comment above that code said the 402 was harmless** because the call would
"auto-recover the moment the FMP plan includes them." That comment is a large
part of why this went unnoticed. It has been rewritten.

## The fix

Probed the plan directly (`/api/debug/fmp-endpoints`, added for this):

| endpoint | status | symbols |
|---|---|---|
| `sp500-constituent` | **402** | 0 |
| `nasdaq-constituent` | **402** | 0 |
| `dowjones-constituent` | **402** | 0 |
| `most-actives` (control) | 200 | 50 |
| **`company-screener`** | **200** | **1000** |
| `stock-list` | 200 | 38,674 |

`company-screener` **is** available. Discovery now uses it
(`marketCapMoreThan=1e9`, `exchange=NASDAQ,NYSE`, `isActivelyTrading=true`,
`limit=1000`) unioned with the static lists. One working call replaces three
failing ones — it also **saves 2 FMP calls per rebuild**.

`stock-list` returns the whole 38k directory including OTC junk; deliberately not
used. `SCREENER_MIN_MARKET_CAP` is the dial if the net needs widening (probing
showed `300000000` also returns a full page).

## Two bugs found on the way

**Pointer reset every request.** `MIN_DYNAMIC_MASTER_SIZE` was 500 but the list
could only ever be 407, so the early-return in `ensureDailyShuffledMasterList`
never fired. Every request rebuilt the list, reshuffled it, and reset
`state.pointer = 0` — discovery never walked systematically. Now 350.

**The screener fix was latent.** Fixing the above made the early-return start
firing, which then accepted the **stale 407-name list** and skipped the rebuild
that would call the screener. `masterListSize` stayed 407 after deploy.
Fixed with `MASTER_LIST_SOURCE_VERSION`, now part of the early-return condition
and stamped onto stored state — same principle as versioning a Redis key when
its payload shape changes. **A stored artifact should carry the version of the
code that produced it.**

## All PRs shipped and verified live

| PR | what | verified |
|---|---|---|
| #214 `c96f755` | chart series off the cached payload | Redis write 3.38MB → 0.51MB; 260/260 charts intact |
| #215 `74e652e` | dynamic universe blob → Redis ZSETs | 20 concurrent increments: v1 kept 1 of 20 (95% lost), v2 kept 20 |
| — `60e7c6e` | fix debug route racing its own seed | — |
| #216 `fd56a4d` | four duplicate `PRESET_UNIVERSE` copies → one | −318/+4; identical in content AND order |
| #217 `a718390` | warm jobs target displayed ∪ universe | `targets: 416 (displayed 416, universe 353)` |
| #218 `3206dcd` | cap 260→450, build timing, `maxDuration` | `universe 416, 0 failed, 6232ms` |
| #219 `e56776d` | cap 450→700 | `universe 416, 0 failed, 6021ms` |
| #220 `20263c6` | pointer-reset fix + Job A (discovery writes ZSET) | `masterListChanged` true → false |
| #221 `549a64e` | company-screener replaces dead endpoints | masterListSize 407 → **1151** |
| #222 `c48da58` | version the master list source | `masterListVersion: 2`, rebuild fired |

## Live state (2026-08-06 15:55Z, still climbing)

```
pool                  453   (was 353 for months; +50 per 5-min run, cap 700)
masterListSize       1151   (was 407)
masterListVersion       2
pointer               136   (was permanently 0)
last discovery        attempted 50, qualified 50, rejected 0
dynamic universe ZSET 453 / 453 in step, no legacy fallback
build duration      6,021ms at universe 416   (300s limit)
Redis payload write   682KB / 784KB wire      (10MB limit)
```

The ZSET tracking the pool exactly (453/453) is Job A working — membership now
lands at discovery time rather than waiting for a page build.

## What to expect

Pool climbs to 700 (`DYNAMIC_MAX_SIZE`) in ~25 minutes, then stops with
`discoveryReason: "dynamic_universe_full"`. The scan universe follows on the next
pickers rebuild (1h TTL), landing near 700 rather than 416.

Watch: build duration should go ~6s → ~10s, payload ~682KB → ~1.2MB, both far
inside limits. `warm-price-pool` self-sizes so price coverage stays ~12 min.

**The one thing that genuinely stretches:** `warm-stock-data` uses a FIXED
25-symbol slice, so full coverage of valuation/dividend/analyst data goes to
roughly **5 hours** at a 700+ universe (was ~1.7h at 260). `REFRESH_SLICE_SIZE`
is the dial, ~8 FMP calls per symbol.

## Still open

- **`state.dynamic` is a QUOTE CACHE, not a duplicate universe.** Its values feed
  `buildRowsFromQuotes` → `topTraded`/`topMovers`/`topRanges`. Retiring it means
  moving the homepage movers onto `msh:price-pool:v1` — scope before starting.
- **`topRanges` is dead in production.** `buildRowsFromQuotes` sets
  `rangePct: null` unconditionally (line ~798) and `topRanges` filters
  `rangePct != null`, so it is always `[]`. Decide whether to implement or remove.
- **Chart re-attach is over-broad.** List view is the default and draws ZERO
  charts; chart view draws 21 (`CHART_PAGE_SIZE`). Yet every series ships on
  every render. Largest remaining inefficiency.
- **Divergence pages render 20 empty charts** — pre-existing. They read
  `item.chartPoints` only and the section is built without `keepChartPoints`.
- **`hasFmpCapacity` is TOCTOU-racy** (plain GET, compare, no reservation).
  `reserveFmpCallSlot` is safe (atomic INCR). Matters if warm loops are ever
  parallelised.

## Things learned worth not relearning

- **A silently-swallowed error plus a reassuring comment hid this for months.**
  `fetchFmpConstituentSymbols` returned `[]` on 402 and a comment said that was
  fine. When an integration "fails open", log the failure.
- **Preview and production share one Upstash.** The key version is the only thing
  separating payload shapes. Nearly caused a site-wide blanking on #214.
- **Previews cannot cold-build pickers** — a preview has to fetch `/api/market`
  on the production domain and that is refused. Verify on production post-merge
  with a fast revert ready.
- **A local redis-server behind a ~50-line Upstash REST shim** tests Redis-layer
  changes properly. Trap: the client sends `Upstash-Encoding: base64`, so a shim
  returning raw strings makes every value come back as garbage.
- **Forcing a pickers rebuild needs `?force=1&key=<EARNINGS_BACKFILL_KEY>`.** The
  Vercel cron "Run" button does NOT rebuild — the handler serves the cache.
- Stop-hook "unpushed commits" warnings fire constantly because pushes go through
  the GitHub API, not `git push`. Verify against `origin/main`.

## Verification endpoints

Need Chrome — `WebFetch` is blocked for `mystockharbor.com` and previews sit
behind Vercel SSO. A session without a browser can still read Vercel runtime logs.

| endpoint | reports |
|---|---|
| `/api/market` | `dynamicUniverseSize`, `masterListSize`, `debug.pointer`, `debug.masterListVersion`, `discoveryReason` |
| `/api/debug/universe-size` | ZSET cardinalities, in-step, legacy fallback flag |
| `/api/debug/pickers-size` | `strippedPayloadChars` (the figure against the 10MB limit), records, withCharts |
| `/api/debug/fmp-endpoints` | which FMP endpoints this plan serves, with symbol counts |

Log lines worth grepping:

```
[market] discovery admitted N symbols -> dynamic universe (attempted A, qualified Q, rejected R, pool P)
[pickers] build complete: universe N, N records, N failed, Nms
[warm-price-pool] targets: N (displayed D, universe U)
[picker-charts] chunk ... failed          <- should never appear
[dynamic-universe] v2 returned nothing    <- should never appear
```
