// THE SPX PAGE'S WEEKLY FILE (#563 COWORK #90): content/markets/spx-weekly.json,
// checked by lib/spxWeekly.ts parseSpxWeekly and read by app/markets/spx/page.tsx.
//
// Rules: the seeded file passes; the schema and types; the length caps (the
// one-liner ≤ 160 characters, each point and watch line ≤ 140); dates are real
// YYYY-MM-DD dates; no buy/sell/"should" wording; no third party's sentiment
// index by name (#96: the sentiment field is gone; Market Mood is ours); the page reads the file
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
  "the schema and types: required fields, numbers positive, exactly 3 points; sentiment removed (#96), ignored if present": ({ M }) =>
    [
      withChange((c) => { delete c.indexClose; }),
      withChange((c) => { c.ath.level = "7798.99"; }),
      withChange((c) => { c.points.pop(); }),
      withChange((c) => { c.breadth.pct200 = 140; }),
      withChange((c) => { c.watchUp = []; }),
      withChange((c) => { c.targets = [{ low: 8100, high: 7900, source: "x" }]; }),
    ].every((bad) => M.parseSpxWeekly(bad).ok === false) &&
    M.parseSpxWeekly(withChange((c) => { c.breadth.pct200 = 61; c.breadth.pct50 = null; c.targets = [{ low: 7900, high: 8100, source: "Year-end targets" }]; })).ok === true &&
    // #96: no sentiment field needed; an old file that still has one is read, the field ignored.
    !("sentiment" in clone()) && M.parseSpxWeekly(withChange((c) => { c.sentiment = { fearGreed: 31, label: "Fear", source: "x", date: "2026-10-02" }; })).ok === true,
  "length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140": ({ M }) =>
    M.ONE_LINER_MAX === 160 && M.POINT_MAX === 140 && M.WATCH_MAX === 140 &&
    !M.parseSpxWeekly(withChange((c) => { c.oneLiner = "x".repeat(161); })).ok && M.parseSpxWeekly(withChange((c) => { c.oneLiner = "x".repeat(160); })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.points[1].text = "x".repeat(141); })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.watchDown[0] = "x".repeat(141); })).ok,
  "dates are real YYYY-MM-DD dates": ({ M }) =>
    ["2026-02-30", "4 Oct 2026", "2026-10-4", "2026-13-01"].every((d) => !M.isIsoDate(d)) && M.isIsoDate("2026-10-02") &&
    !M.parseSpxWeekly(withChange((c) => { c.asOf = "2026-02-30"; })).ok && !M.parseSpxWeekly(withChange((c) => { c.breadth.date = "Sun 4 Oct"; })).ok &&
    !M.parseSpxWeekly(withChange((c) => { c.ath.date = "2026-8-13"; })).ok,
  "no buy / sell / should wording anywhere in the file": ({ M }) =>
    ["Investors should wait for 7,800", "A good time to buy the dip", "Retail selling continues", "We recommend caution"].every((x) =>
      !M.parseSpxWeekly(withChange((c) => { c.watchDown[1] = x; })).ok) &&
    !M.parseSpxWeekly(withChange((c) => { c.points[0].label = "Should watch"; })).ok,
  "no third party's sentiment index by name (CNN, Fear & Greed) anywhere in the file (#96)": ({ M }) =>
    ["The CNN index sits at 31.", "The Fear & Greed Index slides deeper into fear.", "Fear and greed readings stayed cautious all week."].every((x) =>
      !M.parseSpxWeekly(withChange((c) => { c.watchDown[1] = x; })).ok) &&
    !M.parseSpxWeekly(withChange((c) => { c.marketRead[0] = `${c.marketRead[0]} CNN's gauge sat in fear.`; })).ok &&
    M.parseSpxWeekly(withChange((c) => { c.watchDown[1] = "Fear eased as the index held its average."; })).ok,
  "the page reads the file through the check, and renders its fields": ({ page }) =>
    /fs\.readFileSync\(path\.join\(process\.cwd\(\), "content\/markets\/spx-weekly\.json"\), "utf8"\)/.test(page) &&
    /const r = parseSpxWeekly\(raw\);\s*if \(r\.ok\) return r\.data;/.test(page) &&
    ["weekly.intro", "weekly.marketRead.map", "weekly.oneLiner", "weekly.indexClose", "weekly.ath.level", "weekly.ath.date", "weekly.points.map", "weekly.breadth.pct200", "weekly.watchDown", "weekly.watchUp"].every((f) => page.includes(f)) &&
    ["performance", "chart", "levels", "signals", "change"].every((k) => page.includes(`<WriteUp weekly={weekly} k="${k}" stale={stale} />`)) &&
    // Weekly sections are skipped, not filled with guesses, when the file fails.
    /\{weekly \? \(\s*<section className="spxRead"[\s\S]*?This week in 3 points[\s\S]*?Market read/.test(page) &&
    /const sec = weekly\?\.sections\[k\];\s*if \(!weekly \|\| !sec\) return null;/.test(page) && !/weekly\.sentiment/.test(page),
  "the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists": ({ M }) => {
    const ok = (f) => M.parseSpxWeekly(withChange(f)).ok;
    const para = (n) => "Word ".repeat(Math.ceil(n / 5)).slice(0, n - 1) + ".";
    return M.INTRO_MIN === 150 && M.INTRO_MAX === 500 && M.SECTION_MIN === 120 && M.SECTION_MAX === 600 && M.MARKET_READ_MIN === 1400 && M.MARKET_READ_MAX === 2200 &&
      !ok((c) => { c.intro = "Too short."; }) && !ok((c) => { c.intro = `${para(250)} ${para(250)} ${para(80)}`; }) && !ok((c) => { c.intro = para(300); }) &&
      !ok((c) => { delete c.intro; }) &&
      !ok((c) => { c.sections.signals.body = "RSI was neutral."; }) && !ok((c) => { c.sections.chart.body = para(601); }) && !ok((c) => { delete c.sections.change; }) &&
      !ok((c) => { c.sections.levels.heading = "x".repeat(61); }) && ok((c) => { delete c.sections.levels.heading; }) &&
      !ok((c) => { c.marketRead = [para(700)]; }) && !ok((c) => { c.marketRead = [para(300), para(300), para(300)]; }) &&
      !ok((c) => { c.marketRead = [para(800), para(800), para(800)]; }) && !ok((c) => { c.marketRead = [para(1300), para(150)]; }) &&
      !ok((c) => { c.watchUp = c.watchUp.slice(0, 2); }) && !ok((c) => { c.watchDown[0] = "yields rise again, maybe, who knows really"; }) &&
      !ok((c) => { c.watchDown[1] = "Yields up."; });
  },
  "stale after 10 days: the hero says 'Last weekly update', the weekly tiles show their dates": ({ M, page }) =>
    M.STALE_DAYS === 10 && !M.isStale("2026-10-02", Date.parse("2026-10-12T00:00:00Z")) && M.isStale("2026-10-02", Date.parse("2026-10-12T00:00:01Z")) &&
    /const stale = weekly \? isStale\(weekly\.asOf, nowMs\) : false;/.test(page) &&
    /\{stale \? <strong style=\{\{ color: C\.amber \}\}>Last weekly update: \{weeklyDate\(weekly\.asOf\)\}\. <\/strong>/.test(page) &&
    (page.match(/dated=\{stale\}/g) ?? []).length === 2,
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
  ["the schema and types: required fields, numbers positive, exactly 3 points; sentiment removed (#96), ignored if present", "l", (s) => s.replace('if (!isPos(r.indexClose)) p.push("indexClose: not a positive number");', "")],
  ["the schema and types: required fields, numbers positive, exactly 3 points; sentiment removed (#96), ignored if present", "l", (s) => s.replace("r.points.length !== 3", "r.points.length < 1")],
  ["the schema and types: required fields, numbers positive, exactly 3 points; sentiment removed (#96), ignored if present", "l", (s) => s.replace('if (!(v === null || (typeof v === "number" && v >= 0 && v <= 100)))', "if (false)")],
  ["no third party's sentiment index by name (CNN, Fear & Greed) anywhere in the file (#96)", "l", (s) => s.replace("export const THIRD_PARTY_INDEX = /\\bCNN\\b|fear\\s*(?:&|and)\\s*greed/i;", "export const THIRD_PARTY_INDEX = /\\bCNN\\b/i;")],
  ["no third party's sentiment index by name (CNN, Fear & Greed) anywhere in the file (#96)", "l", (s) => s.replace("  if (named.length) p.push(", "  if (false) p.push(")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace("{weekly.oneLiner}", "{weekly.oneLiner}{weekly.sentiment?.label}")],
  ["length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140", "l", (s) => s.replace("export const ONE_LINER_MAX = 160;", "export const ONE_LINER_MAX = 200;")],
  ["length caps: the one-liner ≤ 160 characters, each point and watch line ≤ 140", "l", (s) => s.replace("else if ((pt.text as string).length > POINT_MAX)", "else if (false)")],
  ["dates are real YYYY-MM-DD dates", "l", (s) => s.replace("return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;", "return !Number.isNaN(d.getTime());")],
  ["dates are real YYYY-MM-DD dates", "l", (s) => s.replace("if (!isIsoDate(r.asOf))", "if (!isStr(r.asOf))")],
  ["no buy / sell / should wording anywhere in the file", "l", (s) => s.replace("export const FORBIDDEN = /\\b(buy|buying|sell|selling|should|must|recommend(?:s|ed)?)\\b/i;", "export const FORBIDDEN = /\\b(must)\\b/i;")],
  ["no buy / sell / should wording anywhere in the file", "l", (s) => s.replace("  if (advice.length) p.push(", "  if (false) p.push(")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace("const r = parseSpxWeekly(raw);\n    if (r.ok) return r.data;", "const r = { ok: true, data: raw };\n    if (r.ok) return r.data;")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace("{weekly.oneLiner}", "")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("export const INTRO_MIN = 150, INTRO_MAX = 500;", "export const INTRO_MIN = 1, INTRO_MAX = 500;")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("if (sentences(r.intro) < 2 || sentences(r.intro) > 3)", "if (false)")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("export const SECTION_MIN = 120, SECTION_MAX = 600, SECTION_HEADING_MAX = 60;", "export const SECTION_MIN = 1, SECTION_MAX = 600, SECTION_HEADING_MAX = 60;")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("export const MARKET_READ_MIN = 1400, MARKET_READ_MAX = 2200, PARAGRAPH_MIN = 200;", "export const MARKET_READ_MIN = 1400, MARKET_READ_MAX = 5000, PARAGRAPH_MIN = 200;")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("if (!/^[A-Z0-9]/.test(t) || !/[.!?]$/.test(t))", "if (false)")],
  ["the written analysis has floors and caps (#91): intro, a write-up per visual, the Market read, full-sentence watch lists", "l", (s) => s.replace("w.length < 3 || w.length > 4", "w.length < 1 || w.length > 4")],
  ["the page reads the file through the check, and renders its fields", "p", (s) => s.replace('<WriteUp weekly={weekly} k="signals" stale={stale} />', "")],
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
