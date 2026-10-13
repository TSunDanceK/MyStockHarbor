// The dashboard's per-symbol reads for the measure (#563 COWORK #134): a quote,
// no benchmarks and no news payload. Never fetches.
export async function fetchQuoteSnapshot(symbol) { return { symbol, price: 379.96, date: "2026-10-02", time: "16:00", source: "fixture", priceLabel: "Close, 2 Oct", name: `${symbol} Inc.` }; }
export async function getBenchmarksData() { return { data: null, status: 503 }; }
export async function getInternalNewsPayload() { return null; }
