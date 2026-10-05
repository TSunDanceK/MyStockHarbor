// A DEADLINE ON EVERY UPSTASH REQUEST (#553 CODE-B #144, COWORK #155).
//
// 1. SCAN: every Redis client created in lib/, app/ and instrumentation.ts
//    (Redis.fromEnv / new Redis, found by scanning, not from a list) passes one
//    of the deadline options in lib/server/redisCacheMode.ts: PAGE_READ_CACHE,
//    BULK_READ_CACHE, PAGE_TIMEOUT_OPTS or JOB_REDIS_OPTS. Each option is the
//    FUNCTION form, `signal: () => AbortSignal.timeout(ms)`, and the plain form
//    appears nowhere. The values: 6 s for page paths, 20 s for jobs and bulk.
// 2. RUNTIME, against a local server that accepts and never answers, with the
//    real @upstash/redis client:
//      - the function form throws at the deadline, without retries;
//      - the plain form returns the string "Aborted" as if it were data (the
//        reason the function form is required);
//      - lib/server/redisTimeoutLog logs ONE line per key prefix, rethrows,
//        and ignores non-Upstash requests.
// Every rule has a planted mutant.
//
//   node scripts/check-redis-timeouts.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODE = "lib/server/redisCacheMode.ts";
const LOGGER = "lib/server/redisTimeoutLog.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const OPTIONS = ["PAGE_READ_CACHE", "BULK_READ_CACHE", "PAGE_TIMEOUT_OPTS", "JOB_REDIS_OPTS"];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── 1. the scan ─────────────────────────────────────────────────────────────
function sourceFiles() {
  const out = ["instrumentation.ts"];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && !e.name.startsWith(".check-")) out.push(rel);
    }
  };
  walk("lib");
  walk("app");
  return out;
}

