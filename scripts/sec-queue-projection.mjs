// WHY THE POPULATE BACKLOG MOVED, AND HOW LONG REWINDOW NOW TAKES — measured.
//
// ── THE TWO QUESTIONS ─────────────────────────────────────────────────────
//   1. The panel read "Pages revalidated 0 of 434". Is that zero MEASURED, or
//      zero because the run predates the counter? Answered by printing the
//      stored summary's OWN KEYS — an absent key and a zero are the same value
//      to `?? 0` and opposite facts to a reader.
//   2. The populate backlog jumped. With it at or above the slack ceiling,
//      rewindow falls back to its floor and the chain-stale drain stretches
//      from days to weeks. Answered by simulating the SHIPPED populationQueues
//      forward, run by run, rather than dividing one number by another.
//
// THE SIMULATION USES THE SHIPPED FUNCTION, not a transcription. Dividing
// backlog by allowance is what produced "3 days" for a case that is actually
// governed by a conditional — the slack only exists while populate is under
// the ceiling, so the drain rate CHANGES as the backlog falls, and a division
// cannot see that.
//
// Credentialled (Upstash) and READ-ONLY: every call is a GET or an MGET.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (src, name) => (src.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick(manifestSrc, "SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick(manifestSrc, "SEC_FACTS_PREFIX");
const JOB_RUN_PREFIX = pick(fs.readFileSync("lib/server/jobRuns.ts", "utf8"), "JOB_RUN_PREFIX");
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX],
  ["JOB_RUN_PREFIX", JOB_RUN_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}

// ── 1. THE LAST RUN'S SUMMARY, KEYS AND ALL ──────────────────────────────
const run = await redis.get(`${JOB_RUN_PREFIX}:sec-facts`);
console.log("=".repeat(74));
console.log("LAST sec-facts RUN");
if (!run) {
  console.log("  (no run recorded)");
} else {
  console.log(`  at ${new Date(run.at).toISOString()}  ok=${run.ok}`);
  const keys = Object.keys(run.summary ?? {});
  console.log(`  summary keys (${keys.length}): ${keys.join(", ")}`);
  // THE DISTINCTION THE PANEL CANNOT MAKE WITH `?? 0`.
  console.log(`  "revalidated" present in the stored summary: ${Object.prototype.hasOwnProperty.call(run.summary ?? {}, "revalidated")}`);
  console.log(`  summary JSON: ${JSON.stringify(run.summary)}`);
}
console.log("");

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

// ── THE SHIPPED QUEUES, LIFTED ───────────────────────────────────────────
const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const STALE = readCodeOnly("lib/server/secStaleness.ts");
const EXTRACT = readCodeOnly("lib/server/secExtract.ts");
const num = (src, name) => Number((src.match(new RegExp(`${name} = (\\d+)`)) ?? [])[1]);
const WINDOW = num(EXTRACT, "SEC_QUARTER_WINDOW");
const YEARS = num(EXTRACT, "SEC_YEAR_WINDOW");
// needsReread compares against it; without it the lifted function throws
// ReferenceError on the first entry that reaches the `lv` test.
const LABEL_VERSION = num(EXTRACT, "SEC_LABEL_VERSION");
const LIMITS = {
  reverify: num(ROUTE, "SEC_REVERIFY_PER_RUN"),
  populate: num(ROUTE, "SEC_POPULATE_PER_RUN"),
  rewindow: num(ROUTE, "SEC_REWINDOW_PER_RUN"),
};
const CEILING = num(ROUTE, "SEC_POPULATE_SLACK_CEILING");
for (const [n, v] of [["SEC_QUARTER_WINDOW", WINDOW], ["SEC_YEAR_WINDOW", YEARS],
  ["SEC_LABEL_VERSION", LABEL_VERSION], ["SEC_POPULATE_SLACK_CEILING", CEILING]]) {
  if (!Number.isFinite(v)) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}
const mod = await lift(
  [
    readCodeOnly("lib/server/secFields.ts"),
    `const SEC_QUARTER_WINDOW = ${WINDOW};`,
    `const SEC_YEAR_WINDOW = ${YEARS};`,
    `const SEC_LABEL_VERSION = ${LABEL_VERSION};`,
    `const SEC_REVERIFY_PER_RUN = ${LIMITS.reverify};`,
    `const SEC_POPULATE_PER_RUN = ${LIMITS.populate};`,
    `const SEC_REWINDOW_PER_RUN = ${LIMITS.rewindow};`,
    `const SEC_POPULATE_SLACK_CEILING = ${CEILING};`,
    grabFunction(STALE, "needsReread").replace("export function", "function"),
    grabFunction(ROUTE, "restatedPeriods").replace("export function", "function"),
    grabFunction(ROUTE, "populationQueues").replace("export function", "function"),
    "export { populationQueues };",
  ].join("\n")
);

