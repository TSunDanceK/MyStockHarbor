# chartPoints: what actually depends on them

**For the UI session.** The number people reach for is the byte count. The number
that decides the design is the dependency, and it is not what it looks like.

---

## The size, so it is not the interesting part

`buildPickerChartPoints(points, bars = 72)` — **72 bars per symbol**, each
carrying `date`, `open`, `high`, `low`, `close`, `volume`, `ma50`, `ma200`,
`rsi14`, `macdHist`.

`splitPickersPayload`'s own note measured **3.38 MB at a 260-symbol universe on
2026-08-06, of which 2.86 MB was chartPoints**, and records that the share grows
linearly with the cap. That is ~153 bytes/bar. At today's 700-symbol universe:

    700 symbols x 72 bars x ~153 bytes  ~=  7.7 MB

85% of the payload, and the part that scales with the universe.

## The trap: they are NOT purely presentational

The obvious move — "load chart points per row on demand" — **breaks two things
that have nothing to do with charts**, both in `PickerResultsGrid.tsx`:

    // Price / % change / volume come from the ~15-min price pool when present
    // (attached server-side), falling back to the end-of-day close/volume from
    // chartPoints on a pool miss. 200 MA always comes from chartPoints.

1. **The 200 MA column.** `deriveRow` reads `last.ma200`. There is no other
   source for it in the payload. Lazy-loading bars empties that column for every
   row that has not loaded.

2. **The price-pool-miss fallback.** When the 15-minute pool has no entry for a
   symbol, price / change % / volume fall through to `chartPoints`. This is not
   theoretical: it is the fix for INTC and NVDA both showing **Volume 0** on the
   screener while every other row had a real figure. Remove the fallback source
   and that regression returns, in exactly the rows least likely to be noticed.

## What each consumer actually needs

| consumer | needs | for how many rows |
|---|---|---|
| `deriveRow` — price, change %, volume, **200 MA** | the **last 2 bars** (`last.ma200`, `last.close`, `last.volume`, `prev.close`) | **every row** |
| `sparkCloses` | last **40 closes** | visible rows |
| candle chart | all 72 bars | `CHART_PAGE_SIZE = 21` |

`LIST_PAGE_SIZE = 30`, `CHART_PAGE_SIZE = 21`.

## The shape that works

**Ship four scalars per symbol** — `price`, `changePct`, `volume`, `ma200` —
computed server-side from the two bars the builder already has, and fetch bars on
demand for the rows actually rendered.

That drops roughly **70 of 72 bars per symbol**, so ~7.5 of the ~7.7 MB, while
the table keeps everything it depends on. It also means the row data no longer
carries an implicit dependency on a rendering concern, which is the real defect:
`deriveRow` reaching into a chart series for a moving average is why the obvious
optimisation is dangerous.

## Two things to keep

- **Compute the scalars, do not re-derive them client-side from a truncated
  series.** A 2-bar series produces a `ma200` of `null`, not an error, so the
  column would go quietly empty rather than fail — the shape this repo keeps
  paying for.
- **Volume and price treat 0 as MISSING, not as data.** See the comment at
  `deriveRow`: a listed stock never trades exactly 0 shares. Whatever replaces
  the fallback has to preserve that, or INTC and NVDA go back to Volume 0.

## Related

- `app/pickers/page.tsx` — its payload read went in-process 2026-08-24, which
  removed an 8 MB HTTP round trip per render but **not** the 8 MB itself. This
  document is the other half.
- `lib/server/fmpUsage.ts` `warnIfTooBigToCache` — why a payload this size could
  never be held by Next's Data Cache (2 MB per entry) in the first place.
