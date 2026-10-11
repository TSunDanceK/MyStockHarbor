// THE FETCH-LAYER REQUEST-SIZE GUARD (#553 COWORK #84), EXECUTED.
//
//   1. a 3 MB pipeline is logged (command, count, key prefix, bytes) and sent;
//   2. an 11 MB SET is refused at error level, throws, and is NEVER sent;
//   3. a small request passes silently; a large non-Upstash request is untouched;
//   4. the log carries a key prefix only, never a value or a full key;
//   5. installing twice wraps once, and the original's properties carry over;
//   6. instrumentation.ts installs it in register();
//   MUTANT: a guard that only logs (no refusal) sends the 11 MB SET. Caught.
//
//   node scripts/check-redis-size-guard.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const FILE = "lib/server/redisSizeGuard.ts";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function load(src) {
  const f = path.join(ROOT, "lib/server", `.check-size-guard-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  try { return await import(pathToFileURL(f).href); } finally { fs.rmSync(f, { force: true }); }
}

const URL = "https://example-redis.upstash.io";
const big = (n) => "x".repeat(n);
async function suite(G) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const sent = [];
  const logs = { warn: [], error: [] };
  const target = { fetch: async (input, init) => { sent.push({ url: String(input), bytes: (init?.body ?? "").length }); return { ok: true }; } };
  target.fetch.__nextPatched = true;
  G.installRedisSizeGuard(target, URL, { warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(m) });

  // 0. a ~4 MB SET, the size of one Pickers payload chunk: under the budget, silent.
  await target.fetch(URL, { method: "POST", body: JSON.stringify(["set", "msh:pickers:v10:chunk:x", big(4 * 1024 * 1024)]) });
  want("a 4 MB request (one Pickers chunk) is sent and not logged", sent.length === 1 && logs.warn.length === 0, logs.warn[0]);
  sent.length = 0;

  // 1. a 6 MB pipeline: 3 SETs of ~2 MB under msh:tiingo:eod:v2:
  const pipe = JSON.stringify([["set", "msh:tiingo:eod:v2:AAPL", big(2_100_000)], ["set", "msh:tiingo:eod:v2:MSFT", big(2_100_000)], ["set", "msh:tiingo:eod:v2:NVDA", big(2_100_000)]]);
  await target.fetch(`${URL}/pipeline`, { method: "POST", body: pipe });
  want("a 6 MB pipeline is sent", sent.length === 1);
  want("...and logged with its count, command and key prefix", logs.warn.length === 1 && /^\[redis-size\] pipeline:3 SET msh:tiingo:eod:v2: \d+ bytes$/.test(logs.warn[0] ?? ""), logs.warn[0]);
  want("...without a full key or a value", !/AAPL|xxxx/.test(logs.warn[0] ?? ""));

  // 2. an 11 MB SET
  const huge = JSON.stringify(["set", "msh:plays:v5:main", big(11 * 1024 * 1024)]);
  let threw = null;
  try { await target.fetch(URL, { method: "POST", body: huge }); } catch (e) { threw = e; }
  want("an 11 MB SET throws", threw instanceof Error && /refused/.test(threw.message));
  want("...is never sent", sent.length === 1, `${sent.length} sent`);
  want("...and is logged at ERROR level with REFUSED", logs.error.length === 1 && /^\[redis-size\] REFUSED SET msh:plays:v5: \d+ bytes/.test(logs.error[0] ?? ""), logs.error[0]);

  // 3. small, and non-Upstash
  await target.fetch(URL, { method: "POST", body: JSON.stringify(["get", "msh:x:y"]) });
  want("a small request passes silently", sent.length === 2 && logs.warn.length === 1);
  await target.fetch("https://api.example.com/upload", { method: "POST", body: big(11 * 1024 * 1024) });
  want("a large non-Upstash request is untouched", sent.length === 3 && logs.error.length === 1);

  // 5. idempotent, markers kept
  const again = G.installRedisSizeGuard(target, URL, { warn: () => {}, error: () => {} });
  want("installing twice wraps once", again === false);
  want("the original fetch's properties (Next's patch marker) carry over", target.fetch.__nextPatched === true);

  // prefix helper
  want("keyPrefix: up to the last ':'; a bare key shows 3 characters", G.keyPrefix("msh:a:b:SYM") === "msh:a:b:" && G.keyPrefix("secretkey") === "sec…");
  want("thresholds: log over 5 MB (REQUEST_BYTE_BUDGET), refuse over 9.5 MB", G.REDIS_SIZE_LOG_BYTES === 5 * 1024 * 1024 && G.REDIS_SIZE_REFUSE_BYTES === 9.5 * 1024 * 1024);
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, FILE), "utf8");
console.log("\n1-5. The guard, executed against a recording fetch");
const real = await suite(await load(src));
for (const f of real) check(f, false);
check("the guard behaves as specified", real.length === 0);

console.log("\n6. instrumentation.ts installs it");
const inst = stripComments(fs.readFileSync(path.join(ROOT, "instrumentation.ts"), "utf8"), { file: "instrumentation.ts" });
check("register() imports and installs the guard", /export async function register\(\)[\s\S]*installRedisSizeGuard\(\)/.test(inst));

console.log("\n7. Mutant");
const mutant = src.replace(/throw new Error\(`\[redis-size\] request refused[^;]*;/, "");
check("mutant applies", mutant !== src);
const m = await suite(await load(mutant));
check("mutant caught: a guard without the refusal sends the 11 MB SET", m.some((f) => /never sent|throws/.test(f)), m[0] ?? "no assertion failed");
// #553 COWORK #92: the warn line back at 2 MB would name every Pickers chunk again.
const mutant2 = src.replace("export const REDIS_SIZE_LOG_BYTES = REQUEST_BYTE_BUDGET;", "export const REDIS_SIZE_LOG_BYTES = 2 * 1024 * 1024;");
check("mutant 2 applies", mutant2 !== src);
const m2 = await suite(await load(mutant2));
check("mutant caught: a 2 MB warn line logs a 4 MB Pickers chunk", m2.some((f) => /4 MB request/.test(f)), m2[0] ?? "no assertion failed");

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
