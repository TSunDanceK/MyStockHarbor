// The IPO entity filter must never exclude SPACs, and must stay a conjunction.
//
// WHY THIS CHECK EXISTS. lib/server/ipoExclusions.ts carries two SIC sets whose
// relationship is a rule, not a convention: 6199/6726/6221 are excluded, and 6770
// -- "Blank Checks", i.e. SPACs -- must NEVER be. A SPAC IPO is a real IPO. In the
// measured window 7 of the 53 genuine upcoming IPOs were 6770 filers; Phase 0's
// amendment sample was 8 SPACs in 20. Adding 6770 to the excluded set would
// delete a large share of the page's upper table, and it would look like a
// tidy-up: three finance SIC codes sitting in a list, with a fourth finance SIC
// code conspicuously absent.
//
// A comment claiming that rule and nothing enforcing it is how the rule quietly
// ends -- the same reasoning as scripts/check-relay-isolation.mjs, which exists
// because relay.yml's credential split was a paragraph of prose before it was a
// check.
//
// AND THE CONJUNCTION IS THE OTHER HALF. `SIC && name` is what keeps a fintech at
// 6199 with an ordinary name on the page, and what keeps a REIT called
// "X Realty Trust" on it too. Collapsing it to either half alone -- a blanket SIC
// exclusion, or a name-only test -- breaks the filter in a different direction
// each way, and neither breakage is visible on the page until someone notices a
// real IPO missing.
//
//   node scripts/check-ipo-exclusions.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILE = "lib/server/ipoExclusions.ts";
if (!fs.existsSync(FILE)) {
  console.error(`FATAL: ${FILE} is missing — this check measures nothing.`);
  process.exit(1);
}
const src = fs.readFileSync(FILE, "utf8");

// Strip comments before matching. The header DISCUSSES 6770 at length, and a
// naive substring search would match the prose explaining the rule and report a
// violation -- the same trap check-relay-isolation.mjs documents.
//
// THROUGH THE SHARED STRIPPER, NOT A LOCAL REGEX. The two-line version that
// used to live here is the exact one check-comment-stripper.mjs was written
// against: `*/*` inside a string closes the preceding block comment to it, so
// it eats a region and every NEGATIVE assertion below ("6770 is not in the
// excluded set") then passes on text that was deleted rather than on code.
// Hand-rolled stripping is also what check-comment-stripper.mjs §7 forbids
// outright, and this file was the one harness still doing it.
const code = readCodeOnly(FILE);

