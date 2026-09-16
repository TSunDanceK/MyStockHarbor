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

---

## 9. Three defects from the rendered eye-check

### 9a. The fiscal year's NAME was a convention, and there is no convention

AAP's snapshot read **"Q2 FY2027 (period ending 2026-07-18)"**. AAP calls that
quarter Q2 FY2026. The labeller named a fiscal year by the calendar year its
END falls in — right for WMT, wrong for AAP, and **no rule about dates can
separate them**, because the name belongs to the filer.

Calibrated instead, per filer, from its own filings. Every companyfacts row
carries the `fy` of the FILING it appeared in — that document's
`DocumentFiscalYearFocus` — so an annual report's own period gives the pairing
outright. Three constraints, each with a failure behind it:

- **The latest period in a filing, not a comparative.** A 10-K stamps its `fy`
  on every prior year it restates.
- **Durations only.** A cover-page instant is dated at the FILING date, weeks
  past the year end, and would shift a January filer by a year.
- **Measured from the MIDPOINT year, not the end year.** AAP's year-end is the
  Saturday nearest 31 December: 2 January one year, 27 December the next. An
  offset against the end year flips between 0 and -1 for the same company with
  no change in how it names anything, and a calibration that oscillates renames
  the page every few years.

Only **0** (named for the year it occupies — AAP, AAPL) and **+1** (named for
the year it ends in — WMT, ARM) are conventions. Anything else is a malformed
filing and is refused. A filer whose naming cannot be read keeps today's label
exactly, asserted against all four existing calendar fixtures.

`10-K`, **`20-F` and `40-F`**: the first census run reported eleven foreign
private issuers — BABA, SONY, RYAAY, MUFG, INFY, HMC, TAK, NMR, MFG, HMY, WSE —
as "naming unreadable", purely because the filter named the domestic form.

### 9b. The year-end anchor itself was wrong for two filers

The census turned up **AMZN anchored on 30 June and BG on 31 March**, both
December filers. Not introduced here: the anchor is "the newest twelve-month
frame's end", and a trailing-twelve-month comparative in a 10-Q is twelve
months long without being a fiscal year. Every quarter either page showed was
labelled off a fiscal year that does not exist.

An annual filing's own period end IS the fiscal year end, and the calibration
already has it — so it is offered as the anchor and the extraction prefers it.
Only an annual filing may supply one: a 10-Q's period end is a quarter end, and
taking one would move every label by a quarter.

### 9c. The census — 13 of 786 SYMBOLS relabelled

Relay run 35127993140, every CIK-bearing symbol screened, companyfacts read for
the 493 with a stored fact set and an annual frame.

| | symbols |
|---|---|
| relabelled | **13** |
| confirmed unchanged | 479 |
| naming unreadable (label unchanged) | 1 — CNI |

**Eleven retail/January-calendar filers**, all `Q2 FY2027 → Q2 FY2026`:
AAP · BJ · BURL · CRWD · DAR · DKS · DLTR · EXEL · FIVE · HD · TGT

**Two from the anchor fix:**
- AMZN — year-end `2026-06-30 → 2025-12-31`, `Q4 FY2026 → Q2 FY2026`
- BG — year-end `2026-03-31 → 2025-12-31`, `Q4 FY2026 → Q1 FY2026`

### 9d. It reaches the stored sets, and it does not split a YoY pair

Neither `h` (field order) nor `c` (tag chains) moves for a labelling change, so
a set written before this would keep its wrong year forever with nothing
selecting it. `SEC_LABEL_VERSION` is a fourth staleness reason, **absent
meaning 1**, and the rewindow queue drains it.

Year-over-year matching is by label — same `fp`, `fy-1` — so the checks assert
the naming is applied at **exactly one call site** and that every period of a
filer shifts by the same year: `fp` untouched, `fy-1` still pairing the same
rows, no collisions after the relabel.

### 9e. The reaction bars spoke a different language from the page

