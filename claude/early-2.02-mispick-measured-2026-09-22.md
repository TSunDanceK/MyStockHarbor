# The early-2.02 mispick, measured — and the fix (review of #512/#513, items A–C, E, F)

Relay [35766291679](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35766291679),
task `write-early-202-census` (`scripts/early-202-census.mjs`, reads only), 2026-09-22.
Brief: `claude/BRIEF-early-2.02-mispick-2026-09-22.md`.

## A. Across the universe

818 manifest filers with a CIK; 817 scored (1 had no fact set). 143 have no stored record yet.

| | count |
|---|---|
| periods in the stored window | 9,742 |
| paired with a 10-Q/10-K | 8,962 |
| unpaired (no 10-Q/10-K on file, or no 2.02 before it) | 780 |
| **filers with a period whose earliest 2.02 is not the one nearest the 10-Q/10-K** | **209** |
| **periods covered** | **493** |
| of which the earliest and nearest share a date (accession/timing only) | 19 |
| filers with a date-differing mispick | 192 |
| filers with a recurring pattern (≥ 2 periods) → the current-period guard applies | 84 |
| single-incident filers (guard does not apply) | 125 |

**Not two of 55.** The shape is common: biotechs' JPM-conference preliminary revenue
(ALNY, JAZZ, HALO, EXEL, GH, NTRA, ISRG, DHR), energy/miners' quarter-end operating
updates (FANG, EOG, APA, FCX, CVX), insurers' supplements (PRU, PFH, ALL, AIZ, MET),
pre-announcements (BA 2024-Q3, SWKS, CNC), and deliveries (TSLA, LCID, RIVN).

Largest moves, stored median lag → paired:

```
TSLA  15/15 periods   2d -> 23d   next 2026-10-02 -> 2026-10-22   early 2d vs results 23d
ABBV  13/15           4d -> 31d   next 2026-10-03 -> 2026-10-31   early 3d vs results 31d
LCID  13/14           7d -> 37d   next 2026-10-06 -> month        early 6d vs results 37d
ATHS  12/15          17d -> 41d   next 2026-10-02 -> month
FANG  12/15          12d -> 36d   next 2026-10-09 -> month
APOS   8/13          15d -> 35d   next 2026-10-02 -> 2026-11-04
EOG    6/15          32d -> 38d   next 2026-10-08 -> month
PRU    6/14          30d -> 33d   next 2026-10-14 -> 2026-10-29
```

The full table and per-period detail are in the relay log.

**The rule can also go the other way.** Among the 474 date-differing periods, the
pick is nearer the filer's own paired habit in 411; the earliest is nearer in 63. Most
of the 63 are Q4/annual periods whose real release lands later than the quarterly
habit (TGT, DGX, WAB, HALO), so they are right. Spot-checked, a few look like genuine
reverse errors, where a second 2.02 went out on the 10-K's day: **LUV 2023-Q4**
(25 → 37 days), **H 2023-Q4** (45 → 54), **DAR 2023-Q3** (26 → 38). That is the rule as
specified ("latest on or before the 10-Q/10-K"). A refinement that picks the candidate
nearest the filer's unambiguous-period habit would catch them, and is a decision for
the owner.

**Are 10-Q/10-K dates stored where a render reads them?** The report-dates record: **no**.
Its events hold 8-K/6-K only, and the 10-Q is read at write time from `submissions`,
then discarded. The fact set does carry a per-period `f` (filed). **Neither is needed for
the fix**: the pairing runs in the sec-facts cron, where the submissions payload is
already in hand. So there is **no new field for the pairing and no cron rewrite**. Only
a **one-off record rewrite** is needed (C.3). One small field is added, `earlyNonResults`,
the pattern the guard used.

## B. Production today

`www.mystockharbor.com` sits behind the Vercel Security Checkpoint (HTTP 429 "We're
verifying your browser" to the runner and to the Vercel MCP fetch alike), so page HTML
cannot be read by automation. What follows is the live stored record the pages render:

```
/stock/TSLA/earnings "Next expected earnings date": 2026-10-02, "results filed with the SEC
  before market open if it follows its usual pattern" (next.kind=date, lag 2, 14 events)
/stock/TSLA snapshot next report: the same record, 2026-10-02

"Results filed with the SEC" / the session each reaction bar measures:
  2026-06-30  filed 2026-07-02 09:01 before-open -> session 2026-07-02   NOT the results (release 2026-07-22)
  2026-03-31  filed 2026-04-02 09:07 before-open -> session 2026-04-02   NOT the results (release 2026-04-22)
  2025-12-31  filed 2026-01-02 09:20 before-open -> session 2026-01-02   NOT the results (release 2026-01-28)
  2025-09-30  filed 2025-10-02 09:04 before-open -> session 2025-10-02   NOT the results (release 2025-10-22)
  ... all eight bars
ABBV: 2026-10-03 next; all eight bars on the early 2.02 (e.g. 2026-07-06 16:12 -> session 07-07; release was 07-31)
```

**Confirmed: TSLA's reaction bars measure delivery-numbers day, every one of the eight.**
ABBV's measure its early IPR&D 2.02.

The due strip on Oct 1–3, simulated with the shipped `selectDue` + `dueRowLabel`:

```
OLD, as stored        Oct 1-3: MU TSLA ABBV
  TSLA "Period ended 2026-09-30 · results have not yet been filed · 1/2/3 days outstanding"
OLD, rewritten after the delivery 8-K, Oct 3:
  TSLA dropped from the strip; next 2027-01-02 for 2026-12-31;
  pending 2026-09-30 "announced 2026-10-02"   <- the delivery 8-K claimed as Q3 results
PAIRED + guard, both worlds, Oct 1-3: TSLA and ABBV not listed (TSLA due from ~Oct 16);
  after the 8-K: next 2026-10-22 for 2026-09-30, pending none
```

## C. The fix

- `resultsPairing()` (`lib/server/secReportDates.ts`): per period, the pick is the latest
  **original** 8-K 2.02 filed on or before that period's 10-Q/10-K, matched by the 10-Q's
  period of report. Anything after the 10-Q is kept out, and so is an 8-K/A while an
  original is in the window. With no 10-Q on file, earliest wins as before.
- `earlyNonResultsPattern()`: at least 2 paired periods with an earlier non-results 2.02,
  derived from the pairing, with no symbol list.
- `pendingResults(…, pattern)`: for such a filer, a current-period 2.02 that sits nearer
  its early habit than its results habit (the midpoint of its own two medians) is not
  "results filed". There is no fixed day threshold; ORCL at about 10 days is untouched,
  and that is asserted.
- Backfill: `data/sec/report-dates-rewrite.json` (the 209 above) is queued by the
  production sec-facts cron after `changedThisRun`, cut members first, 100 per run
  alongside the other queues. Each record drains itself once it carries `earlyNonResults`.
  The write path and gate are unchanged. After merge, the cron at 04:20 UTC finishes it
  in about 2–3 runs.

## E. FPIs against the bars (#512's own scorer, stored records)

76 FPI filers (any 6-K-basis event). **11 clear 0.80**: ALC B BCE CLS CNH CNI FMS GFS IAG
IX SHOP. **5 clear 0.70 but not 0.80**: AEM .79, BIPI .75, BNT .77, CVE .75, NVS .76.
**12 below both**. 48 are too thin to score (< 8 periods).

## F. No-key month read

`fetchMonthRowsDetailed` now reads the Redis reference copy before its no-key return.
Check §9 of `check-earnings-failure-not-absence` covers key unset + Redis holding the
month → rows render, served from cache, month known, 0 FMP calls. Mutant M1 caught, 14/14.
