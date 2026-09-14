# The two venue sources disagree — do not quote 62.5% until this is settled

**Date:** 2026-09-14
**Status:** OPEN. Relay task written (`listing-venue-diff`), not yet dispatched.

## The finding

Two counts of the same universe's listing venue do not agree:

|  | NYSE | Nasdaq | (unknown) | universe |
|---|---|---|---|---|
| manifest exchange histogram (live, today) | 476 | 216 | 4 | 696 |
| #448 / `listing-split.mjs` | 463 | 230 | — | 693 |

Nasdaq is **14 lower** and NYSE **13 higher** than the figure the
32.9%-by-count / **62.5%-by-dollar-volume** licensing case rests on. The split is
that case's denominator.

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
being corrupt. And the two runs cover **different symbol counts** (696 vs 693),
so part of a 13/14 delta could be membership rather than classification.

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
   count, and % by dollar volume — plus the swing between them.
4. Coverage gaps (a symbol one file has no row for) reported separately from
   conflicts, and the membership component reported as **UNACCOUNTED** unless
   the live universe is supplied.

Two design points worth keeping:

* `parseTickerFile` is **lifted from `lib/server/secTickerMap.ts`**, not
  reimplemented. "The manifest side of this diff" means exactly what that
  function returns, and a reimplementation of the parser could not be evidence
  about the parser.
* The `VENUE` code table is **duplicated** from `listing-split.mjs` rather than
  shared. The "#448 side" must keep meaning what #448 meant; a shared table
  would let a later edit change the past half of the comparison.

### Dispatching it

```
task:   listing-venue-diff
ref:    build/sec-fundamentals-2026-09-13
run_id: <the run whose artifact holds step0-dump>
```

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
