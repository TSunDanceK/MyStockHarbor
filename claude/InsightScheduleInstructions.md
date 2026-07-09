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