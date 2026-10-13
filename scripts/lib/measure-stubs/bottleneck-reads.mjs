// The Bottleneck page's reads for its measure (#563 COWORK #158): a newest bar
// for any symbol (illustrative closes) and a filed snapshot, so every card
// draws. Never reads Redis.
export * from "../../../lib/server/marketData/read.ts";
const bar = (sym) => { const h = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0); const c = 50 + (h % 400); return { d: "2026-10-06", o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6, pc: c * (1 - ((h % 7) - 3) / 100), w: null, m: null, y: null, a50: null, a200: null }; };
export const readTiingoEodLast = async () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? bar(k) : undefined) });
export const getSecEarningsSnapshot = async (symbol) => ({
  symbol, available: true, basis: "quarter", periodLabel: "Q2 FY2026",
  revenue: { value: 2.75e9 }, revenueYoY: { kind: "pct", value: 33.1 },
  margins: { gross: 60.4, operating: 4.2, net: 3.1 }, yearAgo: { label: "Q2 FY2025", eps: 0.3, gross: 62.1, operating: 3.0 },
});
// A's filed-earnings gate (#552 COWORK #197): every listed symbol but SKHY (an empty set on main).
export const filedEarningsGate = async () => (symbol) => !!symbol && symbol !== "SKHY";
