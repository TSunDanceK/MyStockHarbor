// THE SEC COVERAGE CENSUS (#552 COWORK #157 §1). Reads only.
//
// The strength badge's earnings input is "none" on a stock with no stored SEC
// set. Before any schedule changes: how many of the universe the stock pages
// and Pickers serve have no set, why, and which queue (if any) would fill them.
//
//   universe   what warm-pickers-sec reads: the warm targets plus the Tiingo
//              universe (the same union, the same order)
//   eligible   a CIK in the committed ticker file and not refused by the seed
//              gate (secSeedRefusal: etf, non-equity, security-kind)
//   stored     a member of the fact-set index (dot/dash spellings matched)
//   manifest   an entry in the SEC manifest; only entries are in any cron queue
//              (populate takes an entry with no contentHash yet)
// Also the projected manifest size if every eligible symbol were seeded.
// Prints counts only, no symbol list.
//
//   relay task: write-sec-coverage-census (READ-ONLY despite the prefix: the
//   credentials live in that job). Redis: 2 GET + 1 GET + 1 SMEMBERS + 1 ZCARD.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
// The warm-targets keys, read from their source: warmTargets.ts imports the
// pickers builder (next/server), which bare node cannot load.
const wtSrc = fs.readFileSync("lib/server/warmTargets.ts", "utf8");
const keyOf = (name) => { const m = wtSrc.match(new RegExp(`export const ${name} = "([^"]+)";`)); if (!m) throw new Error(`no ${name}`); return m[1]; };
const WARM_TARGETS_KEY = keyOf("WARM_TARGETS_KEY"), WARM_TARGETS_FALLBACK_KEY = keyOf("WARM_TARGETS_FALLBACK_KEY");
const { TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { SEC_MANIFEST_KEY, SEC_FACTS_INDEX_KEY, dotDashSpellings, emptyEntry } = await import("../lib/server/secManifest.ts");
const { cikForSymbol, SEC_COLD_QUEUE_KEY } = await import("../lib/server/secColdFetch.ts");
const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");

let commands = 0;
const get = async (k) => { commands++; return redis.get(k); };
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

const warm = parse(await get(WARM_TARGETS_KEY)) ?? parse(await get(WARM_TARGETS_FALLBACK_KEY));
const tiingo = parseTiingoUniverse(await get(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
const manifestRaw = await get(SEC_MANIFEST_KEY);
const manifest = parse(manifestRaw);
commands++; const indexMembers = await redis.smembers(SEC_FACTS_INDEX_KEY);
commands++; const coldQueue = await redis.zcard(SEC_COLD_QUEUE_KEY);

const warmSymbols = warm?.symbols ?? [];
const universe = [...new Set([...warmSymbols, ...tiingo])];
const index = new Set(indexMembers.map((s) => String(s).toUpperCase()));
const entries = manifest?.symbols ?? {};
const has = (set, s) => dotDashSpellings(s).some((k) => set.has(k));
const inManifest = (s) => dotDashSpellings(s).find((k) => Object.prototype.hasOwnProperty.call(entries, k));

const t = { universe: universe.length, noCik: 0, refused: {}, eligible: 0, stored: 0,
  missing: 0, missingInManifestUnread: 0, missingInManifestRead: 0, missingNotInManifest: 0 };
for (const s of universe) {
  const cik = cikForSymbol(s);
  if (!cik) { t.noCik++; continue; }
  const why = secSeedRefusal(s, cik);
  if (why) { t.refused[why] = (t.refused[why] ?? 0) + 1; continue; }
  t.eligible++;
  if (has(index, s)) { t.stored++; continue; }
  t.missing++;
  const key = inManifest(s);
  if (!key) t.missingNotInManifest++;
  else if (entries[key].contentHash == null) t.missingInManifestUnread++;
  else t.missingInManifestRead++;
}
const pct = (a, b) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const manifestBytes = typeof manifestRaw === "string" ? manifestRaw.length : JSON.stringify(manifestRaw ?? {}).length;
const entryBytes = JSON.stringify(["XXXX", emptyEntry("0000000000", "NYSE")]).length;
const projected = manifestBytes + t.missingNotInManifest * entryBytes;
const target80 = Math.ceil(t.eligible * 0.8);

console.log(`universe (warm targets ${warmSymbols.length} ∪ Tiingo universe ${tiingo.length}): ${t.universe}`);
console.log(`  no CIK in the ticker file: ${t.noCik} · seed gate refused: ${Object.entries(t.refused).map(([k, v]) => `${k} ${v}`).join(" · ") || "0"}`);
console.log(`  ELIGIBLE (CIK, admitted): ${t.eligible}`);
console.log(`    stored set: ${t.stored} (${pct(t.stored, t.eligible)} of eligible, ${pct(t.stored, t.universe)} of the universe)`);
console.log(`    NO stored set: ${t.missing}`);
console.log(`      in the manifest, never read (populate queue): ${t.missingInManifestUnread}`);
console.log(`      in the manifest, read, no set (empty answer or since cleared): ${t.missingInManifestRead}`);
console.log(`      NOT in the manifest (in no cron queue; only a person's cold fill reads them): ${t.missingNotInManifest}`);
console.log(`  80% of eligible = ${target80}; short by ${Math.max(0, target80 - t.stored)}`);
console.log(`manifest: ${Object.keys(entries).length} entries, ${manifestBytes} bytes; fact-set index ${index.size}; cold queue ${coldQueue}`);
console.log(`  if every eligible symbol not in it were seeded: +${t.missingNotInManifest} entries ≈ ${projected} bytes (${pct(projected, 10 * 1024 * 1024)} of the 10 MB request limit; empty entry ≈ ${entryBytes} B)`);
console.log(`\nRedis commands: ${commands} (GET/SMEMBERS/ZCARD), read-only`);
