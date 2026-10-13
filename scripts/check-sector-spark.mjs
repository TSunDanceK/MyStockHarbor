// THE /sector CARDS' 3-MONTH LINE (#553 COWORK #157, ruled in #167).
//
// Runtime, on lib/sectorSeries.ts with fixtures:
//   - cap-weighted like the cards' returns (equal weights only when no member
//     has a cap); a member missing a day carries its last close forward;
//   - the line starts at 0 on the window's first session and spans 63
//     sessions; its last month agrees in sign and size with a "1 month"
//     figure computed the cards' way;
//   - green when it ends at or above 0, red below;
//   - a member with no close on the first session is left out, not zeroed.
// Wiring: the nightly EOD job writes the key on a complete night only, from
// the bars it already holds (no new fetch, +1 SET), and never fails on it; the
// sector table reads it with its own build; the stored value carries
// percentages only, and no public JSON route reads the key.
// Plus a timing: the 11 lines over a full fixture universe finish well inside
// the job's budget. Every rule has a planted mutant.
//
//   node scripts/check-sector-spark.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const LIB = "lib/sectorSeries.ts";
const JOBS = "lib/server/marketData/jobs.ts";
const SPARKS = "lib/server/sectorSparks.ts";
const PANELS = "lib/server/sectorPanels.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function loadLib(src) {
  const f = path.join(ROOT, "lib", `.check-ssp-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

const day = (i) => new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10);
const series = (n, f) => Array.from({ length: n }, (_, i) => [day(i), f(i)]);

function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  // BIG rises 10% steadily, SMALL falls 50%; caps 9:1 -> the line ends near +4%.
  const closes = { BIG: series(80, (i) => 100 * (1 + 0.1 * (i / 79))), SMALL: series(80, (i) => 100 * (1 - 0.5 * (i / 79))) };
  const caps = { BIG: 9, SMALL: 1 };
  const s = L.sectorSeries(["BIG", "SMALL"], (x) => closes[x], (x) => caps[x]);
  const t0 = 80 - 64;
  const expect = (i) => (9 * ((1 + 0.1 * (i / 79)) / (1 + 0.1 * (t0 / 79)) - 1) * 100 + 1 * ((1 - 0.5 * (i / 79)) / (1 - 0.5 * (t0 / 79)) - 1) * 100) / 10;
  want("63 sessions, starting at 0", s && s.v.length === 64 && s.v[0] === 0 && s.from === day(t0) && s.to === day(79));
  want("cap-weighted like the cards' returns", s && Math.abs(s.v[63] - expect(79)) < 0.01);
  const eq = L.sectorSeries(["BIG", "SMALL"], (x) => closes[x], () => null);
  const eqEnd = (((1.1) / (1 + 0.1 * (t0 / 79)) - 1) * 100 + ((0.5) / (1 - 0.5 * (t0 / 79)) - 1) * 100) / 2;
  want("equal weights only when no member has a cap", eq && Math.abs(eq.v[63] - eqEnd) < 0.01 && eq.v[63] < 0);
  // The last month agrees with a "1 month" figure the cards' way (weighted % from 21 sessions back).
  const m1 = (9 * (1.1 / (1 + 0.1 * (58 / 79)) - 1) * 100 + 1 * (0.5 / (1 - 0.5 * (58 / 79)) - 1) * 100) / 10;
  const lineMonth = s.v[63] - s.v[63 - 21];
  want("the line's last month moves with the 1-month figure (same sign, within 1 point)", Math.sign(lineMonth) === Math.sign(m1) && Math.abs(lineMonth - m1) < 1);
  // A member missing a day carries its last close forward; one with no first-session close is left out.
  const gappy = { A: series(80, () => 100).filter(([d]) => d !== day(70)), LATE: series(80, (i) => (i < 40 ? NaN : 50)) };
  const g = L.sectorSeries(["A", "LATE"], (x) => gappy[x], () => 1);
  want("a missing day carries the last close forward; a late listing is left out", g && g.v.every((x) => x === 0));
  want("green at or above 0, red below", L.sparkUp([0, 1, 2]) && !L.sparkUp([0, -1]) && L.sparkUp([0, 0]));
  want("a path for two or more points, none for fewer", typeof L.sparkPath([0, 1], 120, 28) === "string" && L.sparkPath([0], 120, 28) === null);
  want("percentages only, rounded to 2 dp", s.v.every((x) => Number(x.toFixed(2)) === x));
  return fails;
}

function wiringRules({ jobs, sparks, panels }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const j = stripComments(jobs, { file: JOBS });
  const sp = stripComments(sparks, { file: SPARKS });
  const p = stripComments(panels, { file: PANELS });
  want("the job writes the lines on a complete night only, from its bars", /const sectorSparks = complete \? await writeSectorSparks\(r, bars, nowMs\) : null;/.test(j));
  want("...after the night's bars are in hand, and reports it", j.indexOf("const sectorSparks =") > j.indexOf("await Promise.all(Array.from({ length: EOD_CONCURRENCY }, worker));") && /eodLastRows,\s*sectorSparks,/.test(j));
  want("one SET, never failing the job, no fetch", /await r\.set\(SECTOR_SPARK_KEY, built, \{ ex: SECTOR_SPARK_TTL_SECONDS \}\);/.test(sp) && /\} catch \(err\) \{\s*return \{ error:/.test(sp) && !/\bfetch\(|fetchEod/.test(sp));
  want("the stored lines are percentages from sectorSeries (closes never stored)", /const line = sectorSeries\(members\[sector\.slug\], closesOf,/.test(sp) && !/close:|bars:/.test(sp.slice(sp.indexOf("sectors[sector.slug] = line;") - 20, sp.indexOf("sectors[sector.slug] = line;") + 40)));
  want("the cards' sample: the same top 25", /export const SECTOR_SPARK_SAMPLE = 25;/.test(sp) && /const PERFORMANCE_SAMPLE = 25;/.test(p));
  want("the sector table reads the key with its build", /readSectorSparks\(\)/.test(p) && /spark: sparks\?\.sectors\[sector\.slug\]\?\.v \?\? null,/.test(p));
  return fails;
}

function publicJsonRule(files) {
  return Object.entries(files).filter(([f, src]) => f.startsWith("app/api/") && /SECTOR_SPARK_KEY|readSectorSparks|msh:sector-spark/.test(src)).map(([f]) => f);
}

try {
  const libSrc = read(LIB);
  const L = await loadLib(libSrc);
  console.log("\n1. The line, on fixtures");
  const l = libRules(L);
  check("cap-weighted, from 0, agrees with 1 month, carries forward, colour", l.length === 0, l.join("; "));

  console.log("\n2. Budget");
  // A full universe: 11 sectors x 25 members x 1,400 bars, timed.
  const big = Array.from({ length: 275 }, (_, k) => [`S${k}`, series(1400, (i) => 50 + Math.sin((i + k) / 9) * 5 + i * 0.01)]);
  const byName = Object.fromEntries(big);
  const t = performance.now();
  for (let s = 0; s < 11; s++) L.sectorSeries(big.slice(s * 25, s * 25 + 25).map(([n]) => n), (x) => byName[x], () => 1);
  const ms = performance.now() - t;
  check("the 11 lines over 275 x 1,400 bars take well under a second (the job's budget is 240 s)", ms < 1000, `${ms.toFixed(1)} ms`);

  console.log("\n3. Wiring");
  const real = { jobs: read(JOBS), sparks: read(SPARKS), panels: read(PANELS) };
  const w = wiringRules(real);
  check("written nightly on a complete night, +1 SET, read with the table", w.length === 0, w.join("; "));
  const files = {};
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const r = path.join(d, e.name); if (e.isDirectory()) walk(r); else if (/\.tsx?$/.test(e.name)) files[r] = read(r); } };
  walk("app/api");
  const leaks = publicJsonRule(files);
  check("no public JSON route reads the lines", leaks.length === 0, leaks.join(", "));

  console.log("\n4. Planted mutants");
  const LM = [
    ["equal weights although caps exist", "const weight = (s: string) => (capped.length ? (capOf(s) as number) : 1);", "const weight = (s: string) => (s ? 1 : 1);"],
    ["no carry-forward (a missing day counts as a fall)", "      if (num(c)) last.set(s, c);\n", "      last.set(s, num(c) ? c : 0);\n"],
    ["the window a year long", "export const SECTOR_SPARK_SESSIONS = 63;", "export const SECTOR_SPARK_SESSIONS = 252;"],
    ["red at exactly 0", "return v.length > 0 && v[v.length - 1] >= 0;", "return v.length > 0 && v[v.length - 1] > 0;"],
  ];
  for (const [label, from, to] of LM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = libRules(await loadLib(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const WM = [
    ["written on a partial night too", "jobs", "const sectorSparks = complete ? await writeSectorSparks(r, bars, nowMs) : null;", "const sectorSparks = await writeSectorSparks(r, bars, nowMs);"],
    ["a failure fails the job", "sparks", "  } catch (err) {\n    return { error:", "  } finally {\n    void 0;\n  }\n  {\n    const err = null;\n    return { error:"],
    ["the table no longer reads it", "panels", "spark: sparks?.sectors[sector.slug]?.v ?? null,", "spark: null,"],
  ];
  for (const [label, which, from, to] of WM) {
    if (!real[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = wiringRules({ ...real, [which]: real[which].replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  {
    const f = publicJsonRule({ ...files, "app/api/sector-spark/route.ts": 'import { SECTOR_SPARK_KEY } from "@/lib/server/sectorSparks";' });
    check('mutant "a public JSON route serving the lines" is caught', f.length > 0);
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
