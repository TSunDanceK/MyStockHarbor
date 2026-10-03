// WHICH MARGIN THE GROWTH & MARGINS CHART WOULD DRAW, ACROSS THE UNIVERSE
// (#563 COWORK #71: "measure first"). Reads only.
//
// For every registrant with a stored fact set, run A's shipped
// buildSecEarningsView and C's shipped buildGrowthVisuals and count, for the
// quarters and for the years, which measure the third chart draws:
//   gross       at least one period has a gross margin filed (today's chart)
//   operating   no gross margin in any period: operating margin instead (ORCL)
//   none        neither: no chart, a reason line
// each split by whether any period draws below 0% (owner, 3 Oct: the scale moves down),
// plus how many of the non-gross filers are banks (SIC 6000–6299) and up to 15
// symbols per bucket. SEC-derived values only.
//   relay task: write-margin-kind-census (credentialled for the read)
//   Redis cost: one MGET per 25 registrants (~105 MGET for 2,610), once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { buildSecEarningsView } = await import("../lib/server/secEarningsView.ts");
const { buildGrowthVisuals } = await import("../lib/growthVisuals.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const SYMS = Object.keys(REG).sort();
const bank = (s) => { const sic = Number(REG[s]?.sic); return sic >= 6000 && sic <= 6299; };

const tally = { quarters: new Map(), years: new Map() };
const add = (mode, kind, s) => { const m = tally[mode]; m.set(kind, [...(m.get(kind) ?? []), s]); };
let read = 0, mgets = 0, noSet = 0, failed = 0;
for (let i = 0; i < SYMS.length; i += 25) {
  const chunk = SYMS.slice(i, i + 25);
  const got = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  mgets++;
  chunk.forEach((s, j) => {
    const set = got[j];
    if (!set || !Array.isArray(set.quarters)) { noSet++; return; }
    read++;
    try {
      const view = buildSecEarningsView(set);
      const data = buildGrowthVisuals(view, { oneOffs: view.oneOffs ?? {}, unchecked: view.oneOffUnchecked });
      for (const mode of ["quarters", "years"]) {
        const sr = data[mode];
        if (!sr || !sr.periods.length) { add(mode, "no series", s); continue; }
        const neg = sr.periods.some((p) => (sr.margin.kind === "operating" ? p.opPct : p.grossPct) < 0);
        add(mode, `${sr.margin.kind}${neg ? " (some below 0%)" : ""}`, s);
      }
    } catch (e) { failed++; console.log(`  ${s}: view failed: ${String(e).slice(0, 120)}`); }
  });
}
console.log(`\nRegistrants ${SYMS.length} · stored sets read ${read} · none stored ${noSet} · view failures ${failed} · Redis: ${mgets} MGET\n`);
for (const mode of ["quarters", "years"]) {
  console.log(`== ${mode}`);
  for (const [kind, syms] of [...tally[mode]].sort((a, b) => b[1].length - a[1].length)) {
    const banks = syms.filter(bank).length;
    console.log(`  ${kind.padEnd(36)} ${String(syms.length).padStart(5)}  (banks ${banks})  e.g. ${syms.slice(0, 15).join(", ")}`);
  }
}
