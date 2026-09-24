# Pickers: refused Market Caps and P/E, per reason (2026-09-24)

Relay B, #553 COWORK #19. Measured by relay `write-pickers-pe-census` over the 700-symbol Pickers universe, read-only. For A: each list is a live gap on the Pickers pages, grouped by the refusal `secValuation` gives.

## P/E, EPS and Payout: FMP today vs `secValuation` (post-#577)

| | FMP today | SEC |
|---|---|---|
| P/E rows | 629 | 481 |
| EPS rows | 699 | 538 |
| Payout rows | 699 | 260 (190 with DPS and EPS on the same basis and period end, 70 mixed) |

- **P/E refusals:** 107 ADS (ruled "–"), 57 losses, **51 `no-twelve-month-eps`**. The 51 include BRK.B, V, XOM, COST, NFLX, PEP, NOW, CRWD, BKNG and C.
- **Agreement:** where both exist (480), 408 are within 5%, 38 within 5–20%, and 34 are over 20% (11 of those 34 are notes or preferreds the presets already exclude).
- **EPS basis:** 484 are TTM with a derived Q4, 27 are TTM from four filed quarters, 27 are fiscal year (FY2025 ×23, FY2026 ×4).
- **Mixed payout:** almost every mixed case is TTM EPS to 2026-06-30 against FY2025 DPS. The Q4 dividend is not filed as a quarter.
- **Presets** (after the debt/preferred exclusion), today → on SEC:
  - **low-P/E ≤ 15:** 149 → 91. 46 ADS leave; 9 leave on `no-twelve-month-eps` (C, COF, WES, SUN, CQP, PAA, JEF, PNFP, MPLX); 8 leave on a higher SEC P/E or none (UBER, TPR, FOXA, WBS, CVE, AGI, PAAS, IAG); 5 join (CPB, HST, GFL, SOMN, IESC).
  - **cash-rich:** 16 → 12 (COF, BBVA, BUD, HSBC leave).
  - **cheap-tech:** 35 → 31 (WIT, UMC, WSE, INFY, KSPI leave; APH joins).
  - **high-dividend:** 43 → 43, unchanged.
  - **dividend-growth:** 50 → 50, unchanged.

## Market Cap refusals (`marketCap`)

### `no-cover-share-count` (51)

META, PLTR, SHOP, RIVN, HIMS, PATH, SPG, RL, UHS, ROKU, ABNB, RBLX, GTLB, LEN, HRL, ZM, SYM, STRC, TPG, STRD, SUN, WTS, TSN, RBRK, VIRT, TKO, ULS, STRF, TECK, SLF, RDDT, AMH, XYZ, MKC-V, OWL, OKTA, GFL, FWONK, FCNCA, BN, GIB, DKNG, CRWV, BNJ, NWS, MFC, MAIR, VNOM, VG, RCI, H

### `share-count-is-stale` (31)

BRK.B, V, MA, ACN, NKE, CMCSA, BLK, REGN, UPS, AFRM, CME, FOXA, AI, HSY, SATA, TRI, UHAL, RPRX, WMG, DDOG, GSAT, EMA, DKS, BF-B, COKE, CHTR, NXT, BCE, AUR, NTR, NWSA

### `ads-ratio-makes-shares-incomparable` (107)

ASML, NIO, BABA, XPEV, LI, VOD, SPOT, TAK, WDS, TTE, STM, SNY, SHG, WIT, UMC, TSEM, TM, SBS, RIO, VIK, VALE, TIGO, SQM, SKM, SAN, ZTO, SE, WSE, WF, UL, TS, SONY, MFG, BBVA, BAP, DB, PBR-A, AU, UBS, PHG, NU, MUFG, KB, INFY, GMAB, CX, BSBR, JBS, IHG, BSAC, BEP, PAC, NVMI, MT, GFI, FMX, PDD, HMC, GFS, BUD, BEPH, BBDO, BBD, AZN, ALC, NVS, KOF, KEP, JD, ICLR, IBN, HTHT, GSK, BIPI, AMX, AEG, AEFC, ABEV, MICC, LYG, IX, ESLT, EMBJ, EC, CIB, BTI, ARGX, NOK, KSPI, NVO, NMR, VIV, TCOM, SNN, SHEL, SAP, RYAAY, RELX, PUK, ONON, NWG, NGG, NBIS, HSBC, HMY, FMS, FER

