// DOES THE STORED-FACT-SET INDEX MATCH WHAT IS STORED? (#552 COWORK #59)
//
// The daily index trusts msh:sec:facts:index:v1 to name every stored set. A
// write path that forgets the SADD, or a delete that forgets the SREM, shows up
// here as a mismatch. Also reports DBSIZE, so the real cost of a SCAN (keys
// / COUNT, not matches / COUNT) is stated, and the manifest's dot/dash
// duplicates (one security, two entries). Tickers and counts only.
// Read-only (read-only token). Weekly or on demand.
//   relay task: write-fact-set-index-drift
//   Redis: 1 DBSIZE + 1 SMEMBERS + 1 GET + ceil(DBSIZE / 1000) SCANs.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { toDashed, toDotted } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (src.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = pick("SEC_FACTS_PREFIX"), INDEX = pick("SEC_FACTS_INDEX_KEY"), MANIFEST = pick("SEC_MANIFEST_KEY");
if (!FACTS || !INDEX || !MANIFEST) { console.error("FATAL: key names not found"); process.exit(2); }

const dbsize = await redis.dbsize();
const indexed = new Set((await redis.smembers(INDEX)).map(String));
const manifest = await redis.get(MANIFEST);
let cursor = "0", scans = 0;
const stored = new Set();
do {
  const [next, keys] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 });
  scans++; cursor = String(next);
  for (const k of keys) stored.add(k.slice(FACTS.length + 1));
} while (cursor !== "0");

const notIndexed = [...stored].filter((s) => !indexed.has(s)).sort();
const notStored = [...indexed].filter((s) => !stored.has(s)).sort();
const inManifest = new Set(Object.keys(manifest?.symbols ?? {}));
const noEntry = [...stored].filter((s) => !inManifest.has(s) && !inManifest.has(toDotted(s)) && !inManifest.has(toDashed(s))).sort();
const dupes = [...inManifest].filter((s) => s.includes("-") && inManifest.has(toDotted(s))).sort();

console.log(`DBSIZE ${dbsize} keys · a full SCAN at COUNT 1000 = ${scans} commands (keys / 1000, not matches / 1000)`);
console.log(`stored fact sets ${stored.size} · index members ${indexed.size} · manifest ${inManifest.size}`);
console.log(`stored but NOT indexed ${notIndexed.length}${notIndexed.length ? `: ${notIndexed.join(" ")}` : ""}`);
console.log(`indexed but NOT stored ${notStored.length}${notStored.length ? `: ${notStored.join(" ")}` : ""}`);
console.log(`stored with no manifest entry (any dot/dash spelling) ${noEntry.length}${noEntry.length ? `: ${noEntry.join(" ")}` : ""}`);
console.log(`manifest dot/dash duplicates ${dupes.length}${dupes.length ? `: ${dupes.map((d) => `${toDotted(d)}/${d}`).join(" ")}` : ""}`);
console.log(`DRIFT ${notIndexed.length + notStored.length === 0 ? "none" : notIndexed.length + notStored.length}`);
console.log(`Redis commands: ${3 + scans}`);
