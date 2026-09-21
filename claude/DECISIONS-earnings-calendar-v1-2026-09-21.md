# /earnings-calendar v1 — owner decisions, 2026-09-21

Mirrored into the repo per the standing rule that a Project doc used by a build
is committed alongside the work that uses it. Two docs have already been lost to
that gap (`HANDOFF-earnings-calendar-v1-2026-09-17`,
`BUILD-BRIEF-earnings-calendar-v1-2026-09-15`) plus
`dashboard-off-fmp-scoping-2026-09-12`, none of which exist here or anywhere
reachable from a session.

## 1. FPI market cap — SUPPRESS

For **HDB, IBN, TSM, BABA, ASML**: stay in the list, sort to the bottom under
nulls-last, show **no market cap** rather than the wrong shares x price figure.

Computing a cap from SEC shares x price is wrong for ADS ratios (TSM is 1 ADS =
5 ordinary), so the number would be plausible and wrong — worse than absent.

**This is the existing mutant `stage 4: FPI market-cap suppression removed`.**
When the suppression is implemented, that mutant must be the one that catches
its removal. Do not add a new mutant for it — the brief's ten are the
denominator, and adding an eleventh to cover work that mutant already names
would inflate coverage while covering nothing new.

## 2. Consensus freeze — COMMIT (DONE 2026-09-21)

Committed at `data/consensus/fmp-consensus-freeze.json`, 5,519,554 bytes,
recovered from relay artifact `relay-consensus-freeze-34941546535` (run
34941546535, 2026-09-15) by `.github/workflows/consensus-freeze-commit.yml`,
because a Claude session cannot reach the artifact store (403 CONNECT,
organization policy — see `scripts/lib/relay-capture.mjs`).

Verified three ways before and after landing: exact byte count, a re-count of
1,234 symbols / 123,242 rows / 97,259 carrying an estimate against what the
producing run printed, and header-vs-body agreement. The job refuses to commit
on any mismatch.

## 3. PR #485 — MERGE (DONE 2026-09-21, squashed as 43be297)

## 4. Project-doc mirroring — STANDING RULE

When a claude.ai Project doc is pasted into context, commit it verbatim to
`claude/<same-filename>` before or alongside the work that uses it.

**RESOLVED 2026-09-21 (later same day).** The spec arrived verbatim and is
mirrored at `claude/dashboard-off-fmp-scoping-2026-09-12.md`. The interim
second-hand summary has been deleted rather than left beside it — two files on
one subject at different fidelities is how the wrong one gets cited.

---

# Owner decisions, later on 2026-09-21

## 5. Whole-market bars + stage 5 (dynamic top-50) — OFF THE ROADMAP

**Closed, not deferred.** No budget for a paid bars source — Tiingo and the
others were declined 2026-09-12 and that was reconfirmed on 2026-09-21. The free
route is gone rather than licence-ambiguous: Stooq was eliminated from **three
independent egress paths** (a GitHub Actions runner, a residential UK browser,
and Vercel `iad1`), so it is not a datacentre-IP problem, not a rate limit, and
not a retry candidate.

Consequences already applied:

- `scripts/due-strip-universe.mjs` — the static top-50 is **permanent** (§6
  below). Its stage-5 replacement language is removed, not softened.
- Brief mutants **#1** and **#3** become **permanently inapplicable**. They are
  kept in the denominator and reported separately by
  `scripts/check-brief-mutants.mjs` — see that file's header for why netting
  them out would be a coverage lie.
- Stage 4 (price + market cap) is re-scoped to the existing 700-symbol analysis
  universe, with cells **hidden** rather than dashed for anything outside it.

**This closure still needs recording in
`claude/HANDOFF-earnings-calendar-v1-2026-09-21.md`, which does not exist —
see below.**

## 6. Due strip — the static top-50 is PERMANENT

Not an interim v1 simplification. Regeneration stays periodic with the
generation date visible in the file; no live ranking is coming.

## 7. Doc loss, fourth occurrence — STILL OPEN

`HANDOFF-earnings-calendar-v1-2026-09-21` was to be mirrored here verbatim. The
paste carried a placeholder directing a session to pull it from the claude.ai
Project or to ask the operator, and **a Claude Code sandbox session has no
Project access** — so it was not mirrored, and deliberately not reconstructed
from memory, which the placeholder also forbids.

`BUILD-BRIEF-earnings-calendar-v1-2026-09-15` is mirrored **§9 only**, which is
what was supplied. Its header says so and refuses to stand in for the rest.

`scripts/check-doc-citations.mjs` has been **red on `main`** on every run this
session for four dangling IPO-doc citations. The detector for this class of loss
already exists and is being run past.
