// READ-ONLY PROBE (/earnings-calendar "Results filed" blanks): for each strip
// day, every row's stored figures entry, and for an empty one, why it is empty
// now: no event for the day, an event with no period, an event on a period the
// stored set has not reached, or one that would match today.
//   relay task: write-earnings-week-fill-probe   Reads only.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const { weekDays } = await import("../lib/server/earningsWeek.ts");
const { easternDate } = await import("../lib/server/calendarDayState.ts");
const { getDayCandidates } = await import("../lib/server/earningsCalendar.ts");
const { readReportDates } = await import("../lib/server/secReportDatesStore.ts");
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { buildSecEarningsView } = await import("../lib/server/secEarningsView.ts");

const redis = Redis.fromEnv();
const today = easternDate(new Date());
const days = weekDays(today);
const WATCH = new Set(["MSFT", "GOOGL", "NOW", "PSX", "PLTR", "AAPL"]);
console.log(`today ${today}; days ${days.join(" ")}`);
for (const date of days) {
  const cands = await getDayCandidates(date);
  const raw = await redis.get(`msh:earnings-week:figures:v1:${date}`);
  const figs = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? {};
  const tally = { rows: cands.length, filled: 0, nullEntry: 0, noEntry: 0 };
  const why = {};
  const samples = [];
  for (const c of cands) {
    const e = figs[c.symbol];
    if (e?.f) { tally.filled++; continue; }
    if (!e) tally.noEntry++; else tally.nullEntry++;
    const rec = await readReportDates(c.symbol).catch(() => null);
    const ev = rec?.events.find((x) => x.announcedOn === date) ?? null;
    const set = await readFactSet(c.symbol, "earnings-week-probe").catch(() => null);
    const v = set ? buildSecEarningsView(set) : null;
    const latest = v?.latestEnd ?? null;
    const k = !rec ? "no record" : !ev ? "no event on this day" : !ev.periodEnd ? "event, no period"
      : !latest ? "no stored set" : ev.periodEnd === latest ? "would match now" : ev.periodEnd > latest ? "set behind event" : "event period older than set";
    why[k] = (why[k] ?? 0) + 1;
    const ageH = e ? ((Date.now() - e.at) / 3.6e6).toFixed(1) : "-";
    if (samples.length < 6 || WATCH.has(c.symbol)) samples.push(`${c.symbol}: ${k}; event ${ev ? `${ev.announcedOn} period ${ev.periodEnd}` : "-"}; set latest ${latest}; record at ${rec?.at ?? "-"}; entry age ${ageH}h`);
  }
  console.log(`\n${date}: ${JSON.stringify(tally)} why-empty ${JSON.stringify(why)}`);
  for (const s of samples) console.log(`  ${s}`);
}
