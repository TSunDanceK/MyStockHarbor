// A FORCED RUN MUST NOT REPLACE A GOOD PAYLOAD WITH A DEGRADED ONE.
//
// The question this answers, asked before the 07:00 force was built: the
// degraded-build fallback requires >=15% symbol failures, a prior cache, AND
// forceRefresh false -- so what does a forced run do when 15% of the universe
// fails?
//
// ANSWER, MEASURED: before the fix, it overwrote the good cache. Two independent
// reasons, and fixing either alone would not have been enough:
//
//   1. the guard was gated on `!forceRefresh`
//   2. `const cached = forceRefresh ? null : await readPickersCache()` meant
//      `cached?.data` was falsy under force anyway, so the guard could not have
//      fired even with (1) removed -- and the same nullity silently disabled the
//      lock-contention fallback and the build-threw fallback, which are spelled
//      the same way
//
// This harness EXTRACTS AND RUNS the real getPickersData and the real
// handlePickersRequest against stubbed I/O, rather than asserting anything about
// the shape of the source. A grep would have passed on a version that read the
// cache and then ignored it.
//
//   node scripts/check-forced-build-safety.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SRC = "lib/server/pickersBuilder.ts";
const raw = fs.readFileSync(path.join(ROOT, SRC), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sf = ts.createSourceFile(SRC, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const grab = (name) => {
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      out = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

const WANTED = ["isDegradedBuild", "recordBuildStats", "getPickersData", "handlePickersRequest", "isCronAuthorized"];
const fns = Object.fromEntries(WANTED.map((n) => [n, grab(n)]));
const missing = WANTED.filter((n) => !fns[n]);
if (missing.length) {
  console.error(`FAIL: could not extract ${missing.join(", ")} — measuring nothing.`);
  process.exit(1);
}

// The real constant, read from the file. Restating 0.15 here would mean a
// harness that keeps passing after someone changes the threshold.
const ratioLine = /const DEGRADED_BUILD_FAILURE_RATIO = ([\d.]+);/.exec(raw);
if (!ratioLine) {
  console.error("FAIL: could not read DEGRADED_BUILD_FAILURE_RATIO.");
  process.exit(1);
}
const RATIO = Number(ratioLine[1]);

// ---------------------------------------------------------------------------
// The stub bench. Everything below is I/O; the four functions above are real.
// ---------------------------------------------------------------------------
const PRELUDE = `
const DEGRADED_BUILD_FAILURE_RATIO = ${RATIO};
const MEMORY_CACHE_MS = 0;            // memo never satisfies a read; force is what we are testing
const CACHE_SECONDS = 60;
const STALE_SECONDS = 120;
let memo = null;

export const bench = {
  cache: null,          // what readPickersCache returns
  built: null,          // what buildPickersPayload returns
  buildThrows: false,
  lock: "token",        // null simulates losing the lock
  writes: [],           // every payload written to the cache
  builds: [],           // every buildPickersPayload call's opts
  keyOk: false,
  cronOk: false,
};

const readPickersCache = async () => bench.cache;
const writePickersCache = async (data) => { bench.writes.push(data); };
const buildReducedPickersPayload = (d) => d;
const acquirePickersLock = async () => bench.lock;
const releasePickersLock = async () => {};
const buildPickersPayload = async (origin, opts) => {
  bench.builds.push(opts ?? {});
  if (bench.buildThrows) throw new Error("build failed");
  return bench.built;
};
const originFromReq = () => "https://example.test";
const getClientIp = () => "1.2.3.4";
const checkBackfillLockout = async () => ({ locked: false, retryAfterSeconds: 0 });
const recordBackfillFailure = async () => {};
const clearBackfillFailures = async () => {};
const checkBackfillKey = () => bench.keyOk;
const NextResponse = {
  json: (data, init) => ({ data, status: init?.status ?? 200, headers: init?.headers ?? {} }),
};
let lastBuildStats = null;
export const resetMemo = () => { memo = null; lastBuildStats = null; };
export const readStats = () => lastBuildStats;
`;

const js = ts.transpileModule(
  `${PRELUDE}\n${WANTED.map((n) => fns[n]).join("\n\n")}\n` +
    `export { isDegradedBuild, getPickersData, handlePickersRequest, isCronAuthorized };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
).outputText;

const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { bench } = m;

const payload = (label, degradedPct) => ({ label, degradedSymbolPct: degradedPct });
const GOOD_CACHE = { data: payload("cached-good", 0) };
const HEALTHY = payload("fresh-healthy", 0);
const DEGRADED = payload("fresh-degraded", RATIO * 100 + 5);

function reset(over = {}) {
  bench.cache = null;
  bench.built = HEALTHY;
  bench.buildThrows = false;
  bench.lock = "token";
  bench.writes = [];
  bench.builds = [];
  bench.keyOk = false;
  bench.cronOk = false;
  Object.assign(bench, over);
  m.resetMemo();
}

// A fake request good enough for handlePickersRequest: search params + headers.
const req = ({ force = false, key = "", bearer = null } = {}) => {
  const params = new URLSearchParams();
  if (force) params.set("force", "1");
  if (key) params.set("key", key);
  return {
    nextUrl: { searchParams: params },
    headers: { get: (h) => (h.toLowerCase() === "authorization" && bearer ? bearer : null) },
    url: "https://example.test/api/pickers",
  };
};

console.log("\n=== 0. The predicate itself ===\n");
check("a build at the threshold is degraded", m.isDegradedBuild({ degradedSymbolPct: RATIO * 100 }) === true, `${RATIO * 100}%`);
check("a build just under it is not", m.isDegradedBuild({ degradedSymbolPct: RATIO * 100 - 0.1 }) === false);
check("a build with no figure is not", m.isDegradedBuild({}) === false, "absence is not evidence of failure here");

console.log("\n=== 1. getPickersData: force must not overwrite a good payload ===\n");

reset({ cache: GOOD_CACHE, built: DEGRADED });
let out = await m.getPickersData("o", { forceRefresh: true });
check("FORCED + degraded + good cache: nothing is written", bench.writes.length === 0, `${bench.writes.length} writes`);
check("FORCED + degraded + good cache: the cached payload is returned", out.label === "cached-good", out.label);
check("FORCED + degraded + good cache: it still BUILT", bench.builds.length === 1, "force means refresh, so the build must happen");

reset({ cache: GOOD_CACHE, built: HEALTHY });
out = await m.getPickersData("o", { forceRefresh: true });
check("FORCED + healthy + good cache: the fresh payload IS written", bench.writes.length === 1 && bench.writes[0].label === "fresh-healthy");
check("FORCED + healthy + good cache: the fresh payload is returned", out.label === "fresh-healthy", out.label);

reset({ cache: null, built: DEGRADED });
out = await m.getPickersData("o", { forceRefresh: true });
check("FORCED + degraded + NO cache: the degraded payload IS written", bench.writes.length === 1, "something beats nothing");
check("FORCED + degraded + NO cache: it is returned", out.label === "fresh-degraded", out.label);

reset({ cache: GOOD_CACHE, built: DEGRADED });
out = await m.getPickersData("o", {});
check("UNFORCED + degraded: unchanged — nothing written", bench.writes.length === 0);

console.log("\n=== 1b. The run record tells the truth about what happened ===\n");
// The Sunday/Monday post-mortem is read off ONE page, so the four facts it needs
// have to be recorded rather than inferred. Without `wrote`, "the guard fired"
// and "the guard was not needed" look identical from outside.
reset({ cache: GOOD_CACHE, built: { ...DEGRADED, universeSize: 412 } });
await m.getPickersData("o", { forceRefresh: true });
let stats = m.readStats();
check("a refused degraded build records degradedFallbackUsed", stats?.degradedFallbackUsed === true, JSON.stringify(stats));
check("...and records that it did NOT write", stats?.wrote === false);
check("...and carries the universe size it actually built", stats?.universeSize === 412, String(stats?.universeSize));

reset({ cache: GOOD_CACHE, built: { ...HEALTHY, universeSize: 707 } });
await m.getPickersData("o", { forceRefresh: true });
stats = m.readStats();
check("a published build records wrote:true", stats?.wrote === true && stats?.degradedFallbackUsed === false, JSON.stringify(stats));
check("...with its universe size", stats?.universeSize === 707);

reset({ cache: GOOD_CACHE, built: HEALTHY });
await m.getPickersData("o", {});
check(
  "a run served from cache records NOTHING, rather than repeating the last build",
  m.readStats() === null,
  "null is the answer to \"did the forced warm actually build\""
);

console.log("\n=== 2. Force still means REFRESH, not just 'do not overwrite' ===\n");

reset({ cache: GOOD_CACHE, built: HEALTHY });
await m.getPickersData("o", { forceRefresh: true });
check("a fresh cache does NOT short-circuit a forced run", bench.builds.length === 1, `${bench.builds.length} builds`);

reset({ cache: GOOD_CACHE, built: HEALTHY });
await m.getPickersData("o", {});
check("a fresh cache DOES short-circuit an unforced run", bench.builds.length === 0, `${bench.builds.length} builds`);

reset({ cache: GOOD_CACHE, built: HEALTHY, lock: null });
await m.getPickersData("o", { forceRefresh: true });
check(
  "a forced run that LOSES THE LOCK still builds",
  bench.builds.length === 1,
  "reading the cache must not change what a forced run does"
);

reset({ cache: GOOD_CACHE, built: HEALTHY, lock: null });
out = await m.getPickersData("o", {});
check("an unforced run that loses the lock serves the cache", bench.builds.length === 0 && out.label === "cached-good");

console.log("\n=== 3. The build-threw fallback survives under force ===\n");

// CAUGHT, NOT LEFT TO PROPAGATE. This assertion is precisely about whether the
// function throws, so an unhandled throw here aborts the whole run and reports a
// failure count lower than the real one -- the harness measures how far it got
// rather than what is broken.
//
// RE-APPLIED 2026-08-23. #362's "Calibration fixes" commit message described
// this wrap; `git log -S threwWithCache` shows it was never committed. A
// calibration `git checkout --` reverted it before the commit, so the reported
// M2 = 7 was measured on a tree that had it and main shipped without it. Under
// the crashing version the same mutation reads 4.
reset({ cache: GOOD_CACHE, buildThrows: true });
out = null;
let threwWithCache = false;
try { out = await m.getPickersData("o", { forceRefresh: true }); } catch { threwWithCache = true; }
check(
  "FORCED + threw + good cache: the cache is returned, not an exception",
  !threwWithCache && out?.label === "cached-good",
  threwWithCache ? "threw" : String(out?.label)
);

reset({ cache: null, buildThrows: true });
let threw = false;
try { await m.getPickersData("o", { forceRefresh: true }); } catch { threw = true; }
check("FORCED + threw + NO cache: it throws", threw);

console.log("\n=== 4. handlePickersRequest — the path the cron actually takes ===\n");

reset({ cache: GOOD_CACHE, built: DEGRADED, keyOk: true });
let res = await m.handlePickersRequest(req({ force: true, key: "k" }), { requestHistoryForce: true });
check("FORCED warm + degraded + good cache: nothing written", bench.writes.length === 0, `${bench.writes.length} writes`);
check("FORCED warm + degraded + good cache: cached payload served", res.data.label === "cached-good", res.data.label);
check("FORCED warm + degraded: the degraded-fallback header is set", res.headers["X-Pickers-Degraded-Fallback"] === "true");

reset({ cache: GOOD_CACHE, built: HEALTHY, keyOk: true });
res = await m.handlePickersRequest(req({ force: true, key: "k" }), { requestHistoryForce: true });
check("FORCED warm + healthy: written", bench.writes.length === 1);
check("FORCED warm + healthy: history force reached the builder", bench.builds[0]?.forceHistoryRefresh === true, JSON.stringify(bench.builds[0]));
check("FORCED warm + healthy: the header reports the force", res.headers["X-Pickers-History-Forced"] === "true");

console.log("\n=== 5. The history force is separately authorised ===\n");
// ~700 FMP calls. `?force=1` alone rebuilds the payload; spending the FMP budget
// needs the cron secret or the owner key.

const OLD_SECRET = process.env.CRON_SECRET;
delete process.env.CRON_SECRET;
// NO CACHE, deliberately. With a good cache and no force the handler serves it
// and never builds, so `builds[0]` would be undefined and the assertion would be
// reading its own setup rather than the refusal.
reset({ cache: null, built: HEALTHY });
res = await m.handlePickersRequest(req(), { requestHistoryForce: true });
check(
  "no CRON_SECRET, no key: the history force is REFUSED",
  bench.builds[0]?.forceHistoryRefresh === false,
  "fails closed, unlike the other job routes' isAuthorized"
);
check("...and the header says so", res.headers["X-Pickers-History-Forced"] === "false");

process.env.CRON_SECRET = "s3cret";
reset({ cache: null, built: HEALTHY });
res = await m.handlePickersRequest(req({ bearer: "Bearer wrong" }), { requestHistoryForce: true });
check("wrong bearer: refused", bench.builds[0]?.forceHistoryRefresh === false);

reset({ cache: GOOD_CACHE, built: HEALTHY });
res = await m.handlePickersRequest(req({ bearer: "Bearer s3cret" }), { requestHistoryForce: true });
check("correct bearer: granted", bench.builds[0]?.forceHistoryRefresh === true);
check("...and it implies a payload rebuild", bench.builds.length === 1, "fresh bars nothing reads would be pointless");

reset({ cache: GOOD_CACHE, built: HEALTHY });
res = await m.handlePickersRequest(req({ bearer: "Bearer s3cret" }));
check(
  "the PUBLIC handler never forces history even with a valid bearer",
  bench.builds.length === 0 && res.data.label === "cached-good",
  "GET does not pass requestHistoryForce"
);
check(
  "every response path reports whether the force happened",
  res.headers["X-Pickers-History-Forced"] === "false",
  "an absent header and a false one are the same fact reported two ways"
);
if (OLD_SECRET === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = OLD_SECRET;

console.log("\n=== 6. GET and GET_WARM are one implementation, not two ===\n");
// The two routes were consolidated so they could never drift. Adding forced
// behaviour must not reintroduce a second copy.
const code = stripComments(raw, { file: SRC });
check("the comment stripper kept the code", code.includes("export async function GET_WARM"), `${code.length} of ${raw.length} chars`);
check(
  "GET delegates",
  /export async function GET\(req: NextRequest\) \{\s*return handlePickersRequest\(req\);\s*\}/.test(code)
);
check(
  "GET_WARM delegates",
  /export async function GET_WARM\(req: NextRequest\) \{\s*return handlePickersRequest\(req, \{ requestHistoryForce: true \}\);\s*\}/.test(code)
);
check(
  "there is exactly one cache-write site in the module",
  (code.match(/await writePickersCache\(/g) || []).length === 2,
  "getPickersData and handlePickersRequest — a third means a path that skipped the guard"
);
check(
  "every write site is preceded by the degraded guard",
  (code.match(/if \(isDegradedBuild\(data\) && cached\?\.data\)/g) || []).length === 2
);
check(
  "no write path is gated on !forceRefresh",
  !/isDegradedBuild\(data\) && cached\?\.data && !forceRefresh/.test(code) &&
    !/&& !forceRefresh\) \{[\s\S]{0,200}last known-good/.test(code)
);
check(
  "the cache is read unconditionally in both paths",
  (code.match(/const cached = await readPickersCache\(\);/g) || []).length === 2 &&
    !/forceRefresh \? null : await readPickersCache\(\)/.test(code),
  "the conditional read is what disabled all three fallbacks at once"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
