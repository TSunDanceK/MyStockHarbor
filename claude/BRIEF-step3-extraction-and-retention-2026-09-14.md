# Step 3 — extraction and retention (brief)

> **Provenance.** The authoritative document is the Claude Project copy of the
> same name. This repo mirror was **written from the owner's summary of that
> brief, not copied from the original**, which is Project-only and not visible
> from a coding session. Where the two differ, **the Project copy wins** and this
> file should be re-synced from it. Mirrored per `CLAUDE.md`'s "Where the
> automation docs live".

Source of the tag chains: `claude/hide-list-verdict-2026-09-13.md` §1 (already
in this repo). Cash-flow finding: the same document, §2.

## Owner decisions

| | |
|---|---|
| **Retention** | **8 quarters** and **5 fiscal years** per symbol. |
| **Why 8, not 4** | YoY on the newest quarter needs its year-ago comparator, and 8 gives *every* row in the recent-quarters table one. |
| **Cost** | ~9 KB per symbol against a ~20 KB budget. |
| **Annual series** | **APPEND-ONLY.** Historical periods are never deleted. |
| **Storage** | Redis, per-symbol keys, already registered in `symbolEviction.PER_SYMBOL_KEYS`. |

## The four traps

All measured on real responses. **All four render as plausible numbers rather
than errors** — which is the property that decides how they must be tested.

### 1. Cash flow is year-to-date cumulative

Every quarter except Q1 needs differencing, **not just Q4**. A Q3 figure read
straight is ~3× too large and looks entirely reasonable on the page.

```
Q1 = the 3-month value as filed
Q2 = 6-month  − 3-month
Q3 = 9-month  − 6-month
Q4 = 12-month − 9-month
```

`hide-list-verdict` §2 records the measurement: `NetCashProvidedByUsedInOperatingActivities`,
`PaymentsToAcquirePropertyPlantAndEquipment` and `ShareBasedCompensation` each come
back with only 2–3 quarterly periods in an 8-quarter window, for all five probe
symbols. A uniform result across five unrelated filers is not five coincidences.

It also names the assertion: **a quarterly operating cash flow that exceeds its
own annual figure is arithmetically impossible and trivially checkable.**

### 2. The tag chain resolves PER PERIOD, not per symbol

Resolve once per symbol and AAPL's revenue series goes **empty before 2018**
instead of falling through to the legacy `Revenues` tag.

Chain **order** decides the ASC 606 overlap. `Revenues` is legacy — AAPL's last
is 2018-09-29, MU's 2018-08-30, PLAB's 2018-10-31 — so it must sit *below*
`RevenueFromContractWithCustomerExcludingAssessedTax`, never above, or every
large filer renders 2018 revenue as current.

**Never sum two chain entries for one period.** First hit wins.

### 3. A period can carry two values — original and restatement

Keyed by accession. **Newest accession wins.**

This matters *more* under append-only retention, because nothing revisits an
archived year otherwise. A restatement landing after a year is archived must
still overwrite it.

### 4. Fiscal years are not calendar years

Measured across five probe symbols: **31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec.**

**Q4 is never filed** and must be derived as FY minus 9M.

## Before any extraction code: pin the stored field list

There is **no conditional check on `companyfacts`** — `Last-Modified` and `ETag`
both absent, measured 23 of 23 (`claude/sec-reread-no-cheap-check-2026-09-13.md`).
So a field added later **cannot be backfilled cheaply**: it means re-reading the
whole universe at ~150 KB wire each.

The asymmetry is therefore stark and one-sided:

- storing an unused field costs **bytes**;
- omitting a needed field costs **a full universe re-fetch**.

**Err wide.** Proposal: `claude/step3-stored-field-list-2026-09-14.md`.

## PRECONDITION — extraction must not run on a shared CIK

**Not a follow-up. Extraction cannot ship without this.**

Preferreds and baby bonds resolve to the **parent's CIK**, so extraction keyed on
ticker stores the parent's financials under the derivative's symbol.
`/stock/MER-PK/earnings` renders Bank of America's revenue, EPS, margins and cash
flow: a complete, plausible, entirely wrong page. `state-2026-09-13.md` documents
this and specifies a **preferred/baby-bond filter at universe admission**, which
removes the 424B2 filing-noise problem in the same rule — MER-PK alone filed 143
rows in four days.

### The detector is data-driven, and measured

Not a pattern match on the ticker: **a symbol whose CIK is shared with another
symbol in the manifest.** Measured over the frozen snapshot through the shipped
`parseTickerFile`:

```
54 groups, 132 symbols of 2,619 (5.0% of the universe)
```

It catches all seven named symbols, the warrant and the unit rows, and 47 groups
nobody had listed.

### THE DISPOSITION RULE — decided 2026-09-14

**The test is not share-class-versus-preferred. It is: does this security's
economics match the issuer's financial statements?**

That reframing is what makes the rule decidable. "Is it a share class?" is a
taxonomy question with fuzzy edges; "do the issuer's statements describe this
security's economics?" has one answer per security.

Three branches off the shared-CIK detector:

