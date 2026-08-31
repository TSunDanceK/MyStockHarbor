# History payload audit: `MAX_CACHED_HISTORY_DAYS` is not a bandwidth control (2026-08-30)

Consumer audit after `claude/fmp-bandwidth-97pct-2026-08-30.md` put
`historical-price-eod/full` at 14.41 GB of a 19.56 / 20 GB cap. Audited against
`50eca92`.

## 1. The correction

An earlier draft assumed `MAX_CACHED_HISTORY_DAYS = 1400` sets the payload size.
**It does not.** The fetch at `historyCache.ts` was:

```ts
const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${...}&apikey=${...}`;
```

**No `from`. No `to`.** FMP sends its full default history, the bytes are paid for
on the wire, and *then* the excess is trimmed in memory:

```ts
const daily = parsed.length > MAX_CACHED_HISTORY_DAYS
  ? parsed.slice(-MAX_CACHED_HISTORY_DAYS) : parsed;
```

The constant is a **post-download trim**. It caps what Redis stores, not what FMP
bills. Lowering it to 730 or 365 cuts Redis storage and changes nothing on the
FMP meter.

## 2. The trim almost never fires — measured

The comment at `historyCache.ts` records production instrumentation from the
2026-08-24 forced warm: **831,564 rows parsed** across ~700 symbols = **~1,188
rows per symbol**. A second comment on the constant itself already states the
endpoint is bounded to ~1,250–1,260 trading days on this plan regardless of what
is asked for.

So FMP's default return is ~4.7 years — **below the 1,400 cap** — and the slice is
dead code in practice.

Cross-check: 184 KB ÷ 1,188 rows = **155 bytes/row**, the right size for a full
OHLCV JSON row. Measured bytes, measured row count and endpoint shape all agree.

## 3. What actually reads the depth

| Consumer | Depth | Notes |
|---|---|---|
| `computeMacroSupportResistanceCandidate` (`pickersBuilder.ts`) | `weeklyPoints.slice(-260)` = **260 weeks ≈ 1,300 trading days** | deepest; returns null only below 90 weeks, so degrades from ~450 days |
| `bullFlagsBuilder.ts` / `playsBuilder.ts` / `descendingTrianglesBuilder.ts` | `HISTORY_DAYS = 1300` | need high/low, so `/light` cannot serve them |
| `pickersBuilder.ts` | `LOOKBACK_BARS = 63` | ~3 months |
| ADV / volatility / RSI / ATR | 14–52 bars | trivial |

**1,300–1,400 days is genuinely requested by four call sites**, and FMP already
returns slightly less (1,188) than they ask for. The depth is not gratuitous —
"5.5 years for a momentum screener is surely too much" was wrong.

## 4. Why ~2.5 full-universe passes a day

Six independent full-universe consumers on the same Redis namespace:
`pickersBuilder` calls `getDailyHistoryBulk` at three sites; `bullFlagsBuilder`,
`playsBuilder` and `descendingTrianglesBuilder` each call per-symbol
`getDailyHistory`. TTL is 50h and one forced warm runs at `0 7 * * *`, which
accounts for ~1 pass/day. The other ~1.5 are cache misses and lock-loser
stampedes — the pickers single-flight hole.

## 5. The fix: incremental fetch

**The only levers that move FMP bytes are (a) bound the request, (b) call it less
often.** Depth cannot be cut without losing features; re-downloading unchanged
bars can be stopped without losing anything.

A closed daily bar is a finished fact. The only reason to re-read one is
**restatement** — a split or adjustment rewrites every close before its effective
date. So: request only bars at or after the newest one held, plus a short
overlap, and use the overlap to detect restatement.

| | |
|---|---|
| One full pass, 755 × 1,188 rows | **133 MB** |
| × ~2.5 passes/day × 30 | **9.7 GB/month** |
| Incremental, ~5 rows/symbol/day | **~17 MB/month** |
| Split repairs (~20 symbols/month × 184 KB) | ~4 MB |
| **Total** | **~20 MB — ~500× less** |

Redis still holds the same 1,188 rows/symbol. Every consumer reads exactly what
it read before. This changes how the data is REFRESHED, not what it contains.

**The overlap is a correctness guard, not an optimisation.** Appending blindly
stitches pre-split bars onto post-split bars and fabricates a gap — a 4:1 split
becomes a fake 75% crash in the chart and a false signal in every pattern builder.
Silent and wrong, which is worse than loud and expensive. `"unverifiable"` (no
shared dates) is deliberately not treated as agreement: that is exactly when a
restatement is most likely to have been missed. Both it and `"restated"` force a
full refetch.

Implemented in `lib/server/historyMerge.ts` (pure, so it can be tested without
Redis or Next in scope) and exercised by `scripts/check-history-merge.mjs`.

## 6. Notes for whoever reads the next warm run

`historyRowsParsed` drops from ~831k to a few thousand, because the parser now
sees only new rows. That is the change working, not the warm failing.

## 7. Open questions

- Chart ranges on `/stock/[symbol]`, `/dashboard`, `/api/history` and the SPX page
  were not audited to a specific bar count. That gates any per-caller windowing.
- Whether `from`/`to` bills by returned rows — near-certain (the debug route at
  `app/api/debug/fmp-endpoints/route.ts` already uses that form and its own
  comment notes "a SHORT WINDOW, not the full 1400 days… is ~180 KB"), but one
  debug call would confirm it.
- `/stable/eod-bulk` availability on Starter — unprobed. `stable/batch-quote`
  returned 402 in July (see the FMP endpoint matrix of 22 Jul),
  so bulk endpoints may be gated. Less important now that the incremental path
  makes the steady-state cost negligible.
