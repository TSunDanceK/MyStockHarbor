// /earnings-calendar grid: three beginner-first fixes (#552 COWORK #23), RUN.
//
//   1. A FUTURE day is neutral, not a red ✕ (which read as "failed"); a past
//      day before the window stays archived. MUTATION: the old single
//      out-of-window branch (future treated as archived).
//   2. TODAY, before the US filing day ends, with nothing filed, says "No
//      results filed yet today", while a genuine read failure keeps the gap
//      wording. And the month read records its outcome, so an ordinary empty
//      day is no longer "unseen" (which rendered the gap message for every
//      empty day). MUTATIONS: the dayOpen branch removed; the visibility write
//      removed.
//   3. Company names drop the directory's security-class suffix ("Cintas
//      Corporation - Common Stock" → "Cintas Corporation"), and keep a dash
//      that is part of the name. MUTATION: the suffix rule removed.
//   Plus: each cell shows its count, not only a dot.
//
//   node scripts/check-calendar-grid-ux.mjs
import ts from "typescript";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const build = async (src) => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64")}`);

const DAY = fs.readFileSync("lib/server/calendarDayState.ts", "utf8");
const D = await build(DAY);

console.log("1. future cells are neutral");
const cells = (M) => ["2026-06-01", "2026-09-10", "2026-09-28"].map((d) => M.outOfWindowCell(d, "2026-06-25", "2026-09-24"));
check("before the window → archived; inside → drawn normally; after → future", JSON.stringify(cells(D)) === '["archived",null,"future"]', JSON.stringify(cells(D)));
{
  const PAGE = readCodeOnly("app/earnings-calendar/page.tsx");
  const fut = PAGE.indexOf('outside === "future"'), arch = PAGE.indexOf('outside === "archived"');
  check("the future branch draws no ✕", fut > 0 && arch > fut && !PAGE.slice(fut, arch).includes("✕"));
  const M = await build(once(DAY, 'if (cellDate > windowEnd) return "future";', 'if (cellDate > windowEnd) return "archived";'));
  check("MUTATION: future days drawn as archived again is caught", cells(M)[2] !== "future");
}

console.log("\n2. today before the filing day ends");
const base = { items: [], totalCandidates: 0, complete: false, monthVisibility: "known" };
{
  const open = D.resolveCalendarDay({ ...base, dayOpen: true });
  check("an empty open day is not-yet", open.kind === "not-yet" && D.dayStateMessage(open) === D.DAY_NOT_YET);
  check("...and the words say not yet, not a gap", /No results filed yet today/.test(D.DAY_NOT_YET) && !/gap on our side/.test(D.DAY_NOT_YET));
  const failed = D.resolveCalendarDay({ ...base, monthVisibility: "unknown", dayOpen: true });
  check("a genuine read failure today still says it's a gap", failed.kind === "unavailable" && D.dayStateMessage(failed) === D.DAY_UNAVAILABLE);
  const rows = D.resolveCalendarDay({ ...base, items: [{ symbol: "CTAS" }], totalCandidates: 1, dayOpen: true });
  check("rows filed today are listed", rows.kind === "listed");
  const closed = D.resolveCalendarDay({ ...base });
  check("an empty CLOSED day read successfully is none-scheduled, not a gap", closed.kind === "none-scheduled");
  const M = await build(once(DAY, '  if (inputs.dayOpen) return { kind: "not-yet" };\n', ""));
  check("MUTATION: without the open-day branch today reads as something else", M.resolveCalendarDay({ ...base, dayOpen: true }).kind !== "not-yet");
  check("easternDate is the New York calendar date",
    D.easternDate(new Date("2026-09-24T03:30:00Z")) === "2026-09-23" && D.easternDate(new Date("2026-09-24T05:30:00Z")) === "2026-09-24");
}
{
  const CAL = readCodeOnly("lib/server/earningsCalendar.ts");
  const fn = CAL.slice(CAL.indexOf("async function getMonthCandidates"), CAL.indexOf("export async function getMonthDayCounts"));
  const records = (code) => /monthVisibility\.set\(key, index \? "known" : "unknown"\)/.test(code) && /monthVisibility\.set\(key, "known"\);\s*return cached\.byDate;/.test(code);
  check("the SEC month read records known/unknown (fresh and cached)", records(fn));
  check("MUTATION: the visibility write removed is caught", !records(fn.replace('monthVisibility.set(key, index ? "known" : "unknown");', "")));
  const PAGE = readCodeOnly("app/earnings-calendar/page.tsx");
  check("the page passes dayOpen from the Eastern date", /dayOpen: selectedDate >= easternDate\(new Date\(\)\)/.test(PAGE));
}

