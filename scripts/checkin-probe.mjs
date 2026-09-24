// The 05:00 check-in for #535 in one read-only pass: job-run summaries for the
// SEC jobs, the filing job's state for named filers, the cold-fill counters,
// and the picker build attribution. GET / HGETALL / SCAN only.
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
const days = ["2026-09-23", "2026-09-24"];
const show = (o) => JSON.stringify(o);

let cursor = 0; const runKeys = [];
do { const [n, b] = await redis.scan(cursor, { match: "msh:job-run:v1:*", count: 1000 }); runKeys.push(...b); cursor = n; } while (String(cursor) !== "0");
for (const k of runKeys.filter((k) => /sec|filing|report/.test(k)).sort()) {
  const r = await redis.get(k);
  console.log(`JOB ${k.split(":").pop()} at ${r?.at ? new Date(r.at).toISOString() : "?"} ok=${r?.ok} ${show(r?.summary).slice(0, 1800)}`);
}

const state = (await redis.hgetall("msh:sec:filing-state:v1")) ?? {};
const lags = Object.entries(state).filter(([, v]) => v?.lag);
console.log(`\nFILING STATE entries ${Object.keys(state).length}; with a lag ${lags.length}: ${lags.map(([s, v]) => `${s}:${v.lag.kind}:${v.lag.reportDate}`).join(" ")}`);
console.log(`catch-up flag ${show(await redis.get("msh:sec:filing-catchup:v1"))}; due list ${show(await redis.get("msh:sec:filing-due:v1")).slice(0, 300)}`);
for (const s of ["KO", "DUK", "V", "F", "TSM", "GFI", "GIB", "HMC", "INFY", "KB", "KEP", "KOF", "LPL", "MMYT", "NGG", "SHG", "SQM", "TM", "UMC", "WF", "WIT"]) {
  const v = state[s];
  const set = await redis.get(`msh:sec:facts:v1:${s}`);
  console.log(`  ${s}: ${v ? `checked ${new Date(v.c).toISOString().slice(0, 16)} lag ${show(v.lag ?? null)}` : "no filing-state"} · set newest Y ${set?.years?.[0]?.e ?? "-"} Q ${set?.quarters?.[0]?.e ?? "-"} ff ${show(set?.ff ?? null)} lg ${show(set?.lg ?? null)}`);
}

for (const d of days) {
  const [a, f, o] = await Promise.all([redis.get(`msh:sec:cold-fill-attempt:v1:${d}`), redis.get(`msh:sec:cold-fill-day:v1:${d}`), redis.hgetall(`msh:sec:cold-fill-outcome:v1:${d}`)]);
  console.log(`\nCOLD FILL ${d}: attempts ${a ?? 0}; fills ${f ?? 0}; outcomes ${show(o ?? {})}`);
}
for (const d of days) {
  const t = (await redis.hgetall(`msh:pickers-build-triggers:v1:${d}`)) ?? {};
  const total = Object.values(t).reduce((x, y) => x + Number(y), 0);
  console.log(`\nPICKER BUILDS ${d}: ${total} — ${Object.entries(t).sort((x, y) => Number(y[1]) - Number(x[1])).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}
console.log(`\nresults-days index size ${await redis.hlen("msh:sec:results-days:v1")}`);
