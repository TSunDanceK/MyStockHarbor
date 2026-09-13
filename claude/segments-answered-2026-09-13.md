# Segment revenue — available, free, and the verdict was wrong (2026-09-13, 15:57 UTC)

`joinKeyColumnUsed: "dimhash"`. That was the whole bug. 63 of 63 hashes resolved, 0 not
found. Confirmed on the follow-up run: **GO**, 6 product members, 5 geographic members,
sanity anchor passes.

---

## 1. The segments strings

From `dimensionHashes.classification`:

```
ProductOrService=IPhone;
ProductOrService=Mac;
ProductOrService=IPad;
ProductOrService=WearablesHomeandAccessories;
ProductOrService=Service;
ProductOrService=Product;

BusinessSegments=AmericasSegment;ConsolidationItems=OperatingSegments;
BusinessSegments=EuropeSegment;ConsolidationItems=OperatingSegments;
BusinessSegments=GreaterChinaSegment;ConsolidationItems=OperatingSegments;
BusinessSegments=JapanSegment;ConsolidationItems=OperatingSegments;
BusinessSegments=RestOfAsiaPacificSegment;ConsolidationItems=OperatingSegments;

Geographical=US;
Geographical=CN;
Geographical=OtherCountries;
```

`RevenueFromContractWithCustomerExcludingAssessedTax` carries **45 dimensioned rows of 57**.
That is the disaggregation.

---

## 2. Why the first pass missed it

**The `segments` field strips the `Axis` suffix.** The classifier was matching full XBRL axis
element names; the dataset stores the short form:

| XBRL element | In `dim.tsv` |
|---|---|
| `ProductOrServiceAxis` | `ProductOrService` |
| `StatementGeographicalAxis` | `Geographical` |
| `StatementBusinessSegmentsAxis` | `BusinessSegments` |

A substring match on `ProductOrServiceAxis` finds nothing in `ProductOrService=IPhone;`, so
every hash fell through to `resolved-other-axis` and the histogram came out empty.
`axisHistogram: {}` alongside 63 resolved hashes was the tell — if the parser could read an
axis at all, that object would have entries.

**Parse the left side of each `key=value;` pair as the axis and report it verbatim.** Do not
strip the literal string "Axis"; accept both forms and let the histogram name whatever turns
up, so axes nobody anticipated are visible rather than silently bucketed.

---

## 3. The anchor was right and the verdict overrode it

```
sanityCheck.passes: false
note: "Does NOT match the known disclosure (expected >=4 of each).
       Treat this as a fault in the extraction, not a fact about Apple."

verdict: "NO-GO -- ... this is a genuine statement about what this filing discloses."
```

Those cannot both be true, and the anchor was right. **A failing anchor means INCONCLUSIVE
carrying the anchor's reason, never NO-GO.** A verdict its own sanity check contradicts is
worse than no verdict, because it reads as settled.

The anchor is a probe device and only applies to a symbol whose answer is known. **The
production successor needs no lookup table: the segment breakdown should sum to the
undimensioned total.** Apple's five product lines sum to total revenue; the five operating
segments sum to it independently. Any company, any filing — and it catches the failure modes
that matter, a missing member or a double-counted rollup.

---

## 4. Two traps that would put wrong numbers on the page

**The `ProductOrService` axis carries cost of sales as well as revenue.**
`CostOfGoodsAndServicesSold` sits on the same axis — 6 of the 27 product rows. Filter on the
revenue tag, not just the axis, or the "revenue by product" card quietly includes cost.

**Two overlapping partitions share that one axis.** `{Product, Service}` and
`{iPhone, Mac, iPad, Wearables, Service}` both appear, so taking all six members
double-counts — `Product` is the rollup of the other four and `Service` belongs to both.
Checking FY2023: iPhone 200,583 + Mac 29,357 + iPad 28,300 + Wearables 39,845 + Services
85,200 = 383,285, Apple's total revenue exactly; Product + Service reaches the same total by
the coarser route. So a sum check confirms completeness but does not pick the level.

**The rule that generalises: drop any member whose value equals the sum of its siblings on
the same axis and date.** That removes `Product` here and removes other filers' rollups
without a per-company rule.

---

## 5. Apple discloses geography twice

- **`BusinessSegments=`** — Americas, Europe, Greater China, Japan, Rest of Asia Pacific.
  The reportable operating segments, and the analogue of the live page's "By region" card.
  `ConsolidationItems=OperatingSegments` rides on the same hash and is what makes those rows
  the segment figures rather than a rollup — filter on it, do not discard it.
- **`Geographical=`** — US, CN, OtherCountries. The narrower country-level disclosure.

Report one or both, labelled separately. Merging them makes the percentages not sum.

---

## 6. A parsing hazard worth keeping

```
0x5cd3…  "InvestmentIdentifier=Debt Investments … Arcus Biosciences, Inc.,<TAB>Senior
          Secured, Maturity Date September 2029, … 7.75% Exit Fee;"  0
```

One row in 119,267. The field is **quoted and the tab sits inside the quotes**, so the row is
not malformed — `dim.tsv` uses quoted fields and a naive tab split breaks it. Rejecting the
row is safe today (`wantedHashesLostToIt` is empty) but a quote-aware reader recovers it.

**Watch `wantedHashesLostToIt`.** While it stays empty, discarding costs nothing. If it ever
fills, the parser is losing real dimensions — and a shifted row attaches a wrong axis name to
a real hash and carries it silently into the output, which is the worst shape of bug.

---

## 7. What this settles

**Segment revenue is recoverable, free, from SEC's Financial Statement and Notes Data Sets.**
One 93 MB monthly archive covers every filer; `num.tsv` reads in full in about three seconds
from a Vercel function; `dim.tsv` resolves the dimensions. No key, no licence, public domain.

That was the last open question on the earnings page. Everything the company files is
confirmed available. What remains is analyst consensus — a vendor question, not a technical
one.
