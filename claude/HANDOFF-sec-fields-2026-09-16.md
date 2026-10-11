# Handoff — SEC field diagnosis, PR #467

Written 2026-09-15 at the end of a long session, for whoever picks this up
(including me in a fresh context). **PR #467 is NOT ready to merge.**

Branch: `diag/cold-path-window` → PR
[#467](https://github.com/TSunDanceK/MyStockHarbor/pull/467). Base: `main` @
`8cfbc410`.

---

## What is done and pushed

### Rulings from the owner, all applied

- **(a) GEV cash — chain NOT changed.** When `cash` is null and
  `cashIncludingRestricted` has a value, the balance sheet renders that figure
  under **"Cash & equivalents (incl. restricted)"** with a sub-line saying the
  company cannot freely spend it. Net cash's sub-label carries the same
  qualifier, because it is built on the same leg. Decided once in
  `buildSecEarningsView` (`cashIncludesRestricted`), so the two cards cannot
  disagree about which figure they showed.
- **(b) VRT — approved and added.**
  `DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLossCurrent`
  → `shortTermInvestments`. **Its fair-value twin is deliberately NOT added:**
  it carries the same 300,000,000 for VRT and will not for a filer whose
  holdings have moved, so taking whichever appeared first would make the column
  mean different things on different symbols. `ProceedsFromSaleOfShortTerm-
  Investments` is also excluded — it matched the name pattern and is a
  cash-flow item, not a balance.
- **(c) KTOS finance leases into `totalDebt` — declined**, as instructed.
  Definitional, not a gap.
- **(d) GEV SBC equity roll-forward lines — rejected.** The re-run found
  `ShareBasedCompensation` is tagged (see below), so those lines were noise
  beside a real concept, not the only candidates.

### The probe was wrong, and now says so itself

`scripts/sec-missing-field-probe.mjs`, relay task `sec-missing-fields`.

The first version kept only duration frames of **80–105 days**. US filers report
cash flow **year-to-date** and never file a standalone 3-month frame, so it
reported NOT TAGGED for every cash-flow field on every filer. The owner's GEV
screenshot — "Operating cash flow $5.49B **derived**" — was the evidence against
it, and was right.

Fixed: durations accept any frame ending on the period's end date (the length is
printed, so a YTD figure is never mistaken for a quarterly one); instants must be
**real instants** (no `start`) within ±10 days of the balance-sheet date.

**The self-check is permanent, not a flag.** Every run re-judges each duration
field under the old 80–105 day rule and prints both verdicts. A run where
nothing flips says so and tells the reader not to trust it.

Re-run, relay **35020866364**:

```
FLIPS   GEV    operatingCashFlow       wide=TAGGED   3M-only=NOT TAGGED
FLIPS   GEV    capex                   wide=TAGGED   3M-only=NOT TAGGED
same    GEV    shareBasedCompensation  wide=TAGGED   3M-only=TAGGED
FLIPS   KTOS   capex                   wide=TAGGED   3M-only=NOT TAGGED

3 verdict(s) differ — the frame rule is doing the work, and the old one was wrong about them.
```

Three of four verdicts I had reported were wrong, in the direction that would
have justified adding concepts the filer already tags.

The verdict line now prints **`IN CHAIN: YES/no`** so "in chain and still blank"
is never told apart from a chain gap by reading the list.

---

## The next investigation — ANSWERED, and it overturned its own premise

**Resolved 2026-09-15.** The premise below was wrong, and the probe that
supplied it had in fact already said so.

> ~~GEV capex, KTOS capex and KTOS cash are all TAGGED and IN CHAIN, and all
> three render blank. That is not a chain gap.~~

It is a chain gap. `sec-missing-fields` prints a verdict line reading
`=> IN CHAIN: no | CHAIN GAP` for capex on **both** filers; what got carried
into this handoff was the `wide=TAGGED` column of the self-check flip table,
which says the filer tagged *something matching the name pattern* — not that
our chain lists it. Two different questions, one line apart in the same output.

### What was actually measured

`scripts/sec-blank-cell-probe.mjs`, relay task `sec-blank-cell`, runs
**35024074183** (GEV/KTOS/AAPL) and **35024136855** (sec-missing-fields):

