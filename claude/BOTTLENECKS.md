# MyStockHarbor — Bottlenecks Page Workflow (mirror of Claude Project doc)

This is a GitHub mirror of the `claude/BOTTLENECKS.md` doc kept in the Claude
Project "My Stock Harbor Website", so it's readable from GitHub (e.g. mobile)
without opening Claude. The Claude Project copy is the one that's actively
edited — treat this as a reference mirror, and re-sync it here if the project
copy changes materially.

Key facts as of 2026-07-09:
- `/bottlenecks` shows supply-chain dependency + customer-concentration pie
  charts per stock, content in `content/bottlenecks/{slug}.md`.
- Daily automation (separate scheduled task) builds/refreshes **5 pages/day**,
  priority order from `BOTTLENECK_QUEUE.md`. This was explicitly left
  **unchanged** by the 2026-07-09 Insights cutback (5→2 posts/day) — the
  Bottlenecks pipeline still does 5/day.
- Full schema, ticker-availability policy, note-override pattern, and
  step-by-step build process are documented in the Claude Project copy of
  this file — read that for the authoritative, up-to-date version.