// The FMP limiter fails CLOSED, and a history lock error skips the symbol
// (#553 COWORK #53; CODE-B #39 "riskiest gaps" 1 and 2).
//
// WHAT WENT WRONG: every catch in the minute limiter returned -- a Redis error
// meant "no throttle". During a Redis outage the warm jobs called FMP
// unthrottled while their writes failed silently. And a failed history-lock SET
// read as "someone else holds it", so each symbol polled for 12 s (~40 GETs),
// ~28K commands in one 700-symbol run, exactly while Redis was refusing.
//
// Runs the REAL module against a stubbed Upstash that fails on demand. The
// Upstash client retries a failed request itself, so assertions count
// requests rather than time.
//
//   node scripts/check-fmp-limiter-fail-closed.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const MODULE = "lib/server/historyCache.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REDIS = "https://fake-redis.test";
process.env.UPSTASH_REDIS_REST_URL = REDIS;
process.env.UPSTASH_REDIS_REST_TOKEN = "t";
process.env.FMP_API_KEY = "test-key";

const net = { down: false, redis: 0, fmp: 0 };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith(REDIS)) {
    net.fmp++;
    return new Response("[]", { status: 200 });
  }
  net.redis++;
  // An HTTP error, not a thrown fetch: the Upstash client retries network
  // errors with backoff (~4 s a call) but raises on an error response at once.
  if (net.down) return new Response(JSON.stringify({ error: "ERR stub: Redis down" }), { status: 500 });
  const body = JSON.parse(init.body ?? "null");
  const cmds = Array.isArray(body?.[0]) ? body : [body];
  const answer = (c) => {
    const op = String(c[0]).toLowerCase();
    if (op === "incr") return 1;
    if (op === "get") return null;
    if (op === "set") return "OK";
    return 1;
  };
  const results = cmds.map((c) => ({ result: answer(c) }));
  return new Response(JSON.stringify(/\/pipeline/.test(url) ? results : results[0]), { status: 200 });
};

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib/server", `.check-flf-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

async function suite(M) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 1. Healthy Redis: a reservation goes through.
  M.resetFmpLimiterForTests();
  net.down = false;
  let threw = null;
  try { await M.reserveFmpCallSlot(); } catch (e) { threw = e; }
  ok("with Redis healthy, a slot is reserved", threw === null, String(threw));

  // 2. Redis errors: the reservation is REFUSED (it used to return = allow).
  net.down = true;
  threw = null;
  try { await M.reserveFmpCallSlot(); } catch (e) { threw = e; }
  ok("a Redis error REFUSES the call (fail closed)", threw && threw.reason === "capacity-timeout", String(threw));
  ok("...and opens the cooldown", M.fmpLimiterDown());

  // 3. During the cooldown nothing touches Redis, and nothing is allowed.
  const before = net.redis;
  const usage = await M.getFmpMinuteUsage();
  const cap = await M.hasFmpCapacity(1, 0);
  const tryRes = await M.tryReserveFmpCallSlot();
  threw = null;
  try { await M.reserveFmpCallSlot(); } catch (e) { threw = e; }
  ok("in the cooldown, minute usage reads as FULL", usage >= 200, String(usage));
  ok("in the cooldown, there is no capacity", cap === false);
  ok("in the cooldown, the render path is refused", tryRes === false);
  ok("in the cooldown, a reservation is refused", threw !== null);
  ok("in the cooldown, none of that sent a Redis request", net.redis === before, `${net.redis - before} request(s)`);

  // 4. The render path, on its own: a Redis error refuses (it used to allow).
  M.resetFmpLimiterForTests();
  net.down = true;
  ok("tryReserveFmpCallSlot refuses on a Redis error", (await M.tryReserveFmpCallSlot()) === false);
  M.resetFmpLimiterForTests();
  ok("getFmpMinuteUsage reads FULL on a Redis error, not 0", (await M.getFmpMinuteUsage()) >= 200);

  // 5. The history lock: a Redis error skips the symbol, no 12 s poll, no FMP call.
  M.resetFmpLimiterForTests();
  net.down = true;
  const r0 = net.redis, f0 = net.fmp;
  let bars = null;
  try { bars = await M.getDailyHistory("ZZZT"); } catch (e) { bars = e; }
  ok("a history lock error returns no bars (skipped this run)", Array.isArray(bars) && bars.length === 0, bars instanceof Error ? `threw: ${bars.message}` : "");
  ok("...without the 12 s wait-poll (a handful of requests, not ~40 polls x retries)", net.redis - r0 < 30, `${net.redis - r0} Redis request(s)`);
  ok("...and without calling FMP", net.fmp === f0, `${net.fmp - f0} FMP call(s)`);
  net.down = false;
  M.resetFmpLimiterForTests();
  return fails;
}

let failures = 0;
const src = read(MODULE);
const base = await suite(await load(src));
console.log("=== 1. fail-closed limiter and lock, on the real module ===");
if (!base.length) console.log("  PASS  every assertion");
for (const f of base) console.log(`  FAIL  ${f}`);
failures += base.length;

console.log("\n=== 2. mutants (each must be caught) ===");
const MUTANTS = [
  ["reserveFmpCallSlot fails open again", "      markFmpLimiterDown(err);\n      throw limiterRefusal();\n    }\n\n    // READ-ONLY WAIT.", "      return;\n    }\n\n    // READ-ONLY WAIT."],
  ["the render path fails open again", "    markFmpLimiterDown(err);\n    return false;\n  }\n}", "    return true;\n  }\n}"],
  ["minute usage reads 0 on an error", "    markFmpLimiterDown(err);\n    return FMP_SAFE_CALLS_PER_MINUTE;\n  }\n}", "    return 0;\n  }\n}"],
  ["the cooldown still calls Redis", "  if (fmpLimiterDown()) return FMP_SAFE_CALLS_PER_MINUTE;\n", ""],
  ["a lock error means 'someone holds it' again", '    return "lock-error" as const;', "    return null;"],
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
