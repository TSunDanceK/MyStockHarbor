# The earnings grid's three FMP calls, measured against SEC and the price pool (2026-09-23)

**This is a measurement only.** No production code was changed, nothing new is
wired, and Tiingo was not touched (the owner is still confirming its licence).

- **Evidence run:** relay [35833518584](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35833518584),
  task `write-grid-fmp-measurement`, at `68d9f157`. The numbers below come from this run.
- **First run:** [35832283212](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35832283212)
  at `ef832be7`. It produced the same numbers except in part B. Its name normaliser split
  "Casey's" into "casey s" and kept SEC's `/CAN/` state tags as words, so it reported 15
  names as "different" where the fixed version finds 11. That fix is the only change
  between the two runs.
- **Probe:** `scripts/grid-fmp-measurement.mjs`. **Router entry:** `write-grid-fmp-measurement`
  in `scripts/relay-run.mjs`.
- **Window:** 2026-07-26 to 2026-09-23, 60 days inclusive.

## Where each side comes from

The relay has no FMP key, so **no FMP call was made**. Every FMP figure comes from
data that production had already cached in Redis. The probe only reads (GET, MGET,
HMGET, TTL). The `write-` prefix only means it runs in the job that holds the Redis
credentials.

| Side | Source | State at run time |
|---|---|---|
| FMP candidates, raw | `msh:reference:v1:earnings-calendar:2026-07/08/09` (the rows `fetchMonthRowsDetailed` reads) | All three present: 3,498, 7,327 and 1,163 rows, with ~8.3h of TTL left. That is a daily TTL still being refreshed, so **production is still fetching FMP**. |
| FMP names | `msh:reference:v1:stock-list-names` | 38,829 names, ~8.5 days of TTL left |
| FMP candidates as the grid builds them | `getMonthCandidates`, **lifted from `lib/server/earningsCalendar.ts`** with its two readers stubbed to return the Redis data above | The name join, shape filter and one-row-per-symbol-per-month collapse are the shipped code |
| The grid as shown (post-admission) | `msh:earnings-day-items:v1:<date>` and `msh:earnings-day-complete:v3:<date>` | **Only 32 of the 60 dates have a blob** (31 are marked complete). 2026-07-26 to 2026-08-13 are all absent (TTL −2 = no key), as are the weekend dates. 2026-08-14 is partial, with 89 rows. |
| SEC results events, our universe | `msh:sec:reportdates:v1:*` (the report-dates store) | 693 records across 866 manifest symbols (862 of them have a CIK). 384 events fall in the window: 383 are `8-K item 2.02` and 1 is `6-K near period end`. |
| SEC results events, everyone else | Live `data.sec.gov/submissions` for 5,281 symbols. `resultsPairing` was **lifted** from `secReportDates.ts` and called with no period ends, so only 8-K 2.02 events come back. | 0 fetch failures. 560 symbols had no CIK. |
| SEC names and exchange | Live `www.sec.gov/files/company_tickers_exchange.json` (10,461 tickers; the committed copy has 10,426), plus the stored fact set's `entityName` | |
| Price pool | `msh:price-pool:v1` | 841 fields |

**Pairing rule.** Within each symbol, an FMP (symbol, date) is paired with an SEC
event if they are no more than 10 days apart. Nearest pairs are taken first, and
each side is used at most once.

**Where each classification comes from.** Every unpaired row was classified from
the filer's own submissions:

- **FPI / 6-K:** the filer has a 6-K between 3 days before and 10 days after the FMP
  date, or it files 20-F/40-F and no 10-Q.
- **Filed under a different item:** there is an 8-K within ±3 days, but it has no 2.02.
- **10-Q/10-K only:** the periodic report arrived within ±3 days and no 8-K 2.02 did.
- **Not filed yet:** the FMP date is today or yesterday and nothing has been filed.

## A. Candidates: `/stable/earnings-calendar` vs the SEC record

### A3 is the fair comparison: pre-admission candidates in our universe vs the store (all 60 dates)

```
FMP pairs 683 · SEC events 384 · OVERLAP 379 · FMP-only 304 · SEC-only 5
date agreement (n=379): same day 356 (93.9%) · ±1 day 22 (5.8%) · 4-10 days 1 (SLE, +7)
  signed SEC−FMP: −1:6  0:356  +1:16  +7:1
```

