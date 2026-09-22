# News art v2 on the symbol-led surfaces: the industry layer (2026-09-22)

`/stock/[symbol]/news` chose its illustration from the SECTOR alone. Nineteen
`sector-*` buckets cannot say what 67 v2 subjects can, so every Technology stock
showed servers, cables and abstract network diagrams — Apple and a drone company
alike.

This change adds two layers above the sector art on that one surface.
`/sector/[slug]/news` and the dashboard strip are untouched and are asserted to
be, in `scripts/check-news-art.mjs`.

---

## 1. The collapse, measured

Across the 2,619 symbols in `data/static-profile.json` (asOf 2026-09-13, every
row carries an industry), today's buckets hold this many distinct v2 subjects:

| bucket | symbols | distinct v2 tags underneath |
|---|---|---|
| sector-banks | 342 | 5 — banks 183, asset-management 70, investment-banks 44, fintech-payments 33, exchanges 10 |
| sector-biotech | 333 | 5 — biotech 175, medtech-devices 66, pharma 49, hospitals 30, software 13 |
| sector-software | 317 | 4 — software 166, cloud 69, **consumer-electronics 63**, telecom 19 |
| sector-industrials | 317 | 11 — machinery 118, construction 56, shipping 24, trucking-logistics 21, … |
| sector-retail | 223 | 6 |
| sector-energy | 183 | 8 |

Five buckets are already 1:1 with a subject (insurance, semiconductors,
utilities, aerospace, telecom). Those symbols gain a v2 image and nothing else.

---

## 2. The layers, most specific first

1. **The article's own words.** `articleTopic()`'s subject, with market-wide
   tags dropped (§3). Reaches 9 of 192 per-symbol headlines, 4.7%.
2. **The event bucket**, exactly as today.
3. **The industry**, `lib/server/news/industryArt.ts`. 88.5% of the universe.
4. **The sector bucket**, exactly as today.

### Why the event bucket sits at 2 and not below the industry

The brief said "classifier, then industry, then the existing sector art" and did
not say where `eventType` goes. Putting the industry above it would silently
take event art off every earnings story on a stock page — 7.3% of the per-symbol
fixture reaches `earnings` alone — and replace it with a picture of the
company's industry.

The ordering principle the whole picker is built on says that would be wrong
anyway: layer 1 is first because the ARTICLE is more specific than the company,
and an event type is also a fact about the article. "Apple beats estimates" is an
earnings story that happens to be about a consumer-electronics company.

It is one line to move and §10 pins the current order, so moving it fails a
check rather than passing quietly.

---

## 3. Market-wide tags, and why a symbol page must ignore them

`exchanges` matches `wall street`. On the 192-headline per-symbol fixture all
four of its hits are the metonym for analysts:

```
Apple Stock Slips … Fail to Wow Wall Street
Meta Stock Scores Wall Street Upgrade
A Wall Street Bull Expects 75% Gains            (MSFT)
Tesla's stock drops 6% as … 'underwhelms' Wall Street
```

On `/headlines` that pattern is usually right and is deliberately not narrowed:
a general feed saying "Wall Street" usually IS the market story. On a page about
ONE company it is wrong four times out of four, and worse than wrong, because
layer 1 outranks the industry — it would replace a correct picture of the
business with a trading floor.

The rule is not "`exchanges` is bad". It is that **a market-wide subject is never
more specific than the company whose page it is**. `MARKET_WIDE_SUBJECTS` is a
named set in `artTags.ts`, not a flag on the tag, so a future market-wide subject
joins it deliberately. `exchanges` is the only member today: every one of its
alternatives (`s&p 500`, `nasdaq composite`, `stock futures`, `market breadth`,
`wall street`) is about the market, and no other subject's are.

### `macro` was measured before being judged, and is not excluded

Asked for explicitly before deciding. On the same 192 headlines:

| motif | hits | |
|---|---|---|
| earnings | 14 | 7.3% |
| guidance | 9 | 4.7% |
| analyst | 4 | 2.1% |
| macro | **1** | 0.5% |
| legal | 1 | 0.5% |
| deal | 1 | 0.5% |

