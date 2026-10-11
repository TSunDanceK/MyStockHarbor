# Handover: screener chart coverage (2026-08-04)

Written at the end of a long session. Three things shipped; one measured and
specified but not built. Start with **The open task**.

---

## Shipped today

**#207 — industry/sector starvation in the fundamentals warm job.**
`warmFundamentals()` ran its quote stage first; `stable/batch-quote` answers 402
on the FMP Starter plan, so every chunk fell through to per-symbol quotes
(~1 call per universe symbol). The profile stage — the only source of
`industry`/`sector` — then hit `hasFmpCapacity(1, 60)` against a drained
per-minute budget and **broke out of its loop entirely**. Since the budget
refills every minute, breaking rather than waiting cost the whole stage on
nearly every run. Fixed by running profiles first, replacing the `break` with
`awaitFmpCapacity()` (5s poll, 90s wait budget shared across both stages), and
not retrying batch-quote after a 401/402/403.

Verified: two manual runs took profile coverage from ~130 to **259/260**, and
`industry=Semiconductors` went from **4 rows to 18**. One symbol still has no
profile (fetch returned nothing — likely an ETF or share-class ticker, not worth
chasing). `waitedMs` was 70,000 on the backfill run and 25,000 on the second; if
it ever comes back pinned at 90,000 the run is being truncated again.

**#208 — chart-view indicator panels.**
`chartOverlayForEntry` matched the card's own text (`badge`, `note`, `reasons`)
as well as the page's. On the Advanced Screener a stock qualifies for up to 25
conditions, so whichever mentioned "MACD" or "RSI" first decided that card's
panel — NVDA drew MACD, ON drew RSI, TSM drew neither, side by side. Overlays
now come from the page alone. The divergence pages keep per-card indicators,
gated on `href.includes("divergence")`, which also fixes
`/bullish-divergence-stocks` and `/bearish-divergence-stocks` (their hrefs name
no indicator; they were relying on card text by accident).

**Debug route `/api/debug/pickers-size`** — added to measure the cached payload
before changing chart coverage. Read-only, goes through `getPickersData`, costs
no more than a page view.

---

## The open task: 114 of 260 symbols have no chart

Cards render "Chart preview unavailable" (and a blank **200 MA** column, which
is read off `chartPoints`) because `lib/server/pickersBuilder.ts` keeps
`chartPoints` only for symbols appearing in a section's top 20:

```ts
const displayedSymbols = new Set(
  sections.flatMap((section) => section.items.map((item) => item.symbol))
);
const fullSignalRecords = signalRecords.map((record) =>
  displayedSymbols.has(record.symbol) ? record : { ...record, chartPoints: undefined }
);
```

Section membership is recomputed each rebuild, so *which* symbols lack a chart
changes — AMD and QCOM were missing in the morning, AMAT in the afternoon. To a
visitor it reads as random breakage.

### The budget is real and known

**Upstash "MSH-Market-Cache" is on Pay As You Go, whose Max Request Size is
10 MB.** This is not a theoretical ceiling: an Upstash alert fired on 2026-08-04
for at least one request breaching it in a 15-minute window. Owner's read is
that it was bot-driven traffic rather than a sustained problem, and nothing was
breaching it afterwards — but the pickers payload is the request that gets near
it, and this has bitten before (the pull previously had to be split into two
batches of ~200 to stay under the limit). Treat 10 MB as a hard wall.

### Measurement (2026-08-04, payload updatedAt 16:42:57Z)

| | |
|---|---|
| records | 260 |
| withCharts / withoutCharts | 146 / **114** |
| avgPointsPerChart | 72 |
| avgChartChars | 11,010 |
| signalRecordChars | 1,802,877 (1.8 MB) |
| **payloadChars** | **4,264,915 (4.3 MB)** |
| projectedFullPayloadChars | 5,520,055 (5.5 MB) |

Note these are `JSON.stringify().length` (UTF-16 code units), measured in
process. The figure that counts against the 10 MB limit is the **serialised REST
request body**, which is larger: the value is embedded as a JSON string inside
the command array, so every `"` becomes `\"`. On a payload this quote-dense
that is plausibly another ~15%. So 4.3 MB measured is more like ~5 MB on the
wire, and 5.5 MB is more like ~6.4 MB. Against a 10 MB wall, with the universe
cap having already gone 200 → 260, naive full coverage spends most of the
remaining headroom.

