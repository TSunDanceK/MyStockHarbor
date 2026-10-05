// EVERY REDIS WRITE SITE IS CLASSIFIED, AND THE SIZE LIST CANNOT GO STALE
// (#553 COWORK #82, 2026-10-01).
//
// The 21 Sep debug list (app/api/debug/redis-write-sizes) covered 10 keys while
// 37 files in lib/server wrote to Redis, so the next 10 MB email had nowhere to
// point. This check makes the list a property of the code:
//   1. every write site in lib/ and app/ is in scripts/lib/redis-write-sites.mjs,
//      and every entry there still matches a site (counts included);
//   2. every whole-collection ("listed") write appears in the debug tool's
//      CANDIDATES;
//   3. the three plays builders measure and log their payload write (no bare
//      catch on it any more);
//   4. the one multi-MB request measured anywhere, the Tiingo EOD pipeline,
//      stays inside the request budget at its pinned chunk size;
//   MUTANTS: an unlisted write site, a candidate dropped from the tool, and a
//   builder back on a bare catch. Each is caught.
//
//   node scripts/check-redis-write-sites.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";
import { WRITE_SITES, WRITE_RE, REDIS_RECEIVER, normKey } from "./lib/redis-write-sites.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const walk = (d, o = []) => {
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, o); }
    else if (/\.tsx?$/.test(e.name)) o.push(path.relative(ROOT, p));
  }
  return o;
};
const FILES = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))].sort();
const code = (f, overrides = {}) => stripComments(overrides[f] ?? fs.readFileSync(path.join(ROOT, f), "utf8"), { file: f });

// ── 1. sites vs registry ────────────────────────────────────────────────────
function sitesIn(overrides = {}) {
  const found = new Map();
  for (const f of FILES) {
    const src = code(f, overrides);
    for (const m of src.matchAll(WRITE_RE)) {
      if (!REDIS_RECEIVER.test(m[1])) continue;
      const k = `${f}\t${normKey(m[3])}`;
      found.set(k, (found.get(k) ?? 0) + 1);
    }
  }
  return found;
}
function registryDiff(found) {
  const want = new Map(WRITE_SITES.map((s) => [`${s.file}\t${normKey(s.key)}`, s.count ?? 1]));
  const unlisted = [...found].filter(([k, n]) => (want.get(k) ?? 0) < n).map(([k]) => k.replace("\t", " :: "));
  const stale = [...want].filter(([k, n]) => (found.get(k) ?? 0) < n).map(([k]) => k.replace("\t", " :: "));
  return { unlisted, stale };
}
console.log("\n1. Every write site is classified, and every entry still matches a site");
const found = sitesIn();
const diff = registryDiff(found);
check(`no unlisted write site (${found.size} distinct sites scanned)`, diff.unlisted.length === 0, diff.unlisted.slice(0, 8).join("; "));
check("no stale registry entry", diff.stale.length === 0, diff.stale.slice(0, 8).join("; "));
check("every entry has a known class, and chunked ones state their bound",
  WRITE_SITES.every((s) => ["listed", "chunked", "guarded", "row", "small"].includes(s.cls) && (s.cls !== "chunked" || s.bound) && (s.cls !== "listed" || s.candidate)));

// ── 2. listed writes are on the debug tool ─────────────────────────────────
console.log("\n2. Every whole-collection write is on the debug tool's CANDIDATES");
const TOOL = "app/api/debug/redis-write-sizes/route.ts";
const listedMissing = (toolSrc) =>
  WRITE_SITES.filter((s) => s.cls === "listed").filter((s) => !new RegExp(`key:\\s*${s.candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`).test(toolSrc)).map((s) => `${s.file} ${s.key}`);
const toolSrc = code(TOOL);
const missing = listedMissing(toolSrc);
check("each listed write's key is a CANDIDATES entry", missing.length === 0, missing.join("; "));
// The literal candidates must still be what their owners write.
check('"msh:market:state" is still the market route\'s REDIS_KEY', /const REDIS_KEY = "msh:market:state";/.test(code("app/api/market/route.ts")));
check('"msh:benchmarks:stock" is still REDIS_PREFIX + the stock scope', /const REDIS_PREFIX = "msh:benchmarks";/.test(code("lib/server/benchmarksBuilder.ts")));

