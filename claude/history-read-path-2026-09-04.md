# Who reads history: it is a cron, and the priority order was wrong

**Part 1, answered.** The brief asked to report before implementing Part 2, and to
say plainly if the answer was "it is a cron job after all". It is.

**The reads are cron-shaped, not traffic-shaped. Scrapers are not the cause, the
exposure is not unbounded, and Part 2 (packing, windowing) is not the fix for
this.** What was fixed instead is the thing actually doing the reading.

---

## The answer, in one log excerpt

Production, 2026-09-04, market shut, no human traffic, three consecutive hours:

```
03:10:14  GET /api/jobs/warm-price-pool 200
    [warm-targets] cache miss -- deriving from the pickers payload
    [pickers] build complete: universe 700, 700 records, 0 failed, 9796ms
    [warm-price-pool] {"ok":true,"skipped":true,"reason":"market-closed","written":0}

02:05:14  GET /api/jobs/warm-price-pool 200      (identical)
01:00:14  GET /api/jobs/warm-price-pool 200      (identical)
```

**A five-minute cron was rebuilding the entire picker universe, once an hour,
all night, to look up a list of tickers — and then skipping without using it.**

Each of those builds calls `getDailyHistoryBulk(universe)`, which reads every
symbol's history out of Redis at ~110 KB a symbol: **~80 MB per build.**

### Why it happened

Two TTLs that do not compose:

| key | TTL |
|---|---|
| `msh:warm-targets:v1` | **30 min** |
| `msh:pickers:v9:charts-off-payload` | **60 min** |

`getWarmTargetSymbols` calls `getPickersData()` on a miss. That function does not
only *read* — on a payload miss it **builds**. With the warm-targets key expiring
twice as often as the payload it feeds on, roughly every other miss landed on an
expired payload and became a full rebuild.

`warmTargets.ts`'s own header priced this path at **"the ~8 MB read"** and
budgeted `~0.35 GB/day` across 45 misses a day. That is the cost of *reading* a
cached payload. The cost of a miss that **builds** is ~80 MB — ten times the
figure the comment was written against, and the comment could not have known,
because nothing measured it.

### The arithmetic now closes

The brief could not account for ~30 full-universe passes/day. They are:

| source | passes/day |
|---|---|
| warm-price-pool (`*/5`, hourly warm-targets miss) | ~24 |
| warm-fundamentals (`22 * * * *`, same pattern — observed 05:22) | ~24 |
| warm-picker-universe (the daily cron) | 1 |
| organic ISR regeneration of 36 picker routes | the remainder |

Two crons alone are in the right order of magnitude. Human traffic is not
involved, and neither are scrapers.

---

## Part 0 — what already shipped (checked, not assumed)

| fetch | state today |
|---|---|
| `PickersClient.tsx` → `/api/pickers` | **buster removed.** `?t=` and `no-store` only on `force`, where the builder already sends `no-store`. |
| `/api/stock-valuation`, `/api/stock-analyst-rating` | **no buster.** Plain `fetch(url)`. |
| **the stock page's history fetch** | **no buster, and it never had one.** `fetch("/api/history?symbol=…&days=900")` with an explicit comment saying why there is no `no-store`. |

**The five-minute check the brief hoped would end the investigation came back
clean.** Better than clean: the client history fetch is also guarded by
`if (seededHistory) return;`, so it does not fire at all when the server seeded
the chart — which it does, via `initialHistory={points.slice(-500)}`.

---

## Part 1, question by question

### Q1 — rank every reader of `msh:history:v7:*` by bytes/day

**Not answerable from the #418 meter, because that meter had a hole, and the hole
was the entire question.** `recordRedisRead` was instrumented on the two BULK
paths only. Every single-symbol reader reported **zero bytes**:

`/api/history`, the stock page, its news and earnings tabs, the dashboard, the
SPX page, insight snapshots — and the three plays builders, which read **~700
symbols each, one at a time**. Same ~110 KB per symbol; only the loop shape
differs, and the loop shape is not a property of the bytes.

