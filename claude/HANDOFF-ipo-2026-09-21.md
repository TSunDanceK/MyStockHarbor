# HANDOFF — /upcoming-ipos off FMP, 2026-09-21

Continues `claude/HANDOFF-ipo-2026-09-17.md`, which is still correct about
everything up to its own date. **Read that one first; this one is what happened
after it.** Work is on `claude/confident-tesla-0ozvb4`.

---

## TL;DR

The four steps the 09-17 handoff left are done, bar the flip itself:

1. **The app-side refresh route is built and running the write.** ✅
2. **The store is populated** — 753 records, watermark `20260920`. ✅
3. **Steps 6 and 7 are in the PR** (Market Cap hidden, copy, labels). ✅
4. **`IPO_PROVIDER=sec` is NOT yet flipped.** ⬅ the only thing left.

Two defects were found and fixed along the way that nobody was looking for, both
in the cover parser, both producing **confident wrong numbers on the live page**.
They are the substance of this document.

---

## THE ROUTE, AND HOW THE STORE GOT FILLED

`app/api/jobs/ipo-refresh`, cron `40 4 * * *`. Two commands on
`msh:ipo:filings:v1` (one GET, one SET, prune inside the write) plus one meta
GET for the watermark before the walk. Registered in `vercel.json` AND in
`jobRuns.JOBS`; `check-cron-auth.mjs` asserts neither can be removed without the
other.

**04:40 is deliberate: after sec-facts at 04:20, not beside it.** SEC's
fair-access limit is per REQUESTER, not per endpoint, so two jobs each politely
pacing themselves to 8/s would between them ask for 16/s.

**THE COLD START WAS TWO MANUAL RUNS, AND THAT IS NOT THE STANDING MECHANISM.**
Sundance ran the route twice by hand in a browser on 2026-09-21 to walk the
90-day window; the second came back `caughtUp: true`, `daysRemaining: 0`,
`storedAfter: 753`. **From here the cron keeps it current.** If the cron stops,
the store goes stale silently — the page will keep rendering an ageing window
rather than failing, which is the reading `/cache-health` exists to correct.

### A design point worth not undoing

**A filer's history comes from its own `submissions.json`, not from accumulated
days.** A company filing a 424B4 today whose 8-A12B landed three weeks ago was
not interesting on the day that 8-A12B was filed, so a day-at-a-time build never
records it — and `ipoSecSource` then reads "no 8-A12B in window" and drops a
**genuine IPO** as a follow-on, into the same funnel bucket as the real ones,
with every count still plausible. Reading the whole in-window history the first
time a filer is touched removes the hole and costs nothing: the SIC comes from
that same document.

### The correction to ipoSecStore.ts's header

It used to say the cold start is "seeded once from `form.idx` on a runner, never
backfilled a day at a time from a function". **The runner cannot write** — the
Actions Upstash token is read-only by deliberate choice — so that was never
possible. The day-at-a-time walk is the cold start *and* the standing path.
`scripts/ipo-seed.mjs` remains the `form.idx` measurement instrument it always
was; it is no longer the thing that fills the key.

---

## DEFECT 1 — THE SHARE COUNT WAS WRONG 71% OF THE TIME IT ANSWERED

Phase 0 gated the **price** parser at 5/5 against real covers.
**`sharesOffered` was never measured at all.** Relay **35583959865** ran the
shipped parser over 94 live covers and printed every `<n> shares` with the
sentence around it:

| | |
|---|---|
| shipped rule returned a number | **38 / 94** |
| …whose sentence was disqualifying | **27 / 38 — 71%** |
| …of which specifically "outstanding" | 12 |

`sharesOffered` feeds `dealSize`, which the page renders. Each of those was a
confident wrong figure.

**THREE distinct wrong sentences, not one.** The investigation started from
"outstanding" and that was a third of it:

- **OUTSTANDING** — ADARx: `"88,250,216 shares of our common stock outstanding"`.
  The post-offering total, rendered live as the offering size.
- **RESALE** — CYABRA: `"by the selling shareholders … of up to 21,645,176
  shares"`. Aura: `"We are registering the offer and sale from time to time of up
  to 143,277,908 shares"`. Neither is an offering by the issuer.