## P/E refusals (`peRatio`)

### `no-twelve-month-eps` (51)

BRK.B, V, XOM, COST, NFLX, PEP, NOW, CRWD, BKNG, C, ONDS, SJM, BKR, AZO, KKR, COF, LEN, AAP, DPZ, LYB, HSY, SATA, RY, WES, VTRS, PS, UHAL, SUN, TD, WTRG, WMG, TECK, SN, QXO, CQP, FERG, PAA, JEF, ATHS, COKE, JHX, FWONK, CRWV, PNFP, MPLX, INIO, ALNY, MFC, MDB, MAIR, TPL

### `eps-is-zero-or-negative` (57)

INTC, SNOW, GILD, AVAV, RIVN, RKLB, PLUG, HIMS, IONQ, RIOT, LCID, FSLY, ZS, SEDG, TRMB, KHC, IP, BAX, APD, RBLX, GTLB, GPN, CE, FMC, CNC, BILL, AI, CHPT, CRL, STRC, STRD, SMMT, VIAV, SAIL, RBRK, STRF, LITE, PRAX, GSAT, DKNG, BBIO, AUR, APG, ELAN, NTRA, GKOS, WBD, VSAT, VNOM, TLN, OC, MP, MDGL, LYV, LFUS, GH, FROG

### `ads-ratio-makes-eps-incomparable` (107)

ASML, NIO, BABA, XPEV, LI, VOD, SPOT, TAK, WDS, TTE, STM, SNY, SHG, WIT, UMC, TSEM, TM, SBS, RIO, VIK, VALE, TIGO, SQM, SKM, SAN, ZTO, SE, WSE, WF, UL, TS, SONY, MFG, BBVA, BAP, DB, PBR-A, AU, UBS, PHG, NU, MUFG, KB, INFY, GMAB, CX, BSBR, JBS, IHG, BSAC, BEP, PAC, NVMI, MT, GFI, FMX, PDD, HMC, GFS, BUD, BEPH, BBDO, BBD, AZN, ALC, NVS, KOF, KEP, JD, ICLR, IBN, HTHT, GSK, BIPI, AMX, AEG, AEFC, ABEV, MICC, LYG, IX, ESLT, EMBJ, EC, CIB, BTI, ARGX, NOK, KSPI, NVO, NMR, VIV, TCOM, SNN, SHEL, SAP, RYAAY, RELX, PUK, ONON, NWG, NGG, NBIS, HSBC, HMY, FMS, FER

## P/E more than 20% from FMP's (both present)

34 names; 12 are notes or preferreds the fundamentals presets already exclude.

| Symbol | FMP P/E | SEC P/E |
|---|---|---|
| ONC | 26.56 | 829.55 |
| OMC | 40.37 | 188.72 |
| SYM | 456.05 | 873.8 |
| ALB | 239.21 | 436.42 |
| TPG | 36.83 | 67.06 |
| IAG | 10.05 | 17.45 |
| CVE | 11.96 | 20.19 |
| IESC | 28.29 | 14.2 |
| APH | 39.14 | 20.6 |
| DD | 284.61 | 154.02 |
| SOMN | 19.99 | 10.82 |
| WPM | 32.43 | 44.93 |
| KGC | 10.54 | 14.16 |
| CPB | 15.21 | 10.02 |
| FNV | 34.13 | 45.3 |
| AEM | 16.75 | 22.07 |
| VIRT | 6.7 | 8.81 |
| AGI | 12.53 | 16.42 |
| PAAS | 14.56 | 18.79 |
| RPRX | 24.03 | 30.83 |
| KNX | 250.26 | 319.86 |
| CCI | 28.43 | 35.65 |

Excluded notes/preferreds: AIZN, RZC, PFH, SOJE, SOJD, SOJC, UNMA, XELLL, EP-PC, BNJ, FITB-PM, TBB

