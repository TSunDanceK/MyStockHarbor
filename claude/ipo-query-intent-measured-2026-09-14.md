# /upcoming-ipos — what the 827 impressions actually ask for, 2026-09-14

The number `claude/ipo-source-probe-RESULTS-2026-09-14.md` left unmeasured, measured. Read
from Search Console through the owner's own browser: property `sc-domain:mystockharbor.com`,
page filter `https://www.mystockharbor.com/upcoming-ipos`, exact match, 3 months to
2026-09-12.

**The headline: the SEO exposure is not the full 827. Only about a third of the named
traffic asks when.**

---

## 1. The page today

| | |
|---|---|
| Impressions, 90d | **827** (up from 632 in the 2026-08-15 audit) |
| Clicks | **0** |
| CTR | 0% |
| Average position | **67** — page 7 |
| Distinct queries | 239 |

Two things follow before any option is costed.

**The property is verified.** `claude/seo-recovery-plan-2026-08-15.md` records ownership as
unverified and lists getting it verified as an action. It is done — `mystockharbor.com` is
a verified **domain property**. That item can be closed.

**The exposure is theoretical.** At position 67 with 0 clicks across 90 days, this page
converts nothing today. That cuts both ways: there is less to lose by changing it than the
impression count suggests, and less to protect by leaving it alone.

## 2. The classification

239 queries carrying **494 impressions**; the remaining 333 are Google's anonymised tail
and cannot be classified. So this covers 60% of the page's impressions. Percentages below
are of the 494 named.

| Bucket | Impressions | Share | Served by |
|---|---|---|---|
| **Forward-looking, no date needed** | **160** | **32.4%** | S-1/A watchlist, EDGAR+dates |
| **Needs an actual date** | **155** | **31.4%** | EDGAR+curated dates only |
| Neutral — "who/what list" | 96 | 19.4% | any of the three |
| Backward — recently listed | 50 | 10.1% | recently-listed, EDGAR+dates |
| Named company / historical | 27 | 5.5% | **none of them** |
| Brand | 6 | 1.2% | — |

**Forward-looking but undated is the single largest bucket**, and it is bigger than the
dated one: `upcoming ipos` (29), `upcoming ipo` (21), `companies going public` (6),
`future ipos` (4), `ipos to come` (3), `rumoured ipos` (3), `what ipos are coming up` (3),
`stocks going ipo` (2), `companies going public soon` (2), `upcoming tech ipos` (2).

None of those asks for a date. They ask **who**. And who is exactly what an S-1/A watchlist
knows, from a public-domain source, with no curation.

## 3. What this does to the options

Coverage of the 494 named impressions:

| | Serves | Share | Weekly human time |
|---|---|---|---|
| **1 — EDGAR + curated dates** | all but company/historical | **~93%** | 15–30 min, and blocked on a date source |
| **2 — recently-listed only** | backward + neutral | **~30%** | zero |
| **2(c) — S-1/A watchlist, undated** | forward-undated + neutral | **~52%** | zero |

**2(c) covers more than 2 by twenty-two points, at the same zero maintenance.** That is
the finding. Claude Code proposed 2(c) on structural grounds — licence-clean, genuinely
forward-looking, keeps the slug honest — without this number. The number supports it.

Two refinements the data adds to 2(c):

- **A watchlist and a recently-listed table are not exclusive.** Run both sections on one
  page — S-1/A filings above, 424B4/8-A12B listings below — and coverage goes to roughly
  **62%** (forward-undated + neutral + backward), still at zero curation, still entirely
  public domain. That is the existing two-table layout of the page, with both tables
  re-sourced. It is a smaller change to `page.tsx` than any other option here.
- **The `date` column becomes optional rather than absent.** 424B4 carries a real date at
  ~2 days' lead (measured 2/8 explicit). So the lower table can be dated honestly and the
  upper one carries "terms set, date not yet announced" — which is a true statement, not a
  gap being papered over.

## 4. Three things in the tail worth acting on

**NYSE is asked for, and was never covered.** `nyse ipo calendar` (3), `new york stock
exchange ipo calendar` (3), `upcoming ipo nyse` (2), `ipo on nyse` (2), `upcoming ipos
nyse` (1), `recent ipos nyse` (1), `nyse ipos` (1) — **13 impressions** explicitly want
NYSE. Nasdaq's feed was Nasdaq-only and could never have served them. SEC covers both
exchanges. The licence-clean route is the *better* source here, not the compromise.

**Two pre-IPO SPACs are being searched by name and landing here.** `southern cross
acquisition i corp.` (3) and `east west ave acquisition corp.` (3) — 6 impressions, more
than the brand query. These are companies that have **filed** and not priced, so the
current priced-only page shows them nothing. An S-1/A watchlist would be the first version
of this page that actually answers them.

**"Current window" queries are ambiguous in a useful direction.** `ipos this week` (6),
`ipo today` (6), `today ipo` (5), `new ipo today` (5), `ipos going public this week` (4)
and similar sit in the dated bucket, but an IPO that listed this morning *is* "ipo today".
A recently-listed table serves much of this bucket, so the 31.4% dated figure is the
**upper bound** of what is lost by dropping curated dates, not the expected loss.

## 5. What is still not measured, and should not be guessed

- **333 impressions (40%) are Google's anonymised tail** and are unclassifiable by anyone,
  including Google's own UI. The shares above are of the named 494 and should be quoted
  that way.
- **Position 67 means none of this is ranking.** These are intent shares, not traffic
  forecasts. No option here is worth choosing on a predicted click number, because the page
  earns zero clicks under all of them today.
- **Whether 2(c) ranks better than the status quo is untested.** The argument for it is
  that the page would stop claiming something it cannot deliver, not that a specific
  position follows.

## 6. Recommendation, stated as a recommendation

**2(c) plus the recently-listed table, as one page with two re-sourced sections.** It is
the only option that is licence-clean end to end, needs no curation, covers more intent
than the recently-listed-only design, serves NYSE for the first time, answers the named-SPAC
queries the current page ignores, and keeps the slug, title, H1 and all five internal
anchors truthful.

Option 1 stays available and is not foreclosed: if a licence-clean date source is ever
found, dates drop into the upper table without re-architecting anything. Its blocker stands
until then — every convenient source of the expected date is somebody's licensed
compilation, which is the whole finding of
`claude/nasdaq-licence-verdict-2026-09-14.md`.

Copy for the upper table should follow the house rule on hedged language: *"these companies
have filed to list and set terms; the listing date is not announced until pricing"* —
describing what is known, not forecasting what a reader may do with it.
