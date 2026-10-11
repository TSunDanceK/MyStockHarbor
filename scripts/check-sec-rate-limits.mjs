// WHAT BOUNDS THE EARNINGS PAGE — asserted where it can be, recorded where it cannot.
//
// ── THE THREE LAYERS, AND WHICH ONE THIS FILE IS REALLY FOR ───────────────
//
//   per IP        Vercel Firewall, /stock, 25 req / 600s, Challenge. NOT IN
//                 THIS REPOSITORY — it lives in the Vercel dashboard.
//   site-wide     SEC_COLD_FETCHES_PER_MINUTE, one Redis bucket.
//   SEC's policy  10 req/s, published, not ours to assert.
//
// The middle one is code and this checks it directly. The FIRST one is the
// interesting case: it is the per-IP bound, and the ruling was that there be NO
// per-IP logic in code precisely because the edge already does it. A rule that
// lives outside the repo is a rule that silently stops being true, so the repo
// keeps TWO copies — the claimColdFetch docblock and
// claude/sec-rate-limits-2026-09-16.md — and this asserts they agree.
//
// WHAT THAT CAN AND CANNOT CATCH, stated plainly so nobody quotes it as more:
//   CAN    one copy edited and the other forgotten; either copy deleted.
//   CANNOT whether the dashboard rule still exists or still says 25/600s.
//          Nothing in CI can see the dashboard. This is a consistency check on
//          the repo's own record, not a verification of production.
//
// ── AND IT READS THE RAW FILE, DELIBERATELY ──────────────────────────────
// Every other harness reads through readCodeOnly because prose describing a bug
// must not satisfy an assertion about the bug. Here the PROSE IS THE ARTIFACT:
// the firewall line is a recorded operational fact with no code to check it
// against. So this file reads the source raw for that one assertion and through
// readCodeOnly for everything about behaviour, and says which is which.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const COLD_RAW = fs.readFileSync("lib/server/secColdFetch.ts", "utf8");
const COLD = readCodeOnly("lib/server/secColdFetch.ts");
const DOC_PATH = "claude/sec-rate-limits-2026-09-16.md";
const DOC = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, "utf8") : "";

console.log("\n1. the site-wide bucket still exists and still refuses");

const cap = Number((COLD.match(/SEC_COLD_FETCHES_PER_MINUTE = (\d+)/) ?? [])[1]);
check("SEC_COLD_FETCHES_PER_MINUTE is a named, positive constant",
  Number.isFinite(cap) && cap > 0, `${cap}`);
// Bounded both ways. A cap of 1 would make every second visitor to an
// unpopulated symbol wait for the cron; a cap of 10000 is not a cap.
check("...and it is between 5 and 100", cap >= 5 && cap <= 100, `${cap}`);

const claim = COLD.slice(
  COLD.indexOf("async function claimColdFetch("),
  COLD.indexOf("async function enqueue(")
);
check("claimColdFetch was found and sliced", claim.length > 200, `${claim.length} chars`);
check("it INCRs a minute-resolution bucket",
  /redis\.incr\(key\)/.test(claim) && /coldRateKey\(\)/.test(claim) &&
    /coldRateKey = \(d = new Date\(\)\) =>[\s\S]{0,200}slice\(0, 16\)/.test(COLD),
  "YYYY-MM-DDTHH:MM — an hour-resolution key would be a 60x looser cap");
// ONE KEY BUILDER, SHARED. secHealth reads this bucket; a second spelling there
// would read as a permanent zero rather than as an error.
check("the reader builds the key with the writer's helper, not its own string",
  /coldRateKey\(\)/.test(readCodeOnly("lib/server/secHealth.ts")) &&
    !/msh:sec:cold-rate/.test(readCodeOnly("lib/server/secHealth.ts")),
  "a retyped prefix is how a census reported 759 of 759 symbols unpopulated");
check("the bucket outlives its own window",
  /expire\(key, 120\)/.test(claim),
  "60s would let a bucket created at :59 hand the next second a fresh allowance");
// WHITESPACE COLLAPSED FIRST, and that is not cosmetic. readCodeOnly replaces
// comment characters with SPACES to preserve offsets, so the long docblock
// inside this branch becomes ~700 blank columns and pushed `return false;`
// outside a 900-character window — the assertion failed on a branch that was
// entirely correct. A bounded window over padded source measures the padding.
const tight = (s) => s.replace(/\s+/g, " ");
check("past the cap it returns false",
  /if \(n > SEC_COLD_FETCHES_PER_MINUTE\)[\s\S]{0,300}return false;/.test(tight(claim)));
check("it fails OPEN on a Redis error",
  /catch \{\s*return true;\s*\}/.test(claim),
  "refusing here would cost a reader their page over a bookkeeping outage");