The single `macro` hit is "Costco Wholesale Corporation $COST Shares Acquired by
Saudi Central Bank" — the known-wrong one already recorded as `imprecise` in
`scripts/fixtures/article-topic.jsonl`: `central bank` firing on a named
institution buying shares.

So it is wrong 1 of 1 — and **the question is moot as built**, because layer 1
reads SUBJECTS only. A motif-only article falls through to the industry, which
says more about the picture than a generic podium does. That is the opposite of
the trade on `/headlines`, where there is no company to say anything about. If
motifs are ever admitted here, this row is the one to re-check first.

---

## 4. The industry table

144 labels, 2,619 symbols:

| | labels | symbols | |
|---|---|---|---|
| live | 115 | 2,317 | 88.5% |
| weak, held back | 18 | 201 | 7.7% |
| no honest tag | 11 | 101 | 3.9% |

The last two groups fall through to layer 4 and render exactly what they render
today. `WEAK_LABELS` keeps each held-back row WITH its reason, in the module, and
§10 asserts every one of them is inert — a label in both maps would go live
silently, which is the only way that list can fail.

**`Communication Equipment` was promoted out of the weak list on review.** It is
the label that started the change: ONDS resolves to it, and it resolved to
`sector-software`. It is still only half right — ONDS, CSCO and MSI share the
label, so a drone maker and a router vendor both get radio towers — and it is
live because that exact trade was looked at and taken.

### An exact lookup, not a pattern

`INDUSTRY_BUCKETS` in `art.ts` matches lowercased substrings because it maps free
text onto nineteen buckets and needs the slack. This maps a CLOSED SET of 144
exact labels from a committed snapshot onto 67 tags, so an exact lookup is both
sufficient and safer: "Banks - Regional" cannot be caught by a pattern written
for "Banks", and a label that changes upstream lands in the miss list instead of
quietly matching something adjacent. §10 asserts every key is a label the
snapshot actually contains — a dead row looks exactly like a live one.

### Twelve subjects stay unreachable from any industry label

`ai-compute`, `chip-equipment`, `cruise-lines`, `crypto`, `cybersecurity`,
`ecommerce`, `ev`, `phones`, `reit-datacenter`, `rockets-space`, `satellites`,
`wind`.

Some are surprising and none is a bug in the table: AMZN's label is "Specialty
Retail", so `ecommerce` never fires; ASML's is "Semiconductors", so
`chip-equipment` never fires; TSLA's is "Auto - Manufacturers", so `ev` never
fires. They remain reachable from layer 1 when an article says so. A megacap
override list is deliberately not in this change.

---

## 5. The 10% rule

**No subject pattern may match more than 10% of the 192-headline per-symbol
fixture on its own.** Measured, the shapes it exists to stop:

| pattern | fires on |
|---|---|
| `\bstocks?\b` | **146/192 — 76%** |
| `\bshares?\b` | 11/192 — 6% |
| `\binvestors?\b` | 10/192 — 5% |
| `\bmarkets?\b` | 6/192 — 3% |

The widest live pattern is `ai-compute` at 5/192. The margin is wide on purpose:
this is a limit on a class of mistake, not a tuning parameter.

**Each pattern is tested ALONE, not through `articleTopic`.** First-match-wins
hides a ruinously broad pattern added below a narrow one — the narrow one keeps
winning on the headlines anyone would spot-check. The check also asserts that at
least one of the fallback shapes exceeds the limit, so a limit no candidate could
ever hit would fail rather than pass vacuously.

---

## 6. Before and after

One ordinary headline with no subject and no event type, so layer 3 decides:

| symbol | industry | before | after |
|---|---|---|---|
| AAPL | Consumer Electronics | `sector-software` | `consumer-electronics` |
| NVDA | Semiconductors | `sector-semiconductors` | `chips` |
| KTOS | Aerospace & Defense | `sector-aerospace` | `aerospace-defence` |
| JPM | Banks - Diversified | `sector-banks` | `banks` |
| ONDS | Communication Equipment | `sector-software` | `telecom` |

