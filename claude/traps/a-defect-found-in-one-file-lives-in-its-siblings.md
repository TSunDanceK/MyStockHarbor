# A defect found in one file is still live in its siblings

Found 2026-09-12. The most useful of the five traps recorded that day, because it
is the one that would have prevented the other four from mattering.

## What happened

The 2026-08-27/28 outage was diagnosed correctly and completely: every cache was
empty, and *"a request that loses the lock only short-circuits if a cached payload
exists"*, so every concurrent request fell through and ran its own full build.
#377/#378 fixed it by adding `waitForPickersPayload()` — a lock loser with nothing
cached waits for the winner to publish rather than building its own copy.

The fix was applied to `pickersBuilder.ts`, which is where the bug was found. It
was not applied to `playsBuilder.ts`, `bullFlagsBuilder.ts` or
`descendingTrianglesBuilder.ts`, which are near-identical siblings with the same
lock-loser shape, the same ~700-symbol build behind it, and the same cold-cache
window. **Twelve days later all three were still unfixed, and nothing had flagged
them** — not a check, not a review, not the outage post-mortem.

`pickersBuilder` references `waitForPickersPayload` five times. The three siblings
contain **zero** wait-for-winner of any kind. See
`claude/plays-builders-missing-single-flight-2026-09-12.md`.

## Why nothing caught it

Each of the normal safety nets was looking at the wrong unit:

- **The three builders all take an NX lock.** A reviewer scanning for "is there a
  lock" finds one in every file and stops. The lock was never the missing piece;
  the wait was.
- **The post-mortem described the mechanism, not its extent.** It named the shape
  precisely and never asked how many files had it — so it reads as fully closed.
- **The fix is invisible by absence.** A missing wait has no symptom on a warm
  cache, which is every day until it is not.
- **These files are known to be near-duplicates and that made it worse, not
  better.** `presetUniverse.ts` exists because the same four builders held four
  byte-identical copies of one list. The duplication was already documented as a
  hazard, in a file written to fix an instance of it.

## The rule

- **Fixing a defect is not done when the file is fixed. It is done when the
  shape has been searched for everywhere it could exist.** One `grep` for the
  distinguishing token — here `waitFor`, across `lib/server/*Builder.ts` — takes
  seconds and is the whole check.
- **Sibling files are the first place to look, and near-duplicates are the
  highest risk.** Code that was copied carries its bugs to every copy, and
  whatever made the original worth copying makes the bug worth having in each.
- **Write the search into the fix, not the prose.** A post-mortem that names a
  mechanism should say which files were checked for it and which were found
  clean, because "we fixed it" and "we fixed it here" are indistinguishable
  twelve days later.

Adjacent to `claude/traps/two-validators-for-one-value.md` and to the
consolidation argument in `lib/server/presetUniverse.ts`: both are about the same
logic existing in several places with nothing holding the copies in step. This
one is the version where the drift is a live defect rather than a stale value.