AAPL's latest bar read "Q2 26" under a snapshot calling the same filing Q3
FY2026; AAP carried "Q4 23" **twice**; AAP and ABEV showed a "Q3 26" that had
not ended. One cause: the bars were labelled by the calendar quarter of an
ANNOUNCEMENT, which names the quarter it falls in rather than the one it
reports on — and two announcements can fall in one.

Every bar now takes the label of the stored period it matched, through one
labeller both paths share. A bar with no matched period says
**"Reported Aug 2026"** and makes no fiscal claim at all; a collision on that
path is broken by the day, because a chart with two identically named bars
cannot be read.

### 9f. The gate's refusal is rendered

On AAP no "Next report" card appeared — the same blank a symbol with no SEC
data gets, so a reader could not tell "its history is too irregular to promise
a date" from "we never looked". The `nothing` outcome now renders its own line.
And the reaction card's explanation said "released before market open", which
asserts a press-release time nothing here observes; it describes the filing.

---

## 10. Second eye-check round

### 10a. A twelve-month comparative took every quarter's label

AMZN's reaction card read:

```
Q3 FY2024 · Q4 FY2024 · FY2025 (05/01) · FY2025 (07/31) · FY2025 (10/30)
· FY2025 (02/05) · FY2026 (04/29) · FY2026 (07/30)
```

The bars were looked up in a map built by merging the fact set's `quarters` and
`years` **with years last**. A 10-Q carries twelve-month comparatives — measured
on AMZN's own companyfacts:

```
us-gaap:CashCashEquivalents…IncludingExchangeRateEffect
  2025-07-01..2026-06-30  (364d, 10-Q Q2)
```

Those land in `years` with ends on **quarter** ends, so the annual entry
overwrote the quarter's at every end the two lists shared, and the
collision-breaker then stamped a date on each to tell the duplicates apart.
**The "(MM/DD)" suffix was the tell** — matched correctly, nothing collides.

The same trap as the year-end anchor, one layer down: a twelve-month duration
is not a fiscal year, and nothing about treating one as a fiscal year fails.

**Why the "latest bar equals the snapshot" assertion passed on it.** It was
handed a written-out `Map` of one label per period end — a model of the map, not
the code that builds it. The defect was entirely in the building, so the fixture
had already assumed away the thing that was broken. The map is now built by a
shipped function (`reactionPeriodLabels`) and the check drives it with a set
shaped like the filer that broke it; the mutation restores the merge and
reproduces the rendered string exactly, and AMZN's bars are asserted to carry
**no collision suffix at all**.

An annual period is also labelled **Q4** on the reaction card where the filer
reports quarters — a bar reading "FY2025" beside "Q3 FY2025" implies a different
KIND of event, and it is the same event. A filer that publishes no quarters
keeps "FY2025". `periodLabel` is untouched: the snapshot and five-year card name
a PERIOD, only the reaction card names an ANNOUNCEMENT.

### 10b. ABT — the source is behind, not the pipeline

```
ABT    stored newest 2026-03-31 (169d old, written 2026-09-16 17:34)
         newest periodic filing 10-Q filed 2026-07-28 for period 2026-06-30
         newest item 2.02 8-K   filed 2026-07-16, event 2026-07-16
         report-date record     15 events, newest period 2026-03-31
         companyfacts newest duration ends: 2026-03-31 · 2025-12-31 · …
         companyfacts frames ENDING 2026-06-30: 0
```

ABT filed its June-quarter 10-Q on **28 July**, seven weeks ago, and its
companyfacts payload carries **no duration frame ending 2026-06-30 at all**.
The set was re-extracted from live companyfacts at 17:34 today, so this is not
a stale cache, not the matcher and not the seed — **the source has not published
the period**.