### Do this in the right order

**1. Make the write self-limiting (do this first, regardless).**
`writePickersCache` currently catches and swallows, so an oversized value simply
isn't cached and every request silently falls back to a live FMP rebuild. That
is the worst failure mode available and it is the one already in place. Attempt
the full payload, retry with a reduced one on failure, and log which was used:

```ts
async function writePickersCache(data: PickersPayload, reduced?: () => PickersPayload) {
  if (!redis) return;
  try {
    await redis.set(PICKERS_REDIS_KEY, { cachedAt: Date.now(), data }, { ex: PICKERS_REDIS_TTL_SECONDS });
    return;
  } catch (error) {
    console.warn("[pickers] full payload write failed", error instanceof Error ? error.message : error);
  }
  if (!reduced) return;
  try {
    await redis.set(PICKERS_REDIS_KEY, { cachedAt: Date.now(), data: reduced() }, { ex: PICKERS_REDIS_TTL_SECONDS });
    console.warn("[pickers] cached reduced payload (chartPoints stripped outside sections)");
  } catch {
    // fail open, as today
  }
}
```

**2. Deduplicate `sections` — this is now the load-bearing change, not an
optional cleanup.** `signalRecords` is only 1.8 MB of the 4.3 MB total; most of
the rest is section items carrying their own copy of `chartPoints` for symbols
that are *already* in `signalRecords`. Have section items reference symbols and
read points from `signalRecords`. That frees ~2.4 MB — more than full coverage
costs — so the payload ends up **smaller than today** while every card gains a
chart. Consumers to check: `PickerResultPage.tsx`, `app/plays/*Client.tsx`, the
homepage ticker.

**3. Then ship `chartPoints` for all 260.** After dedup the projection is
roughly 1.8 MB of records + 1.25 MB of new points ≈ 3.1 MB, comfortably clear of
the wall with room for the universe cap to grow again.

Optional extra saving, now that #208 means non-curated pages draw plain candles:
those 114 symbols only need OHLC + `volume` + `ma200`, so `ma50`, `rsi14` and
`macdHist` can be dropped from their series — roughly 30% of their cost. Careful:
a "preset" page draws from the full universe and *can* request an indicator
overlay, so a slimmed symbol there would render the panel with no data. Check
`MiniPickerCandleChart` degrades cleanly before relying on this. If step 2 lands,
this probably isn't needed.

Re-check `/api/debug/pickers-size` after each step, and watch for the warn line
from step 1.

---

## Gotchas worth knowing

- **A push to `main` did not trigger a build.** Commit `c4d369d` (adding the
  debug route) produced no deployment at all — not queued, not cancelled,
  nothing, with all 7 status filters enabled. A second commit to the same file
  deployed normally. If a change seems not to be live, check the Vercel
  deployments list before re-debugging the code.
- **`CRON_SECRET` is set**, so job routes 401 on a plain browser hit. Trigger
  them from Vercel → Project Settings → Cron Jobs → **Run**, which attaches the
  secret. (The dashboard re-renders at a different zoom after clicking; confirm
  via runtime logs rather than the screenshot.)
- **Job summaries are only visible if logged.** `warm-fundamentals` now
  `console.log`s its result; the cron discards response bodies, which is why the
  starvation went unnoticed for so long. Runtime log retention is ~1 day, and
  broad log queries time out — scope to a deployment id or a few minutes.
- **Editing large files costs a full re-upload.** The GitHub connector has no
  patch operation, so any edit to `pickersBuilder.ts` (110 KB) means sending the
  whole file. Write locally, `str_replace`, syntax-check with
  `node -e "require('typescript').transpileModule(...)"`, `diff` against the
  raw.githubusercontent copy, then push and verify the returned byte count.
  Start this with plenty of context headroom.

## Also outstanding

- **Footer relabel.** `PickerResultPage.tsx` renders
  `Universe {universeSize + dynamicUniverseCount}` = 613, which is 260 analyzed
  plus an overlapping 353-name candidate pool. That figure caused a whole wrong
  diagnosis (see `claude/preset-pages-universe-blocker-2026-08-04.md`).
  `Universe 260 · Pool 353` would be honest.
- **Re-measure the preset-page filter counts.** Every number in the blocker note
  was taken when `industry` was null for most of the universe. Semis went 4 → 18;
  expect similar movement elsewhere. Nothing should be committed to a landing
  page until they're retaken.