Fixed here: a `history-single` source metered at `readHistoryEntry` (the one GET
every single-symbol path passes through), and **caller attribution on all 19 call
sites**, derived by an AST scan rather than a hand-typed list. 15 distinct tags.
`scripts/check-history-readers.mjs` fails on any call site that omits one.

The ranking arrives on `/cache-health` within a day of deploy. It is not
guessed here.

### Q2 — traffic or cron?

**Cron.** Two independent lines of evidence:

1. The overnight log above: hourly, clock-aligned, market shut, zero human
   traffic, and the caller is a cron route.
2. The 30/60-minute TTL interaction predicts almost exactly hourly, which is what
   the timestamps show (01:00:14, 02:05:14, 03:10:14 — the drift is the
   `*/5` grid).

**And it is now falsifiable rather than argued.** The meter records units per
**UTC hour** and `/cache-health` draws a 24-bar profile per source with a
peak-to-mean ratio: flat is a cron, an 02:00–06:00 dip is people, flat-and-high
is scrapers. Three log lines are not a measurement; that panel is.

### Q3 — is `/api/history` served from the Data Cache?

**No, and it cannot be.** The route reads `new URL(req.url).searchParams` and
calls `isUnwantedBot()` (which reads headers), so the handler is dynamic and
`export const revalidate = 900` on it is **inert**. Next's Data Cache caches
`fetch()` results anyway — a Redis GET is not a `fetch`, so `getDailyHistory`
would never be cached by it under any configuration.

What *does* absorb repeats is the CDN: the route already returns
`Cache-Control: public, s-maxage=900, stale-while-revalidate=900` in market hours
and 3600/3600 outside. That containment was already in place, which is the second
reason Part 3 has nothing urgent to add.

The misleading `revalidate = 900` is left alone in this PR and flagged: removing
it is correct but it is a separate, behaviour-free tidy.

### Q4 — where are the picker indicators computed? **At build time.**

`buildPickerChartPoints` computes `ma50`, `ma200`, `rsi14` and `macdHist` over
the full series and bakes them into the 72-bar `chartPoints`, which are stored in
`msh:picker-charts:v1`. **A picker render never touches raw history.** The render
path is `readPickersCache` → payload GET + chart-hash HMGETs, and nothing else.

So the first of the brief's two branches holds. It also means the brief's own
worry — "if rows compute them at render time, ISR cadence matters more than
scrapers" — is moot in the way it feared, but the *conclusion* it drew from that
branch turns out to be right anyway for a different reason: **regeneration, not
traffic, is what reads history.** Not ISR regeneration of picker pages, though —
cron-triggered rebuilds.

### Q5 — bars stored vs bars needed

**Stored: ~1,188** (measured 2026-08-24: 831,564 rows / ~700 symbols), capped at
`MAX_CACHED_HISTORY_DAYS = 1400`. The brief's correction is right — it is ~4.7
years, not ten.

| consumer | needs |
|---|---|
| stale-bar eviction (`recordNewestBarAge`) | the **newest bar** |
| stock page chart | 500 seeded / 900 requested |
| `buildPickerChartPoints` indicators | ~**272** (200 for `ma200` + the 72 drawn) |
| `computeMacroSupportResistanceCandidate` | 260 weeks ≈ **1,300 days** |
| plays builders (`HISTORY_DAYS`) | **1,300** |

`claude/fmp-history-payload-audit-2026-08-30.md` already established that
1,300–1,400 is genuinely requested by four call sites. **Depth cannot be cut**,
which is why Part 2(a) — serve a window — has almost nowhere to apply on this
store, and why (b) would have had to carry that PR alone.

### Q6 — the point shape

`{ date, open, close, high, low, volume }`, no rounding applied (FMP's own
precision lands in Redis). Measured **92.6 bytes/row**, of which the field names
are **~45%**. Parallel arrays measure at **1.99×** — consistent with the 2.07×
measured on chart points in #418, and with the same 2× arithmetic ceiling.

### Q7 — is the stored series growing?

**Yes, and it is already bounded.** `mergeDailyPoints(stored, fetched, maxDays)`
slices to `MAX_CACHED_HISTORY_DAYS = 1400`, so the incremental append grows the
series from today's ~1,188 to 1,400 and then stops.

