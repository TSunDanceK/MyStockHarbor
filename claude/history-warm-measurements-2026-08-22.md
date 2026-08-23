# History warm: four measurements before building the per-outcome TTL

All measured from source on `1553b4b4`. **Nothing changed.** Two of these
change the design, and one correction to my own earlier reading is included.

---

## 0. #360 confirmation — no revert needed

**Nothing compares a composite score against an absolute threshold.** Checked
every candidate score in the tree:

- `computeOversoldCandidate` returns `null` on exactly two gates —
  `closes.length < 60` and `!pickIsGreenOverallSignal(comp)`. Neither reads the
  score.
- No `<candidate>.score < N` / `> N` comparison exists anywhere in `lib/` or
  `app/`.
- The two `score > 0` gates in `PickerResultPage.tsx` (:625, :657) read
  `getBuySignalCount` / `getSellSignalCount` — integer condition counts of 0–9
  and 0–5, **not** composites.
- The `score < 45` / `score < 50` gates at `:935` / `:1011` are inside
  `computePositiveLastEarningsCandidate` and
  `computeStrongEarningsGrowthCandidate` — separate functions with their own
  local `score`, untouched by #360.
- `POPULAR_SEARCH_MIN_SCORE` (:2576, :3483, :3732) filters demand scores, not
  picker composites.
- The debug route filters on `!== null`, not a threshold.

The published negatives (AIZN −4.95) corroborate rather than carry the argument.

---

## 1. (b) The 07:00 warm is MISS-ONLY — and that is the finding

`getDailyHistoryBulk` pipelines a Redis read for the whole universe, collects
`misses`, and fetches only those. `getDailyHistory` → `getDailyHistoryInner`
returns the cached entry when present and fetches only when absent.

So there is **no unconditional weekend pull**, and the ~245 MB/month figure does
not apply. But the answer is not "nothing to do":

**Miss-only plus any TTL over 24 h means the 07:00 warm stops refreshing
anything.** Trace it with a 26 h TTL:

| | |
|---|---|
| Mon 07:00 | miss → fetch → written, expires Tue 09:00 |
| Tue 07:00 | **present** (24 h elapsed, 26 h TTL) → skipped |
| Tue 09:00 | expires, in the pre-market, with nothing scheduled to refill it |
| Tue 13:30 | market opens against an empty history cache |
| first render after that | refetches ~700 symbols **during the session** |

That is today's problem moved two hours later, not fixed. The warm job would run
daily and fetch nothing, and live renders would repopulate the cache mid-session
— exactly the shape the reframe is meant to remove.

**So the design needs a forced refresh at 07:00**, not just a longer TTL. The
TTL then protects against a failed or late run; the force is what makes the
07:00 fetch actually happen. Those are two different jobs and the brief's (a)
only covers one of them.

