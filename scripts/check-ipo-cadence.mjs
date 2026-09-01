// The IPO calendar's cadence, and the bandwidth cap the whole meter is scaled
// against. Both are numbers that fail silently rather than loudly.
//
// WHY THE CADENCE NEEDS A CHECK. Three independent layers decide how often
// /upcoming-ipos actually calls FMP, and each can veto the other two:
//
//   feedCache          decides whether fetchIpoRows is invoked at all
//   Next's Data Cache  decides whether that invocation reaches the network
//   the route segment  decides how often the page itself is rebuilt
//
// They were three separate `1800` literals held in step by comments asking the
// next reader to notice, and the failure mode is not a broken build -- it is a
// page that quietly keeps its old cadence while the source says otherwise.
// This project has already paid for that once: the route declared 14400 and
// shipped as 30m because a fetch-level revalidate capped it, and nothing said
// so (claude/traps/fetch-revalidate-caps-the-page.md). Two of the three now
// read one exported constant; the third cannot, because Next requires a
// segment config to be statically analysable and will not follow an import.
// That literal is exactly what is unguarded by the type system, so it is
// checked here against the constant's real value.
//
// WHY THE CAP NEEDS A CHECK. FMP_BANDWIDTH_CAP_BYTES is not derivable from
// anything -- FMP publishes no endpoint reporting the account's own allowance
// -- so it is a hand-maintained fact about the billing plan. Every percentage
// /cache-health and /api/debug/fmp-usage print is computed from it, and a
// stale value does not error: it reports a confident wrong number. It read
// 20 GB for the whole time the 20 GB data boost was live, so /cache-health
// showed 20.4% of cap when the truth was 10.2% -- and that page is what the
// decision to drop the boost is made from, so the error pushed that one
// decision the wrong way. The assertion below is not "the cap is 40 GB
// forever"; it is that the constant is a whole number of GB, is at least the
// 20 GB base plan, and still carries the comment telling the next reader it
// has to be updated by hand.
//
// WHAT THIS DOES NOT CHECK. Whether 40 GB is the allowance FMP is currently
// granting. Nothing in this sandbox can reach FMP, and a script that pretended
// to verify it would be measuring the constant against itself.
//
//   node scripts/check-ipo-cadence.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Comments are stripped from every source read here. A regex over raw source
// is satisfied by the prose ABOUT the code as readily as by the code, and this
// file's subject is precisely a set of numbers that are also written out in
// comments — the exact shape of
// claude/traps/grep-finds-the-comment-not-the-code.md.
const IPO_SRC = "lib/server/ipoCalendar.ts";
const FEED_SRC = "lib/server/feedCache.ts";
const PAGE_SRC = "app/upcoming-ipos/page.tsx";
const USAGE_SRC = "lib/server/fmpUsage.ts";

const ipo = readCodeOnly(IPO_SRC);
const feed = readCodeOnly(FEED_SRC);
const page = readCodeOnly(PAGE_SRC);
const usage = readCodeOnly(USAGE_SRC);

// ── The cadence constant ────────────────────────────────────────────────────
console.log("\nIPO cadence — one number, three layers");

const decl = ipo.match(
  /export\s+const\s+IPO_REVALIDATE_SECONDS\s*=\s*([0-9*\s_]+);/
);
if (!decl) {
  console.error(
    `FAIL: IPO_REVALIDATE_SECONDS not found in ${IPO_SRC} — this script would ` +
      `otherwise pass by measuring nothing.`
  );
  process.exit(1);
}
// Evaluating the arithmetic rather than string-matching "24 * 60 * 60" means
// the check is about the DURATION, not about how it happens to be spelled.
const cadence = Function(`"use strict"; return (${decl[1]});`)();

check(
  "IPO_REVALIDATE_SECONDS is a daily cadence",
  cadence === 86400,
  `${cadence}s — an IPO calendar changes at most once a day; the previous 1800s ` +
    `re-read it 48 times a day against a bandwidth cap whose penalty is suspension`
);

check(
  "the FMP fetch revalidates on the constant, not a literal",
  /next:\s*\{\s*revalidate:\s*IPO_REVALIDATE_SECONDS\s*\}/.test(ipo),
  "a literal here would be free to drift from the freshness feedCache is given, " +
    "and Next's Data Cache would silently win"
);

const freshArgs = ipo.match(/freshSeconds:\s*IPO_REVALIDATE_SECONDS/g) ?? [];
check(
  "both IPO feeds ask readFeed for that same freshness",
  freshArgs.length === 2,
  `${freshArgs.length} of 2 (ipo:upcoming, ipo:recent) — a feed left on the ` +
    `default would keep re-fetching every 30 minutes with nothing to show for it`
);

const pageDecl = page.match(/export\s+const\s+revalidate\s*=\s*(\d+)\s*;/);
check(
  "the route segment's revalidate literal equals the constant",
  !!pageDecl && Number(pageDecl[1]) === cadence,
  pageDecl
    ? `page declares ${pageDecl[1]}, constant is ${cadence} — Next will not ` +
      `follow an import into a segment config, so this literal is the one ` +
      `thing here the compiler cannot keep honest`
    : `no 'export const revalidate' found in ${PAGE_SRC}`
);

