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