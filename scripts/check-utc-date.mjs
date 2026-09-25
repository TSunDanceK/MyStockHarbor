// Dates rendered on the server and the client (Relay B, #553 COWORK #45).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. REACT #418 ON /dashboard: date text formatted in the viewer's zone or
//      locale (toLocale*, getDate()) differs from the server's UTC render and
//      fails hydration.
//   2. THE WRONG DAY: "2026-06-08" is UTC midnight; read back with getDate()
//      west of UTC it is the 7th (the Basic chart's axis said 06/07).
//   3. WIRING: the Basic chart's axis and the dashboard's benchmark "Updated"
//      line and news dates go through lib/utcDate, not toLocale*.
//
// The rendered test (/dashboard in New York, London and Tokyo, en-US, en-GB,
// ja-JP: no hydration error) is posted on #553.
//
//   node scripts/check-utc-date.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/utcDate.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-utcdate-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

async function suite(M, dash, price) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  ok("a date-only bar keeps its own day: 2026-06-08 -> 06/08", M.utcMonthDay("2026-06-08") === "06/08", String(M.utcMonthDay("2026-06-08")));
  ok("New Year's Day stays 01/01", M.utcMonthDay("2026-01-01") === "01/01");
  ok("a calendar date: 8 Jun 2026", M.utcDay("2026-06-08T23:30:00Z") === "8 Jun 2026", String(M.utcDay("2026-06-08T23:30:00Z")));
  ok("a moment is labelled UTC: 8 Jun 2026, 23:30 UTC", M.utcStamp("2026-06-08T23:30:00Z") === "8 Jun 2026, 23:30 UTC", String(M.utcStamp("2026-06-08T23:30:00Z")));
  ok("garbage in, null out (the caller shows its own placeholder)", M.utcMonthDay("nope") === null && M.utcStamp("") === null);
  ok("the Basic chart's axis uses utcMonthDay", /return utcMonthDay\(s\) \?\? s;/.test(price) && !/\.getDate\(\)|\.getMonth\(\)/.test(price));
  ok("the dashboard's benchmark line and news dates go through lib/utcDate",
    /Updated: \{\(bench\?\.updatedAt && utcStamp\(bench\.updatedAt\)\) \|\| "—"\}/.test(dash) && /\{\(item\.pubDate && utcDay\(item\.pubDate\)\) \|\| "Recent"\}/.test(dash));
  ok("no toLocale* date text left in the dashboard", !/toLocale(?:Date|Time)?String\(/.test(dash));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const dash = readCodeOnly("app/components/DashboardClient.tsx");
const price = readCodeOnly("app/components/PriceChart.tsx");

const base = await suite(await loadSibling(MODULE, src), dash, price);
if (base.length) {
  console.error("FAIL check-utc-date:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the viewer's zone (a day early west of UTC)", () => [mut("zone", src, "`${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`", "`${pad(d.getUTCMonth() + 1)}/${pad(new Date(d.getTime() - 3_600_000).getUTCDate())}`"), dash, price]],
  ["the stamp drops its UTC label", () => [mut("label", src, "${pad(d.getUTCMinutes())} UTC`", "${pad(d.getUTCMinutes())}`"), dash, price]],
  ["the chart axis back on getDate()", () => [src, dash, price.replace("return utcMonthDay(s) ?? s;", "const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}`;")]],
  ["the benchmark line back on toLocaleString()", () => [src, mut("bench", dash, "utcStamp(bench.updatedAt)", "new Date(bench.updatedAt).toLocaleString()"), price]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, d, p] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), d, p); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-utc-date: UTC days, labelled stamps and the dashboard wiring hold; ${MUTANTS.length} mutants caught`);
