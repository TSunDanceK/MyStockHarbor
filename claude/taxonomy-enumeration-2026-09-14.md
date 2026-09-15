# The sector/industry taxonomy, enumerated

**Date:** 2026-09-14
**Reference file:** `data/taxonomy.json` (generated — do not hand-edit)
**Generator:** `scripts/build-taxonomy-reference.mjs` · **Drift check:** `scripts/check-taxonomy-reference.mjs`

The ~144 industry labels existed only as values inside `data/static-profile.json`
and had never been listed anywhere. `screenerFields.ts` reads them off the cached
record, so there was no canonical list in code — and the SIC mapping table, the
news-art provider map and the screener filter each need one. **Three consumers
deriving the same list separately is three chances to derive it differently.**

Snapshot: **2,619 rows, 11 sectors, 144 industries, zero rows missing either label.**

## 1. Sectors — clean

All **11** labels, and all 11 resolve against `lib/sectors.ts`. Nothing is
dropping off sector pages today.

```
452 Financial Services   258 Consumer Cyclical    114 Consumer Defensive
399 Technology           165 Basic Materials      113 Communication Services
370 Healthcare           158 Energy               102 Utilities
352 Industrials          136 Real Estate
```

The check asserts the **labels**, not the count. A count of 11 could still hide a
mismatched spelling, and a twelfth label fails nowhere — it silently drops its
symbols off sector pages.

**Also measured: industry implies sector, 1:1.** No industry appears under more
than one sector, so anything keyed on industry alone can rely on that. Asserted,
because if it stops being true it stops being true silently.

## 2. Industries — a 175:1 spread and a long tail

```
industries 144   symbols 2,619   mean 18.2   median 11
largest   Biotechnology 175        smallest  seven singletons
```

| | industries | % of labels | symbols | % of coverage |
|---|---|---|---|---|
| ≤ 1 symbol | 7 | 5% | 7 | 0.3% |
| ≤ 2 | 11 | 8% | 15 | 0.6% |
| **≤ 3** | **16** | **11%** | **30** | **1.1%** |
| ≤ 5 | 32 | 22% | 99 | 3.8% |
| ≤ 10 | 68 | 47% | 379 | 14.5% |

**Smallest decile:** 15 industries, **27 symbols, 1.0% of coverage.**
**Largest decile:** 15 industries, **1,080 symbols, 41.2%.**
**Half of all symbols sit in the top 22 labels (15% of them).**

### What that decides

- **A flat 144-entry screener filter is not usable as-is.** Nearly half the
  entries hold ≤10 symbols and a fifth hold ≤5. A dropdown where 68 of 144
  options return a near-empty result is a worse affordance than search.
- **Per-industry news art needs a size floor.** Art for a 1-symbol industry is
  art for one page. The ≤3 band — 16 labels, 30 symbols, 1.1% of coverage — is
  the obvious first cut, and costs almost nothing in coverage to exclude.

### The tail contains near-duplicates, not just small categories

`Banks` (2) sits beside `Banks - Regional` (157). `Chemicals` (9) beside
`Chemicals - Specialty` (35). `Media & Entertainment` (1) beside `Entertainment`
(23). `Oil & Gas Energy` (1) beside five other Oil & Gas labels. Some of the tail
is taxonomy noise rather than genuinely small industries — which matters for any
mapping that has to pick a target.

## 3. Separators — 60% of labels, 61% of symbols

**87 of 144 labels** carry `-`, `&` or `,`, covering **1,601 of 2,619 symbols.**

```
containing "-": 61    containing "&": 38    containing ",": 5    BOTH - and &: 12
```

61 + 38 − 12 = 87; all five comma labels also contain `&`, so they sit inside the
38 rather than adding to it.

This is why the news-art spec abandoned regex matching. A separator-splitting
rule does not degrade on an edge case here — **it misfires on the majority of the
taxonomy.** And a rule written against `-` and `&` alone misses the five comma
labels: `Hardware, Equipment & Parts`, `Airlines, Airports & Air Services`,
`Furnishings, Fixtures & Appliances`, `Gambling, Resorts & Casinos`,
`Paper, Lumber & Forest Products`.

## 4. THE EXACT-MATCH RULE, AND ITS SCOPE

Recorded with the qualifier attached, because the rule is right for one concern
and wrong for the other, and the strings are the same in both.

| | |
|---|---|
| **IDENTITY — use exact match** | The news-art mapping, any SIC table, the screener's stored value, anything keyed on the label. A near-match here silently files a symbol under the wrong category. |
| **DISCOVERY — do NOT use exact match** | User-facing search. `screenerFields.ts` says industry is "the one people actually search for — 'semiconductor'". Typing `semiconductor` must match `Semiconductors`; typing `bank` must surface **all three** bank labels. Exact match returns nothing for both. |

Two different concerns over one set of strings. **Exact match is a storage and
mapping rule, not a search rule.** Applying it to search makes the field unusable
for its stated purpose; applying substring matching to identity is what the
news-art spec already rejected.

## 5. Head-term families — what prefix grouping would destroy

**14 families, 1,143 symbols (44% of coverage).**

```
Software (3 labels, 193)   Insurance (6, 106)    Apparel (3, 32)
Banks (3, 179) *bare*      Financial (5, 86)     Beverages (3, 20)
Medical (10, 155)          Industrial (4, 77)    Real Estate (3, 19)
REIT (9, 117)              Auto (4, 58)          Manufacturing (4, 17)
                           Chemicals (2, 44) *bare*   Drug Manufacturers (2, 40)
```

**Two families contain a bare label alongside qualified siblings:** `Banks` (2 of
179) and `Chemicals` (9 of 44). These are **flat siblings, not a hierarchy** —
`Banks` is a peer of `Banks - Regional`, not its parent. Prefix grouping would
render **"Banks (179)"**, a category present in no data, and would silently
absorb the two genuinely-bare-labelled symbols into it.

Asserted in the check so a third bare family cannot appear unnoticed.
