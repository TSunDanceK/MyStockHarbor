// Fresh tones for all but one sector (no chip there).
import { SLUGS } from "./sector-panels.mjs";
export async function readSectorTones() {
  const now = Date.now();
  return Object.fromEntries(SLUGS.filter((s) => s !== "energy").map((s, i) => [s, { label: i % 2 ? "Slightly bullish" : "Neutral", score: 50 + i, at: now - 60_000 }]));
}
