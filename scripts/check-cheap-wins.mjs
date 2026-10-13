// A measured command saving (#553 COWORK #53; CODE-B #39 "cheap wins").
//
//   1. clearAbsence: ~850 pipelined DELs a day (one per present symbol, most
//      of them for keys that do not exist) -> one multi-key DEL per 500 keys.
//      Upstash bills a pipeline per command and a multi-key DEL as one.
//
// RETIRED 2026-10-12 (#553 COWORK #212): the second saving, warm-fundamentals
// writing only changed rows (fundamentalRowNeedsWrite), went with that job.
//
//   node scripts/check-cheap-wins.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
console.log("=== clearAbsence is one multi-key DEL per 500 ===");
const evict = read("lib/server/symbolEviction.ts");
const body = evict.slice(evict.indexOf("export async function clearAbsence"), evict.indexOf("export async function clearAbsence") + 1200);
const delOk = /await redis\.del\(\.\.\.keys\);/.test(body) && !/p\.del\(/.test(body) && /i \+= 500/.test(body);
console.log(`  ${delOk ? "PASS" : "FAIL"}  one DEL command per 500 keys, no per-key pipeline`);
if (!delOk) failures++;
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
