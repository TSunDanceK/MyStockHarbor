// The committed static-profile snapshot, and the lookup that reads it.
//
// WHAT IS AT RISK. Every failure here is silent on a page:
//   1. A LIVE-MARKET FIELD GETTING IN. marketCap, beta, the 52-week range and
//      the dividend are READINGS, not facts. A frozen reading puts a stale
//      number on a live page, which is worse than an absent row because a
//      reader cannot tell it is stale. The snapshot must contain none of them.
//   2. THE LOOKUP ORDER. Cache, then snapshot, then null. If the snapshot ever
//      won over the cache, a reclassification would need a redeploy to take
//      effect and nobody would know why the sector was wrong.
//   3. A GUESS INSTEAD OF A NULL. A symbol in neither leg must yield null. A
//      default sector is a wrong sector on every page it touches.
//   4. A MISS COSTING A REQUEST. The refresh trigger is a log line, exactly like
//      the CIK map's. If a miss ever fetched, a symbol off the snapshot would
//      hit the network on every render.
//
//   node scripts/check-static-profile.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ─────────────────────────────────────────────────────────── the module
const src = read("lib/server/staticProfile.ts")
  .replace(/^import snapshotFile from "@\/data\/static-profile.json";$/m,
    () => `const snapshotFile = ${read("data/static-profile.json")};`)
  .replace(/^export type StaticProfileRow = \{[\s\S]*?^\};$/m, "")
  .replace(/^type SnapshotFile = \{[\s\S]*?^\};$/m, "")
  .replace("const SNAPSHOT = snapshotFile as unknown as SnapshotFile;", "const SNAPSHOT = snapshotFile;")
  .replace("export const SNAPSHOT_AS_OF: string = SNAPSHOT.asOf;", "export const SNAPSHOT_AS_OF = SNAPSHOT.asOf;")
  .replace("export const SNAPSHOT_SIZE: number = Object.keys(SNAPSHOT.rows ?? {}).length;",
           "export const SNAPSHOT_SIZE = Object.keys(SNAPSHOT.rows ?? {}).length;")
  .replace("const clean = (v: unknown): string | null =>", "const clean = (v) =>")
  .replace("export function staticProfileFor(symbol: string): StaticProfileRow | null {",
           "export function staticProfileFor(symbol) {")
  .replace(/^export type ResolvedProfile = StaticProfileRow & \{[\s\S]*?^\};$/m, "")
  .replace(/export function resolveProfile\(\n  symbol: string,\n  cached: \{ sector\?: string \| null; industry\?: string \| null \} \| null \| undefined\n\): ResolvedProfile \{/,
           "export function resolveProfile(symbol, cached) {");
if (/^import /m.test(src)) {
  console.error("FAIL: an import survived inlining:\n" + src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
for (const [marker, why] of [
  ["const snapshotFile = {", "the snapshot JSON was not inlined"],
  ["export function resolveProfile(symbol, cached) {", "resolveProfile was not de-typed"],
  ["export function staticProfileFor(symbol) {", "staticProfileFor was not de-typed"],
]) {
  if (!src.includes(marker)) { console.error(`FAIL: ${why} — a substitution stopped matching.`); process.exit(1); }
}
const file = path.join(ROOT, ".check-staticprofile.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let sp;
try { sp = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }

const snapshot = JSON.parse(read("data/static-profile.json"));

console.log("\n=== 1. NO LIVE-MARKET FIELD IS IN THE FILE ===\n");
// A READING IS NOT A FACT. Checked against the serialised rows rather than the
// type, because the type cannot stop a regenerate script widening the payload.
const rowsText = JSON.stringify(snapshot.rows);
const BANNED = [
  ["marketCap", "moves every trading day"],
  ["beta", "recomputed from a rolling window"],
  ["lastAnnualDividend", "changes with every declaration"],
  ["range", "the 52-week range moves continuously"],
  ["price", "the most obviously live number there is"],
  ["peRatio", "a price ratio, so it moves with price"],
  ["volume", "moves every trading day"],
];
for (const [field, why] of BANNED) {
  check(`no "${field}" anywhere in rows`, !rowsText.includes(field), why);
}
check(
  "no description either — a fact store, not FMP's prose",
  !rowsText.includes("description"),
  "the 10-K Item 1 business section is the candidate replacement, via the step-5 SEC adapter"
);
check(
  "every row has ONLY sector and industry",
  Object.values(snapshot.rows).every((r) => {
    const keys = Object.keys(r).sort();
    return keys.length <= 2 && keys.every((k) => k === "sector" || k === "industry");
  }),
  "a widened row is how a live field would get in"
);
check(
  "the file names the excluded fields, so the omissions read as decisions",
  Array.isArray(snapshot.absentFields?.readings) &&
    Array.isArray(snapshot.absentFields?.blocked) &&
    snapshot.absentFields.readings.includes("marketCap") &&
    snapshot.absentFields.blocked.includes("ipoDate"),
  "readings excluded on purpose; the eight blocked ones absent for want of an FMP key"
);

console.log("\n=== 2. Coverage ===\n");
check("the snapshot is complete", snapshot.coverage?.complete === true,
  `${snapshot.coverage?.symbols} symbols, chunks ${snapshot.coverage?.chunksPresent?.join(",")}`);
check("2,619 symbols", sp.SNAPSHOT_SIZE === 2619, `${sp.SNAPSHOT_SIZE}`);
check(
  "every row carries BOTH fields, populated",
  Object.values(snapshot.rows).every((r) => r.sector && r.industry),
  "the source datasets were 100% populated for both; a null here would mean the expander lost something"
);
check(
  "wider than the 695-symbol universe, which is the point",
  sp.SNAPSHOT_SIZE > 695 * 3,
  "a symbol entering the universe later has no free source with this taxonomy to fall back on"
);
check(
  "every sector is one of the site's eleven",
  (() => {
    const slugs = new Set([...read("lib/sectors.ts").matchAll(/slug:\s*"([a-z-]+)"/g)].map((m) => m[1]));
    const labelToSlug = (s) => s.toLowerCase().replace(/\s+/g, "-");
    return [...new Set(Object.values(snapshot.rows).map((r) => r.sector))].every((s) => slugs.has(labelToSlug(s)));
  })(),
  "FMP's 11 sector labels map 1:1 onto lib/sectors.ts — if they ever stop, bucketFor silently stops matching"
);
check("spot checks against reality", 
  snapshot.rows.AAPL?.sector === "Technology" &&
  snapshot.rows.AAPL?.industry === "Consumer Electronics" &&
  snapshot.rows.JPM?.sector === "Financial Services" &&
  snapshot.rows.XOM?.sector === "Energy" &&
  snapshot.rows.MU?.industry === "Semiconductors",
  "AAPL, JPM, XOM, MU");

console.log("\n=== 3. LOOKUP ORDER: cache, then snapshot, then null ===\n");
check(
  "a cached value WINS over the snapshot",
  (() => {
    const r = sp.resolveProfile("AAPL", { sector: "Utilities", industry: "Regulated Water" });
    return r.source === "cache" && r.sector === "Utilities";
  })(),
  "the cache is newer, and a reclassification must take effect without a redeploy"
);
check(
  "the snapshot answers when the cache is empty",
  (() => {
    const r = sp.resolveProfile("AAPL", null);
    return r.source === "snapshot" && r.sector === "Technology" && r.industry === "Consumer Electronics";
  })()
);
check(
  "...and when the cache row exists but both fields are null",
  sp.resolveProfile("AAPL", { sector: null, industry: null }).source === "snapshot",
  "a cache row of nulls is a miss, not an answer"
);
check(
  "...and when the cache row is undefined entirely",
  sp.resolveProfile("AAPL", undefined).source === "snapshot"
);
check(
  "EITHER cached field alone counts as a cache hit",
  sp.resolveProfile("AAPL", { sector: "Energy" }).source === "cache" &&
    sp.resolveProfile("AAPL", { industry: "Gold" }).source === "cache",
  "bucketFor degrades from industry to sector on its own; taking the snapshot's other half would mix two vintages"
);

console.log("\n=== 4. A MISS YIELDS NULL, NOT A GUESS ===\n");
const warnings = [];
const withWarn = (fn) => {
  const real = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try { return fn(); } finally { console.warn = real; }
};
const miss = withWarn(() => sp.resolveProfile("ZZZZNOTREAL", null));
check("both fields are null", miss.sector === null && miss.industry === null);
check("the source says so", miss.source === "none");
check(
  "NO DEFAULT SECTOR — not 'Technology', not the commonest, not anything",
  miss.sector !== "Technology" && miss.sector !== "" && miss.sector == null,
  "a default sector is a wrong sector on every page it touches"
);
check(
  "the refresh trigger fires: the symbol is logged by name",
  warnings.some((w) => w.includes("[static-profile]") && w.includes("ZZZZNOTREAL") && w.includes("static-profile.json")),
  "the same shape as the CIK map's, and for the same reason: a miss IS the event"
);
check(
  "...and the log says what the reader will see, so it is not filed as a bug",
  warnings.some((w) => /generated|sector page/i.test(w)),
  "no sector means no bucket means the generated data card, and no sector-page membership"
);
check(
  "a miss makes NO NETWORK REQUEST",
  await (async () => {
    const real = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("should not fetch"); };
    try { withWarn(() => sp.resolveProfile("ZZZZNOTREAL", null)); return !called; }
    finally { globalThis.fetch = real; }
  })(),
  "otherwise a symbol off the snapshot hits the network on every render"
);
check(
  "the module contains no fetch at all",
  !/fetch\(|await fetch/.test(readCodeOnly("lib/server/staticProfile.ts")),
  "it is a bundled lookup; there is nothing for it to call"
);
check(
  "a blank or junk symbol is a miss, not a throw",
  sp.staticProfileFor("") === null && sp.staticProfileFor("   ") === null && sp.staticProfileFor(null) === null
);
check(
  "lookup is case-insensitive on the way in",
  sp.staticProfileFor("aapl")?.sector === "Technology"
);

console.log("\n=== 5. The wire form and the committed form agree ===\n");
check(
  "re-expanding the wire form reproduces the committed file byte for byte",
  (() => {
    // THE ONLY THING THAT PROVES THE TWO FORMS HAVE NOT DRIFTED. The committed
    // file is generated; if someone hand-edits it, this is what notices.
    const before = read("data/static-profile.json");
    execFileSync("node", ["scripts/static-profile-expand.mjs"], { cwd: ROOT, stdio: "pipe" });
    const after = read("data/static-profile.json");
    if (before !== after) fs.writeFileSync(path.join(ROOT, "data/static-profile.json"), before);
    return before === after;
  })(),
  "do not hand-edit data/static-profile.json — regenerate it"
);
check(
  "no FMP call is made to build it",
  // CODE ONLY. The script's header explains at length WHY financialmodelingprep
  // is unreachable from here, so the raw text contains the host name and a grep
  // over it fails on the explanation rather than on a call.
  !/financialmodelingprep|FMP_API_KEY|fetch\(/.test(readCodeOnly("scripts/static-profile-build.mjs")),
  "the taxonomy came from the Step 0 dump, which already held it"
);

console.log("\n=== 6. Not yet load-bearing ===\n");
check(
  "NEWS_PROVIDER still defaults to fmp",
  /process\.env\.NEWS_PROVIDER === "free" \? "free" : "fmp"/.test(readCodeOnly("lib/server/news/index.ts")),
  "the snapshot only becomes load-bearing at step 7"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