The July Item 2.02 8-K is correctly discarded, and that is worth stating because
it looks like a second bug: with no 2026-06-30 period to match, the announcement
of 2026-07-16 falls back to the newest stored end, 2026-03-31 — where the real
Q1 announcement of 2026-04-16 already sits, and the dedupe keeps the **earliest**
per period. So the page stops at Q1 for exactly the reason its financials do.

### 10c. The population — 58 of 786 SYMBOLS

Relay run 35135811904.

| | symbols |
|---|---|
| stored newest period >100 days old **and** a newer periodic filing exists | **58** |
| skipped as current (newest stored period within 100 days) | 336 |
| no stored fact set at all (populate backlog — a different problem) | 290 |

Foreign private issuers dominate the long tail (SONY 534d, TAK 534d, SQM 624d,
VIST 624d — all 20-F filers whose annual payload lands once a year), but ABT,
SOJE and VRA are ordinary domestic quarterly filers a quarter behind.

**Not proposed here, for the owner to rule on:** the page could say "SEC has not
yet published this quarter's figures; results were announced on <date>" where
the report-date record holds an announcement newer than the newest stored
period. It is the one case where the two sources disagree in a way a reader
would want to know about, and it needs a decision rather than a guess.

### 10d. Still open, found while measuring 10a

AMZN's `years` list holds **six** twelve-month comparatives at quarter ends, so
the five-year card shows them as fiscal years. The reaction card no longer reads
them; the five-year card still does. Out of scope for this PR by the review's own
instruction ("snapshot/five-year card wording unchanged"), and recorded here
rather than fixed, because the fix — admitting an annual period only where it
ends on the filer's fiscal year end — changes what that card shows.

---

## 11. Third eye-check round

### 11a. ABT — the probe ruled out before the source was blamed

A count of zero can mean the period is absent, or that the counter is looking in
the wrong place, and only one of those is a finding about SEC. So the raw rows
were printed for ABT's own revenue tag and `NetIncomeLoss`, with **no end-date
filter at all**:

```
us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax — newest 5:
  2026-01-01..2026-03-31 (89d)  form=10-Q fy=2026 fp=Q1 filed=2026-04-29
  2025-01-01..2025-12-31 (364d) form=10-K fy=2025 fp=FY filed=2026-02-20
  2025-01-01..2025-09-30 (272d) form=10-Q fy=2025 fp=Q3 filed=2025-10-29
  2025-07-01..2025-09-30 (91d)  form=10-Q fy=2025 fp=Q3 filed=2025-10-29
  2025-01-01..2025-06-30 (180d) form=10-Q fy=2025 fp=Q2 filed=2025-07-30

us-gaap:NetIncomeLoss — identical newest five.
```

The newest row of either tag is the **Q1 2026 frame filed 2026-04-29**. There is
no six-month frame ending 2026-06-30 from the 2026-07-28 10-Q, on any tag. The
probe was not missing it: **companyfacts has not ingested ABT's Q2 10-Q**, seven
weeks after filing.

### 11b. `years` now admits only periods that end on the fiscal year end

Measured on AMZN's own payload:

```
us-gaap:CashCashEquivalents…IncludingExchangeRateEffect
  2025-07-01..2026-06-30  (364d, filed in a 10-Q for Q2)
```

Six such trailing years reached AMZN's `years` list. **Length cannot tell them
apart** — 364 days either way. The END can.

Ten days of slack, the same figure and the same reason as `fiscalLabel`'s:
a 52/53-week filer's year end moves a few days annually, so an exact match would
drop every year but the newest. The band is fixed rather than cumulative, so it
never widens toward a quarter.

**The anchor is the annual filing's own period end**, never the newest
twelve-month frame — using the frame would ask the list to validate itself, and
on AMZN that anchor *was* one of the trailing years. Where no annual filing can
be read, nothing is dropped.

**Applied once, at the source.** Every consumer reads the same `set.years`: the
five-year card, the snapshot anchor, `basis`, `tableBasis` and its 548-day gate,
the annual cash-flow fallback, and the period ends handed to the report-date
matcher. The mutation restores the admit-anything list and asserts the trailing
year comes back **and lands first**, where the snapshot anchor reads.