console.log("\n3. company names without the security-class suffix");
const NAME = fs.readFileSync("lib/server/listingName.ts", "utf8");
const N = await build(NAME);
const cases = [
  ["Cintas Corporation - Common Stock", "Cintas Corporation"],
  ["Alphabet Inc. - Class A Common Stock", "Alphabet Inc."],
  ["Unilever PLC - American Depositary Shares", "Unilever PLC"],
  ["Brookfield Corp - Class A Limited Voting Shares", "Brookfield Corp"],
  ["Enterprise Products Partners L.P. - Common Units Representing Limited Partnership Interests", "Enterprise Products Partners L.P."],
  ["Acme Group - Chile ADS", "Acme Group"],
  ["Rolls-Royce Holdings - Aerospace", "Rolls-Royce Holdings - Aerospace"],
  ["Coca-Cola Consolidated, Inc. - Common Stock", "Coca-Cola Consolidated, Inc."],
  ["Some Holdings - Class B", "Some Holdings"],
  ["NVIDIA CORP", "NVIDIA CORP"],
];
for (const [inp, out] of cases) check(`"${inp}" → "${out}"`, N.cleanListingName(inp) === out, N.cleanListingName(inp));
check("the grid's name goes through it", /return cleanListingName\(/.test(readCodeOnly("lib/server/secTickerNames.ts")));
{
  const M = await build(once(NAME, "SECURITY_WORDS.test(suffix) || CLASS_ONLY.test(suffix)", "false"));
  check("MUTATION: without the rule the suffix shows again", M.cleanListingName(cases[0][0]) === cases[0][0]);
}

console.log("\n4. each cell shows its count");
check("the cell renders the per-day count from getMonthDayCounts",
  /const count = dayCounts\.get\(cellDate\) \?\? 0;/.test(readCodeOnly("app/earnings-calendar/page.tsx")) &&
    /\{count\}/.test(readCodeOnly("app/earnings-calendar/page.tsx")));

console.log("\n5. one message, not two (#552 COWORK #26)");
{
  // RENDERED: the day list with no rows, with and without the page's note above it.
  const { createRequire } = await import("node:module");
  const require = createRequire(`${process.cwd()}/package.json`);
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const LIST = fs.readFileSync("app/earnings-calendar/EarningsDayList.tsx", "utf8");
  const buildList = (src) => {
    const js = ts.transpileModule(src.replace(/^"use client";\s*/, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
    }).outputText;
    const mod = { exports: {} };
    const req = (m) => (m === "next/link" ? { __esModule: true, default: (p) => React.createElement("a", p) } : require(m));
    new Function("require", "module", "exports", "React", js)(req, mod, mod.exports, React);
    return mod.exports.default;
  };
  const render = (Comp, explained) => renderToStaticMarkup(React.createElement(Comp, { date: "2026-09-24", initialItems: [], initialHasMore: false, complete: false, emptyExplainedAbove: explained }));
  const L = buildList(LIST);
  check("with the day panel's note above, the empty list renders nothing", render(L, true) === "");
  check("without it, the list still explains itself", /still populating/.test(render(L, false)));
  check("the page passes the flag whenever the panel shows a note",
    /emptyExplainedAbove=\{dayState\.kind !== "listed"\}/.test(readCodeOnly("app/earnings-calendar/page.tsx")));
  const M = buildList(once(LIST, "    if (emptyExplainedAbove) return null;\n", ""));
  check("MUTATION: without the guard both messages show again", /still populating/.test(render(M, true)));
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