**SEC-only (5).** Almost nothing that SEC records is missing from FMP. The five are:

| Reason | Cases |
|---|---|
| The grid's own shape filter drops the symbol | BF-B, BRK-B |
| FMP never listed these spellings | BRK.B (the manifest carries both BRK.B and BRK-B), ATHS |
| FMP's date is more than 10 days away | PAA: SEC 2026-09-08, FMP 2026-08-07 |

**FMP-only (304), by reason:**

| n | Class | Examples |
|---|---|---|
| 128 | **FPI / 6-K.** The store holds **1** 6-K event in the whole window, so for foreign private issuers the SEC side is effectively empty. | BEP, NWG, CCJ, MGA, AU, BTI, VALE, TRP, TAK, STLA, LYG, MFG, BUD, MT |
| 101 | **In our universe, 2.02 on EDGAR, NO stored record.** 173 of 866 manifest symbols have no report-dates record. | SOJD, OWL, SOMN, NXT, MTZ, REGN, SO, PEN, RDDT, PAG, ST, TEVA, ORLY, OHI |
| 54 | **In our universe, 2.02 on EDGAR, the stored record lacks it.** The record was read in September, but its newest event is from April–July. | D, FRT, EXC, LNT, AEP, VIRT, RIVN, JCI, BG, CLH, VRSK, GD, GEHC. For example, D was read 2026-09-16 and its newest stored event is 2026-05-01. |
| 6 | Nothing on EDGAR near the date | BNS, RY, NCPL, NCPLW, RZLT, ESP |
| 5 | Filed under a different item | NCPL/NCPLW (8-K items 4.01, 4.02), FEED (5.07), AES (1.01), OKE (2.01, 7.01) |
| 3 | 10-Q/10-K only, no 8-K 2.02 | MKL, NKLR, VS |
| 3 | 2.02 filed, but more than 10 days from FMP's date | PAA, FDXF, MSB |
| 3 | Not filed yet (FMP date 2026-09-23) | CTAS, SFIX, PAYX |
| 1 | No CIK | EA |

A caveat on BNS and RY: both are 40-F banks. The FPI test looks only at a filer's
newest 200 forms, and for these banks that span is dominated by 424B2 filings. They
are therefore probably FPIs that were misclassified by the heuristic, not genuinely
missing filings.

**What this means for the cutover.** On our universe the store already agrees with
FMP almost perfectly wherever both have a date: 99.7% of overlapping dates are
within ±1 day. The store's gaps sit on its own side, not FMP's:

- **155 domestic 2.02s** it should hold but does not: 101 symbols with no record,
  plus 54 stale records.
- **128 FPI results events** the 6-K rule does not produce.

Both gaps have to close before this data can replace FMP.

### A1: the grid as shown (our universe) vs the store (32 materialised dates only)

```
FMP pairs 118 · SEC 384 · OVERLAP 58 · FMP-only 60 · SEC-only 326
date agreement (n=58): same day 57 · ±1 day 1
SEC-only: 321 "candidate, but its date was never materialised"
          (HIMS, IONQ, RKLB, SOFI, BSX, PFE, ANET, ON, LRCX, APH, MCHP, GLW …)
```

The SEC-only count here is not a candidate gap. Those events fall on 2026-07-26 to
2026-08-13, dates for which no day blob exists. FMP-only (60) splits as:
28 FPI · 14 no record · 4 stale record · 6 nothing on EDGAR · 3 different item ·
3 not filed yet · 2 more than 10 days apart.

### A2: every grid row vs the store plus live 8-K 2.02s outside our universe

```
FMP pairs 881 · SEC 647 · OVERLAP 298 · FMP-only 583 · SEC-only 349
date agreement (n=298): same day 270 · ±1 day 15 · 2-3 days 8 · 4-10 days 5
  signed SEC−FMP: −10:1 −4:1 −1:4 0:270 +1:11 +2:3 +3:5 +5:1 +7:2
  ≥2 days apart: ASPI, STEX, PROP, NDRA, NXGLW, DUOT, CLIR, MOBX, AVAT, CATO, LRHC, OCC, ABAT
```

Of the grid's 875 symbols, **759 are outside the manifest**. 709 of those have a CIK,
but only 252 have a live 8-K 2.02 in the window.

**FMP-only (583):**