**1 — Shared CIK, DIFFERENT security type** (preferred, baby bond, warrant, unit)

- **Out of the analysis universe.** No pickers row, no manifest entry, no
  extraction. This also removes the 424B2 filing noise in the same rule —
  MER-PK alone filed 143 rows in four days.
- A direct page request renders a **stub**: *"MER-PK is a preferred share of
  Bank of America (BAC)"* with a link — not a 404 on a ticker that genuinely
  trades.

**2 — Shared CIK, SAME security type** (`GOOGL`/`GOOG`, `BRK-A`/`BRK-B`,
`FOXA`/`FOX`, `UAA`/`UA`)

- **Keep both.** The financials legitimately apply to both classes.
- **Flag per-share figures as needing the CLASS's own share count.** That is the
  BRK.B error already on record, and it is a **different bug** — not fixed by
  this rule and not to be conflated with it.

**3 — The six orphan groups** (`OAK-PA`/`OAK-PB`, `CTA-PB`/`CTA-PA`, and four
others) **fall out of rule 1**: not operating companies, so they leave the
universe. A direct request renders *"no financial data available for this
security"* rather than a stub pointing at a parent that is not in the universe
either.

### PLACEMENT — both admission and the extraction boundary

The test sits at **universe admission AND the extraction boundary.**

**Admission alone is insufficient:** the cold path (build brief §4,
`SEC_COLD_FETCH_DRAIN_PER_RUN`) fetches *off-universe* symbols on request. A
directly-requested preferred never passes through admission, and would hit the
same parent-CIK problem by a different door.

### The signal — CONFIRMED, with a trap that would have made the test useless

`nasdaqtraded.txt` header, read live (13,221 rows, 38 currently flagged
`Test Issue`):

```
Nasdaq Traded | Symbol | Security Name | Listing Exchange | Market Category |
ETF | Round Lot Size | Test Issue | Financial Status | CQS Symbol |
NASDAQ Symbol | NextShares
```

`Security Name` is index 2, `ETF` 5, `Test Issue` 7. **Read by name, not index**
— the existing scripts already use `header.indexOf(...)`, and a positional read
is one inserted column away from classifying every security by its listing venue.
The indices are recorded as a cross-check, not as the access method.

`Test Issue` is confirmed as a **free second exclusion**, already among the
columns the existing scripts read.

#### THE TRAP: Nasdaq spells suffixed preferreds with a DOLLAR sign

**Two conventions, not one**, and the universe writes both as `-`:

```
$  = preferred / note series     MER$K  EP$C  T$A  BAC$K
.  = share class                 BRK.A  BRK.B  MKC.V
```

A `-` → `$` rule alone misses every share class. The helper already emitted the
dot form (its dash→dot rule), which is why `MKC-V` resolved once the fixture held
real data — verified, not assumed.

A join on symbol returns **NULL for every suffixed preferred**, and a null
Security Name reads as *"no name, so not a preferred"*. The test then **passes
through exactly the securities it exists to catch** — fail-open, and
**indistinguishable from a working test that found nothing.**

**And the two shapes differ, so a spot check misleads.** Suffixed preferreds
(MER-PK, MKC-V, EP-PC) need the `$` form; baby bonds carry plain alphabetic
tickers (TBB, PFH, UNMA) and join correctly as-is. Checking TBB alone passes and
says nothing about the suffixed half. **Assert on the SHAPES, not on one symbol** — five behave differently and one
passing proves nothing about the others:

| universe | Nasdaq | shape | verdict |
|---|---|---|---|
| `EP-PC` | `EP$C` | `$` preferred | not-common |
| `MER-PK` | `MER$K` | `$` note | not-common |
| `MKC-V` | `MKC.V` | `.` share class | **common** |
| `TBB` | `TBB` | plain-ticker note | not-common |
| `EMBJ` | `EMBJ` | plain-ticker common | **common** |

`scripts/check-security-spellings.mjs`.

#### THE CLASSIFIER IS INVERTED — known-good match, everything else excluded

A positive list of bad words does not work. Measured against the real names,
**"Preferred" appears in only one of the six** non-common securities the review
listed:

```
EP$C   El Paso Corporation Preferred Stock                          <- the only one
MER$K  Bank of America ... Income Capital Obligation Notes due 2066
TBB    AT&T Inc. 5.350% Global Notes due 2066
PFH    Prudential Financial 4.125% Junior Subordinated Notes due 2060
UNMA   Unum Group 6.250% Junior Subordinated Notes due 2058
EMBJ   Embraer S.A. Common Stock                                    <- actually COMMON
```

"Income Capital Obligation Notes" is the name nobody would have enumerated. So
the rule matches **`Common Stock` | `Common Shares` | `Ordinary Shares` |
`Class <X> (Common|Capital|Ordinary) Stock`** and treats everything else as
not-common. The qualifier inside the `Class` pattern is required: a bare
`/Stock/` accepts "Preferred Stock", and a bare `/Class .* Stock/` would accept a
hypothetical "Class A Preferred Stock".