```
GEV   PaymentsToAcquirePropertyPlantAndEquipment   ABSENT FROM PAYLOAD
KTOS  PaymentsToAcquirePropertyPlantAndEquipment   ABSENT FROM PAYLOAD
AAPL  PaymentsToAcquirePropertyPlantAndEquipment   105 rows, ladders complete
```

The `capex` chain held **one** tag. Neither filer publishes it, so capex was
null on every stored quarter and every stored year for both, and the Quality of
Earnings card said "Can't calculate — capital expenditure not reported" beside
an operating cash flow that had differenced perfectly. AAPL is the control that
proves the instrument reports a working chain as working.

**All three reported blanks reduce to that one defect. None of the three
suspected causes survives:**

1. **YTD differencing** — there was nothing to difference. OCF's frame ladders
   are complete on both filers; capex's have no rungs at all, because it has no
   rows at all.
2. **The balance-sheet instant** — KTOS's `instants[0]` **is** 2026-06-28, with
   13 of 46 fields filled and cash at 1,437,600,000 on it. A fresh extraction
   renders KTOS cash. If the live page showed it blank, that is a **stale
   stored set**, which is the refresh-on-view item below, not an extraction bug.
3. **The "Not reported" path** — `CellValue` only takes that branch on
   `cell.val == null`, and the view's own capex value is null. Exonerated.

GEV cash is not a new find: GEV publishes no plain cash concept at all, only
`CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` (13.12bn at
2026-06-30). That is ruling (a), already applied.

### The fix, and what it deliberately does not take

`PaymentsToAcquireProductiveAssets` appended to the capex chain — GEV 783m,
KTOS 37.1m, each on the 6M frame of the 2026Q2 10-Q. **Second, not first:**
resolution is rank-first per period, so a filer publishing both keeps the
narrower PP&E reading and AAPL does not move.

Three near-misses were on the same printed list and are excluded, each named in
`secFields.ts` with its value and guarded by name in check §14:

| concept | why not |
|---|---|
| `PaymentsToAcquireBusinessesNetOfCashAcquired` | buying companies, not building assets — 6x overstatement on GEV |
| `PaymentsToAcquireEquityMethodInvestments` / `...InterestInJointVenture` | investments |
| `CapitalExpendituresIncurredButNotYetPaid` | **non-cash** accrual disclosure; wrong kind of thing for a cash line, and 9.1m against KTOS's real 37.1m |

### Retroactivity — built, and it costs nothing today

`needsReread` (lib/server/secStaleness.ts) selects on **w, y OR c**, where `c`
is `secChainsHash()` recorded on the manifest entry at write. One exported
function, so refresh-on-view imports it rather than agreeing with it. The
rewindow queue keeps its name, its allowance and its path — one companyfacts
payload carries all three, so a second queue would be two allowances competing
for one re-read.

**Census, relay 35028639653, against the live manifest:**

```
reverify   103 of 103 SYMBOLS @ 150/run -> 1 day
populate   300 of 647 SYMBOLS @ 300/run -> 3 days
rewindow     4 of   4 SYMBOLS @  25/run -> 1 day
rewindow queue: AAPL AZN MU RYAAY

WHY THOSE 4 ARE ELIGIBLE (a symbol can be behind on more than one)
  quarter window behind   4
  year window behind      4
  chains behind           4     (current chains 00e11f3c)
  of which chains ONLY    0
```

**The chain condition adds ZERO symbols today**, and that is worth stating
rather than glossing: only 4 SYMBOLS are job-populated at all, and all four are
already behind on both windows. 647 are still unpopulated, so the universe is
populate's problem, not rewindow's. The chain condition earns its keep on the
NEXT chain edit, once populate has drained — which is precisely the case
`SEC_REWINDOW_PER_RUN = 25` was sized for.

### Blast radius, both chain edits, 119 SYMBOLS each

`sec-capex-blast` (relay 35028632974) and `sec-sti-blast` (relay 35028627452).
Shipped extractor run twice over one payload — chain minus the entries the edit
added, then as it ships.

