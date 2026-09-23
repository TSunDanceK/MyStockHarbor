# BUILD BRIEF — /earnings-calendar v1 (2026-09-15)

> **COMPLETE MIRROR.** Mirrored 2026-09-21 from the operator's pastes, in three
> rounds: §9 first, then §§6(tail)–10, then §§1–5. The earlier PARTIAL warning is
> removed because the gap it named is closed.
>
> §6's head — the measurement that chose k=7 — was never supplied separately; the
> tail below opens at the top-50 cut. That is the one known remainder.
>
> Cited by `scripts/check-brief-mutants.mjs`, which reads §9 as the denominator.

---

## §1 — What the page becomes

Two halves, each with one honest promise.

**Top — "Due to report".** Top 50 by market cap, k=7. The existing
`getUpcomingTickerItems` strip, re-sourced. Nearest 8–10 visible, expand on a heavy day
(peak max is 21).

**Below — the confirmed grid.** Window inverts to roughly the last 90 days. Same grid,
same day list, same sortable headers, same paging, same dedupe. Only the direction changes
and some of the fill machinery deletes.

URL stays `/earnings-calendar`. H1 and description change to match the content.

---

## §2 — Field inventory — what ships and how far to trust it

| field | source | trust |
|---|---|---|
| Symbol, company | `company_tickers_exchange.json` | exact, public-domain identifiers |
| Date reported | the results filing per §3 | exact, lands within a day |
| Revenue, year-ago quarter | `msh:sec:facts:v1:SYM` | exact as filed, needs the tag chain |
| EPS, year-ago quarter | same source | exact as filed, needs fiscal matching |
| Delta between them | arithmetic on two filed facts | exact |
| Presence dots | confirmed filings | exact |
| Price | the whole-market bar store (**now revised, see handoff decision 7**) | exact but a **close** — label it |
| Market cap | shares × close | derived, needs care, §5 |
| Due strip | top 50, k=7 | ~3%, with attribution uncertainty of similar magnitude |

**Do not build:** EPS/revenue estimates, surprise, beat/miss dots, predicted dates for the
full universe, the Overdue badge. All either have no licence-clean source or were measured
and failed.

---

## §3 — The results date — the spine of both halves

A results filing is the **first 8-K carrying item 2.02 after period end P**. For foreign
private issuers use **6-K**, deduplicated on `accn`, preferring one whose `reportDate` is a
quarter end — ARM files them in same-day pairs, measured.

Prefer the **strict** form — items containing **2.02 AND 9.01** — falling back to loose when
strict resolves to **zero**. Measured: resolves 12.3% of ambiguous periods outright, drops
the lag-outlier rate 51.5% → 44.7%, and only 0.8% resolve to zero and need the fallback.
Free and strictly better; it does **not** fix attribution and is not expected to.

The daily index gives **form type only, not item numbers**. Items come from
`data.sec.gov/submissions/CIK##########.json`, approximately 25 KB a symbol.

**Storage recommendation:** extend the existing manifest rather than adding a parallel store
— `msh:sec:manifest:v1` plus `lastResultsDate`, `lastResultsPeriod`, `lastResultsAccn`. Both
halves read it — the grid inverts it by date, the strip asks which periods have no entry.
One dataset, one source of truth, no drift between two answers to the same question.

> *(This recommendation was implemented and later fully reconciled — see handoff decision 4
> — `secResultsDate.ts`, the parallel store that resulted, has since been deleted entirely
> in favour of `secReportDatesStore`.)*

---

## §4 — The year-ago columns — where wrong numbers get built in

`end − 365 days` is **wrong** for any 52/53-week filer (AAPL's quarter ends 26 Sep one year,
28 Sep the next). Measured fiscal year ends across five probe symbols: 31 Mar, 26 Sep, 3
Sep, 31 Oct, 31 Dec. **Nothing may assume calendar quarters.**

Resolve in order:

