# BUILD BRIEF — /earnings-calendar v1 (2026-09-15)

> **PARTIAL MIRROR — §9 ONLY.** Mirrored 2026-09-21 from the operator's paste.
> Only §9 (the mutant list) was supplied; §§1–8 have **not** been recovered and
> are not reconstructed here, because the brief is the DENOMINATOR for coverage
> and a reconstructed denominator is worse than an absent one — it would read as
> the real list to whoever opens this next.
>
> **To complete this file, paste §§1–8 and they will be committed verbatim.**
> Until then, treat any claim about "what the brief says" outside §9 as
> unsourced. This file is cited by `scripts/check-brief-mutants.mjs`.

## §9 — The ten mutants

The denominator for coverage on this build. All ten are named in every mutation
run, whatever their status.

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
