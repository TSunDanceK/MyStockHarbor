// THE NEXT-REPORT FIXES (#552 COWORK #78 items 1–3), held to fixtures shaped
// like the production cases the owner found on 30 Sep:
//   1. KO   "Last reported" named Q1 while the snapshot showed Q2, filled from
//           the 10-Q by the filing job. The record is rebuilt when a fill lands,
//           and once for a filled set whose record predates it.
//   2. XOM  "too few periods": the successor CIK's list starts at the
//           reorganization. The cited predecessor's filings are merged.
//      JPM  "too few periods": SEC's `recent` list holds ~1,000 filings, a year
//           of JPM's. The record says the feed was short, and the outlook names
//           that reason instead of blaming the filer.
//   3. WDFC a cold fill wrote figures but no report-dates record. The fill now
//           seeds it (bounded, best effort, only when none exists).
// Each fix has a mutation that must be caught.
//
//   node scripts/check-next-report-fixes.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const W = await import("../lib/server/secReportDatesWrite.ts");
const { latestResults } = await import("../lib/server/secReportDatesStore.ts");
const C = await import("../lib/server/secColdReportDates.ts");

const DAY = 86_400_000;
const plus = (iso, d) => new Date(Date.parse(iso) + d * DAY).toISOString().slice(0, 10);
const row = (form, reportDate, filed, items = "") => ({ form, reportDate, filed, items });
const subsOf = (rows, files) => ({
  category: "Large accelerated filer",
  filings: {
    recent: {
      accessionNumber: rows.map((_, i) => `0000000000-26-${String(i).padStart(6, "0")}`),
      form: rows.map((r) => r.form),
      items: rows.map((r) => r.items),
      reportDate: rows.map((r) => r.reportDate),
      filingDate: rows.map((r) => r.filed),
      acceptanceDateTime: rows.map((r) => `${r.filed}T11:00:00.000Z`),
    },
    ...(files ? { files } : {}),
  },
});
const setOf = (quarters, years, at = 0) => ({ at, quarters: quarters.map((e) => ({ e })), years: years.map((e) => ({ e })) });
/** A regular quarterly filer: results 8-K at +21/+35 (Q4), the 10-Q/10-K a day later. Newest first. */
const history = (ends) => {
  const rows = [];
  for (const p of [...ends].sort().reverse()) {
    const q4 = p.endsWith("12-31");
    rows.push(row("8-K", plus(p, q4 ? 35 : 21), plus(p, q4 ? 35 : 21), "2.02,9.01"));
    rows.push(row(q4 ? "10-K" : "10-Q", p, plus(p, q4 ? 36 : 22)));
  }
  return rows.sort((a, b) => (a.filed < b.filed ? 1 : -1));
};
const QS = (from, n) => {
  const out = []; let [y, i] = [Number(from.slice(0, 4)), ["03-31", "06-30", "09-30", "12-31"].indexOf(from.slice(5))];
  for (let k = 0; k < n; k++) { out.push(`${y}-${["03-31", "06-30", "09-30", "12-31"][i]}`); i++; if (i === 4) { i = 0; y++; } }
  return out;
};
const TODAY = "2026-09-30", NOW = `${TODAY}T05:00:00.000Z`;
const ALL = QS("2023-03-31", 14);                 // through 2026-06-30
const ENDS = ALL.filter((e) => !e.endsWith("12-31")), YEARS = ALL.filter((e) => e.endsWith("12-31"));