**Three states, not two.** `unknown` (the join failed) stays distinct from
`not-common` (the join succeeded and it is a note) — both exclude, but they mean
different things in a report. Returning `common` for either is the fail-open path.

A separate `describeSecurityName` gives the fine label for reporting only, and
**its fallback is `other`, not `common`** — the same inversion, so a security
type nobody enumerated cannot become an included symbol.

#### THE COUNT IS 5 OF 7, NOT 7 OF 7

`MKC.V` — *"McCormick & Company, Incorporated Common Stock"*, the same name as
its parent — and `EMBJ` — *"Embraer S.A. Common Stock"* — are **branch 2, keep
both.** `state-2026-09-13.md`'s seven-symbol list needs correcting.

Worth recording: the ticker-shape heuristic I abandoned was **right about MKC-V**
even while wrong about `T`/`TBB`. Being wrong on some cases is not the same as
being wrong on all of them, and the reason to discard it was that it cannot be
*relied* on, not that every one of its answers was incorrect.

#### One helper, because there were seven copies

The dot/dash dance existed in **seven** places. `scripts/lib/symbol-spellings.mjs`
now generates every spelling — dot, dash and dollar — and `classifyUnresolvedIsNotCommon`
states the rule in code: **an unresolved name is `"unknown"`, never `"common"`.**

Five call sites converted; **two exempt with stated reasons** rather than the bar
being lowered: `phase0-adjustment-probe.mjs` builds stooq *filenames*
(`brk-b.us`), and `step0-analyse-dump.mjs` *studies* the two spellings, so
routing it through the helper would make it study the helper.

The rule is generative, not a lookup table — a table of known preferreds is a
September 2026 snapshot that returns a wrong answer silently forever, which this
repo has refused twice already.

### What was previously unverified about the signal

`Security Name` from `nasdaqtraded.txt` — it distinguishes "Class A Common Stock"
from "% Notes due …" and "Preferred Stock".

**Resolved.** I had written that the signal was "already fetched by two existing
scripts" — the **file** was, the **column** was not, and its presence was
unverified from the sandbox (`www.nasdaqtrader.com` returns 403 CONNECT). It has
since been read live and is confirmed above, so no relay dispatch is needed.

### Exact match vs substring — the two rules land close together

`claude/taxonomy-enumeration-2026-09-14.md` §4 says label matching must be
**exact**. A **substring** match on `Security Name` does not contradict it,
because they are different concerns:

| | |
|---|---|
| **IDENTITY → exact** | Label lookups, the art map, the SIC table, stored values. A near-match files a symbol under the wrong category. |
| **CLASSIFICATION and DISCOVERY → substring** | Deciding *what kind of thing* a security is; screener search. `Security Name` contains "Preferred Stock" inside a longer string, exactly as a user typing "bank" must reach all three bank labels. |

Same distinction as the screener search. Stated here because the two rules are
adjacent and would otherwise read as contradictory.

### The heuristic that failed, kept deliberately

Attempting to separate the two classes **by ticker shape** misclassified
`T TBB`, `PRU PFH PRH PRS`, `UNM UNMA` and `SO SOJC SOJD SOJE SOMN` as share
classes on the first try, because **baby bonds carry plain alphabetic tickers**.

Kept in the record rather than replaced with the working version: it is better
evidence for the data-driven approach than a correct implementation would be,
because it shows the plausible shortcut failing on real data rather than merely
asserting that it would.

### What was open, and is now closed

"Shared CIK" is the right **detector** and is not on its own a sufficient
**exclusion**, because two different things share a CIK — which is what the
disposition rule above resolves:

| | Example | Is the page right? |
|---|---|---|
| **Share class** | `GOOGL`/`GOOG`, `BRK-A`/`BRK-B`, `FOXA`/`FOX`, `UAA`/`UA` | **Yes.** Both are equity in the same issuer; the parent's financials are the correct content for both. |
| **Preferred / baby bond** | `BAC`/`MER-PK`, `T`/`TBB`, `PRU`/`PFH`, `UNM`/`UNMA` | **No.** A different security with different economics. Common-stock EPS is not a claim the holder has. |

Applied literally, "exclude on shared CIK" drops `GOOG`, `BRK-A`, `FOX`, `NWS`,
`UA`, `Z` — legitimate pages. Rule 2 above is why they stay.

### Six groups have no parent in the universe at all

`OAK-PA OAK-PB` · `CTA-PB CTA-PA` · `BRK-B BRK-A` · `FCNCA FCNCN` ·
`FWONA FWONK` · `BATRA BATRK`

Two of these (`OAK-*`, `CTA-*`) are preferreds whose common is absent, so there is
no correct page to render and no parent row to defer to. They want the
unclassified-style explicit bucket rather than a silent drop.

## Validation

Diff **every** extracted number against the frozen FMP ground-truth dump.

**Not against hand-built fixtures.** §17 of `scripts/check-sec-daily-index.mjs`
is the worked example of why: a synthetic fixture produced
`{ periodic-report: 77, unconfirmed: 50 }` from a modulo-5 round robin and was
reported as a replay of a real window for days. A fixture reverse-engineered from
the expected answer cannot test the thing that produces the answer.
