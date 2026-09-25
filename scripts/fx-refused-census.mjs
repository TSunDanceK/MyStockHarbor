// WHICH STORED NON-USD SETS STILL REFUSE PERIODS FOR WANT OF A RATE (#552
// COWORK #51). Those are the sets conversionGained (#616) can rewrite on their
// next re-read, but only where a rate now exists for the refused periods. Reads only.
// Scope: every 20-F / 40-F / no-form registrant (10-K filers report in USD).
//   relay task: write-fx-refused-census
//   Redis cost: 1 MGET per 50 symbols (~10 commands).
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = Object.entries(REG).filter(([, r]) => r.annualForm !== "10-K" && r.annualForm !== "10-KT").map(([s]) => s);
// The currencies FRED serves after #615 (read from the shipped map, not restated).
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const fredCcy = new Set([...fxSrc.matchAll(/^\s+([A-Z]{3}): \{ id: "DEX[A-Z]+"/gm)].map((m) => m[1]));
let commands = 0, stored = 0, nonUsd = 0, withRefused = 0;
const byCcy = new Map();
for (let i = 0; i < syms.length; i += 50) {
  const batch = syms.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${FACTS}:${s}`));
  commands++;
  batch.forEach((s, j) => {
    const set = sets[j];
    if (!set) return;
    stored++;
    const cur = set.cur ?? "USD";
    if (cur === "USD") return;
    nonUsd++;
    const refused = set.fx?.refused ?? [];
    const row = byCcy.get(cur) ?? { sets: 0, refusing: [], empty: 0 };
    row.sets++;
    const periods = (set.quarters?.length ?? 0) + (set.years?.length ?? 0);
    if (!set.fx && periods === 0) row.empty++;
    if (refused.length) { withRefused++; row.refusing.push(`${s}(${refused.length})`); }
    byCcy.set(cur, row);
  });
}
console.log(`scope ${syms.length} 20-F/40-F/unknown-form registrants; ${stored} stored; ${nonUsd} non-USD; ${withRefused} with refused periods`);
console.log(`FRED currencies now: ${[...fredCcy].sort().join(" ")}`);
for (const [ccy, r] of [...byCcy].sort((a, b) => b[1].sets - a[1].sets)) {
  console.log(`  ${ccy}${fredCcy.has(ccy) ? " [FRED]" : " [ECB cross]"}: ${r.sets} sets, ${r.empty} stored empty (no series), ${r.refusing.length} refusing${r.refusing.length ? ": " + r.refusing.join(" ") : ""}`);
}
console.log(`Redis commands: ${commands}`);
