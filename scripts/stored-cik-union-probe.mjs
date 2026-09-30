// READS ONLY: the CIK of every stored fact set that is NOT a registrants.json
// CIK (#552 COWORK #71 — the archive universe becomes registrants ∪ stored-set
// CIKs). Prints SYMBOL:CIK pairs (SEC identifiers, no values) and names any
// stored set with no CIK at all. Redis: 1 SMEMBERS + 1 GET.
//   relay task: write-stored-cik-union
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (src.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const INDEX = pick("SEC_FACTS_INDEX_KEY"), MANIFEST = pick("SEC_MANIFEST_KEY");
if (!INDEX || !MANIFEST) { console.error("FATAL: key names not found"); process.exit(2); }
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const regCiks = new Set(Object.values(REG).map((r) => String(r.cik).padStart(10, "0")));
const symbols = (await redis.smembers(INDEX)).map(String).sort();
const manifest = (await redis.get(MANIFEST)) ?? { symbols: {} };
const outside = [], noCik = [];
for (const s of symbols) {
  const c = manifest.symbols?.[s]?.cik ?? REG[s]?.cik ?? null;
  if (!c) { noCik.push(s); continue; }
  const cik = String(c).padStart(10, "0");
  if (!regCiks.has(cik)) outside.push(`${s}:${cik}`);
}
console.log(`stored sets ${symbols.length} · registrant CIKs ${regCiks.size} · outside ${outside.length} · distinct CIKs outside ${new Set(outside.map((p) => p.split(":")[1])).size} · no CIK ${noCik.length}`);
console.log(`OUTSIDE ${outside.join(" ")}`);
console.log(`NOCIK ${noCik.join(" ")}`);
console.log("Redis commands: 2");
