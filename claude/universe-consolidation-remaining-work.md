# Universe consolidation — what's done, and the one thing left

Written 2026-08-06 at the end of a long session. **Start here** if picking this
up fresh.

This file is the repo mirror (per CLAUDE.md's convention) so it is readable
straight from GitHub without opening Claude. The companion docs — the full
architecture audit and one doc per shipped PR — live in the Claude Project
**"My Stock Harbor Website"**, not in this repo. Everything load-bearing is
inlined below, so this file stands alone if you cannot reach them.

Repo: `TSunDanceK/MyStockHarbor` · Vercel project: `mystockharbor`

## Shipped and verified live — all seven

| PR | what | verified |
|---|---|---|
| #214 `c96f755` | chart series off the cached payload | Redis write 3.38MB → 0.51MB; 260/260 charts intact |
| #215 `74e652e` | dynamic universe JSON blob → Redis ZSETs | 20 concurrent increments: v1 kept 1 of 20 (95% lost), v2 kept 20 |
| — `60e7c6e` | fix debug route racing its own seed | — |
| #216 `fd56a4d` | four duplicate `PRESET_UNIVERSE` copies → one module | −318/+4 lines; identical in content AND order |
| #217 `a718390` | warm jobs target displayed ∪ dynamic universe | `targets: 416 (displayed 416, universe 353)` |
| #218 `3206dcd` | cap 260→450, build timing, explicit `maxDuration` | `universe 416, 0 failed, 6232ms` |
| #219 `e56776d` | cap 450→700 | rebuild 13:40:45Z: `universe 416, 0 failed, 6021ms` |

`#219` verified as intended: universe stayed 416 because the **pool** (353) is
the limiter, not the cap. No regression, ceiling removed.

## Final live numbers (2026-08-06 13:40Z)

```
universe scanned      416    (cap 700; pool 353 is the limiter)
records / withCharts  416 / 416, 0 without
failed symbols        0
build duration        6,021ms              (300s limit -- 2% of budget)
Redis payload write   682KB / 784KB wire   (10MB limit -- 8%)
chart store           416 symbols
price full coverage   ~12 min              (priceCap auto-sized to 104)
dynamic universe ZSET 353 / 353 in step, no legacy fallback, top score 4804
```

## THE ONE THING LEFT — and it is not what we thought

The goal was "stop having two universes." Six of the seven steps above were
prerequisites, not the collapse itself. On finally reading
`app/api/market/route.ts` properly, the framing was **wrong**:

**`state.dynamic` is not a duplicate universe. It is a QUOTE CACHE.**

```ts
state.dynamic[symbol] = { quote: q, discoveredAt: now };        // line ~913
const quotes = Object.values(state.dynamic).map(r => r.quote);  // line 942
const rows = buildRowsFromQuotes(quotes);
// -> topTraded / topMovers / topRanges  (the homepage movers tables)
```

Its *keys* happen to form a universe, which is why it read as a second one. But
its *values* are the last-known quote per symbol, and those drive the homepage.
Deleting it would break the movers tables.

### Job A — ZSET becomes the single source of truth for MEMBERSHIP (~10 lines)

Discovery admits a symbol into `state.dynamic`, and only later does a *builder*
copy that set into the ZSET (`pickersBuilder` line ~2278). So the ZSET is
populated as a side effect of a page build rather than at discovery time.

Fix: in `app/api/market/route.ts`, collect symbols admitted during the discovery
loop and call `addToDynamicUniverse(admitted, "market")` directly. Then
`state.dynamic` is demoted to purely a quote cache and stops being a universe
definition at all.

Optionally follow by removing `accumulatedDynamicUniverse` from
`pickersBuilder`'s assembly, since the ZSET would already contain those symbols.
That IS a behaviour change — verify universe size before and after.

### Job B — retire the quote cache (bigger, riskier, scope first)

`msh:price-pool:v1` already stores `{price, changePct, volume, marketCap, pe}`
per symbol with ~12-min full coverage. The movers tables could come from it, and
then `state.dynamic` disappears entirely — genuinely ONE store.

**Do not start casually.** It moves the homepage's movers pipeline onto a
different data source, and the price pool carries no `open`/`dayHigh`/`dayLow`,
so `topRanges` in particular may want fields the pool does not have. Check
`buildRowsFromQuotes`'s field requirements before committing to this.

## Higher-value than Job A, if choosing

Narrow the chart re-attach to only the symbols a page actually draws. **List
view is the default and draws ZERO charts; chart view draws 21
(`CHART_PAGE_SIZE`). Yet all 416 series ship on every render.** Changes render
paths, so it wants its own PR.

Also open and **pre-existing**: `/bullish-divergence-stocks` and
`/bearish-divergence-stocks` render 20 empty charts (they read
`item.chartPoints` only, and the Divergence section is built without
`keepChartPoints`). The comment in `pickersBuilder` claiming they fall back to a
`signalRecords` lookup is **wrong**.

## Things learned worth not relearning

- **Preview and production share one Upstash.** The key version is the only
  thing separating payload shapes. Bump it on any shape change. Nearly caused a
  site-wide blanking on #214.
- **Previews cannot cold-build pickers** — a preview rebuilding has to fetch
  `/api/market` on the production domain and that cross-origin request is
  refused. Preview testing is near-useless for this subsystem; verify on
  production immediately post-merge with a fast revert ready.
- **A local redis-server behind a ~50-line Upstash REST shim** is the way to
  test Redis-layer changes properly. Trap: the client sends
  `Upstash-Encoding: base64` and decodes responses, so a shim returning raw
  strings makes every value come back as garbage that looks like a code bug.
  Cost ~20 min chasing a non-existent bug.
- **Forcing a pickers rebuild needs `?force=1&key=<EARNINGS_BACKFILL_KEY>`.**
  The Vercel cron "Run" button does NOT rebuild — the handler serves the cache.
  Without the key, waiting out the 1h TTL is the only option.
- **`hasFmpCapacity` is TOCTOU-racy** (plain GET, compare, no reservation).
  `reserveFmpCallSlot` is safe (atomic INCR). Still unfixed — matters if the
  warm loops are ever parallelised.
- **`warm-stock-data` full coverage scales linearly** with universe size
  (FIXED 25/run): ~1.7h at 260, ~2.8h at 416, ~4.7h at 700.
  `REFRESH_SLICE_SIZE` is the dial, ~8 FMP calls per symbol.
- The stop-hook "unpushed commits" warning fires constantly because pushes go
  through the GitHub API, not `git push` (the proxy withholds credentials for
  this repo). Verify against `origin/main` rather than dismissing it.

## Verification endpoints

Both need Chrome via the browser tools — `WebFetch` is blocked for
`mystockharbor.com`, so a session with no connected browser can still read
Vercel runtime logs but cannot check a rendered page.

| endpoint | reports |
|---|---|
| `/api/debug/pickers-size` | payload size (`strippedPayloadChars` is the figure that counts against the 10MB limit), records, withCharts, chart store |
| `/api/debug/universe-size` | ZSET cardinalities, whether they are in step, whether the legacy fallback is serving |

Key log lines to grep in Vercel runtime logs:

```
[pickers] build complete: universe N, N records, N failed, Nms
[warm-price-pool] targets: N (displayed D, universe U)
[picker-charts] chunk ... failed          <- should never appear
[dynamic-universe] v2 returned nothing    <- should never appear
```
