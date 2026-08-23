# Six picker pages waiting on a column

Handoff to the UI session. Each page below still orders by `reasons.length` — a
count of 25 unrelated technical conditions — and each one **already has** the
right ordering key computed in `pickersBuilder` and discarded. What is missing is
a place to show it.

## Why they are blocked rather than shipped

The rule the whole ordering effort exists for: **an `orderBy` key must be a
column the grid renders.** Replacing an invisible order (`reasons.length`) with
a different invisible order is not an improvement — it is the same defect with
better intentions.

`scripts/check-orderby.mjs` section E enforces this against
`PickerResultsGrid`'s own `Col` accessors, so none of these pages can quietly
acquire an `orderBy` before its column exists. Add the column, then add the
`orderBy`; the check will pass on its own.

**The near-miss worth recording.** The two breakout pages looked shippable,
because `breakoutBarsAgo` is already printed in the section note ("ATH breakout
• 3 bars ago"). It is not enough. That note reaches only rows that are members
of the underlying SECTION, and section membership is decided by the composite
score — not by `breakoutBarsAgo`. So after reordering, a 1-bar-old breakout
could sit at rank 1 showing the generic "N of 25 tracked conditions met" note
while an 8-bar-old section member below it displays its number. The key would be
visible on an arbitrary subset of rows with no relation to their position: an
ordering that *looks* checkable and is not, which is worse than one that is
plainly unchecked.

**Do not solve this by changing the note.** That is a visible product change and
nobody asked for one.

## What is needed

Four columns, six pages.

### 1. Breakout age — `breakoutBarsAgo`

| | |
|---|---|
| Pages | `/all-time-high-breakout-stocks`, `/3-month-high-breakout-stocks` |
| Suggested header | **Bars Since Breakout** |
| Then order by | `{ field: "breakoutBarsAgo", dir: "asc", label: "Bars Since Breakout" }` |
| Source | `computeAthBreakout` / `computeThreeMonthBreakout`, already ~45% of the composite's weight |

**THE SENTINEL, and it will bite.** `findMostRecentAthBreakoutBarsAgo` can
return null, and it is stored as **`999`** (`pickersBuilder.ts`, in the
`BreakoutCandidate` return). That value is not a breakout 999 bars ago; it means
*no breakout was found*. Two consequences, both required:

- The cell must render **`—`**, never `999`.
- It must sort as **MISSING (bottom)**, never as a very large number. Ascending
  order would otherwise be correct by accident today and wrong the moment the
  direction is questioned.

The cleanest fix is to stop the sentinel at the boundary — map `999` to
`undefined` when it reaches the entry — so the grid and `applyOrderBy` both see
a genuine absence and the existing missing-value handling applies without a
special case. `applyOrderBy` already sinks missing values in both directions.

**Heavy ties are expected and correct.** Many stocks genuinely broke out the
same number of bars ago. An integer column says so honestly, where the composite
manufactures a total order out of liquidity and a popularity boost.

### 2. Volume spike ratio

| | |
|---|---|
| Page | `/volume-spike-stocks` |
| Suggested header | **Volume vs 20d Avg** |
| Then order by | `dir: "desc"` |
| Source | `lastVol / lastVolSma20`, computed at the exact point the `>= 1.8` boolean is made and discarded |

Render as a multiple (`2.4x`), which is what the threshold is expressed in.

### 3. ATR spike ratio

| | |
|---|---|
| Page | `/atr-spike-stocks` |
| Suggested header | **ATR vs 20d Avg** |
| Then order by | `dir: "desc"` |
| Source | `lastAtr / lastAtrSma20`, same shape, `>= 1.5` threshold |

### 4. Distance from the moving average

| | |
|---|---|
| Pages | `/stocks-trading-above-200-day-moving-average`, `/stocks-below-200-day-moving-average`, `/stocks-above-50-day-moving-average`, `/stocks-below-50-day-moving-average` |
| Suggested header | **% from MA200** / **% from MA50** |
| Then order by | **absolute** distance, `dir: "asc"` — closest to the line first |
| Source | `lastClose`, `lastMA50`, `lastMA200`, all computed one line above where the boolean is formed; the subtraction is already implicit in the `>` comparison and thrown away |

**The direction carries a product decision**, and it is the owner's, stated
2026-08-22: the 200-day *"often acts as support, falling below may indicate the
start of a deeper downtrend and the MA200 could act then as resistance"*. The
line does its work when price is **near** it — a stock 80% above its 200-day is
not meaningfully "above the 200-day" in the sense the page means.

It is one line per page to flip if that reasoning is revisited.

Note these four need **absolute** distance for ordering while the column should
show the **signed** value (a stock 3% below its MA200 reads `-3.0%`). Either
carry both, or sort on `Math.abs` of the displayed field — but the sort key and
the displayed number must remain obviously the same quantity, or the ordering
looks wrong to a reader comparing two rows.

## Sequence

1. UI session adds the column.
2. Anyone adds the `orderBy` to the page config — one line.
3. `node scripts/check-orderby.mjs` passes without being edited, because section
   E scans every page config and resolves fields against the grid.

Step 3 is why the pages are safe to leave as they are in the meantime.
