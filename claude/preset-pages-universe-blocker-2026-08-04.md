# Preset landing pages — blocked on universe coverage (2026-08-04)

Investigation note. **No code changed.** Records why the first attempt at
combination-generated preset pages (`/cheap-semiconductor-stocks` and similar)
was stopped before any page was written, and what has to be true before it
restarts.

Depends on the URL-filter work in `claude/screener-url-state-2026-08-01.md`,
which is done and live — the mechanism is not the blocker.

> **CORRECTION, later the same day.** The diagnosis below — "260 of the 613
> analyzed symbols", "the missing 353" — is wrong, and the hypothesis under
> *Investigate next* is refuted. There is no 353-symbol gap; only 260 symbols
> are ever analyzed and the screener ships all of them. The blocker is real but
> it is a **missing `industry`/`sector` field**, not missing universe members.
> See `## Correction` at the end. The original text is left intact as a record
> of what was believed at the time.

---

## The blocker

*(superseded — see Correction)*

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

*(refuted — see Correction)*

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

---

# Correction (2026-08-04, same day)

Read-only follow-up. **No code changed here either.** Everything below is from
reading the source at `main`; the live-site checks were blocked by the Vercel
bot challenge, so the two items marked *unconfirmed* still need a manual look.

## 613 is not a count of analyzed symbols

`PickerResultPage.tsx` renders `Universe {combinedUniverseSize}`, and
`combinedUniverseSize` is `universeSize + dynamicUniverseCount` — the comment
directly above it says so ("Adding dynamicUniverseCount ... on top"). So:

- **260** = `universeSize` = `UNIVERSE_CAP` in `lib/server/pickersBuilder.ts`,
  hard-coded. That is the entire analyzed set.
- **353** = the residual, i.e. `market.dynamicUniverseSize`: the shared
  *candidate pool* held in Redis. Those symbols are eligible to enter the
  universe on a future build. They are not analyzed, and the pool overlaps the
  260, so the displayed figure double-counts.

There is no gap between the universe and the screener's entry list. The screener
ships every symbol it analyzes.

The footer label caused this. `Universe 260 · Pool 353` would have been read
correctly; `Universe 613` invites exactly the wrong inference. Worth relabelling.

## The union-of-sections hypothesis is refuted

It described a real bug — but one that was fixed on 2026-07-23 in commit
`8b7a8fd` (see `claude/all-stocks-full-universe-and-header-dropdown-2026-07-23.md`),
which changed `signalRecords` to ship the full universe, with `chartPoints`
stripped from records not appearing in any section to stay under the Upstash
value-size limit.

## NVDA is in the universe

`PRESET_UNIVERSE` in `pickersBuilder.ts` begins
`AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, BRK.B, AVGO, LLY`, and preset is
*prepended* before the `UNIVERSE_CAP` slice (commit `06e82a4`, see
`claude/universe-megacap-preset-fix-2026-07-23.md`), so the mega-caps hold
guaranteed slots. NVDA, AVGO, AMD and INTC are all inside the 260.

## The actual cause: `industry` is null for most of the universe

`industry` and `sector` come from `lib/server/fundamentalsCache.ts`. A row whose
`industry` is null silently fails any `industry=` filter — it disappears from the
count without disappearing from the screener, which is why this looked like a
membership problem. `warmFundamentals()` has a structural flaw in the ordering
of its two stages:

1. **Quote stage** (`fetchQuoteFundamentals`) calls `stable/batch-quote`, which
   returns **402 on the FMP Starter plan**. Every chunk fails, so every chunk
   falls through to the per-symbol `stable/quote` path — roughly 260 individual
   FMP calls, each taking a slot via `reserveFmpCallSlot()`.
2. **Profile stage** is the only source of `industry`/`sector`. Its first act
   inside the loop is `hasFmpCapacity(1, FMP_MIN_HEADROOM_CALLS /* 60 */)`,
   checked against a per-minute budget the quote stage has just drained — and on
   failure it **`break`s out of the loop entirely** rather than waiting for the
   minute to roll over. `PROFILE_MAX_PER_RUN = 120` is never approached.

So a typical daily run caches close to zero fresh profiles. LRCX, MU, ARM and TSM
are not "the semis in the universe" — they are the semis that happen to have a
warmed profile key. The same applies to every other category filter, and to the
`peRatio` and `marketCap` columns, which come from the same record.

Consistent with this: today's cron (07:30 UTC, `vercel.json`) returned 200 at
07:30:48, long enough for the per-symbol fallback to have run and the profile
stage to have aborted.

