# An ADS filer's EPS is per ordinary share too — measured, not assumed (2026-09-21)

Relay runs [35588311972] (us-gaap only) and [35588547888] (both taxonomies),
`scripts/ads-eps-unit-probe.mjs`. Read-only, uncredentialled; sec.gov is
403 CONNECT from the agent sandbox, so this could only run on a runner.

## The question

#489 suppressed the market cap for HDB, IBN, TSM, BABA and ASML because the
cover-page share count is in **ordinary shares** while every price on this site
is per **ADS**. It recorded the P/E beside it as OPEN and explicitly refused to
settle it by assuming symmetry: a cover-page count is a count of ordinary shares
*by definition*, whereas EPS is whatever the filer **chose** to state, and 20-F
filers differ.

## The test, which looks up no ADS ratio

Three numbers the filing states for the same period, from the **same accession**:

```
epsDiluted x sharesDiluted / netIncome
```

`sharesDiluted` is a count of ordinary shares, so:

- **ratio ≈ 1** → EPS is per ordinary share → same unit as the share count,
  different unit from the price → **the P/E is defective**
- **ratio ≈ N** → EPS is per ADS at ratio N → same unit as the price → correct

The ratio falls out of the filer's own arithmetic, so no external ratio table is
consulted and a filer that changed its ratio describes itself.

## Result

| Symbol | Namespace | Periods | Median | Range | Verdict |
|---|---|---|---|---|---|
| HDB | `us-gaap` | 47 | 1.0000 | 0.9787–1.0104 | per ordinary → **defective** |
| TSM | `ifrs-full` | 11 | 0.9999 | 0.9974–1.0031 | per ordinary → **defective** |
| BABA | `us-gaap` | 47 | 0.9984 | 0.9913–1.0246 | per ordinary → **defective** |
| ASML | `us-gaap` | 51 | 1.0002 | 0.9967–1.0205 | per ordinary → **defective** |
| IBN | — | — | — | — | **no XBRL companyfacts at all** |

**Four of five confirmed.** The assumption was right — and it was right for
reasons the first run could not see, which is the whole argument for measuring.

## Two things the first run got wrong, and reported rather than resolved

**TSM came back `{netIncome: 0, sharesDiluted: 0, epsDiluted: 0}`.** That is not
a filer missing three tags; it is a filer with **no `us-gaap` facts at all**,
because it reports under `ifrs-full`. The probe returned `NO OVERLAPPING
PERIODS — cannot be judged` rather than turning three zeroes into a verdict. A
lenient version would have reported "no evidence of a defect" and been believed.
`secFields.ts` already reads `ifrs-full` via `ifrsChain`, so TSM's EPS reaches
the page through a namespace the probe had never looked in. Extending the probe
to both namespaces — **one winning outright, never merged**, since a `us-gaap`
net income intersected with an `ifrs-full` share count compares two measurement
bases — resolved TSM at 0.9999 over 11 periods.

**IBN's `companyfacts` 404 was ambiguous.** Asking `submissions` as well
separated the two causes: the filer **exists** (6-K and 20-F on file) and
publishes **no XBRL**. So nothing can be extracted for IBN at all — its
suppression is vacuous today, and is kept so the rule is already in place if it
ever starts filing XBRL.

## What shipped

Two **distinct** refusals, not one:

- `ads-ratio-makes-shares-incomparable` — market cap. True by definition.
- `ads-ratio-makes-eps-incomparable` — P/E. **Measured**, per the table above.

Collapsing them would still suppress both figures, so a test asking only "is it
refused" would pass — but the P/E would then blame the share count, which is not
why it is absent. `scripts/check-sec-valuation.mjs` §6 carries a mutant for
exactly that collapse.
