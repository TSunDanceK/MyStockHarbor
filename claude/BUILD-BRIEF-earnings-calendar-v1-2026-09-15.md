# BUILD BRIEF — /earnings-calendar v1 (2026-09-15)

> **PARTIAL MIRROR — §§6 (tail) to 10.** Mirrored 2026-09-21 from the operator's
> pastes, in two rounds: §9 first, then §§6(tail)–10.
>
> **§§1 to 5, and the head of §6, are still MISSING and are NOT reconstructed
> here.** The brief is the denominator for coverage on this build, and a
> reconstructed denominator is worse than an absent one — it reads as the real
> list to whoever opens it next. Treat any claim about "what the brief says"
> outside the sections below as unsourced.
>
> Cited by `scripts/check-brief-mutants.mjs`, which reads §9 as the denominator.

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
| **0** Consensus freeze | nothing | **irreversible, do first** |
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
