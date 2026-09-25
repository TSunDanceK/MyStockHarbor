// Runaway-cost guard for B's jobs (#553 COWORK #51 item 3; lib/server/jobGuard.ts).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A STOPPED RUN KEEPS SPENDING: the budget or a Redis error trips, and the
//      job's later requests (Redis or FMP) still leave the process.
//   2. A PIPELINE COUNTS AS ONE: Upstash bills per command, so a 500-command
//      pipeline read as 1 would let a run spend 500x its budget.
//   3. THE RUN RECORD IS BLOCKED, so a stopped run cannot say it was stopped.
//   4. THE BREAKER OR THE KILL SWITCH IS INERT, or the kill switch fails CLOSED
//      when Edge Config is absent (a config outage must not stop the jobs).
//   5. A JOB IS NOT WRAPPED: its route still exports the bare handler.
//
// Section 1 runs the real module against a stubbed fetch; each mutant below
// must make at least one assertion fail.
//
//   node scripts/check-job-guard.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODULE = "lib/server/jobGuard.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
delete process.env.EDGE_CONFIG;
delete process.env.CRON_SECRET;

// ── the stubbed network: Upstash REST, an "FMP" host, and Edge Config ─────────
const net = { sent: [], redisStatus: 200, dayTotal: 0, edge: null, hsets: [] };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  net.sent.push(url);
  if (url.startsWith("https://edge-config.test")) {
    return net.edge ? new Response(JSON.stringify(net.edge), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if (!url.startsWith(REDIS)) return new Response("ok", { status: 200 });
  if (net.redisStatus !== 200) return new Response(JSON.stringify({ error: "ERR max daily request limit exceeded" }), { status: net.redisStatus });
  const body = JSON.parse(init.body ?? "null");
  // The client AUTO-PIPELINES, so single commands arrive here too: answer each.
  const answer = (cmd) => {
    if (cmd[0] === "hincrby") return (net.dayTotal += Number(cmd[3]));
    if (cmd[0] === "hget") return net.dayTotal;
    if (cmd[0] === "hset") { net.hsets.push(cmd); return 1; }
    if (cmd[0] === "get") return null;
    return 1;
  };
  if (/\/pipeline/.test(url)) {
    return new Response(JSON.stringify(body.map((cmd) => ({ result: answer(cmd) }))), { status: 200 });
  }
  if (body?.[0] === "hget") return new Response(JSON.stringify({ result: net.dayTotal }), { status: 200 });
  if (body?.[0] === "hset") net.hsets.push(body);
  if (body?.[0] === "get") return new Response(JSON.stringify({ result: null }), { status: 200 });
  return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
};

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib/server", `.check-jg-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const redisCmd = (cmd) => fetch(`${REDIS}/`, { method: "POST", body: JSON.stringify(cmd) });
const redisPipe = (n) => fetch(`${REDIS}/pipeline`, { method: "POST", body: JSON.stringify(Array.from({ length: n }, () => ["get", "k"])) });

async function suite(M) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const reset = () => { net.sent = []; net.redisStatus = 200; net.dayTotal = 0; net.edge = null; net.hsets = []; delete process.env.EDGE_CONFIG; };

  // Pure helpers.
  ok("a pipeline counts as its length", M.upstashCommandCount(`${REDIS}/pipeline`, JSON.stringify([[1], [2], [3]])) === 3);
  ok("a single command counts as 1", M.upstashCommandCount(`${REDIS}/`, JSON.stringify(["get", "k"])) === 1);
  ok("the run record is recognised", M.isRunRecordWrite(JSON.stringify(["set", "msh:job-run:v1:warm-stock-data", "{}"])));
  ok("other writes are not", !M.isRunRecordWrite(JSON.stringify(["set", "msh:other", "{}"])));
  ok("an auto-pipelined batch of only run-record SETs is", M.isRunRecordWrite(JSON.stringify([["set", "msh:job-run:v1:ipo-refresh", "{}"]])));
  ok("a batch mixing a run-record SET with other commands is NOT", !M.isRunRecordWrite(JSON.stringify([["set", "msh:job-run:v1:ipo-refresh", "{}"], ["get", "k"]])));
  ok("kill switch: explicit false disables", M.jobEnabledIn({ "warm-stock-data": false }, "warm-stock-data") === false);
  ok("kill switch: { enabled: false } disables", M.jobEnabledIn({ "warm-stock-data": { enabled: false } }, "warm-stock-data") === false);
  ok("kill switch: anything else is enabled", M.jobEnabledIn({ "warm-stock-data": "no" }, "warm-stock-data") && M.jobEnabledIn(null, "warm-stock-data"));

  // 1. A normal run passes through and is counted.
  reset();
  let r = await M.runGuarded("ipo-refresh", async () => { await redisCmd(["get", "a"]); await redisPipe(4); return "done"; });
  ok("a normal run returns its value", r.value === "done" && r.outcome.stopped === null && r.outcome.skipped === null);
  ok("...and counts 1 + 4 commands", r.outcome.commands === 5, String(r.outcome.commands));
  ok("...and adds them to today's total", net.dayTotal === 5, String(net.dayTotal));

  // 2. Over the per-run budget: stopped, and NOTHING more leaves the process.
  reset();
  const budget = M.JOB_LIMITS["ipo-refresh"].perRun;
  let afterStop = { redis: null, fmp: null, record: null };
  r = await M.runGuarded("ipo-refresh", async () => {
    try { await redisPipe(budget + 1); } catch { /* the job fails open */ }
    const before = net.sent.length;
    try { await redisCmd(["get", "x"]); } catch { afterStop.redis = "threw"; }
    try { await fetch("https://fmp.test/quote"); } catch { afterStop.fmp = "threw"; }
    await redisCmd(["set", "msh:job-run:v1:ipo-refresh", "{}"]).then(() => { afterStop.record = "sent"; }, () => { afterStop.record = "threw"; });
    afterStop.leaked = net.sent.length - before;
  });
  ok("over budget: the run is stopped as command-budget", r.outcome.stopped === "command-budget", String(r.outcome.stopped));
  ok("after the stop, Redis calls throw", afterStop.redis === "threw");
  ok("after the stop, FMP (any host) calls throw", afterStop.fmp === "threw");
  ok("after the stop, the run record still goes through", afterStop.record === "sent");
  ok("after the stop, only the run record left the process", afterStop.leaked === 1, String(afterStop.leaked));

  // 3. A Redis failure stops the run.
  reset();
  r = await M.runGuarded("ipo-refresh", async () => {
    net.redisStatus = 429;
    try { await redisCmd(["get", "a"]); } catch { /* */ }
    net.redisStatus = 200;
    try { await fetch("https://fmp.test/quote"); return "leaked"; } catch { return "blocked"; }
  });
  ok("a Redis 429 stops the run as redis-error", r.outcome.stopped === "redis-error", String(r.outcome.stopped));
  ok("...and blocks the next request", r.value === "blocked", String(r.value));
  reset();
  r = await M.runGuarded("ipo-refresh", async () => {
    net.redisStatus = 400;
    try { await redisCmd(["get", "a"]); } catch { /* */ }
    net.redisStatus = 200;
    return "x";
  });
  ok("an Upstash limit refusal (400 'limit exceeded') stops the run", r.outcome.stopped === "redis-error");

  // 4. The breaker: at or over the day's ceiling, the run is skipped.
  reset();
  net.dayTotal = M.JOB_LIMITS["ipo-refresh"].perDay;
  let ran = false;
  r = await M.runGuarded("ipo-refresh", async () => { ran = true; });
  ok("breaker open: the run is skipped", r.outcome.skipped === "circuit-breaker" && !ran);
  reset();
  net.dayTotal = M.JOB_LIMITS["ipo-refresh"].perDay - 2;
  r = await M.runGuarded("ipo-refresh", async () => { await redisPipe(3); });
  ok("crossing the ceiling marks the trip for the alert", net.hsets.some((h) => h[1].startsWith("msh:jobs:commands:v1:") && String(h[2]).endsWith(":tripped")), JSON.stringify(net.hsets));

  // 5. The kill switch, through Edge Config; absent config means enabled.
  reset();
  process.env.EDGE_CONFIG = "https://edge-config.test/ecfg_x?token=tok";
  net.edge = { "ipo-refresh": false };
  ran = false;
  r = await M.runGuarded("ipo-refresh", async () => { ran = true; });
  ok("Edge Config false: skipped as kill-switch", r.outcome.skipped === "kill-switch" && !ran);
  reset();
  process.env.EDGE_CONFIG = "https://edge-config.test/ecfg_x?token=tok";
  net.edge = null; // 404: no `jobs` item
  ran = false;
  await M.runGuarded("ipo-refresh", async () => { ran = true; });
  ok("no `jobs` item: the job runs", ran);
  reset();
  ran = false;
  await M.runGuarded("ipo-refresh", async () => { ran = true; });
  ok("no EDGE_CONFIG at all: the job runs (fails open)", ran);

  // 6. Outside a guarded run, fetch is untouched.
  reset();
  const outside = await fetch("https://fmp.test/x").then((x) => x.status, () => "threw");
  ok("outside a run, fetch passes through", outside === 200);
  return fails;
}

