# /stock/[symbol] off FMP: what shipped, what did not, and what is left (2026-09-21)

Three changes the owner decided on 2026-09-21, against the standing rules: hide
behind a flag with a comment naming the source and date, never delete;
behavioural checks under mutation rather than position-in-file checks.

---

## 0. Two things about the brief, checked before any code was written

Neither is a blocker. Both are recorded because the brief will be read again.

### 0.1 Both documents the brief cites are Claude-Project-only

Neither is in the repo mirror:

| Cited as | Status |
|---|---|
| `claude/fmp-exit-options-pickers-2026-09-12.md` | **already on the `KNOWN_MISSING` allowlist** in `scripts/check-doc-citations.mjs`, added 2026-09-13 with the SEC build brief — Project-only, never mirrored |
| `claude/HANDOFF-earnings-2026-09-17.md` | not in the repo and not on the allowlist; **added to it by this change**, same situation, reason in the commit |

So the decisions they record are real and were made — they are simply not
readable from here, which is the standing mirroring gap
`claude/CLAUDE.md` describes rather than anything new. This work therefore
follows what is **in the code**, and §0.2 is the one place that matters.

The repo docs covering the same ground, and the ones this work used:
`claude/fmp-provider-attribution-inventory-2026-09-12.md` (its §4–§7 is the
piece that bites here — the four "provided by Financial Modeling Prep" lines
describing analyst and valuation data, and the rule that **they must hide
*with* the block, not independently**, now asserted by §10 of
`check-earnings-snapshot.mjs`), plus
`claude/earnings-page-on-sec-2026-09-15.md`,
`claude/HANDOFF-sec-fields-2026-09-16.md` and
`claude/hide-list-verdict-2026-09-13.md`.

### 0.2 The Pickers Analysts tab is not hidden in code

The brief asks for "the same flag convention as the existing Analysts-tab hide
on Pickers". **In the code, that tab is live.**
`app/components/PickerResultsGrid.tsx` still declares it (`TabKey`, line 248),
lists it in `TABS` (line 256), and builds its columns (line 886). Nothing in
the repo hides it.

Most likely the decision was taken and recorded in the Project-only doc above
and not yet built — which is consistent with §3 below, where the Forward PE
column turns out to live on that same Pickers tab.

Either way there was no shipped flag to copy, so this work follows the
convention that **is** in the repo: `RETIRED_SOURCES` + `retiredSource()` +
`HiddenCard` in `lib/server/secEarningsView.ts` and
`app/stock/[symbol]/earnings/SecEarningsCards.tsx` — a registry naming the
source and the date, the code kept, and **nothing rendered in its place**: no
dashed placeholder, no apology card. That last part is a reversal the owner
already made on the earnings page, and it is what has been applied here.

**Nothing was changed on Pickers.** The brief scoped this pass to
`/stock/[symbol]`. If the Analysts tab is also meant to go, it is a separate
small change — and see §3, because Forward PE goes with it.

---

## 1. CompanyProfile stat grid — five rows hidden

`app/components/CompanyProfile.tsx`.

`HIDDEN_PROFILE_ROWS` registers **CEO, Employees, Beta, ISIN, CUSIP**, each with
its FMP field, the date, and why no free successor exists (officer names are
DEF 14A prose; headcount is 10-K prose; beta is a vendor computation, not a
filed figure; ISIN and CUSIP assignment is licensed). The rows stay in the
`allRows` array with their formatters intact; `applyHiddenRows` drops them on
the way to render.

Two properties, both asserted:

- **Emptying the registry brings all five back.** The registry is what decides,
  not a deletion somewhere else.
- **A registration matching no row throws at render.** Register `"Beta "` with
  a trailing space and a Set filter would remove nothing while the record said
  the row was hidden — a disagreement in the direction nobody looks. It now
  fails loudly instead.

**Ordering is load-bearing and is commented as such:** `applyHiddenRows` runs
*before* the `r.value` filter. Run it after, and every symbol whose FMP `ceo`
field comes back empty — common — would throw a page-breaking error.

Everything else in the grid (Sector, Industry, Market cap, 52-wk range,
Dividend, Exchange, Country, IPO date, Website) and the description are
untouched, per the brief. Their FMP→Tiingo/SEC source swap is separate work.

