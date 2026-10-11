// "LEVELS TO WATCH" (#563 COWORK #93): a few lines under Key levels on the SPX
// page, read off the SAME zones the Price zones card shows (lib/ta/confluence.ts
// over the same bars and inputs), so the two can never disagree. No weekly input.
//
//   inside     when the price sits in a zone, the first line says so
//   main       the shown zone with the most levels; a tie goes to the nearer one
//   nearest    the nearest zone above and below, each only if it isn't the main
//
// Prices are the zone's midpoint in the cards' price format; distances are the
// cards' own (to the zone's nearer edge). Descriptive only: no forecast, no advice.
import { priceWords } from "./keyLevels";
import { countWords, zoneDistance, type Confluence, type Zone } from "./confluence";

export type GlanceSide = "above" | "below" | "inside";
export type GlanceLine = { kind: "inside" | "main" | "nearAbove" | "nearBelow"; side: GlanceSide; lead: string | null; text: string; zone: Zone };

/** "around $763", the zone's midpoint. */
export const aroundWords = (z: Zone) => `around ${priceWords((z.lo + z.hi) / 2)}`;

/** The price's distance to a zone's nearer edge, as a fraction; 0 inside. */
export function zoneGap(z: Zone, price: number): number {
  if (z.lo <= price && price <= z.hi) return 0;
  return Math.abs((z.lo > price ? z.lo : z.hi) - price) / price;
}

/** The shown zone with the most levels; a tie goes to the nearer one. */
export function mainZone(c: Confluence): Zone | null {
  if (c.price === null) return null;
  const shown = [...(c.inside ? [c.inside] : []), ...c.above, ...c.below];
  let best: Zone | null = null;
  for (const z of shown) if (!best || z.count > best.count || (z.count === best.count && zoneGap(z, c.price) < zoneGap(best, c.price))) best = z;
  return best;
}

/** The card's lines, in order; empty when the Price zones card shows none. */
export function glanceLines(c: Confluence): GlanceLine[] {
  const price = c.price, main = mainZone(c);
  if (price === null || !main) return [];
  const side = (z: Zone): GlanceSide => (z === c.inside ? "inside" : z.lo > price ? "above" : "below");
  const out: GlanceLine[] = [];
  if (c.inside) out.push({ kind: "inside", side: "inside", lead: null, text: `The price is inside a zone of ${countWords(c.inside)} ${aroundWords(c.inside)}.`, zone: c.inside });
  if (main !== c.inside) {
    const around = aroundWords(main);
    out.push({ kind: "main", side: side(main), lead: around[0].toUpperCase() + around.slice(1), text: `: ${countWords(main)} cluster here, ${zoneDistance(main, price)} the last price.`, zone: main });
  }
  const near = (z: Zone | undefined, kind: "nearAbove" | "nearBelow", word: string) => {
    if (z && z !== main) out.push({ kind, side: side(z), lead: `Nearest ${word}:`, text: ` ${aroundWords(z)} (${countWords(z)}, ${zoneDistance(z, price)}).`, zone: z });
  };
  near(c.above[0], "nearAbove", "above");
  near(c.below[0], "nearBelow", "below");
  return out;
}