const setBody = (name) => {
  const m = code.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  return m ? m[1] : null;
};
const parseSet = (body) =>
  body === null ? null : [...body.matchAll(/["']([0-9]{4})["']/g)].map((m) => m[1]);

console.log("\nIPO entity filter — the SPAC rule, and the conjunction\n");

const excluded = parseSet(setBody("ENTITY_EXCLUDED_SIC"));
const never = parseSet(setBody("NEVER_EXCLUDED_SIC"));

check(
  "ENTITY_EXCLUDED_SIC exists and is parseable",
  Array.isArray(excluded) && excluded.length > 0,
  excluded ? `[${excluded.join(", ")}]` : "not found — the filter cannot be audited"
);
check(
  "NEVER_EXCLUDED_SIC exists and is parseable",
  Array.isArray(never) && never.length > 0,
  never ? `[${never.join(", ")}]` : "not found"
);

check(
  "6770 (Blank Checks) is in the NEVER-excluded set",
  Boolean(never?.includes("6770")),
  "a SPAC IPO is a real IPO — 7 of 53 in the measured window, 8 of 20 in Phase 0's sample"
);

check(
  "6770 is NOT in the excluded set",
  !excluded?.includes("6770"),
  "excluding blank checks would delete a large share of the upper table, and would " +
    "read as a tidy-up rather than as the regression it is"
);

const overlap = (excluded ?? []).filter((s) => (never ?? []).includes(s));
check(
  "the two sets are disjoint",
  overlap.length === 0,
  overlap.length ? `both sets contain ${overlap.join(", ")} — the rule contradicts itself` : "no code is in both"
);

check(
  "6199 is excluded — it is where the measured ETFs actually sit",
  Boolean(excluded?.includes("6199")),
  "the first version of this rule used 6726/6221 and matched ZERO rows in 120 days; " +
    "both real ETFs (Canary Staked INJ, Bitwise NEAR) are 6199"
);

// The conjunction. Either half alone breaks the filter, in opposite directions.
check(
  "the entity test is a CONJUNCTION of SIC and name",
  /ENTITY_EXCLUDED_SIC\.has\([^)]*\)\s*&&\s*FUND_NAME\.test\(/.test(code),
  "blanket SIC deletes fintech IPOs at 6199; name-only deletes REITs called " +
    "'X Realty Trust'. Both halves are load-bearing"
);

check(
  "the never-excluded set is checked before the excluded set",
  /NEVER_EXCLUDED_SIC\.has\(sic\)\)\s*return false;[\s\S]{0,200}ENTITY_EXCLUDED_SIC\.has/.test(code),
  "belt and braces: even a set that wrongly contained 6770 could not exclude a SPAC"
);

// ── THE JOIN DIRECTION, WHICH THE TYPE SYSTEM CANNOT GUARD ────────────────
// company_tickers_exchange.json is symbol -> { cik, exchange }. A lookup of a CIK
// against that map compiles perfectly (Map<string, T>.has takes any string) and
// is ALWAYS FALSE, so the already-listed filter would exclude nobody and the
// upper table would fill with the 172 already-listed issuers it exists to
// remove. tsc cannot see it. This can.
const exclSrc = code;
check(
  "the already-listed join goes through a CIK index, not the symbol-keyed map",
  /export function indexByCik\(/.test(exclSrc) &&
    /byCik\.has\(normaliseCik\(cik\)\)/.test(exclSrc),
  "a direct tickerMap.has(cik) type-checks and silently matches nothing"
);
check(
  "isAlreadyListed does NOT take the raw symbol-keyed map",
  !/isAlreadyListed\([^)]*tickerMap:\s*Map<string,\s*TickerEntry>/.test(exclSrc),
  "taking the raw map is what makes the wrong-direction lookup easy to write"
);

// The instrumentation is the thing that would have caught the 6726/6221 version.
check(
  "a zero-match warning exists for the entity filter",
  /export function warnIfEntityFilterMatchedNothing/.test(code),
  "a rule that matches nothing looks exactly like a rule with nothing to match — " +
    "that is precisely how 6726/6221 would have shipped looking correct"
);

// ── The split rules in ipoSecSource.ts ────────────────────────────────────
// Source-level, matching the house pattern in check-ipo-cadence.mjs: these are
// one-line invariants whose regression is invisible on the page until someone
// reads the table closely.
const SRC2 = "lib/server/ipoSecSource.ts";
if (fs.existsSync(SRC2)) {
  const sec = readCodeOnly(SRC2);
  console.log("");

  check(
    "a withdrawal is compared against the amendment date",
    /w\.date\s*>=\s*amendmentDate/.test(sec),
    "'has a withdrawal anywhere' deletes live deals — four RW/AW filings in the " +
      "sample pre-dated the amendment they would have been credited against"
  );

  // BOTH descending, and deliberately NOT one shared comparator.
  const upperSort = /upcoming\.sort\(\(a, b\) => b\.date\.localeCompare\(a\.date\)\)/.test(sec);
  const lowerSort = /recent\.sort\(\(a, b\) => b\.date\.localeCompare\(a\.date\)\)/.test(sec);
  check(
    "the upper table sorts DESCENDING on the amendment date",
    upperSort,
    "its date is when terms were SET, always in the past — ascending puts the " +
      "stalest filing first, which is what the FMP forward calendar's ascending " +
      "sort would do if copied across"
  );
  check(
    "the lower table sorts DESCENDING on the listing date",
    lowerSort,
    "most recently listed first, unchanged from getRecentIpos()"
  );
  check(
    "the two sorts are separate statements, not one shared comparator",
    upperSort && lowerSort,
    "they agree on direction today by coincidence of meaning, not of purpose — " +
      "a shared comparator makes the next change to either column's meaning " +
      "silently wrong in the other table"
  );

  check(
    "market cap is null on the SEC branch, not guessed",
    /marketCap:\s*null/.test(sec),
    "no free source carries it; the column is hidden rather than fabricated"
  );

  check(
    "the staleness cap is applied to the upper table",
    /isStale\(amendment\.date, now\)/.test(sec),
    "RW/AW alone caught 3 of 56 — without the cap ~95% of dead deals never leave"
  );
}

console.log(
  failures === 0
    ? "\nThe SPAC rule, the conjunction and the split rules all hold.\n"
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
