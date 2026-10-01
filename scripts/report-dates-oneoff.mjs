// ONE-OFF PRODUCTION WRITE, ON THE OWNER'S GO (#552 CODE-A #83, 1 Oct):
// rebuild the report-dates records of XOM and JPM now, instead of waiting for
// their Q3 results 8-Ks, so #668's fixes can be confirmed before the purge.
//
// THE SAME BUILDER AS THE CRONS (buildReportDatesRecord, pure) and the same
// predecessor merge (withPredecessorSubmissions); the record goes to the same
// key (reportDatesKey) and the results-days mirror to the same hash
// (SEC_RESULTS_DAYS_KEY / resultsDaysOf) that writeReportDates and
// recordResultsDays write. Written directly, NOT by faking VERCEL_ENV past
// the production gate: this runner is not the production deployment, and the
// owner's GO is the authority for this one write.
//
// Only symbols on ALLOW are accepted. SEC: 1 request each (2 for a cited
// successor), 1 s apart. Redis: per symbol 1 GET (set) + 1 SET + 1 HSET; plus
// 1 GET of the manifest for the CIK. The manifest is NOT written (the cron's
// next pass stamps reportDatesAt itself). Log: SEC dates and counts only.
//   relay task: write-report-dates-oneoff, symbols "XOM,JPM"
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const { buildReportDatesRecord, withPredecessorSubmissions } = await import("../lib/server/secReportDatesWrite.ts");
const { reportDatesKey } = await import("../lib/server/secReportDatesStore.ts");
const { SEC_RESULTS_DAYS_KEY, resultsDaysOf } = await import("../lib/server/secResultsDays.ts");
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { readManifest } = await import("../lib/server/secManifest.ts");

const ALLOW = new Set(["XOM", "JPM"]);
const syms = String(process.env.SYMBOLS ?? "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
const bad = syms.filter((s) => !ALLOW.has(s));
if (!syms.length || bad.length) { console.log(`refused: only ${[...ALLOW].join(", ")} are allowed (got ${syms.join(",") || "none"})`); process.exit(2); }

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; report-dates one-off)";
let secReq = 0, last = 0;
const fetchSubs = async (cik) => {
  const wait = 1000 - (Date.now() - last); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); secReq++;
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 429 || res.status === 403) { console.log(`stopped: SEC ${res.status}`); process.exit(3); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
const redis = Redis.fromEnv();
let cmds = 0;
const manifest = await readManifest(); cmds++;
const today = new Date().toISOString().slice(0, 10), now = new Date().toISOString();
for (const sym of syms) {
  const cik = manifest?.symbols?.[sym]?.cik;
  const set = await readFactSet(sym); cmds++;
  if (!cik || !set) { console.log(`${sym}: skipped (cik ${cik ? "ok" : "missing"}, set ${set ? "ok" : "missing"})`); continue; }
  const subs = await withPredecessorSubmissions(cik, await fetchSubs(cik), fetchSubs);
  const rec = buildReportDatesRecord(sym, cik, set, subs, today, now);
  await redis.set(reportDatesKey(sym), rec); cmds++;
  await redis.hset(SEC_RESULTS_DAYS_KEY, { [sym]: resultsDaysOf(rec).join(",") }); cmds++;
  const e = rec.events.slice(0, 2).map((x) => `${x.announcedOn}→${x.periodEnd}`).join(" ");
  console.log(`${sym}: written at ${now.slice(0, 16)} · events ${rec.events.length} [${e}] · nextPeriodEnd ${rec.nextPeriodEnd ?? "-"} · fye ${rec.fye ?? "-"} · feedShort ${rec.feedShort}`);
}
console.log(`SEC requests ${secReq} · Redis commands ${cmds}`);
