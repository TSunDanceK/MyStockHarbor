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
const iBudget = at("claimColdFetch(clean)");
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
  /hasUsableData\(set\)\s*\?[\s\S]{0,80}"ready"[\s\S]{0,80}emptyResult\(/.test(code),
  "an IFRS filer would otherwise be permanently 'coming soon'");
// THE BRANCH GAINED A BODY ONCE and this pattern was pinned to the one-line
// form: `if (hasUsableData(stored)) return { status: "ready" ...`. A
// refresh-on-view added a call before that return, so the regex stopped
// matching while the PROPERTY it is about — a usable set returns ready, and the
// fall-through returns emptyResult — was unchanged. That refresh has since been
// removed and the branch is one line again, but the two-anchor form is kept
// deliberately: it matches BOTH shapes, so this assertion is about the property
// rather than about the formatting of the day.
check("a stored-but-empty set also returns no-xbrl",
  /if \(hasUsableData\(stored\)\)[\s\S]{0,1200}status: "ready"[\s\S]{0,2000}return emptyResult\(/.test(code));
check("the page renders a DISTINCT card for no-xbrl",
  /status === "no-xbrl" \? \(\s*<SecNoXbrlCard/.test(pageCode),
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
// ── THIS ASSERTION USED TO ENFORCE A FALSE STATEMENT ──────────────────────
//
// It required the copy to read "does not file the financial data this page is
// built from" — a claim about the COMPANY — and passed for two weeks while the
// page said exactly that about Ryanair, AstraZeneca, HSBC and every other
// foreign private issuer, whose complete statements were in the payload the
// whole time under `ifrs-full`. The check was pinned to a phrasing and the
// phrasing was wrong, so the check defended the bug.
//
// What is asserted now is the DISTINCTION: the card must be able to say both
// things, and the fact-about-the-filer wording must be reachable ONLY on the
// one reason that justifies it.
const noneBranch = noXbrlBody.slice(
  noXbrlBody.indexOf('reason === "none"'),
  noXbrlBody.indexOf("return (", noXbrlBody.indexOf("}\n  return ("))
);
check("the card branches on WHOSE limit it is",
  /reason === "none"/.test(noXbrlBody) &&
    noneBranch.length > 200,
  `none-branch ${noneBranch.length}b — non-empty, so a mis-sliced body cannot ` +
    `pass this by being blank`);
check("...and only the 'none' branch makes a claim about the FILER",
  /has not filed XBRL financial statements/.test(noneBranch) &&
    !/does not file the financial data|does not publish them/.test(
      noXbrlBody.slice(noXbrlBody.indexOf("}\n  return ("))
    ),
  "a payload with a financial taxonomy we simply do not read is the PAGE's gap");
check("the site-limit branch says so plainly and names the taxonomy",
  /does not read .*filings yet|gap is here, not in/.test(noXbrlBody) &&
    /\{named\}/.test(noXbrlBody),
  "naming it is what stops a reader taking it as a verdict on the company");
check("neither branch reads as temporary",
  !/not loaded yet|coming soon|check back|refresh in a moment/i.test(noXbrlBody),
  "no wording here will stop being true on its own");
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
const overBudget = body.slice(body.indexOf("await claimColdFetch(clean)"), body.indexOf("await withTimeout("));
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

console.log("\n7. hasUsableData — the bar is DENSITY, not existence");

// GRABBED BY NAME, NOT STRIPPED BY REGEX. The previous version lifted this file
// by deleting whole functions with `^async function ...` patterns, and broke
// the moment a non-async helper was added between them: it left a dangling
// fragment and the module failed to parse. Naming what it wants cannot do that.
const usable = (await lift(
  `export const MIN_PERIOD_FIELDS = ${
    (raw.match(/MIN_PERIOD_FIELDS = (\d+)/) ?? [])[1] ?? "0"
  };\n` +
  // NO `export` PREFIX: grabFunction keeps the one already on the declaration,
  // and prepending a second is a syntax error. rethrowIfDynamic in section 8
  // needs the prefix precisely because it is NOT exported.
  grabFunction(raw, "hasUsableData")
));
const MIN = usable.MIN_PERIOD_FIELDS;
// Bounded both ways, and the bounds come from the measurement: the filers worth
// rendering had 16-24 populated fields in their best period, the ones that
// would render a table of dashes had 1-2. Anything in 3..15 separates them; a
// threshold outside that is either letting dashes through or hiding real pages.
check("the threshold is a named constant inside the measured gap", MIN >= 3 && MIN <= 15,
  `MIN_PERIOD_FIELDS = ${MIN} — measured best-period fill was 16-24 (renderable) ` +
    `against 1-2 (a page of dashes), relay 34971118882`);

const period = (filled, width = 46) =>
  ({ e: "2026-06-30", v: Array.from({ length: width }, (_, i) => (i < filled ? 1 : null)) });
const set = (key, ...periods) =>
  ({ quarters: [], years: [], instants: [], [key]: periods });

check("an empty set is not usable", usable.hasUsableData(set("quarters")) === false);
for (const key of ["quarters", "years", "instants"]) {
  check(`${key} alone, at the threshold, is usable`,
    usable.hasUsableData(set(key, period(MIN))) === true);
}
// THE ONE THE OLD VERSION GOT WRONG. It asserted "one quarter alone is usable"
// against a period with NO values at all, which passed because the bar was
// "does a period exist". That bar is what let five filers through on one or two
// populated fields out of 46 — RYAAY, AEG, MFC, NWG, VIV, every one of them a
// non-USD reporter rendering a table of dashes.
check("a period one field BELOW the threshold is not usable",
  usable.hasUsableData(set("quarters", period(MIN - 1))) === false,
  "'a period exists' is not the same as 'there is a page here'");
check("a sparse period does not become usable by being repeated",
  usable.hasUsableData(set("years", period(1), period(1), period(1), period(1), period(1))) === false,
  "five years of one field each is AEG, and it is still a page of dashes");
check("one dense period among sparse ones IS usable",
  usable.hasUsableData(set("years", period(1), period(MIN + 4), period(1))) === true,
  "a filer with one fully-tagged year has a page worth rendering");

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
