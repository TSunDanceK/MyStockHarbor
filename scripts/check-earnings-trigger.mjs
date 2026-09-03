// The filing-driven endpoints fire on earnings, and no symbol can be excluded
// from them indefinitely.
//
// WHY. warm-stock-data made all eight of fetchOne's calls for every symbol on a
// 10-minute clock. Three answer questions that only change when a company FILES.
// Splitting them off is cheap and safe; getting the split WRONG is neither, and
// every way of getting it wrong is silent:
//
//   * A SYMBOL THE CALENDAR HAS NEVER HEARD OF. Probe Q6 measured the calendar
//     at 1,553 symbols against a universe heading for 3,000. Without a floor,
//     a foreign listing, a fund, a recent IPO -- or simply a month whose read
//     failed -- has its income statement, cash flow and dividends frozen
//     PERMANENTLY while the job reports a clean run every ten minutes.
//   * THE WRONG TIMESTAMP. If the trigger compares against `updatedAt`, which
//     advances on every clock refresh, it fires once per symbol and then never
//     again -- and the floor never elapses either, because its clock is also
//     being reset. The stamp has to be separate.
//   * THE DAY-OF BOUNDARY. A report scheduled for TODAY carries a midnight-UTC
//     timestamp already behind Date.now(). Comparing against the instant rather
//     than start-of-day drops the day-of report, which is the one that should
//     trigger the refresh (lib/latest-earnings-data.ts records this).
//   * THE SPLIT REPEATED PER CALL SITE. A condition written out at each of
//     eight blocks drifts from the call count reserved for them, and
//     CALLS_PER_SYMBOL was a flat 8 that would have quietly become a lie.
//
// The first three are claims about behaviour over inputs, so the functions are
// RUN, not pattern-matched.
//
//   node scripts/check-earnings-trigger.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function load(relPath, patch = (x) => x) {
  const js = ts.transpileModule(patch(fs.readFileSync(path.join(ROOT, relPath), "utf8")), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const sched = await load("lib/server/earningsSchedule.ts", (src) =>
  src
    .replace(/import \{ Redis \} from "@upstash\/redis";/, "")
    .replace(/import \{ PAGE_READ_CACHE \} from ".\/redisCacheMode";/, "")
    .replace(/import \{ fetchMonthRows[\s\S]*?from ".\/earningsCalendar";/, "")
    .replace(/const redis =[\s\S]*?: null;/, "const redis = null;")
);

// needsQuarterlyRefresh lives in a 500-line module with Redis and FMP imports;
// lift the function itself rather than stubbing the world around it.
const cacheSrc = readCodeOnly("lib/server/stockDataCache.ts");
const fnSrc = (cacheSrc.match(
  /export function needsQuarterlyRefresh\([\s\S]*?\n\}/
) ?? [])[0];
const floorDays = Number((cacheSrc.match(/QUARTERLY_FLOOR_DAYS = (\d+)/) ?? [])[1]);
if (!fnSrc || !floorDays) {
  console.error(
    `FAIL: could not extract needsQuarterlyRefresh (${!!fnSrc}) or ` +
      `QUARTERLY_FLOOR_DAYS (${floorDays}) — this script would otherwise pass by ` +
      `measuring nothing.`
  );
  process.exit(1);
}
const trigger = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(
      `const QUARTERLY_FLOOR_MS = ${floorDays} * 24 * 60 * 60 * 1000;\n${fnSrc}`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
    ).outputText
  ).toString("base64")}`
);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-02T14:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

// ── 1. Nothing is excluded forever ──────────────────────────────────────────
console.log("\n1. No symbol can be excluded from a quarterly refresh indefinitely");

check(
  "a symbol the calendar has never heard of still refreshes on the floor",
  trigger.needsQuarterlyRefresh(iso(now - (floorDays + 1) * DAY), null, null, now) === true,
  `no earnings date at all, last refresh ${floorDays + 1} days ago — the calendar ` +
    `covered 1,553 symbols against a universe heading for 3,000, so this is the ` +
    `common case, not the edge`
);
check(
  "and is held off until the floor actually elapses",
  trigger.needsQuarterlyRefresh(iso(now - (floorDays - 1) * DAY), null, null, now) === false,
  `a floor that fires early is just the clock again`
);
check(
  "a symbol that has never had a quarterly refresh is due",
  trigger.needsQuarterlyRefresh(null, null, null, now) === true &&
    trigger.needsQuarterlyRefresh(undefined, null, "2026-08-01", now) === true &&
    trigger.needsQuarterlyRefresh("not-a-date", null, null, now) === true,
  "absent, undefined and unparseable all mean 'we hold nothing we can date'"
);
check(
  "the floor is measured in months, not days",
  floorDays >= 95 && floorDays <= 200,
  `${floorDays} days — shorter than a quarter and the trigger is decoration; ` +
    `much longer and a missed filing sits for half a year`
);

// ── 2. The trigger fires on the filing ──────────────────────────────────────
console.log("\n2. A report since the last refresh triggers one");

check(
  "a filing we have not covered -> due",
  trigger.needsQuarterlyRefresh(iso(now - 40 * DAY), "2026-05-20", "2026-08-20", now) === true,
  "last refresh covered the May filing; August's has since landed"
);
check(
  "the same filing again -> not due",
  trigger.needsQuarterlyRefresh(iso(now - 10 * DAY), "2026-08-01", "2026-08-01", now) === false,
  "already picked that one up"
);

// THE CASE A TIMESTAMP COMPARISON LOSES, and the reason this is keyed on the
// date rather than on Date.parse of it. A symbol refreshed at 06:00 on its own
// report day has a lastQuarterly INSTANT later than that date's midnight, so a
// `reported > lastQuarterly` test reads the filing as already covered -- and
// `last` stays that same date until the next quarter, so it is never picked up
// at all. It would sit until the 120-day floor. Recording which DATE was
// covered has no clock in it to get wrong.
check(
  "a refresh EARLIER ON the report day has not covered that filing",
  trigger.needsQuarterlyRefresh(
    "2026-09-02T06:00:00.000Z",
    "2026-05-20",
    "2026-09-02",
    now
  ) === true,
  "refreshed 06:00 today, reported today — a timestamp test would call this " +
    "covered because midnight is behind 06:00, and never revisit it"
);
check(
  "and once covered, the same day does not re-fire every run",
  trigger.needsQuarterlyRefresh(
    "2026-09-02T06:00:00.000Z",
    "2026-09-02",
    "2026-09-02",
    now
  ) === false,
  "end-of-day parsing would fix the case above and then re-fetch on every run " +
    "for the rest of the day; a date match fires exactly once per filing"
);

// ── 3. The schedule's day boundary ──────────────────────────────────────────
console.log("\n3. buildSchedule puts today's report in `last`, not `next`");

const built = sched.buildSchedule(
  [
    { symbol: "AAA", date: "2026-09-02" }, // today
    { symbol: "AAA", date: "2026-06-01" }, // older
    { symbol: "AAA", date: "2026-12-01" }, // future
    { symbol: "bbb", date: "2026-08-15" }, // lowercase in, upper out
  ],
  now
);
check(
  "today's report lands in `last`",
  built.get("AAA")?.last === "2026-09-02",
  `got ${built.get("AAA")?.last} — if today fell into \`next\`, the refresh it ` +
    `should trigger would wait a whole quarter`
);
check(
  "the newest past date wins, and the soonest future one",
  built.get("AAA")?.next === "2026-12-01",
  `next ${built.get("AAA")?.next}`
);
check(
  "symbols are normalised",
  built.get("BBB")?.last === "2026-08-15",
  "the calendar and the universe must key the same way or every symbol is a miss"
);
check(
  "startOfTodayUtcMs is midnight, not the current instant",
  sched.startOfTodayUtcMs(now) === Date.parse("2026-09-02T00:00:00.000Z"),
  "the single place this boundary is defined — three partial copies existed " +
    "before it (claude/traps/two-validators-for-one-value.md)"
);

