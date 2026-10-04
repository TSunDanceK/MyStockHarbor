// FMP CALLS PER DAY, PER ENDPOINT — the key-pull table (#552 COWORK #145).
//
// Reads the byte meter lib/server/fmpUsage.ts writes (msh:fmp-bytes:v1:<YYYYMMDD>,
// one HASH per UTC day, fields <endpoint>:calls|wire|decoded|wireExact) for the
// last DAYS days (default 14) and prints calls and wire bytes per endpoint per
// day, plus a per-day mean over the days that have data. READ-ONLY: one
// HGETALL per day, nothing written. No key, URL or credential is printed.
//
//   relay task: write-fmp-bytes-read (READ-ONLY despite the prefix: the
//   credentials live in that job)
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const DAYS = Math.max(1, Math.min(31, Number(process.env.DAYS) || 14));
const dayKey = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

const days = [];
for (let i = 0; i < DAYS; i++) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - i);
  days.push(dayKey(d));
}
const p = redis.pipeline();
days.forEach((k) => p.hgetall(`msh:fmp-bytes:v1:${k}`));
const hashes = await p.exec();

const per = new Map(); // endpoint -> Map(day -> {calls, wire})
let withData = 0;
hashes.forEach((h, i) => {
  if (!h || !Object.keys(h).length) return;
  withData++;
  for (const [field, raw] of Object.entries(h)) {
    const at = field.lastIndexOf(":");
    if (at <= 0) continue;
    const ep = field.slice(0, at), metric = field.slice(at + 1);
    if (metric !== "calls" && metric !== "wire") continue;
    const m = per.get(ep) ?? new Map();
    const cell = m.get(days[i]) ?? { calls: 0, wire: 0 };
    cell[metric] += Number(raw) || 0;
    m.set(days[i], cell);
    per.set(ep, m);
  }
});

console.log(`days read ${DAYS} (${days.at(-1)}..${days[0]}), with data ${withData}, commands ${DAYS}`);
const rows = [...per.entries()].map(([ep, m]) => {
  const calls = [...m.values()].reduce((s, c) => s + c.calls, 0);
  const wire = [...m.values()].reduce((s, c) => s + c.wire, 0);
  return { ep, calls, wire, daysSeen: m.size, m };
}).sort((a, b) => b.calls - a.calls);
console.log("\nendpoint | calls (window) | calls/day (over days with data) | days seen | wire MB | newest day | newest-day calls");
for (const r of rows) {
  const newest = days.find((d) => r.m.has(d));
  console.log(`${r.ep} | ${r.calls} | ${(r.calls / Math.max(1, withData)).toFixed(1)} | ${r.daysSeen} | ${(r.wire / 1e6).toFixed(2)} | ${newest} | ${r.m.get(newest).calls}`);
}
console.log("\nper day (calls):");
for (const d of days) {
  const parts = rows.filter((r) => r.m.has(d)).map((r) => `${r.ep}=${r.m.get(d).calls}`);
  console.log(`${d}: ${parts.length ? parts.join(", ") : "(no data)"}`);
}
