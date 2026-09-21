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

**Not satisfiable for the bars-migration spec.** The 2026-09-21 message carried
a placeholder — `[PASTE FULL TEXT OF ... §1 here`— followed by a bracketed
summary, not the document. What is known from that summary is recorded in
`claude/bars-migration-SUMMARY-2026-09-21.md` and is explicitly labelled as a
second-hand summary, not the spec.
