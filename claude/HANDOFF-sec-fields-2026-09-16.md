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

## The next investigation — one class, three candidate causes

**GEV capex, KTOS capex and KTOS cash are all TAGGED and IN CHAIN, and all three
render blank.** That is not a chain gap. Something between extraction and render
is dropping a value it already has.

Separate them in this order:

1. **YTD differencing wants a prior frame that is not stored.** The extractor
   steps one frame-length at a time (`byLen.get(f.n - 1)`), so a filer with H1
   present and Q1 absent cannot yield Q2. **Check whether OCF and capex resolve
   from different frame chains for GEV** — OCF derived fine on the same filing,
   so whatever capex lacks, OCF has.
2. **The balance-sheet instant is not the date cash was filed at.** KTOS tags
   `CashAndCashEquivalentsAtCarryingValue = 1,437,600,000` at **2026-06-28**;
   check what `set.instants[0]` actually is in the stored set.
3. **The new "Not reported" path intercepting a present value.** Least likely —
   `CellValue` only takes that branch on `cell.val == null` — but rule it out.

The KTOS fixture was captured (relay **35020873004**) and is **not decoded or
committed**; decoding base64 out of CI logs is what ran the context down. Decode
it and inspect locally — that answers (2) and (3) immediately.

---

## Outstanding, in order

1. **Decode and commit the GEV and KTOS fixtures** (relay 35020873004 for KTOS;
   GEV from relay 35017270505). GEV is the spun-off filer with 4 fiscal years —
   the real-world case for "a year with no prior year is a base, not a row",
   currently asserted on AAPL stored at y=5.
2. **Diagnose the three blank-but-tagged cells** above. Add KTOS as a fixture and
   assert cash renders 1.44B. Mutation: whichever cause it was, reintroduce it →
   fails.
3. **Null rate per field across all stored SYMBOLS, before and after** the VRT
   addition. **The VRT change is currently UNMEASURED** — it is in the branch and
   nothing shows it does not disturb anything else. It should not merge on my
   word alone.
4. **Canaries:** revenue 25/25, AAPL TTM. **Identities table re-run.**
5. **Cowork eye-check** — GEV, KTOS, VRT, TSLA, KGC — then merge #467.
6. **Next PR: refresh-on-view + CIK on cold writes (with backfill).** ONDS-type
   symbols never refresh until this lands: ONDS's manifest entry has **no CIK**,
   and `populationQueues` filters on `e.cik`, so it is in no cron queue at all.
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