| Group | n | Breakdown and examples |
|---|---|---|
| Not in our universe | 473 | FPI / 6-K **296** (preferreds and ADRs: BPYPP/O/N, SGML, MAKO, BHP, XP) · 10-Q/10-K only, no 8-K 2.02 **84** (small caps and SPAC units: NWAX, ALFUU, PAII, BEAG) · different item **37** (NUAI 7.01, SSAC 8.01, CVM 5.07) · nothing on EDGAR near the date **34** (TAYD, UUU, HIO, BANX) · 2.02 more than 10 days away **15** (HCWC, GPUS, HAIN, OBX) · not filed yet **7** (GIS, FUL, CBRL 2026-09-23) |
| No CIK at all | 50 | Mostly warrants, rights and units: CBRGU, NVVEW, AMPGR, DTSTW. Also AULT, EVTV, QLGN, UGRO. |
| In our universe | 60 | Same split as A1 |

**SEC-only (349):** 326 on dates that were never materialised · 16 where FMP had the
symbol more than 10 days away · 3 candidates on complete dates that the exchange test
did not admit (SCWO, QMLS, GME) · 2 dropped by the shape filter (BF-B, BRK-B) ·
2 never listed by FMP (ATHS, BRK.B).

**Not measurable: SEC-only across all of EDGAR.** SEC's side is complete only for
the manifest, because that is the only place a store exists. Outside it, the probe
fetched submissions only for symbols that FMP (or the store) had already named. A
filer that neither source knows about cannot appear in either list. Finding those
would need an EDGAR-wide scan of 8-K items for the window, and this probe did not
do one.

## B. Names: `/stable/stock-list` vs SEC

**FMP names:** 875 of 875 grid symbols (100%). This is true by construction, because
`getMonthCandidates` drops any row whose symbol has no stock-list name.

That join is therefore also a filter. **58 raw FMP symbols were dropped for having no
name.** SEC lists 38 of them with a title, and 21 of those on Nasdaq, NYSE or CBOE.
Examples:

- UMBFO "UMB FINANCIAL CORP" (Nasdaq)
- AUXX "Gold X2 Mining" (NYSE)
- HOST "Host Digital" (NYSE)
- SMCIP "Super Micro Computer" (Nasdaq)
- MCHPP "MICROCHIP TECHNOLOGY" (Nasdaq)
- OPENZ/OPENL/OPENW "Opendoor"
- NFEGP "New Fortress Energy"

**SEC names:**

| Source | Coverage |
|---|---|
| SEC title (`company_tickers_exchange`) | **825 of 875 (94.3%)** |
| Title ∪ fact-set `entityName` ∪ `submissions.name` | 825 (no gain) |
| Fact-set `entityName` | 116 of 116 manifest grid symbols, which is 13.3% of the grid |

**Missing from SEC (50).** Most are warrants, rights and units (ADNWW, AMPGR, BEEMW,
BTMWW, CBRGU, CCCXU, CMIIU, DTSTW, FFAIW, GDEVW, GIPRW, MNTSW, NIXXW, NRXPW, NVVEW,
NXPLW, PRSTW, RNWWW, STSSW) and SPACs or shells (ATMV, ATON). There are also
operating companies absent from SEC's current ticker file: ALOT, AMWD, AGAE, AULT,
BTM, CEAD, CTLP, EDAP, ENTO, EVTV, GLMD, GREE, HOTH, KWM, NKLA, PHGE, PRTC, QLGN, REE,
SBEV, SBLX, SCVL, SLAI, TIVC, UEPS, UGRO, VINC, VSCO, VVPR. The probe did not
establish why each one is absent.

**Agreement over the 825 symbols that have both names:**

```
identical 327 · case only 92 · same after punctuation/suffix/accent/state-tag folding 353
  → 772 / 825 (93.6%) the same name
first word agrees, rest differs 42 · DIFFERENT 11
```

The 11 that differ fall into three kinds:

| Kind | Symbols |
|---|---|
| **Renames where SEC is newer** | HCWC (FMP "Healthy Choice Wellness Corp." / SEC "Host Digital Inc."), LUCY ("Lucyd" / "Innovative Eyewear"), ZONE ("CleanCore Solutions" / "Zone Frontier"), CPB ("Campbell Soup Company" / "CAMPBELL'S Co"), BILL ("Bill.com Holdings" / "BILL Holdings") |
| **Language** | BMA ("Banco Macro S.A." / "Macro Bank Inc."), SQM ("Sociedad Química y Minera de Chile" / "CHEMICAL & MINING CO OF CHILE") |
| **SEC's surname-first or spaced style** | FUL ("FULLER H B CO"), JBSS ("SANFILIPPO JOHN B & SON"), GROW ("U S GLOBAL INVESTORS"), RFIL ("R F INDUSTRIES") |