let failures = 0;
const src = read(MODULE);
const base = await suite(await load(src));
console.log("=== 1. the guard, against a stubbed network ===");
if (!base.length) console.log("  PASS  every assertion");
for (const f of base) console.log(`  FAIL  ${f}`);
failures += base.length;

// ── 2. wiring ────────────────────────────────────────────────────────────────
console.log("\n=== 2. every guarded job's route exports the guarded GET ===");
const JOBS = ["warm-stock-data", "warm-fundamentals", "warm-screener-fundamentals", "warm-picker-universe", "warm-pickers-sec", "ipo-refresh"];
for (const job of JOBS) {
  const route = read(`app/api/jobs/${job}/route.ts`);
  const pass = new RegExp(`export const GET = guardJob\\("${job}", handleGET\\);`).test(route) && !/export async function GET\b/.test(route);
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${job}`);
  if (!pass) failures++;
}

// ── 3. mutants ───────────────────────────────────────────────────────────────
console.log("\n=== 3. mutants (each must be caught) ===");
const MUTANTS = [
  ["a pipeline counts as one", "return Array.isArray(parsed) ? Math.max(1, parsed.length) : 1;", "return 1;"],
  ["a stopped run keeps sending", "    if (ctx.stopped) throw new JobStoppedError(ctx.stopped);\n", ""],
  ["the run record is blocked after a stop", "    if (isRedis && isRunRecordWrite(init?.body)) return original(input, init);\n", ""],
  ["a mixed batch rides on a run-record SET", "  return cmds.every(", "  return cmds.some("],
  ["Redis failures ignored", "    if (await isRedisFailure(res)) ctx.stopped = \"redis-error\";", ""],
  ["the breaker never opens", "if (before !== null && before >= limits.perDay) {", "if (false) {"],
  ["the kill switch fails closed without Edge Config", "  if (!conn) return true;", "  if (!conn) return false;"],
  ["a limit refusal is not a failure", "return /limit|quota|exceeded|max requests|max daily/i.test(text);", "return false;"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source`);
    failures++;
    continue;
  }
  const fails = await suite(await load(src.replace(from, to)));
  console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : " — NOTHING FAILED"}`);
  if (!fails.length) failures++;
}

console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
