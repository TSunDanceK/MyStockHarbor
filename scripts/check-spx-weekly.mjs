// THE SPX PAGE'S WEEKLY FILE (#563 COWORK #90): content/markets/spx-weekly.json,
// checked by lib/spxWeekly.ts parseSpxWeekly and read by app/markets/spx/page.tsx.
//
// Rules: the seeded file passes; the schema and types; the length caps (the
// one-liner ≤ 160 characters, each point and watch line ≤ 140); dates are real
// YYYY-MM-DD dates; no buy/sell/"should" wording; the page reads the file
// through the check and renders its fields; the staleness guard (asOf more
// than 10 days old → "Last weekly update: <date>" and dated tiles). Mutants:
// each rule broken once, caught.
//
//   node scripts/check-spx-weekly.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";

const LIB = "lib/spxWeekly.ts", FILE = "content/markets/spx-weekly.json", PAGE = "app/markets/spx/page.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
let n = 0;
async function load(src = read(LIB)) {
  const tmp = `scripts/.check-spx-weekly-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const seeded = JSON.parse(read(FILE));
const clone = () => JSON.parse(JSON.stringify(seeded));
const withChange = (f) => { const c = clone(); f(c); return c; };

const RULES = {
  "the seeded file passes the check": ({ M, file }) => M.parseSpxWeekly(file).ok === true,
  "the schema and types: required fields, numbers positive, exactly 3 points, a known sentiment label": ({ M }) =>
    [
      withChange((c) => { delete c.indexClose; }),
      withChange((c) => { c.ath.level = "7798.99"; }),
      withChange((c) => { c.points.pop(); }),
      withChange((c) => { c.sentiment.label = "Panic"; }),
      withChange((c) => { c.sentiment.fearGreed = 131; }),
      withChange((c) => { c.breadth.pct200 = 140; }),
      withChange((c) => { c.watchUp = []; }),
      withChange((c) => { c.targets = [{ low: 8100, high: 7900, source: "x" }]; }),
    ].every((bad) => M.parseSpxWeekly(bad).ok === false) &&
    M.parseSpxWeekly(withChange((c) => { c.breadth.pct200 = 61; c.breadth.pct50 = null; c.targets = [{ low: 7900, high: 8100, source: "Year-end targets" }]; })).ok === true,
  "length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140": ({ M }) =>
    M.ONE_LINER_MAX === 160 && M.POINT_MAX === 140 && M.WATCH_MAX === 140 &&
    !M.parseSpxWeekly(withChange((c) => { c.oneLiner = "x".repeat(161); })).ok && M.parseSpxWeekly(withChange((c) => { c.oneLiner = "x".repeat(160); })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.points[1].text = "x".repeat(141); })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.watchDown[0] = "x".repeat(141); })).ok,
  "dates are real YYYY-MM-DD dates": ({ M }) =>
    ["2026-02-30", "4 Oct 2026", "2026-10-4", "2026-13-01"].every((d) => !M.isIsoDate(d)) && M.isIsoDate("2026-10-02") &&
    !M.parseSpxWeekly(withChange((c) => { c.asOf = "2026-02-30"; })).ok && !M.parseSpxWeekly(withChange((c) => { c.sentiment.date = "Sun 4 Oct"; })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.ath.date = "2026-8-13"; })).ok,
  "no buy / sell / should wording anywhere in the file": ({ M }) =>
    ["Investors should wait for 7,800", "A good time to buy the dip", "Retail selling continues", "We recommend caution"].every((x) =>
      !M.parseSpxWeekly(withChange((c) => { c.watchDown[1] = x; })).ok) &&
    !M.parseSpxWeekly(withChange((c) => { c.points[0].label = "Should watch"; })).ok,
  "the page reads the file through the check, and renders its fields": ({ page }) =>
    /fs\.readFileSync\(path\.join\(process\.cwd\(\), "content\/markets\/spx-weekly\.json"\), "utf8"\)/.test(page) &&
    /const r = parseSpxWeekly\(raw\);\s*if \(r\.ok\) return r\.data;/.test(page) &&
    ["weekly.oneLiner", "weekly.indexClose", "weekly.ath.level", "weekly.ath.date", "weekly.sentiment.fearGreed", "weekly.sentiment.source", "weekly.points.map", "weekly.breadth.pct200", "weekly.watchDown", "weekly.watchUp"].every((f) => page.includes(f)) &&
    // Weekly sections are skipped, not filled with guesses, when the file fails.
    /\{weekly \? \(\s*<section style=\{card\(\)\}>\s*<div style=\{eyebrow\}>This week in 3 points/.test(page),
  "stale after 10 days: the hero says 'Last weekly update', the weekly tiles show their dates": ({ M, page }) =>
    M.STALE_DAYS === 10 && !M.isStale("2026-10-02", Date.parse("2026-10-12T00:00:00Z")) && M.isStale("2026-10-02", Date.parse("2026-10-12T00:00:01Z")) &&
    /const stale = weekly \? isStale\(weekly\.asOf, nowMs\) : false;/.test(page) &&
    /\{stale \? <strong style=\{\{ color: C\.amber \}\}>Last weekly update: \{weeklyDate\(weekly\.asOf\)\}\. <\/strong>/.test(page) &&
    (page.match(/dated=\{stale\}/g) ?? []).length === 3,
};

const libSrc = read(LIB), pageSrc = read(PAGE);
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const measure = async (lib = libSrc, page = pageSrc, file = seeded) => ({ M: await load(lib), page: stripComments(page, { file: PAGE }), file });

console.log("=== Rules ===");
const base = await measure();
const r0 = base.M.parseSpxWeekly(seeded);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base), label.startsWith("the seeded") && !r0.ok ? r0.problems.join("; ") : "");

// [rule, where: "l" lib, "p" page, "f" file, mutation]
const MUTANTS = [
  ["the seeded file passes the check", "f", (c) => { c.oneLiner = "x".repeat(170); }],
  ["the schema and types: required fields, numbers positive, exactly 3 points, a known sentiment label", "l", (s) => s.replace('if (!isPos(r.indexClose)) p.push("indexClose: not a positive number");', "")],
  ["the schema and types: required fields, numbers positive, exactly 3 points, a known sentiment label", "l", (s) => s.replace("r.points.length !== 3", "r.points.length < 1")],
  ["the schema and types: required fields, numbers positive, exactly 3 points, a known sentiment label", "l", (s) => s.replace("if (!SENTIMENT_LABELS.includes(s.label as (typeof SENTIMENT_LABELS)[number]))", "if (false)")],
  ["length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140", "l", (s) => s.replace("export const ONE_LINER_MAX = 160;", "export const ONE_LINER_MAX = 200;")],
  ["length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140", "l", (s) => s.replace("else if ((pt.text as string).length > POINT_MAX)", "else if (false)")],
  ["dates are real YYYY-MM-DD dates", "l", (s) => s.replace("return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;", "return !Number.isNaN(d.getTime());")],
  ["dates are real YYYY-MM-DD dates", "l", (s) => s.replace("if (!isIsoDate(r.asOf))", "if (!isStr(r.asOf))")],
  ["no buy / sell / should wording anywhere in the file", "l", (s) => s.replace("export const FORBIDDEN = /\\b(buy|buying|sell|selling|should|must|recommend(?:s|ed)?)\\b/i;", "export const FORBIDDEN = /\\b(must)\\b/i;")],
  ["no buy / sell / should wording anywhere in the file", "l", (s) => s.replace("  if (advice.length) p.push(", "  if (false) p.push(")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace("const r = parseSpxWeekly(raw);\n    if (r.ok) return r.data;", "const r = { ok: true, data: raw };\n    if (r.ok) return r.data;")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace("{weekly.oneLiner}", "")],
  ["stale after 10 days: the hero says 'Last weekly update', the weekly tiles show their dates", "l", (s) => s.replace("export const STALE_DAYS = 10;", "export const STALE_DAYS = 30;")],
  ["stale after 10 days: the hero says 'Last weekly update', the weekly tiles show their dates", "p", (s) => s.replace("const stale = weekly ? isStale(weekly.asOf, nowMs) : false;", "const stale = false;")],
  ["stale after 10 days: the hero says 'Last weekly update', the weekly tiles show their dates", "p", (s) => s.replace("dated={stale} />", "/>")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, where, mutate] of MUTANTS) {
  let m;
  if (where === "f") { const f = clone(); mutate(f); m = await measure(libSrc, pageSrc, f); }
  else {
    const src = where === "l" ? libSrc : pageSrc, mut = mutate(src);
    if (mut === src) { check(`mutant bites: ${label}`, false, "the mutation did not apply"); continue; }
    try { m = await measure(where === "l" ? mut : libSrc, where === "p" ? mut : pageSrc); } catch { m = null; }
  }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
