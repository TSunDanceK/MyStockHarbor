# MyStockHarbor — Insight Post Scheduled Task (backup reference)

This file is a standalone backup of the scheduled task ("Routine") that runs the
daily automated Insight post pipeline, saved outside chat history so it survives
even if this conversation gets archived or too long to reference.

---

## Current schedule config (as of 2026-07-09, updated same day: 5/day → 2/day)

- **Trigger name:** MyStockHarbor Daily Insight Posts x2 (Full Auto)
- **Trigger ID:** `trig_017iUyXG3Q7Wm4UjgrZEHmYw`
- **Cron:** `0 6 * * *` (6:00 AM UTC daily — adjust for UK BST/GMT drift at the
  March/October clock changes if 7am UK time needs to stay exact)
- **Environment ID:** `env_011111111111111111111117`
- **Notifications:** push enabled, email off
- **Created:** 2026-07-09, via this Claude project's chat (`created_via: meta_mcp`)

**History:** this replaces two earlier triggers that no longer exist —
`trig_01LmfgXov4YRL2cKmSWcS74K` (an original 1-post/day version, documented
in an earlier revision of this file but superseded before this file was kept
in sync) and `trig_014Uu7GiSCtDCqMiJ137bgpa` ("x5", 5 posts/day, deleted
2026-07-09 when this 2-post version was created). If you ever see a trigger
ID in old notes that doesn't match the one above, assume it's stale — check
`list_triggers` for what's actually live.

**Connector permissions — check this on any newly (re)created trigger:**
GitHub write tools (`create_branch`, `create_or_update_file`,
`create_pull_request`, `merge_pull_request`) need an **Always allow** policy
set on the `Git_Hum_Connector` for this routine (Settings → Connectors, or
the routine's own Connectors/Permissions tab at claude.ai/code/routines) —
otherwise a run can stall for hours waiting on a permission prompt nobody's
there to answer.

See the Claude Project doc of the same name for the full stored prompt text.

## Note: the Bottlenecks daily automation is separate and unaffected

The `/bottlenecks` pipeline (5 pages/day) is a different scheduled task and was
**not** changed by the 2026-07-09 cutback described here — see `BOTTLENECKS.md`
and `BOTTLENECK_QUEUE.md`.

## Scheduled runs may squash-merge their own content PRs (2026-11-03)

The insight, bottleneck, SPX and QQQ scheduled runs are **allowed to
squash-merge their own content PR** with
`mcp__GitHub_-_Account_2__merge_pull_request`, the only tool they use to merge.
Allowing the merge does not change the gates in front of it. A run merges only
after:

1. **The fact-check passes.** The independent fact-check subagent has to come
   back clean on its second pass (0 WRONG, 0 UNVERIFIABLE).
2. **The Vercel preview is green.** The preview deployment for the PR head has
   to be READY, and every GitHub check on that head has to pass.

If either gate fails, the run leaves the PR open and notifies instead of
merging. Interactive engineering sessions do not merge their own PRs. The
owner merges those.

**Why this is here.** Auto mode's classifier refused the final merge on #967
and #975 ("Merge Without Review") but let #971 and #974 through. The merge was
the only GitHub write that went to the classifier at all.
`create_branch`, `create_or_update_file` and `create_pull_request` are
accepted by a permission rule, so they never reach it. A matching allow rule
is resolved before the classifier, according to Claude Code's permission-modes
docs ("Actions matching your allow, ask, or deny rules resolve immediately"),
and merging is not one of that page's listed exceptions.

**Where the rule has to live.** `.claude/settings.json` in this repo carries
the allow rule, but a session reads it only when it has this repository checked
out. The scheduled runs observed on 2026-11-03 had no checkout: they work in
`/home/claude` and reach the repo through the GitHub connector. For those runs
the rule that counts is the **GitHub - Account 2 connector's "Always allow"
setting for `merge_pull_request`** (claude.ai → Settings → Connectors), the
same setting the other three write tools already have. The first scheduled
run after the change is the test: its merge call should show as accepted by a
rule, not by the classifier.