const q = mod.populationQueues(manifest);
const entries = Object.entries(manifest.symbols);
const withCik = entries.filter(([, e]) => e.cik);
console.log("=".repeat(74));
console.log(`MANIFEST: ${entries.length} SYMBOLS, ${withCik.length} with a CIK`);
console.log(`allowances: reverify ${LIMITS.reverify} · populate ${LIMITS.populate} · ` +
  `rewindow floor ${LIMITS.rewindow} · slack ceiling ${CEILING}`);
console.log(`QUEUES NOW: reverify ${q.reverifyBacklog} · populate ${q.populateBacklog} · rewindow ${q.rewindowBacklog}`);
console.log(`TAKEN NEXT RUN: reverify ${q.reverify.length} · populate ${q.populate.length} · rewindow ${q.rewindow.length}`);
console.log(`  slack active: ${q.populateBacklog < CEILING ? "YES" : `NO — populate ${q.populateBacklog} >= ceiling ${CEILING}`}`);
console.log("");

// ── WHY POPULATE IS THAT BIG: does the symbol already have a stored set? ──
// A populate target with a set on disk is a RE-fetch of something already
// held, which is a different problem from a symbol nobody has ever read.
const populate = q.populate.length ? q.populate : [];
const populateAll = Object.entries(manifest.symbols)
  .filter(([, e]) => e.cik && !e.needsReverify && e.contentHash === null)
  .map(([s]) => s);
let storedAlready = 0;
for (let i = 0; i < populateAll.length; i += 100) {
  const chunk = populateAll.slice(i, i + 100);
  const sets = await redis.mget(...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  sets.forEach((v) => { if (v && typeof v === "object") storedAlready++; });
}
console.log(`POPULATE BACKLOG COMPOSITION (${populateAll.length} SYMBOLS):`);
console.log(`  ${storedAlready} already have a stored fact set — the entry has no contentHash, not the store`);
console.log(`  ${populateAll.length - storedAlready} have never been fetched`);
console.log(`  next run takes ${populate.length}`);
console.log("");

// ── MY OWN DEFECT, LOOKED FOR RATHER THAN ASSUMED ────────────────────────
// cold-cik-backfill lifted emptyEntry with SEC_SCORE_VERSION substituted via
// JSON.stringify of a REGEX CAPTURE — a string. Every entry it created carries
// scoreVersion as "1" where the type says number.
const badScore = entries.filter(([, e]) => e.scoreVersion !== undefined && typeof e.scoreVersion !== "number");
console.log(`ENTRIES WHOSE scoreVersion IS NOT A NUMBER: ${badScore.length}` +
  (badScore.length ? ` — ${badScore.map(([s]) => s).sort().join(", ")}` : ""));
console.log("");

// ── 2. THE DRAIN, SIMULATED RUN BY RUN ───────────────────────────────────
// NOT backlog/allowance. The slack is conditional on the populate backlog, so
// the rate changes as populate drains — the thing a division cannot express.
//
// Each modelled run: reverify takes what it has (capped), populate takes what
// it has (capped), rewindow takes its floor plus whatever the other two left,
// but only while populate is under the ceiling. Populated symbols leave
// populate permanently; rewindowed ones leave rewindow.
const simulate = (limits, ceiling, label) => {
  let pop = populateAll.length;
  let rew = q.rewindowBacklog;
  const rev = q.reverifyBacklog;
  let day = 0;
  const marks = [];
  while (rew > 0 && day < 400) {
    day++;
    const revTaken = Math.min(rev, limits.reverify);
    const popTaken = Math.min(pop, limits.populate);
    const slack = pop < ceiling ? (limits.reverify - revTaken) + (limits.populate - popTaken) : 0;
    const rewTaken = Math.min(rew, Math.max(limits.rewindow, limits.rewindow + slack));
    pop -= popTaken;
    rew -= rewTaken;
    if (day <= 5 || rew === 0) marks.push(`    day ${day}: populate ${pop} · rewindow ${rew} (took ${rewTaken})`);
  }
  console.log(`  ${label}: ${day >= 400 ? "does not drain within 400 runs" : `${day} run(s)`}`);
  for (const m of marks.slice(0, 8)) console.log(m);
};
console.log("REWINDOW DRAIN, SIMULATED WITH THE SHIPPED populationQueues RULE:");
simulate(LIMITS, CEILING, "as shipped");
// What the smallest lever would do, so the proposal carries a number.
simulate(LIMITS, Math.max(CEILING, populateAll.length + 1), `slack ceiling raised above the backlog (${populateAll.length + 1})`);
