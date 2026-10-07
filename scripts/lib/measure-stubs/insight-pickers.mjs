// The pickers payload for the insight page's measure (#563 COWORK #133): a few
// symbols' flags only, so the "Showing up in screens" card has chips. Never builds.
const records = [
  { symbol: "AMZN", aboveMA200: true, dailyMa200Proximity: true, positiveLastEarnings: true, aboveMA50: true },
  { symbol: "RIOT", volumeSpike: true, belowMA50: true, bullishRsiDivergence: true },
  { symbol: "AAPL", aboveMA50: true, aboveMA200: true },
];
export async function getPickersData() { return { signalRecords: records }; }
export async function readPickersSymbolsIfCached() { return records.map((r) => r.symbol); }
