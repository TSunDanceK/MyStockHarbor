# Report dates and timing, off EDGAR — what was measured

Step 3 of taking `/stock/[symbol]/earnings` off FMP. The page needed an
announcement date, a before-open / after-close reading, and a next-report
estimate, and the question was whether `submissions` can supply all three well
enough to stop paying an earnings calendar for them.

Relay runs on `feat/sec-report-dates-2026-09-16`, 120 SYMBOLS from the manifest.
Final figures are from run **35120730648**.

---

## 1. `acceptanceDateTime` is UTC, not Eastern

The field ends in `Z` and carries a value that *looks* like Eastern wall time,
which is the shape a wrong assumption survives in: read as Eastern, every 16:30
filing reads as after-close, which is the right answer for the wrong reason,
and every 09:30 filing reads as before-open, also right. The two readings only
separate on filers whose habit is known.

A 24-filer panel with a public, stable habit (12 after-close, 12 before-open)
plus 6 drawn from the during-market bucket. **The UTC reading put 10 of 10
discriminating filers in the right bucket; the Eastern reading put 5 of 10.**
The discarded reading is kept in the probe as a control arm, computed from the
raw string, so the run reports both every time rather than asserting the
conclusion.

## 2. The during-market question is openly unanswered

226 of 3,219 filings land in market hours. Six were sampled and their EX-99.1
exhibits read for a stated release time: **0 of 6 stated one.** So whether a
"during market" filing is a morning release filed late is not known from here,
and this document does not claim it is.

It does not need answering. The session mapping collapses before-open and
during-market onto the same trading day — both are digested by that day's close
— so the boundary this code could plausibly get wrong is the one boundary that
does not move the measurement. Only after-close advances the session.

## 3. The bug that a backtest reported as a triumph

EDGAR labels the 8-K field "Date of Report (Date of earliest event reported)".
For an Item 2.02 8-K the earliest event reported **is the results release**. It
was read as the fiscal period end, so every reporting lag was announcement
minus announcement — **zero by construction** — and the backtest predicted the
announcement date from the announcement date and reported a **0-day median
error across 103 filers**.

Nothing about that fails. No exception, no empty column, no wrong-looking
number. The tell was six consecutive zero lags on AA in the worked examples.

Fixed by splitting the field: `eventDate` is what the filing says, `periodEnd`
is **matched** against the stored fact set — the newest stored end that had
already passed when the filing was accepted, within 120 days — and null when
nothing matches. `check-sec-report-dates` §3c is the regression guard, with a
mutation that restores the defect and watches the lags collapse to 0.

## 4. The estimator was chosen by a rule fixed before the measurement

The first method (median lag) lost to a one-line baseline. Choosing its
replacement after seeing that is how a method gets picked by the noise in one
corpus, so exactly three candidates were declared first, with the selection rule
declared with them: **lowest MEAN absolute error over the symbols all three can
answer, ties to A.**

| id | holds fixed | mean | median | 0d | ≤1d | ≤3d | ≤7d |
|----|-------------|------|--------|----|-----|-----|-----|
| **A** | the LAG from period end (year-ago lag) | **1.98d** | 1d | 15 | 34 | 36 | 42 |
| B | the CALENDAR position (year-ago + 364d) | 2.07d | 0d | 26 | 33 | 33 | 43 |
| C | nothing — the filer's median lag | 3.27d | 1d | 13 | 26 | 36 | 41 |

44 SYMBOLS, all three covering all 44. **Winner: A.**

B is better on exact hits (26 vs 15) and worse on the mean, which is exactly the
kind of split that invites picking the column that flatters the answer. The rule
was fixed beforehand and says mean, so A ships. **C remains the fallback** for a
filer with no same-quarter event a year ago, which is the one case A and B
cannot answer at all.

A *is* the "same quarter last year" baseline the first method lost to. That is
recorded rather than tidied away: the method was replaced by its own baseline.

## 5. The leak test, after three faults of its own

A backtest that scores its own answer is worthless, so the target event and
everything filed after it are excluded on both axes. Proving that took three
corrections to the *test*:

1. **It compared different populations.** Restoring the target changes which
   filers clear the regularity gate, so the two columns covered 42 and 44
   symbols and were compared as one.
2. **It compared medians only.** At errors of 0–3 days a median ties while
   every individual prediction moves.