`SEC_LABEL_VERSION` is 3 and its docblock now covers admission as well as
labelling: this changes which rows a stored set holds, and neither `h` nor `c`
can see that either.

### 11c. The "announced, not yet in the feed" notice

> Results for the quarter ended **2026-06-30** were announced on
> **2026-07-16**. The SEC has not yet published the figures in its data feed, so
> this page still shows the previous quarter.

**The test is an ordering, not a window.** A results 8-K newer than the one
already placed on the newest stored period must be about a *later* period —
there is no third possibility, because `reportEvents` keeps the earliest
announcement per period and a filer does not announce the same quarter twice on
an 8-K. So it compares two announcement dates and needs no plausible-lag window
to guess with. The mutation that drops the ordering test fires on an up-to-date
filer, which is what would make the notice mean nothing.

Guards: 8-K only, never a 6-K (no item codes, selected positionally — too weak
to hang a claim about a specific quarter on) and never an 8-K/A (re-announces a
period already announced); nothing when the announcement is from today, because
companyfacts was never going to carry it yet; nothing when the cadence cannot be
read, because the notice names a quarter; nothing when the derived quarter has
not ended.

It is computed by the **cron**, from the submissions payload already in hand, and
stored. The page reads it. Deriving it on a render would mean fetching EDGAR from
a page render, which this pipeline does not do.

### 11e. The censuses

**Five-year card rows change: 3 of 786 SYMBOLS** (relay run 35140905294). No
symbol's snapshot anchor, `basis` or `tableBasis` changes — every affected
filer's newest QUARTER already sat at or after the trailing year that was being
dropped, so `latest` was the quarter either way.

```
AMCR   drops 2 of 5 year rows: 2024-09-28 · 2023-09-30   (fiscal year end 2026-06-30)
AMZN   drops 5 of 6 year rows: 2026-06-30 · 2026-03-31 · 2025-09-30 ·
                               2025-06-30 · 2025-03-31   (fiscal year end 2025-12-31)
                               newest year row 2026-06-30 -> 2025-12-31
BG     drops 2 of 6 year rows: 2026-03-31 · 2025-03-31   (fiscal year end 2025-12-31)
                               newest year row 2026-03-31 -> 2025-12-31
```

AMCR's two are September ends on a June filer; AMZN's and BG's are March/June/
September ends on December filers. Every one of them is a trailing twelve months.

**The notice shows on 41 SYMBOLS today** (relay run 35141767176, all 786
screened, 500 with a stored fact set). Every one is a June quarter announced in
late July and still absent from companyfacts — ABT, BG, MAA, NEE, PYPL, SOJE
among them. AAPL, AMZN and AMCR do not show it, which is the control: their
figures are current.

The 41 is a subset of §10c's 58: that count included 20-F filers with no Item
2.02 8-K at all (excluded here by design) and symbols whose cadence could not be
read.

### 11d. Recorded, not built — reading a filing's own XBRL

When companyfacts lags a filed 10-Q by more than ~30 days, the figures exist in
the filing's own inline XBRL (`Financial_Report.xlsx`, or the `R` files behind
the filing index) and could be read directly, per-symbol, on demand.

Against it, today: it is a **second extraction path** for the same numbers, and
this repository's standing rule is that two sources for one value is the
divergence it keeps finding (`claude/traps/two-validators-for-one-value.md`).
Every identity check, every derivation code and every restatement tripwire is
built around companyfacts' shape. A second reader would need all of it again or
would quietly bypass it.

For it: the lag is real and measured — **58 of 786 SYMBOLS** — and a filer that
has published its results is not a filer whose figures are unknowable.

The notice in 11c is the cheap half of the answer and costs nothing. The
extraction is a project, and it needs a ruling rather than a commit.
