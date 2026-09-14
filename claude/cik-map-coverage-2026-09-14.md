# §D — the CIK map miss rate. It is 73.5%, and the cause is the denominator.

2026-09-14. Measured offline against the two committed datasets; no network
needed, and none available (see "How this was measured" below).

---

## 1. The number

| | symbols |
|---|---|
| `data/cik-map.json` | **695** |
| `data/static-profile.json` rows | **2,619** |
| in the profile with **no CIK** | **1,924 — 73.5%** |
| in the CIK map but not the profile | **0** |

The last row is the finding. `cik-map ⊂ static-profile`, exactly and with
nothing left over. The map is not a partial capture of a bigger list that
happened to fail on some symbols — it is a strict subset drawn against a
narrower denominator.

## 2. Why, and why it is not a data problem

`scripts/sec-probe.mjs` builds the map as *the universe ∩ SEC's
`company_tickers.json`*, where "the universe" is `pickersSymbolsKey` — the
**pickers** universe, 695 symbols.

But `secProvider.fetchForSymbol` is called for **any symbol whose stock page is
viewed**, and stock pages are not restricted to the pickers universe. So every
symbol outside it gets `[]` from the SEC leg, permanently, by construction.

The misses are not exotic. The first forty are ordinary US common stock:

    A, AADX, AAL, AAMI, AAOI, AAON, AAPG, AAT, AAUC, AB, ABCB, ABCL, ABG,
    ABM, ABSI, ABUS, ABVX, ABXL, ACA, ACAD, ACGL, ACHC, ACHR, ACI, ACIW,
    ACLS, ACM, ACMR, ACT, ACVA, AD, ADC, ADEA, ADMA, ADNT, ADPT, ADSK, ADT,
    ADUS, AEHR

Agilent, American Airlines, Autodesk, Arch Capital — all SEC filers with real
CIKs. Of the 1,924 misses only 12 carry a dash or dot (class shares like
`BRK-A`/`BRK-B`, preferreds like `CTA-PA`) and 23 are five-letter tickers where
an ADR or fund is plausible. **1,893 are plain four-letter-or-shorter US common
stock** — the shape that always has a CIK.

So this is not "SEC's file does not have them". It is "we never asked about
them".

## 3. The comment in the adapter encodes the wrong belief

`lib/server/news/secProvider.ts` said, beside the warning:

> the map is trimmed to the universe, so a symbol entering the universe is
> exactly when it needs regenerating, and this is the event that says so

That describes a map whose misses are universe-entrants — transient, self-
announcing, fixed by the next regeneration. The real misses are symbols that
were never in the pickers universe and never will be, and that have live stock
pages today. Regenerating against the same denominator fixes none of them.
Corrected in place.

## 4. AOS

`AOS` is the case that surfaced this: present in `static-profile.json`, absent
from `cik-map.json`. Its SEC leg is therefore **structurally zero** — not slow,
not flaky, zero on every render, and only ever visible as a per-request
`console.warn` nobody reads.

**What that does and does not explain.** It fully explains a missing SEC leg. It
does not by itself explain a zero-item *page*: that additionally needs Google
News to return nothing, which happens when `companyName` is empty
(`gnewsProvider` skips with `no usable company name`), plus the wires
contributing nothing for that symbol — which is the normal case, since one real
poll resolved 2 of 40 wire items to a universe symbol.

Worth noting for that chain: **`static-profile.json` carries `sector` and
`industry` only.** There is no committed fallback for company name, so a symbol
whose profile cache has expired can lose the Google News leg as well as the SEC
one. That is a second, separate gap and is not fixed here.

## 5. What to regenerate against

The generator's denominator should be the symbols that get **served**, not the
symbols that get **screened**. The widest list already committed to this repo is
`static-profile.json`'s 2,619 rows, and it is the same list the sector and art
paths already depend on.

Cost, extrapolated from the current file (14,782 bytes / 695 entries ≈ 21 b/entry):

| denominator | entries | file |
|---|---|---|
| pickers universe (today) | 695 | 14.8 KB |
| **static-profile rows** | **2,619** | **~54 KB** |
| SEC's full `company_tickers.json` | ~12,000 | ~249 KB |

~54 KB is a committed JSON imported at build time, in a repo that already
commits a 2,619-row profile snapshot. The full file is ~5× that for symbols the
site has no other data about.

**Recommendation: regenerate against the union of the pickers universe and
`static-profile.json`'s rows.** The union rather than the profile alone so that a
universe symbol missing from the snapshot cannot be dropped by the widening.

## 6. Status

- **Measured** — this document.
- **Generator fixed** — `scripts/sec-probe.mjs` now builds from that union and
  reports coverage against it.
- **Adapter comment corrected** — it no longer claims universe entry is the
  refresh trigger.
- **Made visible** — `/cache-health` carries a CIK coverage line beside the
  static-profile one. Both are committed JSON, so it costs no request.
- **NOT regenerated.** That needs `sec.gov`, which the agent sandbox cannot
  reach (see below). It is one relay dispatch — task `sec`, `symbols=cik-map` —
  and it is an owner-side step.

## How this was measured

Offline, from the two committed JSON files. Neither `data.sec.gov` nor
`www.sec.gov` is reachable from the agent sandbox (both return `000` — no
connection — with a declared User-Agent), and there are no Upstash credentials
here, so neither SEC's file nor the live universe could be consulted directly.

That is also why the comparison uses `static-profile.json` as the wide list
rather than SEC's ~12,000-row file: it is the widest symbol list that exists
*inside the repo*, so the measurement is reproducible by anyone with a checkout
and no credentials at all.
