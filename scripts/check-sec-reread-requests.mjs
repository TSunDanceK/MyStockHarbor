// COMMITTED RE-READ REQUESTS (#552 COWORK #30): a code change puts a symbol
// on the sec-facts reverify queue, with no secret and no manual call.
//
//   1. applyRereadRequests, RUN: flags a symbol last verified before the
//      request; not one verified after it (one-shot); not one already queued;
//      not one with no CIK or no manifest entry; not a future-dated request;
//      at most one a run. MUTATIONS: the verifiedAt test removed (the request
//      would re-read the symbol every run forever); the cap removed.
//   2. The cron applies the requests BEFORE it builds its queues.
//      MUTATION: applied after.
//   3. The committed file parses and names XOM with a real timestamp.
//
//   node scripts/check-sec-reread-requests.mjs
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
const SRC = readCodeOnly("lib/server/secRereadRequests.ts");
const load = (src) => lift([
  src.match(/^export const SEC_REREAD_REQUESTS_PER_RUN = \d+;$/m)?.[0].replace(/^export /, "") ?? "",
  grabFunction(src, "applyRereadRequests"),
  "export { applyRereadRequests };",
].join("\n"));

const NOW = Date.parse("2026-09-25T06:00:00Z");
const entry = (over = {}) => ({ cik: "0000000001", needsReverify: false, reverifyReason: null, verifiedAt: Date.parse("2026-09-01T00:00:00Z"), enqueuedAt: null, ...over });
const manifest = () => ({ symbols: {
  XOM: entry(),
  AAPL: entry({ verifiedAt: Date.parse("2026-09-24T20:00:00Z") }),
  NVDA: entry({ needsReverify: true, reverifyReason: "periodic-report", enqueuedAt: 5 }),
  NOCIK: entry({ cik: null }),
  MSFT: entry(),
} });
const REQ = (symbol, requestedAt = "2026-09-24T12:30:00Z") => ({ symbol, requestedAt, reason: "test" });

console.log("1. applyRereadRequests");
const M = await load(SRC);
{
  const m = manifest();
  const out = M.applyRereadRequests(m, [REQ("XOM")], NOW);
  check("a symbol verified before the request is flagged 'requested'",
    out.join() === "XOM" && m.symbols.XOM.needsReverify === true && m.symbols.XOM.reverifyReason === "requested" && m.symbols.XOM.enqueuedAt === NOW);
  const m2 = manifest();
  check("verified after the request → inert (one-shot)", M.applyRereadRequests(m2, [REQ("AAPL")], NOW).length === 0 && !m2.symbols.AAPL.needsReverify);
  const m3 = manifest();
  check("already queued → left as it is (its own reason kept)",
    M.applyRereadRequests(m3, [REQ("NVDA")], NOW).length === 0 && m3.symbols.NVDA.reverifyReason === "periodic-report" && m3.symbols.NVDA.enqueuedAt === 5);
  check("no CIK, or no manifest entry → nothing",
    M.applyRereadRequests(manifest(), [REQ("NOCIK"), REQ("ZZZZ")], NOW).length === 0);
  check("a future-dated request waits", M.applyRereadRequests(manifest(), [REQ("XOM", "2026-10-01T00:00:00Z")], NOW).length === 0);
  check("at most one a run", M.applyRereadRequests(manifest(), [REQ("XOM"), REQ("MSFT")], NOW).join() === "XOM");
  const Mm = await load(once(SRC, "if ((entry.verifiedAt ?? 0) >= at) continue;", ""));
  check("MUTATION: the verifiedAt test removed → a re-read symbol is flagged again forever",
    Mm.applyRereadRequests(manifest(), [REQ("AAPL")], NOW).length === 1);
  const Mc = await load(once(SRC, "if (applied.length >= cap) break;", ""));
  check("MUTATION: the cap removed → two in one run", Mc.applyRereadRequests(manifest(), [REQ("XOM"), REQ("MSFT")], NOW).length === 2);
}

console.log("\n2. the cron applies them before building its queues");
const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const before = (src) => {
  const a = src.indexOf("applyRereadRequests(manifest, SEC_REREAD_REQUESTS, Date.now())");
  const q = src.indexOf("const q = populationQueues(manifest);");
  return a > 0 && q > a;
};
check("applyRereadRequests runs before populationQueues", before(ROUTE));
check("MUTATION: applied after the queues are built → caught",
  !before(once(ROUTE, "const q = populationQueues(manifest);", "const q = populationQueues(manifest);\nconst late = applyRereadRequests(manifest, SEC_REREAD_REQUESTS, Date.now());").replace("const requested = applyRereadRequests(manifest, SEC_REREAD_REQUESTS, Date.now());", "const requested = [];")));

console.log("\n3. the committed file");
const FILE = JSON.parse(fs.readFileSync("data/sec/reread-requests.json", "utf8"));
check("every request has a symbol, a parseable requestedAt and a reason",
  FILE.requests.every((r) => r.symbol && Number.isFinite(Date.parse(r.requestedAt)) && r.reason));
check("XOM is requested (#581's predecessor merge)", FILE.requests.some((r) => r.symbol === "XOM"));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
