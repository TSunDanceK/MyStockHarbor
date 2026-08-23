# Open engineering items

Live backlog of things found, measured and deliberately **not** changed. Each
entry says what is known, what decision it needs, and who it belongs to.

Started 2026-08-22 by lifting four items out of a handover note dated
2026-08-21, which nobody re-reads.

> **Why not `BOTTLENECK_QUEUE.md`,** where these were asked to go: that file is a
> nine-line mirror of a Claude Project doc that ranks which *bottleneck content
> pages* to write next, and it says in its own header that the Claude Project
> copy is the actively-edited source of truth. Engineering items placed there
> would be off-topic for every reader of it and would be lost at the next mirror
> sync. This file is the intended thing with a name that matches it.

---

## 1. `advScore < 35` is a liquidity floor written as a penalty

Five sites, one of which is **+30** rather than +25 (`computeAthPullback`, line
2215). Expressed as a deduction it can be outweighed by ~25 points elsewhere,
which is reachable on these composites — so none of the five implements a floor.

**Decision needed:** rename it to what it is, make it a real filter
(`return null`), or both. And whether the `+30` is deliberate.

Detail: `claude/housekeeping-findings-2026-08-22.md`.

## 2. `Daily history` shows 24 / 24 against a 755-symbol universe

Not sampling, and not 24-symbol coverage. `dailyHistory` is the only registered
dataset that calls `markRefreshed` and never `registerSymbols`, so its set holds
only symbols actually written since it was created — a self-selecting
denominator. "Within policy" on it is reassuring about nothing.

**Fix is one line**, but belongs with the per-outcome TTL work, which changes
when history is written and would move the number anyway.

Detail: `claude/housekeeping-findings-2026-08-22.md`.

## 3. `dynamicBoost` decides the /overbought-stocks-today cut

Not a tiebreaker. On the raw composite the name at rank 25 outscores the name at
rank 20; the boost produces the cut. A popularity term deciding membership of a
page making a technical claim is either a stated product choice or a bug.

**Decision needed:** state it on the page, demote it to a genuine tiebreaker, or
drop it from the pages whose names are technical claims.

Detail: `claude/picker-structure-findings-2026-08-22.md`.

## 4. `rankNoStructurePenalised` was never implemented

Identical to `rankNoStructureWaived` **by construction** — no comparison against
`"no-structure-penalised"` exists anywhere in `pickersBuilder.ts`. The debug
route currently answers the same question twice under two names, which reads as
"we tried it both ways and it makes no difference".

**Decision needed:** implement it, or delete it and its column.

Detail: `claude/picker-structure-findings-2026-08-22.md`.

## 5. `getSellSignalCount` disagrees with itself across three copies

`DashboardTicker.tsx` gates on `!belowMA200`; the picker page and
`PickersClient` do not. A stock overbought and below its MA50 but not below its
MA200 scores **2** on the picker pages and **0** on the dashboard ticker, today.

Left as three copies deliberately — collapsing means picking a winner, which is
a rules change, and the rules are parked. `scripts/check-signal-counts-single-source.mjs`
fails if anyone unifies them silently.

**Decision needed:** which behaviour is correct.

## 6. Six picker pages waiting on a column

Each still orders by `reasons.length` and each has its real key computed and
discarded. Blocked on the grid, which is another session's file.

Detail: `claude/picker-columns-needed-2026-08-22.md`.

---

## Closed since this file was started

- **`recencyScore = 100`** — removed. Flat 5.00 on every candidate; that
  composite had five discriminating terms, not six. Order-neutral by
  construction.
- **`fetchIndexChanges` failure visibility** — confirmed already correct; it
  throws and the feed reads not-ok. Its comment was corrected: all three
  constituent endpoints 402, not just Dow Jones.
- **Stale `note:` fields in `/api/debug/fmp-endpoints`** — four, not three.
