// Daily usage alert, independent of the site (#553 COWORK #53; #535 COWORK #17 Part 3).
//
// COUNTERS MODE (default): reads the job guard's per-job daily command totals
// (msh:jobs:commands:v1:<day>, written by lib/server/jobGuard.ts) with the
// existing READ-ONLY token. Yesterday against each job's median over the 7
// days before; over 2x (and 1,000+ commands), or any tripped breaker, opens ONE
// issue "⚠ Usage spike: <date> — <jobs>". On Mondays (or --weekly) it also
// writes the "Weekly job cost report" issue.
//
// MANAGEMENT MODE switches on only when UPSTASH_MGMT_EMAIL, UPSTASH_MGMT_API_KEY
// and UPSTASH_DATABASE_ID all exist (COWORK #53: the management key is
// account-level, so it is the owner's choice to add). It adds whole-database
// daily figures; any failure there is logged and the counters report stands.
//
// PUBLIC REPO: nothing here prints a secret, a host or a link.
// REDIS: 8 HGETALL a run (yesterday + 7 days), read-only.
//
//   node scripts/usage-alert.mjs [--dry] [--weekly]
import { Redis } from "@upstash/redis";
import { dayBefore, evaluate, managementMode, parseDay, spikeIssue, weeklyReport } from "./lib/usage-alert.mjs";

const dry = process.argv.includes("--dry");
const today = new Date().toISOString().slice(0, 10);
const weekly = process.argv.includes("--weekly") || new Date().getUTCDay() === 1;
const redis = Redis.fromEnv();

const dates = Array.from({ length: 8 }, (_, i) => dayBefore(today, i + 1)); // yesterday first
const days = [];
for (const d of dates) days.push(parseDay((await redis.hgetall(`msh:jobs:commands:v1:${d}`)) ?? {}));
console.log(`read ${dates.length} day(s) of counters (${dates[dates.length - 1]} .. ${dates[0]}); Redis commands ${dates.length}`);

const result = evaluate(days);
console.log(`jobs ${result.rows.length}; alert due: ${result.due}`);
for (const r of result.rows) console.log(`  ${r.job}: ${r.yesterday} (median ${r.median ?? "—"})${r.spike ? " SPIKE" : ""}${r.tripped ? " TRIPPED" : ""}`);

let mgmtNote = "";
if (managementMode(process.env)) {
  try {
    const auth = Buffer.from(`${process.env.UPSTASH_MGMT_EMAIL}:${process.env.UPSTASH_MGMT_API_KEY}`).toString("base64");
    const res = await fetch(`https://api.upstash.com/v2/redis/stats/${encodeURIComponent(process.env.UPSTASH_DATABASE_ID)}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    const series = Array.isArray(stats?.dailyrequests) ? stats.dailyrequests : Array.isArray(stats?.daily_net_commands) ? stats.daily_net_commands : null;
    const ys = series ? series.map((p) => Number(p?.y ?? p)).filter(Number.isFinite) : [];
    if (ys.length >= 2) {
      const y = ys[ys.length - 2]; // the last full day
      const prior = ys.slice(Math.max(0, ys.length - 9), ys.length - 2).sort((a, b) => a - b);
      const med = prior.length ? prior[Math.floor(prior.length / 2)] : null;
      mgmtNote = `\n\nWhole database (Upstash management API): ${Math.round(y).toLocaleString("en-US")} commands on the last full day; 7-day median ${med === null ? "—" : Math.round(med).toLocaleString("en-US")}.`;
      if (med && y > 2 * med && y >= 1000) result.due = true;
    } else {
      console.log(`management stats: no daily series in the response (fields: ${Object.keys(stats ?? {}).join(", ")})`);
    }
  } catch (err) {
    console.log(`management stats unavailable (${err?.name ?? "error"}); counters report stands`);
  }
} else {
  console.log("management mode: off (needs UPSTASH_MGMT_EMAIL, UPSTASH_MGMT_API_KEY and UPSTASH_DATABASE_ID)");
}

const issues = [];
if (result.due) issues.push({ ...spikeIssue(dates[0], result), kind: "spike" });
if (weekly) issues.push({ ...weeklyReport(dates[0], days.slice(0, 7)), kind: "weekly" });
for (const i of issues) i.body += mgmtNote;

if (dry || !issues.length) {
  for (const i of issues) console.log(`\n--- ${i.title}\n${i.body}`);
  if (!issues.length) console.log("nothing to open");
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required (or pass --dry)");
const gh = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
};
const open = await gh(`/issues?state=open&per_page=100`);
for (const i of issues) {
  const existing = open.find((x) => !x.pull_request && x.title === i.title);
  if (existing) {
    await gh(`/issues/${existing.number}`, { method: "PATCH", body: JSON.stringify({ body: i.body }) });
    console.log(`updated #${existing.number}: ${i.title}`);
  } else {
    const made = await gh(`/issues`, { method: "POST", body: JSON.stringify({ title: i.title, body: i.body }) });
    console.log(`opened #${made.number}: ${i.title}`);
  }
}
