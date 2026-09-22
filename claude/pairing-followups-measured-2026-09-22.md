# Pairing follow-ups, measured — nothing adopted (review of #515)

Relay [35772820498](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/35772820498),
task `write-pairing-followups` (`scripts/pairing-followups-census.mjs`, reads only).

## T. Same-day tie-break — every period it would flip

Rule measured: when the pick was filed the **same day** as its period's 10-Q/10-K
**and** an earlier original 8-K 2.02 in the window sits beyond the filer's early cut,
keep the earlier one (the latest such earlier filing). Early cut = the filer's own
midpoint for the 84 pattern filers; a filer with no pattern has no cut, so any earlier
original qualifies.

Paired periods 8,962; picks filed the same day as their 10-Q/10-K: 3,749.
**Flips: 76** — 25 on pattern filers, 51 on filers without one.

Format: `symbol period  pick <date> <accession>  ->  keep <date> <accession>  lags keep vs pick`.

### Filers with an early pattern (25)
```
ADM    2024-09-30  pick 2024-11-18 0000007084-24-000056  ->  keep 2024-11-04 0000007084-24-000031  35d vs 49d  cut 32d
APOS   2023-12-31  pick 2024-02-27 0001858681-24-000029  ->  keep 2024-02-08 0001858681-24-000005  39d vs 58d  cut 18.5d
ATHS   2026-06-30  pick 2026-08-10 0001527469-26-000057  ->  keep 2026-08-05 0001193125-26-333977  36d vs 41d  cut 21.5d
ATHS   2026-03-31  pick 2026-05-07 0001527469-26-000030  ->  keep 2026-05-06 0001527469-26-000024  36d vs 37d  cut 21.5d
ATHS   2025-09-30  pick 2025-11-10 0001527469-25-000080  ->  keep 2025-11-04 0001527469-25-000073  35d vs 41d  cut 21.5d
ATHS   2025-06-30  pick 2025-08-07 0001527469-25-000059  ->  keep 2025-08-05 0001527469-25-000053  36d vs 38d  cut 21.5d
ATHS   2025-03-31  pick 2025-05-07 0001527469-25-000034  ->  keep 2025-05-02 0001527469-25-000029  32d vs 37d  cut 21.5d
ATHS   2024-09-30  pick 2024-11-06 0001527469-24-000092  ->  keep 2024-11-05 0001527469-24-000086  36d vs 37d  cut 21.5d
ATHS   2024-03-31  pick 2024-05-07 0001527469-24-000037  ->  keep 2024-05-02 0001527469-24-000031  32d vs 37d  cut 21.5d
ATHS   2023-12-31  pick 2024-02-27 0001527469-24-000019  ->  keep 2024-02-12 0001527469-24-000012  43d vs 58d  cut 21.5d
ATHS   2023-09-30  pick 2023-11-07 0001527469-23-000074  ->  keep 2023-11-01 0001527469-23-000066  32d vs 38d  cut 21.5d
CNC    2024-06-30  pick 2024-07-25 0001071739-24-000158  ->  keep 2024-07-23 0001071739-24-000151  23d vs 25d  cut 19.5d
CORT   2020-12-31  pick 2021-02-23 0001628280-21-002824  ->  keep 2021-02-08 0001628280-21-001612  39d vs 54d  cut 29.5d
FIS    2024-03-31  pick 2024-05-07 0001193125-24-133216  ->  keep 2024-05-06 0001136893-24-000060  36d vs 37d  cut 32.5d
GMED   2022-12-31  pick 2023-02-21 0001562762-23-000046  ->  keep 2023-02-09 0001193125-23-029211  40d vs 52d  cut 24d
HALO   2025-12-31  pick 2026-02-17 0001159036-26-000023  ->  keep 2026-01-28 0001159036-26-000011  28d vs 48d  cut 24d
HL     2025-12-31  pick 2026-02-17 0001193125-26-054862  ->  keep 2026-01-26 0001437749-26-002003  26d vs 48d  cut 25.5d
LITE   2024-12-28  pick 2025-02-06 0001628280-25-004265  ->  keep 2025-02-03 0001193125-25-019371  37d vs 40d  cut 37d
LUV    2023-12-31  pick 2024-02-06 0000092380-24-000026  ->  keep 2024-01-25 0000092380-24-000003  25d vs 37d  cut 20.5d
MPC    2020-12-31  pick 2021-02-26 0001510295-21-000026  ->  keep 2021-02-02 0001510295-21-000019  33d vs 57d  cut 27d
NCPL   2023-04-30  pick 2023-07-26 0001903596-23-000563  ->  keep 2023-07-06 0001903596-23-000522  67d vs 87d  cut 43.5d
NCPLW  2023-04-30  pick 2023-07-26 0001903596-23-000563  ->  keep 2023-07-06 0001903596-23-000522  67d vs 87d  cut 43.5d
ONDS   2022-12-31  pick 2023-03-14 0001213900-23-019741  ->  keep 2023-02-14 0001213900-23-011133  45d vs 73d  cut 29d
PRAX   2024-12-31  pick 2025-02-28 0001689548-25-000037  ->  keep 2025-01-29 0001689548-25-000021  29d vs 59d  cut 25.5d
TPR    2023-07-01  pick 2023-08-17 0001157523-23-001344  ->  keep 2023-08-10 0001140361-23-038946  40d vs 47d  cut 36.5d
```

