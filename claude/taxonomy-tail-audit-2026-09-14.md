# Audit of the ≤3 band — what is noise, what is real, and two findings that are neither

**Date:** 2026-09-14
**Scope:** 16 labels, 30 symbols, 1.1% of coverage.
**Status:** REPORT ONLY. Nothing folded, nothing edited.

Done now because it is far cheaper than after the art map, SIC table and screener
filter are all keyed on these strings — and because the snapshot is frozen, so
whatever is wrong in it is permanent.

## 1. Genuinely distinct — leave alone (4 labels, 12 symbols)

| Label | Symbols | Why it is real |
|---|---|---|
| `Silver` | AG, AYA, EXK | Sits in a coherent commodity family: Gold (28), Other Precious Metals (11), Copper (5), Aluminum (4). |
| `Uranium` | CCJ, LEU, NXE | Same family. Cameco is not a rounding error. |
| `Industrial - Pollution & Treatment Controls` | CECO, PCT, VLTO | Veralto is a $20bn+ spin-off. Small label, real category. |
| **`Home Improvement`** | FND, **HD, LOW** | **Home Depot and Lowe's.** A 3-symbol label holding two of the largest US retailers. Size is not a proxy for significance, and any rule that folds by count alone would have folded this. |

`Home Improvement` is the strongest argument against a purely size-based floor:
by symbol count it is in the smallest decile; by market cap it is one of the
largest categories on the site.

## 2. Near-duplicate or catch-all — candidates to fold (9 labels, 13 symbols)

| Label | Symbols | Duplicates / belongs with |
|---|---|---|
| `Oil & Gas Energy` | SPH | Catch-all beside six real Oil & Gas labels (E&P 41, Midstream 37, Equipment & Services 27, Refining 14, Integrated 14, Drilling 9). |
| `Software - Services` | CART, IOND, VRSK | `Software - Application` (121) / `Information Technology Services` (42). |
| `Medical - Specialties` | ALC, STE | Alcon and Steris are devices/instruments — `Medical - Devices` (38), `Medical - Instruments & Supplies` (25). |
| `Medical - Equipment & Services` | MMED | **Misfiled.** MindMed is a clinical-stage pharma, not equipment. |
| `Industrial - Specialties` | AZZ, CSW | Catch-all. |
| `Manufacturing - Miscellaneous` | PRLB | Catch-all by name. |
| `Manufacturing - Textiles` | AIN | Singleton; Albany International is arguably machinery. |
| `Real Estate - Diversified` | IRS | `Real Estate - Services` (13), `REIT - Diversified` (10). |
| `Beverages - Wineries & Distilleries` | BF-B | `Beverages - Alcoholic` (8). Brown-Forman is a distiller — the label is *accurate*, it is the split that is arbitrary. |

**Folding judgement is not uniform here.** `Medical - Equipment & Services` is a
misfiling to correct; `Beverages - Wineries & Distilleries` is an accurate label
that merely duplicates a broader one. Those want different treatment.

## 3. TWO FINDINGS THAT ARE NOT TAXONOMY NOISE

### 3a. LION is on the wrong SECTOR page today

`Media & Entertainment` (1 symbol, **LION** — Lionsgate) is filed under sector
**Technology**. Every other media-adjacent industry is under Communication
Services:

```
  23  Entertainment        -> Communication Services
  10  Advertising Agencies -> Communication Services
   6  Publishing           -> Communication Services
   4  Broadcasting         -> Communication Services
   1  Media & Entertainment -> Technology      <-- the only one
```

**Sector is the URL slug, the nav and the sitemap.** This is not a cosmetic label
problem: Lionsgate renders on `/sector/technology` and is absent from
`/sector/communication-services`. An industry-level alias map does not fix it,
because the error is in the sector column.

It is also the one case where the 1:1 industry→sector property the check asserts
is *technically* satisfied while being substantively wrong — the mapping is
unique, it is just unique to the wrong sector.

### 3b. Thirteen snapshot rows are not operating companies

Eleven preferred shares, one warrant, one unit — all carrying sector and industry
labels as though they were companies:

```
CCXIW (warrant)  NOVTU (unit)
CMS-PB  CTA-PA  CTA-PB  EP-PC  FITB-PA  FITB-PM
MER-PK  OAK-PA  OAK-PB  SEAL-PB  TRTN-PC
```

This changes the reading of the bare `Banks` label. Its two symbols are **ITUB**
(Itaú Unibanco, a genuine foreign bank) and **MER-PK** (a Merrill Lynch preferred).
So the label the SIC-mapping argument turns on contains **one real company and one
security**.

That strengthens the case rather than weakening it: SIC 6022 "State Commercial
Banks" would have to target a label whose membership is partly not banks at all,
with no way to detect the error downstream.

> ### CORRECTION, 2026-09-14 — this was inverted, and the inversion mattered
>
> I wrote that "a preferred share has no `companyfacts` of its own, so anything
> keyed per symbol will find nothing for them and report nothing about it."
> **That is wrong, and wrong in the most consequential direction: I called a live
> correctness bug a no-op.**
>
> Preferreds resolve to the **parent's CIK**. Verified against the committed
> ticker map through the shipped parser:
>
> ```
> MER-PK -> 0000070858  = BAC's CIK      MKC-V -> 0000063754  = MKC
> EP-PC  -> 0001506307  = KMI            TBB   -> 0000732717  = T
> PFH    -> 0001137774  = PRU            UNMA  -> 0000005513  = UNM
> EMBJ   -> 0001355444  = EMBRAER
> ```
>
> So step 3 does **not** find nothing. It finds the **parent's complete
> financials** and stores them under the preferred's ticker.
> `/stock/MER-PK/earnings` would render Bank of America's revenue, EPS, margins
> and cash flow — a full page, plausible, entirely wrong. That is the worst
> failure class in this project, and it is the same shape as every other one
> found today: it renders as a number, not an error.
>
> Already documented in `state-2026-09-13.md` (not mirrored into this repo),
> section "New, and it is a correctness bug rather than a cost one", naming the
> same seven symbols. The specified fix is a **preferred/baby-bond filter at
> universe admission**, which also removes the 424B2 filing-noise problem in one
> rule — MER-PK alone filed 143 rows in four days.
>
> Carried into the step-3 brief as a **precondition**, not a follow-up:
> `claude/BRIEF-step3-extraction-and-retention-2026-09-14.md`.

(18 rows carry `.` or `-` overall — `BF-B BRK-A BRK-B CIG-C MKC-V MOG-A PBR-A`
plus the 11 preferreds. The symbol-spelling hazard is already recorded in
`claude/symbol-spelling-split-2026-09-12.md`.)

## 4. What this says about the fold

- **Do not fold by size.** `Home Improvement` (3 symbols, HD + LOW) and
  `Manufacturing - Miscellaneous` (1 symbol, a catch-all by name) sit in the same
  band and want opposite treatment.
- **The signature the review named holds** — a one-symbol label that
  near-duplicates a much larger one — but it identifies *candidates*, and only
  the symbol confirms it. Four of sixteen survived inspection.
- **Two of the sixteen are not fold candidates at all**: LION is a sector error
  and the preferred/warrant rows are a universe-composition question.
