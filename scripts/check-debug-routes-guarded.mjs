// Every debug route is behind the key, and the key is checked before the cost.
//
// WHAT WAS OPEN. Nine of the fourteen route handlers whose path contains
// "debug" had NO key, NO lockout and NO bot guard, with
// `next: { revalidate: 0 }` -- so every request was real spend:
//
//   /api/debug/earnings-calendar    3 FMP calls INCLUDING /stable/stock-list at
//                                   3.0 MB. ~6,800 requests exhausts the entire
//                                   20 GB monthly FMP cap.
//   /api/debug/pickers-size         getPickersData -- the ~8 MB payload, read
//                                   from REDIS, per request. Not on the brief's
//                                   list and arguably the worst of them: ~2,500
//                                   requests is 20 GB of Redis read bandwidth,
//                                   which is the meter that suspended the
//                                   database on 2026-08-28.
//   plus symbol-search, earnings/[symbol], index-changes, ipo-calendar,
//   picker-structure, universe-size and stock-earnings-debug/[symbol].
//
// robots.ts disallows /api/, which keeps well-behaved crawlers out. Scrapers do
// not read robots -- that is why this site runs a firewall, and the firewall
// logged ~1.6k bot challenges a day before the August work.
//
// THE LIST IS SCANNED, NOT TYPED. A hand-written list is how the tenth one gets
// missed -- the brief itself listed six of the nine, and the three it missed
// included the 8 MB one. This walks app/api and takes every route whose path
// contains "debug".
//
// NO EXEMPTIONS. None of the fourteen is meant to be public: every one exists
// to answer a question about the plan, the cache or the payload, and every one
// costs FMP bandwidth, Redis bandwidth or both. If a future route genuinely
// needs to be open, exempt it HERE by name with the reason, rather than
// weakening the rule for all of them.
//
//   node scripts/check-debug-routes-guarded.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Routes that may answer without a key. Empty, deliberately -- see the header. */
const PUBLIC_BY_DESIGN = new Set([]);

const routes = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") routes.push(path.relative(ROOT, full));
  }
};
walk(path.join(ROOT, "app/api"));
const debugRoutes = routes.filter((r) => r.includes("debug"));

console.log("\n1. Every debug route asks for the key");

check(
  "the scan found debug routes to check",
  debugRoutes.length >= 10,
  `${debugRoutes.length} of ${routes.length} route handlers under app/api have "debug" in ` +
    `their path — a scan that finds nothing passes trivially, which is the ` +
    `failure mode of a derived list`
);