console.log("\n1. KO: a fill moves 'Last reported' with the snapshot");
{
  const subs = subsOf(history(ALL));
  const filled = setOf(ENDS, YEARS, Date.parse("2026-09-24T16:40:00Z"));
  // THE PRODUCTION SHAPE (probe, 30 Sep): written 2026-09-23 under the older
  // pairing, newest event Q1 (announced 04-28), beside a set whose newest is Q2.
  const stale = { at: "2026-09-23T04:23:00.000Z", events: [{ announcedOn: "2026-04-21", periodEnd: "2026-03-31", accession: "x", basis: "8-K 2.02" }] };
  const NOWMS = Date.parse("2026-09-30T04:40:00Z");
  check("a record that predates its set is rebuilt", W.reportDatesNeedRebuild(stale, filled, NOWMS));
  check("a record written AFTER the set but still naming an older quarter is rebuilt (once it is 20 h old)",
    W.reportDatesNeedRebuild({ ...stale, at: "2026-09-25T04:23:00.000Z" }, filled, NOWMS) &&
      !W.reportDatesNeedRebuild({ ...stale, at: "2026-09-30T00:00:00.000Z" }, filled, NOWMS));
  const fresh = W.buildReportDatesRecord("KO", "21344", filled, subs, TODAY, "2026-09-30T04:41:00.000Z");
  check("rebuilt, 'Last reported' is the quarter the snapshot shows", latestResults(fresh)?.periodEnd === "2026-06-30", latestResults(fresh)?.periodEnd);
  check("...and the rebuilt record is not rebuilt again", !W.reportDatesNeedRebuild(fresh, filled, NOWMS + 3 * 86_400_000));
  check("no record at all is rebuilt", W.reportDatesNeedRebuild(null, filled, NOWMS));
  // MUTATION: the lag test removed (only "older than the set" kept) → the
  // production KO record, if its set was built first, is never rebuilt.
  const WS = fs.readFileSync("lib/server/secReportDatesWrite.ts", "utf8");
  const WA = "  return newest !== null && (last === null || last < newest) && nowMs - at >= REBUILD_AFTER_MS;";
  if (WS.split(WA).length !== 2) throw new Error("rebuild mutation anchor must match once");
  const tmpw = `lib/server/.check-nrf-w-${process.pid}.ts`;
  fs.writeFileSync(tmpw, WS.replace(WA, "  return false;"));
  let MW;
  try { MW = await import(`../${tmpw}`); } finally { fs.rmSync(tmpw, { force: true }); }
  check("MUTATION: the 'older quarter' test removed → KO's record (written after its set) stays stale (caught)",
    !MW.reportDatesNeedRebuild({ ...stale, at: "2026-09-25T04:23:00.000Z" }, filled, NOWMS));
  const R = readCodeOnly("app/api/jobs/sec-filings/route.ts");
  const J = readCodeOnly("lib/server/secFilingJob.ts");
  check("the filing job hands back the submissions it read (no extra request)",
    /sicChange, subs \};/.test(J));
  check("the route rebuilds the record right after writing a filled set",
    /if \(!\(await writeFactSet\(out\.set\)\)\) throw new Error\("fact-set write failed"\);\s*await refreshDates\(symbol, cik, out\.set, out\.subs\);/.test(R));
  check("...and, on nightly runs only, for a filled set whose record lags it",
    /if \(stored\.ff && \(mode === "nightly" \|\| mode === "catch-up"\)\)[\s\S]{0,200}reportDatesNeedRebuild\(read\.rec, stored, Date\.now\(\)\)\) await refreshDates\(/.test(R));
  check("...through the one builder, with a cited successor's predecessor merged",
    /withPredecessorSubmissions\(cik, subs, fetchers\.submissions\)/.test(R) && /buildAndWriteReportDates\(symbol, cik, set, all, today\)/.test(R));
}

console.log("\n2. XOM: the cited predecessor's filings give the successor its cadence");
{
  const set = setOf(ENDS, YEARS);
  const own = subsOf(history(["2026-06-30"]));                   // one 8-K since the reorganization
  const pred = subsOf(history(ALL.slice(0, -1)));                // the history, under the old CIK
  const alone = W.buildReportDatesRecord("XOM", "2115436", set, own, TODAY, NOW);
  const merged = W.buildReportDatesRecord("XOM", "2115436", set, W.mergeSubmissions(own, pred), TODAY, NOW);
  check("alone, the successor has too few events (the defect)", alone.events.length < 8, String(alone.events.length));
  check("merged, it has its full history", merged.events.length >= 12 && latestResults(merged)?.periodEnd === "2026-06-30",
    `${merged.events.length} · ${latestResults(merged)?.periodEnd}`);
  let fetched = [];
  const fetchSubs = async (c) => { fetched.push(c); return pred; };
  const got = await W.withPredecessorSubmissions("0002115436", own, fetchSubs);
  check("withPredecessorSubmissions fetches the CITED predecessor (0000034088) for XOM's CIK",
    fetched.join() === "0000034088" && (got.filings.recent.form.length === own.filings.recent.form.length + pred.filings.recent.form.length), fetched.join());
  fetched = [];
  const same = await W.withPredecessorSubmissions("0000021344", own, fetchSubs);
  check("...and nothing for a filer with no cited predecessor (no request)", same === own && fetched.length === 0);
  const failed = await W.withPredecessorSubmissions("0002115436", own, async () => { throw new Error("HTTP 503"); });
  check("...and a failed predecessor fetch keeps the successor's own list", failed === own);
  const F = readCodeOnly("app/api/jobs/sec-facts/route.ts"), RW = readCodeOnly("app/api/jobs/sec-report-dates-rewrite/route.ts");
  check("sec-facts and the pairing rewrite both merge the predecessor before building",
    /const subs = await withPredecessorSubmissions\(cik, await fetchSubmissions\(cik\), fetchSubmissions\);/.test(F) &&
      /const subs = await withPredecessorSubmissions\(cik, await fetchSubmissions\(cik\), fetchSubmissions\);/.test(RW));
  // MUTATION: the predecessor ignored.
  const SRC = fs.readFileSync("lib/server/secReportDatesWrite.ts", "utf8");
  const ANCHOR = "    return mergeSubmissions(subs, await fetchSubmissions(pred));";
  if (SRC.split(ANCHOR).length !== 2) throw new Error("predecessor mutation anchor must match once");
  const tmp = `lib/server/.check-nrf-${process.pid}.ts`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, "    await fetchSubmissions(pred); return subs;"));
  let M;
  try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  const mut = M.buildReportDatesRecord("XOM", "2115436", set, await M.withPredecessorSubmissions("0002115436", own, async () => pred), TODAY, NOW);
  check("MUTATION: predecessor fetched but not merged → XOM back to too few events (caught)", mut.events.length < 8, String(mut.events.length));
}

