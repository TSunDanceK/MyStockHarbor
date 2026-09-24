// The Federal contracts panel on /bottlenecks/capex (#563 D5).
//
// What this pins, and the mutation each assertion is shown to catch:
//   1. A recipient maps to a ticker only through a reviewed alias or an exact
//      name match to a NYSE/Nasdaq listing: never an OTC line, never an
//      excluded joint venture, never a name two CIKs share.
//   2. The alias list corrects the stale parents the probe found, and every
//      alias names a listed ticker with a stated basis.
//   3. Subsidiaries roll into their parent; different companies never add.
//   4. The job writes nothing on a failed or implausible read.
//
//   node scripts/check-capex-federal.mjs
import fs from "node:fs";
import { liftCapexFederal } from "./lib/capex-lift.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const caught = (label, assertion) => {
  let failed;
  try {
    failed = !assertion();
  } catch {
    failed = true;
  }
  check(`mutation caught: ${label}`, failed);
};

const F = await liftCapexFederal();
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8")).data;
const aliasFile = JSON.parse(fs.readFileSync("data/capex/federal-aliases.json", "utf8"));
const exchangeOf = new Map(tickers.map((r) => [r[2], r[3]]));

// ── 1. How a recipient becomes a ticker ────────────────────────────────────
console.log("\n1. Alias, else an exact NYSE/Nasdaq name match, else nothing");
const cases = [
  ["LOCKHEED MARTIN CORPORATION", "LMT"],
  ["THE BOEING COMPANY", "BA"],
  ["SIKORSKY AIRCRAFT CORPORATION", "LMT"], // stale RTX parent in USAspending
  ["AMENTUM SERVICES, INC.", "AMTM"], // stale AECOM parent
  ["V2X SYSTEMS LLC", "VVX"], // stale ITT parent
  ["CITIBANK, N.A.", "C"], // the probe mapped this to an OTC line
  ["GLENCORE LTD.", null], // OTC only
  ["KONGSBERG DEFENCE & AEROSPACE AS", null], // OTC only
  ["SAVANNAH RIVER NUCLEAR SOLUTIONS LLC", null], // joint venture
  ["TRIWEST HEALTHCARE ALLIANCE CORP", null], // private
  ["GLENCORE PLC/ADR", null], // the exact name of an OTC ADR: listed nowhere we use
];
const matchesOk = (build) => {
  const m = build(tickers, aliasFile.aliases, aliasFile.exclusions);
  return cases.every(([name, want]) => (m(name)?.ticker ?? null) === want);
};
check("eleven recipients map as reviewed", matchesOk(F.buildMatcher),
  cases.map(([n, t]) => `${n.split(" ")[0]}→${t ?? "none"}`).join(", "));
check("no mapped ticker is an OTC line", F.buildMatcher(tickers, aliasFile.aliases, aliasFile.exclusions)("GLENCORE PLC") === null);

const src = fs.readFileSync("lib/server/capexFederal.ts", "utf8");
const mutant = async (from, to) => {
  const m = src.replace(from, to);
  if (m === src) throw new Error(`mutation target not found: ${from}`);
  return lift(m.slice(m.indexOf("export const CAPEX_FEDERAL_REDIS_KEY"), m.indexOf("const redis =")), "", "mutant");
};
{
  const otc = await mutant("if (!exchange || !LISTED.has(exchange)) continue;", "");
  caught("OTC listings allowed into the name match", () => matchesOk(otc.buildMatcher));
  const noExclusions = await mutant("if (excluded.has(key)) return null;", "");
  caught("the joint-venture exclusions ignored", () =>
    noExclusions.buildMatcher(tickers, [...aliasFile.aliases, { name: "SAVANNAH RIVER NUCLEAR SOLUTIONS LLC", ticker: "FLR", basis: "x" }], aliasFile.exclusions)(
      "SAVANNAH RIVER NUCLEAR SOLUTIONS LLC"
    ) === null);
  caught("the stale-parent aliases dropped (name match only)", () => matchesOk((t, _a, e) => F.buildMatcher(t, [], e)));
}
{
  // Two different CIKs under one normalised name is ambiguous, not a match.
  const twins = [[1, "ACME CORP", "ACM1", "NYSE"], [2, "ACME INC", "ACM2", "Nasdaq"]];
  check("a name two companies share maps to neither", F.buildMatcher(twins, [], [])("ACME CORPORATION") === null);
}

// ── 2. The alias list itself ───────────────────────────────────────────────
console.log("\n2. Every alias names a NYSE/Nasdaq ticker and says why");
const aliasesOk = (list) =>
  list.every((a) => ["NYSE", "Nasdaq"].includes(exchangeOf.get(a.ticker)) && typeof a.basis === "string" && a.basis.length >= 12);
