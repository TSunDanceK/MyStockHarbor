// The "Filed earnings" tab's data shape, shared by the route-only reader
// (lib/server/dashboardEarnings.ts) and the client tab.
//
// SINCE #563 COWORK #160 (7 Oct 2026) the tab shows the stock page's own
// Earnings snapshot, so the answer is A's SecEarningsSnapshot itself. TYPE-ONLY
// import: the tab is a client component (see LatestEarningsCard's note on why).
import type { SecEarningsSnapshot } from "@/lib/server/secEarningsSnapshot";

export type DashboardEarnings = SecEarningsSnapshot | { symbol: string; available: false };

// RETIRED 7 OCT 2026 (#563 COWORK #160): FiledPeriod, the custom chart's
// per-quarter EPS / operating-margin row. Its reader disagreed with the stock
// page's snapshot (TSLA Q2 FY2026: $0.32 and 1.4% against $0.68 and 35.0%) and
// skipped the Q4s; the owner ruled one reader. Passed to A (#552) to find which
// is wrong.