1. **`frame` when present** — match `CY<year>Q<n>` against `CY<year−1>Q<n>`. SEC assigns
   non-calendar periods to the nearest calendar frame, so this is both correct and robust,
   but not present on every fact.
2. **duration plus tolerance** — comparable duration (about 90 days) whose `end` falls
   within ±7 days of one year before the current period's `end`.

**Never match on `fy` or `fp`.** Those describe the *report the fact was filed in*, not the
fact's own period, and silently pair wrong quarters across a fiscal boundary. Cross-check
only.

**Tag chain order for revenue:** `RevenueFromContractWithCustomerExcludingAssessedTax`, then
`Revenues`, then `SalesRevenueNet`. `Revenues` is **legacy** — AAPL's latest value is
2018-09-29, MU's is 2018-08-30. It must sit **below** the contract-revenue tag or large
filers render 2018 revenue as current.

**Rows that get a dash:** recent IPOs and spin-offs (no year-ago quarter exists),
pre-revenue filers (a delta off a de-minimis base is meaningless). Absence stated honestly,
never a zero.

---

## §5 — Market cap — the only column that can be quietly wrong

It is the **default sort**, so an error reorders the page rather than printing one bad cell.
Expect the first bug here.

**Multi-class:** `dei:EntityCommonStockSharesOutstanding` is filed per share class with
different contexts. **Group tickers by CIK** and compute the sum of each class's shares ×
that class's own close, assigning the group total to every ticker in it. Otherwise GOOGL
reads as half of Google.

**Foreign private issuers get no market cap.** Shares are filed in ordinary shares, price is
per ADS, TSM is 1 ADS = 5 ordinary — the naive product is out by 5×, and the ADS ratio lives
in the F-6 and is not structured anywhere free. Detection is free from the form set
(20-F/6-K). Existing sort is nulls-last, so they fall to the bottom.