Unchanged, verified by calling the same rules: the compact rows (still the
generated data card), an earnings item on the same page (still `event-earnings`),
`/headlines` (still `planHeadlineArt`), and `/sector/technology/news` (still
`bucketFor(slug, null)`).

**920 picks across all 115 live labels, 0 broken and 0 missing from the
manifest.**

---

## 7. The drone/defence capture — measure only

None of ONDS, RCAT, UMAC, AVAV or KTOS is in the 2026-09-13 fixture, so nothing
in this repo said what layer 1 does on the copy the whole change was prompted
by. Captured 2026-09-22 by the `drone-sample` relay task (run 35780548638, the
read-only job), 14 headlines each, committed verbatim as
`scripts/fixtures/drone-headlines-2026-09-22.jsonl`. `node
scripts/newsart-drone-measure.mjs` reproduces everything below.

### Layer 1 reaches nothing. Zero of seventy.

| | |
|---|---|
| subject after the market-wide exclusion | **0 (0%)** |
| dropped as market-wide | 0 |
| nothing, falls to the layers below | **70 (100%)** |

Not one drone or defence headline scores a subject, and none was dropped by the
exclusion either — there is simply no defence vocabulary in the subject table.
**This is the designed outcome, not a failure:** the picker has three more
layers, and a headline that says nothing specific should fall through to the
company rather than be forced into a picture.

### What each symbol actually gets

| symbol | industry | what decides the picture |
|---|---|---|
| RCAT | Aerospace & Defense | layer 3 → `aerospace-defence` |
| AVAV | Aerospace & Defense | layer 3 → `aerospace-defence` |
| KTOS | Aerospace & Defense | layer 3 → `aerospace-defence` |
| ONDS | Communication Equipment | layer 3 → `telecom` |
| UMAC | **not in the universe at all** | layer 4, or the generated card |

### UMAC, and a correction

The first reading of this was "a snapshot gap the `static-profile` relay run
fills". **That was wrong, and the count in §7b is why.** UMAC is not in
`data/static-profile.json`, and it is also not in `data/cik-map.json`, not in
`data/logo-manifest.json` and not in `data/company-names.json`. It is not a row
missing from the snapshot; it is a symbol outside the site's universe entirely.
Re-running the snapshot would not add it, because the snapshot is built from
that universe.

Adding UMAC is a universe question — whether the symbol belongs on the site at
all — and nothing about news art.

### 7b. Every symbol with no snapshot row — and there is no gap

Counted across the union of every symbol any committed data file knows
(`cik-map.json` 2,609, `logo-manifest.json` 2,621, `company-names.json` 2,610,
and the snapshot itself 2,619): **2,653 symbols, of which 34 have no row in
`data/static-profile.json`.**

```
ARKK ARKW BRK.B DGRO DIA GLD HODL HYG IBIT IWM JEPI JEPQ QQQ SCHD SLV SMH
SOXX SPY SQ TLT VOO VTI VUG XLB XLC XLE XLF XLI XLK XLP XLRE XLU XLV XLY
```

**32 of the 34 are ETFs and funds** — SPY, QQQ, the XL* sector funds, GLD, SLV,
IBIT, the ARK funds, JEPI/JEPQ, TLT, HYG. A fund has no industry, so having no
row is CORRECT rather than missing. They appear only in `logo-manifest.json`,
which is a list of things that need a picture, not a list of companies.

The two that are not funds are both explained and neither is a gap:

| symbol | what it actually is |
|---|---|
| `BRK.B` | a SPELLING VARIANT. The snapshot has `BRK-A` and `BRK-B`; the logo manifest writes the dot form. |
| `SQ` | a STALE TICKER. Block renamed SQ → XYZ, and the snapshot has `XYZ`. The logo manifest still carries the old one. |

**So the snapshot is complete for every company in the universe, and the
proposed relay run has nothing to fill.** What each of the 34 loses:

