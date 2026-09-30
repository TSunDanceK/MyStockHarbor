// The usage alert's pure core (#553 COWORK #51 item 3 / #53; #535 COWORK #17 Part 3).
// No I/O here: scripts/usage-alert.mjs reads the counters and writes the issue.

export const SPIKE_RATIO = 2; // yesterday > 2x the trailing 7-day median
export const MIN_HISTORY_DAYS = 3; // fewer days than this is not a median worth alerting on
export const MIN_ALERT_COMMANDS = 1_000; // below this a "spike" is noise, not money
export const USD_PER_100K = 0.2; // Upstash pay-as-you-go, per 100K commands

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** The UTC day `offset` days before `iso` (YYYY-MM-DD). */
export function dayBefore(iso, offset) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Split one day's counter hash (msh:jobs:commands:v1:<day>) into per-job
 * command totals and the jobs whose circuit breaker tripped that day.
 */
export function parseDay(hash) {
  const commands = {};
  const tripped = [];
  for (const [field, value] of Object.entries(hash ?? {})) {
    if (field.endsWith(":tripped")) tripped.push(field.slice(0, -":tripped".length));
    else {
      const n = Number(value);
      if (Number.isFinite(n)) commands[field] = n;
    }
  }
  return { commands, tripped };
}

/**
 * `days`: newest first; days[0] is YESTERDAY, days[1..7] the trailing week.
 * Returns every job's row and whether an alert is due.
 */
export function evaluate(days) {
  const [yesterday, ...history] = days;
  const jobs = new Set([...Object.keys(yesterday.commands), ...history.flatMap((d) => Object.keys(d.commands))]);
  const rows = [];
  for (const job of [...jobs].sort()) {
    const y = yesterday.commands[job] ?? 0;
    const past = history.map((d) => d.commands[job]).filter((x) => Number.isFinite(x));
    const med = past.length >= MIN_HISTORY_DAYS ? median(past) : null;
    const ratio = med && med > 0 ? y / med : null;
    const spike = ratio !== null && ratio > SPIKE_RATIO && y >= MIN_ALERT_COMMANDS;
    rows.push({ job, yesterday: y, median: med, ratio, spike, tripped: yesterday.tripped.includes(job), monthlyUsd: (y * 30 * USD_PER_100K) / 100_000 });
  }
  rows.sort((a, b) => b.yesterday - a.yesterday);
  const due = rows.some((r) => r.spike || r.tripped);
  return { rows, due };
}

const fmt = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
const usd = (n) => `$${n.toFixed(2)}`;

/** The spike issue. Plain text: no links, no hosts, no credentials (public repo). */
export function spikeIssue(date, { rows }) {
  const top = rows.filter((r) => r.spike || r.tripped).map((r) => r.job);
  const title = `⚠ Usage spike: ${date} — ${top.slice(0, 3).join(", ")}`;
  const lines = [
    `Redis commands on ${date} (UTC), from the job guard's per-job counters, against each job's median over the 7 days before.`,
    "",
    "| Job | Commands | 7-day median | × median | Breaker | Projected monthly |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.job}${r.spike ? " ⚠" : ""} | ${fmt(r.yesterday)} | ${fmt(r.median)} | ${r.ratio === null ? "—" : r.ratio.toFixed(1)} | ${r.tripped ? "TRIPPED" : "ok"} | ${usd(r.monthlyUsd)} |`),
    "",
    `A job is flagged above ${SPIKE_RATIO}× its median (and ${MIN_ALERT_COMMANDS.toLocaleString("en-US")}+ commands), or when its daily circuit breaker tripped (the rest of that day's runs were skipped).`,
    "To stop a job without a deploy, set it to false in the Edge Config `jobs` item.",
    "",
    "_Opened by the usage alert (Relay B). Counters cover the guarded jobs only._",
  ];
  return { title, body: lines.join("\n") };
}

/** The weekly per-job cost report (counters mode). */
export function weeklyReport(date, days) {
  const jobs = new Set(days.flatMap((d) => Object.keys(d.commands)));
  const rows = [...jobs].map((job) => {
    const vals = days.map((d) => d.commands[job] ?? 0);
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, days.length);
    return { job, avg, monthlyUsd: (avg * 30 * USD_PER_100K) / 100_000 };
  }).sort((a, b) => b.avg - a.avg);
  const total = rows.reduce((a, r) => a + r.monthlyUsd, 0);
  const lines = [
    `Average Redis commands per day over the ${days.length} days to ${date} (UTC), per guarded job, and the projected monthly cost at $${USD_PER_100K} per 100K commands.`,
    "",
    "| Job | Commands/day | Projected monthly |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.job} | ${fmt(r.avg)} | ${usd(r.monthlyUsd)} |`),
    `| **Total (guarded jobs)** | ${fmt(rows.reduce((a, r) => a + r.avg, 0))} | **${usd(total)}** |`,
    "",
    "_Written weekly by the usage alert (Relay B). It covers the guarded jobs only; whole-database figures need the management secrets._",
  ];
  return { title: "Weekly job cost report", body: lines.join("\n") };
}

/** Management mode only when BOTH secrets and the database id are present. */
export function managementMode(env) {
  return Boolean(env.UPSTASH_MGMT_EMAIL && env.UPSTASH_MGMT_API_KEY && env.UPSTASH_DATABASE_ID);
}
