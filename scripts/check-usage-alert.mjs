// The usage alert (#553 COWORK #53; scripts/lib/usage-alert.mjs).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE ALERT NEVER FIRES: a 3x day or a tripped breaker produces no issue.
//   2. IT CRIES WOLF: a thin history (day 2 after launch) or a tiny job's 10 -> 30
//      commands reads as a spike, and the owner learns to ignore it.
//   3. A SECRET, HOST OR LINK REACHES A PUBLIC ISSUE OR LOG.
//   4. MANAGEMENT MODE RUNS HALF-CONFIGURED, or the workflow grows a secret
//      beyond the two management ones and the read-only Upstash token.
//
//   node scripts/check-usage-alert.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CORE = "scripts/lib/usage-alert.mjs";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "scripts/lib", `.check-ua-${process.pid}-${seq++}.mjs`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const day = (commands, tripped = []) => ({ commands, tripped });
const WEEK = Array.from({ length: 7 }, () => day({ "warm-stock-data": 50_000, "ipo-refresh": 5 }));

async function suite(M) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  ok("median of an odd and an even list", M.median([3, 1, 2]) === 2 && M.median([1, 2, 3, 4]) === 2.5);
  ok("dayBefore walks UTC days", M.dayBefore("2026-09-26", 1) === "2026-09-25" && M.dayBefore("2026-03-01", 1) === "2026-02-28");
  const parsed = M.parseDay({ "warm-stock-data": "123", "warm-stock-data:tripped": "2026-09-25T10:00:00Z" });
  ok("a day's hash splits into counts and trips", parsed.commands["warm-stock-data"] === 123 && parsed.tripped[0] === "warm-stock-data");

  let r = M.evaluate([day({ "warm-stock-data": 150_000, "ipo-refresh": 5 }), ...WEEK]);
  ok("3x a job's median is a spike and the alert is due", r.due && r.rows.find((x) => x.job === "warm-stock-data").spike);
  r = M.evaluate([day({ "warm-stock-data": 60_000, "ipo-refresh": 5 }), ...WEEK]);
  ok("1.2x is not", !r.due);
  r = M.evaluate([day({ "warm-stock-data": 50_000, "ipo-refresh": 40 }), ...WEEK]);
  ok("a tiny job's 8x (5 -> 40 commands) is noise, not a spike", !r.due);
  r = M.evaluate([day({ "warm-stock-data": 150_000 }), day({ "warm-stock-data": 50_000 }), day({ "warm-stock-data": 50_000 })]);
  ok("fewer than 3 days of history never alerts on a ratio", !r.due);
  r = M.evaluate([day({ "warm-stock-data": 50_000 }, ["warm-stock-data"]), ...WEEK]);
  ok("a tripped breaker alerts even at a normal count", r.due && r.rows.find((x) => x.job === "warm-stock-data").tripped);

  const issue = M.spikeIssue("2026-09-25", M.evaluate([day({ "warm-stock-data": 150_000, "ipo-refresh": 5 }), ...WEEK]));
  ok("the spike title names the date and the job", /^⚠ Usage spike: 2026-09-25 — warm-stock-data/.test(issue.title), issue.title);
  const weekly = M.weeklyReport("2026-09-25", WEEK);
  ok("the weekly report prices a 50K/day job at $3.00/month", /\| warm-stock-data \| 50,000 \| \$3\.00 \|/.test(weekly.body), weekly.body.split("\n").find((l) => l.startsWith("| warm")));
  for (const t of [issue.body, weekly.body]) ok("no links, hosts or handles in an issue body", !/https?:|www\.|\.com|@/.test(t));

  ok("management mode needs all three", !M.managementMode({ UPSTASH_MGMT_EMAIL: "a", UPSTASH_MGMT_API_KEY: "b" }) &&
    M.managementMode({ UPSTASH_MGMT_EMAIL: "a", UPSTASH_MGMT_API_KEY: "b", UPSTASH_DATABASE_ID: "c" }));
  return fails;
}

let failures = 0;
const src = read(CORE);
const base = await suite(await load(src));
console.log("=== 1. the alert's core ===");
if (!base.length) console.log("  PASS  every assertion");
for (const f of base) console.log(`  FAIL  ${f}`);
failures += base.length;

console.log("\n=== 2. the workflow and the runner ===");
const wf = read(".github/workflows/usage-alert.yml");
const runner = read("scripts/usage-alert.mjs");
const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const secrets = [...new Set([...code.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
const checks = [
  ["the workflow uses only the read-only token, the two management secrets and GITHUB_TOKEN",
    secrets.join() === ["GITHUB_TOKEN", "UPSTASH_MGMT_API_KEY", "UPSTASH_MGMT_EMAIL", "UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL"].join(), secrets.join()],
  ["it runs daily and can be dispatched dry", /cron: "40 7 \* \* \*"/.test(code) && /--dry/.test(code)],
  ["the runner never logs an env value", !/console\.log\([^)]*process\.env/.test(runner)],
  ["management stats failures leave the counters report standing", /management stats unavailable/.test(runner)],
];
for (const [label, pass, detail] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

console.log("\n=== 3. mutants (each must be caught) ===");
const MUTANTS = [
  ["the ratio threshold ignored", "ratio > SPIKE_RATIO && y >= MIN_ALERT_COMMANDS", "false"],
  ["tiny jobs alert", "ratio > SPIKE_RATIO && y >= MIN_ALERT_COMMANDS", "ratio > SPIKE_RATIO"],
  ["a thin history alerts", "past.length >= MIN_HISTORY_DAYS ? median(past) : null", "past.length ? median(past) : null"],
  ["a tripped breaker is ignored", "const due = rows.some((r) => r.spike || r.tripped);", "const due = rows.some((r) => r.spike);"],
  ["management mode on two of three", "env.UPSTASH_MGMT_EMAIL && env.UPSTASH_MGMT_API_KEY && env.UPSTASH_DATABASE_ID", "env.UPSTASH_MGMT_EMAIL && env.UPSTASH_MGMT_API_KEY"],
];
for (const [label, from, to] of MUTANTS) {
  if (!src.includes(from)) {
    console.log(`  FAIL  mutant "${label}" no longer matches the source`);
    failures++;
    continue;
  }
  const fails = await suite(await load(src.replace(from, to)));
  console.log(`  ${fails.length ? "PASS" : "FAIL"}  mutant caught: ${label}${fails.length ? ` (${fails[0]})` : " — NOTHING FAILED"}`);
  if (!fails.length) failures++;
}
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