| surface | what a missing row costs |
|---|---|
| news art | layers 3 and 4 both go quiet; the card falls to the generated ticker card. For a fund that is the right outcome — there is no industry to draw. |
| sector pages | absent from membership, since `sectorUniverse` builds it from the same field. Right for a fund, which is not in a sector. |
| Pickers | unaffected — they are built from price and fundamentals rows, not from this file. |

The one real consequence is cosmetic and worth a separate look: `BRK.B` and `SQ`
in `logo-manifest.json` are two entries pointing at spellings the rest of the
site no longer uses.

### A defence pattern: proposed, measured, NOT landed

Item 5 was measure-only, so nothing below is in the live table.

```ts
// Candidate A
/\b(defen[cs]e (spending|budget|contract|awards?|stocks?|tech|sector|primes?)|drone (makers?|stocks?|programs?|fleet|swarms?)|drones?\b|pentagon|warfighters?|precision[- ]strike|cruise[- ]missiles?)\b/i
```

| candidate | drone / 70 | per-symbol / 192 | general / 42 | "defensive stocks", "defensive sectors" |
|---|---|---|---|---|
| A (narrow) | 25 (36%) | **1 (0.5%)** | 0 | clean |
| B (bare `defence` too) | 31 (44%) | 1 (0.5%) | 0 | clean |
| C (drones only) | 16 (23%) | 0 | 0 | clean |

The guard holds by construction rather than by care: `\bdefense\b` cannot match
"defensive" — the word boundary needs a non-word character and gets an `i`. All
three candidates were run against the guard phrases and none fires.

**All three pass the 10% rule, and that is the rule's limitation, not its
endorsement.** The 192-row fixture is tech and consumer copy with no defence
stories in it, so it cannot bound how broad a defence pattern is. The honest
limit for one of these is the drone fixture, where 36% is by design because it
IS a defence feed. A pattern for a sector needs a fixture from that sector.

The single per-symbol hit is worth reading before anyone lands this:

> NIO Stock Jumps Overnight: Deutsche Bank's 304% Profit Growth Outlook Drowns
> Out **Pentagon** Military Tag Concerns

Defensible — it is a defence-policy story about NIO — and exactly the shape that
turned out wrong for `banks`. There is a second and larger risk in the same
family: "Kratos Defense & Security Solutions" is a COMPANY NAME containing
"Defense", so a headline naming Kratos on someone else's page would score
`aerospace-defence` the way "Bank of America" once scored `banks`.

**And for four of the five symbols it would change almost nothing**, because
layer 3 already answers `aerospace-defence` for RCAT, AVAV and KTOS. The only
symbol a layer-1 defence pattern actually moves is ONDS (4 of 14), and only
because its industry label says telecom.

### Candidate C, read hit by hit

All 16 of C's hits on the drone fixture, with what landing it would actually do:

| | symbol | headline | effect |
|---|---|---|---|
| 1 | ONDS | Ondas vs. Red Cat: Which Drone Stock Is the Better Pick Now? | **new** (layer 3 gives telecom) |
| 2 | ONDS | Ondas Drops 6% as Risk-Off Selling Cascades Through Drone Names | **new** |
| 3 | RCAT | Red Cat Stock Could Fly On Pentagon's Biggest-Ever Drone Bet | redundant |
| 4 | RCAT | Red Cat Misses the Cut in Pentagon's Latest Drone Dominance Round | redundant |
| 5 | RCAT | RCAT Stock Falls… Retail Bets Iran Conflict Could Boost Military Drone Demand | redundant |
| 6 | RCAT | Why ONDS, RCAT And Other Drone Stocks Are Surging In Overnight Trading | redundant |
| 7 | RCAT | Red Cat Holdings (RCAT) Stock Is Jumping Today: What's Moving Drone Stocks? | redundant |
| 8 | UMAC | Drone Stocks Are Back In Play: Why RCAT, AVAV, KTOS, UMAC Stocks Are Climbing | **new** (no snapshot row) |
| 9 | UMAC | 3 Drone Tech Stocks Well-Positioned for Long-Term Growth | **new** |
| 10 | UMAC | Unusual Machines (UMAC) Stock Is Climbing Today: Is the Whole Drone Group Moving? | **new** |
| 11 | UMAC | UMAC Stock Eyes Second Weekly Gains: Drone Maker Ties Its CEO's Fortune… | **new** |
| 12 | AVAV | Drones Stock AeroVironment Is Now a Space Stock, Too | redundant |
| 13 | AVAV | AeroVironment Stock Jumps After Earnings Beat. There's Still Growth for Drones. | **DISPLACES `event-earnings`** |
| 14 | KTOS | Kratos' Drone Business Is Just the Beginning for This Defense Stock | redundant |
| 15 | KTOS | Better Drone Stock: Kratos Defense vs. Northrop Grumman | redundant |
| 16 | KTOS | Drone Stocks Are Back In Play: Why RCAT, AVAV, KTOS, UMAC Stocks Are Climbing | redundant |

