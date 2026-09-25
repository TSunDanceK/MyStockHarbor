// WHICH STORED FACT SETS HAVE NO MANIFEST ENTRY? (#552 COWORK #57: TSM)
//
// A symbol outside the manifest is in no cron queue: its set is written once
// (cold path or an on-demand read) and never re-read. TSM was one. This counts
// them: SCAN the fact-set keys, compare with the manifest's symbols. Names are
// tickers only; no figure is printed. Read-only (read-only token).
//   relay task: write-manifest-gap   Redis: 1 GET + ceil(keys/1000) SCANs.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const FACTS = (src.match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const MANIFEST = (src.match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
if (!FACTS || !MANIFEST) { console.error("FATAL: key names not found"); process.exit(2); }
const manifest = await redis.get(MANIFEST);
const inManifest = new Set(Object.keys(manifest?.symbols ?? {}));
let cursor = "0", scans = 0;
const stored = new Set();
do {
  const [next, keys] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 });
  scans++; cursor = String(next);
  for (const k of keys) stored.add(k.slice(FACTS.length + 1));
} while (cursor !== "0" && scans < 200);
const off = [...stored].filter((s) => !inManifest.has(s)).sort();
const popular = new Set((fs.readFileSync("lib/server/earningsCalendar.ts", "utf8").match(/const POPULAR_SYMBOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "").match(/"([A-Z.\-]+)"/g)?.map((x) => x.slice(1, -1)) ?? []);
console.log(`manifest ${inManifest.size} symbols · stored fact sets ${stored.size} · stored with NO manifest entry ${off.length}`);
console.log(`of those, in the earnings calendar's POPULAR_SYMBOLS: ${off.filter((s) => popular.has(s)).join(" ") || "none"}`);
console.log(`POPULAR_SYMBOLS not in the manifest at all: ${[...popular].filter((s) => !inManifest.has(s)).join(" ") || "none"}`);
console.log(`off-manifest symbols: ${off.join(" ")}`);
console.log(`Redis commands: ${1 + scans}`);
