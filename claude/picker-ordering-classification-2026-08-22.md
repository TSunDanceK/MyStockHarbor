# Picker ordering: A / B / C classification (2026-08-22)

Follows from the ranking-density finding of 2026-08-21 (#327, #328): the picker
composites order stocks by differences smaller than the smallest signal they can
express, and a 0.1% price tick reshuffles ranks. The decision taken was to
**separate the SET from the ORDER** — membership stays a judgement, ordering
becomes a single named quantity shown as a column, and pickers with no
defensible key stop claiming an order at all.

This file classifies all 34 picker pages. It is the input to that work, not the
work itself.

- **A** — a clean single ordering key already computed.
- **B** — a key exists but ordering by it does not reproduce what the page's own
  code deliberately asserts.
- **C** — no defensible single key.

---

## The three numbers problem (read before the per-page reasoning)

On the twelve section-backed preset pages, **three different quantities are in
play and only two of them are visible, and neither visible one is the order:**

| Quantity | Where it comes from | Where it shows |
|---|---|---|
| section rank | `_score`, the per-category composite in `pickersBuilder` | **nowhere** — it is only the row order |
| `entry.score` | `reasons.length`, count of 25 tracked conditions | the "Score" pill (chart view) |
| the note count | e.g. `3/4 trend checks`, `2 oversold` | the card note |

`buildEntries`' preset branch (`PickerResultPage.tsx:637`–`:679`) re-applies the
section's *rank* to the row order but never writes the section's `score` onto
the entry, so `entry.score` stays at the tracked-conditions count. A visitor
reading Best Trend Score Stocks sees a Score pill (0–25 conditions), a note
(`3/4` or `4/4`), and a row order driven by a third number they cannot see.

Two further terms are in **every** composite and are declared nowhere:

- `dynamicBoost(symbol)` — a flat `+10` for a dynamic-universe name and another
  `+10` for a popular-search name, added to every section's `_score`
  (`pickersBuilder.ts:2585`). Against the measured adjacent-rank gaps of 0.20–0.30
  in the flat bands, +10 is a 30–50 place jump. The published order is partly a
  popularity ranking.
- `liquidityScore(points) * 0.06`–`0.30` — present in nearly every composite.

Neither is wrong as a product choice. Both are invisible, which is the problem
this work exists to fix.

---

## A — a clean single ordering key already computed

### `/low-pe-stocks`, `/high-dividend-yield-stocks`, `/dividend-growth-stocks`, `/cheap-tech-stocks`

The predicate that defines the set *is* the key, and it is already a sortable
shown column:

| page | predicate | column |
|---|---|---|
| `/low-pe-stocks` | `peRatio <= 15` | **PE Ratio** (ascending) |
| `/high-dividend-yield-stocks` | `divYield >= 4` | **Div Yield** (descending) |
| `/dividend-growth-stocks` | `divYield >= 2` AND `divGrowth >= 5` | **Div Growth** (descending) |
| `/cheap-tech-stocks` | `sector = Technology` AND `peRatio <= 25` | **PE Ratio** (ascending) |

Single, monotone, no composite, no direction ambiguity, and the value is on the
entry already — nothing needs plumbing.

`/dividend-growth-stocks` and `/cheap-tech-stocks` each carry two predicates,
but in both cases only one is numeric-with-a-direction (the other is a floor or
a sector membership), so the key is still single.

**What they order by today:** `reasons.length` — how many of 25 *technical*
conditions the stock also meets, descending, ties broken A–Z
(`PickerResultPage.tsx:611`). On a dividend page, that is an ordering by
oversold/breakout/MA-relation flags. It is not merely imprecise, it is about a
different subject.

### `/all-time-high-breakout-stocks`, `/3-month-high-breakout-stocks`

Key: `breakoutBarsAgo`, ascending. Already computed
(`computeAthBreakout` / `computeThreeMonthBreakout`), already printed in the
note (`ATH breakout • 3 bars ago`), and it is 45% of the composite's weight
already — so declaring it is close to what the page already does, minus the
liquidity and volume terms.

The ties are heavy (most breakouts are 0–5 bars old) and that is a **feature**:
tied stocks genuinely are tied, and a shown integer column says so. The current
composite manufactures a total order out of that tie using liquidity and
`dynamicBoost`.

One handling note: `findMostRecentAthBreakoutBarsAgo` can return `null`, stored
as the sentinel `999`. That must render as "—", never as a 999-bar-old breakout.

### `/volume-spike-stocks`, `/atr-spike-stocks`

Key: the spike ratio itself — `lastVol / lastVolSma20`, and
`lastAtr / lastAtrSma20`. Both are computed at the exact point the boolean is
made (`pickersBuilder.ts:2979`, `:2985`) and then discarded; only the `>= 1.8` /
`>= 1.5` boolean survives. Bigger ratio = more of a spike; no direction
question. One field to carry through.

### `/stocks-above-50-day-moving-average`, `/stocks-below-50-day-moving-average`, `/stocks-trading-above-200-day-moving-average`, `/stocks-below-200-day-moving-average`

Key: percentage distance from that moving average. `lastClose`, `lastMA50` and
`lastMA200` are all computed one line above where the boolean is formed
(`pickersBuilder.ts:2966`–`:3009`); the subtraction is already implicit in the
`>` comparison and is thrown away.

The direction is an editorial choice — "furthest above" (most confirmed trend)
versus "closest to the line" (freshest reclaim) — but that is a decision to
*declare in a column header*, not a modelling problem, and it is what separates
these from the B cases below: **nothing in the current code takes a view on the
degree at all.** There is no intent to contradict.

### `/top-stocks-with-buy-signals`, `/top-stocks-with-sell-signals`

Key: `getBuySignalCount` (integer 0–9, gated on `aboveMA200`) and
`getSellSignalCount` (integer 0–5). Unlike every other picker, **this page
already orders by the number it already shows** — the Score pill and the
`N of 9 bullish conditions met` note are both that integer, and the sort is that
integer.

So these are A already, with one honesty gap: ~260 symbols on a 0–9 integer
means massive ties, currently resolved alphabetically and presented as a rank.
Once the count is a column the ties are visible and the alphabetical tail reads
as what it is.

---

## B — a key exists but does not reproduce the page's intent

The distinguishing feature: the code **already contains a written view** about
degree, and the raw key contradicts it.

### `/stocks-down-20-from-all-time-highs`

The named case. `computeAthPullback` scores distance with
`scoreTargetBand(drawdownPct, 20, 35, 20, 65)` — 20–35% below the high scores a
flat 100, and the score falls to zero at 65% — then adds `+20` penalty above
50% and another `+15` above 60%. A stock down 60% is deliberately buried.

Ordering by raw drawdown descending would put exactly those stocks first and
**invert the page's own thesis**, which is "liquid, tradable pullbacks over weak
broken charts" (the section description says so in as many words). The key is
clean; adopting it is a product reversal, not a refactor.

Resolution is a product call, not a code one: either show `drawdown %` and
accept that the page becomes "most fallen" (retitle it), or keep the band view
and show *the band position* as the column, which is honest but is no longer a
single natural quantity.

### `/stocks-near-200-day-moving-average`, `/stocks-near-weekly-200-day-moving-average`

Same shape, and arguably sharper. The page is named "Near the 200-day MA". The
obvious key is `|pctDistance|`. `computeMa200Candidate` instead:

- scores distance as `scoreTargetBand(pctDistance, -0.25, 1.5, -1, 3)` — so
  **zero distance is not the peak**; anything from 0.25% below to 1.5% above
  scores a flat 100, and a stock *at* the MA ranks identically to one 1.5% above
  it;
- gives its **largest single weight (0.32)** to `deepUnderScore`, the share of
  the last 500 bars spent more than 7% below the MA — a history-quality term
  with nothing to do with proximity;
- adds `abovePct` (0.18), `slopePct` (0.14) and liquidity (0.08).

So proximity is 28% of a page named after proximity, and even that 28% is
non-monotone in the quantity. Ordering by `|pctDistance|` would produce a
visibly different page, and a defensible one — but it discards a view the code
holds deliberately.

The weekly page's key is **already on the wire**: `weeklyMa200DistancePct` is
computed and attached to every `signalRecord` (`pickersBuilder.ts:2856`,
`:3043`) for the ticker feed. Nothing needs plumbing there, only deciding.

### `/stocks-with-positive-last-earnings`

`computePositiveLastEarningsCandidate` weights EPS surprise and **revenue
surprise equally** (0.35 / 0.35), plus positivity flags and a freshness term.
EPS surprise % alone is clean, computed and already in the note — but it is half
of what the page currently asserts. Ordering by it narrows the page's claim
rather than expressing it.

The clean resolution here is cheap, though: show *both* as two columns and
declare which one orders. That converts it to A by making the choice visible
instead of blending it.

### `/stocks-with-strong-earnings-growth`

Same, with a detail worth its own line. `epsGrowthPct`, `revenueGrowthPct` and
`releaseDate` **are** computed and attached to the PickerItem
(`pickersBuilder.ts:2625`–`:2627`) — and then `takeTop`'s destructure
(`:3118`) does not list them, so all three are dropped at the section boundary,
about 490 lines later. The key exists, reaches the section, and is discarded on
the way out.

Beyond that it is the same B: EPS YoY and revenue YoY are weighted 0.25/0.25,
alongside a positive-consistency term weighted higher than either (0.30).
Ordering by EPS YoY alone contradicts a composite that says consistency matters
more than magnitude.

---

## C — no defensible single key

### `/best-trend-score-stocks`

The named case, and it is worse than "an integer 0–4". Because
`trendScore.passed` **is** the count of the same four booleans that are then
scored individually, the discrete part of the score collapses to three values:

```
passed=4                              80 + 18+12+18+12 = 140
passed=3, missing MACD or price>MA50  60 + (18+12+18)   = 108
passed=3, missing MA50>MA200 or price>MA200            = 102
```

Everything else is `liquidityScore * 0.2` (a 0–20 range) plus `dynamicBoost`
(0/10/20). **The 6-point gap between the two `passed=3` tiers is smaller than
the liquidity spread**, so the tiers interleave and, below the top tier, the
"Best Trend Score" ranking is substantially a liquidity-and-popularity ranking
wearing a trend label.

Meanwhile the page shows a note of `3/4` or `4/4` — two distinct values across
20 rows — and a Score pill showing a *third* number entirely. There is no single
key here, and the honest ordering is the tier (with ties left as ties).

### `/oversold-stocks-today`, `/overbought-stocks-today`

Five weighted terms (`oversoldStrength` 0.30, `advScore` 0.25, `exhaustionScore`
0.20, `distanceScore` 0.15, `structureScore` 0.05, `recencyScore` 0.05) minus
three conditional penalties (12 / 25 / 10) — and `oversoldStrength`,
`exhaustionScore` and `distanceScore` are each themselves 2–3-term blends. RSI
is the closest thing to a natural key and reaches the output through
`scoreInverse(lastRsi, 15, 35) * 0.45` inside a term weighted 0.30, i.e. about
13.5% of the composite.

These are also the two lists #327 measured directly: rank 20 falls in the
oversold band 14–27, adjacent-gap median **0.20** — the flattest region in the
distribution, and the exact place the badged/unbadged cut is made.

### `/bullish-bearish-divergence-stocks`, `/bullish-divergence-stocks`, `/bearish-divergence-stocks`

Divergence strength is itself a composite: `timeframeScore` 0.30 +
`durationScore` 0.20 + `structureScore` 0.20 + `magnitudeScore` 0.15 +
`locationScore` 0.10 + `reactionScore` 0.05, minus three penalties — and
`structureScore` is `scoreLinear` over the detector's *own* internal score.

The largest term is a **binary**: `timeframeScore` is 100 for weekly and 65 for
daily, so weekly-versus-daily alone is worth 10.5 points of a range where
adjacent stocks sit 0.2–0.3 apart. The published order is, to a first
approximation, "all weeklies, then all dailies", with the within-group order
decided by the flat tail.

`/bullish-divergence-stocks` and `/bearish-divergence-stocks` are additionally a
special case: they are byte-identical files but for one href
(`/stock/X` versus `/?symbol=X`), both render the **same combined** bullish-and-
bearish section, and neither filters to its own direction. A "position" on those
pages ranks a list that is not the list the URL claims.

### `/bullish-rsi-divergence-stocks`, `/bearish-rsi-divergence-stocks`, `/bullish-macd-divergence-stocks`, `/bearish-macd-divergence-stocks`

Same composite, plus a membership problem that has to be fixed before ordering
is even worth discussing. Each symbol gets exactly **one** divergence —
`bestDiv`, the argmax of the composite above — and the four flags are derived
from that single winner (`pickersBuilder.ts:3011`–`:3017`). So a stock with a
real daily bullish RSI divergence whose weekly bearish MACD divergence scored
higher **never appears on the bullish RSI page at all**. The set itself is
decided by the composite, not just the order.

### `/breakout-signal-stocks`

`breakout = !!athBo || !!threeMonthBo` — an OR of two different detectors with
two different composites and two different reference levels. A single strength
key would have to make an ATH breakout commensurable with a 3-month-high
breakout, and each detector's own score is already a 4-term blend minus
penalties. Two honest pages already exist for the two halves
(`/all-time-high-breakout-stocks`, `/3-month-high-breakout-stocks`, both A); the
union page should claim membership only.

### `/macro-support-resistance-stocks`

Two composites stacked. The zone is chosen by `argmax` over clustered pivots
(`touchScore` 0.27 + `proximityScore` 0.24 + `tightnessScore` 0.18 +
`volumeScore` 0.16 + `spanScore` 0.09 + liquidity 0.06), and that same score is
then the section rank. So the ordering key answers "how good is the best zone we
found" — which is not a property of the stock so much as of the detector's
selection among several candidate zones for that stock. Distance-to-zone is
available but is 24% of a score whose other 76% is about the zone's own
construction quality.

### `/semiconductor-stocks`

The predicate is `industry = Semiconductors` — pure membership, no numeric
component at all. The page has no ordering intent to reproduce. Today it orders
by `reasons.length` (technical conditions met), which asserts a ranking of
semiconductor stocks by unrelated chart signals.

Correct outcome: claim no order, and use a **declared convention** (Market Cap
descending) as the visible default — a convention shown in a column, not a
finding.

### `/stock-screener` (kind `allSymbols`)

Same shape, one level up: the page has no condition of its own, so there is no
page-specific key by construction. It orders the entire universe by
`reasons.length`, and its `ItemList` — unfiltered, sliced to 24 — currently
asserts that these 24 stocks are the top of a general-purpose screener.

It is a *tool*, with a real sort control on every column. Its honest default is
a declared convention (Market Cap descending), and its structured data should
claim no ranking.

### `/cash-rich-value-stocks`

The only fundamentals page that genuinely carries two numeric predicates with
directions: `freeCashFlow >= 10bn` **and** `peRatio <= 20`. Ordering by FCF
descending ranks megacaps; ordering by P/E ascending ranks the cheapest. Both
are defensible; the page's name asserts both halves at once.

Filed C rather than A because "pick one and declare it" is a genuine editorial
decision about what the page is for, not a mechanical one — but it is the
cheapest C to resolve: one choice, one column, both values already shown.

---

## Summary

| Class | Pages | Count |
|---|---|---|
| **A** | `/low-pe-stocks`, `/high-dividend-yield-stocks`, `/dividend-growth-stocks`, `/cheap-tech-stocks`, `/all-time-high-breakout-stocks`, `/3-month-high-breakout-stocks`, `/volume-spike-stocks`, `/atr-spike-stocks`, `/stocks-above-50-day-moving-average`, `/stocks-below-50-day-moving-average`, `/stocks-trading-above-200-day-moving-average`, `/stocks-below-200-day-moving-average`, `/top-stocks-with-buy-signals`, `/top-stocks-with-sell-signals` | 14 |
| **B** | `/stocks-down-20-from-all-time-highs`, `/stocks-near-200-day-moving-average`, `/stocks-near-weekly-200-day-moving-average`, `/stocks-with-positive-last-earnings`, `/stocks-with-strong-earnings-growth` | 5 |
| **C** | `/best-trend-score-stocks`, `/oversold-stocks-today`, `/overbought-stocks-today`, `/bullish-bearish-divergence-stocks`, `/bullish-divergence-stocks`, `/bearish-divergence-stocks`, `/bullish-rsi-divergence-stocks`, `/bearish-rsi-divergence-stocks`, `/bullish-macd-divergence-stocks`, `/bearish-macd-divergence-stocks`, `/breakout-signal-stocks`, `/macro-support-resistance-stocks`, `/semiconductor-stocks`, `/stock-screener`, `/cash-rich-value-stocks` | 15 |

Of the 14 A pages, **exactly two** (`/top-stocks-with-buy-signals`,
`/top-stocks-with-sell-signals`) currently order by their key. The other twelve
order by `reasons.length` — a count of 25 technical conditions that, on a
dividend or P/E page, is about a different subject entirely.

---

## What changed in code alongside this file

`position` dropped from the `ItemList` in the structured data of the C families
only, and `itemListOrder: ItemListUnordered` added in its place so the markup
*states* "this is a set" rather than leaving it to be inferred from a missing
field. `ItemList` itself is kept — asserting a membership list is correct and is
the page's actual claim.

- `app/components/PickerResultPage.tsx` — the shared JSON-LD block. Since one
  component serves all 32 config-driven pages, the distinction is an explicit
  `ORDERED_PICKER_HREFS` set: **positions are opt-in**, so a page added later
  claims no ranking until someone declares its key. That direction follows the
  corollary in `claude/traps/return-type-cannot-express-failure.md` — asserting
  nothing beats asserting something false.
- `app/bullish-divergence-stocks/page.tsx`, `app/bearish-divergence-stocks/page.tsx`
  — both bespoke pages, `mainEntity` only. Their `BreadcrumbList` positions are
  untouched; position is required there and is genuinely ordered.

**B families keep their positions for now.** They are as unable to justify a
rank as the C families are, but narrowing or widening that scope is a product
call — see the B section for what each one costs.
