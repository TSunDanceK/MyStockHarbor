# HANDOFF — DueInput producer merged (PR #507), 2026-09-22

Supersedes nothing directly, but closes the "no producer" gap noted throughout
`claude/HANDOFF-due-strip-universe-regenerated-2026-09-22.md` and the earlier
earnings-calendar handoffs: `dueToReport.ts` had defined `DueInput` and
`selectDue()` since the v1 build opened, and nothing had ever constructed one.

## What merged

**PR #507**, `claude/due-input-producer` → `main`, squash-merged as
`4302b1d82e11ac6084dcbc003840ea9ffdf5bc28`.

- Built the missing producer: `dueInputs.ts` reads the sec-facts store and
  produces `DueInput[]` for `selectDue()`.
- Added two optional fields to `StoredReportDates` — `category?: string | null`
  and `annual?: boolean | null` — populated at the existing `writeReportDates()`
  call site in `sec-facts/route.ts` from variables already live there
  (`subs.category`, `cadence?.annual`). No extra request, no extra rate-limit
  exposure. Absent means not-yet-backfilled, same convention as `pending?`; no
  migration job needed since the sec-facts rotation rewrites every record.
- Coverage is measured over **the cut** (the 50-symbol due-strip universe), not
  the full 700-symbol analysis universe — a flagged departure from the original
  instruction. The first draft tried to get the literal 700-symbol figure by
  having a render path call `readManifest()` on the 417 KB manifest, and
  `check-sec-daily-index`'s committed guard correctly failed the run: only two
  routes are allowed to read that value, and a render path isn't one of them.
  The fix was to change the design, not the allowlist. Getting the literal
  700-symbol figure would need a small coverage-summary key written by the
  cron — a new stored value, and a second home for a derived number
  (`claude/traps/two-validators-for-one-value.md` territory) — so that wasn't
  built speculatively.
- Verified against live production data: 29/50 due-strip-cut symbols produced
  inputs, every one of the other 21 accounted for by name (6 no-record, 1
  no-period-end, 14 no-median-lag — the 14 include the 8 FPI/6-K exclusions
  already recorded in the estimator's source). `coverageOfCut` = 84.0% against
  a 50% floor. `resolveDueStrip` → `listed` with one real entry: **MU, period
  2026-08-27, due from 2026-09-15, 26 days outstanding.**
- Mutation: 9/9 caught. `check-all`: 115/115. `tsc --noEmit` clean.
- Honest about scope: only the `listed` branch is verified against real
  production data. `none-outstanding` and `unavailable` are verified with
  forced inputs only — not reachable from current production data (something
  is always outstanding; coverage is well above the floor).

## Scope — data layer only

`getDueStripState()` now returns a real `DueStripState`. **Nothing renders it
yet.** `/earnings-calendar` still shows the old `EarningsUpcomingTicker`
component, unconnected to any of this.

## What's next — in progress

Instructed Claude Code (2026-09-22) to wire `/earnings-calendar`:

1. Decide whether to adapt or replace `EarningsUpcomingTicker.tsx` — it takes
   `UpcomingEarningsItem[]` (`symbol`, `company`, `date`, `dayLabel`), which
   doesn't match `DueEntry` (`symbol`, `periodEnd`, `dueFrom`, `expectedOn`,
   `daysOutstanding`) or the three-branch `DueStripState`. Flagged concern:
   the ticker's scrolling "Next up" marquee is forward-looking visual framing,
   which is exactly what `dueToReport.ts`'s header says a due strip must never
   look like, even with correct copy underneath. Told to confirm this before
   building, not carry the framing over by default.
2. Render the three `DueStripState` branches using the existing
   `DUE_STRIP_HEADING` / `DUE_STRIP_INTRO` / `DUE_STRIP_NONE_OUTSTANDING` /
   `DUE_STRIP_UNAVAILABLE` / `dueRowLabel()` from `dueStripState.ts` — no new
   copy invented.
3. Feed it from `data/due-strip.json`'s cut through `dueInputs.ts` (PR #507)
   into `getDueStripState()`.
4. Confirm the live `PAGE_DESCRIPTION` ("the largest companies whose results
   are not yet on file") now has something real behind it.
5. Verify against production before merging — today's `listed` branch should
   show MU at 26 days outstanding. **Not to be merged without review** — asked
   to report back with a preview link and the MU-row confirmation first.

Not yet started as of this doc. Update this file (or supersede it) once that
PR lands.