### Filers without a pattern (51) — no cut, any earlier original qualifies
```
AAP    2025-07-12  pick 2025-08-14 0001158449-25-000268  ->  keep 2025-07-24 0001193125-25-163855  12d vs 33d
APD    2024-12-31  pick 2025-02-06 0000002969-25-000012  ->  keep 2025-01-14 0001193125-25-006210  14d vs 37d
APG    2025-12-31  pick 2026-02-25 0001628280-26-011397  ->  keep 2026-02-17 0001628280-26-008320  48d vs 56d
APG    2024-12-31  pick 2025-02-26 0001628280-25-007968  ->  keep 2025-02-19 0001193125-25-029131  50d vs 57d
APG    2024-03-31  pick 2024-05-02 0001628280-24-019803  ->  keep 2024-04-15 0001193125-24-095538  15d vs 32d
APG    2021-12-31  pick 2022-03-01 0000950170-22-002419  ->  keep 2022-02-23 0001193125-22-049404  54d vs 60d
APG    2020-12-31  pick 2021-03-24 0001193125-21-091941  ->  keep 2021-02-16 0001193125-21-043161  47d vs 83d
BA     2024-09-30  pick 2024-10-23 0000012927-24-000079  ->  keep 2024-10-11 0000012927-24-000067  11d vs 23d
CAH    2023-12-31  pick 2024-02-01 0001628280-24-002805  ->  keep 2024-01-09 0000721371-24-000005  9d vs 32d
CLX    2023-09-30  pick 2023-11-01 0000021076-23-000046  ->  keep 2023-10-04 0001206774-23-001174  4d vs 32d
CNA    2024-09-30  pick 2024-11-04 0000021175-24-000093  ->  keep 2024-10-21 0000021175-24-000082  21d vs 35d
CRL    2025-12-27  pick 2026-02-18 0001100682-26-000020  ->  keep 2026-01-13 0001628280-26-001905  17d vs 53d
CRWD   2025-04-30  pick 2025-06-03 0001535527-25-000017  ->  keep 2025-05-07 0001104659-25-045244  7d vs 34d
DAR    2023-09-30  pick 2023-11-07 0000916540-23-000035  ->  keep 2023-10-26 0000916540-23-000032  26d vs 38d
DOV    2024-09-30  pick 2024-10-24 0000029905-24-000044  ->  keep 2024-10-10 0000029905-24-000037  10d vs 24d
DRS    2022-12-31  pick 2023-03-28 0001628280-23-009346  ->  keep 2023-03-10 0001628280-23-007451  69d vs 87d
ED     2020-12-31  pick 2021-02-18 0001047862-21-000051  ->  keep 2021-01-21 0001047862-21-000028  21d vs 49d
ELV    2025-03-31  pick 2025-04-22 0001156039-25-000056  ->  keep 2025-04-17 0001156039-25-000051  17d vs 22d
ENPH   2026-03-31  pick 2026-04-28 0001463101-26-000046  ->  keep 2026-04-06 0001463101-26-000037  6d vs 28d
FDX    2024-08-31  pick 2024-09-19 0000950170-24-108098  ->  keep 2024-09-03 0000950170-24-102826  3d vs 19d
FE     2020-12-31  pick 2021-02-18 0001031296-21-000018  ->  keep 2021-02-16 0001031296-21-000009  47d vs 49d
FTV    2025-06-27  pick 2025-07-30 0001659166-25-000119  ->  keep 2025-06-30 0001659166-25-000104  3d vs 33d
FWONK  2025-06-30  pick 2025-08-07 0001560385-25-000018  ->  keep 2025-07-21 0001104659-25-069182  21d vs 38d
GBX    2023-08-31  pick 2023-10-25 0001193125-23-262210  ->  keep 2023-09-21 0001193125-23-239025  21d vs 55d
GPN    2025-03-31  pick 2025-05-06 0001123360-25-000028  ->  keep 2025-04-17 0001104659-25-035771  17d vs 36d
GTLB   2026-04-30  pick 2026-06-02 0001628280-26-039805  ->  keep 2026-05-11 0001653482-26-000095  11d vs 33d
H      2023-12-31  pick 2024-02-23 0001468174-24-000011  ->  keep 2024-02-14 0001193125-24-036816  45d vs 54d
HPQ    2026-01-31  pick 2026-02-24 0000047217-26-000009  ->  keep 2026-02-03 0001140361-26-003514  3d vs 24d
HSIC   2024-12-28  pick 2025-02-25 0001000228-25-000010  ->  keep 2025-01-29 0001193125-25-015654  32d vs 59d
HSY    2026-03-29  pick 2026-04-30 0001628280-26-028569  ->  keep 2026-03-31 0001628280-26-022272  2d vs 32d
IBM    2026-06-30  pick 2026-07-22 0000051143-26-000077  ->  keep 2026-07-14 0000051143-26-000070  14d vs 22d
INTC   2020-12-26  pick 2021-01-21 0000050863-21-000009  ->  keep 2021-01-14 0001193125-21-009142  19d vs 26d
IONQ   2025-12-31  pick 2026-02-25 0001193125-26-071520  ->  keep 2026-01-26 0001193125-26-021616  26d vs 56d
IONQ   2022-12-31  pick 2023-03-30 0001193125-23-085543  ->  keep 2023-03-06 0001193125-23-060754  65d vs 89d
ITT    2025-03-29  pick 2025-05-01 0000216228-25-000029  ->  keep 2025-04-10 0000216228-25-000022  12d vs 33d
JCI    2024-06-30  pick 2024-07-31 0000833444-24-000049  ->  keep 2024-07-23 0000833444-24-000044  23d vs 31d
KVUE   2025-06-29  pick 2025-08-07 0001944048-25-000174  ->  keep 2025-07-14 0000950157-25-000569  15d vs 39d
MDGL   2024-12-31  pick 2025-02-26 0001193125-25-035787  ->  keep 2025-01-13 0001193125-25-004939  13d vs 57d
MPLX   2026-03-31  pick 2026-05-05 0001552000-26-000023  ->  keep 2026-04-13 0001552000-26-000017  13d vs 35d
NSC    2024-03-31  pick 2024-04-24 0001552781-24-000243  ->  keep 2024-04-09 0001193125-24-090246  9d vs 24d
OVV    2020-12-31  pick 2021-02-18 0001193125-21-047183  ->  keep 2021-01-05 0001564590-21-000245  5d vs 49d
Q      2025-12-31  pick 2026-02-26 0002058873-26-000007  ->  keep 2026-01-16 0002058873-26-000002  16d vs 57d
SYY    2026-03-28  pick 2026-04-28 0000096021-26-000019  ->  keep 2026-03-30 0000950142-26-000899  2d vs 31d
TDG    2026-03-28  pick 2026-05-05 0001260221-26-000039  ->  keep 2026-04-14 0001260221-26-000033  17d vs 38d
TKO    2023-09-30  pick 2023-11-07 0001193125-23-272432  ->  keep 2023-11-01 0001193125-23-268188  32d vs 38d
TRU    2022-12-31  pick 2023-02-14 0001552033-23-000014  ->  keep 2023-02-10 0001552033-23-000009  41d vs 45d
VG     2025-12-31  pick 2026-03-02 0002007855-26-000015  ->  keep 2026-01-12 0002007855-26-000002  12d vs 61d
VG     2025-09-30  pick 2025-11-10 0002007855-25-000068  ->  keep 2025-10-06 0002007855-25-000059  6d vs 41d
VLO    2025-03-31  pick 2025-04-24 0001035002-25-000016  ->  keep 2025-04-16 0001193125-25-082159  16d vs 24d
WAB    2024-12-31  pick 2025-02-12 0001628280-25-005014  ->  keep 2025-01-14 0001140361-25-001006  14d vs 43d
WMG    2026-06-30  pick 2026-08-05 0001319161-26-000031  ->  keep 2026-08-03 0001193125-26-329621  34d vs 36d
```

