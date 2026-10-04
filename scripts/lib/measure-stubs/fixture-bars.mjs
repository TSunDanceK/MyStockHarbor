// Deterministic weekday bars to Fri 2 Oct 2026, for the browser measures only.
// [date, open, high, low, close, volume]; an index-ETF-like level and wave.
export function fixtureBars(level = 560, from = "2024-10-01") {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = level + (level / 9) * Math.sin(i / 37) + (level / 30) * Math.sin(i / 6.1) + i * (level / 2200);
    out.push([d.toISOString().slice(0, 10), b, b * 1.006, b * 0.994, b * 1.001, 6e7 + (i % 7) * 4e6]);
    i++;
  }
  return out;
}