3. **It perturbed an input the shipped estimator never reads.** Restoring the
   target moves the MEDIAN LAG, which is estimator C. A is what ships and A
   never reads the median, so the mutation changed nothing and the probe
   reported "identical — suspicious", which reads as a leak and was in fact the
   mutation missing its target. A mutation that cannot move the thing under
   test is not a weak test, it is no test.

Two arms now, each naming what it perturbs:

- **Arm 1 — C's median, target restored.** leaky better 10 · worse 8 ·
  identical 24; mean honest C 2.71d vs leaky 1.38d. Does not dominate.
- **Arm 2 — A's year-ago event, the input that ships.** Merely restoring the
  target is identical to honest on 44 of 44, *as it must be*: a gap of 0 is
  outside the 330–400 day window, so A cannot see it. Widening the window to
  admit it: **mean 0.00d, exact on 44 of 44 — the mutation bites.** Honest A
  sits 1.98d from that floor. **Not leaking.**

Against the other baseline: vs period end + 35 days, better on 28 SYMBOLS,
worse on 12.

## 6. Only a filer that earned a date gets one

≥4 prior Item 2.02 events and a lag spread (max−min over the last 4) ≤ 7 days,
8-K path only. Over 109 SYMBOLS read:

**a specific DATE: 45 · a MONTH only: 14 · NOTHING: 50**

Unchanged from the run before the `eventDate`/`periodEnd` correction, which
confirms the gate was already reading corrected lags rather than the collapsed
ones.

The clamp is the statutory deadline measured from the **matched** period end —
40/40/45 days for a 10-Q, 60/75/90 for a 10-K, by filer category. Measuring it
from the announcement, as the first version did, is a deadline measured from
the thing being predicted. Where no period end could be matched there is no
deadline to clamp to and no date to offer, and `estimateNextReport` returns
nothing rather than computing one off the announcement.

6-K filings (foreign private issuers, no item codes) are selected by a weaker,
positional rule: **188 events across 24 SYMBOLS**. They are charted, and they
never earn an estimate — the weakest evidence must not carry the most specific
claim.

## 7. A past date under "next expected", caught on the first seeded preview

ABT rendered **"Next expected earnings date: 2026-07-18"** on a page read in
September. The estimate was *correct* for the quarter it was computed for, and
that quarter had already been reported. The stored fact set lags the filings by
design — companyfacts carries a period once it is FILED — so a filer that has
announced Q3 but not yet filed its 10-Q has a fact set ending at Q2, and one
cadence step past Q2 is a date in the past.

Nothing about it fails, and a reader cannot tell it from a date the company
missed. `estimateUpcoming` rolls forward one cadence step at a time until the
estimate lands on or after today (bounded at eight steps — an unbounded roll is
a hang on a page render), and a month-only estimate whose month has passed
becomes nothing rather than a stale month.

Rolling by the median step accumulates drift: two steps of 92 days from a
31 March quarter end lands on **1 October**, not 30 September, and the estimate
inherits every day of it. So each rolled date is **snapped to the filer's own
calendar** via `periodAnniversary`, which tells the two filer conventions apart
by the only thing that distinguishes them — whether the period end is its
month's last day:

- month-end filer: 2025-09-30 → 2026-09-30 (and 2027-02-28 → **2028-02-29**,
  which +365 would miss)
- 52/53-week filer: AAPL's 2026-06-27 → 2027-06-26, 364 days, weekday preserved

`today` is an argument, never read from the clock inside the function: this runs
in the cron, in the seeder and in checks, and a function that reads the clock
cannot be given a date to test against.

## 8. What ships

- `lib/server/secReportDates.ts` — selection, the ET conversion, the three
  estimators, the gate, the clamp, the session mapping, the wording.
- `lib/server/secReportDatesStore.ts` — one key per symbol, its own absence.
- `app/api/jobs/sec-facts/route.ts` — a separate 100/run allowance draining
  from `submissions`, sharing the existing SEC rate gate. Filers whose numbers
  moved this run go first; the backfill behind them drains once and stays
  drained, because only an 8-K moves these dates.
- `app/stock/[symbol]/earnings/page.tsx` — the reaction card keyed to the
  filing dates and labelled from the matched period end; the next-report card
  rendering a date, a month or nothing; **the FMP `/earnings` call skipped
  entirely** where the record has events.

Wording on the page describes the **filing**, never the announcement: "Results
filed with the SEC after market close", never "reported after close". What is
observed is when a document reached EDGAR, which is at or after the press
release.
