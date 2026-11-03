// COMMITTED FILING-JOB CHECK REQUESTS (audit r6): a code change asks the
// filing job to check a filer once more, with no secret and no manual call.
//
//   1. requestedFilingChecks, RUN: a filer last checked before the request is
//      returned; not one checked after it (one-shot); a filer never checked is
//      returned; a future-dated request waits; a symbol requested twice once.
//      MUTATION: the last-check test removed (the request would re-check the
//      filer every run forever).
//   2. pickCandidates puts a requested filer at rank 1 in every non-idle mode,
//      including one with no lag and no newer filing, which the job would
//      otherwise skip; none in idle mode.
//   3. The route adds the requests to the due set it hands pickCandidates,
//      and does not write them into the stored due list. MUTATION: the
//      requests left out of pickCandidates' due set → caught.
//   4. The committed file parses; the nine audit-r6 filers are requested.
//
//   node scripts/check-sec-filing-check-requests.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const SRC = readCodeOnly("lib/server/secFilingCheckRequests.ts");
const load = (src) => lift([grabFunction(src, "requestedFilingChecks"), "export { requestedFilingChecks };"].join("\n"));
const NOW = Date.parse("2026-11-04T06:00:00Z");
const AT = "2026-11-03T14:30:00Z";
const REQ = (symbol, requestedAt = AT) => ({ symbol, requestedAt, reason: "test" });
const state = new Map([
  ["EIX", { c: Date.parse("2026-11-01T02:00:00Z"), lag: null }],
  ["DOW", { c: Date.parse("2026-11-03T20:00:00Z"), lag: null }],
  ["XOM", { c: Date.parse("2026-11-01T02:00:00Z"), lag: null }],
]);

console.log("1. requestedFilingChecks");
const M = await load(SRC);
check("last checked before the request → returned", M.requestedFilingChecks([REQ("EIX")], state, NOW).join() === "EIX");
check("checked after the request → inert (one-shot)", M.requestedFilingChecks([REQ("DOW")], state, NOW).length === 0);
check("never checked → returned", M.requestedFilingChecks([REQ("URI")], state, NOW).join() === "URI");
check("a future-dated request waits", M.requestedFilingChecks([REQ("EIX", "2026-11-05T00:00:00Z")], state, NOW).length === 0);
check("an unparseable requestedAt does nothing", M.requestedFilingChecks([REQ("EIX", "soon")], state, NOW).length === 0);
check("requested twice → once", M.requestedFilingChecks([REQ("EIX"), REQ("eix")], state, NOW).join() === "EIX");
{
  const Mm = await load(once(SRC, "if ((state.get(symbol)?.c ?? 0) >= at) continue;", ""));
  check("MUTATION: the last-check test removed → a filer checked since is re-checked forever (caught)",
    Mm.requestedFilingChecks([REQ("DOW")], state, NOW).length === 1);
}

console.log("\n2. pickCandidates takes a requested filer at rank 1");
const JOB = readCodeOnly("lib/server/secFilingJob.ts");
const J = await lift([grabFunction(JOB, "pickCandidates"), "export { pickCandidates };"].join("\n"));
// EIX: checked, no lag, lastFiled before its last check -- the job would skip it.
const entries = [["EIX", { cik: "0000827052", lastFiled: "20261028" }], ["XOM", { cik: "0000034088", lastFiled: "20261028" }]];
for (const mode of ["season", "nightly", "catch-up"]) {
  const out = J.pickCandidates(mode, entries, state, new Set(["EIX"]), NOW);
  check(`${mode}: the requested no-lag filer is checked at rank 1`, out.length === 1 && out[0].symbol === "EIX" && out[0].rank === 1);
}
check("without the request it is skipped (why the request exists)",
  J.pickCandidates("nightly", entries, state, new Set(), NOW).every((c) => c.symbol !== "EIX"));
check("idle: nothing", J.pickCandidates("idle", entries, state, new Set(["EIX"]), NOW).length === 0);

console.log("\n3. the route wires it into this run's due set only");
const ROUTE = readCodeOnly("app/api/jobs/sec-filings/route.ts");
const wired = (src) => /const requested = requestedFilingChecks\(SEC_FILING_CHECK_REQUESTS, state, started\);/.test(src)
  && /pickCandidates\(mode, entries, state, new Set\(\[\.\.\.due, \.\.\.requested\]\), started\)/.test(src);
check("requests read against the filing state and added to pickCandidates' due set", wired(ROUTE));
check("the stored due list is written without them", /await writeDueList\(due\);/.test(ROUTE) && !/writeDueList\([^)]*requested/.test(ROUTE));
check("MUTATION: requests left out of the due set → caught",
  !wired(once(ROUTE, "new Set([...due, ...requested])", "new Set(due)")));

console.log("\n4. the committed file");
const FILE = JSON.parse(fs.readFileSync("data/sec/filing-check-requests.json", "utf8"));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
check("every request has a symbol, a parseable requestedAt and a reason",
  FILE.requests.every((r) => r.symbol && Number.isFinite(Date.parse(r.requestedAt)) && r.reason));
check("every requested symbol is a registrant", FILE.requests.every((r) => REG[r.symbol]));
const NINE = ["EIX", "DOW", "URI", "IDA", "CAH", "CMS-PB", "CNMD", "NNN", "TAP"];
check("the nine audit-r6 no-lag filers are requested", NINE.every((s) => FILE.requests.some((r) => r.symbol === s)));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
