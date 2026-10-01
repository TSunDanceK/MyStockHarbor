// THE DAILY INCREMENTAL ARCHIVE (#552 COWORK #65/#70, PR 2 of the archive).
//
// Keeps Layer 1 current without re-reading the universe: EDGAR's daily form
// index (one request a day) names every filing. For each registrant CIK that
// filed:
//   - a FINANCIAL form (10-K, 10-Q, 20-F, 40-F, 10-KT, 6-K, and amendments):
//     companyfacts and submissions are re-archived;
//   - any other form: submissions only (the filing list changed, the facts
//     did not).
// A universe CIK with no index entry yet (the universe grew) is archived in
// full. Unchanged content is not re-put (archiveOne's content hash).
//
// Same fair-access rules as the backfill: one runner (≤4 requests/s here; see the clock guard), and SEC
// 429/403 STOPS the run with the index saved. `lastDaily` only advances past
// days whose every filer was processed, so a stopped run re-reads those days
// next time (a re-read of unchanged content writes nothing).
//
// PUBLIC LOGS: counts only.
import { secFetcher, archiveOne, SecThrottled } from "./secArchiveBackfill.mjs";
import { sha256, ARCHIVE_VERSION } from "./secArchive.mjs";

export const FACT_FORMS = /^(10-K|10-Q|20-F|40-F|10-KT|6-K)(\/A)?$/;

// ── THE CLOCK GUARD (#552 CODE-A #86) ─────────────────────────────────────
// The job was scheduled at 03:05 UTC because nothing else reads SEC then. But
// GitHub starts this repo's scheduled workflows HOURS late (06:30/06:45/07:40
// crons started at 12:51/13:01/14:13 on 30 Sep), so the start time is not a
// guarantee. This job and the app's SEC jobs (≤5/s) together must stay under
// SEC's 10/s, so the job:
//   - paces at ≤4 requests/s (INCREMENTAL_GAP_MS), not the backfill's 8;
//   - refuses to START inside an SEC job window, and STOPS (index saved,
//     lastDaily only past finished days) if it reaches one mid-run.
// The windows (UTC), with margin around each job:
//   03:55–06:50  sec-daily-index 04:00, sec-facts 04:20, sec-filings 04:40,
//                report-dates 05:10, capex 05:50–06:30
//   16:15–16:50  sec-facts 16:20, sec-filings 16:40
//   in reporting season, every even hour :38–:48  (sec-filings)
export const INCREMENTAL_GAP_MS = 250;
/** Mirrors lib/server/secFilingJob.ts REPORTING_SEASONS (check-sec-archive asserts they match). */
export const REPORTING_SEASONS = [["01-20", "02-28"], ["04-15", "05-15"], ["07-15", "08-14"], ["10-15", "11-14"]];
export function inSecJobWindow(ms) {
  const d = new Date(ms);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins >= 3 * 60 + 55 && mins < 6 * 60 + 50) return true;
  if (mins >= 16 * 60 + 15 && mins < 16 * 60 + 50) return true;
  const md = d.toISOString().slice(5, 10);
  const season = REPORTING_SEASONS.some(([a, b]) => md >= a && md <= b);
  return season && d.getUTCHours() % 2 === 0 && d.getUTCMinutes() >= 38 && d.getUTCMinutes() < 48;
}
export const MAX_DAYS_PER_RUN = 10;
export const NEW_CIKS_PER_RUN = 100;

/** EDGAR form.idx → [{ form, cik (10 digits), date }]; header lines skipped. */
export function parseFormIndex(text) {
  const out = [];
  for (const l of String(text ?? "").split("\n")) {
    const m = /^(\S+(?: \S+)*?)\s{2,}.+?\s{2,}(\d{1,10})\s{2,}(\d{4}-?\d{2}-?\d{2})\s+\S+/.exec(l);
    if (m) out.push({ form: m[1], cik: m[2].padStart(10, "0"), date: m[3].replace(/-/g, "") });
  }
  return out;
}