check(`${aliasFile.aliases.length} aliases, each listed and with a basis`, aliasesOk(aliasFile.aliases));
check(`${aliasFile.exclusions.length} exclusions, each with a reason`, aliasFile.exclusions.every((e) => e.reason && e.reason.length >= 12));
caught("an alias to an OTC ticker", () => aliasesOk([...aliasFile.aliases, { name: "X", ticker: "GLCNF", basis: "subsidiary of Glencore" }]));

// ── 3. Roll-up ─────────────────────────────────────────────────────────────
console.log("\n3. Subsidiaries roll into their parent; companies never add");
const match = F.buildMatcher(tickers, aliasFile.aliases, aliasFile.exclusions);
const rows = [
  { name: "GENERAL DYNAMICS CORPORATION", amount: 10 },
  { name: "ELECTRIC BOAT CORPORATION", amount: 30 },
  { name: "LOCKHEED MARTIN CORPORATION", amount: 25 },
  { name: "SIKORSKY AIRCRAFT CORPORATION", amount: 5 },
  { name: "TRIWEST HEALTHCARE ALLIANCE CORP", amount: 99 },
];
const rolled = F.rollUp(rows, match);
const rollOk = (r) =>
  r.companies.length === 2 &&
  r.companies[0].ticker === "GD" && r.companies[0].amount === 40 && r.companies[0].recipients === 2 &&
  r.companies[1].ticker === "LMT" && r.companies[1].amount === 30 &&
  r.matched === 70 && r.unmatchedLargest[0].name.startsWith("TRIWEST");
check("GD 40 from two entities, LMT 30 with Sikorsky, TriWest left unmatched", rollOk(rolled));
caught("a roll-up keyed by something other than the ticker", () => {
  const byName = (name) => { const m = match(name); return m ? { ...m, ticker: name } : null; };
  return rollOk(F.rollUp(rows, byName));
});
check("the window is the 12 complete months before today",
  JSON.stringify(F.federalWindow(new Date("2026-09-24T06:30:00Z"))) === JSON.stringify({ start: "2025-09-01", end: "2026-08-31" }));

// ── 4. The job ─────────────────────────────────────────────────────────────
console.log("\n4. A failed or implausible read writes nothing");
const route = readCodeOnly("app/api/jobs/capex-federal/route.ts");
const failWritesNothing = (code) => /catch \(err\) \{[\s\S]*?written: false[\s\S]*?return NextResponse\.json\(summary, \{ status: 502 \}\)/.test(code);
check("a USAspending failure returns before any write", failWritesNothing(route));
const plausibleGate = (code) => /dryRun \|\| !plausible\s*\?\s*\{[\s\S]*?\}\s*:\s*await writeStoredFederal\(doc\)/.test(code);
check("an implausible read (under 500 recipients, $100bn or 20 companies) is not written", plausibleGate(route) && /recipientsRead >= 500/.test(route));
caught("the plausibility gate removed", () => plausibleGate(route.replace(/dryRun \|\| !plausible\s*\?/, "dryRun ?")));
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const cron = vercel.crons.find((c) => c.path === "/api/jobs/capex-federal");
const jobs = fs.readFileSync("lib/server/jobRuns.ts", "utf8");
check("scheduled daily (refreshing weekly) and registered in JOBS with the same cron",
  Boolean(cron) && jobs.split("\n").some((l) => l.includes('"capex-federal":') && l.includes(`cron: "${cron?.schedule}"`)) &&
  /ageDays < CAPEX_FEDERAL_FRESH_DAYS/.test(route));
check("gated and recorded", /Bearer \$\{secret\}/.test(route) && /guardDebugRequest\(req\)/.test(route) && /recordJobRun\("capex-federal"/.test(route));

// ── 5. The committed baseline is a real, dated read ───────────────────────
console.log("\n5. The baseline shown before the first run");
const base = JSON.parse(fs.readFileSync("data/capex/federal-baseline.json", "utf8"));
check("baseline: 1,000 recipients, a 12-month window, sorted companies with listed tickers",
  base.recipientsRead === 1000 && /^\d{4}-\d{2}-01$/.test(base.window.start) &&
  base.companies.every((c, i, a) => (i === 0 || a[i - 1].amount >= c.amount) && ["NYSE", "Nasdaq"].includes(exchangeOf.get(c.ticker))) &&
  base.matchedObligations <= base.topRecipientsObligations && base.topRecipientsObligations <= base.totalObligations * 1.001);

const panel = readCodeOnly("app/bottlenecks/capex/FederalPanel.tsx");
check("the panel adds nothing across companies", !/\.reduce\s*\(/.test(panel) && /Source: USAspending\.gov/.test(panel) && /SAM\.gov/.test(panel));

console.log(failures ? `\n${failures} FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