**Reading it, before the hand check:** many of the no-pattern flips run in the WRONG
direction. BA 2024-10-11 was the Q3 pre-announcement, and 10-23 the release. IBM
2026-07-14 is not IBM's release. The 2–7-day "keeps" (HSY, SYY, FTV, FDX, CLX, ENPH,
CRWD) are far too early to be results. That is the cost of "no cut" for a filer with no
pattern. The flips most likely to be real reverse errors are the ones where the kept
filing sits at the filer's usual lag: LUV, H, DAR, TKO, TRU, WMG, FE, JCI, and
ATHS/APOS within a few days of the pick.

## G. General current-period rule — scored on history (optional)

Rule: a current-period 2.02 whose lag is below half the filer's prior median paired
results lag does not count. It was scored causally on 7,045 historical paired results
releases. **It would have wrongly rejected 97.**

Caveat: most of the 97 are one or two days under a threshold inflated by annual
periods early in a filer's history (e.g. AEP 27d < 27.5d, FIX, FTI, KDP, NEM, EFX, VRT,
UHS, CSGP, GPC, OMC, NDSN, SELF, MKC-V, EME). The clear misses are ALNY 2024-Q4 (13d),
RGLD ×4 (8–14d), SLE ×2 (2–3d), VG ×2 (8–9d) and DAR ×3. The full list is in the relay
log. On this evidence the rule is not safe as stated.

## F. Why 48 of 76 FPIs are too thin to score

| reason | n | symbols |
|---|---|---|
| **Annual-only fact set** (20-F filers: ≤ 7 year ends, 365d step) | 33 | AGI ARGX ASML AU BBVA BTI CCEP EGO ESLT FER GFI HBM HMY HSBC IHG INFY KGC KOF LYG MFC NBIS NVO NWG RCI RELX RYAAY SAN SONY SQM TAK VOD ZTO JBS* |
| **Genuinely short history** | 3 | BSAC (0 ends), MICC (1), WSHP (2) |
| **6-K match gap** (quarterly periods on file; 6-K reportDates do not land on them) | 8 | BMO BNS RY TD (Canadian banks, fiscal Oct), STM, TTE, VIK, SN |
| **Semiannual reporters** | 4 | DB GMAB TRI VALE |

*JBS has a 183-day step on 5 ends and was counted with the short or annual-only group.

So most of them (33) are thin because the stored fact set holds only annual periods;
their history is long in years. Only 3 are genuinely short. The 8 match-gap filers
are the one group a better 6-K rule could recover. Nothing built.