**Unconfirmed, worth checking manually:**
- The job's summary object (`profileFetches`, `quotesFetched`) is returned in the
  HTTP response body but never logged, so it is invisible in Vercel runtime logs.
  Hit `/api/jobs/warm-fundamentals` with the `CRON_SECRET` bearer and read the
  response; `profileFetches: 0` confirms the diagnosis outright.
- Open `/stock-screener` in a browser and check that NVDA is present with a blank
  Industry cell. That is the observation that distinguishes "not in the list"
  from "in the list with no industry".

## What to fix (in rough priority order)

1. **Run the profile stage before the quote stage**, so it draws on a fresh
   minute instead of the drained tail of one.
2. **Replace the `break` on capacity exhaustion** with a wait-and-retry, or at
   minimum a `continue`, so one exhausted minute can't abort a whole run.
3. **Drop the `batch-quote` attempt.** It 402s on every call on this plan; its
   only effect is to burn one reserved slot per chunk before the fallback.
4. **Backfill profiles once.** They carry a 30-day TTL, so covering all 260 is
   ~260 calls a month — cheap, and it makes category filters usable immediately.
5. `console.log` the warm summary so coverage is observable without a manual
   curl.
6. Relabel the screener footer to `Universe 260 · Pool 353`.

## What still stands from the original note

- **Counts must be retaken** — but because the category fields are sparse, not
  because the population is wrong. Expect them to go **up**, in some cases a
  lot; `industry=Semiconductors` should land nearer 15–25 than 4.
- **260 remains a genuine constraint** on how narrow a landing page can be. It is
  a deliberate cap (raised 200 → 260 in `06e82a4`), not a bug, and it is the
  number to reason about when picking combinations.
- Everything under *Judgements worth keeping* is unaffected, including the floor
  of ~15 rows and the preference for fundamental over technical screens.

---

# Re-measurement (2026-08-04, evening) — blocker cleared, counts retaken

The `industry`/`sector` starvation diagnosed above was fixed in **#207**
(`cdb0582`): profile stage moved ahead of the quote stage, `break` replaced with
`awaitFmpCapacity()`, no batch-quote retry after 402. Profile coverage went from
~130 to **259/260**.

Every count below was taken from the **live production screener in a real
browser** — the Vercel bot challenge that blocked the earlier session does not
apply to a genuine browser session. Method: load
`/stock-screener?<filter>` and read the `.screenerChipCount` element
("N of 260") next to the filter chips.

**Cross-check on data integrity:** the eleven sector counts sum to **259**, i.e.
exactly `260 − 1`, matching the single symbol still lacking a profile. The
category fields are now effectively complete.

## Sector distribution (the whole analyzed universe)

| Sector | Rows |
|---|---|
| Technology | 63 |
| Financial Services | 35 |
| Healthcare | 32 |
| Industrials | 32 |
| Consumer Cyclical | 27 |
| Consumer Defensive | 20 |
| Energy | 14 |
| Utilities | 10 |
| Basic Materials | 9 |
| Communication Services | 9 |
| Real Estate | 8 |
| **Total** | **259** (+1 with no profile) |

## The original counts, retaken

| Filter | Was | Now |
|---|---|---|
| `industry=Semiconductors` | 4 | **18** |
| `industry=Semiconductors&peRatio=..25` | 1 | **2** |
| `industry=Semiconductors&peRatio=..40` | 2 | **5** |
| `divYield=4..` | 28 | 27 |
| `peRatio=..12` | 18 | 18 |
| `peRatio=..15` | 41 | 41 |
| `divGrowth=5..&divYield=2..` | 28 | 28 |
| `perfYtd=20..` | 81 | 90 |
| `freeCashFlow=10000000000..` | 46 | 48 |
| `freeCashFlow=1000000000..` | 188 | 188 |
| `oversold=1&sector=Technology` | 7 | 11 |

Only the `industry=` rows moved materially, which is the expected signature of
the fix: `peRatio`, `divYield` and `freeCashFlow` come from the price pool and
stock-data caches, which were never starved. The earlier note's prediction that
"counts will go up, in some cases a lot" was right about semis specifically and
wrong as a general expectation — worth remembering, because it means **the
numeric screens were never the thing that was broken** and their original
readings stand.

## `/cheap-semiconductor-stocks` is dead — and not because of a bug

This is the headline result and it reverses the premise of the original note.

The coverage problem is genuinely fixed: the semis list is now 18 names and
contains NVDA, AVGO, INTC, ASML, TXN, ADI, AMAT, LRCX, KLAC, MU, ARM, MCHP,
TER and the rest. Nothing is missing any more.