/** Business days after `lastDaily` (YYYY-MM-DD) through the day before `todayIso`, oldest first. */
export function pendingDays(lastDaily, todayIso) {
  const days = [];
  const end = new Date(`${todayIso}T00:00:00Z`);
  for (let d = new Date(`${lastDaily}T00:00:00Z`); ;) {
    d = new Date(d.getTime() + 86_400_000);
    if (d >= end) break;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export const formIndexUrl = (day) => {
  const [y, m] = day.split("-").map(Number);
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${Math.floor((m - 1) / 3) + 1}/form.${day.replace(/-/g, "")}.idx`;
};

/** From one day's index rows: universe CIK → true when it filed a financial form that day. */
export function changedCiks(rows, universeSet) {
  const out = new Map();
  for (const r of rows) {
    if (!universeSet.has(r.cik)) continue;
    out.set(r.cik, Boolean(out.get(r.cik)) || FACT_FORMS.test(r.form.trim().toUpperCase()));
  }
  return out;
}

export async function runIncremental({ universe, r2, fetchImpl, sleep, now, log, userAgent, todayIso, maxDays = MAX_DAYS_PER_RUN, newPerRun = NEW_CIKS_PER_RUN, budgetMs = 30 * 60 * 1000, blockedAt = inSecJobWindow }) {
  const started = now();
  // NOT EVEN THE INDEX IS READ inside a window: a start there is a late
  // schedule, and the next run picks the days up (lastDaily is untouched).
  if (blockedAt(started)) {
    log(`skipped: started ${new Date(started).toISOString().slice(11, 16)} UTC, inside an SEC job window · lastDaily unchanged`);
    return { status: "window", T: { days: 0, secRequests: 0, puts: 0, failed: 0, filers: 0 } };
  }
  const T = { days: 0, holidays: 0, filers: 0, factsRefreshed: 0, subsOnly: 0, newCiks: 0, unchanged: 0, noFacts: 0, failed: 0, secRequests: 0, puts: 0, factRows: 0, factBytes: 0, subBytes: 0 };
  const prior = await r2.get("index.json");
  if (!prior) { log("stopped: no archive index · run the backfill first"); return { status: "no-archive", T }; }
  const index = JSON.parse(prior.toString("utf8"));
  index.v ??= ARCHIVE_VERSION;
  // First incremental after the backfill: re-read from the backfill's own day.
  const lastDaily = index.lastDaily ?? new Date(new Date(index.updatedAt).getTime() - 86_400_000).toISOString().slice(0, 10);
  const all = pendingDays(lastDaily, todayIso);
  const days = all.slice(0, maxDays);
  const universeSet = new Set(universe);
  const sec = secFetcher({ fetchImpl, sleep, now, userAgent, counters: T, gapMs: INCREMENTAL_GAP_MS });
  const putIfChanged = async (key, body, type, prevSha) => {
    const h = sha256(body);
    if (h !== prevSha) { await r2.put(key, body, type); T.puts++; }
    return h;
  };
  const saveIndex = async () => {
    index.updatedAt = new Date(now()).toISOString();
    await r2.put("index.json", Buffer.from(JSON.stringify(index)), "application/json");
    T.puts++;
  };
  log(`index ${Object.keys(index.entries).length}/${universe.length} · last daily ${lastDaily} · days pending ${all.length} · this run ${days.length}`);
  let status = "complete";
  const doCik = async (cik, facts) => {
    const prev = index.entries[cik] ?? {};
    const isNew = !index.entries[cik];
    const entry = await archiveOne({ cik, prev, sec, r2, T, now, putIfChanged, facts: facts || isNew, subs: true, reusePages: !isNew });
    if (entry.factsSha === prev.factsSha && entry.subSha === prev.subSha) T.unchanged++;
    index.entries[cik] = entry;
  };
  outer: for (const day of days) {
    if (now() - started > budgetMs) { status = "budget"; break; }
    if (blockedAt(now())) { status = "window"; break; }
    let text;
    try {
      const buf = await sec(formIndexUrl(day));
      if (!buf) { T.holidays++; T.days++; index.lastDaily = day; continue; }
      text = buf.toString("utf8");
    } catch (e) {
      if (e instanceof SecThrottled) { status = "throttled"; break; }
      T.failed++; log(`failed: daily index · ${String(e?.message ?? e).slice(0, 40)}`); break;
    }
    const changed = changedCiks(parseFormIndex(text), universeSet);
    for (const [cik, facts] of changed) {
      if (now() - started > budgetMs) { status = "budget"; break outer; }
      if (blockedAt(now())) { status = "window"; break outer; }
      try {
        await doCik(cik, facts);
        T.filers++; if (facts) T.factsRefreshed++; else T.subsOnly++;
      } catch (e) {
        if (e instanceof SecThrottled) { status = "throttled"; break outer; }
        T.failed++; log(`failed: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 60)}`);
      }
    }
    // Every filer of this day was processed: the day is done.
    T.days++; index.lastDaily = day;
  }
  // THE UNIVERSE GREW: CIKs with no entry yet, archived in full (capped).
  if (status === "complete") {
    for (const cik of universe.filter((c) => !index.entries[c]).slice(0, newPerRun)) {
      if (now() - started > budgetMs) { status = "budget"; break; }
      if (blockedAt(now())) { status = "window"; break; }
      try { await doCik(cik, true); T.newCiks++; } catch (e) {
        if (e instanceof SecThrottled) { status = "throttled"; break; }
        T.failed++; log(`failed: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 60)}`);
      }
    }
  }
  await saveIndex();
  if (status === "throttled") log("stopped: SEC throttled (429/403) · index saved · the next run resumes");
  if (status === "budget") log("stopped: budget reached · index saved · the next run resumes");
  if (status === "window") log("stopped: reached an SEC job window · index saved · the next run resumes");
  const mb = (b) => (b / 1e6).toFixed(1);
  log(`days ${T.days} (holidays ${T.holidays}) · filers ${T.filers} (facts ${T.factsRefreshed}, submissions only ${T.subsOnly}) · new CIKs ${T.newCiks} · unchanged ${T.unchanged} · no companyfacts ${T.noFacts} · failed ${T.failed} · SEC requests ${T.secRequests} · R2 puts ${T.puts} · facts ${mb(T.factBytes)} MB · submissions ${mb(T.subBytes)} MB · last daily ${index.lastDaily ?? "-"} · ${Math.round((now() - started) / 1000)}s`);
  return { status, T, index };
}
