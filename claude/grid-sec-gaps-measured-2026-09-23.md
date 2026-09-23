# What closes the grid's in-universe SEC gaps (measured 2026-09-23)

**This round only measures.** No production code was changed, nothing was wired,
there is no Tiingo code, no new public route and no export (per
`claude/tiingo-contract-and-limits-2026-09-23.md`).

**Owner's decision this serves.** The grid's universe becomes our tracked SEC
manifest (~866 symbols) instead of FMP's candidate list, but **only after the
in-universe SEC gaps are closed**.

## Evidence

| Run | Commit | What changed |
|---|---|---|
| [35840312446](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35840312446) (**evidence run**) | `e19ee901` | Every number below comes from this run. |
| [35838912504](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35838912504) (first run) | `0082cdec` | Same numbers for everything except the 6-K document-text rules. Those rules were added after this run showed that exhibit descriptions are generic ("EX-99.1"). |

- **Probe:** `scripts/grid-sec-gaps.mjs`
- **Router entry:** `write-grid-sec-gaps` in `scripts/relay-run.mjs`. It only reads. The
  `write-` prefix just routes it to the job that holds the Redis credentials.
- **Lifted, not reimplemented** (the probe runs the code as shipped):
  - `getMonthCandidates`, which builds the grid's candidates
  - `resultsPairing`, `periodicReportDates` and `nextPeriodEndFrom`, which read results dates from SEC filings
  - `reportDatesQueue`, the job's queue
  - `secFieldsHash`, which is `readFactSet`'s gate
- **FMP side:** read from what production already caches in Redis. No FMP call was made.
- **SEC side:** live submissions for all 862 manifest symbols that have a CIK, plus the
  filing index and main document of every 6-K the in-universe foreign filers filed in
  the window.

**Window and matching.** The window is 2026-07-26 to 2026-09-23. The overlap
definition is #532's A3: FMP's pre-admission candidates in our universe against the
SEC side, paired per symbol, nearest date first, within ±10 days.

**Baseline, reproduced:** FMP 683 · SEC 384 · **overlap 379 (55.5%)** · FMP-only 304 ·
SEC-only 5.

**FMP-only split into buckets:**

| n | Bucket |
|---|---|
| 128 | Foreign filers on 6-K |
| 101 | 2.02 on EDGAR, but no report-dates record |
| 54 | 2.02 on EDGAR, but the record is stale |
| 17 | Other |
| 3 | 2.02 more than 10 days from FMP's date |
| 1 | No CIK |

## 1. The 128 foreign filers on 6-K

**Why the store has 1 6-K event.** The shipped rule accepts a 6-K only when its
`reportDate` equals a period end in the stored fact set. That fails for two reasons:

- 80 of these 127 filers have **no quarters at all** in their fact set (median 0). They
  are IFRS or semi-annual filers.
- 666 of their 913 window 6-Ks carry a `reportDate` that is blank or equal to the
  filing date.

Across all 1,140 in-universe 6-Ks, the shipped rule flags 3.

**A 6-K near the FMP date exists almost every time.** One is filed within ±1 day for
**122 of 128 (95.3%)** pairs and within ±3 days for **125 of 128 (97.7%)**. The three
without one are BAP (its 6-K is 4 days late), SANG and ADSEW.

**Which signal separates a results 6-K from the rest.** The population is 1,140 6-Ks
from 167 in-universe foreign filers, about 19 a day.

"FP" here means a flagged 6-K with **no** FMP date for that symbol within ±10 days.
Hit rate is the share of the 128 bucket-1 pairs with a flagged 6-K within ±3 days.

| Rule | Flags | FP | Bucket-1 hit ±1d | ±3d |
|---|---|---|---|---|
| R0 shipped (`reportDate` = stored period end) | 3 | 0% | 0.8% | 1.6% |
| R1 any 6-K | 1,140 | **57.8%** | 95.3% | 97.7% |
| R2 `isXBRL` | 55 | 29.1% | 27.3% | 27.3% |
| R3 submissions text (`primaryDocDescription` + `primaryDocument`) | 21 | 19.0% | 7.0% | 7.0% |
| R4 filing-index text (exhibit descriptions + file names) | 32 | 15.6% | 13.3% | 13.3% |
| **R6 main-document text, first 20k chars** | 332 | 26.2% | **90.6%** | **93.0%** |
| **R7 main-document text, first 3k chars** | 266 | **20.7%** | 85.2% | 87.5% |
| R8 R7 or `isXBRL` | 292 | 22.3% | 88.3% | 90.6% |