| | CHANGED | GAINED | same | empty both ways |
|---|---|---|---|---|
| `capex` | **0** | **24** | 85 | 10 |
| `shortTermInvestments` | **0** | 0 | 69 | 50 |

**Nothing moved on either.** The VRT gate — merge only on 0 CHANGED — is met.

shortTermInvestments gains nothing across those 119 because **VRT is not among
them** (it is not in the first 120 of the analysis universe). Aimed at VRT
directly (relay 35028964792): **VRT 0 → 6 of 26 periods, 0 CHANGED.** That is
the ruling's own justification, measured rather than restated.

capex's 24: NVDA, AMZN, V, HD, CVX, QCOM, ISRG, REGN, PANW, LRCX, HPE, HPQ,
SOFI, KEY each 0 → 18 of 18 periods. PEP 0→14, HIMS 0→14, NIO 0→8 of 8,
COP 0→3 of 18. Partial gains show per-period resolution working rather than one
tag per symbol: GE 3→18, ANET 9→15, MELI 9→17, MRK 17→18, TT 16→17, MAR 16→17.

### Two concepts down one column — I CANNOT give this a clean bill

The question was whether a filer resolves a field from more than one concept
across its periods. **It does, often, and that was true before this PR.**

```
MIXED CONCEPTS   capex                 23 of 119 SYMBOLS
                 shortTermInvestments  20 of 119 SYMBOLS
```

shortTermInvestments' 20 are **entirely pre-existing** — provably, because that
edit's GAINED and CHANGED are both 0, so the added concept won nothing anywhere
and every mix comes from the three chain entries that were already there. AAPL,
META, TSLA, MRK, CRM, IBM and 14 others already resolve it from two or three
concepts across their history.

This is not automatically wrong. Per-period resolution exists so AAPL's revenue
can be `Revenues` before 2018 and `RevenueFromContractWithCustomer...` after —
the filer changed its presentation and the column follows.

**But there is a concrete harm, and for capex it is not small:**

```
BLOCKED BY A MID-YEAR TAG CHANGE   capex   46 year-spans
```

The extractor refuses to difference across a tag change — the ASC 606 guard —
so a filer that switches concept mid-year loses that year's quarters. ANET does
it in six consecutive years (2020–2025); AAPL, NVDA, MRK, CAT, GE, AMAT, PANW,
MELI, AMGN and ISRG all appear.

**It is not a regression: `CHANGED = 0` proves no cell that had a value lost
one.** Those quarters were null before too, for the duller reason that the
concept was not in the chain at all. What changed is that the null now has a
name in the extractor's notes.

**The follow-up this suggests, NOT taken here:** allow differencing across a tag
change when both tags belong to the SAME field's chain. The guard exists to stop
subtracting across an ASC 606 boundary, where the two concepts are different
measures; two entries of one capex chain are not that. It relaxes a deliberate
safety rule, so it is the owner's call and belongs in its own PR with its own
measurement.

`n/a`, not `0`, is printed for BLOCKED on an instant field: instants are never
differenced, so the count cannot fire there however badly concepts are mixed,
and a zero in a risk column reads as reassurance.

### Canaries, null rate and identities — before against after

Both from the SAME commit, `sec-extract-before` (relay 35029338511) against
`sec-extract` (relay 35029344672). The only difference between the runs is this
branch's two chain additions, reverted in the first.

**Every line is identical.**

```
CANARY revenue quarters AGREE   25/25    (baseline 25/25)      unchanged
CANARY AAPL TTM                 revenue / operatingIncome / netIncome /
                                freeCashFlow all AGREE, epsTtm NO-GT,
                                divPerShare CLOSE               unchanged
D1 null rate, 8 quarters, all symbols
  sharesBasic / sharesDiluted / epsBasic / epsDiluted
                                10/40 null (25%) each           unchanged
Identities
  assets = liabilities + equity              40/0   100%        unchanged
  grossProfit = revenue - costOfRevenue      32/0   100%  (8 skipped)
  operatingIncome = gp - opex                27/5    84%  (8 skipped)
  op + inv + fin + fx = netChangeInCash      39/1    98%
  cashEnd - cashStart = netChangeInCash      32/3    91%  (5 skipped)
STRUCTURAL ASSERTIONS            65/65 pass                     unchanged
```

