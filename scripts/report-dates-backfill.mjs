// THE feedShort BACKFILL (#552 COWORK #182 part 2). Three modes, one script:
//
//   MODE=scan   READ-ONLY. Every report-dates record (SCAN + MGET): how many
//               carry feedShort, which, and their usable periods.
//   MODE=dry    READ-ONLY. For each feedShort record (or SYMBOLS=…): one
//               submissions request, then the older pages it WOULD read (the
//               ones reaching back inside four years), as an upper bound.
//   MODE=apply  WRITES the report-dates record only (one SET per symbol). Runs
//               only from a checkout that carries the merge-don't-rebuild fix
//               (carryOlderEvents), so the next nightly rebuild keeps what this
//               adds; it refuses to run otherwise.
//
// IT RUNS THE SHIPPED BUILDER, NOT A COPY: buildReportDatesRecord,
// carryOlderEvents, feedIsShort and mergeSubmissions are lifted from
// lib/server/secReportDatesWrite.ts, the pairing from secReportDates.ts, and
// the bar from expectedToReport.ts. The older pages are appended to `recent`
// exactly as mergeSubmissions appends a predecessor's list.
//
// STOP RULE: pages newest first; stop at 16 results events since the four-year
// cutoff, or at the first page wholly older than the cutoff. SEC ≤ 8 req/s
// (125 ms gap, sequential). feedShort is kept as the live `recent` computes it,
// so the nightly rebuild writes the same value and the record does not flap.
// The results-day index is not touched: it serves the last seven days only.
//
// Store guard: every Upstash command is checked against the mode's list before
// it leaves; anything else throws. Commands are counted.
import ts from "typescript";
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const MODE = process.env.MODE || "scan";
if (!["scan", "dry", "apply"].includes(MODE)) { console.error(`FATAL: MODE ${MODE}`); process.exit(2); }
const ALLOWED = new Set(MODE === "apply" ? ["get", "mget", "scan", "set"] : ["get", "mget", "scan"]);
const counts = {};
let secRequests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    const cmds = Array.isArray(body?.[0]) ? body : [body];
    for (const c of cmds) {
      const op = String(c?.[0]).toLowerCase();
      if (!ALLOWED.has(op)) throw new Error(`store guard: ${op} refused in MODE=${MODE}`);
      if (op === "set" && !String(c[1]).startsWith(`${DATES_PREFIX}:`)) throw new Error(`store guard: set outside ${DATES_PREFIX}`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!DATES_PREFIX || !FACTS_PREFIX) { console.error("FATAL: a key prefix moved"); process.exit(2); }
const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; report-dates backfill)";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();
const CUTOFF = `${Number(TODAY.slice(0, 4)) - 4}${TODAY.slice(4)}`;
const TARGET_EVENTS = 16;
const NAMED = ["JPM", "BAC", "GS", "WFC", "MS"];

// ── THE SHIPPED CODE, LIFTED ────────────────────────────────────────────────
const decl = (file, name) => {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const n = sf.statements.find((s) =>
    (ts.isFunctionDeclaration(s) && s.name?.text === name) ||
    (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(sf) === name)) ||
    (ts.isTypeAliasDeclaration(s) && s.name.text === name));
  if (!n) return null;
  return n.getText(sf).replace(/^export /, "");
};
const W = "lib/server/secReportDatesWrite.ts";
const carry = decl(W, "carryOlderEvents");
if (!carry) {
  console.error("FATAL: this checkout has no carryOlderEvents; the next rebuild would wipe a backfill. Run from a branch carrying the merge-don't-rebuild fix.");
  process.exit(2);
}
const RD = readCodeOnly("lib/server/secReportDates.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1");
const builderSrc = [decl(W, "buildReportDatesRecord"), decl(W, "FEED_SHORT_YEARS"), decl(W, "feedIsShort"),
  decl(W, "mergeSubmissions"), decl(W, "SubmissionsFilingsLike"), carry].join("\n");
const B = await lift(RD + "\n" + decl("lib/server/secReportDatesStore.ts", "STORED_EVENT_LIMIT") + "\n" + builderSrc +
  "\nexport { buildReportDatesRecord, feedIsShort, mergeSubmissions };", "", "builder");
