// THE /sector CARDS' EXTRA FACTS (#553 COWORK #157 item 3, #158). Pure, so
// scripts/check-sector-cards.mjs runs every rule on fixtures.
//
//   sectorMovers    "Driving it today": the 2 biggest gainers and 1 biggest
//                   decliner by last-close % among the LARGER half of the
//                   sector's constituents by tracked cap (so a micro-cap spike
//                   cannot headline the card). Only names whose bar is the
//                   card's own session count.
//   usableMedian    A's sector P/E median, shown only where the stock page's
//                   P/E line would show it (lib/peSectorLine.ts: enough peers,
//                   a stable median). Banks are already out of A's peers.
//   toneIsFresh     a stored news tone counts only while it is under 3 hours
//                   old; otherwise the chip is omitted, never shown stale.

export type Mover = { symbol: string; pct: number };

export type MoverInput = { symbol: string; pct: number | null; cap: number | null; sessionDate: string | null };

/** The rule, in words, for the card's tap note. */
export const MOVERS_RULE =
  "The two biggest gainers and the biggest decliner on the last close, among the larger half of the sector's companies by tracked market cap.";

export function sectorMovers(rows: MoverInput[], sessionDate: string | null): { gainers: Mover[]; decliners: Mover[] } {
  const capped = rows
    .filter((r) => typeof r.cap === "number" && Number.isFinite(r.cap) && r.cap > 0)
    .sort((a, b) => (b.cap as number) - (a.cap as number));
  const larger = capped.slice(0, Math.ceil(capped.length / 2));
  const moved = larger.filter(
    (r): r is MoverInput & { pct: number } =>
      r.sessionDate === sessionDate && sessionDate !== null && typeof r.pct === "number" && Number.isFinite(r.pct)
  );
  const gainers = moved.filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 2);
  const decliners = moved.filter((r) => r.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 1);
  const strip = (r: MoverInput & { pct: number }) => ({ symbol: r.symbol, pct: r.pct });
  return { gainers: gainers.map(strip), decliners: decliners.map(strip) };
}

export type MedianInput = { median: number; n: number; spreadPct: number } | null | undefined;

export function usableMedian(m: MedianInput, peerFloor: number, maxSpreadPct: number): number | null {
  if (!m || !Number.isFinite(m.median) || m.median <= 0) return null;
  if (m.n < peerFloor || m.spreadPct > maxSpreadPct) return null;
  return m.median;
}

export const TONE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export type StoredTone = { label: string; score: number; at: number };

export function toneIsFresh(t: StoredTone | null | undefined, nowMs: number): t is StoredTone {
  return Boolean(t && typeof t.label === "string" && t.label && Number.isFinite(t.at) && nowMs - t.at >= 0 && nowMs - t.at < TONE_MAX_AGE_MS);
}

/** "Above their 200-day average: X of N", or null when no constituent has 200 bars. */
export function breadthLine(above200: number | null | undefined, n: number | null | undefined): { x: number; n: number; pct: number } | null {
  if (typeof n !== "number" || n <= 0 || typeof above200 !== "number") return null;
  return { x: above200, n, pct: (above200 / n) * 100 };
}