**Read this for what it is.** It proves nothing regressed; it does NOT measure
the change, because this probe's five fixed symbols (ARM, AAPL, MU, PLAB, ASTS)
all publish the PP&E concept and none of them needs the fallback. The effect of
the change is the 24 GAINED in the blast run, not here. The D1 null-rate table
covers only the four shares/EPS fields, so it cannot show capex either.

**And running it at all required a fix.** `sec-extract` had been dying on `main`
since the crossing strings landed: `Pct` is `number | PctCrossing | null`, ASTS
is loss-making, and the probe called `.toFixed(1)` on `"swung-to-loss"`. The
optional chain is why it survived review — `?.` guards null, not the wrong kind
of thing. **Neither canary had run since.**

### The eye-check: which sets are actually re-read

A page renders from the STORED set, so this is the difference between testing
the fix and testing a stale set. From the same census:

| symbol | state |
|---|---|
| GEV | **never populated** — `contentHash` null, so it is POPULATE's |
| KTOS | **never populated** |
| VRT | **never populated** |
| NVDA | **never populated** |
| AAPL | STALE (quarters, years, chains) — `w`/`y`/`c` all absent |

None of the four eye-check symbols is in the rewindow queue at all. They reach
today's chains through **populate** (300/run, ~3 days to drain 647) once this is
deployed and the cron has run — not on the preview, which runs no cron. 39
SYMBOLS have a cold-path set the manifest does not record, and those are
populate's too.

**So on the #467 preview, GEV/KTOS/VRT/NVDA will show the OLD capex.** That is
expected and is not this PR failing. The fixtures are how the fix is checked
before then: §14 renders GEV and KTOS through the shipped cards.

### What it does NOT do

**The fix does not reach a stored set on the preview.** Retroactivity is built
(above) but it runs on the CRON, and a preview deployment runs no cron. The
eye-check symbols are POPULATE's, not rewindow's, and populate needs ~3 days to
drain 647 SYMBOLS after this deploys.

**And it does not un-block a mid-year tag change.** 46 capex year-spans stay
null for that reason; see above for why that is not a regression and what the
follow-up would be.

---

## Outstanding, in order

1. ~~Decode and commit the GEV and KTOS fixtures.~~ **Done** — captured at the
   corrected chain (relay 35024551826), SHA-256 verified against the runner's
   own hash of the plaintext: GEV `b21d9fb4…` 11,811 B, KTOS `71f3e83c…`
   14,706 B. (KTOS decodes to 14,708 *bytes*; the runner printed a JS string
   length and the entity name carries two U+00A0. The hash is over the same
   bytes and matches.) GEV is still the spun-off filer with 4 fiscal years —
   the real-world case for "a year with no prior year is a base, not a row".
2. ~~Diagnose the three blank-but-tagged cells.~~ **Done, above.** §14 asserts
   capex renders on both, read out of the markup; mutation (i) nulls every
   capex cell of the real GEV fixture and the card comes back saying "Can't
   calculate". Three structural assertions (chain order, near-miss guard) were
   each run under the mutation that breaks them.
3. ~~Null rate per field, and the VRT addition measured.~~ **Done.**
   `sec-sti-blast` (relay 35028627452): **0 CHANGED**, 0 GAINED over 119
   SYMBOLS — the merge gate the handoff set is met. `sec-capex-blast` (relay
   35028632974): 0 CHANGED, 24 GAINED. The null rate per field before/after
   comes from `sec-extract` against `sec-extract-before`, which is the SAME
   probe with this branch's chain additions reverted — one code path run twice,
   not two refs. Dispatching at `ref=main` was tried first and is wrong twice
   over: it compares different code, and the probe crashes on `main`.
4. ~~Canaries and the identities table.~~ **Unblocked.** `sec-extract` had been
   crashing on ASTS since the crossing strings landed — `epsYoY` can be
   `"swung-to-loss"`, and the probe called `.toFixed` on it — so neither canary
   had run since. Fixed; the run pair is the record.