// THE BUCKET EXISTING IS NOT THE BUCKET BEING USED. The one fetch path —
// fillColdSymbol, the human-gated fill since #535 COWORK #13 (the render and
// its empty-set retry no longer fetch) — must claim it before fetching.
{
  const fill = COLD.slice(COLD.indexOf("export async function fillColdSymbol"));
  const claimAt = fill.indexOf("await claimColdFetch(");
  const fetchAt = fill.indexOf("withTimeout(fetchAndStore(clean, cik)");
  check("the one SEC fetch path claims the budget before it fetches",
    COLD.indexOf("export async function fillColdSymbol") > 0 && claimAt > 0 && fetchAt > claimAt &&
      (COLD.match(/fetchAndStore\(/g) ?? []).length === 2, // the definition and the one call
    `claim at ${claimAt}, fetch at ${fetchAt}, fetchAndStore( sites ${(COLD.match(/fetchAndStore\(/g) ?? []).length}`);
}

{
  // MUTATION: the cap check removed, so the bucket counts and never refuses.
  const mutated = claim.replace("if (n > SEC_COLD_FETCHES_PER_MINUTE) {", "if (false) {");
  check("the remove-the-cap mutation actually applied", mutated !== claim);
  check("MUTATION: a bucket that counts but never refuses fails this check",
    !/if \(n > SEC_COLD_FETCHES_PER_MINUTE\)[\s\S]{0,300}return false;/.test(tight(mutated)),
    "an assertion that survived the removal would not be guarding the cap");
}
{
  // MUTATION: the whole guard deleted from the fetch paths.
  const mutated = COLD.replace(/await claimColdFetch\(/g, "await Promise.resolve(true) && (");
  check("the unclaim mutation actually applied", mutated !== COLD);
  check("MUTATION: dropping the claim from the fetch paths fails this check",
    (mutated.match(/await claimColdFetch\(/g) ?? []).length < 2);
}

console.log("\n2. the exhaustion counter, because a log line is not a measurement");

check("exhaustion is counted on a day key",
  /coldExhaustionKey = /.test(COLD) && /cold-exhausted:v1/.test(COLD));
check("...and only on the path where the budget is ALREADY spent",
  claim.indexOf("await bumpExhaustion()") > claim.indexOf("if (n > SEC_COLD_FETCHES_PER_MINUTE)"),
  "counting before the refusal would make it a second per-fetch command");
const ttl = Number((COLD.match(/SEC_COLD_EXHAUSTION_TTL_S = (\d+) \* 86400/) ?? [])[1]);
check("the counter expires rather than accumulating keys forever",
  Number.isFinite(ttl) && ttl >= 7 && ttl <= 90, `${ttl} days`);

console.log("\n3. NO per-IP logic in the SEC code — the edge owns that");

// The ruling: per-IP is the firewall's job. These are the two ways it would
// come back, and both would also break the ISR route.
check("secColdFetch never reads the client address",
  !/getClientIp|x-forwarded-for|from "next\/headers"/.test(COLD),
  "headers() is unconditionally dynamic — on this ISR route that is a 500, measured");
check("...and holds no per-IP Redis key",
  !/:ip:|perIp|per-ip/i.test(COLD.replace(/per-IP/g, "")),
  "a per-IP bucket here would duplicate the edge rule at a per-request cost");

console.log("\n4. the firewall rule, recorded in two places that must agree");

// ONE SHAPE, PARSED THE SAME WAY FROM BOTH. Matching the two files with one
// regex is what makes "they agree" mean the same thing on each side; two
// regexes could drift into agreeing about different things.
const RULE = /VERCEL FIREWALL: (\/\S+) — (\d+) requests \/ (\d+)s per IP — (\w+)/;
const inSource = COLD_RAW.match(RULE);
const inDoc = DOC.match(RULE);
check("the doc exists", DOC.length > 500, `${DOC.length} bytes at ${DOC_PATH}`);
check("the rule is recorded in secColdFetch's docblock",
  !!inSource, inSource?.[0] ?? "(not found — the code is read more often than the doc)");
check("the rule is recorded in the doc",
  !!inDoc, inDoc?.[0] ?? "(not found)");
check("the two copies agree, field for field",
  !!inSource && !!inDoc && inSource.slice(1, 5).join("|") === inDoc.slice(1, 5).join("|"),
  `source ${inSource?.slice(1, 5).join("|") ?? "?"} vs doc ${inDoc?.slice(1, 5).join("|") ?? "?"}`);

// THE FIREWALL MUST ACTUALLY CLOSE THE GAP IT IS CITED FOR, which is
// arithmetic rather than assertion: at its rate one address cannot reach the
// site-wide cap even if every one of its requests triggered a cold fetch.
if (inSource) {
  const perMinute = (Number(inSource[2]) / Number(inSource[3])) * 60;
  check("one address cannot reach the site-wide cap through the firewall",
    perMinute < cap,
    `${inSource[2]}/${inSource[3]}s = ${perMinute.toFixed(1)} req/min against a cap of ${cap}/min`);
}

{
  // MUTATION: the doc's numbers edited and the source left alone — the exact
  // drift the two copies exist to catch.
  const drifted = DOC.replace(RULE, "VERCEL FIREWALL: /stock — 500 requests / 600s per IP — Challenge");
  check("the doc-drift mutation actually applied", drifted !== DOC);
  const m = drifted.match(RULE);
  check("MUTATION: editing one copy and not the other is caught",
    !!inSource && !!m && inSource.slice(1, 5).join("|") !== m.slice(1, 5).join("|"),
    "two copies that can disagree silently are worse than one");
}

console.log("\n5. the crawler bypass, and the order that makes it work");

// ── A SECOND RULE, THE SAME DISCIPLINE ───────────────────────────────────
// Recorded in both places in one parseable shape, for the same reason: the
// dashboard is invisible to CI, so the most the repo can do is refuse to
// disagree with itself.
//
// THE ORDER IS A FIELD. A bypass configured BELOW the challenge is every field
// correct and the rule inert — the crawler is challenged anyway and the index
// drains with nothing in the logs to say why. So "ABOVE the rate limit" is
// captured and compared like any other field rather than left to prose.
const BYPASS =
  /VERCEL FIREWALL BYPASS: (.+?) — AS ([\d,]+) AND user-agent matches (\S+) — (Bypass), (ABOVE|BELOW) the rate limit/;
const bypassSource = COLD_RAW.match(BYPASS);
const bypassDoc = DOC.match(BYPASS);
check("the bypass is recorded in secColdFetch's docblock",
  !!bypassSource, bypassSource?.[0]?.slice(0, 120) ?? "(not found)");
check("the bypass is recorded in the doc",
  !!bypassDoc, bypassDoc?.[0]?.slice(0, 120) ?? "(not found)");
check("the two copies agree, field for field",
  !!bypassSource && !!bypassDoc &&
    bypassSource.slice(1, 6).join("|") === bypassDoc.slice(1, 6).join("|"),
  `source ${bypassSource?.slice(2, 6).join("|") ?? "?"} vs doc ${bypassDoc?.slice(2, 6).join("|") ?? "?"}`);
check("...and it is recorded as ABOVE the rate limit",
  bypassSource?.[5] === "ABOVE",
  `${bypassSource?.[5] ?? "?"} — below the challenge the bypass never fires and the failure is silent`);

if (bypassSource) {
  // THE UA PATTERN MUST ACTUALLY MATCH THE CRAWLERS IT NAMES, which is
  // arithmetic rather than assertion: the recorded pattern is compiled and run
  // against real user-agent strings. A typo in the alternation would otherwise
  // read as a correct record of a rule that exempts nobody.
  const ua = new RegExp(bypassSource[3].replace(/^\/|\/$/g, ""));
  const SHOULD_MATCH = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mediapartners-Google",
    "AdsBot-Google (+http://www.google.com/adsbot.html)",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
  ];
  const SHOULD_NOT = ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "python-requests/2.31.0", "curl/8.4.0"];
  check("the recorded user-agent pattern matches every crawler it names",
    SHOULD_MATCH.every((u) => ua.test(u)),
    SHOULD_MATCH.filter((u) => !ua.test(u)).join(" | ") || `${SHOULD_MATCH.length} of ${SHOULD_MATCH.length}`);
  check("...and does not match an ordinary browser or client",
    SHOULD_NOT.every((u) => !ua.test(u)),
    SHOULD_NOT.filter((u) => ua.test(u)).join(" | ") || "none");
  // BOTH CONDITIONS, NOT EITHER. The ASNs are the whole of GCP and Azure, so a
  // bypass on ASN alone exempts every scraper on either cloud; a user-agent
  // alone is a claim `curl -A Googlebot` can make. Asserted as an AND.
  check("the bypass requires the ASN AND the user-agent, never either alone",
    / AND user-agent matches /.test(bypassSource[0]) && /^[\d,]+$/.test(bypassSource[2]),
    `AS ${bypassSource[2]} AND a user-agent pattern — either alone is worthless, for opposite reasons`);
  check("...and the doc records why ASN alone was rejected",
    /whole of GCP and the whole\s+of Azure|whole of GCP/.test(DOC) && /datacenter block list/i.test(DOC),
    "a rule recorded without its rejected alternative gets re-litigated by the next reader");
}

{
  // MUTATION: the order flipped in one copy only — every field still correct,
  // the rule inert, and nothing else in this file would notice.
  const flipped = DOC.replace("Bypass, ABOVE the rate limit", "Bypass, BELOW the rate limit");
  check("the order-flip mutation actually applied", flipped !== DOC);
  const m = flipped.match(BYPASS);
  check("MUTATION: flipping the recorded order in one copy is caught",
    !!bypassSource && !!m && bypassSource.slice(1, 6).join("|") !== m.slice(1, 6).join("|"),
    "order is the property that can be wrong while every field is right");
}

console.log(
  failures
    ? `\n${failures} assertion(s) failed.`
    : "\nThe site-wide bucket holds, and the repo agrees with itself about the edge.\n"
);
process.exit(failures ? 1 : 0);
