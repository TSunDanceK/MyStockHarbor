// A fixture Market Mood series (scores only), so the card renders its face.
export async function readMarketMood() {
  const days = [];
  const start = Date.parse("2026-05-20T00:00:00Z");
  for (let i = 0, t = start; days.length < 100; t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const r = Math.round(50 + 20 * Math.sin(i++ / 9));
    days.push({ d: d.toISOString().slice(0, 10), r, n: 5, s: { momentum: r, strength: r, breadth: r, volatility: r, safeHaven: r } });
  }
  return { v: 1, asOf: days[days.length - 1].d, days };
}
