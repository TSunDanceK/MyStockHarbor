# The two venue sources disagree — do not quote 62.5% until this is settled

**Date:** 2026-09-14
**Status:** OPEN. Relay task written (`listing-venue-diff`), not yet dispatched.

## The finding

Two counts of the same universe's listing venue do not agree:

|  | NYSE | Nasdaq | other / unresolved | universe |
|---|---|---|---|---|
| manifest exchange histogram (live, today) | 476 | 216 | 4 unknown | **696** |
| #448 / `listing-split.mjs` | 463 + 3 SEC-only = 466 | 230 | 4 UNRESOLVED | **700** |

**Correction, 2026-09-14:** an earlier version of this file gave #448's universe
as 693. That was wrong — it came from adding only the NYSE and Nasdaq rows of
#448's table and dropping its `UNRESOLVED 4` and `NYSE (SEC only) 3`. #448's own
headline is "*The 700* is a third Nasdaq by count", and its rows sum to 700. The
frozen dump holds 700 symbols in both the 2026-09-12 and 2026-09-13 captures
(the 2026-09-13 one resolves 696 of them to a CIK). So the universe gap is
**700 dump vs 696 live manifest — the live set is SMALLER, not larger**, which
is the opposite of what this file previously said.

Nasdaq is **14 lower** and NYSE **10 higher** (476 against 466, once #448's
SEC-only rows are counted) than the figure the 32.9%-by-count /
**62.5%-by-dollar-volume** licensing case rests on. The split is that case's
denominator.

Nothing moved today — this run reported `exchangesChanged: 0`, `unchanged: 692`.
**The two sources have never agreed.** The `(unknown) 4` are BK, EA, EQR and WBS
and are explained (corporate actions; see the CIK reconciliation notes).

## Why the totals cannot settle it

The two figures are not two measurements of one thing. They come from different
files, read by different rules:

