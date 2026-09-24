// Dates on the Interactive chart (Relay B, #553 COWORK #42).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A CLOCK TIME ON A DAILY BAR: klinecharts' default shows "YYYY-MM-DD HH:mm"
//      in the tooltip and the crosshair label ("2026-08-13 01:00" in UK summer
//      time). Every bar here is a day, week or month.
//   2. THE WRONG DAY: bars are stamped at UTC midnight; formatted in the
//      viewer's zone, anyone west of UTC sees the PREVIOUS day's date.
//   3. THE AXIS: a tick format asking for hours must show a date instead; the
//      coarser ticks (MM-DD, YYYY-MM, YYYY) keep their own granularity.
//   4. WIRING: the chart must actually use the formatter, in UTC.
//
//   node scripts/check-chart-date.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/chartDate.ts";
const CHART = "app/components/InteractiveChart.tsx";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-chartdate-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const AUG13 = Date.UTC(2026, 7, 13); // a daily bar: UTC midnight
const JAN1 = Date.UTC(2026, 0, 1);

async function suite(M, chart) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const T = M.DATE_TYPE;
  ok("tooltip: date only", M.formatBarDate(AUG13, "YYYY-MM-DD HH:mm", T.tooltip) === "2026-08-13", M.formatBarDate(AUG13, "YYYY-MM-DD HH:mm", T.tooltip));
  ok("crosshair label: date only", M.formatBarDate(AUG13, "YYYY-MM-DD HH:mm", T.crosshair) === "2026-08-13");
  ok("the bar's own UTC date, whatever the viewer's zone (New Year's Day stays 1 Jan)", M.formatBarDate(JAN1, "YYYY-MM-DD HH:mm", T.tooltip) === "2026-01-01");
  ok("an axis tick asking for hours shows the date instead", M.formatBarDate(AUG13, "HH:mm", T.xAxis) === "08-13" && M.formatBarDate(AUG13, "YYYY-MM-DD HH:mm", T.xAxis) === "2026-08-13");
  ok("coarser ticks keep their own granularity", M.formatBarDate(AUG13, "MM-DD", T.xAxis) === "08-13" && M.formatBarDate(AUG13, "YYYY-MM", T.xAxis) === "2026-08" && M.formatBarDate(AUG13, "YYYY", T.xAxis) === "2026");
  ok("the chart uses the formatter, in UTC",
    /chart\.setTimezone\("UTC"\)/.test(chart) && /chart\.setCustomApi\(\{ formatDate: \(_f: unknown, ts: number, format: string, type: number\) => formatBarDate\(ts, format, type\) \}\)/.test(chart));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const chart = readCodeOnly(CHART);

const base = await suite(await loadSibling(MODULE, src), chart);
if (base.length) {
  console.error("FAIL check-chart-date:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the tooltip keeps the clock time", () => [mut("time", src, "if (type !== DATE_TYPE.xAxis) return `${YYYY}-${MM}-${DD}`;", "if (type !== DATE_TYPE.xAxis) return `${YYYY}-${MM}-${DD} 00:00`;"), chart]],
  ["the viewer's zone, not UTC (a day shifts either side of midnight)", () => [mut("tz", src, "const DD = pad(d.getUTCDate());", "const DD = pad(new Date(timestamp - 3_600_000).getUTCDate());"), chart]],
  ["an hour tick stays a time", () => [mut("tick", src, 'const f = /H|m{2}|s{2}/.test(format.replace(/MM/g, "")) ? (format.includes("YYYY") ? "YYYY-MM-DD" : "MM-DD") : format;', "const f = format;"), chart]],
  ["the chart never installs the formatter", () => [src, mut("wire", chart, "chart.setCustomApi({ formatDate:", "chart.setCustomApi({ formatDateUnused:")]],
  ["the chart formats in the viewer's zone", () => [src, mut("utc", chart, 'chart.setTimezone("UTC")', 'chart.setTimezone("Europe/London")')]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), c); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-chart-date: date-only, UTC, axis granularity and the wiring hold; ${MUTANTS.length} mutants caught`);
