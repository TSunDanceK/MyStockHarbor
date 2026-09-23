# BRIEF — Get `/earnings-calendar` fully off FMP (final outstanding scope)

*Mirrored into the repo 2026-09-22 from the Claude Project doc of the same
name. The Project doc said it was already saved here; it was not — the same
mirroring gap that lost `HANDOFF-due-strip-universe-regenerated-2026-09-22.md`
earlier the same day. Recorded verbatim, so the repo copy and the Project copy
say the same thing.*

Get `/earnings-calendar` fully off FMP — full outstanding scope.

Three FMP touchpoints remain, all confirmed live by tracing the code (not
assumed from comments):

1. The confirmed grid's candidate list and company names.
2. The grid's price/market cap — same file, `/stable/quote`, one call per
   symbol.
3. The ticker search's "next earnings date" — `EarningsTickerSearch.tsx` →
   `/api/stock-earnings/[symbol]` → `lib/latest-earnings-data.ts`. This one is
   the most urgent: it currently renders "NVDA next reports on Nov 18, 2026" as
   an unhedged fact, with no "estimated" language at all. That's misleading a
   reader today, not a future risk.

A rolling 30-day-forward measurement has already been run against the full
universe (695/700 filers): 82.6% listing-day precision against a computed 31.5%
naive baseline, 90.6% of filers individually clearing 70%.

**Build order:**

1. Build the "expected to report in the next 30 days" section below the grid —
   banded 7 / 8–21 / 22–30 day sub-windows, evidence cards per entry (last
   reported date, the filer's own median filing lag, next period end, last
   quarter's headline number and price reaction), honest heading with its own
   coverage denominator, per-filer ≥70% suppression, FPIs get a wider band
   rather than exclusion, re-measure the 5 paging-capped filers before excluding
   them.
2. Remove `EarningsUpcomingTicker` entirely.
3. Point the ticker search at the new 30-day estimator instead of FMP's
   exact-day call — highest priority of the three touchpoints, since it's
   actively misleading readers right now.
4. Replace the grid's three remaining FMP calls: candidates →
   `secReportDatesStore`/SEC daily index (confirm coverage matches FMP's before
   cutover); names → `company_tickers_exchange.json`; price → Tiingo, switching
   the US-listed admission test from FMP quote's `exchange` field to the
   existing `usOk`/price-pool check, since Tiingo's `quoteOne` supplies neither
   `exchange` nor `marketCap`. Confirm Tiingo's licensing tier before wiring.
5. Fix the cold-lambda bug found by inspection: `fetchMonthRowsDetailed`'s
   no-key early return sits above the Redis reference read, so a lapsed FMP key
   would read a cached month as empty even when Redis holds it. Fix before the
   key is actually pulled.

**Finish line:** the page should render correctly with `FMP_API_KEY` unset
entirely — that's the acceptance test, not any single PR.

Verify each piece the way #507/#508 were verified — render against real
production data via a relay task, print the visible text, mutation-test new
logic, `check-all` clean — and report back with numbers and a preview link
before merging any of it.

---

## Status against this brief, as of 2026-09-22

| Item | State |
|---|---|
| 1. Expected section | Built — PR #512, branch `claude/expected-30d`, **unmerged, awaiting review** |
| 2. Remove `EarningsUpcomingTicker` | Done in the same PR (component, loader and import all gone) |
| 3. Ticker search → estimator | Built — branch `claude/search-outlook`, stacked on #512 |
| 4. Grid's three FMP calls | Not started |
| 5. `fetchMonthRowsDetailed` cold-lambda bug | Not started |

**Two deltas against this brief's wording, flagged rather than silently
absorbed** (both decided under the earlier instruction that preceded this
brief's phrasing):

- *"FPIs get a wider band rather than exclusion"* — implemented as a **higher
  bar** (`PRECISION_BAR_FPI = 0.8`) rather than a wider band, under the earlier
  instruction "give FPIs a wider band **or** a higher bar rather than excluding
  them outright". The reasoning is in `expectedToReport.ts`: the band IS the
  sentence a reader reads, and two classes of row making two different claims
  under one heading is a worse honesty problem than a shorter list. FPIs are not
  excluded — a 6-K filer clearing 0.8 is shown.
- *"last quarter's headline number and price reaction"* in the evidence cards —
  **not shipped**. The cards carry last reported date, the filer's own median
  filing lag with its sample size, and next period end. The headline number and
  price reaction are a separate data source from the one this section reads and
  were not wired; this is a gap against the brief, not a decision against it.