const EX = readCodeOnly("lib/server/expectedToReport.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type|async function)/g, "$1");
const X = await lift(EX + "\nexport { expectedFrom, lagsFrom, lagHabit };", "", "expectedToReport");
const verdict = (sym, rec) => {
  const got = X.expectedFrom(sym, rec, TODAY, new Set());
  const lags = X.lagsFrom(rec?.events).lags.length;
  const clears = "row" in got || ["beyond-window", "estimate-in-past", "already-due"].includes(got.skip);
  return `${rec?.events?.length ?? 0} events, ${lags} lags · ${"row" in got ? `on the grid (${got.row.daysAway}d)` : got.skip} · ${clears ? "CLEARS the bar" : "does not clear"}`;
};

// ── SCAN ────────────────────────────────────────────────────────────────────
async function allRecords() {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${DATES_PREFIX}:*`, count: 1000 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== "0");
  const recs = new Map();
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const raw = await redis.mget(...chunk);
    chunk.forEach((k, j) => recs.set(k.slice(DATES_PREFIX.length + 1), raw[j]));
  }
  return recs;
}

const recs = await allRecords();
const short = [...recs].filter(([, r]) => r && r.feedShort === true).map(([s]) => s).sort();
console.log(`1. SCAN: ${recs.size} report-dates records · ${short.length} carry feedShort`);
for (const s of short) console.log(`   ${s.padEnd(7)} ${verdict(s, recs.get(s))}`);
for (const s of NAMED) if (!short.includes(s)) console.log(`   (named ${s}: ${recs.has(s) ? `feedShort ${recs.get(s)?.feedShort}` : "no record"})`);
if (MODE === "scan") { done(); process.exit(0); }

// ── DRY / APPLY ─────────────────────────────────────────────────────────────
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const cikOf = (s) => recs.get(s)?.cik ?? manifest?.symbols?.[s]?.cik ?? REG[s]?.cik ?? null;
const pad10 = (c) => String(c).replace(/\D/g, "").padStart(10, "0");
let lastAt = 0;
async function sec(url) {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  secRequests++;
  const res = await realFetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
const RESULTS = /(^|,)\s*2\.02\b/;
const resultsSince = (cols) => {
  let n = 0;
  for (let i = 0; i < (cols.accessionNumber?.length ?? 0); i++) {
    if ((cols.filingDate?.[i] ?? "") < CUTOFF) continue;
    const f = cols.form?.[i];
    if ((f === "8-K" || f === "8-K/A") && RESULTS.test(cols.items?.[i] ?? "")) n++;
  }
  return n;
};
const asSubs = (page) => ({ filings: { recent: page } });

const targets = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
const list = targets.length ? targets : [...new Set([...short, ...NAMED])];
console.log(`\n2. ${MODE.toUpperCase()}: ${list.length} symbols · cutoff ${CUTOFF} · stop at ${TARGET_EVENTS} results 8-Ks`);
let planned = 0, written = 0;
for (const sym of list) {
  const cik = cikOf(sym);
  if (!cik) { console.log(`   ${sym}: no CIK, skipped`); continue; }
  let subs;
  try { subs = await sec(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`); }
  catch (e) { console.log(`   ${sym}: submissions ${e.message}, skipped`); continue; }
  const pages = [...(subs.filings?.files ?? [])].sort((a, b) => String(b.filingTo).localeCompare(String(a.filingTo)));
  const inRange = pages.filter((p) => !p.filingTo || p.filingTo >= CUTOFF);
  const before = recs.get(sym) ?? null;
  if (MODE === "dry") {
    planned += inRange.length;
    console.log(`   ${sym.padEnd(6)} recent ${resultsSince(subs.filings.recent)} results 8-Ks since cutoff · older pages ${pages.length}, at most ${inRange.length} to read · now: ${verdict(sym, before)}`);
    continue;
  }
  const set = await redis.get(`${FACTS_PREFIX}:${sym}`);
  if (!set?.quarters) {
    // WHY THERE IS NO RECORD: report dates are built beside a fact set, so no
    // set means nothing was ever paired. Say whether the manifest lists it.
    console.log(`   ${sym}: no fact set (manifest entry: ${manifest?.symbols?.[sym] ? "yes" : "no"}), skipped; a record needs a fact set beside it`);
    continue;
  }
  let merged = subs, read = 0, found = resultsSince(subs.filings.recent);
  for (const p of inRange) {
    if (found >= TARGET_EVENTS) break;
    let page;
    try { page = await sec(`https://data.sec.gov/submissions/${p.name}`); }
    catch (e) { console.log(`   ${sym}: page ${p.name} ${e.message}; stopping this symbol's pages`); break; }
    read++;
    found += resultsSince(page);
    merged = B.mergeSubmissions(merged, asSubs(page));
  }
  const rec = B.buildReportDatesRecord(sym, String(cik), set, merged, TODAY, NOW, before);
  rec.feedShort = B.feedIsShort(subs, TODAY);
  // THE NEXT NIGHTLY REBUILD, SIMULATED with the shipped builder on the live
  // `recent` alone: what it keeps is what the backfill is worth.
  const nightly = B.buildReportDatesRecord(sym, String(cik), set, subs, TODAY, NOW, rec);
  if (nightly.events.length < rec.events.length) {
    console.log(`   ${sym}: the simulated nightly rebuild keeps ${nightly.events.length} of ${rec.events.length}; NOT written`);
    continue;
  }
  await redis.set(`${DATES_PREFIX}:${sym}`, rec);
  written++;
  console.log(`   ${sym.padEnd(6)} pages read ${read}, results 8-Ks since cutoff ${found}`);
  console.log(`          before: ${verdict(sym, before)}`);
  console.log(`          after:  ${verdict(sym, rec)}`);
}
if (MODE === "dry") console.log(`   planned page requests (upper bound): ${planned}, plus ${list.length} submissions`);
else console.log(`   records written: ${written}`);
done();

function done() {
  console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${secRequests}`);
}