**Not one of the 16 is a wrong match.** Every headline is genuinely about drones
or the drone group. Two are worth a second look and neither is an error:

- **#13 is the only one that changes a card that already had a specific
  picture.** It is an EARNINGS story whose last clause mentions drones, and
  layer 1 outranks the event bucket by design, so C would take
  `event-earnings` off it. That is the cost of the ordering, showing up for the
  first time on real copy.
- **#12 says AeroVironment is now a SPACE stock** — Mars helicopters, NASA. The
  library has `rockets-space` and `satellites`, either of which would be truer
  than `aerospace-defence`; the picture is not wrong, only broad.

**The arithmetic for the decision: 9 redundant, 6 new, 1 displacement.** All six
of the new ones are ONDS and UMAC — the two symbols whose industry does not say
aerospace. For RCAT, AVAV and KTOS, C changes which of four images appears and
nothing else.

---

## 7c. Follow-up, NOT this PR: company names that contain subject words

A company name is not a topic, and the classifier cannot tell the difference.
Two cases are already on record:

**"Bank of America resets Apple stock price target"** scored `banks` and put a
vault on an Apple analyst note. That one was fixed by narrowing the pattern —
the bare singular is gone — but the fix works because "Bank of America" happens
not to contain the plural. **"Kratos Defense & Security Solutions"** is the same
shape and no narrowing helps: any defence pattern worth having matches the word
"Defense" inside that company's name, so a headline naming Kratos on someone
else's page would score `aerospace-defence`. The proposal is to MASK KNOWN
COMPANY NAMES OUT OF THE TITLE BEFORE LAYER-1 MATCHING, using
`data/company-names.json`, which already holds the display name for 2,610
symbols: strip the names it knows, then classify what is left, so "Kratos" and
"Bank of America" become invisible to the tables while "the banking sector" and
"drone stocks" stay exactly as visible as they are now. It is a separate change
because it needs its own measurement — masking can take away a true positive
(a headline about a bank naming a bank) as easily as a false one — and because
it touches every surface layer 1 serves, not just this one.

## 8. Open

- **ONDS gets telecom art, not drone art.** `drones` is not a subject the
  library holds. A per-symbol override and new art are both out of this change,
  by decision.
- **The 18 weak labels**, one approval at a time. Each is in `WEAK_LABELS` with
  the reason it is only half right.
- **The 11 with no honest tag.** `Security & Protection Services` is the sharpest:
  guards and alarms, and tagging it `cybersecurity` would be a different
  industry rather than an approximation of one.
- **`BRK.B` and `SQ` in `logo-manifest.json`** are a spelling variant and a
  stale ticker; §7b. Cosmetic, and nothing to do with news art.
- **Masking company names before layer-1 matching**, §7c.
- **A defence pattern for layer 1**, per §7 — proposed and measured, not landed,
  and worth little for four of the five symbols.
- `/sector/[slug]/news` and the dashboard strip, each its own change.
