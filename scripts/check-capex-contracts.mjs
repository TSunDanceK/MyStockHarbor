// Capex "Federal contracts": mapping USAspending recipients to listed
// companies, and the committed alias list (Relay C, #563 COWORK #1 D5).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A REAL DOLLAR FIGURE ON THE WRONG COMPANY. The probe saw Citibank map to
//      JTGEY and "Target" map to TGT. So: exclusions win over everything, and
//      name matching is EXACT after normalising -- never "contains".
//   2. A COMPANY UNDER-STATED. Its subsidiaries' obligations must sum into it.
//   3. AN ALIAS WITH NO BASIS, or pointing outside our universe.
//   4. THE WINDOW SLIDES WRONG: the last 12 FULL months, across a year end.
//
//   node scripts/check-capex-contracts.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CORE = "lib/server/capexContractsCore.ts";

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib/server", `.check-cxc-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const UNIVERSE = [
  { ticker: "LMT", secName: "LOCKHEED MARTIN CORP" },
  { ticker: "GD", secName: "GENERAL DYNAMICS CORP" },
  { ticker: "C", secName: "CITIGROUP INC" },
  { ticker: "BA", secName: "BOEING CO" },
  { ticker: "AT", secName: "AT INC" },
];
const ALIASES = [{ recipient: "ELECTRIC BOAT CORPORATION", ticker: "GD", basis: "constructed for the check" }];
const EXCLUSIONS = [{ recipient: "THE BOEING COMPANY", reason: "constructed: an exclusion must beat an exact name" }];

async function suite(M, aliasFile, universeTickers) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  ok("normalising drops legal forms and folds &", M.normName("Lockheed Martin Corporation") === M.normName("LOCKHEED MARTIN CORP") && M.normName("A & B Inc.") === "A AND B");
  const map = M.buildMapper(ALIASES, EXCLUSIONS, UNIVERSE);
  ok("an exact name maps", map("Lockheed Martin Corporation")?.ticker === "LMT" && map("Lockheed Martin Corporation")?.how === "name");
  ok("a longer name does NOT map by containment", map("Lockheed Martin Space Systems Company") === null);
  ok("a committed alias maps a subsidiary", map("Electric Boat Corporation")?.ticker === "GD" && map("Electric Boat Corporation")?.how === "alias");
  ok("an exclusion beats an exact name", map("The Boeing Company") === null);
  ok("a name shorter than 3 characters never matches", map("AT Inc") === null);

  const agg = M.aggregateContracts(
    [
      { name: "Lockheed Martin Corporation", amount: 50e9 },
      { name: "Electric Boat Corporation", amount: 10e9 },
      { name: "General Dynamics Corporation", amount: 8e9 },
      { name: "Some University", amount: 5e9 },
      { name: "Broken", amount: "n/a" },
    ],
    map,
    10
  );
  const gd = agg.rows.find((r) => r.ticker === "GD");
  ok("a company's own entities sum into it", gd?.amount === 18e9 && gd.entities.length === 2 && gd.entities[0].amount === 10e9, JSON.stringify(gd));
  ok("rows sort by amount and the mapped share is kept", agg.rows[0].ticker === "LMT" && agg.mappedAmount === 68e9 && agg.readAmount === 73e9, JSON.stringify(agg));
  ok("the keep limit holds", M.aggregateContracts([{ name: "Lockheed Martin Corp", amount: 1 }, { name: "General Dynamics Corp", amount: 2 }], map, 1).rows.length === 1);

  const w = M.contractWindow(Date.parse("2026-09-24T09:00:00Z"));
  ok("the window is the last 12 full months", w.start === "2025-09-01" && w.end === "2026-08-31", JSON.stringify(w));
  const j = M.contractWindow(Date.parse("2026-01-15T09:00:00Z"));
  ok("…across a year end", j.start === "2025-01-01" && j.end === "2025-12-31", JSON.stringify(j));

  // The committed list.
  const aliasNames = new Set(aliasFile.aliases.map((a) => M.normName(a.recipient)));
  ok("every alias carries a basis", aliasFile.aliases.every((a) => typeof a.basis === "string" && a.basis.trim().length >= 12), JSON.stringify(aliasFile.aliases.filter((a) => !(a.basis?.trim().length >= 12))));
  ok("every alias points into our universe", aliasFile.aliases.every((a) => universeTickers.has(a.ticker)), aliasFile.aliases.filter((a) => !universeTickers.has(a.ticker)).map((a) => a.ticker).join());
  ok("every exclusion carries a reason", aliasFile.exclusions.every((e) => typeof e.reason === "string" && e.reason.trim().length >= 12));
  ok("no recipient is both aliased and excluded", aliasFile.exclusions.every((e) => !aliasNames.has(M.normName(e.recipient))));
  ok("no recipient is aliased twice", aliasNames.size === aliasFile.aliases.length);

  // The REAL list against the REAL universe, in company-tickers' own order
  // (the job's universeNames rule: primary ticker first).
  const real = M.buildMapper(aliasFile.aliases, aliasFile.exclusions, realUniverse);
  ok("AT&T maps to the common stock, never the note", real("AT&T INC.")?.ticker === "T" && real("AT&T ENTERPRISES, LLC")?.ticker === "T");
  ok("Sikorsky is Lockheed's, not RTX's (stale parent record overridden)", real("SIKORSKY AIRCRAFT CORPORATION")?.ticker === "LMT");
  ok("Amentum and V2X map to themselves, not their stale parents", real("AMENTUM SERVICES, INC.")?.ticker === "AMTM" && real("V2X SYSTEMS LLC")?.ticker === "VVX");
  ok("a joint venture stays unmapped", real("SAVANNAH RIVER NUCLEAR SOLUTIONS LLC") === null);
  // #563 COWORK #4: a national lab's operating budget is not its owner's line.
  ok("national-lab operators stay unmapped, even when a listed company owns them",
    ["NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC", "HONEYWELL FEDERAL MANUFACTURING & TECHNOLOGIES, LLC", "FLUOR MARINE PROPULSION, LLC", "LEIDOS BIOMEDICAL RESEARCH INC", "TRIAD NATIONAL SECURITY, LLC"].every((n) => real(n) === null));
  ok("no alias names a laboratory or a national-security site operator",
    !aliasFile.aliases.some((x) => /LABORATOR|SANDIA|LIVERMORE|LOS ALAMOS|OAK RIDGE|BATTELLE|NATIONAL SECURITY|NUCLEAR SECURITY|MARINE PROPULSION|BIOMEDICAL RESEARCH|PANTEX|Y-12/.test(x.recipient)),
    aliasFile.aliases.filter((x) => /LABORATOR|SANDIA|NATIONAL SECURITY|MARINE PROPULSION|BIOMEDICAL RESEARCH/.test(x.recipient)).map((x) => x.recipient).join());
  ok("the primes map by exact name", real("LOCKHEED MARTIN CORPORATION")?.ticker === "LMT" && real("THE BOEING COMPANY")?.ticker === "BA");
  return fails;
}

