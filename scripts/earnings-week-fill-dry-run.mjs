// DRY RUN (/earnings-calendar "Results filed"): per strip day, rows filled in
// the store now, and rows filled once the hourly job has run (this branch's
// figuresForRow on every row not filled now, nothing written). Also: rows
// whose EPS fills from the derived Q4 EPS, "Shares since" rows that read 0.0%
// on the filing-day bar, and the live trap-block keys (counts and when set,
// no IP addresses).   relay task: write-earnings-week-fill-dry-run. Reads only.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const { weekDays, sharesSince } = await import("../lib/server/earningsWeek.ts");
const { easternDate } = await import("../lib/server/calendarDayState.ts");
const { stripDaySymbols } = await import("../lib/server/earningsWeekStrip.ts");
const { figuresForRow } = await import("../lib/server/earningsWeekStore.ts");
const { readTiingoEodLast } = await import("../lib/server/marketData/read.ts");
const { toDashed } = await import("../lib/symbolSpellings.mjs");

const redis = Redis.fromEnv();
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v) ?? {};
const today = easternDate(new Date());
const days = weekDays(today);
const strip = await stripDaySymbols(days);
const last = await readTiingoEodLast().catch(() => ({}));
const WATCH = ["MSFT", "GOOGL", "NOW", "PSX", "PLTR", "AAPL"];
console.log(`today ${today}`);
const t0 = Date.now();
for (const date of days) {
  const rows = strip.get(date) ?? [];
  if (!rows.length) { console.log(`${date}: 0 rows`); continue; }
  const figs = parse(await redis.get(`msh:earnings-week:figures:v1:${date}`));
  const closes = parse(await redis.get(`msh:tiingo:earnings-week:close-before:v1:${date}`));
  let before = 0, after = 0, epsBefore = 0, epsAfter = 0, zeroBefore = 0, dashAfter = 0;
  const notes = [];
  for (const { symbol, source } of rows) {
    const e = figs[symbol];
    const had = Boolean(e?.f);
    if (had) { before++; if (e.f.epsDiluted !== null) epsBefore++; }
    const now = await figuresForRow(source, date);
    const got = now.figures ?? (had ? e.f : null);
    if (got) { after++; if (got.epsDiluted !== null) epsAfter++; }
    if (WATCH.includes(symbol)) notes.push(`${symbol}: before ${had ? `rev ${e.f.revenue} eps ${e.f.epsDiluted}` : "blank"}; after ${got ? `rev ${got.revenue} eps ${got.epsDiluted} (period ${got.periodEnd})` : "blank"}`);
    const c = closes[symbol], l = last[toDashed(symbol)];
    if (c?.d && l) {
      const oldRule = l.d < c.d ? null : ((l.c - c.c) / c.c) * 100;
      if (oldRule === 0 && l.d === c.d) zeroBefore++;
      if (l.d === c.d && sharesSince({ date: c.d, close: c.c }, { date: l.d, close: l.c }) === null) dashAfter++;
    }
  }
  console.log(`${date}: rows ${rows.length}; filled before ${before}, after ${after}; with EPS before ${epsBefore}, after ${epsAfter}; "Shares since" 0.0% on the filing-day bar ${zeroBefore} → "—" ${dashAfter}`);
  for (const n of notes) console.log(`  ${n}`);
}
console.log(`dry run read ${[...strip.values()].reduce((n, l) => n + l.length, 0)} rows in ${Date.now() - t0} ms`);

// TRAP BLOCKS (middleware.ts → "Access denied" on every path): counts and set times only.
const DAYS = Number(process.env.TRAP_BLOCK_DAYS) || 2;
for (const prefix of ["msh:trap-block:ip:v1:", "msh:trap-block:ja4:v1:"]) {
  let cursor = "0"; const rows = [];
  do {
    const [next, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 500 });
    cursor = String(next);
    for (const k of keys) {
      const ttl = await redis.ttl(k);
      const setAt = ttl > 0 ? new Date(Date.now() - (DAYS * 86400 - ttl) * 1000).toISOString().slice(0, 16) : `ttl ${ttl}`;
      rows.push(prefix.includes("ja4") ? `${setAt} ${k.slice(prefix.length)}` : setAt);
    }
  } while (cursor !== "0");
  rows.sort();
  console.log(`\n${prefix.includes("ja4") ? "JA4" : "IP"} trap blocks live: ${rows.length} (set time assumes the ${DAYS}-day default)`);
  for (const r of rows.slice(-40)) console.log(`  ${r}`);
}