---

## 2. Analyst Ratings block — hidden, and its fetch stopped

`app/stock/[symbol]/retiredBlocks.ts` (new) and `app/stock/[symbol]/StockSymbolPageClient.tsx`.

The whole section — consensus pill, `AnalystTargetChart`, the four target
figures, the rating breakdown and the FMP attribution line — is wrapped in
`{isRetiredBlock("analyst-ratings") ? null : ( … )}`. The JSX is all still
there and still compiles.

Three things worth knowing:

- **`StockBlockId` is a union, not a string.** The first draft had
  `isRetiredBlock(id: string)` throw on an unknown id, to catch the typo that
  matters — guard the section with `"analyst-rating"`, singular, and it renders
  exactly as before while the registry says it is hidden. A throw catches that
  only at render, and it makes the normal case (delete an entry to bring a
  block back) throw instead of un-hiding. A union does both jobs, at compile
  time, for free.
- **The attribution is inside the guard.** Per
  `fmp-provider-attribution-inventory-2026-09-12.md` §7, a surviving "provided
  by Financial Modeling Prep when available" beside a hidden block explains an
  absence to a reader who can see nothing there. Asserted.
- **The fetch is gated on the same flag.** The effect was still calling
  `/api/stock-analyst-rating` on every load for data nothing draws.
  `fmp-bandwidth-97pct-2026-08-30.md` has the plan at 97% of its allowance and
  `/stock/[symbol]` is the most-crawled route on the site, so hiding the block
  without this would have cost exactly what the hide was for.

`valuation-multiples` is named in `StockBlockId` and deliberately **not** in
`RETIRED_BLOCKS` — P/E, P/S, P/B and EV/EBITDA still render. They are ratios
over filed fundamentals and a live price, both of which survive the FMP exit
(`lib/server/secValuation.ts` already rebuilds them off SEC facts for the
earnings page). Naming it in the union and not in the list is what lets the
guard say "this one is not hidden" as a fact rather than a silence.

---

## 3. Forward PE — it is not on this page, so nothing was hidden

The brief asks to hide "the Forward PE figure in the Valuation section" on
`/stock/[symbol]`. **That figure does not exist there.** The Valuation section
renders exactly four multiples — P/E Ratio, P/S Ratio, P/B Ratio, EV/EBITDA —
and `StockValuationData` has no forward field; nor does
`/api/stock-valuation/[symbol]`. The hero stat rail shows "P/E (TTM)" and
nothing forward.

Forward PE on this site is a **Pickers/screener** column:
`app/components/PickerResultsGrid.tsx:868` (`fwdpe`), computed live as
`price / forwardEps`, with `forwardEps` coming from `stable/analyst-estimates`
via `lib/server/stockDataCache.ts:215`.

So it is on the same surface as the Analysts tab from §0.2, fed by the same
retired FMP endpoint — which makes it likely the brief's §2 is describing the
Pickers Valuation *tab*, not this page's Valuation *section*. **Nothing was
changed there**, for the reason in §0.2. It is a one-line change plus a
registry entry whenever the owner confirms.

---

## 4. LatestEarningsCard rebuilt on SEC filings

### 4.1 What now feeds it

