import { SLUGS } from "./sector-panels.mjs";
export async function getSectorConstituentCounts() {
  return Object.fromEntries(SLUGS.map((s, i) => [s, 40 + i * 3]));
}