> **Departure, flagged for veto at the time:** HDB, IBN, TSM, BABA and ASML currently showed
> a cap and would stop. Owner previously chose to keep ADRs in the list; this changes how
> they present, not whether they appear. *(Resolved — see handoff decision 2, implemented in
> #489 and #491.)*

**Tag chain:** `EntityCommonStockSharesOutstanding`, then `CommonStockSharesOutstanding`,
with the **weighted-average diluted tag explicitly excluded** — a different number that
looks like the right one.

---

## §9 — Mutation coverage

The review step has failed to catch this class **six times this week** — every instance
caught by machinery instead. Assume it will fail again.

The denominator for coverage on this build. All ten are named in every mutation run,
whatever their status.

1. `frame` matching replaced by `end − 365`
2. `Revenues` promoted above the contract-revenue tag
3. `fy`/`fp` used as the primary match
4. year-ago absence rendered as `0` rather than a dash
5. multi-class grouping removed (per-ticker cap instead of per-CIK)
6. FPI market-cap suppression removed
7. weighted-average diluted tag admitted to the shares chain
8. strict 2.02+9.01 falling back to loose when strict resolves to one, not zero
9. due-strip k changed from 7
10. 30-day overdue cap removed

And the standing rule, because it has earned it: **a measurement that cannot attribute its
own zero is not a measurement.** Every counter that can read zero needs a denominator
beside it. The mutation suite rewrites tracked files in place and must never overlap a
commit.

### The denominator does not shrink

Owner decisions 4 and 5 of 2026-09-21 put whole-market bars and stage 5
(dynamic top-50) **off the roadmap**, so two of these ten describe a stage that
will never be built. They are **permanently inapplicable**, not covered:

- **#1 `frame` matching replaced by `end − 365`** — belonged to the stage-5
  dynamic ranking path.
- **#3 `fy`/`fp` used as the primary match** — same path.

**#9 (due-strip k) and #10 (30-day overdue cap) stay LIVE**, because they apply
to the static-list strip, which decision 6 made permanent rather than interim.

The distinction is recorded rather than netted out. Dropping the two from the
denominator would move coverage from *n*/10 to *n*/8 and read as progress that
did not happen, which is the one thing a coverage number must never do.

---

## §6 (tail) — The cut, and the overdue cap

Restricted to the **top 50 by market cap**. Measured: peak median 5.5, peak max 21,
false negatives 3.0%, dwell median 7 days.

**Take 50, not 20.** The rate does not fall monotonically with cap — top-20 is *worse*
at k=5 and k=7 because its rate is computed over a peak median of 1 symbol and is noisy.

**v1 simplification, flagged:** compute the top-50 membership from a **static committed
list** rather than live market cap. Top-50 membership changes a few names a quarter, and
this decouples the strip from the bars migration entirely. Regenerate when convenient;
note the generation date in the file so staleness is visible. **AS OF 2026-09-21, this is
the permanent approach — see HANDOFF-earnings-calendar-v1-2026-09-21.md decision 6. It
will not be replaced by live ranking.**

**Overdue: cap membership at 30 days past the statutory deadline (40 days after period
end for large accelerated filers, 45 otherwise), with no UI.** Measured within the cut:
2 entries in twelve months, 4 symbol-days total, both mega-caps in the 31 December crush,
both cleared by real filings, and the cap clears 0 of 2. It is a safeguard that has never
fired — **say so in a comment**, so nobody later "fixes" it believing it broken. Across
the full universe the same cap clears 22 of 310, so it does real work if the cut ever
widens.

---

## §7 — Copy

House register: hedged, never prescriptive. "Results have not yet been filed", not "will
report". The page describes what is outstanding and what arrived; it does not tell a
reader what to expect or what to do about it.

- **The strip is a cut, and the page must say so** — the largest companies with results
  outstanding, not a census. Leaving it implied is the thing that breaks trust.
- **Price is a close**, not an intraday figure. Label it.
- **Empty state is informative.** Quiet median is 6 at k=7, and between seasons it may be
  near zero. "No results currently outstanding" is true and useful; an empty box is not.
- Every score or figure derived from filings is **backward-looking only**. Nothing on this
  page says anything about expectations.

---

## §8 — Build order and what gates on what

| stage | needs | notes |
|---|---|---|
| **0** Consensus freeze | nothing | **irreversible, do first** — superseded 2026-09-23 (#552): no FMP data is stored; removed |
| **1** Results date in the manifest (§3) | step 2 (merged, #454) | unblocks both halves |
| **2** Window inversion + strip shell | stage 1 | page works without FMP |
| **3** Year-ago columns (§4) | **step 3 fact sets** | see `BRIEF-step3-extraction-and-retention` |
| **4** Price + market cap (§5) | **current 700-symbol universe's bar source, revised 2026-09-21 — see handoff** | until then, hide rather than render absent |
| **5** Dynamic top-50 | **CLOSED 2026-09-21, will not be built** | see handoff decision 6 |

Stages 1–2 can land before step 3. The page is thin without the year-ago columns, but a
thin working page beats one that empties 24 hours after the key dies — measured, not
assumed.

All behind `FUNDAMENTALS_PROVIDER = "sec" | "fmp"`, FMP adapter left compiling in the tree.

### On the window inversion

`findNextIncompleteDate` walks front-to-back from a frontier pointer, so reversing the
window reverses that walk — more than flipping two constants. But **past dates settle
permanently**: once populated a date is final barring a restatement, so the hourly cap, the
frontier and the re-population walk get simpler or delete outright. A fair part of the
machinery fixed in #459 exists only to service a window that keeps moving.

---

## §10 — Explicitly deferred to next week

Not in v1, recorded so they are not silently dropped:

- Segment revenue extraction (§3.3 of the 2026-09-13 build brief — the axis traps are real)
- Score re-base and `scoreVersion` (§2 of that brief)
- Resolving the ~2% attribution residue, which needs exhibit documents
- `earningsRow` dump declaration fix (traced, not yet applied)
- The month-level cadence question — deliberately not measured; even a good number does not
  rescue a grid