/** Every client construction: the call text up to its closing paren. */
function clientSites(files) {
  const sites = [];
  for (const [file, raw] of Object.entries(files)) {
    const code = stripComments(raw, { file });
    for (const m of code.matchAll(/\b(Redis\.fromEnv|new Redis)\(/g)) {
      let depth = 0, j = m.index + m[0].length - 1;
      for (; j < code.length; j++) {
        if (code[j] === "(") depth++;
        else if (code[j] === ")") { depth--; if (depth === 0) break; }
      }
      sites.push({ file, call: code.slice(m.index, j + 1) });
    }
  }
  return sites;
}

function scanRules(files, modeSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const sites = clientSites(files);
  want("the client sites were found by scanning", sites.length >= 60);
  for (const { file, call } of sites) {
    want(`${file}: ${call.slice(0, 60)} carries a deadline option`, OPTIONS.some((o) => call.includes(o)));
  }
  const mode = stripComments(modeSrc, { file: MODE });
  for (const o of OPTIONS) {
    want(`${o} uses the function form`, new RegExp(`export const ${o} = \\{[^}]*signal: \\(\\) => AbortSignal\\.timeout\\(REDIS_(PAGE|JOB)_TIMEOUT_MS\\)`).test(mode));
  }
  want("the deadlines: 6 s for page paths, 20 s for jobs and bulk",
    /export const REDIS_PAGE_TIMEOUT_MS = 6_000;/.test(mode) && /export const REDIS_JOB_TIMEOUT_MS = 20_000;/.test(mode) &&
      /PAGE_READ_CACHE = \{[^}]*REDIS_PAGE_TIMEOUT_MS/.test(mode) && /PAGE_TIMEOUT_OPTS = \{[^}]*REDIS_PAGE_TIMEOUT_MS/.test(mode) &&
      /BULK_READ_CACHE = \{[^}]*REDIS_JOB_TIMEOUT_MS/.test(mode) && /JOB_REDIS_OPTS = \{[^}]*REDIS_JOB_TIMEOUT_MS/.test(mode));
  want("PAGE_READ_CACHE and BULK_READ_CACHE keep the prerender-safe cache mode", /PAGE_READ_CACHE = \{ cache: "default",/.test(mode) && /BULK_READ_CACHE = \{ cache: "default",/.test(mode));
  // On Redis options only: other fetches (SEC, FRED) legitimately pass a
  // plain signal to fetch itself, where it behaves normally.
  const plain = sites.filter((s) => /signal:\s*AbortSignal\.timeout\(/.test(s.call)).map((s) => s.file);
  if (/signal:\s*AbortSignal\.timeout\(/.test(mode)) plain.push(MODE);
  want("the plain-signal form appears in no Redis option", plain.length === 0);
  return fails;
}

const files = Object.fromEntries(sourceFiles().map((f) => [f, read(f)]));
const modeSrc = read(MODE);
console.log("\n1. Every client carries a deadline (scan)");
const sites = clientSites(files);
const scan = scanRules(files, modeSrc);
check(`all ${sites.length} client sites carry a function-form deadline; 6 s / 20 s`, scan.length === 0, scan.slice(0, 4).join("; "));

// ── 2. runtime, against a server that never answers ─────────────────────────
const hung = [];
const server = http.createServer((req) => { hung.push(req); /* never respond */ });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}`;
const { Redis } = await import("@upstash/redis");
const T = 250;

async function timed(p) {
  const t0 = Date.now();
  try { return { value: await p, ms: Date.now() - t0 }; } catch (err) { return { err, ms: Date.now() - t0 }; }
}

let tmpSeq = 0;
const tmp = [];
async function loadLogger(src) {
  const f = path.join(ROOT, "lib/server", `.check-rtl-${process.pid}-${tmpSeq++}.ts`);
  fs.writeFileSync(f, src.replace('from "./redisSizeGuard"', `from "${pathToFileURL(path.join(ROOT, "lib/server/redisSizeGuard.ts")).href}"`));
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

async function loggerRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const lines = [];
  const target = { fetch: globalThis.fetch.bind(globalThis) };
  L.installRedisTimeoutLog(target, URL_, { warn: (l) => lines.push(l) });
  const saved = globalThis.fetch;
  globalThis.fetch = target.fetch;
  try {
    const r = new Redis({ url: URL_, token: "t", signal: () => AbortSignal.timeout(T) });
    const a = await timed(r.get("msh:test:one"));
    const b = await timed(r.get("msh:test:two"));
    const c = await timed(r.set("msh:other:x", "1"));
    want("the logger rethrows: the caller still sees the TimeoutError itself", [a, b, c].every((x) => x.err?.name === "TimeoutError"));
    want("one line per key prefix: two GETs on msh:test: log once", lines.filter((l) => / GET msh:test:$/.test(l)).length === 1);
    want("...and a different prefix gets its own line", lines.some((l) => / SET msh:other:$/.test(l)));
    const before = lines.length;
    await timed(target.fetch(`${URL_.replace("127.0.0.1", "localhost")}/x`, { signal: AbortSignal.timeout(T) }));
    want("a request to another host is not logged", lines.length === before);
  } finally {
    globalThis.fetch = saved;
  }
  return fails;
}

try {
  console.log("\n2. Runtime, against a server that never answers");
  const fn = new Redis({ url: URL_, token: "t", signal: () => AbortSignal.timeout(T) });
  const f = await timed(fn.get("msh:test:k"));
  check("the function form throws at the deadline", !!f.err && /timeout|abort/i.test(`${f.err?.name} ${f.err?.message}`), `${f.err?.name ?? "resolved"} after ${f.ms} ms`);
  check("...without retrying (well under two deadlines)", f.ms < T * 2 + 400, `${f.ms} ms`);
  // WHY THE PLAIN FORM IS BANNED, both ways it goes wrong: the client turns an
  // abort on a non-function signal into a fake 200 whose result is the abort
  // reason, so with auto-pipelining off a read RETURNS that as data, and with
  // it on (the default) the read fails as an unrelated TypeError, not a
  // timeout. Neither reaches the caller as what it is.
  const plainOff = new Redis({ url: URL_, token: "t", enableAutoPipelining: false, signal: AbortSignal.timeout(T) });
  const p = await timed(plainOff.get("msh:test:k"));
  check("the plain form, auto-pipelining off: the abort comes back as an ordinary result (no error)", !p.err, p.err ? String(p.err) : `resolved to ${JSON.stringify(p.value)}: indistinguishable from a missing key`);
  const plainOn = new Redis({ url: URL_, token: "t", signal: AbortSignal.timeout(T) });
  const q = await timed(plainOn.get("msh:test:k"));
  check("the plain form, auto-pipelining on: the abort surfaces as a non-timeout error", !!q.err && !/timeout/i.test(`${q.err?.name} ${q.err?.message}`), q.err ? `${q.err.name}: ${String(q.err.message).slice(0, 60)}` : "resolved");
  const loggerSrc = read(LOGGER);
  const lr = await loggerRules(await loadLogger(loggerSrc));
  check("the timeout logger: one line per prefix, rethrows, Upstash only", lr.length === 0, lr.join("; "));

  console.log("\n3. Planted mutants");
  const SCAN_MUTANTS = [
    ["a job client without a deadline", "lib/server/jobGuard.ts", "Redis.fromEnv(JOB_REDIS_OPTS)", "Redis.fromEnv()"],
    ["a page client without a deadline", "lib/server/historyCache.ts", "Redis.fromEnv(PAGE_READ_CACHE)", "Redis.fromEnv({ cache: \"default\" })"],
    ["a new client added bare", "app/api/market/route.ts", "const redis = Redis.fromEnv(PAGE_TIMEOUT_OPTS);", "const redis = Redis.fromEnv(PAGE_TIMEOUT_OPTS);\nconst other = new Redis({ url: \"x\", token: \"y\" });"],
  ];
  for (const [label, file, from, to] of SCAN_MUTANTS) {
    if (!files[file]?.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const fl = scanRules({ ...files, [file]: files[file].replace(from, to) }, modeSrc);
    check(`mutant "${label}" is caught`, fl.length > 0, fl[0] ?? "no rule failed");
  }
  const MODE_MUTANTS = [
    ["the plain-signal form", "signal: () => AbortSignal.timeout(REDIS_PAGE_TIMEOUT_MS) } as const;\n/** Bulk", "signal: AbortSignal.timeout(REDIS_PAGE_TIMEOUT_MS) } as const;\n/** Bulk"],
    ["the deadline dropped from page reads", 'export const PAGE_READ_CACHE = { cache: "default", signal: () => AbortSignal.timeout(REDIS_PAGE_TIMEOUT_MS) } as const;', 'export const PAGE_READ_CACHE = { cache: "default" } as const;'],
    ["page reads given the platform's 300 s", "export const REDIS_PAGE_TIMEOUT_MS = 6_000;", "export const REDIS_PAGE_TIMEOUT_MS = 300_000;"],
    ["the cache mode lost (prerender break)", 'export const PAGE_READ_CACHE = { cache: "default", signal', "export const PAGE_READ_CACHE = { signal"],
  ];
  for (const [label, from, to] of MODE_MUTANTS) {
    if (!modeSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const fl = scanRules(files, modeSrc.replace(from, to));
    check(`mutant "${label}" is caught`, fl.length > 0, fl[0] ?? "no rule failed");
  }
  const LOGGER_MUTANTS = [
    ["one line per request, not per prefix", "        if (!seen.has(family)) {\n          seen.add(family);\n          log.warn(`[redis-timeout] ${what}`);\n        }", "        log.warn(`[redis-timeout] ${what}`);"],
    ["the timeout swallowed", "      throw err;\n    }\n  };", "      return null;\n    }\n  };"],
    ["every host logged", "      if (urlOf(input).startsWith(base) && isTimeoutAbort(err, init?.signal)) {", "      if (isTimeoutAbort(err, init?.signal)) {"],
  ];
  for (const [label, from, to] of LOGGER_MUTANTS) {
    if (!loggerSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let fl;
    try { fl = await loggerRules(await loadLogger(loggerSrc.replace(from, to))); } catch (err) { fl = [String(err)]; }
    check(`mutant "${label}" is caught`, fl.length > 0, fl[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
  for (const req of hung) req.socket.destroy();
  server.close();
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