In the 42 "first word agrees" cases, the difference is mostly FMP appending the
security class ("Warrants", "American Depositary Shares", "Unit", "9.00% Senior Notes
due 2027", "PFD DEP1/1000A"). SEC gives the issuer. There are also more renames
where SEC is newer: ENGN "enGene Therapeutics", OSRH "OSR Health", TWLV "Twelve Seas
Investment Co III", PPSI, where FMP has the truncated "Pioneer Pow".

## C. Admission: FMP quote `exchange` vs `usOk` / the price pool

A grid row carries `priceCoverage`. `"covered"` means a price-pool hit, which is
`usOk`. `"outside-bar-universe"` means no pool hit, so the row was admitted by FMP
quote's exchange being one of NASDAQ, NYSE or AMEX.

```
grid rows 881: admitted via FMP exchange 485 · via usOk 67 · field absent 329
grid symbols 875: FMP exchange only 485 · usOk 67 · unknown (pre-field blob) 323
```

**Pool size versus the grid.** Today the pool holds a priced row for only **95 of the
875 grid symbols**. The pool (841 fields) is sized to the site's own analysis universe (the manifest
has 866 symbols), not to the set of US-listed companies. A `usOk`-only admission test would
therefore **admit 95 and drop 780 (89%)** of the grid's symbols.

**SEC's exchange column on the two admitted sets:**

| Admitted by | SEC exchange |
|---|---|
| FMP exchange (485) | Nasdaq 338 · NYSE 105 · not in SEC's file 39 · OTC 2 · blank 1 |
| usOk (67) | NYSE 41 · Nasdaq 26. Every one is SEC-listed. |

No symbol moved between the two sets. None admitted via the FMP exchange is in the
pool now, and none admitted via `usOk` has left it.

**Rejected candidates.** These are candidates on the 31 complete dates that have no
grid row, so the exchange test turned them away:

```
candidates 1,061 · admitted 790 · REJECTED 271
SEC exchange of the rejected: not in SEC's file 165 · OTC 97 · Nasdaq 5 · blank 3 · NYSE 1
rejected but SEC-listed (6): EBF 2026-09-21 [NYSE], YYAI, NCEL, VFSWW, TLSA, PSNYW [Nasdaq]
rejected but in the pool now (usOk would admit): 0
```

The rejected list is mostly delisted or bankrupt names still in FMP's calendar,
such as NAVBQ, GOEVQ, HTGMQ, MDVLQ, FNCHQ, AFIIQ and BIORQ. The six that SEC places on
an exchange are FMP-side disagreements. The probe cannot say why, because FMP's
exchange value for them was never stored.

Using SEC's exchange column as the admission test gives this against FMP's decisions:

- It would keep **443 of the 485** FMP-exchange admissions and all 67 `usOk` admissions.
- It would lose the 39 not in SEC's file plus 3 OTC or blank.
- Among the rejected, it would add 6 and agree with FMP on the other 265.

## What could not be measured, and why

1. **FMP quote's `exchange` value.** It is held only in Next's per-instance fetch
   cache and never reaches Redis, so for any symbol it can only be inferred: admitted
   without a pool hit implies an allowed exchange, and rejected implies it was not
   one. For the same reason, the six SEC-listed rejections cannot be explained.
2. **The grid as shown for 28 of 60 dates.** There is no day-items blob for
   2026-07-26 to 2026-08-13 or for the weekends, and 2026-08-14 is only partly filled.
   A1, A2 and C therefore cover 32 dates. A3 covers all 60, using the candidate list
   rebuilt from the cached months. The probe did not establish why those dates are
   absent.
3. **How 329 grid rows (323 symbols) were admitted.** Their blobs predate
   `priceCoverage`. Current pool membership is reported instead, and it is not the
   same thing as pool membership when the row was written.
4. **SEC-only outside the manifest.** See the end of section A. There is no
   EDGAR-wide scan.
5. **Tiingo.** Not touched, by instruction.