But of those 18, **2 trade under P/E 25 and 5 under P/E 40.** The original note
already suspected this ("semis trade far richer than a generic 'cheap' ceiling
assumes") and it is now quantified. There is no P/E ceiling that produces both a
defensible "cheap" claim and a list clearing the 15-row floor — a ceiling loose
enough to fill the page stops meaning "cheap".

The page as conceived cannot be written. Two viable replacements, same keyword
territory:

- **`/semiconductor-stocks`** — `industry=Semiconductors` — **18 rows.** A plain
  industry landing page, no valuation claim to defend.
- **`/semiconductor-stocks-outperforming`** — `industry=Semiconductors&perfYtd=20..`
  — **15 rows.** Right at the floor and it is a momentum screen, so it churns;
  weaker on the evergreen test.

## The three previously-unmeasured fields

**Analyst `rating` — only two values exist: `Buy` and `Hold`.** No Strong Buy,
Sell or Strong Sell anywhere in the universe. `rating=Buy` is **180 of 260
(69%)**, far too broad to define a page, and "stocks analysts say hold" is not a
query anyone types. **Rating is not a viable page axis** — usable only as a
secondary qualifier (`divYield=2..&rating=Buy` → 53).

**`payoutFreq` — `Monthly` does exist**, alongside Irregular, Quarterly,
Semi-Annual and Special. But `payoutFreq=Monthly` returns **2 rows**. A
monthly-dividend page is dead on arrival, and structurally so: monthly payers are
overwhelmingly REITs and BDCs, which a 260-name mega/large-cap universe barely
contains (Real Estate is the smallest sector here at 8).

**Bank industry labels — the split was real.** FMP uses `Banks - Diversified`
and `Banks - Regional` (plain hyphen, spaces either side), plus a separate
`Investment - Banking & Investment Services`. Counts: Regional **5**, both bank
labels OR'd together **8**. **Below the floor even combined**, so neither the one
page nor the two narrower ones are viable. Bank coverage has to come in via
`sector=Financial Services` (35) instead — which also sidesteps the P/B-not-P/E
problem, since a sector page makes no valuation claim.

## Shortlist that survives the floor

Ordered by how well each holds up as evergreen content, not by row count.

| Page | Filter | Rows |
|---|---|---|
| `/low-pe-stocks` | `peRatio=..15` | 41 |
| `/dividend-growth-stocks` | `divGrowth=5..&divYield=2..` | 28 |
| `/high-dividend-yield-stocks` | `divYield=4..` | 27 |
| `/cash-rich-value-stocks` | `freeCashFlow=10000000000..&peRatio=..20` | 20 |
| `/semiconductor-stocks` | `industry=Semiconductors` | 18 |
| `/cheap-tech-stocks` | `sector=Technology&peRatio=..25` | 18 |

That is six, matching the "launch 5–6 hand-written" guidance. Two near-misses
worth noting rather than launching: `divYield=4..&payoutRatio=..60`
(**13** — a genuinely good screen, sustainable high yield, just under the floor;
revisit if the universe cap rises) and `sector=Financial Services&peRatio=..15`
(**14**, same).

Explicitly rejected: `perfYtd=20..` (90 rows, and a momentum screen that churns);
`freeCashFlow=1000000000..` (188 = 72% of the list); `rating=Buy` (180);
`oversold=1&sector=Technology` (11, technical, churns daily);
`payoutFreq=Monthly` (2); any bank page (≤8).

## Bug found while measuring

The results footer is **stuck at the unfiltered count**. With
`?industry=Semiconductors` applied it reads

```
Current scan · Live matches 260 · Shown 260 · Universe 613 · Updated 04 Aug, 17:45
```

while the chip bar directly above the table correctly reads `18 of 260`.
Reproduced on every filter tried. So "Live matches" and "Shown" ignore the
applied predicates entirely — the label promises exactly the thing it is not
doing, and it is the number a visitor is most likely to read as authoritative.

This sits next to the already-outstanding relabel (`Universe 613` should be
`Universe 260 · Pool 353`). Both are in the same footer; fix them together.

## Still to do

1. Fix the footer: make `Live matches` / `Shown` track the applied predicates,
   and relabel `Universe 613` → `Universe 260 · Pool 353`.
2. Write the six pages by hand. A filtered table plus a generated sentence is
   thin content; the ranking case rests on the copy, not the screen.
3. Link them from the Select Screener menu and the Pickers drilldown — internal
   linking, not the sitemap, is the binding constraint on indexation (two
   independent GSC audits agree).
4. Sitemap entries follow the `lib/curatedSymbols.ts` pattern from #202.
5. Copy must not cite row counts. Every number in this document is one snapshot
   of a universe that rebuilds continuously.
