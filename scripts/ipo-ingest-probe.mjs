// Run the SHIPPED daily ingest against live EDGAR, and render what it produces.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Steps 3-5 of the IPO build have only ever been FIXTURE-PROVEN. Every rule has
// a behavioural test and none of them has ever met a real filing: the seed ran
// against `form.idx` on a runner, and the classifier ran against synthetic
// records. This is the first exercise of the whole chain on live data --
//
//     daily index -> touched filers -> submissions -> covers
//       -> mergeIpoRecords -> validateStored -> buildSecIpoTables
//
// -- and it calls the SAME FUNCTIONS the app calls. It re-implements nothing.
// That is the point: a probe with its own copy of the walk would tell us about
// the probe.
//
// ── WHY ON THE RELAY ───────────────────────────────────────────────────────
// The agent sandbox is refused www.sec.gov and data.sec.gov with 403 CONNECT
// (re-tested 2026-09-21; still a policy denial). A runner is not.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
// WRITE. This is the read-only job; it holds no Upstash credential and the
// client is not even installed. The write is app-side, in
// app/api/jobs/ipo-refresh, because that is where the write token lives. So
// this proves everything up to and including the document that WOULD be
// written, and prints its size and validation verdict -- the two things a
// refused SET could otherwise hide until it was tried.
//
//   dispatch relay.yml, task `ipo-ingest`
//   inputs: symbols = "<from>[..<to>]" as yyyymmdd, blank = the last 7 days
import fs from "node:fs";

import { ingestIpoWindow } from "../lib/server/ipoIngest.ts";
import { mergeIpoRecords, validateStored, windowStartFor } from "../lib/server/ipoRecordMerge.ts";
import { buildSecIpoTables } from "../lib/server/ipoSecSource.ts";
import { indexByCik } from "../lib/server/ipoExclusions.ts";
import { addDays, latestProcessableDate } from "../lib/server/secDailyIndex.ts";

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";
if (!SEC_UA.includes("@")) {
  console.error("FATAL: SEC_USER_AGENT carries no contact address. SEC will 403.");
  process.exit(1);
}

const NOW = new Date();
const LATEST = latestProcessableDate(NOW);

// The relay forwards `symbols` already, so the window rides in it rather than
// costing a merge to main for a dedicated input. "<from>" or "<from>..<to>".
const RANGE = (process.env.SYMBOLS ?? "").trim();
const m = RANGE.match(/^(\d{8})(?:\.\.(\d{8}))?$/);
const FROM = m ? m[1] : addDays(LATEST, -6);
const TO = m?.[2] ?? LATEST;
const MAX_DAYS = Number(process.env.IPO_PROBE_MAX_DAYS || 20);

console.log("=".repeat(78));
console.log(`IPO INGEST PROBE — the shipped ingest, live EDGAR, no write`);
console.log(`   walking ${FROM}..${TO}  (latest processable: ${LATEST})`);
console.log("=".repeat(78));

const windowStart = windowStartFor(NOW);
console.log(`\n   window start (prune boundary): ${windowStart}`);

const result = await ingestIpoWindow({
  ua: SEC_UA,
  windowStart,
  from: FROM,
  to: TO,
  maxDays: MAX_DAYS,
  now: NOW,
});

console.log(`\n${"═".repeat(78)}\nTHE WALK\n${"═".repeat(78)}`);
for (const d of result.days) {
  const extra =
    d.outcome === "parsed"
      ? `${String(d.indexRows).padStart(5)} rows · ${String(d.filers).padStart(3)} filers · ${d.noticesSkipped} notice(s) skipped`
      : d.outcome === "absent"
        ? `no index published (HTTP ${d.status}) — weekend or holiday`
        : `HTTP ${d.status} — ${d.reason}`;
  console.log(`   ${d.date}  ${d.outcome.padEnd(7)} ${String(d.ms).padStart(6)}ms  ${extra}`);
}
console.log(`\n   filers touched          ${String(result.filersTouched).padStart(5)}`);
console.log(`   submissions read        ${String(result.submissionsRead).padStart(5)}`);
console.log(`   submissions FAILED      ${String(result.submissionsFailed).padStart(5)}`);
console.log(`   covers fetched          ${String(result.coversFetched).padStart(5)}`);
console.log(`   covers with terms       ${String(result.coversParsed).padStart(5)}`);
// A CATEGORY THAT SHOULD BE SMALL BEING LARGE IS THE SIGNAL, and one that should
// be EMPTY being non-empty doubly so. Printed unconditionally: an alarm that
// only prints when it fires is an alarm nobody has seen work.
console.log(`   EDGAR notices skipped   ${String(result.noticesSkipped).padStart(5)}  (9999999995-* — EFFECT and the like; NOT company filings)`);
console.log(`   histories TRUNCATED     ${String(result.historyTruncated.length).padStart(5)}  ${result.historyTruncated.length ? `>>> ${result.historyTruncated.join(", ")} — submissions.recent should hold a year; if it does not, an 8-A12B just outside it reads as a follow-on` : "(expected: 0)"}`);
console.log(`   SEC requests            ${String(result.requests).padStart(5)}`);
console.log(`   stopped on deadline     ${result.stoppedOnDeadline}`);
console.log(`   elapsed                 ${String(result.ms).padStart(5)}ms`);

