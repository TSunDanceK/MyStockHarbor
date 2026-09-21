# The spelling hand-roll that recovered none of the 18 it was written for

*2026-09-15. Relay runs 86 and 87.*

## The checker nobody was reading

`check-security-spellings` had been red on `main` continuously, but for
*changing* reasons — which is the state in which a checker stops being read at
all. Its rule: no script rolls its own dot↔dash spelling where
`symbolSpellings` / `lookupBySpelling` exists.

Two offenders. One of them was mine, from #460.

## The defect is measurable, not stylistic

`sec-title-candidates.mjs` built `data/company-names.json` with:

```js
const row = findRow(symbol) ?? (symbol.includes("-") ? findRow(symbol.replace(/-/g, ".")) : undefined);
```

The comment directly above it names the symbols the fallback exists to reach:
BF-B, BRK-A, CIG-C, CMS-PB, CTA-PA, CTA-PB, EP-PC, FITB-PA, FITB-PM, MER-PK,
MKC-V, MOG-A, OAK-PA, OAK-PB, PBR-A, SEAL-PB, TRTN-PC.

**It reached none of them.** All 18 suffixed symbols in the universe were absent
from the committed snapshot. BRK.B was present only because the pickers half of
the universe supplies the dotted spelling directly.

**Dot was never the spelling to reach for.** `scripts/lib/symbol-spellings.mjs`
records this in as many words: Nasdaq Trader writes a suffixed preferred with a
**dollar** — `MER$K`, not `MER.PK`. The dollar rule is precisely the half a
hand-rolled dot/dash cannot express, and it is the helper's entire reason for
existing. The caller that most needed it was the one not calling it.

The recovered `MER-PK` row confirms the mechanism rather than just the count:
`"Bank of America Corporation Income Capital Obligation Notes …"` — the name the
helper's own header cites as the one nobody enumerates.

## The result, measured against the live directory

```
[titles] company-name snapshot: 2610/2620 universe symbols   (was 2592/2619)
```

Payload byte-verified: 130,337 declared, 130,337 captured. Diffed against the
committed file: **18 added, 0 removed, 0 changed.** The full-refresh churn worth
worrying about did not materialise — the directory has not moved since the
previous capture.

## What "+18" hides, and it matters

Only **7 of the 18** produce a usable news query. The other 11 are preferreds,
notes and depositary shares whose directory name is an *instrument description*,
which `cleanName` does not strip:

| recovered, usable | recovered, refused as `fund-or-note` |
|---|---|
| BF-B, BRK-A, **BRK-B**, CIG-C, FITB-PA, MKC-V, MOG-A | CMS-PB, CTA-PA, CTA-PB, EP-PC, FITB-PM, MER-PK, OAK-PA, OAK-PB, PBR-A, SEAL-PB, TRTN-PC |

BRK-B is in `PRESET_UNIVERSE` — a guaranteed pickers slot that was losing its
news leg.

**A behaviour change to state plainly.** `assessCompanyName` failing is a
*warning*, not a skip: `gnewsProvider` logs `weak query name … — override
candidate` and queries anyway. So those 11 symbols go from *no name, skipped
entirely* to *a query like `"CMS Energy Corporation Preferred Stock" stock`*. A
long quoted phrase returns approximately nothing, so the cost is 11 wasted
fetches rather than wrong content — and the warning is working as designed, since
its own comment says that log line is what the manual override list gets built
from. Whether a `fund-or-note` verdict should suppress the fetch outright is a
separate question about existing symbols too, and is not decided here.

## The checker then flagged its own fix

`logo-coverage-probe.mjs`'s new comment quotes the pattern it replaced, and the
guard matched raw text — so the file was flagged for *saying what it had stopped
doing*. That is the repo's own `grep-finds-the-comment` trap landing on the guard
rather than on the code it guards, for the second time.

Rewording the comment would have worked once and broken on the next file that
discusses the pattern honestly. The guard now reads through `readCodeOnly`, with
two controls: the exempt file that *carries* the pattern must still match (or the
haystack is empty), and `logo-coverage-probe` must fail the raw match while
passing the stripped one (or the strip is a no-op).

## Two assertions pinned the removed shapes

`check-sec-title-match` pinned both hand-rolls as structural greps — and one of
them was pinning a shape that recovered **0 of 18**. Testing the wrong thing, not
nothing. Restated to the property (*every spelling the helper knows*) rather than
deleted, each with a control that **runs** the call instead of grepping for it,
since a structural match passes happily on a call that returns nothing.

A third checker then caught the new fixture for carrying a dotted ticker string
literal. It parses literals rather than text, so a fixture and a live spelling
look identical to it — correctly — and the dotted form is now asserted by shape.

## Verification

- `tsc` clean; `check-all` **80 / 81**, the one failure being `check-doc-citations`
  on main's own IPO documents and pre-existing
- **3 / 3 mutations caught**: restoring either hand-roll, and reverting the
  comment strip to raw text
- The fallback-only population is unchanged at **66** — none of the 18 recovered
  rows is short-named — while the denominator moves 2,592 → 2,610. Four prose
  references updated.
