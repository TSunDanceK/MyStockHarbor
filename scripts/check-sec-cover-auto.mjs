// THE AUTOMATIC TWO-CLASS COVER COUNT, ONLY ON THE FILING'S OWN WORDS
// (#552 COWORK #37, addendum). See lib/server/secCoverAuto.ts.
//
//   1. oneToOneStatement: finds a one-for-one class conversion sentence, and
//      nothing else (a ratio, a split, a voting clause).
//   2. autoCoverFromClasses: two classes + a statement → summed, with the
//      sentence as the citation; no statement, one class, or three → a named
//      refusal for the review list. MUTATIONS: each guard removed.
//   3. coverIsUsable: a plain, single, recent total short-circuits the path.
//   4. withClassCover takes the path only without a map entry and a usable
//      total, and records / clears the review entry. MUTATIONS: unwired.
//
//   node scripts/check-sec-cover-auto.mjs
import "./lib/register-ts-here.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

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
const SRC = readCodeOnly("lib/server/secCoverAuto.ts");
const load = (src) => lift(src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, ""));
const M = await load(SRC);

console.log("1. oneToOneStatement");
const YES = [
  "Each share of Class B common stock is convertible at any time at the option of the holder into one share of Class A common stock.",
  "Shares of our Class B common stock convert into shares of Class A common stock on a one-for-one basis upon transfer.",
  "Each share of Class B common stock is convertible into one (1) fully paid and nonassessable share of Class A common stock.",
];
const NO = [
  "Each share of Class A common stock is convertible into 1,500 shares of Class B common stock.",
  "On June 1 the Board approved a two-for-one stock split of our common stock.",
  "Class B common stock carries ten votes per share and Class A common stock one vote per share.",
];
for (const t of YES) check(`found: "${t.slice(0, 70)}…"`, M.oneToOneStatement(`Intro text. ${t} More text.`) === t);
for (const t of NO) check(`not found: "${t.slice(0, 70)}…"`, M.oneToOneStatement(`Intro text. ${t} More text.`) === null);

console.log("\n2. autoCoverFromClasses");
const f = (asOf, member, val) => ({ asOf, member, val });
const TWO = [f("2026-07-28", "CommonClassAMember", 7_700_000_000), f("2026-07-28", "CommonClassBMember", 5_490_000_000), f("2026-04-01", "CommonClassAMember", 1)];
const ok = M.autoCoverFromClasses(TWO, YES[0], { accession: "0001628280-26-052535", filed: "2026-08-04" });
check("two classes + the statement → summed on the newest date, citation kept",
  ok.ok && ok.cover.val === 13_190_000_000 && ok.cover.asOf === "2026-07-28" && ok.cover.basis === YES[0] && ok.cover.derived === "computed", JSON.stringify(ok));
const noStmt = M.autoCoverFromClasses(TWO, null, {});
check("no statement → review, naming both classes", !noStmt.ok && /does not state/.test(noStmt.why) && noStmt.classes.length === 2);
const THREE = [...TWO.slice(0, 2), f("2026-07-28", "CommonClassCMember", 5)];
check("three classes → review (the map decides)", !M.autoCoverFromClasses(THREE, YES[0], {}).ok);
check("one class and no total → review", !M.autoCoverFromClasses([TWO[0]], YES[0], {}).ok);
{
  const Ms = await load(once(SRC, `if (!statement) return`, `if (false) return`));
  check("MUTATION: statement requirement removed → summed on a guess", Ms.autoCoverFromClasses(TWO, null, {}).ok === true);
  const M3 = await load(once(SRC, `if (classes.length > 2) return`, `if (false) return`));
  check("MUTATION: two-class limit removed → three classes summed at 1:1", M3.autoCoverFromClasses(THREE, YES[0], {}).ok === true);
}

console.log("\n3. coverIsUsable");
const c = (asOf, val, extra = {}) => ({ asOf, accession: null, filed: null, val, derived: "as-filed", ...extra });
check("a recent single total is usable", M.coverIsUsable(c("2026-07-01", 100), "2026-09-24", 455));
check("none / null value / ambiguous candidates / stale → not usable",
  !M.coverIsUsable(null, "2026-09-24", 455) && !M.coverIsUsable(c("2026-07-01", null), "2026-09-24", 455)
  && !M.coverIsUsable(c("2026-07-01", 100, { candidates: [1, 2] }), "2026-09-24", 455) && !M.coverIsUsable(c("2016-07-01", 100), "2026-09-24", 455));

console.log("\n4. wiring");
const CC = readCodeOnly("lib/server/secCoverClasses.ts");
const wired = (src) => /if \(!entry && coverIsUsable\(cover, today, COVER_SHARES_MAX_AGE_DAYS\)\) return cover;/.test(src)
  && /if \(auto\.ok\) \{\s*await clearCoverReview\(symbol\);\s*return auto\.cover;/.test(src)
  && /await recordCoverReview\(symbol, \{ why: auto\.why, classes: auto\.classes, accession \}\);/.test(src)
  && /await clearCoverReview\(symbol\);\s*return out\.cover;/.test(src);
check("withClassCover: short-circuit on a usable total, record on refusal, clear on either resolution", wired(CC));
check("MUTATION: the review record dropped → caught", !wired(once(CC, "await recordCoverReview(symbol, { why: auto.why, classes: auto.classes, accession });", "")));
check("MUTATION: the map path stops clearing → caught", !wired(once(CC, "await clearCoverReview(symbol);\n    return out.cover;", "return out.cover;")));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