console.log("\n2b. JPM: a short filing list is named as ours, not the filer's");
{
  const g = await loadOutlookGraph();
  const { outlookFrom } = g.mod;
  // A YEAR of `recent` (JPM: 26,269 filings, 2025-09-30..2026-09-30) and 70 older pages.
  const yearOnly = history(ALL.slice(-4)).concat(Array.from({ length: 40 }, (_, i) => row("424B2", "", plus("2025-10-01", i * 9))));
  const shortSubs = subsOf(yearOnly.sort((a, b) => (a.filed < b.filed ? 1 : -1)), [{ name: "CIK0000019617-submissions-001.json" }]);
  const longSubs = subsOf(history(ALL), [{ name: "older.json" }]);            // KO: pages exist, but recent spans years
  check("feedIsShort: older pages AND recent reaching back < 3 years → short", W.feedIsShort(shortSubs, TODAY) === true);
  check("feedIsShort: older pages but recent spans years (KO) → not short", W.feedIsShort(longSubs, TODAY) === false);
  check("feedIsShort: no older pages → never short (the list is whole)", W.feedIsShort(subsOf(history(ALL.slice(-4))), TODAY) === false);
  const rec = W.buildReportDatesRecord("JPM", "19617", setOf(ENDS, YEARS), shortSubs, TODAY, NOW);
  check("the record stores feedShort", rec.feedShort === true, String(rec.feedShort));
  const o = outlookFrom("JPM", rec, TODAY);
  check("JPM's refusal is 'short-feed', with its own sentence (not 'too few periods')",
    o.kind === "no-estimate" && o.reason === "short-feed" && /crowded with other documents, so the part we read holds too few of its results/.test(o.hedge ?? "") && !/too few periods for us/.test(o.hedge ?? ""),
    `${o.reason} · ${o.hedge}`);
  const whole = { ...rec, feedShort: false };
  check("the same thin record with a whole feed stays 'thin-history' (the filer's gap)", outlookFrom("JPM", whole, TODAY).reason === "thin-history");
  const legacy = { ...rec }; delete legacy.feedShort;
  check("a record written before the field (absent) stays 'thin-history'", outlookFrom("JPM", legacy, TODAY).reason === "thin-history");
  check("every reason still has its own sentence",
    new Set(["no-record", "no-period-end", "thin-history", "short-feed", "below-precision-bar", "estimate-in-past"].map((r) => g.copy.outlookReasonLabel(r))).size === 6);
  // MUTATION: the short-feed branch removed.
  const OSRC = fs.readFileSync("lib/server/symbolOutlook.ts", "utf8");
  const OA = 'skip === "thin-history" && rec?.feedShort === true ? "short-feed" : skip;';
  if (OSRC.split(OA).length !== 2) throw new Error("short-feed mutation anchor must match once");
  const gm = await loadOutlookGraph({ patch: { "lib/server/symbolOutlook.ts": (s) => s.replace(OA, "skip;") } });
  check("MUTATION: short-feed branch removed → JPM blamed for 'too few periods' again (caught)", gm.mod.outlookFrom("JPM", rec, TODAY).reason === "thin-history");
}