// ── 3. the plays builders measure and log their payload write ───────────────
console.log("\n3. The plays builders' payload writes are measured and logged, not swallowed");
const BUILDERS = [
  ["lib/server/playsBuilder.ts", "PLAYS_REDIS_KEY", "plays"],
  ["lib/server/bullFlagsBuilder.ts", "PLAYS_REDIS_KEY", "bull-flags"],
  ["lib/server/descendingTrianglesBuilder.ts", "DESCENDING_REDIS_KEY", "desc-tri"],
];
const builderRule = (src, key, tag) => {
  const i = src.indexOf(`await writeRedis.set(${key}, entry`); // the 20 s client (#553 COWORK #156)
  if (i < 0) return "payload write not found";
  const before = src.slice(Math.max(0, i - 700), i);
  const after = src.slice(i, i + 700);
  if (!before.includes(`trySetRequestBytes(${key}, entry`)) return "not measured before the write";
  if (!/bodyBytes > REQUEST_BYTE_BUDGET/.test(before)) return "no over-budget refusal";
  if (!after.includes(`[${tag}] payload write`)) return "no ok log line";
  if (!/\} catch \(error\) \{[\s\S]{0,80}console\.error\(/.test(after)) return "the catch is silent";
  return null;
};
for (const [f, key, tag] of BUILDERS) {
  const r = builderRule(code(f), key, tag);
  check(`${tag}: measured, refused over budget, logged ok/failed`, r === null, r ?? "");
}

// ── 4. the Tiingo EOD pipeline stays inside the budget ─────────────────────
console.log("\n4. The largest measured request: the Tiingo EOD write pipeline");
// MEASURED: max stored row 81,492 B across 825 keys at 1,400 bars (CODE-B #75
// census, 2026-10-01). The escaping factor is chunkByBytes' measured one.
const EOD_ROW_BYTES_MEASURED = 81_492;
const jobs = code("lib/server/marketData/jobs.ts");
const helper = code("lib/server/chunkByBytes.ts");
const chunk = Number((jobs.match(/const EOD_WRITE_CHUNK = (\d+);/) ?? [])[1]);
// The window moved to eodWindow.ts (shared with the stock-page cold fill, #553 COWORK #121).
const bars = Number((code("lib/server/marketData/eodWindow.ts").match(/export const EOD_WINDOW_BARS = (\d+);/) ?? [])[1]);
const escaping = Number((helper.match(/MEASURED_ESCAPING_INFLATION = ([0-9.]+)/) ?? [])[1]);
const budget = 5 * 1024 * 1024;
check("REQUEST_BYTE_BUDGET is still 5 MB", /REQUEST_BYTE_BUDGET = 5 \* 1024 \* 1024;/.test(helper));
const worst = chunk * EOD_ROW_BYTES_MEASURED * escaping;
check(
  "EOD_WRITE_CHUNK x the largest measured row fits the budget",
  chunk > 0 && bars === 1400 && worst < budget,
  `${chunk} x ${EOD_ROW_BYTES_MEASURED} B x ${escaping} = ${(worst / 1024 / 1024).toFixed(2)} MB against ${(budget / 1024 / 1024).toFixed(0)} MB at ${bars} bars; more bars or a bigger chunk needs a re-measure`
);

const eodLogRule = (src) =>
  /largestWriteRequestBytes = Math\.max\(largestWriteRequestBytes, pipelineRequestBytes\(cmds\)\)/.test(src) &&
  /console\.log\(\s*`\[tiingo-eod\] largest write request \$\{largestWriteRequestBytes\} bytes/.test(src) &&
  /bytesWritten,\s*largestWriteRequestBytes,/.test(src);
check("the EOD job measures, logs and records its largest write request every run (COWORK #83)", eodLogRule(jobs));

// ── mutants ────────────────────────────────────────────────────────────────
console.log("\n5. Mutants");
{
  const f = "lib/server/capexSpending.ts";
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const m = sitesIn({ [f]: src + "\nasync function x(redis: any) { await redis.set(BRAND_NEW_UNLISTED_KEY, 1); }\n" });
  check("mutant caught: an unlisted write site", registryDiff(m).unlisted.length > 0);
}
{
  const m = toolSrc.replace(/key: BULL_FLAGS_REDIS_KEY,/, "key: SOMETHING_ELSE,");
  check("mutant caught: a listed key dropped from the debug tool", m !== toolSrc && listedMissing(m).length > 0);
}
{
  const f = BUILDERS[1][0];
  const src = code(f);
  const i = src.indexOf(`await writeRedis.set(${BUILDERS[1][1]}, entry`);
  const m = src.slice(0, i) + src.slice(i).replace("} catch (error) {", "} catch {");
  check("mutant caught: a builder back on a silent catch", m !== src && builderRule(m, BUILDERS[1][1], BUILDERS[1][2]) !== null);
}

{
  const m = jobs.replace(/console\.log\(\s*`\[tiingo-eod\] largest write request/, "void (`[tiingo-eod] largest write request");
  check("mutant caught: the EOD largest-request log removed", m !== jobs && !eodLogRule(m));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