- **WARRANTS** — Aptevo: `"warrants to purchase up to 4,308,540 shares issuable
  upon exercise thereof"`.

**The probe's own CONTROLS were the tell.** Covers whose answer did *not* say
"outstanding", and which were therefore classified as correct, turned out to be
resales — every one. A fix for "outstanding" alone would have looked complete at
a third of the defect.

**THE FIX:** five anchors, each traceable to a named filing, plus a
disqualifying-context test read in **both directions** around the number —
"resale" precedes the count, "outstanding" follows it, and a trailing-only window
catches half of them while reporting a clean result.

**The trade is deliberate:** coverage 38 → ~18, correctness 29% → ~100%. Null
beats a guess, and a null costs a **column**, not a row — `hasTerms()` drops a
listing only when the price is also absent.

---

## DEFECT 2 — SPAC DEAL SIZE, AND WHY THE FIRST ANCHOR MATCHED 1 OF 94

Fixing defect 1 cost coverage exactly where this page is most visible: the
cohort is SPAC-dominated, and the one unit-shaped anchor matched **1 of 94**
covers. Deal Size would have gone blank on almost every live row.

Relay **35586785501** read 9 SPAC covers — masthead, every `$≥6-digit` sum,
every `<n> Units`, every trust sentence — with **no candidate patterns in the
probe**, so the output could not be read as confirmation of a guess.

The masthead shape is what a positional pattern cannot follow:

```
Three Lions 424B4   "$100,000,000 THREE LIONS ACQUISITION CORP. 10,000,000 Units"
Lannister F-1/A     "$15,000,000 Units 3,000,000 Units"
```

The company name sits between the two numbers in one and not the other, and the
old anchor had been written against Lannister alone.

**WHAT DOES NOT VARY IS THE ARITHMETIC.** The aggregate IS the count times the
price: 10,000,000 × $10.00 = $100,000,000; 3,000,000 × $5.00 (that cover's
$4–$6 midpoint) = $15,000,000. So a count is accepted **only when some dollar
figure on the same cover agrees with it**. Two numbers that multiply out is a
far stronger claim than either one's position, and it refuses the three
distractors Three Lions' own cover carries: the 1,500,000 over-allotment option,
the 11,500,000 with-option total, and the 10,400,000 "outstanding after this
offering" count.

**Measured after the fix (relay 35587433966): 13 of 14 SPAC covers now yield a
count, up from 1 of 9.**

---

## KNOWN, DELIBERATELY DEFERRED

None is guessed at in this pass. Each wants its own measurement first — the
discipline that turned the share count from 29% correct to ~100% was reading
the filings before writing the pattern, and these are where that has not been
done yet.

### 1. The 3× range guard has a blind spot on a single price

Aptevo's 424B4 parses a price of **$428.40**. Inside the `$1–$500` plausibility
bound, and a **single** price, so the 3× range-ratio guard never applies to it.
Combined with a resale share count it produced a **$2.76 BILLION** deal size.

**1 of 94 covers. Inert today** — that row is dropped as a follow-on either way,
so nothing renders it. But the guard has a hole, and the fix is not a tweak
grafted onto the existing ratio test: it needs a price-coverage measurement
first, exactly as the share count did.

### 2. JATT III still renders an implausible deal size — the cross-check's known weakness

The arithmetic cross-check accepts **any** count-and-total pair that agrees, and
a SPAC cover carries more than one. Adding `private placement` / `private
unit(s)` to the disqualifier list moved this row rather than fixing it:

```
before  JTTT  JATT III Acquisition Corp  $10.00  234,000  $2.34M   (relay 35588270240)
after   JTTT  JATT III Acquisition Corp  $10.00  225,000  $2.25M   (relay 35590006334)
```

A SPAC raising $2.25M does not happen. **JATT III's own cover sentence has not
been read** — the private-placement fix was written against the shape Three
Lions shows, and this row evidently has a third agreeing pair of some other
kind.