const failed = result.days.filter((d) => d.outcome === "failed");
if (failed.length) {
  console.log(`\n   >>> ${failed.length} day(s) FAILED. The watermark would stop at ${result.lastIndexDate ?? "(nothing)"}.`);
}

// ── THE DOCUMENT THAT WOULD BE WRITTEN ────────────────────────────────────
// Built by the SAME merge the route calls, with an empty `existing` because
// this runner cannot read the store. That makes it a cold-start document, which
// is the harder case: nothing carried forward can mask a record this run failed
// to build.
const doc = mergeIpoRecords([], result.records, windowStart, NOW.getTime(), {
  lastIndexDate: result.lastIndexDate,
});
const valid = validateStored(doc);
const bytes = JSON.stringify(doc).length;
console.log(`\n${"═".repeat(78)}\nTHE DOCUMENT (not written — this job holds no write credential)\n${"═".repeat(78)}`);
console.log(`   records            ${doc.records.length}`);
console.log(`   windowStart        ${doc.windowStart}`);
console.log(`   lastIndexDate      ${doc.lastIndexDate}`);
console.log(`   validates          ${valid.ok ? "yes" : `NO — ${valid.reason}`}`);
console.log(`   bytes              ${bytes}  (Upstash's per-request ceiling is 10 MB)`);

// ── THE RENDER PATH ───────────────────────────────────────────────────────
// buildSecIpoTables is what /upcoming-ipos calls. Running it here is what makes
// this an end-to-end exercise rather than an ingest test: a record set that
// merges and validates can still classify to two empty tables.
const tick = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
  headers: { "User-Agent": SEC_UA, accept: "*/*" },
});
if (!tick.ok) {
  console.error(`FATAL: ticker map unreadable (HTTP ${tick.status}). The already-listed filter removes 141 of 187 upper candidates and MUST NOT be skipped — running without it would report a busy page that is mostly resale registrations.`);
  process.exit(1);
}
const tj = JSON.parse(await tick.text());
const fi = tj.fields ?? [];
const symbolKeyed = new Map();
for (const row of tj.data ?? []) {
  const ticker = row[fi.indexOf("ticker")];
  if (!ticker) continue;
  symbolKeyed.set(String(ticker), {
    cik: String(row[fi.indexOf("cik")]),
    exchange: row[fi.indexOf("exchange")] ?? null,
  });
}
// THE SAME INVERSION THE RENDER USES. The file is keyed by SYMBOL; a direct
// has(cik) type-checks and is always false.
const listedByCik = indexByCik(symbolKeyed);
console.log(`\n   ticker map: ${symbolKeyed.size} symbols -> ${listedByCik.size} distinct CIKs`);

const { upcoming, recent, funnel } = buildSecIpoTables(doc.records, listedByCik, 90, NOW);

console.log(`\n${"═".repeat(78)}\nTHE FUNNEL — buildSecIpoTables(), the same call the render makes\n${"═".repeat(78)}`);
console.log(`   filer records in                    ${String(funnel.records).padStart(5)}`);
console.log(`\n   UPPER  candidates (amendment, no 424B) ${String(funnel.upperCandidates).padStart(4)}`);
console.log(`     − already listed  [class a + c]     ${String(funnel.droppedAlreadyListed).padStart(4)}`);
console.log(`     − ETF / trust     [class b]         ${String(funnel.droppedEntity).padStart(4)}`);
console.log(`     − no terms on the cover             ${String(funnel.droppedNoTerms).padStart(4)}`);
console.log(`     − withdrawn RW/AW after amendment   ${String(funnel.droppedWithdrawn).padStart(4)}`);
console.log(`     − stale                             ${String(funnel.droppedStale).padStart(4)}`);
console.log(`   = UPCOMING                            ${String(funnel.upcoming).padStart(4)}`);
console.log(`\n   LOWER  candidates (424B in last 30d)  ${String(funnel.lowerCandidates).padStart(4)}`);
console.log(`     − follow-on                         ${String(funnel.droppedFollowOn).padStart(4)}`);
console.log(`         both tests agree                ${String(funnel.followOnBothAgree).padStart(4)}`);
console.log(`         no-8-A12B only                  ${String(funnel.followOnNoExchangeOnly).padStart(4)}  (Advance JV's shape: a real first-time offering that is not an EXCHANGE listing)`);
console.log(`         prior-reporting only            ${String(funnel.followOnPriorReportingOnly).padStart(4)}`);
console.log(`     − no terms on the cover             ${String(funnel.droppedNoTermsLower).padStart(4)}`);
console.log(`   = RECENT                              ${String(funnel.recent).padStart(4)}`);