**The metadata cannot separate them.** `primaryDocDescription` is "6-K" or
"FORM 6-K" for 811 of 1,140. Exhibit descriptions are nearly always the generic
"EX-99.1" / "EXHIBIT 99.1". Only a few filers put it in the file name (for example AGI's
`ex991alamosgoldq22026earni.htm`).

**The document itself can.** The release says what it is in its opening text. The
rule `DOC_RE` in the probe matches phrases such as "second quarter", "Q2 2026",
"half-year", "six months ended", "interim results" and "financial results".

**The FP rate above overstates the real one.** It is measured against FMP's dates,
which are incomplete for foreign filers. Of the 25 R7 flags printed with no FMP date
nearby, many are genuine results releases:

- Aegon's 1H26 results under its second ticker, AEFC
- Brookfield's results under its preferred and baby-bond tickers BEPH, BIPI, BNH and BNJ
- GSK's Q2 report
- BIPI's interim report

The true false positives in that sample are of two kinds:

- **Date announcements:** "Baidu to Report Second Quarter 2026 Financial Results on
  August 18", Bradesco's (BBD) Q3 videoconference date, AQNB's "Announces Date for
  Second Quarter…", EGO's call details.
- **Deal text mentioning a quarter:** "expected to close in the fourth quarter" (AEM, BSP).

A negative clause for "to report … on / announces date / conference call" would
remove the first kind. **It was not measured.**

**What R7 still misses (16 of 128):**

| Why | Filers |
|---|---|
| The release sits in an XBRL instance or financial appendix, not a press release | TAK, DB, UL, GMAB, ONON (R8 recovers some) |
| The results document is not the first EX-99 | BSAC management commentary, HMY, ESLT, KEP |
| FMP's date is not a results event at all | ZENA, RVSN/RVSNW product releases |
| No 6-K near the date | BAP, SANG, ADSEW |

**Fix.** A results-6-K reader for foreign filers:
- Consider the filer's 6-Ks. For each, fetch the filing index plus the main exhibit (the
  first EX-99, else the primary document) and apply `DOC_RE` to the opening text.
- Keep the earliest flagged 6-K in each cluster.
- Carry the weaker `basis` label, as `SIX_K_IS_A_WEAKER_SIGNAL` already requires.

**Cost.** Two extra fetches per 6-K, about 19 6-Ks a day in the universe, so roughly
38 fetches and 5s a day at the 125ms pace. The document bytes were not measured,
because gzip responses did not report a content length.

## 2. The 101 with a 2.02 on EDGAR but no record

**Cause: the backlog starves.** All 101 are the same class: a readable fact set, never
stamped (`reportDatesAt` null), sitting in tier 3's never-written backfill. That
queue holds **393** today, at positions #4 to #392.

The job reserves 100 slots a run. The 04:20 run on 2026-09-23 spent them like this:

| Tier | Slots |
|---|---|
| Tier 1, filed since the record was written | 64 |
| Tier 2, the due-strip cut | 33 |
| Backfill | ~3 |

So the backlog drains at a few symbols a run, while earnings season keeps tier 1
full. The job reported `reportDatesBacklog` 463 at 04:20.

**Ruled out:**

| Suspected cause | Finding |
|---|---|
| CIK problem | none |
| Missing or gated fact set | 1 symbol of 169 (IBN has no fact set and is skipped unstamped) |
| Records written and then lost | none |

Over the manifest, 169 symbols with a CIK have no record. 168 of them are this same
backlog case.

**Fix.** Give the never-written backfill its own guaranteed slice, or raise
`SEC_REPORT_DATES_PER_RUN`. Once re-read, the shipped reader recovers **86 of 101**
events. With the reader fix in section 3 it recovers **101 of 101**.

## 3. The 54 stale records

**It is the reader, not the queue.** Every one of the 54 records was read *after* its
8-K. The queue did pick them. The reader dropped the event.

`resultsPairing` matches a 2.02 only to period ends in the **stored fact set**, and
those sets lag. For 49 of the 54, the newest stored quarter is still Q1 (for example
2026-03-31), although the Q2 10-Q is on EDGAR. This is the fact-set re-read backlog: the
751-set rewindow backlog that prompted the temporary 16:20 run on main. The July/August 2.02 then fails in one of three ways:

