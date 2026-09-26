// CODE-A DAILY CHECK-IN, ONE READ (#552). Reads only; SEC values and counts.
//   1. filing-job state for the watched filers (HMGET): last check and the
//      recorded lag (filled / notice, report date, accession);
//   2. their stored sets' newest annual and quarterly period ends, and the
//      set's own `ff` (filled from the filing) / `lg` (notice) stamps;
//   3. each A job's last run record: ok, when, Redis commands, and its cold /
//      queue counters, with runs/day from the job's cron.
//   relay task: write-code-a-checkin   Redis: 1 HMGET + 1 MGET + 1 MGET.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const STATE = keyOf("lib/server/secFilingJob.ts", "FILING_STATE_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const RUNS = keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX");
const watch = (process.env.SYMBOLS || "KO,DUK,V,F,TSM,CHT,JNJ").split(/[\s,]+/).filter(Boolean);
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");

const st = await redis.hmget(STATE, ...watch);
const sets = await redis.mget(...watch.map((s) => `${FACTS}:${s}`));
console.log("1-2. filing job and stored sets");
watch.forEach((s, i) => {
  const f = st?.[s] ?? null, set = sets[i];
  const y = set?.years?.map((p) => p.e).sort().at(-1) ?? "-", q = set?.quarters?.map((p) => p.e).sort().at(-1) ?? "-";
  const lag = f?.lag ? `${f.lag.kind} ${f.lag.reportDate} (${f.lag.accn})` : "none";
  const stamp = set?.ff ? `ff ${set.ff.reportDate}` : set?.lg ? `lg ${set.lg.reportDate}` : "-";
  console.log(`  ${s.padEnd(5)} checked ${iso(f?.c)} · lag ${lag} · set: newest FY ${y}, newest Q ${q}, stamp ${stamp}${set ? "" : " · NO STORED SET"}`);
});

const jobsSrc = fs.readFileSync("lib/server/jobRuns.ts", "utf8");
const jobs = [...jobsSrc.matchAll(/"((?:sec|capex)-[a-z0-9-]+)": \{ label: "[^"]*", instrumented: (?:true|false), cron: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
const perDay = (cron) => { const [min, hr] = cron.split(" "); const n = (f, max) => f === "*" ? max : f.includes("/") ? Math.ceil(max / Number(f.split("/")[1])) : f.split(",").length; return n(min, 60) * n(hr, 24); };
const runs = await redis.mget(...jobs.map(([j]) => `${RUNS}:${j}`));
console.log("\n3. A jobs' last runs");
jobs.forEach(([j, cron], i) => {
  const r = runs[i], sm = r?.summary ?? {};
  const cmds = typeof sm.redisCommands === "number" ? sm.redisCommands : null;
  const extra = Object.entries(sm).filter(([k, v]) => /^(cold|reverify|populate|rewindow|failed|written|deferred|factSetIndex|filled|notices?|checked)/i.test(k) && (typeof v === "number" || typeof v === "boolean")).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`  ${j.padEnd(26)} ${r ? (r.ok ? "ok " : "ERR") : "-- "} ${iso(r?.at)} · runs/day ${perDay(cron)} · redisCommands ${cmds ?? "-"}${cmds != null ? ` (≈${cmds * perDay(cron)}/day if every run is alike)` : ""}${extra ? ` · ${extra}` : ""}`);
});
console.log("\nRedis commands: 3");