const unguarded = debugRoutes.filter(
  (r) => !PUBLIC_BY_DESIGN.has(r) && !/guardDebugRequest\(/.test(readCodeOnly(r))
);
check(
  "every one of them calls guardDebugRequest",
  unguarded.length === 0,
  unguarded.length
    ? `OPEN: ${unguarded.join(", ")}`
    : `all ${debugRoutes.length}, with no exemptions — /api/debug/earnings-calendar ` +
      `alone pulls 3.0 MB of FMP per request and ~6,800 requests would exhaust the ` +
      `monthly cap`
);

// THE GUARD HAS TO COME FIRST, or the request pays for the work and THEN gets a
// 401. That is not a theoretical ordering point: earnings-calendar's first
// statement fetched /stable/stock-list.
const late = [];
for (const rel of debugRoutes) {
  if (PUBLIC_BY_DESIGN.has(rel)) continue;
  const src = readCodeOnly(rel);
  const handler = src.indexOf("export async function GET(");
  if (handler === -1) continue;
  const body = src.slice(handler);
  const firstAwait = body.indexOf("await ");
  const guardAt = body.indexOf("await guardDebugRequest(");
  if (firstAwait === -1 || guardAt !== firstAwait) late.push(rel);
}
check(
  "and it is the FIRST thing the handler awaits",
  late.length === 0,
  late.length
    ? `work happens before the key check in: ${late.join(", ")}`
    : "a 401 that arrives after the 3 MB fetch has already cost the 3 MB"
);

console.log("\n2. One mechanism, not a copy per route");

// THE COPIES HAD ALREADY DRIFTED. The five routes that were guarded carried
// THREE versions of the same fifteen lines -- `{ error }` vs `{ ok: false,
// error }`, a retry-after header on one, `submitted` vs an inline lookup.
// Nothing had changed the rule; the copies drifted the way copies do. Nine more
// would have made the assertion above have to match three shapes to be true.
const reimplemented = debugRoutes.filter((r) => /checkBackfillKey\(/.test(readCodeOnly(r)));
check(
  "no route re-implements the guard inline",
  reimplemented.length === 0,
  reimplemented.length
    ? `inline guard in: ${reimplemented.join(", ")}`
    : "one implementation in backfillAuth.ts, so there is one place the rule " +
      "lives and one thing to assert about it"
);

console.log("\n3. The guard itself, run");

// RUN, NOT GREPPED. Fourteen routes now depend on this one function; a guard
// that returned null on a bad key would open all of them at once, and no
// amount of grepping for its NAME would notice.
const auth = readCodeOnly("lib/server/backfillAuth.ts");
const guardSrc = grabFunction(auth, "guardDebugRequest");
if (!guardSrc) {
  console.error("FAIL: could not extract guardDebugRequest — measuring nothing.");
  process.exit(1);
}
const calls = { recorded: 0, cleared: 0 };
globalThis.__GUARD_STATE = { locked: false, retryAfterSeconds: 0, keyOk: false, calls };
const guard = await lift(
  guardSrc,
  `const getClientIp = () => "1.2.3.4";
const checkBackfillLockout = async () => ({
  locked: globalThis.__GUARD_STATE.locked,
  retryAfterSeconds: globalThis.__GUARD_STATE.retryAfterSeconds,
});
const checkBackfillKey = () => globalThis.__GUARD_STATE.keyOk;
const recordBackfillFailure = async () => { globalThis.__GUARD_STATE.calls.recorded++; };
const clearBackfillFailures = async () => { globalThis.__GUARD_STATE.calls.cleared++; };`
);
const req = (q = "") => new Request(`https://example.invalid/api/debug/x${q}`);

globalThis.__GUARD_STATE.keyOk = false;
const noKey = await guard.guardDebugRequest(req());
check(
  "no key is a 401, and the attempt is recorded",
  noKey !== null && noKey.status === 401 && calls.recorded === 1,
  `status ${noKey?.status}, ${calls.recorded} failure(s) recorded — without the ` +
    `record there is no lockout, and without the lockout the key is a speed bump`
);

globalThis.__GUARD_STATE.keyOk = true;
const good = await guard.guardDebugRequest(req("?key=right"));
check(
  "the right key returns null, so the route continues",
  good === null && calls.cleared === 1,
  "and clears the failure count, or one typo followed by nine good requests " +
    "still locks the owner out"
);

globalThis.__GUARD_STATE.locked = true;
globalThis.__GUARD_STATE.retryAfterSeconds = 42;
const locked = await guard.guardDebugRequest(req("?key=right"));
check(
  "a locked-out IP is refused BEFORE the key is even considered",
  locked !== null && locked.status === 429 && locked.headers.get("retry-after") === "42",
  `status ${locked?.status}, retry-after ${locked?.headers.get("retry-after")} — ` +
    `checking the key first would let an attacker keep probing while locked out, ` +
    `and the header is the only part that tells a legitimate caller when to return`
);
const body = await locked.json();
check(
  "...and the refusal carries both response shapes the old copies used",
  body.ok === false && typeof body.error === "string" && body.retryAfterSeconds === 42,
  "the five drifted copies answered `{ error }` or `{ ok: false, error }`; the " +
    "union breaks neither"
);

console.log(
  failures === 0
    ? "\nEvery debug route is behind the key, and the key is checked first.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
