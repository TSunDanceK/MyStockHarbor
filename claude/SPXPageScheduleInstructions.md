# MyStockHarbor — SPX Market Page Scheduled Task (mirror)

This is a GitHub mirror of the `claude/SPXPageScheduleInstructions.md` doc kept
in the Claude Project "My Stock Harbor Website". Read the Claude Project copy
for the full stored prompt text.

Summary: a weekly (Mondays, 6am UTC) scheduled task refreshes the hardcoded
market-commentary text on `/markets/spx` (`app/markets/spx/page.tsx`) — the
price chart, market-mood gauge, and AI market-backdrop section are already
live-computed and don't need this. Trigger name: "MyStockHarbor Weekly SPX
Page Refresh (Full Auto)", trigger ID `trig_01BBjBhnodwN49JZ2cRryvcr` as of
2026-07-09. Unlike the Insights pipeline, this waits for a successful Vercel
preview build before merging (higher risk of a JSX syntax break since it edits
an existing page rather than adding a new content file). Not affected by the
2026-07-09 Insights 5→2 posts/day change.

The weekly QQQ refresh (`/markets/qqq`, file `content/markets/qqq-weekly.json`)
runs the same way and follows the same merge rule below.

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
