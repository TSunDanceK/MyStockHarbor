// A's medians, keyed by sector label; Financial Services has none (banks out).
export async function readPeSectorMedians() {
  return { asOf: "2026-10-02", sectors: { Technology: { median: 31.2, n: 120, spreadPct: 8 }, Healthcare: { median: 24.5, n: 80, spreadPct: 10 }, Energy: { median: 12.1, n: 30, spreadPct: 12 } } };
}
