// ARE THE STORED FACT SETS STILL READABLE? Reads only.
//
// readFactSet() discards a set whose `h` differs from secFieldsHash() -- the
// positional-field gate. A change to SEC_FIELD_KEYS would null every stored
// set at once and every stock page would render "no SEC data". This reads each
// stored set's `h` against the shipped hash, and runs the shipped gate for the
// named symbols.
//   relay task: write-sec-factset-readability
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const fields = await lift(readCodeOnly("lib/server/secFields.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1") + "\nexport { secFieldsHash, secChainsHash };", "", "secFields");
const H = fields.secFieldsHash();
const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
console.log(`shipped secFieldsHash ${H} · chains ${fields.secChainsHash()} · ${symbols.length} manifest symbols\n`);

const byH = {};
let absent = 0, readable = 0, gated = 0;
const gatedList = [];
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`));
  sets.forEach((raw, j) => {
    if (!raw || typeof raw !== "object") { absent++; return; }
    byH[raw.h] = (byH[raw.h] ?? 0) + 1;
    // THE SHIPPED GATE, verbatim: readFactSet returns null on either of these.
    if (raw.h !== H || !Array.isArray(raw.quarters)) { gated++; gatedList.push(batch[j]); }
    else readable++;
  });
}
console.log(`stored sets: readable ${readable} · discarded by the gate ${gated} · absent ${absent}`);
console.log(`by h: ${JSON.stringify(byH)}`);
if (gatedList.length) console.log(`gated: ${gatedList.slice(0, 60).join(" ")}`);
for (const s of ["TSLA", "ABBV", "MU", "AAPL"]) {
  const raw = await redis.get(`${PREFIX}:${s}`);
  const ok = raw && raw.h === H && Array.isArray(raw.quarters);
  console.log(`  ${s.padEnd(5)} readFactSet -> ${ok ? `SET (h ${raw.h}, ${raw.quarters.length} quarters, newest ${raw.quarters.map((p) => p.e).sort().pop()}, lv ${raw.lv}, c ${raw.c})` : `NULL (h ${raw?.h ?? "absent"})`}`);
}