console.log(`\n── UPPER TABLE (${upcoming.length})`);
for (const r of upcoming) {
  const range =
    r.priceRangeLow === null
      ? "—"
      : r.priceRangeLow === r.priceRangeHigh
        ? `$${r.priceRangeLow.toFixed(2)}`
        : `$${r.priceRangeLow.toFixed(2)}-$${r.priceRangeHigh.toFixed(2)}`;
  console.log(`   ${(r.symbol ?? "—").padEnd(6)} ${r.company.slice(0, 38).padEnd(40)} terms ${r.date} · ${(r.exchange ?? "—").padEnd(28)} ${range}`);
}
console.log(`\n── LOWER TABLE (${recent.length})`);
for (const r of recent) {
  const range =
    r.priceRangeLow === null
      ? "—"
      : r.priceRangeLow === r.priceRangeHigh
        ? `$${r.priceRangeLow.toFixed(2)}`
        : `$${r.priceRangeLow.toFixed(2)}-$${r.priceRangeHigh.toFixed(2)}`;
  console.log(`   ${(r.symbol ?? "—").padEnd(6)} ${r.company.slice(0, 38).padEnd(40)} listed ${r.date} · ${(r.exchange ?? "—").padEnd(28)} ${range}`);
}

// A WALK OF ONE WEEK CANNOT FILL EITHER TABLE, and saying so here is what stops
// a small number being read as a quiet market. The upper table draws on 45 days
// of amendments and the lower on 30 days of prospectuses; this run walked
// however many days it was asked for.
console.log(
  `\n   NOTE: this probe walked ${result.days.length} day(s) from a COLD start, so these two\n` +
    `   tables are what that slice alone produces. The upper table draws on 45 days of\n` +
    `   amendments and the lower on 30 days of final prospectuses, so a short walk\n` +
    `   UNDER-FILLS both by construction. Row counts here are not comparable to the\n` +
    `   seed's 19/8 unless the walk covered the same span.`
);

fs.mkdirSync("data/sec", { recursive: true });
const payload = {
  probedAt: NOW.toISOString(),
  walked: [FROM, TO],
  days: result.days,
  counters: {
    filersTouched: result.filersTouched,
    submissionsRead: result.submissionsRead,
    submissionsFailed: result.submissionsFailed,
    coversFetched: result.coversFetched,
    coversParsed: result.coversParsed,
    noticesSkipped: result.noticesSkipped,
    historyTruncated: result.historyTruncated,
    requests: result.requests,
    ms: result.ms,
  },
  document: { records: doc.records.length, bytes, valid, lastIndexDate: doc.lastIndexDate },
  funnel,
  upcoming,
  recent,
};
fs.writeFileSync("data/sec/ipo-ingest-probe.json", JSON.stringify(payload));
fs.writeFileSync("data/sec/ipo-ingest-document.json", JSON.stringify(doc));
console.log(`\n<<<RAW name=ipo-ingest-probe.json bytes=0>>>`);
console.log(JSON.stringify(payload, null, 2).slice(0, 120000));
console.log(`<<<ENDRAW name=ipo-ingest-probe.json>>>`);

// ── THE DOCUMENT ITSELF, COMPACT, IN ITS OWN BLOCK ────────────────────────
// Separate and unindented on purpose. The summary above is pretty-printed for
// reading; the document is what scripts/local-upstash.mjs is seeded from, and
// pretty-printing 198 records would push it past the log's practical limit and
// truncate it into invalid JSON -- which reads as a parse bug rather than as a
// truncation. The sandbox cannot reach the Actions artifact blob host, so this
// log block is the only way the records get back to where the render runs.
console.log(`\n<<<RAW name=ipo-ingest-document.json bytes=${JSON.stringify(doc).length}>>>`);
console.log(JSON.stringify(doc));
console.log(`<<<ENDRAW name=ipo-ingest-document.json>>>`);
console.log(`\nDONE ${new Date().toISOString()}`);
