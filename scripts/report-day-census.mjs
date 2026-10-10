// COWORK #199/#200 item 1, READ-ONLY CENSUS: how many current estimated report
// DAYS fall on a weekend or an NYSE holiday.
//   1. the calendar/dashboard "expected" rows, built by the shipped
//      getCalendarForwardSections (estimated day = today + daysAway);
//   2. every stored report-date record's `next` estimate of kind "date"
//      (the earnings page's next-report input), from today on.
// For each hit: the filer's 8-K 2.02 weekday habit, so the proposed rule's
// destination can be read off. Store: GET / SCAN / MGET only. No SEC requests.
import { register } from "node:module";
import { Redis } from "@upstash/redis";
register("./lib/tsx-render-hooks.mjs", import.meta.url); // stubs next/* (dueInputs reaches pickersBuilder)
const READS = new Set(["get", "scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};
const { getCalendarForwardSections } = await import("../lib/server/dueInputs.ts");
const { easternDate } = await import("../lib/server/calendarDayState.ts");
const { addDays } = await import("../lib/server/earningsWeek.ts");
const { SEC_REPORT_DATES_PREFIX } = await import("../lib/server/secReportDatesStore.ts");
const { isUsTradingDay, isUsMarketHoliday } = await import("../lib/usMarketCalendar.ts");

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
const why = (d) => (isUsMarketHoliday(d) ? "holiday" : "weekend");
const habit = (events) => {
  const h = {};
  for (const e of (events ?? []).filter((e) => e.basis === "8-K item 2.02").slice(0, 8)) h[wd(e.announcedOn)] = (h[wd(e.announcedOn)] ?? 0) + 1;
  return Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" ") || "no 8-K 2.02";
};
const redis = Redis.fromEnv();
const today = easternDate(new Date());
console.log(`today (ET): ${today}`);

// ── 1. expected rows (dashboard card + calendar "Coming up") ──────────────
const fwd = await getCalendarForwardSections(today);
const recOf = new Map();
if (fwd.expected.kind === "listed") {
  const rows = fwd.expected.rows.map((r) => ({ ...r, on: addDays(today, r.daysAway) }));
  const off = rows.filter((r) => !isUsTradingDay(r.on));
  console.log(`\n1. expected rows: ${rows.length} · on a weekend or holiday: ${off.length} (${rows.length ? Math.round((100 * off.length) / rows.length) : 0}%)`);
  const byDay = {};
  for (const r of off) (byDay[`${wd(r.on)} ${r.on} (${why(r.on)})`] ??= []).push(r.symbol);
  for (const [k, v] of Object.entries(byDay).sort()) console.log(`   ${k}: ${v.length} · ${v.join(" ")}`);
  const keys = off.map((r) => `${SEC_REPORT_DATES_PREFIX}:${r.symbol}`);
  for (let i = 0; i < keys.length; i += 50) {
    const raw = await redis.mget(...keys.slice(i, i + 50));
    raw.forEach((rec, j) => recOf.set(off[i + j].symbol, rec));
  }
  for (const s of ["NFLX", "GOOGL", ...off.map((r) => r.symbol).filter((x) => x !== "NFLX" && x !== "GOOGL").slice(0, 12)]) {
    const r = rows.find((x) => x.symbol === s);
    if (!r) { console.log(`   ${s}: not in the expected rows today`); continue; }
    console.log(`   ${s}: ${wd(r.on)} ${r.on} = period end ${r.periodEnd} + median lag ${r.medianLagDays}d · band ${r.band} · 2.02 weekdays ${habit(recOf.get(s)?.events)}`);
  }
} else console.log(`\n1. expected rows: ${fwd.expected.kind}`);

// ── 2. every stored record's `next` date ─────────────────────────────────
const keys = [];
let cursor = "0";
do { const [n, b] = await redis.scan(cursor, { match: `${SEC_REPORT_DATES_PREFIX}:*`, count: 1000 }); cursor = String(n); keys.push(...b); } while (cursor !== "0");
let dated = 0, upcoming = 0; const offNext = [];
for (let i = 0; i < keys.length; i += 50) {
  const raw = await redis.mget(...keys.slice(i, i + 50));
  raw.forEach((rec, j) => {
    const n = rec?.next;
    if (n?.kind !== "date") return;
    dated++;
    if (n.date < today) return;
    upcoming++;
    if (!isUsTradingDay(n.date)) offNext.push({ s: keys[i + j].slice(SEC_REPORT_DATES_PREFIX.length + 1), d: n.date, clamped: n.clamped, est: n.estimator, h: habit(rec.events) });
  });
}
console.log(`\n2. stored records: ${keys.length} · next of kind "date": ${dated} · from today on: ${upcoming} · on a weekend or holiday: ${offNext.length} (${upcoming ? Math.round((100 * offNext.length) / upcoming) : 0}%)`);
const byE = {}; for (const o of offNext) byE[o.est] = (byE[o.est] ?? 0) + 1;
console.log(`   by estimator: ${JSON.stringify(byE)} · clamped to the deadline: ${offNext.filter((o) => o.clamped).length} · holidays: ${offNext.filter((o) => isUsMarketHoliday(o.d)).length}`);
for (const o of offNext.slice(0, 30)) console.log(`   ${o.s}: ${wd(o.d)} ${o.d} (${why(o.d)}${o.clamped ? ", clamped" : ""}, estimator ${o.est}) · 2.02 weekdays ${o.h}`);
console.log(`\nStore commands: ${JSON.stringify(counts)} · No writes were performed.`);