| n | What happens | Examples |
|---|---|---|
| 30 | The 2.02 is **grouped into the older Q1 period**, and "earliest wins" keeps the May event | JCI, BG, CLH, VRSK, GD, GEHC, HUM, CTSH, V, PNR |
| 19 | The 2.02 is more than 120 days after the newest stored period end, so its period is **null** and it is filtered out | D (read 09-16, newest stored Q 2026-03-31, 2.02 on 07-31), FRT, EXC, LNT, AEP, DTE, NXPI |
| 5 | The record was written before the set gained Q2; a plain re-read now fixes these | VIRT, RIVN, PLUG, RMD, PRU |

**Fix: widen the period-end set the reader matches against.** Both variants reuse the
same submissions payload, so there is **no extra fetch**:

| Variant | Recovers |
|---|---|
| V0 shipped | 5 of 54 |
| V1 + 10-Q/10-K `reportDate` from submissions (the only exact period ends outside the fact set) | 48 of 54 |
| V2 + cadence-projected period ends (`nextPeriodEndFrom`, stepped forward) | 50 of 54 |
| **V3 = V1 + V2** | **50 of 54** |

V3 does not recover GEHC, PNR, DTE or VG.

**No regressions.** Across all 862 filers, V3 against V0 on in-window events: 786
unchanged, 75 gained, 0 moved, 0 lost.

**Caveat for building it.** In this past window V1 works because the Q2 10-Qs are now
filed. On the day a 2.02 lands, its 10-Q usually is not. Only V2's projected end can
match it then, so V2 is what keeps the record current. It needs snapping to a month
end before being stored, because a raw step count drifts by a day or two.

## Projected in-universe coverage vs FMP (A3 definition, same window)

| Scenario | SEC events | Overlap | FMP-only | SEC-only |
|---|---|---|---|---|
| S0 today's store | 384 | **379 / 683 (55.5%)** | 304 | 5 |
| S1 buckets 2 and 3 re-read, shipped reader | 476 | 470 (68.8%) | 213 | 6 |
| S2 S1 + reader fix V3 | 551 | 539 (78.9%) | 144 | 12 |
| S3 S2 + filers without a fact set read from submissions | 551 | 539 (78.9%) | 144 | 12 |
| S3 + 6-K rule R4 (index text) | 574 | 553 (81.0%) | 130 | 21 |
| **S3 + 6-K rule R7 (document text, 3k)** | 720 | **646 (94.6%)** | 37 | 74 |
| S3 + 6-K rule R6 (document text, 20k) | 752 | 652 (95.5%) | 31 | 100 |
| S3 + 6-K rule R8 (R7 or `isXBRL`) | 728 | 649 (95.0%) | 34 | 79 |

**Dates stay tight.** Under R7, 593 of the 646 overlaps are the same day, 46 are ±1
day and 7 are 2 to 10 days apart.

**What is left FMP-only under R7 (37):**

| n | What |
|---|---|
| 12 | Foreign filers the text rule misses |
| 17 | The #532 "other" class: BNS and RY (40-F banks), MKL, NKLR and VS (10-Q only), NCPL/NCPLW, FEED, AES, OKE, and CTAS, SFIX and PAYX on 2026-09-23 (not filed yet at run time) |
| 4 | GEHC, PNR and VG stale; ZWS without a record |
| 4 | PAA and FDXF more than 10 days away; the no-CIK case (EA) |

**SEC-only rises to 74.** They are mostly foreign results that FMP dates elsewhere or
lists under another ticker (BEP, TAK, SONY, ARM, GSK, AZN, BABA), plus R7's date
announcements. The negative clause above would cut the second group, but **it is not
measured.**

## Job-time cost against sec-facts' budget

**Budget, as `lib/server/jobBudget.ts` sets it:**

- `JOB_BUDGET_MS` 240,000, of which `REPORT_DATES_RESERVE_MS` 60,000 is reserved for report dates
- `MIN_GAP_MS` 125
- `SEC_REPORT_DATES_PER_RUN` 100

**The 04:20 run on 2026-09-23 (the run record, read by the probe):**

- total elapsed 193.6s
- facts phase 180.3s, which is its full share: 300 facts deferred
- report dates 13.2s for 100 attempted, so about **132ms a record**
- `reportDatesDeferred` 0