Weekend cost, for completeness: with the current 6 h TTL, Friday's daytime
writes expire Friday evening, so **Saturday 07:00 is usually a full pull** and
Sunday 07:00 finds everything cached (Saturday's write carries the weekend
extension confirmed in #354). One weekend pull, not two. A 26 h TTL would make
Saturday cached too.

## 2. (a) Proposed TTL: **26 hours**, with the force above

Matching the precedent the panel already shows for the hourly fundamentals job,
rather than the 30 h the daily screener job uses.

- **> 24 h** so a late or failed 07:00 run leaves a stale-but-present cache
  instead of an empty one. This is the race the brief warns about, and it is the
  whole reason not to use 24 h exactly.
- **26 rather than 30** because with a forced refresh the TTL is no longer doing
  the scheduling — it is only the failure margin. 26 h covers one missed run and
  makes a second consecutive failure *visible* (the cache empties, renders slow,
  someone notices) rather than quietly serving three-day-old bars. 30 h would
  hide two consecutive failures.
- The weekend branch composes unchanged: `getRedisHistoryTtlSeconds` would return
  `max(26 h, time-to-Monday-open)` rather than choosing between them.

**Failure TTL floor: 15 minutes.** Deliberate, not derived from the success
path. Long enough that a symbol failing on a genuine FMP outage is not retried on
every render for the rest of the day; short enough that a transient failure
clears well inside one session, so a symbol is not missing from the pickers for
hours because of one bad minute. It is a defer marker, the same shape as #337's
profile empty-marker, and it must **not** scale with the success TTL — a 26 h
failure TTL would mean one bad fetch removes a symbol from every picker page
until tomorrow.

---

## 3. Urgency: what the picker build does with missing history

### (1) The symbol is DROPPED — but it is counted

```js
const pts = normalizeHistory(rawPts, days);
if (!pts.length) { failedSymbolCount++; failedSymbols.push(symbol); return; }
```

It contributes to no section and no `signalRecords` entry. A page with 400 rows
instead of 700 renders perfectly well.

### (2) DEGRADED_BUILD_FAILURE_RATIO **does** fire — I was wrong first time

My first read found only the log-severity switch at `:3190` and I was about to
report that the fallback described in the comment did not exist. It does, at
`:3977` and `:4073`:

```js
const isDegraded = data.degradedSymbolPct / 100 >= DEGRADED_BUILD_FAILURE_RATIO;
if (isDegraded && cached?.data && !forceRefresh) { /* serve last known-good */ }
```

`degradedSymbolPct` is populated at `:3419` from `failedSymbolCount / universe.length`.

**Three conditions have to hold**, and each is a real hole:

- `>= 15%` — a 14% drop (≈100 symbols) ships silently at `console.log` severity.
- `cached?.data` — with **no** prior cache, a degraded build ships regardless.
- `!forceRefresh` — a forced rebuild bypasses the fallback entirely.

So it is not silent, but it is not airtight either.

### (3) `CAPACITY_WAIT_BUDGET_MS` does **not** apply here

That 90 s shared budget is `fundamentalsCache`'s. History uses a different
mechanism: `reserveFmpCallSlot` waits per call up to `FMP_MAX_WAIT_MS = 20_000`
and then **throws**.

That difference matters, and it is the better of the two designs:

- `getDailyHistory` is `try/finally` with **no catch**, so the throw propagates
  out of `getDailyHistoryBulk`'s `Promise.all` and out of `buildPickersPayload`.
- `getPickersData`'s catch at `:3990` serves the cached payload if one exists.

So a capacity exhaustion during the 13:00-expiry window is a **hard failure with
a cache fallback**, not the stable-order truncation the quote stage had. There is
no equivalent of "the first N symbols get served and the rest silently do not".

### The verdict on urgency

The 13:00 expiry against a 13:30 open is real and worth fixing, but it is **not**
a daily silent-partial-universe event. The likely outcomes in that window are, in
order: a slow rebuild (700 misses at 10 concurrent against a 300/min guard); or a
throw with a cache fallback; or — only when genuine per-symbol fetch failures
stay under 15% and a cache exists — a quietly thinner universe.

Urgent enough to do next. Not the emergency the "dropped" answer alone suggests.

---

## 4. `dailyHistory` coverage — in scope, with a design note

`dailyHistory` is the only registered dataset calling `markRefreshed` and never
`registerSymbols`, so `/cache-health` shows `24 / 24, within policy` — "of the
24 we happened to observe, all are fresh".

The fix belongs with the forced 07:00 warm, because that is the first point at
which the whole universe is known **and** touched: `registerSymbols("dailyHistory",
universe)` there gives a real denominator, and the numbers only become
meaningful once the warm actually refetches.

**And the page should render this state distinctly**, per the same
declared-versus-verified treatment the jobs table got. A dataset with a
`markRefreshed` caller but no `registerSymbols` caller cannot have meaningful
coverage, and today it renders green. `scripts/check-cache-health-page.mjs`
already asserts every registered dataset has *a* writer; it should distinguish
the two kinds, and the page should show "coverage not established" rather than a
ratio it has not earned. That generalises: the next dataset registered without a
`registerSymbols` caller would otherwise read as healthy on day one.
