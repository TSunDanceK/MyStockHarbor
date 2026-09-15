// The cold path: the guards, in the order that makes them guards.
//
// The render itself needs Redis and the network, so what is asserted here is
// the ORDER and the EXISTENCE of the four gates, read from the shipped source,
// plus the pure behaviour that can be run.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const COLD = "lib/server/secColdFetch.ts";
const raw = fs.readFileSync(COLD, "utf8");
const code = readCodeOnly(COLD);
const pageRaw = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const pageCode = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const cardsRaw = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
const jobCode = readCodeOnly("app/api/jobs/sec-facts/route.ts");

console.log("\n1. the four guards, in order");

// THE ORDER IS THE WHOLE PROPERTY. A CIK gate that runs after the fetch is not
// a gate; a store check after the fetch is a fetch on every render.
const body = code.slice(code.indexOf("export async function resolveFactSetForRender"));
const at = (needle) => body.indexOf(needle);
const iCik = at("cikForSymbol(clean)");
const iStore = at("readFactSet(clean)");
const iIp = at("claimColdFetch()");
const iFetch = at("fetchAndStore(clean, cik)");
check("all four gates are present", [iCik, iStore, iIp, iFetch].every((i) => i > -1),
  `cik@${iCik} store@${iStore} ip@${iIp} fetch@${iFetch}`);
check("CIK gate runs FIRST — before the store, the budget and the network",
  iCik < iStore && iCik < iIp && iCik < iFetch,
  "a gate that runs after the fetch is not a gate");
check("the store is consulted before the per-IP budget is spent",
  iStore < iIp, "a cached symbol must cost nothing, not a budget slot");
check("the budget is claimed before the fetch", iIp < iFetch);

// NOTHING happens for an unknown symbol. Asserted as ABSENCE inside the branch,
// because "returns no-cik" is true of a version that enqueued first.
const noCikBranch = body.slice(iCik, body.indexOf("readFactSet"));
check("the no-CIK branch fetches nothing and enqueues nothing",
  !/enqueue|fetch\(/.test(noCikBranch),
  "this is what bounds an endpoint anyone can hit");

console.log("\n2. three outcomes, and the third is never pending");

for (const status of ["no-cik", "ready", "no-xbrl", "pending"]) {
  check(`ColdResult carries "${status}"`, new RegExp(`"${status}"`).test(code));
}
// THE ONE THAT WOULD BE WRONG FOREVER. A successful fetch of nothing usable
// must not render as pending: the cron would re-read it daily and get the same
// nothing, so the page would promise data that never arrives.
check("an empty-but-successful fetch returns no-xbrl, NOT pending",
  /hasUsableData\(set\)\s*\?[\s\S]{0,120}"ready"[\s\S]{0,200}"no-xbrl"/.test(code),
  "an IFRS filer would otherwise be permanently 'coming soon'");
check("a stored-but-empty set also returns no-xbrl",
  /hasUsableData\(stored\)\s*\?[\s\S]{0,140}"no-xbrl"/.test(code));
check("the page renders a DISTINCT card for no-xbrl",
  /status === "no-xbrl" \?\s*<SecNoXbrlCard/.test(pageCode),
  "not the pending card with different words");
// SLICED ON THE DECLARATIONS, NOT THE FIRST MENTION. The first version sliced
// from indexOf("SecNoXbrlCard"), which lands inside the OTHER card's doc
// comment -- so it read the pending card's copy and reported it as the
// permanent card's. A name appearing in prose is not the thing it names.
const cardBody = (name) => {
  const start = cardsRaw.indexOf(`export function ${name}(`);
  const rest = cardsRaw.slice(start);
  const end = rest.indexOf("\nexport ", 1);
  return end === -1 ? rest : rest.slice(0, end);
};
const noXbrlBody = cardBody("SecNoXbrlCard");
const pendingBody = cardBody("SecPendingCard");
check("the no-xbrl copy is about the FILING, not about the site",
  /does not file the financial data this page is built from/.test(noXbrlBody) &&
    !/not loaded yet|coming soon|check back|refresh in a moment/i.test(noXbrlBody),
  "it will never stop being true, so it must not read as temporary");
check("the pending copy IS temporary, and only that card says so",
  /check back shortly|refresh in a moment/i.test(pendingBody) &&
    pendingBody.length > 100 && noXbrlBody.length > 100,
  `pending ${pendingBody.length}b, no-xbrl ${noXbrlBody.length}b — both non-empty, ` +
    `so a mis-sliced body cannot pass this by being blank`);
check("no-cik 404s the page rather than rendering anything",
  /status === "no-cik"\) notFound\(\)/.test(pageCode));

console.log("\n3. the timeout");

check("the fetch is wrapped in a timeout", /withTimeout\(\s*fetchAndStore/.test(code));
check("the timeout is a named constant, not a literal at the call site",
  /SEC_COLD_TIMEOUT_MS = \d/.test(code) && /SEC_COLD_TIMEOUT_MS\s*[,)]/.test(code));
