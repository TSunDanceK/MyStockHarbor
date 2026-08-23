// The history TTL, and the one question that decides whether a flush is needed.
//
// QUESTION (2026-08-22): does the weekend extension apply to writes made DURING
// the weekend, or only to the Friday-after-close write?
//
// ANSWER: during the weekend too. getRedisHistoryTtlSeconds() is called with no
// argument at the write site (writeHistoryEntry), so it reads the moment of the
// WRITE, and every weekend write lands on the same next-Monday-open expiry.
// Recorded here as a running assertion rather than as prose, because the flush
// decision rests on it.
//
// FOUND WHILE ANSWERING IT: getNextMondayOpenUtcMsFromEastern hardcoded
// `-05:00`, which is EST. New York is on EDT from mid-March to early November,
// so for ~8 months a year the "Monday open" it computed was 10:30 ET -- an hour
// after the real one -- and history stayed stale through the first hour of
// Monday's session. Both seasons are asserted below, so a fix that merely swaps
// one hardcoded offset for the other fails here.
//
//   node scripts/check-history-ttl.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = "lib/server/historyCache.ts";
const raw = fs.readFileSync(path.join(ROOT, SRC), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sf = ts.createSourceFile(SRC, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const grab = (n) => {
  let out = null;
  const visit = (x) => {
    if (ts.isFunctionDeclaration(x) && x.name?.text === n) out = x.getText(sf).replace(/^export\s+/, "");
    ts.forEachChild(x, visit);
  };
  visit(sf);
  return out;
};

const wanted = ["getEasternParts", "getNextMondayOpenUtcMsFromEastern", "getRedisHistoryTtlSeconds"];
const fns = Object.fromEntries(wanted.map((n) => [n, grab(n)]));
const missing = wanted.filter((n) => !fns[n]);
if (missing.length) {
  console.error(`FAIL: could not extract ${missing.join(", ")} — measuring nothing.`);
  process.exit(1);
}
const consts = raw.split("\n").filter((l) => /^const REDIS_HISTORY_TTL_SECONDS/.test(l)).join("\n");
const js = ts.transpileModule(
  `${consts}\n${wanted.map((n) => fns[n]).join("\n")}\nexport { getRedisHistoryTtlSeconds, getNextMondayOpenUtcMsFromEastern };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// Comments stripped once, up front, for every "does the code do X" assertion
// below. See the note on the hardcoded-offset check.
const codeOnly = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l))
  .join("\n");

const H = 3600;
const expiryOf = (iso) => {
  const at = new Date(iso);
  return new Date(at.getTime() + m.getRedisHistoryTtlSeconds(at) * 1000).toISOString().replace(".000Z", "Z");
};
const ttlOf = (iso) => m.getRedisHistoryTtlSeconds(new Date(iso));

console.log("\n=== 1. The weekend extension applies to weekend WRITES ===\n");
// This is the answer the flush decision rests on. All three land on the same
// Monday open, so a stale entry written at any point across the weekend clears
// at one known moment rather than 6 hours after whenever it happened to land.
const MONDAY_OPEN_SUMMER = "2026-08-24T13:30:00Z";
check("Friday after the close is extended", ttlOf("2026-08-21T21:00:00Z") > 6 * H);
check("Saturday is extended too", ttlOf("2026-08-22T07:00:00Z") > 6 * H);
check("Sunday is extended too", ttlOf("2026-08-23T12:00:00Z") > 6 * H);
for (const [label, iso] of [
  ["Friday 21:00 UTC", "2026-08-21T21:00:00Z"],
  ["Saturday 07:00 UTC", "2026-08-22T07:00:00Z"],
  ["Saturday 19:46 UTC", "2026-08-22T19:46:00Z"],
  ["Sunday 12:00 UTC", "2026-08-23T12:00:00Z"],
]) {
  check(`${label} -> expires at the Monday open`, expiryOf(iso) === MONDAY_OPEN_SUMMER, expiryOf(iso));
}

console.log("\n=== 2. Everything else keeps the plain 6 hours ===\n");
check("midweek", ttlOf("2026-08-19T16:00:00Z") === 6 * H);
check("Friday BEFORE the close", ttlOf("2026-08-21T15:00:00Z") === 6 * H, "the extension is after-close, not all-Friday");
check("Monday morning before the open", ttlOf("2026-08-24T12:00:00Z") === 6 * H);

console.log("\n=== 3. The Monday open is resolved against the ZONE, both seasons ===\n");
// A fix that swaps -05:00 for -04:00 passes summer and fails winter. Both are
// asserted so neither hardcode survives.
check(
  "SUMMER (EDT): Monday open is 13:30 UTC",
  expiryOf("2026-08-22T12:00:00Z") === "2026-08-24T13:30:00Z",
  expiryOf("2026-08-22T12:00:00Z")
);
check(
  "WINTER (EST): Monday open is 14:30 UTC",
  expiryOf("2026-01-17T12:00:00Z") === "2026-01-19T14:30:00Z",
  expiryOf("2026-01-17T12:00:00Z")
);
// COMMENT-STRIPPED, and it failed on first run without it: the comment in
// historyCache.ts explaining the bug quotes the offset it removed, so the
// assertion matched the prose describing the fix. Same trap as
// claude/traps/grep-finds-the-comment-not-the-code.md, in a check written the
// same day as claude/traps/a-regex-over-source-has-no-scope.md, which says to
// strip comments from every file you read.
check(
  "the offset is not hardcoded anywhere in the helper",
  !/T09:30:00-0[45]:00/.test(codeOnly),
  "a literal offset is right for one season and wrong for the other"
);
// The weekend around a DST switch is the case a hardcode gets wrong by an hour
// at exactly the moment it matters. US DST began 2026-03-08.
check(
  "the weekend DST springs forward across: Sat 07 Mar -> Mon 09 Mar open is 13:30 UTC",
  expiryOf("2026-03-07T12:00:00Z") === "2026-03-09T13:30:00Z",
  expiryOf("2026-03-07T12:00:00Z")
);

console.log("\n=== 4. The write site reads the moment of the WRITE ===\n");
// If writeHistoryEntry passed a fixed time, or hoisted the value to module
// scope, every one of the assertions above would be about a function nothing
// calls that way.
check(
  "writeHistoryEntry calls getRedisHistoryTtlSeconds() with no argument",
  /ex: getRedisHistoryTtlSeconds\(\),/.test(codeOnly),
  "so `now` defaults to the write instant, which is what makes weekend writes extended"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
