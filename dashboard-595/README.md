# #595 wide-chart toggle: screenshots per chart mode (desktop, 1440px)

Rendered locally from #595's branch head 27b8b405 against a read-only fixture of the cached AAPL daily history (1,271 bars to 2026-09-23). The preview itself could not be shot: the repository has no VERCEL_AUTOMATION_BYPASS_SECRET Actions secret.

- Basic: dashboard-basic-normal.png, dashboard-basic-wide.png
- Interactive: dashboard-interactive-normal.png, dashboard-interactive-wide.png
- TradingView: dashboard-tradingview-normal.png, dashboard-tradingview-wide.png

Rendered test 16/16 PASS. Basic re-measured (viewBox 760 -> 1103, height 470 -> 471px); Interactive canvas 768 -> 1144px; TradingView container 828 -> 1204px (tv.js is refused in the sandbox, so its frame is empty). The red '1 Issue' badge is Next's dev overlay reporting those blocked loads.