console.log("\n3. WDFC: a cold fill seeds the report-dates record");
{
  const set = setOf(["2025-11-30", "2026-02-28", "2026-05-31"], ["2024-08-31", "2025-08-31"]);
  const calls = [];
  const deps = (rec, s = set, ok = true) => ({
    readRecord: async () => ({ ok: true, rec }),
    readSet: async () => s,
    build: async (sym, cik, st, subs, today) => { calls.push({ sym, cik, today, n: subs.filings.recent.form.length }); return { ok, events: [], next: { kind: "none" }, pending: null }; },
  });
  const subs = subsOf(history(ALL.slice(-3)));
  const fetchSubs = async () => subs;
  check("no record → written through the one builder", (await C.seedColdReportDates("WDFC", "0000105132", fetchSubs, TODAY, 1000, deps(null))) === "written" && calls.length === 1 && calls[0].sym === "WDFC");
  calls.length = 0;
  check("a record already there → 'exists', nothing fetched or written", (await C.seedColdReportDates("WDFC", "0000105132", async () => { throw new Error("must not fetch"); }, TODAY, 1000, deps({ at: NOW, events: [] }))) === "exists" && calls.length === 0);
  check("no stored set → 'no-set' (nothing to pair against)", (await C.seedColdReportDates("WDFC", "0000105132", fetchSubs, TODAY, 1000, deps(null, null))) === "no-set");
  check("a submissions failure → 'failed', never thrown", (await C.seedColdReportDates("WDFC", "0000105132", async () => { throw new Error("HTTP 503"); }, TODAY, 1000, deps(null))) === "failed");
  check("a slow fetch → 'timeout' at the bound, never holds the fill",
    (await C.seedColdReportDates("WDFC", "0000105132", () => new Promise(() => {}), TODAY, 50, deps(null))) === "timeout");
  const A = readCodeOnly("app/stock/[symbol]/coldFillAction.ts");
  check("the action seeds on 'filled' only, BEFORE revalidating the pages",
    /const dates = outcome !== "filled" \? null/.test(A) &&
      A.indexOf(": await seedColdReportDates(") > 0 && A.indexOf(": await seedColdReportDates(") < A.indexOf("revalidatePath(`/stock/${clean}`)"));
  check("the seed's SEC fetch is the cold path's own (fetchColdSubmissions), with no hand-rolled fetch or User-Agent fallback in the action",
    /seedColdReportDates\(clean, cikForSymbol\(clean\) as string, fetchColdSubmissions,/.test(A) &&
      !/data\.sec\.gov/.test(A) && !/SEC_USER_AGENT/.test(A) && /!coldSecConfigured\(\) \? "skipped-no-user-agent"/.test(A));
  const CF = readCodeOnly("lib/server/secColdFetch.ts");
  const body = CF.slice(CF.indexOf("export async function fetchColdSubmissions"), CF.indexOf("async function fetchFactsFor"));
  check("...which refuses with no User-Agent and claims the cold minute bucket (secCounterPrefix) before any request",
    /if \(!SEC_UA\) throw/.test(body) && /await claimColdFetch\(/.test(body) &&
      body.indexOf("await claimColdFetch(") < body.indexOf("await fetch(") && !/cache: "no-store"/.test(body) &&
      /const coldRateKey = \(d = new Date\(\)\) =>\s*`\$\{secCounterPrefix\(RATE_PREFIX\)\}/.test(CF));
  const claims = (b) => /if \(!SEC_UA\) throw/.test(b) && /await claimColdFetch\(/.test(b) && b.indexOf("await claimColdFetch(") < b.indexOf("await fetch(");
  const CLAIM = '  if (!(await claimColdFetch(`submissions ${cik}`))) throw new Error("cold rate budget exhausted");\n';
  if (body.split(CLAIM).length !== 2) throw new Error("claim mutation anchor must match once");
  check("MUTATION: the bucket claim removed → an uncounted SEC request from a page view (caught)", claims(body) && !claims(body.replace(CLAIM, "")));
  check("the bound is inside the client's 12 s ceiling", C.COLD_DATES_TIMEOUT_MS <= 4000, String(C.COLD_DATES_TIMEOUT_MS));
  // MUTATION: the "exists" guard removed → a warm fill re-fetches and rewrites.
  const CS = fs.readFileSync("lib/server/secColdReportDates.ts", "utf8");
  const CA = '    if (read.rec) return "exists";\n';
  if (CS.split(CA).length !== 2) throw new Error("exists mutation anchor must match once");
  const tmp = `lib/server/.check-nrf-c-${process.pid}.ts`;
  fs.writeFileSync(tmp, CS.replace(CA, ""));
  let MC;
  try { MC = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  calls.length = 0;
  await MC.seedColdReportDates("WDFC", "0000105132", fetchSubs, TODAY, 1000, deps({ at: NOW, events: [] }));
  check("MUTATION: the 'exists' guard removed → a warm fill rewrites the record (caught)", calls.length === 1);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