5. **Cowork eye-check** — GEV, KTOS, VRT, TSLA, KGC — then merge #467.
   **On the preview, GEV/KTOS/VRT/NVDA render the OLD capex**: all four are
   `contentHash: null`, so they are populate's, and a preview runs no cron.
   That blank is expected and is not this PR failing. The fixtures are the
   before-then check — §14 renders GEV and KTOS through the shipped cards.
6. **Next PR: refresh-on-view + CIK on cold writes (with backfill).** ONDS-type
   symbols never refresh until this lands: ONDS's manifest entry has **no
   CIK**, and `populationQueues` filters on `e.cik`, so it is in no cron queue
   at all. This PR now has a second reason to want it: a chain edit reaches a
   non-empty stored set only through a refresh.
7. **Then PR B (presentation, B1–B7)** — stashed on branch
   `feat/earnings-presentation`. View groundwork already written there: tone
   thresholds as one exported constant, prior-year margin deltas in percentage
   points, the waterfall residual, and the trend-summary derivation including
   the never-average-across-a-crossing rule. Reuses the page's existing
   `ChartFrame` / `CHART_VIEW_W` inline-SVG kit — **no new dependency needed**.

---

## Standing rules (they have caught real defects, repeatedly)

- **No check that can produce its own expected value.** A fixture that supplies
  the answer is not a check.
- **Run every assertion under a mutation** that breaks the property. If the
  mutation cannot make it fail, the assertion is decorative. Mutations go stale
  when the code they target moves — one in this session was passing by mutating
  a code path nothing travels any more.
- **Never treat string position as execution order.** This has been wrong three
  times. Lift the function and run it.
- **Every count says SYMBOLS or FILINGS.**
- **The FMP dump never enters the repo.**
- **Cowork reviews before merge; I commit.**
- **Never delete on absence.** Absence of evidence is not evidence of absence —
  it is the reason the probe exists.
- **Diagnose before changing a chain.** A blank cell is either a chain gap or
  nothing filed, and the two need opposite responses. Guessing is how a
  near-miss tag ships a plausible wrong number.
- **Quote a probe's VERDICT line, never a neighbouring column.** This handoff
  spent its whole "next investigation" section ruling out three causes that
  could not have been the cause, because `wide=TAGGED` from the self-check flip
  table was carried over as "in chain". The probe's own
  `=> IN CHAIN: no | CHAIN GAP` was one line away in the same output. The probe
  was right; the summary of it was not.
- **A probe that prints nothing has not reported nothing.** `sec-blank-cell`
  first printed a bare heading for capex on both filers — no rows, no reason —
  and an empty space reads the same whether the chain found no rows, the rows
  had no start, or no span mapped to a quarter count. Every filter a probe
  applies must print what it dropped and why, or the probe commits the exact
  error it exists to prevent.
- **Measure what a chain addition DISTURBS, not only what it fills.** Rank-first
  resolution makes displacement look impossible, but `byLen` picks one frame per
  length **by filing date**, so a later-filed same-length frame under a new
  entry can delete a differenced quarter outright. `sec-capex-blast` runs the
  shipped extractor twice over one payload to find it. And note how NOT to test
  it: reversing the chain moves the "before" run too, so both readings shift
  together and the probe correctly reports no change while appearing to prove
  the detector is dead.
- `automation/gcp-search-console-service-account.json` is a **live credential,
  deliberately kept out of GitHub**.

## Environment facts worth not rediscovering

- The sandbox **cannot reach** `data.sec.gov`, `*.vercel.app`, the production
  domain, or the Actions artifact blob host. It **can** reach `api.github.com`
  and npm. Everything networked goes through the relay
  (`.github/workflows/relay.yml`, `workflow_dispatch` only, no cron).
- **A local `next build` cannot complete** without the Upstash env vars — it
  fails identically on unmodified `main`, so a local build failure is **not**
  evidence a change broke something. `tsc --noEmit` and `check-all.mjs` are the
  checks that work locally; the Vercel preview is the only real build.
- `check-doc-citations.mjs` fails on `main` byte-identically (three dangling
  citations in `claude/`). **85 of 86 is the clean state.**
