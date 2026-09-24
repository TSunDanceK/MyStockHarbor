# COWORK #42 follow-up: Interactive chart dates only, in UTC (throwaway, not for merge)

Rendered locally (`next dev`, real AAPL bars from a read-only Redis stand-in), browser time zone set per run.
Every date string the chart draws (tooltip "Time:", crosshair label, axis) was read from the canvas.

| Viewer zone | main | this PR |
|---|---|---|
| Europe/London | "2026-09-23 01:00" (D), times on W/M too | "2026-09-23", no times on D/W/M |
| America/New_York | "2026-09-22 20:00": the PREVIOUS day | "2026-09-23" |

Rendered test: this PR 8/8, main 1/8.
- before-*-daily-tooltip.png / after-*-daily-tooltip.png for each zone.