This rate is set by pacing, not by SEC. The runner measured a 31ms median submissions
fetch, so each record costs one submissions fetch paced at `MIN_GAP_MS`.

| Fix | Extra fetches | Time |
|---|---|---|
| **Bucket 2**, backlog slice | 393 one-off records | About 52s in total. At a cap of about 400 a run, this fits in **one run's** unused reserve: 13s + 52s is roughly 60s, so it is safest across two runs. With the temporary 16:20 run, that is one day. Afterwards, steady state is tier 1 (about 64 a run in season, about 8s). |
| **Bucket 3**, reader fix V1+V2 | 0 per record. Correcting the 693 existing records means rewriting them once. | About 91s, spread over two or three runs at a 300 to 400 cap. It shares the reserve with the bucket-2 drain. |
| **Bucket 1**, 6-K text rule | About 38 a day (19 6-Ks, 2 fetches each), in the report-dates phase for tier-1 foreign filers | About 5s a day. The one-off backfill for the 60-day window is 1,140 × 2 fetches, about 285s, spread over about 5 runs. |

**Summary.** All three fit inside the 60s report-dates reserve, which today uses 13s,
once the per-run cap moves from 100 to about 400. They do not touch the facts phase.
The facts phase is saturated (300 deferred), and that is what makes fact sets lag and
bucket 3 happen. Fix V1+V2 makes the dates independent of that lag.

## Separately, for later: US-listed companies over a market-cap floor

**Source.** SEC only; no FMP, no Tiingo, no price source. The measure is
**`dei:EntityPublicFloat`**, the aggregate market value held by non-affiliates that
every 10-K cover reports. It was read from SEC's XBRL `frames` API (CY2024Q2I to
CY2026Q2I; newest per CIK) and joined to `company_tickers_exchange.json`, counting
Nasdaq, NYSE and CBOE as US-listed.

**How complete it is:**

- **Coverage:** 4,032 of 6,066 US-listed registrants (66.5%) have a float value. The
  34% without one were not broken down. Foreign filers on 20-F/40-F are probably most
  of them, since the cover field comes from the 10-K, but that was not checked.
- **Age:** 3,174 values are as of 2025-06, so most are about 15 months old.
- **Bias:** float leaves out insider holdings. Against the price pool's live market
  cap (587 filers with both), float/cap has a median of **0.82** (p10 0.39, p90 1.32).
- **These counts are a floor.** Inside the manifest, pool market cap ≥ $2B counts 736
  filers, where public float ≥ $2B counts 601.

| Floor (public float) | Registrants | Already in manifest | **New** |
|---|---|---|---|
| ≥ $2B | 1,393 | 601 | **792** |
| ≥ $5B | 940 | 567 | **373** |
| ≥ $10B | 638 | 459 | **179** |

**What covering them would cost.** From a sample of 25 new $2B+ filers, companyfacts is
a median **3.4 MB** and 300ms on the runner. A filer makes a median of 4 periodic
filings and 11 8-K/6-K filings a year.

| Floor | Seed (fetch time, one-off) | Steady state |
|---|---|---|
| $2B | ≈ 338s: 792 companyfacts (≈ 2.7 GB) + 792 submissions | ≈ 8.7 fact re-reads + 24 date re-reads a day ≈ 6s/day |
| $5B | ≈ 159s | ≈ 2.6s/day |
| $10B | ≈ 76s | ≈ 1.3s/day |

**The seed is the constraint.** It would go through the **facts phase, which is already
saturated**: 300 deferred, and a rewindow backlog of 751 on main. Even $10B adds about
half a run's facts time as a one-off. The seed time uses runner fetch times. Production
per-symbol facts time is higher: 180s for 480 attempted on 09-23, including
extraction. So these seed figures are a lower bound.

## What was not measured

- **A true false-positive rate for the 6-K rule.** The measured FP uses FMP's dates as
  ground truth, and FMP misses foreign-filer results under secondary tickers. Separating
  that needs hand labelling. The date-announcement negative clause is also unmeasured.
- **6-K document bytes.** gzip responses gave no content length.
- **Why about 34% of US-listed registrants have no public-float value.** Not broken down.
- **Market caps from a live price.** There is no licensed full-market price source in
  reach: Tiingo is not wired (by instruction), and FMP has no key. The floor counts use
  float, not market cap.
- **Why GEHC, PNR, DTE and VG stay unmatched under V3.** Not diagnosed further.