// ── The freshness/retention relationship in feedCache ───────────────────────
console.log("\nfeedCache — retention must outlive freshness");

check(
  "freshness is a per-feed argument, not a module constant",
  /function\s+isFresh\s*\([^)]*freshSeconds\s*:\s*number[^)]*\)/.test(feed),
  "isFresh reading a module-level FRESH_MS would accept the freshSeconds " +
    "option and then ignore it — the caller's cadence would be inert"
);

const ttlFn = feed.match(
  /function\s+staleTtlSeconds\s*\(\s*freshSeconds\s*:\s*number\s*\)\s*:\s*number\s*\{([\s\S]*?)\n\}/
);
if (!ttlFn) {
  console.error(
    `FAIL: staleTtlSeconds not found in ${FEED_SRC} — a flat retention constant ` +
      `is the failure this section exists to catch, so its absence is a FAIL, ` +
      `not a skip.`
  );
  process.exit(1);
}
const staleTtl = Function(
  `"use strict"; const STALE_RETENTION_MULTIPLE = ${
    (feed.match(/const\s+STALE_RETENTION_MULTIPLE\s*=\s*(\d+)/) ?? [, "0"])[1]
  }; return (function (freshSeconds) {${ttlFn[1]}\n});`
)();

// The real hazard, and the reason retention is derived at all: a flat 24h
// retention is comfortably longer than a 30-minute freshness and EXACTLY equal
// to a daily one. Equal means the Redis copy expires at the instant it stops
// being served fresh, so `fallback` is undefined and stale-on-error — the
// entire reason feedCache exists — silently stops existing for that feed. It
// would only be discovered during an upstream outage.
check(
  "retention strictly outlives freshness at the daily cadence",
  staleTtl(cadence) > cadence,
  `${staleTtl(cadence)}s retained against ${cadence}s fresh — equal would mean ` +
    `no stale copy survives to degrade to, and that is only ever found out ` +
    `during an outage`
);
check(
  "and still does at the 30-minute default the other feeds use",
  staleTtl(1800) > 1800,
  `${staleTtl(1800)}s retained against 1800s fresh — indexChanges is unchanged ` +
    `by this and must stay that way`
);

// ── The bandwidth cap ───────────────────────────────────────────────────────
console.log("\nFMP bandwidth cap — hand-maintained, so say so");

const capDecl = usage.match(
  /export\s+const\s+FMP_BANDWIDTH_CAP_BYTES\s*=\s*([0-9*\s_]+);/
);
if (!capDecl) {
  console.error(`FAIL: FMP_BANDWIDTH_CAP_BYTES not found in ${USAGE_SRC}.`);
  process.exit(1);
}
const capBytes = Function(`"use strict"; return (${capDecl[1]});`)();
const GB = 1024 ** 3;

check(
  "the cap is a whole number of GB and at least the 20 GB base plan",
  capBytes % GB === 0 && capBytes >= 20 * GB,
  `${capBytes / GB} GB`
);

// Read RAW on purpose: these two assertions ARE about the comment. The constant
// cannot be derived from anything, so the note telling the next reader to
// update it by hand is the only mechanism there is, and deleting it is a silent
// regression the stripped source could never show.
const usageRaw = fs.readFileSync(path.join(ROOT, USAGE_SRC), "utf8");
const capComment = usageRaw.slice(
  Math.max(0, usageRaw.indexOf("export const FMP_BANDWIDTH_CAP_BYTES") - 1600),
  usageRaw.indexOf("export const FMP_BANDWIDTH_CAP_BYTES")
);
check(
  "the cap carries the note that it must track the plan by hand",
  /NOT DERIVABLE/.test(capComment) && /MUST TRACK THE PLAN/.test(capComment),
  "FMP exposes no endpoint for the account's own allowance, so a reader who " +
    "assumes this self-corrects will trust a stale percentage — that comment " +
    "is the entire safeguard"
);

// The constant against its own stated reason. Deliberately NOT "the cap is
// 40 GB": the boost is meant to come off one day, and a check that forbids the
// change it exists to inform would just be edited away. What it forbids is the
// cap and the breakdown disagreeing — which is the state this PR found the file
// in, the constant reading 20 GB with the boost live and nothing saying which
// of the two was wrong. Dropping the boost means deleting the boost line AND
// halving the constant, and that still passes.
const terms = [...capComment.matchAll(/^\/\/\s{2,}\S[^\n]*?(\d+)\s*GB/gm)].map((m) =>
  Number(m[1])
);
const termSum = terms.reduce((a, b) => a + b, 0);
check(
  "the cap equals the sum of the plan terms listed above it",
  terms.length > 0 && termSum * GB === capBytes,
  terms.length
    ? `${terms.join(" + ")} = ${termSum} GB against a constant of ${capBytes / GB} GB`
    : "no '<name>  <n> GB' term lines found above the constant — the breakdown " +
      "is what makes the number auditable at all, so its absence is a failure"
);

console.log(
  failures === 0
    ? "\nAll IPO cadence and bandwidth cap assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