const src = read(CORE);
const aliasFile = JSON.parse(read("data/capex/contract-aliases.json"));
const universeTickers = new Set(Object.keys(JSON.parse(read("data/sec/registrants.json")).rows));
const ct = JSON.parse(read("data/sec/company-tickers.json"));
const realUniverse = ct.data
  .map((r) => ({ ticker: String(r[ct.fields.indexOf("ticker")]), secName: String(r[ct.fields.indexOf("name")]) }))
  .filter((u) => universeTickers.has(u.ticker));
const base = await suite(await load(src), aliasFile, universeTickers);
if (base.length) {
  console.error("FAIL check-capex-contracts:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["exclusions ignored", () => mut("excl", src, `if (!n || excluded.has(n)) return null;`, `if (!n) return null;`)],
  ["containment matching", () => mut("contains", src, `const t = byName.get(n);`, `const t = byName.get(n) ?? [...byName].find(([k]) => n.startsWith(k))?.[1];`)],
  ["short names allowed", () => mut("short", src, `if (n.length >= 3 && !byName.has(n))`, `if (!byName.has(n))`)],
  ["entities overwrite instead of summing", () => mut("sum", src, `row.amount += amount;`, `row.amount = amount;`)],
  ["the window ends a month late", () => mut("window", src, `const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));`, `const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));`)],
];
let survived = 0;
for (const [label, make] of MUTANTS) {
  const fails = await suite(await load(make()), aliasFile, universeTickers);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);

// ── The job: weekly data from a daily cron, no implausible write, a deadline ──
// (ported from #572 under #563 COWORK #3). /cache-health reads a cron's minute
// and hour only, so a Mondays-only cron reads as a stalled daily job; the
// route fires daily and rebuilds when its record is 6.5 days old.
function jobSuite(route, job, vercel, jobs) {
  const fails = [];
  const ok = (label, cond) => { if (!cond) fails.push(label); };
  const cron = JSON.parse(vercel).crons.find((c) => c.path === "/api/jobs/capex-contracts")?.schedule ?? "";
  ok("the cron fires daily (every day-of-week)", /^\d+ \d+ \* \* \*$/.test(cron));
  ok("JOBS carries the same cron", jobs.split("\n").some((l) => l.includes('"capex-contracts":') && l.includes(`cron: "${cron}"`)));
  ok("a fresh record skips the rebuild", /ageDays < CONTRACTS_FRESH_DAYS/.test(route) && /CONTRACTS_FRESH_DAYS = 6\.5/.test(route));
  ok("an implausibly small read is not written", /recipientsRead >= 500 && built\.record\.rows\.length >= 10/.test(route) && /const record = plausible \? built\.record : null;/.test(route));
  ok("every USAspending call stops at the deadline", /if \(left < 5_000\) return null;/.test(job) && (job.match(/, deadline\)\)?/g) ?? []).length >= 2);
  return fails;
}
const JOB = { route: read("app/api/jobs/capex-contracts/route.ts"), job: read("lib/server/capexContractsJob.ts"), vercel: read("vercel.json"), jobs: read("lib/server/jobRuns.ts") };
const jobFails = jobSuite(JOB.route, JOB.job, JOB.vercel, JOB.jobs);
if (jobFails.length) {
  console.error("FAIL check-capex-contracts (job):\n  " + jobFails.join("\n  "));
  process.exit(1);
}
const JOB_MUTANTS = [
  ["the weekly cron restored", () => jobSuite(JOB.route, JOB.job, JOB.vercel.replace('"schedule": "10 6 * * *"', '"schedule": "10 6 * * 1"'), JOB.jobs)],
  ["the plausibility gate removed", () => jobSuite(JOB.route.replace("const record = plausible ? built.record : null;", "const record = built.record;"), JOB.job, JOB.vercel, JOB.jobs)],
  ["the deadline ignored", () => jobSuite(JOB.route, JOB.job.replace("if (left < 5_000) return null;", ""), JOB.vercel, JOB.jobs)],
];
for (const [label, run] of JOB_MUTANTS) {
  if (!run().length) {
    console.error(`MUTANT SURVIVED: ${label}`);
    process.exit(1);
  }
}
console.log(`check-capex-contracts: all assertions pass; ${MUTANTS.length + JOB_MUTANTS.length} mutants caught`);
