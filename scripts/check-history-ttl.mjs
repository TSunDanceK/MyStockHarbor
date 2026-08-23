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
// Every TTL constant the extracted functions read, pulled from the real file so
// a value changed there is a value changed here. `export` is stripped because
// these are being re-declared inside a synthesised module.
const consts = raw
  .split("\n")
  .filter((l) => /^(export )?const (REDIS_HISTORY_TTL_SECONDS|HISTORY_FAILURE_TTL_SECONDS|HISTORY_MAX_BAR_AGE_WEEKDAYS)/.test(l))
  .map((l) => l.replace(/^export\s+/, ""))
  .join("\n");
const js = ts.transpileModule(
  `${consts}\n${wanted.map((n) => fns[n]).join("\n")}\nexport { getRedisHistoryTtlSeconds, getNextMondayOpenUtcMsFromEastern };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// Comments stripped once, up front, for every "does the code do X" assertion
// below. See the note on the hardcoded-offset check.
//
// STRIPPED WITH THE REAL TOKENISER, NOT A REGEX, and the reason is a live bug
// this harness hit: historyCache.ts sends an Accept header containing `*/*`.
// To `/\*[\s\S]*?\*\//` that `*/` closes whatever block comment came before it
// and the following `/*` opens a new one, so the strip swallowed 12.7k
// characters of real code -- including every line these assertions are about.
//
// The failure mode is the dangerous direction: the missing code made the
// POSITIVE assertions fail loudly, but it made the NEGATIVE ones ("this string
// does not appear") pass, because nothing appears in text that was deleted. A
// harness that reads its own subject through a broken filter reports the filter,
// not the subject -- claude/traps/a-regex-over-source-has-no-scope.md, in the
// one file that documented the rule.
function stripComments(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, text);
  let out = "";
  let kind;
  while ((kind = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    const tok = scanner.getTokenText();
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      // Newlines preserved so line-anchored assertions keep their meaning.
      out += tok.replace(/[^\n]/g, "");
    } else {
      out += tok;
    }
  }
  return out;
}
const codeOnly = stripComments(raw);
// A stripper that ate the file would make every negative assertion below pass
// for the wrong reason. Assert it did not before trusting anything it produced.
check(
  "the comment stripper kept the code",
  codeOnly.length > raw.length * 0.6 && codeOnly.includes("export async function getDailyHistoryBulk("),
  `${codeOnly.length} of ${raw.length} chars`
);

const H = 3600;
// Read from the real source rather than restated, so raising the TTL in
// historyCache.ts cannot leave this file asserting the old number.
const SUCCESS_TTL = Number(/const REDIS_HISTORY_TTL_SECONDS = ([^;]+);/.exec(consts)[1].replace(/[^\d*+ ]/g, "").split("*").reduce((a, b) => a * Number(b), 1));
const FAILURE_TTL = Number(/const HISTORY_FAILURE_TTL_SECONDS = ([^;]+);/.exec(consts)[1].split("*").reduce((a, b) => a * Number(b), 1));
const expiryOf = (iso) => {
  const at = new Date(iso);
  return new Date(at.getTime() + m.getRedisHistoryTtlSeconds("success", at) * 1000).toISOString().replace(".000Z", "Z");
};
const ttlOf = (iso) => m.getRedisHistoryTtlSeconds("success", new Date(iso));
const failTtlOf = (iso) => m.getRedisHistoryTtlSeconds("failure", new Date(iso));

console.log("\n=== 1. The weekend extension applies to weekend WRITES ===\n");
// This is the answer the flush decision rests on. All three land on the same
// Monday open, so a stale entry written at any point across the weekend clears
// at one known moment rather than 6 hours after whenever it happened to land.
const MONDAY_OPEN_SUMMER = "2026-08-24T13:30:00Z";
check("Friday after the close is extended", ttlOf("2026-08-21T21:00:00Z") > SUCCESS_TTL);
check("Saturday is extended too", ttlOf("2026-08-22T07:00:00Z") > SUCCESS_TTL);
check("Sunday is NOT extended past the base — at 50h the base is already longer", ttlOf("2026-08-23T12:00:00Z") === SUCCESS_TTL);
// MAX, NOT CHOOSE-ONE, and this is what changed when the base went 6h -> 50h.
// At 6h every weekend write expired at the Monday open because the open was
// always further away than 6h. At 50h that is only true for writes early enough
// in the weekend; a Sunday write is closer to the open than 50h, and picking the
// weekend branch outright would SHORTEN its TTL. The weekend branch exists to
// hold data across a closed market, never to expire it sooner, so each case
// below asserts max(base, to-the-open) rather than "the open".
for (const [label, iso] of [
  ["Friday 21:00 UTC", "2026-08-21T21:00:00Z"],
  ["Saturday 07:00 UTC", "2026-08-22T07:00:00Z"],
  ["Saturday 19:46 UTC", "2026-08-22T19:46:00Z"],
  ["Sunday 12:00 UTC", "2026-08-23T12:00:00Z"],
]) {
  const toOpen = Math.ceil((Date.parse(MONDAY_OPEN_SUMMER) - Date.parse(iso)) / 1000);
  const want = Math.max(SUCCESS_TTL, toOpen);
  check(`${label} -> max(base, to-the-open)`, ttlOf(iso) === want, `${Math.round(ttlOf(iso) / H)}h, expires ${expiryOf(iso)}`);
  check(`${label} -> never expires BEFORE the Monday open`, Date.parse(expiryOf(iso)) >= Date.parse(MONDAY_OPEN_SUMMER), expiryOf(iso));
}

console.log("\n=== 2. Everything else keeps the plain base TTL ===\n");
check("midweek", ttlOf("2026-08-19T16:00:00Z") === SUCCESS_TTL, `${SUCCESS_TTL / H}h`);
check("Friday BEFORE the close", ttlOf("2026-08-21T15:00:00Z") === SUCCESS_TTL, "the extension is after-close, not all-Friday");
check("Monday morning before the open", ttlOf("2026-08-24T12:00:00Z") === SUCCESS_TTL);

console.log("\n=== 3. The Monday open is resolved against the ZONE, both seasons ===\n");
// A fix that swaps -05:00 for -04:00 passes summer and fails winter. Both are
// asserted so neither hardcode survives.
// MEASURED ON THE HELPER, NOT THROUGH THE TTL. These used to read the Monday
// open out of expiryOf(), which worked only while the base TTL was short enough
// that every weekend write landed on the open. At 50h it does not, and asserting
// the zone through a function that no longer exposes it would be
// claude/traps/measuring-the-wrong-layer.md: the DST bug could come back and
// these would stay green.
const openOf = (iso) => new Date(m.getNextMondayOpenUtcMsFromEastern(new Date(iso))).toISOString().replace(".000Z", "Z");
check(
  "SUMMER (EDT): Monday open is 13:30 UTC",
  openOf("2026-08-22T12:00:00Z") === "2026-08-24T13:30:00Z",
  openOf("2026-08-22T12:00:00Z")
);
check(
  "WINTER (EST): Monday open is 14:30 UTC",
  openOf("2026-01-17T12:00:00Z") === "2026-01-19T14:30:00Z",
  openOf("2026-01-17T12:00:00Z")
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
  openOf("2026-03-07T12:00:00Z") === "2026-03-09T13:30:00Z",
  openOf("2026-03-07T12:00:00Z")
);

console.log("\n=== 4. The write site reads the moment of the WRITE ===\n");
// If writeHistoryEntry passed a fixed time, or hoisted the value to module
// scope, every one of the assertions above would be about a function nothing
// calls that way. The outcome is now passed; `now` still must not be.
check(
  "writeHistoryEntry passes the OUTCOME and no time",
  /ex: getRedisHistoryTtlSeconds\(outcome\),/.test(codeOnly),
  "so `now` still defaults to the write instant, which is what makes weekend writes extended"
);

console.log("\n=== 5. The failure floor is a FLOOR, not a scaled success TTL ===\n");
// The requirement in the brief, asserted rather than commented: "15-minute
// failure floor, agreed it must not scale from the success path". A failure TTL
// derived from the success one -- REDIS_HISTORY_TTL_SECONDS / 200, say -- would
// pass a naive "is it 15 minutes" check today and silently grow the next time
// the success TTL is raised.
check("failure TTL is 15 minutes", failTtlOf("2026-08-19T16:00:00Z") === 15 * 60, `${FAILURE_TTL}s`);
check(
  "failure TTL is not derived from the success TTL",
  !/HISTORY_FAILURE_TTL_SECONDS\s*=[^;]*REDIS_HISTORY_TTL_SECONDS/.test(codeOnly),
  "it must stay a fixed number no change to the success path can lengthen"
);
// THE BRANCH ORDER IS THE ASSERTION. A failure on a Saturday must get 15
// minutes, not "hold this failure until Monday's open" -- which is what happens
// if the outcome check is placed after the weekend branch instead of before it.
for (const [label, iso] of [
  ["Friday after close", "2026-08-21T21:00:00Z"],
  ["Saturday", "2026-08-22T07:00:00Z"],
  ["Sunday", "2026-08-23T12:00:00Z"],
  ["midweek", "2026-08-19T16:00:00Z"],
]) {
  check(`${label}: a failure still gets 15 minutes`, failTtlOf(iso) === 15 * 60, `${failTtlOf(iso)}s`);
}
check(
  "the success TTL is at least 24h longer than one day, so a missed warm leaves data present",
  SUCCESS_TTL > 24 * H,
  `${SUCCESS_TTL / H}h — at exactly 24h a late run races an empty cache`
);
check(
  "the success TTL survives one missed daily warm plus a full session",
  SUCCESS_TTL >= 48 * H,
  `${SUCCESS_TTL / H}h — Monday 07:00 bars must still be present through Tuesday's close`
);

console.log("\n=== 6. An empty response is a failure; a short history is a fact ===\n");
// Without this split the failure floor turns every legitimately short history (a
// recent IPO with 12 bars) into a permanent 15-minute refetch loop -- 96
// calls/day/symbol to re-learn something that has not changed.
check(
  "fetchAndCacheDailyHistory branches on parsed.length === 0",
  /writeHistoryEntry\(normalized, entry, parsed\.length === 0 \? "failure" : "success"\)/.test(codeOnly),
  "not on entry.status, which cannot tell an empty response from a short one"
);
check(
  "the qualified write is explicitly a success",
  /writeHistoryEntry\(normalized, entry, "success"\)/.test(codeOnly)
);

console.log("\n=== 7. The 07:00 warm actually refetches ===\n");
// getDailyHistoryBulk is MISS-ONLY. With a TTL over 24h and no force, the daily
// warm finds every symbol present, fetches nothing, and records a successful run
// that refreshed zero bars. This is the single assertion that stops the whole
// TTL change from being a silent no-op.
const bulk = /export async function getDailyHistoryBulk\(([\s\S]*?)\n}/.exec(codeOnly)?.[0] ?? "";
check("getDailyHistoryBulk was extracted", bulk.length > 200, `${bulk.length} chars`);
if (bulk.length <= 200) {
  console.error("  (every assertion below would pass vacuously against an empty string — stopping)");
  process.exit(1);
}
check(
  "it takes a force option",
  /export async function getDailyHistoryBulk\(\s*symbols: string\[\],\s*opts: \{ force\?: boolean \}/.test(bulk)
);
check(
  "force sends every symbol to the miss path",
  /const ok = usable\(entry, symbol\);/.test(bulk) && /if \(ok && !force\)/.test(bulk),
  "a cached entry is only SERVED when not forcing"
);
check(
  "force is threaded to the per-symbol fetch",
  (bulk.match(/getDailyHistory\(symbol, \{ force \}\)/g) || []).length === 2,
  "both the no-redis path and the miss path"
);
check(
  "the pipeline read still happens under force",
  !/if \(!force\) \{\s*try \{\s*const pipeline/.test(bulk),
  "the cached entry is the fallback when a forced refetch throws"
);
check(
  "a forced refetch that throws falls back to the cached entry",
  /if \(!force \|\| !fallback\) throw error;/.test(bulk),
  "so forcing can never yield a THINNER universe than not forcing"
);
check(
  "getDailyHistory takes force too",
  /export async function getDailyHistory\(symbol: string, opts: \{ force\?: boolean \} = \{\}\)/.test(codeOnly)
);
check(
  "force skips the READ, not the lock",
  /const cached = force \? null : await readHistoryEntry\(normalized\);/.test(codeOnly),
  "waiting on another caller's in-flight fetch is still a fresh result"
);
check(
  "the warm route asks for the force",
  /GET_WARM as buildPickerUniverse/.test(
    fs.readFileSync(path.join(ROOT, "app/api/jobs/warm-picker-universe/route.ts"), "utf8")
  ),
  "the cron target, not the public /api/pickers handler"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
