# Pickers & Earnings daily warm-up automation (mirror)

This is a GitHub mirror of the `claude/PICKERS_EARNINGS_WARM_AUTOMATION.md` doc
kept in the Claude Project "My Stock Harbor Website".

This automation runs as a **GitHub Actions scheduled workflow** (not a Claude
scheduled task) — see `.github/workflows/pickers-warm.yml` in this repo,
merged via PR #37. Runs daily at `cron: "3 5 * * *"` UTC, hitting
`/api/jobs/warm-picker-universe` then `/api/jobs/warm-earnings` twice (120s
apart). Both endpoints are public, unauthenticated, and self-rate-limiting.
GitHub Actions was chosen over a Claude scheduled task because Claude's cloud
sandbox network policy blocks `mystockharbor.com` itself, and because relying
on the user's Chrome being open would defeat the point of unattended
automation. See the Claude Project copy for full detail and history.