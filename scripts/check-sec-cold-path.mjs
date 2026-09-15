// The cold path: the guards, in the order that makes them guards.
//
// The render itself needs Redis and the network, so what is asserted here is
// the ORDER and the EXISTENCE of the four gates, read from the shipped source,
// plus the pure behaviour that can be run.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

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
const iBudget = at("claimColdFetch()");
const iFetch = at("fetchAndStore(clean, cik)");
check("all four gates are present", [iCik, iStore, iBudget, iFetch].every((i) => i > -1),
  `cik@${iCik} store@${iStore} budget@${iBudget} fetch@${iFetch}`);
check("CIK gate runs FIRST — before the store, the budget and the network",
  iCik < iStore && iCik < iBudget && iCik < iFetch,
  "a gate that runs after the fetch is not a gate");
check("the store is consulted before the budget is spent",
  iStore < iBudget, "a cached symbol must cost nothing, not a budget slot");
check("the budget is claimed before the fetch", iBudget < iFetch);

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

console.log("\n4. the budget counts FETCHES, not requests");

check("the counter is incremented inside claimColdFetch only",
  (code.match(/redis\.incr\(/g) ?? []).length === 1 &&
    code.indexOf("redis.incr(") > code.indexOf("async function claimColdFetch"),
  "a counter incremented per request would 403 a reader of cached pages — " +
    "which happened on /insights/videos and is on record");
check("it fails OPEN", /catch \{\s*return true;\s*\}/.test(code),
  "a Redis outage must not take the page down");
check("the bucket outlives its window so a burst cannot roll into a fresh one",
  /expire\(key, 120\)/.test(code));
// OVER BUDGET IS NOT AN ERROR. The whole reason a cap lives here rather than in
// middleware is that it degrades instead of refusing; asserting the return
// shape is what keeps a future edit from turning it back into a 403.
// Anchored on a CODE landmark, not a comment: `body` has been through
// readCodeOnly, so an indexOf("4. THE TIMEOUT") returns -1 and slice(x, -1)
// silently reads the wrong span. That is the same mis-slice this file already
// caught twice, in section 2 and again in section 4. Both ends carry the
// `await` a CALL site has and a declaration does not — check-assertion-anchors
// rejected the bare spellings, and it was right to.
const overBudget = body.slice(body.indexOf("await claimColdFetch()"), body.indexOf("await withTimeout("));
check("over budget degrades to queued-and-pending, never to a refusal",
  /enqueue\(clean\)/.test(overBudget) && /status: "pending"/.test(overBudget) &&
    !/40[13]|notFound|throw/.test(overBudget),
  `branch ${overBudget.length}b`);
// THE LOSS IS RECORDED, NOT SILENT. The brief asked for per-IP; this is not it,
// and a swap with no trace in the source is how a requirement disappears.
check("the source says the budget is site-wide rather than per-IP, and why",
  /SITE-WIDE, NOT PER-IP/.test(raw) && /headers\(\)/.test(raw) &&
    /middleware/.test(raw),
  "a dropped requirement must leave a mark where the code is read");

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

// ── THIS SECTION USED TO ASSERT THE OPPOSITE, AND IT WAS WRONG ─────────────
//
// It pinned `cache: "no-store"` on the fetch and one `await headers()` call
// site, both with reasoning about why confining them to the cold path made them
// safe. A single render measurement falsified both: /stock/ALSN/earnings
// returned HTTP 500, with Next naming the no-store fetch as the reason the page
// changed from static to dynamic at runtime.
//
// So what is asserted now is ABSENCE, and absence of a CLASS rather than of the
// two spellings that happened to break: any dynamic API, any explicit no-store,
// anywhere this module can reach from a render. A check that had named only
// `headers()` would have passed a version that called `cookies()`.
const DYNAMIC_APIS = ["headers(", "cookies(", "draftMode(", "connection("];
for (const api of DYNAMIC_APIS) {
  check(`the render path never calls ${api})`, !code.includes(api),
    "a dynamic API inside this ISR route is a 500, not a slower page");
}
check('no import from "next/headers"', !/from "next\/headers"/.test(code));
check("the fetch does not carry an explicit no-store hint",
  !/cache: "no-store"/.test(code),
  "one such hint opts the whole route out of static rendering");
check("the Redis client is PAGE_READ_CACHE-guarded",
  /Redis\.fromEnv\(\{ \.\.\.PAGE_READ_CACHE/.test(code),
  "@upstash/redis sends no-store by default, which is the same defect wearing " +
    "a different hat");
// A FETCH REVALIDATE BELOW THE SEGMENT'S SHORTENS THE SEGMENT'S. Next takes the
// minimum, so a 60 here would quietly re-render every stock page every minute.
check("the fetch's revalidate is a named constant, not a literal",
  /next: \{ revalidate: SEC_COLD_FETCH_REVALIDATE \}/.test(code));
const layout = fs.readFileSync("app/stock/[symbol]/layout.tsx", "utf8");
const segRevalidate = Number((layout.match(/^export const revalidate = (\d+)/m) ?? [])[1]);
const fetchRevalidate = Number((code.match(/SEC_COLD_FETCH_REVALIDATE = (\d+)/) ?? [])[1]);
check("...and it is not shorter than the segment's own revalidate",
  Number.isFinite(segRevalidate) && fetchRevalidate >= segRevalidate,
  `fetch ${fetchRevalidate}s vs segment ${segRevalidate}s — Next takes the minimum, ` +
    "so a shorter one here would shorten every /stock/* page's window");
// THE SWALLOW IS WHAT MADE THE 500 INVISIBLE. Both catches read as handled
// timeouts while Next failed the route underneath. FIRST STATEMENT IN THE
// CATCH, not merely present: a rethrow after `await enqueue(clean)` would have
// already lengthened the cron's queue with a symbol that never had a problem.
check("the catch rethrows a DynamicServerError before doing anything else",
  /\} catch \(err\) \{\s*rethrowIfDynamic\(err\);/.test(body),
  "a swallowed DynamicServerError is not a handled error");
// READ FROM RAW: readCodeOnly strips comments, so asserting the reasoning is
// written down has to look at the source a human reads.
check("the once-per-window property is stated in the code",
  /paid ONCE PER SYMBOL PER REVALIDATION WINDOW/.test(raw),
  "it is the reason this is affordable and it is not obvious");
check("and the measured 500 that forced all of this is recorded with it",
  /Page changed from static to dynamic at runtime/.test(raw),
  "the next person to reach for headers() here should meet the measurement");

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

console.log("\n8. rethrowIfDynamic, run rather than read");

// RUN, because section 6 can only see that the call is there. What it must do
// is let an ordinary failure through and refuse a dynamic-usage one, and the
// two messages below are the real ones Next emits -- the second is verbatim
// from the /stock/ALSN/earnings runtime log.
// GRABBED BY NAME AND EXPORTED FOR THE LIFT: it is deliberately not exported
// from the module -- nothing outside the cold path should be able to call it --
// so the section-7 lift does not carry it.
const guard = (await lift(`export ${grabFunction(raw, "rethrowIfDynamic")}`)).rethrowIfDynamic;
const passesThrough = (err) => {
  try { guard(err); return true; } catch { return false; }
};
check("an ordinary failure passes through to the pending path",
  passesThrough(new Error("HTTP 503")) &&
    passesThrough(new Error("[sec-cold] ALSN exceeded 5000ms")));
check("a DynamicServerError does not",
  !passesThrough(new Error("Dynamic server usage: Route /stock/[symbol]/earnings " +
    "couldn't be rendered statically because it used no-store fetch " +
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0001411207.json")));
check("...and neither does the shorter Next phrasing",
  !passesThrough(new Error("Route /x couldn't be rendered statically because it used headers")));
check("a non-Error rejection does not crash the guard", passesThrough(undefined));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nCold-path guards hold.\n");
process.exit(failures ? 1 : 0);