// ── 4. One list, and a counted cost ─────────────────────────────────────────
console.log("\n4. The split is declared once and the call count follows it");

const triggerList = (cacheSrc.match(/const ENDPOINT_TRIGGERS = \{[\s\S]*?\} as const/) ?? [])[0];
if (!triggerList) {
  console.error("FAIL: ENDPOINT_TRIGGERS not found — measuring nothing.");
  process.exit(1);
}
const quarterlyEndpoints = (triggerList.match(/"quarterly"/g) ?? []).length;
const clockEndpoints = (triggerList.match(/"clock"/g) ?? []).length;
check(
  "every endpoint fetchOne calls is classified exactly once",
  quarterlyEndpoints + clockEndpoints === 8,
  `${clockEndpoints} clock + ${quarterlyEndpoints} quarterly = ` +
    `${clockEndpoints + quarterlyEndpoints} of fetchOne's 8 blocks`
);
check(
  "the analyst and rating endpoints stay on the clock",
  ["price-target-summary", "grades-consensus", "analyst-estimates"].every((e) =>
    new RegExp(`"${e}": "clock"`).test(triggerList)
  ),
  "a downgrade happens BETWEEN filings — an earnings-triggered fetch would not " +
    "see it until the next quarter, which is worse than the cost it saves"
);
check(
  "the per-symbol call count is counted from that list, not stated",
  /CLOCK_CALLS = Object\.values\(ENDPOINT_TRIGGERS\)/.test(cacheSrc) &&
    !/CALLS_PER_SYMBOL = \d+/.test(cacheSrc),
  "a flat 8 stops being true the moment a symbol can cost 5, and reserving " +
    "eight for a five-call symbol idles the run against a budget it will not spend"
);
// THE SHAPE MOVED AND THE RULE DID NOT. The capacity test used to be inline
// (`hasFmpCapacity(callsForSymbol(...))`) and is now inside
// waitForStockDataBudget, because breaking on the first exhausted minute was
// the #396/#406 defect a third time. Both halves are asserted rather than the
// old literal: the derived count is what the wait is ASKED for, and the wait is
// what passes it to hasFmpCapacity -- so a helper that quietly asked for a
// different number would fail here.
check(
  "the capacity check reserves the derived count",
  /waitForStockDataBudget\(callsForSymbol\(includeQuarterly\), runDeadlineMs\)/.test(cacheSrc) &&
    /hasFmpCapacity\(calls, FMP_MIN_HEADROOM_CALLS\)/.test(cacheSrc),
  "the one place the count is spent must be the one place it is computed"
);

