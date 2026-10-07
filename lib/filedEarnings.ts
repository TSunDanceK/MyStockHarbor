// The "Filed earnings" tab's data shape (#563 COWORK #154 §6), shared by the
// route-only reader (lib/server/dashboardEarnings.ts) and the client chart.

export type FiledPeriod = {
  /** A's label ("Q2 FY2026") and its axis form ("Q2 '26"). */
  label: string;
  short: string;
  /** Diluted EPS as filed (split-adjusted), and its text. */
  eps: number;
  epsText: string;
  /** Operating margin, whole %, or null where A's rule draws none. */
  opPct: number | null;
  opText: string | null;
};

export type DashboardEarnings =
  | { symbol: string; available: true; many: string; periods: FiledPeriod[] }
  | { symbol: string; available: false };