`lib/server/secEarningsSnapshot.ts` (new). `getSecEarningsSnapshot(symbol)`
reads the stored fact set through `resolveFactSetForRender`, builds the view
with `buildSecEarningsView`, scores it with `scoreFromSec`, and reads report
dates from the shared store (`readReportDates` / `latestResults`, as
consolidated in #484). `buildSecEarningsSnapshot` is the pure half, so the
check can drive it from fixtures with no Redis.

The payload is plain numbers and strings. **It has to be**: the card is
imported by `StockSymbolPageClient.tsx`, which is `"use client"`, so a value
import from `lib/server` would drag secEarningsView → secCurrency → fxRates →
Redis into the browser bundle. The card imports types only.

### 4.2 The scorer moved out of the earnings page

`lib/server/secEarningsScore.ts` (new) — `SCORE_BANDS`, `scoreComponents`,
`scoreExplanation`, `scoreGaps`, `buildScoreResult`, `noScoreReason`,
`scoreFromSec` and the constants, lifted **unchanged** out of
`app/stock/[symbol]/earnings/page.tsx`.

This was not tidying. The card needs a tone, and the alternative was a second
scorer over the same view — two validators for one value
(`claude/traps/two-validators-for-one-value.md`). They would agree on every
symbol anyone opened and disagree on the ones nobody did: `/stock/MU`'s sidebar
reading Good over a `/stock/MU/earnings` gauge reading Mixed, from one filing.

`scripts/check-sec-earnings-page.mjs` was repointed at the new module. It used
to `grabFunction(pageRaw, …)` the scorer out of a 1,200-line page by
brace-matching; it now reads `lib/server/secEarningsScore.ts`. **The assertions
are unchanged** — same arithmetic, better instrument. What still reads the page
is what is genuinely about the page: the gauge JSX, the `HiddenCard` call
sites, the prose. `SCORE_MAX_CONTRIBUTION` also stopped being an unused-var
warning, because it is now a real export the check reads.

### 4.3 Why the old tone could not simply be kept

This is the finding that shaped the whole of §4, and it is worth recording.

`lib/latest-earnings-data.ts` derives **every** tone from estimate surprise:

- `buildEarningsTone` — green needs score ≥ 1.5, red needs ≤ −1. Without EPS
  and revenue surprise the only remaining term is net income at ±0.5. **Every
  stock on the site would have read "Neutral", permanently.**
- `completedEarningsTone` — drives the "Recent earnings trend" dots and the
  "Yearly earnings read" badges. Without surprise, a negative EPS scores −0.25,
  which is above the −1 red threshold. **Every dot amber, every year "Neutral",
  on every stock.**
- The News page's "Earnings Tone" tile was worse still: `earningsToneScore`
  returned the literal **78 for green, 28 for red, 55 otherwise** — a traffic
  light printed as a two-digit score. Every "Good" stock on the site showed 78.

A uniformly amber card reading "Neutral" for every company is a claim, and a
false one — the same failure mode as "EPS surprise: 0.00" reading as "came in
exactly in line". So the tone comes from `scoreFromSec` instead, and the News
tile now prints the **real 0-100 score**, the same one the earnings gauge draws.

The tile's caption changed with it: *"based on actual EPS/revenue"* was no
longer true. The score reads revenue growth, EPS growth, profitability, margin
direction and cash conversion — a caption naming two inputs of five, one of
which is not an input at all any more, is how an old claim outlives its data.

### 4.4 What the card shows now

Kept, per the brief: EPS actual (GAAP, diluted), revenue actual, YoY growth on
both, gross/operating/net margin, net income, and the latest report date with
its timing wording. Added, because the old card had neither: **which period the
figures are for** (a stale fact set used to render identically to a current
one) and **what the growth is measured against**.

Hidden and registered in `RETIRED_SNAPSHOT_FIELDS`: EPS estimate, EPS surprise,
revenue estimate, revenue surprise, guidance, and — because both are surprise
tones in a different shape — the recent-trend dots and the yearly read.

Four smaller things the rebuild fixed, all of them now asserted:

1. **Margins were printed with a leading `+`.** `formatPercent` signed every
   positive, so Apple's gross margin rendered "+50.1%" — which reads as a
   margin that *rose* fifty points, not one that *is* fifty percent. Split into
   `formatGrowth` (signed, for changes) and `formatLevel` (unsigned, for
   levels). This was pre-existing, on every stock.
2. **A refused score no longer prints as 50.** `scoreFromSec` returns 50 on its
   unavailable branch because the shape needs a number, and its own docblock
   says 50 is the seed and not a reading. The payload carries `null`.
3. **An unavailable card is grey, not amber.** `tone` is `"neutral"` on the
   refusal branch for the same shape reason, so both the pill *and the card
   border* were painting "could not measure" as "measured, and middling". The
   check caught the border after the pill was already fixed.
4. **`emptyEarnings()` is gone.** It caught any throw and returned
   `hasStructuredData: false`, and this route is ISR-cached — so one transient
   Redis blip produced a plausible "data is not available for this symbol"
   card, served to every visitor and crawler for the next 15 minutes, and
   indistinguishable from a symbol that genuinely has no filings. The snapshot
   has real `available: false` states with their own sentences; anything else
   throws, and Next does not cache a render that throws.

### 4.5 The News page — asked about, and the answer is "no breakage"

The brief asked what `/stock/[symbol]/news` reads from this component before
changing its shape. It reads four things, all now supplied:

| Was | Now |
|---|---|
| `latestEarnings.tone` → tile border | `earningsTileTone(snapshot)`, mapping the scorer's vocabulary to the news scorer's at the one call site |
| `latestEarnings.toneLabel` → caption | `snapshot.toneLabel`, caption rewritten (§4.3) |
| `latestEarnings.hasStructuredData` | `snapshot.available` |
| `<SharedLatestEarningsCard earnings={…}>` | `snapshot={…}` |

`earningsScore` on that page is **unrelated** and untouched: it is
`scoreEarnings(news)` from `lib/stock-news-data.ts`, which scores *headlines*,
not estimates. It feeds the lead summary and `AiInsightCard` and is unaffected.

The two vocabularies are mapped at the call site rather than by widening
`miniScoreCardStyle` to accept both, because a style function that takes either
is how the two scales become interchangeable.

---

## 4a. The lead-paragraph stammer, found on the preview

Not in the brief and not on my eye-check list — the owner found it on
`/stock/AAPL/news`:

> "Earnings tone is currently mixed earnings tone."

**It was on every band and every symbol, not just AAPL and not just MIXED.**
`scoreToEarningsLabel` returns a complete noun phrase — "Positive earnings
tone" / "Mixed earnings tone" / "Weak earnings tone" — and `buildLeadSummary`
interpolated it into a sentence that had already said the noun. There is a
fourth case that is wrong differently: with no earnings headlines the label is
"No clear earnings read", giving *"Earnings tone is currently no clear earnings
read."*

**Pre-existing**, on `main` since #451. Nothing in this pass touched
`buildLeadSummary` or the scorer; the preview is simply the first time anyone
read the paragraph.

### Why reading that line did not catch it

The clause immediately before it interpolates `newsScore.label` **identically
and correctly**, because `scoreToNewsLabel` returns a bare adjective
("Bullish") — so "a bullish headline tone" reads fine and the template looks
sound. Two scorers returned **different parts of speech under one field name**,
`label`, and nothing in the types could say so.

### The fix

`EARNINGS_TONE_BANDS` in `lib/stock-news-data.ts` — one table carrying
threshold, bare `word`, standalone `label` and `tone`. `scoreToEarningsLabel`
and the new `scoreToEarningsWord` both read it, and `EarningsScoreResult` gains
`word: string | null`. Prose takes the word; chips (the sector page,
`AiInsightCard`) keep the label, where the full phrase is correct.

A null `word` takes a different sentence rather than a blank — "There is no
clear earnings read in the recent headlines." Same rule the function already
applied to a null trend: no headlines is not a tone of "mixed", it is no
reading, and naming a state that was never established is the thing to avoid.

**The fix also removed a duplicate that was already there.** `scoreEarnings()`
carried its own inline `if (score >= 64) … else if (score <= 36)` chain with
the same three label strings, 700 lines from `scoreToEarningsLabel`. They
agreed, which is the only reason nobody noticed — and adding a third form to
two copies would have made three. It now reads the table for label and tone and
keeps only its `reason`, which genuinely differs per branch.

`scripts/check-news-lead-copy.mjs` runs the real builder over every band and
both sides of every boundary, asserts the null-word case, and pins the 64/37
split the if/else chain had — the actual risk of rewriting it as a
`>= from` table. Mutations included: interpolating the label again brings the
stammer back, and the check fails if it does not.

**Not changed:** `earningsTone: earningsScore.label` reaching the AI brief
prompt (`app/api/stock-news/insight/route.ts:127`). It is a field value, not
rendered copy — mildly redundant to a model, not a defect.

---

## 5. What is still on FMP, and is a follow-up rather than a regression

`lib/latest-earnings-data.ts` is **unchanged and still live**. The card no
longer uses it, but three surfaces do, and they still show the estimate-derived
tone described in §4.3:

| Surface | Reads | State |
|---|---|---|
| `/api/stock-earnings/[symbol]` | `getLatestEarningsData` | FMP, estimates present in the JSON |
| `/dashboard` overview chip | that route, via `DashboardClient.tsx:867` | FMP tone |
| `/earnings-calendar` ticker search | that route, via `EarningsTickerSearch.tsx:71` | FMP |

**The visible consequence:** `/stock/MU`'s sidebar now shows a SEC-scored tone
while `/dashboard`'s Earnings chip for MU still shows the FMP one, and they can
disagree. That is a narrowing of an existing inconsistency, not a new one — the
sidebar previously disagreed with `/stock/MU/earnings` instead — but it is real
and it is the next thing to close.

The `LatestEarningsData` / `EarningsPeriodSummary` / `EarningsYearSummary` /
`ScoreTone` types moved from the card into `lib/latest-earnings-data.ts`, which
is the module that still builds them. The name is now slightly wrong on purpose:
the HTTP route's consumers key off those field names over the wire, and
renaming the type would not rename the JSON.

**Also noted, not fixed** (pre-existing, out of this pass's scope):

- `app/stock/[symbol]/earnings/page.tsx:6` imports `getLatestEarningsData` and
  never calls it. It was already an unused-var warning on `main`. The 14-line
  comment beside it describes a call that no longer happens.
- `app/api/stock-analyst-rating/[symbol]/route.ts` still exists and still calls
  FMP. Nothing on `/stock/[symbol]` calls it any more, but it is a live route.

---

## 6. Verification

```
npx tsc --noEmit                    clean
npx eslint <changed files>          no new errors or warnings vs main's baseline
node scripts/check-all.mjs          102 of 103 pass
node scripts/check-earnings-snapshot.mjs   all pass
node scripts/check-news-lead-copy.mjs      all pass
```

The one failure is `check-doc-citations.mjs`, which **already fails on `main`**
with four dangling IPO citations (verified by stashing). This document is what
clears the fifth.

`next build` was not run: it cannot complete in this sandbox without
`UPSTASH_REDIS_REST_URL`/`_TOKEN` — the ISR'd screener pages exceed Next's 60s
per-page budget against a cold cache. See
`claude/traps/next-build-not-locally-validatable.md`. The Vercel preview is the
only build check available, and the only place a rendered page can be seen: the
sandbox cannot reach `*.vercel.app` or the production domain (403 CONNECT
tunnel failed).

### `scripts/check-earnings-snapshot.mjs`

Renders the shipped card against committed SEC fixtures and asserts on what a
reader sees. **Every property is asserted twice** — once against the shipped
source, once against source mutated to break that exact property — so a check
that cannot fail shows up as one. The mutation harness is
`scripts/lib/render-snapshot.mjs`, alongside the existing `render-cards.mjs`.

One note on that harness: it inlines `TIMING_WORDING` out of
`lib/server/secReportDates.ts` rather than the module, because that file and
`secExtract.ts` both declare a top-level `const DAY = 86400000` and
concatenating them turned two correct modules into a syntax error. That
collision exists only in the harness.

---

## 7. Eye-check list for the preview

Per the owner's two-surface workflow, nothing merges without this.

- **`/stock/MU`** — the named symbol. Sidebar snapshot: figures present, period
  named, no "estimate" or "surprise" anywhere, margins with no `+`. Stat grid:
  nine rows, no CEO/Employees/Beta/ISIN/CUSIP. No Analyst Ratings section
  between Valuation and Chart Summary. Valuation still shows four multiples.
- **`/stock/AAPL`** — a large filer with a long description, to confirm the
  stat-grid float still balances with five fewer rows. This is the layout
  `CompanyProfile.tsx`'s own comment warns about: the sidebar was ~1,000px
  against a description of 450–2,150 characters, and the grid is now shorter.
  **Most likely place for a visual regression.**
- **`/stock/RYAAY` or another non-USD filer** — the `available: false` path.
  Should read the currency sentence, on a grey card with a grey pill, and no
  figure grid.
- **`/stock/MU/news`** — the "Earnings Tone" tile should show a real two-digit
  score, not 78/28/55, and read "… on the latest filed results".
- **Any symbol not yet read into the SEC store** — the other `available: false`
  sentence, and confirm it is not a grid of em dashes.
