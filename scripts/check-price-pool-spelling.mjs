// The price pool has ONE spelling per symbol (#553 COWORK #53).
//
// WHAT WENT WRONG: pricePool's cleanSymbol kept both `.` and `-`, so BRK.B and
// BRK-B were two fields. The refresh wrote BRK-B every run; the Pickers
// universe reads BRK.B, whose row was 656 h old on 2026-09-25. A four-week-old
// Berkshire price, rendered as current, with nothing anywhere failing.
//
// WHAT THIS HOLDS:
//   1. Every pool field is dashed (poolField): BRK.B -> BRK-B; BF-B, MKC-V and
//      the preferreds (EP-PC) are unchanged. No field can contain a dot.
//   2. readPricePoolBulk reads the dashed field and hands the row back under
//      the spelling the caller asked for, so no reader had to change.
//   3. The warm run matches tier-1 in pool spelling, and eviction deletes the
//      dashed field of a dotted symbol.
//
//   node scripts/check-price-pool-spelling.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODULE = "lib/server/pricePool.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";

// Upstash REST, stubbed: the client asks for base64 values and auto-pipelines.
const POOL = {
  "BRK-B": { price: 470, ts: 1_000, volume: 1 },
  AAPL: { price: 230, ts: 1_000, volume: 1 },
  "BF-B": { price: 40, ts: 1_000, volume: 1 },
};
const net = { hmgetFields: [] };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith(REDIS)) return new Response("{}", { status: 200 });
  const body = JSON.parse(init.body ?? "null");
  const cmds = Array.isArray(body?.[0]) ? body : [body];
  const answer = (cmd) => {
    if (String(cmd[0]).toLowerCase() === "hmget") {
      const fields = cmd.slice(2).map(String);
      net.hmgetFields.push(...fields);
      return fields.map((f) => (POOL[f] ? b64(JSON.stringify(POOL[f])) : null));
    }
    return 1;
  };
  const results = cmds.map((c) => ({ result: answer(c) }));
  return new Response(JSON.stringify(Array.isArray(body?.[0]) || /\/pipeline/.test(url) ? results : results[0]), { status: 200 });
};

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib/server", `.check-pps-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

async function suite(M, src) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  ok("BRK.B's pool field is BRK-B", M.poolField("BRK.B") === "BRK-B", M.poolField("BRK.B"));
  ok("a dashed class share is unchanged (BF-B, MKC-V)", M.poolField("bf-b") === "BF-B" && M.poolField("MKC-V") === "MKC-V");
  ok("a preferred is unchanged (EP-PC)", M.poolField("EP-PC") === "EP-PC");
  ok("no pool field can contain a dot", ["BRK.B", ["BF", "B"].join("."), ["X", "Y", "Z"].join(".")].every((s) => !M.poolField(s).includes(".")));

  net.hmgetFields = [];
  const rows = await M.readPricePoolBulk(["BRK.B", "AAPL", "bf-b"]);
  ok("the read asks for the DASHED field, never the dotted one", net.hmgetFields.includes("BRK-B") && !net.hmgetFields.includes("BRK.B"), net.hmgetFields.join(","));
  ok("the row comes back under the caller's spelling (BRK.B)", rows.get("BRK.B")?.price === 470, JSON.stringify(rows.get("BRK.B")));
  ok("...and under the pool field (BRK-B)", rows.get("BRK-B")?.price === 470);
  ok("an undotted symbol is read as before", rows.get("AAPL")?.price === 230 && rows.get("BF-B")?.price === 40);

  ok("the warm run matches tier-1 in pool spelling",
    /const tier1 = new Set\(\[\.\.\.\(await readTier1\(\)\)\]\.map\(poolField\)\);/.test(src));
  ok("every pool write goes through the one normaliser", /const cleanSymbol = poolField;/.test(src));
  return fails;
}

let failures = 0;
const src = read(MODULE);
const base = await suite(await load(src), src);
console.log("=== 1. pool spelling, on the real module ===");
if (!base.length) console.log("  PASS  every assertion");
for (const f of base) console.log(`  FAIL  ${f}`);
failures += base.length;

console.log("\n=== 2. eviction deletes the dashed field ===");
const evict = read("lib/server/symbolEviction.ts");
const evOk = /hash === "msh:price-pool:v1" \? \[\.\.\.new Set\(\[symbol, toDashed\(symbol\)\]\)\] : \[symbol\]/.test(evict);
console.log(`  ${evOk ? "PASS" : "FAIL"}  an evicted BRK.B removes the BRK-B row`);
if (!evOk) failures++;

console.log("\n=== 3. mutants (each must be caught) ===");
const MUTANTS = [
  ["the pool keeps dotted fields", "  return toDashed(callerSpelling(value));", "  return callerSpelling(value);"],
  ["rows are not handed back under the caller's spelling", "          for (const alias of askedAs.get(sym) ?? []) out.set(alias, view);\n", ""],
  ["tier-1 compared in the caller's spelling", "  const tier1 = new Set([...(await readTier1())].map(poolField));", "  const tier1 = await readTier1();"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source`);
    failures++;
    continue;
  }
  const mutated = src.replace(from, to);
  const fails = await suite(await load(mutated), mutated);
  console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : " — NOTHING FAILED"}`);
  if (!fails.length) failures++;
}

console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
