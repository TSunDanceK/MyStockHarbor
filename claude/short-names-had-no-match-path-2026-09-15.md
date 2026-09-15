# 55 symbols had no company-name match path at all

2026-09-15. Inherited, not a regression from #460 — the old rule carried the
identical `length >= 4` guard on the cleaned name, so these were already dark.

---

## Step 1 — the traffic rate, which is not 2.1%

The 55 are 2.1% of the committed snapshot, but **the snapshot is not what gets
viewed**, so that number should not be quoted. The 700-symbol picker universe
lives in Redis and is not in the repo. The proxies that *are*:

| population | in the dark set | rate | which |
|---|---|---|---|
| `PRESET_UNIVERSE` (guaranteed pickers slots) | **1 / 100** | **1.0%** | KLAC |
| `lib/curatedSymbols.ts` | **4 / 161** | **2.5%** | CSX, HPQ, KLAC, RTX |
| symbols with published insight posts | 0 / 52 | 0% | — |
| the whole committed snapshot | 55 / 2,592 | 2.1% | — |

**So the honest answer is roughly 1–2.5% of anything resembling traffic**, and
the true picker-universe figure is still unmeasured here. Small — but the
affected names are 3M, HP, Dow, CSX, RTX, KKR, PVH, EQT, F5, Box, XPO, TPG, and
the failure is total rather than partial: MMM fetched 88 items and rendered 2,
both carrying a literal `(MMM)`.

## Step 2 — the groups, measured rather than assumed

Classifying by what evidence each name actually has:

| group | count | examples |
|---|---|---|
| **the name IS the ticker** | **42** | CSX, RTX, KKR, LKQ, EQT, XPO, PVH, DOW, BOX, FOX, ADT, APA, BCE, CDW, CRH, ITT, KBR, NVR, PPL, PTC, QXO, RH, SLM, TPG, UDR, UGI, WEX, WPP, XP … |
| **short but different from the ticker** | **13** | 3M/MMM, HP/HPQ, F5/FFIV, KLA/KLAC, CGI/GIB, RPC/RES, V2X/VVX, AAR/AIR, AXT/AXTI, MKS/MKSI, VSE/VSEC, FOX/FOXA, AES |
| punctuated two-letter (VFC, T) | 0 in the 55 | they are dark for a *different* reason — see §3 |

Two corrections to my own first pass, both from re-reading the output:

- **AES was mis-grouped.** I classified with `getCleanCompanyName`, which keeps
  a leading "the" — `"the aes"`. `companyNameVariants` strips it, leaving
  `"aes"`, which *is* the ticker. It belongs in group 1.
- **The "punctuated" group is empty within the 55.** VFC and T are not in the
  list because they produced a *bad* needle rather than none, which is §3.

## The fix: one rule, not three

The brief anticipated three answers. The measurement says **one shape covers all
55**, because both groups are the same thing — *the name is too short to be a
substring needle* — and differ only in whether it happens to equal the ticker.

`anchoredNameSignal` builds a **word-anchored, case-sensitive** pattern and
tests it against the headline's **original case**, not the lowercased text every
other rule uses.

**The guard is not lowered.** `"rh"` as a substring still matches `"growth"`;
that is why the substring rule keeps its four-character minimum. What changes is
the *kind* of evidence: anchored rather than contained.

### Casing is the discriminator, and it comes from the data

The company's own name says which shape to demand — no list:

```
CSX  "CSX Corporation"  ->  \bCSX\b   caps required
DOW  "Dow Inc."         ->  \bDow\b   capitalised required
MMM  "3M Company"       ->  \b3M\b
```

```
ok  CSX  CSX Corporation reports record intermodal volume   -> match
ok  CSX  the csx line was closed for maintenance            -> no match
ok  DOW  Dow Inc. beats on packaging demand                 -> match
ok  DOW  shares were flat as the market closed down         -> no match
ok  BOX  Box, Inc. raises subscription outlook              -> match
ok  BOX  he opened the box and found nothing                -> no match
ok  RH   RH reports weaker demand for luxury furnishings    -> match
ok  RH   growth slowed through the quarter                  -> no match
```

`COMMON_WORDS` in `companyName.ts` was the wrong instrument: it is a **query**
-quality list of business words (american, capital, energy) and contains neither
box nor dow nor fox.

### Strictly additive

Reached **only** when `companyNameVariants` returns nothing, so no symbol that
matches today can change behaviour. Asserted structurally, and FAST/AOS/SNA are
re-checked unmoved.

### The residual, stated rather than hidden

Casing cannot separate **"Dow Inc." from "Dow Jones"**, or **"Box, Inc." from
"Box Office"**. Those false positives remain. They are a smaller error than the
present one — every item discarded, a blank page — and ranking, dedup and the
churn filter all still apply downstream. Worth revisiting with a measurement;
not worth blocking the 42 clean cases on.

## Step 3 — the two checker defects

**(a) The assertion claimed more than it tested.** Its name said "no usable
variant"; its body only checked `.every(v => v.length >= 4)`, which an
initials-only name satisfies — so it passed against code with the property *and*
without it. It now asserts the list is **empty**, with the real committed rows
as fixtures instead of the invented `A.B.`:

```
VFC  "V.F. Corporation Common Stock"  ->  was ["v. f"]   now []
T    "AT&T Inc."                      ->  was ["at t"]   now []
```

**(b) Both bad needles are fixed by the same change: the guard now counts
ALPHANUMERICS, not characters.** `"v. f"` is four characters and two letters;
`"at t"` is four and three. This is the measure
`assessCompanyName` already uses on the query side (`letters.length <= 2`), so
the two sides now judge a name the same way instead of one counting letters and
the other counting punctuation. **It is a tightening** — every variant that
passed on real alphanumerics still passes.

VFC then reaches its own headlines through the anchored path, because the
punctuated token is carried alongside the alphanumeric one: `\bVF\b` does not
match the text `"V.F."` — the letters are not adjacent there.

```
PASS  VFC  V.F. Corporation Reports Second Quarter Results
drop  VFC  Roe v. Ford settled out of court
PASS  T    AT&T adds 400,000 wireless subscribers
drop  T    what the market did today, flat tires and all
```

## Mutation coverage — 10/10

Guard back to characters; guard lowered rather than retargeted; fallback
removed; fallback no longer gated on `!variants.length`; anchored match run on
the lowercased text; uppercase requirement dropped; word boundaries removed;
upper bound removed; punctuated form dropped; one-character names admitted.

Two needed sharper probes first, and both are the same lesson as (a):

- **Word boundaries removed** survived until a probe used an uppercase substring
  inside a longer all-caps token — `NATO` contains `AT`, `OVERHAUL` contains
  `RH`. Case-sensitivity alone was carrying the earlier probes.
- **One-character names** survived until a fixture actually had one
  (`"X Corporation"`).

And one assertion I wrote in this pass **failed correctly and was wrong**: "a
name long enough for a variant gets NO anchored needle". `"A.O. Smith"` has
usable variants yet its first token is two alphanumerics, so the builder does
return a needle. That is not a defect — the fallback-only property lives at the
**call site**, which is asserted separately. The assertion was claiming a
guarantee the function does not make.

## Not verified here

The acceptance criterion needs **`cache=MISS` renders** on the affected symbols,
which this sandbox cannot reach. What is verified is the predicate against real
headline spellings, the 55/55 coverage, and that the long names are unmoved.
**The 45-day window was not touched.**
