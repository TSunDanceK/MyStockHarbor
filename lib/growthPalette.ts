// THE GROWTH & MARGINS PALETTE, in one plain module (#552 COWORK #134).
//
// Shared by the earnings page's Growth & margins picture
// (app/stock/[symbol]/earnings/GrowthVisuals.tsx) and the stock page's
// Earnings snapshot tile (app/components/LatestEarningsCard.tsx), so the two
// draw sales, profit, loss and margin in the same colours and cannot drift.
//
// ITS OWN MODULE, NOT AN EXPORT OF EITHER FILE. GrowthVisuals.tsx is "use
// client": a server component (the news page renders the tile) importing a
// constant from it receives a client reference, not the object. And
// lib/growthVisuals.ts imports server code. This file imports nothing.
export const GROWTH_COLORS = {
  sales: "#3987e5",
  lastYear: "#184f95",
  profit: "#0ca30c",
  loss: "#d03b3b",
  margin: "#9085e9",
  ink: "#e2e8f0",
  muted: "#94a3b8",
  rule: "rgba(148,163,184,0.35)",
  active: "rgba(255,255,255,0.06)",
} as const;

/** The thin, lighter line joining the margin dots, under them. */
export const GROWTH_MARGIN_LINE = { width: 1.5, opacity: 0.7 } as const;
