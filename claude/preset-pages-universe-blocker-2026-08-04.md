# Preset landing pages — blocked on universe coverage (2026-08-04)

Investigation note. **No code changed.** Records why the first attempt at
combination-generated preset pages (`/cheap-semiconductor-stocks` and similar)
was stopped before any page was written, and what has to be true before it
restarts.

Depends on the URL-filter work in `claude/screener-url-state-2026-08-01.md`,
which is done and live — the mechanism is not the blocker.

---

## The blocker

Every screener page footer reads `Live matches 260 · Universe 613`. The screener
ships **260 of the 613 analyzed symbols**, and the missing 353 are not a random
tail.

Measured on production, 2026-08-04 (all counts `of 260`):

| Filter | Rows |
|---|---|
| `industry=Semiconductors` | **4** — LRCX, MU, ARM, TSM |
| `industry=Semiconductors&peRatio=..25` | 1 |
| `industry=Semiconductors&peRatio=..40` | 2 |

NVDA, AVGO, AMD and INTC are absent. They are in the 613 (their `/stock/[SYM]`
pages exist and are in the sitemap), so they are being dropped between the
analyzed universe and the screener's entry list.

Loosening the P/E ceiling from 25 to 40 moved the count from 1 to 2. **The
threshold was never the problem** — the population is.

A semiconductor landing page cannot be written on a list that omits Nvidia and
Broadcom. It would be wrong on its face to any reader, and no amount of copy
fixes it.

## Why this also invalidates the other counts

Same session, same method:

| Filter | Rows | Read |
|---|---|---|
| `divYield=4..` | 28 | viable |
| `peRatio=..12` | 18 | viable |
| `peRatio=..15` | 41 | viable |
| `divGrowth=5..&divYield=2..` | 28 | viable |
| `perfYtd=20..` | 81 | viable |
| `freeCashFlow=10000000000..` | 46 | viable |
| `freeCashFlow=1000000000..` | 188 | too broad — 72% of the list |
| `oversold=1&sector=Technology` | 7 | too thin, and see below |

Every one of these is a fraction of 260, not of 613, and the universe rebuilds
dynamically — so these are one snapshot of a moving subset. They are useful as a
rough ordering and **not** as a basis for committing to a page. Any count taken
before the coverage question is settled will have to be retaken afterwards.

## Investigate next

Where the 260 comes from. `config.kind: "allSymbols"` (`app/stock-screener/page.tsx`)
routes through `buildEntries` in `PickerResultPage.tsx`, fed by
`lib/server/pickersBuilder.ts`, which reports both `universeSize` and
`dynamicUniverseCount`.

The hypothesis worth testing first — **not yet verified, do not treat as fact** —
is that the screener's entry list is assembled from the union of the picker
sections, i.e. symbols currently qualifying for at least one of the ~25
conditions, rather than from the universe itself. That would explain the
observation exactly: NVDA qualifying for no condition on a given day would drop
out of the screener while remaining in the universe. It also predicts that the
260 fluctuates day to day, which matches the universe being dynamic.

If that is the cause, the fix is for `allSymbols` to start from the universe and
attach condition flags, rather than starting from the conditions.

## Then, and only then

1. Re-measure every candidate filter against the corrected population.
2. Pick combinations on the corrected counts, with a floor around 15 rows.
3. Write real copy per page — a filtered table plus a generated sentence is thin
   content and will not rank. Launch 5–6 hand-written, not a generated set.
4. Link them from the Select Screener menu and the Pickers drilldown ("Top
   Searched Pages"), not from the sitemap alone. Two independent GSC audits in
   this repo (#198 here, #202–#204 from the other account) reached the same
   conclusion: internal linking is the binding constraint on indexation.
5. Sitemap entries follow the `lib/curatedSymbols.ts` pattern from #202 rather
   than a second parallel list.

## Judgements worth keeping

- **Technical screens make poor landing pages.** `oversold=1&sector=Technology`
  was dropped for churn as much as for its 7 rows: membership turns over daily,
  so the page never accumulates authority around stable content. Fundamental
  screens (yield, P/E, FCF) move slowly and are the right basis for evergreen
  pages.
- **Sector-appropriate metrics matter.** Banks should screen on P/B, not P/E.
  Getting that wrong is what separates a page that reads as expert from one that
  reads as generated.
- **Semis trade far richer than a generic "cheap" ceiling assumes.** The original
  P/E 25 guess was wrong on its own terms, independently of the coverage bug.
- **The universe is dynamic.** Any page whose premise is "there are N of these"
  needs to survive N changing. Copy should not cite counts.

## Still unmeasured

Three category fields whose live values were never captured, all needed before
their pages can be specified: analyst `rating` values, whether `payoutFreq`
offers "Monthly" at all, and the exact industry labels FMP uses for banks
(likely split, e.g. Diversified vs Regional — possibly two narrower pages rather
than one).