// ── 5. The stamp, and the dataset ───────────────────────────────────────────
console.log("\n5. The quarterly stamp is separate, and the job is visible");

check(
  "quarterlyUpdatedAt only advances when the filing endpoints were read",
  /quarterlyUpdatedAt: includeQuarterly \? nowIso : prev\?\.quarterlyUpdatedAt/.test(cacheSrc),
  "advancing it on a clock refresh makes the trigger fire once per symbol and " +
    "never again, and stops the floor from ever elapsing"
);
// SCOPED TO stockData'S OWN BLOCK. The first version tested
// /stockData: \{[\s\S]*?coverage: "registered"/ over the whole file, and
// `[\s\S]*?` ran straight past stockData's entry into the NEXT dataset's
// `coverage: "registered"` — so de-registering stockData still passed. Same
// shape as the assertion in #396 that matched a definition elsewhere in the
// file (claude/traps/a-regex-over-source-has-no-scope.md).
const queueSrc = readCodeOnly("lib/server/stalenessQueue.ts");
const stockDataBlock = (queueSrc.match(/stockData: \{[^}]*\}/) ?? [])[0];
if (!stockDataBlock) {
  console.error("FAIL: stockData is not in the DATASETS registry at all.");
  process.exit(1);
}
check(
  "warm-stock-data is a registered dataset on /cache-health",
  /coverage: "registered"/.test(stockDataBlock) &&
    /registerSymbols\("stockData"/.test(cacheSrc) &&
    /markRefreshed\("stockData"/.test(cacheSrc),
  "the longest lap in the system had no per-symbol freshness anywhere a human " +
    "could see it; `registered` without a registerSymbols call is a " +
    "self-selecting denominator"
);

console.log(
  failures === 0
    ? "\nAll earnings-trigger assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