- **Growth: +17.8%**, once, over roughly the first year. The brief's ~18% is
  right; what it did not know is that the ceiling exists.
- **Cost of the ceiling being 1,400:** ~110 KB → ~130 KB a symbol at steady
  state, +20 GB/month of read bandwidth at 762 symbols and today's read volume.
- **Cost of lowering it to 1,300:** nothing measurable. 1,300 is what the deepest
  consumer actually asks for, and 1,400 was the safety margin above it. That is a
  deliberate decision available whenever it is wanted; it is **not** taken in
  this PR, because it is a storage-shape change and this PR is a read-path one.

---

## What was fixed, and what it should remove

Three changes, all on the cause rather than the symptom:

1. **`readPickersSymbolsIfCached()`** — a payload reader that returns `null`
   instead of building, and skips the chart re-attach a symbol list never needed
   (**~1.5 MB instead of ~9.4**).
2. **A last-good warm-targets list** (7-day key, written in the same pipeline as
   the 30-minute one). On a payload miss the crons serve a slightly stale ticker
   list rather than becoming the thing that rebuilds the site. A genuine cold
   start — no key, no payload, no fallback — can still build, deliberately: warm
   jobs that never start are a silent site-wide freshness failure, which is worse
   than a bill.
3. **warm-price-pool checks the market window before deriving targets.** It was
   doing its most expensive work and *then* discovering there was nothing to do,
   for over half of its 288 daily runs.

### Projected effect

Full-universe history passes/day, at 762 symbols and ~80 MB a pass:

| | passes/day | GB/day |
|---|---|---|
| before | ~30 | **~2.5** |
| after | ~1 daily cron + organic ISR regeneration | **~0.3–0.5** |

That is roughly **2 GB/day, ~30% of a 6.67 GB/day bill and ~60 GB/month**, removed
by three small changes and no shape change at all.

**This is a projection, not a measurement**, and it is stated as one. The meter
shipped alongside it is what turns it into a measurement within a day: if
`history-bulk`'s caller breakdown still shows `pickers-build` at 30 passes after
this deploys, the diagnosis was wrong and the panel says so.

---

## Corrections this forces

**To this brief's priority order.** "Unbounded exposure before bounded cost" was
the reason this jumped the queue. The exposure is **not unbounded** — it is a
cron on a fixed schedule, and its worst case was always 24 passes/day per job. The
ISR work in `cut-the-bill.md` is not competing with an unbounded risk.

**To `cut-the-bill.md`'s PR A**, and in the opposite direction to the withdrawal.
That brief claimed raising the ISR window "cuts the Vercel bill AND the Redis
bandwidth line at the same time", then withdrew it as unverified. It is **partly
true after all**: organic ISR regeneration of the 36 picker routes does read the
payload, and a regeneration landing on an expired payload does trigger a build.
It is simply not the *dominant* term — the crons were. Reinstate it as a real but
secondary effect, and size it after this deploy rather than before.

**To Part 2.** Packing (option b) is still worth doing — 1.99× on history, 2.07×
on chart points, no UX cost, and it applies whoever is reading, which was the
brief's own best argument for it. But it is no longer urgent, and the honest
ordering is: measure this fix first. Cutting ~30% of the bill by not doing
unnecessary work beats cutting 50% of the bytes of work that should not happen.

**To Part 3.** Containment is not needed. `/api/history` already carries a
tiered `s-maxage`, the busters were already removed, and the reads were never
traffic-shaped. BotID Deep Analysis on the big-read routes would be spend against
a threat this measurement does not find — and at $3.36/month for 3.36K calls it
is not free. Recommend not doing it.

## The method note, for the sixth time

Twice now an unexamined path has turned out to dominate: FMP bandwidth was
measured while Redis was not, and the picker payload was measured while history
was not. This is the third instance and it has the same shape — **a comment
priced a code path at 8 MB, the path had since become capable of costing 80, and
nothing was counting.** A number in a comment is a measurement with no expiry
date on it. The meter is the fix, not the arithmetic.