* **`listing-split.mjs` (#448)** resolves venue from Nasdaq's own
  `nasdaqtraded.txt` **Listing Exchange** code first — `Q`/`N`/`A`/`P`/`Z`/`V` —
  and only falls back to SEC where that file has no row. Its "Nasdaq" means
  *Listing Exchange == Q*.
* **The manifest** stores SEC's `exchange` column **verbatim**, via
  `parseTickerFile` → `reconcileExchanges`. Nothing normalises, collapses, or
  prefers another source. Its "Nasdaq" means *that cell says Nasdaq*.

A symbol can be counted Nasdaq by one and NYSE by the other with neither file
being corrupt. And the two runs cover **different symbol counts** (696 live vs
700 in the dump), so part of the delta could be membership rather than
classification.

**Totals that disagree do not say which one is wrong, and do not even say what
kind of disagreement it is.** Subtracting one histogram from the other and
calling the remainder a classification difference is precisely the error to
avoid: it silently attributes the membership component to misclassification.

## The measurement

`scripts/listing-venue-diff.mjs`, relay task `listing-venue-diff`. Read-only,
no credential, `needsDump: true`.

It runs both classifications over **one** symbol set, so anything that differs
between them is classification and nothing else, and reports:

1. Both venue histograms over that single set.
2. **Every symbol the two sources classify differently**, with both raw values,
   the source each came from, and the symbol's share of dollar volume.
3. What the headline figure becomes **under each source** — Nasdaq count, % by
   count, and % by dollar volume — plus the swing between them. Computed over
   the **comparable set** (symbols both files have a row for), with the all-rows
   figure printed beside it and the exclusion reported by count *and* by
   dollar-volume share. See *The coverage trap* below.
4. Coverage gaps (a symbol one file has no row for) reported separately from
   conflicts, and the membership component reported as **UNACCOUNTED** unless
   the live universe is supplied.

### The coverage trap

The Nasdaq test is `norm(venue) === "NASDAQ"`, and `norm(null)` is `null`. A
symbol one file has **no row for** is therefore counted as *not Nasdaq* on that
file's side — so a **coverage gap prints as a source disagreement**. If
`nasdaqtraded.txt` lacks rows for symbols SEC calls Nasdaq, the #448 side
undercounts Nasdaq by absence and the headline reports it as misclassification.
That is a version of the exact error this script exists to stop, committed by the
script itself, and it produces a plausible number rather than an error.

Fixed by computing section 3 over the comparable set, with that set as the
denominator for `pctCount` as well as `pctDv` — `rows.length` carries the same
defect into the count column. **Both numbers are kept**: the all-rows line is
printed beside it and labelled, so the divergence between the two lines is itself
the signal, and the exclusion is reported by weight because "6 symbols excluded,
0.02% of dollar volume" and "6 symbols excluded, 11% of dollar volume" call for
completely different responses. `counts.excludedFromHeadline` and
`counts.excludedDollarVolumeShare` travel in the JSON, which is what gets read
later without the console output beside it.

Section 1's closing claim was wrong for the same reason and is corrected: one
symbol set rules out *membership*, not coverage — a difference between the two
columns is classification **or** coverage, and section 4 says which.

`node scripts/listing-venue-diff.mjs --selftest` proves it, with no network and
no dump. The fixture is three covered symbols plus one that only SEC has a row
for, carrying 70% of the dollar volume: the comparable headline reads 66.7%, the
all-rows view 90.0%. Driven through the real `computeHeadline` — a
reimplementation of the arithmetic could not be evidence about the arithmetic.

Two design points worth keeping:

* `parseTickerFile` is **lifted from `lib/server/secTickerMap.ts`**, not
  reimplemented. "The manifest side of this diff" means exactly what that
  function returns, and a reimplementation of the parser could not be evidence
  about the parser.
* The `VENUE` code table is **duplicated** from `listing-split.mjs` rather than
  shared. The "#448 side" must keep meaning what #448 meant; a shared table
  would let a later edit change the past half of the comparison.

### Dispatching it

The dump is chosen, not left open: the **most recent successful** Step 0 freeze.

```
task:          listing-venue-diff
ref:           build/sec-fundamentals-2026-09-13
run_id:        34776325456
artifact_name: step0-dump
```

That run is `step0-ground-truth.yml` run #2, `main` @ `8d01e93`, completed
**2026-09-13T19:00:34Z**; the `step0-dump` artifact is 25.3 MB, created
19:00:32Z, expires 2026-12-12. One day old at time of writing.

**Provenance is printed at the top of the report, before any finding**, and
carried into `LISTING-VENUE-DIFF.json` as `dumpProvenance`. `relay.yml` now
forwards `DUMP_RUN_ID` and `DUMP_ARTIFACT` into the task environment, and the
script *additionally* derives the dump's age from a declared timestamp in
`universe.json` or from file mtimes — belt and braces, because a report that
loses its provenance when dispatched from an older workflow ref is worse than one
that infers it. Over `STALE_DAYS` (default 14) it prints a loud banner.

**What staleness actually does here, stated precisely.** A stale dump does *not*
fabricate a classification disagreement: both reference files are fetched **live**
on the runner, so the venue comparison is live-vs-live regardless of the dump's
age. What goes stale is the **universe** (section 1's denominator) and the
**dollar-volume weights** (section 3's pricing) — and section 3 is the number the
licensing case turns on. That is the reason to pin the dump, and it is the reason
the banner does not suppress sections 1–2.

Optional `SYMBOLS` = the live manifest universe (comma- or space-separated). With
it, the membership component closes; without it the script says so rather than
guessing. Output: `LISTING-VENUE-DIFF.json` in the dump dir — **every** symbol,
not only the conflicts, so "what did each source say about X" is answerable later
without a second runner round trip.

## Until then

**Do not quote 62.5% to anyone**, internally or in a negotiation. Section 3 of
the output is what says whether the disagreement even reaches that number: a
14-symbol count dispute could move it by a rounding error or by twenty points
depending entirely on *which* fourteen. The script prices it; nothing else does.

Once it lands, a **source of record** has to be chosen and written down. Two
files will keep disagreeing; the pipeline can only store one answer.
