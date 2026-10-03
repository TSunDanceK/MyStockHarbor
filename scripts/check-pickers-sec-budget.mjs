// THE warm-pickers-sec TIME BUDGET (#553 COWORK #113/#114, 2026-10-03).
//
// warmPickersSec stops READING symbols once WARM_PICKERS_SEC_BUDGET_MS has
// passed (the route's maxDuration is 300 s), and still:
//   - flushes the rows it read (HSET),
//   - sets the EXPIRE,
//   - SKIPS the prune on that early stop (pruneSkipped: "time-budget"), since
//     the symbols it never reached are not stale,
//   - reports stoppedEarly: "time-budget" and durationMs.
// The job prints durationMs and records it in its run summary.
//
// BEHAVIOURAL: the real module, with a fake clock (each fact-set read takes
// 1 s), a stubbed Redis that records every command, and the committed AAPL
// fact-set fixture as every symbol's set. No Redis, no network. Mutants: each
// rule broken once, through a temp copy of the module, and caught.
//
//   node scripts/check-pickers-sec-budget.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/server/pickersSecFundamentals.ts";
const ROUTE = "app/api/jobs/warm-pickers-sec/route.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SET = JSON.parse(read("data/sec/factset-fixture-AAPL.json"));
const NOW = Date.parse("2026-09-23");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function loadSibling(source) {
  const file = path.join(ROOT, "lib/server", `.check-psb-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

/** One run: `n` symbols, each read advancing the fake clock by `stepMs`. */
async function run(mod, n, stepMs = 1000) {
  let t = 1_000_000;
  const log = [];
  const stored = [];
  const redis = {
    hset: async (key, batch) => { log.push(["hset", key, Object.keys(batch).length]); stored.push(...Object.keys(batch)); return Object.keys(batch).length; },
    hkeys: async (key) => { log.push(["hkeys", key]); return [...stored, "GONE"]; },
    hdel: async (key, ...f) => { log.push(["hdel", key, f]); return f.length; },
    expire: async (key, ttl) => { log.push(["expire", key, ttl]); return 1; },
  };
  const symbols = Array.from({ length: n }, (_, i) => `S${i}`);
  let reads = 0;
  const result = await mod.warmPickersSec(symbols, () => ({}), NOW, "test:key", {
    clock: () => t,
    redis,
    readFactSet: async () => { reads++; t += stepMs; return SET; },
  });
  return { result, log, reads };
}

function rules(mod, early, full) {
  const fails = [];
  const want = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const B = mod.WARM_PICKERS_SEC_BUDGET_MS;
  want("the budget is exported and is 240 s", B === 240_000, String(B));
  // 300 symbols at 1 s each: the budget allows 240 reads.
  want("BUDGET: reading stops once the budget is spent", early.reads === 240, `${early.reads} reads`);
  want("BUDGET: the result says stoppedEarly \"time-budget\"", early.result.stoppedEarly === "time-budget", String(early.result.stoppedEarly));
  const hsets = early.log.filter((c) => c[0] === "hset");
  want("BUDGET: the pending batch is still flushed (every row read is written)",
    early.result.written === 240 && hsets.reduce((a, c) => a + c[2], 0) === 240 && hsets.at(-1)?.[2] === 40, JSON.stringify(hsets));
  want("BUDGET: the EXPIRE is still set, after the writes",
    early.log.some((c) => c[0] === "expire" && c[1] === "test:key") && early.log.findIndex((c) => c[0] === "expire") > early.log.findLastIndex((c) => c[0] === "hset"));
  want("BUDGET: the prune is skipped on an early stop (no HKEYS, no HDEL)",
    !early.log.some((c) => c[0] === "hkeys" || c[0] === "hdel") && early.result.pruneSkipped === "time-budget", String(early.result.pruneSkipped));
  want("BUDGET: an early stop is not a failed run", early.result.ok === true);
  want("DURATION: reported by the run's clock", early.result.durationMs === 240_000, String(early.result.durationMs));
  // Control: 50 symbols fit in the budget.
  want("CONTROL: a run inside the budget reads every symbol and does not stop early", full.reads === 50 && full.result.stoppedEarly === null);
  want("CONTROL: ...and still prunes (HKEYS, then HDEL of the stale row)",
    full.log.some((c) => c[0] === "hkeys") && full.log.some((c) => c[0] === "hdel" && JSON.stringify(c[2]) === '["GONE"]') && full.result.pruneSkipped === null);
  want("CONTROL: ...and reports its duration", full.result.durationMs === 50_000, String(full.result.durationMs));
  return fails;
}
async function suite(mod) {
  return rules(mod, await run(mod, 300), await run(mod, 50));
}

const src = read(MODULE);
{
  const fails = await suite(await loadSibling(src));
  for (const f of fails) check(f, false);
  check("the time budget: stops reading, flushes, EXPIREs, skips the prune, reports duration", fails.length === 0);
}

// The route prints and records the duration.
function routeRules(r) {
  const c = stripComments(r, { file: ROUTE });
  const fails = [];
  if (!/console\.log\("\[warm-pickers-sec\]", `durationMs=\$\{result\.durationMs \?\? null\}`, JSON\.stringify\(result\)\);/.test(c)) fails.push("the job's console line carries durationMs");
  if (!/recordJobRun\("warm-pickers-sec", result\.ok, \{\s*durationMs: result\.durationMs \?\? null,/.test(c)) fails.push("the job's run summary records durationMs");
  if (!/stoppedEarly: result\.stoppedEarly,/.test(c)) fails.push("the run summary still records stoppedEarly");
  return fails;
}
const routeSrc = read(ROUTE);
{
  const fails = routeRules(routeSrc);
  for (const f of fails) check(f, false);
  check("the route prints and records durationMs", fails.length === 0);
}

console.log("\n  mutants (each must be caught)");
const MUTANTS = [
  ["the budget check removed", `    if (clock() - startedAt >= budgetMs) {`, `    if (false) {`],
  ["the clock not injectable (wall clock)", `  const clock = deps.clock ?? Date.now;`, `  const clock = Date.now;`],
  ["the last batch dropped on an early stop", `  if (!(await flush())) return done();\n\n  // Drop`, `  if (result.stoppedEarly !== "time-budget" && !(await flush())) return done();\n\n  // Drop`],
  ["no EXPIRE after an early stop", `    await redis.expire(key, PICKERS_SEC_TTL_SECONDS);`, `    if (result.stoppedEarly) throw new Error("skip");\n    await redis.expire(key, PICKERS_SEC_TTL_SECONDS);`],
  ["the prune runs after an early stop", `  if (result.stoppedEarly === "time-budget") {\n    result.pruneSkipped = "time-budget";`, `  if (false) {\n    result.pruneSkipped = "time-budget";`],
  ["the duration not reported", `    result.durationMs = Math.max(0, clock() - startedAt);`, `    result.durationMs = 0;`],
  ["the budget doubled", `export const WARM_PICKERS_SEC_BUDGET_MS = 240_000;`, `export const WARM_PICKERS_SEC_BUDGET_MS = 480_000;`],
];
for (const [label, from, to] of MUTANTS) {
  if (src.split(from).length !== 2) { check(`mutant "${label}" applies`, false, "the anchor matched other than once"); continue; }
  let fails;
  try { fails = await suite(await loadSibling(src.replace(from, to))); } catch (err) { fails = [String(err)]; }
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
for (const [label, from, to] of [
  ["the console line drops durationMs", "`durationMs=${result.durationMs ?? null}`, ", ""],
  ["the run summary drops durationMs", "      durationMs: result.durationMs ?? null,\n", ""],
]) {
  const m = routeSrc.replace(from, to);
  check(`mutant "${label}" is caught`, m !== routeSrc && routeRules(m).length > 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