const ms = Number((code.match(/SEC_COLD_TIMEOUT_MS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ""));
// Bounded both ways: long enough that a slow-but-real response lands, short
// enough that the render cannot be what a 71-second news render was.
check("and it is between 3s and 8s", ms >= 3000 && ms <= 8000, `${ms}ms`);
check("the timer is unref'd so it cannot hold the invocation open",
  /unref\?\.\(\)/.test(code));
check("a timeout enqueues and returns pending — it never rethrows",
  /catch \(err\)[\s\S]{0,400}enqueue\(clean\)[\s\S]{0,300}status: "pending"/.test(code));

console.log("\n4. the per-IP cap counts FETCHES, not requests");

check("the counter is incremented inside claimColdFetch only",
  (code.match(/redis\.incr\(/g) ?? []).length === 1 &&
    code.indexOf("redis.incr(") > code.indexOf("async function claimColdFetch"),
  "a counter incremented per request would 403 a reader of cached pages — " +
    "which happened on /insights/videos and is on record");
check("it fails OPEN", /catch \{\s*return true;\s*\}/.test(code),
  "a Redis outage must not take the page down");
check("the bucket outlives its window so an IP cannot roll into a fresh one",
  /expire\(key, 7200\)/.test(code));

console.log("\n5. the queue is bounded, and drained whatever the outcome");

check("the queue has a cap", /SEC_COLD_QUEUE_MAX = \d+/.test(code));
check("...and enqueue refuses past it",
  /if \(size >= SEC_COLD_QUEUE_MAX\) return false;/.test(code),
  "an endpoint anyone can hit must not be able to fill the cron's day");
check("the cron takes the cold queue FIRST", /\.\.\.coldSymbols\.map[\s\S]{0,200}\.\.\.q\.reverify/.test(jobCode),
  "every entry has a person looking at a pending page");
check("the cold queue has its own allowance, below the other two",
  /SEC_COLD_PER_RUN = (\d+)/.test(jobCode) &&
    Number(jobCode.match(/SEC_COLD_PER_RUN = (\d+)/)[1]) <
      Number(jobCode.match(/SEC_REVERIFY_PER_RUN = (\d+)/)[1]));
// CLEARED WHETHER OR NOT IT POPULATED. An IFRS filer would otherwise be
// re-fetched every day forever — the same mistake as rendering it as pending.
check("the cron clears what it took, regardless of outcome",
  /clearColdQueue\(coldSymbols\)/.test(jobCode) &&
    !/if \([^)]*written[^)]*\)\s*await clearColdQueue/.test(jobCode));
check("a cold symbol's CIK falls back to the ticker file",
  /entry\?\.cik \?\? cikForSymbol\(symbol\)/.test(jobCode),
  "it is off-universe by definition, so the manifest does not have it");
check("and a cold symbol is NOT added to the manifest",
  /if \(entry\) \{/.test(jobCode),
  "the manifest tracks the universe, not everything anyone has looked at");

console.log("\n6. the ISR property the affordability rests on");

check("the Redis client is PAGE_READ_CACHE-guarded",
  /Redis\.fromEnv\(\{ \.\.\.PAGE_READ_CACHE/.test(code),
  "one no-store hint opts the whole route out of static rendering, which would " +
    "make the fetch cost once per VISITOR rather than once per window");
check("the fetch itself is no-store, deliberately",
  /cache: "no-store"/.test(code),
  "a second Next cache layer would hold a multi-megabyte body per symbol on a " +
    "different lifetime than the HTML it produced");
// READ FROM RAW: readCodeOnly strips comments, so asserting the reasoning is
// written down has to look at the source a human reads.
check("the once-per-window property is stated in the code",
  /paid ONCE PER SYMBOL PER REVALIDATION WINDOW/.test(raw),
  "it is the reason this is affordable and it is not obvious");
// TWO ATTEMPTS AT THIS WERE WRONG BEFORE IT WAS RIGHT, and both failed the
// same way: they measured a POSITION IN THE FILE and called it an order of
// execution. `headers()` sits inside claimColdFetch, which is DECLARED above
// resolveFactSetForRender and CALLED from inside it -- so "headers() appears
// after readFactSet in the source" is simply false, while the property it was
// trying to express is true.
//
// The property is containment, not position: exactly one call site, and it is
// inside claimColdFetch -- which section 1 has already shown runs after the
// store check. That chain is what keeps a warm render from touching it.
const claimBody = (() => {
  const start = code.indexOf("async function claimColdFetch");
  const rest = code.slice(start);
  return rest.slice(0, rest.indexOf("\n}") + 2);
})();
check("headers() has exactly ONE call site in this module",
  (code.match(/await headers\(\)/g) ?? []).length === 1,
  "headers() on a warm render forces the route dynamic and the fetch is then " +
    "paid per visitor — the whole affordability argument");
check("...and it is inside claimColdFetch, which section 1 showed runs after the store",
  /await headers\(\)/.test(claimBody),
  `claimColdFetch body ${claimBody.length}b — non-empty, so a mis-sliced body ` +
    `cannot pass this by being blank`);

console.log("\n7. hasUsableData");

const mod = await lift(
  fs.readFileSync("lib/server/secFields.ts", "utf8") + "\n" +
  raw.replace(/^import[\s\S]*?;$/gm, "")
     .replace(/^export async function resolveFactSetForRender[\s\S]*$/m, "")
     .replace(/^async function [\s\S]*?\n\}$/gm, "")
     .replace(/^function withTimeout[\s\S]*?\n\}$/m, "")
);
const empty = { quarters: [], instants: [], years: [] };
check("an empty set is not usable", mod.hasUsableData(empty) === false);
check("one quarter alone is usable", mod.hasUsableData({ ...empty, quarters: [{}] }) === true);
check("instants alone are usable — a filer with only a balance sheet still renders",
  mod.hasUsableData({ ...empty, instants: [{}] }) === true);
check("years alone are usable", mod.hasUsableData({ ...empty, years: [{}] }) === true);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nCold-path guards hold.\n");
process.exit(failures ? 1 : 0);