**DO NOT GUESS AT A THIRD PATTERN.** Two candidate fixes are available and both
are inventions until measured: a plausibility floor on the aggregate (an
arbitrary bound), or preferring the LARGEST agreeing pair over the first (rests
on "the public offering is always the biggest", which is plausible and
unverified). The next step is a targeted probe that dumps JATT III's cover
around every agreeing pair, exactly as `ipo-spac` did for the masthead.

**Scale, so the residual is not read as worse than it is:** 11 of 15 rendered
rows carry a deal size, and this is the one known to be wrong. Before this work
27 of 38 share counts were wrong.

### 3. `US$`-prefixed prices parse as no price at all

Lannister writes `"between US$4 and US$6 per Unit"`. The price patterns expect
`$` straight after the whitespace, so **that cover parses NO price** — which is
why the probe printed `price —-—` for it. **Foreign private issuers filing F-1/A
use the `US$` form routinely**, so this is likely more than one filer.

**IT FAILS SAFE, AND THAT IS WHY IT CAN WAIT.** The cover parses no price at
all, so the row renders a dash — null, not wrong. That is a different category
from the two defects this pass fixed, both of which produced confident wrong
figures. A coverage gap can be deferred; a wrong number cannot.

Found while isolating a fixture, not while looking for it. Not fixed here:
widening a price pattern without measuring how many filings it then catches is
how the first share-count rule got written.

---

## METHOD NOTES THAT COST SOMETHING

- **A document that parses is not a document that survived the trip.** A
  219-record ingest document came back through the Actions log with ONE byte
  changed. gzip's CRC caught it; the DEFLATE stream still decompressed and the
  JSON still parsed, so overriding the CRC produced a document reading
  `"Nasdaq Capital Marktt"` on **52 rows** — one corrupted LZ77 literal inherited
  by every back-reference. Fifty-two identical wrong values is a parser defect's
  exact costume, and it was only caught because the runner's own printout in the
  same log said `Market`. `scripts/local-upstash.mjs` now refuses a document
  whose sha256 does not match.

- **A fixture can pass for the wrong reason, and this happened twice.** A
  par-value test passed with the plausibility bound deleted, because its text
  matched no price phrase at all. A SPAC test passed with `$10.00` hardcoded,
  because the verbatim cover is caught by an anchor and never reaches the
  arithmetic. **Break each half separately and watch which assertion fails** —
  if none does, the control is missing, not the bug.

- **The Actions log API returns a TAIL measured in lines.** A large payload
  printed after a report pushes the report out of reach and the run has to be
  repeated to read its own answer. Payload first, or behind a flag
  (`IPO_EMIT_DOCUMENT=1`).

- **`node --check` parses and does not run**, and eslint's `no-undef` is off
  under this repo's TypeScript preset. A deleted `const` cost a full 51-day relay
  run that failed on its last few lines, after every network round trip was spent.

---

## WHAT IS LEFT

**Flip `IPO_PROVIDER=sec` in Vercel Production, then trigger a production
redeploy.** An env change alone is not picked up — the correction PR #453 made
the hard way for `NEWS_PROVIDER`.

Then verify the live page, and specifically **check Deal Size renders on the
SPAC rows**, since that is the column both defects above ran through.

Rolling back is setting the var back and redeploying. Nothing else has to move:
the FMP branch is untouched, `app/api/debug/ipo-calendar` and `fmpFetch` stay
while `IPO_PROVIDER=fmp` remains a working fallback.

---

## STILL SETTLED — do not relitigate

Everything in the 09-17 handoff's "DECISIONS ALREADY SETTLED" section stands
unchanged: Nasdaq is permanently closed, no price-range column on the upper
table, the `8-A12B` test is sound as-is, SIC 6770 stays in, do not tune toward
~28 IPOs/month, membership travels on the row, the age cap is 45 days, one key
and two commands a day.

Add to it: **the share-count and SPAC rules are measured, not guessed.** Both
have fixtures built from named filings with break-and-verify controls. Changing
either means re-running `ipo-shares` / `ipo-spac` on the relay and reading the
covers, not editing a regex until the numbers look better.

---

*Written 2026-09-21. Relay runs cited: 35583959865 (share counts, 94 covers),
35586785501 (SPAC covers, before), 35587433966 (SPAC covers, after),
35585163429 / 35587711390 (ingest).*
