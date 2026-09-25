# COWORK #45 follow-ups (throwaway, not for merge)

## 1. Interactive chart profile (main at 18056251: #605, #606, #611 in)
Local `next dev` (dev React is slower than production), Chromium 1440px, AAPL daily.
- rAF calls counted by wrapping window.requestAnimationFrame; CPU from CDP Performance.getMetrics
  (TaskDuration/ScriptDuration deltas); long tasks and Event Timing (durationThreshold 16ms) from PerformanceObserver.
- interactive-profile.txt: every idle window (5s) and click.
Summary: idle = 0 rAF calls, ~2-3ms main-thread work per 5s, 0 long tasks, in every idle state
(loaded, mouse resting on chart, after a click, measure on screen, after W). Worst click = 32ms (% chip,
right-click menu), 0 long tasks. Budget was 200ms.

## 2. /dashboard hydration (#614)
/dashboard?symbol=AAPL and /dashboard in NY, LA, London, Tokyo, UTC (en-US/en-GB/ja-JP), benchmark
payload seeded in the local Redis stand-in. main 2/10 loads free of hydration errors; #614 10/10.
London on main: server "9/24/2026, 11:39:53 PM" vs client "25/09/2026, 00:39:53" (the #418 Cowork saw);
NY/LA on main: chart axis 06/07 (client) vs 06/08 (server).
